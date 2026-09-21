// ==========================================
// NHÓM PHÊ DUYỆT TRÌNH (Văn Bản Trình) + NHÓM PHÊ DUYỆT HĐ (Hợp Đồng) — đợt "Nhóm Phê Duyệt Trình tự
// cấu hình" (10/2026): TRƯỚC ĐÂY mỗi bên là 7/4 nhóm CỐ ĐỊNH trong code (SUBMISSION_APPROVAL_LAYERS/
// CONTRACT_APPROVAL_LAYERS), admin chỉ gán được thành viên, không đổi tên/thêm/xoá nhóm được. NAY dữ
// liệu nhóm (DB.submissionApprovalGroups/DB.contractApprovalGroups, mảng {id,label,order,blocking?,
// singleApprover,allowFileReplacementProposal?,members,actionLabel?}) VÀ "Cấp Phê Duyệt Cuối Cùng" (DB.
// submissionApprovalLevels/DB.contractApprovalLevels, mảng {id,label,order,visibleGroupIds,
// lockedGroupIds,isSystemDefault?}) đều nằm trong AppData — admin tự đổi tên/thêm/xoá cả 2 ở đây, và
// đây chính là NGUỒN DỮ LIỆU trực tiếp cho trường "Phê duyệt"/"Cấp Phê Duyệt Cuối Cùng" ở form tạo Văn
// Bản Trình/Hợp Đồng (xem getSubmissionApprovalLayers()/getContractApprovalLayers()/
// getSubmissionApprovalLevels()/getContractApprovalLevels() ở core.js). `id` là khoá ỔN ĐỊNH — đổi
// `label` (tên hiển thị) không ảnh hưởng gì tới hồ sơ đã tạo trước đó (effectiveSteps/effectiveApprovers
// là snapshot bất biến, xem lib/createValidation.js). Server (routes/data.js -> lib/createValidation.js
// assertApprovalGroupsSingleApproverCaps()/resolveApprovalLevelRule()) là chốt xác minh THẬT — mọi kiểm
// tra ở đây chỉ là UX, không phải bảo mật.
// ==========================================
const APPROVAL_GROUPS_ADMIN_CONFIG = {
  submission: {
    groupsKey: 'submissionApprovalGroups', levelsKey: 'submissionApprovalLevels',
    groupsWrapId: 'submissionApprovalGroupsAdminWrap', levelsWrapId: 'submissionApprovalLevelsAdminWrap',
    hasBlocking: true, hasFileReplacement: true, logTag: 'SUBMISSION',
    groupIdPrefix: 'subgrp', levelIdPrefix: 'sublvl'
  },
  contract: {
    groupsKey: 'contractApprovalGroups', levelsKey: 'contractApprovalLevels',
    groupsWrapId: 'contractApprovalGroupsAdminWrap', levelsWrapId: 'contractApprovalLevelsAdminWrap',
    hasBlocking: false, hasFileReplacement: false, logTag: 'CONTRACT',
    groupIdPrefix: 'ctrgrp', levelIdPrefix: 'ctrlvl'
  }
};

function approvalGroupsGenId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

// ===== Lưu CÓ CHỜ XÁC NHẬN + PHỤC HỒI (rollback) cho toàn bộ CRUD Nhóm/Cấp Phê Duyệt =====
// LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Cao): mọi hàm CRUD ở màn này
// trước đây gọi syncStorage() theo kiểu "bắn và quên" (không await, không kiểm kết quả) rồi báo
// "✅ Đã lưu..." + ghi log SUCCESS + vẽ lại bảng NGAY LẬP TỨC — nếu server từ chối sau đó (409 xung
// đột phiên bản, 400 do validate, 403 hết phiên) thì admin đã thấy thông báo thành công, nhật ký đã có
// dòng SUCCESS giả, và DB.* trong bộ nhớ trình duyệt vẫn giữ thay đổi CHƯA BAO GIỜ được lưu (hiển thị
// sai cho tới lần tải lại trang). Khuôn đúng đã có sẵn ở saveUser() (module này) và
// saveWorkflowParticipatingPositions() (module-admin-specialperm.js): chụp state -> sửa -> await ->
// phục hồi nếu thất bại -> CHỈ khi thành công mới alert/ghi log.
function snapshotApprovalAdminState(cfg) {
  return JSON.parse(JSON.stringify({
    [cfg.groupsKey]: DB[cfg.groupsKey] || [],
    [cfg.levelsKey]: DB[cfg.levelsKey] || []
  }));
}

async function syncApprovalAdminKey(moduleKind, key, snapshot) {
  const saved = await syncStorage(key);
  if (!saved) {
    Object.entries(snapshot).forEach(([k, v]) => { DB[k] = v; });
    renderApprovalGroupsTable(moduleKind);
    renderApprovalLevelsTable(moduleKind);
  }
  return saved;
}

// Ô chọn ĐÚNG 1 người — dùng cho nhóm bật cờ "Chỉ 1 người" (singleApprover). 1 <select> đơn, KHÁC
// renderPeopleMultiSelect() (cho phép nhiều người). Vẫn hiện đúng người ĐÃ GÁN dù tài khoản đó vừa bị
// khoá (active:false) — cùng tinh thần renderPeopleMultiSelect() ("thành viên đã gán từ trước không bị
// ảnh hưởng").
function renderSingleApproverSelect(pickerId, selectClass, currentUsername) {
  const el = document.getElementById(pickerId);
  if (!el) return;
  const activeUsers = DB.users.filter(u => u.active !== false);
  const currentUser = DB.users.find(u => u.username === currentUsername);
  const options = activeUsers.slice();
  if (currentUsername && currentUser && !options.some(u => u.username === currentUsername)) options.push(currentUser);
  el.innerHTML = `
    <select class="${selectClass} w-full border p-1.5 rounded text-xs">
      <option value="">-- Chưa gán --</option>
      ${options.map(u => `<option value="${escapeHtml(u.username)}" ${u.username === currentUsername ? 'selected' : ''}>${escapeHtml(u.name)}${u.active === false ? ' (đã khoá)' : ''}</option>`).join('')}
    </select>
  `;
}

