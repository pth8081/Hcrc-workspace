// server/tests/test-collapse-catalog-accordion.js
//
// Regression test cho đợt "thu gọn danh mục" (10/2026, yêu cầu người dùng): toàn bộ thẻ danh mục ở
// #adminSubCatalog (Hệ Thống > Quản Trị > 🗂️ Quản Lý Danh Mục, server/public/fragments/systemSection.html)
// TRƯỚC ĐÂY hiện mở hết cùng lúc (không có cơ chế thu gọn nào) — giờ mỗi thẻ bọc trong
// <details class="filter-box-details">/<summary> (cùng khuôn ".filter-box-details"/".filter-box-chevron"
// đã có sẵn ở public/app.css, đang dùng cho khối "🔍 Tìm Kiếm & Lọc" ở nhiều fragment khác), mặc định
// ĐÓNG (không có thuộc tính "open"), toggle qua hành vi <details> gốc của trình duyệt — KHÔNG có JS mới
// nào can thiệp cơ chế mở/đóng.
//
// 2 kịch bản theo đúng yêu cầu:
//   (a) Vừa mở sub-tab "Quản Lý Danh Mục" lần đầu -> MỌI <details> trong #adminSubCatalog đều
//       open === false (thu gọn hết, không có ngoại lệ "mở sẵn" nào).
//   (b) Bấm (click DOM thật, không chỉ gán page.evaluate) đúng 1 thẻ bất kỳ ("Vùng Giá Áp Dụng" —
//       DB.priceZones, chọn vì route lưu POST /api/data/priceZones đã có sẵn trong mock chung của
//       testHarness.js) để mở ra -> input/nút "Thêm" bên trong hiện ra THẬT (Playwright coi là visible,
//       không bị <details> đóng che) và vẫn submit được bình thường qua form thật (fill + click nút Thêm
//       thật, không gọi thẳng hàm JS) — tạo bản ghi mới thành công, danh sách tự vẽ lại.
//
// Chạy: node server/tests/test-collapse-catalog-accordion.js
'use strict';
const {
  startStaticServer, createMockState, launchPage, createRunner,
  assert, assertEqual
} = require('./testHarness');

const PORT = 8997;

// totpEnabled:true bắt buộc (xem các test admin khác trong bộ này) — thiếu field này proceedAfterAuth()
// (core.js) rẽ vào openTotpSetupWall() và return sớm, DB.* không được initDatabase() nạp.
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Hỗ Trợ IT', perms: { admin: true }, active: true, totpEnabled: true };

