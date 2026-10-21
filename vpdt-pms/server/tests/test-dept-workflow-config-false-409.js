// server/tests/test-dept-workflow-config-false-409.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo trực tiếp qua ảnh chụp màn hình: bấm "Lưu Cấu Hình [Phòng Mua hàng
// FMCG]" ở màn "QT Phê Duyệt Giá Bán Lẻ" (itPriceDeptWorkflows) ra lỗi "Dữ liệu 'itPriceDeptWorkflows'
// vừa bị người khác thay đổi — vui lòng tải lại trang rồi thử lại" — và nghi ngờ lỗi này xảy ra Ở NHIỀU
// MÀN, yêu cầu rà soát luôn cả "⚡ Áp Dụng Nhanh"):
//
// saveDeptWorkflowConfig()/saveAllDeptWorkflowConfigs()/resetDeptWorkflowConfig()/
// resetAllDeptWorkflowConfigs()/saveItPriceTierWorkflowConfig()/resetTierWorkflowConfig()
// (module-itsupport-tier.js) và applyQuickApplyConfig() (module-workflow.js, "⚡ Áp Dụng Nhanh") ĐỀU đã
// tự chụp sẵn `snapshot` trước khi sửa (để tự phục hồi nếu lưu hỏng) nhưng KHÔNG truyền baseline cho
// syncStorage() — khiến MỌI 409 ở các màn này luôn rơi thẳng vào nhánh "báo lỗi + bắt tải lại trang"
// thay vì nhánh thử lại thông minh (đọc bản mới nhất, nếu KHÔNG ai đụng đúng phòng ban/mức mình đang
// sửa thì tự áp lại rồi lưu lại 1 lần, không cần người dùng làm gì thêm) — vốn ĐÃ hoạt động đúng cho
// users/permGroups/workflows/*MixedApprovalRules từ các đợt vá 409 trước.
//
// NGUYÊN NHÂN GỐC khiến các hàm này trước giờ "né" truyền baseline: retryArraySaveAfterConflict() (hàm
// xử lý baseline DUY NHẤT từng có) giả định CỨNG dữ liệu là MẢNG object có `.id` (baseline.map(x=>x.id))
// — itPriceDeptWorkflows/carDeptWorkflows/.../*TierWorkflows lại là OBJECT MAP {phòng ban/mức: cấu
// hình}, truyền thẳng baseline dạng object vào đó sẽ THROW (object không có .map). Bản vá thêm
// retryObjectMapSaveAfterConflict() (core.js) — mirror đúng logic nhưng đối chiếu theo KHOÁ object thay
// vì `.id` — và syncStorageOnce() tự chọn đúng hàm theo Array.isArray(DB[key]).
//
// Test THẬT qua UI (Chromium thật + core.js thật, chỉ stub window.fetch) — mô phỏng ĐÚNG tình huống báo
// cáo: 2 admin cùng sửa itPriceDeptWorkflows GẦN NHƯ ĐỒNG THỜI nhưng KHÔNG đụng chung phòng ban nào (1
// người sửa "Phòng Mua hàng FMCG", người kia sửa "Phòng Kế Toán") — lẽ ra phải tự lưu được êm, KHÔNG nên
// hiện lỗi 409 nào cả.
'use strict';
const path = require('path');
const { setup, teardown, makeRunner, assert, assertEqual } = require('./_harness');

const PORT = 8993;

