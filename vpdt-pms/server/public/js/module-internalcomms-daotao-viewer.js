  // loadVendorScript() chuyển sang core.js (Hạ tầng: nạp module theo cụm, đợt 7) — core-devicesecurity.js
  // (WebAuthn, luôn nạp sẵn) cũng gọi thẳng hàm này nên KHÔNG thể để nằm ở 1 module-*.js được nạp lười,
  // xem chú thích ở core.js. File này giữ nguyên phần còn lại (renderWordProtected/renderExcelProtected/...).

  function buildOfficeWatermarkOverlayEl() {
    const wm = document.createElement('div');
    wm.style.cssText = PROTECTED_VIEW_WATERMARK_STYLE;
    wm.textContent = PROTECTED_VIEW_WATERMARK_COMPANY;
    return wm;
  }

  window.renderWordProtected = async function(container, fileSrc) {
    container.innerHTML = '<div class="p-6 text-center text-gray-500 text-sm">⏳ Đang tải bộ xem Word...</div>';
    try {
      await Promise.all([
        loadVendorScript('/vendor/mammoth/mammoth.browser.min.js'),
        loadVendorScript('/vendor/dompurify/purify.min.js')
      ]);
      const res = await fetch(fileSrc);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const arrayBuffer = await res.arrayBuffer();
      const result = await window.mammoth.convertToHtml({ arrayBuffer });

      container.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'relative bg-white shadow-md rounded p-6 max-w-3xl mx-auto my-2 word-view-content';
      wrap.oncontextmenu = () => false;
      // HTML do mammoth sinh ra đọc trực tiếp từ nội dung .docx người dùng tải lên (kể cả href/src) —
      // phải lọc qua DOMPurify trước khi gán innerHTML, không được coi là an toàn mặc định.
      wrap.innerHTML = DOMPurify.sanitize(result.value);
      container.appendChild(wrap);
      wrap.appendChild(buildOfficeWatermarkOverlayEl());
    } catch (err) {
      container.innerHTML = `<div class="p-6 text-center text-red-600 text-sm">⛔ Không xem được file Word này: ${err.message}<br><span class="text-gray-500 text-xs">Có thể do file .doc đời cũ hoặc file bị lỗi — vui lòng dùng nút "⬇️ Tải" để tải về.</span></div>`;
    }
  };

  // "In có watermark" cho file Word (.docx) — CHỈ áp dụng được cho .docx vì mammoth chỉ đọc được OOXML
  // (không đọc được .doc nhị phân đời cũ, nút này bị ẩn với .doc — xem openFileProtectedView()).
  //
  // LỖI ĐÃ VÁ (11/2026, người dùng báo tờ trình/hợp đồng cần in bị lệch/mất nội dung): cách CŨ (mammoth
  // -> html2canvas chụp toàn bộ nội dung thành 1 ảnh dài -> CẮT ẢNH theo chiều cao cố định 1 trang A4 ->
  // ghép từng lát vào PDF bằng jsPDF) cắt ngang nội dung TÙY TIỆN vì chỉ cắt theo PIXEL, không theo đúng
  // ngắt trang thật — bảng/đoạn văn/ảnh có thể bị cắt làm đôi giữa 2 "trang". Đã xác nhận với người dùng
  // 2 phương án thay thế (dùng LibreOffice thật phía server — trung thực 100% nhưng cần cài thêm hạ tầng,
  // hoặc in TRỰC TIẾP qua window.print() của trình duyệt — chữ thật, ngắt trang theo CSS chuẩn của trình
  // duyệt, không còn cắt ảnh tùy tiện, KHÔNG cần cài gì thêm) — người dùng chọn phương án in trực tiếp,
  // chấp nhận đánh đổi còn lại (mammoth docx->HTML vẫn không trung thực 100% layout phức tạp của Word,
  // nhưng không còn lỗi cắt ngang nội dung). Watermark giờ là 1 dòng CHÂN TRANG cố định lặp lại mỗi trang
  // in (CSS position:fixed trong @media print, xem #wordPrintArea ở public/app.css) — giống nguyên tắc
  // "chỉ vẽ đè, không đụng nội dung" đã áp dụng cho watermark PDF gốc (routes/download.js, pdf-lib).
  window.printWordWithWatermark = async function() {
    const info = currentWordPrintFile;
    if (!info || !info.fileSrc) return;
    const btn = document.getElementById('viewModalWordPrintBtn');
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Đang chuẩn bị in...';

    let printArea = null;
    try {
      await Promise.all([
        loadVendorScript('/vendor/mammoth/mammoth.browser.min.js'),
        loadVendorScript('/vendor/dompurify/purify.min.js')
      ]);

      const res = await fetch(info.fileSrc);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const arrayBuffer = await res.arrayBuffer();
      const result = await window.mammoth.convertToHtml({ arrayBuffer });

      printArea = document.createElement('div');
      printArea.id = 'wordPrintArea';
      const content = document.createElement('div');
      content.className = 'word-view-content';
      // Lọc qua DOMPurify trước khi gán innerHTML — xem giải thích ở renderWordProtected() phía trên.
      content.innerHTML = DOMPurify.sanitize(result.value);
      printArea.appendChild(content);
      const wm = document.createElement('div');
      wm.className = 'word-print-watermark';
      wm.textContent = PROTECTED_VIEW_WATERMARK_COMPANY;
      printArea.appendChild(wm);
      document.body.appendChild(printArea);

      // body.word-printing (xem @media print ở app.css) ẩn TOÀN BỘ phần còn lại của trang lúc in — bản
      // in chỉ có đúng nội dung tờ trình + watermark chân trang, không dính sidebar/modal khác.
      document.body.classList.add('word-printing');
      // Khôi phục nút NGAY TRƯỚC khi mở hộp thoại in — từ đây hàm không còn việc bất đồng bộ nào khác,
      // không cần giữ trạng thái "⏳ Đang chuẩn bị..." trong lúc người dùng thao tác hộp thoại in.
      btn.disabled = false;
      btn.innerHTML = originalLabel;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        document.body.classList.remove('word-printing');
        printArea.remove();
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      // Phòng trường hợp trình duyệt không bắn sự kiện 'afterprint' (hiếm gặp) — tự dọn sau 1 khoảng đủ
      // dài để người dùng thao tác xong hộp thoại in, không để #wordPrintArea treo mãi trong DOM.
      setTimeout(cleanup, 60000);
      return;
    } catch (err) {
      alert('⛔ Không chuẩn bị được bản in: ' + err.message);
      if (printArea) printArea.remove();
      document.body.classList.remove('word-printing');
    }
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  };

  window.renderExcelProtected = async function(container, fileSrc) {
    container.innerHTML = '<div class="p-6 text-center text-gray-500 text-sm">⏳ Đang tải bộ xem Excel...</div>';
    try {
      await loadVendorScript('/vendor/exceljs/exceljs.min.js');
      const res = await fetch(fileSrc);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const arrayBuffer = await res.arrayBuffer();
      const wb = new window.ExcelJS.Workbook();
      await wb.xlsx.load(arrayBuffer);

      container.innerHTML = '';
      const outer = document.createElement('div');
      outer.className = 'relative bg-white shadow-md rounded p-3';
      outer.oncontextmenu = () => false;
      container.appendChild(outer);

      const tabBar = document.createElement('div');
      tabBar.className = 'flex gap-1 mb-2 flex-wrap select-none';
      const sheetsWrap = document.createElement('div');
      outer.appendChild(tabBar);
      outer.appendChild(sheetsWrap);

      const cellText = (cell) => {
        let v = cell.value;
        if (v && typeof v === 'object') {
          if (Array.isArray(v.richText)) v = v.richText.map(t => t.text).join('');
          else if (v.result !== undefined) v = v.result;
          else if (v.text !== undefined) v = v.text;
          else v = '';
        }
        return v == null ? '' : String(v);
      };

      function renderSheet(sheet) {
        sheetsWrap.innerHTML = '';
        const table = document.createElement('table');
        table.className = 'text-xs border-collapse';
        sheet.eachRow((row) => {
          const tr = document.createElement('tr');
          row.eachCell({ includeEmpty: true }, (cell) => {
            const td = document.createElement('td');
            td.className = 'border px-2 py-1 whitespace-nowrap';
            td.textContent = cellText(cell);
            tr.appendChild(td);
          });
          table.appendChild(tr);
        });
        const scrollWrap = document.createElement('div');
        scrollWrap.className = 'overflow-auto max-h-[55vh]';
        scrollWrap.appendChild(table);
        sheetsWrap.appendChild(scrollWrap);
      }

      wb.worksheets.forEach((sheet, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'text-xs px-2 py-1 rounded border ' + (i === 0 ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-gray-100 text-gray-700');
        btn.textContent = sheet.name;
        btn.onclick = () => {
          [...tabBar.children].forEach(b => b.className = 'text-xs px-2 py-1 rounded border bg-gray-100 text-gray-700');
          btn.className = 'text-xs px-2 py-1 rounded border bg-emerald-600 text-white border-emerald-600';
          renderSheet(sheet);
        };
        tabBar.appendChild(btn);
      });
      if (wb.worksheets[0]) renderSheet(wb.worksheets[0]);

      outer.appendChild(buildOfficeWatermarkOverlayEl());
    } catch (err) {
      container.innerHTML = `<div class="p-6 text-center text-red-600 text-sm">⛔ Không xem được file Excel này: ${err.message}<br><span class="text-gray-500 text-xs">Có thể do file .xls đời cũ hoặc file bị lỗi — vui lòng dùng nút "⬇️ Tải" để tải về.</span></div>`;
    }
  };
