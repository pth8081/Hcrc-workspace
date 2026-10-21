#!/usr/bin/env node
'use strict';

// ==========================================================================
// LỖI THẬT đã vá (11/2026, người dùng báo lại đúng cảnh báo "⚠️ Dữ liệu 'itPriceDeptWorkflows' vừa bị
// người khác thay đổi" ở màn "Cấu Hình Quy Trình Phê Duyệt Giá Bán Lẻ Theo Phòng Ban" — rà soát lại phát
// hiện đây là 1 LỚP LỖI 409 GIẢ KHÁC, chưa từng được vá ở các đợt "Rà soát toàn hệ thống lỗi 409 giả"
// trước đây vì các đợt đó chỉ xử lý thiếu `baseline` — ở đây `baseline` đã có sẵn, nhưng cơ chế đối chiếu
// xung đột (retryObjectMapSaveAfterConflict(), core.js) chỉ đối chiếu đúng 1 CẤP khoá):
//
// Các dbKey LỒNG 2 CẤP (WF_MODULE_CONFIG[...].hasTypes — VD submissionTypeDeptWorkflows =
// {loại: {phòng ban: config}}, itPriceDeptWorkflows = {phòng ban: {RETAIL/WHOLESALE: config}} với
// priceTypeNested) bị đối chiếu xung đột ở ĐÚNG cấp 1 — admin A sửa "Phòng Mua hàng FMCG" nhánh RETAIL
// trong khi admin B (hoặc "⚡ Áp Dụng Nhanh") sửa CÙNG "Phòng Mua hàng FMCG" nhưng nhánh WHOLESALE (2
// nhánh ĐỘC LẬP hoàn toàn) -> bị báo "genuineConflict" SAI vì so sánh nguyên khối cấp 1 thấy khác nhau,
// dù 2 đổi thay không hề đụng nhau. Tương tự cho submissionTypeDeptWorkflows: 2 phòng ban khác nhau CÙNG
// 1 loại tờ trình cũng bị báo nhầm.
//
// Bản vá: retryNestedObjectMapSaveAfterConflict() (core.js) đối chiếu/merge ĐÚNG ở cấp lồng thứ 2 (cặp
// [cấp1,cấp2]) khi nơi gọi truyền `syncStorage(key, {nestedMap: true})` — xem
// saveDeptWorkflowConfig()/saveAllDeptWorkflowConfigs()/resetDeptWorkflowConfig()/
// resetAllDeptWorkflowConfigs() (module-itsupport-tier.js) và applyQuickApplyConfig()
// (module-workflow.js), cả 2 nay đều truyền `nestedMap: !!WF_MODULE_CONFIG[...].hasTypes`.
//
// Run: node server/tests/test-syncstorage-nested-map-conflict-retry.js
// ==========================================================================

const { setup, teardown, makeRunner, assert, assertEqual } = require('./_harness');

const PORT = 8997;

