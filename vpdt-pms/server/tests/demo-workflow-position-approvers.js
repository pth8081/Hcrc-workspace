// server/tests/demo-workflow-position-approvers.js
//
// DEMO thật (không nằm trong bộ hồi quy tự động test-*.js) cho Phần 2 của tính năng "Theo vị trí"
// (POSITION mode) ở bước duyệt quy trình — chụp ảnh màn hình thật + thực hiện phê duyệt THẬT qua
// _harness-contract.js (Chromium thật + lib/workflowEngine.js/lib/createValidation.js THẬT, không mock
// lại luật nghiệp vụ). Chứng minh:
//   (b) 1 bước duyệt (module "Mua Bán" — Tổng Hợp, phòng "Phòng Kinh Doanh") bật "Theo vị trí", chọn vị
//       trí, hiện đúng preview 3 trạng thái (chưa cấu hình / đã cấu hình nhưng chưa ai giữ / đã cấu hình
//       và tra ra người thật) — khớp UX đã dùng ở KPI Theo Vị Trí (v10.3).
//   (c) End-to-end THẬT: tạo 1 đề xuất Mua Bán cần duyệt ở bước POSITION mode đó — người giữ ĐÚNG vị
//       trí VÀ có quyền "Người duyệt" (canBeApprover) duyệt được; người giữ ĐÚNG vị trí nhưng KHÔNG có
//       canBeApprover bị SERVER từ chối (403) — đây là yêu cầu bảo mật cốt lõi.
//
// Chạy: node server/tests/demo-workflow-position-approvers.js
const fs = require('fs');
const path = require('path');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'workflow-position-approvers');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const h = await startHarness();
  const { page, state, loginAs, alerts, clearAlerts, confirmPending, stop } = h;

  try {
    await page.setViewportSize({ width: 1400, height: 1100 });

    // ===== Chuẩn bị: 2 tài khoản "Trưởng phòng — Phòng Kinh Doanh" — 1 có canBeApprover, 1 KHÔNG có =====
    // (tp_kd đã có sẵn trong tests/_seed.js với đúng dept/jobTitle này nhưng KHÔNG có canBeApprover —
    // cấp thêm quyền này CHỈ cho 1 bản demo trong bộ nhớ, không sửa file _seed.js dùng chung.)
    // pos_noperm: user MỚI, CÙNG (jobTitle,dept) với tp_kd nhưng CỐ Ý không cấp canBeApprover — dùng để
    // chứng minh khớp vị trí KHÔNG đủ, còn thiếu quyền "Người duyệt" thì vẫn bị từ chối.
    const posNoPerm = {
      id: 999, username: 'pos_noperm', pass: '123456', name: 'Đặng Văn Không Quyền Duyệt',
      email: 'posnoperm@company.com', phone: '0909999999', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng phòng',
      perms: { admin: false }
    };
    await page.evaluate((u) => { DB.users.push(u); }, posNoPerm);
    state.users.push(posNoPerm);
    // applyWorkflowAction() (lib/workflowEngine.js) đọc appData.users để resolve POSITION mode — mock
    // backend (_mockBackend.js) giữ state.appData TÁCH RIÊNG khỏi state.users (khác app thật, nơi
    // getAllAppData() luôn trả về "users" là 1 field AppData thường) — đồng bộ 1 LẦN ở đây cho ĐÚNG hành
    // vi app thật, KHÔNG sửa _mockBackend.js/_seed.js dùng chung cho các bộ test khác.
    state.appData.users = state.users;
    // Cấp canBeApprover cho tp_kd NGAY TRONG bộ nhớ state (không sửa _seed.js) — đây là người sẽ DUYỆT
    // được thật (đúng vị trí + đủ quyền).
    await page.evaluate(() => { const u = DB.users.find(x => x.username === 'tp_kd'); if (u) u.perms.canBeApprover = true; });
    const tpKdState = state.users.find(u => u.username === 'tp_kd');
    if (tpKdState) tpKdState.perms.canBeApprover = true;

    // ===== (b) Cấu hình "Theo vị trí" cho bước 1 của Mua Bán / Phòng Kinh Doanh, qua ĐÚNG màn Quản Trị =====
    await loginAs('admin');
    await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('WORKFLOW'); switchWfModule('OFFICE_BUY'); });
    await page.waitForSelector('[id="wfPosModeToggle_Phòng_Kinh_Doanh_1"]');

    // --- Trạng thái 1: BẬT "Theo vị trí" nhưng CHƯA chọn vị trí nào -> "chưa cấu hình" ---
    await page.locator('[id="wfPosModeToggle_Phòng_Kinh_Doanh_1"]').check();
    await page.waitForTimeout(80);
    const cardLocator = page.locator('[id="wfPosModeToggle_Phòng_Kinh_Doanh_1"]').locator('xpath=ancestor::div[contains(@class,"bg-gray-100")][1]');
    await cardLocator.screenshot({ path: path.join(OUT_DIR, '05-theo-vi-tri-trang-thai-1-chua-cau-hinh.png') });
    let previewText = await page.locator('[id="wfPositionPreview_Phòng_Kinh_Doanh_1"]').innerText();
    if (!previewText.includes('Chưa chọn vị trí')) throw new Error('LỖI DEMO: trạng thái 1 (chưa cấu hình) không hiện đúng thông báo! Thấy: ' + previewText);
    console.log('✅ 05: bật "Theo vị trí" nhưng chưa chọn vị trí nào -> preview hiện đúng trạng thái 1 "Chưa chọn vị trí nào".');

    // --- Trạng thái 2: chọn 1 vị trí ĐÃ cấu hình nhưng KHÔNG ai giữ ("Nhân viên — Phòng Kinh Doanh": kd1
    // là "Nhân viên" nhưng KHÔNG có canBeApprover -> vẫn coi là chưa có ai đủ điều kiện) ---
    const posInput = page.locator('#wfPositionPicker_Phòng_Kinh_Doanh_1 input[data-pms-search]');
    await posInput.click();
    // Query chỉ cần là 1 CHUỖI CON thật của nhãn "<chức danh> — <phòng ban>" (widget so khớp includes()
    // trên toàn bộ nhãn) — gõ tên phòng ban là đủ để hiện vài dòng (mỗi chức danh 1 dòng), rồi
    // .filter({hasText: <nhãn đầy đủ>}) ngay dưới chọn đúng 1 dòng.
    await posInput.fill('Phòng Kinh Doanh');
    await page.waitForTimeout(80);
    await page.locator('#wfPositionPicker_Phòng_Kinh_Doanh_1 [data-pms-dropdown] div[data-op="gmsAdd"]').filter({ hasText: 'Nhân viên — Phòng Kinh Doanh' }).first().click();
    await page.waitForTimeout(80);
    await cardLocator.screenshot({ path: path.join(OUT_DIR, '06-theo-vi-tri-trang-thai-2-cau-hinh-nhung-chua-ai-giu.png') });
    previewText = await page.locator('[id="wfPositionPreview_Phòng_Kinh_Doanh_1"]').innerText();
    if (!previewText.includes('CHƯA có ai')) throw new Error('LỖI DEMO: trạng thái 2 (đã cấu hình nhưng chưa ai giữ) không hiện đúng! Thấy: ' + previewText);
    console.log('✅ 06: chọn vị trí "Nhân viên — Phòng Kinh Doanh" (kd1 đúng vị trí nhưng KHÔNG có canBeApprover) -> preview hiện đúng trạng thái 2 "đã cấu hình nhưng CHƯA có ai giữ".');

    // Bỏ chip "Nhân viên — Phòng Kinh Doanh" vừa chọn, chuyển sang vị trí THẬT sẽ dùng cho e2e bên dưới.
    await page.locator('#wfPositionPicker_Phòng_Kinh_Doanh_1 [data-pms-chips] button[data-op="gmsRemove"]').first().click();
    await page.waitForTimeout(50);

    // --- Trạng thái 3: chọn "Trưởng phòng — Phòng Kinh Doanh" -> tra ra ĐÚNG tp_kd (đã cấp canBeApprover
    // ở trên) VÀ pos_noperm bị loại (không có canBeApprover) ---
    await posInput.click();
    await posInput.fill('Phòng Kinh Doanh');
    await page.waitForTimeout(80);
    await page.locator('#wfPositionPicker_Phòng_Kinh_Doanh_1 [data-pms-dropdown] div[data-op="gmsAdd"]').filter({ hasText: 'Trưởng phòng — Phòng Kinh Doanh' }).first().click();
    await page.waitForTimeout(80);
    await cardLocator.screenshot({ path: path.join(OUT_DIR, '07-theo-vi-tri-trang-thai-3-da-tra-ra-nguoi-that.png') });
    previewText = await page.locator('[id="wfPositionPreview_Phòng_Kinh_Doanh_1"]').innerText();
    if (!previewText.includes('Trần Thị Trưởng Phòng KD') || previewText.includes('Đặng Văn Không Quyền Duyệt')) {
      throw new Error('LỖI DEMO: trạng thái 3 phải tra ra ĐÚNG tp_kd (có canBeApprover) và KHÔNG được có pos_noperm (thiếu canBeApprover)! Thấy: ' + previewText);
    }
    console.log('✅ 07: chọn vị trí "Trưởng phòng — Phòng Kinh Doanh" -> preview trạng thái 3 tra ra ĐÚNG "Trần Thị Trưởng Phòng KD" (có canBeApprover), loại đúng người thiếu quyền dù cùng vị trí.');

    // Lưu cấu hình — bấm ĐÚNG nút "Lưu Cấu Hình" thật (saveDeptWorkflowConfig(), ghi DB.officeBuyDeptWorkflows
    // ở trình duyệt NGAY LẬP TỨC rồi mới "bắn và quên" gọi syncStorage()/POST /api/data/officeBuyDeptWorkflows
    // để đồng bộ lên server — xem core.js). _mockBackend.js (harness demo này) CHỈ triển khai
    // /api/create|workflow|records/* (đủ cho luồng tạo+duyệt hồ sơ thật bên dưới), KHÔNG có route
    // /api/data/:key chung nào (route đó vốn không cần thiết cho các bộ test Playwright hiện có của repo —
    // luôn seed thẳng cấu hình qua state.appData._seed.js) — nên POST đó nhận 404 rồi tự alert lỗi, một
    // hành vi ĐÚNG của client khi gọi 1 route server thật không tồn tại trong harness giả lập này, KHÔNG
    // phải lỗi của tính năng. Đồng bộ NGAY sau đó state.appData (phía "server" mock) khớp đúng
    // DB.officeBuyDeptWorkflows (phía client) VỪA GHI — mirror đúng việc 1 server thật sẽ làm nếu route
    // đó tồn tại, cùng kỹ thuật seedRecord() có sẵn của _harness-contract.js (ghi đồng thời cả 2 phía).
    await page.locator('[data-op="saveDeptWorkflowConfig"][data-arg0="Phòng Kinh Doanh"]').click();
    await page.waitForTimeout(150);
    const clientSavedCfg = await page.evaluate(() => DB.officeBuyDeptWorkflows['Phòng Kinh Doanh']);
    if (clientSavedCfg?.approverMode?.[1] !== 'POSITION' || !(clientSavedCfg.approversByPosition?.[1] || []).some(p => p.jobTitle === 'Trưởng phòng' && p.dept === 'Phòng Kinh Doanh')) {
      throw new Error('LỖI DEMO: lưu cấu hình POSITION mode KHÔNG có hiệu lực ở CLIENT (DB.officeBuyDeptWorkflows)! ' + JSON.stringify(clientSavedCfg));
    }
    state.appData.officeBuyDeptWorkflows['Phòng Kinh Doanh'] = clientSavedCfg;
    const savedCfg = state.appData.officeBuyDeptWorkflows['Phòng Kinh Doanh'];
    console.log(`✅ Đã lưu cấu hình — client xác nhận bước 1 [Phòng Kinh Doanh] ở chế độ POSITION: ${JSON.stringify(savedCfg.approverMode)}, vị trí: ${JSON.stringify(savedCfg.approversByPosition)}`);

    // ===== (c) End-to-end THẬT — tạo 2 đề xuất Mua Bán rồi thử duyệt bằng 2 người khác nhau =====
    async function createOfficeBuyReq(titleSuffix) {
      await loginAs('kd1');
      await page.evaluate(() => { switchTab('office'); setOfficeSubTab('MUA_BAN'); });
      const code = await page.locator('#offCode').inputValue();
      await page.fill('#offTitle', `Mua sắm thiết bị demo POSITION mode ${titleSuffix}`);
      await page.fill('#offReason', 'Kiểm thử end-to-end bước duyệt "Theo vị trí".');
      await page.evaluate(() => {
        officeItems.length = 0;
        officeItems.push({ name: 'Bàn làm việc', model: '', unit: 'Cái', qty: 2, unitPrice: 1000000, note: '' });
        renderOfficeItemsTable();
      });
      await clearAlerts();
      await page.evaluate(() => submitOfficeReq({ preventDefault() {}, target: document.getElementById('officeForm') }));
      await page.waitForTimeout(200);
      const item = await page.evaluate((c) => DB.officeReqs.find((x) => x.code === c), code);
      if (!item) throw new Error('LỖI DEMO: tạo đề xuất Mua Bán thất bại! ' + JSON.stringify(await alerts()));
      return item;
    }

    // --- (c-1) tp_kd (đúng vị trí + canBeApprover) DUYỆT ĐƯỢC ---
    const reqForApprover = await createOfficeBuyReq('(người có quyền duyệt)');
    await loginAs('tp_kd');
    await page.evaluate((id) => { switchTab('office'); setOfficeSubTab('MUA_BAN'); openOfficeProcessModal(id); }, reqForApprover.id);
    await page.waitForSelector('#officeProcessModal:not(.hidden)');
    await page.locator('#officeProcessModal').screenshot({ path: path.join(OUT_DIR, '08-modal-duyet-nguoi-co-quyen.png') });
    await clearAlerts();
    await page.evaluate(() => confirmProcessOfficeReq('APPROVE'));
    await confirmPending();
    const afterApproverTry = await page.evaluate((id) => DB.officeReqs.find((x) => x.id === id), reqForApprover.id);
    if (afterApproverTry.status !== 'APPROVED') {
      throw new Error('LỖI DEMO: tp_kd (đúng vị trí "Trưởng phòng — Phòng Kinh Doanh" + có canBeApprover) PHẢI duyệt được! Trạng thái hiện tại: ' + afterApproverTry.status + ' | alerts: ' + JSON.stringify(await alerts()));
    }
    console.log('✅ 08: tp_kd (khớp vị trí "Trưởng phòng — Phòng Kinh Doanh" VÀ có canBeApprover) DUYỆT ĐƯỢC — hồ sơ chuyển APPROVED.');

    // --- (c-2) pos_noperm (đúng vị trí NHƯNG KHÔNG canBeApprover) KHÔNG duyệt được — server (403) chặn ---
    const reqForNoPerm = await createOfficeBuyReq('(người KHÔNG có quyền duyệt)');
    await loginAs('pos_noperm');
    await page.evaluate((id) => { switchTab('office'); setOfficeSubTab('MUA_BAN'); openOfficeProcessModal(id); }, reqForNoPerm.id);
    await page.waitForSelector('#officeProcessModal:not(.hidden)');
    await clearAlerts();
    await page.evaluate(() => confirmProcessOfficeReq('APPROVE'));
    await confirmPending();
    const afterNoPermTry = await page.evaluate((id) => DB.officeReqs.find((x) => x.id === id), reqForNoPerm.id);
    const noPermAlerts = await alerts();
    await page.locator('#officeProcessModal').screenshot({ path: path.join(OUT_DIR, '09-tu-choi-nguoi-khong-co-quyen-duyet.png') });
    if (afterNoPermTry.status !== 'PENDING') {
      throw new Error('LỖI DEMO BẢO MẬT: pos_noperm (khớp vị trí nhưng KHÔNG có canBeApprover) KHÔNG ĐƯỢC PHÉP duyệt, nhưng hồ sơ đã chuyển trạng thái: ' + afterNoPermTry.status);
    }
    if (!noPermAlerts.some((a) => a.includes('không có quyền'))) {
      throw new Error('LỖI DEMO: phải thấy thông báo lỗi "không có quyền xử lý ở bước hiện tại" từ SERVER! Thấy: ' + JSON.stringify(noPermAlerts));
    }
    console.log(`✅ 09: pos_noperm (khớp ĐÚNG vị trí "Trưởng phòng — Phòng Kinh Doanh" nhưng KHÔNG có canBeApprover) bị SERVER từ chối (403) — hồ sơ VẪN PENDING. Thông báo: "${noPermAlerts[0]}"`);

    console.log('\n🎉 DEMO PHẦN 2 HOÀN TẤT — bước duyệt "Theo vị trí" hiện đúng 3 trạng thái preview, và ĐÚNG NHƯ YÊU CẦU BẢO MẬT: khớp vị trí KHÔNG thay thế được quyền "Người duyệt" (canBeApprover) — chỉ là điều kiện LỌC BỚT thêm.');
    console.log(`   Ảnh đã lưu tại: ${OUT_DIR}`);
  } finally {
    await stop();
  }
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
