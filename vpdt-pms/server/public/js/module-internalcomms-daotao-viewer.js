  const _loadedVendorScripts = {};
  function loadVendorScript(src) {
    if (_loadedVendorScripts[src]) return _loadedVendorScripts[src];
    _loadedVendorScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { delete _loadedVendorScripts[src]; reject(new Error('Không tải được thư viện ' + src)); };
      document.head.appendChild(s);
    });
    return _loadedVendorScripts[src];
  }

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

  // ============ ĐỌC NỘI DUNG FILE .pptx TẢI LÊN Ở BÁO CÁO ĐỊNH KỲ (module Điều Hành > Báo Cáo) ============
  // Chuyển 1 file .pptx (ArrayBuffer) thành mảng slide content nhẹ {title, bodyLines, images} — dùng
  // JSZip (đã có sẵn trong node_modules qua exceljs/mammoth, khai báo tường minh ở package.json, tự lưu
  // trên server qua /vendor/jszip cùng lý do với mammoth/exceljs ở trên) để giải nén + DOMParser gốc của
  // trình duyệt để đọc XML (KHÔNG cần thêm thư viện XML riêng). Chỉ đọc được .pptx (OOXML/zip) — KHÔNG
  // đọc được .ppt nhị phân đời cũ, giống hệt giới hạn mammoth với .doc.
  //
  // Bảng/biểu đồ (a:tbl / c:chart) được VẼ LẠI thành ảnh (canvas -> PNG dataURL) chứ không giữ dạng dữ
  // liệu có thể sửa — vẽ lại đơn giản để không cần layout engine đầy đủ (không cần LibreOffice). Text
  // (tiêu đề + đoạn văn bản/bullet) được giữ dạng chuỗi để có thể sửa trực tiếp ở bước Tổng Hợp (xem
  // renderPrAggCompilation()).
  window.parsePptxToSlideContents = async function parsePptxToSlideContents(arrayBuffer) {
    const zip = await window.JSZip.loadAsync(arrayBuffer);

    const readText = async (path) => {
      const f = zip.file(path);
      if (!f) return null;
      return f.async('text');
    };
    const readBase64 = async (path) => {
      const f = zip.file(path);
      if (!f) return null;
      return f.async('base64');
    };
    const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
    // Ghép/normalize đường dẫn tương đối trong .rels (vd "../media/image1.png") theo ĐÚNG thư mục chứa
    // slide (không phải thư mục _rels) — không được nối chuỗi thô kẻo ra sai đường dẫn ("../" phải lùi
    // đúng 1 cấp so với thư mục cha, không phải so với chính nó).
    const resolveZipPath = (baseDir, target) => {
      const parts = baseDir.split('/').filter(Boolean);
      target.split('/').forEach(part => {
        if (part === '..') parts.pop();
        else if (part !== '.' && part !== '') parts.push(part);
      });
      return parts.join('/');
    };
    const firstText = (el, tag) => {
      const nodes = el.getElementsByTagName(tag);
      return nodes.length ? nodes[0].textContent : null;
    };

    // 1. Thứ tự slide THẬT lấy từ presentation.xml (không phải theo tên file slideN.xml, vì thứ tự hiển
    //    thị có thể khác thứ tự đặt tên file khi 1 slide bị xoá/thêm giữa chừng).
    const presXml = parseXml(await readText('ppt/presentation.xml'));
    const relsXml = parseXml(await readText('ppt/_rels/presentation.xml.rels'));
    const relMap = {};
    Array.from(relsXml.getElementsByTagName('Relationship')).forEach(r => {
      relMap[r.getAttribute('Id')] = r.getAttribute('Target');
    });
    const slideIds = Array.from(presXml.getElementsByTagName('p:sldId'));
    const slidePaths = slideIds.map(sid => {
      const rId = sid.getAttribute('r:id');
      const target = relMap[rId]; // vd "slides/slide3.xml"
      return 'ppt/' + target;
    });

    const mimeByExt = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', emf: 'image/x-emf', wmf: 'image/x-wmf' };

    const drawTableImage = (rows) => {
      const colCount = Math.max(1, ...rows.map(r => r.length));
      const cellW = 160, cellH = 34, pad = 8;
      const canvas = document.createElement('canvas');
      canvas.width = colCount * cellW;
      canvas.height = rows.length * cellH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = '14px Arial, sans-serif';
      ctx.textBaseline = 'middle';
      rows.forEach((row, ri) => {
        row.forEach((cellText, ci) => {
          const x = ci * cellW, y = ri * cellH;
          ctx.strokeStyle = '#cbd5e1';
          ctx.strokeRect(x, y, cellW, cellH);
          if (ri === 0) { ctx.fillStyle = '#f1f5f9'; ctx.fillRect(x, y, cellW, cellH); }
          ctx.fillStyle = '#111827';
          ctx.font = ri === 0 ? 'bold 14px Arial, sans-serif' : '14px Arial, sans-serif';
          const text = String(cellText || '').slice(0, 24);
          ctx.fillText(text, x + pad, y + cellH / 2);
        });
      });
      return canvas.toDataURL('image/png');
    };

    const CHART_COLORS = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];
    const drawChartImage = (chartTitle, chartType, categories, series) => {
      const W = 560, H = 360, marginL = 50, marginB = 40, marginT = 30, marginR = 20;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#111827'; ctx.font = 'bold 15px Arial, sans-serif'; ctx.textAlign = 'center';
      if (chartTitle) ctx.fillText(chartTitle, W / 2, 20);

      const plotW = W - marginL - marginR, plotH = H - marginT - marginB;
      const allVals = series.flatMap(s => s.values).filter(v => typeof v === 'number');
      const maxV = Math.max(1, ...allVals);
      ctx.strokeStyle = '#94a3b8'; ctx.beginPath();
      ctx.moveTo(marginL, marginT); ctx.lineTo(marginL, marginT + plotH); ctx.lineTo(marginL + plotW, marginT + plotH); ctx.stroke();

      if (chartType === 'pie') {
        const vals = series[0]?.values || [];
        const total = vals.reduce((a, b) => a + (b || 0), 0) || 1;
        const cx = marginL + plotW / 2, cy = marginT + plotH / 2, r = Math.min(plotW, plotH) / 2 - 10;
        let angle = -Math.PI / 2;
        vals.forEach((v, i) => {
          const slice = (v / total) * Math.PI * 2;
          ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, angle, angle + slice); ctx.closePath(); ctx.fill();
          angle += slice;
        });
      } else if (chartType === 'line') {
        const stepX = plotW / Math.max(1, categories.length - 1 || 1);
        series.forEach((s, si) => {
          ctx.strokeStyle = CHART_COLORS[si % CHART_COLORS.length]; ctx.lineWidth = 2; ctx.beginPath();
          s.values.forEach((v, i) => {
            const x = marginL + i * stepX, y = marginT + plotH - (v / maxV) * plotH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();
        });
      } else {
        const groupW = plotW / Math.max(1, categories.length);
        const barW = groupW / (series.length + 1);
        series.forEach((s, si) => {
          ctx.fillStyle = CHART_COLORS[si % CHART_COLORS.length];
          s.values.forEach((v, i) => {
            const barH = (v / maxV) * plotH;
            const x = marginL + i * groupW + si * barW + barW * 0.5;
            ctx.fillRect(x, marginT + plotH - barH, barW * 0.8, barH);
          });
        });
      }
      ctx.fillStyle = '#334155'; ctx.font = '11px Arial, sans-serif'; ctx.textAlign = 'center';
      categories.forEach((c, i) => {
        const x = marginL + (plotW / Math.max(1, categories.length)) * (i + 0.5);
        ctx.fillText(String(c).slice(0, 10), x, marginT + plotH + 16);
      });
      return canvas.toDataURL('image/png');
    };

    const parseChartXml = (xmlDoc) => {
      const plotArea = xmlDoc.getElementsByTagName('c:plotArea')[0];
      if (!plotArea) return null;
      let chartType = 'bar';
      if (plotArea.getElementsByTagName('c:pieChart').length) chartType = 'pie';
      else if (plotArea.getElementsByTagName('c:lineChart').length) chartType = 'line';
      else if (plotArea.getElementsByTagName('c:barChart').length) chartType = 'bar';
      const sers = Array.from(xmlDoc.getElementsByTagName('c:ser'));
      let categories = [];
      const series = sers.map(ser => {
        const nameNode = ser.getElementsByTagName('c:tx')[0];
        const name = nameNode ? (firstText(nameNode, 'c:v') || '') : '';
        const catNode = ser.getElementsByTagName('c:cat')[0];
        if (catNode && !categories.length) {
          categories = Array.from(catNode.getElementsByTagName('c:pt')).map(pt => firstText(pt, 'c:v') || '');
        }
        const valNode = ser.getElementsByTagName('c:val')[0];
        const values = valNode ? Array.from(valNode.getElementsByTagName('c:pt')).map(pt => parseFloat(firstText(pt, 'c:v')) || 0) : [];
        return { name, values };
      });
      const titleNode = xmlDoc.getElementsByTagName('c:title')[0];
      const chartTitle = titleNode ? firstText(titleNode, 'a:t') : null;
      return { chartType, categories, series, chartTitle };
    };

    const extractCellText = (tc) => {
      const paras = Array.from(tc.getElementsByTagName('a:p'));
      return paras.map(p => Array.from(p.getElementsByTagName('a:t')).map(t => t.textContent).join('')).join(' ').trim();
    };

    const slides = [];
    for (let idx = 0; idx < slidePaths.length; idx++) {
      const slidePath = slidePaths[idx];
      const slideName = slidePath.split('/').pop();
      const slideRelsPath = `ppt/slides/_rels/${slideName}.rels`;
      const slideXmlText = await readText(slidePath);
      if (!slideXmlText) continue;
      const slideXml = parseXml(slideXmlText);
      const slideRelsText = await readText(slideRelsPath);
      const slideRelMap = {};
      if (slideRelsText) {
        Array.from(parseXml(slideRelsText).getElementsByTagName('Relationship')).forEach(r => {
          slideRelMap[r.getAttribute('Id')] = r.getAttribute('Target');
        });
      }

      const spTree = slideXml.getElementsByTagName('p:spTree')[0];
      let title = '';
      const bodyLines = [];
      const images = [];

      const children = spTree ? Array.from(spTree.childNodes).filter(n => n.nodeType === 1) : [];
      for (const node of children) {
        const tag = node.nodeName;
        if (tag === 'p:sp') {
          const ph = node.getElementsByTagName('p:ph')[0];
          const phType = ph ? ph.getAttribute('type') : null;
          const isTitle = phType === 'title' || phType === 'ctrTitle';
          const paras = Array.from(node.getElementsByTagName('a:p'));
          const lines = paras.map(p => Array.from(p.getElementsByTagName('a:t')).map(t => t.textContent).join('')).filter(l => l.trim().length > 0);
          if (isTitle) {
            title = lines.join(' ').trim() || title;
          } else {
            lines.forEach(l => bodyLines.push(l));
          }
        } else if (tag === 'p:pic') {
          const blip = node.getElementsByTagName('a:blip')[0];
          const embedId = blip ? blip.getAttribute('r:embed') : null;
          const target = embedId ? slideRelMap[embedId] : null;
          if (target) {
            const mediaPath = resolveZipPath('ppt/slides', target);
            const ext = (mediaPath.split('.').pop() || '').toLowerCase();
            const mime = mimeByExt[ext] || 'application/octet-stream';
            const b64 = await readBase64(mediaPath);
            if (b64 && mimeByExt[ext]) images.push({ dataUrl: `data:${mime};base64,${b64}`, kind: 'embedded' });
          }
        } else if (tag === 'p:graphicFrame') {
          const graphicData = node.getElementsByTagName('a:graphicData')[0];
          const uri = graphicData ? graphicData.getAttribute('uri') : '';
          if (uri && uri.endsWith('/table')) {
            const tbl = node.getElementsByTagName('a:tbl')[0];
            if (tbl) {
              const rows = Array.from(tbl.getElementsByTagName('a:tr')).map(tr =>
                Array.from(tr.getElementsByTagName('a:tc')).map(tc => extractCellText(tc))
              );
              if (rows.length) images.push({ dataUrl: drawTableImage(rows), kind: 'table' });
            }
          } else if (uri && uri.endsWith('/chart')) {
            const chartRef = node.getElementsByTagName('c:chart')[0];
            const chartRId = chartRef ? chartRef.getAttribute('r:id') : null;
            const chartTarget = chartRId ? slideRelMap[chartRId] : null;
            if (chartTarget) {
              const chartPath = resolveZipPath('ppt/slides', chartTarget);
              const chartXmlText = await readText(chartPath);
              if (chartXmlText) {
                const parsed = parseChartXml(parseXml(chartXmlText));
                if (parsed && parsed.series.length) {
                  images.push({ dataUrl: drawChartImage(parsed.chartTitle, parsed.chartType, parsed.categories, parsed.series), kind: 'chart' });
                }
              }
            }
          }
        }
      }

      slides.push({ order: idx + 1, title, bodyLines, images });
    }

    return slides;
  };