const state = createMockState({
  depts: ['Hỗ Trợ IT'],
  users: [ADMIN],
  priceZones: ['Miền Bắc']
});

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    await loginAs(page, ADMIN);
    await page.evaluate(async () => {
      await switchTab('system');
      setSystemSubTab('ADMIN');
      setAdminSubTab('CATALOG');
    });
    await page.waitForTimeout(150);

    let detailsCount = 0;

    await run.run('(a) #adminSubCatalog có ít nhất vài chục thẻ danh mục, TẤT CẢ đều bọc <details class="filter-box-details"> và ĐÓNG (open=false) ngay khi vừa mở sub-tab lần đầu', async () => {
      const result = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('#adminSubCatalog > details'));
        return {
          total: nodes.length,
          allHaveClass: nodes.every(d => d.classList.contains('filter-box-details')),
          allHaveSummary: nodes.every(d => !!d.querySelector('summary')),
          openCount: nodes.filter(d => d.open).length
        };
      });
      detailsCount = result.total;
      assert(result.total >= 15, `Phải có nhiều thẻ danh mục trực tiếp trong #adminSubCatalog, chỉ thấy ${result.total}`);
      assert(result.allHaveClass, 'Mọi <details> trong #adminSubCatalog phải mang class "filter-box-details" (đúng khuôn CSS thu gọn dùng chung)');
      assert(result.allHaveSummary, 'Mọi <details> trong #adminSubCatalog phải có <summary> con (tiêu đề bấm để mở/đóng)');
      assertEqual(result.openCount, 0, `TẤT CẢ ${result.total} thẻ phải đang ĐÓNG (open=false) ngay khi vừa vào sub-tab lần đầu, nhưng còn ${result.openCount} thẻ mở sẵn`);
    });

    await run.run('(a-đối-chứng) Không có thẻ nào mang thuộc tính HTML "open" tĩnh (markup gốc không tự mở bất kỳ thẻ nào)', async () => {
      const staticOpenCount = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#adminSubCatalog > details[open]')).length
      );
      assertEqual(staticOpenCount, 0, 'Không thẻ danh mục nào được phép có sẵn thuộc tính "open" trong markup');
    });

    await run.run('(b) Nội dung bên trong 1 thẻ ĐANG ĐÓNG (vd input "Vùng Giá Áp Dụng") KHÔNG hiện/visible cho Playwright', async () => {
      const visible = await page.locator('#txtPriceZoneName').isVisible();
      assert(!visible, 'Input #txtPriceZoneName phải KHÔNG visible khi <details> cha còn đóng (đây chính là hành vi gốc của <details>, không phải lỗi)');
    });

    await run.run('(b) Bấm (click DOM thật) đúng 1 thẻ "Vùng Giá Áp Dụng" để MỞ RA -> input/nút "Thêm" bên trong hiện ra thật (visible)', async () => {
      // Bấm vào <summary> (không bấm thẳng <details>) — đúng hành vi người dùng thật: click dòng tiêu đề
      // để toggle, KHÔNG dùng page.evaluate() gán .open = true (tránh né hành vi click gốc của <details>).
      const summary = page.locator('#txtPriceZoneName').locator('xpath=ancestor::details[1]/summary');
      await summary.click();
      const isOpenNow = await page.evaluate(() => document.getElementById('txtPriceZoneName').closest('details').open);
      assert(isOpenNow, 'Bấm vào <summary> phải mở được <details> cha (hành vi gốc của trình duyệt)');
      const visibleAfter = await page.locator('#txtPriceZoneName').isVisible();
      assert(visibleAfter, 'Sau khi bấm mở, input #txtPriceZoneName phải visible thật (Playwright coi là tương tác được)');
      const submitBtnVisible = await page.locator('#txtPriceZoneName ~ button[type="submit"]').isVisible();
      assert(submitBtnVisible, 'Nút "Thêm" (submit) bên trong thẻ vừa mở cũng phải visible');
    });

    await run.run('(b) Submit THẬT (fill input real + click nút "Thêm" real, không gọi thẳng hàm JS) vẫn hoạt động bình thường sau khi thu gọn — thêm được Vùng Giá mới', async () => {
      await page.fill('#txtPriceZoneName', 'Miền Trung (Test Accordion)');
      await page.click('#txtPriceZoneName ~ button[type="submit"]');
      await page.waitForTimeout(200);
      const result = await page.evaluate(() => ({
        priceZones: DB.priceZones.slice(),
        listHtml: document.getElementById('priceZoneList').innerHTML,
        inputValueAfter: document.getElementById('txtPriceZoneName').value
      }));
      assert(result.priceZones.includes('Miền Trung (Test Accordion)'), `DB.priceZones phải có vùng giá mới sau khi submit thật — thực tế: ${JSON.stringify(result.priceZones)}`);
      assert(result.listHtml.includes('Miền Trung (Test Accordion)'), 'Danh sách (renderPriceZoneList) phải tự vẽ lại kèm mục mới ngay trong thẻ vừa mở');
      assertEqual(result.inputValueAfter, '', 'Input phải tự xoá trắng sau khi submit thành công (hành vi gốc của savePriceZone(), không bị ảnh hưởng bởi việc bọc <details>)');
    });

    await run.run('(b) Thẻ vừa mở KHÔNG làm các thẻ khác tự mở theo (mỗi <details> độc lập, không phải accordion loại-trừ-lẫn-nhau)', async () => {
      const result = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('#adminSubCatalog > details'));
        const openOnes = nodes.filter(d => d.open).map(d => d.querySelector('summary')?.textContent.trim());
        return { openCount: openOnes.length, openOnes };
      });
      assertEqual(result.openCount, 1, `Chỉ đúng 1 thẻ (vừa bấm mở) được mở, các thẻ khác phải vẫn đóng — thực tế đang mở: ${JSON.stringify(result.openOnes)}`);
    });

    console.log(`\n(Thông tin) Tổng số thẻ <details class="filter-box-details"> trong #adminSubCatalog: ${detailsCount}`);
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main();
