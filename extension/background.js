chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'archive') return;
  archive(message.payload).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function archive(payload) {
  const { secret } = await chrome.storage.local.get('secret');
  if (!secret) return { ok: false, error: '请先在扩展中填写本机桥接密钥。' };
  const response = await fetch('http://127.0.0.1:43118/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Archive-Secret': secret },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  return response.ok ? { ok: true, recordId: result.recordId } : { ok: false, error: result.error || '写入失败' };
}
