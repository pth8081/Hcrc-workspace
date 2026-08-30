// routes/create.js — Bước 2 (phương án C bảo mật): tạo hồ sơ mới đi qua đường có xác minh ở server
// (xem lib/createValidation.js), thay cho POST /api/data/:key chung — trước đây server tin nguyên
// dept/creator client tự gửi, chỉ dựa vào dropdown ĐÃ LỌC SẴN ở giao diện.
const express = require('express');
const router = express.Router();
const { getAllAppData, withLockedAppDataValue } = require('../lib/appData');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { CREATE_MODULE_CONFIGS, CreateError, validateAndPrepareCreate } = require('../lib/createValidation');
const { createForCollection, createForCollectionSerialized, getAllForCollection, withAppLock } = require('../lib/recordStore');

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
    // reportPeriods cần tra cứu chéo sang collection reportSlideTemplates (kiểm tra slideTemplateId
    // client gửi lên có phải mẫu trình chiếu có thật hay không) — cùng lý do, reportSlideTemplates cũng
    // ở dbo.Records, không nằm trong AppData chung.
    if (moduleKey === 'reportPeriods') appData.reportSlideTemplates = await getAllForCollection('reportSlideTemplates');
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

    const config = CREATE_MODULE_CONFIGS[moduleKey];
    const builderFn = (list) => validateAndPrepareCreate(moduleKey, req.body, freshUser, list, appData);
    // docs (version mới)/contracts (phụ lục mới): khoá theo ID GỐC của cả "họ" — cùng khoá mà
    // routes/records.js dùng khi XOÁ family này (doc_family:<rootDocId>/contract_family:<rootContractId>)
    // — trước đây tạo version/phụ lục mới chỉ tự kiểm tra root còn tồn tại tại thời điểm đọc mà không
    // khoá gì, có thể đan xen với 1 lượt xoá root đang chạy song song: root bị xoá xong đúng lúc version
    // mới vừa ghi xong với rootDocId trỏ vào id đã không còn tồn tại — mồ côi vĩnh viễn, không xoá/sửa
    // tiếp được (xem đầu file lib/recordActions.js hoặc báo cáo audit). Việc khoá đảm bảo 1 trong 2 phía
    // luôn chờ phía kia hoàn tất trước khi đọc lại trạng thái mới nhất.
    const familyLockKey = moduleKey === 'docs' && req.body?.rootDocId != null ? `doc_family:${req.body.rootDocId}`
      : moduleKey === 'contracts' && req.body?.rootContractId != null ? `contract_family:${req.body.rootContractId}`
      : null;
    // meetings: điều kiện trùng lặp là khoảng thời gian chồng lấn (không diễn đạt được bằng UNIQUE
    // INDEX như Code) — dùng đường khoá nghiêm túc theo phòng họp thay vì createForCollection() thường
    // (xem lib/createValidation.js CREATE_MODULE_CONFIGS.meetings.getLockKey +
    // lib/recordStore.js createForCollectionSerialized).
    const record = config.getLockKey
      ? await createForCollectionSerialized(config.dbKey, config.getLockKey(req.body, freshUser), builderFn)
      : familyLockKey
      ? await withAppLock(familyLockKey, () => createForCollection(config.dbKey, builderFn))
      : await createForCollection(config.dbKey, builderFn);

    // Tự học loại giấy phép mới vào danh mục gợi ý — xem learnLicenseType() ở đầu file.
    if (moduleKey === 'licenses') await learnLicenseType(record.licenseType);

    res.json({ ok: true, item: record });
  } catch (err) {
    if (err instanceof CreateError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/create/${moduleKey} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể tạo hồ sơ' });
  }
});

module.exports = router;