async function main() {
  const { server, browser, page } = await setup(PORT);
  const run = makeRunner();

  try {
    await run.run('itPriceDeptWorkflows (object map, KHÔNG phải mảng): 2 admin sửa 2 phòng ban KHÁC nhau gần như đồng thời -> KHÔNG được hiện lỗi 409 giả, tự lưu êm', async () => {
      const original = {
        'Phòng Mua hàng FMCG': { workflowId: 'WF_1STEP', approvers: { 1: ['nv.a'] } },
        'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['nv.b'] } }
      };
      await page.evaluate((orig) => {
        DB.itPriceDeptWorkflows = JSON.parse(JSON.stringify(orig));
        DB._versions = DB._versions || {};
        DB._versions.itPriceDeptWorkflows = 'v1';
        window.__alerted = [];
        window.__origAlert = window.alert;
        window.alert = (msg) => { window.__alerted.push(msg); };
      }, original);

      // Stub window.fetch: bọc thêm 1 lớp quanh bản GỐC (đã bị mock backend của harness ghi đè sẵn) —
      // chỉ chặn ĐÚNG request tới itPriceDeptWorkflows, mọi request khác đi qua nguyên vẹn.
      await page.evaluate(() => {
        const orig = window.fetch;
        let postCount = 0;
        window.fetch = async function (url, opts) {
          const u = typeof url === 'string' ? url : String((url && url.url) || url);
          const method = ((opts && opts.method) || 'GET').toUpperCase();
          if (u === '/api/data/itPriceDeptWorkflows' && method === 'POST') {
            postCount++;
            if (postCount === 1) {
              // Lượt lưu ĐẦU của "mình" -> server từ chối 409 vì "Phòng Kế Toán" vừa bị admin KHÁC sửa
              // xong NGAY TRƯỚC đó (updatedAt mới hơn version mình đang cầm) — KHÔNG đụng chung phòng ban
              // nào với thay đổi của mình ("Phòng Mua hàng FMCG").
              return { ok: false, status: 409, headers: { get: () => null }, json: async () => ({ error: 'Dữ liệu "itPriceDeptWorkflows" vừa bị người khác thay đổi — vui lòng tải lại trang rồi thử lại.' }) };
            }
            // Lượt lưu THỨ 2 (sau khi retryObjectMapSaveAfterConflict() tự đọc bản mới nhất + áp lại) ->
            // server chấp nhận. Lưu lại payload để assert đúng nội dung đã GỘP.
            window.__secondPostBody = JSON.parse(opts.body);
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? 'v3' : null }, json: async () => ({ ok: true, version: 'v3' }) };
          }
          if (u === '/api/data/itPriceDeptWorkflows' && method === 'GET') {
            // Bản MỚI NHẤT trên server tại thời điểm retry: "Phòng Mua hàng FMCG" (mình KHÔNG đụng ở lượt
            // đọc lại này — baseline của mình cho phòng này vẫn khớp) GIỮ NGUYÊN giá trị gốc; "Phòng Kế
            // Toán" đã bị admin KHÁC đổi approver; "Phòng Nhân Sự" là phòng MỚI admin khác vừa thêm.
            const fresh = {
              'Phòng Mua hàng FMCG': { workflowId: 'WF_1STEP', approvers: { 1: ['nv.a'] } },
              'Phòng Kế Toán': { workflowId: 'WF_2STEP', approvers: { 1: ['nv.c'], 2: ['nv.d'] } },
              'Phòng Nhân Sự': { workflowId: 'WF_1STEP', approvers: { 1: ['nv.e'] } }
            };
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? 'v2' : null }, json: async () => fresh };
          }
          return orig(url, opts);
        };
      });

      // Baseline = bản ĐÃ ĐỌC trước khi sửa (chính là `original`) — đúng khuôn snapshot mà
      // saveDeptWorkflowConfig() đã chụp sẵn (JSON.parse(JSON.stringify(DB[dbKey] || {}))).
      const baseline = JSON.parse(JSON.stringify(original));
      // Admin "mình" sửa ĐÚNG "Phòng Mua hàng FMCG" — đổi approver, KHÔNG đụng "Phòng Kế Toán".
      await page.evaluate(() => {
        DB.itPriceDeptWorkflows['Phòng Mua hàng FMCG'] = { workflowId: 'WF_1STEP', approvers: { 1: ['nv.a.moi'] } };
      });

      const saved = await page.evaluate((bl) => syncStorage('itPriceDeptWorkflows', { baseline: bl }), baseline);
      assert(saved === true, 'syncStorage() phải trả về true (lưu thành công sau khi tự retry) — không được coi là thất bại');

      const state = await page.evaluate(() => ({
        alerted: window.__alerted,
        secondPostBody: window.__secondPostBody,
        dbValue: DB.itPriceDeptWorkflows,
        version: DB._versions.itPriceDeptWorkflows
      }));
      assertEqual(state.alerted.length, 0, `KHÔNG được hiện bất kỳ alert() nào (lỗi 409 giả) — thực tế: ${JSON.stringify(state.alerted)}`);
      assertEqual(state.version, 'v3', 'DB._versions.itPriceDeptWorkflows phải cập nhật đúng version MỚI trả về sau lượt lưu thứ 2');

      // Payload gửi lên ở lượt lưu THỨ 2 phải là bản ĐÃ GỘP: giữ "Phòng Kế Toán"/"Phòng Nhân Sự" của
      // admin KHÁC (mình không đụng), và "Phòng Mua hàng FMCG" là giá trị MỚI của mình.
      assertEqual(JSON.stringify(state.secondPostBody['Phòng Mua hàng FMCG']), JSON.stringify({ workflowId: 'WF_1STEP', approvers: { 1: ['nv.a.moi'] } }), 'Payload lượt 2 phải có "Phòng Mua hàng FMCG" = giá trị MỚI của mình');
      assertEqual(JSON.stringify(state.secondPostBody['Phòng Kế Toán']), JSON.stringify({ workflowId: 'WF_2STEP', approvers: { 1: ['nv.c'], 2: ['nv.d'] } }), 'Payload lượt 2 phải GIỮ NGUYÊN "Phòng Kế Toán" của admin khác — không bị mình ghi đè mất');
      assertEqual(JSON.stringify(state.secondPostBody['Phòng Nhân Sự']), JSON.stringify({ workflowId: 'WF_1STEP', approvers: { 1: ['nv.e'] } }), 'Payload lượt 2 phải GIỮ NGUYÊN "Phòng Nhân Sự" admin khác vừa thêm — không bị mất');

      assertEqual(JSON.stringify(state.dbValue), JSON.stringify(state.secondPostBody), 'DB.itPriceDeptWorkflows trong bộ nhớ phải khớp đúng bản đã gộp vừa lưu thành công');
    });

    await run.run('itPriceDeptWorkflows: ĐÚNG phòng ban mình đang sửa bị admin khác đổi/xoá CÙNG LÚC -> conflict THẬT, vẫn phải báo lỗi rõ ràng (không được âm thầm ghi đè mất thay đổi của người khác)', async () => {
      const original = { 'Phòng Mua hàng FMCG': { workflowId: 'WF_1STEP', approvers: { 1: ['nv.a'] } } };
      await page.evaluate((orig) => {
        DB.itPriceDeptWorkflows = JSON.parse(JSON.stringify(orig));
        DB._versions.itPriceDeptWorkflows = 'v1';
        window.__alerted = [];
      }, original);

      await page.evaluate(() => {
        const orig = window.fetch;
        window.fetch = async function (url, opts) {
          const u = typeof url === 'string' ? url : String((url && url.url) || url);
          const method = ((opts && opts.method) || 'GET').toUpperCase();
          if (u === '/api/data/itPriceDeptWorkflows' && method === 'POST') {
            return { ok: false, status: 409, headers: { get: () => null }, json: async () => ({ error: 'Dữ liệu "itPriceDeptWorkflows" vừa bị người khác thay đổi — vui lòng tải lại trang rồi thử lại.' }) };
          }
          if (u === '/api/data/itPriceDeptWorkflows' && method === 'GET') {
            // ĐÚNG "Phòng Mua hàng FMCG" (phòng mình đang sửa) đã bị admin KHÁC đổi khác hẳn baseline.
            return { ok: true, status: 200, headers: { get: (h) => h === 'ETag' ? 'v2' : null }, json: async () => ({ 'Phòng Mua hàng FMCG': { workflowId: 'WF_2STEP', approvers: { 1: ['ai.do.khac'], 2: ['nv.x'] } } }) };
          }
          return orig(url, opts);
        };
      });

      const baseline = JSON.parse(JSON.stringify(original));
      await page.evaluate(() => {
        DB.itPriceDeptWorkflows['Phòng Mua hàng FMCG'] = { workflowId: 'WF_1STEP', approvers: { 1: ['nv.a.moi'] } };
      });
      const saved = await page.evaluate((bl) => syncStorage('itPriceDeptWorkflows', { baseline: bl }), baseline);
      assert(saved === false, 'syncStorage() phải trả về false (conflict THẬT — đúng phòng ban mình sửa bị người khác đụng)');
      const alerted = await page.evaluate(() => window.__alerted);
      assert(alerted.length === 1 && /vừa bị thay đổi|xoá/.test(alerted[0]), `Phải báo lỗi rõ ràng cho conflict THẬT, thực tế: ${JSON.stringify(alerted)}`);
    });

    run.summarize('test-dept-workflow-config-false-409');
  } finally {
    await teardown({ server, browser });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
