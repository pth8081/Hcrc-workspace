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
  // (không đọc được .doc nhị phân đời cũ, nút này bị ẩn với .doc — xem openFileProtectedView()). Do
  // Word không có cách "đóng dấu trực tiếp lên file gốc" như PDF (không có thư viện dựng lại đúng layout
  // Word phía server mà không cần LibreOffice), giải pháp ở đây là DỰNG LẠI nội dung thành PDF mới có
  // watermark: mammoth (docx -> HTML) -> html2canvas (chụp toàn bộ nội dung thành 1 ảnh dài) -> cắt ảnh
  // theo chiều cao 1 trang A4 -> ghép từng lát vào PDF nhiều trang bằng jsPDF (cùng kỹ thuật với
  // downloadPrPdf() ở Báo Cáo Định Kỳ). Chữ watermark được vẽ bằng Canvas 2D (ctx.fillText, đúng font hệ
  // thống, hỗ trợ tiếng Việt có dấu đầy đủ) rồi rasterize CÙNG với ảnh nội dung mỗi trang trước khi
  // addImage — nếu vẽ watermark bằng doc.text() thẳng trong jsPDF thì bị lỗi (font chuẩn của jsPDF chỉ hỗ
  // trợ bảng mã WinAnsi, không có tiếng Việt có dấu). ĐÁNH ĐỔI ĐÃ BÁO TRƯỚC: PDF dựng lại có thể không
  // giống 100% bản Word gốc (ngắt trang có thể lệch vài dòng, không giữ được mọi định dạng phức tạp).
  const WORD_PDF_PAGE_W = 794;  // A4 @ 96dpi (px)
  const WORD_PDF_PAGE_H = 1123;
  const WORD_PDF_MARGIN = 40;
  const WORD_PDF_CAPTURE_SCALE = 2; // nét chữ/ảnh khi in — cũng dùng làm hệ số quy đổi canvas trang <-> canvas nội dung để dán ảnh 1:1, không cần tính lại tỉ lệ.

  window.printWordWithWatermark = async function() {
    const info = currentWordPrintFile;
    if (!info || !info.fileSrc) return;
    const btn = document.getElementById('viewModalWordPrintBtn');
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Đang dựng PDF...';

    const stage = document.createElement('div');
    try {
      await Promise.all([
        loadVendorScript('/vendor/mammoth/mammoth.browser.min.js'),
        loadVendorScript('/vendor/html2canvas/html2canvas.min.js'),
        loadVendorScript('/vendor/jspdf/jspdf.umd.min.js'),
        loadVendorScript('/vendor/dompurify/purify.min.js')
      ]);

      const res = await fetch(info.fileSrc);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const arrayBuffer = await res.arrayBuffer();
      const result = await window.mammoth.convertToHtml({ arrayBuffer });

      const contentWidth = WORD_PDF_PAGE_W - WORD_PDF_MARGIN * 2;
      stage.className = 'word-view-content';
      stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${contentWidth}px;background:#fff;color:#111;box-sizing:border-box;font-family:Arial,'Segoe UI',sans-serif;font-size:14px;line-height:1.5;`;
      // Lọc qua DOMPurify trước khi gán innerHTML — xem giải thích ở renderWordProtected() phía trên.
      stage.innerHTML = DOMPurify.sanitize(result.value);
      document.body.appendChild(stage);

      const imgs = Array.from(stage.querySelectorAll('img'));
      await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = r; })));

      const bigCanvas = await window.html2canvas(stage, { backgroundColor: '#ffffff', scale: WORD_PDF_CAPTURE_SCALE, useCORS: true, logging: false });

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [WORD_PDF_PAGE_W, WORD_PDF_PAGE_H], compress: true });

      const pageCanvasW = WORD_PDF_PAGE_W * WORD_PDF_CAPTURE_SCALE;
      const pageCanvasH = WORD_PDF_PAGE_H * WORD_PDF_CAPTURE_SCALE;
      const marginPx = WORD_PDF_MARGIN * WORD_PDF_CAPTURE_SCALE;
      const sliceH = (WORD_PDF_PAGE_H - WORD_PDF_MARGIN * 2) * WORD_PDF_CAPTURE_SCALE;
      const totalPages = Math.min(300, Math.max(1, Math.ceil(bigCanvas.height / sliceH)));

      for (let i = 0; i < totalPages; i++) {
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = pageCanvasW;
        pageCanvas.height = pageCanvasH;
        const ctx = pageCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvasW, pageCanvasH);

        const thisSliceH = Math.min(sliceH, bigCanvas.height - i * sliceH);
        if (thisSliceH > 0) {
          ctx.drawImage(bigCanvas, 0, i * sliceH, bigCanvas.width, thisSliceH, marginPx, marginPx, bigCanvas.width, thisSliceH);
        }

        ctx.font = `${13 * WORD_PDF_CAPTURE_SCALE}px Arial, "Segoe UI", sans-serif`;
        ctx.fillStyle = 'rgba(110,110,110,0.75)';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(PROTECTED_VIEW_WATERMARK_COMPANY, 14 * WORD_PDF_CAPTURE_SCALE, (WORD_PDF_PAGE_H - 14) * WORD_PDF_CAPTURE_SCALE);

        const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
        if (i > 0) doc.addPage([WORD_PDF_PAGE_W, WORD_PDF_PAGE_H], 'portrait');
        doc.addImage(imgData, 'JPEG', 0, 0, WORD_PDF_PAGE_W, WORD_PDF_PAGE_H);
      }

      const safeName = (info.fileName || 'TaiLieu').replace(/\.docx?$/i, '').replace(/[\\/:*?"<>|]+/g, '_');
      doc.save(`${safeName}_watermark.pdf`);
    } catch (err) {
      alert('⛔ Không tạo được PDF có watermark: ' + err.message);
    } finally {
      stage.remove();
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
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