async function main() {
  const { server, browser, page } = await setup(PORT);
  const run = makeRunner();

  try {
    await run.run('priceTypeNested (itPriceDeptWorkflows-kiểu): sửa nhánh RETAIL của 1 phòng ban trong khi server vừa đổi nhánh WHOLESALE CÙNG phòng ban đó -> KHÔNG được báo xung đột, phải tự gộp cả 2', async () => {
      const r = await page.evaluate(async () => {
        const key = 'itPriceNestedTest';
        let serverState = { 'Phòng Mua hàng FMCG': { RETAIL: { workflowId: 'WF_OLD' } } };
        let serverVersion = '100';
        const savedFetch = window.fetch;
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === `/api/data/${key}` && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => serverState };
          }
          if (url === `/api/data/${key}` && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && ifMatch !== serverVersion) {
              return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            }
            serverState = JSON.parse(opts.body);
            serverVersion = String(Number(serverVersion) + 1);
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };

        DB[key] = { 'Phòng Mua hàng FMCG': { RETAIL: { workflowId: 'WF_OLD' } } };
        DB._versions = DB._versions || {};
        DB._versions[key] = '100';

        // admin A: baseline chụp TRƯỚC khi sửa RETAIL.
        const baseline = JSON.parse(JSON.stringify(DB[key]));
        DB[key]['Phòng Mua hàng FMCG'].RETAIL = { workflowId: 'WF_NEW_RETAIL' };

        // Admin B (hoặc "⚡ Áp Dụng Nhanh") lưu TRƯỚC đó, qua nhánh WHOLESALE CÙNG phòng ban -> server đã
        // tiến version lên (409 thật sẽ xảy ra khi admin A gửi với If-Match cũ).
        serverState = { 'Phòng Mua hàng FMCG': { RETAIL: { workflowId: 'WF_OLD' }, WHOLESALE: { workflowId: 'WF_SET_BY_OTHER' } } };
        serverVersion = '101';

        const saved = await syncStorage(key, { baseline, nestedMap: true });
        const out = { saved, finalClient: DB[key], finalServer: serverState };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'LỖI NẾU FALSE: 2 thay đổi KHÁC nhánh lồng của CÙNG 1 phòng ban phải tự gộp được, không được báo xung đột giả: ' + JSON.stringify(r));
      assertEqual(r.finalServer['Phòng Mua hàng FMCG'].RETAIL.workflowId, 'WF_NEW_RETAIL', 'server phải có đúng RETAIL mới của admin A: ' + JSON.stringify(r));
      assertEqual(r.finalServer['Phòng Mua hàng FMCG'].WHOLESALE.workflowId, 'WF_SET_BY_OTHER', 'server phải GIỮ NGUYÊN WHOLESALE của admin B (không bị admin A ghi đè mất): ' + JSON.stringify(r));
      assertEqual(r.finalClient['Phòng Mua hàng FMCG'].RETAIL.workflowId, 'WF_NEW_RETAIL', 'DB client phải khớp đúng bản vừa gộp: ' + JSON.stringify(r));
      assertEqual(r.finalClient['Phòng Mua hàng FMCG'].WHOLESALE.workflowId, 'WF_SET_BY_OTHER', 'DB client phải thấy luôn WHOLESALE mới (không mất hiển thị): ' + JSON.stringify(r));
    });

    await run.run('hasTypes (submissionTypeDeptWorkflows-kiểu): sửa phòng ban X trong khi server vừa đổi phòng ban Y CÙNG 1 loại tờ trình -> KHÔNG được báo xung đột, phải tự gộp', async () => {
      const r = await page.evaluate(async () => {
        const key = 'submissionNestedTest';
        let serverState = { 'DE_XUAT': { 'Phòng A': { workflowId: 'WF_OLD' } } };
        let serverVersion = '200';
        const savedFetch = window.fetch;
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === `/api/data/${key}` && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => serverState };
          }
          if (url === `/api/data/${key}` && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && ifMatch !== serverVersion) {
              return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            }
            serverState = JSON.parse(opts.body);
            serverVersion = String(Number(serverVersion) + 1);
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };

        DB[key] = { 'DE_XUAT': { 'Phòng A': { workflowId: 'WF_OLD' } } };
        DB._versions = DB._versions || {};
        DB._versions[key] = '200';

        const baseline = JSON.parse(JSON.stringify(DB[key]));
        DB[key]['DE_XUAT']['Phòng A'] = { workflowId: 'WF_NEW_A' };

        // Admin khác vừa thêm "Phòng B" (CÙNG loại DE_XUAT) -> server tiến version.
        serverState = { 'DE_XUAT': { 'Phòng A': { workflowId: 'WF_OLD' }, 'Phòng B': { workflowId: 'WF_SET_BY_OTHER' } } };
        serverVersion = '201';

        const saved = await syncStorage(key, { baseline, nestedMap: true });
        const out = { saved, finalClient: DB[key], finalServer: serverState };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === true, 'LỖI NẾU FALSE: 2 phòng ban khác nhau CÙNG 1 loại tờ trình phải tự gộp được: ' + JSON.stringify(r));
      assertEqual(r.finalServer['DE_XUAT']['Phòng A'].workflowId, 'WF_NEW_A', 'server phải có đúng Phòng A mới: ' + JSON.stringify(r));
      assertEqual(r.finalServer['DE_XUAT']['Phòng B'].workflowId, 'WF_SET_BY_OTHER', 'server phải GIỮ Phòng B của admin khác: ' + JSON.stringify(r));
    });

    await run.run('nestedMap: xung đột THẬT (đúng cặp [phòng ban, nhánh] mình vừa sửa bị đổi ở nơi khác) vẫn phải báo lỗi, KHÔNG được âm thầm ghi đè', async () => {
      const r = await page.evaluate(async () => {
        const key = 'itPriceNestedConflictTest';
        let serverState = { 'Phòng Mua hàng FMCG': { RETAIL: { workflowId: 'WF_OLD' } } };
        let serverVersion = '300';
        const savedFetch = window.fetch;
        window.fetch = async (url, opts) => {
          const method = (opts && opts.method) || 'GET';
          if (url === `/api/data/${key}` && method === 'GET') {
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => serverState };
          }
          if (url === `/api/data/${key}` && method === 'POST') {
            const ifMatch = opts.headers['If-Match'];
            if (ifMatch && ifMatch !== serverVersion) {
              return { ok: false, status: 409, json: async () => ({ error: 'conflict' }) };
            }
            serverState = JSON.parse(opts.body);
            serverVersion = String(Number(serverVersion) + 1);
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? serverVersion : null }, json: async () => ({ ok: true, version: serverVersion }) };
          }
          return savedFetch(url, opts);
        };
        window.alert = () => {};

        DB[key] = { 'Phòng Mua hàng FMCG': { RETAIL: { workflowId: 'WF_OLD' } } };
        DB._versions = DB._versions || {};
        DB._versions[key] = '300';

        const baseline = JSON.parse(JSON.stringify(DB[key]));
        DB[key]['Phòng Mua hàng FMCG'].RETAIL = { workflowId: 'WF_MINE' };

        // Ai đó khác CŨNG đổi đúng RETAIL của CÙNG phòng ban này -> xung đột THẬT.
        serverState = { 'Phòng Mua hàng FMCG': { RETAIL: { workflowId: 'WF_SET_BY_OTHER_SAME_BRANCH' } } };
        serverVersion = '301';

        const saved = await syncStorage(key, { baseline, nestedMap: true });
        const out = { saved, finalServer: serverState };
        window.fetch = savedFetch;
        return out;
      });
      assert(r.saved === false, 'LỖI NẾU TRUE: đúng [phòng ban, nhánh] mình vừa sửa bị người khác đổi PHẢI báo lỗi, không được âm thầm ghi đè: ' + JSON.stringify(r));
      assertEqual(r.finalServer['Phòng Mua hàng FMCG'].RETAIL.workflowId, 'WF_SET_BY_OTHER_SAME_BRANCH', 'server phải GIỮ NGUYÊN bản của người khác (không bị ghi đè nhầm): ' + JSON.stringify(r));
    });

    run.summarize('test-syncstorage-nested-map-conflict-retry');
  } finally {
    await teardown({ server, browser });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
