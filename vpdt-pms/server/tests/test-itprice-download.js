// tests/test-itprice-download.js — Kiểm thử hồi quy THUẦN NODE (không Playwright) cho phần SERVER của
// đợt "2 loại giá + giới hạn tải file + đánh dấu cột + khoá khẩn cấp" (module itPriceApprovals):
//
//   1. lib/fileAuthz.js (mode 'download', nhánh owning.itPrice) — CHỈ file khớp resolveApprovedFileUrl()
//      mới tải được; hồ sơ chưa APPROVED thì không file nào tải được; hồ sơ cũ APPROVED trước khi có
//      approvedFileId vẫn fallback đúng (hoặc đúng đắn từ chối khi từng có yêu cầu bổ sung từ IT sau
//      duyệt — khi đó fallback không còn tin cậy). mode 'view' KHÔNG bị giới hạn thêm.
//   2. routes/priceFile.js POST /:id/download-marked — tô đúng cột được chọn (cả header lẫn dữ liệu),
//      GIỮ NGUYÊN mọi cột/dòng khác, KHÔNG ghi đè file gốc trên đĩa, tự kiểm lại quyền xem + xác định
//      đúng "file đã duyệt" (không tin riêng client).
//   3. lib/workflowEngine.js::resolveItPriceDeptWorkflowConfig() — cấu hình phẳng CŨ (itPriceDeptWorkflows
//      chưa có nhánh RETAIL/WHOLESALE) vẫn resolve đúng thành RETAIL, WHOLESALE coi như chưa cấu hình,
//      không throw.
//
// Test THUẦN NODE: lib/recordStore + lib/appData được thay bằng bản giả cắm vào require.cache TRƯỚC
// khi require lib/fileAuthz/routes/priceFile (cùng khuôn tests/test-uploads-file-authz.js/
// tests/test-audit-round2-cluster6.js) — code nghiệp vụ THẬT (lib/fileAuthz.js, lib/recordActions.js,
// lib/workflowEngine.js, routes/priceFile.js) chạy nguyên bản, không phải bản chép lại gần giống.
//
// Chạy: node server/tests/test-itprice-download.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const ExcelJS = require('exceljs');

