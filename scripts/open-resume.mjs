import { access, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createResumeOpenPlan } from './resume-open-plan.mjs'

const RENDERER_DIR = resolve(homedir(), 'tsumi_resume')
const RESUME_ORIGIN = process.env.TSUMI_RESUME_ORIGIN || 'http://127.0.0.1:4173'
const CHROME_BIN = process.env.TSUMI_CHROME_BIN || 'google-chrome-stable'
const FILE_INPUT_SELECTOR = 'input[type="file"][accept*=".json"]'
const IMPORT_SUCCESS_TEXT = 'JSON 导入成功，已替换当前简历。'
const IMPORT_FAILURE_TEXT = 'JSON 导入失败，请检查文件内容是否正确。'

const BROWSER_STATE_FILE = join(tmpdir(), 'tsumi-resume-browser.json')
const plan = createResumeOpenPlan({
  args: process.argv.slice(2),
  origin: RESUME_ORIGIN,
})
const { dryRun, resumePath, pageUrl: PAGE_URL } = plan

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function waitForCondition(check, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastError

  while (Date.now() < deadline) {
    try {
      const result = await check()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }

  const detail = lastError ? `：${lastError.message}` : ''
  throw new Error(`等待${description}超时${detail}`)
}

function startDetached(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return child
}

async function ensureRenderer() {
  try {
    const response = await fetch(PAGE_URL)
    if (response.ok) return
  } catch {
    // Start the renderer below.
  }

  const origin = new URL(RESUME_ORIGIN)
  const port = origin.port || '4173'
  startDetached(
    'npm',
    ['run', 'dev', '--', '--host', origin.hostname, '--port', port, '--strictPort'],
    RENDERER_DIR,
  )

  await waitForCondition(async () => {
    const response = await fetch(PAGE_URL)
    return response.ok
  }, '本地简历渲染器启动')
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  const eventWaiters = new Map()
  let nextId = 1

  const opened = new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', () => rejectOpen(new Error('无法连接 Chrome DevTools')), {
      once: true,
    })
  })

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))

    if (message.id) {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) {
        request.reject(new Error(`${message.error.message} (${message.error.code})`))
      } else {
        request.resolve(message.result)
      }
      return
    }

    const waiters = eventWaiters.get(message.method)
    if (!waiters?.length) return
    eventWaiters.delete(message.method)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(message.params || {})
    }
  })

  async function send(method, params = {}) {
    await opened
    const id = nextId
    nextId += 1

    return new Promise((resolveRequest, rejectRequest) => {
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async function waitForEvent(method, timeoutMs = 10_000) {
    await opened
    return new Promise((resolveEvent, rejectEvent) => {
      const timer = setTimeout(() => {
        const waiters = eventWaiters.get(method) || []
        eventWaiters.set(method, waiters.filter((waiter) => waiter.resolve !== resolveEvent))
        rejectEvent(new Error(`等待 Chrome 事件 ${method} 超时`))
      }, timeoutMs)
      const waiters = eventWaiters.get(method) || []
      waiters.push({ resolve: resolveEvent, reject: rejectEvent, timer })
      eventWaiters.set(method, waiters)
    })
  }

  function close() {
    socket.close()
  }

  return { opened, send, waitForEvent, close }
}

async function evaluate(client, expression, { userGesture = false } = {}) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture,
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || '浏览器脚本执行失败')
  }
  return response.result?.value
}


async function closePreviousBrowser() {
  try {
    const state = JSON.parse(await readFile(BROWSER_STATE_FILE, 'utf8'))
    if (state.webSocketDebuggerUrl) {
      const client = createCdpClient(state.webSocketDebuggerUrl)
      await client.send('Browser.close').catch(() => {})
      client.close()
    }
  } catch {
    // No previous tool-owned browser, or it has already exited.
  } finally {
    await unlink(BROWSER_STATE_FILE).catch(() => {})
  }
}

async function launchBrowser() {
  await closePreviousBrowser()
  const profileDir = await mkdtemp(join(tmpdir(), 'tsumi-resume-chrome-'))
  const headless = process.env.TSUMI_RESUME_HEADLESS === '1'
  const chromeArgs = [
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
  ]

  if (headless) {
    chromeArgs.push('--headless=new', '--disable-gpu', '--window-size=1440,2200')
  }
  if (process.env.TSUMI_RESUME_NO_SANDBOX === '1') {
    chromeArgs.push('--no-sandbox')
  }
  chromeArgs.push(PAGE_URL)

  const chrome = startDetached(CHROME_BIN, chromeArgs, process.cwd())
  let launchError
  chrome.once('error', (error) => {
    launchError = error
  })

  const devToolsFile = join(profileDir, 'DevToolsActivePort')
  const devTools = await waitForCondition(async () => {
    if (launchError) throw launchError
    const content = await readFile(devToolsFile, 'utf8')
    const [port] = content.trim().split(/\r?\n/)
    return port ? { port } : null
  }, 'Chrome DevTools 启动')

  const version = await waitForCondition(async () => {
    const response = await fetch(`http://127.0.0.1:${devTools.port}/json/version`)
    if (!response.ok) return null
    return response.json()
  }, 'Chrome DevTools 版本信息')
  await writeFile(BROWSER_STATE_FILE, JSON.stringify({
    webSocketDebuggerUrl: version.webSocketDebuggerUrl,
  }))

  const target = await waitForCondition(async () => {
    const response = await fetch(`http://127.0.0.1:${devTools.port}/json/list`)
    if (!response.ok) return null
    const targets = await response.json()
    return targets.find((item) => item.type === 'page' && item.url.startsWith(PAGE_URL))
  }, '简历编辑页加载')

  return {
    client: createCdpClient(target.webSocketDebuggerUrl),
    headless,
  }
}

async function importResumeThroughToolbar(client, expectedName) {
  await client.opened
  await Promise.all([
    client.send('Page.enable'),
    client.send('DOM.enable'),
    client.send('Runtime.enable'),
  ])

  await waitForCondition(async () => evaluate(
    client,
    `Boolean(document.querySelector(${JSON.stringify(FILE_INPUT_SELECTOR)}))`,
  ), '“导入 JSON”文件入口出现')

  await client.send('Page.setInterceptFileChooserDialog', { enabled: true })
  const chooserOpened = client.waitForEvent('Page.fileChooserOpened')
  const importButtonClicked = await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === '导入 JSON')
    if (!button) return false
    button.click()
    return true
  })()`, { userGesture: true })
  if (!importButtonClicked) throw new Error('未找到“导入 JSON”按钮')

  const chooser = await chooserOpened
  await client.send('DOM.setFileInputFiles', {
    backendNodeId: chooser.backendNodeId,
    files: [resumePath],
  })
  await client.send('Page.setInterceptFileChooserDialog', { enabled: false })

  return waitForCondition(async () => {
    const state = await evaluate(client, `(() => {
      const text = document.body?.innerText || ''
      const name = document.querySelector('input[placeholder="请输入姓名"]')?.value || ''
      return {
        imported: text.includes(${JSON.stringify(IMPORT_SUCCESS_TEXT)}),
        failed: text.includes(${JSON.stringify(IMPORT_FAILURE_TEXT)}),
        name,
        overflow: text.includes('当前内容已超过一页 A4'),
      }
    })()`)

    if (state.failed) throw new Error(IMPORT_FAILURE_TEXT)
    if (!state.imported) return null
    if (expectedName && state.name !== expectedName) return null
    return state
  }, '目标 JSON 导入完成')
}

async function main() {
  await access(resumePath)
  await access(RENDERER_DIR)

  const resume = JSON.parse(await readFile(resumePath, 'utf8'))
  const expectedName = String(resume.profile?.name || '')

  await ensureRenderer()
  const browser = await launchBrowser()

  try {
    const state = await importResumeThroughToolbar(browser.client, expectedName)
    const screenshotPath = process.env.TSUMI_RESUME_SCREENSHOT
    if (screenshotPath) {
      const screenshot = await browser.client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      })
      await writeFile(resolve(screenshotPath), Buffer.from(screenshot.data, 'base64'))
    }
    const pdfPath = process.env.TSUMI_RESUME_PDF
    if (pdfPath) {
      await browser.client.send('Emulation.setEmulatedMedia', { media: 'print' })
      const pdf = await browser.client.send('Page.printToPDF', {
        printBackground: true,
        preferCSSPageSize: true,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
      })
      await writeFile(resolve(pdfPath), Buffer.from(pdf.data, 'base64'))
      console.log(`已导出 PDF：${resolve(pdfPath)}`)
    }

    console.log(`已通过“导入 JSON”加载：${basename(resumePath)}`)
    console.log(`候选人：${state.name || '未填写'}`)
    console.log(state.overflow ? '提醒：当前内容超过一页 A4。' : '页面未检测到 A4 溢出。')
  } finally {
    if (browser.headless) {
      await browser.client.send('Browser.close').catch(() => {})
    }
    browser.client.close()
  }
}

if (dryRun) {
  console.log(JSON.stringify(plan))
} else {
  await main()
}
