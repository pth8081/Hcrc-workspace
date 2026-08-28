// server/tests/test-it-service-renewal.js
//
// Regression test cho module con "Gia Hạn Dịch Vụ CNTT" (Hỗ Trợ IT, sub-tab RENEWAL):
//   - Quyền HOÀN TOÀN phẳng (itManage/admin) — KHÔNG qua duyệt (khác Giấy Phép), tạo xong hiệu lực ngay.
//   - CHỈ itManage/admin thấy được sub-tab này (khác Phê Duyệt Giá/Hỗ Trợ Yêu Cầu mở cho toàn bộ nhân
//     viên) — xem canManageItSupportClient() ở public/index.html.
//   - Action "Sửa" (editItServiceRenewal) cho phép sửa mọi field kể cả lùi ngày hết hạn (fix nhập sai).
//   - Action "Gia Hạn" (renewItServiceRenewal) BẮT BUỘC ngày hết hạn mới lớn hơn ngày hiện tại, reset
//     notifiedThresholds, ghi lịch sử RENEWED riêng.
//   - computeItRenewalLifecycleState() phân loại đúng Còn hiệu lực/Sắp hết hạn/Hết hạn.
//   - Xóa chỉ admin mới thực hiện được.
//
// Chạy: node server/tests/test-it-service-renewal.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8984;

