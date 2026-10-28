// lib/minutesDocx.js — Sinh file .docx từ 1 bản ghi meetingMinutes, dùng để ĐÍNH KÈM vào email thông
// báo Biên Bản Họp (11/2026, yêu cầu người dùng: "đính kèm nội dung bằng file docx để đối tác bên
// ngoài không có tài khoản sẽ xem được" — khác link truy cập trong email, vốn chỉ dùng được cho người
// CÓ tài khoản hệ thống). Bố cục mirror ĐÚNG bản "Tải — In" đang có ở client
// (buildMeetingMinutesDocumentHTML(), public/js/module-bienbanhop.js) — tiêu đề/mã/thời gian/địa điểm/
// chủ trì/thư ký/thành phần tham dự + nội dung trao đổi/kết luận.
//
// m.content là HTML đã qua CẢ 2 lớp sanitize (server: normalizeMeetingMinutesContent()/sanitize-html,
// client: DOMPurify trước khi hiển thị) — CHỈ còn đúng 10 tag, KHÔNG thuộc tính nào:
// b/strong/i/em/u/ul/ol/li/br/p (xem MEETING_MINUTES_CONTENT_ALLOWED_TAGS ở lib/createValidation.js).
// Nhờ tập tag cố định + không thuộc tính này, tự viết 1 parser nhỏ ngay dưới thay vì thêm 1 dependency
// HTML parser mới — "docx" là dependency DUY NHẤT thêm cho tính năng này.
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, LevelFormat, HeadingLevel
} = require('docx');

function decodeEntities(str) {
  return String(str || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Tách HTML (chỉ gồm tag không thuộc tính) thành token {type:'tag', tag, closing} | {type:'text', value}.
function tokenizeHtml(html) {
  const tokens = [];
  const re = /<\/?([a-zA-Z]+)\s*\/?>/g;
  let last = 0, match;
  while ((match = re.exec(html))) {
    if (match.index > last) tokens.push({ type: 'text', value: html.slice(last, match.index) });
    tokens.push({ type: 'tag', tag: match[1].toLowerCase(), closing: match[0][1] === '/' });
    last = re.lastIndex;
  }
  if (last < html.length) tokens.push({ type: 'text', value: html.slice(last) });
  return tokens;
}

const INLINE_MARK_KEYS = { b: 'bold', strong: 'bold', i: 'italics', em: 'italics', u: 'underline' };

// Dựng danh sách TextRun từ 1 đoạn token NỘI TUYẾN (không chứa p/ul/ol/li) — theo dõi độ sâu lồng
// bold/italics/underline hiện tại (dùng số đếm, không phải boolean, để xử lý đúng lồng nhau kiểu
// <b>A<i>B</i>C</b> không bị tắt "bold" khi gặp </i>), <br> ngắt dòng NGAY TRONG 1 Paragraph (TextRun
// break:1) — khác <p> mới (Paragraph riêng).
function buildRunsFromInlineHtml(html) {
  const runs = [];
  const depth = { bold: 0, italics: 0, underline: 0 };
  for (const t of tokenizeHtml(html)) {
    if (t.type === 'tag') {
      if (t.tag === 'br') { runs.push(new TextRun({ text: '', break: 1 })); continue; }
      const key = INLINE_MARK_KEYS[t.tag];
      if (key) depth[key] += t.closing ? -1 : 1;
      continue;
    }
    const text = decodeEntities(t.value).replace(/[ \t\r\n]+/g, ' ');
    if (!text) continue;
    runs.push(new TextRun({
      text,
      bold: depth.bold > 0,
      italics: depth.italics > 0,
      underline: depth.underline > 0 ? {} : undefined
    }));
  }
  return runs;
}

// Dựng danh sách Paragraph từ toàn bộ m.content — chia theo khối <p>/<ul>/<ol>, phần nội tuyến còn sót
// ngoài mọi khối (trình soạn thảo không tự bọc <p> trong 1 số trường hợp trình duyệt) được coi như 1
// đoạn văn thường.
function buildParagraphsFromContentHtml(html, numberingRef) {
  const paragraphs = [];
  const re = /<(p|ul|ol)>([\s\S]*?)<\/\1>/g;
  let last = 0, match;
  const flushLoose = (segment) => {
    const trimmed = segment.replace(/^\s+|\s+$/g, '');
    if (!trimmed) return;
    const runs = buildRunsFromInlineHtml(trimmed);
    if (runs.length) paragraphs.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
  };
  while ((match = re.exec(html))) {
    flushLoose(html.slice(last, match.index));
    const [, tagName, inner] = match;
    if (tagName === 'p') {
      const runs = buildRunsFromInlineHtml(inner);
      paragraphs.push(new Paragraph({ children: runs.length ? runs : [new TextRun({ text: '' })], spacing: { after: 120 } }));
    } else {
      // LỖI ĐÃ VÁ (tự kiểm tra qua render PDF trước khi báo cáo xong): docx KHÔNG cho Paragraph có CẢ
      // "numbering" LẪN "bullet" cùng lúc — chỉ "numbering" thắng, khiến <ul> (gạch đầu dòng) bị đánh số
      // 1/2/3 tiếp nối luôn với <ol> (đánh số) ngay sau đó thay vì có dấu chấm riêng. Tách hẳn 2 nhánh:
      // <ul> dùng "bullet" (docx tự có bullet mặc định, không cần khai numbering riêng), <ol> dùng
      // "numbering" (numberingRef khai ở Document.numbering, xem buildMeetingMinutesDocxBuffer()).
      const liRe = /<li>([\s\S]*?)<\/li>/g;
      let liMatch;
      while ((liMatch = liRe.exec(inner))) {
        const runs = buildRunsFromInlineHtml(liMatch[1]);
        const children = runs.length ? runs : [new TextRun({ text: '' })];
        paragraphs.push(tagName === 'ul'
          ? new Paragraph({ children, bullet: { level: 0 } })
          : new Paragraph({ children, numbering: { reference: numberingRef, level: 0 } }));
      }
    }
    last = re.lastIndex;
  }
  flushLoose(html.slice(last));
  if (!paragraphs.length) paragraphs.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
  return paragraphs;
}

function metaRow(label, value) {
  const cellOpts = { borders: NO_BORDER };
  return new TableRow({
    children: [
      new TableCell({ width: { size: 22, type: WidthType.PERCENTAGE }, ...cellOpts,
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })] }),
      new TableCell({ width: { size: 78, type: WidthType.PERCENTAGE }, ...cellOpts,
        children: [new Paragraph({ children: [new TextRun({ text: String(value || '') })] })] })
    ]
  });
}

