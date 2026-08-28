// server/tests/test-license.js
//
// Regression test cho module Giấy Phép (key 'license', con của Hành Chính):
//   - Phân quyền HOÀN TOÀN phẳng NGAY TRONG module (licenseCreate/licenseApprove/licenseView), KHÔNG đi
//     qua quy trình phòng ban — cùng khuôn Góc Chia Sẻ (internalPosts SHARE), xem lib/recordActions.js
//     canApproveLicense().
//   - Versioning "cộng thêm phiên bản mới" giống hệt Tài Liệu (rootLicenseId, chặn tạo version mới khi
//     phiên bản mới nhất còn PENDING, REJECTED không chặn).
//   - Vòng đời sau khi APPROVED: lifecycleStatus RENEWING (bấm tay bật/tắt)/REVOKED (thu hồi, có lý do),
//     tính TRẠNG THÁI HIỆU LỰC (Còn hiệu lực/Sắp hết hạn/Hết hạn) từ expiryDate khi không RENEWING/REVOKED.
//   - Quyền xem: licenseCreate-only chỉ thấy hồ sơ CỦA MÌNH trong danh sách (canViewThisLicense, lọc phía
//     client trong renderLicenses() — xem chú thích trong file đó về việc server đã lọc sẵn ở GET /api/data
//     thật, mock harness này không tái hiện lớp lọc server nên bài test khai thác đúng lớp lọc client).
//
// Chạy: node server/tests/test-license.js
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual, assertIncludes
} = require('./testHarness');

const PORT = 8983;