// ===== Bảng NHÓM PHÊ DUYỆT (groups) =====
function renderApprovalGroupsTable(moduleKind) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const wrap = document.getElementById(cfg.groupsWrapId);
  if (!wrap) return;
  const groups = (DB[cfg.groupsKey] || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const rowsHTML = groups.map((g, idx) => {
    const pickerId = `apgMemberPicker_${moduleKind}_${g.id}`;
    return `
      <tr class="border-b align-top">
        <td class="p-1.5 border text-center whitespace-nowrap">
          <div class="flex flex-col items-center gap-0.5">
            <button type="button" ${idx === 0 ? 'disabled' : ''} data-op="moveApprovalGroup" data-arg0="${moduleKind}" data-arg1="${escapeHtml(g.id)}" data-arg2="-1" class="text-gray-500 hover:text-gray-800 disabled:opacity-20 leading-none">▲</button>
            <span class="text-[10px] text-gray-400">${idx + 1}</span>
            <button type="button" ${idx === groups.length - 1 ? 'disabled' : ''} data-op="moveApprovalGroup" data-arg0="${moduleKind}" data-arg1="${escapeHtml(g.id)}" data-arg2="1" class="text-gray-500 hover:text-gray-800 disabled:opacity-20 leading-none">▼</button>
          </div>
        </td>
        <td class="p-1.5 border min-w-[140px]">
          <input type="text" value="${escapeHtml(g.label || '')}" data-op-change="renameApprovalGroup" data-arg0="${moduleKind}" data-arg1="${escapeHtml(g.id)}" data-arg-value="2" class="w-full border p-1 rounded text-[11px] font-semibold">
        </td>
        <td class="p-1.5 border min-w-[120px]">
          <input type="text" value="${escapeHtml(g.actionLabel || '')}" placeholder="Phê Duyệt" title="Chữ hiện trên nút bấm + chân ký khi hoàn tất bước này — VD: Xác Nhận, Thẩm Định, Kiểm Duyệt... Để trống = mặc định &quot;Phê Duyệt&quot;." data-op-change="updateApprovalGroupActionLabel" data-arg0="${moduleKind}" data-arg1="${escapeHtml(g.id)}" data-arg-value="2" class="w-full border p-1 rounded text-[11px]">
        </td>
        ${cfg.hasBlocking ? `
        <td class="p-1.5 border text-center">
          <input type="checkbox" ${g.blocking !== false ? 'checked' : ''} data-op-change="toggleApprovalGroupFlag" data-arg0="${moduleKind}" data-arg1="${escapeHtml(g.id)}" data-arg2="blocking" data-arg-el="3">
        </td>` : ''}
        <td class="p-1.5 border text-center">
          <input type="checkbox" ${g.singleApprover ? 'checked' : ''} data-op-change="toggleApprovalGroupFlag" data-arg0="${moduleKind}" data-arg1="${escapeHtml(g.id)}" data-arg2="singleApprover" data-arg-el="3">
        </td>
        ${cfg.hasFileReplacement ? `
        <td class="p-1.5 border text-center">
          <input type="checkbox" ${g.allowFileReplacementProposal ? 'checked' : ''} data-op-change="toggleApprovalGroupFlag" data-arg0="${moduleKind}" data-arg1="${escapeHtml(g.id)}" data-arg2="allowFileReplacementProposal" data-arg-el="3">
        </td>` : ''}
        <td class="p-1.5 border min-w-[220px]">
          <div id="${pickerId}"></div>
          <button type="button" data-op="saveApprovalGroupMembers" data-arg0="${moduleKind}" data-arg1="${escapeHtml(g.id)}" class="w-full mt-1 bg-rose-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-rose-700">💾 Lưu Thành Viên</button>
        </td>
        <td class="p-1.5 border text-center">
          <button type="button" data-op="deleteApprovalGroup" data-arg0="${moduleKind}" data-arg1="${escapeHtml(g.id)}" class="text-red-600 text-[11px] font-bold hover:underline">🗑 Xoá</button>
        </td>
      </tr>
    `;
  }).join('');

  const colCount = 5 + (cfg.hasBlocking ? 1 : 0) + (cfg.hasFileReplacement ? 1 : 0);
  wrap.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-[11px] border-collapse">
        <thead>
          <tr class="bg-slate-100 text-gray-600">
            <th class="p-1.5 border">Thứ Tự</th>
            <th class="p-1.5 border text-left">Tên Nhóm</th>
            <th class="p-1.5 border text-left" title="Chữ hiện trên nút bấm + chân ký khi hoàn tất bước của nhóm này (VD Xác Nhận/Thẩm Định), thay cho mặc định &quot;Phê Duyệt&quot; — cùng cơ chế nhãn hành động ở mục &quot;Quy Trình &amp; Phê Duyệt&quot;">Nhãn Phê Duyệt</th>
            ${cfg.hasBlocking ? '<th class="p-1.5 border" title="Nhóm KHÔNG chặn quy trình chỉ là kênh tham khảo song song (VD Xin ý kiến), không cộng thêm bước duyệt nào">Chặn Quy Trình?</th>' : ''}
            <th class="p-1.5 border" title="Nhóm chỉ được gán tối đa 1 thành viên">Chỉ 1 Người?</th>
            ${cfg.hasFileReplacement ? '<th class="p-1.5 border" title="Người duyệt ở bước của nhóm này có thêm lựa chọn đề xuất thay thế toàn bộ tệp tờ trình">Đề Xuất Thay File?</th>' : ''}
            <th class="p-1.5 border text-left">Thành Viên</th>
            <th class="p-1.5 border">Thao Tác</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHTML || `<tr><td colspan="${colCount}" class="p-3 text-center text-gray-400 italic">Chưa có nhóm nào — bấm "+ Thêm Nhóm" bên dưới.</td></tr>`}
        </tbody>
      </table>
    </div>
    <button type="button" data-op="addApprovalGroup" data-arg0="${moduleKind}" class="mt-2 bg-emerald-600 text-white px-3 py-1.5 rounded text-[11px] font-bold hover:bg-emerald-700">+ Thêm Nhóm</button>
  `;

  groups.forEach(g => {
    const pickerId = `apgMemberPicker_${moduleKind}_${g.id}`;
    if (g.singleApprover) {
      renderSingleApproverSelect(pickerId, 'apg-single-select', (g.members || [])[0] || '');
    } else {
      // Tài khoản đã khoá không hiện trong nguồn tìm-để-thêm-mới nữa — thành viên đã gán từ trước
      // (members) không bị ảnh hưởng, vẫn hiện đúng qua renderChips().
      renderPeopleMultiSelect(pickerId, DB.users.filter(u => u.active !== false), g.members || [], '', {});
    }
  });
}

async function renameApprovalGroup(moduleKind, groupId, newLabel) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const group = (DB[cfg.groupsKey] || []).find(g => g.id === groupId);
  if (!group) return;
  const trimmed = String(newLabel || '').trim();
  if (!trimmed) { alert('Tên nhóm không được để trống!'); renderApprovalGroupsTable(moduleKind); return; }
  const snapshot = snapshotApprovalAdminState(cfg);
  group.label = trimmed;
  if (!await syncApprovalAdminKey(moduleKind, cfg.groupsKey, snapshot)) return;
  logSystemAction(cfg.logTag, 'RENAME_APPROVAL_GROUP', `Đổi tên nhóm phê duyệt [${groupId}] -> "${trimmed}"`, 'SUCCESS', groupId);
}

// Nhãn hành động RIÊNG cho bước do nhóm này sinh ra (VD "Xác Nhận"/"Thẩm Định") — cùng cơ chế/quy ước
// step.actionLabel đã dùng cho "🛠️ Định Nghĩa Các Mẫu Bước Phê Duyệt" (module-itsupport-tier.js): để
// trống = mặc định "Phê Duyệt" (resolveStepActionLabel(), core.js). Lan toả tự động tới nút bấm
// Duyệt/chân ký in của MỌI tờ trình/hợp đồng MỚI tạo từ nay có tick nhóm này (xem getSubmissionApprovalLayers()/
// getContractApprovalLayers() + buildEffectiveSubmissionWorkflow()/buildEffectiveContractApprovalWorkflow()
// ở core.js/module-vanbantrinh.js, và bản snapshot server ở lib/createValidation.js) — hồ sơ ĐÃ TẠO
// trước đó không đổi (effectiveSteps là snapshot bất biến, cùng khuôn đổi tên nhóm ở renameApprovalGroup()).
async function updateApprovalGroupActionLabel(moduleKind, groupId, newLabel) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const group = (DB[cfg.groupsKey] || []).find(g => g.id === groupId);
  if (!group) return;
  const trimmed = String(newLabel || '').trim();
  const snapshot = snapshotApprovalAdminState(cfg);
  group.actionLabel = trimmed || null;
  if (!await syncApprovalAdminKey(moduleKind, cfg.groupsKey, snapshot)) return;
  logSystemAction(cfg.logTag, 'UPDATE_APPROVAL_GROUP_ACTION_LABEL', `Đổi nhãn phê duyệt nhóm [${group.label}] -> "${trimmed || 'Phê Duyệt (mặc định)'}"`, 'SUCCESS', groupId);
}

// el = chính checkbox vừa đổi (data-arg-el) — đọc el.checked thay vì el.value (checkbox không dùng
// data-arg-value vì el.value luôn là "on", không phản ánh trạng thái tick).
async function toggleApprovalGroupFlag(moduleKind, groupId, flagName, el) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const group = (DB[cfg.groupsKey] || []).find(g => g.id === groupId);
  if (!group) return;
  // Chặn bật "Chỉ 1 người" khi nhóm đang có >1 thành viên — mirror ĐÚNG chốt chặn thật ở server
  // (lib/createValidation.js::assertApprovalGroupsSingleApproverCaps()), báo lỗi sớm ở UI thay vì để
  // request bị 400 sau khi bấm lưu.
  if (flagName === 'singleApprover' && el.checked && (group.members || []).length > 1) {
    alert(`⛔ Nhóm "${group.label}" hiện có ${group.members.length} thành viên — vui lòng bớt xuống còn tối đa 1 người (nút "💾 Lưu Thành Viên") trước khi bật "Chỉ 1 người".`);
    el.checked = false;
    return;
  }
  const snapshot = snapshotApprovalAdminState(cfg);
  group[flagName] = el.checked;
  if (!await syncApprovalAdminKey(moduleKind, cfg.groupsKey, snapshot)) return;
  logSystemAction(cfg.logTag, 'UPDATE_APPROVAL_GROUP_FLAG', `Đổi cờ "${flagName}" nhóm [${group.label}] = ${el.checked}`, 'SUCCESS', groupId);
  // Vẽ lại cả bảng — đổi "Chỉ 1 người" cần đổi LOẠI widget cột Thành Viên (select đơn <-> chọn nhiều).
  renderApprovalGroupsTable(moduleKind);
}

async function saveApprovalGroupMembers(moduleKind, groupId) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const group = (DB[cfg.groupsKey] || []).find(g => g.id === groupId);
  if (!group) return;
  const pickerId = `apgMemberPicker_${moduleKind}_${groupId}`;
  let members;
  if (group.singleApprover) {
    const select = document.querySelector(`#${pickerId} select`);
    members = select && select.value ? [select.value] : [];
  } else {
    // Container ID đã riêng theo đúng moduleKind+groupId (không dùng chung data-layer với form TẠO tờ
    // trình/hợp đồng như trước) — querySelectorAll trong ĐÚNG picker này là đủ, không cần scope thêm.
    members = [...document.querySelectorAll(`#${pickerId} input[type="checkbox"]`)].map(cb => cb.value);
  }
  const snapshot = snapshotApprovalAdminState(cfg);
  group.members = members;
  if (!await syncApprovalAdminKey(moduleKind, cfg.groupsKey, snapshot)) return;
  logSystemAction(cfg.logTag, 'SAVE_APPROVAL_GROUP', `Cập nhật thành viên nhóm [${group.label}]: ${members.length} người`, 'SUCCESS', groupId);
  alert(`✅ Đã lưu thành viên nhóm "${group.label}"!`);
}

// LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Cao): xoá 1 nhóm trước đây KHÔNG
// dọn id nhóm đó khỏi visibleGroupIds/lockedGroupIds của các "Cấp Phê Duyệt Cuối Cùng" — nếu nhóm vừa
// xoá đang được đặt BẮT BUỘC (locked) ở 1 cấp thì MỌI hồ sơ chọn cấp đó bị server từ chối VĨNH VIỄN
// ("Thiếu nhóm phê duyệt bắt buộc...", xem buildEffectiveSubmissionWorkflowServer() ở
// lib/createValidation.js) trong khi form tạo hồ sơ không còn render nổi checkbox của nhóm đã xoá để
// tick lại -> khoá cứng việc tạo hồ sơ ở cấp đó, không có đường lùi qua giao diện. Hộp thoại xác nhận
// cũ còn khẳng định SAI rằng "cấp đó sẽ tự bỏ qua nhóm này" (không hề có cơ chế nào làm việc đó). Nay
// dọn ngay ở client, nêu rõ ảnh hưởng trong hộp thoại xác nhận, và server cũng TỰ dọn lại trong cùng
// request ghi nhóm (xem syncApprovalLevelsWithGroupsChange() ở routes/data.js) để 1 request tự soạn
// cũng không tạo ra được tham chiếu treo.
async function deleteApprovalGroup(moduleKind, groupId) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const group = (DB[cfg.groupsKey] || []).find(g => g.id === groupId);
  if (!group) return;
  const affectedLevels = (DB[cfg.levelsKey] || []).filter(lv =>
    (Array.isArray(lv.visibleGroupIds) && lv.visibleGroupIds.includes(groupId)) || (lv.lockedGroupIds || []).includes(groupId));
  const affectedNote = affectedLevels.length
    ? `\n\n⚠️ Nhóm này đang được cấu hình ở ${affectedLevels.length} Cấp Phê Duyệt Cuối Cùng (${affectedLevels.map(lv => lv.label || lv.id).join(', ')}) — sẽ được TỰ ĐỘNG gỡ khỏi danh sách nhóm hiển thị/bắt buộc của các cấp đó.`
    : '';
  if (!confirm(`Xoá nhóm "${group.label}"? Hồ sơ ĐÃ TẠO trước đó không bị ảnh hưởng (quy trình của hồ sơ cũ đã chốt cố định lúc tạo, không đổi theo cấu hình sau này) — chỉ ảnh hưởng lựa chọn cho hồ sơ MỚI từ giờ trở đi.${affectedNote}`)) return;
  const snapshot = snapshotApprovalAdminState(cfg);
  DB[cfg.groupsKey] = (DB[cfg.groupsKey] || []).filter(g => g.id !== groupId);
  DB[cfg.levelsKey] = (DB[cfg.levelsKey] || []).map(lv => ({
    ...lv,
    ...(Array.isArray(lv.visibleGroupIds) && { visibleGroupIds: lv.visibleGroupIds.filter(id => id !== groupId) }),
    ...(Array.isArray(lv.lockedGroupIds) && { lockedGroupIds: lv.lockedGroupIds.filter(id => id !== groupId) })
  }));
  // CHỈ cần ghi collection NHÓM — server tự dọn lại "Cấp" trong CÙNG request đó (nguyên tử hơn 2 lượt
  // ghi rời) và trả kèm version mới của "Cấp" (syncedVersions, xem syncStorageOnce() ở core.js) để lượt
  // "💾 Lưu Phạm Vi" kế tiếp không bị 409 giả do chính lượt xoá này gây ra.
  if (!await syncApprovalAdminKey(moduleKind, cfg.groupsKey, snapshot)) return;
  logSystemAction(cfg.logTag, 'DELETE_APPROVAL_GROUP', `Xoá nhóm phê duyệt [${group.label}]${affectedLevels.length ? ` (gỡ khỏi ${affectedLevels.length} cấp phê duyệt)` : ''}`, 'SUCCESS', groupId);
  renderApprovalGroupsTable(moduleKind);
  renderApprovalLevelsTable(moduleKind);
}