// ===================== Seed dữ liệu =====================
const IT_STAFF = { username: 'it1', name: 'Nguyễn Văn IT', dept: 'Hỗ Trợ IT', perms: { itManage: true }, active: true };
const IT_STAFF2 = { username: 'it2', name: 'Trần Thị IT', dept: 'Hỗ Trợ IT', perms: { itManage: true }, active: true };
const EMP_NOPERM = { username: 'emp_noperm', name: 'Người Không Quyền', dept: 'Kinh Doanh', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Hỗ Trợ IT', perms: { admin: true }, active: true };

const state = createMockState({
  depts: ['Hỗ Trợ IT', 'Kinh Doanh'],
  users: [IT_STAFF, IT_STAFF2, EMP_NOPERM, ADMIN]
});

function todayPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loginAs(page, user) {
  await page.evaluate(async (u) => {
    window.__resetCapture();
    await proceedAfterAuth(u);
  }, user);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    // ===== 1) Sub-tab "Gia Hạn Dịch Vụ" chỉ hiện cho itManage/admin =====
    await run.run('Sub-tab "Gia Hạn Dịch Vụ" ẨN với người không có itManage/admin', async () => {
      await loginAs(page, EMP_NOPERM);
      const hidden = await page.evaluate(() => document.getElementById('btnItSubRenewal').classList.contains('hidden'));
      assert(hidden, 'btnItSubRenewal phải ẩn với người không có itManage/admin');
    });
    await run.run('Sub-tab "Gia Hạn Dịch Vụ" HIỆN với itManage', async () => {
      await loginAs(page, IT_STAFF);
      const hidden = await page.evaluate(() => document.getElementById('btnItSubRenewal').classList.contains('hidden'));
      assert(!hidden, 'btnItSubRenewal phải hiện với người có itManage');
    });

    // ===== 2) Happy path: itManage thêm dịch vụ mới, hiệu lực ngay (không qua duyệt) =====
    let firstItemId;
    await run.run('itManage thêm dịch vụ CNTT mới (happy path, không qua duyệt)', async () => {
      const result = await page.evaluate(async (expiry) => {
        switchTab('itSupport');
        setItSupportSubTab('RENEWAL');
        document.getElementById('itRenewalName').value = 'Microsoft 365 Business';
        document.getElementById('itRenewalCategory').value = 'Phần mềm/Bản quyền';
        document.getElementById('itRenewalVendor').value = 'Microsoft Việt Nam';
        document.getElementById('itRenewalResponsible').value = 'Nguyễn Văn IT';
        document.getElementById('itRenewalCost').value = '12000000';
        document.getElementById('itRenewalExpiryDate').value = expiry;
        const before = DB.itServiceRenewals.length;
        await submitItServiceRenewal({ preventDefault() {}, target: document.getElementById('itRenewalCreateForm') });
        return {
          alerts: window.__alerts,
          countIncreased: DB.itServiceRenewals.length === before + 1,
          created: DB.itServiceRenewals[0]
        };
      }, todayPlusDays(365));
      assertIncludes(result.alerts, 'Đã thêm dịch vụ vào danh mục theo dõi gia hạn', 'Phải báo thành công');
      assert(result.countIncreased, 'DB.itServiceRenewals phải tăng thêm 1 bản ghi');
      assert(result.created, 'Phải tạo được bản ghi');
      assertEqual(result.created.name, 'Microsoft 365 Business', 'Tên dịch vụ phải đúng');
      assertEqual(result.created.cost, 12000000, 'Chi phí phải parse đúng từ ô money-input');
      assertEqual(result.created.creator, 'it1', 'creator phải là người đang đăng nhập (server tự gán)');
      assert(!('status' in result.created) || result.created.status === undefined, 'Bản ghi KHÔNG có status/qua duyệt — tạo xong hiệu lực ngay (khác Giấy Phép)');
      assert(Array.isArray(result.created.notifiedThresholds) && result.created.notifiedThresholds.length === 0, 'notifiedThresholds phải khởi tạo rỗng');
      firstItemId = result.created.id;
    });

    // ===== 3) Validation: thiếu Tên dịch vụ bị chặn =====
    await run.run('Validation: thiếu Tên dịch vụ bị chặn (không tạo bản ghi)', async () => {
      const before = await page.evaluate(() => DB.itServiceRenewals.length);
      const result = await page.evaluate(async (expiry) => {
        window.__resetCapture();
        document.getElementById('itRenewalName').value = '';
        document.getElementById('itRenewalCategory').value = 'Tên miền';
        document.getElementById('itRenewalExpiryDate').value = expiry;
        await submitItServiceRenewal({ preventDefault() {}, target: document.getElementById('itRenewalCreateForm') });
        return { alerts: window.__alerts, count: DB.itServiceRenewals.length };
      }, todayPlusDays(365));
      assertIncludes(result.alerts, 'Vui lòng nhập Tên dịch vụ', 'Phải cảnh báo thiếu Tên dịch vụ');
      assertEqual(result.count, before, 'Không được tạo thêm bản ghi khi validation thất bại');
    });

    // ===== 4) Permission: người không có itManage bị server chặn khi tạo =====
    await run.run('Permission: người không có itManage bị server chặn khi tạo dịch vụ', async () => {
      await loginAs(page, EMP_NOPERM);
      const before = await page.evaluate(() => DB.itServiceRenewals.length);
      const result = await page.evaluate(async (expiry) => {
        window.__resetCapture();
        document.getElementById('itRenewalName').value = 'Tên miền trái phép';
        document.getElementById('itRenewalCategory').value = 'Tên miền';
        document.getElementById('itRenewalExpiryDate').value = expiry;
        await submitItServiceRenewal({ preventDefault() {}, target: document.getElementById('itRenewalCreateForm') });
        return { alerts: window.__alerts, count: DB.itServiceRenewals.length };
      }, todayPlusDays(365));
      assertIncludes(result.alerts, 'Bạn không có quyền quản lý danh mục gia hạn dịch vụ CNTT', 'Server phải trả lỗi 403 với thông báo đúng');
      assertEqual(result.count, before, 'Không được tạo thêm bản ghi khi không có quyền');
    });

    // ===== 5) Sửa: itManage sửa được thông tin, kể cả lùi ngày hết hạn để fix nhập sai =====
    await run.run('Sửa: itManage sửa được thông tin dịch vụ (kể cả lùi ngày hết hạn)', async () => {
      await loginAs(page, IT_STAFF2);
      const result = await page.evaluate(async (args) => {
        const [id, earlierExpiry] = args;
        window.__resetCapture();
        openItServiceRenewalEditModal(id);
        document.getElementById('itRenewalEditVendor').value = 'Microsoft Corp (sửa lại)';
        document.getElementById('itRenewalEditExpiryDate').value = earlierExpiry; // LÙI ngày hết hạn — hợp lệ khi Sửa
        await submitItServiceRenewalEdit();
        return { alerts: window.__alerts, item: DB.itServiceRenewals.find(x => x.id === id) };
      }, [firstItemId, todayPlusDays(200)]);
      assertEqual(result.item.vendor, 'Microsoft Corp (sửa lại)', 'Phải cập nhật đúng nhà cung cấp mới');
      assertEqual(result.item.expiryDate, todayPlusDays(200), 'Sửa phải cho phép lùi ngày hết hạn (khác Gia Hạn)');
      assert(result.item.history.some(h => h.action === 'EDITED'), 'Lịch sử phải ghi nhận EDITED');
    });

    // ===== 6) Gia Hạn: bắt buộc ngày mới PHẢI SAU ngày hiện tại, reset notifiedThresholds =====
    await run.run('Gia Hạn: chặn khi ngày mới KHÔNG sau ngày hết hạn hiện tại', async () => {
      const result = await page.evaluate(async (args) => {
        const [id, sameExpiry] = args;
        window.__resetCapture();
        openItServiceRenewalRenewModal(id);
        document.getElementById('itRenewalRenewNewExpiryDate').value = sameExpiry;
        await submitItServiceRenewalRenew();
        return { alerts: window.__alerts, item: DB.itServiceRenewals.find(x => x.id === id) };
      }, [firstItemId, todayPlusDays(200)]);
      assertIncludes(result.alerts, 'Ngày hết hạn mới phải sau ngày hết hạn hiện tại', 'Phải chặn khi ngày mới không sau ngày hiện tại');
      assertEqual(result.item.expiryDate, todayPlusDays(200), 'Ngày hết hạn không được đổi khi bị chặn');
    });

    await run.run('Gia Hạn: itManage gia hạn thành công, reset notifiedThresholds + ghi lịch sử RENEWED', async () => {
      // Giả lập đã từng gửi nhắc (notifiedThresholds có dữ liệu) để kiểm chứng bị reset về rỗng.
      await page.evaluate((id) => {
        const item = DB.itServiceRenewals.find(x => x.id === id);
        item.notifiedThresholds = [30, 15];
      }, firstItemId);
      const result = await page.evaluate(async (args) => {
        const [id, newExpiry] = args;
        window.__resetCapture();
        openItServiceRenewalRenewModal(id);
        document.getElementById('itRenewalRenewNewExpiryDate').value = newExpiry;
        document.getElementById('itRenewalRenewCost').value = '15000000';
        await submitItServiceRenewalRenew();
        return { item: DB.itServiceRenewals.find(x => x.id === id) };
      }, [firstItemId, todayPlusDays(400)]);
      assertEqual(result.item.expiryDate, todayPlusDays(400), 'Ngày hết hạn phải cập nhật đúng sau khi gia hạn');
      assertEqual(result.item.cost, 15000000, 'Chi phí gia hạn phải cập nhật đúng');
      assertEqual(result.item.notifiedThresholds.length, 0, 'notifiedThresholds phải reset về rỗng sau khi gia hạn');
      assert(result.item.history.some(h => h.action === 'RENEWED'), 'Lịch sử phải ghi nhận RENEWED (khác EDITED)');
    });

    // ===== 7) computeItRenewalLifecycleState() phân loại đúng =====
    await run.run('computeItRenewalLifecycleState() phân loại đúng Còn hiệu lực/Sắp hết hạn/Hết hạn', async () => {
      const result = await page.evaluate((d) => {
        return {
          valid: computeItRenewalLifecycleState({ expiryDate: d.far }),
          expiring: computeItRenewalLifecycleState({ expiryDate: d.soon }),
          expired: computeItRenewalLifecycleState({ expiryDate: d.past })
        };
      }, { far: todayPlusDays(365), soon: todayPlusDays(10), past: todayPlusDays(-5) });
      assertEqual(result.valid, 'VALID', 'Hết hạn xa (365 ngày) phải là Còn hiệu lực');
      assertEqual(result.expiring, 'EXPIRING', 'Hết hạn trong 10 ngày (≤30) phải là Sắp hết hạn');
      assertEqual(result.expired, 'EXPIRED', 'Đã qua ngày hết hạn phải là Hết hạn');
    });

    // ===== 8) Xóa: chỉ admin mới xóa được =====
    await run.run('Permission: itManage (không phải admin) KHÔNG xóa được', async () => {
      const before = await page.evaluate(() => DB.itServiceRenewals.length);
      await page.evaluate(async () => {
        window.__resetCapture();
        // deleteItServiceRenewalAction() tự alert() và return sớm nếu !perms.admin, không mở modal xác nhận.
        deleteItServiceRenewalAction(DB.itServiceRenewals[0].id);
      });
      const after = await page.evaluate(() => DB.itServiceRenewals.length);
      assertEqual(after, before, 'itManage không phải admin thì không xóa được');
    });

    await run.run('Xóa dịch vụ CNTT chỉ admin mới thực hiện được', async () => {
      await loginAs(page, ADMIN);
      const targetId = await page.evaluate(() => DB.itServiceRenewals[0].id);
      const before = await page.evaluate(() => DB.itServiceRenewals.length);
      await page.evaluate(async (id) => {
        window.__resetCapture();
        deleteItServiceRenewalAction(id);
        await window.__confirmPending();
      }, targetId);
      const after = await page.evaluate(() => DB.itServiceRenewals.length);
      assertEqual(after, before - 1, 'Admin phải xóa được dịch vụ CNTT');
    });

    // ===== 9) Dashboard: thẻ đếm đúng số lượng =====
    await run.run('Dashboard: thẻ "Tổng Dịch Vụ" đếm đúng số lượng hiện có', async () => {
      await loginAs(page, IT_STAFF);
      const result = await page.evaluate(() => {
        switchTab('itSupport');
        setItSupportSubTab('RENEWAL');
        return { html: document.getElementById('itRenewalDashboardCards').innerHTML, total: DB.itServiceRenewals.length };
      });
      assert(result.html.includes('Tổng Dịch Vụ'), 'Dashboard phải có thẻ "Tổng Dịch Vụ"');
      assert(result.html.includes(String(result.total)), 'Thẻ phải hiển thị đúng số lượng hiện có');
    });

  } finally {
    run.summary();
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
