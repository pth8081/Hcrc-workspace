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
    { key: 'internalPosts', icon: '📰', label: 'Nhịp Sống HCRC / Góc Chia Sẻ' },
    { key: 'daotao', icon: '🎓', label: 'Đào Tạo' },
    { key: 'recruitment', icon: '💼', label: 'Tuyển Dụng' },
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
    { key: 'license', icon: '📜', label: 'Giấy Phép' },
  ]},
  { group: 'Tổng Hợp', items: [
    { key: 'office', icon: '🛒', label: 'Mua Bán / Sửa Chữa / Thanh Toán' },
    { key: 'budget', icon: '💰', label: 'Ngân Sách 2.0' },
  ]},
  // Icon từng mục dưới đây bám ĐÚNG icon thật trên sidebar index.html (đợt rà soát 10/2026 phát hiện
  // hàng loạt icon lệch: Vận Hành 📦→⚙️, Cơ Cấu Tổ Chức 🗂️→🌳, Onboarding 🆕→🧑‍💼, HĐLĐ 📄→📝,
  // Công/Phép 🕒→⏱️, Lương 💴→💰, Mua Hàng 🛒→🔗) — người đọc tài liệu dò theo icon để tìm đúng nút
  // trên sidebar, lệch icon là lệch hướng dẫn.
  { group: 'Vận Hành', items: [
    { key: 'vanHanh', icon: '⚙️', label: 'Đơn Hàng & Mở Mới/Sửa Chữa Siêu Thị' },
    { key: 'checklist', icon: '✅', label: 'Checklist Đánh Giá Siêu Thị' },
  ]},
  { group: 'Nhân Sự', items: [
    { key: 'orgChart', icon: '🌳', label: 'Cơ Cấu Tổ Chức' },
    { key: 'hrLifecycle', icon: '🧑‍💼', label: 'Onboarding / Offboarding' },
    { key: 'hrProfile', icon: '👤', label: 'Hồ Sơ Nhân Sự' },
    { key: 'hrContract', icon: '📝', label: 'Hợp Đồng Lao Động' },
    { key: 'hrReport', icon: '📊', label: 'Báo Cáo' },
    { key: 'hrAttendance', icon: '⏱️', label: 'Công / Phép' },
    { key: 'hrPayroll', icon: '💰', label: 'Lương' },
    { key: 'hr', icon: '🤝', label: 'Phản Hồi Ý Kiến (HCRC Đồng Hành)' },
  ]},
  { group: 'Hỗ Trợ IT', items: [
    { key: 'itSupport', icon: '🎫', label: 'Hỗ Trợ Yêu Cầu (Ticket)' },
    { key: 'itPriceApproval', icon: '🏷️', label: 'Phê Duyệt Giá Bán (Bán Lẻ / Bán Buôn)' },
  ]},
  { group: 'Mua Hàng', items: [
    { key: 'muaHang', icon: '🔗', label: 'BAS — Cơ Sở Tính Chiết Khấu/Thưởng NCC' },
  ]},
  // 2 nhóm cuối (10/2026, đợt rà soát đối chiếu tài liệu với UI thật): 3 màn DÙNG CHUNG cho mọi module
  // trước đây thiếu hẳn entry dù đã có nút sidebar thật — "✅ Phê Duyệt" (core-approvalhub.js, 17 entry
  // khác đang hướng dẫn "vào mục ✅ Phê Duyệt" mà không có mục nào mô tả chính màn đó), "📊 Báo Cáo"
  // (module-baocaoquantri.js) và màn cài đặt cá nhân (modal #profileModal, mở từ khối tên người dùng ở
  // đáy sidebar — không phải 1 tab nên trước đây bị bỏ sót).
  { group: 'Phê Duyệt & Tra Cứu Chung', items: [
    { key: 'approvalHub', icon: '✅', label: 'Phê Duyệt (Hộp Thư Duyệt Tổng Hợp)' },
    { key: 'reports', icon: '📊', label: 'Báo Cáo (Tổng Hợp Toàn Hệ Thống)' },
  ]},
  { group: 'Tài Khoản Cá Nhân', items: [
    { key: 'profile', icon: '⚙️', label: 'Hồ Sơ Cá Nhân & Bảo Mật Tài Khoản' },
  ]},
];

