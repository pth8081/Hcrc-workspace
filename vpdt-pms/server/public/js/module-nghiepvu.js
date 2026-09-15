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
  { group: 'Vận Hành', items: [
    { key: 'vanHanh', icon: '📦', label: 'Đơn Hàng & Mở Mới/Sửa Chữa Siêu Thị' },
    { key: 'checklist', icon: '✅', label: 'Checklist Đánh Giá Siêu Thị' },
  ]},
  { group: 'Nhân Sự', items: [
    { key: 'orgChart', icon: '🗂️', label: 'Cơ Cấu Tổ Chức' },
    { key: 'hrLifecycle', icon: '🆕', label: 'Onboarding / Offboarding' },
    { key: 'hrProfile', icon: '👤', label: 'Hồ Sơ Nhân Sự' },
    { key: 'hrContract', icon: '📄', label: 'Hợp Đồng Lao Động' },
    { key: 'hrAttendance', icon: '🕒', label: 'Công / Phép' },
    { key: 'hrPayroll', icon: '💴', label: 'Lương' },
    { key: 'hr', icon: '🤝', label: 'Phản Hồi Ý Kiến (HCRC Đồng Hành)' },
  ]},
  { group: 'Hỗ Trợ IT', items: [
    { key: 'itSupport', icon: '🎫', label: 'Hỗ Trợ Yêu Cầu & Phê Duyệt Giá' },
  ]},
];

// ===================== SVG flow renderer (dùng chung, không phụ thuộc thư viện ngoài) =====================
// Phong cách tham khảo theo ảnh người dùng gửi: node bo góc, mũi tên có hướng, khung tham chiếu nét đứt
// nối vào luồng bằng mũi tên nét đứt (nhãn "tham chiếu"), node quyết định viền xanh nổi bật rẽ 2 nhánh
// màu (xanh = duyệt tiếp, đỏ = từ chối), mũi tên vòng lặp cong quay lại bước trước đó khi bị từ chối.

function nvArrowMarker(id, color) {
  return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`;
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
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
  out += `<text x="${x + w / 2}" y="${y + h / 2 - (sub ? 6 : -1)}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#111827">${escapeHtml(label)}</text>`;
  if (sub) out += `<text x="${x + w / 2}" y="${y + h / 2 + 14}" text-anchor="middle" font-size="10.5" fill="#6b7280">${escapeHtml(sub)}</text>`;
  return out;
}

function nvEdge(x1, y1, x2, y2, opts = {}) {
  const color = opts.color || '#9ca3af';
  const marker = opts.marker || 'nv-arrow';
  const dash = opts.dashed ? ' stroke-dasharray="4,4"' : '';
  let out = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.75"${dash} marker-end="url(#${marker})"/>`;
  if (opts.label) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 8;
    out += `<text x="${mx}" y="${my}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${color}">${escapeHtml(opts.label)}</text>`;
  }
  return out;
}

function nvCurve(x1, y1, x2, y2, opts = {}) {
  const color = opts.color || '#9ca3af';
  const dip = opts.dip != null ? opts.dip : 46;
  const dipY = Math.max(y1, y2) + dip;
  const path = `M ${x1} ${y1} C ${x1} ${dipY}, ${x2} ${dipY}, ${x2} ${y2}`;
  let out = `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.75" marker-end="url(#nv-arrow-gray)"/>`;
  if (opts.label) out += `<text x="${(x1 + x2) / 2}" y="${dipY + 4}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${color}">${escapeHtml(opts.label)}</text>`;
  return out;
}

