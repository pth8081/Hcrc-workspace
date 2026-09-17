// Module "📘 Nghiệp Vụ" — màn tài liệu tham khảo TRỰC QUAN (sơ đồ quy trình + diễn giải) cho toàn bộ
// nghiệp vụ của hệ thống, KHÔNG tạo/lưu hồ sơ riêng. Nav tree nhóm theo đúng cách người dùng vận hành
// thực tế (Văn Bản & Tác Nghiệp / Truyền Thông Nội Bộ / Điều Hành / Hành Chính / Tổng Hợp / Vận Hành /
// Nhân Sự / Hỗ Trợ IT) — khác thứ tự phẳng của BUSINESS_MODULES (core.js) vì đây là nhóm TRÌNH BÀY cho
// người đọc, không phải nhóm phân quyền. Nội dung (NGHIEP_VU_DOCS) do dev/Claude biên soạn thủ công —
// xem CLAUDE.md mục "Module mới → bắt buộc cập nhật Nghiệp Vụ": bất kỳ module/tính năng nghiệp vụ mới
// nào PHẢI thêm 1 entry vào registry này trong CÙNG đợt merge. Mục nào chưa có entry sẽ tự hiện cảnh báo
// "⚠️ Chưa có tài liệu nghiệp vụ" thay vì im lặng thiếu sót — xem renderNghiepVuContent().

const NGHIEP_VU_NAV = [
  { group: 'Văn Bản & Tác Nghiệp', items: [
    { key: 'doc', icon: '📄', label: 'Tài Liệu' },
    { key: 'submission', icon: '📜', label: 'Văn Bản Trình / Tờ Trình' },
    { key: 'contract', icon: '📁', label: 'Hợp Đồng' },
  ]},
  { group: 'Truyền Thông Nội Bộ', items: [
    { key: 'daotao', icon: '🎓', label: 'Đào Tạo' },
  ]},
  { group: 'Điều Hành', items: [
    { key: 'minutes', icon: '📝', label: 'Biên Bản Họp' },
    { key: 'task', icon: '📋', label: 'Công Việc' },
    { key: 'periodicReport', icon: '📅', label: 'Báo Cáo Định Kỳ' },
  ]},
  { group: 'Hành Chính', items: [
    { key: 'meeting', icon: '📅', label: 'Đặt Phòng Họp' },
    { key: 'car', icon: '🚗', label: 'Đăng Ký Xe' },
    { key: 'vpp', icon: '🖇️', label: 'Văn Phòng Phẩm' },
    { key: 'uniform', icon: '👕', label: 'Đồng Phục' },
    { key: 'license', icon: '🔑', label: 'Bản Quyền Phần Mềm' },
  ]},
  { group: 'Tổng Hợp', items: [
    { key: 'office', icon: '🛒', label: 'Mua Bán / Sửa Chữa / Thanh Toán' },
    { key: 'budget', icon: '💰', label: 'Ngân Sách 2.0' },
  ]},
  { group: 'QLDA', items: [
    { key: 'vanHanh', icon: '📦', label: 'Đơn Hàng & Mở Mới/Sửa Chữa Siêu Thị' },
    { key: 'checklist', icon: '✅', label: 'Checklist Đánh Giá Siêu Thị' },
  ]},
  { group: 'Nhân Sự', items: [
    { key: 'orgChart', icon: '🗂️', label: 'Cơ Cấu Tổ Chức' },
    { key: 'hrLifecycle', icon: '🆕', label: 'Onboarding / Offboarding' },
    { key: 'hrProfile', icon: '👤', label: 'Hồ Sơ Nhân Sự' },
    { key: 'hrContract', icon: '📄', label: 'Hợp Đồng Lao Động' },
    { key: 'hrReport', icon: '📊', label: 'Báo Cáo' },
    { key: 'hrAttendance', icon: '🕒', label: 'Công / Phép' },
    { key: 'hrPayroll', icon: '💴', label: 'Lương' },
    { key: 'hr', icon: '🤝', label: 'Phản Hồi Ý Kiến (HCRC Đồng Hành)' },
  ]},
  { group: 'Hỗ Trợ IT', items: [
    { key: 'itSupport', icon: '🎫', label: 'Hỗ Trợ Yêu Cầu (Ticket)' },
    { key: 'itPriceApproval', icon: '🏷️', label: 'Phê Duyệt Giá Bán (Bán Lẻ / Bán Buôn)' },
  ]},
];

// ===================== SVG flow renderer (dùng chung, không phụ thuộc thư viện ngoài) =====================
// Phong cách tham khảo theo ảnh người dùng gửi: node bo góc, mũi tên có hướng, khung tham chiếu nét đứt
// nối vào luồng bằng mũi tên nét đứt (nhãn "tham chiếu"), node quyết định viền xanh nổi bật rẽ 2 nhánh
// màu (xanh = duyệt tiếp, đỏ = từ chối), mũi tên vòng lặp cong quay lại bước trước đó khi bị từ chối.

function nvArrowMarker(id, color) {
  return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`;
}

// Bọc dòng chú thích phụ (sub) tối đa 2 dòng theo bề rộng node — sửa lỗi thật: trước đây sub luôn vẽ
// 1 dòng duy nhất, chú thích dài (VD "Duyệt theo cấu hình từng phòng ban") tràn hẳn ra ngoài khung node
// đè lên mũi tên/node bên cạnh, đúng lỗi "hình vẽ xấu" người dùng phản ánh.
function nvWrapLines(text, maxChars) {
  if (!text) return [];
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) {
    lines[1] = lines[1].slice(0, Math.max(0, maxChars - 1)).replace(/\s+\S*$/, '') + '…';
    return lines.slice(0, 2);
  }
  return lines;
}

function nvRoundedNode(x, y, w, h, opts) {
  const { label, sub, kind } = opts;
  let stroke = '#d1d5db', fill = '#ffffff';
  if (kind === 'decision') { stroke = '#2563eb'; fill = '#eff6ff'; }
  if (kind === 'approved') { stroke = '#86efac'; fill = '#f0fdf4'; }
  if (kind === 'rejected') { stroke = '#fca5a5'; fill = '#fef2f2'; }
  if (kind === 'reference') { stroke = '#9ca3af'; fill = '#f9fafb'; }
  if (kind === 'hub') { stroke = '#7c3aed'; fill = '#f5f3ff'; }
  if (kind === 'actor') { stroke = '#d97706'; fill = '#fffbeb'; }
  const dash = kind === 'reference' ? ' stroke-dasharray="5,4"' : '';
  const sw = (kind === 'decision' || kind === 'hub') ? 2.5 : 1.5;
  const subLines = nvWrapLines(sub, Math.floor((w - 14) / 6.1));
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
  const labelY = subLines.length ? y + h / 2 - (subLines.length > 1 ? 10 : 6) : y + h / 2 + 1;
  out += `<text x="${x + w / 2}" y="${labelY}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#111827">${escapeHtml(label)}</text>`;
  subLines.forEach((line, i) => {
    out += `<text x="${x + w / 2}" y="${y + h / 2 + 13 + i * 13}" text-anchor="middle" font-size="10" fill="#6b7280">${escapeHtml(line)}</text>`;
  });
  return out;
}

function nvEdge(x1, y1, x2, y2, opts = {}) {
  const color = opts.color || '#9ca3af';
  const marker = opts.marker || 'nv-arrow';
  const dash = opts.dashed ? ' stroke-dasharray="4,4"' : '';
  let out = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.75"${dash} marker-end="url(#${marker})"/>`;
  if (opts.label) {
    // Nhãn cạnh nối trước đây đặt NGAY GIỮA đường nối (chỉ lệch 8px) -> dễ đè lên viền 2 node 2 bên khi
    // nhãn dài (VD "Duyệt xong") và khoảng cách giữa 2 node hẹp — sửa: lệch hẳn lên trên (14px) + viền
    // trắng "halo" quanh chữ (paint-order) để luôn đọc được rõ dù có đè lên đường nối/hình khác.
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 14;
    out += `<text x="${mx}" y="${my}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${color}" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round">${escapeHtml(opts.label)}</text>`;
  }
  return out;
}

function nvCurve(x1, y1, x2, y2, opts = {}) {
  const color = opts.color || '#9ca3af';
  const dip = opts.dip != null ? opts.dip : 46;
  const dipY = Math.max(y1, y2) + dip;
  const path = `M ${x1} ${y1} C ${x1} ${dipY}, ${x2} ${dipY}, ${x2} ${y2}`;
  let out = `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.75" marker-end="url(#nv-arrow-gray)"/>`;
  if (opts.label) out += `<text x="${(x1 + x2) / 2}" y="${dipY + 4}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${color}" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round">${escapeHtml(opts.label)}</text>`;
  return out;
}