// ===================== Hệ Thống (từ v23.63 — tách khỏi Nghiệp Vụ theo yêu cầu người dùng) =====
// Tách RIÊNG khỏi NGHIEP_VU_NAV (không dùng chung canViewNVItem()/NV_KEY_ACCESS_FN của bên Nghiệp Vụ) —
// CẢ danh mục này chỉ dành cho quản trị viên (nvCanSeeSystemSection()), không có khái niệm "xem theo
// quyền module con" như bên Nghiệp Vụ (1 tài khoản có quyền admin thì thấy TẤT CẢ mục Hệ Thống). Mục
// "Sơ Đồ Kiến Trúc Hệ Thống" dời nguyên từ NGHIEP_VU_NAV/NGHIEP_VU_DOCS sang đây (trước đây là mục DUY
// NHẤT trong nhóm "Hệ Thống" bên Nghiệp Vụ, gác cứng qua NV_ADMIN_ONLY_KEYS — nay cả khu Hệ Thống mới
// đảm nhiệm đúng vai trò đó, không cần cơ chế gác riêng lẻ theo key nữa).
const SYSTEM_NAV = [
  { group: 'Phân Quyền & Tài Khoản', items: [
    { key: 'sysPermissions', icon: '🔑', label: 'Phân Quyền' },
    { key: 'sysUsers', icon: '👥', label: 'Người Dùng' },
    { key: 'sysPermMatrix', icon: '🧮', label: 'Ma Trận Phân Quyền' },
  ]},
  { group: 'Cấu Hình Quy Trình', items: [
    { key: 'sysWorkflow', icon: '🔀', label: 'Quy Trình & Phê Duyệt' },
    { key: 'sysAdvWorkflow', icon: '🔀', label: 'Nghiệp Vụ Nâng Cao' },
  ]},
  { group: 'Danh Mục & Biểu Mẫu', items: [
    { key: 'sysCatalog', icon: '🗂️', label: 'Quản Lý Danh Mục' },
    { key: 'sysFormBuilder', icon: '📋', label: 'Biểu Mẫu' },
  ]},
  { group: 'Vận Hành Hệ Thống', items: [
    { key: 'sysFiles', icon: '📁', label: 'Quản Lý Tệp File' },
    { key: 'sysTrash', icon: '🗑️', label: 'Thùng Rác' },
    { key: 'sysLog', icon: '📜', label: 'Nhật Ký Hệ Thống' },
  ]},
  // 2 màn API là 2 thứ TÁCH BIỆT hoàn toàn, đừng gộp nhầm: "🔑 API Xác Thực Ngoài" (tab con của ⚙️ Quản
  // Trị, cấp API key cho ứng dụng NGOÀI gọi VÀO hệ thống) và "🔌 Cấu Hình API" (tab con khác, đẩy Đơn
  // Hàng RA dsmart16). Nhãn/icon lấy ĐÚNG theo nút thật ở fragments/systemSection.html #adminSubTabBar.
  { group: 'Tích Hợp & Thông Báo', items: [
    { key: 'sysEmail', icon: '📧', label: 'Cấu Hình Email' },
    { key: 'sysExtAuth', icon: '🔑', label: 'API Xác Thực Ngoài' },
    { key: 'sysOpApi', icon: '🔌', label: 'Cấu Hình API — Đồng Bộ Đơn Hàng Ra dsmart16' },
  ]},
  { group: 'Kiến Trúc', items: [
    { key: 'systemArchitecture', icon: '🗺️', label: 'Sơ Đồ Kiến Trúc Hệ Thống' },
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

  // nv-arrow-gray: PHÁT HIỆN lúc thêm renderNVSystemArchitectureOverview() — 4 cạnh nét đứt bên dưới
  // tham chiếu marker "nv-arrow-gray" nhưng defs cũ chỉ khai 3 marker (nv-arrow/nv-arrow-violet/
  // nv-arrow-amber), thiếu đúng cái này nên trước đây 4 mũi tên nét đứt không hiện đầu mũi tên (marker
  // id không tồn tại trong CHÍNH svg này — mỗi lần gọi hàm renderNVFlow()/renderNVDaotaoOverview() tạo
  // 1 gốc <svg> riêng, defs không dùng chung được giữa các lần gọi khác nhau). Bổ sung cho đủ.
  let svg = `<defs>${nvArrowMarker('nv-arrow', '#9ca3af')}${nvArrowMarker('nv-arrow-violet', '#7c3aed')}${nvArrowMarker('nv-arrow-amber', '#d97706')}${nvArrowMarker('nv-arrow-gray', '#9ca3af')}</defs>`;

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

// Sơ Đồ Kiến Trúc Hệ Thống (10/2026, theo yêu cầu người dùng) — toàn cảnh Trình duyệt ↔ Server ↔ SQL
// Server + các hệ thống NGOÀI đang tích hợp thật (xác nhận từng cái bằng cách đọc code, không đoán):
// lib/mailer.js (SMTP, nodemailer), lib/dsmartApiClient.js + routes/purchasing.js (DSmart API — module
// Mua Hàng > BAS, CHỈ KÉO dữ liệu Chiết Khấu/Thưởng NCC vào, cấu hình qua .env DSMART_API_BASE_URL/
// DSMART_API_KEY), jobs/operationOrderApiSync.js (dsmart16 — module Vận Hành, CHỈ ĐẨY dữ liệu Đơn Hàng
// đã tạo ra ngoài, cấu hình qua màn Admin/Cấu Hình API, có assertSafeExternalUrl() chống SSRF). Đây là
// 2 điểm tích hợp TÁCH BIỆT hoàn toàn (2 chiều dữ liệu ngược nhau, 2 nguồn cấu hình khác nhau) dù cùng
// nhắc tới tên "DSmart" — cố tình vẽ thành 2 node riêng để không gây hiểu lầm là 1 kết nối duy nhất.
function renderNVSystemArchitectureOverview() {
  const W = 940, H = 400;
  const N = {
    client:    { x: 20,  y: 168, w: 190, h: 68, label: 'Trình Duyệt (SPA)', sub: 'index.html + JS modules', kind: 'actor' },
    server:    { x: 340, y: 142, w: 250, h: 96, label: 'Server Node.js / Express', sub: 'PM2 cluster mode, xác thực JWT', kind: 'hub' },
    sqlServer: { x: 340, y: 288, w: 180, h: 64, label: 'SQL Server', sub: 'AppData, Records, Users', kind: 'approved' },
    localDisk: { x: 550, y: 288, w: 180, h: 64, label: 'Ổ Đĩa Cục Bộ', sub: 'Thư mục uploads/', kind: 'approved' },
    smtp:      { x: 740, y: 16,  w: 180, h: 64, label: 'Máy Chủ SMTP', sub: 'Gửi email thông báo/OTP', kind: 'reference' },
    dsmartBas: { x: 740, y: 142, w: 180, h: 64, label: 'DSmart API (BAS)', sub: 'Chiết Khấu/Thưởng NCC', kind: 'reference' },
    dsmart16:  { x: 740, y: 268, w: 180, h: 64, label: 'dsmart16 (bên ngoài)', sub: 'Nhận Đơn Hàng (Vận Hành)', kind: 'reference' },
  };
  const cx = (k) => N[k].x + N[k].w / 2, cy = (k) => N[k].y + N[k].h / 2;
  const bottom = (k) => ({ x: cx(k), y: N[k].y + N[k].h });
  const top = (k) => ({ x: cx(k), y: N[k].y });
  const side = (k, dir) => ({ x: dir === 'l' ? N[k].x : N[k].x + N[k].w, y: cy(k) });

  let svg = `<defs>${nvArrowMarker('nv-arrow', '#9ca3af')}${nvArrowMarker('nv-arrow-violet', '#7c3aed')}${nvArrowMarker('nv-arrow-gray', '#9ca3af')}</defs>`;

  svg += nvEdge(side('client', 'r').x, side('client', 'r').y, side('server', 'l').x, side('server', 'l').y, { color: '#9ca3af', marker: 'nv-arrow', label: 'HTTPS · API (JWT)' });
  svg += nvEdge(bottom('server').x - 60, bottom('server').y, top('sqlServer').x, top('sqlServer').y, { color: '#7c3aed', marker: 'nv-arrow-violet', label: 'Đọc / Ghi dữ liệu' });
  svg += nvEdge(bottom('server').x + 20, bottom('server').y, top('localDisk').x, top('localDisk').y, { color: '#7c3aed', marker: 'nv-arrow-violet', label: 'Lưu file đính kèm' });
  svg += nvEdge(side('server', 'r').x, side('server', 'r').y - 30, side('smtp', 'l').x, side('smtp', 'l').y, { color: '#9ca3af', marker: 'nv-arrow-gray', dashed: true, label: 'Gửi email (SMTP)' });
  svg += nvEdge(side('dsmartBas', 'l').x, side('dsmartBas', 'l').y, side('server', 'r').x, side('server', 'r').y, { color: '#9ca3af', marker: 'nv-arrow-gray', dashed: true, label: 'Kéo Chiết Khấu NCC' });
  svg += nvEdge(side('server', 'r').x, side('server', 'r').y + 30, side('dsmart16', 'l').x, side('dsmart16', 'l').y, { color: '#9ca3af', marker: 'nv-arrow-gray', dashed: true, label: 'Đẩy Đơn Hàng (định kỳ)' });

  Object.values(N).forEach(n => { svg += nvRoundedNode(n.x, n.y, n.w, n.h, { label: n.label, sub: n.sub, kind: n.kind }); });

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sơ đồ kiến trúc tổng thể hệ thống và liên kết bên ngoài" class="nv-flow-svg">${svg}</svg>`;
}

// Sơ đồ hub cho "🔀 Nghiệp Vụ Nâng Cao" (SYSTEM_DOCS.sysAdvWorkflow, từ v23.65) — 4 sub-tab đứng quanh
// hub trung tâm, KHÔNG có mũi tên nối lẫn nhau (4 mục độc lập hoàn toàn về dữ liệu, chỉ gom chung tab).
function renderNVSysAdvWorkflowOverview() {
  const W = 900, H = 320;
  const N = {
    hub:    { x: 360, y: 128, w: 180, h: 64, label: '🔀 Nghiệp Vụ Nâng Cao', sub: '4 sub-tab độc lập', kind: 'hub' },
    mixed:  { x: 20,  y: 16,  w: 210, h: 64, label: '🏬 Quy Trình Đặt Hàng Siêu Thị', sub: 'Người duyệt theo bước' },
    quick:  { x: 20,  y: 240, w: 210, h: 64, label: '⚡ Áp Dụng Nhanh', sub: 'Set nhanh số bước' },
    groups: { x: 670, y: 16,  w: 210, h: 64, label: '🖋️ Nhóm Phê Duyệt Trình/HĐ', sub: 'Văn Bản Trình + Hợp Đồng' },
    special:{ x: 670, y: 240, w: 210, h: 64, label: '🧩 Nhóm Quyền Đặc Biệt', sub: '3 cấu hình toàn hệ thống' },
  };
  const cx = (k) => N[k].x + N[k].w / 2, cy = (k) => N[k].y + N[k].h / 2;
  let svg = `<defs>${nvArrowMarker('nv-arrow-hub', '#7c3aed')}</defs>`;
  ['mixed', 'quick', 'groups', 'special'].forEach(k => {
    svg += `<line x1="${cx('hub')}" y1="${cy('hub')}" x2="${cx(k)}" y2="${cy(k)}" stroke="#d1d5db" stroke-width="1.5" stroke-dasharray="4,4"/>`;
  });
  Object.values(N).forEach(n => { svg += nvRoundedNode(n.x, n.y, n.w, n.h, { label: n.label, sub: n.sub, kind: n.kind }); });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sơ đồ 4 sub-tab độc lập của Nghiệp Vụ Nâng Cao" class="nv-flow-svg">${svg}</svg>`;
}

function nvFooterCol(title, items) {
  if (!items || !items.length) return '';
  const li = items.map(it => `<li class="py-1.5 border-t first:border-t-0 border-gray-100"><b>${escapeHtml(it.label)}</b> — ${it.text}</li>`).join('');
  return `<div><div class="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">${escapeHtml(title)}</div><ul class="text-[12.5px] text-gray-700 leading-snug list-none">${li}</ul></div>`;
}

// "Cách Thao Tác" — hướng dẫn CLICK-BY-CLICK (khác `flow`/`footer` vốn giải thích NGHIỆP VỤ/quy tắc,
// không nói "bấm nút gì, tab nào"). `steps` là mảng {role?, text} theo ĐÚNG thứ tự thao tác thật trên
// UI — role gắn nhãn "ai làm bước này" (Người đăng ký/Người duyệt/...), để trống nếu bước không gắn
// riêng 1 vai trò cụ thể (VD bước xem báo cáo, ai có quyền cũng làm được). Chỉ viết dạng TEXT (không
// kèm ảnh chụp màn hình) — tên tab/nút/field id phải khớp ĐÚNG với HTML/JS thật tại thời điểm viết, để
// không lạc hậu ngay khi UI đổi thì phải cập nhật lại đoạn text tương ứng (rẻ hơn nhiều so với chụp lại
// ảnh). Optional trên từng entry — entry nào chưa có `steps` thì khối này tự ẩn, không hiện rỗng.
function renderNVSteps(steps) {
  if (!steps || !steps.length) return '';
  const li = steps.map((s, idx) => `
    <li class="flex gap-3 py-2 border-t first:border-t-0 border-gray-100">
      <div class="shrink-0 w-6 h-6 rounded-full bg-teal-600 text-white text-[11px] font-bold flex items-center justify-center">${idx + 1}</div>
      <div class="flex-1 text-[13px] text-gray-700 leading-relaxed">${s.role ? `<span class="inline-block text-[10px] font-bold uppercase tracking-wide text-teal-700 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5 mr-1.5 align-middle">${escapeHtml(s.role)}</span>` : ''}${s.text}</div>
    </li>`).join('');
  return `
    <div class="text-[13px] font-bold uppercase tracking-wide text-gray-700 mb-3 pb-1.5 border-b mt-6">🛠️ Cách Thao Tác</div>
    <ul class="list-none mb-2">${li}</ul>
  `;
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
    steps: [
      { role: 'Người tải lên', text: 'vào tab <b>📂 Tài liệu</b> → điền form "📄 Tải Lên Tài Liệu Mới": chọn Loại thao tác "➕ Nhập mới", Phòng Ban Trình, Phân Loại (mã tài liệu tự sinh theo 2 mục này), Tên/Tiêu Đề, Tệp Tài Liệu, Trích Lục/Tóm Tắt Nội Dung → bấm <b>"Gửi phê duyệt"</b>.' },
      { role: 'Người duyệt', text: 'vào mục <b>✅ Phê Duyệt</b> (sidebar, ngay dưới Trang chủ) → tìm đúng hồ sơ Tài Liệu đang chờ mình duyệt (theo cấu hình luồng duyệt của phòng ban) → bấm Duyệt hoặc Từ chối.' },
      { role: 'Người tải lên', text: 'muốn thêm phiên bản mới cho tài liệu đã có (không xoá bản cũ): chọn Loại thao tác "🔄 Cập nhật (thêm version cho tài liệu đã có)" → chọn đúng tài liệu ở "Chọn Mã Tài Liệu Cần Cập Nhật" (chỉ hiện tài liệu đã duyệt xong) → tải file mới → gửi lại như bước 1.' },
    ],
    footer: { left: [
      { label: 'Ai xem được gì', text: 'quản trị viên xem được tất cả; người tải tài liệu lên luôn xem được bài của mình dù đang ở bước nào; một số người chỉ được xem bản đã duyệt, một số khác chỉ xem bản chưa duyệt — 2 quyền này tách biệt, không cộng dồn; người phê duyệt xem đúng hồ sơ thuộc phòng ban mình phụ trách. Quản lý trực tiếp (hoặc cấp cao hơn — đệ quy mọi cấp theo Cơ Cấu Tổ Chức) của người tải lên cũng tự xem được, không cần cấp quyền gì thêm (10/2026).' },
      { label: 'Tạo phiên bản mới', text: 'không tạo được phiên bản mới nếu bản mới nhất đang chờ duyệt hoặc còn là bản nháp; nếu bản mới nhất bị từ chối thì vẫn tạo phiên bản mới bình thường. Mọi phiên bản trong 1 "gia đình" tài liệu LUÔN cùng Phòng Ban/Phân Loại với bản gốc (server tự khoá cứng) — kể cả khi 1 phiên bản bị người duyệt yêu cầu bổ sung rồi "Sửa & Gửi Lại" (từ 9/2026) cũng không đổi được Phòng Ban/Phân Loại khác bản gốc, tránh né nhầm sang quy trình duyệt của phòng ban khác.' },
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
    steps: [
      { role: 'Người trình', text: 'vào mục <b>📜 Văn bản trình</b> (sidebar) → điền form: Phòng Ban Trình, Loại Tờ Trình, Cấp Phê Duyệt Cuối Cùng, Tên/Trích Yếu Tờ Trình, Độ Khẩn, Tờ Trình (file) → nếu cần chọn thêm Nhóm Phê Duyệt bổ sung/Xin Ý Kiến thì bấm ô "Phê Duyệt" chọn cụ thể từng nhóm → điền Nội Dung Trình Chi Tiết → bấm <b>"Gửi phê duyệt"</b>.' },
      { text: 'Muốn xem trước cả chuỗi các bước duyệt sẽ đi qua (bao gồm cả nhóm bổ sung vừa chọn) trước khi gửi: bấm <b>"🔍 Xem Quy Trình"</b> ngay trên form.' },
      { role: 'Người duyệt', text: 'vào mục <b>✅ Phê Duyệt</b> (sidebar) → tìm đúng hồ sơ đang chờ mình duyệt ở đúng lớp hiện tại → bấm Duyệt hoặc Từ chối (bắt buộc nêu lý do khi từ chối) — duyệt xong lớp này mới chuyển sang lớp kế tiếp.' },
    ],
    footer: { left: [
      { label: 'Lớp duyệt độc lập', text: 'quy trình gốc theo phòng ban có sẵn danh sách người duyệt riêng từng lớp — duyệt xong lớp trước mới hiện ra lớp sau, không thể "duyệt tắt" bỏ qua lớp nào.' },
      { label: 'Nhóm Phê Duyệt bổ sung (10/2026)', text: 'ngoài quy trình gốc, người trình chọn 1 "Cấp Phê Duyệt Cuối Cùng" để xác định những "Nhóm Phê Duyệt" nào được phép chọn thêm — nhóm bị cấp đó khoá thì tự bắt buộc (tick sẵn, không bỏ được), nhóm còn lại tự chọn tuỳ ý. Mỗi nhóm được chọn nối thêm ĐÚNG 1 bước duyệt vào CUỐI quy trình gốc (không thay thế bước nào). Quản lý danh sách nhóm/cấp ở Hệ Thống → Quản Trị → Quản Lý Nhóm Phê Duyệt Trình.' },
      { label: 'Nhóm "Xin Ý Kiến" (không chặn)', text: 'riêng Văn Bản Trình có loại nhóm đánh dấu "không chặn quy trình" — chỉ là kênh tham khảo song song (opinionRequestees), không phải bước duyệt thật, không cần chờ mới đi tiếp; nhóm này có thể được bật thêm quyền "Đề Xuất Thay File" — người trong nhóm được đề xuất thay thế toàn bộ file tờ trình ngay trong bước xử lý của mình.' },
    ], right: [
      { label: 'Không tự duyệt', text: 'người tạo tờ trình không được nằm trong danh sách duyệt của chính tờ trình đó.' },
      { label: 'Huỷ đề xuất thay thế đang treo (9/2026)', text: 'tờ trình đang chờ người trình xác nhận 1 đề xuất thay thế file thì bị khoá mọi thao tác khác — nếu người trình không còn xử lý được (nghỉ việc/khoá tài khoản/đi vắng), Quản Trị Viên HOẶC chính người đã đề xuất bấm "🚫 Huỷ Đề Xuất Thay Thế" trong modal Bút Phê để gỡ, hồ sơ quay lại xử lý bình thường ở ĐÚNG bước hiện tại.' },
      { label: 'Loại tờ trình / Độ khẩn xác minh ở server (9/2026)', text: 'phải khớp đúng danh mục admin cấu hình — giá trị lệch trước đây âm thầm rơi về loại "Khác" (ít bước duyệt hơn) dù phiếu vẫn hiện đúng tên loại. Tiêu đề/Nội dung cũng có giới hạn độ dài (300 / 20.000 ký tự). Nếu "Cấp Phê Duyệt Cuối Cùng" của 1 tờ trình NHÁP bị admin xoá khỏi danh mục, hệ thống tự chuyển về cấp mặc định hợp lệ và báo rõ khi "Sửa & Gửi Lại" thay vì báo lỗi cứng.' },
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
    steps: [
      { role: 'Người soạn hợp đồng', text: 'vào mục 📄 Hợp Đồng (sidebar) → tab <b>"⏳ Phê Duyệt"</b> → chọn Loại Thao Tác (Tạo Mới hoặc Bổ Sung Phụ Lục cho hợp đồng đã có) → điền Phòng Ban Quản Lý, Loại Pháp Lý, Cấp Phê Duyệt Cuối Cùng, Tên Hợp Đồng, Đối Tác/Bên Ký Kết, Giá Trị Hợp Đồng, Ngày Hiệu Lực → bấm <b>"Gửi phê duyệt"</b>.' },
      { role: 'Người duyệt', text: 'vào mục ✅ Phê Duyệt (sidebar) → tìm đúng hồ sơ Hợp Đồng đang chờ ở đúng lớp hiện tại → bấm Duyệt hoặc Từ chối.' },
      { text: 'Sau khi duyệt xong, hồ sơ tự chuyển sang tab <b>"📄 Quản Lý Hợp Đồng & Giấy Phép"</b> để theo dõi hiệu lực. Tab này cũng dùng để nhập tay hồ sơ ĐÃ KÝ sẵn ngoài hệ thống (tự APPROVED ngay, không qua hàng chờ) — không phải đường tắt cho hồ sơ cần trình duyệt thật.' },
    ],
    footer: { left: [
      { label: 'Cảnh báo hết hạn', text: 'hợp đồng đang hiệu lực mà gần tới ngày hết hạn sẽ được nhắc trước, để chủ động gia hạn hoặc thanh lý thay vì để hết hạn lúc nào không hay.' },
      { label: 'Nhóm Phê Duyệt bổ sung (10/2026)', text: 'cùng cơ chế với Văn Bản Trình — chọn 1 "Cấp Phê Duyệt Cuối Cùng" để xác định "Nhóm Phê Duyệt" nào bắt buộc/tuỳ chọn thêm, mỗi nhóm chọn nối thêm 1 bước duyệt vào CUỐI quy trình gốc theo phòng ban (không thay thế). KHÁC Văn Bản Trình: Hợp Đồng KHÔNG có loại nhóm "không chặn/Xin Ý Kiến" — mọi nhóm được chọn thêm đều là bước duyệt thật, không có kênh tham khảo song song.' },
    ], right: [
      { label: 'Nhập Hợp Đồng/Phụ Lục ĐÃ KÝ cần quyền RIÊNG (9/2026)', text: 'hồ sơ nhập ở tab "📄 Quản Lý Hợp Đồng &amp; Giấy Phép" được đánh dấu ĐÃ DUYỆT ngay (bỏ qua toàn bộ quy trình Phê Duyệt) nên không còn dùng chung quyền "Tạo hồ sơ hợp đồng" — cần quyền "📥 Nhập Hợp Đồng / Phụ Lục ĐÃ KÝ" cấp riêng trong cây phân quyền. Người không có quyền này vào tab đó sẽ không thấy form nhập. Đổi "Phòng ban" khi SỬA hợp đồng cũng phải nằm trong đúng phạm vi quyền tạo hợp đồng của người sửa.' },
      { label: 'Thanh Toán liên kết', text: 'chi phí thực tế phát sinh từ hợp đồng được ghi nhận qua mục Thanh Toán (Tổng Hợp), liên kết ngược về đúng hợp đồng gốc — cần tải "Tài liệu ký" và tài liệu đó được duyệt xong mới lập được đề nghị thanh toán từ hợp đồng. **Khoá chéo với Đổi Hình Thức Thanh Toán (từ 9/2026)**: không "Lập Thanh Toán" được trong lúc hợp đồng đang có 1 yêu cầu Đổi Hình Thức Thanh Toán treo chờ duyệt — tránh tạo đề nghị theo hình thức CŨ ngay trước khi hình thức đó bị đổi.' },
      { label: 'Bị Từ Chối / Cần Bổ Sung PHẢI nhìn thấy được (10/2026)', text: 'trước đây 2 trạng thái này gần như "biến mất" khỏi tầm nhìn — không hiện ở Dashboard/Tab Phê Duyệt mặc định, chỉ tra được bằng cách lọc tay đúng trạng thái. Nay tab "⏳ Phê Duyệt" có thêm 2 thẻ Dashboard riêng "❌ Bị Từ Chối"/"✏️ Cần Bổ Sung" (bấm vào lọc thẳng), bộ lọc Loại Hợp Đồng cũng có 2 option tương ứng. "Cần Bổ Sung" giờ là trạng thái RIÊNG (`NEEDS_SUPPLEMENT`) tách khỏi "Nháp" cũ — người tạo hồ sơ sửa lại rồi gửi lại bình thường, không đổi cách thao tác. Hub ✅ Phê Duyệt: nút "Xem" trên thông báo hồ sơ bị từ chối nay dẫn đúng vào thẳng thẻ "❌ Bị Từ Chối" (trước đây dẫn sai/không lọc gì).' },
      { label: 'Quản lý thấy hợp đồng của nhân viên mình (10/2026)', text: 'ngoài người tạo/người duyệt, BẤT KỲ ai đứng trên người tạo hợp đồng theo Cơ Cấu Tổ Chức (quản lý trực tiếp, hoặc cấp cao hơn — đệ quy mọi cấp) cũng tự xem được hồ sơ, không cần cấp quyền gì thêm — cùng cơ chế với Tài Liệu/Thanh Toán bên dưới.' },
    ] },
  },
  // internalPosts + recruitment (10/2026, đợt rà soát đối chiếu tài liệu với UI thật): nhóm "Truyền
  // Thông Nội Bộ" trước đây CHỈ có Đào Tạo, thiếu hẳn 3/4 nội dung thật của module "internal" (📰 Nhịp
  // Sống HCRC, 💬 Góc Chia Sẻ — dùng chung DB.internalPosts phân biệt bằng field `type`; 💼 Tuyển Dụng —
  // dữ liệu RIÊNG recruitmentJobs/recruitmentReferrals, không phải bài đăng). Tách 2 entry theo đúng
  // ranh giới dữ liệu thật thay vì gộp 1 entry "3-4 loại bài" (Tuyển Dụng không phải 1 loại bài đăng).
  // "🤝 HCRC Đồng Hành" (sub-tab thứ 5 của cùng module) đã có entry riêng ở nhóm Nhân Sự (key 'hr').
  internalPosts: {
    icon: '📰', title: 'Nhịp Sống HCRC / Góc Chia Sẻ', badge: 'Mở cho mọi nhân viên',
    desc: 'Bảng tin nội bộ toàn công ty — 2 loại bài dùng chung 1 kho dữ liệu nhưng KHÁC HẲN nhau về quyền đăng: "📰 Nhịp Sống HCRC" chỉ người được cấp quyền đăng tin (hoặc admin) mới đăng được và công khai NGAY; "💬 Góc Chia Sẻ" ai cũng đăng được nhưng phải qua người duyệt mới hiện cho cả công ty. XEM và tương tác (❤️ Thích / 💬 Bình luận / ghi nhận đã xem) mở cho MỌI tài khoản, không lọc theo phòng ban.',
    flow: { ariaLabel: 'Quy trình đăng bài Truyền Thông Nội Bộ', chain: [
      { label: 'Soạn bài', sub: 'Tiêu đề + Chuyên đề + Nội dung' },
      { label: 'Chờ duyệt?', sub: 'CHỈ Góc Chia Sẻ mới qua bước này', kind: 'decision' },
      { label: 'Công khai', sub: 'Cả công ty đọc, thích, bình luận', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Duyệt / Nhịp Sống HCRC đăng thẳng', rejectLabel: 'Từ chối / Yêu cầu bổ sung', rejectBox: { label: 'Về tay tác giả', sub: 'Sửa lại rồi gửi duyệt lại' }, loopBackToIndex: 0 } },
    steps: [
      { role: 'Người có quyền đăng tin', text: 'vào <b>📣 Truyền thông</b> (sidebar) → <b>📰 Nhịp Sống HCRC</b> → điền form "📝 Đăng Nhịp Sống HCRC Mới": Tiêu Đề, Chuyên Đề Nhịp Sống HCRC, Lịch Đăng (để trống = đăng ngay), Nội Dung, Tệp Đính Kèm (tuỳ chọn) → bấm <b>"📝 Lưu Nháp"</b> để để dành, hoặc <b>"Đăng Ngay"</b> để phát hành.' },
      { role: 'Người có quyền duyệt bài', text: 'muốn bài nổi lên Trang chủ: tick <b>"📌 Ghim bài này lên trang chủ (Dashboard)"</b> ngay trên form rồi chọn số ngày ghim — ô này CHỈ hiện với người có quyền duyệt bài và KHÔNG áp dụng cho Góc Chia Sẻ.' },
      { role: 'Mọi nhân viên', text: 'vào <b>📣 Truyền thông → 💬 Góc Chia Sẻ</b> → điền Tiêu Đề, Chuyên Đề Góc Chia Sẻ, Nội Dung → bấm <b>"Gửi Duyệt"</b> (nút này tự đổi nhãn thành "Đăng Ngay" nếu chính bạn có quyền duyệt bài) — bài đang chờ duyệt chỉ tác giả và người duyệt nhìn thấy.' },
      { role: 'Người duyệt bài', text: 'vào mục <b>✅ Phê Duyệt</b> (sidebar) → lọc loại <b>"💬 Góc chia sẻ"</b> → Duyệt hoặc Từ chối ngay tại danh sách (mở bài ra còn có thêm Yêu Cầu Bổ Sung — bài quay về cho tác giả sửa rồi gửi lại).' },
      { role: 'Người đọc', text: 'bấm vào 1 bài trong "📰 Danh Sách Nhịp Sống HCRC" → bấm <b>"❤️ Thích"</b>, gõ bình luận vào ô "Viết bình luận..." rồi bấm <b>"Gửi"</b> — riêng "👁️ N người đã xem" hệ thống TỰ ghi nhận ngay khi bạn mở bài, không cần bấm gì.' },
      { text: 'Tìm lại bài cũ: khối <b>"🔍 Tìm Kiếm & Lọc"</b> ngay dưới form (Từ Ngày Đăng / Đến Ngày Đăng / Từ Khóa) — riêng Góc Chia Sẻ có thêm ô "Lọc Theo Trạng Thái" (Chờ duyệt / Đã duyệt / Từ chối).' },
    ],
    footer: { left: [
      { label: 'Quyền ĐĂNG khác nhau theo từng loại bài', text: '"Góc Chia Sẻ" ai cũng đăng được (nhưng phải qua duyệt); "Nhịp Sống HCRC" cần quyền đăng tin riêng; "Đào Tạo" cần quyền quản lý đào tạo (xem mục 🎓 Đào Tạo); "Tuyển Dụng" cần quyền đăng tin tuyển dụng (mục 💼 Tuyển Dụng). Quyền XEM thì chung cho cả module, không tách theo loại bài.' },
      { label: 'Lịch đăng — chỉ Nhịp Sống HCRC', text: 'đặt "Lịch Đăng" ở tương lai thì bài ở trạng thái chờ đăng, tới giờ tự hiện — hệ thống tính LIVE theo thời điểm người xem mở trang, không có job nền nào phải chờ.' },
    ], right: [
      { label: 'Bình luận nhạy cảm tự vào hàng chờ', text: 'bình luận bị hệ thống đánh dấu nhạy cảm sẽ hiện ở mục ✅ Phê Duyệt với nhãn "⚠️/🚨 Bình luận nhạy cảm" để người có quyền duyệt bài xử lý, thay vì công khai ngay.' },
      { label: 'Nháp và sửa lại', text: 'bài Nháp (chưa gửi) hoặc bài bị "Yêu cầu bổ sung" mở lại được bằng nút Sửa trên chính bài đó — form quay về chế độ sửa, bấm "Hủy Sửa" để thoát; không chọn tệp mới thì đính kèm cũ được giữ nguyên, không bị xoá.' },
    ] },
  },
  recruitment: {
    icon: '💼', title: 'Tuyển Dụng', badge: 'Truyền Thông Nội Bộ',
    desc: 'Bản tin tuyển dụng nội bộ + kênh nhân viên giới thiệu ứng viên: bộ phận nhân sự đăng tin theo đợt (tháng), mọi nhân viên xem tin và giới thiệu ứng viên kèm CV, nhân sự theo dõi/cập nhật trạng thái từng ứng viên trong 1 bảng chung. Dữ liệu RIÊNG (tin tuyển dụng + hồ sơ giới thiệu), không phải bài đăng như Nhịp Sống HCRC/Góc Chia Sẻ.',
    flow: { ariaLabel: 'Quy trình Tuyển Dụng nội bộ', chain: [
      { label: 'Đăng tin tuyển dụng', sub: 'Theo đợt (tháng) + đơn vị' },
      { label: 'Nhân viên giới thiệu', sub: 'Kèm CV bắt buộc' },
      { label: 'Nhân sự xử lý ứng viên', sub: 'Mới → Đã liên hệ → Đã tuyển/Từ chối', kind: 'decision' },
      { label: 'Đóng tin / Đã tuyển đủ', sub: 'Ngừng nhận giới thiệu mới', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Đã tuyển', rejectLabel: 'Từ chối', rejectBox: { label: 'Từ chối ứng viên', sub: 'Ghi chú lý do, tin vẫn mở' }, loopBackToIndex: 1, loopBackLabel: 'Nhận giới thiệu tiếp' } },
    steps: [
      { role: 'Nhân sự (quyền đăng tin tuyển dụng)', text: 'vào <b>📣 Truyền thông</b> (sidebar) → <b>💼 Tuyển Dụng</b> → tab <b>"📋 Tin Tuyển Dụng"</b> → điền form "➕ Đăng Tin Tuyển Dụng Mới": Tên Vị Trí, Số Lượng Cần Tuyển (để trống = không giới hạn), Đợt Tuyển (Tháng), Đơn Vị/Siêu Thị Đăng Tuyển, Địa Điểm Làm Việc, Hạn Nhận Hồ Sơ, Thông Tin Liên Hệ, Ảnh/Banner (tuỳ chọn), Mô Tả Công Việc, Yêu Cầu Ứng Viên → bấm <b>"Đăng Tin"</b>.' },
      { role: 'Mọi nhân viên', text: 'ở danh sách "📋 Danh Sách Tin Tuyển Dụng" (lọc nhanh theo Đợt (Tháng) / Đơn Vị-Siêu Thị / Từ Khoá) → bấm <b>"🙋 Giới Thiệu Ứng Viên"</b> trên đúng tin → điền Họ Tên Ứng Viên, Số Điện Thoại, Email (tuỳ chọn), tải <b>CV Ứng Viên</b> (bắt buộc, .pdf/.docx), Ghi Chú Thêm → bấm <b>"Gửi Giới Thiệu"</b>.' },
      { role: 'Người giới thiệu', text: 'theo dõi kết quả ở tab <b>"🙋 Ứng Viên Tôi Giới Thiệu"</b> — mỗi người chỉ thấy ứng viên của chính mình (server tự lọc, không phải chỉ ẩn trên giao diện).' },
      { role: 'Nhân sự', text: 'tab <b>"🗂 Quản Lý Ứng Viên"</b> (chỉ người có quyền mới thấy nút tab này) → lọc theo tin tuyển dụng → bấm "📄 Xem CV", rồi đổi ô trạng thái ở cột Thao Tác (Mới / Đã liên hệ / Đã tuyển / Từ chối) — hệ thống hỏi thêm 1 ghi chú tuỳ chọn cho mỗi lần đổi.' },
      { role: 'Nhân sự', text: 'tuyển xong: bấm <b>"✅ Xác Nhận Đã Tuyển Đủ"</b> hoặc <b>"Đóng Tin"</b> ngay trên thẻ tin — tin đã đóng/đã tuyển đủ không còn nút "🙋 Giới Thiệu Ứng Viên" nữa.' },
    ],
    footer: { left: [
      { label: '1 quyền duy nhất cho cả đăng tin lẫn quản lý ứng viên', text: 'người có quyền đăng tin tuyển dụng đồng thời quản lý TOÀN BỘ ứng viên được giới thiệu (coi như hộp thư chung của bộ phận nhân sự), không giới hạn theo người đăng tin cụ thể; người không có quyền vẫn xem được mọi tin và giới thiệu ứng viên bình thường.' },
      { label: 'CV là bắt buộc', text: 'không tải CV thì không gửi được giới thiệu — tránh hồ sơ trống không xử lý tiếp được. Người giới thiệu luôn được ghi nhận tự động theo tài khoản đăng nhập, không chọn tay/không ẩn danh.' },
    ], right: [
      { label: '4 trạng thái của TIN, khác 4 trạng thái của ỨNG VIÊN', text: 'tin: Đang tuyển / "⏳ Sắp hết hạn" (còn ≤7 ngày tới Hạn Nhận Hồ Sơ, tự tính khi xem, không cần job nền) / Đã tuyển đủ / Đã đóng tuyển dụng. Ứng viên: Mới / Đã liên hệ / Đã tuyển / Từ chối — 2 bộ trạng thái độc lập nhau.' },
      { label: 'Gợi ý "đã tuyển đủ" chỉ là gợi ý', text: 'khi số ứng viên "Đã tuyển" đạt Số Lượng Cần Tuyển, hệ thống hiện banner nhắc — nhưng nút "✅ Xác Nhận Đã Tuyển Đủ" LUÔN bấm được bất kể con số này (nhân sự có thể đã tuyển qua kênh ngoài hệ thống).' },
    ] },
  },
  minutes: {
    icon: '📝', title: 'Biên Bản Họp', badge: 'Điều Hành',
    desc: 'Ghi nhận nội dung và điểm danh cuộc họp, có thể liên kết tới 1 lịch đặt phòng (nếu có) — Công Việc CHỈ sinh ra khi người lập biên bản chủ động bấm "Giao việc", không tự động khi lưu.',
    flow: { ariaLabel: 'Quy trình Biên Bản Họp', chain: [
      { label: 'Tạo biên bản', sub: 'Liên kết cuộc họp (tuỳ chọn)' },
      { label: 'Điểm danh + nội dung', sub: 'Ghi nhận thảo luận, quyết nghị' },
      { label: 'Lưu biên bản', sub: 'CHỈ lưu nội dung, chưa sinh Công Việc' },
      { label: 'Giao việc (thủ công)', sub: 'Bấm "Giao việc" trên màn Xem để thực sự sinh Công Việc', kind: 'approved' },
    ] },
    steps: [
      { role: 'Người lập biên bản', text: 'vào <b>🗂️ Điều Hành ▾ → 📝 Biên bản họp</b> (sidebar) → điền form: Liên Kết Lịch Đặt Phòng Họp (tuỳ chọn), Chủ Đề/Tiêu Đề, Thời Gian Họp, Địa Điểm, Chủ Trì, Thư Ký, Nội Dung Biên Bản.' },
      { text: 'Thêm Thành Phần Tham Dự: bấm "➕ Thêm Người Tham Dự" cho từng dòng, hoặc chọn 1 mẫu có sẵn ở "🗂️ Mẫu danh sách tham gia" rồi bấm "▶️ Áp Dụng" thay vì nhập lại từ đầu.' },
      { text: 'Ghi Ý Kiến Chỉ Đạo: bấm "➕ Thêm Ý Kiến Chỉ Đạo" cho từng đầu việc, gán sẵn "Người thực hiện" nếu có.' },
      { text: 'Bấm <b>"Lưu Biên Bản Họp"</b> để hoàn tất — không có bước phê duyệt, nhưng CŨNG CHƯA sinh Công Việc nào (khác điều dễ nhầm: lưu KHÔNG tự động giao việc).' },
      { role: 'Người lập biên bản', text: 'muốn các Ý Kiến Chỉ Đạo đã gán người thực hiện thực sự thành Công Việc theo dõi được: mở lại biên bản (màn Xem) → bấm <b>"Giao việc"</b> cho từng đầu việc (hoặc toàn bộ) — làm xong biên bản tự khoá sửa (trừ admin xử lý khẩn cấp).' },
    ],
    footer: { left: [
      { label: 'Quyền tạo', text: 'chỉ người được cấp quyền tạo biên bản họp mới thấy được form tạo — người khác chỉ xem nội dung.' },
      { label: 'Đừng quên bấm "Giao việc" (9/2026)', text: 'lưu biên bản KHÔNG tự sinh Công Việc — Ý Kiến Chỉ Đạo dù đã gán "Người thực hiện" vẫn chỉ nằm trong nội dung biên bản tới khi có người chủ động bấm "Giao việc" trên màn Xem; quên bước này thì đầu việc không có gì để theo dõi tiến độ/nhắc hạn.' },
      { label: 'Giao việc lại cho đầu việc bị lỗi (9/2026)', text: 'nếu 1 đầu việc không sinh được Công Việc (tài khoản khai ở "Thành phần tham dự" không hợp lệ/đã khoá), Admin sửa lại đúng tài khoản rồi bấm "Giao việc" lại — hệ thống chỉ giao lại đúng (các) đầu việc còn thiếu, không tạo trùng các đầu việc đã giao thành công trước đó.' },
    ], right: [
      { label: 'Mẫu điểm danh', text: 'có thể lưu sẵn danh sách người tham dự thường xuyên thành 1 mẫu, để không phải chọn lại từ đầu mỗi lần họp định kỳ.' },
      { label: 'Xem/Tải/In khớp nội dung (9/2026)', text: 'màn Xem và file Tải/khung In nay dùng chung 1 bộ nội dung (kể cả chân ký Thư Ký/Chủ Trì), chỉ khác bản Xem có thêm nút "Giao việc" theo từng đầu việc.' },
    ] },
  },
  task: {
    icon: '📋', title: 'Công Việc', badge: 'Điều Hành',
    desc: 'Giao việc có người giao, người nhận, hạn hoàn thành và cập nhật tiến độ theo từng trạng thái — có thể tự sinh từ 1 đầu việc trong Biên Bản Họp.',
    flow: { ariaLabel: 'Quy trình Công Việc', chain: [
      { label: 'Giao việc', sub: 'TODO — người giao tạo, gán hạn' },
      { label: 'Nhận việc', sub: 'Người nhận bấm nhận → DOING' },
      { label: 'Cập nhật tiến độ', sub: 'Ghi chú nhiều lần, không cần đổi trạng thái' },
      { label: 'Hoàn thành', sub: 'Người nhận TỰ đóng — không ai duyệt lại', kind: 'approved' },
    ] },
    steps: [
      { role: 'Người giao việc', text: 'vào <b>🗂️ Điều Hành ▾ → 📋 Công việc</b> (sidebar) → bấm <b>"➕ Giao Việc Thủ Công"</b> → điền tiêu đề, mô tả, người nhận, hạn hoàn thành → lưu — việc mới ở trạng thái "Chưa bắt đầu" (TODO).' },
      { role: 'Người nhận việc', text: 'mở đúng việc của mình trong danh sách → bấm nhận việc để chuyển sang "Đang thực hiện" (DOING) → ghi chú cập nhật tiến độ nhiều lần trong lúc làm (không cần đổi trạng thái mỗi lần ghi chú).' },
      { role: 'Người nhận việc', text: 'làm xong tự bấm đóng việc thành "Đã hoàn thành" (DONE) — không cần ai duyệt lại.' },
      { role: 'Người nhận việc', text: 'cần dời hạn hoặc huỷ việc: bấm xin Gia Hạn/xin Huỷ trên đúng việc đó → chờ người giao việc Đồng ý/Từ chối (chưa có hiệu lực ngay khi xin, phải đợi duyệt).' },
      { text: 'Lọc nhanh danh sách: dùng 3 ô "Lọc Theo Trạng Thái"/"Lọc Theo Nguồn Gốc"/"Từ Khóa Tìm Kiếm" ngay trên đầu danh sách — bấm "Đặt Lại Bộ Lọc" để xoá hết bộ lọc đang áp dụng.' },
    ],
    footer: { left: [
      { label: 'Giao việc thay người khác', text: 'tạo/sửa (đổi tiêu đề, mô tả, hạn, người nhận) BẤT KỲ việc nào cần quyền quản lý công việc (hoặc admin); riêng "gán người nhận" cho 1 việc CHƯA có người nhận (VD việc tự sinh từ Văn Bản Trình) hẹp hơn — chỉ admin hoặc đúng người đã tạo/giao việc đó mới gán được, không dùng chung quyền Sửa. Nhân viên thường chỉ tự cập nhật tiến độ việc của mình. **Đổi người nhận khi đang "Đang thực hiện"**: việc tự đưa về "Chưa bắt đầu" (người mới phải tự Nhận việc lại từ đầu), xoá sạch công việc nhỏ cũ, và (từ 9/2026) tự huỷ luôn mọi yêu cầu Xin Gia Hạn/Xin Huỷ còn treo của người nhận CŨ — tránh người nhận MỚI bị chặn "Hoàn thành" vô cớ vì 1 yêu cầu không còn liên quan tới mình.' },
      { label: 'Xin Gia Hạn / Xin Huỷ — phải được duyệt', text: 'người NHẬN việc xin gia hạn hoặc xin huỷ đều phải chờ người GIAO việc (hoặc admin) Đồng ý/Từ chối, chưa có hiệu lực ngay khi xin. Mỗi lần gia hạn ĐƯỢC DUYỆT (không phải lúc xin) cộng thêm cả "số lần gia hạn" lẫn "số lần trễ hạn" — hệ thống không tự tính trễ hạn theo ngày hệ thống, chỉ tăng khi có xin gia hạn được duyệt. Ngược lại, người GIAO việc (hoặc admin) huỷ trực tiếp thì có hiệu lực NGAY, không cần ai duyệt.' },
      { label: 'Người phối hợp: nội bộ và ngoài hệ thống', text: 'chọn nội bộ từ danh sách tài khoản đang hoạt động, hoặc tự sinh "ngoài hệ thống" (có tên/email nhưng không đăng nhập được) khi Thành Phần Tham Dự trong Biên Bản Họp không khớp tài khoản nào — người ngoài hệ thống không tự bấm "Nhận việc"/"Xác nhận tham gia" được, người giao việc hoặc admin phải xác nhận thay.' },
    ], right: [
      { label: 'Tự sinh từ Văn Bản Trình / Biên Bản Họp', text: 'Văn Bản Trình: server TỰ ĐỘNG tạo 1 việc (CHƯA gán người) khi bước duyệt CUỐI CÙNG có kèm ý kiến chỉ đạo — vào Công Việc bấm "Gán người nhận" sau. Biên Bản Họp: phải bấm nút "Giao việc" thủ công cho từng đầu việc đã gán người trong biên bản — việc tạo ra vào THẲNG trạng thái "Đang thực hiện" (bỏ qua bước Nhận việc, vì coi như chủ trì/thư ký đã giao trực tiếp tại cuộc họp).' },
      { label: 'Xem được nhưng không thao tác', text: 'trưởng phòng (kể cả gián tiếp — đi lên hết chuỗi quản lý theo Cơ Cấu Tổ Chức, không chỉ đúng 1 cấp) xem được việc của toàn bộ nhân viên mình quản lý, nhưng CHỈ xem — không sửa/gán/huỷ được.' },
      { label: 'Công việc nhỏ (subtasks)', text: 'chỉ CHÍNH người nhận việc quản lý được (thêm/tick/xoá), và chỉ khi việc chính đang "Đang thực hiện" — hạn của việc nhỏ không được vượt hạn việc chính.' },
    ] },
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
    steps: [
      { role: 'Quản trị', text: 'mở <b>🗂️ Điều Hành ▾ → 📅 Báo Cáo Định Kỳ</b> (sidebar) → tab <b>"📅 Kỳ Báo Cáo"</b> → tạo kỳ mới (mẫu, tần suất, hạn chót) để mở đợt nhập cho các phòng ban.' },
      { role: 'Người phụ trách phòng ban', text: 'ở tab <b>"📝 Nhập Báo Cáo"</b> → chọn kỳ báo cáo đang mở cho phòng ban mình → điền Tiêu Đề báo cáo → tải lên 1 hoặc nhiều file PDF (hệ thống tự ghép thành 1 file duy nhất, giữ nguyên định dạng từng trang) → bấm <b>"💾 Lưu Nháp"</b> để lưu tạm hoặc <b>"📤 Gửi Báo Cáo"</b> để nộp chính thức đúng hạn.' },
      { role: 'Quản trị', text: 'tab <b>"🧩 Tổng Hợp"</b> → gộp báo cáo PDF của toàn bộ phòng ban đã nộp trong kỳ thành 1 bản trình chiếu chung.' },
      { text: 'Xem lại bản đã gộp: tab <b>"📣 Đã Phát Hành"</b>.' },
    ],
    footer: { left: [
      { label: 'Nhắc hạn (9/2026, job nền chạy thật)', text: 'hệ thống tự quét mỗi 24h, gửi email nhắc TỪNG phòng ban còn thuộc phạm vi kỳ mà CHƯA nộp báo cáo (Nháp chưa gửi vẫn tính là chưa nộp) — nhắc ở các mốc còn khoảng 3/1 ngày và ngay ngày hết hạn/đã quá hạn, mỗi mốc chỉ nhắc đúng 1 lần cho phòng ban đó. Người nhận là người của đúng phòng ban đang thiếu, có quyền "Nộp Báo Cáo Định Kỳ".' },
    ], right: [
      { label: 'Khác mục "Báo Cáo"', text: 'đây là quy trình chủ động — từng phòng ban tự nhập và nộp số liệu theo kỳ; mục "📊 Báo Cáo" ở cuối menu chỉ để xem lại số liệu đã tổng hợp, không có thao tác riêng.' },
    ] },
  },
  meeting: {
    icon: '📅', title: 'Đặt Phòng Họp', badge: 'Hành Chính',
    desc: 'Đặt phòng họp theo khung giờ — hệ thống tự kiểm tra trùng lịch trước khi xác nhận, có thể sửa lại (gửi phê duyệt lại) hoặc huỷ.',
    flow: { ariaLabel: 'Quy trình Đặt Phòng Họp', chain: [
      { label: 'Đăng ký giữ chỗ', sub: 'Chọn phòng + giờ, tự kiểm tra trùng lịch' },
      { label: 'Chờ duyệt', sub: 'Người có quyền duyệt xác nhận', kind: 'decision' },
      { label: 'Đã duyệt', sub: 'Sử dụng đúng lịch đã đặt', kind: 'approved' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Huỷ', sub: 'Người đặt tự huỷ, hoặc người quản lý phòng họp/admin huỷ bất kỳ lịch nào' }, loopBackToIndex: 0 } },
    steps: [
      { role: 'Người đặt lịch', text: 'vào <b>🏢 Hành Chính → 📅 Phòng họp</b> (sidebar) → tab <b>"📝 Đăng Ký"</b> → điền form: Phòng Ban Đặt Lịch, Chọn Phòng Họp, Chủ Đề, Số Lượng Người Tham Dự, Thời Gian Bắt Đầu/Kết Thúc, Thiết Bị Hỗ Trợ Yêu Cầu, Nội Dung/Agenda → có thể bấm <b>"🔍 Xem Quy Trình"</b> để xem trước ai sẽ duyệt, rồi bấm <b>"Gửi phê duyệt"</b> (hệ thống tự chặn nếu trùng phòng + khung giờ với lịch đang chờ/đã duyệt khác).' },
      { role: 'Người quản lý phòng họp', text: 'vẫn ở tab 📝 Đăng Ký, tìm phiếu đang chờ duyệt trong danh sách → bấm Duyệt hoặc mở "Khác ▾" bấm Huỷ (quyền này duyệt/huỷ/sửa được mọi phòng/phòng ban, không cần đúng phòng ban mình).' },
      { role: 'Người đặt lịch / Người quản lý phòng họp', text: 'đặt sai giờ/phòng/nội dung: mở "Khác ▾" ở dòng phiếu đó → bấm <b>"✏️ Sửa"</b> (từ 10/2026) — mở lại đúng form Đăng Ký với dữ liệu cũ, sửa lại rồi bấm Lưu. Hệ thống kiểm tra trùng phòng lại NGAY LÚC MỞ SỬA lẫn LÚC BẤM LƯU (loại trừ chính phiếu đang sửa). Nếu phiếu đang "Đã duyệt", Lưu xong tự quay về "Chờ duyệt" (gửi phê duyệt lại) — nếu đang "Chờ duyệt" thì giữ nguyên. Không sửa được lịch đã Huỷ.' },
      { text: 'Xem lịch trống/bận trực quan trước khi đặt: tab <b>"🗓️ Lịch Họp"</b> — lưới này hiện phòng bận của TOÀN CÔNG TY (kể cả lịch của đơn vị khác, chỉ hiện "đang bận", không hiện nội dung cuộc họp của họ).' },
    ],
    footer: { left: [
      { label: 'Chặn trùng lịch', text: 'chỉ chặn khi trùng ĐÚNG 1 phòng và khung giờ giao nhau — tính cả lịch đang "Chờ duyệt" lẫn "Đã duyệt" là đang chiếm chỗ (chặn ngay từ lúc đăng ký, không đợi tới lúc duyệt), chỉ bỏ qua lịch đã Huỷ; khoá theo tên phòng để 2 người bấm giữ cùng lúc không bao giờ trùng nhau. Từ 10/2026, lưới Lịch Họp + bước kiểm tra trùng giờ lúc Gửi đọc dữ liệu chiếm chỗ của TOÀN CÔNG TY (không chỉ lịch trong phạm vi xem của mình) — hết cảnh nhìn thấy "trống" rồi bị báo trùng khi bấm Gửi.' },
      { label: '✏️ Sửa + Gửi Phê Duyệt Lại (từ 10/2026)', text: 'thay cho việc phải Huỷ rồi tạo lịch mới như trước — ai được sửa: chính người đặt (creator), hoặc "Người Quản Lý Phòng Họp" (<code>meetingCancel</code>)/admin. Sửa được khi đang "Chờ duyệt" hoặc "Đã duyệt"; không sửa được lịch đã Huỷ. Đang "Đã duyệt" mà sửa xong sẽ tự chuyển về "Chờ duyệt" và báo lại người duyệt — đảm bảo không có lịch nào "Đã duyệt" mà nội dung/giờ giấc đã bị đổi khác lúc duyệt.' },
    ], right: [
      { label: 'Duyệt là 1 quyền phẳng toàn công ty', text: 'người được tick quyền <b>"Người Quản Lý Phòng Họp"</b> (cờ <code>meetingApprove</code> trong cây Phân Quyền, mục 5. Phòng Họp) duyệt được MỌI phòng/phòng ban (không cấu hình theo từng phòng ban/nhiều bước như các module dùng "Quy Trình & Phê Duyệt"); duyệt lại tự kiểm tra trùng phòng 1 lần nữa ngay tại thời điểm duyệt. Người này (hoặc admin) cũng huỷ được lịch của bất kỳ ai (cờ <code>meetingCancel</code>, tách riêng khỏi <code>meetingApprove</code>), không giới hạn mốc thời gian — huỷ được cả khi lịch đã bắt đầu/đã qua. Nút "🔍 Xem Quy Trình" ở form Đăng Ký hiện đúng danh sách những người đang giữ cờ <code>meetingApprove</code> này.' },
      { label: '📊 Báo Cáo', text: 'sub-tab riêng cho người có quyền duyệt: lọc theo khoảng ngày SỬ DỤNG (khác tab Đăng Ký lọc theo ngày tạo), xem tỷ lệ dùng phòng theo Phòng Họp/Phòng Ban đặt lịch, xu hướng theo tháng.' },
    ] },
  },
  car: {
    icon: '🚗', title: 'Đăng Ký Xe', badge: 'Cập nhật 9/2026',
    desc: 'Đăng ký lịch trình công tác cần xe — sau khi duyệt, bộ phận điều phối gán xe và tài xế cụ thể cho chuyến đi; lái xe xác nhận nhận chuyến rồi báo số km khi kết thúc, người đăng ký đánh giá lại chuyến đi sau cùng.',
    flow: { ariaLabel: 'Quy trình Đăng Ký Xe', chain: [
      { label: 'Đăng ký lịch trình', sub: 'Điểm đi/đến, thời gian' },
      { label: 'Duyệt', sub: 'Theo cấu hình phòng ban', kind: 'decision' },
      { label: 'Điều phối xe', sub: 'Gán xe + tài xế', kind: 'approved' },
      { label: 'Lái xe xác nhận & kết thúc', sub: 'Nhận chuyến (🚗 LX Đã Xác Nhận Chuyến) → báo km khi xong' },
      { label: 'Đánh giá & hoàn tất', sub: 'Người đăng ký xác nhận lại' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Bị từ chối', sub: 'Nêu lý do' }, loopBackToIndex: 0 } },
    steps: [
      { role: 'Người đăng ký', text: 'vào <b>🏢 Hành Chính ▾ → 🚗 Đăng ký xe</b> (sidebar) → tab đầu tiên "🚗 Đăng Ký Xe" → điền form: Đơn Vị, Loại Xe, Số Người Sử Dụng, Mục Đích Sử Dụng, Số KM Dự Kiến, Thời Gian Bắt Đầu/Dự Kiến Về, Lộ Trình Di Chuyển (bấm "+ Thêm Điểm" để thêm từng điểm dừng), Nội Dung Chi Tiết → bấm <b>"Gửi phê duyệt"</b>. Chưa cần chọn biển số/lái xe cụ thể ở bước này.' },
      { role: 'Người duyệt', text: 'mở đúng phiếu đang "Chờ duyệt" theo cấu hình luồng duyệt của phòng ban đăng ký → bấm Duyệt hoặc Từ chối (bắt buộc nêu lý do khi từ chối).' },
      { role: 'Người điều hành xe', text: 'sau khi phiếu đã duyệt, mở phiếu → gán Loại Xe cụ thể + Biển Số + Lái Xe (nếu chọn xe đánh dấu "Là Xe Taxi" thì điền thêm Hãng Taxi thay vì tài xế công ty) → lưu lại.' },
      { role: 'Lái xe', text: 'vào tab <b>🧑‍✈️ Lái Xe</b> → xem các chuyến được phân công cho mình → bấm xác nhận nhận chuyến (phiếu chuyển trạng thái "🚗 LX Đã Xác Nhận Chuyến") → khi kết thúc chuyến, báo lại số KM thực đi.' },
      { role: 'Người đăng ký', text: 'sau khi lái xe báo kết thúc, mở lại phiếu để đánh giá chuyến đi: chọn mức <b>1-5 sao</b> (Không hài lòng/Chưa hài lòng/Đạt yêu cầu/Tốt/Rất tốt); nếu chọn 1-4 sao sẽ hiện thêm câu hỏi "Điều gì cần thay đổi?" (tích chọn nhiều lý do từ danh mục) — 1-2 sao BẮT BUỘC chọn ít nhất 1 lý do mới đánh giá được, 3-4 sao không bắt buộc, 5 sao không hiện câu hỏi này — làm xong bước này phiếu mới tính là hoàn tất.' },
      { text: 'Muốn xem lái xe nào đang rảnh trước khi đăng ký: vào tab <b>🗓️ Lịch Xe</b>, chọn chế độ Ngày/Tuần/Tháng để xem lịch trống/bận theo từng lái xe.' },
      { role: 'Người đăng ký', text: 'lỡ cần đổi lộ trình/ngày giờ sau khi đã gửi (kể cả đã duyệt xong): bấm <b>"🔄 Đổi Lộ Trình"</b> ở danh sách phiếu → sửa Lộ Trình Di Chuyển (thêm/bớt điểm), Ngày Kết Thúc, và Ngày/Giờ Xuất Phát nếu chuyến CHƯA bắt đầu → bấm "Lưu & Gửi Duyệt Lại". Phiếu tự quay lại bước 1, phải được duyệt lại từ đầu.' },
    ],
    footer: { left: [
      { label: 'Điều phối tách biệt', text: 'người duyệt đăng ký khác với người điều phối xe — bộ phận điều phối (quyền "Người Điều Hành Xe") chỉ thao tác sau khi đăng ký đã được duyệt.' },
      { label: 'Đánh giá & xác nhận', text: 'lái xe tự xác nhận đã nhận chuyến (chuyển trạng thái "🚗 LX Đã Xác Nhận Chuyến"), rồi báo số km thực đi khi kết thúc; sau đó người đăng ký xem lại và đánh giá chuyến đi — xong bước này chuyến mới được tính là hoàn tất.' },
      { label: 'Đánh giá 1-5 sao (9/2026)', text: 'mức đánh giá cố định 1-5 sao ↔ Không hài lòng/Chưa hài lòng/Đạt yêu cầu/Tốt/Rất tốt. 1-4 sao hiện thêm câu hỏi "Điều gì cần thay đổi?" (tích chọn nhiều từ danh mục lý do, admin tự sửa ở "🗂️ Quản Lý Danh Mục" — Hệ Thống ▾ → Quản Trị): 1-2 sao BẮT BUỘC chọn ít nhất 1 lý do mới đánh giá được, 3-4 sao không bắt buộc, 5 sao ẩn hẳn câu hỏi và server tự xoá sạch lý do nếu có gửi kèm. Server luôn tự kiểm tra lại độc lập, không tin dữ liệu client gửi lên.' },
      { label: 'Hủy đăng ký', text: 'người đăng ký tự hủy được đăng ký của mình khi CHƯA ai duyệt (còn ở bước 1), hoặc bất kỳ lúc nào SAU khi đã duyệt xong (kể cả khi lái xe đã xác nhận nhưng chưa kết thúc chuyến) — chỉ không hủy được khi đang dở dang giữa các bước duyệt, hoặc chuyến đã thực sự kết thúc.' },
      { label: '🔄 Đổi Lộ Trình (10/2026)', text: 'CHÍNH người đăng ký hoặc admin (không phải người duyệt) chủ động đổi Lộ Trình (thêm/bớt điểm) + Ngày Kết Thúc — áp dụng ở PENDING/Đã duyệt/LX Đã Xác Nhận Chuyến. Ngày/Giờ Xuất Phát CŨNG sửa được nhưng CHỈ khi chuyến CHƯA bắt đầu (PENDING/Đã duyệt) — khi tài xế ĐÃ xác nhận nhận chuyến (LX Đã Xác Nhận Chuyến) thì khoá lại, chỉ còn Lộ Trình + Ngày Kết Thúc. Nút KHÔNG hiện nữa khi tài xế đã báo kết thúc chuyến (Chờ đánh giá/Hoàn thành). Sau khi lưu, phiếu TỰ quay lại bước 1, phải duyệt lại từ đầu (khác "🔁 Đổi Tài Xế-Xe" dưới đây — không quay lại quy trình duyệt); nếu phiếu đã có xe/tài xế gán sẵn thì phần phân công đó bị xoá, Người Điều Hành Xe phải gán lại sau khi duyệt xong.' },
      { label: '🔁 Đổi Tài Xế-Xe', text: 'sau khi đã duyệt (Đã duyệt hoặc LX Đã Xác Nhận Chuyến), người điều phối bấm "🔁 Đổi Tài Xế-Xe" để đổi lái xe VÀ/HOẶC loại xe-biển số — đổi ĐỘC LẬP từng phần, không bắt buộc đổi cả hai, có hiệu lực NGAY, không quay lại quy trình duyệt. Đổi lái xe: hệ thống tự kiểm tra người được gán mới có đang bận chuyến khác trùng giờ không (chặn nếu trùng); nếu chuyến đã được tài xế cũ xác nhận, trạng thái xác nhận tự reset về "chưa xác nhận" cho tài xế mới. **Đổi tài xế khi chuyến đang "🚗 LX Đã Xác Nhận Chuyến" (từ 9/2026)**: phiếu tự quay LẠI trạng thái "Đã duyệt" (không còn giữ nguyên "LX Đã Xác Nhận Chuyến" với cờ xác nhận đã bị xoá) — để tài xế MỚI bấm xác nhận nhận chuyến lại từ đầu; trước đây phiếu bị KẸT vĩnh viễn ở tình huống này (không ai xác nhận/kết thúc chuyến được nữa, chỉ còn cách Hủy Chuyến).' },
      { label: 'Chuyển sang Taxi (trường hợp riêng của Đổi Tài Xế-Xe)', text: 'chọn loại xe cụ thể đánh dấu "Là Xe Taxi" (lúc duyệt hay lúc "Đổi Tài Xế-Xe" sau này) tự xoá luôn tài xế công ty đã gán, vì xe giờ là taxi thuê ngoài; đổi ngược lại từ Taxi sang xe công ty thì tự xoá "Hãng Taxi" đã ghi. Nếu đổi sang Taxi lúc chuyến đang "🚗 LX Đã Xác Nhận Chuyến" thì phiếu tự quay LẠI "Đã duyệt" (từ 10/2026 — trước đây kẹt vĩnh viễn, giống hệt tình huống đổi tài xế ở trên). "Loại xe cụ thể"/"Hãng Taxi" nhập vào bắt buộc khớp đúng danh mục quản trị, không lưu được giá trị lạ.' },
      { label: 'Phiếu đi Taxi hoàn tất thế nào (từ 10/2026)', text: 'xe Taxi không có tài xế hệ thống nên KHÔNG có bước "Xác Nhận Đăng Ký": người đăng ký (hoặc Người Điều Hành Xe/admin) bấm thẳng <b>"🏁 Kết Thúc Chuyến (Taxi)"</b> ở menu thao tác của dòng phiếu, nhập số KM thực tế, rồi bấm "⭐ Đánh Giá (bắt buộc)" như thường để phiếu chuyển "✅ Hoàn Thành". Phiếu dùng xe đội nhà giữ nguyên luật cũ (chỉ tài xế được phân công kết thúc chuyến, chỉ người đăng ký đánh giá).' },
    ], right: [
      { label: 'Báo Cáo: lịch sử đánh giá + xác nhận', text: 'mục 📊 Báo Cáo có 2 bảng chi tiết: "ai đánh giá lái xe nào, ở phiếu nào, mức mấy sao, lý do cần thay đổi (nếu có), nhận xét gì" và "lái xe xác nhận/kết thúc phiếu nào, lúc nào, báo bao nhiêu km".' },
      { label: 'Biểu đồ xu hướng chọn kỳ', text: 'biểu đồ số chuyến + số km theo Ngày/Tuần/Tháng/Quý/Năm, tách biệt với mục Lịch Xe (xem lịch trực quan theo ngày/tuần/tháng, không phải biểu đồ thống kê).' },
      { label: 'Quyền xem/tải Phiếu Phê Duyệt', text: 'chỉ người đăng ký, tài xế được gán, người duyệt hồ sơ đó, hoặc admin — không còn mở rộng theo phòng ban như các file tải khác trong hệ thống.' },
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
    steps: [
      { role: 'Người đăng ký', text: 'vào <b>🏢 Hành Chính ▾ → 🖇️ Văn phòng phẩm</b> (sidebar) → tab <b>"📝 Đăng Ký"</b> → chọn kỳ đăng ký đang mở → tick chọn mặt hàng và nhập Số Lượng cho từng dòng cần (chỉ dòng nhập số lượng > 0 mới tính là đã chọn, có ô tìm nhanh theo tên mặt hàng) → theo dõi tổng tiền ở khung dưới bảng.' },
      { text: 'Bấm "💾 Kết Thúc Chọn (Lưu Nháp)" để lưu tạm, sửa lại được sau; khi đã ưng thì bấm <b>"Gửi phê duyệt"</b> để gửi chính thức. Lỡ gửi nhầm mà CHƯA ai duyệt (còn ở bước 1) thì bấm <b>"🚫 Hủy Đăng Ký"</b> ngay ở danh sách để rút lại.' },
      { role: 'Người duyệt', text: 'vào mục ✅ Phê Duyệt (sidebar) → tìm đúng hồ sơ VPP đang chờ → bấm Duyệt hoặc Từ chối, hoặc "Yêu Cầu Bổ Sung" để trả về Nháp cho người đăng ký sửa lại.' },
      { role: 'Quản trị', text: 'tab <b>"📅 Kỳ Đăng Ký"</b> để mở/kết thúc từng kỳ; tab <b>"📊 Báo Cáo Tổng Hợp"</b> để xem tổng hợp toàn công ty theo kỳ.' },
    ],
    footer: { left: [
      { label: 'Ngân sách theo phòng ban', text: 'quản trị có thể cấu hình mức riêng cho từng người, hoặc chặn theo tổng ngân sách cả phòng — 2 kiểu này không dùng cùng lúc cho 1 phòng ban. Cảnh báo LIVE ngay khi đang chọn mặt hàng nếu vượt phần còn lại, nhưng CHẶN THẬT chỉ xảy ra lúc bấm "Gửi phê duyệt" (tải lại số liệu mới nhất rồi mới chặn — server cũng tự kiểm tra lại lần nữa).' },
      { label: 'Không sửa trực tiếp sau khi Gửi', text: 'đã gửi (Chờ duyệt) thì không tự sửa được — chỉ khi người duyệt bấm "Yêu Cầu Bổ Sung" mới đưa hồ sơ về Nháp để sửa lại rồi gửi lại; hồ sơ Bị Từ Chối coi như kết thúc, muốn đăng ký lại thì tạo bản Nháp mới.' },
      { label: 'Hủy Đăng Ký (từ 9/2026)', text: 'chỉ hủy được khi ĐANG chờ duyệt bước 1 (chưa ai duyệt gì cả) — người tạo hoặc admin bấm "🚫 Hủy Đăng Ký" ở danh sách. Hồ sơ đã qua ít nhất 1 bước duyệt thì KHÔNG tự hủy được nữa (nhờ người duyệt bước hiện tại Từ Chối thay); hủy rồi tự "nhả chỗ" ngân sách phòng ban ngay (không còn tính vào "đã giữ chỗ" khi phòng khác đăng ký).' },
    ], right: [
      { label: 'Xuất Excel danh mục', text: 'quản trị có thể tải file mẫu và xuất Excel toàn bộ danh mục mặt hàng để đối chiếu ngoài hệ thống.' },
      { label: 'Theo từng Kỳ Đăng Ký', text: 'chỉ đăng ký được khi có ít nhất 1 kỳ đang Mở; quản lý có thể "Kết Thúc Kỳ" sớm để khoá đăng ký thêm. Mỗi kỳ tự chọn ngân sách/người dùng CHUNG 1 mức toàn công ty, hoặc CHIA NHIỀU NHÓM mức khác nhau theo phòng ban.' },
    ] },
  },
  uniform: {
    icon: '👕', title: 'Đồng Phục', badge: 'Hành Chính',
    desc: 'Mô hình ĐẨY XUỐNG, không phải nhân viên tự đăng ký: Hành Chính lập Kỳ Cấp Phát, phân bổ mặt hàng/size/số lượng cho từng siêu thị, Giám Đốc Siêu Thị xác nhận đã nhận rồi mới cấp phát cho từng nhân viên.',
    flow: { ariaLabel: 'Quy trình Đồng Phục', chain: [
      { label: 'Hành Chính lập Kỳ Cấp Phát', sub: 'Phân bổ mặt hàng/size/số lượng cho từng siêu thị' },
      { label: 'Duyệt kỳ', sub: '', kind: 'decision' },
      { label: 'Siêu thị xác nhận đã nhận', sub: 'Chỉ làm được sau khi kỳ đã duyệt' },
      { label: 'Cấp phát cho nhân viên', sub: 'Nhân viên tự xác nhận đã nhận', kind: 'approved' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Từ chối', sub: 'QUYẾT ĐỊNH CUỐI CÙNG — kỳ này không làm lại được nữa' }, loopBackToIndex: 0 } },
    steps: [
      { role: 'Hành Chính', text: 'vào <b>🏢 Hành Chính ▾ → 👕 Đồng phục</b> (sidebar) → tab <b>"📦 Kỳ Cấp Phát"</b> → bấm "+ Thêm Siêu Thị" để phân bổ mặt hàng/size/số lượng cho từng siêu thị → có thể bấm <b>"🔍 Xem Quy Trình"</b> để xem trước ai sẽ duyệt kỳ này → bấm <b>"Tạo Kỳ Cấp Phát"</b>.' },
      { role: 'Giám Đốc Siêu Thị', text: 'vào tab <b>"✅ Xác Nhận / Cấp Phát"</b> → mục "✅ Xác Nhận Nhận Đồng Phục Từ Hành Chính" → xác nhận đã nhận đúng số lượng kỳ vừa phân bổ cho siêu thị mình (chỉ làm được sau khi kỳ đã duyệt).' },
      { role: 'Giám Đốc Siêu Thị', text: 'vẫn ở tab đó, mục "👕 Cấp Đồng Phục Cho Nhân Viên" → bấm "+ Thêm Mặt Hàng" chọn từng mặt hàng/size cấp cho nhân viên cụ thể → bấm <b>"Cấp Phát"</b>.' },
      { role: 'Nhân viên', text: 'tự xác nhận đã nhận đồng phục ở Hồ Sơ Cá Nhân — bước này khép lại vòng cấp phát cho người đó.' },
      { text: 'Xem tồn kho hiện tại: tab <b>"📊 Kho Đồng Phục"</b> (tự tính động, không lưu số liệu riêng); xem tổng quan toàn công ty: tab <b>"📈 Tổng Quan"</b>.' },
      { role: 'Hành Chính', text: 'Điều Chuyển Kho Giữa Các Siêu Thị: vẫn ở tab "✅ Xác Nhận / Cấp Phát" → mục "⏳ Chờ Duyệt" để Duyệt/Từ Chối yêu cầu điều chuyển của siêu thị; lỡ duyệt nhầm thì bấm <b>"🚫 Hủy Điều Chuyển"</b> ở mục "🚚 Đang Vận Chuyển — Hủy Nếu Cần" ngay bên dưới (chỉ hủy được TRƯỚC KHI siêu thị đích xác nhận đã nhận).' },
    ],
    footer: { left: [
      { label: 'Mô hình đẩy xuống, không phải đăng ký', text: 'nhân viên KHÔNG tự đăng ký đồng phục — Hành Chính (quyền "uniformManage") phân bổ xuống từng siêu thị trước, Giám Đốc Siêu Thị (quyền "uniformStoreManage") xác nhận nhận hàng rồi mới cấp phát cho từng người; nhân viên chỉ tự xác nhận ĐÃ NHẬN (ở Hồ Sơ Cá Nhân), không tự chọn/yêu cầu được mặt hàng.' },
      { label: 'Theo đợt (Kỳ Cấp Phát)', text: 'mỗi kỳ tách riêng, mỗi siêu thị chỉ xuất hiện 1 lần/kỳ — không gộp lẫn số liệu giữa các kỳ khác nhau khi tra lịch sử. Từ chối 1 kỳ là quyết định cuối cùng, không sửa/gửi duyệt lại được kỳ đó.' },
    ], right: [
      { label: 'Kho tính động, không lưu số liệu riêng', text: 'tồn kho mỗi siêu thị = tổng đã xác nhận nhận trừ đi đã cấp phát cho nhân viên — không có bảng tồn kho lưu sẵn, luôn tính lại theo dữ liệu thật.' },
      { label: 'Mã SKU tự sinh lần đầu', text: 'mỗi cặp (mặt hàng, size) chỉ sinh mã 1 LẦN đầu tiên khi được bất kỳ siêu thị nào xác nhận nhận, dùng lại mãi về sau — không sinh lại mỗi kỳ.' },
      { label: 'Điều Chuyển Kho Giữa Các Siêu Thị (Phase 2)', text: 'Giám Đốc Siêu Thị tự yêu cầu chuyển hàng sang siêu thị khác (đủ tồn kho mới gửi được, có nút "🔍 Xem Quy Trình" ở form để xem trước ai duyệt) → Hành Chính/người có quyền duyệt (uniformApprove/uniformManage) Duyệt hoặc Từ Chối → duyệt xong hàng coi như "đang vận chuyển" (tồn kho NGUỒN giảm ngay) → siêu thị ĐÍCH tự "Xác Nhận Đã Nhận" thì tồn kho đích mới thật sự tăng. Lỡ duyệt nhầm mà siêu thị đích CHƯA xác nhận nhận thì người có quyền duyệt bấm <b>"🚫 Hủy Điều Chuyển"</b> (từ 9/2026) ngay ở mục "🚚 Đang Vận Chuyển — Hủy Nếu Cần" — tồn kho siêu thị nguồn tự nhả lại ngay, không cần thao tác gì thêm.' },
      { label: 'Xác nhận hộ khi nhân viên đã nghỉ việc (9/2026)', text: 'phiếu cấp phát ở trạng thái "⏳ Chờ xác nhận" mà nhân viên đã nghỉ việc/khoá tài khoản (không tự bấm được nữa) — Giám Đốc Siêu Thị (uniformStoreManage) bấm nút <b>"✅ Xác nhận hộ (đã nghỉ việc)"</b> hiện ngay tại bảng "Lịch Sử Cấp Phát" cho đúng phiếu đó; nút này CHỈ hiện khi tài khoản nhân viên đã inactive — còn hoạt động vẫn bắt buộc tự nhân viên xác nhận.' },
    ] },
  },
  license: {
    icon: '📜', title: 'Giấy Phép', badge: 'Hành Chính',
    desc: 'Tải lên giấy phép/đăng ký kinh doanh của từng công ty/địa điểm (Nhập mới hoặc Cập nhật thêm phiên bản cho giấy phép đã có), gửi duyệt — sau khi duyệt hệ thống tự theo dõi hiệu lực theo Ngày hết hạn, tách biệt hoàn toàn với trạng thái duyệt.',
    flow: { ariaLabel: 'Quy trình Giấy Phép', chain: [
      { label: 'Tải lên', sub: 'Nhập mới hoặc Cập nhật phiên bản' },
      { label: 'Duyệt?', sub: '', kind: 'decision' },
      { label: 'Đã duyệt', sub: 'Bắt đầu theo dõi hiệu lực', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'duyệt', rejectLabel: 'từ chối', rejectBox: { label: 'Bị từ chối', sub: 'Nêu lý do' }, loopBackToIndex: 0, loopBackLabel: 'Tải lên lại' },
      reference: { atIndex: 0, label: 'Loại Giấy Phép', sub: 'Danh mục tự học từ giá trị mới gõ' } },
    steps: [
      { role: 'Người tải lên', text: 'vào <b>🏢 Hành Chính ▾ → 📜 Giấy phép</b> (sidebar) → điền form "📜 Tải Lên Giấy Phép": chọn Loại thao tác "➕ Nhập mới", Tên công ty chủ quản, Tên địa điểm, Tình trạng hoạt động, Tên/Loại Giấy Phép, Số giấy phép, Ngày cấp/Ngày hết hạn, Cơ quan cấp phép, tệp đính kèm → bấm gửi.' },
      { role: 'Người duyệt', text: 'vào mục ✅ Phê Duyệt (sidebar) → tìm đúng hồ sơ Giấy Phép đang chờ → bấm Duyệt hoặc Từ chối (nêu lý do).' },
      { role: 'Người tải lên', text: 'thêm phiên bản mới cho giấy phép đã có: chọn Loại thao tác "🔄 Cập nhật (thêm phiên bản cho giấy phép đã có)" → chọn đúng giấy phép ở "Chọn Giấy Phép Cần Cập Nhật" (chỉ hiện giấy phép mà phiên bản mới nhất không đang chờ duyệt) → gửi lại như bước 1 (mã tự sinh dạng &lt;mã gốc&gt;-V&lt;số thứ tự&gt;).' },
      { text: 'Sau khi duyệt, hệ thống tự tính hiệu lực (Còn hiệu lực/Sắp hết hạn/Hết hạn) theo Ngày hết hạn — đánh dấu "Đang gia hạn"/"Đã thu hồi" trực tiếp trên giấy phép đã duyệt khi cần.' },
    ],
    footer: { left: [
      { label: 'Cập nhật = thêm phiên bản mới', text: 'chọn "Cập nhật" để thêm 1 phiên bản mới cho giấy phép đã có (mã tự sinh dạng <mã gốc>-V<số thứ tự>) — chỉ thực hiện được khi phiên bản mới nhất KHÔNG đang chờ duyệt.' },
      { label: 'Hủy khi còn chờ duyệt (9/2026)', text: 'gửi nhầm tệp/thông tin trong khi CÒN ĐANG chờ duyệt (chưa ai xử lý) thì tự bấm "🚫 Hủy" ngay tại bảng danh sách (chỉ hiện với chính người tạo) — không cần chờ người duyệt Từ Chối hộ. Đã duyệt/từ chối rồi thì không hủy được nữa.' },
      { label: 'Hiệu lực tách biệt với duyệt', text: '"Đang gia hạn"/"Đã thu hồi" là trạng thái RIÊNG, chỉ đánh dấu được cho giấy phép ĐÃ duyệt và chưa bị thu hồi — không đụng tới lịch sử duyệt.' },
    ], right: [
      { label: 'Tự tính hiệu lực', text: 'Còn hiệu lực / Sắp hết hạn (≤30 ngày) / Hết hạn tự tính theo Ngày hết hạn, có nhắc tự động trước khi hết hạn — job nhắc hạn (9/2026) chỉ xét ĐÚNG phiên bản MỚI NHẤT của mỗi giấy phép, tự bỏ qua các phiên bản CŨ đã bị thay thế (trước đây gia hạn sớm vẫn khiến bản cũ tiếp tục gửi nhắc hạn trùng lặp).' },
      { label: 'Thu hồi', text: 'bắt buộc nhập lý do; sau khi thu hồi không đánh dấu "Đang gia hạn" được nữa — huỷ đánh dấu thu hồi được nếu thao tác nhầm.' },
      { label: 'Không tự duyệt hồ sơ của chính mình (9/2026)', text: 'người vừa tải giấy phép lên không Duyệt/Từ chối/đánh dấu Gia hạn/Thu hồi chính hồ sơ đó được, kể cả khi có quyền "Duyệt Giấy Phép" — cần 1 người duyệt KHÁC (Quản Trị Viên vẫn giữ đặc quyền vượt cấu hình). Nút tương ứng cũng được ẩn sẵn.' },
      { label: 'Xoá bản gốc xoá luôn cả "họ" (9/2026)', text: 'xoá 1 giấy phép GỐC nay xoá kèm toàn bộ phiên bản gia hạn của nó — trước đây để lại các phiên bản con mồ côi, hiện lẫn trong danh sách và không cập nhật tiếp được. Xoá 1 phiên bản con vẫn chỉ xoá đúng phiên bản đó.' },
    ] },
  },
  office: {
    icon: '🛒', title: 'Mua Bán / Sửa Chữa / Thanh Toán', badge: 'Tổng Hợp',
    desc: 'Đề xuất mua sắm hoặc sửa chữa, sau khi duyệt và thực hiện thì chi phí thực tế được ghi nhận ở mục Thanh Toán, liên kết ngược về đúng đề xuất gốc.',
    flow: { ariaLabel: 'Quy trình Mua Bán/Sửa Chữa/Thanh Toán', chain: [
      { label: 'Đề xuất', sub: 'Mua Sắm (có bảng hạng mục) hoặc Sửa Chữa (1 dòng tổng)' },
      { label: 'Duyệt theo lớp', sub: '2 luồng workflow RIÊNG theo từng phân hệ', kind: 'decision' },
      { label: 'Tải Tài Liệu Ký', sub: 'Bắt buộc trước khi chuyển sang Thanh Toán', kind: 'approved' },
      { label: 'Thanh Toán', sub: 'Nháp → Chờ duyệt → Đã duyệt → Đã thanh toán' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Bị từ chối / Yêu cầu bổ sung', sub: 'Bổ sung → về Nháp sửa & gửi lại' }, loopBackToIndex: 0 } },
    steps: [
      { role: 'Người đề xuất', text: 'vào mục 🗂️ Tổng Hợp (sidebar) → chọn tab <b>"🛒 Mua Bán"</b> hoặc <b>"🔧 Sửa Chữa"</b> → điền form: Phòng Ban Trình, Tên Hạng Mục, Số Lượng/Quy Mô, Dự Toán/Tổng Chi Phí, Đối Tác/Nhà Cung Cấp (Mua Sắm có thêm bảng hạng mục con để khai chi tiết từng tài sản) → gửi phê duyệt. Lỡ gửi nhầm mà CHƯA ai duyệt (còn ở bước 1) thì bấm <b>"🚫 Hủy Đề Xuất"</b> ngay ở danh sách để rút lại.' },
      { role: 'Người duyệt', text: 'vào mục ✅ Phê Duyệt (sidebar) → tìm đúng hồ sơ Mua Sắm/Sửa Chữa đang chờ ở đúng phòng ban → bấm Duyệt, Từ chối, hoặc Yêu Cầu Bổ Sung (trả về Nháp cho người đề xuất sửa lại).' },
      { role: 'Người đề xuất', text: 'sau khi duyệt xong, tải "Tài liệu ký" ngay trên đề xuất đó — bắt buộc phải có tài liệu này mới hiện được nút chuyển sang Thanh Toán.' },
      { role: 'Người lập thanh toán', text: 'vào tab <b>"💰 Thanh Toán"</b> → mục <b>"➕ Tạo Mới"</b> → tạo đề nghị thanh toán từ đề xuất đã có Tài liệu ký (hoặc tạo thủ công), kèm ít nhất 1 tệp "Hồ Sơ Đề Nghị Thanh Toán" → gửi duyệt.' },
      { role: 'Người duyệt thanh toán (kế toán)', text: 'mục <b>"✅ Xác Nhận Đề Nghị Thanh Toán"</b> → Duyệt xong đợt chuyển "Đã duyệt" (đang chờ thanh toán) → xác nhận đã chi tiền để chuyển "Đã thanh toán" (khoá cứng, không sửa/xoá được nữa).' },
      { text: 'Theo dõi/sửa các đợt thanh toán: mục "🗂️ Quản Lý Thanh Toán".' },
    ],
    footer: { left: [
      { label: 'Hạng mục chi tiết — CHỈ ở Mua Sắm', text: 'phân hệ Mua Sắm có bảng hạng mục con (tên tài sản/model/ĐVT/số lượng/đơn giá/thành tiền tự tính); phân hệ Sửa Chữa KHÔNG dùng bảng hạng mục — chỉ 1 dòng tổng (số lượng/giá trị dự kiến/nhà cung cấp).' },
      { label: 'Thanh Toán: 5 trạng thái + chia đợt', text: 'Nháp (chưa gửi) → Chờ duyệt → (Cần bổ sung) → Đã duyệt (đang chờ thanh toán) → Đã thanh toán (khoá cứng, không sửa/xoá được nữa). Chia được nhiều đợt thanh toán, mỗi đợt có hạn riêng; tạo THỦ CÔNG (không từ Hợp Đồng/Office) với nhiều đợt thì MỖI đợt tách thành 1 hồ sơ riêng, tự đi hết quy trình duyệt/xác nhận độc lập.' },
      { label: 'Hủy Đề Xuất (từ 9/2026)', text: 'chỉ hủy được khi ĐANG chờ duyệt bước 1 (chưa ai duyệt gì cả) — người tạo hoặc admin bấm "🚫 Hủy Đề Xuất" ở danh sách. Đề xuất đã qua ít nhất 1 bước duyệt/đã Phê Duyệt xong thì KHÔNG tự hủy được nữa qua nút này (khác Đăng Ký Xe không mở rộng huỷ sau duyệt cho Mua Sắm/Sửa Chữa — chưa có khái niệm "đang thực hiện giữa chừng" cần huỷ).' },
    ], right: [
      { label: 'Người duyệt Thanh Toán', text: 'ghi nhận/quản lý 1 đề xuất Mua Sắm/Sửa Chữa cần CẢ quyền phạm vi phòng ban (tạo đề xuất theo đúng phòng ban đó) LẪN quyền riêng theo phân hệ ("officeBuy" cho Mua Sắm / "officeFix" cho Sửa Chữa); việc DUYỆT (Chờ duyệt → Đã duyệt) đi qua workflow theo phòng ban riêng, còn xác nhận ĐÃ THANH TOÁN là quyền quản lý thanh toán khác (kế toán), không phải người duyệt bước.' },
      { label: 'Tài liệu ký là điều kiện bắt buộc', text: 'đề xuất đã duyệt phải tải "Tài liệu ký" thì mới hiện nút chuyển sang Thanh Toán; nộp Thanh Toán cũng bắt buộc kèm ít nhất 1 tệp "Hồ Sơ Đề Nghị Thanh Toán" trước khi gửi duyệt — xác nhận Đã Thanh Toán thì KHÔNG còn bắt buộc tải thêm tệp nữa (đã đủ điều kiện từ 2 bước trên).' },
      { label: 'Tự động nhắc hạn từng đợt (từ 9/2026)', text: 'với đề nghị Đã duyệt (đang chờ thanh toán), hệ thống tự quét mỗi ngày và gửi email nhắc khi 1 đợt còn khoảng 3/1/0 ngày là tới hạn (hoặc đã quá hạn) — gửi tới người tạo đề nghị VÀ mọi người đang giữ quyền quản lý Thanh Toán (paymentManage). Mỗi đợt chỉ nhắc 1 lần cho mỗi ngưỡng đã vượt qua; đợt đã xác nhận thanh toán thì không còn bị nhắc nữa.' },
      { label: 'Quản lý thấy đề nghị Thanh Toán của nhân viên mình (10/2026)', text: 'quản lý trực tiếp (hoặc cấp cao hơn — đệ quy mọi cấp theo Cơ Cấu Tổ Chức) của người tạo đề nghị thanh toán tự xem được hồ sơ, không cần cấp quyền quản lý thanh toán riêng — cùng cơ chế với Tài Liệu/Hợp Đồng.' },
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
    steps: [
      { role: 'Người đề xuất', text: 'vào <b>🗂️ Tổng Hợp ▾ → 📊 Ngân Sách</b> (sidebar) → tab <b>📝 Đề Xuất</b> → chọn Vị Trí (🏢 Trụ sở chính (HO) hoặc 🏬 Siêu Thị — chọn xong tự hiện đúng ô Khối Phòng Ban hoặc Siêu Thị tương ứng) → điền Danh Mục, Nội Dung, VAT (%), Năm NS/Tháng NS, số tiền → bấm <b>"➕ Thêm Đề Xuất"</b>.' },
      { role: 'Người quản lý ngân sách', text: 'vẫn ở tab 📝 Đề Xuất, chọn dòng đang chờ trong danh sách → Duyệt hoặc Từ chối. Duyệt xong hệ thống TỰ SINH 1 dòng tương ứng bên tab <b>✅ Phê Duyệt</b> — không tự tạo tay dòng này.' },
      { role: 'Người quản lý ngân sách', text: 'qua tab <b>✅ Phê Duyệt</b>, xử lý tiếp dòng vừa tự sinh — duyệt xong hệ thống lại TỰ SINH tiếp 1 dòng cha bên tab <b>💳 Sử Dụng</b>.' },
      { role: 'Người phụ trách phòng ban/siêu thị', text: 'qua tab 💳 Sử Dụng, chọn đúng dòng cha vừa sinh → ghi nhận từng lần sử dụng thực tế (dòng con) — nội dung/loại hạng mục của dòng cha giữ nguyên từ nguồn, không sửa được ở đây.' },
      { text: 'Xem tổng hợp: vào tab <b>📊 Báo Cáo</b> (chỉ hiện cho người có quyền xem báo cáo) để xem số liệu theo phòng ban/siêu thị, bấm "📤 Xuất Excel" nếu cần tải ra ngoài.' },
      { text: 'Nhập nhanh hàng loạt (thay vì nhập tay từng dòng): ở tab Đề Xuất/Phê Duyệt bấm "⬇️ Tải File Excel Mẫu", điền vào file rồi bấm "⬆️ Nhập Excel" để nạp lại.' },
    ],
    footer: { left: [
      { label: 'Không cho sửa nội dung nguồn', text: 'khi hệ thống tự sinh dòng Sử Dụng, nội dung và loại hạng mục luôn lấy nguyên từ dòng gốc — không ai chỉnh sửa được ở bước này. Nếu chọn Vị trí là Siêu Thị, hệ thống cũng tự gán đúng tên siêu thị đó cho dòng ngân sách.' },
      { label: 'Không tự duyệt hồ sơ mình tạo', text: 'áp dụng cho mọi vai trò, kể cả quản trị viên, không có ngoại lệ.' },
    ], right: [
      { label: 'Quyền đề xuất & ghi nhận', text: 'tự tạo/sửa/xoá đề xuất của mình, và ghi nhận phần Sử Dụng cho đúng phòng ban/siêu thị mình phụ trách.' },
      { label: 'Quyền quản lý toàn bộ', text: 'duyệt đề xuất, tạo và duyệt phần Phê Duyệt, sửa/xoá được dòng Sử Dụng gốc — quyền cao nhất trong mục này. **Từ 9/2026**: chỉ sửa được Vị Trí/Khối Phòng Ban của dòng Sử Dụng gốc khi dòng đó CHƯA có mục con nào ghi nhận — đã có mục con thì chỉ sửa được Ghi chú (đổi Vị Trí/Khối Phòng Ban lúc này sẽ làm lệch quyền xem/sửa của các mục con đã ghi nhận), muốn chuyển hẳn sang phòng ban khác thì tạo 1 dòng Sử Dụng mới.' },
      { label: 'Quyền xem báo cáo', text: 'xem được số liệu của mọi phòng ban/siêu thị và tab Báo Cáo, nhưng không tạo hay duyệt được gì.' },
      { label: 'Excel Tải Mẫu/Nhập/Xuất', text: 'tab Đề Xuất/Phê Duyệt có đủ cả 3 nút; tab Sử Dụng/Báo Cáo chỉ có nút Xuất Excel.' },
      { label: 'Cảnh báo Vượt Ngân Sách (9/2026)', text: 'ghi nhận Sử Dụng KHÔNG bị chặn dù vượt số tiền dòng cha đã Phê Duyệt (tiền đã thực chi không thể "huỷ") — nhưng badge dòng cha ở tab Sử Dụng sẽ đổi thành "⚠️ Vượt ngân sách" (đỏ) thay vì "✅ Đã dùng hết" (xanh) như trước, để không còn bị âm thầm — trước đây chỉ phát hiện được qua cột "Chênh Lệch" ở tab Báo Cáo (cần quyền riêng).' },
      { label: 'Đề Xuất/Phê Duyệt bị Từ Chối không còn là ngõ cụt (9/2026)', text: 'bấm nút "✏️" trên 1 dòng ❌ Từ chối để sửa lại nội dung — lưu xong hệ thống TỰ ĐỘNG chuyển lại về ⏳ Chờ duyệt (xoá sạch lý do/người từ chối cũ) để người khác duyệt lại, đúng đường "Sửa & gửi lại" ở sơ đồ trên; không muốn sửa nữa thì bấm "🗑️" xoá thẳng cũng được.' },
    ] },
  },
  vanHanh: {
    icon: '⚙️', title: 'Đơn Hàng & Mở Mới/Sửa Chữa Siêu Thị', badge: 'Vận Hành',
    desc: 'Hai luồng: Đơn Hàng (mua hàng vận hành theo đợt, có phê duyệt) và Mở Mới/Sửa Chữa Siêu Thị — "QLDA" (dự án đối chiếu Ngân Sách + cây công việc nhiều cấp theo dõi tiến độ, KHÔNG có bước phê duyệt nào — hồ sơ có hiệu lực ngay lúc tạo).',
    flow: { ariaLabel: 'Quy trình Mở Mới/Sửa Chữa Siêu Thị (QLDA)', chain: [
      { label: 'Tạo hồ sơ', sub: 'Mở mới hoặc sửa chữa — có hiệu lực NGAY, không qua ai duyệt', kind: 'approved' },
      { label: 'Danh mục đầu tư', sub: 'Nhập hạng mục, đối chiếu Ngân Sách Phê Duyệt/Còn Lại' },
      { label: 'Thực hiện', sub: 'Cây công việc nhiều cấp — chỉ công việc lá cập nhật tiến độ' },
      { label: 'Nghiệm thu', sub: 'Xác nhận từng công việc' },
    ] },
    steps: [
      { role: 'Người đề xuất', text: 'vào mục <b>⚙️ Vận Hành</b> (sidebar) → tab <b>"🏬 QLDA"</b> → chọn "🏬 Mở mới" hoặc "🔧 Sửa chữa" → điền form → Lưu — hồ sơ có hiệu lực NGAY, không có bước phê duyệt nào.' },
      { role: 'Người phụ trách/toàn quyền hồ sơ', text: 'tab "📁 Danh mục đầu tư" → nhập bảng hạng mục đầu tư (đối chiếu Ngân Sách Phê Duyệt/Còn Lại) → bấm <b>Lưu</b> — hoàn tất ngay, không cần chờ ai duyệt.' },
      { text: 'Chỉ hiển thị hồ sơ ĐÃ lưu xong Danh mục đầu tư: tab "🛠️ Thực hiện" → tạo cây công việc từ mức lớn đến mức con — chỉ công việc LÁ (không có con) mới cập nhật tiến độ trực tiếp được, công việc có con tự cập nhật theo tiến độ các con.' },
      { role: 'Người nghiệm thu', text: 'tab "✅ Nghiệm thu" — cùng dữ liệu cây công việc với Thực hiện, chỉ nghiệm thu/bổ sung được công việc đang ở trạng thái "Đang nghiệm thu" (danh sách công việc bên Thực hiện tạo sẽ tự xuất hiện ở đây).' },
      { text: 'Xem tổng hợp tiến độ toàn bộ dự án: tab "📈 Báo cáo" — bấm vào số liệu Tổng CV/Đã Nghiệm Thu/Đang Thực Hiện/Chưa Bắt Đầu để mở nhanh đúng nhóm công việc đó.' },
      { role: 'Người đặt hàng', text: 'luồng riêng CÓ phê duyệt — vào tab <b>"📦 Đơn Hàng"</b> → chọn "🏬 Đặt Hàng Tại Siêu Thị" hoặc "🏢 Đặt Hàng Tại HO" → tạo đơn → mục "🧾 Duyệt Nhập/Hủy Đơn Hàng" để duyệt nhập/huỷ đơn, không đi qua QLDA.' },
    ],
    footer: { left: [
      { label: '⚠️ QLDA KHÔNG có bước phê duyệt', text: 'khác Đơn Hàng, hồ sơ Mở Mới/Sửa Chữa Siêu Thị (và toàn bộ 3 bước Danh mục đầu tư/Thực hiện/Nghiệm thu bên trong) đi thẳng có hiệu lực ngay lúc Lưu — không có trạng thái Chờ duyệt/Từ chối nào, không cần vào mục ✅ Phê Duyệt.' },
      { label: '👁️ Xem Nhanh (9/2026)', text: 'ở tab Báo Cáo, bấm vào số liệu Tổng CV/Đã Nghiệm Thu/Đang Thực Hiện/Chưa Bắt Đầu của 1 hồ sơ để mở nhanh danh sách đúng nhóm công việc đó (tiến độ/trạng thái/người thực hiện), không cần mở "Xem/Lập Danh Mục Đầu Tư" đầy đủ.' },
      { label: 'Tải Mẫu/Nhập Excel Danh mục đầu tư có cột Người Phụ Trách (10/2026)', text: 'tab "📁 Danh mục đầu tư" → "📥 Tải File Mẫu" ra tệp Excel có sẵn cột "Người Phụ Trách (username, cách nhau dấu phẩy)" — điền username (1 hoặc nhiều, ngăn cách dấu phẩy) rồi "📤 Nhập File" để gộp thẳng vào bảng, không cần tự gán tay từng dòng sau khi nhập. Username không tồn tại hoặc đã nghỉ việc sẽ tự bị bỏ qua (có cảnh báo rõ, không chặn cả dòng); người phụ trách hợp lệ hiện ngay đúng ô "Người Phụ Trách" như gán tay.' },
    ], right: [
      { label: 'Đơn Hàng', text: 'là luồng tách biệt CÓ phê duyệt theo mức giá trị — tạo đơn, duyệt, xử lý rồi hoàn tất, không liên quan gì tới QLDA.' },
      { label: 'Tự đồng bộ ra dsmart16 (từ 9/2026: tự gửi lại khi đổi trạng thái)', text: 'đơn hàng đã có Mã PO tự đẩy dữ liệu sang hệ thống ngoài dsmart16 (job định kỳ hoặc admin bấm "🔄 Đồng Bộ Ngay" ở Cấu Hình API) — trước đây chỉ gửi ĐÚNG 1 LẦN, đơn đổi trạng thái sau đó (VD Chờ duyệt → Đã duyệt → Đã nhận) KHÔNG được đồng bộ lại, dsmart16 giữ mãi bản ghi cũ. Nay hệ thống tự so sánh nội dung với lần gửi thành công gần nhất, phát hiện khác (đổi trạng thái/ngày duyệt/ngày nhận/số tiền...) thì tự gửi lại — y hệt không đổi thì bỏ qua, không gửi thừa.' },
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
    steps: [
      { role: 'Quản trị', text: 'vào <b>⚙️ Vận Hành → ✅ Checklist Đánh Giá</b> (sidebar) → tab <b>"🛠️ Cấu Hình"</b> → "🛠️ Tạo Mẫu Checklist Mới" → chọn Loại Mẫu, thêm hạng mục/câu hỏi/điểm → lưu ở trạng thái Nháp, rồi kích hoạt để chuyển thành "Đang dùng" (chỉ 1 mẫu đang dùng mỗi lúc).' },
      { role: 'Người đánh giá', text: 'tab <b>"✅ Thực Hiện"</b> → chọn siêu thị cần đánh giá → trả lời từng mục theo đúng mẫu đang dùng → nộp bài (hệ thống tự tính điểm/xếp loại). Bài chưa nộp có thể bấm "Tiếp Tục" để làm tiếp, không cần làm lại từ đầu.' },
      { text: 'Xem kết quả và phản hồi: tab "📣 Kết Quả & Phản Hồi"; xem tổng hợp nhiều đợt: tab "📊 Báo Cáo".' },
      { role: 'Quản trị', text: 'muốn đổi mẫu đang dùng: bấm "⏸️ Dừng" trên mẫu hiện tại (chuyển sang Lưu trữ) rồi kích hoạt mẫu khác; muốn sửa nội dung mẫu Đang dùng/Lưu trữ thì bấm "✏️ Sửa" (tự nhân bản thành 1 bản Nháp mới, không sửa trực tiếp để giữ nguyên dữ liệu bài đã nộp).' },
    ],
    footer: { left: [
      { label: 'Tiếp tục dở dang', text: 'bài chấm chưa nộp có thể bấm "Tiếp Tục" để làm tiếp, không cần làm lại từ đầu.' },
      { label: 'Nhân bản mẫu', text: 'có thể nhân bản 1 mẫu có sẵn để chỉnh sửa nhanh thay vì dựng lại từ đầu — nhân bản được từ cả mẫu Đang dùng lẫn Lưu trữ.' },
    ], right: [
      { label: '⏸️ Dừng (Đang dùng → Lưu trữ)', text: 'dừng thủ công 1 mẫu Đang dùng mà không cần kích hoạt bản thay thế ngay. Muốn dùng lại đúng mẫu vừa Dừng thì bấm "🔄 Kích Hoạt Lại" ngay trên mẫu Lưu trữ đó — không cần Nhân Bản/Sửa gì cả, không tạo phiên bản mới.' },
      { label: '✏️ Sửa (Đang dùng/Lưu trữ)', text: 'không sửa trực tiếp được, để giữ nguyên dữ liệu các bài đã nộp trước đó — bấm "Sửa" sẽ tự nhân bản thành 1 bản Nháp mới rồi mở thẳng form sửa, gộp 2 bước cũ thành 1 lần bấm.' },
      { label: '🗑️ Xoá — chỉ Quản Trị Viên', text: 'nút Xoá chỉ Quản Trị Viên (quyền cao nhất) mới thấy được, ở mọi trạng thái — nếu mẫu đã có người nộp bài thì nút này sẽ bị khoá kèm gợi ý dùng "⏸️ Dừng" thay thế, để không làm mất dữ liệu báo cáo cũ.' },
      { label: 'Sửa lại phản hồi/giải trình (9/2026)', text: 'siêu thị (checklist Kiểm Soát) gõ nhầm hoặc muốn bổ sung phản hồi đã gửi thì bấm "✏️ Sửa" ngay cạnh phản hồi cũ ở tab "📣 Kết Quả & Phản Hồi" — nội dung mới GHI ĐÈ nội dung cũ, không lưu lịch sử các lần sửa trước.' },
    ] },
  },
  orgChart: {
    icon: '🌳', title: 'Cơ Cấu Tổ Chức', badge: 'Nhân Sự',
    desc: 'Sơ đồ tổ chức theo từng phiên bản — tab "🌳 Sơ Đồ Tổ Chức" xem/sửa dạng cây thụt lề (đủ cả Vị Trí), tab "🖼️ Sơ Đồ Trực Quan" tự vẽ sơ đồ khối CHỈ tới cấp Phòng Ban, xem trực tiếp và tải về PNG/SVG — mỗi phiên bản mới LUÔN sao chép từ phiên bản đang áp dụng rồi sửa tiếp, "Áp Dụng" có hiệu lực ngay không qua ai duyệt lần 2.',
    flow: { ariaLabel: 'Quy trình Cơ Cấu Tổ Chức', chain: [
      { label: '+ Tạo Bản Nháp Mới', sub: 'Luôn clone từ bản đang áp dụng, không có "tạo bản trắng"' },
      { label: 'Sửa cây (bản Nháp)', sub: 'Thêm/sửa/xoá vị trí, gắn phòng ban' },
      { label: 'Áp Dụng', sub: 'Có hiệu lực NGAY, không qua ai duyệt lần 2', kind: 'approved' },
    ] },
    steps: [
      { text: 'Lần đầu chưa có sơ đồ nào: vào <b>💼 Nhân Sự → 🌳 Cơ Cấu Tổ Chức</b> (sidebar) → bấm <b>"Khởi Tạo"</b> ở khung "🌱 Khởi Tạo Cơ Cấu Tổ Chức".' },
      { text: 'Sửa tiếp: bấm <b>"+ Tạo Bản Nháp Mới"</b> (luôn sao chép từ bản đang áp dụng) → sửa cây ngay trên tab "🌳 Sơ Đồ Tổ Chức" (thêm/sửa/xoá vị trí, gắn phòng ban).' },
      { text: 'Trước khi áp dụng, có thể bấm "🔍 Kiểm Tra Hợp Lệ" (tuỳ chọn, chỉ cảnh báo lỗi) hoặc "🔀 So Sánh Với Bản Đang Áp Dụng" để đối chiếu.' },
      { text: 'Bấm <b>"✅ Áp Dụng Phiên Bản Này"</b> để có hiệu lực ngay — bản đang áp dụng cũ tự chuyển sang Lưu trữ, không cần ai duyệt lần 2. Sau khi Áp Dụng xong, hệ thống TỰ chuyển sang tab "🖼️ Sơ Đồ Trực Quan" để xem ngay sơ đồ khối cấp Phòng Ban vừa cập nhật — bấm <b>"🖼️ Tải Ảnh (PNG)"</b> hoặc <b>"⬇️ Tải SVG (Vector)"</b> để tải về.' },
      { text: 'Chỉ vừa đổi phòng ban/chức danh 1-2 người mà chưa muốn áp dụng cả phiên bản mới: bấm riêng "🔄 Đồng Bộ Quản Lý Trực Tiếp" để cập nhật ngay field này.' },
      { text: 'Cấu hình luồng KPI theo cấp bậc: tab "🎯 Cấu Hình Đánh Giá KPI" → bấm "Thêm Quan Hệ".' },
    ],
    footer: { left: [
      { label: 'Không sửa phiên bản cũ', text: 'sửa node (thêm/sửa/xoá vị trí) là sửa TRỰC TIẾP trên bản Nháp hiện có, không tự tạo phiên bản mới mỗi lần sửa — chỉ khi bấm "+ Tạo Bản Nháp Mới" mới sinh phiên bản mới (luôn clone từ bản đang áp dụng); phiên bản Đã áp dụng/Lưu trữ chỉ xem, không sửa lại được.' },
      { label: 'Áp Dụng = có hiệu lực ngay, không có bước duyệt thứ 2', text: '1 người có quyền bấm "Áp Dụng" là xong — bản đang áp dụng cũ tự động chuyển sang Lưu Trữ. Có thể chạy "Kiểm Tra Hợp Lệ" trước (tuỳ chọn, chỉ cảnh báo lỗi, không bắt buộc phải chạy).' },
      { label: 'Xoá bản nháp không dùng nữa (9/2026)', text: 'tạo thử/nhân bản nhầm 1 bản Nháp muốn dọn đi: chọn đúng bản đó ở dropdown Phiên bản → bấm <b>"🗑️ Xoá Bản Nháp Này"</b>. CHỈ xoá được bản đang ở trạng thái Nháp — bản Đã áp dụng/Lưu trữ không xoá được (phải giữ lại làm lịch sử).' },
    ], right: [
      { label: 'Người giữ vị trí được tra động, không lưu cố định', text: 'hệ thống KHÔNG lưu "ai giữ chức gì" trong phiên bản — mà lọc động theo đúng phòng ban/chức danh đang có trên hồ sơ user. Cây chỉ PHẢN ÁNH hồ sơ, không ghi ngược — TRỪ field "Quản Lý Trực Tiếp" được tự động cập nhật khi Áp Dụng (hoặc bấm nút <b>"🔄 Đồng Bộ Quản Lý Trực Tiếp"</b> riêng khi chỉ vừa đổi phòng ban/chức danh 1-2 người).' },
      { label: 'So sánh phiên bản', text: 'xem được bảng so sánh (Thêm mới/Đã xoá/Đổi tên-chuyển cấp) giữa 1 phiên bản Lưu Trữ và phiên bản đang Áp Dụng, chỉ để đối chiếu, không sửa được từ màn so sánh.' },
      { label: '🖼️ Sơ Đồ Trực Quan — CHỈ cấp Phòng Ban (10/2026)', text: 'theo yêu cầu người dùng: sơ đồ khối chỉ vẽ tới cấp Phòng Ban (bỏ qua mọi Vị Trí nằm giữa, kể cả khi 1 Phòng Ban là "con" của 1 Vị Trí như Tổng Giám Đốc — tự gắn vào Phòng Ban/Công Ty tổ tiên gần nhất), giữ nguyên cấu trúc Phòng Ban lồng Phòng Ban con. Muốn xem đủ Vị Trí bên trong từng phòng thì quay lại tab "🌳 Sơ Đồ Tổ Chức". Vẽ theo ĐÚNG phiên bản đang chọn ở dropdown phía trên (không giới hạn chỉ bản Đang áp dụng).' },
      { label: 'Luồng KPI tự sinh theo cấp bậc tự "dọn dẹp" khi đổi cha (từ 9/2026)', text: 'mỗi lần Áp Dụng, hệ thống KHÔNG chỉ tự thêm quan hệ đánh giá còn thiếu theo cây mới (cấp trên trực tiếp đánh giá cấp dưới) mà còn tự XOÁ quan hệ tự sinh đã lỗi thời khi 1 vị trí bị đổi sang cấp trên khác giữa 2 lần Áp Dụng — tránh cả quản lý CŨ lẫn quản lý MỚI cùng có quyền đánh giá 1 người ("2 người cùng chấm 1 nhân viên"). Quan hệ tự thêm TAY qua "Thêm Quan Hệ" (không theo cây) không bao giờ bị đụng vào dù cây đổi thế nào.' },
    ] },
  },
  hrLifecycle: {
    icon: '🧑‍💼', title: 'Onboarding / Offboarding', badge: 'Quy trình theo từng mốc thời gian',
    desc: 'Hệ thống tự tạo danh sách việc cần làm theo từng mốc thời gian, dựa theo mẫu đã chuẩn bị sẵn — mỗi việc được gán cho đúng bộ phận phụ trách (Nhân Sự, IT, Hành Chính, Kế Toán hoặc Quản Lý trực tiếp), tự hoàn tất khi đã xong hết các việc bắt buộc.',
    flow: { ariaLabel: 'Quy trình Onboarding 4 mốc', chain: [
      { label: 'Chuẩn bị trước ngày đi làm', sub: '' },
      { label: 'Ngày đầu tiên', sub: '' },
      { label: 'Tuần/Tháng đầu', sub: '' },
      { label: 'Kết thúc thử việc', sub: '', kind: 'approved' },
    ] },
    steps: [
      { role: 'Nhân Sự', text: 'vào <b>💼 Nhân Sự → 🧑‍💼 Onboarding / Offboarding</b> (sidebar) → bấm <b>"+ Tạo Onboarding"</b> (nhân viên mới) hoặc <b>"+ Tạo Offboarding"</b> (nhân viên nghỉ việc) → điền thông tin → bấm <b>"📨 Tạo Quy Trình"</b> — hệ thống tự sinh danh sách việc cần làm theo mẫu, gán đúng bộ phận phụ trách từng việc.' },
      { role: 'Người phụ trách từng việc', text: 'vào tab <b>"✅ Việc Của Tôi"</b> để xem đúng việc được gán cho mình (theo bộ phận Nhân Sự/IT/Hành Chính/Kế Toán/Quản Lý trực tiếp) → đánh dấu hoàn tất từng việc.' },
      { text: 'Theo dõi toàn bộ tiến độ: tab <b>"📋 Danh Sách Quy Trình"</b> — quy trình tự chuyển trạng thái hoàn tất khi đã xong hết việc bắt buộc (riêng Offboarding còn chờ chỉ định người kế nhiệm nếu người nghỉ đang quản lý trực tiếp ai đó).' },
      { role: 'Quản trị', text: 'chuẩn bị sẵn danh sách việc theo mốc thời gian: tab "🗂️ Checklist Mẫu".' },
    ],
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
    steps: [
      { role: 'Nhân viên', text: 'vào <b>💼 Nhân Sự ▾ → 👤 Hồ Sơ Nhân Sự</b> (sidebar) → tab <b>"👤 Hồ Sơ Của Tôi"</b> để xem/tự cập nhật hồ sơ mình (trong phạm vi trường đã được mở xem, xem mục "Cấu hình trường xem" bên dưới).' },
      { role: 'Người quản lý hồ sơ', text: 'tab <b>"📋 Quản Lý Hồ Sơ"</b> → bấm <b>"➕ Tạo Hồ Sơ Mới"</b> để tạo tay (Mã Nhân Viên tự sinh), hoặc <b>"📤 Nhập Excel"</b> để nhập hàng loạt.' },
      { text: 'Cấu hình trường nhạy cảm nào được hiển thị: bấm "⚙️ Trường Xem Của Quản Lý Trực Tiếp" (áp dụng khi quản lý xem hồ sơ cấp dưới) hoặc "⚙️ Trường Xem Của Tôi" (áp dụng khi nhân viên tự xem hồ sơ mình) — 2 cấu hình độc lập, mặc định KHÔNG trường nào hiện tới khi admin chủ động mở.' },
      { role: 'Quản lý trực tiếp', text: 'xem hồ sơ cấp dưới ngay trong tab "👤 Hồ Sơ Của Tôi" (danh sách cấp dưới hiện sẵn) → bấm "Xem" trên đúng người cần xem.' },
    ],
    footer: { left: [
      { label: 'Không hiện ở Báo Cáo chung', text: 'đây là nhóm dữ liệu cực kỳ nhạy cảm nên không đưa vào các báo cáo tổng hợp dùng chung — thay vào đó có module con "📊 Báo Cáo" RIÊNG cấp Nhân Sự (vào làm/nghỉ việc/tăng lương/hợp đồng mới-gia hạn-sắp hết hạn/thăng chức, lọc theo thời gian), gác quyền chặt như Lịch Sử Nhân Sự.' },
      { label: 'Tái Tuyển', text: 'nút "Kiểm Tra Nhân Sự Cũ" (khi tạo hồ sơ mới hoặc mở Onboarding) tra theo CCCD+ngày sinh — nhân viên cũ quay lại giữ NGUYÊN Mã Nhân Viên cũ, chỉ ghi thêm 1 dòng lịch sử tái tuyển.' },
      { label: 'Liên Kết Tài Khoản VPDT', text: 'hồ sơ tạo tay có thể chưa có tài khoản VPDT ngay (tick "Liên Kết Tài Khoản" ở màn hồ sơ khi tài khoản đã có sau) — nếu hồ sơ ĐÃ được gán Chức Vụ TRƯỚC lúc liên kết, hệ thống tự đồng bộ NGAY Phòng Ban/Chức Danh/Vị Trí xuống tài khoản vừa liên kết (từ 9/2026, cùng cơ chế đồng bộ khi gán Chức Vụ cho hồ sơ ĐÃ có tài khoản) — không cần vào gán lại Chức Vụ 1 lần nữa chỉ để kích hoạt đồng bộ.' },
      { label: 'Đổi tài khoản liên kết khi tái tuyển (9/2026)', text: 'hồ sơ ĐÃ có tài khoản liên kết (VD tài khoản cũ đã bị khoá/xoá khi nghỉ việc) muốn đổi sang tài khoản VPDT MỚI khi tái tuyển: bấm "🔁 Đổi tài khoản liên kết" ngay tại màn Quản Lý Hồ Sơ → gõ chọn tài khoản mới → Xác Nhận Đổi. Tài khoản cũ mất quyền xem/sửa hồ sơ ngay, lịch sử đổi được lưu lại để tra soát — khác "Liên Kết Tài Khoản VPDT" (chỉ dùng cho hồ sơ CHƯA từng liên kết lần nào).' },
      { label: 'Phân quyền chi tiết', text: '3 quyền tách riêng Tạo/Xem toàn bộ/Sửa (kết hợp tự do) bên cạnh quyền "Quản Lý Hồ Sơ Nhân Sự" gộp sẵn cả 3 — admin cấu hình ở Hệ Thống > Phân Quyền.' },
      { label: 'Cấu hình trường xem (opt-in)', text: '2 nút "⚙️" riêng trong Quản Lý Hồ Sơ, cùng nguyên tắc: MẶC ĐỊNH KHÔNG trường nhạy cảm nào hiển thị (đủ 15 field: ngày sinh, giới tính, email cá nhân, liên hệ khẩn cấp, CCCD, địa chỉ, ngân hàng, BHXH, mã số thuế, người phụ thuộc, học vấn) tới khi admin chủ động mở — "Trường Xem Của Quản Lý Trực Tiếp" áp dụng khi quản lý xem hồ sơ cấp dưới, "Trường Xem Của Tôi" áp dụng khi chính nhân viên tự xem/sửa hồ sơ mình — 2 cấu hình độc lập, mở ở màn này không tự mở cho màn kia.' },
    ], right: [
      { label: 'Lịch Sử Thay Đổi & Chỉnh Sửa', text: 'mọi lần tạo mới/sửa hồ sơ (liệt kê đúng field đã đổi) được ghi lại, gộp chung vào "Lịch Sử Nhân Sự" cùng chức vụ/hợp đồng/tái tuyển — luôn sắp mới nhất lên đầu.' },
    ] },
  },
  hrContract: {
    icon: '📝', title: 'Hợp Đồng Lao Động', badge: 'Nhân Sự',
    desc: 'Hợp đồng thử việc tự sinh khi bắt đầu Onboarding, chuyển sang chính thức khi ký kết — tự động chuyển sang đã kết thúc khi hoàn tất thủ tục nghỉ việc, không cần đổi tay.',
    flow: { ariaLabel: 'Quy trình Hợp Đồng Lao Động', chain: [
      { label: 'Thử việc', sub: 'Tự sinh từ Onboarding' },
      { label: 'Ký chính thức', sub: 'Ra quyết định sau thử việc', kind: 'decision' },
      { label: 'Đang hiệu lực', sub: 'Theo dõi hiệu lực', kind: 'approved' },
      { label: 'Đã kết thúc', sub: 'Tự động khi nghỉ việc xong' },
    ], decision: { atIndex: 1, approveLabel: 'Ký', rejectLabel: 'Không đạt/gia hạn thêm', rejectBox: { label: 'Gia hạn thử việc', sub: 'Kéo dài thời gian thử việc' }, loopBackToIndex: 0 } },
    steps: [
      { text: 'Hợp đồng thử việc TỰ SINH ngay khi tạo Onboarding cho nhân viên mới (mục 🧑‍💼 Onboarding / Offboarding) — không cần tạo tay ở đây.' },
      { role: 'Người quản lý hợp đồng', text: 'vào <b>💼 Nhân Sự → 📝 Hợp Đồng Lao Động</b> (sidebar) → bấm <b>"➕ Tạo Hợp Đồng Mới"</b> nếu cần tạo tay (VD hợp đồng không qua Onboarding).' },
      { text: 'Tăng lương THẬT (đổi số dùng để tính Lương hàng tháng): mở hợp đồng ACTIVE của nhân viên → khối "💰 Cập Nhật Lương Cơ Bản" → nhập Lương cơ bản mới → bấm "💾 Lưu Lương Cơ Bản".' },
      { text: 'Ghi nhận thay đổi khác chỉ để LƯU LỊCH SỬ (đổi chức danh, gia hạn, quyết định kèm theo...): thêm 1 dòng phụ lục mới, điền "Ngày áp dụng" (tuỳ chọn)/"Ngày hiệu lực" (bắt buộc) + Giá trị cũ/mới (bật checkbox "💰 Giá trị tiền" nếu là số tiền để tự định dạng) — phần này KHÔNG tự cập nhật Lương cơ bản, chỉ để tra cứu.' },
      { text: 'Hợp đồng tự chuyển "Đã kết thúc" khi hoàn tất thủ tục nghỉ việc ở Onboarding/Offboarding — không cần đóng tay.' },
    ],
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
    steps: [
      { text: 'Vào <b>💼 Nhân Sự ▾ → 📊 Báo Cáo</b> (sidebar — nút này nằm CUỐI CÙNG trong dropdown Nhân Sự, nhãn nút thật chỉ là "📊 Báo Cáo", KHÔNG phải "Báo Cáo (Nhân Sự)"; đừng nhầm với mục "📊 Báo Cáo" cấp 1 — module Báo Cáo & Biểu Mẫu dùng chung, đứng riêng trên sidebar) → chọn khoảng thời gian Từ ngày/Đến ngày (tuỳ chọn), lọc tình trạng hợp đồng nếu cần → bấm <b>"🔍 Xem Báo Cáo"</b> để hệ thống tính lại số liệu theo bộ lọc vừa chọn.' },
    ],
    footer: { left: [
      { label: 'Cần đủ 2 quyền', text: 'CẦN CẢ "Quản Lý Hồ Sơ Nhân Sự" LẪN "Quản Lý Hợp Đồng Lao Động" (hoặc admin) — chỉ có 1 trong 2 sẽ không thấy mục này, vì số liệu gộp cả 2 nguồn (kể cả tăng lương, vốn chỉ Quản Lý Hợp Đồng Lao Động mới xem được).' },
    ], right: [
      { label: 'Không phải báo cáo tổng hợp chung', text: 'tách biệt hoàn toàn khỏi màn "📊 Báo Cáo" (module Báo Cáo & Biểu Mẫu dùng chung) — dữ liệu nhân sự cực nhạy cảm nên có route + màn hình thống kê RIÊNG, gác đúng quyền của module Nhân Sự.' },
    ] },
  },
  hrAttendance: {
    icon: '⏱️', title: 'Công / Phép', badge: 'Nhân Sự',
    desc: 'Đăng ký nghỉ phép theo loại phép — duyệt theo quản lý trực tiếp (hoặc bất kỳ cấp quản lý cao hơn theo Cơ Cấu Tổ Chức) hoặc Nhân Sự, tự trừ vào quỹ phép năm còn lại.',
    flow: { ariaLabel: 'Quy trình Công/Phép', chain: [
      { label: 'Đăng ký nghỉ phép', sub: 'Chọn loại phép + số ngày/giờ' },
      { label: 'Duyệt', sub: 'Quản lý trực tiếp (hoặc cấp cao hơn) / Nhân Sự', kind: 'decision' },
      { label: 'Trừ quỹ phép', sub: 'CHỈ Phép Năm mới trừ quỹ, lúc DUYỆT chứ không phải lúc nộp', kind: 'approved' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Bị từ chối', sub: 'Không trừ quỹ (chưa từng trừ)' }, loopBackToIndex: 0 } },
    steps: [
      { role: 'Nhân viên', text: 'vào <b>💼 Nhân Sự → ⏱️ Công &amp; Phép</b> (sidebar) → tab <b>"🙋 Của Tôi"</b> → bấm <b>"📝 Nộp Đơn Nghỉ Phép"</b> → chọn loại phép + số ngày/giờ → có thể bấm <b>"🔍 Xem Quy Trình"</b> để xem trước ai sẽ duyệt → gửi. Nhân viên chấm công theo ca (SHIFT_BASED) nộp đơn "Xin Đổi Ca" tương tự (cũng có nút Xem Quy Trình riêng).' },
      { role: 'Quản lý trực tiếp / Nhân Sự', text: 'tab <b>"✅ Duyệt Nghỉ Phép"</b> → tìm đơn đang chờ (của nhân viên thuộc quyền quản lý, đệ quy mọi cấp dưới) → Duyệt hoặc Từ chối — Duyệt Phép Năm mới trừ quỹ phép, các loại phép khác chỉ ghi nhận chấm công.' },
      { role: 'Quản lý siêu thị', text: 'phân ca cho nhân viên: tab <b>"📅 Phân Ca Siêu Thị"</b> → bấm <b>"➕ Phân Ca Mới"</b>.' },
      { role: 'Nhân Sự', text: 'tab <b>"🛠️ Quản Lý & Cấu Hình"</b> để: bổ sung bản ghi công thủ công ("➕ Bổ Sung Bản Ghi Công"), tạo/sửa phép năm từng người ("➕ Tạo/Sửa Phép Năm"), cấu hình giờ hành chính, ngày lễ, mẫu ca làm việc, hoặc tạo API Key cho máy chấm công.' },
    ],
    footer: { left: [
      { label: 'Không hiện ở Báo Cáo chung', text: 'dữ liệu chấm công/phép không đưa vào báo cáo tổng hợp dùng chung, như các dữ liệu nhạy cảm khác của Nhân Sự.' },
      { label: '5 loại phép, chỉ Phép Năm trừ quỹ', text: 'Phép năm / Nghỉ không lương / Nghỉ ốm / Nghỉ việc riêng / Nghỉ theo giờ (nghỉ 1 phần ngày, tự quy đổi ra ngày lẻ theo giờ hành chính) — CHỈ Phép Năm trừ vào quỹ phép còn lại, các loại còn lại chỉ ghi nhận chấm công.' },
      { label: 'Huỷ đơn — tự hoàn quỹ + dọn chấm công + khôi phục Phân Ca (từ 9/2026)', text: 'nhân viên tự huỷ đơn của mình khi đang Chờ duyệt, hoặc đã Duyệt nhưng NGÀY BẮT ĐẦU CÒN Ở TƯƠNG LAI. Huỷ đơn Phép Năm đã duyệt (đã trừ quỹ) tự CỘNG LẠI đúng số ngày vào quỹ phép năm, đồng thời dọn lại các bản ghi chấm công những ngày đó về "chưa chấm công" (không còn ghi "nghỉ phép có lương" nữa) — không cần Nhân Sự vào sửa tay. Trước đây phải tự vào "Quản Lý & Cấu Hình" cộng lại tay nếu cần. **Nhân viên chấm công theo ca (SHIFT_BASED)**: huỷ đơn còn tự KHÔI PHỤC lại đúng trạng thái/ghi chú của các dòng "📅 Phân Ca Siêu Thị" mà chính lượt Duyệt đơn đó đã tự huỷ trước đó (chỉ khôi phục đúng những dòng ca do CHÍNH đơn này gây huỷ — không đụng tới dòng bị huỷ vì lý do khác như Offboarding/huỷ tay) — nhân viên quay lại đi làm đúng ca cũ mà không cần quản lý ca vào phân lại tay.' },
      { label: 'Duyệt phép tự huỷ ca đã phân trùng ngày (mô hình theo ca, từ 9/2026)', text: 'nhân viên chấm công theo ca (SHIFT_BASED) — duyệt đơn phép của họ TỰ ĐỘNG huỷ (chuyển "Đã huỷ") mọi dòng phân ca ở tab "📅 Phân Ca Siêu Thị" trùng đúng khoảng ngày nghỉ, không cần quản lý ca vào huỷ tay từng dòng; trước đây chỉ ghi nhận "có ảnh hưởng" mà không tự xử lý gì.' },
    ], right: [
      { label: 'Ai duyệt được', text: 'quản lý trực tiếp HOẶC bất kỳ cấp quản lý nào cao hơn theo Cơ Cấu Tổ Chức (đệ quy, không chỉ đúng 1 cấp) đều duyệt được, hoặc người được tick cờ <code>hrLeaveApprove</code> (duyệt nghỉ phép) / <code>hrShiftSwapApprove</code> (duyệt đổi ca) trong cây Phân Quyền (mục 21. Nhân Sự), hoặc <code>hrAttendanceManage</code> (Nhân Sự — duyệt được CẢ 2 loại, toàn công ty, chỉ chặn tự duyệt đơn của chính mình) — không phải cấu hình luồng nhiều bước như các module khác. Nút "🔍 Xem Quy Trình" ở 2 form Nộp Đơn Nghỉ Phép/Xin Đổi Ca chỉ hiện đúng danh sách người đang giữ các cờ này (không tính được quản lý trực tiếp theo Cơ Cấu Tổ Chức vì phụ thuộc người nộp đơn, chỉ mang tính tham khảo).' },
      { label: 'Quỹ phép năm', text: '12 ngày cơ bản + 1 ngày cho mỗi 5 năm thâm niên (tính theo ngày hợp đồng lao động CŨ NHẤT của nhân viên = ngày vào làm thật). Tạo lần đầu khi Onboarding hoàn tất; từ 9/2026, hệ thống còn tự quét lại mỗi ngày (job nền) để tự tạo bù quỹ phép năm hiện tại cho MỌI nhân viên đang hoạt động chưa có — không cần Nhân Sự nhớ tạo tay mỗi khi sang năm mới nữa. Khi hoàn tất nghỉ việc, hệ thống tự huỷ mọi đơn còn Chờ duyệt của người đó.' },
    ] },
  },
  hrPayroll: {
    icon: '💰', title: 'Lương', badge: 'Nhân Sự — Dữ liệu nhạy cảm',
    desc: 'Tính lương theo tháng dựa trên Hợp Đồng Lao Động (lương cơ bản) và dữ liệu Công/Phép (ngày công, nghỉ không lương, làm thêm giờ) — đi qua 5 trạng thái từ Nháp tới Công Bố, lưu phiếu lương từng kỳ để tra cứu.',
    flow: { ariaLabel: 'Quy trình Lương', chain: [
      { label: 'Tính Lương (Nháp)', sub: 'Tự động, có thể bấm tính lại nhiều lần' },
      { label: 'Gửi Duyệt', sub: '', kind: 'decision' },
      { label: 'Duyệt → Chốt', sub: 'Chốt xong khoá sửa hoàn toàn' },
      { label: 'Công Bố', sub: 'Thông báo trong app cho từng nhân viên', kind: 'approved' },
    ], decision: { atIndex: 1, rejectBox: { label: 'Từ chối', sub: 'Quay về Nháp để sửa lại' }, loopBackToIndex: 0 } },
    steps: [
      { role: 'Nhân viên', text: 'vào <b>💼 Nhân Sự → 💰 Lương</b> (sidebar) → tab <b>"🙋 Phiếu Lương Của Tôi"</b> để xem phiếu lương từng kỳ.' },
      { role: 'Kế toán/Nhân Sự', text: 'tab <b>"🛠️ Quản Lý Kỳ Lương"</b> → bấm <b>"+ Tạo Kỳ Lương"</b> → hệ thống tự tính lương (Nháp) từ Hợp Đồng Lao Động + Công/Phép; có thể bấm "Tính Lương" lại nhiều lần khi còn Nháp (mỗi lần tính lại chỉ DỰNG LẠI các dòng TỰ ĐỘNG — các dòng Điều Chỉnh tay đã lưu của MỌI nhân viên trong kỳ được giữ nguyên và tự gộp lại vào phiếu mới, không bị mất).' },
      { text: 'Thêm phụ cấp/KPI/thưởng/khấu trừ (không tự tính được): bấm "Điều Chỉnh" trên từng dòng — chỉ làm được khi kỳ còn Nháp.' },
      { text: 'Bấm "Gửi Duyệt" → người duyệt Duyệt (chuyển "Đã Duyệt" rồi "Đã Chốt", khoá sửa hoàn toàn) hoặc Từ chối (quay về Nháp để sửa lại).' },
      { text: 'Bấm "Công Bố" để thông báo trong app cho từng nhân viên. Cần sửa lại kỳ đã khoá: bấm "Mở Lại" (từ Đã Chốt/Đã Công Bố, bắt buộc nhập lý do).' },
      { role: 'Quản trị', text: 'cấu hình mức phụ cấp/hệ số mặc định: bấm "⚙️ Cấu Hình Lương".' },
    ],
    footer: { left: [
      { label: 'Không hiện ở Báo Cáo chung', text: 'dữ liệu lương cực kỳ nhạy cảm nên không đưa vào báo cáo tổng hợp dùng chung theo cách thông thường.' },
      { label: '5 trạng thái kỳ lương', text: 'Nháp → Chờ Duyệt → Đã Duyệt → Đã Chốt → Đã Công Bố. Còn có "Mở Lại" (từ Đã Chốt/Đã Công Bố, bắt buộc nhập lý do) khi cần sửa lại kỳ đã khoá — Mở Lại 1 kỳ ĐÃ CÔNG BỐ (từ 9/2026) còn tự xoá cờ "đã xem" trên mọi phiếu lương của kỳ đó, để nhân viên thấy lại đúng trạng thái "chưa xem" khi kế toán sửa xong và Công Bố lại.' },
      { label: 'Tính lại CHỈ dựng lại dòng tự động, giữ nguyên Điều Chỉnh tay', text: 'bấm "Tính Lương" lại khi kỳ còn Nháp dựng lại TOÀN BỘ các dòng TỰ ĐỘNG (lương cơ bản, BHXH/BHYT/BHTN, thuế TNCN...) từ đầu — nhưng hệ thống tự gom lại mọi dòng "Điều Chỉnh" đã lưu tay (phụ cấp/thưởng/KPI/khấu trừ, kể cả của những nhân viên KHÁC không liên quan tới lý do tính lại) rồi gộp NGƯỢC vào phiếu mới, không bị xoá mất như trước đây kế toán chỉ cần tính lại cho 1 người (VD thêm nhân viên sót/sửa lỗi chấm công) mà không lo mất dữ liệu đã điều chỉnh tay cho cả kỳ. Sau khi Gửi Duyệt thì không điều chỉnh tay được nữa (trừ khi bị Từ chối về Nháp).' },
      { label: 'Xoá kỳ tạo nhầm (9/2026)', text: 'kỳ lương tạo nhầm (sai tháng/năm/tên) hiện nút "🗑️ Xoá" ngay tại danh sách — CHỈ khi còn Nháp và CHƯA từng bấm "Tính Lương" lần nào (employeeCount=0); kỳ đã có dữ liệu tính lương hoặc đã qua bất kỳ bước duyệt nào phải giữ lại làm lịch sử, không xoá được.' },
      { label: 'Thuế TNCN tự tính lại sau mỗi lần Điều Chỉnh tay', text: 'thêm/sửa 1 dòng "Điều Chỉnh" (VD thưởng KPI, phụ cấp ăn trưa) hoặc gộp lại dòng tay khi tính lại cả kỳ đều tự CHẠY LẠI công thức thuế TNCN ngay lập tức — dòng khấu trừ Thuế TNCN và số Thực nhận đổi theo ngay, không cần bấm nút "tính thuế" riêng. Dòng thuế tự sinh có ghi chú "đã tính lại sau điều chỉnh tay" khi có thu nhập nhập tay. Các khoản KHẤU TRỪ nhập tay (tạm ứng/phạt) CỐ Ý KHÔNG làm giảm thu nhập chịu thuế (đúng bản chất là khoản thu hồi/kỷ luật, không phải khoản miễn trừ thuế) — chỉ dòng thu nhập (thưởng/phụ cấp/KPI) nhập tay mới được cộng vào thu nhập chịu thuế. Trường hợp thiếu cấu hình mức thuế (rateConfig), hệ thống KHÔNG tự bịa số mà gắn cờ cảnh báo "taxRecalcPending" lên phiếu để kế toán biết thuế chưa phản ánh đúng phần vừa điều chỉnh tay.' },
    ], right: [
      { label: 'Các khoản phải nhập tay', text: 'phụ cấp ăn trưa/điện thoại/chức vụ/ca đêm/ngày lễ, KPI, thưởng khác, khấu trừ tạm ứng/phạt đều KHÔNG tự tính (hệ thống chưa có nguồn dữ liệu cho các khoản này) — kế toán tự thêm qua "Điều Chỉnh", chỉ làm được khi kỳ còn Nháp.' },
      { label: 'Xem của mình', text: 'mọi nhân viên có hồ sơ nhân sự tự xem phiếu lương của mình (tab "Của Tôi") không cần quyền gì thêm, và tự xuất PDF phiếu lương; xem TOÀN BỘ kỳ lương của mọi người cần quyền quản lý hoặc duyệt lương.' },
      { label: 'Nghỉ việc / vào làm giữa kỳ (từ 9/2026)', text: 'hệ thống KHÔNG tự trừ/cộng theo số ngày lẻ — nhân viên nghỉ việc HOẶC mới vào làm giữa kỳ vẫn được tính ĐỦ 1 tháng lương cơ bản, chỉ ghi CHÚ THÍCH ngay ở dòng "Lương cơ bản" nêu rõ ngày nghỉ/ngày vào làm để kế toán tự rà soát + bấm "Điều Chỉnh" trừ/bù đúng số ngày (đúng nguyên tắc hệ thống không tự bịa công thức khi chưa có chính sách proration chính thức).' },
      { label: 'Đổi lương cơ bản giữa kỳ (từ 9/2026)', text: 'nếu HR dùng "💰 Cập Nhật Lương Cơ Bản" sửa thẳng lương trên hợp đồng đang hiệu lực NGAY TRONG kỳ đang tính (ở module Hợp Đồng Lao Động — xem entry đó), dòng "Lương cơ bản" cũng tự ghi CHÚ THÍCH nêu rõ ngày đổi, nhắc mức đang hiển thị LÀ MỨC SAU KHI ĐỔI (chưa chia tỷ lệ theo ngày hiệu lực thật) — cùng nguyên tắc "chỉ cảnh báo, không tự chia tỷ lệ" như nhánh nghỉ việc/vào làm ở trên; kế toán tự "Điều Chỉnh" bù/trừ đúng phần chênh lệch nếu cần.' },
      { label: 'Chặn lương thực nhận ÂM (từ 9/2026)', text: 'nếu 1 phiếu lương trong kỳ có "Thực nhận" ÂM (thường do khấu trừ tạm ứng/phạt nhập tay ở "Điều Chỉnh" lớn hơn cả lương gộp), bấm "Gửi Duyệt" sẽ bị chặn (400, nêu rõ mã nhân viên bị âm) — kế toán phải vào "Điều Chỉnh" sửa lại đúng số tiền trước khi gửi duyệt được, tránh lương âm lọt qua tới tận lúc Công Bố mới phát hiện.' },
    ] },
  },
  hr: {
    icon: '🤝', title: 'Phản Hồi Ý Kiến (HCRC Đồng Hành)', badge: 'Nhân Sự',
    desc: 'Hộp thư riêng tư 1-1 giữa từng nhân viên và Nhân Sự (không phải bảng tin công khai) — 1 hỏi, 1 đáp rồi kết thúc, không ẩn danh.',
    flow: { ariaLabel: 'Quy trình Phản Hồi Ý Kiến', chain: [
      { label: 'Gửi câu hỏi/góp ý', sub: 'Không ẩn danh, chọn 1 trong 4 danh mục' },
      { label: 'Nhân Sự tiếp nhận & trả lời', sub: '', kind: 'approved' },
      { label: 'Kết thúc', sub: '1 hỏi – 1 đáp, không mở lại/hỏi tiếp được' },
    ] },
    steps: [
      { role: 'Nhân viên', text: 'vào <b>📣 Truyền thông → 🤝 HCRC Đồng Hành</b> (sidebar) → điền form "🤝 Gửi Câu Hỏi Tới Nhân Sự": chọn Chủ Đề (tuỳ chọn) + Nội Dung Câu Hỏi → bấm <b>"Gửi Câu Hỏi"</b>.' },
      { text: 'Xem lại câu hỏi và câu trả lời của mình: mục "📨 Câu Hỏi Của Tôi" ngay bên dưới form.' },
      { role: 'Nhân Sự', text: 'vào mục 🤝 Quản Lý & Phản Hồi Ý Kiến (sidebar, dưới Nhân Sự) → xem toàn bộ câu hỏi của công ty → trả lời từng câu — trả lời xong câu đó KHÔNG sửa/trả lời thêm được nữa, nhân viên phải gửi câu mới nếu cần hỏi tiếp.' },
    ],
    footer: { left: [
      { label: 'Không ẩn danh, không mở lại', text: 'mỗi câu hỏi gắn sẵn người gửi (hệ thống tự gán, không chọn ẩn danh được); mô hình 1 hỏi-1 đáp rồi kết thúc — sau khi Nhân Sự trả lời thì không sửa/trả lời tiếp được ở đúng câu đó, muốn hỏi thêm phải gửi câu mới. Không có bước đánh giá mức độ hài lòng.' },
      { label: 'Rút lại khi còn chờ phản hồi (9/2026)', text: 'gửi nhầm/muốn rút lại câu hỏi trong khi Nhân Sự CHƯA trả lời: bấm "🚫 Rút lại" ngay tại mục "📨 Câu Hỏi Của Tôi" — chuyển sang "Đã rút lại", không xoá hẳn (giữ lịch sử). Nhân Sự đã trả lời rồi thì không rút lại được nữa.' },
      { label: '4 danh mục', text: 'Chế độ/Phúc lợi, Chính sách/Quy định, Lương/Thưởng, Khác.' },
    ], right: [
      { label: 'Riêng tư 1-1', text: 'chỉ người gửi và Nhân Sự thấy được nội dung — người khác (kể cả người khác cũng có quyền Nhân Sự) không thấy câu hỏi lẫn vào hộp thư cá nhân của người đó.' },
      { label: 'Ai xử lý & huy hiệu chưa đọc', text: 'chỉ 1 quyền duy nhất (Quản Lý Nhân Sự) — không lọc theo phòng ban, ai có quyền này nhận và trả lời TOÀN BỘ câu hỏi của công ty. Cả 2 phía đều có huy hiệu đếm số câu chưa đọc/chưa xử lý; không gửi email khi có câu trả lời mới (chỉ báo trong app).' },
    ] },
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
    steps: [
      { role: 'Nhân viên', text: 'vào mục <b>🖥️ Hỗ Trợ IT</b> (sidebar) → tab <b>"🎫 Hỗ Trợ Yêu Cầu"</b> → điền form "🎫 Gửi Yêu Cầu Hỗ Trợ IT" → bấm <b>"Gửi yêu cầu"</b> (mã ticket tự sinh, tự đổi mã kế tiếp nếu trùng).' },
      { role: 'Đội Hỗ Trợ IT', text: 'mở đúng ticket trong danh sách → bấm nhận xử lý (chuyển "Tôi đang xử lý") → xử lý xong đánh dấu hoàn tất.' },
      { text: 'Cần 1 người cụ thể duyệt trước khi tiếp tục xử lý (VD chi phí phát sinh ngoài luồng Phê Duyệt Giá Bán): gửi yêu cầu leo thang phê duyệt ngay trên ticket — bước này tuỳ chọn, phần lớn ticket không cần.' },
      { text: 'Theo dõi dịch vụ CNTT sắp hết hạn: tab "🔔 Gia Hạn Dịch Vụ".' },
    ],
    footer: { left: [
      { label: 'Leo thang phê duyệt là tuỳ chọn', text: 'phần lớn ticket không cần bước này — đội IT chỉ gửi khi cần 1 người cụ thể (không nhất thiết có quyền itManage) duyệt trước khi tiếp tục xử lý, VD xin phê duyệt chi phí phát sinh ngoài luồng Phê Duyệt Giá Bán.' },
      { label: 'Không có "Từ chối khẩn cấp" cho ticket (9/2026, sửa lại tài liệu)', text: 'người được xin ý kiến leo thang chỉ Duyệt hoặc Từ chối NGAY LÚC ĐƯỢC HỎI (sơ đồ trên) — sau khi đã bấm Duyệt thì KHÔNG có cách nào đổi ý/chặn khẩn cấp lại giữa chừng nữa (khác hẳn "Phê Duyệt Giá Bán" — mục riêng bên dưới — CÓ cơ chế Từ Chối Khẩn Cấp thật sự, vì rủi ro tài chính lớn hơn); tài liệu bản trước ghi nhầm ticket cũng có tính năng này, đã sửa lại cho đúng thực tế.' },
      { label: 'Nhắc hạn tự động khi leo thang treo lâu (9/2026)', text: 'yêu cầu leo thang phê duyệt còn chờ xử lý quá 2 ngày sẽ tự động gửi email nhắc người được xin ý kiến (job chạy mỗi 24h) — không còn phải tự nhớ vào xem badge chờ trên giao diện.' },
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
  // lib/createValidation.js. Cây phân quyền "Hỗ Trợ IT" (10/2026) đã tách nhỏ từ 3 quyền gộp thành 7 quyền
  // riêng biệt — xem "Cây phân quyền" ở footer bên dưới cho đầy đủ ánh xạ cũ→mới.
  itPriceApproval: {
    icon: '🏷️', title: 'Phê Duyệt Giá Bán (Bán Lẻ / Bán Buôn)', badge: 'Hỗ Trợ IT',
    desc: 'Đề xuất duyệt bảng giá bán (tải lên tệp Excel nhiều dòng/mặt hàng) — Bán Lẻ và Bán Buôn là 2 QUY TRÌNH KHÁC NHAU thật sự (khác field bắt buộc, khác cấu hình luồng duyệt), không phải cùng 1 luồng dùng chung.',
    flow: { ariaLabel: 'Quy trình Phê Duyệt Giá Bán: Bán Lẻ theo phòng ban, Bán Buôn theo mức Margin/Chiết Khấu', chain: [
      { label: 'Tạo đề xuất', sub: 'Tải tệp bảng giá (.xlsx) + Lý do' },
      { label: 'Duyệt', sub: 'Bán Lẻ: theo phòng ban · Bán Buôn: theo mức Margin/Chiết Khấu', kind: 'decision' },
      { label: 'IT áp giá', sub: 'Đội Hỗ Trợ IT nhận & áp giá thật', kind: 'approved' },
      { label: 'Hoàn tất', sub: '' },
    ], decision: { atIndex: 1, approveLabel: 'Duyệt', rejectLabel: 'Từ chối', rejectBox: { label: 'Bị từ chối', sub: 'Sửa & gửi lại' }, loopBackToIndex: 0 } },
    steps: [
      { role: 'Người đề xuất', text: 'vào <b>🖥️ Hỗ Trợ IT → 🏷️ Phê Duyệt Giá</b> (sidebar) → chọn tab <b>"🏷️ Bán Lẻ"</b> hoặc <b>"🏪 Bán Buôn"</b> (2 quy trình khác nhau thật sự) → tải lên tệp bảng giá (.xlsx, khớp đúng Mẫu Giá nếu hệ thống đã có mẫu) + Lý do → Bán Buôn phải chọn thêm Mức Margin/Chiết Khấu, Đơn Vị Áp Dụng, ít nhất 1 siêu thị/cửa hàng đề xuất, Ngày Áp Dụng → bấm <b>"Gửi phê duyệt"</b>.' },
      { role: 'Người duyệt', text: 'vào mục ✅ Phê Duyệt (sidebar) → tìm đúng hồ sơ đang chờ (Bán Lẻ duyệt theo phòng ban, Bán Buôn duyệt theo đúng mức Margin/Chiết Khấu đã chọn — không duyệt lẫn được) → bấm Duyệt, Từ chối, hoặc Yêu Cầu Bổ Sung (khoá áp giá tới khi có tệp bổ sung mới).' },
      { role: 'Đội Hỗ Trợ IT (quyền itPriceSupport)', text: 'sau khi duyệt, mở hồ sơ → áp giá thật vào hệ thống → đánh dấu hoàn tất.' },
    ],
    footer: { left: [
      { label: 'Bán Lẻ', text: 'chọn "Vùng Giá Áp Dụng" (không bắt buộc, từ danh mục hệ thống) — không có Margin/Chiết Khấu/Đơn Vị Áp Dụng. Tự gắn Ngày Áp Dụng = hôm nay, Vĩnh viễn, áp dụng Toàn bộ siêu thị (không hỏi lại).' },
      { label: 'Bán Buôn', text: 'BẮT BUỘC chọn Mức Margin/Chiết Khấu + nhập Đơn Vị Áp Dụng (khách hàng/đại lý ngoài) + chọn ít nhất 1 siêu thị/cửa hàng đề xuất + Ngày Áp Dụng (Ngày Hết Hiệu Lực tuỳ chọn, mặc định Vĩnh viễn) — không có Vùng Giá.' },
    ], right: [
      { label: 'Luồng duyệt tách biệt', text: 'Bán Lẻ duyệt theo cấu hình từng phòng ban (itPriceDeptWorkflows); Bán Buôn duyệt theo đúng mức Margin/Chiết Khấu đã chọn (itPriceTierWorkflows) — người duyệt mức này KHÔNG duyệt được hồ sơ mức khác.' },
      { label: 'Mẫu Giá (khuôn cột)', text: 'nếu hệ thống đã có ít nhất 1 Mẫu Giá thì bắt buộc chọn đúng mẫu khớp cột với tệp đang nộp — chỉ dùng để đối chiếu tên cột, không còn đối chiếu giá trị/tự động duyệt.' },
      { label: 'Yêu Cầu Bổ Sung', text: 'người duyệt hoặc đội IT có thể yêu cầu bổ sung tệp trước khi áp giá — hồ sơ bị khoá áp giá/duyệt tới khi có tệp bổ sung mới (không ghi đè, chỉ nối thêm). Nếu yêu cầu đến từ người duyệt GIỮA CHỪNG (không phải bước cuối) và hồ sơ đã có bước nào đó DUYỆT XONG trước đó, nộp tệp bổ sung sẽ VÔ HIỆU HOÁ các bước đã duyệt cũ và đưa quy trình về lại Bước 1 để duyệt lại từ đầu với tệp mới (9/2026) — tránh tình huống các bước trước duyệt dựa trên số liệu giá đã lỗi thời. Yêu cầu bổ sung đến từ đội IT SAU KHI đã duyệt xong (trước khi áp giá) thì KHÔNG áp dụng luật này — đó chỉ là hoàn thiện tệp trước khi áp giá, không phải duyệt lại.' },
      { label: 'Cây phân quyền (10/2026)', text: 'trước đây 3 quyền gộp — nay tách 7 quyền riêng: Đề xuất Bán Buôn/Bán Lẻ tách 2 cờ (itPriceProposeCreateWholesale/Retail — ai chỉ phụ trách 1 loại chỉ đề xuất đúng loại đó); "Đội Hỗ Trợ IT" (itManage) giờ CHỈ còn xử lý ticket "Hỗ Trợ Yêu Cầu", KHÔNG còn tự động áp giá/xem hết Phê Duyệt Giá; áp giá sau khi duyệt + xem toàn bộ hồ sơ Phê Duyệt Giá chuyển sang quyền riêng itPriceSupport (vẫn gộp chung Bán Buôn/Bán Lẻ); Gia Hạn Dịch Vụ CNTT chuyển sang quyền riêng itServiceRenewalManage; Từ chối khẩn cấp tách 2 cờ theo đúng loại giá (itPriceEmergencyRejectApproveWholesale/Retail). Việc DUYỆT thật sự (bước "Duyệt" ở sơ đồ trên) không đổi — vẫn theo cấu hình phòng ban/mức Margin-Chiết Khấu ở "Hệ Thống → Quy Trình & Phê Duyệt".' },
      { label: 'Nhắc hạn tự động khi treo lâu (9/2026)', text: 'Yêu Cầu Bổ Sung chưa được người đề xuất phản hồi, hoặc Từ Chối Khẩn Cấp chưa được người có quyền xử lý — treo quá 2 ngày sẽ tự động gửi email nhắc (job chạy mỗi 24h), mỗi yêu cầu chỉ nhắc đúng 1 lần.' },
      { label: 'Mẫu Giá tách riêng theo Bán Lẻ/Bán Buôn (10/2026)', text: 'mỗi Mẫu Giá (khuôn cột) giờ gắn cố định với đúng 1 kênh (Bán Lẻ hoặc Bán Buôn) — màn "Sửa Bán Lẻ"/"Sửa Bán Buôn" chỉ liệt kê/cho chọn đúng mẫu của kênh đang sửa, xoá 1 mẫu ở kênh này KHÔNG còn ảnh hưởng gì tới mẫu của kênh kia (trước đây dùng chung 1 danh sách, xoá nhầm mẫu bên này làm mất luôn đối chiếu cột của bên kia). Mẫu tạo TRƯỚC đợt này (chưa gắn kênh) vẫn hiện ở CẢ 2 kênh như cũ — không mất dữ liệu cũ, chỉ mẫu tạo MỚI mới bắt buộc theo đúng kênh đang thao tác.' },
    ] },
  },
  muaHang: {
    icon: '🔗', title: 'BAS — Cơ Sở Tính Chiết Khấu/Thưởng NCC', badge: 'Mua Hàng, Giai đoạn 1',
    desc: 'Quản lý Nhà Cung Cấp + Điều Khoản Chiết Khấu/Thưởng (mỗi điều khoản tự mang bậc thang % + phạm vi áp dụng riêng), đồng bộ dữ liệu mua hàng thực tế từ hệ thống DSmart, rồi tính ƯỚC TÍNH số tiền chiết khấu theo đúng bậc thang đã cấu hình. Giai đoạn 1 dừng ở mức ƯỚC TÍNH — chưa có Sổ Cái đối chiếu/phê duyệt chính thức với NCC (Giai đoạn 2-3, chưa triển khai).',
    flow: { ariaLabel: 'Quy trình BAS: Điều Khoản → Kích Hoạt → Đồng Bộ → Tính Ước Tính', chain: [
      { label: 'Tạo Điều Khoản', sub: 'Bậc thang % + phạm vi áp dụng, trạng thái Nháp' },
      { label: 'Kích Hoạt', sub: 'Người khác thực hiện, tách biệt nhiệm vụ', kind: 'decision' },
      { label: 'Đồng Bộ DSmart', sub: 'Dữ liệu mua hàng thực tế', kind: 'approved' },
      { label: 'Tính Ước Tính', sub: 'Theo đúng bậc thang tại thời điểm tính' },
    ], decision: { atIndex: 1, approveLabel: 'Kích hoạt', rejectLabel: 'Lưu trữ', rejectBox: { label: 'Lưu Trữ', sub: 'Ngừng áp dụng' }, loopBackToIndex: 0 } },
    steps: [
      { role: 'Người quản lý', text: 'vào mục <b>🔗 Mua Hàng</b> (sidebar) → tab <b>"🧮 BAS"</b> → tab con <b>"🏢 Nhà Cung Cấp"</b> → bấm <b>"+ Thêm NCC"</b> nếu chưa có nhà cung cấp cần dùng.' },
      { role: 'Người quản lý', text: 'tab con <b>"📜 Điều Khoản Chiết Khấu / Thưởng NCC"</b> → bấm <b>"+ Tạo Điều Khoản"</b> → bấm "+ Thêm Bậc" để khai bậc thang %, "+ Thêm Phạm Vi" để khai phạm vi áp dụng → bấm <b>"💾 Lưu Điều Khoản"</b> (trạng thái Nháp).' },
      { role: 'Người có quyền kích hoạt', text: 'mở đúng điều khoản Nháp → bấm Kích Hoạt để chuyển sang Đang Hoạt Động — quyền này TÁCH RIÊNG khỏi quyền tạo/sửa (tách biệt nhiệm vụ).' },
      { role: 'Người quản lý', text: 'tab con <b>"🔄 Đồng Bộ DSmart"</b> → bấm <b>"🔄 Đồng Bộ Ngay"</b> để kéo dữ liệu mua hàng thực tế (tự chống trùng theo mã tham chiếu gốc), sau đó bấm Tính Ước Tính trên điều khoản đang Hoạt Động để ra số tiền chiết khấu ước tính.' },
      { text: 'Chưa/không đồng bộ được DSmart: vẫn ở tab con "🔄 Đồng Bộ DSmart", kéo xuống khối <b>"📤 Nhập/Xuất Dữ Liệu Thủ Công"</b> → bấm <b>"📥 Tải File Mẫu"</b>, điền tay rồi bấm <b>"📤 Nhập File"</b> (.xlsx) để nạp lên; hoặc chọn Từ Ngày/Đến Ngày rồi bấm <b>"📊 Xuất File"</b> để lấy lại dữ liệu đang có mà chỉnh sửa/bổ sung.' },
      { text: 'Sửa điều khoản đã Kích Hoạt: không sửa trực tiếp được — bấm "Nhân Bản" thành 1 bản Nháp mới (version+1) rồi sửa/kích hoạt lại.' },
      { text: 'Xem số liệu đã tính: tab "📊 Báo Cáo" (chỉ cần quyền xem báo cáo, không cần quyền quản lý/kích hoạt).' },
    ],
    footer: { left: [
      { label: 'Tách biệt nhiệm vụ (mục 8 tài liệu)', text: 'người TẠO/SỬA điều khoản (quyền Quản Lý) KHÔNG tự động KÍCH HOẠT được — phải người khác có quyền Kích Hoạt riêng mới bật điều khoản sang Đang Hoạt Động, vì liên quan trực tiếp số tiền chiết khấu lớn với NCC.' },
      { label: 'Không sửa trực tiếp điều khoản đã Kích Hoạt', text: 'phải "Nhân Bản" thành bản Nháp mới (version+1) rồi sửa/kích hoạt lại — giữ nguyên bản cũ để không làm sai lệch các lần Tính Ước Tính đã thực hiện trước đó (mỗi lần tính LUÔN lưu lại đúng bậc thang tại thời điểm tính, không tham chiếu ngược điều khoản hiện tại). **Kích hoạt bản Nhân Bản tự Lưu Trữ bản cũ (từ 9/2026)**: bấm Kích Hoạt cho bản Nháp mới sẽ tự chuyển bản ACTIVE CŨ cùng Nhà Cung Cấp + Mã Điều Khoản sang "🗄️ Lưu Trữ" ngay lập tức — không còn 2 bản cùng Hoạt Động song song để chọn nhầm bản cũ (bậc thang lỗi thời) khi Tính Ước Tính.' },
      { label: 'Nhập/Xuất Dữ Liệu Thủ Công — phương án thay thế DSmart', text: 'khối "📤 Nhập/Xuất Dữ Liệu Thủ Công" (tab con 🔄 Đồng Bộ DSmart) dùng khi DSmart tạm không sẵn sàng hoặc cần bổ sung tay vài giao dịch lẻ — dữ liệu nhập tay ghi vào CÙNG 1 chỗ với dữ liệu DSmart (chỉ khác cột "Nguồn": DSMART/MANUAL) nên Tính Ước Tính dùng chung, và cũng tự chống trùng y như đồng bộ tự động.' },
      { label: 'Đồng bộ DSmart tự chống trùng VÀ tự cập nhật (9/2026)', text: 'mỗi lần Đồng Bộ đối chiếu theo mã tham chiếu gốc — dòng CHƯA có thì thêm mới, dòng ĐÃ có nhưng DSmart sửa lại nội dung (VD sửa số tiền/ngày mua) thì CẬP NHẬT LẠI ngay tại dòng cũ, dòng y hệt lần trước thì bỏ qua (không ghi thừa); kết quả mỗi lần đồng bộ hiện đủ 3 số "dòng mới / dòng cập nhật lại / trùng bỏ qua". Trước đây dòng đã có luôn bị bỏ qua vô điều kiện — số liệu DSmart sửa lại sau khi đã đồng bộ lần đầu sẽ không bao giờ cập nhật, làm sai lệch vĩnh viễn kết quả Tính Ước Tính.' },
      { label: 'Tính Ước Tính phải nằm trong hiệu lực điều khoản (9/2026)', text: 'kỳ tính (Từ ngày–Đến ngày) chọn ra ngoài Ngày Hiệu Lực Từ/Đến của điều khoản sẽ bị từ chối — tránh gộp nhầm doanh số của các tháng KHÔNG thuộc phạm vi thoả thuận vào số ước tính. Điều khoản hết hiệu lực (qua Ngày Hiệu Lực Đến) KHÔNG tự chuyển sang "Hết Hạn" — vẫn phải người quản lý tự bấm "⏳ Hết Hạn"; guard kỳ tính ở trên hoạt động độc lập, không phụ thuộc việc đã đánh dấu hết hạn hay chưa.' },
    ], right: [
      { label: 'Quyền quản lý (Tạo/Sửa/Nhân Bản/Đồng Bộ/Tính)', text: 'quản lý Nhà Cung Cấp và Điều Khoản, kích hoạt Đồng Bộ DSmart, bấm Tính Ước Tính cho điều khoản đang Hoạt Động.' },
      { label: 'Quyền kích hoạt (riêng)', text: 'CHỈ chuyển điều khoản từ Nháp sang Đang Hoạt Động — không tự động có quyền quản lý/sửa nội dung.' },
      { label: 'Quyền xem Báo Cáo', text: 'xem module con "📊 Báo Cáo" nội bộ Mua Hàng (số liệu đã tính) — là điều kiện đủ để vào được module, không cần quyền quản lý/kích hoạt nào khác. Người NGOÀI module này vẫn xem được số liệu qua module 📊 Báo Cáo tổng hợp (mục riêng ở đó, gác bằng cơ chế Mở Thêm Mục đã có — KHÔNG cần vào module Mua Hàng).' },
      { label: 'Đối chiếu/Phê duyệt Sổ Cái — chưa triển khai', text: '2 quyền Đối Chiếu/Phê Duyệt đã khai báo sẵn trong cây phân quyền cho Giai đoạn 2-3 (Sổ Cái ACCRUED→CONFIRMED→SETTLED, đối chiếu với NCC) — hiện chưa có luồng nghiệp vụ nào dùng tới.' },
    ] },
  },
  // ===== 3 màn DÙNG CHUNG (10/2026) — xem chú thích ở 2 nhóm cuối NGHIEP_VU_NAV =====
  approvalHub: {
    icon: '✅', title: 'Phê Duyệt (Hộp Thư Duyệt Tổng Hợp)', badge: 'Dùng chung mọi module',
    desc: 'Một chỗ DUY NHẤT gom toàn bộ hồ sơ đang chờ ĐÚNG bạn duyệt ngay bây giờ, từ mọi module có luồng duyệt (Tài liệu, Văn bản trình, Hợp đồng + Tài liệu ký, Đăng ký xe, Mua Bán/Sửa Chữa, Thanh Toán, Văn phòng phẩm, Ngân Sách, Phòng họp, Giấy phép, Góc chia sẻ, Phê Duyệt Giá Bán Lẻ/Bán Buôn, Đơn Hàng/QLDA của Vận Hành...) — bấm Duyệt/Từ chối ngay tại đây, KHÔNG cần mở từng module. Đổi bộ lọc "Trạng Thái" để tra lại hồ sơ mình ĐÃ duyệt/đã từ chối trước đây.',
    flow: { ariaLabel: 'Cách hoạt động của Hộp Thư Duyệt Tổng Hợp', chain: [
      { label: 'Hồ sơ chờ ở module gốc', sub: 'Bất kỳ module nào có bước duyệt' },
      { label: 'Hub gom về 1 danh sách', sub: 'Chỉ hồ sơ ĐÚNG bạn duyệt được lúc này', kind: 'decision' },
      { label: 'Về lại module gốc', sub: 'Chuyển bước/gửi email y hệt duyệt tại module', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Duyệt', rejectLabel: 'Từ chối', rejectBox: { label: 'Bị từ chối', sub: 'Theo đúng luật của module gốc' }, loopBackToIndex: 0, loopBackLabel: 'Hồ sơ quay về module gốc' } },
    steps: [
      { role: 'Người duyệt', text: 'vào mục <b>✅ Phê Duyệt</b> (sidebar, ngay dưới 🏠 Trang chủ) — con số trên nhãn nút chính là số hồ sơ đang chờ bạn xử lý.' },
      { text: 'Thu hẹp danh sách bằng 4 bộ lọc trên đầu: <b>Trạng Thái</b> (⏳ Đang chờ duyệt / ✅ Đã duyệt / ❌ Đã từ chối), <b>Khoảng Thời Gian</b> (chỉ hiện khi xem lại hồ sơ đã xử lý: 30 ngày / 90 ngày / Tất cả thời gian), <b>Lọc Theo Loại</b>, và ô <b>"Tìm Theo Mã / Trích Yếu"</b>.' },
      { role: 'Người duyệt', text: 'trong bảng (Loại / Mã / Trích Yếu / Phòng Ban / Bước Hiện Tại / Trạng Thái / Ngày Tạo / Thao Tác), bấm nút ở cột <b>Thao Tác</b>: <b>"✅ Duyệt"</b> hoặc <b>"❌ Từ chối"</b> với hồ sơ duyệt được 1 chạm; hồ sơ cần nhập thêm thông tin thì nút là <b>"✍️ Xử lý / Duyệt"</b> — bấm vào sẽ mở đúng màn xử lý đầy đủ của module gốc (VD Văn Bản Trình, Đăng Ký Xe).' },
      { text: 'Cột "Bước Hiện Tại" cho biết hồ sơ đang ở bước mấy trên tổng số bước (VD "Bước 2/3: Trưởng phòng") — duyệt xong, hồ sơ tự rời danh sách và đi tiếp sang người duyệt bước sau.' },
      { text: 'Xem lại việc đã làm: đổi Trạng Thái sang "✅ Đã duyệt" hoặc "❌ Đã từ chối" — cột ngày tự đổi nhãn thành "Ngày Xử Lý" và hiện thêm ô Khoảng Thời Gian. Không còn gì chờ thì màn hiện "🎉 Hiện không có hồ sơ nào chờ bạn duyệt."' },
    ],
    footer: { left: [
      { label: 'Chỉ hiện hồ sơ ĐÚNG bạn duyệt được NGAY BÂY GIỜ', text: 'điều kiện lọc từng hồ sơ ở đây COPY y hệt điều kiện duyệt của chính module gốc — hồ sơ đang ở bước của người khác, hoặc bạn đã duyệt ở bước trước rồi, đều không hiện. Không thấy hồ sơ mình tưởng phải duyệt thì kiểm tra lại cấu hình bước duyệt (Hệ Thống → 🔄 Quy Trình & Phê Duyệt) chứ không phải lỗi hiển thị của Hub.' },
      { label: 'Ai thấy được mục này', text: 'mọi tài khoản đang thực sự nằm trong ít nhất 1 luồng duyệt (được gán làm người duyệt ở 1 bước quy trình phòng ban/mức nào đó), hoặc có 1 trong các quyền duyệt phẳng (duyệt Hợp Đồng / Phòng Họp / Góc Chia Sẻ / Thanh Toán / Giấy Phép), hoặc admin — KHÔNG cần admin cấp thêm quyền riêng nào cho Hub.' },
    ], right: [
      { label: 'Hub không phải module lưu hồ sơ riêng', text: 'đây thuần là 1 lớp giao diện tổng hợp — không có kho hồ sơ/quy trình riêng, nút Duyệt/Từ chối gọi THẲNG đúng hàm xử lý của module gốc nên mọi hệ quả (gửi email, chuyển bước, tự sinh Công Việc từ Văn Bản Trình...) y hệt như duyệt tại module đó.' },
      { label: 'Nhãn trạng thái phụ', text: 'đa số dòng hiện "⏳ Đang Chờ Duyệt"; riêng vài loại có trạng thái con hữu ích hơn sẽ hiện "🟠 Chờ Bổ Sung" (VD Phê Duyệt Giá đang chờ người đề xuất nộp tệp bổ sung) để biết ngay là chưa tới lượt mình bấm duyệt.' },
      { label: 'Vẫn duyệt tại module gốc được', text: 'Hub không thay thế màn duyệt của từng module — cần xem thật kỹ hồ sơ/tệp đính kèm trước khi quyết định thì cứ mở module gốc như trước, kết quả không khác gì.' },
    ] },
  },
  reports: {
    icon: '📊', title: 'Báo Cáo (Tổng Hợp Toàn Hệ Thống)', badge: 'Chỉ đọc, không tạo hồ sơ',
    desc: 'Màn tổng hợp SỐ LIỆU đọc từ các module khác — không có luồng nghiệp vụ riêng, không tạo/sửa hồ sơ nào. Điều hướng 2 cấp: chọn 1 nhánh ở hàng nút trên (Tổng Hợp đa chiều, hoặc từng module), nhánh nào có module con thì hiện thêm hàng "Chọn màn báo cáo:" cấp 2. Cùng 1 bộ lọc thời gian/phòng ban áp dụng cho mọi nhánh, xuất được ra Excel.',
    flow: { ariaLabel: 'Quy trình xem Báo Cáo tổng hợp', chain: [
      { label: 'Chọn nhánh báo cáo', sub: 'Hàng nút cấp 1' },
      { label: 'Chọn màn báo cáo', sub: 'Hàng cấp 2 (nếu nhánh có module con)' },
      { label: 'Lọc thời gian / phòng ban', sub: 'Dùng chung cho mọi nhánh' },
      { label: 'Xem & Xuất Excel', sub: 'Chỉ đọc, không sửa được gì', kind: 'approved' },
    ] },
    steps: [
      { text: 'Vào mục <b>📊 Báo cáo</b> (sidebar, ngay dưới 📘 Hướng Dẫn).' },
      { text: 'Chọn nhánh ở hàng nút cấp 1: <b>📊 Tổng Hợp</b> (đa chiều toàn hệ thống), 📂 Tài Liệu, 📜 Văn Bản Trình, ✅ Công Việc, 📄 Hợp Đồng, 📝 Biên Bản Họp, 🖥️ Hỗ Trợ IT, 📅 Báo Cáo Định Kỳ, 📣 Truyền Thông Nội Bộ, 🏢 Hành Chính, 🛒 Tổng Hợp, 👤 Nhân Sự, 🛠️ Vận Hành, 🛒 Mua Hàng (BAS).' },
      { text: 'Nhánh có module con (🏢 Hành Chính, 🛒 Tổng Hợp, 👤 Nhân Sự, 🛠️ Vận Hành) hiện thêm dòng <b>"Chọn màn báo cáo:"</b> — bấm đúng module con cần xem (VD Hành Chính → 📅 Phòng Họp / 🚗 Đăng Ký Xe / 🖇️ Văn Phòng Phẩm / 👕 Đồng Phục / 🪪 Giấy Phép). Nhánh không có module con thì vào thẳng màn báo cáo.' },
      { text: 'Lọc số liệu bằng khối trắng bên dưới: <b>Từ Ngày (theo ngày tạo hồ sơ)</b>, <b>Đến Ngày</b>, <b>Phòng Ban</b> → bấm <b>"Đặt Lại Bộ Lọc"</b> để xoá hết. Riêng màn Đồng Phục, ô Phòng Ban tự đổi thành khối <b>"Nhóm Siêu Thị"</b> tick chọn nhiều siêu thị (mặc định chọn hết, có "Chọn Tất Cả"/"Bỏ Chọn Hết").' },
      { text: 'Bấm <b>"📥 Xuất Báo Cáo Excel"</b> (góc trên bên phải) để tải số liệu đang xem ra file.' },
      { role: 'Quản trị viên', text: 'mở thêm 1 tab báo cáo cho người CHƯA có quyền module tương ứng: vào <b>Hệ Thống → ⚙️ Quản Trị → 🔐 Phân Quyền</b> → bấm "Sửa" đúng tài khoản → chọn ở ô <b>"📊 Mở Thêm Tab Báo Cáo (tuỳ chọn)"</b> (mở từng tab cụ thể), hoặc tick <b>"👁️ Xem Toàn Bộ Tab Báo Cáo"</b> trong cây quyền để mở hết mọi tab → bấm "Lưu Người Dùng &amp; Phân Quyền".' },
    ],
    footer: { left: [
      { label: 'Khác "📅 Báo Cáo Định Kỳ"', text: 'Báo Cáo Định Kỳ (nhóm Điều Hành) là 1 QUY TRÌNH chủ động — từng phòng ban nhập, nộp, tổng hợp theo kỳ. Mục này chỉ ĐỌC lại số liệu đã có từ các module, không có thao tác nghiệp vụ nào.' },
      { label: 'Dữ liệu Nhân Sự cực nhạy cảm KHÔNG có ở đây', text: 'Hồ Sơ Nhân Sự / Hợp Đồng Lao Động / Lương / Chấm công không đưa vào báo cáo dùng chung — muốn xem số liệu tổng hợp nhóm này phải dùng module con "📊 Báo Cáo" RIÊNG cấp Nhân Sự (gác đúng quyền của module Nhân Sự). Nhánh 👤 Nhân Sự ở đây chỉ gồm HCRC Đồng Hành và Onboarding/Offboarding.' },
    ], right: [
      { label: '"Mở Thêm Tab" chỉ mở TAB, không mở dữ liệu', text: 'cơ chế Mở Thêm Tab Báo Cáo / Xem Toàn Bộ Tab Báo Cáo chỉ quyết định tab nào HIỆN trên hàng nút — số liệu thật vẫn luôn lọc theo đúng phạm vi phòng ban/quyền sở hữu bản ghi của từng module. Ngoại lệ duy nhất là Checklist Đánh Giá Siêu Thị (module đó phân quyền phẳng theo "có tham gia hay không" nên xem chéo đúng nghĩa là thấy toàn bộ bài nộp).' },
      { label: 'Module mới phải được thêm vào đây', text: 'mỗi module có tạo hồ sơ riêng đều phải bổ sung 1 nhánh trong cây báo cáo này ngay khi ra mắt — thiếu thì số liệu module đó không bao giờ xuất hiện ở màn tổng hợp dù dữ liệu vẫn có.' },
    ] },
  },
  profile: {
    icon: '⚙️', title: 'Hồ Sơ Cá Nhân & Bảo Mật Tài Khoản', badge: 'Mở cho mọi tài khoản',
    desc: 'Màn cài đặt của riêng bạn — mở bằng cách bấm vào KHỐI TÊN của mình ở đáy sidebar (không phải 1 tab trong menu). Gồm 6 tab: cập nhật thông tin liên hệ, đổi mật khẩu, đổi mã PIN duyệt, đăng ký vân tay/Face ID, quản lý xác thực 2 lớp (TOTP, chỉ quản trị viên), xác nhận đồng phục đã nhận — kèm khối cài ứng dụng lên màn hình chính (PWA).',
    flow: { ariaLabel: 'Các nhóm thiết lập trong Hồ Sơ Cá Nhân', chain: [
      { label: 'Mở Hồ Sơ Cá Nhân', sub: 'Bấm tên mình ở đáy sidebar' },
      { label: 'Chọn tab cần thiết lập', sub: '6 tab, mỗi tab tự lưu riêng', kind: 'decision' },
      { label: 'Lưu từng tab', sub: 'Có hiệu lực ngay', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Lưu tab đang mở', rejectLabel: 'Sai mật khẩu/PIN hiện tại', rejectBox: { label: 'Báo lỗi, không lưu', sub: 'Nhập lại giá trị hiện tại cho đúng' }, loopBackToIndex: 1, loopBackLabel: 'Thử lại' } },
    steps: [
      { role: 'Mọi nhân viên', text: 'bấm vào <b>khối tên tài khoản của bạn ở ĐÁY sidebar</b> (ngay trên nút Đăng xuất) để mở hộp thoại <b>"⚙️ Cá Nhân Hóa &amp; Cập Nhật Thông Tin"</b>.' },
      { text: 'Tab <b>"👤 Thông Tin"</b>: sửa Họ và Tên, Email Nhận Thông Báo, Số Điện Thoại (Tên đăng nhập khoá cứng, chỉ quản trị viên đổi được) → bấm <b>"Lưu Thay Đổi"</b>.' },
      { text: 'Tab <b>"🔒 Đổi Mật Khẩu"</b>: nhập Mật khẩu hiện tại, Mật khẩu mới, Xác nhận mật khẩu mới → bấm <b>"Đổi Mật Khẩu"</b>.' },
      { role: 'Người duyệt dùng mã PIN', text: 'tab <b>"🔑 Đổi Mã PIN"</b> (chỉ hiện với tài khoản được cấu hình xác thực lại bằng PIN khi Duyệt): nhập Mã PIN hiện tại, Mã PIN mới (số, tối thiểu 4 chữ số), Xác nhận → bấm <b>"🔑 Cập Nhật Mã PIN"</b>.' },
      { text: 'Tab <b>"🖐️ Vân Tay/Face ID"</b> (chỉ hiện khi trình duyệt/thiết bị hỗ trợ): gõ tên thiết bị vào ô "Tên thiết bị (VD: iPhone của tôi)" → bấm <b>"➕ Đăng Ký Thiết Bị Này"</b> → làm theo hướng dẫn của máy. Sau đó đăng nhập hoặc xác thực lại khi Duyệt bằng vân tay/Face ID thay vì gõ mật khẩu.' },
      { role: 'Quản trị viên', text: 'tab <b>"🔐 Xác Thực 2 Lớp"</b> (chỉ tài khoản quản trị, luôn BẮT BUỘC bật): thêm máy thứ 2 bằng cách nhập mật khẩu rồi bấm <b>"Hiện Mã QR"</b> để quét lại đúng mã đang dùng (không làm mất hiệu lực máy cũ); đổi điện thoại/thiết lập lại từ đầu thì nhập mật khẩu rồi bấm <b>"🗑️ Gỡ Xác Thực 2 Lớp"</b> — lần đăng nhập kế tiếp hệ thống tự đưa tới màn thiết lập TOTP mới.' },
      { text: 'Tab <b>"👕 Đồng Phục Của Tôi"</b>: xem các phiếu đồng phục đã cấp cho bạn và bấm "Xác nhận đã nhận" sau khi thực nhận đủ (đây chính là bước cuối của quy trình Đồng Phục).' },
      { text: 'Khối <b>"📲 Cài Đặt Ứng Dụng"</b> ở cuối hộp thoại: trên Android/Chrome bấm <b>"⬇️ Cài Đặt Ngay"</b>; trên iPhone/iPad phải dùng Safari → nút Chia sẻ → "Thêm vào MH chính" → "Thêm" (Chrome/Cốc Cốc trên iOS không cài được).' },
    ],
    footer: { left: [
      { label: 'Mỗi tab lưu riêng', text: '6 tab hoàn toàn độc lập, mỗi tab có nút lưu của chính nó — đổi mật khẩu không cần đụng tới thông tin liên hệ và ngược lại; đóng hộp thoại giữa chừng chỉ mất phần đang gõ dở ở tab đó.' },
      { label: 'Mã PIN khác mật khẩu', text: 'mã PIN chỉ dùng để XÁC THỰC LẠI lúc bấm Duyệt (hoặc xoá vĩnh viễn hồ sơ trong Thùng Rác) với tài khoản được admin cấu hình mức xác thực đó — không dùng để đăng nhập, đổi PIN đi qua đường riêng nên phải nhập PIN cũ chứ không phải mật khẩu.' },
    ], right: [
      { label: 'Vân tay/Face ID là tiện ích chung', text: 'đăng ký thiết bị không phụ thuộc mức xác thực admin đặt cho bạn — ai có máy hỗ trợ cũng đăng ký được để đăng nhập nhanh; thiết bị đã đăng ký liệt kê ngay trong tab đó để gỡ khi đổi máy.' },
      { label: 'Xác thực 2 lớp không tắt được', text: 'tài khoản quản trị viên BẮT BUỘC bật TOTP, không có nút "tắt hẳn" — chỉ có "gỡ để thiết lập lại", và đăng nhập lần sau sẽ bị đưa thẳng vào màn thiết lập lại trước khi vào được hệ thống.' },
    ] },
  },
};

// ===================== Hệ Thống — MỌI mục trong SYSTEM_NAV đều đã có entry đầy đủ ở đây (chú thích cũ
// "chỉ 3/10 mục có nội dung để demo" đã lạc hậu, gỡ bỏ 10/2026). Thêm màn admin mới thì thêm ĐỒNG THỜI
// 1 key vào SYSTEM_NAV và 1 entry tại đây — thiếu 1 trong 2 sẽ hiện cảnh báo "⚠️ Chưa có tài liệu nghiệp
// vụ" ngay trên màn thật. ĐƯỜNG DẪN ghi trong `steps` phải đủ CẢ cấp tab con: 6 màn Cấu Hình Email/
// Thông Báo Email Phê Duyệt/Quản Lý Danh Mục/Phân Quyền/API Xác Thực Ngoài/Cấu Hình API đều là tab CẤP 2
// nằm BÊN TRONG "⚙️ Quản Trị" (xem #adminSubTabBar ở fragments/systemSection.html), không phải mục cấp 1
// trên sidebar Hệ Thống. =====================
const SYSTEM_DOCS = {
  sysPermissions: {
    icon: '🔑', title: 'Phân Quyền', badge: 'Chỉ Quản Trị Viên',
    desc: 'Cây quyền chi tiết theo từng khối chức năng (không phải vai trò cố định kiểu "Nhân viên/Quản lý") — mỗi tài khoản được tick từng quyền riêng lẻ, kết hợp tự do. Từ v23.28, 3 nhóm dữ liệu nhạy cảm Nhân Sự (Hồ Sơ/Hợp Đồng/Lương) KHÔNG còn tự động mở cho admin — phải tick quyền tương ứng như tài khoản thường.',
    flow: { ariaLabel: 'Quy trình cấp quyền cho 1 tài khoản', chain: [
      { label: 'Mở Sửa Người Dùng', sub: 'Quản Trị → Phân Quyền' },
      { label: 'Tick quyền theo khối', sub: 'Từng khối chức năng riêng' },
      { label: 'Lưu lại', sub: 'Áp dụng ngay lần đăng nhập sau', kind: 'approved' },
    ] },
    steps: [
      { role: 'Quản trị viên', text: 'vào <b>Hệ Thống → ⚙️ Quản Trị → 🔐 Phân Quyền</b> → kéo xuống bảng danh sách tài khoản, tìm đúng tài khoản → bấm <b>"Sửa"</b> (form tạo/sửa tài khoản nằm ngay đầu chính tab này — hệ thống KHÔNG có màn "Người Dùng" riêng trên sidebar).' },
      { role: 'Quản trị viên', text: 'kéo xuống khối <b>"Phân Quyền"</b> — cây quyền chia theo từng module (Văn Bản, Tài Chính, Nhân Sự, Vận Hành, Hệ Thống...), mỗi khối là 1 nhóm checkbox riêng, tick đúng quyền cần cấp.' },
      { role: 'Quản trị viên', text: '3 khối nhạy cảm Nhân Sự (Hồ Sơ/Hợp Đồng/Lương) hiện RIÊNG với ghi chú "không tự động mở cho admin" — phải tick tường minh dù tài khoản đã có quyền admin chung.' },
      { role: 'Quản trị viên', text: 'bấm <b>"Lưu Người Dùng &amp; Phân Quyền"</b> — quyền mới có hiệu lực ngay từ lượt tải lại trang / đăng nhập sau của tài khoản đó (không cần đăng xuất-vào lại ngay lập tức nếu đang F5 lại trang).' },
    ],
    footer: { left: [
      { label: 'Không có "vai trò" cố định', text: 'hệ thống không gán sẵn gói quyền theo chức danh — mỗi tài khoản là 1 tổ hợp quyền độc lập, linh hoạt nhưng đòi hỏi quản trị viên tick đúng/đủ khi tạo tài khoản mới.' },
      { label: 'admin KHÔNG còn "toàn quyền tuyệt đối"', text: 'từ v23.28, `perms.admin=true` không tự mở 3 khối Hồ Sơ/Hợp Đồng/Lương Nhân Sự nữa — hạn chế rủi ro 1 tài khoản admin kỹ thuật vô tình xem được dữ liệu nhạy cảm không thuộc phạm vi công việc.' },
      { label: 'Tài khoản "admin" gốc luôn bị ÉP toàn quyền, không sửa/khoá được', text: 'bất kỳ ai sửa bản ghi tài khoản có username gốc là "admin" (kể cả chính admin tự sửa) đều bị server ÉP LẠI `perms:{admin:true}`, `groupIds:[]`, `permOverrides:null` ngay tại điểm lưu — không thể gỡ quyền/gán vào nhóm phân quyền cho tài khoản này. Cũng KHÔNG đổi được tên đăng nhập của tài khoản này (v23.68) — hệ thống luôn giữ đúng bất biến "luôn có 1 tài khoản tên admin toàn quyền", kể cả khi đổi tên thử trong cùng 1 lượt lưu.' },
      { label: 'Không tự khoá được chính mình, không được làm hệ thống hết Admin', text: 'server chặn cứng 2 tình huống: (1) tự đặt "active: false" cho chính tài khoản đang đăng nhập — kể cả gọi thẳng API cũng bị từ chối; (2) lưu 1 lượt khiến KHÔNG còn tài khoản nào giữ quyền Admin và đang hoạt động (`active` khác false) — báo lỗi ngay, không cho lưu.' },
    ], right: [
      { label: 'Nhóm Phân Quyền', text: 'mẫu quyền dựng sẵn (ô "Nhóm Phân Quyền" ngay trong form Sửa Người Dùng) gom nhiều quyền phê duyệt lại thành 1 "vai trò ảo" để gán nhanh cho người mới — không thay thế cây quyền chi tiết, chỉ là lối tắt khi cấp hàng loạt. Khác "🧩 Nhóm Quyền Đặc Biệt" (nay ở tab "🔀 Nghiệp Vụ Nâng Cao") — đó là 3 cấu hình chung toàn hệ thống, không phải mẫu quyền theo người.' },
      { label: '"Xem Toàn Bộ Mục Nghiệp Vụ"', text: 'quyền admin-grant riêng (`nghiepVuViewAll`) cho phép 1 tài khoản đọc hết tài liệu Nghiệp Vụ mà không cần cấp quyền module thật — dùng cho đào tạo/kiểm toán nội bộ. KHÔNG áp dụng cho khu Hệ Thống (khu vực này luôn đòi `perms.admin` thật, không bypass được).' },
      { label: 'Chọn siêu thị đổi sang ô tìm-kiếm-gõ-chọn (10/2026)', text: '2 khối "🧾 Duyệt Nhập/Hủy Đơn Hàng Siêu Thị" (mục 22. Vận Hành) và "Phạm Vi Kiểm Soát" (mục 23. Checklist Đánh Giá Siêu Thị) trước đây là lưới checkbox 2-3 cột khiến tên siêu thị dài bị cắt ngắn/không nhìn thấy hết — nay đổi sang ô gõ để tìm rồi bấm chọn (giống ô chọn Đơn Vị/Chức Danh ở "🧩 Nhóm Quyền Đặc Biệt"), mỗi siêu thị đã chọn hiện thành 1 thẻ (chip) có nút ✕ để bỏ chọn nhanh. Vẫn giữ nguyên checkbox "ALL" riêng — tick ALL thì ô chọn siêu thị tự mờ đi (không cần chọn từng cái).' },
    ] },
  },
  sysPermMatrix: {
    icon: '🧮', title: 'Ma Trận Phân Quyền', badge: 'Chỉ Quản Trị Viên',
    desc: 'Từ 10/2026 — xuất/nhập hàng loạt qua Excel toàn bộ quyền dạng Có/Không (bật/tắt) của Người Dùng hoặc Nhóm Phân Quyền, thay vì phải tick tay từng ô cho từng người. Cột của file Excel tự sinh động theo đúng quyền đang có trong hệ thống (không lệch với cây quyền ở mục 🔑 Phân Quyền khi có quyền mới về sau), đặt tên TIẾNG VIỆT đúng như nhãn checkbox thật cho dễ đọc. Mỗi file có NHIỀU SHEET (mỗi khối quyền — Tài Liệu, Hợp Đồng, Nhân Sự... — 1 sheet riêng, KHÔNG còn dồn hết ~130 cột vào 1 sheet phẳng), cột Username/HoTen/PhongBan (hoặc TenNhom/MoTa) lặp lại ở mọi sheet để mở riêng sheet nào cũng biết đang xem quyền của ai.',
    flow: { ariaLabel: 'Quy trình xuất-sửa-nhập Ma Trận Phân Quyền', chain: [
      { label: 'Xuất Excel', sub: 'Người Dùng hoặc Nhóm Phân Quyền' },
      { label: 'Sửa hàng loạt trên Excel', sub: 'Đổi Y/N ở cột tiếng Việt' },
      { label: 'Nhập lại + xem trước', sub: 'Đối chiếu, chỉ áp dụng dòng có thay đổi', kind: 'decision' },
      { label: 'Xác Nhận Áp Dụng', sub: 'Ghi trực tiếp vào hệ thống', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Bấm Xác Nhận', rejectLabel: 'Bấm Hủy', rejectBox: { label: 'Không thay đổi gì', sub: 'Huỷ bỏ toàn bộ file vừa đọc' }, loopBackToIndex: 0, loopBackLabel: 'Sửa lại file rồi nhập lại' } },
    steps: [
      { role: 'Quản trị viên', text: 'vào <b>Hệ Thống → ⚙️ Quản Trị → 🔐 Phân Quyền</b> → kéo xuống khối <b>"🧮 Ma Trận Phân Quyền"</b> (nằm ngay dưới khối Import Excel Người Dùng).' },
      { role: 'Quản trị viên', text: 'bấm <b>"📤 Xuất Excel Người Dùng"</b> (1 dòng = 1 tài khoản) hoặc <b>"📤 Xuất Excel Nhóm Phân Quyền"</b> (1 dòng = 1 nhóm) — mỗi loại là 1 file .xlsx RIÊNG, không gộp chung.' },
      { role: 'Quản trị viên', text: 'mở file Excel vừa tải: mỗi cột quyền có TÊN TIẾNG VIỆT đúng như nhãn checkbox thật ở cây phân quyền (VD "Hành Chính &gt; Đăng Ký Xe", "Đăng Ký Xe — Người Điều Hành Xe...") — gõ <b>Y</b>/<b>N</b> để bật/tắt (file cũ còn ghi TRUE/FALSE từ trước 10/2026 vẫn nhập lại được bình thường). Quyền hiếm chưa có nhãn tiếng Việt vẫn hiện được, chỉ ở dạng kỹ thuật <b>"Q_&lt;tên quyền&gt;"</b>. Cột "NhomPhanQuyen" (sheet Người Dùng) và "BaoCao_MucBoSung" (cả 2 sheet) nhận nhiều giá trị cách nhau bằng dấu <b>;</b>. KHÔNG đổi cột đầu tiên (Username/TenNhom) — đó là khoá để hệ thống nhận diện đúng ai/nhóm nào.' },
      { role: 'Quản trị viên', text: 'sửa xong, bấm <b>"📥 Import Người Dùng"</b> hoặc <b>"📥 Import Nhóm Phân Quyền"</b> tương ứng đúng file vừa sửa → hệ thống hiện bảng xem trước, chỉ liệt kê dòng THỰC SỰ có thay đổi so với dữ liệu hiện tại, dòng nào không tìm thấy/trùng trong file sẽ báo rõ và không cho tick.' },
      { role: 'Quản trị viên', text: 'bỏ tick dòng nào không muốn áp dụng, rồi bấm <b>"✅ Xác Nhận Áp Dụng"</b> — quyền mới có hiệu lực ngay từ lượt tải lại trang / đăng nhập sau của người đó.' },
    ],
    footer: { left: [
      { label: 'Chỉ áp dụng quyền dạng Có/Không', text: 'quyền theo PHẠM VI (VD chỉ cho xem 1 số phòng ban/siêu thị cụ thể, không phải toàn bộ) và các trường không phải Có/Không (mức phê duyệt IT, danh sách phòng ban upload...) KHÔNG có trong ma trận — vẫn phải vào form Sửa Người Dùng/Sửa Nhóm ở mục 🔑 Phân Quyền để chỉnh tay phần này.' },
      { label: 'Nhập theo Nhóm sẽ cập nhật NGAY cho mọi thành viên', text: 'sửa quyền 1 Nhóm Phân Quyền qua ma trận cũng áp dụng ngay cho TẤT CẢ người đang thuộc nhóm đó (giống hệt khi sửa tay ở khối "🗂️ Nhóm Phân Quyền"), không phải chỉ ảnh hưởng riêng bản ghi nhóm.' },
      { label: 'Tài khoản "admin" gốc không đổi được qua đây', text: 'dòng Username="admin" trong file Người Dùng bị bỏ qua khi áp dụng — tài khoản này luôn bị hệ thống ép giữ toàn quyền, xem thêm mục 🔑 Phân Quyền.' },
    ], right: [
      { label: 'Vì sao Người Dùng và Nhóm Phân Quyền vẫn là 2 file riêng', text: 'dù máy chủ giờ đã đọc được nhiều sheet trong 1 file, Người Dùng và Nhóm Phân Quyền vẫn tách 2 file .xlsx riêng vì là 2 khái niệm khác hẳn nhau ("1 dòng = 1 người" và "1 dòng = 1 nhóm") — chỉ các khối quyền BÊN TRONG cùng 1 loại (Tài Liệu, Hợp Đồng, Nhân Sự...) mới gộp chung 1 file, mỗi khối 1 sheet.' },
      { label: 'Sửa nhầm 2 sheet khác nhau cho cùng 1 người/nhóm', text: 'cột Username/TenNhom xuất hiện lại ở MỌI sheet (đúng thiết kế) — hệ thống tự gộp lại khi import, KHÔNG coi là trùng lặp lỗi. Chỉ báo lỗi trùng khi CÙNG 1 Username/TenNhom xuất hiện từ 2 DÒNG trở lên TRONG CHÍNH 1 SHEET (VD dán nhầm trùng dòng).' },
      { label: 'Cột "BaoCao_MucBoSung"', text: 'ứng với các tab Báo Cáo được mở THÊM ngoài quyền vận hành thông thường (VD người không có quyền Vận Hành nhưng vẫn cần xem tab Báo Cáo Vận Hành) — gõ đúng danh sách tab cách nhau bằng dấu ";", để trống nghĩa là không mở thêm tab nào.' },
    ] },
  },
  sysUsers: {
    icon: '👥', title: 'Người Dùng', badge: 'Chỉ Quản Trị Viên',
    desc: 'Tạo/sửa/khoá tài khoản đăng nhập — hỗ trợ tạo hàng loạt (điền nhiều người vào 1 danh sách tạm rồi lưu 1 lần) tiện khi nhận nhiều nhân viên mới cùng đợt.',
    flow: { ariaLabel: 'Quy trình tạo tài khoản hàng loạt', chain: [
      { label: 'Điền form 1 người', sub: 'Thêm vào danh sách tạm' },
      { label: 'Lặp lại nhiều người', sub: 'Chưa gửi lên server' },
      { label: 'Kiểm tra trùng tên', sub: 'Cả danh sách tạm lẫn tài khoản cũ', kind: 'decision' },
      { label: 'Lưu Tất Cả Danh Sách', sub: 'Tạo cùng lúc toàn bộ', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Không trùng', rejectLabel: 'Trùng tên đăng nhập', rejectBox: { label: 'Báo lỗi trùng', sub: 'Chỉ rõ dòng nào trùng' }, loopBackToIndex: 0, loopBackLabel: 'Sửa lại tên đăng nhập' } },
    steps: [
      { role: 'Quản trị viên', text: 'vào <b>Hệ Thống → ⚙️ Quản Trị → 🔐 Phân Quyền</b> — form tạo/sửa tài khoản LUÔN hiện sẵn ngay đầu tab (không có nút "+ Thêm" riêng, cũng không có màn "Người Dùng" tách riêng trên sidebar) → điền Vị Trí (HO/Siêu Thị), Tên đăng nhập, Mật khẩu, Họ và Tên, Email, Số điện thoại, Phòng Ban (hoặc Siêu Thị), Chức Danh.' },
      { role: 'Quản trị viên', text: 'tạo hàng loạt: điền xong 1 người → bấm <b>"➕ Thêm Vào Danh Sách"</b> (chưa gửi lên server) thay vì lưu ngay, lặp lại cho từng người tiếp theo — danh sách tạm hiện ở khối "📋 Danh Sách Người Dùng Chờ Lưu".' },
      { role: 'Quản trị viên', text: 'điền xong hết danh sách tạm → bấm <b>"💾 Lưu Tất Cả Danh Sách"</b> — hệ thống tự kiểm tra trùng tên đăng nhập (cả trong danh sách tạm lẫn với tài khoản đã có) trước khi tạo, báo rõ dòng nào trùng nếu có.' },
      { role: 'Quản trị viên', text: 'tạo 1 người lẻ thì bấm thẳng <b>"Lưu Người Dùng &amp; Phân Quyền"</b> (nút tím ngoài cùng bên phải) thay vì đưa vào danh sách chờ.' },
      { role: 'Quản trị viên', text: 'tài khoản mới chỉ có quyền tối thiểu — bấm <b>"Sửa"</b> lại đúng tài khoản đó trong bảng danh sách bên dưới để tick quyền (xem mục 🔑 Phân Quyền).' },
      { role: 'Quản trị viên', text: 'tạo hàng loạt bằng Excel (đợt HO/Siêu Thị lớn): bấm <b>"📄 Tải File Mẫu (.xlsx)"</b> — file mẫu có đủ 9 cột khớp ĐÚNG form tạo tay (username/pass/name/email/phone/dept/jobtitle/postype/startdate), điền xong bấm <b>"📥 Import Excel"</b> chọn file lên để xem trước.' },
      { role: 'Quản trị viên', text: 'ở bảng xem trước, dòng nào có Vị Trí/Phòng Ban (Siêu Thị)/Chức Danh/Ngày Vào Làm Việc KHÔNG khớp đúng danh mục hiện có sẽ bị CHẶN CỨNG (không có ô tick, cột "Ghi chú" nêu rõ lỗi) — phải sửa lại đúng trong file Excel rồi tải lên lại, không có cách nào nhập dòng lỗi qua được.' },
      { role: 'Quản trị viên', text: 'dòng hợp lệ mới có ô tick "Nhập?" (hoặc chọn Bỏ qua/Ghi đè nếu username đã có tài khoản) — bấm <b>"✅ Xác Nhận Import"</b> để tạo/ghi đè hàng loạt.' },
    ],
    footer: { left: [
      { label: 'Liên kết Phân Quyền', text: 'tạo tài khoản xong chưa có quyền gì đáng kể — luôn phải sang màn Phân Quyền tick đúng/đủ quyền cho tài khoản vừa tạo.' },
      { label: 'Import Excel: server chỉ đọc thô, không tự đoán/mặc định', text: 'Vị Trí phải đúng "HO" hoặc "STORE", Phòng Ban/Siêu Thị phải khớp ĐÚNG TÊN đang có trong Quản Lý Danh Mục (không phân biệt hoa/thường), Chức Danh nếu điền cũng phải khớp danh mục theo đúng Vị Trí (HO dùng danh mục Chức Danh Khối Văn Phòng, Siêu Thị dùng danh mục Chức Danh Siêu Thị) — để trống Chức Danh/Ngày Vào Làm Việc vẫn hợp lệ (2 trường tuỳ chọn, giống form tay).' },
      { label: 'Đặt mật khẩu cho người khác phải đủ mạnh + tự bắt đổi lại', text: 'admin gõ mật khẩu mới cho 1 tài khoản (tạo mới hoặc reset) bị kiểm tra độ mạnh THẬT ở server (cùng chuẩn với người dùng tự đổi mật khẩu, xem `lib/passwordPolicy.js`) — không còn đặt được mật khẩu yếu tuỳ ý như trước. Mật khẩu đặt hộ chỉ có giá trị cho LẦN ĐĂNG NHẬP ĐẦU: hệ thống tự gắn `mustChangePassword=true`, buộc chính người đó tự đổi lại ngay sau khi vào được, và tự huỷ mọi phiên đăng nhập cũ của tài khoản đó.' },
      { label: 'Tài khoản "admin" gốc là ngoại lệ đặc biệt', text: 'không đổi được tên đăng nhập, luôn bị ép giữ nguyên toàn quyền (`perms.admin=true`) dù có sửa cây quyền hay gán nhóm phân quyền thế nào — xem thêm mục 🔑 Phân Quyền.' },
    ], right: [
      { label: '🏷️ Vị Trí Kiêm Nhiệm', text: 'trường tuỳ chọn ở form Sửa Người Dùng — gán thêm 1-2 vị trí (chức danh+phòng ban) phụ để người đó được tính là người duyệt "Theo vị trí" ở module khác, KHÔNG đổi chức danh/phòng ban chính thức, không ảnh hưởng Quản Lý Trực Tiếp/KPI.' },
      { label: 'Không tự khoá được chính mình / không để hệ thống hết Admin', text: 'áp dụng CHUNG cho cả màn tạo tài khoản này: không lưu được nếu đang tự khoá (active:false) chính tài khoản đang đăng nhập, hoặc nếu lượt lưu khiến không còn tài khoản Admin nào đang hoạt động — xem chi tiết ở mục 🔑 Phân Quyền.' },
    ] },
  },
  sysWorkflow: {
    icon: '🔀', title: 'Quy Trình & Phê Duyệt', badge: 'Chỉ Quản Trị Viên',
    desc: 'Cấu hình người duyệt cho từng bước của hơn 15 module dùng chung 1 engine phê duyệt (Tài Liệu, Văn Bản Trình, Đăng Ký Xe, Hợp Đồng, Hỗ Trợ IT, Ngân Sách, Thanh Toán, Vận Hành - Đặt Hàng...) — mỗi bước của mỗi phòng ban/tier cấu hình độc lập.',
    flow: { ariaLabel: 'Quy trình cấu hình 1 bước duyệt', chain: [
      { label: 'Chọn module + bước', sub: 'Mỗi phòng ban/tier riêng' },
      { label: 'Chọn cách gán người duyệt', sub: 'Theo người / phòng ban / vị trí' },
      { label: 'Lưu', sub: 'Có hiệu lực ngay cho hồ sơ mới', kind: 'approved' },
    ] },
    steps: [
      { role: 'Quản trị viên', text: 'vào <b>Hệ Thống → 🔄 Quy Trình & Phê Duyệt</b> → chọn đúng module (VD "Hợp đồng - Phê duyệt") → chọn đúng phòng ban/mức cần cấu hình.' },
      { role: 'Quản trị viên', text: 'với từng bước, chọn 1 trong 3 chế độ: <b>Theo người</b> (chọn tay 1-nhiều người cụ thể), <b>Theo phòng ban</b> (toàn bộ người có quyền "Người duyệt" thuộc phòng ban đó), hoặc bật toggle <b>"🧭 Theo vị trí"</b> rồi chọn 1-nhiều vị trí (cặp chức danh+phòng ban, khai báo sẵn ở <b>Hệ Thống → 🔀 Nghiệp Vụ Nâng Cao → 🧩 Nhóm Quyền Đặc Biệt</b>).' },
      { role: 'Quản trị viên', text: 'tuỳ chọn: đặt <b>"Nhãn hành động"</b> riêng cho bước (VD "Xác Nhận"/"Thẩm Định" thay vì mặc định "Phê Duyệt") tại khối <b>"🛠️ Định Nghĩa Các Mẫu Bước Phê Duyệt"</b> — nhãn tự áp dụng cả ở nút bấm lẫn chân ký in, không đổi logic phân quyền/chuyển bước.' },
      { role: 'Quản trị viên', text: 'bấm <b>"Lưu"</b> — xác nhận người thật đang giữ đúng vị trí/thuộc phòng ban đó đã có quyền "Người duyệt" (tick ở Phân Quyền), nếu chưa thì khớp vị trí vẫn không duyệt được.' },
      { role: 'Quản trị viên', text: 'cần set nhanh số bước cho nhiều module cùng lúc: vào <b>Hệ Thống → 🔀 Nghiệp Vụ Nâng Cao → ⚡ Áp Dụng Nhanh</b> — chọn 1 mẫu quy trình có sẵn, bấm "🔍 Xem Trước" rồi "⚡ Áp Dụng" (chỉ điền phòng ban/mức đang THIẾU cấu hình, không tự gán người duyệt).' },
      { role: 'Quản trị viên', text: 'muốn Áp Dụng Nhanh TỰ GÁN LUÔN người duyệt Bước 1 theo đúng chức danh (VD "Trưởng Phòng") của TỪNG phòng ban/mức đang áp dụng (từ 10/2026): ở khối "3. Gán người duyệt theo Chức Danh cho từng bước", bật "🧭 Gán theo Chức Danh" cho Bước 1 → bật thêm "🏢 Tự động khớp đúng phòng ban của từng mục" (CHỈ có ở Bước 1) → chọn chức danh (không ghép phòng ban, phòng ban sẽ tự khớp) → Lưu rồi Áp Dụng. Mỗi phòng ban/mức sẽ tự ra ĐÚNG người giữ chức danh đó của RIÊNG mình, không lộ chéo sang phòng ban khác.' },
    ],
    footer: { left: [
      { label: 'Điểm bảo mật cốt lõi', text: 'khớp đúng vị trí/phòng ban chỉ là điều kiện LỌC BỚT — người đó vẫn phải có quyền "Người duyệt" (canBeApprover) riêng mới thực sự duyệt được, kể cả khi tên/vị trí đã đúng như cấu hình.' },
      { label: '🏢 Tự động khớp phòng ban (từ 10/2026, chỉ Bước 1)', text: 'trước đây "Theo Chức Danh" ở Áp Dụng Nhanh dùng CHUNG 1 danh sách chức danh cho MỌI phòng ban/mức được chọn — để trống phòng ban thì khớp chức danh đó CẢ CÔNG TY (VD Trưởng Phòng A duyệt được cả hồ sơ Phòng B). Bật "Tự động khớp đúng phòng ban của từng mục" giải quyết đúng lỗi này — chỉ dùng được ở Bước 1 (các bước sau thường là cấp cao hơn, không theo phòng ban của người đăng ký).' },
    ], right: [
      { label: 'Áp Dụng Nhanh không ghi đè', text: 'phòng ban/mức nào ĐÃ được cấu hình từ trước (kể cả chỉ mới chọn số bước) luôn được giữ nguyên — Áp Dụng Nhanh chỉ điền vào chỗ đang trống, không đụng cấu hình đã có.' },
    ] },
  },
  sysAdvWorkflow: {
    icon: '🔀', title: 'Nghiệp Vụ Nâng Cao', badge: 'Chỉ Quản Trị Viên',
    desc: 'Từ v23.65 — 4 mục cấu hình quy trình/duyệt "nâng cao" gom về 1 chỗ (trước đây rải rác: Áp Dụng Nhanh/Quy Trình Hỗn Hợp — nay đổi tên "Quy Trình Đặt Hàng Siêu Thị" từ v23.66 — là 2 tab cấp cao nhất riêng; Nhóm Phê Duyệt Trình-HĐ/Nhóm Quyền Đặc Biệt bị giấu bên trong form Sửa 1 tài khoản ở Phân Quyền dù là cấu hình CHUNG toàn hệ thống, không gắn user nào). Từ v23.73, sidebar cũng bỏ luôn mục "⚡ Áp Dụng Nhanh" RIÊNG (dư thừa, đã nằm sẵn bên trong) — thay bằng đúng 1 lối vào thẳng "🔀 Nghiệp Vụ Nâng Cao". Không đổi hành vi lưu của bất kỳ mục nào — chỉ đổi vị trí điều hướng cho dễ tìm.',
    isCustomFlow: true, customFlowRenderer: 'renderNVSysAdvWorkflowOverview', diagramTitle: 'Sơ đồ 4 mục con',
    steps: [
      { role: 'Quản trị viên', text: 'trên sidebar, "🔀 Nghiệp Vụ Nâng Cao" là 1 trong 5 mục ở dropdown "🛠️ Hệ Thống ▾" (⚙️ Quản Trị/📋 Biểu Mẫu/🔄 Quy Trình & Phê Duyệt/🔀 Nghiệp Vụ Nâng Cao/📎 Quản Lý Tệp File/📊 Log) — bấm thẳng mục đó để vào ĐÚNG màn Hệ Thống, đã mở sẵn tab "🔀 Nghiệp Vụ Nâng Cao" (giữ nguyên sub-tab đang mở dở lần gần nhất trong phiên, mặc định "🏬 Quy Trình Đặt Hàng Siêu Thị" nếu chưa từng mở).' },
      { role: 'Quản trị viên', text: 'ở THANH TAB TRÊN CÙNG (dính khi cuộn) ngay bên trong màn Hệ Thống, chọn 1 trong 4 sub-tab: <b>🏬 Quy Trình Đặt Hàng Siêu Thị</b> (ai duyệt từng bước đơn "Đặt Hàng Tại Siêu Thị", số bước vẫn cấu hình ở "Quy Trình & Phê Duyệt"), <b>⚡ Áp Dụng Nhanh</b> (set nhanh số bước cho nhiều module cùng lúc), <b>🖋️ Nhóm Phê Duyệt Trình/HĐ</b> (nhóm phê duyệt tuỳ chọn cho Văn Bản Trình + Hợp Đồng), hoặc <b>🧩 Nhóm Quyền Đặc Biệt</b> (Đơn Vị Tham Gia Quy Trình/Nhóm Không Cấp VPP/Vị Trí Tham Gia Quy Trình).' },
      { role: 'Quản trị viên', text: 'mỗi sub-tab có nút <b>"💾 Lưu"</b> RIÊNG cho đúng phần đang sửa — không có nút Lưu chung cho cả 4 mục, đổi 1 mục không ảnh hưởng 3 mục còn lại.' },
    ],
    footer: { left: [
      { label: 'Không phải 1 nhóm quyền', text: '4 mục này KHÔNG liên quan tới nhau về mặt dữ liệu (mỗi mục 1 bảng AppData riêng) — gom chung 1 tab chỉ vì cùng thuộc phạm trù "cấu hình quy trình/duyệt nâng cao", giúp dễ tìm hơn so với trước.' },
    ], right: [
      { label: 'Đã dời khỏi Phân Quyền', text: '"Nhóm Phê Duyệt Trình/HĐ" (khối 11/14 cũ) và "Nhóm Quyền Đặc Biệt" (khối 17 cũ) không còn nằm trong cây quyền của form Sửa Người Dùng nữa — mở nhanh hơn, không cần mở form sửa 1 tài khoản bất kỳ chỉ để đụng tới cấu hình chung.' },
    ] },
  },
  sysCatalog: {
    icon: '🗂️', title: 'Quản Lý Danh Mục', badge: 'Chỉ Quản Trị Viên',
    desc: 'Nơi tập trung mọi danh mục dùng chung toàn hệ thống (Phòng Ban, Chức Danh, Siêu Thị, Loại Hợp Đồng, Loại Xe, Vùng Giá Áp Dụng, Phòng Họp...) — sửa 1 danh mục ở đây áp dụng ngay cho MỌI form có dùng tới, không cần sửa từng nơi.',
    flow: { ariaLabel: 'Quy trình thêm/sửa 1 danh mục', chain: [
      { label: 'Chọn đúng danh mục', sub: 'VD Phòng Ban, Chức Danh...' },
      { label: 'Thêm / Sửa / Xoá', sub: 'Xoá bị chặn nếu đang được dùng', kind: 'decision' },
      { label: 'Áp dụng ngay', sub: 'Mọi form liên quan cập nhật', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Không ai đang dùng', rejectLabel: 'Đang có dữ liệu tham chiếu', rejectBox: { label: 'Chặn xoá', sub: 'Báo rõ đang dùng ở đâu' }, loopBackToIndex: 1, loopBackLabel: 'Xử lý dữ liệu tham chiếu trước' } },
    steps: [
      { role: 'Quản trị viên', text: 'vào <b>Hệ Thống → ⚙️ Quản Trị → 🗂️ Quản Lý Danh Mục</b> (tab con, cùng hàng với Cấu Hình Email/Phân Quyền) → tìm đúng khối danh mục cần sửa (Phòng Ban/Siêu Thị/Chức Danh/Loại Hợp Đồng...).' },
      { role: 'Quản trị viên', text: 'bấm <b>"+ Thêm"</b> để tạo mới, hoặc <b>"✏️ Sửa"</b>/<b>"🗑️ Xoá"</b> ngay tại dòng danh mục đã có.' },
      { role: 'Quản trị viên', text: 'nếu xoá 1 giá trị ĐANG được dùng ở hồ sơ/form khác, hệ thống chặn lại và báo rõ lý do — phải xử lý xong dữ liệu đang tham chiếu (đổi sang giá trị khác) trước khi xoá được.' },
      { role: 'Quản trị viên', text: 'cấu hình <b>"📲 Phím Tắt PWA (Android/Chrome)"</b> (cùng màn Quản Lý Danh Mục): tick tối đa 4 module hiện ra khi người dùng nhấn giữ icon ứng dụng đã cài trên màn hình chính Android/Chrome → bấm <b>"💾 Lưu Phím Tắt PWA"</b> — bấm thẳng vào đúng module đó thay vì phải mở app rồi tự điều hướng. KHÔNG hỗ trợ iPhone/iPad (Apple chưa cho phép trình duyệt làm việc này).' },
      { role: 'Quản trị viên', text: 'quản lý <b>"🧭 Quản Lý Vị Trí Làm Việc"</b> (10/2026, cùng màn): danh mục MỞ thay cho 2 giá trị cứng HO/Siêu Thị trước đây — bấm <b>"Thêm"</b> để tạo 1 Vị Trí Làm Việc mới (VD "Kho"), mỗi Vị Trí mang theo 1 cặp danh mục con RIÊNG (📍 Địa Điểm + 🎖️ Chức Danh, giống hệt khuôn Siêu Thị). 2 mục HO/Siêu Thị luôn có sẵn (chỉ đổi được tên hiển thị, không xoá/đổi định danh) — quản lý địa điểm/chức danh của 2 mục này vẫn ở đúng 2 khối Phòng Ban/Siêu Thị/Chức Danh phía trên, không phải ở đây.' },
    ],
    footer: { left: [
      { label: 'Dùng chung TOÀN HỆ THỐNG', text: 'không có khái niệm danh mục "riêng cho 1 module" — Phòng Ban ở đây là ĐÚNG Phòng Ban hiện trên mọi form/báo cáo khác, sửa 1 chỗ đủ.' },
      { label: 'Vị Trí Làm Việc — phạm vi hiện tại', text: 'Vị Trí Làm Việc TỰ THÊM (khác HO/Siêu Thị) hiện áp dụng cho form Người Dùng/Import Excel/cascading Phòng Ban-Chức Danh/Vị Trí Kiêm Nhiệm. Các tính năng nghiệp vụ khác đang CHỈ hiểu HO/Siêu Thị (Checklist tự đánh giá Siêu Thị, mô hình ca kíp Công&Phép/Lương, validate bắt buộc ở HR Onboarding, bộ duyệt hỗn hợp Vận Hành-Đặt Hàng, Cơ Cấu Tổ Chức) TẠM giữ nguyên hành vi cũ — nhân sự gán 1 Vị Trí Làm Việc mới sẽ KHÔNG tự động có các tính năng đó.' },
    ], right: [
      { label: 'Tự học danh mục con', text: 'một số danh mục nhỏ (VD Loại Dịch Vụ CNTT, Chủ Đề HCRC Đồng Hành) KHÔNG có màn quản lý riêng — tự "học" thêm giá trị mới ngay khi có người gõ giá trị mới lúc tạo hồ sơ, không cần vào Quản Lý Danh Mục trước.' },
      { label: 'Phím Tắt PWA tối đa 4 module', text: 'hầu hết launcher Android chỉ hiện được tối đa 4 phím tắt dù khai nhiều hơn — chọn quá 4 sẽ bị cắt bớt (kể cả khi ai đó ghi thẳng qua API). Không liên quan tới danh mục dùng chung ở trên — đây là cấu hình RIÊNG cho trải nghiệm cài đặt PWA.' },
      { label: 'Xoá 1 Vị Trí Làm Việc bị chặn nếu còn tài khoản đang dùng', text: 'khác các danh mục phẳng khác (chỉ CẢNH BÁO trước khi xoá) — xoá hẳn 1 Vị Trí kéo theo mất luôn nhánh Địa Điểm/Chức Danh con của nó nên bị CHẶN CỨNG (server từ chối) nếu đang có ít nhất 1 tài khoản gán Vị Trí đó, phải đổi Vị Trí của họ trước.' },
    ] },
  },
  sysFormBuilder: {
    icon: '📋', title: 'Biểu Mẫu', badge: 'Chỉ Quản Trị Viên',
    desc: 'Tuỳ biến field của gần như mọi form tạo hồ sơ trong hệ thống MÀ KHÔNG CẦN sửa code — đổi nhãn hiển thị, đổi field nào bắt buộc, sửa danh sách lựa chọn (dropdown), và thêm hẳn field mới. Bao phủ 26 nhóm module (đếm theo `FORM_GROUPS`, `core.js` — số này tăng dần mỗi khi có module mới, tự kiểm tra lại số thật trên màn nếu cần con số chính xác tuyệt đối).',
    flow: { ariaLabel: 'Quy trình tuỳ biến 1 form', chain: [
      { label: 'Chọn module + form', sub: 'VD Văn Bản Trình, Hợp Đồng...' },
      { label: 'Sửa field / Thêm field mới', sub: 'Nhãn, bắt buộc, dropdown' },
      { label: 'Lưu', sub: 'Áp dụng cho hồ sơ tạo TIẾP THEO', kind: 'approved' },
    ] },
    steps: [
      { role: 'Quản trị viên', text: 'vào <b>Hệ Thống → 📋 Biểu Mẫu</b> → chọn đúng nhóm module ở hàng nút bên phải tiêu đề; nhóm nào có nhiều form thật thì hiện thêm 1 hàng nút cấp 2 để chọn đúng form (tên form đang sửa hiện màu hồng ngay trên form nhập).' },
      { role: 'Quản trị viên', text: 'với field có sẵn: ở bảng "Cấu Trúc Tất Cả Các Trường Đang Áp Dụng" bấm <b>"Sửa"</b> ngay dòng field đó để đổi <b>Nhãn hiển thị</b>, tick/bỏ <b>Bắt buộc nhập</b>, sửa <b>danh sách lựa chọn</b> (với vài field kiểu dropdown) — field mặc định không xoá được, chỉ field bổ sung mới sửa/xoá/sắp xếp tự do.' },
      { role: 'Quản trị viên', text: 'thêm field mới: form <b>"➕ Thêm Trường Dữ Liệu Bổ Sung Cho: ..."</b> luôn hiện sẵn ở đầu màn (KHÔNG có nút "+ Thêm Field" phải bấm trước) → điền Tên Trường (Label), chọn Kiểu Dữ Liệu (Text/Number/Date/DateTime/Dropdown/Multi-select/Textarea/File/Multi-file), điền "CÁC TÙY CHỌN" nếu là dropdown, tick "Bắt buộc nhập" nếu cần → bấm <b>"Thêm Trường Vào Biểu Mẫu"</b>.' },
      { role: 'Quản trị viên', text: 'field mới hiện ngay dưới các field mặc định của đúng form đó, áp dụng từ lượt TẠO hồ sơ tiếp theo — KHÔNG ảnh hưởng hồ sơ đã tạo trước đó. Đang sửa dở 1 field mà muốn thoát: bấm <b>"Hủy Sửa"</b>.' },
    ],
    footer: { left: [
      { label: 'Khác Quản Lý Danh Mục', text: 'đây là tuỳ biến RIÊNG của từng form (field/nhãn/bắt buộc); Quản Lý Danh Mục là danh mục LÕI dùng chéo nhiều module (Phòng Ban, Chức Danh...) — 2 màn có vai trò khác nhau.' },
    ], right: [
      { label: 'Ngoại lệ 3 form đặc biệt', text: 'Ngân Hàng Câu Hỏi Đào Tạo/Checklist Đánh Giá Siêu Thị/Career Path chỉ tuỳ biến được field CẤP MẪU (VD Mã/Tên/Loại) — phần câu hỏi/hạng mục tự thêm-bớt BÊN TRONG mỗi mẫu KHÔNG tuỳ biến được ở đây.' },
    ] },
  },
  sysFiles: {
    icon: '📁', title: 'Quản Lý Tệp File', badge: 'Chỉ Quản Trị Viên',
    desc: 'Cấu hình loại tệp được phép upload và giới hạn dung lượng tối đa (MB) riêng cho TỪNG module có đính kèm file.',
    flow: { ariaLabel: 'Quy trình cấu hình tệp cho 1 module', chain: [
      { label: 'Chọn module', sub: 'VD Tài Liệu, Hợp Đồng...' },
      { label: 'Cấu hình loại tệp + dung lượng', sub: 'Chỉ được SIẾT chặt hơn mức chung', kind: 'decision' },
      { label: 'Lưu', sub: 'Áp dụng cho lượt tải lên tiếp theo', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Trong giới hạn chung', rejectLabel: 'Vượt UPLOAD_MAX_MB', rejectBox: { label: 'Chặn lưu', sub: 'Không vượt được mức chung .env' }, loopBackToIndex: 1, loopBackLabel: 'Giảm lại mức MB' } },
    steps: [
      { role: 'Quản trị viên', text: 'vào <b>Hệ Thống → 📎 Quản Lý Tệp File</b> → chọn đúng module trong 23 mục (rà soát chuyên sâu 9/2026 bổ sung 11 mục trước đây thiếu): 📂 Tài Liệu/📜 Văn Bản Trình/📄 Hợp Đồng/🚗 Đăng Ký Xe/🏢 Phòng Họp/📝 Biên Bản Họp/🛒 Văn Phòng Tổng Hợp/📣 Truyền Thông Nội Bộ/💳 Thanh Toán/📁 Danh Mục Đầu Tư/📄 Hợp Đồng Lao Động/🔄 Gia Hạn Dịch Vụ CNTT/📜 Giấy Phép — dùng chung .pdf/.docx/.xlsx; 📦 Đơn Hàng/📅 Báo Cáo Định Kỳ chỉ nhận .pdf; 🧪 Ngân Hàng Câu Hỏi/📣 Ảnh-Banner/✅ Checklist Đánh Giá Siêu Thị chỉ nhận ẢNH; 👤 Hồ Sơ Nhân Sự/🔧 Sửa Chữa nhận cả văn bản lẫn ảnh; 🚀 Onboarding/Offboarding và 💲 Phê Duyệt Giá IT chưa từng giới hạn nên hiện đủ 12 định dạng chung; 🏬 Mở Mới dùng mặc định văn bản.' },
      { role: 'Quản trị viên', text: 'sửa danh sách <b>loại tệp được phép</b> (chỉ tick trong đúng tập định dạng module đó đang thật sự cho chọn) và <b>Giới Hạn Dung Lượng Tối Đa (MB)</b> riêng cho module đó.' },
      { role: 'Quản trị viên', text: 'bấm <b>"Lưu"</b> — mức riêng chỉ được SIẾT chặt hơn, không vượt quá giới hạn chung toàn hệ thống (`UPLOAD_MAX_MB`, cấu hình ở `.env`, mặc định 20MB).' },
    ],
    footer: { left: [
      { label: 'Chỉ siết, không nới', text: 'dù đặt dung lượng riêng cao hơn `UPLOAD_MAX_MB` ở đây, server vẫn chặn ở đúng mức chung — mức riêng chỉ có tác dụng SIẾT chặt hơn.' },
    ], right: [
      { label: 'Mục ảnh là ngoại lệ', text: '🧪 Ngân Hàng Câu Hỏi, 📣 Truyền Thông Nội Bộ (Ảnh/Banner) và ✅ Checklist Đánh Giá Siêu Thị (Ảnh Minh Chứng) chỉ nhận định dạng ảnh (.jpg/.jpeg/.png/.webp), tách biệt hoàn toàn khỏi các khoá văn bản (.pdf/.docx/.xlsx) — đổi loại tệp của 1 khoá không ảnh hưởng khoá kia.' },
    ] },
  },
  sysTrash: {
    icon: '🗑️', title: 'Thùng Rác', badge: 'Chỉ Quản Trị Viên',
    desc: 'Gom hồ sơ đã xoá từ 37 loại hồ sơ khác nhau (đếm theo `TRASH_COLLECTION_LABELS`, `module-logsystem-trash.js` — số này tăng dần mỗi khi có module mới hỗ trợ xoá mềm) về 1 nơi để khôi phục nếu xoá nhầm, hoặc xoá vĩnh viễn khi chắc chắn không cần nữa.',
    flow: { ariaLabel: 'Quy trình xử lý hồ sơ trong Thùng Rác', chain: [
      { label: 'Hồ sơ bị xoá', sub: 'Từ bất kỳ module nào' },
      { label: 'Khôi phục hay xoá hẳn?', sub: '', kind: 'decision' },
      { label: 'Về lại module gốc', sub: 'Nguyên vẹn như trước khi xoá', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Khôi phục', rejectLabel: 'Xoá vĩnh viễn', rejectBox: { label: 'Xác thực lại', sub: 'Mật khẩu/OTP/vân tay rồi mới xoá hẳn' }, loopBackToIndex: 1, loopBackLabel: 'Không thể hoàn tác sau bước này' } },
    steps: [
      { role: 'Quản trị viên', text: 'vào Hệ Thống (bấm bất kỳ mục nào trong dropdown "🛠️ Hệ Thống ▾" trên sidebar — "🗑️ Thùng Rác" KHÔNG có trên dropdown này) → bấm nút <b>"🗑️ Thùng Rác"</b> ở THANH TAB TRÊN CÙNG bên trong màn Hệ Thống (dính khi cuộn) → lọc theo loại hồ sơ/phòng ban để tìm đúng hồ sơ cần xử lý.' },
      { role: 'Quản trị viên', text: 'khôi phục: bấm <b>"♻️ Khôi phục"</b> ngay dòng hồ sơ → xác nhận — hồ sơ trở lại nguyên vẹn ở đúng module gốc.' },
      { role: 'Quản trị viên', text: 'xoá vĩnh viễn: bấm <b>"🗑️ Xóa vĩnh viễn"</b> → hệ thống yêu cầu xác thực lại (mật khẩu/OTP/vân tay tuỳ mức cấu hình bảo mật của tài khoản đó) → xác nhận — KHÔNG khôi phục lại được sau bước này.' },
    ],
    footer: { left: [
      { label: 'Không tự dọn theo thời gian', text: 'hồ sơ nằm mãi trong Thùng Rác cho tới khi có người chủ động khôi phục hoặc xoá vĩnh viễn — không có cơ chế tự xoá sau X ngày.' },
    ], right: [
      { label: 'Gác quyền cả 2 lớp', text: 'CHỈ admin vào được, và được kiểm tra lại THẬT ở server (không chỉ ẩn nút giao diện) — gọi thẳng API cũng không xem/khôi phục được nếu không phải admin.' },
    ] },
  },
  sysLog: {
    icon: '📜', title: 'Nhật Ký Hệ Thống', badge: 'Chỉ Quản Trị Viên',
    desc: 'Ghi lại mọi thao tác quan trọng (đăng nhập, tạo/sửa/xoá/duyệt hồ sơ...) kèm người thực hiện, thời gian, module, kết quả — chỉ admin xem được, không giới hạn theo phòng ban.',
    flow: { ariaLabel: 'Quy trình tra cứu Nhật Ký Hệ Thống', chain: [
      { label: 'Thao tác xảy ra', sub: 'Ở bất kỳ module nào' },
      { label: 'Tự ghi 1 dòng log', sub: 'Người/thời gian/kết quả' },
      { label: 'Tra cứu qua bộ lọc', sub: 'Tối đa 1.000 dòng/lượt tải', kind: 'approved' },
    ] },
    steps: [
      { role: 'Quản trị viên', text: 'vào <b>Hệ Thống → 📊 Log</b>.' },
      { role: 'Quản trị viên', text: 'lọc theo <b>Phân Hệ</b> (module), <b>Sự Kiện</b> (loại thao tác), <b>Trạng thái</b>, hoặc gõ từ khoá vào ô tìm nhanh (khớp tên đăng nhập/địa chỉ IP/loại thao tác/mô tả).' },
      { role: 'Quản trị viên', text: 'mỗi lượt tải chỉ trả tối đa 1.000 dòng — thu hẹp bằng bộ lọc thay vì cố tải hết nếu cần tra dữ liệu cũ hơn.' },
      { role: 'Quản trị viên', text: 'muốn tải toàn bộ log ra ngoài để lưu trữ/đối chiếu: bấm <b>"📥 Xuất Log Excel"</b> (góc trên khung Log) — xuất theo đúng bộ lọc đang áp dụng.' },
      { role: 'Quản trị viên', text: 'muốn dọn sạch nhật ký: bấm <b>"🗑️ Xóa Log"</b> (cạnh nút Xuất Excel) → xác nhận — xoá NGAY TOÀN BỘ nhật ký hệ thống, chỉ 1 hộp thoại xác nhận, KHÔNG có bước xác thực lại nào khác. Nên bấm "Xuất Log Excel" lưu lại trước nếu còn cần tra cứu sau này.' },
    ],
    footer: { left: [
      { label: '🗑️ Xóa Log — phá huỷ, không hoàn tác', text: 'xoá TOÀN BỘ nhật ký hệ thống (`DELETE /api/log`) ngay khi xác nhận — không đưa vào Thùng Rác, không có cách nào khôi phục lại sau khi xoá. Luôn có nút "🗑️ Xóa Log" thật trên màn — mục "Tự dọn sau 5.000 dòng" ngay dưới đây chỉ nói về cơ chế tự động, KHÔNG có nghĩa là màn này không có nút xoá tay.' },
      { label: 'Tự dọn sau 5.000 dòng', text: 'hệ thống chỉ giữ lại 5.000 dòng gần nhất — nhật ký cũ hơn tự bị dọn dần, không cần admin tự xoá tay; muốn xoá sạch NGAY LẬP TỨC (không đợi tự dọn dần) thì dùng nút "🗑️ Xóa Log" ở trên.' },
    ], right: [
      { label: 'Xem TOÀN công ty', text: 'admin xem được nhật ký của mọi phòng ban, không chỉ giới hạn trong phòng ban của tài khoản admin đó.' },
    ] },
  },
  sysEmail: {
    icon: '📧', title: 'Cấu Hình Email', badge: 'Chỉ Quản Trị Viên',
    desc: 'Cấu hình SMTP toàn bộ trên web (Host/Port/Kiểu mã hoá/Email người gửi/Tài khoản đăng nhập), không cần sửa `.env` hay khởi động lại server. Việc bật/tắt riêng từng loại email thông báo phê duyệt theo từng module nằm ở TAB CON RIÊNG "🔔 Thông Báo Email Phê Duyệt" ngay cạnh (cùng trong ⚙️ Quản Trị), không phải trong màn SMTP này.',
    flow: { ariaLabel: 'Quy trình cấu hình SMTP', chain: [
      { label: 'Nhập cấu hình SMTP', sub: 'Host/Port/Kiểu mã hoá' },
      { label: 'Gửi Thử', sub: 'Xác minh trước khi lưu', kind: 'decision' },
      { label: 'Lưu', sub: 'Có hiệu lực ngay, không restart', kind: 'approved' },
    ], decision: { atIndex: 1, approveLabel: 'Gửi thử thành công', rejectLabel: 'Gửi thử lỗi', rejectBox: { label: 'Sửa lại cấu hình', sub: 'Kiểm tra Host/Port/tài khoản' }, loopBackToIndex: 0, loopBackLabel: 'Nhập lại thông số' } },
    steps: [
      { role: 'Quản trị viên', text: 'vào <b>Hệ Thống → ⚙️ Quản Trị → 📧 Cấu Hình Email</b> (tab con) → điền Host/Port/Email người gửi/Tài khoản đăng nhập SMTP.' },
      { role: 'Quản trị viên', text: 'bấm 1 trong 3 nút chọn nhanh kiểu mã hoá (<b>Không mã hoá/TLS/SSL</b>) — Port tự đổi sang giá trị chuẩn tương ứng (25/587/465).' },
      { role: 'Quản trị viên', text: 'bấm <b>"Gửi Thử"</b> để xác minh cấu hình đúng trước khi lưu chính thức.' },
      { role: 'Quản trị viên', text: 'bấm <b>"Lưu"</b> — có hiệu lực ngay, không cần khởi động lại server.' },
      { role: 'Quản trị viên', text: 'muốn giảm email trùng lặp: <b>chuyển sang tab "🔔 Thông Báo Email Phê Duyệt"</b> (tab con RIÊNG ngay cạnh "📧 Cấu Hình Email", KHÔNG phải 1 khối kéo xuống bên trong màn này) → trong bảng "Phân Hệ", tick/bỏ tick từng module ở cột <b>"Cần Phê Duyệt"</b> (email gửi người duyệt) hoặc <b>"Kết Quả Duyệt"</b> (email gửi người trình) → bấm <b>"Lưu Cấu Hình"</b>.' },
      { role: 'Quản trị viên', text: 'các sự kiện email không thuộc 2 nhóm trên (VD Văn Bản Trình xin ý kiến, Hỗ Trợ IT huỷ khẩn cấp/ticket) nằm ở khối <b>"🧩 Sự Kiện Đặc Thù Riêng Từng Phân Hệ"</b> cuối chính tab đó — mặc định giữ nguyên hành vi cũ (BẬT).' },
    ],
    footer: { left: [
      { label: 'Mặc định chỉ mô phỏng', text: 'chưa nhập SMTP Server ở màn này thì hệ thống chỉ MÔ PHỎNG gửi email (ghi Nhật Ký Hệ Thống, không gửi thật).' },
      { label: '2 tab riêng, đừng tìm nhầm chỗ', text: '"📧 Cấu Hình Email" (máy chủ SMTP) và "🔔 Thông Báo Email Phê Duyệt" (bật/tắt từng loại email theo phân hệ) là 2 TAB CON tách biệt trong "⚙️ Quản Trị", mỗi tab có nút Lưu riêng — lưu tab này không đụng gì tới tab kia.' },
    ], right: [
      { label: 'Fail-open khi chưa cấu hình', text: 'nếu admin chưa từng lưu tab "Thông Báo Email Phê Duyệt", email vẫn gửi như hành vi gốc — chỉ khi admin chủ động lưu giá trị TẮT thì email đó mới thực sự bị chặn. Riêng nhóm "Cần Phê Duyệt" mặc định TẮT (đã có Hub Phê Duyệt nên email này thường trùng lặp), nhóm "Kết Quả Duyệt" mặc định BẬT.' },
      { label: 'Tắt email KHÔNG mất dấu vết', text: 'tắt 1 ô chỉ chặn email thật đi ra — Nhật Ký Hệ Thống vẫn ghi đầy đủ sự kiện như cũ.' },
    ] },
  },
  sysExtAuth: {
    icon: '🔑', title: 'API Xác Thực Ngoài', badge: 'Chỉ Quản Trị Viên',
    desc: 'Cấp/thu hồi API key cho phép 1 ứng dụng NGOÀI hệ thống xác thực tài khoản HCRC Workspace hoặc đồng bộ danh bạ nhân sự cơ bản, mà không cần tự lưu mật khẩu người dùng.',
    flow: { ariaLabel: 'Vòng đời 1 API key', chain: [
      { label: 'Tạo API Key', sub: 'Sinh chuỗi hcrc_ + 64 ký tự hex' },
      { label: 'Giao Cho Bên Tích Hợp', sub: 'Copy ngay, chỉ hiện đúng 1 lần' },
      { label: 'Đang Hoạt Động', sub: 'Bên ngoài gọi API xác thực', kind: 'approved' },
    ] },
    steps: [
      { role: 'Quản trị viên', text: 'vào <b>Hệ Thống → ⚙️ Quản Trị → 🔑 API Xác Thực Ngoài</b> (tab con) → điền <b>"Tên / Mô tả ứng dụng dùng key này"</b>, tuỳ chọn khai thêm ô <b>"IP cho phép (lớp bảo mật thứ 2 — để trống = mọi IP)"</b> (nhiều IP/dải CIDR cách nhau bằng dấu phẩy hoặc xuống dòng) → bấm <b>"➕ Tạo API Key"</b>.' },
      { role: 'Quản trị viên', text: 'copy ngay chuỗi key hiện ra (nút <b>"📋 Sao chép"</b>) — hệ thống CHỈ hiển thị đúng 1 lần lúc tạo, DB chỉ lưu bcrypt hash nên không đọc lại được key thật về sau kể cả có toàn quyền truy cập DB.' },
      { role: 'Quản trị viên', text: 'giao key cho bên tích hợp dùng gọi <code>POST /api/external/verify-credentials</code> (xác thực tài khoản/mật khẩu, không cấp phiên đăng nhập) hoặc <code>GET /api/external/users</code> (đồng bộ danh bạ, không bao giờ kèm mật khẩu/PIN).' },
      { role: 'Quản trị viên', text: 'cần xoay vòng bí mật: bấm <b>"🔄 Tạo lại key"</b> ở cột Hành động — key cũ ngừng hoạt động NGAY, key mới hiện ra thay thế (giữ nguyên lịch sử/IP cho phép đã cấu hình), phải cập nhật lại ngay cho bên tích hợp. Đổi riêng danh sách IP thì bấm <b>"Sửa IP"</b> ngay cạnh, không cần tạo lại key.' },
      { role: 'Quản trị viên', text: 'không dùng nữa: bấm <b>"Thu hồi"</b> (dừng vĩnh viễn, không kích hoạt lại được) — chỉ SAU KHI đã thu hồi mới bấm được <b>"🗑️ Xóa"</b> để dọn khỏi danh sách hiển thị (Nhật Ký Hệ Thống vẫn giữ nguyên dấu vết).' },
    ],
    footer: { left: [
      { label: 'Chặn theo IP tuỳ chọn', text: 'nếu đã khai báo allowedIps, request gọi từ IP ngoài danh sách bị chặn (403) dù key đúng — để trống thì key đúng gọi từ đâu cũng được.' },
    ], right: [
      { label: '2 API tách biệt vai trò', text: '`verify-credentials` KHÔNG cấp phiên đăng nhập, chỉ trả lời đúng/sai; `GET /api/external/users` chỉ trả field công khai (username/tên/điện thoại/phòng ban/chức danh), không bao giờ kèm mật khẩu/PIN dù đã hash.' },
    ] },
  },
  // sysOpApi (10/2026, đợt rà soát đối chiếu tài liệu với UI thật): màn admin "🔌 Cấu Hình API — Đồng Bộ
  // Đơn Hàng Ra dsmart16" (#adminSubOpApi, jobs/operationOrderApiSync.js) trước đây thiếu hẳn entry dù đã
  // là 1 tab con thật trong ⚙️ Quản Trị. TÁCH BIỆT HOÀN TOÀN với "🔑 API Xác Thực Ngoài" (mục ngay trên):
  // cái kia cho ứng dụng ngoài gọi VÀO hệ thống, cái này hệ thống tự đẩy dữ liệu RA ngoài.
  sysOpApi: {
    icon: '🔌', title: 'Cấu Hình API — Đồng Bộ Đơn Hàng Ra dsmart16', badge: 'Chỉ Quản Trị Viên',
    desc: 'Cấu hình để hệ thống TỰ ĐỘNG đẩy Đơn Hàng (Vận Hành → Đơn Hàng) sang hệ thống ngoài "dsmart16" theo chu kỳ — khai Base URL nhận đơn, 1 header xác thực tuỳ chỉnh (tên + giá trị, không cố định Bearer/Basic vì mỗi hệ thống ngoài yêu cầu tên header khác nhau), chu kỳ quét (phút) và Mã Khoá Đối Chiếu (mặc định `poNumber` — trường dùng để 2 hệ thống nhận ra cùng 1 đơn). Chỉ đơn ĐÃ CÓ Số Đơn NCC (poNumber) mới được gửi.',
    flow: { ariaLabel: 'Quy trình cấu hình đồng bộ Đơn Hàng ra dsmart16', chain: [
      { label: 'Khai Base URL + header', sub: 'Giá trị header là write-only' },
      { label: 'Bật đồng bộ + chu kỳ', sub: 'Tối thiểu 5 phút, mặc định 60' },
      { label: 'Job quét định kỳ', sub: 'Chỉ đơn có poNumber, nội dung đã đổi', kind: 'decision' },
      { label: 'dsmart16 nhận đơn', sub: 'Ghi lại kết quả lần đồng bộ gần nhất', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Gửi thành công', rejectLabel: 'Lỗi / URL không an toàn', rejectBox: { label: 'Báo lỗi tại màn này', sub: 'Đơn khác vẫn gửi tiếp bình thường' }, loopBackToIndex: 0, loopBackLabel: 'Sửa lại cấu hình' } },
    steps: [
      { role: 'Quản trị viên', text: 'vào <b>Hệ Thống → ⚙️ Quản Trị → 🔌 Cấu Hình API</b> (tab con cuối cùng trên hàng tab của Quản Trị).' },
      { role: 'Quản trị viên', text: 'điền hàng trên: <b>Trạng thái đồng bộ</b> (Bật/Tắt), <b>Base URL (endpoint nhận đơn hàng)</b> của dsmart16, <b>Chu kỳ tự động (phút)</b> (tối thiểu 5, để trống = 60).' },
      { role: 'Quản trị viên', text: 'điền hàng dưới: <b>Tên Header Xác Thực</b> (VD "X-Api-Key" hoặc "Authorization" — theo yêu cầu của dsmart16), <b>Giá Trị Header</b> (write-only: nhập 1 lần, sau đó ô luôn trống — để trống khi sửa = GIỮ NGUYÊN giá trị đã lưu), <b>Mã Khoá Đối Chiếu (matchingKey)</b> (mặc định `poNumber`).' },
      { role: 'Quản trị viên', text: 'bấm <b>"Lưu Cấu Hình API"</b> — dòng trạng thái ngay dưới form cho biết đã có giá trị header xác thực hay chưa ("✅ Đã cấu hình..." / "⚠️ Chưa cấu hình giá trị header xác thực.").' },
      { role: 'Quản trị viên', text: 'không muốn chờ tới chu kỳ kế tiếp: bấm <b>"🔄 Đồng Bộ Ngay"</b> — kết quả hiện ngay ở dòng cuối màn ("✅/⚠️/⛔ Lần đồng bộ gần nhất: [thời điểm] — [thông báo]"), cùng 1 hàm xử lý với job tự động nên không có khác biệt hành vi.' },
    ],
    footer: { left: [
      { label: 'Chỉ đẩy RA, không kéo VÀO', text: 'đây là luồng 1 chiều: hệ thống gửi Đơn Hàng ra dsmart16, KHÔNG nhận dữ liệu ngược lại. Đừng nhầm với "DSmart API" của module Mua Hàng (BAS) — luồng đó ngược lại (chỉ KÉO dữ liệu Chiết Khấu/Thưởng NCC vào) và cấu hình bằng biến môi trường `.env`, không phải màn này.' },
      { label: 'Phạm vi đơn được gửi', text: 'chỉ đơn ĐÃ có "Số Đơn NCC" (poNumber) — thiếu mã này thì không có gì để 2 hệ thống đối chiếu nên bị bỏ qua. Đơn đã gửi thành công sẽ được gửi LẠI khi nội dung thay đổi (đổi trạng thái/ngày duyệt/ngày nhận/số tiền...); nội dung y hệt lần trước thì bỏ qua, không gửi thừa.' },
    ], right: [
      { label: 'Chặn SSRF cho Base URL', text: 'Base URL do admin tự nhập được kiểm tra trước mỗi lần gọi: chỉ cho http/https, chặn mọi địa chỉ nội bộ/loopback/link-local (kể cả tên miền trỏ ngược về IP nội bộ sau khi phân giải DNS) và có timeout 15 giây — 1 endpoint treo không làm kẹt cả job đồng bộ.' },
      { label: 'Lỗi 1 đơn không chặn các đơn còn lại', text: 'job cô lập lỗi theo TỪNG đơn — 1 đơn gửi lỗi vẫn ghi nhận rồi đi tiếp, kết quả tổng kết ghi rõ SUCCESS/PARTIAL/FAILED ở dòng "Lần đồng bộ gần nhất" và trong Nhật Ký Hệ Thống.' },
      { label: 'Giá trị header mã hoá khi lưu', text: 'giá trị header xác thực được mã hoá trong cơ sở dữ liệu và KHÔNG bao giờ trả ngược về giao diện (cùng quy ước write-only với mật khẩu SMTP ở Cấu Hình Email) — mất thì nhập lại giá trị mới, không xem lại được.' },
    ] },
  },
  systemArchitecture: {
    icon: '🗺️', title: 'Sơ Đồ Kiến Trúc Hệ Thống', badge: 'Chỉ Quản Trị Viên',
    isCustomFlow: true, customFlowRenderer: 'renderNVSystemArchitectureOverview', diagramTitle: 'Sơ đồ kiến trúc & liên kết ngoài',
    desc: 'Toàn cảnh kiến trúc ứng dụng — Trình duyệt (SPA, thuần HTML/JS, không có app di động riêng) gọi API tới 1 Server Node.js/Express duy nhất (chạy PM2 cluster mode), server đọc/ghi toàn bộ dữ liệu ở SQL Server + lưu file đính kèm trên ổ đĩa cục bộ, cùng 2 điểm tích hợp hệ thống ngoài đang có thật.',
    footer: { left: [
      { label: 'Không SSO/LDAP', text: 'xác thực hoàn toàn nội bộ qua JWT (lib/auth.js) — không đồng bộ tài khoản với Active Directory hay hệ thống đăng nhập nào khác.' },
      { label: 'Hạ tầng lõi', text: 'Server Node.js/Express (PM2 cluster mode nhiều tiến trình) + SQL Server (toàn bộ dữ liệu, kể cả cấu hình quy trình duyệt) + ổ đĩa cục bộ (thư mục uploads/ cho file đính kèm) — không dùng dịch vụ lưu trữ đám mây nào.' },
    ], right: [
      { label: '2 điểm tích hợp DSmart TÁCH BIỆT', text: 'DSmart API (module Mua Hàng, BAS) chỉ KÉO dữ liệu Chiết Khấu/Thưởng NCC vào, cấu hình qua .env (DSMART_API_BASE_URL/DSMART_API_KEY); dsmart16 (module Vận Hành) chỉ ĐẨY dữ liệu Đơn Hàng đã tạo ra ngoài, cấu hình qua màn Admin (Base URL + header xác thực tuỳ chỉnh, mã hoá khi lưu) — 2 luồng độc lập hoàn toàn, không dùng chung cấu hình dù cùng nhắc tới tên "DSmart".' },
      { label: 'An toàn khi gọi ra ngoài', text: 'Base URL do admin tự nhập cho dsmart16 được kiểm tra chống SSRF (assertSafeExternalUrl) trước mỗi lần gọi; mật khẩu SMTP và header xác thực dsmart16 đều mã hoá khi lưu trong DB, không hiện lại giá trị thật sau khi đã lưu.' },
    ] },
  },
};

// Đào Tạo — module lớn, tách 6 khu vực con (pill sub-nav) thay vì 1 luồng đơn — sống trong module
// "Truyền Thông Nội Bộ" (internal) chứ KHÔNG phải 1 entry riêng của BUSINESS_MODULES.
const NGHIEP_VU_DAOTAO_AREAS = [
  { key: 'overview', label: 'Tổng Quan', icon: '🧭' },
  // "dashboard" bám ĐÚNG tab thật đầu tiên trên thanh LMS ("📊 Dashboard", fragments/internalSection.html)
  // — trước đây thiếu hẳn pill cho tab này dù UI đã có (10/2026, đợt rà soát lần 2).
  { key: 'dashboard', label: 'Dashboard', icon: '📊' },
  { key: 'classes', label: 'Lớp Học', icon: '🏫' },
  // Icon pill bám ĐÚNG icon tab thật trên thanh LMS (10/2026, đợt rà soát lần 2): Chương Trình 📚→🎓,
  // Kế Hoạch Đào Tạo 🗓️→📋, Kho Tài Liệu 📦→📁, Ngân Hàng Câu Hỏi ❓→🧪. Icon trong "steps" bên trong
  // mỗi khu (VD nút thật) đã đúng từ trước — chỉ pill ở đây bị lệch.
  { key: 'programs', label: 'Chương Trình', icon: '🎓' },
  { key: 'plans', label: 'Kế Hoạch Đào Tạo', icon: '📋' },
  { key: 'docs', label: 'Kho Tài Liệu', icon: '📁' },
  { key: 'bank', label: 'Ngân Hàng Câu Hỏi', icon: '🧪' },
  // Nhãn pill bám ĐÚNG tên tab thật trong LMS Đào Tạo (fragments/internalSection.html) — tab đó tên
  // "🆕 Đào Tạo Tân Binh", trước đây tài liệu ghi "Lộ Trình Tân Binh" (tên khái niệm bên trong tab,
  // không phải tên nút) làm người đọc dò không ra nút nào trên UI.
  { key: 'newhire', label: 'Đào Tạo Tân Binh', icon: '🆕' },
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
  dashboard: {
    desc: 'Màn tổng quan số liệu Đào Tạo — 5 chỉ số nhanh (Tổng Số Lớp Học/Số Lượt Đăng Ký/Lớp Đang Học/Lớp Đã Kết Thúc/Người Đã Hoàn Thành) và bảng xếp hạng điểm bài test cao nhất, KHÔNG có thao tác tạo/sửa gì — chỉ để xem nhanh tình hình chung trước khi vào các khu vực chi tiết khác.',
    flow: { ariaLabel: 'Dashboard Đào Tạo', chain: [
      { label: 'Lớp Học / Đăng Ký / Bài Test', sub: 'Dữ liệu nguồn từ các khu vực khác' },
      { label: 'Tự tổng hợp', sub: 'Mỗi lần mở tab, không cần bấm nút' },
      { label: 'Xem 5 chỉ số + Top Điểm Cao', sub: 'Thuần xem, không sửa được ở đây', kind: 'approved' },
    ] },
    steps: [
      { text: 'vào tab <b>📊 Dashboard</b> (tab đầu tiên trên thanh LMS Đào Tạo) — số liệu tự tính lại mỗi lần mở tab, không cần bấm nút làm mới.' },
    ],
    footer: { left: [
      { label: '5 chỉ số nhanh', text: 'Tổng Số Lớp Học, Số Lượt Đăng Ký, Lớp Đang Học, Lớp Đã Kết Thúc, Người Đã Hoàn Thành — tính trên TOÀN BỘ lớp học người xem có quyền thấy, không lọc theo khoảng thời gian.' },
    ], right: [
      { label: '🏆 Top Điểm Cao Nhất', text: 'bảng xếp hạng học viên theo % điểm bài test (kèm tên bài test + lớp học), gộp chung mọi lớp — chưa có bài làm nào thì hiện "Chưa có bài làm test nào." thay vì bảng trống.' },
    ] },
  },
  classes: {
    desc: 'Lớp học gắn với 1 Chương Trình — học viên đăng ký hoặc được gán vào lớp, học theo tài liệu và làm bài kiểm tra; câu hỏi tự luận cần giảng viên chấm tay thay vì tự động. Huỷ đăng ký (từ học viên) phải qua Nhân Sự phụ trách đào tạo duyệt trước khi có hiệu lực, trừ Admin huỷ thì có hiệu lực ngay.',
    flow: { ariaLabel: 'Quy trình Lớp Học', chain: [
      { label: 'Mở lớp', sub: 'Chọn chương trình, thời gian' },
      { label: 'Học viên tham gia', sub: 'Đăng ký hoặc được gán' },
      { label: 'Làm bài kiểm tra', sub: 'Trắc nghiệm tự chấm', kind: 'decision' },
      { label: 'Hoàn thành lớp', sub: 'Đạt điểm yêu cầu', kind: 'approved' },
    ], decision: { atIndex: 2, approveLabel: 'Tự động', rejectLabel: 'Có câu tự luận', rejectBox: { label: 'Giảng viên chấm', sub: 'Chấm tay câu tự luận' }, loopBackToIndex: 2, loopBackLabel: 'Chấm xong → cộng điểm' } },
    steps: [
      { role: 'Quản lý đào tạo', text: 'vào tab <b>🏫 Lớp Học</b> → điền form "➕ Tạo Lớp Học Mới": Loại Đào Tạo, Tên Lớp Học, Chương Trình (tuỳ chọn — để trống nếu lớp không thuộc chương trình nào), Kiểu Lớp Học (Online/Offline), Thời Gian Bắt Đầu/Kết Thúc, Bài Test Gán Cho Lớp (tuỳ chọn, phải tạo sẵn ở tab Ngân Hàng Câu Hỏi), Giáo Trình Đọc Bắt Buộc (chọn từ Kho Tài Liệu, giữ Ctrl/Cmd để chọn nhiều) → bấm nút Tạo.' },
      { role: 'Quản lý đào tạo', text: 'muốn giới hạn ai được đăng ký: điền ô "Danh Sách Được Mời" ngay trên form tạo lớp (gõ tên/tài khoản từng người, hoặc tải mẫu Excel điền rồi upload lại) — để trống thì mọi người tự đăng ký được.' },
      { role: 'Học viên', text: 'vào tab <b>📝 Đăng Ký Của Tôi</b>, tìm đúng lớp cần học → bấm <b>"Đăng Ký"</b>.' },
      { role: 'Học viên', text: 'lớp Online có tài liệu bắt buộc: bấm <b>"📚 Vào Lớp Học"</b> → xem hết từng tài liệu bắt buộc (video/PDF) — xem đủ hệ thống tự hiện nút "📝 Vào Làm Bài Test". Lớp Offline thì phải chờ giảng viên/quản lý đào tạo bấm <b>"⏹️ Kết Thúc Lớp"</b> mới hiện nút làm bài test.' },
      { role: 'Học viên', text: 'bấm <b>"📝 Vào Làm Bài Test"</b> → trả lời từng câu → nộp bài → có kết quả/điểm ngay (riêng câu Nghị Luận thì chờ giảng viên chấm tay, điểm cuối chốt sau khi chấm xong).' },
      { role: 'Giảng viên', text: 'nếu bài test có câu Nghị Luận: vào tab Ngân Hàng Câu Hỏi, mục <b>"📝 Cần Chấm Nghị Luận"</b> → chấm điểm từng câu — chấm xong hệ thống tự cộng dồn và chốt Đạt/Không Đạt theo đúng Điểm Đạt Yêu Cầu TẠI THỜI ĐIỂM học viên nộp bài (từ 9/2026, không bị ảnh hưởng nếu quản lý đào tạo lỡ sửa Điểm Đạt của lớp trong lúc bài đang chờ chấm).' },
      { role: 'Quản lý đào tạo/Giảng viên', text: 'muốn DỪNG nhận đăng ký sớm (chưa tới hạn, chưa đủ sĩ số): bấm <b>"🔒 Đóng Đăng Ký"</b> ngay trên dòng lớp — học viên không tự đăng ký được nữa (Nhân Sự/giảng viên vẫn "➕ Thêm Học Viên" tay được), bấm <b>"🔓 Mở Lại Đăng Ký"</b> để mở lại.' },
      { role: 'Quản lý đào tạo/Giảng viên', text: 'muốn thêm học viên thủ công sau khi lớp đã mở: bấm <b>"➕ Thêm Học Viên"</b> ngay trên danh sách lớp — nếu lớp có gắn Chương Trình trùng với lớp trước đó, khối gợi ý màu vàng tự hiện học viên chưa hoàn thành để thêm nhanh, bấm từng người hoặc "+ Thêm tất cả" rồi "✅ Xác Nhận Thêm Vào Lớp".' },
      { role: 'Học viên', text: 'muốn huỷ đăng ký (chỉ khi đăng ký đang ở trạng thái "Đã đăng ký", chưa có kết quả): vào tab <b>📝 Đăng Ký Của Tôi</b> → bấm <b>"Huỷ Đăng Ký"</b> → nhập lý do (không bắt buộc) — nếu là Admin thì huỷ có hiệu lực NGAY; người thường thì chỉ tạo 1 yêu cầu huỷ đang chờ duyệt (chỉ gửi được 1 yêu cầu/lượt, gửi lần 2 khi lần trước còn treo sẽ bị chặn).' },
      { role: 'Nhân Sự phụ trách đào tạo/Admin', text: 'duyệt yêu cầu huỷ: vào tab <b>🏫 Lớp Học</b> → khối <b>"⏳ Yêu Cầu Huỷ Đăng Ký Đang Chờ Duyệt"</b> (đầu tab, hiện đủ mọi lớp) → bấm <b>"Duyệt Huỷ"</b> để đồng ý (chuyển đăng ký sang "Đã huỷ") — nút này CHỈ dành cho quyền quản lý đào tạo/Admin, giảng viên phụ trách lớp KHÔNG thấy/bấm được dù đang quản lý đúng lớp đó.' },
    ],
    footer: { left: [
      { label: 'Quét mã để vào bài', text: 'học viên quét mã QR để vào thẳng màn "Đăng Ký Của Tôi" và mở luôn bài làm, không cần dò tìm qua nhiều menu trên điện thoại.' },
      { label: 'Giảng Viên theo từng lớp', text: 'lớp Offline gán riêng 1 giảng viên — người này chỉ quản lý/chấm được đúng lớp mình được gán, khác người quản lý đào tạo chung (quản lý được mọi lớp).' },
      { label: 'Huỷ Đăng Ký → Duyệt Huỷ (9/2026)', text: 'học viên tự gửi KHÔNG còn huỷ có hiệu lực ngay — chỉ tạo 1 yêu cầu chờ Nhân Sự phụ trách đào tạo (quyền quản lý đào tạo) hoặc Admin duyệt mới thật sự chuyển sang "Đã huỷ" (tránh học viên tự ý bỏ lớp giữa chừng phá vỡ sĩ số/kế hoạch mà không ai hay biết). Admin tự huỷ (hộ ai đó hoặc của chính mình) vẫn có hiệu lực NGAY như trước. Người duyệt cũng có thể "Từ chối" để gỡ yêu cầu treo mà không huỷ đăng ký.' },
      { label: 'Duyệt Huỷ KHÔNG còn xoá mất kết quả đã thi (v23.68)', text: 'nếu học viên ĐÃ CÓ kết quả (Đạt/Không đạt) cho đúng lớp đó trước khi yêu cầu huỷ được xử lý (VD tự động chấm xong ngay sau khi gửi yêu cầu), nút "Duyệt Huỷ" bị CHẶN hẳn (báo lỗi rõ, gợi ý dùng "Từ chối" để gỡ yêu cầu treo thay vì huỷ) — trước đây duyệt huỷ trong tình huống này sẽ đè thẳng kết quả ĐẠT đã thi thành "Đã huỷ", kéo theo mất luôn điều kiện "Đạt" dùng để tính Lộ Trình Thăng Tiến/Tân Binh mà không có cách nào khôi phục lại.' },
    ], right: [
      { label: 'Nhập câu hỏi hàng loạt', text: 'có thể tải file mẫu để nhập nhiều câu hỏi cùng lúc thay vì tạo tay từng câu.' },
      { label: 'Gợi ý học viên chưa hoàn thành', text: 'khi mở "Thêm Học Viên" cho 1 lớp mới, hệ thống tự gợi ý những học viên KHÔNG ĐẠT (chưa từng đạt) ở các lớp khác CÙNG Chương Trình, để dễ thêm lại vào đợt tổ chức lại — tài khoản đã khoá không được gợi ý.' },
    ] },
  },
  programs: {
    desc: 'Chương Trình là khung nội dung tái sử dụng được cho nhiều Lớp Học khác nhau (VD "Đào tạo Quản lý ca" mở nhiều đợt/lớp theo thời gian).',
    flow: { ariaLabel: 'Quy trình Chương Trình', chain: [
      { label: 'Tạo chương trình', sub: 'Mục tiêu, nội dung khung' },
      { label: 'Gắn tài liệu + câu hỏi', sub: 'Từ Kho Tài Liệu / Ngân Hàng Câu Hỏi' },
      { label: 'Mở lớp theo chương trình', sub: 'Tái sử dụng nhiều lần', kind: 'approved' },
    ] },
    steps: [
      { role: 'Quản lý đào tạo', text: 'vào tab <b>🎓 Chương Trình</b> → điền Tên Chương Trình + mục tiêu/nội dung khung → lưu.' },
      { text: 'Gõ sai tên/loại đào tạo? Bấm <b>"Sửa"</b> ngay trên dòng chương trình đó (10/2026) — sửa tại chỗ, KHÔNG cần xoá tạo lại (xoá-tạo-lại sẽ đổi id, phá liên kết với mọi Lớp Học/Tài Liệu/Kế Hoạch đã gắn chương trình này).' },
      { text: 'Gắn tài liệu và câu hỏi có sẵn vào Chương Trình khi tạo Tài Liệu (tab Kho Tài Liệu) hoặc tạo Lớp Học (tab Lớp Học) — chọn đúng Chương Trình này ở ô "Chương Trình".' },
      { text: 'Mở nhiều lớp tái sử dụng cùng 1 Chương Trình: tạo Lớp Học mới, chọn lại đúng Chương Trình đã có ở ô "Chương Trình" thay vì để trống.' },
    ],
    footer: { left: [], right: [] },
  },
  plans: {
    desc: 'Kế hoạch đào tạo theo năm/quý — liệt kê các chương trình dự kiến mở, có thể import từ file có sẵn thay vì nhập tay từng dòng.',
    flow: { ariaLabel: 'Quy trình Kế Hoạch Đào Tạo', chain: [
      { label: 'Lập kế hoạch', sub: 'Theo năm/quý' },
      { label: 'Import / nhập tay', sub: 'Danh sách chương trình dự kiến' },
      { label: 'Theo dõi thực hiện', sub: 'Đối chiếu lớp đã mở thực tế', kind: 'approved' },
    ] },
    steps: [
      { role: 'Quản lý đào tạo', text: 'vào tab <b>📋 Kế Hoạch Đào Tạo</b> → điền Tháng, Đơn Vị/Đối Tượng, Số Lớp/Số Học Viên/Số Giờ Dự Kiến → lưu; hoặc nhập hàng loạt từ file có sẵn thay vì gõ tay từng dòng.' },
      { text: 'Đối chiếu thực tế: xem danh sách Lớp Học đã mở thực sự (tab Lớp Học) so với kế hoạch đã lập.' },
    ],
    footer: { left: [], right: [] },
  },
  docs: {
    desc: 'Kho tài liệu đào tạo dùng chung — tài liệu được gắn vào Chương Trình/Lớp Học, có theo dõi tiến độ đọc/xem của từng học viên.',
    flow: { ariaLabel: 'Quy trình Kho Tài Liệu Đào Tạo', chain: [
      { label: 'Tải tài liệu lên', sub: 'Gắn vào chương trình' },
      { label: 'Học viên xem', sub: 'Theo dõi tiến độ đọc', kind: 'approved' },
    ] },
    steps: [
      { role: 'Quản lý đào tạo', text: 'vào tab <b>📁 Kho Tài Liệu</b> → điền Tên Tài Liệu, chọn Loại Tài Liệu (VIDEO/IMAGE/PDF/DOCUMENT), tick "Bắt buộc xem" nếu cần, chọn Chương Trình (tuỳ chọn) → tải file hoặc dán link → lưu.' },
      { text: 'Gõ sai tên/loại đào tạo? Bấm <b>"Sửa"</b> ngay trên dòng tài liệu đó (10/2026) để sửa metadata (tên/loại đào tạo/Bắt Buộc/Chương Trình + link-thời lượng nếu là Video) — KHÔNG đổi được loại tài liệu/tệp đã tải (muốn thay tệp/video khác hẳn vẫn phải Xoá rồi Thêm lại).' },
      { text: 'Gắn tài liệu này vào 1 lớp cụ thể: khi tạo/sửa Lớp Học, chọn tài liệu ở ô "Giáo Trình Đọc Bắt Buộc" (giữ Ctrl/Cmd để chọn nhiều).' },
      { role: 'Học viên', text: 'mở lớp qua "📚 Vào Lớp Học" → xem từng tài liệu bắt buộc — hệ thống tự theo dõi tiến độ đọc/xem (video/PDF theo % đã xem).' },
    ],
    footer: { left: [], right: [] },
  },
  bank: {
    desc: 'Ngân hàng câu hỏi dùng chung cho nhiều bài kiểm tra — câu hỏi trắc nghiệm (tự chấm) hoặc tự luận (chấm tay), nhập được hàng loạt qua file mẫu.',
    flow: { ariaLabel: 'Quy trình Ngân Hàng Câu Hỏi', chain: [
      { label: 'Soạn câu hỏi', sub: 'Trắc nghiệm hoặc tự luận' },
      { label: 'Gắn vào bài kiểm tra', sub: 'Của 1 hoặc nhiều lớp', kind: 'approved' },
    ] },
    steps: [
      { role: 'Quản lý đào tạo', text: 'vào tab <b>🧪 Ngân Hàng Câu Hỏi</b> → điền Tiêu Đề bài test, Điểm Đạt Yêu Cầu → thêm từng câu hỏi (SINGLE/MULTI/ESSAY/IMAGE_DRAG_DROP) kèm đáp án đúng → lưu. Có thể tải file mẫu để nhập hàng loạt câu hỏi SINGLE/MULTI thay vì tạo tay từng câu (ESSAY/IMAGE_DRAG_DROP chỉ tạo được qua giao diện).' },
      { text: 'Sửa 1 câu hỏi/đáp án sai sau khi đã lưu? Bấm <b>"Sửa"</b> ngay trên dòng bài test đó (10/2026) — Test Builder tự nạp lại đúng toàn bộ câu hỏi hiện có để sửa tại chỗ, KHÔNG cần xoá tạo lại cả bài (xoá-tạo-lại sẽ đổi id, phá liên kết trainingClasses đang gán bài test này).' },
      { text: 'Gắn bài test vào 1 lớp cụ thể: khi tạo/sửa Lớp Học, chọn bài test ở ô "Bài Test Gán Cho Lớp".' },
      { role: 'Giảng viên', text: 'nếu bài test có câu Nghị Luận, vào mục "📝 Cần Chấm Nghị Luận" ngay trong tab này để chấm tay sau khi học viên nộp bài.' },
    ],
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
    steps: [
      { role: 'Quản lý đào tạo', text: 'vào tab <b>🆕 Đào Tạo Tân Binh</b> → khối "🆕 Quản Lý Lộ Trình" → điền Tên Lộ Trình, chọn Chương Trình bắt buộc Giai Đoạn 1 (Ngày 1-7) và Giai Đoạn 2 (Ngày 8-21), nhập Tiêu Chí Đánh Giá Giai Đoạn 3 (Ngày 59) → bấm <b>"Tạo Lộ Trình"</b>.' },
      { role: 'Quản lý đào tạo', text: 'khối "📋 Phân Công Lộ Trình Cho Nhân Viên Mới" → gõ tìm Nhân Viên, chọn Lộ Trình → bấm <b>"Phân Công"</b>.' },
      { role: 'Nhân viên mới', text: 'tự đăng ký + học các lớp thuộc đúng Chương Trình được chọn (ở tab Lớp Học, lớp PHẢI gán bài test) — % hoàn thành Giai đoạn 1/2 tự động cập nhật theo kết quả làm bài.' },
      { role: 'Nhân Sự', text: 'bấm <b>"Xác Nhận"</b> từng giai đoạn khi đã đủ điều kiện — Giai đoạn 3 do quản lý trực tiếp đánh giá theo tiêu chí đã khai, không có bài test.' },
      { role: 'Quản lý trực tiếp', text: 'nếu Giai đoạn 3 đã chấm <b>Không Đạt</b> mà nhân viên sau đó đã cải thiện (hoặc chấm nhầm): khối "Đánh Giá Giai Đoạn 3" hiện lại hồ sơ đó với 2 nút <b>"🔄 Đánh Giá Lại: Đạt / Không Đạt"</b> — bắt buộc nhập lý do, kết quả cũ được lưu vào lịch sử đánh giá. Hồ sơ đã cấp chứng chỉ thì không đánh giá lại được nữa.' },
    ],
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
    steps: [
      { role: 'Quản lý đào tạo', text: 'vào tab <b>🪜 Lộ Trình Thăng Tiến</b> → bấm "+ Thêm Cấp Bậc" cho từng bậc theo đúng thứ tự thăng tiến, mỗi bậc chọn ít nhất 1 Chương Trình bắt buộc (giữ Ctrl/Cmd để chọn nhiều) → điền Tên Lộ Trình, Chức Danh Mục Tiêu (tuỳ chọn) → bấm <b>"Tạo Lộ Trình"</b>.' },
      { text: 'Nhân viên học và hoàn thành các lớp thuộc Chương Trình của từng bậc — chỉ xác nhận được bậc sau khi bậc liền trước đã được xác nhận Đạt, không nhảy cóc bậc.' },
      { role: 'Quản lý đào tạo', text: 'xác nhận nhầm người/nhầm cấp: gõ lại username đó vào ô tra cứu ngay trên lộ trình → bấm <b>"↩️ Thu Hồi Xác Nhận Cấp N"</b> (chỉ thu hồi được mốc CAO NHẤT đã xác nhận — muốn thu hồi cấp dưới thì thu hồi cấp trên trước). Sau khi thu hồi có thể xác nhận lại bình thường.' },
    ],
    footer: { left: [
      { label: 'Khoá tuần tự', text: 'mỗi bậc chỉ mở khi bậc liền trước đã đạt — không thể đăng ký thẳng lên bậc cao hơn để "đi tắt".' },
    ], right: [] },
  },
};

let nvActiveKey = 'doc';
let nvActiveDaotaoArea = 'overview';
// 'business' = tab Nghiệp Vụ (NGHIEP_VU_NAV/NGHIEP_VU_DOCS, mọi tài khoản đã đăng nhập, gác theo
// canViewNVItem() như cũ); 'system' = tab Hệ Thống (SYSTEM_NAV/SYSTEM_DOCS, CHỈ admin — xem
// nvCanSeeSystemSection()). Theo yêu cầu người dùng (9/2026): tách module "Nghiệp Vụ" cũ thành 2 khu
// vực điều hướng dạng tab, đổi tên module cha thành "Hướng Dẫn" (index.html), giữ NGUYÊN mọi id/
// data-op/tên hàm nội bộ liên quan tới "nghiepVu"/"NghiepVu" để giảm rủi ro/diff.
let nvActiveSection = 'business';

// Khu Hệ Thống lộ chi tiết cấu hình/hạ tầng (phân quyền, danh mục, quy trình, tệp, log, email, API đối
// tác ngoài...) — CHỈ admin xem được, KHÔNG áp dụng 2 cơ chế mở rộng nghiepVuViewAll/nghiepVuExtraKeys
// (kế thừa đúng nguyên tắc trước đây của NV_ADMIN_ONLY_KEYS cho riêng "systemArchitecture", nay áp dụng
// cho CẢ khu vực mới thay vì gác từng key lẻ).
function nvCanSeeSystemSection() {
  return !!(currentUser && currentUser.perms?.admin);
}

function setNVActiveSection(section) {
  if (section === 'system' && !nvCanSeeSystemSection()) return;
  if (section !== 'business' && section !== 'system') return;
  nvActiveSection = section;
  nvActiveKey = null;
  renderNghiepVuModule();
}

function setNVActiveKey(key) {
  nvActiveKey = key;
  renderNghiepVuModule();
}

function setNVDaotaoArea(areaKey) {
  nvActiveDaotaoArea = areaKey;
  renderNghiepVuContent();
}

// PHÁT HIỆN theo yêu cầu người dùng (10/2026): mỗi mục Nghiệp Vụ chỉ hiện cho người ĐÃ có đúng quyền
// vào module THẬT tương ứng — tái dùng lại chính các hàm canAccessXModule()/hasModuleAccess() đã có
// (core.js), KHÔNG tạo lớp quyền song song mới. "daotao" mượn quyền module "internal" (Đào Tạo là nội
// dung con của Truyền Thông Nội Bộ, không phải module/tab riêng); "itPriceApproval" mượn quyền module
// "itSupport" (cùng 1 module thật, 2 nghiệp vụ con). Tên hàm ghi dạng STRING (tra qua window[...]) thay
// vì tham chiếu thẳng để không phụ thuộc thứ tự nạp file core.js/module-nghiepvu.js.
const NV_KEY_ACCESS_FN = {
  doc: 'canAccessDocModule', submission: 'canAccessSubmissionModule', contract: 'canAccessContractModule',
  // 3 mục con của module "internal" dùng CHUNG 1 điều kiện quyền xem (canAccessInternalModule) — quyền
  // ĐĂNG bài/đăng tin mới khác nhau theo từng loại, nhưng đó không phải điều kiện đọc tài liệu.
  daotao: 'canAccessInternalModule', internalPosts: 'canAccessInternalModule', recruitment: 'canAccessInternalModule',
  minutes: 'canAccessMeetingMinutesModule', task: 'canAccessTaskModule', periodicReport: 'canAccessPeriodicReportModule',
  meeting: 'canAccessMeetingModule', car: 'canAccessCarModule', vpp: 'canAccessVppModule', uniform: 'canAccessUniformModule', license: 'canAccessLicenseModule',
  office: 'canAccessOfficeModule', budget: 'canAccessBudgetModule',
  vanHanh: 'canAccessOperationModule', checklist: 'canAccessChecklistModule',
  orgChart: 'canAccessOrgChartModule', hrLifecycle: 'canAccessHrLifecycleModule', hrProfile: 'canAccessHrProfileModule',
  hrContract: 'canAccessHrContractModule', hrReport: 'hrpfCanViewReports', hrAttendance: 'canAccessHrAttendanceModule',
  hrPayroll: 'canAccessHrPayrollModule', hr: 'canAccessHrModule',
  itSupport: 'canAccessItSupportModule', itPriceApproval: 'canAccessItSupportModule',
  // LỖI ĐÃ VÁ (rà soát chuyên sâu theo yêu cầu người dùng, 9/2026): mục "muaHang" (Mua Hàng > BAS) thiếu
  // hẳn entry ở đây — canViewNVItem() bên dưới fallback về `true` (hiện MẶC ĐỊNH cho MỌI người) khi
  // không tìm thấy hàm tương ứng, nên ai cũng xem được tài liệu nghiệp vụ BAS dù không có bất kỳ quyền
  // Mua Hàng nào (rebateTermManage/rebateTermActivate/rebateViewReport/rebateReconcile/rebateApprove).
  // canAccessPurchasingModule() (core.js) đã có sẵn đúng logic gộp cả 5 quyền đó, chỉ cần nối vào.
  muaHang: 'canAccessPurchasingModule',
  // 3 màn dùng chung (10/2026): nối ĐÚNG hàm quyền thật đang gác chính màn đó — "approvalHub" dùng
  // canAccessApprovalHub() (KHÔNG có hậu tố "Module" như các hàm khác, đừng gõ nhầm), "reports" dùng
  // canAccessReportsModule(). Riêng "profile" (Hồ Sơ Cá Nhân) mở cho MỌI tài khoản đăng nhập, không có
  // hàm quyền riêng nào — mượn canAccessNghiepVuModule() (điều kiện vào chính màn 📘 Hướng Dẫn này) thay
  // vì để trống, vì canViewNVItem() fail-CLOSED sẽ ẩn hẳn mục nếu không có ánh xạ.
  approvalHub: 'canAccessApprovalHub', reports: 'canAccessReportsModule', profile: 'canAccessNghiepVuModule',
};

// Quyền admin-grant riêng (checkbox "Xem Toàn Bộ Mục Nghiệp Vụ", xem systemSection.html mục 24) bỏ qua
// toàn bộ giới hạn dưới đây; user.nghiepVuExtraKeys (mảng key, sanitize ở routes/data.js) mở thêm TỪNG
// mục cụ thể ngoài phạm vi quyền module hiện có, không cần bật cả quyền module thật tương ứng.
function canViewNVItem(key) {
  if (!currentUser) return false;
  if (currentUser.perms?.nghiepVuViewAll) return true;
  if ((currentUser.nghiepVuExtraKeys || []).includes(key)) return true;
  // LỖI ĐÃ VÁ (rà soát chuyên sâu theo yêu cầu người dùng, 9/2026): trước đây fallback về `true` (hiện
  // MẶC ĐỊNH cho mọi người) khi key KHÔNG có trong NV_KEY_ACCESS_FN — đúng nguyên nhân khiến mục
  // "muaHang" (Mua Hàng > BAS) lọt qua mọi giới hạn quyền suốt từ lúc thêm module. Tất cả 26/26 hàm
  // trong NV_KEY_ACCESS_FN đều định nghĩa ở core.js (luôn nạp sẵn, không lazy-load) nên không có lý do
  // hợp lệ nào để 1 key thiếu ánh xạ vẫn hiện được — đổi fallback về `false` (fail-closed): thêm module
  // mới vào NGHIEP_VU_NAV mà QUÊN nối NV_KEY_ACCESS_FN giờ sẽ ẨN mục đó (an toàn, dễ phát hiện ngay khi
  // test) thay vì ÂM THẦM lộ cho mọi người (nguy hiểm, khó phát hiện).
  const fn = window[NV_KEY_ACCESS_FN[key]];
  return typeof fn === 'function' ? !!fn(currentUser) : false;
}

function visibleNVGroups() {
  return NGHIEP_VU_NAV
    .map(g => ({ group: g.group, items: g.items.filter(it => canViewNVItem(it.key)) }))
    .filter(g => g.items.length > 0);
}

// Khu Hệ Thống không có cơ chế gác từng key riêng (khác NGHIEP_VU_NAV) — cả khu đã bị chặn ở mức
// section bởi nvCanSeeSystemSection() (renderNghiepVuModule()/setNVActiveSection()), nên hễ qua được
// bước đó thì hiện toàn bộ SYSTEM_NAV.
function visibleSystemGroups() {
  if (!nvCanSeeSystemSection()) return [];
  return SYSTEM_NAV.filter(g => g.items.length > 0);
}

function nvFindItem(key) {
  const nav = nvActiveSection === 'system' ? SYSTEM_NAV : NGHIEP_VU_NAV;
  for (const g of nav) {
    const it = g.items.find(i => i.key === key);
    if (it) return { group: g.group, item: it };
  }
  return null;
}

function renderNghiepVuModule() {
  const root = document.getElementById('nghiepVuRoot');
  if (!root) return;

  // Không còn quyền admin (VD chuyển tài khoản ngay trong phiên) mà đang đứng ở tab Hệ Thống thì trả
  // về tab Nghiệp Vụ — tránh kẹt ở tab đã mất quyền xem.
  if (nvActiveSection === 'system' && !nvCanSeeSystemSection()) nvActiveSection = 'business';

  const groups = nvActiveSection === 'system' ? visibleSystemGroups() : visibleNVGroups();
  if (!groups.some(g => g.items.some(it => it.key === nvActiveKey))) {
    nvActiveKey = groups[0]?.items[0]?.key || null;
  }

  const navHtml = groups.map(g => `
    <div class="nv-group">${escapeHtml(g.group)}</div>
    ${g.items.map(it => `
      <button type="button" class="nv-item${it.key === nvActiveKey ? ' active' : ''}" data-op="setNVActiveKey" data-arg0="${it.key}">${it.icon} ${escapeHtml(it.label)}</button>
    `).join('')}
  `).join('');

  // Tab bar Nghiệp Vụ/Hệ Thống chỉ hiện cho admin — non-admin không có gì để chuyển sang nên giữ
  // nguyên giao diện gốc (chỉ sidebar + nội dung), tránh 1 tab bar thừa chỉ có 1 lựa chọn.
  const tabsHtml = nvCanSeeSystemSection() ? `
    <div class="nv-section-tabs">
      <button type="button" class="nv-section-tab${nvActiveSection === 'business' ? ' active' : ''}" data-op="setNVActiveSection" data-arg0="business">📘 Nghiệp Vụ</button>
      <button type="button" class="nv-section-tab${nvActiveSection === 'system' ? ' active' : ''}" data-op="setNVActiveSection" data-arg0="system">⚙️ Hệ Thống</button>
    </div>
  ` : '';

  root.innerHTML = `
    ${tabsHtml}
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
  const sectionLabel = nvActiveSection === 'system' ? 'Hệ Thống' : 'Nghiệp Vụ';
  if (!nvActiveKey) {
    main.innerHTML = `<div class="p-4 bg-gray-50 border rounded text-gray-500 text-sm">Bạn chưa có quyền xem mục nào trong ${escapeHtml(sectionLabel)}.</div>`;
    return;
  }
  const found = nvFindItem(nvActiveKey);
  if (!found) { main.innerHTML = ''; return; }
  const { group, item } = found;

  if (nvActiveSection === 'business' && item.key === 'daotao') {
    main.innerHTML = renderNghiepVuDaotao(group);
    return;
  }

  const docs = nvActiveSection === 'system' ? SYSTEM_DOCS : NGHIEP_VU_DOCS;
  const doc = docs[item.key];
  if (!doc) {
    main.innerHTML = `
      <div class="text-xs text-gray-400 mb-1">${escapeHtml(sectionLabel)} / ${escapeHtml(group)}</div>
      <h2 class="text-xl font-bold mb-3">${item.icon} ${escapeHtml(item.label)}</h2>
      <div class="p-4 bg-amber-50 border border-amber-300 rounded text-amber-800 text-sm font-bold">⚠️ Chưa có tài liệu nghiệp vụ cho mục này.</div>
    `;
    return;
  }

  main.innerHTML = `
    <div class="text-xs text-gray-400 mb-1">${escapeHtml(sectionLabel)} / ${escapeHtml(group)}</div>
    <div class="flex items-center gap-2 mb-1 flex-wrap">
      <h2 class="text-xl font-bold">${doc.icon} ${escapeHtml(doc.title)}</h2>
      ${doc.badge ? `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">${escapeHtml(doc.badge)}</span>` : ''}
    </div>
    <div class="text-[13.5px] text-gray-600 leading-relaxed max-w-3xl mb-5">${doc.desc}</div>
    <div class="text-[13px] font-bold uppercase tracking-wide text-gray-700 mb-3 pb-1.5 border-b">${escapeHtml(doc.diagramTitle || 'Sơ đồ quy trình')}</div>
    ${doc.isCustomFlow ? (typeof window[doc.customFlowRenderer] === 'function' ? window[doc.customFlowRenderer]() : '') : renderNVFlow(doc.flow)}
    ${renderNVSteps(doc.steps)}
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
    ${renderNVSteps(area.steps)}
    <div class="nv-footer-grid">
      ${nvFooterCol('Lưu Ý Quan Trọng', area.footer.left)}
      ${nvFooterCol('Mẹo & Quy Tắc Hay Gặp', area.footer.right)}
    </div>
  `;
}
