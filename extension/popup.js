const $ = id => document.getElementById(id);

async function fillPageDetails() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const details = await chrome.tabs.sendMessage(tab.id, { type: 'job-page' }).catch(() => ({ jobUrl: tab.url }));
  $('jobUrl').value = details.jobUrl || tab.url || '';
  $('position').value = details.position || '';
  $('company').value = details.company || '';
  const saved = await chrome.storage.local.get('secret');
  $('secret').value = saved.secret || '';
  const settings = await chrome.storage.local.get('autoArchive');
  $('autoArchive').checked = Boolean(settings.autoArchive);
}

$('autoArchive').addEventListener('change', () => chrome.storage.local.set({ autoArchive: $('autoArchive').checked }));

$('archive').addEventListener('click', async () => {
  const secret = $('secret').value.trim();
  const status = $('status');
  if (!secret) return status.value = '请先填写本机桥接密钥。';
  await chrome.storage.local.set({ secret });
  status.value = '正在写入并回读验证…';
  const payload = { company: $('company').value, position: $('position').value, jobUrl: $('jobUrl').value, note: $('note').value, appliedAt: localDateTime() };
  try {
    const result = await chrome.runtime.sendMessage({ type: 'archive', payload });
    if (!result.ok) throw new Error(result.error || '写入失败');
    status.value = `已归档并回读验证：${result.recordId}`;
  } catch (error) { status.value = `归档失败：${error.message}`; }
});

fillPageDetails();

function localDateTime() {
  const date = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
