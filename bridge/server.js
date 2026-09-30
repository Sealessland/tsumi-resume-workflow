import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { createRecordPayload, findRecordId, validateArchiveConfig, verifyWritableFields } from './record.js';

const run = promisify(execFile);
const port = Number(process.env.PORT || 43118);
const secret = process.env.FEISHU_ARCHIVE_SECRET;
const configPath = path.resolve(process.env.ARCHIVE_CONFIG || 'archive.config.json');
let config;

try {
  config = validateArchiveConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
} catch (error) {
  console.error(`Unable to load archive config at ${configPath}: ${error.message}`);
  process.exit(1);
}
if (!secret) {
  console.error('Set FEISHU_ARCHIVE_SECRET before starting the bridge.');
  process.exit(1);
}

http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (!origin.startsWith('chrome-extension://')) return reply(res, 403, { error: 'Extension origin required' });
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Archive-Secret');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method !== 'POST' || req.url !== '/archive') return reply(res, 404, { error: 'Not found' });
  if (req.headers['x-archive-secret'] !== secret) return reply(res, 401, { error: 'Invalid bridge secret' });
  try {
    const input = await readJson(req);
    const fields = createRecordPayload(input);
    const fieldList = await lark(['base', '+field-list', '--as', 'user', '--base-token', config.baseToken, '--table-id', config.tableId, '--format', 'json']);
    verifyWritableFields(JSON.parse(fieldList.stdout), fields, config);
    const create = await lark(['base', '+record-upsert', '--as', 'user', '--base-token', config.baseToken, '--table-id', config.tableId, '--json', JSON.stringify(fields), '--format', 'json']);
    const created = JSON.parse(create.stdout);
    const recordId = findRecordId(created);
    if (!recordId) throw new Error('Feishu did not return a record_id');
    const verified = await lark(['base', '+record-get', '--as', 'user', '--base-token', config.baseToken, '--table-id', config.tableId, '--record-id', recordId, '--format', 'json']);
    reply(res, 201, { recordId, record: JSON.parse(verified.stdout) });
  } catch (error) {
    reply(res, 500, { error: error.message });
  }
}).listen(port, '127.0.0.1', () => console.log(`Feishu archive bridge listening on http://127.0.0.1:${port}`));

function lark(args) { return run('lark-cli', args, { maxBuffer: 1024 * 1024 }); }
function reply(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
function readJson(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', chunk => { text += chunk; if (text.length > 65536) { reject(new Error('Request body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(text)); } catch { reject(new Error('Invalid JSON body')); } });
    req.on('error', reject);
  });
}
