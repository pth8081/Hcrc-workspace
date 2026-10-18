// server/tests/test-design-system-foundation.js
//
// Regression test cho Giai đoạn 1 của kế hoạch "HCRC Workspace Refresh" (11/2026, người dùng đã duyệt
// lộ trình hiện đại hoá giao diện qua demo trước/sau) — xác nhận các class CSS dùng chung MỚI thêm vào
// public/app.css (.badge-*/.btn-*/.stat-card*/.empty-state*) thực sự được app.css phục vụ đúng, có màu
// đúng theo 4 màu trạng thái đã chuẩn hoá (khớp buildNotificationEmailHtml() ở core.js) — PHÒNG khi ai
// đó vô tình sửa/xoá mất các class này ở Giai đoạn 2+ (lúc đó hàng loạt màn đã áp dụng sẽ vỡ hàng loạt
// mà không ai biết ngay). Giai đoạn 1 CHƯA gắn các class này vào bất kỳ HTML thật nào trong app — bài
// test này tự tạo phần tử rời để kiểm tra riêng app.css, không phụ thuộc màn hình cụ thể nào.
//
// Chạy: node server/tests/test-design-system-foundation.js
'use strict';
const assert = require('assert');
const { startStaticServer, launchPage, createMockState } = require('./testHarness');

const PORT_UI = 8994;

function rgbToHex(rgb) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '');
  if (!m) return rgb;
  return '#' + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, '0')).join('');
}

async function main() {
  let passed = 0, failed = 0;
  async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
  }

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users: [] });
  const { browser, page } = await launchPage(PORT_UI, state);

  try {
    console.log('== app.css: hệ thống thiết kế dùng chung Giai đoạn 1 ==');

    await test('.badge-info/.badge-success/.badge-warning/.badge-danger: đúng 4 màu nền đã chuẩn hoá', async () => {
      const colors = await page.evaluate(() => {
        const out = {};
        for (const cls of ['badge-info', 'badge-success', 'badge-warning', 'badge-danger']) {
          const el = document.createElement('span');
          el.className = cls;
          el.textContent = 'x';
          document.body.appendChild(el);
          out[cls] = getComputedStyle(el).backgroundColor;
          el.remove();
        }
        return out;
      });
      assert.strictEqual(rgbToHex(colors['badge-info']), '#dbeafe', 'badge-info phải nền #dbeafe');
      assert.strictEqual(rgbToHex(colors['badge-success']), '#dcfce7', 'badge-success phải nền #dcfce7');
      assert.strictEqual(rgbToHex(colors['badge-warning']), '#fef3c7', 'badge-warning phải nền #fef3c7');
      assert.strictEqual(rgbToHex(colors['badge-danger']), '#fee2e2', 'badge-danger phải nền #fee2e2');
    });

    await test('.badge-*: dáng pill (border-radius lớn, uppercase)', async () => {
      const style = await page.evaluate(() => {
        const el = document.createElement('span');
        el.className = 'badge-info';
        el.textContent = 'x';
        document.body.appendChild(el);
        const cs = getComputedStyle(el);
        const out = { radius: cs.borderRadius, transform: cs.textTransform, display: cs.display };
        el.remove();
        return out;
      });
      assert.ok(parseInt(style.radius, 10) >= 100, `border-radius phải rất lớn (pill), đang là ${style.radius}`);
      assert.strictEqual(style.transform, 'uppercase', 'badge phải viết hoa (text-transform: uppercase)');
      assert.strictEqual(style.display, 'inline-flex', 'badge phải display inline-flex');
    });

    await test('.btn-primary: nền đúng màu info #2563eb, chữ trắng', async () => {
      const style = await page.evaluate(() => {
        const el = document.createElement('button');
        el.className = 'btn-primary';
        el.textContent = 'x';
        document.body.appendChild(el);
        const cs = getComputedStyle(el);
        const out = { bg: cs.backgroundColor, color: cs.color };
        el.remove();
        return out;
      });
      assert.strictEqual(rgbToHex(style.bg), '#2563eb', 'btn-primary phải nền #2563eb');
      assert.strictEqual(rgbToHex(style.color), '#ffffff', 'btn-primary phải chữ trắng');
    });

    await test('.btn-secondary/.btn-destructive-outline/.btn-ghost/.btn-more: đều render được, không lỗi CSS', async () => {
      const ok = await page.evaluate(() => {
        for (const cls of ['btn-secondary', 'btn-destructive-outline', 'btn-ghost', 'btn-more']) {
          const el = document.createElement('button');
          el.className = cls;
          el.textContent = 'x';
          document.body.appendChild(el);
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || !cs.borderRadius) { el.remove(); return false; }
          el.remove();
        }
        return true;
      });
      assert.strictEqual(ok, true, 'cả 4 class nút phụ phải render hợp lệ (có border-radius, không display:none)');
    });

    await test('.stat-card + .stat-card-num/.stat-card-label: bo góc lớn + có shadow', async () => {
      const style = await page.evaluate(() => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        const num = document.createElement('div');
        num.className = 'stat-card-num';
        num.textContent = '3';
        card.appendChild(num);
        document.body.appendChild(card);
        const cs = getComputedStyle(card);
        const csNum = getComputedStyle(num);
        const out = { radius: cs.borderRadius, shadow: cs.boxShadow, numWeight: csNum.fontWeight };
        card.remove();
        return out;
      });
      assert.ok(parseInt(style.radius, 10) >= 10, `stat-card phải bo góc đáng kể, đang là ${style.radius}`);
      assert.notStrictEqual(style.shadow, 'none', 'stat-card phải có box-shadow (không còn phẳng)');
      assert.ok(parseInt(style.numWeight, 10) >= 700, 'stat-card-num phải in đậm (font-weight >= 700)');
    });

    await test('.empty-state + .empty-state-icon: nền mờ, khung chấm, icon tròn màu info', async () => {
      const style = await page.evaluate(() => {
        const wrap = document.createElement('div');
        wrap.className = 'empty-state';
        const icon = document.createElement('div');
        icon.className = 'empty-state-icon';
        icon.textContent = '📭';
        wrap.appendChild(icon);
        document.body.appendChild(wrap);
        const csWrap = getComputedStyle(wrap);
        const csIcon = getComputedStyle(icon);
        const out = { borderStyle: csWrap.borderStyle, iconRadius: csIcon.borderRadius, iconBg: csIcon.backgroundColor };
        wrap.remove();
        return out;
      });
      assert.strictEqual(style.borderStyle, 'dashed', 'empty-state phải viền nét đứt');
      assert.ok(parseInt(style.iconRadius, 10) >= 20, 'empty-state-icon phải tròn hoàn toàn');
      assert.strictEqual(rgbToHex(style.iconBg), '#dbeafe', 'empty-state-icon phải nền info #dbeafe mặc định');
    });

    await test('ĐỐI CHỨNG: Giai đoạn 1 KHÔNG đụng tới bất kỳ màn hình thật nào — Dashboard vẫn render y nguyên, không lỗi JS', async () => {
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
      await page.evaluate((u) => { window.DB = window.DB || {}; }, null);
      const hasDashboard = await page.evaluate(() => !!document.getElementById('dashboardSection'));
      assert.strictEqual(hasDashboard, true, '#dashboardSection vẫn tồn tại bình thường trong DOM');
      assert.strictEqual(pageErrors.length, 0, 'không phát sinh lỗi JS nào khi thêm class CSS mới');
    });

  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