// spec = { ariaLabel, chain:[{label,sub,kind?}], decision?:{atIndex,approveLabel,rejectLabel,rejectBox:{label,sub},loopBackToIndex,loopBackLabel}, reference?:{atIndex,label,sub} }
function renderNVFlow(spec) {
  const nodeW = 152, nodeH = 62, gapX = 54, marginX = 40;
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

  return `<svg viewBox="0 0 ${totalW} ${height}" role="img" aria-label="${escapeHtml(spec.ariaLabel || 'Sơ đồ quy trình')}" style="width:100%;height:auto;max-width:920px;display:block;margin:0 auto;">${svg}</svg>`;
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
    giangvien:  { x: 96,  y: 364, w: 176, h: 58, label: 'Giảng Viên', sub: 'instructorUsername (lớp Offline)', kind: 'actor' },
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

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sơ đồ quan hệ tổng quan Đào Tạo" style="width:100%;height:auto;max-width:920px;display:block;margin:0 auto;">${svg}</svg>`;
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
    desc: 'Quản lý văn bản nội bộ theo mã tự sinh, versioning theo "gia đình" tài liệu (mỗi lần cập nhật tạo 1 phiên bản mới), phê duyệt theo quy trình từng phòng ban.',
    flow: { ariaLabel: 'Quy trình Tài Liệu: Tạo mới, Duyệt, Bổ Sung', chain: [
      { label: 'Tạo mới', sub: 'Chọn phòng ban + phân loại, tải file' },
      { label: 'PENDING', sub: 'Duyệt theo cấu hình từng phòng ban', kind: 'decision' },
      { label: 'APPROVED', sub: 'Có thể tạo version mới', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Duyệt xong', rejectLabel: 'Từ chối', rejectBox: { label: 'DRAFT', sub: 'Về "Sửa & Gửi Lại"' }, loopBackToIndex: 1, loopBackLabel: 'Sửa & gửi lại → PENDING bước 1' } },
    footer: { left: [
      { label: 'Quyền xem', text: 'hợp của 4 nhánh độc lập: admin · chính người tải lên (mọi trạng thái) · <code>viewApprovedDepts</code> (chỉ bản đã duyệt) / <code>viewDraftDepts</code> (chỉ bản chưa duyệt) — 2 quyền KHÔNG cộng ngầm · người duyệt đúng phòng ban.' },
      { label: 'Versioning', text: 'không tạo được version mới nếu bản mới nhất đang PENDING/DRAFT; REJECTED thì không chặn.' },
    ], right: [
      { label: 'Mã trùng', text: 'server tự sinh lại mã kế tiếp khi phát hiện trùng (kể cả 2 người tạo cùng lúc), không báo lỗi cho người dùng.' },
    ] },
  },
  submission: {
    icon: '📜', title: 'Văn Bản Trình / Tờ Trình', badge: 'Duyệt nhiều lớp',
    desc: 'Tờ trình nội bộ với số lớp phê duyệt cấu hình được (không cố định 1 bước) — mỗi lớp là 1 nhóm người duyệt độc lập, phải qua hết lớp trước mới tới lớp sau.',
    flow: { ariaLabel: 'Quy trình Văn Bản Trình', chain: [
      { label: 'Soạn thảo', sub: 'DRAFT, chọn số lớp duyệt' },
      { label: 'PENDING', sub: 'Duyệt tuần tự từng lớp', kind: 'decision' },
      { label: 'APPROVED', sub: 'Ban hành / lưu trữ', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Đủ các lớp', rejectLabel: 'Từ chối', rejectBox: { label: 'REJECTED', sub: 'Bắt buộc nêu lý do' }, loopBackToIndex: 0, loopBackLabel: 'Sửa & trình lại' } },
    footer: { left: [
      { label: 'Lớp duyệt độc lập', text: 'mỗi lớp có danh sách người duyệt riêng (renderSubmissionApprovalLayerCheckboxes) — qua lớp N mới hiện lớp N+1, không thể "duyệt tắt".' },
    ], right: [
      { label: 'Không tự duyệt', text: 'người tạo tờ trình không được nằm trong danh sách duyệt của chính tờ trình đó.' },
    ] },
  },
  contract: {
    icon: '📁', title: 'Hợp Đồng', badge: 'Trình duyệt + theo dõi hiệu lực',
    desc: 'Hợp đồng với đối tác/nhà cung cấp — tạo mới, trình duyệt theo lớp (giống Văn Bản Trình), sau khi ACTIVE thì hệ thống theo dõi hiệu lực để cảnh báo trước khi hết hạn.',
    flow: { ariaLabel: 'Quy trình Hợp Đồng', chain: [
      { label: 'Soạn hợp đồng', sub: 'DRAFT, đính kèm file' },
      { label: 'PENDING', sub: 'Trình duyệt theo lớp', kind: 'decision' },
      { label: 'ACTIVE', sub: 'Theo dõi ngày hết hạn', kind: 'approved' },
      { label: 'EXPIRED / Thanh lý', sub: 'Kết thúc hiệu lực' },
    ], decision: { atIndex: 1, approveLabel: 'Duyệt', rejectLabel: 'Từ chối', rejectBox: { label: 'DRAFT', sub: 'Sửa lại điều khoản' }, loopBackToIndex: 0 },
      reference: { atIndex: 0, label: 'Danh Mục Đối Tác', sub: 'Loại hợp đồng, đơn vị' } },
    footer: { left: [
      { label: 'Cảnh báo hết hạn', text: 'hợp đồng ACTIVE gần tới ngày hết hạn được nhắc trước (xem module-hopdong.js) để chủ động gia hạn/thanh lý, tránh trôi hiệu lực âm thầm.' },
    ], right: [
      { label: 'Thanh Toán liên kết', text: 'chi phí thực tế phát sinh từ hợp đồng được ghi nhận qua module Thanh Toán (Tổng Hợp), liên kết ngược về đúng hợp đồng gốc.' },
    ] },
  },
  minutes: {
    icon: '📝', title: 'Biên Bản Họp', badge: 'Điều Hành',
    desc: 'Ghi nhận nội dung + điểm danh cuộc họp, có thể liên kết tới 1 lịch đặt phòng (nếu có), và sinh Công Việc trực tiếp từ các đầu việc thống nhất trong biên bản.',
    flow: { ariaLabel: 'Quy trình Biên Bản Họp', chain: [
      { label: 'Tạo biên bản', sub: 'Liên kết cuộc họp (tuỳ chọn)' },
      { label: 'Điểm danh + nội dung', sub: 'Ghi nhận thảo luận, quyết nghị' },
      { label: 'Chốt & lưu', sub: 'Sinh Công Việc cho đầu việc', kind: 'approved' },
    ] },
    footer: { left: [
      { label: 'Quyền tạo', text: 'chỉ người có <code>canCreateMeetingMinutes</code> mới thấy form tạo — người khác chỉ xem.' },
    ], right: [
      { label: 'Mẫu điểm danh', text: 'có thể lưu "mẫu người tham dự" (renderMeetingAttendeeTemplateSelect) để không phải chọn lại danh sách mỗi lần họp định kỳ.' },
    ] },
  },
  task: {
    icon: '📋', title: 'Công Việc', badge: 'Điều Hành',
    desc: 'Giao việc có người giao/người nhận, hạn hoàn thành, cập nhật tiến độ theo trạng thái — có thể tự sinh từ 1 đầu việc trong Biên Bản Họp.',
    flow: { ariaLabel: 'Quy trình Công Việc', chain: [
      { label: 'Giao việc', sub: 'Người giao tạo, gán hạn' },
      { label: 'Đang thực hiện', sub: 'Người nhận cập nhật tiến độ' },
      { label: 'Chờ nghiệm thu', sub: 'Người nhận báo hoàn thành', kind: 'decision' },
      { label: 'Hoàn thành', sub: 'Người giao xác nhận', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Đạt', rejectLabel: 'Chưa đạt', rejectBox: { label: 'Trả lại', sub: 'Yêu cầu làm lại' }, loopBackToIndex: 1, loopBackLabel: 'Tiếp tục thực hiện' } },
    footer: { left: [
      { label: 'Quản lý việc của người khác', text: '<code>canManageTasks</code> mới thấy nút tạo việc thủ công cho người khác — nhân viên thường chỉ tự cập nhật việc của mình.' },
    ], right: [] },
  },
  periodicReport: {
    icon: '📅', title: 'Báo Cáo Định Kỳ', badge: 'Điều Hành',
    desc: 'Báo cáo lặp lại theo chu kỳ (tuần/tháng/quý) — người phụ trách nhập số liệu theo mẫu, nộp đúng hạn, sau đó tổng hợp thành bản trình chiếu chung.',
    flow: { ariaLabel: 'Quy trình Báo Cáo Định Kỳ', chain: [
      { label: 'Cấu hình kỳ', sub: 'Mẫu + tần suất (admin)' },
      { label: 'Nhập số liệu', sub: 'DRAFT theo phòng ban' },
      { label: 'Nộp báo cáo', sub: 'Đúng hạn kỳ báo cáo' },
      { label: 'Tổng hợp & trình chiếu', sub: 'Gộp toàn bộ phòng ban', kind: 'approved' },
    ] },
    footer: { left: [
      { label: 'Nhắc hạn', text: 'hệ thống nhắc các phòng ban chưa nộp khi gần tới hạn kỳ báo cáo, tránh thiếu số liệu khi tổng hợp.' },
    ], right: [
      { label: 'Khác "Báo Cáo"', text: 'đây là 1 QUY TRÌNH nghiệp vụ chủ động (nộp theo kỳ); màn "📊 Báo Cáo" ở cuối sidebar chỉ đọc số liệu tổng hợp thụ động, không có luồng riêng.' },
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
      { label: 'Chặn trùng lịch', text: 'server từ chối đặt nếu khung giờ đã có người giữ cùng phòng — không cần người dùng tự tra lịch trước.' },
    ], right: [] },
  },
  car: {
    icon: '🚗', title: 'Đăng Ký Xe', badge: 'Cập nhật v23.4',
    desc: 'Đăng ký lịch trình công tác cần xe — sau khi duyệt, bộ phận điều phối gán xe/tài xế cụ thể cho chuyến đi; lái xe nhận chuyến/kết thúc chuyến/báo km, người đăng ký đánh giá lại sau khi kết thúc. Tab Báo Cáo có đủ lịch sử đánh giá + xác nhận + biểu đồ xu hướng chọn kỳ.',
    flow: { ariaLabel: 'Quy trình Đăng Ký Xe', chain: [
      { label: 'Đăng ký lịch trình', sub: 'Điểm đi/đến, thời gian' },
      { label: 'Duyệt', sub: 'Theo cấu hình phòng ban', kind: 'decision' },
      { label: 'Điều phối xe', sub: 'Gán xe + tài xế', kind: 'approved' },
      { label: 'Lái xe xác nhận & kết thúc', sub: 'Nhận chuyến → báo km khi xong' },
      { label: 'Đánh giá & hoàn tất', sub: 'Người đăng ký xác nhận lại' },
    ], decision: { atIndex: 1, rejectBox: { label: 'REJECTED', sub: 'Nêu lý do' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Điều phối tách biệt', text: 'người duyệt đăng ký khác với người điều phối xe — điều phối chỉ thao tác sau khi đăng ký đã ở trạng thái duyệt.' },
      { label: 'Đánh giá & xác nhận', text: 'lái xe tự xác nhận nhận chuyến (driverConfirmedAt) rồi báo km khi kết thúc (tripEndedAt/driverReportedKm); người đăng ký đánh giá lại sau đó (evaluatedBy/evaluatedAt/actualKm/nhận xét) mới chuyển COMPLETED.' },
    ], right: [
      { label: 'Báo Cáo: Lịch Sử Đánh Giá + Xác Nhận', text: 'sub-tab 📊 Báo Cáo có 2 bảng chi tiết "ai đánh giá lái xe nào, phiếu nào, nhận xét gì" và "lái xe xác nhận/kết thúc phiếu nào, lúc nào, báo bao nhiêu km".' },
      { label: 'Biểu đồ xu hướng chọn kỳ', text: 'biểu đồ số chuyến + số km theo Ngày/Tuần/Tháng/Quý/Năm (pill filter), tách biệt với Lịch Xe (xem lịch trực quan theo Ngày/Tuần/Tháng, không phải biểu đồ thống kê).' },
    ] },
  },
  vpp: {
    icon: '🖇️', title: 'Văn Phòng Phẩm', badge: 'Hành Chính',
    desc: 'Đăng ký mua văn phòng phẩm từ danh mục mặt hàng có sẵn — hệ thống tự kiểm tra ngân sách còn lại của phòng ban (mức/người hoặc tổng phòng, tuỳ cấu hình) trước khi cho gửi.',
    flow: { ariaLabel: 'Quy trình Văn Phòng Phẩm', chain: [
      { label: 'Chọn mặt hàng', sub: 'Từ Danh Mục VPP' },
      { label: 'Kiểm tra ngân sách', sub: 'Tự động, theo phòng ban', kind: 'decision' },
      { label: 'Duyệt & cấp phát', sub: '', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Đủ hạn mức', rejectLabel: 'Vượt hạn mức', rejectBox: { label: 'Chặn gửi', sub: 'Không cho vượt mức' }, loopBackToIndex: 0, loopBackLabel: 'Giảm số lượng' },
      reference: { atIndex: 0, label: 'Danh Mục Mặt Hàng', sub: 'Đơn giá, hạn mức' } },
    footer: { left: [
      { label: 'Ngân sách theo phòng ban', text: 'admin cấu hình mức/người khác nhau HOẶC chặn theo tổng ngân sách cả phòng — 2 kiểu không dùng đồng thời cho cùng 1 phòng.' },
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
    ], decision: { atIndex: 1, rejectBox: { label: 'REJECTED', sub: '' }, loopBackToIndex: 0 } },
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
      { label: 'Phát hành', sub: 'Sinh key/seat', kind: 'approved' },
      { label: 'Phân bổ / Cấp phát', sub: 'Gán cho người dùng cuối' },
    ], decision: { atIndex: 2, approveLabel: 'duyệt', rejectLabel: 'từ chối', rejectBox: { label: 'Từ chối mua', sub: 'Nêu lý do' }, loopBackToIndex: 1, loopBackLabel: 'Đăng ký lại' },
      reference: { atIndex: 0, label: 'Danh Mục Nền Tảng', sub: 'Tên phần mềm, NCC' } },
    footer: { left: [
      { label: 'max_assignees', text: 'mỗi bản quyền có giới hạn số người được gán cùng lúc (<code>max_assignees</code>) — hệ thống chặn phân bổ vượt số seat đã phát hành.' },
      { label: 'Thu hồi khi Offboarding', text: 'khi 1 nhân sự hoàn tất Offboarding, license đang gán cho họ tự chuyển về trạng thái "sẵn sàng cấp lại", không cần thao tác tay riêng.' },
    ], right: [
      { label: 'Gia hạn', text: 'license sắp hết hạn được nhắc trước để tạo Kỳ mua gia hạn kịp thời, tránh gián đoạn phần mềm đang dùng.' },
    ] },
  },
  office: {
    icon: '🛒', title: 'Mua Bán / Sửa Chữa / Thanh Toán', badge: 'Tổng Hợp',
    desc: 'Đề xuất mua sắm hoặc sửa chữa (2 sub-tab MUA_BAN/SUA_CHUA), sau khi duyệt và thực hiện thì chi phí thực tế được ghi nhận ở sub-tab Thanh Toán, liên kết ngược về đề xuất gốc.',
    flow: { ariaLabel: 'Quy trình Mua Bán/Sửa Chữa/Thanh Toán', chain: [
      { label: 'Đề xuất', sub: 'MUA_BAN hoặc SUA_CHUA' },
      { label: 'Duyệt theo lớp', sub: '', kind: 'decision' },
      { label: 'Thực hiện', sub: 'Mua/sửa thực tế', kind: 'approved' },
      { label: 'Thanh Toán', sub: 'Ghi nhận chi phí thực tế' },
    ], decision: { atIndex: 1, rejectBox: { label: 'REJECTED', sub: 'Nêu lý do' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Hạng mục chi tiết', text: 'đề xuất có danh sách hạng mục con (officeItemsSection) — mỗi hạng mục 1 dòng số lượng/đơn giá riêng, không chỉ 1 tổng tiền duy nhất.' },
    ], right: [
      { label: 'Người duyệt Thanh Toán', text: '<code>paymentManage</code>/admin hoặc approver đúng bước trong paymentDeptWorkflows mới thấy được ghi nhận thanh toán.' },
    ] },
  },
  budget: {
    icon: '💰', title: 'Ngân Sách 2.0', badge: 'Cập nhật v23.3',
    desc: '3 giai đoạn ĐỘC LẬP (không phải 1 pipeline tuyến tính) — mỗi dòng ngân sách tự mang Năm/Tháng riêng, không còn khái niệm "Kỳ ngân sách" chung. Vị trí HO/Siêu Thị chọn theo 2 bước (mirror màn Người Dùng), có Tải Mẫu/Nhập/Xuất Excel.',
    flow: { ariaLabel: 'Quy trình Ngân Sách 2.0: 3 giai đoạn độc lập', chain: [
      { label: 'Đề Xuất', sub: 'budgetCreate tạo → SUBMITTED', kind: 'decision' },
      { label: 'Phê Duyệt', sub: 'Tự sinh khi Đề Xuất duyệt xong' },
      { label: 'Sử Dụng', sub: 'Dòng cha hệ thống tự sinh', kind: 'approved' },
    ], decision: { atIndex: 0, approveLabel: 'Duyệt', rejectLabel: 'Từ chối', rejectBox: { label: 'REJECTED', sub: 'Sửa & gửi lại' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Zero-trust field locking', text: 'server LUÔN ghi đè content/loại hạng mục từ dòng nguồn khi sinh dòng Sử Dụng — không tin bất kỳ giá trị nào client gửi lên; Vị trí = Siêu Thị cũng tự gán <code>dept</code> = đúng tên Siêu Thị theo cùng nguyên tắc.' },
      { label: 'Không tự duyệt hồ sơ mình tạo', text: 'áp dụng cho MỌI vai trò kể cả admin, không có ngoại lệ.' },
    ], right: [
      { label: 'budgetCreate', text: 'tạo/sửa/xoá Đề Xuất của mình · ghi nhận Sử Dụng cho phòng/siêu thị mình.' },
      { label: 'budgetManage', text: 'toàn quyền: duyệt Đề Xuất, tạo/duyệt Phê Duyệt, sửa/xoá dòng Sử Dụng cha.' },
      { label: 'budgetAggregate', text: 'xem xuyên phòng ban + tab Báo Cáo, không tạo/duyệt được gì.' },
      { label: 'Excel Tải Mẫu/Nhập/Xuất', text: 'tab Đề Xuất/Phê Duyệt có đủ 3 nút; Sử Dụng/Báo Cáo chỉ có Xuất Excel.' },
    ] },
  },
  vanHanh: {
    icon: '📦', title: 'Đơn Hàng & Mở Mới/Sửa Chữa Siêu Thị', badge: 'Vận Hành',
    desc: 'Hai luồng: Đơn Hàng (mua hàng vận hành theo đợt) và Mở Mới/Sửa Chữa Siêu Thị (dự án nhiều mốc tiến độ, có lịch sử cập nhật từng mốc).',
    flow: { ariaLabel: 'Quy trình Mở Mới/Sửa Chữa Siêu Thị', chain: [
      { label: 'Đề xuất dự án', sub: 'Mở mới hoặc sửa chữa' },
      { label: 'Duyệt', sub: '', kind: 'decision' },
      { label: 'Các mốc tiến độ', sub: 'Theo template mốc đã cấu hình', kind: 'approved' },
      { label: 'Hoàn tất', sub: 'Đủ mốc bắt buộc' },
    ], decision: { atIndex: 1, rejectBox: { label: 'REJECTED', sub: '' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Lịch sử theo mốc', text: 'mỗi mốc tiến độ có lịch sử cập nhật + đính kèm riêng (operationProcessModalHistory) — không ghi đè, xem lại được toàn bộ diễn biến dự án.' },
    ], right: [
      { label: 'Đơn Hàng', text: 'luồng tách biệt (operationOrders) — tạo đơn → duyệt → xử lý → hoàn tất, không đi qua các mốc tiến độ dự án.' },
    ] },
  },
  checklist: {
    icon: '✅', title: 'Checklist Đánh Giá Siêu Thị', badge: 'Cập nhật v23.4',
    desc: 'Bộ tiêu chí đánh giá (hạng mục/câu hỏi/điểm) do admin cấu hình sẵn thành template — người đánh giá chọn siêu thị rồi chấm theo đúng bộ tiêu chí đã kích hoạt. Vòng đời template: Nháp → Đang dùng → Lưu trữ, với Dừng/Sửa/Xoá theo đúng trạng thái + quyền.',
    flow: { ariaLabel: 'Quy trình Checklist Đánh Giá Siêu Thị', chain: [
      { label: 'Cấu hình template', sub: 'Hạng mục, câu hỏi, điểm (admin)' },
      { label: 'Kích hoạt', sub: 'Chỉ 1 bản ACTIVE mỗi lúc' },
      { label: 'Chấm điểm', sub: 'Chọn siêu thị, trả lời từng mục', kind: 'approved' },
      { label: 'Nộp & tổng hợp', sub: 'Tự tính điểm/xếp loại' },
    ] },
    footer: { left: [
      { label: 'Tiếp tục dở dang', text: 'bài chấm chưa nộp có thể "Tiếp Tục" thay vì làm lại từ đầu (resumeChecklistSubmission).' },
      { label: 'Nhân bản template', text: 'có thể nhân bản 1 template có sẵn để chỉnh sửa nhanh thay vì dựng lại từ đầu — nhân bản được từ CẢ Đang dùng lẫn Lưu trữ (trước v23.4 chỉ nhân bản được từ Đang dùng).' },
    ], right: [
      { label: '⏸️ Dừng (Đang dùng → Lưu trữ)', text: 'dừng thủ công 1 template Đang dùng mà KHÔNG cần kích hoạt bản thay thế — khác "Kích hoạt" (tự lưu trữ các bản Đang dùng cùng mã khi kích hoạt bản MỚI).' },
      { label: '✏️ Sửa (Đang dùng/Lưu trữ)', text: 'KHÔNG sửa trực tiếp được (bảo toàn dữ liệu bài đã nộp cũ) — bấm "Sửa" sẽ tự Nhân Bản thành 1 bản Nháp mới rồi mở thẳng form sửa (gộp 2 bước cũ thành 1 click).' },
      { label: '🗑️ Xoá — chỉ Admin', text: 'nút Xoá CHỈ Admin (quyền cao nhất) thấy được, ở MỌI trạng thái — khoá mờ + không xoá được nếu template đã có người nộp bài (checklistSubmissions tham chiếu), dùng "⏸️ Dừng" thay thế để tránh mất dữ liệu báo cáo cũ.' },
    ] },
  },
  orgChart: {
    icon: '🗂️', title: 'Cơ Cấu Tổ Chức', badge: 'Nhân Sự',
    desc: 'Sơ đồ tổ chức theo phiên bản (version) — mỗi lần thay đổi vị trí/người phụ trách tạo 1 version mới, các version cũ giữ nguyên để tra cứu lịch sử, không sửa trực tiếp lên bản cũ.',
    flow: { ariaLabel: 'Quy trình Cơ Cấu Tổ Chức', chain: [
      { label: 'Version hiện hành', sub: 'Đang áp dụng' },
      { label: 'Chỉnh sửa', sub: 'Thêm/sửa/xoá vị trí, gán người' },
      { label: 'Version mới', sub: 'Tự tăng số version', kind: 'approved' },
    ] },
    footer: { left: [
      { label: 'Không sửa version cũ', text: 'mọi thay đổi luôn tạo version MỚI — version cũ chỉ xem, không chỉnh sửa lại được (đảm bảo lịch sử không bị viết đè).' },
    ], right: [] },
  },
  hrLifecycle: {
    icon: '🆕', title: 'Onboarding / Offboarding', badge: 'Quy trình theo mốc (staged checklist)',
    desc: 'Tự sinh checklist theo mốc thời gian từ danh mục cấu hình sẵn (Checklist Mẫu) — mỗi việc gắn nhãn trách nhiệm HR/IT/ADMIN/FINANCE/MANAGER, tự hoàn tất khi xong hết việc bắt buộc.',
    flow: { ariaLabel: 'Quy trình Onboarding 4 mốc', chain: [
      { label: 'Chuẩn bị trước ngày đi làm', sub: 'PRE_BOARDING' },
      { label: 'Ngày đầu tiên', sub: 'FIRST_DAY' },
      { label: 'Tuần/Tháng đầu', sub: 'TRAINING' },
      { label: 'Kết thúc thử việc', sub: 'PROBATION_REVIEW', kind: 'approved' },
    ] },
    footer: { left: [
      { label: 'Hoàn tất Offboarding tự động', text: 'khoá tài khoản đăng nhập + huỷ mọi phiên đang mở + chuyển Hợp Đồng Lao Động sang TERMINATED, không cần thao tác tay.' },
      { label: 'Cổng chặn "Người kế nhiệm"', text: 'nếu người sắp nghỉ còn đang là quản lý trực tiếp của ai, Offboarding DỪNG ở "Chờ chỉ định người kế nhiệm" dù đã xong hết việc — HR chỉ định xong mới tự hoàn tất.' },
    ], right: [
      { label: 'Cầu nối IT', text: 'việc gắn nhãn IT có thể sinh 1 Ticket Hỗ Trợ IT liên kết; hệ thống KHÔNG tự tạo tài khoản đăng nhập — IT vẫn phải tạo thủ công ngoài hệ thống.' },
      { label: 'hrOnboardingManage / hrOffboardingManage', text: 'quản lý đúng loại quy trình; <code>hrViewAll</code> chỉ xem, không thao tác được kể cả bỏ qua việc bắt buộc.' },
    ] },
  },
  hrProfile: {
    icon: '👤', title: 'Hồ Sơ Nhân Sự', badge: 'Dữ liệu nhạy cảm',
    desc: 'Hồ sơ cá nhân từng nhân viên (thông tin, giấy tờ đính kèm) — liên kết với Hợp Đồng Lao Động/Lương/Công Phép của cùng người.',
    flow: { ariaLabel: 'Quy trình Hồ Sơ Nhân Sự', chain: [
      { label: 'Tạo hồ sơ', sub: 'Từ Onboarding hoặc tạo tay' },
      { label: 'Cập nhật thông tin', sub: 'Giấy tờ, liên hệ, quá trình' },
      { label: 'Lưu trữ', sub: 'Xuyên suốt vòng đời nhân sự', kind: 'approved' },
    ] },
    footer: { left: [
      { label: 'Chặn khỏi Báo Cáo chung', text: 'thuộc nhóm dữ liệu CỰC NHẠY CẢM, bị chặn hẳn khỏi <code>GET /api/data</code> chung (xem routes/data.js) — không hiện trong màn Báo Cáo tổng hợp như các module khác.' },
    ], right: [] },
  },
  hrContract: {
    icon: '📄', title: 'Hợp Đồng Lao Động', badge: 'Nhân Sự',
    desc: 'HĐLĐ thử việc tự sinh khi bắt đầu Onboarding, chuyển sang chính thức khi ký kết — tự động TERMINATED khi Offboarding hoàn tất, không cần đổi tay.',
    flow: { ariaLabel: 'Quy trình Hợp Đồng Lao Động', chain: [
      { label: 'Thử việc', sub: 'Tự sinh từ Onboarding, DRAFT' },
      { label: 'Ký chính thức', sub: 'Ra quyết định sau thử việc', kind: 'decision' },
      { label: 'ACTIVE', sub: 'Theo dõi hiệu lực', kind: 'approved' },
      { label: 'TERMINATED', sub: 'Tự động khi Offboarding xong' },
    ], decision: { atIndex: 1, approveLabel: 'Ký', rejectLabel: 'Không đạt/gia hạn thêm', rejectBox: { label: 'Gia hạn thử việc', sub: 'Kéo dài thời gian thử việc' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Chặn khỏi Báo Cáo chung', text: 'cùng nhóm dữ liệu nhạy cảm với Hồ Sơ Nhân Sự/Lương/Công Phép — không đưa vào <code>GET /api/data</code> chung.' },
    ], right: [] },
  },
  hrAttendance: {
    icon: '🕒', title: 'Công / Phép', badge: 'Nhân Sự',
    desc: 'Đăng ký nghỉ phép theo loại phép và số ngày — duyệt theo cấp quản lý trực tiếp, tự trừ vào quỹ phép còn lại, tổng hợp công/phép theo tháng.',
    flow: { ariaLabel: 'Quy trình Công/Phép', chain: [
      { label: 'Đăng ký nghỉ phép', sub: 'Loại phép + số ngày' },
      { label: 'Duyệt', sub: 'Quản lý trực tiếp', kind: 'decision' },
      { label: 'Trừ quỹ phép', sub: 'Tự động', kind: 'approved' },
    ], decision: { atIndex: 1, rejectBox: { label: 'REJECTED', sub: 'Không trừ quỹ phép' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Chặn khỏi Báo Cáo chung', text: 'attendanceRecords bị chặn khỏi <code>GET /api/data</code> chung như các collection nhạy cảm khác của Nhân Sự.' },
    ], right: [] },
  },
  hrPayroll: {
    icon: '💴', title: 'Lương', badge: 'Nhân Sự — Dữ liệu nhạy cảm',
    desc: 'Tính lương theo tháng dựa trên Hợp Đồng Lao Động + dữ liệu Công/Phép — duyệt trước khi phát lương, lưu payslip lịch sử từng kỳ.',
    flow: { ariaLabel: 'Quy trình Lương', chain: [
      { label: 'Tính lương tháng', sub: 'Dựa trên HĐLĐ + Công/Phép' },
      { label: 'Duyệt', sub: '', kind: 'decision' },
      { label: 'Phát lương', sub: 'Lưu payslip lịch sử', kind: 'approved' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Điều chỉnh', sub: 'Tính lại' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'payslips — chặn khỏi Báo Cáo chung', text: 'cực nhạy cảm, KHÔNG đưa vào <code>GET /api/data</code>/Báo Cáo chung theo khuôn thông thường — cần route thống kê riêng nếu muốn báo cáo.' },
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
    icon: '🎫', title: 'Hỗ Trợ Yêu Cầu & Phê Duyệt Giá', badge: 'Hỗ Trợ IT',
    desc: 'Ticket hỗ trợ/gia hạn thiết bị-phần mềm — nếu có phát sinh chi phí mua/gia hạn thì phải qua bước Phê Duyệt Giá (báo giá → duyệt) trước khi IT xử lý.',
    flow: { ariaLabel: 'Quy trình Hỗ Trợ IT & Phê Duyệt Giá', chain: [
      { label: 'Tạo ticket', sub: 'Sự cố / gia hạn / mua mới' },
      { label: 'Phê Duyệt Giá', sub: 'Nếu có chi phí phát sinh', kind: 'decision' },
      { label: 'IT xử lý', sub: '', kind: 'approved' },
      { label: 'Đóng ticket', sub: '' },
    ], decision: { atIndex: 1, approveLabel: 'Duyệt giá', rejectLabel: 'Từ chối giá', rejectBox: { label: 'REJECTED', sub: 'Báo giá lại' }, loopBackToIndex: 0 } },
    footer: { left: [
      { label: 'Không cần Phê Duyệt Giá', text: 'ticket sự cố thuần (không phát sinh chi phí) bỏ qua thẳng bước Phê Duyệt Giá, IT xử lý ngay sau khi tạo.' },
    ], right: [
      { label: 'Chống trùng mã', text: 'itSupportTickets/itPriceApprovals tự sinh lại mã kế tiếp khi phát hiện trùng, kể cả khi 2 người tạo cùng lúc.' },
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
    desc: 'Sơ đồ quan hệ tổng quan — 8 chức năng của Đào Tạo không đứng độc lập mà nuôi vào nhau: 2 loại Lộ Trình (Tân Binh/Thăng Tiến) đều được XÂY từ nhiều Chương Trình, Chương Trình là khung để MỞ Lớp Học, Lớp Học lấy Giáo Trình từ Kho Tài Liệu + Đề Kiểm Tra từ Ngân Hàng Câu Hỏi, có Giảng Viên đứng lớp (nếu Offline) và mời Học Viên tham gia.',
    isCustomFlow: true,
    footer: { left: [
      { label: 'Lớp Học là trung tâm vận hành', text: 'mọi chức năng khác (Chương Trình, Kho Tài Liệu, Ngân Hàng Câu Hỏi, Giảng Viên) đều tồn tại ĐỂ phục vụ 1 Lớp Học cụ thể — không có Lớp Học thì các danh mục kia chỉ là dữ liệu chờ dùng.' },
      { label: 'Giảng Viên ≠ Học Viên', text: '"Giảng Viên" là 1 vai trò gán theo <code>instructorUsername</code> trên từng lớp Offline (quyền <code>trainingInstruct</code>, chỉ quản lý/chấm đúng lớp được gán); "Học Viên" không phải hồ sơ riêng — là bất kỳ nhân viên nào đăng ký/được mời vào lớp.' },
    ], right: [
      { label: '2 loại Lộ Trình khác nhau', text: '<b>Lộ Trình Tân Binh</b> gán cho nhân viên MỚI (có đánh giá Giai Đoạn 3 + cấp chứng chỉ); <b>Lộ Trình Thăng Tiến</b> áp dụng XUYÊN SUỐT sự nghiệp, khoá theo từng bậc — cả 2 đều tham chiếu tới cùng danh mục Chương Trình, không phải 2 khái niệm trùng nhau.' },
    ] },
  },
  classes: {
    desc: 'Lớp học gắn với 1 Chương Trình — học viên đăng ký/được gán vào lớp, học theo tài liệu + làm bài kiểm tra; bài tự luận (essay) cần giảng viên chấm tay thay vì tự động.',
    flow: { ariaLabel: 'Quy trình Lớp Học', chain: [
      { label: 'Mở lớp', sub: 'Chọn chương trình, thời gian' },
      { label: 'Học viên tham gia', sub: 'Đăng ký hoặc được gán' },
      { label: 'Làm bài kiểm tra', sub: 'Trắc nghiệm tự chấm', kind: 'decision' },
      { label: 'Hoàn thành lớp', sub: 'Đạt điểm yêu cầu', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Tự động', rejectLabel: 'Có câu tự luận', rejectBox: { label: 'Giảng viên chấm', sub: 'Chấm tay câu essay' }, loopBackToIndex: 2, loopBackLabel: 'Chấm xong → cộng điểm' } },
    footer: { left: [
      { label: 'QR điểm danh/vào bài', text: 'học viên quét QR để vào thẳng màn "Đăng Ký Của Tôi" và mở luôn modal làm bài, không cần điều hướng qua nhiều lớp menu trên điện thoại.' },
      { label: 'Giảng Viên theo từng lớp', text: 'lớp Offline gán 1 giảng viên qua <code>instructorUsername</code> — người này (<code>trainingInstruct</code>) chỉ quản lý/chấm được ĐÚNG lớp mình được gán, khác <code>trainingManage</code> quản lý được mọi lớp.' },
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
    desc: 'Kho tài liệu đào tạo dùng chung — tài liệu được gắn vào Chương Trình/Lớp Học, có theo dõi tiến độ đọc/xem của từng học viên (trainingDocumentProgress).',
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
    desc: 'Lộ Trình Tân Binh — khác Lộ Trình Thăng Tiến ở chỗ áp dụng riêng cho nhân viên MỚI: 1 lộ trình gồm nhiều Chương Trình bắt buộc học, phân công cho từng người, kết thúc bằng đánh giá Giai Đoạn 3 và cấp chứng chỉ.',
    flow: { ariaLabel: 'Quy trình Lộ Trình Tân Binh', chain: [
      { label: 'Phân công lộ trình', sub: 'Gán 1 lộ trình cho nhân viên mới' },
      { label: 'Học theo Chương Trình', sub: 'Hoàn thành các Lớp Học liên quan' },
      { label: 'Đánh Giá GĐ3', sub: '', kind: 'decision' },
      { label: 'Cấp Chứng Chỉ', sub: 'Hoàn tất lộ trình tân binh', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Đạt', rejectLabel: 'Chưa đạt', rejectBox: { label: 'Học bổ sung', sub: 'Chưa đủ điều kiện GĐ3' }, loopBackToIndex: 1, loopBackLabel: 'Tiếp tục học' } },
    footer: { left: [
      { label: 'Khác Onboarding của Nhân Sự', text: 'đây là lộ trình HỌC (nội dung/Chương Trình), khác Onboarding/Offboarding (Nhân Sự) là checklist hành chính theo mốc thời gian — 2 quy trình độc lập, không tự động liên kết với nhau.' },
    ], right: [
      { label: 'Không xoá phân công cũ', text: 'xoá 1 lộ trình khỏi danh mục KHÔNG xoá dữ liệu phân công đã gán cho nhân viên trước đó — giữ nguyên lịch sử học tập.' },
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

function nvInjectStylesOnce() {
  if (document.getElementById('nv-inline-styles')) return;
  const style = document.createElement('style');
  style.id = 'nv-inline-styles';
  style.textContent = `
    #nghiepVuRoot .nv-app { display:flex; min-height:520px; background:#fff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; }
    #nghiepVuRoot .nv-sidebar { width:270px; flex-shrink:0; background:#f9fafb; border-right:1px solid #e5e7eb; padding:12px 0; overflow-y:auto; max-height:80vh; }
    #nghiepVuRoot .nv-group { padding:10px 16px 4px; font-size:11px; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:.04em; }
    #nghiepVuRoot .nv-item { display:block; width:100%; text-align:left; padding:8px 16px 8px 26px; font-size:13px; color:#374151; cursor:pointer; border-left:3px solid transparent; background:none; border-top:0; border-right:0; border-bottom:0; }
    #nghiepVuRoot .nv-item.active { background:#f5f3ff; color:#4c1d95; font-weight:700; border-left-color:#7c3aed; }
    #nghiepVuRoot .nv-item:hover:not(.active) { background:#f3f4f6; }
    #nghiepVuRoot .nv-main { flex:1; padding:22px 28px; min-width:0; overflow-x:auto; }
    #nghiepVuRoot .nv-pill-bar { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px; }
    #nghiepVuRoot .nv-pill { padding:6px 12px; border-radius:999px; font-size:12px; font-weight:700; background:#f3f4f6; color:#374151; cursor:pointer; border:1px solid #e5e7eb; }
    #nghiepVuRoot .nv-pill.active { background:#7c3aed; color:#fff; border-color:#7c3aed; }
    #nghiepVuRoot .nv-footer-grid { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:18px; }
    @media (max-width: 720px) { #nghiepVuRoot .nv-footer-grid { grid-template-columns:1fr; } #nghiepVuRoot .nv-app { flex-direction:column; } #nghiepVuRoot .nv-sidebar { width:100%; max-height:none; } }
  `;
  document.head.appendChild(style);
}

function nvFindItem(key) {
  for (const g of NGHIEP_VU_NAV) {
    const it = g.items.find(i => i.key === key);
    if (it) return { group: g.group, item: it };
  }
  return null;
}

function renderNghiepVuModule() {
  nvInjectStylesOnce();
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
      ${nvFooterCol('Điểm Chặn Quan Trọng', doc.footer.left)}
      ${nvFooterCol('Cơ Chế Đáng Chú Ý', doc.footer.right)}
    </div>
    <div class="mt-6 pt-3 border-t text-[11px] text-gray-400">📎 Xem chi tiết đầy đủ tại <b>deploy/Huong-dan-nghiep-vu.md</b> — trang này là bản tóm tắt trực quan.</div>
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
      ${nvFooterCol('Điểm Chặn Quan Trọng', area.footer.left)}
      ${nvFooterCol('Cơ Chế Đáng Chú Ý', area.footer.right)}
    </div>
    <div class="mt-6 pt-3 border-t text-[11px] text-gray-400">📎 Xem chi tiết đầy đủ tại <b>deploy/Huong-dan-nghiep-vu.md</b> — mục Truyền Thông Nội Bộ &gt; Đào Tạo.</div>
  `;
}