// spec = { ariaLabel, chain:[{label,sub,kind?}], decision?:{atIndex,approveLabel,rejectLabel,rejectBox:{label,sub},loopBackToIndex,loopBackLabel}, reference?:{atIndex,label,sub} }
function renderNVFlow(spec) {
  const nodeW = 168, nodeH = 62, gapX = 70, marginX = 40;
  const chain = spec.chain;
  const n = chain.length;
  const hasRef = !!spec.reference;
  const hasDecision = !!spec.decision;
  const mainY = hasRef ? 96 : 26;
  const totalW = marginX * 2 + n * nodeW + (n - 1) * gapX;
  const rejectY = mainY + nodeH + 72;
  const height = hasDecision ? rejectY + 70 : mainY + nodeH + 26;
  const xs = chain.map((_, i) => marginX + i * (nodeW + gapX));

  let svg = `<defs>${nvArrowMarker('nv-arrow', '#9ca3af')}${nvArrowMarker('nv-arrow-blue', '#2563eb')}${nvArrowMarker('nv-arrow-red', '#dc2626')}${nvArrowMarker('nv-arrow-gray', '#9ca3af')}</defs>`;

  for (let i = 0; i < n - 1; i++) {
    const isDecisionEdge = hasDecision && spec.decision.atIndex === i;
    svg += nvEdge(xs[i] + nodeW, mainY + nodeH / 2, xs[i + 1], mainY + nodeH / 2,
      isDecisionEdge ? { color: '#2563eb', marker: 'nv-arrow-blue', label: spec.decision.approveLabel || 'Duyệt' } : {});
  }

  chain.forEach((node, i) => {
    let kind = node.kind || 'normal';
    if (hasDecision && spec.decision.atIndex === i) kind = 'decision';
    svg += nvRoundedNode(xs[i], mainY, nodeW, nodeH, { label: node.label, sub: node.sub, kind });
  });

  if (hasRef) {
    const ref = spec.reference;
    const idx = ref.atIndex != null ? ref.atIndex : 0;
    const rx = xs[idx], ry = 8, rw = nodeW, rh = 50;
    svg += nvRoundedNode(rx, ry, rw, rh, { label: ref.label, sub: ref.sub, kind: 'reference' });
    svg += nvEdge(rx + rw / 2, ry + rh, xs[idx] + nodeW / 2, mainY, { color: '#9ca3af', marker: 'nv-arrow-gray', dashed: true, label: 'tham chiếu' });
  }

  if (hasDecision) {
    const d = spec.decision;
    const dx = xs[d.atIndex] + nodeW / 2;
    const boxX = dx - nodeW / 2, boxY = rejectY;
    svg += nvEdge(dx, mainY + nodeH, dx, boxY, { color: '#dc2626', marker: 'nv-arrow-red', label: d.rejectLabel || 'Từ chối' });
    svg += nvRoundedNode(boxX, boxY, nodeW, nodeH, { label: d.rejectBox.label, sub: d.rejectBox.sub, kind: 'rejected' });
    const loopIdx = d.loopBackToIndex != null ? d.loopBackToIndex : 0;
    const lx = xs[loopIdx] + nodeW / 2;
    svg += nvCurve(boxX, boxY + nodeH / 2, lx, mainY + nodeH, { dip: 30, label: d.loopBackLabel || 'Làm lại' });
  }

  return `<svg viewBox="0 0 ${totalW} ${height}" role="img" aria-label="${escapeHtml(spec.ariaLabel || 'Sơ đồ quy trình')}" class="nv-flow-svg">${svg}</svg>`;
}

// Sơ đồ QUAN HỆ (hub) dùng riêng cho trang "Tổng Quan" của Đào Tạo — khác renderNVFlow() (chuỗi tuần
// tự có hướng): ở đây nhiều chức năng cùng NUÔI vào 1 hub trung tâm (Lớp Học) theo nhiều chiều, nên toạ
// độ node đặt tay bằng nvRoundedNode()/nvEdge() thay vì auto-layout theo hàng ngang.
function renderNVDaotaoOverview() {
  const W = 860, H = 460;
  const N = {
    tanbinh:    { x: 16,  y: 16,  w: 176, h: 58, label: 'Lộ Trình Tân Binh', sub: 'Gồm nhiều Chương Trình', kind: 'normal' },
    thangtien:  { x: 232, y: 16,  w: 176, h: 58, label: 'Lộ Trình Thăng Tiến', sub: 'Mỗi bậc khoá theo Chương Trình', kind: 'normal' },
    chuongtrinh:{ x: 124, y: 128, w: 176, h: 58, label: 'Chương Trình', sub: 'Khung nội dung tái sử dụng', kind: 'normal' },
    khotl:      { x: 528, y: 16,  w: 176, h: 58, label: 'Kho Tài Liệu', sub: 'Giáo trình dùng chung', kind: 'reference' },
    khoch:      { x: 528, y: 128, w: 176, h: 58, label: 'Ngân Hàng Câu Hỏi', sub: 'Đề kiểm tra dùng chung', kind: 'reference' },
    lophoc:     { x: 332, y: 244, w: 196, h: 62, label: 'Lớp Học', sub: 'Mở theo đợt, gắn 1 Chương Trình', kind: 'hub' },
    giangvien:  { x: 96,  y: 364, w: 176, h: 58, label: 'Giảng Viên', sub: 'Gán riêng cho lớp Offline', kind: 'actor' },
    hocvien:    { x: 588, y: 364, w: 176, h: 58, label: 'Học Viên', sub: 'Đăng ký hoặc được mời', kind: 'actor' },
  };
  const cx = (k) => N[k].x + N[k].w / 2, cy = (k) => N[k].y + N[k].h / 2;
  const bottom = (k) => ({ x: cx(k), y: N[k].y + N[k].h });
  const top = (k) => ({ x: cx(k), y: N[k].y });
  const side = (k, dir) => ({ x: dir === 'l' ? N[k].x : N[k].x + N[k].w, y: cy(k) });

  let svg = `<defs>${nvArrowMarker('nv-arrow', '#9ca3af')}${nvArrowMarker('nv-arrow-violet', '#7c3aed')}${nvArrowMarker('nv-arrow-amber', '#d97706')}</defs>`;

  svg += nvEdge(bottom('tanbinh').x, bottom('tanbinh').y, top('chuongtrinh').x - 30, top('chuongtrinh').y, { color: '#9ca3af', marker: 'nv-arrow-gray', dashed: true, label: 'gồm nhiều' });
  svg += nvEdge(bottom('thangtien').x, bottom('thangtien').y, top('chuongtrinh').x + 30, top('chuongtrinh').y, { color: '#9ca3af', marker: 'nv-arrow-gray', dashed: true, label: 'khoá theo bậc' });
  svg += nvEdge(side('chuongtrinh', 'r').x, side('chuongtrinh', 'r').y, side('lophoc', 'l').x, side('lophoc', 'l').y - 14, { color: '#7c3aed', marker: 'nv-arrow-violet', label: 'mở lớp theo' });
  svg += nvEdge(bottom('khotl').x, bottom('khotl').y, side('lophoc', 'r').x + 30, top('lophoc').y - 4, { color: '#9ca3af', marker: 'nv-arrow-gray', dashed: true, label: 'giáo trình' });
  svg += nvEdge(bottom('khoch').x, bottom('khoch').y, side('lophoc', 'r').x + 60, top('lophoc').y + 6, { color: '#9ca3af', marker: 'nv-arrow-gray', dashed: true, label: 'đề kiểm tra' });
  svg += nvEdge(top('giangvien').x, top('giangvien').y, side('lophoc', 'l').x, side('lophoc', 'l').y + 14, { color: '#d97706', marker: 'nv-arrow-amber', label: 'đứng lớp (Offline)' });
  svg += nvEdge(side('lophoc', 'r').x, cy('lophoc'), top('hocvien').x, top('hocvien').y, { color: '#7c3aed', marker: 'nv-arrow-violet', label: 'mời / đăng ký' });

  Object.values(N).forEach(n => { svg += nvRoundedNode(n.x, n.y, n.w, n.h, { label: n.label, sub: n.sub, kind: n.kind }); });

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sơ đồ quan hệ tổng quan Đào Tạo" class="nv-flow-svg">${svg}</svg>`;
}

function nvFooterCol(title, items) {
  if (!items || !items.length) return '';
  const li = items.map(it => `<li class="py-1.5 border-t first:border-t-0 border-gray-100"><b>${escapeHtml(it.label)}</b> — ${it.text}</li>`).join('');
  return `<div><div class="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">${escapeHtml(title)}</div><ul class="text-[12.5px] text-gray-700 leading-snug list-none">${li}</ul></div>`;
}

// ===================== Nội dung nghiệp vụ =====================
// text.text trong footer items được phép chứa HTML tối giản (<code>, <b>) — nội dung TĨNH do dev tự viết,
// không phải input người dùng, nên không cần escape ở đây (khác escapeHtml() dùng cho label trong SVG).

