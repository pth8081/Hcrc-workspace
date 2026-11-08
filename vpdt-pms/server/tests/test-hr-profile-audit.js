'use strict';

// tests/test-hr-profile-audit.js
//
// Regression cho lib/hrProfileAudit.js — "🔍 Audit Nhân Sự" (11/2026, theo yêu cầu người dùng: "rà soát
// hồ sơ chưa active/hợp đồng chưa active, hợp đồng hết hạn/sau hết hạn, hồ sơ thiếu thông tin"). 4 nhóm:
// H1 (hồ sơ DRAFT tồn đọng), H2 (thiếu/DRAFT hợp đồng), H3 (hợp đồng hết hạn/sắp hết hạn), H4 (hồ sơ
// thiếu thông tin). auditHrProfileGaps() async (tự đọc laborContracts qua lib/recordStore.getAllForCollection)
// — stub lib/recordStore để không cần DB thật, dùng THẬT lib/employeeProfile/lib/laborContract (hàm
// thuần, không đụng DB).
//
// Chạy: node server/tests/test-hr-profile-audit.js
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let CONTRACTS = [];
stubModule('lib/recordStore', {
  getAllForCollection: async (collection) => (collection === 'laborContracts' ? CONTRACTS : [])
});

const { auditHrProfileGaps, computeFindingsSignature } = require('../lib/hrProfileAudit');

let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