async function addApprovalGroup(moduleKind) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const label = String(prompt('Tên nhóm phê duyệt mới:') || '').trim();
  if (!label) return;
  const groups = DB[cfg.groupsKey] || (DB[cfg.groupsKey] = []);
  const order = Math.max(-1, ...groups.map(g => g.order ?? 0)) + 1;
  const newGroup = { id: approvalGroupsGenId(cfg.groupIdPrefix), label, order, singleApprover: false, members: [] };
  if (cfg.hasBlocking) newGroup.blocking = true;
  if (cfg.hasFileReplacement) newGroup.allowFileReplacementProposal = false;
  const snapshot = snapshotApprovalAdminState(cfg);
  groups.push(newGroup);
  if (!await syncApprovalAdminKey(moduleKind, cfg.groupsKey, snapshot)) return;
  logSystemAction(cfg.logTag, 'ADD_APPROVAL_GROUP', `Thêm nhóm phê duyệt mới [${label}]`, 'SUCCESS', newGroup.id);
  renderApprovalGroupsTable(moduleKind);
}

async function moveApprovalGroup(moduleKind, groupId, direction) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const groups = (DB[cfg.groupsKey] || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = groups.findIndex(g => g.id === groupId);
  const swapIdx = idx + direction;
  if (idx === -1 || swapIdx < 0 || swapIdx >= groups.length) return;
  const snapshot = snapshotApprovalAdminState(cfg);
  [groups[idx], groups[swapIdx]] = [groups[swapIdx], groups[idx]];
  groups.forEach((g, i) => { g.order = i; });
  DB[cfg.groupsKey] = groups;
  if (!await syncApprovalAdminKey(moduleKind, cfg.groupsKey, snapshot)) return;
  renderApprovalGroupsTable(moduleKind);
}

