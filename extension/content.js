function text(selector) { return document.querySelector(selector)?.content?.trim() || document.querySelector(selector)?.textContent?.trim() || ''; }

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.type !== 'job-page') return;
  const ldJson = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map(node => { try { return JSON.parse(node.textContent); } catch { return null; } })
    .flatMap(value => Array.isArray(value) ? value : [value])
    .find(value => value?.['@type'] === 'JobPosting');
  respond({
    jobUrl: location.href,
    position: ldJson?.title || text('meta[property="og:title"]'),
    company: ldJson?.hiringOrganization?.name || '',
    pageTitle: document.title
  });
});

let archived = false;
const successText = /(?:投递|申请|简历).{0,12}(?:成功|已提交)|(?:successfully\s+(?:applied|submitted))/i;
const attemptAutoArchive = async () => {
  if (archived || !successText.test(document.body.innerText)) return;
  const { autoArchive } = await chrome.storage.local.get('autoArchive');
  if (!autoArchive) return;
  archived = true;
  const ldJson = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map(node => { try { return JSON.parse(node.textContent); } catch { return null; } })
    .flatMap(value => Array.isArray(value) ? value : [value])
    .find(value => value?.['@type'] === 'JobPosting');
  chrome.runtime.sendMessage({ type: 'archive', payload: {
    jobUrl: location.href,
    position: ldJson?.title || text('meta[property="og:title"]'),
    company: ldJson?.hiringOrganization?.name || '',
    note: '浏览器检测到投递成功提示后自动归档',
    appliedAt: localDateTime()
  }});
};
const observer = new MutationObserver(attemptAutoArchive);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
attemptAutoArchive();

function localDateTime() {
  const date = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