const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
};
const THIN_BORDER_SIDE = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const THIN_BORDER = { top: THIN_BORDER_SIDE, bottom: THIN_BORDER_SIDE, left: THIN_BORDER_SIDE, right: THIN_BORDER_SIDE };

function formatVnDateTime(iso) {
  if (!iso) return '(chưa có)';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('vi-VN');
}

// Hàm chính — trả về Buffer .docx (dùng thẳng cho attachments.content của nodemailer/Graph API, hoặc
// base64 cho EWS). Nhận "m" là bản ghi meetingMinutes ĐÃ qua canViewMeetingMinutes()/canView*Record()
// phía nơi gọi (hàm này không tự kiểm quyền — chỉ sinh file từ dữ liệu được truyền vào).
async function buildMeetingMinutesDocxBuffer(m) {
  const numberingRef = 'minutesOl';
  const attendeesRows = (m.attendees || []).map(a => new TableRow({
    children: [
      new TableCell({ borders: THIN_BORDER, children: [new Paragraph(String(a?.name || ''))] }),
      new TableCell({ borders: THIN_BORDER, children: [new Paragraph(String(a?.title || ''))] }),
      new TableCell({ borders: THIN_BORDER, children: [new Paragraph(String(a?.dept || ''))] })
    ]
  }));
  const attendeesTable = attendeesRows.length
    ? new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: [
            new TableCell({ borders: THIN_BORDER, children: [new Paragraph({ children: [new TextRun({ text: 'Họ Tên', bold: true })] })] }),
            new TableCell({ borders: THIN_BORDER, children: [new Paragraph({ children: [new TextRun({ text: 'Chức Danh', bold: true })] })] }),
            new TableCell({ borders: THIN_BORDER, children: [new Paragraph({ children: [new TextRun({ text: 'Phòng Ban', bold: true })] })] })
          ] }),
          ...attendeesRows
        ]
      })
    : new Paragraph({ children: [new TextRun({ text: '(Không có thành phần tham dự)', italics: true })] });

  // Hồ sơ TRƯỚC v28.36 (chưa có editor rich-text) không có contentFormat='html' — content là VĂN BẢN
  // THƯỜNG (xem normalizeMeetingMinutesContent() ở lib/createValidation.js, chỉ sanitize khi
  // contentFormat === 'html'). Tách theo dòng để giữ đúng ngắt dòng gốc, không chạy qua parser HTML
  // (tránh hiểu nhầm ký tự '<'/'>' người dùng gõ tay thành tag).
  const contentParagraphs = m.contentFormat === 'html'
    ? buildParagraphsFromContentHtml(String(m.content || ''), numberingRef)
    : String(m.content || '').split(/\r?\n/).map(line => new Paragraph({ children: [new TextRun({ text: line })], spacing: { after: 120 } }));

  const doc = new Document({
    numbering: {
      config: [{
        reference: numberingRef,
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }]
      }]
    },
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'BIÊN BẢN HỌP' })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
          children: [new TextRun({ text: String(m.title || ''), bold: true, size: 28 })] }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
          metaRow('Mã biên bản:', m.code),
          metaRow('Thời gian:', formatVnDateTime(m.time)),
          metaRow('Địa điểm:', m.location),
          metaRow('Chủ trì:', m.chair),
          metaRow('Thư ký:', m.secretary)
        ] }),
        new Paragraph({ spacing: { before: 200, after: 100 }, children: [new TextRun({ text: 'Thành Phần Tham Dự', bold: true, size: 26 })] }),
        attendeesTable,
        new Paragraph({ spacing: { before: 200, after: 100 }, children: [new TextRun({ text: 'Nội Dung Trao Đổi / Kết Luận', bold: true, size: 26 })] }),
        ...contentParagraphs
      ]
    }]
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildMeetingMinutesDocxBuffer };
