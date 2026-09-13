// server/tests/test-itprice-scope-dates.js
//
// Đợt 9/2026 — thêm 3 trường THÔNG TIN (đã xác nhận với người dùng: không giới hạn ai xem/không có xử
// lý tự động nào theo ngày, chỉ để đội Hỗ Trợ IT tự biết mà xử lý) vào form "Phê Duyệt Giá" (Bán Lẻ +
// Bán Buôn dùng CHUNG form, xem module-itsupport-price.js):
//   - "Siêu thị áp dụng": mặc định "Toàn bộ" (mode=ALL), chọn "Khác" (mode=OTHER) bắt buộc >=1 siêu thị
//     hợp lệ (đối chiếu appData.stores — danh mục siêu thị thật).
//   - "Ngày áp dụng" (effectiveDate): luôn bắt buộc, đúng khuôn YYYY-MM-DD.
//   - "Ngày hết hiệu lực": mặc định "Vĩnh viễn" (expiryMode=PERMANENT), chọn "Khác" bắt buộc nhập ngày
//     thật và phải >= effectiveDate.
// Gọi THẲNG validateAndPrepareCreate('itPriceApprovals', ...) — hàm thuần, không đọc DB (lib/createValidation.js).
//
// Chạy: node server/tests/test-itprice-scope-dates.js
'use strict';
const { createRunner, assertEqual } = require('./testHarness');
const { validateAndPrepareCreate } = require('../lib/createValidation');

const DEPT = 'Kinh Doanh';
const GOOD_URL = '/uploads/1717171717171-0123456789abcdef.pdf';
const PRICE_ITEMS = [{ values: { c0: 'Mặt hàng A', c1: '15000' } }];
const IT_USER = { username: 'it1', name: 'Người Đề Xuất Giá', dept: DEPT, perms: { itPriceProposeCreate: true } };
const APP_DATA = { formTemplates: {}, stores: ['Siêu thị A', 'Siêu thị B', 'Siêu thị C'] };

const basePayload = (over) => ({
  dept: DEPT, reason: 'Áp giá đợt 9', priceType: 'RETAIL', effectiveDate: '2026-09-01',
  files: [{ fileUrl: GOOD_URL, fileName: 'bang-gia.xlsx', items: PRICE_ITEMS, columnLabels: [] }],
  ...over
});

function expectHttpError(fn, status, messagePart) {
  let thrown = null;
  try { fn(); } catch (err) { thrown = err; }
  if (!thrown) throw new Error(`Đáng lẽ phải ném lỗi (${status}) nhưng chạy thành công`);
  if (thrown.status !== status) throw new Error(`Sai mã lỗi: mong ${status}, thực tế ${thrown.status} (${thrown.message})`);
  if (messagePart && !String(thrown.message).includes(messagePart)) {
    throw new Error(`Sai nội dung lỗi: mong chứa "${messagePart}", thực tế "${thrown.message}"`);
  }
}

async function main() {
  const run = createRunner();

  await run.run('Siêu thị áp dụng: không gửi storeScope -> mặc định ALL, stores=[]', async () => {
    const rec = validateAndPrepareCreate('itPriceApprovals', basePayload({}), IT_USER, [], APP_DATA);
    assertEqual(rec.storeScope.mode, 'ALL', 'mặc định phải là ALL');
    assertEqual(rec.storeScope.stores.length, 0, 'ALL thì không cần danh sách siêu thị');
  });

  await run.run('Siêu thị áp dụng: mode=OTHER nhưng không chọn siêu thị nào -> 400', async () => {
    expectHttpError(() => validateAndPrepareCreate('itPriceApprovals',
      basePayload({ storeScope: { mode: 'OTHER', stores: [] } }), IT_USER, [], APP_DATA),
      400, 'Vui lòng chọn ít nhất 1 siêu thị');
  });

  await run.run('Siêu thị áp dụng: mode=OTHER với siêu thị KHÔNG có thật trong danh mục -> bị lọc bỏ, còn lại rỗng -> 400', async () => {
    expectHttpError(() => validateAndPrepareCreate('itPriceApprovals',
      basePayload({ storeScope: { mode: 'OTHER', stores: ['Siêu thị Giả Mạo'] } }), IT_USER, [], APP_DATA),
      400, 'Vui lòng chọn ít nhất 1 siêu thị');
  });

  await run.run('Siêu thị áp dụng: mode=OTHER với 2 siêu thị hợp lệ (+ 1 trùng lặp) -> giữ đúng 2, khử trùng lặp', async () => {
    const rec = validateAndPrepareCreate('itPriceApprovals',
      basePayload({ storeScope: { mode: 'OTHER', stores: ['Siêu thị A', 'Siêu thị B', 'Siêu thị A'] } }),
      IT_USER, [], APP_DATA);
    assertEqual(rec.storeScope.mode, 'OTHER', 'phải giữ đúng mode OTHER');
    assertEqual(JSON.stringify([...rec.storeScope.stores].sort()), JSON.stringify(['Siêu thị A', 'Siêu thị B']), 'phải khử trùng lặp, chỉ giữ 2 siêu thị hợp lệ');
  });

  await run.run('Ngày áp dụng: thiếu effectiveDate -> 400', async () => {
    expectHttpError(() => validateAndPrepareCreate('itPriceApprovals',
      basePayload({ effectiveDate: '' }), IT_USER, [], APP_DATA), 400, 'Ngày Áp Dụng');
  });

  await run.run('Ngày áp dụng: sai định dạng -> 400', async () => {
    expectHttpError(() => validateAndPrepareCreate('itPriceApprovals',
      basePayload({ effectiveDate: '01/09/2026' }), IT_USER, [], APP_DATA), 400, 'Ngày Áp Dụng');
  });

  await run.run('Ngày hết hiệu lực: không gửi gì -> mặc định PERMANENT (Vĩnh viễn), expiryDate=null', async () => {
    const rec = validateAndPrepareCreate('itPriceApprovals', basePayload({}), IT_USER, [], APP_DATA);
    assertEqual(rec.expiryMode, 'PERMANENT', 'mặc định phải là Vĩnh viễn');
    assertEqual(rec.expiryDate, null, 'Vĩnh viễn thì không có ngày hết hiệu lực');
  });

  await run.run('Ngày hết hiệu lực: expiryMode=OTHER nhưng thiếu expiryDate -> 400', async () => {
    expectHttpError(() => validateAndPrepareCreate('itPriceApprovals',
      basePayload({ expiryMode: 'OTHER' }), IT_USER, [], APP_DATA), 400, 'Ngày Hết Hiệu Lực');
  });

  await run.run('Ngày hết hiệu lực: expiryDate SỚM HƠN effectiveDate -> 400', async () => {
    expectHttpError(() => validateAndPrepareCreate('itPriceApprovals',
      basePayload({ effectiveDate: '2026-09-10', expiryMode: 'OTHER', expiryDate: '2026-09-01' }), IT_USER, [], APP_DATA),
      400, 'Ngày Hết Hiệu Lực phải từ Ngày Áp Dụng trở đi');
  });

  await run.run('Ngày hết hiệu lực: expiryDate ĐÚNG bằng effectiveDate -> hợp lệ (biên đúng, không bị chặn oan)', async () => {
    const rec = validateAndPrepareCreate('itPriceApprovals',
      basePayload({ effectiveDate: '2026-09-10', expiryMode: 'OTHER', expiryDate: '2026-09-10' }), IT_USER, [], APP_DATA);
    assertEqual(rec.expiryDate, '2026-09-10', 'phải chấp nhận đúng bằng effectiveDate');
  });

  await run.run('Ngày hết hiệu lực: expiryDate SAU effectiveDate -> hợp lệ bình thường', async () => {
    const rec = validateAndPrepareCreate('itPriceApprovals',
      basePayload({ expiryMode: 'OTHER', expiryDate: '2026-12-31' }), IT_USER, [], APP_DATA);
    assertEqual(rec.expiryMode, 'OTHER', 'phải giữ đúng mode OTHER');
    assertEqual(rec.expiryDate, '2026-12-31', 'phải giữ đúng ngày hết hiệu lực đã nhập');
  });

  await run.run('WHOLESALE + Siêu thị áp dụng + ngày hết hiệu lực đều hợp lệ cùng lúc (không cross-contaminate)', async () => {
    const rec = validateAndPrepareCreate('itPriceApprovals',
      basePayload({
        priceType: 'WHOLESALE', priceTier: 'MARGIN_LT5',
        storeScope: { mode: 'OTHER', stores: ['Siêu thị C'] },
        expiryMode: 'OTHER', expiryDate: '2027-01-01'
      }), IT_USER, [], APP_DATA);
    assertEqual(rec.priceTier, 'MARGIN_LT5', 'không bị field mới làm hỏng luồng Bán Buôn cũ');
    assertEqual(rec.storeScope.stores[0], 'Siêu thị C', 'store scope vẫn đúng');
    assertEqual(rec.expiryDate, '2027-01-01', 'expiry vẫn đúng');
  });

  run.summary();
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
