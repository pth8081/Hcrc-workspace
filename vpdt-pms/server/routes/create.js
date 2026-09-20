// routes/create.js — Bước 2 (phương án C bảo mật): tạo hồ sơ mới đi qua đường có xác minh ở server
// (xem lib/createValidation.js), thay cho POST /api/data/:key chung — trước đây server tin nguyên
// dept/creator client tự gửi, chỉ dựa vào dropdown ĐÃ LỌC SẴN ở giao diện.
const express = require('express');
const router = express.Router();
const { getAllAppData, withLockedAppDataValue } = require('../lib/appData');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { CREATE_MODULE_CONFIGS, CreateError, validateAndPrepareCreate } = require('../lib/createValidation');
const { createForCollection, createForCollectionSerialized, getAllForCollection, withAppLock, getTrashItems } = require('../lib/recordStore');
const employeeProfile = require('../lib/employeeProfile');
const { hasModuleAccessServer, MODULE_ACCESS_GATED_COLLECTIONS } = require('../lib/recordViewScope');
const { MODULE_CONFIGS: WORKFLOW_MODULE_CONFIGS } = require('../lib/workflowEngine');
const { insertSystemLog } = require('../lib/systemLogStore');
// assertPayloadFileUrlsOwnedByUser() — vá lỗ hổng giả mạo quyền sở hữu file (rà soát bảo mật 9/2026,
// mức Cao): xem chú thích đầy đủ ở lib/uploadedFiles.js + sql/schema.sql (bảng UploadedFiles).
const { assertPayloadFileUrlsOwnedByUser } = require('../lib/uploadedFiles');

// Đảo ngược MODULE_ACCESS_GATED_COLLECTIONS (moduleKey -> [collection,...]) thành collection -> moduleKey
// để tra cứu 1 chiều tại đây — PQ-01 (đợt test chuyên sâu 9/2026) phát hiện Khối 0 (moduleAccess) TRƯỚC
// ĐÂY chỉ được mirror ở GET /api/data (routes/data.js), CHƯA hề chặn ở khâu TẠO MỚI: tắt moduleAccess.doc/
// contract/itSupport... cho 1 user xong họ vẫn POST /api/create/docs|contracts|itSupportTickets... tạo
// hồ sơ bình thường (chỉ không thấy lại được sau đó qua GET /api/data) — vi phạm đúng nguyên tắc "Khối 0
// chặn trước tiên, quyền chi tiết vô nghĩa khi thiếu Khối 0". Chặn ở ĐÚNG 1 điểm chung (route handler
// này, nơi MỌI module qua CREATE_MODULE_CONFIGS đều đi qua) thay vì rải rác từng extraValidate.
const COLLECTION_TO_MODULE_ACCESS_KEY = Object.entries(MODULE_ACCESS_GATED_COLLECTIONS).reduce(
  (acc, [moduleKey, collections]) => {
    collections.forEach((c) => { acc[c] = moduleKey; });
    return acc;
  }, {}
);

router.use(requireAuth, blockIfMustChangePassword);

// Danh mục "Các Loại Giấy Phép" (appData.licenseTypes) TỰ HỌC giá trị mới người dùng vừa gõ khi tải
// giấy phép — trước đây do CLIENT làm (uploadLicense() ở public/index.html: push vào DB.licenseTypes
// rồi syncStorage('licenseTypes') = POST /api/data/licenseTypes ghi đè NGUYÊN mảng). Từ khi
// "licenseTypes" vào ADMIN_ONLY_KEYS (routes/data.js — danh mục này thuộc tab Quản Lý Danh Mục chỉ
// admin thấy, trước đây bất kỳ ai đã đăng nhập cũng ghi đè/xoá trắng được), đường đó đóng với người
// dùng thường, nên bước tự học chuyển hẳn về SERVER ở đây.
//
// Khác biệt cốt lõi so với đường cũ: CHỈ THÊM (append) đúng 1 giá trị đã được extraValidate của
// licenses làm sạch (trim + cắt 300 ký tự) vào cuối danh mục — KHÔNG bao giờ sửa/xoá phần tử đang có,
// nên không dựng lại được lỗ hổng "ghi đè/xoá trắng cả danh mục" mà bản vá vừa đóng. Chỉ chạy khi
// giấy phép đã tạo THÀNH CÔNG (người gọi chắc chắn có quyền licenseCreate/admin).
const LICENSE_TYPES_MAX = 500; // trần an toàn: danh mục là nguồn GỢI Ý, không để phình vô hạn.