// ===== Bảng CẤP PHÊ DUYỆT CUỐI CÙNG (levels) =====
function renderApprovalLevelsTable(moduleKind) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const wrap = document.getElementById(cfg.levelsWrapId);
  if (!wrap) return;
  const levels = (DB[cfg.levelsKey] || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const groupItems = (DB[cfg.groupsKey] || []).map(g => ({ value: g.id, label: g.label }));

  const rowsHTML = levels.map((lv, idx) => {
    const isAll = !Array.isArray(lv.visibleGroupIds);
    const allCbId = `aplVisibleAllCb_${moduleKind}_${lv.id}`;
    const visibleWrapId = `aplVisiblePickerWrap_${moduleKind}_${lv.id}`;
    const visiblePickerId = `aplVisiblePicker_${moduleKind}_${lv.id}`;
    const lockedPickerId = `aplLockedPicker_${moduleKind}_${lv.id}`;
    return `
      <tr class="border-b align-top">
        <td class="p-1.5 border text-center whitespace-nowrap">
          <div class="flex flex-col items-center gap-0.5">
            <button type="button" ${idx === 0 ? 'disabled' : ''} data-op="moveApprovalLevel" data-arg0="${moduleKind}" data-arg1="${escapeHtml(lv.id)}" data-arg2="-1" class="text-gray-500 hover:text-gray-800 disabled:opacity-20 leading-none">▲</button>
            <span class="text-[10px] text-gray-400">${idx + 1}</span>
            <button type="button" ${idx === levels.length - 1 ? 'disabled' : ''} data-op="moveApprovalLevel" data-arg0="${moduleKind}" data-arg1="${escapeHtml(lv.id)}" data-arg2="1" class="text-gray-500 hover:text-gray-800 disabled:opacity-20 leading-none">▼</button>
          </div>
        </td>
        <td class="p-1.5 border min-w-[140px]">
          <input type="text" value="${escapeHtml(lv.label || '')}" data-op-change="renameApprovalLevel" data-arg0="${moduleKind}" data-arg1="${escapeHtml(lv.id)}" data-arg-value="2" class="w-full border p-1 rounded text-[11px] font-semibold">
          ${lv.isSystemDefault ? '<span class="block text-[10px] text-sky-600 mt-0.5">🔒 Mặc định hệ thống</span>' : ''}
        </td>
        <td class="p-1.5 border min-w-[200px]">
          <label class="flex items-center gap-1 text-[10px] text-gray-600 mb-1 cursor-pointer">
            <input type="checkbox" id="${allCbId}" ${isAll ? 'checked' : ''} data-op-change="onLevelVisibleAllToggle" data-arg0="${moduleKind}" data-arg1="${escapeHtml(lv.id)}" data-arg-el="2"> Tất cả nhóm (mặc định)
          </label>
          <div id="${visibleWrapId}" class="${isAll ? 'hidden' : ''}">
            <div id="${visiblePickerId}"></div>
          </div>
        </td>
        <td class="p-1.5 border min-w-[200px]">
          <div id="${lockedPickerId}"></div>
        </td>
        <td class="p-1.5 border text-center whitespace-nowrap">
          <button type="button" data-op="saveApprovalLevelGroups" data-arg0="${moduleKind}" data-arg1="${escapeHtml(lv.id)}" class="w-full bg-rose-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-rose-700 mb-1">💾 Lưu Phạm Vi</button>
          ${lv.isSystemDefault
            ? '<span class="text-gray-400 text-[11px]" title="Cấp mặc định hệ thống — không xoá được">🔒</span>'
            : `<button type="button" data-op="deleteApprovalLevel" data-arg0="${moduleKind}" data-arg1="${escapeHtml(lv.id)}" class="text-red-600 text-[11px] font-bold hover:underline">🗑 Xoá</button>`}
        </td>
      </tr>
    `;
  }).join('');

  wrap.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-[11px] border-collapse">
        <thead>
          <tr class="bg-slate-100 text-gray-600">
            <th class="p-1.5 border">Thứ Tự</th>
            <th class="p-1.5 border text-left">Tên Cấp</th>
            <th class="p-1.5 border text-left">Nhóm Được Chọn (hiển thị)</th>
            <th class="p-1.5 border text-left">Nhóm Bắt Buộc (khoá sẵn)</th>
            <th class="p-1.5 border">Thao Tác</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHTML || `<tr><td colspan="5" class="p-3 text-center text-gray-400 italic">Chưa có cấp nào — bấm "+ Thêm Cấp" bên dưới.</td></tr>`}
        </tbody>
      </table>
    </div>
    <button type="button" data-op="addApprovalLevel" data-arg0="${moduleKind}" class="mt-2 bg-emerald-600 text-white px-3 py-1.5 rounded text-[11px] font-bold hover:bg-emerald-700">+ Thêm Cấp</button>
  `;

  levels.forEach(lv => {
    const isAll = !Array.isArray(lv.visibleGroupIds);
    renderMultiSelectDropdown(`aplVisiblePicker_${moduleKind}_${lv.id}`, groupItems, isAll ? [] : lv.visibleGroupIds, {
      placeholder: '🔍 Tìm nhóm để thêm vào phạm vi hiển thị...', emptyText: 'Chưa chọn nhóm nào.',
      chipClass: 'bg-sky-100 text-sky-700', hoverClass: 'hover:bg-sky-50'
    });
    renderMultiSelectDropdown(`aplLockedPicker_${moduleKind}_${lv.id}`, groupItems, lv.lockedGroupIds || [], {
      placeholder: '🔍 Tìm nhóm để khoá bắt buộc...', emptyText: 'Không khoá nhóm nào.',
      chipClass: 'bg-amber-100 text-amber-700', hoverClass: 'hover:bg-amber-50'
    });
  });
}

async function renameApprovalLevel(moduleKind, levelId, newLabel) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const level = (DB[cfg.levelsKey] || []).find(l => l.id === levelId);
  if (!level) return;
  const trimmed = String(newLabel || '').trim();
  if (!trimmed) { alert('Tên cấp không được để trống!'); renderApprovalLevelsTable(moduleKind); return; }
  const snapshot = snapshotApprovalAdminState(cfg);
  level.label = trimmed;
  if (!await syncApprovalAdminKey(moduleKind, cfg.levelsKey, snapshot)) return;
  logSystemAction(cfg.logTag, 'RENAME_APPROVAL_LEVEL', `Đổi tên cấp phê duyệt [${levelId}] -> "${trimmed}"`, 'SUCCESS', levelId);
}

// Chỉ đổi hiển thị (ẩn/hiện khối chọn nhóm cụ thể) — KHÔNG tự lưu, chờ bấm "💾 Lưu Phạm Vi" (xem
// saveApprovalLevelGroups() đọc lại đúng trạng thái checkbox này tại thời điểm lưu).
function onLevelVisibleAllToggle(moduleKind, levelId, el) {
  const wrap = document.getElementById(`aplVisiblePickerWrap_${moduleKind}_${levelId}`);
  if (wrap) wrap.classList.toggle('hidden', el.checked);
}

async function saveApprovalLevelGroups(moduleKind, levelId) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const level = (DB[cfg.levelsKey] || []).find(l => l.id === levelId);
  if (!level) return;
  const isAll = !!document.getElementById(`aplVisibleAllCb_${moduleKind}_${levelId}`)?.checked;
  const visibleGroupIds = isAll ? null : getMultiSelectValues(`aplVisiblePicker_${moduleKind}_${levelId}`);
  const lockedGroupIds = getMultiSelectValues(`aplLockedPicker_${moduleKind}_${levelId}`);
  // Nhóm bắt buộc (locked) PHẢI nằm trong phạm vi hiển thị (visible) — nếu không, form tạo hồ sơ sẽ
  // KHÔNG BAO GIỜ render checkbox cho nhóm đó (renderSubmissionApprovalLayerCheckboxes() lọc theo
  // rule.visible), khiến server luôn từ chối vì "thiếu nhóm phê duyệt bắt buộc" mà người dùng không
  // thấy được lý do — chặn sớm ở đây thay vì để lỗi khó hiểu xảy ra lúc tạo hồ sơ thật.
  if (!isAll) {
    const missing = lockedGroupIds.filter(id => !visibleGroupIds.includes(id));
    if (missing.length) {
      const names = missing.map(id => (DB[cfg.groupsKey] || []).find(g => g.id === id)?.label || id).join(', ');
      return alert(`⛔ Nhóm bắt buộc "${names}" phải nằm trong danh sách "Nhóm Được Chọn (hiển thị)" — hoặc bật "Tất cả nhóm".`);
    }
  }
  const snapshot = snapshotApprovalAdminState(cfg);
  level.visibleGroupIds = visibleGroupIds;
  level.lockedGroupIds = lockedGroupIds;
  if (!await syncApprovalAdminKey(moduleKind, cfg.levelsKey, snapshot)) return;
  logSystemAction(cfg.logTag, 'SAVE_APPROVAL_LEVEL_SCOPE', `Cập nhật phạm vi cấp phê duyệt [${level.label}]`, 'SUCCESS', levelId);
  alert(`✅ Đã lưu phạm vi cấp "${level.label}"!`);
}

async function deleteApprovalLevel(moduleKind, levelId) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const level = (DB[cfg.levelsKey] || []).find(l => l.id === levelId);
  if (!level) return;
  if (level.isSystemDefault) return alert('Đây là cấp mặc định hệ thống — không xoá được (đảm bảo luôn có 1 cấp dự phòng), chỉ đổi tên được.');
  if (!confirm(`Xoá cấp "${level.label}"? Hồ sơ ĐÃ TẠO trước đó không bị ảnh hưởng (quy trình của hồ sơ cũ đã chốt cố định lúc tạo, không đổi theo cấu hình sau này) — chỉ ảnh hưởng lựa chọn cho hồ sơ MỚI từ giờ trở đi.`)) return;
  const snapshot = snapshotApprovalAdminState(cfg);
  DB[cfg.levelsKey] = (DB[cfg.levelsKey] || []).filter(l => l.id !== levelId);
  if (!await syncApprovalAdminKey(moduleKind, cfg.levelsKey, snapshot)) return;
  logSystemAction(cfg.logTag, 'DELETE_APPROVAL_LEVEL', `Xoá cấp phê duyệt [${level.label}]`, 'SUCCESS', levelId);
  renderApprovalLevelsTable(moduleKind);
}

async function addApprovalLevel(moduleKind) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const label = String(prompt('Tên cấp phê duyệt cuối cùng mới:') || '').trim();
  if (!label) return;
  const levels = DB[cfg.levelsKey] || (DB[cfg.levelsKey] = []);
  const order = Math.max(-1, ...levels.map(l => l.order ?? 0)) + 1;
  const newLevel = { id: approvalGroupsGenId(cfg.levelIdPrefix), label, order, visibleGroupIds: null, lockedGroupIds: [], isSystemDefault: false };
  const snapshot = snapshotApprovalAdminState(cfg);
  levels.push(newLevel);
  if (!await syncApprovalAdminKey(moduleKind, cfg.levelsKey, snapshot)) return;
  logSystemAction(cfg.logTag, 'ADD_APPROVAL_LEVEL', `Thêm cấp phê duyệt mới [${label}]`, 'SUCCESS', newLevel.id);
  renderApprovalLevelsTable(moduleKind);
}

async function moveApprovalLevel(moduleKind, levelId, direction) {
  const cfg = APPROVAL_GROUPS_ADMIN_CONFIG[moduleKind];
  const levels = (DB[cfg.levelsKey] || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = levels.findIndex(l => l.id === levelId);
  const swapIdx = idx + direction;
  if (idx === -1 || swapIdx < 0 || swapIdx >= levels.length) return;
  const snapshot = snapshotApprovalAdminState(cfg);
  [levels[idx], levels[swapIdx]] = [levels[swapIdx], levels[idx]];
  levels.forEach((l, i) => { l.order = i; });
  DB[cfg.levelsKey] = levels;
  if (!await syncApprovalAdminKey(moduleKind, cfg.levelsKey, snapshot)) return;
  renderApprovalLevelsTable(moduleKind);
}

// Giữ nguyên 2 tên hàm cũ (gọi từ module-hethong-tabs.js switchSystemSubTab() — không cần sửa nơi gọi)
// — mỗi hàm vẽ CẢ bảng Nhóm lẫn bảng Cấp của đúng module đó.
function renderSubmissionApprovalGroups() {
  renderApprovalGroupsTable('submission');
  renderApprovalLevelsTable('submission');
}
function renderContractApprovalGroups() {
  renderApprovalGroupsTable('contract');
  renderApprovalLevelsTable('contract');
}

function cancelPermFormEdit() {
  editingGroupId = null;
  toggleUserPermFormMode('USER');
  resetUserForm();
}

// Đọc + xác thực phần DỮ LIỆU CHUNG của form Người dùng (dùng cho cả sửa người có sẵn, lưu ngay 1
// người mới, và thêm 1 người mới vào danh sách chờ — xem saveUser()/addUserToStagingList()). Trả về
// null (đã tự alert lý do) nếu có lỗi.
// Vị Trí (HO/Siêu Thị) — chọn HO hiện select Phòng Ban (nguồn DB.depts) + ẩn Siêu Thị, chọn Siêu Thị
// thì ngược lại. Dù chọn nguồn nào, chỉ 1 giá trị chuỗi duy nhất được ghi vào user.dept khi lưu (xem
// readUserFormState()) — mọi workflow/quyền scope hiện có dùng user.dept làm khoá tra cứu không cần
// biết/quan tâm giá trị đó đến từ danh mục nào.
function onUserPosTypeChange() {
  const posType = document.getElementById('uPosType').value;
  document.getElementById('uDeptFieldWrap').classList.toggle('hidden', posType !== 'HO');
  document.getElementById('uStoreFieldWrap').classList.toggle('hidden', posType !== 'STORE');
  populateUserJobTitleOptions(posType);
}

// populateUserJobTitleOptions() CHUYỂN sang core.js (Hạ tầng: nạp module theo cụm, đợt 7) —
// populateDropdowns() gọi thẳng hàm này ở MỌI switchTab() (không riêng gì tab Hệ Thống/Admin).

function readUserFormState() {
  const editId = document.getElementById('editUserId').value;
  const username = document.getElementById('uUsername').value.trim();
  const pass = document.getElementById('uPassword').value.trim();
  const pin = document.getElementById('uPin').value.trim();
  const name = document.getElementById('uFullName').value.trim();
  const email = document.getElementById('uEmail').value.trim();
  const phone = document.getElementById('uPhone').value.trim();
  const posType = document.getElementById('uPosType').value;
  const dept = posType === 'STORE' ? document.getElementById('uStore').value : document.getElementById('uDept').value;
  if (!dept) { alert(posType === 'STORE' ? 'Vui lòng chọn Siêu Thị!' : 'Vui lòng chọn Phòng Ban!'); return null; }
  const jobTitle = document.getElementById('uJobTitle').value || null;
  const secondaryPositions = getMultiSelectValues('uSecondaryPositionsMultiSelect').map(decodeWfPositionPair).filter(Boolean);
  const nghiepVuExtraKeys = getMultiSelectValues('uNghiepVuExtraKeysMultiSelect');
  const reportExtraKeys = getMultiSelectValues('uReportExtraKeysMultiSelect');
  const isDriver = !!document.getElementById('uIsDriver')?.checked;
  const startDate = document.getElementById('uStartDate').value || '';
  const groupIds = currentEditingUserGroupIds();

  // Nếu gán vào (một hoặc nhiều) nhóm phân quyền: khối checkbox trên form KHÔNG còn bị khoá, cho phép
  // tick thêm/bớt tuỳ chỉnh riêng trên nền quyền GỘP của các nhóm (xem mergeGroupsBasePerms()). Chỉ lưu
  // lại PHẦN KHÁC BIỆT so với nền đó (permOverrides), không lưu y nguyên toàn bộ như trước — nhờ vậy
  // khi 1 trong các nhóm đổi quyền sau này (savePermGroup()) vẫn tự động cập nhật đúng cho người này mà
  // không mất phần tuỳ chỉnh riêng.
  const groups = groupIds.map(id => DB.permGroups.find(g => g.id === id)).filter(Boolean);
  const basePerms = groups.length ? mergeGroupsBasePerms(groups.map(g => g.perms)) : null;
  const formPerms = collectPermsFromForm();
  const permOverrides = basePerms ? diffPerms(formPerms, basePerms) : null;
  const perms = basePerms ? mergePerms(basePerms, permOverrides) : formPerms;

  // Mã PIN kiểm tra sơ bộ ở client (server vẫn xác minh lại) — chỉ ép buộc khi thực sự nhập giá trị
  // mới, để trống = giữ nguyên PIN cũ (khớp hành vi mật khẩu ở trên).
  if (pin && !/^\d{4,}$/.test(pin)) { alert('Mã PIN phải là dãy số, tối thiểu 4 chữ số!'); return null; }
  if (perms.approverAuthLevel === 'PIN' && !editId && !pin) {
    alert('Vui lòng nhập mã PIN cho người dùng mới đang chọn mức xác thực "Yêu cầu nhập mã PIN"!');
    return null;
  }

  return { editId, username, pass, pin, name, email, phone, posType, dept, jobTitle, secondaryPositions, nghiepVuExtraKeys, reportExtraKeys, isDriver, startDate, groupIds, perms, permOverrides };
}

// Dựng 1 bản ghi người dùng MỚI từ state đã đọc — dùng chung cho lưu ngay (saveUser()) lẫn thêm vào
// danh sách chờ (addUserToStagingList()). Kiểm tra trùng username với CẢ DB.users lẫn danh sách chờ
// hiện tại (tránh 2 người trong cùng danh sách trùng tên đăng nhập nhau).
function buildNewUserFromState(state) {
  const { username, pass, pin, name, email, phone, posType, dept, jobTitle, secondaryPositions, nghiepVuExtraKeys, reportExtraKeys, isDriver, startDate, groupIds, perms, permOverrides } = state;
  if (!pass) { alert('Vui lòng nhập mật khẩu cho người dùng mới!'); return null; }
  if (DB.users.some(u => u.username === username)) { alert('Tên đăng nhập đã tồn tại!'); return null; }
  if (pendingNewUsers.some(u => u.username === username)) { alert('Tên đăng nhập đã có trong danh sách chờ lưu!'); return null; }
  return {
    id: Date.now() + pendingNewUsers.length,
    username, pass, ...(pin && { pin }), name, email, phone, posType, dept, jobTitle, secondaryPositions, nghiepVuExtraKeys, reportExtraKeys, isDriver, startDate, perms, groupIds, permOverrides
  };
}

async function saveUser(e) {
  e.preventDefault();
  if (permFormMode === 'GROUP') return savePermGroup(e); // form đang ở chế độ Nhóm — xem savePermGroup()

  const state = readUserFormState();
  if (!state) return;
  const { editId, username, pass, pin, name, email, phone, posType, dept, jobTitle, secondaryPositions, nghiepVuExtraKeys, reportExtraKeys, isDriver, startDate, groupIds, perms, permOverrides } = state;

  // Chụp lại nguyên trạng DB.users TRƯỚC khi sửa trực tiếp trong mảng bên dưới — nếu server từ chối
  // lưu (409/400), phục hồi lại đúng bằng bản chụp này rồi render lại, tránh để "user"/DB.users bị sửa
  // dở trong bộ nhớ trình duyệt (đã đổi nhưng chưa từng được server chấp nhận) mà giao diện không hề
  // phản ánh đúng cho tới lần tải lại trang tiếp theo.
  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));
  let savedUserId = editId ? parseInt(editId, 10) : null;

  if (editId) {
    const user = DB.users.find(u => u.id === parseInt(editId, 10));
    if (user) {
      // LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Cao): 3 dòng ép quyền bên
      // dưới trước đây so theo `username` — tức tên MỚI vừa gõ trong form — nên chỉ cần đổi tên tài
      // khoản admin gốc ngay trong CÙNG lượt lưu là bỏ qua được hoàn toàn lớp khoá này (và ngược lại,
      // ai tự đổi tên mình thành "admin" sẽ tự được phong toàn quyền). Phải xét theo bản ghi ĐANG LƯU
      // trong DB (user.username, đọc TRƯỚC khi gán tên mới), khớp đúng cách server chốt chặn thật theo
      // prior.username (routes/data.js prepareUsersForSave()) — server cũng khoá luôn việc đổi tên tài
      // khoản gốc, nên ở đây giữ nguyên username cũ để giao diện không hiển thị lệch với dữ liệu thật.
      const isProtectedAdminAccount = user.username === 'admin';
      user.username = isProtectedAdminAccount ? 'admin' : username;
      // Để trống ô mật khẩu/PIN khi sửa = giữ nguyên giá trị hiện tại (server không bao giờ gửi mật
      // khẩu/PIN thật về trình duyệt để hiển thị lại, nên chỉ gửi khi admin thực sự nhập giá trị mới).
      if (pass) user.pass = pass;
      if (pin) user.pin = pin; else delete user.pin;
      user.name = name;
      user.email = email;
      user.phone = phone;
      user.posType = posType;
      user.dept = dept;
      user.jobTitle = jobTitle;
      user.secondaryPositions = secondaryPositions;
      user.nghiepVuExtraKeys = nghiepVuExtraKeys;
      user.reportExtraKeys = reportExtraKeys;
      user.isDriver = isDriver;
      user.startDate = startDate;
      // Tài khoản "admin" luôn toàn quyền, không cho sửa qua form (khối cây phân quyền đã bị khoá ở
      // editUser() khi mở form sửa đúng tài khoản này) — ép lại đây phòng trường hợp form vẫn đọc được
      // giá trị khác đi (vd DevTools bỏ qua thuộc tính disabled); server cũng ép lại lần nữa khi ghi
      // (routes/data.js) nên đây chỉ là lớp phòng vệ bổ sung, không phải chốt chặn duy nhất.
      user.perms = isProtectedAdminAccount ? { admin: true } : perms;
      user.groupIds = isProtectedAdminAccount ? [] : groupIds;
      user.permOverrides = isProtectedAdminAccount ? null : permOverrides;
    }
  } else {
    // Tạo mới ngay lập tức, lưu 1 người — nếu muốn gộp nhiều người rồi lưu 1 lần, dùng "+ Thêm Vào
    // Danh Sách" / "Lưu Tất Cả Danh Sách" (xem addUserToStagingList()/commitPendingNewUsers()).
    const newUser = buildNewUserFromState(state);
    if (!newUser) return;
    DB.users.push(newUser);
    savedUserId = newUser.id;
  }

  // Chờ server xác nhận đã lưu thật rồi mới báo thành công/dọn form — trước đây gọi syncStorage() rồi
  // báo "✅ Đã lưu..." và render lại danh sách NGAY LẬP TỨC (không đợi phản hồi), nên nếu server từ
  // chối sau đó (409 xung đột phiên bản, hoặc 400 "hệ thống sẽ không còn admin nào") người dùng đã
  // thấy thông báo thành công + giao diện coi như đã lưu xong, chỉ có thêm 1 alert lỗi hiện SAU đó gây
  // rối chứ không sửa lại được ấn tượng sai ban đầu.
  const saved = await syncStorage('users', { usersBaseline: usersSnapshot });
  if (!saved) {
    DB.users = usersSnapshot;
    renderUsers();
    return;
  }
  logSystemAction('USER_MGM', 'SAVE_USER', `Lưu thông tin người dùng [${username}]`, 'SUCCESS', username);
  alert('✅ Đã lưu thông tin người dùng và phân quyền!');
  resetUserForm();
  renderUsers();
  renderPermGroupsList();

  // Chớp sáng đúng dòng vừa lưu trong bảng — sau khi bấm "OK" ở alert() trên, admin quay lại màn hình
  // dài (nhiều người dùng) dễ mất dấu vừa sửa/thêm ai; alert() chỉ xác nhận SERVER đã chấp nhận, không
  // chỉ ra TRỰC QUAN đúng dòng nào vừa đổi. Có thể không tìm thấy dòng nếu người này đang ở trang khác/
  // bị bộ lọc ẩn — bỏ qua im lặng, không phải lỗi.
  const rowEl = savedUserId != null ? document.getElementById(`userRow_${savedUserId}`) : null;
  if (rowEl) {
    rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    rowEl.classList.add('admin-row-saved-highlight');
  }
}
