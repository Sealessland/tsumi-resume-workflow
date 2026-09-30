import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordPayload, findRecordId, normalizeDateTime, validateArchiveConfig, verifyWritableFields } from '../bridge/record.js';

test('creates a Feishu payload containing only confirmed writable fields', () => {
  const payload = createRecordPayload({
    company: '飞书科技',
    position: '后端开发工程师',
    jobUrl: 'https://jobs.example.com/123',
    appliedAt: '2026-07-18T10:30:00+08:00',
    note: '官网投递'
  });

  assert.deepEqual(payload, {
    公司: '飞书科技',
    岗位: '后端开发工程师',
    岗位链接: 'https://jobs.example.com/123',
    投递日期: '2026-07-18 10:30:00',
    当前状态: '已投递',
    备注: '官网投递'
  });
  assert.equal(Object.hasOwn(payload, '归档状态'), false);
});

test('does not invent missing company or role values', () => {
  assert.deepEqual(createRecordPayload({ jobUrl: 'https://jobs.example.com/123' }), {
    岗位链接: 'https://jobs.example.com/123',
    当前状态: '已投递'
  });
});

test('normalizes an ISO datetime to the Base field format', () => {
  assert.equal(normalizeDateTime('2026-07-18T10:30:05+08:00'), '2026-07-18 10:30:05');
});

test('finds a record id in a nested CLI response', () => {
  assert.equal(findRecordId({ data: { record: { record_id: 'recVerified' } } }), 'recVerified');
});

const testConfig = {
  baseToken: 'app_test_token', tableId: 'tbl_test_table',
  fieldIds: { 公司: 'fld_company', 岗位: 'fld_position', 投递日期: 'fld_applied', 当前状态: 'fld_status', 下一步: 'fld_next', 下次跟进时间: 'fld_follow', 岗位链接: 'fld_url', 备注: 'fld_note' }
};

test('rejects incomplete archive configuration', () => {
  assert.throws(() => validateArchiveConfig({ baseToken: 'token', tableId: 'table', fieldIds: {} }), /fieldIds/);
});

test('requires configured writable field identifiers before writing', () => {
  const fields = { data: { items: [
    { field_name: '公司', field_id: 'fld_company', type: 1 },
    { field_name: '当前状态', field_id: 'fld_status', type: 3 },
    { field_name: '备注', field_id: 'fld_note', type: 20 }
  ] } };
  assert.doesNotThrow(() => verifyWritableFields(fields, { 公司: '飞书科技', 当前状态: '已投递' }, testConfig));
  assert.throws(() => verifyWritableFields(fields, { 公司: '飞书科技' }, { ...testConfig, fieldIds: { ...testConfig.fieldIds, 公司: 'fld_wrong' } }));
  assert.throws(() => verifyWritableFields(fields, { 备注: '不可写' }, testConfig), /备注/);
});