async function learnLicenseType(rawType) {
  const licenseType = String(rawType || '').trim();
  if (!licenseType) return;
  try {
    await withLockedAppDataValue('licenseTypes', (current) => {
      const list = Array.isArray(current) ? current : [];
      if (list.includes(licenseType) || list.length >= LICENSE_TYPES_MAX) return list;
      return [...list, licenseType];
    });
  } catch (err) {
    // Không bao giờ để việc cập nhật danh mục GỢI Ý làm hỏng lượt tạo giấy phép đã thành công —
    // bản ghi giấy phép mới là thứ người dùng thật sự cần, danh mục chỉ là tiện ích nhập liệu.
    console.error('Không thể bổ sung loại giấy phép vào danh mục licenseTypes:', err.message);
  }
}

// Đợt audit "form-fields-6" — cùng khuôn learnLicenseType() ở trên, áp dụng cho "Loại Dịch Vụ" của
// Hỗ Trợ IT > Gia Hạn Dịch Vụ CNTT (appData.itRenewalCategories, TRƯỚC ĐÂY free-text + gợi ý cố định
// IT_RENEWAL_CATEGORY_SUGGESTIONS ở client, giờ danh mục admin-editable + tự học server-side).
const IT_RENEWAL_CATEGORIES_MAX = 500; // trần an toàn, cùng lý do LICENSE_TYPES_MAX ở trên.

async function learnItRenewalCategory(rawCategory) {
  const category = String(rawCategory || '').trim();
  if (!category) return;
  try {
    await withLockedAppDataValue('itRenewalCategories', (current) => {
      const list = Array.isArray(current) ? current : [];
      if (list.includes(category) || list.length >= IT_RENEWAL_CATEGORIES_MAX) return list;
      return [...list, category];
    });
  } catch (err) {
    // Không bao giờ để việc cập nhật danh mục GỢI Ý làm hỏng lượt tạo dịch vụ đã thành công — cùng lý
    // do learnLicenseType() ở trên.
    console.error('Không thể bổ sung loại dịch vụ vào danh mục itRenewalCategories:', err.message);
  }
}