let passed = 0, failed = 0;
async function run(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`);
  }
}

function stubModule(relPath, exportsObj) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true, children: [], paths: [], exports: exportsObj
  };
  return resolved;
}

// ===================== Người dùng =====================
const DEPT = 'Kinh Doanh';
const CREATOR = { username: 'staff_kd', name: 'Người Đề Xuất', dept: DEPT, perms: { itPriceProposeCreate: true } };
const IT_MANAGER = { username: 'it_mgr', name: 'Đội Hỗ Trợ IT', dept: 'IT', perms: { itManage: true } };
const APPROVER = { username: 'approver1', name: 'Người Duyệt', dept: 'Ban Giám Đốc', perms: {} };
const OUTSIDER = { username: 'outsider', name: 'Người Ngoài', dept: 'Marketing', perms: {} };

// itPriceDeptWorkflows CŨ, PHẲNG (chưa có nhánh RETAIL/WHOLESALE) — bằng chứng tương thích ngược mục 6.
const APP_DATA = {
  itPriceDeptWorkflows: { [DEPT]: { workflowId: 'wf1', approvers: { 1: [APPROVER.username] } } }
};

// ===================== Cắm bản giả cho recordStore + appData =====================
let ITEMS = [];
stubModule('../lib/recordStore', {
  getAllForCollection: async (name) => (name === 'itPriceApprovals' ? ITEMS : []),
  getAllTrashItemsCached: async () => []
});
stubModule('../lib/appData', {
  getAllAppData: async () => APP_DATA,
  getAppDataValue: async () => ({})
});

const { authorizeFileAccess } = require('../lib/fileAuthz');
const { resolveApprovedFileId, resolveApprovedFileUrl } = require('../lib/recordActions');
const { resolveItPriceDeptWorkflowConfig, MODULE_CONFIGS, applyWorkflowAction } = require('../lib/workflowEngine');

function baseItem(overrides) {
  return Object.assign({
    id: 1, code: 'ITP-1', dept: DEPT, creator: CREATOR.username, creatorName: CREATOR.name,
    status: 'PENDING', currentStep: 1, history: [], infoRequests: [],
    applied: false, applyClaimedBy: null,
    files: [{ id: 100, fileUrl: '/uploads/file-goc.xlsx', fileName: 'file-goc.xlsx', columnLabels: [{ key: 'c0', label: 'Mã hàng' }], items: [] }]
  }, overrides);
}

async function withServer(app, fn) {
  const server = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(res => server.close(res));
  }
}

async function main() {
  // ###############################################################################################
  // # 1. lib/fileAuthz.js mode 'download' — chỉ file đã phê duyệt mới tải được
  // ###############################################################################################

  await run('[1] Hồ sơ CHƯA APPROVED (PENDING): không file nào tải được, kể cả người đề xuất/IT/người duyệt', async () => {
    ITEMS = [baseItem({ status: 'PENDING' })];
    for (const user of [CREATOR, IT_MANAGER, APPROVER]) {
      assert.strictEqual(await authorizeFileAccess(user, '/uploads/file-goc.xlsx', 'download'), false, `${user.username} không được tải file khi hồ sơ chưa duyệt`);
    }
  });

  await run('[1] Hồ sơ CHƯA APPROVED vẫn XEM được (mode view không bị giới hạn thêm)', async () => {
    ITEMS = [baseItem({ status: 'PENDING' })];
    assert.strictEqual(await authorizeFileAccess(CREATOR, '/uploads/file-goc.xlsx', 'view'), true, 'mode view chỉ theo canViewItPriceApproval, không giới hạn theo file đã duyệt');
  });

  await run('[1] Hồ sơ APPROVED có approvedFileId: CHỈ đúng file đó tải được, file khác (bản gốc/bổ sung) bị chặn — cho cả IT lẫn người duyệt', async () => {
    ITEMS = [baseItem({
      status: 'APPROVED', approvedFileId: 200,
      files: [
        { id: 100, fileUrl: '/uploads/file-goc.xlsx', fileName: 'file-goc.xlsx', columnLabels: [] },
        { id: 200, fileUrl: '/uploads/file-duyet.xlsx', fileName: 'file-duyet.xlsx', columnLabels: [] }
      ]
    })];
    for (const user of [IT_MANAGER, APPROVER]) {
      assert.strictEqual(await authorizeFileAccess(user, '/uploads/file-duyet.xlsx', 'download'), true, `${user.username} phải tải được ĐÚNG file đã duyệt`);
      assert.strictEqual(await authorizeFileAccess(user, '/uploads/file-goc.xlsx', 'download'), false, `${user.username} KHÔNG được tải file khác (chưa/không phải file đã duyệt)`);
    }
  });

  await run('[1] Người ngoài phạm vi (không phải creator/IT/approver) bị chặn hoàn toàn, kể cả file đã duyệt', async () => {
    ITEMS = [baseItem({ status: 'APPROVED', approvedFileId: 200, files: [{ id: 200, fileUrl: '/uploads/file-duyet.xlsx', fileName: 'x', columnLabels: [] }] })];
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, '/uploads/file-duyet.xlsx', 'download'), false, 'canViewItPriceApproval() phải chặn trước khi tới bước kiểm file đã duyệt');
  });

  await run('[1] Hồ sơ cũ APPROVED, KHÔNG có approvedFileId, CHƯA từng có yêu cầu bổ sung từ IT -> fallback file cuối cùng tải được', async () => {
    ITEMS = [baseItem({
      status: 'APPROVED', approvedFileId: undefined, infoRequests: [],
      files: [
        { id: 100, fileUrl: '/uploads/file-goc.xlsx', fileName: 'a', columnLabels: [] },
        { id: 101, fileUrl: '/uploads/file-cuoi.xlsx', fileName: 'b', columnLabels: [] }
      ]
    })];
    assert.strictEqual(resolveApprovedFileId(ITEMS[0]), 101, 'phải fallback đúng file CUỐI CÙNG');
    assert.strictEqual(await authorizeFileAccess(IT_MANAGER, '/uploads/file-cuoi.xlsx', 'download'), true);
    assert.strictEqual(await authorizeFileAccess(IT_MANAGER, '/uploads/file-goc.xlsx', 'download'), false);
  });

  await run('[1] Hồ sơ cũ APPROVED, KHÔNG có approvedFileId, ĐÃ từng có yêu cầu bổ sung từ IT -> fallback KHÔNG áng tin cậy, chặn tất cả', async () => {
    ITEMS = [baseItem({
      status: 'APPROVED', approvedFileId: undefined,
      infoRequests: [{ id: 1, byRole: 'it', reason: 'x', response: 'đã bổ sung' }],
      files: [{ id: 100, fileUrl: '/uploads/file-goc.xlsx', fileName: 'a', columnLabels: [] }]
    })];
    assert.strictEqual(resolveApprovedFileId(ITEMS[0]), null, 'không còn cơ sở tin cậy để suy luận file đã duyệt');
    assert.strictEqual(await authorizeFileAccess(IT_MANAGER, '/uploads/file-goc.xlsx', 'download'), false);
  });

  await run('[1] resolveApprovedFileUrl() trả null cho hồ sơ REJECTED/DRAFT dù có files', async () => {
    ITEMS = [baseItem({ status: 'REJECTED' })];
    assert.strictEqual(resolveApprovedFileUrl(ITEMS[0]), null);
  });

  // ###############################################################################################
  // # 2. lib/workflowEngine.js::resolveItPriceDeptWorkflowConfig() — tương thích ngược cấu hình PHẲNG
  // ###############################################################################################

  await run('[2] Cấu hình phẳng CŨ (chưa có RETAIL/WHOLESALE) -> resolve đúng thành RETAIL', async () => {
    const flatCfg = { workflowId: 'wf1', approvers: { 1: ['approver1'] } };
    const map = { [DEPT]: flatCfg };
    assert.deepStrictEqual(resolveItPriceDeptWorkflowConfig(map, DEPT, 'RETAIL'), flatCfg);
  });

  await run('[2] Cấu hình phẳng CŨ -> WHOLESALE coi như CHƯA cấu hình (null, không throw)', async () => {
    const map = { [DEPT]: { workflowId: 'wf1', approvers: { 1: ['approver1'] } } };
    assert.strictEqual(resolveItPriceDeptWorkflowConfig(map, DEPT, 'WHOLESALE'), null);
  });

  await run('[2] Phòng ban chưa cấu hình gì -> null cho cả 2 loại giá, không throw', async () => {
    assert.strictEqual(resolveItPriceDeptWorkflowConfig({}, 'Không Tồn Tại', 'RETAIL'), null);
    assert.strictEqual(resolveItPriceDeptWorkflowConfig({}, 'Không Tồn Tại', 'WHOLESALE'), null);
  });

  await run('[2] Cấu hình MỚI (đã lồng RETAIL/WHOLESALE) -> đọc đúng nhánh, priceType thiếu mặc định RETAIL', async () => {
    const retailCfg = { workflowId: 'wf-r', approvers: { 1: ['a'] } };
    const wholesaleCfg = { workflowId: 'wf-w', approvers: { 1: ['b'] } };
    const map = { [DEPT]: { RETAIL: retailCfg, WHOLESALE: wholesaleCfg } };
    assert.deepStrictEqual(resolveItPriceDeptWorkflowConfig(map, DEPT, 'RETAIL'), retailCfg);
    assert.deepStrictEqual(resolveItPriceDeptWorkflowConfig(map, DEPT, 'WHOLESALE'), wholesaleCfg);
    assert.deepStrictEqual(resolveItPriceDeptWorkflowConfig(map, DEPT), retailCfg, 'priceType thiếu/undefined phải mặc định RETAIL, không throw');
  });

  await run('[2] applyWorkflowAction() qua MODULE_CONFIGS.itPriceApprovals thật: hồ sơ thiếu priceType vẫn duyệt được theo cấu hình phẳng cũ (RETAIL)', async () => {
    const item = { id: 5, dept: DEPT, status: 'PENDING', currentStep: 1, history: [] }; // KHÔNG có priceType
    const outcome = applyWorkflowAction({
      moduleKey: 'itPriceApprovals', item, action: 'APPROVE', user: APPROVER, comment: '',
      appData: APP_DATA, existingCollection: null, users: []
    });
    assert.strictEqual(outcome.item.status, 'APPROVED', 'phải duyệt được — resolveWfConfig() phải tự fallback RETAIL cho hồ sơ thiếu priceType, khớp cấu hình phẳng cũ');
  });

  // ###############################################################################################
  // # 3. routes/priceFile.js POST /:id/download-marked — route thật, file thật trên đĩa
  // ###############################################################################################

  let CURRENT_USER = null;
  stubModule('../lib/auth', {
    requireAuth: (req, _res, next) => { req.freshUser = CURRENT_USER; next(); },
    blockIfMustChangePassword: (_req, _res, next) => next()
  });
  const priceFileRouter = require('../routes/priceFile');
  const app = express();
  app.use(express.json());
  app.use('/api/it-price', priceFileRouter);

  const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  async function buildPriceXlsx() {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Sheet1');
    sheet.addRow(['Mã hàng', 'Tên mặt hàng', 'Giá mới']);
    sheet.addRow(['SP001', 'Mì gói Hảo Hảo', '5500']);
    sheet.addRow(['SP002', 'Bánh Chocopie', '11000']);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const COLUMN_LABELS = [{ key: 'code', label: 'Mã hàng' }, { key: 'name', label: 'Tên mặt hàng' }, { key: 'price', label: 'Giá mới' }];
  const MARK_FILL_ARGB = 'FFBFDFF5';

  await run('[3] download-marked: tô đúng cột được chọn, GIỮ NGUYÊN mọi cột/dòng khác, KHÔNG ghi đè file gốc trên đĩa', async () => {
    const fileName = `test-itprice-mark-${crypto.randomBytes(6).toString('hex')}.xlsx`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    const originalBuffer = await buildPriceXlsx();
    fs.writeFileSync(filePath, originalBuffer);
    const originalHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

    ITEMS = [baseItem({
      id: 7, status: 'APPROVED', approvedFileId: 700,
      files: [{ id: 700, fileUrl: `/uploads/${fileName}`, fileName, columnLabels: COLUMN_LABELS, items: [] }]
    })];

    CURRENT_USER = IT_MANAGER;
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/it-price/7/download-marked`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnKeys: ['name'] }) // chỉ đánh dấu cột "Tên mặt hàng"
      });
      assert.strictEqual(res.status, 200, 'phải trả về 200 kèm file đã đánh dấu');
      const buf = Buffer.from(await res.arrayBuffer());

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const sheet = wb.worksheets[0];
      assert.strictEqual(sheet.rowCount, 3, 'KHÔNG được mất dòng nào (1 header + 2 dữ liệu)');
      assert.strictEqual(sheet.getRow(1).cellCount >= 3, true, 'KHÔNG được mất cột nào');

      // Cột 2 ("Tên mặt hàng") phải được tô — cả header lẫn 2 dòng dữ liệu.
      for (const r of [1, 2, 3]) {
        const cell = sheet.getCell(r, 2);
        assert.strictEqual(cell.fill?.fgColor?.argb, MARK_FILL_ARGB, `Cột đã đánh dấu (dòng ${r}) phải có màu tô đúng`);
      }
      // Cột 1 và 3 KHÔNG được tô.
      for (const c of [1, 3]) {
        for (const r of [1, 2, 3]) {
          const cell = sheet.getCell(r, c);
          assert.notStrictEqual(cell.fill?.fgColor?.argb, MARK_FILL_ARGB, `Cột KHÔNG được chọn (cột ${c}, dòng ${r}) không được tô`);
        }
      }
      // Dữ liệu GIỮ NGUYÊN — không mất/đổi nội dung ô nào.
      assert.strictEqual(String(sheet.getCell(2, 1).value), 'SP001');
      assert.strictEqual(String(sheet.getCell(3, 2).value), 'Bánh Chocopie');
      assert.strictEqual(String(sheet.getCell(3, 3).value), '11000');
    });

    // File GỐC trên đĩa phải giữ NGUYÊN — route chỉ đọc, không bao giờ ghi đè filePath.
    const afterHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    assert.strictEqual(afterHash, originalHash, 'File gốc trên đĩa KHÔNG được thay đổi sau khi tải bản đánh dấu');

    fs.unlinkSync(filePath);
  });

  await run('[3] download-marked: cả IT lẫn người duyệt phòng ban đều gọi được (cùng phạm vi mục 2/3 kế hoạch)', async () => {
    const fileName = `test-itprice-mark2-${crypto.randomBytes(6).toString('hex')}.xlsx`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    fs.writeFileSync(filePath, await buildPriceXlsx());
    ITEMS = [baseItem({
      id: 8, status: 'APPROVED', approvedFileId: 800,
      files: [{ id: 800, fileUrl: `/uploads/${fileName}`, fileName, columnLabels: COLUMN_LABELS, items: [] }]
    })];

    CURRENT_USER = APPROVER; // người duyệt phòng ban (isApproverForApproversMap qua itPriceDeptWorkflows)
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/it-price/8/download-marked`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnKeys: ['code'] })
      });
      assert.strictEqual(res.status, 200, 'người duyệt phòng ban phải tải được file đã đánh dấu của hồ sơ mình duyệt');
    });
    fs.unlinkSync(filePath);
  });

  await run('[3] download-marked: người ngoài phạm vi bị chặn 403, không có file nào được sinh ra', async () => {
    const fileName = `test-itprice-mark3-${crypto.randomBytes(6).toString('hex')}.xlsx`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    fs.writeFileSync(filePath, await buildPriceXlsx());
    ITEMS = [baseItem({
      id: 9, status: 'APPROVED', approvedFileId: 900,
      files: [{ id: 900, fileUrl: `/uploads/${fileName}`, fileName, columnLabels: COLUMN_LABELS, items: [] }]
    })];

    CURRENT_USER = OUTSIDER;
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/it-price/9/download-marked`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnKeys: ['code'] })
      });
      assert.strictEqual(res.status, 403, 'người ngoài phạm vi (không phải creator/IT/approver) phải bị chặn');
    });
    fs.unlinkSync(filePath);
  });

  await run('[3] download-marked: hồ sơ CHƯA APPROVED -> 403 (chưa có file nào được coi là "đã duyệt")', async () => {
    ITEMS = [baseItem({ id: 10, status: 'PENDING' })];
    CURRENT_USER = IT_MANAGER;
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/it-price/10/download-marked`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnKeys: ['code'] })
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.ok(/chưa có tệp đã được phê duyệt/i.test(body.error || ''));
    });
  });

  await run('[3] download-marked: thiếu columnKeys hợp lệ -> 400, không sinh file', async () => {
    const fileName = `test-itprice-mark4-${crypto.randomBytes(6).toString('hex')}.xlsx`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    fs.writeFileSync(filePath, await buildPriceXlsx());
    ITEMS = [baseItem({
      id: 11, status: 'APPROVED', approvedFileId: 1100,
      files: [{ id: 1100, fileUrl: `/uploads/${fileName}`, fileName, columnLabels: COLUMN_LABELS, items: [] }]
    })];
    CURRENT_USER = IT_MANAGER;
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/it-price/11/download-marked`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ columnKeys: ['khong-ton-tai'] })
      });
      assert.strictEqual(res.status, 400);
    });
    fs.unlinkSync(filePath);
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-itprice-download.js:', err);
  process.exitCode = 1;
});