// ===================== Seed dữ liệu =====================
const CREATOR = { username: 'hc1', name: 'Nguyễn Văn Hành Chính', dept: 'Hành Chính', perms: { licenseCreate: true }, active: true };
const CREATOR2 = { username: 'hc2', name: 'Trần Thị Hành Chính', dept: 'Hành Chính', perms: { licenseCreate: true }, active: true };
const APPROVER = { username: 'approver1', name: 'Người Duyệt Giấy Phép', dept: 'Ban Giám Đốc', perms: { licenseApprove: true }, active: true };
const VIEWER = { username: 'viewer1', name: 'Người Xem Giấy Phép', dept: 'Kế Toán', perms: { licenseView: true }, active: true };
const EMP_NOPERM = { username: 'emp_noperm', name: 'Người Không Quyền', dept: 'Hành Chính', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Hành Chính', perms: { admin: true }, active: true };

const state = createMockState({
  depts: ['Hành Chính', 'Ban Giám Đốc', 'Kế Toán'],
  users: [CREATOR, CREATOR2, APPROVER, VIEWER, EMP_NOPERM, ADMIN]
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
    // ===== 1) Happy path: licenseCreate tải lên giấy phép mới =====
    await run.run('licenseCreate tải lên giấy phép mới (happy path, mã tự sinh)', async () => {
      await loginAs(page, CREATOR);
      const result = await page.evaluate(async (expiry) => {
        function setFileInput(id, filename, content, mime) {
          const dt = new DataTransfer();
          dt.items.add(new File([content], filename, { type: mime }));
          document.getElementById(id).files = dt.files;
        }
        switchTab('license');
        document.getElementById('licenseOpMode').value = 'NEW';
        onLicenseOpModeChange();
        document.getElementById('licenseCompanyName').value = 'Công ty TNHH HCRC';
        document.getElementById('licenseLocationName').value = 'Chi nhánh Hội An';
        document.getElementById('licenseOperatingStatus').value = 'ACTIVE';
        document.getElementById('licenseType').value = 'Giấy phép kinh doanh';
        document.getElementById('licenseNumber').value = 'GPKD-001/2026';
        document.getElementById('licenseIssueDate').value = '2026-01-01';
        document.getElementById('licenseExpiryDate').value = expiry;
        document.getElementById('licenseIssuingAuthority').value = 'Sở KH&ĐT Quảng Nam';
        setFileInput('licenseFile', 'giay-phep-kinh-doanh.pdf', 'nội dung giả lập', 'application/pdf');
        const before = DB.licenses.length;
        await uploadLicense({ preventDefault() {} });
        const created = DB.licenses[0];
        return {
          alerts: window.__alerts,
          countIncreased: DB.licenses.length === before + 1,
          created,
          licenseTypesLearned: DB.licenseTypes.includes('Giấy phép kinh doanh')
        };
      }, todayPlusDays(365));
      assertIncludes(result.alerts, 'Tải lên và trình duyệt giấy phép thành công', 'Phải báo thành công');
      assert(result.countIncreased, 'DB.licenses phải tăng thêm 1 bản ghi');
      assert(result.created && result.created.status === 'PENDING', 'Giấy phép mới phải ở trạng thái PENDING');
      assert(result.created && result.created.rootLicenseId === null, 'Giấy phép mới (nhập mới) phải có rootLicenseId = null');
      assert(result.created && result.created.versionNumber === 1, 'Giấy phép mới phải là versionNumber 1');
      assert(/^HCRC-GP-/.test(result.created.code), `Mã phải tự sinh theo tiền tố HCRC-GP- (generateHcrcCode), thực tế: ${result.created.code}`);
      assertEqual(result.created.creator, 'hc1', 'creator phải là người đang đăng nhập (server tự gán)');
      assert(result.licenseTypesLearned, 'Loại giấy phép mới gõ phải tự học thêm vào DB.licenseTypes');
    });

    // ===== 2) Validation: thiếu trường bắt buộc bị chặn =====
    await run.run('Validation: thiếu Cơ Quan Cấp Phép bị chặn (không tạo bản ghi)', async () => {
      const before = await page.evaluate(() => DB.licenses.length);
      const result = await page.evaluate(async (expiry) => {
        window.__resetCapture();
        function setFileInput(id, filename, content, mime) {
          const dt = new DataTransfer();
          dt.items.add(new File([content], filename, { type: mime }));
          document.getElementById(id).files = dt.files;
        }
        document.getElementById('licenseOpMode').value = 'NEW';
        onLicenseOpModeChange();
        document.getElementById('licenseCompanyName').value = 'Công ty TNHH HCRC';
        document.getElementById('licenseLocationName').value = 'Chi nhánh Đà Nẵng';
        document.getElementById('licenseType').value = 'Giấy phép PCCC';
        document.getElementById('licenseNumber').value = 'GPCC-002/2026';
        document.getElementById('licenseIssueDate').value = '2026-01-01';
        document.getElementById('licenseExpiryDate').value = expiry;
        document.getElementById('licenseIssuingAuthority').value = ''; // thiếu
        setFileInput('licenseFile', 'giay-pccc.pdf', 'noi dung', 'application/pdf');
        await uploadLicense({ preventDefault() {} });
        return { alerts: window.__alerts, count: DB.licenses.length };
      }, todayPlusDays(365));
      assertIncludes(result.alerts, 'Vui lòng nhập đầy đủ thông tin', 'Phải cảnh báo thiếu thông tin bắt buộc');
      assertEqual(result.count, before, 'Không được tạo thêm bản ghi khi validation thất bại');
    });

    // ===== 3) Permission: người không có licenseCreate bị server chặn =====
    await run.run('Permission: người không có quyền licenseCreate bị server chặn khi tạo giấy phép', async () => {
      await loginAs(page, EMP_NOPERM);
      const before = await page.evaluate(() => DB.licenses.length);
      const result = await page.evaluate(async (expiry) => {
        window.__resetCapture();
        function setFileInput(id, filename, content, mime) {
          const dt = new DataTransfer();
          dt.items.add(new File([content], filename, { type: mime }));
          document.getElementById(id).files = dt.files;
        }
        document.getElementById('licenseOpMode').value = 'NEW';
        onLicenseOpModeChange();
        document.getElementById('licenseCompanyName').value = 'Công ty TNHH HCRC';
        document.getElementById('licenseLocationName').value = 'Chi nhánh Huế';
        document.getElementById('licenseType').value = 'Giấy phép trái phép';
        document.getElementById('licenseNumber').value = 'GP-XXX';
        document.getElementById('licenseIssueDate').value = '2026-01-01';
        document.getElementById('licenseExpiryDate').value = expiry;
        document.getElementById('licenseIssuingAuthority').value = 'Cơ quan test';
        setFileInput('licenseFile', 'giay-trai-phep.pdf', 'noi dung', 'application/pdf');
        await uploadLicense({ preventDefault() {} });
        return { alerts: window.__alerts, count: DB.licenses.length };
      }, todayPlusDays(365));
      assertIncludes(result.alerts, 'Bạn không có quyền tạo/tải lên giấy phép', 'Server phải trả lỗi 403 với thông báo đúng');
      assertEqual(result.count, before, 'Không được tạo thêm bản ghi khi không có quyền');
    });

    // ===== 4) Quyền xem: licenseCreate-only chỉ thấy giấy phép CỦA MÌNH trong danh sách =====
    await run.run('Quyền xem: licenseCreate-only (không có approve/view) chỉ thấy giấy phép do chính mình tạo', async () => {
      await loginAs(page, CREATOR2);
      const result = await page.evaluate(async (expiry) => {
        function setFileInput(id, filename, content, mime) {
          const dt = new DataTransfer();
          dt.items.add(new File([content], filename, { type: mime }));
          document.getElementById(id).files = dt.files;
        }
        switchTab('license');
        document.getElementById('licenseOpMode').value = 'NEW';
        onLicenseOpModeChange();
        document.getElementById('licenseCompanyName').value = 'Công ty TNHH HCRC';
        document.getElementById('licenseLocationName').value = 'Chi nhánh Nha Trang';
        document.getElementById('licenseType').value = 'Giấy phép ATTP';
        document.getElementById('licenseNumber').value = 'ATTP-003/2026';
        document.getElementById('licenseIssueDate').value = '2026-01-01';
        document.getElementById('licenseExpiryDate').value = expiry;
        document.getElementById('licenseIssuingAuthority').value = 'Chi cục ATTP';
        setFileInput('licenseFile', 'giay-attp.pdf', 'noi dung', 'application/pdf');
        await uploadLicense({ preventDefault() {} });
        renderLicenses();
        const rows = document.getElementById('licenseTableBody').innerText;
        return { rows, myCode: DB.licenses.find(l => l.creator === 'hc2').code };
      }, todayPlusDays(365));
      assertIncludes(result.rows, result.myCode, 'Phải thấy giấy phép của chính mình (hc2)');
      assert(!result.rows.includes('GPKD-001'), 'KHÔNG được thấy giấy phép do hc1 tạo (khác creator, hc2 không có licenseApprove/licenseView)');

      // Đối chiếu: APPROVER (có licenseApprove) phải thấy CẢ 2 giấy phép của cả hc1 lẫn hc2.
      await loginAs(page, APPROVER);
      const approverView = await page.evaluate(() => {
        switchTab('license');
        renderLicenses();
        return document.getElementById('licenseTableBody').innerText;
      });
      assert(approverView.includes('GPKD-001') && /ATTP/.test(approverView), 'licenseApprove phải thấy TOÀN BỘ giấy phép, không riêng gì của mình');
    });

    let firstLicenseId;
    // ===== 5) Duyệt: licenseApprove duyệt giấy phép đầu tiên (hc1) =====
    await run.run('licenseApprove duyệt giấy phép PENDING thành APPROVED', async () => {
      const before = await page.evaluate(() => DB.licenses.find(l => l.code && l.code.startsWith('HCRC-GP-') && l.creator === 'hc1'));
      firstLicenseId = before.id;
      const result = await page.evaluate(async (id) => {
        window.__resetCapture();
        approveLicenseAction(id);
        const modalTitle = document.getElementById('genericConfirmTitle')?.innerText || '';
        await window.__confirmPending();
        return { modalTitle, item: DB.licenses.find(l => l.id === id) };
      }, firstLicenseId);
      assertIncludes(result.modalTitle, 'Phê duyệt giấy phép', 'Modal xác nhận phải hiện đúng tiêu đề trước khi bấm Đồng Ý');
      assertEqual(result.item.status, 'APPROVED', 'Giấy phép phải chuyển sang APPROVED sau khi duyệt');
      assert(result.item.history.some(h => h.action === 'APPROVED' && h.by === 'approver1'), 'Lịch sử phải ghi nhận đúng người duyệt');
    });

    // ===== 6) Permission: người không có licenseApprove không tự duyệt được (server chặn) =====
    await run.run('Permission: người không có licenseApprove bị server chặn khi bấm Duyệt', async () => {
      await loginAs(page, CREATOR);
      const targetId = await page.evaluate(() => DB.licenses.find(l => l.creator === 'hc2').id);
      const result = await page.evaluate(async (id) => {
        window.__resetCapture();
        approveLicenseAction(id);
        await window.__confirmPending();
        return { alerts: window.__alerts, item: DB.licenses.find(l => l.id === id) };
      }, targetId);
      assertIncludes(result.alerts, 'Bạn không có quyền phê duyệt giấy phép', 'Server phải chặn người không có licenseApprove');
      assertEqual(result.item.status, 'PENDING', 'Giấy phép không được đổi trạng thái khi bị chặn quyền');
    });

    // ===== 7) Versioning: cập nhật phiên bản mới cho giấy phép đã duyệt =====
    await run.run('Versioning: licenseCreate (chủ sở hữu) cập nhật phiên bản mới cho giấy phép đã APPROVED', async () => {
      await loginAs(page, CREATOR);
      const result = await page.evaluate(async (args) => {
        const [id, expiry] = args;
        function setFileInput(fid, filename, content, mime) {
          const dt = new DataTransfer();
          dt.items.add(new File([content], filename, { type: mime }));
          document.getElementById(fid).files = dt.files;
        }
        switchTab('license');
        document.getElementById('licenseOpMode').value = 'UPDATE';
        onLicenseOpModeChange();
        document.getElementById('licenseUpdateTarget').value = String(id);
        onLicenseUpdateTargetChange();
        document.getElementById('licenseNumber').value = 'GPKD-001/2026-B';
        document.getElementById('licenseIssueDate').value = '2027-01-01';
        document.getElementById('licenseExpiryDate').value = expiry;
        setFileInput('licenseFile', 'giay-phep-kinh-doanh-v2.pdf', 'noi dung v2', 'application/pdf');
        const before = DB.licenses.length;
        await uploadLicense({ preventDefault() {} });
        return {
          alerts: window.__alerts,
          countIncreased: DB.licenses.length === before + 1,
          v2: DB.licenses.find(l => l.rootLicenseId === id)
        };
      }, [firstLicenseId, todayPlusDays(730)]);
      assert(result.countIncreased, 'Phải tạo thêm 1 bản ghi version mới');
      assert(result.v2, 'Phải tìm thấy bản ghi version 2 với rootLicenseId đúng');
      assertEqual(result.v2.versionNumber, 2, 'Phiên bản mới phải là versionNumber 2');
      assertEqual(result.v2.status, 'PENDING', 'Phiên bản mới phải ở trạng thái PENDING chờ duyệt lại');
      assert(result.v2.code.endsWith('-V2'), `Mã version phải có hậu tố -V2, thực tế: ${result.v2.code}`);
    });

    // ===== 8) Versioning: chặn tạo version mới khi phiên bản mới nhất đang PENDING =====
    await run.run('Versioning: chặn cập nhật phiên bản khi bản mới nhất đang chờ duyệt', async () => {
      const before = await page.evaluate(() => DB.licenses.length);
      const result = await page.evaluate(async (args) => {
        window.__resetCapture();
        const [id, expiry] = args;
        function setFileInput(fid, filename, content, mime) {
          const dt = new DataTransfer();
          dt.items.add(new File([content], filename, { type: mime }));
          document.getElementById(fid).files = dt.files;
        }
        document.getElementById('licenseOpMode').value = 'UPDATE';
        onLicenseOpModeChange();
        // populateLicenseUpdateTargets() phải KHÔNG liệt kê license này nữa (bản mới nhất đang PENDING)
        const stillListed = Array.from(document.getElementById('licenseUpdateTarget').options).some(o => o.value === String(id));
        document.getElementById('licenseUpdateTarget').value = String(id);
        document.getElementById('licenseNumber').value = 'GPKD-001/2026-C';
        document.getElementById('licenseIssueDate').value = '2027-06-01';
        document.getElementById('licenseExpiryDate').value = expiry;
        setFileInput('licenseFile', 'giay-phep-kinh-doanh-v3.pdf', 'noi dung v3', 'application/pdf');
        await uploadLicense({ preventDefault() {} });
        return { alerts: window.__alerts, count: DB.licenses.length, stillListed };
      }, [firstLicenseId, todayPlusDays(1000)]);
      // Chặn ở NGAY BƯỚC populateLicenseUpdateTargets() (không liệt kê trong dropdown) — chọn "value" của 1
      // option không tồn tại thì dropdown giữ nguyên rỗng, uploadLicense() báo "chưa chọn" thay vì thông
      // báo "đang chờ duyệt" (thông báo đó chỉ hiện nếu chọn được rồi mới bị chặn ở bước validate sau) —
      // cả 2 đều CHỨNG MINH ĐÚNG hiệu ứng chặn, chỉ khác điểm phát hiện.
      assert(!result.stillListed, 'Dropdown "Chọn Giấy Phép Cần Cập Nhật" KHÔNG được liệt kê giấy phép có bản mới nhất đang PENDING');
      assertIncludes(result.alerts, 'Vui lòng chọn giấy phép cần cập nhật', 'Phải cảnh báo do không chọn được mục tiêu cập nhật (đã bị loại khỏi dropdown)');
      assertEqual(result.count, before, 'Không được tạo thêm bản ghi khi bị chặn');
    });

    // ===== 9) Từ chối + REJECTED không chặn tạo version mới =====
    await run.run('Từ chối phiên bản v2 (có lý do) rồi vẫn tạo được version mới (REJECTED không chặn)', async () => {
      await loginAs(page, APPROVER);
      const v2Id = await page.evaluate((id) => DB.licenses.find(l => l.rootLicenseId === id && l.versionNumber === 2).id, firstLicenseId);
      const rejectResult = await page.evaluate(async (id) => {
        window.__resetCapture();
        window.__promptAnswer = 'Thiếu chữ ký người có thẩm quyền';
        rejectLicenseAction(id);
        await window.__confirmPending();
        return { alerts: window.__alerts, prompts: window.__prompts, item: DB.licenses.find(l => l.id === id) };
      }, v2Id);
      assertIncludes(rejectResult.prompts, 'Nhập lý do từ chối giấy phép', 'Phải hỏi lý do từ chối qua prompt');
      assertEqual(rejectResult.item.status, 'REJECTED', 'Phiên bản v2 phải chuyển sang REJECTED');
      assertEqual(rejectResult.item.rejectReason, 'Thiếu chữ ký người có thẩm quyền', 'Phải lưu đúng lý do từ chối');

      await loginAs(page, CREATOR);
      const v3Result = await page.evaluate(async (args) => {
        window.__resetCapture();
        const [id, expiry] = args;
        function setFileInput(fid, filename, content, mime) {
          const dt = new DataTransfer();
          dt.items.add(new File([content], filename, { type: mime }));
          document.getElementById(fid).files = dt.files;
        }
        switchTab('license');
        document.getElementById('licenseOpMode').value = 'UPDATE';
        onLicenseOpModeChange();
        const stillListed = Array.from(document.getElementById('licenseUpdateTarget').options).some(o => o.value === String(id));
        document.getElementById('licenseUpdateTarget').value = String(id);
        onLicenseUpdateTargetChange();
        document.getElementById('licenseNumber').value = 'GPKD-001/2026-D';
        document.getElementById('licenseIssueDate').value = '2027-08-01';
        document.getElementById('licenseExpiryDate').value = expiry;
        setFileInput('licenseFile', 'giay-phep-kinh-doanh-v3.pdf', 'noi dung v3', 'application/pdf');
        const before = DB.licenses.length;
        await uploadLicense({ preventDefault() {} });
        return { alerts: window.__alerts, countIncreased: DB.licenses.length === before + 1, stillListed, v3: DB.licenses.find(l => l.rootLicenseId === id && l.versionNumber === 3) };
      }, [firstLicenseId, todayPlusDays(1000)]);
      assert(v3Result.stillListed, 'REJECTED KHÔNG được coi là chặn — giấy phép phải xuất hiện lại trong dropdown cập nhật');
      assert(v3Result.countIncreased && v3Result.v3, 'Phải tạo được version 3 dù version 2 bị REJECTED');
    });

    // ===== 10) Vòng đời: đánh dấu/bỏ đánh dấu "Đang gia hạn" trên giấy phép v1 đã APPROVED =====
    await run.run('Vòng đời: đánh dấu rồi bỏ đánh dấu "Đang gia hạn" cho giấy phép đã duyệt', async () => {
      await loginAs(page, APPROVER);
      const onResult = await page.evaluate(async (id) => {
        window.__resetCapture();
        setLicenseRenewingAction(id, true);
        await window.__confirmPending();
        return { alerts: window.__alerts, item: DB.licenses.find(l => l.id === id) };
      }, firstLicenseId);
      assertEqual(onResult.item.lifecycleStatus, 'RENEWING', 'Phải chuyển lifecycleStatus sang RENEWING');
      assert(onResult.item.history.some(h => h.action === 'MARK_RENEWING'), 'Lịch sử phải ghi nhận MARK_RENEWING');

      const offResult = await page.evaluate(async (id) => {
        window.__resetCapture();
        setLicenseRenewingAction(id, false);
        await window.__confirmPending();
        return { item: DB.licenses.find(l => l.id === id) };
      }, firstLicenseId);
      assertEqual(offResult.item.lifecycleStatus, null, 'Phải bỏ RENEWING (về null) khi bấm bỏ đánh dấu');
    });

    // ===== 11) Vòng đời: thu hồi (có lý do) rồi bỏ thu hồi =====
    await run.run('Vòng đời: thu hồi giấy phép (bắt buộc lý do) rồi bỏ thu hồi', async () => {
      const revokeResult = await page.evaluate(async (id) => {
        window.__resetCapture();
        window.__promptAnswer = 'Vi phạm quy định an toàn';
        revokeLicenseAction(id);
        await window.__confirmPending();
        return { item: DB.licenses.find(l => l.id === id) };
      }, firstLicenseId);
      assertEqual(revokeResult.item.lifecycleStatus, 'REVOKED', 'Phải chuyển lifecycleStatus sang REVOKED');
      assertEqual(revokeResult.item.revokeReason, 'Vi phạm quy định an toàn', 'Phải lưu đúng lý do thu hồi');
      assertEqual(revokeResult.item.revokedBy, 'approver1', 'Phải ghi nhận đúng người thu hồi');

      // Không thể đánh dấu "Đang gia hạn" khi đã REVOKED (server tự chặn).
      const blockedResult = await page.evaluate(async (id) => {
        window.__resetCapture();
        setLicenseRenewingAction(id, true);
        await window.__confirmPending();
        return { alerts: window.__alerts, item: DB.licenses.find(l => l.id === id) };
      }, firstLicenseId);
      assertIncludes(blockedResult.alerts, 'đã bị thu hồi', 'Server phải chặn đánh dấu gia hạn khi đã thu hồi');
      assertEqual(blockedResult.item.lifecycleStatus, 'REVOKED', 'Vẫn phải giữ REVOKED sau khi bị chặn');

      const unrevokeResult = await page.evaluate(async (id) => {
        window.__resetCapture();
        unrevokeLicenseAction(id);
        await window.__confirmPending();
        return { item: DB.licenses.find(l => l.id === id) };
      }, firstLicenseId);
      assertEqual(unrevokeResult.item.lifecycleStatus, null, 'Phải trả lifecycleStatus về null sau khi bỏ thu hồi');
    });

    // ===== 12) Tính trạng thái hiệu lực từ expiryDate (Còn hiệu lực / Sắp hết hạn / Hết hạn) =====
    await run.run('computeLicenseLifecycleState() phân loại đúng Còn hiệu lực/Sắp hết hạn/Hết hạn', async () => {
      const result = await page.evaluate((soon) => {
        const valid = computeLicenseLifecycleState({ status: 'APPROVED', lifecycleStatus: null, expiryDate: soon.far });
        const expiring = computeLicenseLifecycleState({ status: 'APPROVED', lifecycleStatus: null, expiryDate: soon.soon });
        const expired = computeLicenseLifecycleState({ status: 'APPROVED', lifecycleStatus: null, expiryDate: soon.past });
        const pendingNull = computeLicenseLifecycleState({ status: 'PENDING', lifecycleStatus: null, expiryDate: soon.far });
        return { valid, expiring, expired, pendingNull };
      }, { far: todayPlusDays(365), soon: todayPlusDays(10), past: todayPlusDays(-5) });
      assertEqual(result.valid, 'VALID', 'Hết hạn xa (365 ngày) phải là Còn hiệu lực');
      assertEqual(result.expiring, 'EXPIRING', 'Hết hạn trong 10 ngày (≤30) phải là Sắp hết hạn');
      assertEqual(result.expired, 'EXPIRED', 'Đã qua ngày hết hạn phải là Hết hạn');
      assertEqual(result.pendingNull, null, 'Giấy phép chưa APPROVED thì trạng thái hiệu lực phải là null (không áp dụng)');
    });

    // ===== 13) Xóa: chỉ admin mới xóa được =====
    await run.run('Xóa giấy phép chỉ admin mới thực hiện được (deleteRecordAdminOnly)', async () => {
      await loginAs(page, ADMIN);
      const targetId = await page.evaluate(() => DB.licenses.find(l => l.creator === 'hc2').id);
      const before = await page.evaluate(() => DB.licenses.length);
      await page.evaluate(async (id) => {
        window.__resetCapture();
        deleteLicenseAction(id);
        await window.__confirmPending();
      }, targetId);
      const after = await page.evaluate(() => DB.licenses.length);
      assertEqual(after, before - 1, 'Admin phải xóa được giấy phép (window.confirm() luôn trả true trong harness)');
    });

    // ===== 14) Dashboard: thẻ đếm đúng số lượng theo trạng thái =====
    await run.run('Dashboard: thẻ "Chờ Duyệt: Cập Nhật" đếm đúng số version đang PENDING', async () => {
      await loginAs(page, APPROVER);
      const result = await page.evaluate(() => {
        switchTab('license');
        renderLicenses();
        const pendingVersions = DB.licenses.filter(l => l.rootLicenseId != null && l.status === 'PENDING').length;
        return { html: document.getElementById('licenseDashboardCards').innerHTML, pendingVersions };
      });
      assert(result.html.includes('Chờ Duyệt: Cập Nhật'), 'Dashboard phải có thẻ "Chờ Duyệt: Cập Nhật"');
      assert(result.pendingVersions >= 1, 'Phải còn ít nhất 1 version đang PENDING để thẻ có ý nghĩa (v3 vừa tạo ở bước 9)');
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