// POST /api/create/:module  (module: submissions|contracts|meetings|carRegs|officeReqs|docs)
router.post('/:module', async (req, res) => {
  const { module: moduleKey } = req.params;
  if (!CREATE_MODULE_CONFIGS[moduleKey]) {
    return res.status(400).json({ error: `Module không hợp lệ: ${moduleKey}` });
  }

  try {
    // requireAuth đã tự tra cứu bản ghi user hiện tại từ DB (kể cả trạng thái active) và gắn sẵn vào
    // req.freshUser — không cần tự đọc lại DB thêm 1 lần nữa cho cùng mục đích.
    const freshUser = req.freshUser;

    // Khối 0: chặn TẠO MỚI nếu module này đang bị tắt moduleAccess cho user — xem chú thích
    // COLLECTION_TO_MODULE_ACCESS_KEY ở đầu file.
    const moduleAccessKey = COLLECTION_TO_MODULE_ACCESS_KEY[moduleKey];
    if (moduleAccessKey && !hasModuleAccessServer(freshUser, moduleAccessKey)) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập module này' });
    }

    // Đọc kèm toàn bộ AppData (quy trình phòng ban, nhóm phê duyệt trình...) — chỉ module submissions
    // dùng tới (dựng lại quy trình hiệu lực server-side, xem lib/createValidation.js), các module khác
    // bỏ qua tham số này.
    const appData = await getAllAppData();
    // vppRegistrations cần tra cứu chéo sang collection vppPeriods (kỳ đăng ký còn mở/danh mục mặt
    // hàng hợp lệ) — vppPeriods đã chuyển sang dbo.Records (không còn trong AppData) nên gộp thêm vào
    // đây, CALLER đọc sẵn rồi truyền vào (khớp đúng nguyên tắc appData ở lib/createValidation.js — file
    // đó không tự đọc DB/collection khác).
    if (moduleKey === 'vppRegistrations') appData.vppPeriods = await getAllForCollection('vppPeriods');
    // reportEntries cần tra cứu chéo sang collection reportPeriods (kỳ báo cáo còn mở/phạm vi phòng
    // ban/hạn chót) — cùng lý do vppRegistrations ở trên, reportPeriods cũng đã ở dbo.Records.
    if (moduleKey === 'reportEntries') appData.reportPeriods = await getAllForCollection('reportPeriods');
    // trainingRegistrations cần tra cứu chéo sang collection trainingClasses (lớp còn mở/còn chỗ/hạn
    // đăng ký, snapshot tên+mã lớp) — cùng lý do vppRegistrations/reportEntries ở trên.
    if (moduleKey === 'trainingRegistrations') appData.trainingClasses = await getAllForCollection('trainingClasses');
    // trainingClasses cần tra cứu chéo sang collection trainingTests (kiểm tra testId client gửi lên
    // khi gán bài test có phải bài test có thật hay không) — cùng lý do trainingRegistrations ở trên.
    // Đợt 4: cũng cần trainingCourses (kiểm tra courseId, tuỳ chọn, có phải chương trình có thật không).
    if (moduleKey === 'trainingClasses') {
      appData.trainingTests = await getAllForCollection('trainingTests');
      appData.trainingCourses = await getAllForCollection('trainingCourses');
    }
    // trainingDocuments (Đợt 4) cần tra cứu chéo sang collection trainingCourses (kiểm tra courseId,
    // tuỳ chọn, có phải chương trình có thật không) — cùng lý do trainingClasses ở trên.
    if (moduleKey === 'trainingDocuments') appData.trainingCourses = await getAllForCollection('trainingCourses');
    // trainingPlans (Đợt 5) cần tra cứu chéo sang collection trainingCourses (kiểm tra courseId, tuỳ
    // chọn, có phải chương trình có thật không) — cùng lý do trainingClasses/trainingDocuments ở trên.
    // depts/stores (kiểm tra targetDept) đã có sẵn trong appData (2 key AppData thường, không cần đọc thêm).
    if (moduleKey === 'trainingPlans') appData.trainingCourses = await getAllForCollection('trainingCourses');
    // careerPaths (Đợt 7) cần tra cứu chéo sang collection trainingCourses (mỗi cấp bậc — stages[].
    // requiredCourseIds — phải trỏ vào chương trình có thật) — cùng lý do trainingClasses/
    // trainingDocuments/trainingPlans ở trên.
    if (moduleKey === 'careerPaths') appData.trainingCourses = await getAllForCollection('trainingCourses');
    // onboardingPaths cần tra cứu chéo sang trainingCourses (mỗi giai đoạn — stage{1,2}RequiredCourseIds
    // — phải trỏ vào chương trình có thật, cùng khuôn careerPaths ở trên, xem
    // normalizeOnboardingPathFields()).
    if (moduleKey === 'onboardingPaths') appData.trainingCourses = await getAllForCollection('trainingCourses');
    // onboardingProgress (Đợt 6) cần tra cứu chéo sang onboardingPaths (pathId có phải lộ trình có thật
    // không, snapshot tên) — appData.users đã có sẵn trong AppData chung (không cần đọc thêm, khác
    // trainingCourses/trainingTests vẫn ở dbo.Records riêng).
    if (moduleKey === 'onboardingProgress') appData.onboardingPaths = await getAllForCollection('onboardingPaths');
    // recruitmentReferrals cần tra cứu chéo sang collection recruitmentJobs (tin còn OPEN/snapshot
    // jobTitle) — cùng lý do trainingRegistrations ở trên.
    if (moduleKey === 'recruitmentReferrals') appData.recruitmentJobs = await getAllForCollection('recruitmentJobs');
    // budgetEntries cần tra cứu chéo sang budgetPeriods (kỳ còn mở/phạm vi phòng ban/hạn chót/mẫu đã
    // chọn) + budgetTemplates (đọc field mẫu để validate các dòng ngân sách) — cùng lý do reportEntries
    // ở trên. budgetPeriods cần tra cứu chéo sang budgetTemplates (kiểm tra templateId có thật) — cùng
    // lý do reportPeriods ở trên.
    if (moduleKey === 'budgetEntries') {
      appData.budgetPeriods = await getAllForCollection('budgetPeriods');
      appData.budgetTemplates = await getAllForCollection('budgetTemplates');
    }
    if (moduleKey === 'budgetPeriods') appData.budgetTemplates = await getAllForCollection('budgetTemplates');
    // operationExecutionPeriods (Vận Hành > Siêu Thị > Thực hiện) cần tra cứu chéo sang hồ sơ nguồn
    // (operationStoreOpenings/operationRepairs — dự toán đã duyệt xong chưa) — cùng lý do các nhánh trên.
    if (moduleKey === 'operationExecutionPeriods') {
      appData.operationStoreOpenings = await getAllForCollection('operationStoreOpenings');
      appData.operationRepairs = await getAllForCollection('operationRepairs');
    }
    // Công & Phép (Đợt 3/4 module Nhân Sự, xem lib/attendance.js): attendanceRecords/leaveRequests cần
    // tra cứu chéo hrProcesses (dự phòng suy WorkModel khi hồ sơ CHƯA liên kết tài khoản, xem
    // resolveWorkModelForEmployeeCode()); leaveRequests còn cần leaveBalances (kiểm tra đủ ngày phép còn
    // lại); shiftSwapRequests cần shiftRoster (đúng ca xin đổi có phải của người nộp đơn không) — 3
    // collection này KHÔNG có trong appData mặc định vì đều là dbo.Records (MIGRATED_COLLECTIONS) chứ
    // không phải AppData thường, cùng lý do các nhánh cross-lookup khác ở trên.
    if (moduleKey === 'attendanceRecords' || moduleKey === 'leaveRequests') {
      appData.hrProcesses = await getAllForCollection('hrProcesses');
    }
    if (moduleKey === 'leaveRequests') appData.leaveBalances = await getAllForCollection('leaveBalances');
    if (moduleKey === 'shiftSwapRequests') appData.shiftRoster = await getAllForCollection('shiftRoster');
    // rebateTerms (Mua Hàng > BAS): cần danh sách NCC để kiểm vendorId có thật + còn ACTIVE không (xem
    // rebateTerms.extraValidate ở lib/createValidation.js) — vendors là dbo.Records, cùng lý do các
    // nhánh cross-lookup ở trên.
    if (moduleKey === 'rebateTerms') appData.vendors = await getAllForCollection('vendors');

    const config = CREATE_MODULE_CONFIGS[moduleKey];
    // Đọc Thùng Rác của ĐÚNG collection này trước khi tạo — validateAndPrepareCreate() dùng để chặn
    // "code" trùng với 1 hồ sơ đã bị xoá trước đó (xem chú thích tham số trashedItems ở hàm đó). Đọc ở
    // đây (ngoài lock chính) vì đây chỉ là lớp phòng vệ bổ sung cho 1 kịch bản hiếm (cố ý dùng lại code
    // cũ sau khi xoá) — không phải điều kiện đua chính mà createForCollection(Serialized) đã khoá chặt
    // cho trường hợp phổ biến (2 người tạo cùng code cùng lúc trong collection ĐANG SỐNG).
    const trashedItems = await getTrashItems(config.dbKey);
    // async — chờ được assertPayloadFileUrlsOwnedByUser() (kiểm DB) SAU khi validateAndPrepareCreate()
    // (đồng bộ) dựng xong payload cuối cùng, TRƯỚC KHI trả về cho createForCollection(Serialized) ghi
    // xuống DB — record giả mạo bị chặn ở đây không bao giờ được ghi. createForCollection()/
    // createForCollectionSerialized() (lib/recordStore.js) đều đã `await builderFn(...)` sẵn, an toàn
    // với builderFn async.
    const builderFn = async (list) => {
      const record = validateAndPrepareCreate(moduleKey, req.body, freshUser, list, appData, trashedItems);
      await assertPayloadFileUrlsOwnedByUser(record, freshUser);
      return record;
    };
    // docs (version mới)/contracts (phụ lục mới): khoá theo ID GỐC của cả "họ" — cùng khoá mà
    // routes/records.js dùng khi XOÁ family này (doc_family:<rootDocId>/contract_family:<rootContractId>)
    // — trước đây tạo version/phụ lục mới chỉ tự kiểm tra root còn tồn tại tại thời điểm đọc mà không
    // khoá gì, có thể đan xen với 1 lượt xoá root đang chạy song song: root bị xoá xong đúng lúc version
    // mới vừa ghi xong với rootDocId trỏ vào id đã không còn tồn tại — mồ côi vĩnh viễn, không xoá/sửa
    // tiếp được (xem đầu file lib/recordActions.js hoặc báo cáo audit). Việc khoá đảm bảo 1 trong 2 phía
    // luôn chờ phía kia hoàn tất trước khi đọc lại trạng thái mới nhất.
    // licenses (phiên bản mới): CÙNG cơ chế/cùng lý do — licenses cũng có versioning theo rootLicenseId
    // (xem licenses.extraValidate ở lib/createValidation.js) nhưng TRƯỚC ĐÂY bị bỏ sót khỏi danh sách
    // này, nên tạo phiên bản mới có thể đan xen với 1 lượt xoá cả họ đang chạy song song -> phiên bản
    // mồ côi (đợt audit chuyên sâu cụm "…/Giấy Phép", mức Trung bình).
    const familyLockKey = moduleKey === 'docs' && req.body?.rootDocId != null ? `doc_family:${req.body.rootDocId}`
      : moduleKey === 'contracts' && req.body?.rootContractId != null ? `contract_family:${req.body.rootContractId}`
      : moduleKey === 'licenses' && req.body?.rootLicenseId != null ? `license_family:${req.body.rootLicenseId}`
      : null;
    // meetings: điều kiện trùng lặp là khoảng thời gian chồng lấn (không diễn đạt được bằng UNIQUE
    // INDEX như Code) — dùng đường khoá nghiêm túc theo phòng họp thay vì createForCollection() thường
    // (xem lib/createValidation.js CREATE_MODULE_CONFIGS.meetings.getLockKey +
    // lib/recordStore.js createForCollectionSerialized).
    // hrProcesses/ONBOARDING (9/2026, theo yêu cầu người dùng): Mã Nhân Viên TỰ SINH ("BL" + số tuần
    // tự, employeeProfile.generateEmployeeCode()) thay vì HR gõ tay — sinh + ĐẶT CHỖ (push ngay 1 hồ sơ
    // DRAFT) TRONG CÙNG 1 khoá employeeProfiles, NGAY TRƯỚC KHI tạo hrProcesses, để 2 request tạo
    // Onboarding gần như cùng lúc không bao giờ nhận trùng mã (xem chú thích generateEmployeeCode()).
    // Ghi thẳng vào req.body.employeeCode — builderFn ở trên đọc req.body qua closure nên vẫn thấy giá
    // trị mới này khi validateAndPrepareCreate() chạy ngay sau đây, không cần đổi gì ở
    // lib/createValidation.js (check "thiếu Mã Nhân Viên" vẫn qua bình thường vì đã có giá trị).
    // Nếu tạo hrProcesses THẤT BẠI ngay sau đó (lỗi field khác) thì hồ sơ DRAFT vừa đặt chỗ trở thành mồ
    // côi (processId=null, không ai dùng mã đó nữa) — chấp nhận được (hiếm, không hỏng dữ liệu, chỉ lãng
    // phí 1 số thứ tự) vì client đã tự kiểm tra các field bắt buộc khác trước khi gửi.
    //
    // NGOẠI LỆ — luồng Tái Tuyển (task Kiểm Tra Nhân Sự Cũ, routes/employeeProfile.js reactivateForRehire()):
    // client CHỦ ĐỘNG gửi kèm employeeCode = mã CŨ của hồ sơ vừa được tái kích hoạt (đã tồn tại sẵn,
    // KHÔNG phải mã mới) — KHÔNG được tự sinh/đặt chỗ đè lên trong trường hợp này, giữ nguyên client gửi.
    //
    // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu cụm Nhân Sự, 10/2026, mức Cao): nhánh "client chủ động gửi
    // employeeCode" ở trên TRƯỚC ĐÂY nhận NGUYÊN chuỗi client gửi, KHÔNG kiểm tra gì — trong khi người
    // tạo Onboarding chỉ cần quyền hrOnboardingManage (KHÔNG cần bất kỳ quyền Hồ Sơ Nhân Sự nào). Hệ quả:
    //   (a) gửi đúng mã của 1 hồ sơ ACTIVE người khác -> quy trình Onboarding mới bám thẳng vào hồ sơ
    //       đang sống đó (hook sau khi tạo GHI ĐÈ processId, và khi quy trình này hoàn tất
    //       applyProcessCompletion() ghi đè cả status hồ sơ) — chiếm/phá hồ sơ người khác mà không có
    //       quyền Hồ Sơ Nhân Sự nào;
    //   (b) gửi 1 mã KHÔNG tồn tại -> quy trình "mồ côi" không hồ sơ nào đi kèm, mọi hook hồ sơ/phép
    //       năm/hợp đồng sau đó im lặng không làm gì.
    // Luồng nghiệp vụ THẬT chỉ có ĐÚNG 2 trường hợp (xem hrLifecycleSection.html + module-hrlifecycle.js):
    //   1. Nhân viên MỚI hoàn toàn -> để TRỐNG, server tự sinh mã + đặt chỗ hồ sơ DRAFT (nhánh dưới);
    //   2. Tái Tuyển -> chọn từ "🔍 Kiểm Tra Nhân Sự Cũ" (GET /api/hr-profile/search-inactive) vốn CHỈ
    //      trả về hồ sơ INACTIVE.
    // Nên mã client gửi lên BẮT BUỘC phải trỏ đúng 1 hồ sơ INACTIVE (tái tuyển), hoặc 1 hồ sơ DRAFT chưa
    // gắn quy trình nào (processId=null — hồ sơ đặt chỗ mồ côi do lượt tạo trước lỗi giữa chừng, xem chú
    // thích ngay trên; cho dùng lại đúng mã đó thay vì bỏ phí).
    const isOnboarding = moduleKey === 'hrProcesses' && req.body?.processType === 'ONBOARDING';
    const clientProvidedEmployeeCode = isOnboarding && req.body?.employeeCode ? String(req.body.employeeCode).trim() : '';
    if (isOnboarding && clientProvidedEmployeeCode) {
      // appData đã đọc sẵn ở đầu handler (getAllAppData()) — employeeProfiles là key AppData thường.
      const existing = (appData.employeeProfiles || []).find(p => p.employeeCode === clientProvidedEmployeeCode);
      if (!existing) {
        return res.status(400).json({ error: `Mã Nhân Viên "${clientProvidedEmployeeCode}" không có trong Hồ Sơ Nhân Sự — để TRỐNG ô Mã Nhân Viên nếu đây là nhân viên mới (hệ thống tự sinh mã), hoặc chọn lại đúng hồ sơ cũ qua "🔍 Kiểm Tra Nhân Sự Cũ"` });
      }
      const reusableDraft = existing.status === 'DRAFT' && existing.processId == null;
      if (existing.status !== 'INACTIVE' && !reusableDraft) {
        return res.status(409).json({ error: `Mã Nhân Viên "${clientProvidedEmployeeCode}" đang gắn với 1 hồ sơ nhân sự khác đang hoạt động — chỉ tạo Onboarding theo mã cũ cho hồ sơ ĐÃ NGHỈ VIỆC (Tái Tuyển). Để trống ô Mã Nhân Viên nếu đây là nhân viên mới.` });
      }
    }
    if (isOnboarding && !clientProvidedEmployeeCode) {
      await withLockedAppDataValue('employeeProfiles', (list) => {
        const arr = Array.isArray(list) ? list : [];
        const code = employeeProfile.generateEmployeeCode(arr);
        req.body.employeeCode = code;
        arr.push(employeeProfile.createDraftProfileForOnboarding(code, freshUser.username, freshUser.name));
        return arr;
      });
    }

    const record = config.getLockKey
      ? await createForCollectionSerialized(config.dbKey, config.getLockKey(req.body, freshUser), builderFn)
      : familyLockKey
      ? await withAppLock(familyLockKey, () => createForCollection(config.dbKey, builderFn))
      : await createForCollection(config.dbKey, builderFn);

    // Tự học loại giấy phép mới vào danh mục gợi ý — xem learnLicenseType() ở đầu file.
    if (moduleKey === 'licenses') await learnLicenseType(record.licenseType);
    // Tự học "Loại Dịch Vụ" mới vào danh mục gợi ý — xem learnItRenewalCategory() ở đầu file.
    if (moduleKey === 'itServiceRenewals') await learnItRenewalCategory(record.category);
    // Onboarding mới tạo (giai đoạn PRE_BOARDING) -> hồ sơ (DRAFT vừa đặt chỗ tự sinh mã, HOẶC hồ sơ vừa
    // được tái kích hoạt qua luồng Tái Tuyển với mã CŨ giữ nguyên — cả 2 trường hợp đều đã tồn tại đúng
    // employeeCode trong employeeProfiles tại đây) -> gắn/ghi đè processId = id hrProcesses vừa tạo xong
    // (chưa biết trước lúc đặt chỗ/tái kích hoạt) — LUÔN ghi đè (không chỉ khi trống) vì Tái Tuyển tạo
    // Onboarding MỚI cho hồ sơ cũ, processId phải trỏ đúng quy trình đang thực hiện HIỆN TẠI, không giữ
    // processId của đợt làm việc trước. Offboarding KHÔNG cần hook ở đây vì hồ sơ chắc chắn đã tồn tại từ
    // Onboarding trước đó.
    if (moduleKey === 'hrProcesses' && record.processType === 'ONBOARDING') {
      await withLockedAppDataValue('employeeProfiles', (list) => {
        const arr = Array.isArray(list) ? list : [];
        const idx = arr.findIndex(p => p.employeeCode === record.employeeCode);
        if (idx !== -1) arr[idx] = { ...arr[idx], processId: record.id };
        return arr;
      });
    }

    // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Trung bình): việc lọc approver theo đúng siêu thị
    // của đơn "Đặt Hàng Tại Siêu Thị" (nay tra từ appData.operationOrderStoreMixedApprovalRules — "Quy
    // Trình Hỗn Hợp", xem lib/workflowEngine.js resolveOperationOrderStoreMixedApprovers(), đã thay hẳn
    // cơ chế cũ filterOperationOrderStoreApprovers()) có thể vô tình lọc RỖNG danh sách duyệt bước 1 nếu
    // admin cấu hình người/chức danh cho bước đó nhưng KHÔNG ai/dòng nào khớp đúng siêu thị vừa đặt hàng
    // (VD quên khai siêu thị đó vào "Siêu Thị Phụ Trách") — hồ sơ vẫn tạo được, rơi vào PENDING, nhưng
    // KHÔNG một người duyệt "thường" nào thấy được
    // để xử lý (chỉ admin bypass mới duyệt được, xem applyWorkflowAction()) — im lặng "treo" vô thời hạn
    // nếu admin không tình cờ phát hiện. Vá bằng cách CẢNH BÁO NGAY khi tạo (không chặn tạo — hồ sơ vẫn
    // hợp lệ, admin vẫn duyệt được bình thường): trả kèm `warning` cho người tạo thấy ngay + ghi 1 dòng
    // Nhật Ký Hệ Thống mức WARNING để admin tra cứu được kể cả khi bỏ lỡ alert lúc tạo.
    //
    // PHÁT HIỆN BỔ SUNG (đợt audit chuyên sâu 12 cụm, mức Trung bình): bản vá đầu chỉ kiểm ĐÚNG BƯỚC
    // HIỆN TẠI (record.currentStep — luôn = 1 lúc vừa tạo), nên 1 quy trình 2-3 bước mà admin quên cấu
    // hình người duyệt cho bước 2/3 vẫn im lặng như cũ: đơn chạy bình thường qua bước 1 rồi mới treo ở
    // bước sau, lúc đó người tạo đã quên hẳn đơn này. Nay quét TẤT CẢ các bước của quy trình áp dụng.
    //
    // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #9): bản vá trên CHỈ kiểm đơn
    // STORE (record.orderLocationType === 'STORE') — đơn HO (thuần theo tier giá trị, KHÔNG có mixed
    // rules) với tier đã chọn mẫu nhưng approvers[step] rỗng vẫn treo vĩnh viễn không hề cảnh báo, vì
    // resolveOperationOrderWorkflow() (lib/workflowEngine.js) xử lý được cả 2 loại như nhau — không có lý
    // do gì để giới hạn cảnh báo chỉ cho STORE. Bỏ điều kiện orderLocationType, áp dụng cho CẢ HO lẫn STORE.
    let warning = null;
    if (moduleKey === 'operationOrders') {
      const resolved = WORKFLOW_MODULE_CONFIGS.operationOrders.resolveWfConfig(record, appData);
      const emptySteps = (resolved?.steps || []).filter(s => !((resolved?.approvers?.[s.order]) || []).length);
      if (emptySteps.length) {
        const stepsLabel = emptySteps.map(s => `Bước ${s.order}${s.name ? ` (${s.name})` : ''}`).join(', ');
        warning = record.orderLocationType === 'STORE'
          ? `Đơn hàng "${record.title}" đã tạo thành công nhưng CHƯA có người duyệt nào khớp đúng siêu thị "${record.dept}" ở ${stepsLabel} của mức giá trị hiện tại — vui lòng báo Quản Trị Viên cấu hình lại Người Duyệt (chỉ Admin duyệt được cho tới khi cấu hình đúng).`
          : `Đơn hàng "${record.title}" đã tạo thành công nhưng CHƯA có người duyệt nào được cấu hình ở ${stepsLabel} của mức giá trị hiện tại (Đặt Hàng Tại HO) — vui lòng báo Quản Trị Viên cấu hình lại Người Duyệt (chỉ Admin duyệt được cho tới khi cấu hình đúng).`;
        await insertSystemLog({
          username: freshUser.username, fullName: freshUser.name, ipAddress: req.ip || '',
          module: 'OPERATION_ORDER', actionType: 'CREATE_NO_APPROVER_WARNING',
          targetObject: record.code || String(record.id),
          description: warning, status: 'WARNING'
        });
      }
    }

    res.json({ ok: true, item: record, warning });
  } catch (err) {
    if (err instanceof CreateError) return res.status(err.status).json({ error: err.message });
    // In đủ err.stack (trước đây chỉ err.message) — lỗi không mong đợi (không phải CreateError/HttpError)
    // rơi vào đây nghĩa là 1 exception THẬT (TypeError/lỗi SQL...), chỉ có .message thường không đủ để
    // tìm ra dòng code gây lỗi, nhất là khi không tái hiện được cục bộ (dữ liệu/trạng thái DB thật khác
    // môi trường test) — xem log PM2 ngay sau khi gặp "Không thể tạo hồ sơ" để tra tiếp.
    console.error(`POST /api/create/${moduleKey} lỗi:`, err.stack || err.message);
    res.status(500).json({ error: 'Không thể tạo hồ sơ' });
  }
});

module.exports = router;