// nowVN()-format "HH:mm:ss d/M/yyyy" (xem lib/employeeProfile.js) — helper tạo mốc N ngày trước.
function nowVNMinusDays(days) {
  const d = new Date(Date.now() - days * 86400000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}
function isoDateOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function baseAppData(overrides) {
  return Object.assign({ employeeProfiles: [], users: [], hrProcesses: [] }, overrides || {});
}

(async () => {
  // ===== H1: hồ sơ DRAFT tồn đọng quá lâu =====
  await run('H1: DRAFT 40 ngày, ngưỡng 30 -> WARNING STALE_DRAFT_PROFILE', async () => {
    CONTRACTS = [];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0001', status: 'DRAFT', createdAt: nowVNMinusDays(40) }] });
    const findings = await auditHrProfileGaps(appData, { draftStaleDaysThreshold: 30 });
    const f = findings.find(f => f.type === 'STALE_DRAFT_PROFILE' && f.employeeCode === 'BL0001');
    assert.ok(f && f.severity === 'WARNING', 'phải có finding STALE_DRAFT_PROFILE/WARNING');
  });

  await run('H1: DRAFT 10 ngày, ngưỡng 30 -> KHÔNG báo', async () => {
    CONTRACTS = [];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0002', status: 'DRAFT', createdAt: nowVNMinusDays(10) }] });
    const findings = await auditHrProfileGaps(appData, { draftStaleDaysThreshold: 30 });
    assert.ok(!findings.some(f => f.type === 'STALE_DRAFT_PROFILE'), 'không được báo khi chưa đủ ngưỡng');
  });

  await run('H1: DRAFT 40 ngày nhưng onboardingQueueStatus=CANCELLED -> KHÔNG báo (đã hủy, cố ý giữ DRAFT)', async () => {
    CONTRACTS = [];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0003', status: 'DRAFT', createdAt: nowVNMinusDays(40), onboardingQueueStatus: 'CANCELLED' }] });
    const findings = await auditHrProfileGaps(appData, { draftStaleDaysThreshold: 30 });
    assert.ok(!findings.some(f => f.type === 'STALE_DRAFT_PROFILE'), 'hồ sơ đã Hủy không được báo tồn đọng');
  });

  await run('H1: hồ sơ ACTIVE (không phải DRAFT) -> KHÔNG báo dù createdAt rất cũ', async () => {
    CONTRACTS = [];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0004', status: 'ACTIVE', createdAt: nowVNMinusDays(400) }] });
    const findings = await auditHrProfileGaps(appData, { draftStaleDaysThreshold: 30 });
    assert.ok(!findings.some(f => f.type === 'STALE_DRAFT_PROFILE'), 'chỉ xét profile.status===DRAFT');
  });

  // ===== H2: hồ sơ ACTIVE thiếu/chưa kích hoạt hợp đồng tương ứng =====
  await run('H2: ACTIVE, không có hợp đồng nào -> CRITICAL NO_CONTRACT', async () => {
    CONTRACTS = [];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0010', status: 'ACTIVE' }] });
    const findings = await auditHrProfileGaps(appData, {});
    const f = findings.find(f => f.type === 'NO_CONTRACT' && f.employeeCode === 'BL0010');
    assert.ok(f && f.severity === 'CRITICAL');
  });

  await run('H2: ACTIVE, có hợp đồng ACTIVE -> KHÔNG báo', async () => {
    CONTRACTS = [{ id: 1, employeeCode: 'BL0011', code: 'HDLD-BL0011-1', status: 'ACTIVE', endDate: null }];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0011', status: 'ACTIVE' }] });
    const findings = await auditHrProfileGaps(appData, {});
    assert.ok(!findings.some(f => (f.type === 'NO_CONTRACT' || f.type === 'NO_ACTIVE_CONTRACT' || f.type === 'DRAFT_CONTRACT_NOT_ACTIVATED') && f.employeeCode === 'BL0011'));
  });

  await run('H2: ACTIVE, hợp đồng gần nhất còn DRAFT -> WARNING DRAFT_CONTRACT_NOT_ACTIVATED', async () => {
    CONTRACTS = [{ id: 1, employeeCode: 'BL0012', code: 'HDLD-BL0012-1', status: 'DRAFT', endDate: null }];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0012', status: 'ACTIVE' }] });
    const findings = await auditHrProfileGaps(appData, {});
    const f = findings.find(f => f.type === 'DRAFT_CONTRACT_NOT_ACTIVATED' && f.employeeCode === 'BL0012');
    assert.ok(f && f.severity === 'WARNING');
  });

  await run('H2: ACTIVE, hợp đồng gần nhất TERMINATED (không có ACTIVE kế tiếp) -> CRITICAL NO_ACTIVE_CONTRACT', async () => {
    CONTRACTS = [{ id: 1, employeeCode: 'BL0013', code: 'HDLD-BL0013-1', status: 'TERMINATED', endDate: null }];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0013', status: 'ACTIVE' }] });
    const findings = await auditHrProfileGaps(appData, {});
    const f = findings.find(f => f.type === 'NO_ACTIVE_CONTRACT' && f.employeeCode === 'BL0013');
    assert.ok(f && f.severity === 'CRITICAL');
  });

  await run('H2: hồ sơ DRAFT (không phải ACTIVE) -> KHÔNG xét H2 dù không có hợp đồng', async () => {
    CONTRACTS = [];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0014', status: 'DRAFT' }] });
    const findings = await auditHrProfileGaps(appData, {});
    assert.ok(!findings.some(f => f.type === 'NO_CONTRACT' && f.employeeCode === 'BL0014'));
  });

  // ===== H3: hợp đồng ACTIVE đã hết hạn (chưa xử lý) / sắp hết hạn =====
  await run('H3: hợp đồng ACTIVE endDate đã qua -> CRITICAL CONTRACT_EXPIRED_UNPROCESSED', async () => {
    CONTRACTS = [{ id: 1, employeeCode: 'BL0020', code: 'HDLD-BL0020-1', status: 'ACTIVE', endDate: isoDateOffset(-5) }];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0020', status: 'ACTIVE' }] });
    const findings = await auditHrProfileGaps(appData, {});
    const f = findings.find(f => f.type === 'CONTRACT_EXPIRED_UNPROCESSED' && f.employeeCode === 'BL0020');
    assert.ok(f && f.severity === 'CRITICAL');
  });

  await run('H3: hợp đồng ACTIVE còn 10 ngày, ngưỡng sắp hết hạn 30 -> WARNING CONTRACT_EXPIRING_SOON', async () => {
    CONTRACTS = [{ id: 1, employeeCode: 'BL0021', code: 'HDLD-BL0021-1', status: 'ACTIVE', endDate: isoDateOffset(10) }];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0021', status: 'ACTIVE' }] });
    const findings = await auditHrProfileGaps(appData, { contractExpirySoonDays: 30 });
    const f = findings.find(f => f.type === 'CONTRACT_EXPIRING_SOON' && f.employeeCode === 'BL0021');
    assert.ok(f && f.severity === 'WARNING');
  });

  await run('H3: hợp đồng ACTIVE endDate null (Vô thời hạn) -> KHÔNG báo', async () => {
    CONTRACTS = [{ id: 1, employeeCode: 'BL0022', code: 'HDLD-BL0022-1', status: 'ACTIVE', endDate: null }];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0022', status: 'ACTIVE' }] });
    const findings = await auditHrProfileGaps(appData, {});
    assert.ok(!findings.some(f => (f.type === 'CONTRACT_EXPIRED_UNPROCESSED' || f.type === 'CONTRACT_EXPIRING_SOON') && f.employeeCode === 'BL0022'));
  });

  await run('H3: hợp đồng DRAFT (chưa hiệu lực) endDate đã qua -> KHÔNG báo hết hạn', async () => {
    CONTRACTS = [{ id: 1, employeeCode: 'BL0023', code: 'HDLD-BL0023-1', status: 'DRAFT', endDate: isoDateOffset(-5) }];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0023', status: 'ACTIVE' }] });
    const findings = await auditHrProfileGaps(appData, {});
    assert.ok(!findings.some(f => f.type === 'CONTRACT_EXPIRED_UNPROCESSED'));
  });

  // ===== H4: hồ sơ ACTIVE thiếu thông tin quan trọng =====
  await run('H4: ACTIVE thiếu nationalId -> CRITICAL MISSING_NATIONAL_ID', async () => {
    CONTRACTS = [];
    const appData = baseAppData({ employeeProfiles: [{
      employeeCode: 'BL0030', status: 'ACTIVE', nationalId: null,
      contactPhone: '0900000000', permanentAddress: 'A', bankAccountNo: '123', taxCode: 'T1', socialInsuranceNo: 'S1'
    }] });
    const findings = await auditHrProfileGaps(appData, {});
    const f = findings.find(f => f.type === 'MISSING_NATIONAL_ID' && f.employeeCode === 'BL0030');
    assert.ok(f && f.severity === 'CRITICAL');
  });

  await run('H4: ACTIVE thiếu contactPhone+bankAccountNo -> WARNING MISSING_PROFILE_INFO nêu đúng tên field', async () => {
    CONTRACTS = [];
    const appData = baseAppData({ employeeProfiles: [{
      employeeCode: 'BL0031', status: 'ACTIVE', nationalId: '012345678901',
      contactPhone: '', permanentAddress: 'A', bankAccountNo: null, taxCode: 'T1', socialInsuranceNo: 'S1'
    }] });
    const findings = await auditHrProfileGaps(appData, {});
    const f = findings.find(f => f.type === 'MISSING_PROFILE_INFO' && f.employeeCode === 'BL0031');
    assert.ok(f && f.severity === 'WARNING');
    assert.ok(f.reason.includes('Điện thoại liên hệ') && f.reason.includes('Số tài khoản ngân hàng'), 'phải nêu đúng 2 field thiếu, không nêu thừa field khác');
    assert.ok(!f.reason.includes('Địa chỉ thường trú'), 'không nêu field ĐÃ có giá trị');
  });

  await run('H4: ACTIVE đủ thông tin (và có hợp đồng ACTIVE, tránh dính H2) -> KHÔNG báo', async () => {
    CONTRACTS = [{ id: 1, employeeCode: 'BL0032', code: 'HDLD-BL0032-1', status: 'ACTIVE', endDate: null }];
    const appData = baseAppData({ employeeProfiles: [{
      employeeCode: 'BL0032', status: 'ACTIVE', nationalId: '012345678901',
      contactPhone: '0900000000', permanentAddress: 'A', bankAccountNo: '123', taxCode: 'T1', socialInsuranceNo: 'S1'
    }] });
    const findings = await auditHrProfileGaps(appData, {});
    assert.ok(!findings.some(f => f.employeeCode === 'BL0032'));
  });

  await run('H4: hồ sơ DRAFT thiếu nationalId -> KHÔNG xét H4 (chỉ áp dụng cho ACTIVE)', async () => {
    CONTRACTS = [];
    const appData = baseAppData({ employeeProfiles: [{ employeeCode: 'BL0033', status: 'DRAFT', nationalId: null }] });
    const findings = await auditHrProfileGaps(appData, {});
    assert.ok(!findings.some(f => f.type === 'MISSING_NATIONAL_ID' && f.employeeCode === 'BL0033'));
  });

  // ===== computeFindingsSignature(): thứ tự độc lập, không gồm `reason` =====
  await run('computeFindingsSignature(): không đổi khi chỉ đổi thứ tự findings', async () => {
    const a = [{ type: 'X', employeeCode: 'E1', severity: 'WARNING', reason: 'r1' }, { type: 'Y', employeeCode: 'E2', severity: 'CRITICAL', reason: 'r2' }];
    const b = [a[1], a[0]];
    assert.strictEqual(computeFindingsSignature(a), computeFindingsSignature(b));
  });
  await run('computeFindingsSignature(): đổi reason không đổi chữ ký', async () => {
    const a = [{ type: 'X', employeeCode: 'E1', severity: 'WARNING', reason: 'r1' }];
    const b = [{ type: 'X', employeeCode: 'E1', severity: 'WARNING', reason: 'khác hẳn' }];
    assert.strictEqual(computeFindingsSignature(a), computeFindingsSignature(b));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
