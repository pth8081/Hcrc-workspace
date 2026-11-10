// lib/orgChartDiagramTree.js — Cây Phòng Ban/Siêu Thị RIÊNG dùng để vẽ "🖼️ Cây Sơ Đồ Tổ Chức" (11/2026,
// theo yêu cầu người dùng "tách cơ cấu tổ chức ra khỏi định biên" — demo đã xác nhận: xác nhận RÕ 2 cây
// HOÀN TOÀN TÁCH BIỆT, không liên quan gì tới orgChartVersions[].nodes (Phòng Ban+Vị Trí+Định Biên ở tab
// "🧩 Định Biên Nhân Sự", xem lib/orgChart.js) — Phòng Ban ở cây này CHỈ phục vụ vẽ sơ đồ hình ảnh, không
// versioning/DRAFT/APPLIED/ARCHIVED (sửa là lưu ngay, giống các danh mục đơn giản khác trong hệ thống).
//
// Lưu CHUNG 1 khoá AppData riêng "orgChartDiagramNodes" (mảng phẳng {id, parentNodeId, nodeName}) —
// KHÔNG dùng chung khoá orgChartVersions, đúng yêu cầu tách biệt hoàn toàn. parentNodeId=null nghĩa là
// node gốc (có thể có NHIỀU node gốc cùng lúc — sơ đồ khi đó vẽ thành rừng cây song song, không bắt buộc
// phải có đúng 1 "Công Ty" như cây Định Biên).
const { HttpError } = require('./httpErrors');

function nextIdFor(items) {
  let maxId = 0;
  for (const it of items || []) {
    const n = Number(it?.id);
    if (Number.isFinite(n) && n > maxId) maxId = n;
  }
  return maxId + 1;
}

function isDescendant(nodes, nodeId, maybeAncestorId) {
  const byId = new Map((nodes || []).map(n => [n.id, n]));
  let cur = byId.get(nodeId);
  let steps = 0;
  while (cur && cur.parentNodeId != null && steps < 200) {
    if (cur.parentNodeId === maybeAncestorId) return true;
    cur = byId.get(cur.parentNodeId);
    steps++;
  }
  return false;
}

// Thêm 1 Phòng Ban/Siêu Thị — trả { list, node }.
function addDiagramNode(list, { parentNodeId, nodeName }) {
  const nodes = list || [];
  if (!nodeName || !nodeName.trim()) throw new HttpError(400, 'Vui lòng nhập tên Phòng Ban/Siêu Thị');
  const normalizedParentId = (parentNodeId === undefined || parentNodeId === null || parentNodeId === '') ? null : Number(parentNodeId);
  if (normalizedParentId != null && !nodes.some(n => n.id === normalizedParentId)) {
    throw new HttpError(400, 'Không tìm thấy Phòng Ban cha');
  }
  const node = { id: nextIdFor(nodes), parentNodeId: normalizedParentId, nodeName: nodeName.trim().slice(0, 200) };
  return { list: [...nodes, node], node };
}

// Xoá 1 Phòng Ban + TOÀN BỘ nhánh con (cascade) — không có khái niệm "người đang giữ" như cây Định Biên
// (đây chỉ là khung Phòng Ban/Siêu Thị thuần phục vụ vẽ hình, không gắn Vị Trí/định biên) nên không cần
// chặn xoá theo occupant. Trả { list, deletedIds }.
function deleteDiagramNodeCascade(list, nodeId) {
  const nodes = list || [];
  if (!nodes.some(n => n.id === nodeId)) throw new HttpError(404, 'Không tìm thấy Phòng Ban này');
  const toDelete = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      if (n.parentNodeId != null && toDelete.has(n.parentNodeId) && !toDelete.has(n.id)) {
        toDelete.add(n.id);
        changed = true;
      }
    }
  }
  return { list: nodes.filter(n => !toDelete.has(n.id)), deletedIds: [...toDelete] };
}

// Sửa tên hoặc chuyển Phòng Ban cha — trả { list, node }.
function renameDiagramNode(list, nodeId, { nodeName, parentNodeId }) {
  const nodes = list || [];
  const idx = nodes.findIndex(n => n.id === nodeId);
  if (idx === -1) throw new HttpError(404, 'Không tìm thấy Phòng Ban này');
  const updated = { ...nodes[idx] };
  if (nodeName !== undefined) {
    if (!nodeName || !nodeName.trim()) throw new HttpError(400, 'Tên Phòng Ban/Siêu Thị không được để trống');
    updated.nodeName = nodeName.trim().slice(0, 200);
  }
  if (parentNodeId !== undefined) {
    const normalizedParentId = (parentNodeId === null || parentNodeId === '') ? null : Number(parentNodeId);
    if (normalizedParentId != null) {
      if (normalizedParentId === nodeId) throw new HttpError(400, 'Không thể chọn chính Phòng Ban này làm cha');
      if (!nodes.some(n => n.id === normalizedParentId)) throw new HttpError(400, 'Không tìm thấy Phòng Ban cha mới');
      if (isDescendant(nodes, normalizedParentId, nodeId)) {
        throw new HttpError(400, 'Không thể chuyển Phòng Ban vào bên dưới chính nhánh con của nó (tạo vòng lặp)');
      }
    }
    updated.parentNodeId = normalizedParentId;
  }
  const newList = [...nodes];
  newList[idx] = updated;
  return { list: newList, node: updated };
}

module.exports = { addDiagramNode, deleteDiagramNodeCascade, renameDiagramNode };
