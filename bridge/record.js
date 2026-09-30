export function normalizeDateTime(value) {
  if (!value) return undefined;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : undefined;
}

export function createRecordPayload(input = {}) {
  const fields = {
    公司: clean(input.company),
    岗位: clean(input.position),
    投递日期: normalizeDateTime(input.appliedAt),
    当前状态: '已投递',
    下一步: clean(input.nextStep),
    下次跟进时间: normalizeDateTime(input.followUpAt),
    岗位链接: clean(input.jobUrl),
    备注: clean(input.note)
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

export function findRecordId(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.record_id === 'string') return value.record_id;
  for (const child of Object.values(value)) {
    const recordId = findRecordId(child);
    if (recordId) return recordId;
  }
  return undefined;
}

export function validateArchiveConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Archive config must be an object');
  if (typeof config.baseToken !== 'string' || !config.baseToken.trim()) throw new Error('Archive config requires baseToken');
  if (typeof config.tableId !== 'string' || !config.tableId.trim()) throw new Error('Archive config requires tableId');
  const fieldIds = config.fieldIds;
  const names = ['公司', '岗位', '投递日期', '当前状态', '下一步', '下次跟进时间', '岗位链接', '备注'];
  if (!fieldIds || typeof fieldIds !== 'object') throw new Error('Archive config requires fieldIds');
  for (const name of names) {
    if (typeof fieldIds[name] !== 'string' || !fieldIds[name].trim()) {
      throw new Error(`Archive config requires fieldIds.${name}`);
    }
  }
  return { baseToken: config.baseToken.trim(), tableId: config.tableId.trim(), fieldIds: Object.fromEntries(names.map(name => [name, fieldIds[name].trim()])) };
}

export function verifyWritableFields(fieldResponse, payload, config) {
  const fields = collectFields(fieldResponse);
  const fieldIds = config?.fieldIds;
  if (!fieldIds) throw new Error('Archive field configuration is missing');
  for (const name of Object.keys(payload)) {
    const field = fields.find(item => item.field_name === name);
    if (!field || field.field_id !== fieldIds[name] || field.type === 20 || field.is_computed || field.property?.is_computed) {
      throw new Error(`Feishu field verification failed for: ${name}`);
    }
  }
}

function collectFields(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (typeof value.field_name === 'string' && typeof value.field_id === 'string') output.push(value);
  for (const child of Object.values(value)) collectFields(child, output);
  return output;
}

function clean(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