const NGHIEP_VU_DOCS = {
  doc: {
    icon: '📄', title: 'Tài Liệu', badge: 'Mở cho mọi nhân viên',
    desc: 'Quản lý văn bản nội bộ theo mã số tự động, mỗi lần cập nhật lại tạo ra 1 phiên bản mới (bản cũ vẫn giữ nguyên để tra cứu), phê duyệt theo đúng quy trình của từng phòng ban.',
    flow: { ariaLabel: 'Quy trình Tài Liệu: Tạo mới, Duyệt, Bổ Sung', chain: [
      { label: 'Tạo mới', sub: 'Chọn phòng ban + phân loại, tải file' },
      { label: 'Chờ duyệt', sub: 'Duyệt theo cấu hình từng phòng ban', kind: 'decision' },
      { label: 'Đã duyệt', sub: 'Có thể tạo phiên bản mới', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Duyệt xong', rejectLabel: 'Từ chối', rejectBox: { label: 'Trả về sửa', sub: 'Về "Sửa & Gửi Lại"' }, loopBackToIndex: 1, loopBackLabel: 'Sửa & gửi lại → chờ duyệt' } },
    footer: { left: [
      { label: 'Ai xem được gì', text: 'quản trị viên xem được tất cả; người tải tài liệu lên luôn xem được bài của mình dù đang ở bước nào; một số người chỉ được xem bản đã duyệt, một số khác chỉ xem bản chưa duyệt — 2 quyền này tách biệt, không cộng dồn; người phê duyệt xem đúng hồ sơ thuộc phòng ban mình phụ trách.' },
      { label: 'Tạo phiên bản mới', text: 'không tạo được phiên bản mới nếu bản mới nhất đang chờ duyệt hoặc còn là bản nháp; nếu bản mới nhất bị từ chối thì vẫn tạo phiên bản mới bình thường.' },
    ], right: [
      { label: 'Mã trùng', text: 'nếu 2 người cùng tạo tài liệu cùng lúc và mã bị trùng, hệ thống tự đổi sang mã kế tiếp — người dùng không thấy lỗi gì cả.' },
    ] },
  },
  submission: {
    icon: '📜', title: 'Văn Bản Trình / Tờ Trình', badge: 'Duyệt nhiều lớp',
    desc: 'Tờ trình nội bộ với số lớp phê duyệt tự cấu hình được (không cố định 1 bước) — mỗi lớp là 1 nhóm người duyệt riêng, phải qua hết lớp trước mới tới lớp sau.',
    flow: { ariaLabel: 'Quy trình Văn Bản Trình', chain: [
      { label: 'Soạn thảo', sub: 'Bản nháp, chọn số lớp duyệt' },
      { label: 'Chờ duyệt', sub: 'Duyệt tuần tự từng lớp', kind: 'decision' },
      { label: 'Đã duyệt', sub: 'Ban hành / lưu trữ', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Đủ các lớp', rejectLabel: 'Từ chối', rejectBox: { label: 'Bị từ chối', sub: 'Bắt buộc nêu lý do' }, loopBackToIndex: 0, loopBackLabel: 'Sửa & trình lại' } },
    footer: { left: [
      { label: 'Lớp duyệt độc lập', text: 'mỗi lớp có danh sách người duyệt riêng — duyệt xong lớp trước mới hiện ra lớp sau, không thể "duyệt tắt" bỏ qua lớp nào.' },
    ], right: [
      { label: 'Không tự duyệt', text: 'người tạo tờ trình không được nằm trong danh sách duyệt của chính tờ trình đó.' },
    ] },
  },
  contract: {
    icon: '📁', title: 'Hợp Đồng', badge: 'Trình duyệt + theo dõi hiệu lực',
    desc: 'Hợp đồng với đối tác/nhà cung cấp — tạo mới, trình duyệt theo lớp (giống Văn Bản Trình), sau khi có hiệu lực thì hệ thống theo dõi để cảnh báo trước khi hết hạn.',
    flow: { ariaLabel: 'Quy trình Hợp Đồng', chain: [
      { label: 'Soạn hợp đồng', sub: 'Bản nháp, đính kèm file' },
      { label: 'Chờ duyệt', sub: 'Trình duyệt theo lớp', kind: 'decision' },
      { label: 'Đang hiệu lực', sub: 'Theo dõi ngày hết hạn', kind: 'approved' },
      { label: 'Hết hạn / Thanh lý', sub: 'Kết thúc hiệu lực' },
    ], decision: { atIndex: 1, approveLabel: 'Duyệt', rejectLabel: 'Từ chối', rejectBox: { label: 'Trả về sửa', sub: 'Sửa lại điều khoản' }, loopBackToIndex: 0 },
      reference: { atIndex: 0, label: 'Danh Mục Đối Tác', sub: 'Loại hợp đồng, đơn vị' } },
    footer: { left: [
      { label: 'Cảnh báo hết hạn', text: 'hợp đồng đang hiệu lực mà gần tới ngày hết hạn sẽ được nhắc trước, để chủ động gia hạn hoặc thanh lý thay vì để hết hạn lúc nào không hay.' },
    ], right: [
      { label: 'Thanh Toán liên kết', text: 'chi phí thực tế phát sinh từ hợp đồng được ghi nhận qua mục Thanh Toán (Tổng Hợp), liên kết ngược về đúng hợp đồng gốc.' },
    ] },
  },
  minutes: {
    icon: '📝', title: 'Biên Bản Họp', badge: 'Điều Hành',
    desc: 'Ghi nhận nội dung và điểm danh cuộc họp, có thể liên kết tới 1 lịch đặt phòng (nếu có), và sinh Công Việc trực tiếp từ các đầu việc đã thống nhất trong biên bản.',
    flow: { ariaLabel: 'Quy trình Biên Bản Họp', chain: [
      { label: 'Tạo biên bản', sub: 'Liên kết cuộc họp (tuỳ chọn)' },
      { label: 'Điểm danh + nội dung', sub: 'Ghi nhận thảo luận, quyết nghị' },
      { label: 'Chốt & lưu', sub: 'Sinh Công Việc cho đầu việc', kind: 'approved' },
    ] },
    footer: { left: [
      { label: 'Quyền tạo', text: 'chỉ người được cấp quyền tạo biên bản họp mới thấy được form tạo — người khác chỉ xem nội dung.' },
    ], right: [
      { label: 'Mẫu điểm danh', text: 'có thể lưu sẵn danh sách người tham dự thường xuyên thành 1 mẫu, để không phải chọn lại từ đầu mỗi lần họp định kỳ.' },
    ] },
  },
  task: {
    icon: '📋', title: 'Công Việc', badge: 'Điều Hành',
    desc: 'Giao việc có người giao, người nhận, hạn hoàn thành và cập nhật tiến độ theo từng trạng thái — có thể tự sinh từ 1 đầu việc trong Biên Bản Họp.',
    flow: { ariaLabel: 'Quy trình Công Việc', chain: [
      { label: 'Giao việc', sub: 'Người giao tạo, gán hạn' },
      { label: 'Đang thực hiện', sub: 'Người nhận cập nhật tiến độ' },
      { label: 'Chờ nghiệm thu', sub: 'Người nhận báo hoàn thành', kind: 'decision' },
      { label: 'Hoàn thành', sub: 'Người giao xác nhận', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Đạt', rejectLabel: 'Chưa đạt', rejectBox: { label: 'Trả lại', sub: 'Yêu cầu làm lại' }, loopBackToIndex: 1, loopBackLabel: 'Tiếp tục thực hiện' } },
    footer: { left: [
      { label: 'Giao việc thay người khác', text: 'chỉ người được cấp quyền quản lý công việc mới tạo việc thay cho người khác được — nhân viên thường chỉ tự cập nhật tiến độ việc của mình.' },
    ], right: [] },
  },
  periodicReport: {
    icon: '📅', title: 'Báo Cáo Định Kỳ', badge: 'Điều Hành',
    desc: 'Báo cáo lặp lại theo chu kỳ (tuần/tháng/quý) — người phụ trách nhập số liệu theo mẫu, nộp đúng hạn, sau đó hệ thống tổng hợp thành 1 bản trình chiếu chung.',
    flow: { ariaLabel: 'Quy trình Báo Cáo Định Kỳ', chain: [
      { label: 'Cấu hình kỳ', sub: 'Mẫu + tần suất (quản trị)' },
      { label: 'Nhập số liệu', sub: 'Đang nhập, theo phòng ban' },
      { label: 'Nộp báo cáo', sub: 'Đúng hạn kỳ báo cáo' },
      { label: 'Tổng hợp & trình chiếu', sub: 'Gộp toàn bộ phòng ban', kind: 'approved' },
    ] },
    footer: { left: [
      { label: 'Nhắc hạn', text: 'hệ thống tự nhắc các phòng ban chưa nộp khi gần tới hạn kỳ báo cáo, tránh thiếu số liệu lúc tổng hợp.' },
    ], right: [
      { label: 'Khác mục "Báo Cáo"', text: 'đây là quy trình chủ động — từng phòng ban tự nhập và nộp số liệu theo kỳ; mục "📊 Báo Cáo" ở cuối menu chỉ để xem lại số liệu đã tổng hợp, không có thao tác riêng.' },
    ] },
  },
  meeting: {
    icon: '📅', title: 'Đặt Phòng Họp', badge: 'Hành Chính',
    desc: 'Đặt phòng họp theo khung giờ — hệ thống tự kiểm tra trùng lịch trước khi xác nhận, có thể huỷ trước giờ họp.',
    flow: { ariaLabel: 'Quy trình Đặt Phòng Họp', chain: [
      { label: 'Chọn phòng + giờ', sub: 'Kiểm tra trùng lịch tự động' },
      { label: 'Xác nhận đặt', sub: 'Giữ chỗ ngay nếu còn trống', kind: 'approved' },
      { label: 'Sử dụng / Huỷ', sub: 'Huỷ được trước giờ họp' },
    ] },
    footer: { left: [
      { label: 'Chặn trùng lịch', text: 'hệ thống tự chối nếu khung giờ đã có người giữ cùng phòng — không cần tự tra lịch trước khi đặt.' },
    ], right: [] },
  },
  car: {
    icon: '🚗', title: 'Đăng Ký Xe', badge: 'Cập nhật v23.4',
    desc: 'Đăng ký lịch trình công tác cần xe — sau khi duyệt, bộ phận điều phối gán xe và tài xế cụ thể cho chuyến đi; lái xe xác nhận nhận chuyến rồi báo số km khi kết thúc, người đăng ký đánh giá lại chuyến đi sau cùng.',
    flow: { ariaLabel: 'Quy trình Đăng Ký Xe', chain: [
      { label: 'Đăng ký lịch trình', sub: 'Điểm đi/đến, thời gian' },
      { label: 'Duyệt', sub: 'Theo cấu hình phòng ban', kind: 'decision' },
      { label: 'Điều phối xe', sub: 'Gán xe + tài xế', kind: 'approved' },
      { label: 'Lái xe xác nhận & kết thúc', sub: 'Nhận chuyến → báo km khi xong' },
      { label: 'Đánh giá & hoàn tất', sub: 'Người đăng ký xác nhận lại' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Bị từ chối', sub: 'Nêu lý do' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Điều phối tách biệt', text: 'người duyệt đăng ký khác với người điều phối xe — bộ phận điều phối chỉ thao tác sau khi đăng ký đã được duyệt.' },
      { label: 'Đánh giá & xác nhận', text: 'lái xe tự xác nhận đã nhận chuyến, rồi báo số km thực đi khi kết thúc; sau đó người đăng ký xem lại và đánh giá chuyến đi — xong bước này chuyến mới được tính là hoàn tất.' },
    ], right: [
      { label: 'Báo Cáo: lịch sử đánh giá + xác nhận', text: 'mục 📊 Báo Cáo có 2 bảng chi tiết: "ai đánh giá lái xe nào, ở phiếu nào, nhận xét gì" và "lái xe xác nhận/kết thúc phiếu nào, lúc nào, báo bao nhiêu km".' },
      { label: 'Biểu đồ xu hướng chọn kỳ', text: 'biểu đồ số chuyến + số km theo Ngày/Tuần/Tháng/Quý/Năm, tách biệt với mục Lịch Xe (xem lịch trực quan theo ngày/tuần/tháng, không phải biểu đồ thống kê).' },
    ] },
  },
  vpp: {
    icon: '🖇️', title: 'Văn Phòng Phẩm', badge: 'Hành Chính',
    desc: 'Đăng ký mua văn phòng phẩm từ danh mục mặt hàng có sẵn — hệ thống tự kiểm tra ngân sách còn lại của phòng ban (mức mỗi người hoặc tổng phòng, tuỳ cấu hình) trước khi cho gửi.',
    flow: { ariaLabel: 'Quy trình Văn Phòng Phẩm', chain: [
      { label: 'Chọn mặt hàng', sub: 'Từ Danh Mục VPP' },
      { label: 'Kiểm tra ngân sách', sub: 'Tự động, theo phòng ban', kind: 'decision' },
      { label: 'Duyệt & cấp phát', sub: '', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Đủ hạn mức', rejectLabel: 'Vượt hạn mức', rejectBox: { label: 'Chặn gửi', sub: 'Không cho vượt mức' }, loopBackToIndex: 0, loopBackLabel: 'Giảm số lượng' },
      reference: { atIndex: 0, label: 'Danh Mục Mặt Hàng', sub: 'Đơn giá, hạn mức' } },
    footer: { left: [
      { label: 'Ngân sách theo phòng ban', text: 'quản trị có thể cấu hình mức riêng cho từng người, hoặc chặn theo tổng ngân sách cả phòng — 2 kiểu này không dùng cùng lúc cho 1 phòng ban.' },
    ], right: [
      { label: 'Xuất Excel danh mục', text: 'quản trị có thể tải file mẫu và xuất Excel toàn bộ danh mục mặt hàng để đối chiếu ngoài hệ thống.' },
    ] },
  },
  uniform: {
    icon: '👕', title: 'Đồng Phục', badge: 'Hành Chính',
    desc: 'Đăng ký đồng phục theo đợt (loại, size), duyệt rồi cấp phát — có lưu lịch sử cấp phát để tra khi cần đối chiếu.',
    flow: { ariaLabel: 'Quy trình Đồng Phục', chain: [
      { label: 'Đăng ký', sub: 'Chọn loại + size, theo đợt' },
      { label: 'Duyệt', sub: '', kind: 'decision' },
      { label: 'Cấp phát', sub: 'Lưu lịch sử', kind: 'approved' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Bị từ chối', sub: '' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Theo đợt', text: 'mỗi đợt cấp phát tách riêng — không gộp lẫn số liệu giữa các đợt khác nhau khi tra lịch sử.' },
    ], right: [] },
  },
  license: {
    icon: '🔑', title: 'Bản Quyền Phần Mềm (License)', badge: 'Hành Chính',
    desc: 'Danh mục nền tảng → Kỳ mua → Đăng ký mua → Phát hành → Phân bổ/Cấp phát → Gia hạn hoặc Thu hồi.',
    flow: { ariaLabel: 'Quy trình Bản Quyền Phần Mềm', chain: [
      { label: 'Kỳ mua', sub: 'Theo năm/đợt ngân sách' },
      { label: 'Đăng ký mua', sub: 'Số lượng, nền tảng' },
      { label: 'Duyệt?', sub: '', kind: 'decision' },
      { label: 'Phát hành', sub: 'Sinh mã/số lượng dùng' },
      { label: 'Phân bổ / Cấp phát', sub: 'Gán cho người dùng cuối', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'duyệt', rejectLabel: 'từ chối', rejectBox: { label: 'Từ chối mua', sub: 'Nêu lý do' }, loopBackToIndex: 1, loopBackLabel: 'Đăng ký lại' },
      reference: { atIndex: 0, label: 'Danh Mục Nền Tảng', sub: 'Tên phần mềm, NCC' } },
    footer: { left: [
      { label: 'Giới hạn số người dùng', text: 'mỗi bản quyền chỉ được gán cho tối đa 1 số người nhất định cùng lúc — hệ thống tự chặn nếu gán vượt quá số lượng đã mua.' },
      { label: 'Thu hồi khi nghỉ việc', text: 'khi 1 nhân sự hoàn tất thủ tục nghỉ việc, bản quyền đang gán cho họ tự chuyển về trạng thái "sẵn sàng cấp lại", không cần thao tác tay riêng.' },
    ], right: [
      { label: 'Gia hạn', text: 'bản quyền sắp hết hạn được nhắc trước để tạo kỳ mua gia hạn kịp thời, tránh gián đoạn phần mềm đang dùng.' },
    ] },
  },
  office: {
    icon: '🛒', title: 'Mua Bán / Sửa Chữa / Thanh Toán', badge: 'Tổng Hợp',
    desc: 'Đề xuất mua sắm hoặc sửa chữa, sau khi duyệt và thực hiện thì chi phí thực tế được ghi nhận ở mục Thanh Toán, liên kết ngược về đúng đề xuất gốc.',
    flow: { ariaLabel: 'Quy trình Mua Bán/Sửa Chữa/Thanh Toán', chain: [
      { label: 'Đề xuất', sub: 'Mua sắm hoặc Sửa chữa' },
      { label: 'Duyệt theo lớp', sub: '', kind: 'decision' },
      { label: 'Thực hiện', sub: 'Mua/sửa thực tế', kind: 'approved' },
      { label: 'Thanh Toán', sub: 'Ghi nhận chi phí thực tế' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Bị từ chối', sub: 'Nêu lý do' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Hạng mục chi tiết', text: 'mỗi đề xuất có danh sách các hạng mục con, mỗi hạng mục có số lượng và đơn giá riêng — không chỉ gộp thành 1 con số tổng duy nhất.' },
    ], right: [
      { label: 'Người duyệt Thanh Toán', text: 'chỉ người được phân quyền quản lý thanh toán, hoặc đúng người duyệt ở bước thanh toán của phòng ban đó, mới ghi nhận được khoản chi này.' },
    ] },
  },
  budget: {
    icon: '💰', title: 'Ngân Sách 2.0', badge: 'Cập nhật v23.3',
    desc: 'Gồm 3 phần việc tách biệt nhau (không đi tuần tự từ đầu tới cuối) — mỗi dòng ngân sách tự có Năm/Tháng riêng, không dùng chung 1 "kỳ ngân sách" cho tất cả. Khi chọn Vị trí là Văn Phòng hoặc Siêu Thị, hệ thống sẽ hỏi thêm để chọn đúng phòng ban/siêu thị. Có thể tải file mẫu, nhập và xuất Excel.',
    flow: { ariaLabel: 'Quy trình Ngân Sách 2.0: 3 phần việc tách biệt', chain: [
      { label: 'Đề Xuất', sub: 'Người đề xuất gửi lên', kind: 'decision' },
      { label: 'Phê Duyệt', sub: 'Tự sinh khi Đề Xuất duyệt xong' },
      { label: 'Sử Dụng', sub: 'Dòng cha hệ thống tự sinh', kind: 'approved' },
    ], decision: { atIndex: 0, approveLabel: 'Duyệt', rejectLabel: 'Từ chối', rejectBox: { label: 'Bị từ chối', sub: 'Sửa & gửi lại' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Không cho sửa nội dung nguồn', text: 'khi hệ thống tự sinh dòng Sử Dụng, nội dung và loại hạng mục luôn lấy nguyên từ dòng gốc — không ai chỉnh sửa được ở bước này. Nếu chọn Vị trí là Siêu Thị, hệ thống cũng tự gán đúng tên siêu thị đó cho dòng ngân sách.' },
      { label: 'Không tự duyệt hồ sơ mình tạo', text: 'áp dụng cho mọi vai trò, kể cả quản trị viên, không có ngoại lệ.' },
    ], right: [
      { label: 'Quyền đề xuất & ghi nhận', text: 'tự tạo/sửa/xoá đề xuất của mình, và ghi nhận phần Sử Dụng cho đúng phòng ban/siêu thị mình phụ trách.' },
      { label: 'Quyền quản lý toàn bộ', text: 'duyệt đề xuất, tạo và duyệt phần Phê Duyệt, sửa/xoá được dòng Sử Dụng gốc — quyền cao nhất trong mục này.' },
      { label: 'Quyền xem báo cáo', text: 'xem được số liệu của mọi phòng ban/siêu thị và tab Báo Cáo, nhưng không tạo hay duyệt được gì.' },
      { label: 'Excel Tải Mẫu/Nhập/Xuất', text: 'tab Đề Xuất/Phê Duyệt có đủ cả 3 nút; tab Sử Dụng/Báo Cáo chỉ có nút Xuất Excel.' },
    ] },
  },
  vanHanh: {
    icon: '📦', title: 'Đơn Hàng & Mở Mới/Sửa Chữa Siêu Thị', badge: 'QLDA',
    desc: 'Hai luồng: Đơn Hàng (mua hàng vận hành theo đợt) và Mở Mới/Sửa Chữa Siêu Thị (dự án nhiều mốc tiến độ, có lịch sử cập nhật từng mốc).',
    flow: { ariaLabel: 'Quy trình Mở Mới/Sửa Chữa Siêu Thị', chain: [
      { label: 'Đề xuất dự án', sub: 'Mở mới hoặc sửa chữa' },
      { label: 'Duyệt', sub: '', kind: 'decision' },
      { label: 'Các mốc tiến độ', sub: 'Theo mẫu mốc đã cấu hình', kind: 'approved' },
      { label: 'Hoàn tất', sub: 'Đủ mốc bắt buộc' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Bị từ chối', sub: '' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Lịch sử theo mốc', text: 'mỗi mốc tiến độ có lịch sử cập nhật và tệp đính kèm riêng — không bị ghi đè, xem lại được toàn bộ diễn biến của dự án.' },
      { label: '👁️ Xem Nhanh (9/2026)', text: 'ở tab Báo Cáo, bấm vào số liệu Tổng CV/Đã Nghiệm Thu/Đang Thực Hiện/Chưa Bắt Đầu của 1 hồ sơ để mở nhanh danh sách đúng nhóm công việc đó (tiến độ/trạng thái/người thực hiện), không cần mở "Xem/Lập Danh Mục Đầu Tư" đầy đủ.' },
    ], right: [
      { label: 'Đơn Hàng', text: 'là luồng tách biệt — tạo đơn, duyệt, xử lý rồi hoàn tất, không đi qua các mốc tiến độ của dự án.' },
    ] },
  },
  checklist: {
    icon: '✅', title: 'Checklist Đánh Giá Siêu Thị', badge: 'Cập nhật v23.4',
    desc: 'Bộ tiêu chí đánh giá (hạng mục/câu hỏi/điểm) do quản trị chuẩn bị sẵn thành mẫu — người đánh giá chọn siêu thị rồi chấm theo đúng bộ tiêu chí đang dùng. Mỗi mẫu trải qua 3 trạng thái: Nháp → Đang dùng → Lưu trữ, với các nút Dừng/Sửa/Xoá phù hợp theo từng trạng thái và quyền hạn.',
    flow: { ariaLabel: 'Quy trình Checklist Đánh Giá Siêu Thị', chain: [
      { label: 'Chuẩn bị mẫu', sub: 'Hạng mục, câu hỏi, điểm (quản trị)' },
      { label: 'Kích hoạt', sub: 'Chỉ 1 bản đang dùng mỗi lúc' },
      { label: 'Chấm điểm', sub: 'Chọn siêu thị, trả lời từng mục', kind: 'approved' },
      { label: 'Nộp & tổng hợp', sub: 'Tự tính điểm/xếp loại' },
    ] },
    footer: { left: [
      { label: 'Tiếp tục dở dang', text: 'bài chấm chưa nộp có thể bấm "Tiếp Tục" để làm tiếp, không cần làm lại từ đầu.' },
      { label: 'Nhân bản mẫu', text: 'có thể nhân bản 1 mẫu có sẵn để chỉnh sửa nhanh thay vì dựng lại từ đầu — nhân bản được từ cả mẫu Đang dùng lẫn Lưu trữ.' },
    ], right: [
      { label: '⏸️ Dừng (Đang dùng → Lưu trữ)', text: 'dừng thủ công 1 mẫu Đang dùng mà không cần kích hoạt bản thay thế ngay. Muốn dùng lại đúng mẫu vừa Dừng thì bấm "🔄 Kích Hoạt Lại" ngay trên mẫu Lưu trữ đó — không cần Nhân Bản/Sửa gì cả, không tạo phiên bản mới.' },
      { label: '✏️ Sửa (Đang dùng/Lưu trữ)', text: 'không sửa trực tiếp được, để giữ nguyên dữ liệu các bài đã nộp trước đó — bấm "Sửa" sẽ tự nhân bản thành 1 bản Nháp mới rồi mở thẳng form sửa, gộp 2 bước cũ thành 1 lần bấm.' },
      { label: '🗑️ Xoá — chỉ Quản Trị Viên', text: 'nút Xoá chỉ Quản Trị Viên (quyền cao nhất) mới thấy được, ở mọi trạng thái — nếu mẫu đã có người nộp bài thì nút này sẽ bị khoá kèm gợi ý dùng "⏸️ Dừng" thay thế, để không làm mất dữ liệu báo cáo cũ.' },
    ] },
  },
  orgChart: {
    icon: '🗂️', title: 'Cơ Cấu Tổ Chức', badge: 'Nhân Sự',
    desc: 'Sơ đồ tổ chức theo từng phiên bản — mỗi lần thay đổi vị trí hoặc người phụ trách sẽ tạo ra 1 phiên bản mới, các phiên bản cũ giữ nguyên để tra cứu lịch sử, không sửa trực tiếp lên bản cũ.',
    flow: { ariaLabel: 'Quy trình Cơ Cấu Tổ Chức', chain: [
      { label: 'Phiên bản hiện hành', sub: 'Đang áp dụng' },
      { label: 'Chỉnh sửa', sub: 'Thêm/sửa/xoá vị trí, gán người' },
      { label: 'Phiên bản mới', sub: 'Tự tăng số phiên bản', kind: 'approved' },
    ] },
    footer: { left: [
      { label: 'Không sửa phiên bản cũ', text: 'mọi thay đổi luôn tạo ra phiên bản mới — phiên bản cũ chỉ xem, không chỉnh sửa lại được, để lịch sử không bị viết đè.' },
    ], right: [] },
  },
  hrLifecycle: {
    icon: '🆕', title: 'Onboarding / Offboarding', badge: 'Quy trình theo từng mốc thời gian',
    desc: 'Hệ thống tự tạo danh sách việc cần làm theo từng mốc thời gian, dựa theo mẫu đã chuẩn bị sẵn — mỗi việc được gán cho đúng bộ phận phụ trách (Nhân Sự, IT, Hành Chính, Kế Toán hoặc Quản Lý trực tiếp), tự hoàn tất khi đã xong hết các việc bắt buộc.',
    flow: { ariaLabel: 'Quy trình Onboarding 4 mốc', chain: [
      { label: 'Chuẩn bị trước ngày đi làm', sub: '' },
      { label: 'Ngày đầu tiên', sub: '' },
      { label: 'Tuần/Tháng đầu', sub: '' },
      { label: 'Kết thúc thử việc', sub: '', kind: 'approved' },
    ] },
    footer: { left: [
      { label: 'Hoàn tất nghỉ việc tự động', text: 'khi hoàn tất thủ tục nghỉ việc, hệ thống tự khoá tài khoản đăng nhập, huỷ mọi phiên đang mở và chuyển hợp đồng lao động sang trạng thái đã kết thúc — không cần thao tác tay.' },
      { label: 'Chờ chỉ định người kế nhiệm', text: 'nếu người sắp nghỉ còn đang là quản lý trực tiếp của ai, quy trình nghỉ việc sẽ dừng lại ở bước "Chờ chỉ định người kế nhiệm" dù đã xong hết việc khác — Nhân Sự chỉ định xong mới tự hoàn tất.' },
    ], right: [
      { label: 'Cầu nối IT', text: 'việc gắn nhãn IT có thể tự sinh 1 ticket hỗ trợ IT liên kết; hệ thống không tự tạo tài khoản đăng nhập — IT vẫn phải tạo thủ công ngoài hệ thống.' },
      { label: 'Ai được thao tác', text: 'người quản lý đúng loại quy trình (nhận việc hoặc nghỉ việc) mới thao tác được; người chỉ được cấp quyền xem thì chỉ xem, không bỏ qua được bất kỳ việc bắt buộc nào.' },
    ] },
  },
  hrProfile: {
    icon: '👤', title: 'Hồ Sơ Nhân Sự', badge: 'Dữ liệu nhạy cảm',
    desc: 'Hồ sơ cá nhân từng nhân viên (thông tin, giấy tờ đính kèm) — liên kết với Hợp Đồng Lao Động, Lương và Công/Phép của cùng người. Mã Nhân Viên tự sinh (tiền tố "BL" + số tuần tự, chống trùng khi 2 người tạo cùng lúc) — vẫn gõ tay được nếu muốn.',
    flow: { ariaLabel: 'Quy trình Hồ Sơ Nhân Sự', chain: [
      { label: 'Tạo hồ sơ', sub: 'Từ Onboarding hoặc tạo tay' },
      { label: 'Cập nhật thông tin', sub: 'Giấy tờ, liên hệ, quá trình' },
      { label: 'Lưu trữ', sub: 'Xuyên suốt vòng đời nhân sự', kind: 'approved' },
    ] },
    footer: { left: [
      { label: 'Không hiện ở Báo Cáo chung', text: 'đây là nhóm dữ liệu cực kỳ nhạy cảm nên không đưa vào các báo cáo tổng hợp dùng chung — thay vào đó có module con "📊 Báo Cáo" RIÊNG cấp Nhân Sự (vào làm/nghỉ việc/tăng lương/hợp đồng mới-gia hạn-sắp hết hạn/thăng chức, lọc theo thời gian), gác quyền chặt như Lịch Sử Nhân Sự.' },
      { label: 'Tái Tuyển', text: 'nút "Kiểm Tra Nhân Sự Cũ" (khi tạo hồ sơ mới hoặc mở Onboarding) tra theo CCCD+ngày sinh — nhân viên cũ quay lại giữ NGUYÊN Mã Nhân Viên cũ, chỉ ghi thêm 1 dòng lịch sử tái tuyển.' },
      { label: 'Phân quyền chi tiết', text: '3 quyền tách riêng Tạo/Xem toàn bộ/Sửa (kết hợp tự do) bên cạnh quyền "Quản Lý Hồ Sơ Nhân Sự" gộp sẵn cả 3 — admin cấu hình ở Hệ Thống > Phân Quyền.' },
      { label: 'Cấu hình trường xem (opt-in)', text: '2 nút "⚙️" riêng trong Quản Lý Hồ Sơ, cùng nguyên tắc: MẶC ĐỊNH KHÔNG trường nhạy cảm nào hiển thị (đủ 15 field: ngày sinh, giới tính, email cá nhân, liên hệ khẩn cấp, CCCD, địa chỉ, ngân hàng, BHXH, mã số thuế, người phụ thuộc, học vấn) tới khi admin chủ động mở — "Trường Xem Của Quản Lý Trực Tiếp" áp dụng khi quản lý xem hồ sơ cấp dưới, "Trường Xem Của Tôi" áp dụng khi chính nhân viên tự xem/sửa hồ sơ mình — 2 cấu hình độc lập, mở ở màn này không tự mở cho màn kia.' },
    ], right: [
      { label: 'Lịch Sử Thay Đổi & Chỉnh Sửa', text: 'mọi lần tạo mới/sửa hồ sơ (liệt kê đúng field đã đổi) được ghi lại, gộp chung vào "Lịch Sử Nhân Sự" cùng chức vụ/hợp đồng/tái tuyển — luôn sắp mới nhất lên đầu.' },
    ] },
  },
  hrContract: {
    icon: '📄', title: 'Hợp Đồng Lao Động', badge: 'Nhân Sự',
    desc: 'Hợp đồng thử việc tự sinh khi bắt đầu Onboarding, chuyển sang chính thức khi ký kết — tự động chuyển sang đã kết thúc khi hoàn tất thủ tục nghỉ việc, không cần đổi tay.',
    flow: { ariaLabel: 'Quy trình Hợp Đồng Lao Động', chain: [
      { label: 'Thử việc', sub: 'Tự sinh từ Onboarding' },
      { label: 'Ký chính thức', sub: 'Ra quyết định sau thử việc', kind: 'decision' },
      { label: 'Đang hiệu lực', sub: 'Theo dõi hiệu lực', kind: 'approved' },
      { label: 'Đã kết thúc', sub: 'Tự động khi nghỉ việc xong' },
    ], decision: { atIndex: 1, approveLabel: 'Ký', rejectLabel: 'Không đạt/gia hạn thêm', rejectBox: { label: 'Gia hạn thử việc', sub: 'Kéo dài thời gian thử việc' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Không hiện ở Báo Cáo chung', text: 'cùng nhóm dữ liệu nhạy cảm với Hồ Sơ Nhân Sự, Lương và Công/Phép — thay vào đó có số liệu tổng hợp trong module con "📊 Báo Cáo" cấp Nhân Sự (hợp đồng mới/gia hạn/sắp hết hạn, tăng lương).' },
      { label: 'Cảnh báo sắp hết hạn', text: 'hợp đồng đang hiệu lực còn ≤30 ngày hiện badge vàng, ≤7 ngày hoặc đã quá hạn hiện badge đỏ — cả ở danh sách lẫn chi tiết hợp đồng.' },
    ], right: [
      { label: 'Phụ lục "Ngày áp dụng" + "Giá trị cũ/mới"', text: '2 mốc thời gian riêng khi bổ sung thay đổi: "Ngày áp dụng" (tuỳ chọn) và "Ngày hiệu lực" (bắt buộc, có thể trễ hơn). Checkbox "💰 Giá trị tiền" (mặc định BẬT) tự định dạng dấu chấm phân cách hàng nghìn cho 2 ô Giá trị cũ/mới khi gõ — tắt khi cần gõ chữ tự do (đổi chức danh...). Danh sách phụ lục luôn sắp mới nhất lên đầu.' },
    ] },
  },
  hrReport: {
    icon: '📊', title: 'Báo Cáo (Nhân Sự)', badge: 'Nhân Sự',
    desc: 'Số liệu tổng hợp nhân sự (vào làm/nghỉ việc/tăng lương/thăng chức/tình trạng hợp đồng), lọc theo khoảng thời gian — module con RIÊNG cấp Nhân Sự (9/2026, trước đó từng nằm lồng bên trong Hồ Sơ Nhân Sự). KHÔNG tạo collection/route mới — vẫn đọc từ Hồ Sơ Nhân Sự + Hợp Đồng Lao Động, chỉ đổi nơi hiển thị cho đúng cấp module.',
    flow: { ariaLabel: 'Quy trình xem Báo Cáo Nhân Sự', chain: [
      { label: 'Chọn khoảng thời gian', sub: 'Từ ngày / Đến ngày (tuỳ chọn)' },
      { label: 'Lọc tình trạng HĐLĐ', sub: 'Tuỳ chọn, riêng cho danh sách hợp đồng' },
      { label: 'Xem số liệu', sub: '8 chỉ số + 6 danh sách chi tiết', kind: 'approved' },
    ] },
    footer: { left: [
      { label: 'Cần đủ 2 quyền', text: 'CẦN CẢ "Quản Lý Hồ Sơ Nhân Sự" LẪN "Quản Lý Hợp Đồng Lao Động" (hoặc admin) — chỉ có 1 trong 2 sẽ không thấy mục này, vì số liệu gộp cả 2 nguồn (kể cả tăng lương, vốn chỉ Quản Lý Hợp Đồng Lao Động mới xem được).' },
    ], right: [
      { label: 'Không phải báo cáo tổng hợp chung', text: 'tách biệt hoàn toàn khỏi màn "📊 Báo Cáo" (module Báo Cáo & Biểu Mẫu dùng chung) — dữ liệu nhân sự cực nhạy cảm nên có route + màn hình thống kê RIÊNG, gác đúng quyền của module Nhân Sự.' },
    ] },
  },
  hrAttendance: {
    icon: '🕒', title: 'Công / Phép', badge: 'Nhân Sự',
    desc: 'Đăng ký nghỉ phép theo loại phép và số ngày — duyệt theo cấp quản lý trực tiếp, tự trừ vào quỹ phép còn lại, tổng hợp công/phép theo tháng.',
    flow: { ariaLabel: 'Quy trình Công/Phép', chain: [
      { label: 'Đăng ký nghỉ phép', sub: 'Loại phép + số ngày' },
      { label: 'Duyệt', sub: 'Quản lý trực tiếp', kind: 'decision' },
      { label: 'Trừ quỹ phép', sub: 'Tự động', kind: 'approved' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Bị từ chối', sub: 'Không trừ quỹ phép' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Không hiện ở Báo Cáo chung', text: 'dữ liệu chấm công/phép không đưa vào báo cáo tổng hợp dùng chung, như các dữ liệu nhạy cảm khác của Nhân Sự.' },
    ], right: [] },
  },
  hrPayroll: {
    icon: '💴', title: 'Lương', badge: 'Nhân Sự — Dữ liệu nhạy cảm',
    desc: 'Tính lương theo tháng dựa trên Hợp Đồng Lao Động và dữ liệu Công/Phép — duyệt trước khi phát lương, lưu lại phiếu lương từng kỳ để tra cứu.',
    flow: { ariaLabel: 'Quy trình Lương', chain: [
      { label: 'Tính lương tháng', sub: 'Dựa trên HĐLĐ + Công/Phép' },
      { label: 'Duyệt', sub: '', kind: 'decision' },
      { label: 'Phát lương', sub: 'Lưu phiếu lương lịch sử', kind: 'approved' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Điều chỉnh', sub: 'Tính lại' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Không hiện ở Báo Cáo chung', text: 'dữ liệu lương cực kỳ nhạy cảm nên không đưa vào báo cáo tổng hợp dùng chung theo cách thông thường.' },
    ], right: [] },
  },
  hr: {
    icon: '🤝', title: 'Phản Hồi Ý Kiến (HCRC Đồng Hành)', badge: 'Nhân Sự',
    desc: 'Kênh nhân viên gửi phản hồi/góp ý nội bộ tới bộ phận Nhân Sự — Nhân Sự tiếp nhận, phản hồi lại và đóng khi đã xử lý xong.',
    flow: { ariaLabel: 'Quy trình Phản Hồi Ý Kiến', chain: [
      { label: 'Gửi phản hồi', sub: 'Nhân viên gửi góp ý' },
      { label: 'Tiếp nhận', sub: 'Nhân Sự xem & phản hồi', kind: 'approved' },
      { label: 'Đóng', sub: 'Đã xử lý xong' },
    ] },
    footer: { left: [], right: [] },
  },
  itSupport: {
    icon: '🎫', title: 'Hỗ Trợ Yêu Cầu (Ticket)', badge: 'Hỗ Trợ IT',
    desc: 'Ticket hỗ trợ sự cố hoặc gia hạn thiết bị/phần mềm — mở cho toàn bộ nhân viên tạo, chỉ đội Hỗ Trợ IT nhận xử lý. KHÁC HẲN "Phê Duyệt Giá Bán" (mục riêng bên dưới, quy trình duyệt bảng giá bán lẻ/bán buôn — không liên quan tới ticket này).',
    flow: { ariaLabel: 'Quy trình Hỗ Trợ Yêu Cầu (Ticket)', chain: [
      { label: 'Tạo ticket', sub: 'Sự cố / gia hạn' },
      { label: 'IT nhận xử lý', sub: 'TODO → DOING' },
      { label: 'Leo thang phê duyệt?', sub: 'Tuỳ chọn, khi cần người khác duyệt trước khi tiếp tục', kind: 'decision' },
      { label: 'Hoàn tất', sub: '', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Duyệt', rejectLabel: 'Từ chối', rejectBox: { label: 'Bị từ chối', sub: 'Gửi lại yêu cầu' }, loopBackToIndex: 1 } },
    footer: { left: [
      { label: 'Leo thang phê duyệt là tuỳ chọn', text: 'phần lớn ticket không cần bước này — đội IT chỉ gửi khi cần 1 người cụ thể (không nhất thiết có quyền itManage) duyệt trước khi tiếp tục xử lý, VD xin phê duyệt chi phí phát sinh ngoài luồng Phê Duyệt Giá Bán.' },
      { label: 'Từ chối khẩn cấp', text: 'chỉ đúng người đã duyệt bước leo thang cuối cùng mới gửi được yêu cầu Từ Chối Khẩn Cấp; bị khoá khi ticket đang ở trạng thái "Tôi đang xử lý".' },
    ], right: [
      { label: 'Chống trùng mã', text: 'nếu 2 người cùng tạo phiếu cùng lúc và mã bị trùng, hệ thống tự đổi sang mã kế tiếp — người dùng không thấy lỗi gì cả.' },
    ] },
  },
  // itPriceApproval — Đề Xuất Duyệt Giá Bán (module itPriceApprovals): TRƯỚC ĐÂY gộp chung 1 mô tả mơ hồ
  // với ticket "itSupport" ở trên (nhãn "Phê Duyệt Giá" bị hiểu nhầm là cùng 1 thứ) — sửa lại thành mục
  // RIÊNG theo đúng phản hồi người dùng (9/2026): "đây là phê duyệt giá bán buôn và giá bán lẻ khác
  // nhau", KHÔNG phải 1 quy trình chung — 2 sub-tab Bán Lẻ/Bán Buôn có field khác nhau VÀ đi qua 2 cấu
  // hình luồng duyệt khác nhau (itPriceDeptWorkflows theo phòng ban cho Bán Lẻ, itPriceTierWorkflows theo
  // mức Margin/Chiết Khấu cho Bán Buôn) — xem CREATE_MODULE_CONFIGS.itPriceApprovals.extraValidate ở
  // lib/createValidation.js.
  itPriceApproval: {
    icon: '🏷️', title: 'Phê Duyệt Giá Bán (Bán Lẻ / Bán Buôn)', badge: 'Hỗ Trợ IT',
    desc: 'Đề xuất duyệt bảng giá bán (tải lên tệp Excel nhiều dòng/mặt hàng) — Bán Lẻ và Bán Buôn là 2 QUY TRÌNH KHÁC NHAU thật sự (khác field bắt buộc, khác cấu hình luồng duyệt), không phải cùng 1 luồng dùng chung.',
    flow: { ariaLabel: 'Quy trình Phê Duyệt Giá Bán: Bán Lẻ theo phòng ban, Bán Buôn theo mức Margin/Chiết Khấu', chain: [
      { label: 'Tạo đề xuất', sub: 'Tải tệp bảng giá (.xlsx) + Lý do' },
      { label: 'Duyệt', sub: 'Bán Lẻ: theo phòng ban · Bán Buôn: theo mức Margin/Chiết Khấu', kind: 'decision' },
      { label: 'IT áp giá', sub: 'Đội Hỗ Trợ IT nhận & áp giá thật', kind: 'approved' },
      { label: 'Hoàn tất', sub: '' },
    ], decision: { atIndex: 1, approveLabel: 'Duyệt', rejectLabel: 'Từ chối', rejectBox: { label: 'Bị từ chối', sub: 'Sửa & gửi lại' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Bán Lẻ', text: 'chọn "Vùng Giá Áp Dụng" (không bắt buộc, từ danh mục hệ thống) — không có Margin/Chiết Khấu/Đơn Vị Áp Dụng. Tự gắn Ngày Áp Dụng = hôm nay, Vĩnh viễn, áp dụng Toàn bộ siêu thị (không hỏi lại).' },
      { label: 'Bán Buôn', text: 'BẮT BUỘC chọn Mức Margin/Chiết Khấu + nhập Đơn Vị Áp Dụng (khách hàng/đại lý ngoài) + chọn ít nhất 1 siêu thị/cửa hàng đề xuất + Ngày Áp Dụng (Ngày Hết Hiệu Lực tuỳ chọn, mặc định Vĩnh viễn) — không có Vùng Giá.' },
    ], right: [
      { label: 'Luồng duyệt tách biệt', text: 'Bán Lẻ duyệt theo cấu hình từng phòng ban (itPriceDeptWorkflows); Bán Buôn duyệt theo đúng mức Margin/Chiết Khấu đã chọn (itPriceTierWorkflows) — người duyệt mức này KHÔNG duyệt được hồ sơ mức khác.' },
      { label: 'Mẫu Giá (khuôn cột)', text: 'nếu hệ thống đã có ít nhất 1 Mẫu Giá thì bắt buộc chọn đúng mẫu khớp cột với tệp đang nộp — chỉ dùng để đối chiếu tên cột, không còn đối chiếu giá trị/tự động duyệt.' },
      { label: 'Yêu Cầu Bổ Sung', text: 'người duyệt hoặc đội IT có thể yêu cầu bổ sung tệp trước khi áp giá — hồ sơ bị khoá áp giá tới khi có tệp bổ sung mới (không ghi đè, chỉ nối thêm).' },
    ] },
  },
};

// Đào Tạo — module lớn, tách 6 khu vực con (pill sub-nav) thay vì 1 luồng đơn — sống trong module
// "Truyền Thông Nội Bộ" (internal) chứ KHÔNG phải 1 entry riêng của BUSINESS_MODULES.
const NGHIEP_VU_DAOTAO_AREAS = [
  { key: 'overview', label: 'Tổng Quan', icon: '🧭' },
  { key: 'classes', label: 'Lớp Học', icon: '🏫' },
  { key: 'programs', label: 'Chương Trình', icon: '📚' },
  { key: 'plans', label: 'Kế Hoạch Đào Tạo', icon: '🗓️' },
  { key: 'docs', label: 'Kho Tài Liệu', icon: '📦' },
  { key: 'bank', label: 'Ngân Hàng Câu Hỏi', icon: '❓' },
  { key: 'newhire', label: 'Lộ Trình Tân Binh', icon: '🆕' },
  { key: 'career', label: 'Lộ Trình Thăng Tiến', icon: '🪜' },
];

const NGHIEP_VU_DAOTAO_CONTENT = {
  overview: {
    desc: 'Sơ đồ quan hệ tổng quan — các phần của Đào Tạo không đứng độc lập mà gắn kết với nhau: 2 loại Lộ Trình (Tân Binh/Thăng Tiến) đều được xây từ nhiều Chương Trình, Chương Trình là khung để mở Lớp Học, Lớp Học lấy giáo trình từ Kho Tài Liệu và đề kiểm tra từ Ngân Hàng Câu Hỏi, có Giảng Viên đứng lớp (nếu học Offline) và mời Học Viên tham gia.',
    isCustomFlow: true,
    footer: { left: [
      { label: 'Lớp Học là trung tâm vận hành', text: 'mọi phần khác (Chương Trình, Kho Tài Liệu, Ngân Hàng Câu Hỏi, Giảng Viên) đều tồn tại để phục vụ 1 Lớp Học cụ thể — không có Lớp Học thì các danh mục kia chỉ là dữ liệu chờ dùng.' },
      { label: 'Giảng Viên khác Học Viên', text: '"Giảng Viên" là vai trò được gán riêng cho từng lớp Offline, chỉ quản lý/chấm đúng lớp mình được gán; "Học Viên" không phải hồ sơ riêng — là bất kỳ nhân viên nào đăng ký hoặc được mời vào lớp.' },
    ], right: [
      { label: '2 loại Lộ Trình khác nhau', text: 'Lộ Trình Tân Binh dành cho nhân viên mới (có đánh giá cuối kỳ và cấp chứng chỉ); Lộ Trình Thăng Tiến áp dụng xuyên suốt sự nghiệp, khoá theo từng bậc — cả 2 đều dùng chung danh mục Chương Trình, không phải 2 khái niệm trùng nhau.' },
    ] },
  },
  classes: {
    desc: 'Lớp học gắn với 1 Chương Trình — học viên đăng ký hoặc được gán vào lớp, học theo tài liệu và làm bài kiểm tra; câu hỏi tự luận cần giảng viên chấm tay thay vì tự động.',
    flow: { ariaLabel: 'Quy trình Lớp Học', chain: [
      { label: 'Mở lớp', sub: 'Chọn chương trình, thời gian' },
      { label: 'Học viên tham gia', sub: 'Đăng ký hoặc được gán' },
      { label: 'Làm bài kiểm tra', sub: 'Trắc nghiệm tự chấm', kind: 'decision' },
      { label: 'Hoàn thành lớp', sub: 'Đạt điểm yêu cầu', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Tự động', rejectLabel: 'Có câu tự luận', rejectBox: { label: 'Giảng viên chấm', sub: 'Chấm tay câu tự luận' }, loopBackToIndex: 2, loopBackLabel: 'Chấm xong → cộng điểm' } },
    footer: { left: [
      { label: 'Quét mã để vào bài', text: 'học viên quét mã QR để vào thẳng màn "Đăng Ký Của Tôi" và mở luôn bài làm, không cần dò tìm qua nhiều menu trên điện thoại.' },
      { label: 'Giảng Viên theo từng lớp', text: 'lớp Offline gán riêng 1 giảng viên — người này chỉ quản lý/chấm được đúng lớp mình được gán, khác người quản lý đào tạo chung (quản lý được mọi lớp).' },
    ], right: [
      { label: 'Nhập câu hỏi hàng loạt', text: 'có thể tải file mẫu để nhập nhiều câu hỏi cùng lúc thay vì tạo tay từng câu.' },
    ] },
  },
  programs: {
    desc: 'Chương Trình là khung nội dung tái sử dụng được cho nhiều Lớp Học khác nhau (VD "Đào tạo Quản lý ca" mở nhiều đợt/lớp theo thời gian).',
    flow: { ariaLabel: 'Quy trình Chương Trình', chain: [
      { label: 'Tạo chương trình', sub: 'Mục tiêu, nội dung khung' },
      { label: 'Gắn tài liệu + câu hỏi', sub: 'Từ Kho Tài Liệu / Ngân Hàng Câu Hỏi' },
      { label: 'Mở lớp theo chương trình', sub: 'Tái sử dụng nhiều lần', kind: 'approved' },
    ] },
    footer: { left: [], right: [] },
  },
  plans: {
    desc: 'Kế hoạch đào tạo theo năm/quý — liệt kê các chương trình dự kiến mở, có thể import từ file có sẵn thay vì nhập tay từng dòng.',
    flow: { ariaLabel: 'Quy trình Kế Hoạch Đào Tạo', chain: [
      { label: 'Lập kế hoạch', sub: 'Theo năm/quý' },
      { label: 'Import / nhập tay', sub: 'Danh sách chương trình dự kiến' },
      { label: 'Theo dõi thực hiện', sub: 'Đối chiếu lớp đã mở thực tế', kind: 'approved' },
    ] },
    footer: { left: [], right: [] },
  },
  docs: {
    desc: 'Kho tài liệu đào tạo dùng chung — tài liệu được gắn vào Chương Trình/Lớp Học, có theo dõi tiến độ đọc/xem của từng học viên.',
    flow: { ariaLabel: 'Quy trình Kho Tài Liệu Đào Tạo', chain: [
      { label: 'Tải tài liệu lên', sub: 'Gắn vào chương trình' },
      { label: 'Học viên xem', sub: 'Theo dõi tiến độ đọc', kind: 'approved' },
    ] },
    footer: { left: [], right: [] },
  },
  bank: {
    desc: 'Ngân hàng câu hỏi dùng chung cho nhiều bài kiểm tra — câu hỏi trắc nghiệm (tự chấm) hoặc tự luận (chấm tay), nhập được hàng loạt qua file mẫu.',
    flow: { ariaLabel: 'Quy trình Ngân Hàng Câu Hỏi', chain: [
      { label: 'Soạn câu hỏi', sub: 'Trắc nghiệm hoặc tự luận' },
      { label: 'Gắn vào bài kiểm tra', sub: 'Của 1 hoặc nhiều lớp', kind: 'approved' },
    ] },
    footer: { left: [], right: [] },
  },
  newhire: {
    desc: 'Lộ Trình Tân Binh — khác Lộ Trình Thăng Tiến ở chỗ áp dụng riêng cho nhân viên mới: 1 lộ trình gồm nhiều Chương Trình bắt buộc học, phân công cho từng người, kết thúc bằng đánh giá cuối kỳ và cấp chứng chỉ.',
    flow: { ariaLabel: 'Quy trình Lộ Trình Tân Binh', chain: [
      { label: 'Phân công lộ trình', sub: 'Gán 1 lộ trình cho nhân viên mới' },
      { label: 'Học theo Chương Trình', sub: 'Hoàn thành các Lớp Học liên quan' },
      { label: 'Đánh giá cuối kỳ', sub: '', kind: 'decision' },
      { label: 'Cấp Chứng Chỉ', sub: 'Hoàn tất lộ trình tân binh', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Đạt', rejectLabel: 'Chưa đạt', rejectBox: { label: 'Học bổ sung', sub: 'Chưa đủ điều kiện' }, loopBackToIndex: 1, loopBackLabel: 'Tiếp tục học' } },
    footer: { left: [
      { label: 'Khác Onboarding của Nhân Sự', text: 'đây là lộ trình HỌC (nội dung/Chương Trình), khác Onboarding/Offboarding (Nhân Sự) vốn là các việc hành chính theo mốc thời gian — 2 quy trình độc lập, không tự động liên kết với nhau.' },
    ], right: [
      { label: 'Không xoá phân công cũ', text: 'xoá 1 lộ trình khỏi danh mục không xoá dữ liệu phân công đã gán cho nhân viên trước đó — giữ nguyên lịch sử học tập.' },
    ] },
  },
  career: {
    desc: 'Lộ trình thăng tiến theo từng bậc tuần tự — mỗi bậc khoá cho tới khi đạt điều kiện bậc trước, không nhảy cóc bậc.',
    flow: { ariaLabel: 'Quy trình Lộ Trình Thăng Tiến', chain: [
      { label: 'Bậc 1', sub: 'Điều kiện khởi điểm' },
      { label: 'Bậc 2', sub: 'Khoá tới khi đạt Bậc 1', kind: 'decision' },
      { label: 'Bậc 3', sub: 'Khoá tới khi đạt Bậc 2', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Đạt', rejectLabel: 'Chưa đạt', rejectBox: { label: 'Giữ nguyên bậc', sub: 'Chưa mở khoá bậc kế' }, loopBackToIndex: 0, loopBackLabel: 'Tiếp tục tích luỹ' } },
    footer: { left: [
      { label: 'Khoá tuần tự', text: 'mỗi bậc chỉ mở khi bậc liền trước đã đạt — không thể đăng ký thẳng lên bậc cao hơn để "đi tắt".' },
    ], right: [] },
  },
};

let nvActiveKey = 'doc';
let nvActiveDaotaoArea = 'overview';

function setNVActiveKey(key) {
  nvActiveKey = key;
  renderNghiepVuModule();
}

function setNVDaotaoArea(areaKey) {
  nvActiveDaotaoArea = areaKey;
  renderNghiepVuContent();
}

function nvFindItem(key) {
  for (const g of NGHIEP_VU_NAV) {
    const it = g.items.find(i => i.key === key);
    if (it) return { group: g.group, item: it };
  }
  return null;
}

function renderNghiepVuModule() {
  const root = document.getElementById('nghiepVuRoot');
  if (!root) return;

  const navHtml = NGHIEP_VU_NAV.map(g => `
    <div class="nv-group">${escapeHtml(g.group)}</div>
    ${g.items.map(it => `
      <button type="button" class="nv-item${it.key === nvActiveKey ? ' active' : ''}" data-op="setNVActiveKey" data-arg0="${it.key}">${it.icon} ${escapeHtml(it.label)}</button>
    `).join('')}
  `).join('');

  root.innerHTML = `
    <div class="nv-app">
      <div class="nv-sidebar">${navHtml}</div>
      <div class="nv-main" id="nghiepVuMain"></div>
    </div>
  `;
  renderNghiepVuContent();
}

function renderNghiepVuContent() {
  const main = document.getElementById('nghiepVuMain');
  if (!main) return;
  const found = nvFindItem(nvActiveKey);
  if (!found) { main.innerHTML = ''; return; }
  const { group, item } = found;

  if (item.key === 'daotao') {
    main.innerHTML = renderNghiepVuDaotao(group);
    return;
  }

  const doc = NGHIEP_VU_DOCS[item.key];
  if (!doc) {
    main.innerHTML = `
      <div class="text-xs text-gray-400 mb-1">Nghiệp Vụ / ${escapeHtml(group)}</div>
      <h2 class="text-xl font-bold mb-3">${item.icon} ${escapeHtml(item.label)}</h2>
      <div class="p-4 bg-amber-50 border border-amber-300 rounded text-amber-800 text-sm font-bold">⚠️ Chưa có tài liệu nghiệp vụ cho mục này.</div>
    `;
    return;
  }

  main.innerHTML = `
    <div class="text-xs text-gray-400 mb-1">Nghiệp Vụ / ${escapeHtml(group)}</div>
    <div class="flex items-center gap-2 mb-1 flex-wrap">
      <h2 class="text-xl font-bold">${doc.icon} ${escapeHtml(doc.title)}</h2>
      ${doc.badge ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">${escapeHtml(doc.badge)}</span>` : ''}
    </div>
    <div class="text-[13.5px] text-gray-600 leading-relaxed max-w-3xl mb-5">${doc.desc}</div>
    <div class="text-[13px] font-bold uppercase tracking-wide text-gray-700 mb-3 pb-1.5 border-b">Sơ đồ quy trình</div>
    ${renderNVFlow(doc.flow)}
    <div class="nv-footer-grid">
      ${nvFooterCol('Lưu Ý Quan Trọng', doc.footer.left)}
      ${nvFooterCol('Mẹo & Quy Tắc Hay Gặp', doc.footer.right)}
    </div>
  `;
}

function renderNghiepVuDaotao(group) {
  const area = NGHIEP_VU_DAOTAO_CONTENT[nvActiveDaotaoArea];
  const pills = NGHIEP_VU_DAOTAO_AREAS.map(a => `
    <button type="button" class="nv-pill${a.key === nvActiveDaotaoArea ? ' active' : ''}" data-op="setNVDaotaoArea" data-arg0="${a.key}">${a.icon} ${escapeHtml(a.label)}</button>
  `).join('');
  const areaMeta = NGHIEP_VU_DAOTAO_AREAS.find(a => a.key === nvActiveDaotaoArea);
  const diagramTitle = area.isCustomFlow ? 'Sơ đồ quan hệ' : 'Sơ đồ quy trình';
  const diagramHtml = area.isCustomFlow ? renderNVDaotaoOverview() : renderNVFlow(area.flow);
  return `
    <div class="text-xs text-gray-400 mb-1">Nghiệp Vụ / ${escapeHtml(group)}</div>
    <div class="flex items-center gap-2 mb-1 flex-wrap">
      <h2 class="text-xl font-bold">🎓 Đào Tạo</h2>
      <span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">${NGHIEP_VU_DAOTAO_AREAS.length} khu vực nghiệp vụ</span>
    </div>
    <div class="text-[13.5px] text-gray-600 leading-relaxed max-w-3xl mb-5">Module lớn nhất trong Truyền Thông Nội Bộ — quản lý toàn bộ vòng đời đào tạo: Chương Trình khung nội dung, Lớp Học mở theo đợt (có Giảng Viên + Học Viên), Kế Hoạch Đào Tạo theo năm, Kho Tài Liệu, Ngân Hàng Câu Hỏi dùng chung, Lộ Trình Tân Binh (nhân viên mới) và Lộ Trình Thăng Tiến (theo bậc) — xem mục "🧭 Tổng Quan" để hiểu mối liên hệ giữa các chức năng này.</div>
    <div class="nv-pill-bar">${pills}</div>
    <h3 class="text-base font-bold mb-1">${areaMeta.icon} ${escapeHtml(areaMeta.label)}</h3>
    <div class="text-[13px] text-gray-600 leading-relaxed max-w-3xl mb-4">${area.desc}</div>
    <div class="text-[13px] font-bold uppercase tracking-wide text-gray-700 mb-3 pb-1.5 border-b">${diagramTitle}</div>
    ${diagramHtml}
    <div class="nv-footer-grid">
      ${nvFooterCol('Lưu Ý Quan Trọng', area.footer.left)}
      ${nvFooterCol('Mẹo & Quy Tắc Hay Gặp', area.footer.right)}
    </div>
  `;
}
