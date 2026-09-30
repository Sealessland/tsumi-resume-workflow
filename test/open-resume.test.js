import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createResumeOpenPlan } from '../scripts/resume-open-plan.mjs'

const workspaceDir = resolve(import.meta.dirname, '..')

test('resolves an explicitly selected resume from the working directory', () => {
  const plan = createResumeOpenPlan({
    args: ['fixtures/public-example.json'],
    cwd: workspaceDir,
    origin: 'http://localhost:5173/editor',
  })

  assert.equal(plan.dryRun, false)
  assert.equal(plan.resumePath, resolve(workspaceDir, 'fixtures/public-example.json'))
  assert.equal(plan.pageUrl, 'http://localhost:5173/')
})

test('rejects multiple selected resumes', () => {
  assert.throws(
    () => createResumeOpenPlan({ args: ['one.json', 'two.json'], cwd: workspaceDir }),
    /用法：npm run resume:open -- \[resume\.json\]/,
  )
})
