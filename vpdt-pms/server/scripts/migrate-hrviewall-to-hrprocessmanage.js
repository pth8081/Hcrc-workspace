// scripts/migrate-hrviewall-to-hrprocessmanage.js — Script MỘT LẦN, chạy thủ công SAU KHI đã deploy code
// đợt vá 96 phát hiện audit vòng 2 (v23.70). Bản vá tách quyền GHI mới `hrProcessManage` ra khỏi
// `hrViewAll` (trước đây nhãn "chỉ xem" nhưng thực chất cho phép hoàn thành/bỏ qua mọi task Onboarding/
// Offboarding — xem lib/recordActions.js: canActOnHrTask()/canManageHrProcess()). Sau khi deploy code
// mới mà KHÔNG chạy script này, mọi tài khoản đang có `hrViewAll` sẽ MẤT khả năng thao tác (chỉ còn
// xem) — người dùng đã xác nhận muốn GIỮ NGUYÊN khả năng thao tác như trước cho các tài khoản này, nên
// cần cấp thêm `hrProcessManage` cho toàn bộ tài khoản đang có `hrViewAll`.
//
// AN TOÀN — script CHỈ THÊM, KHÔNG XOÁ, KHÔNG ĐỤNG QUYỀN KHÁC:
//   - Chỉ set thêm `perms.hrProcessManage = true` cho user đang có `perms.hrViewAll === true` VÀ chưa
//     có `hrProcessManage`. Không đổi/xoá bất kỳ field nào khác của user (kể cả `hrViewAll` — giữ
//     nguyên, không tắt).
//   - Idempotent — chạy lại nhiều lần an toàn: user đã có `hrProcessManage` rồi thì tự bỏ qua.
//   - User thuộc 1+ Nhóm Phân Quyền (có `groupIds`/`groupId`) — `perms` của họ bị TÍNH LẠI TỪ ĐẦU
//     (quyền nhóm + `permOverrides`) mỗi lần admin lưu users/permGroups qua UI (xem
//     server/routes/data.js:602-608, prepareUsersForSave()), nên chỉ set `perms.hrProcessManage` thôi
//     sẽ "biến mất" ở lần sửa kế tiếp. Với nhóm user này, script set THÊM cả
//     `permOverrides.hrProcessManage = true` để quyền không bị mất khi perms được build lại.
//   - Dùng `withLockedAppDataValue('users', ...)` (lib/appData.js) — tự khoá dòng (UPDLOCK, HOLDLOCK)
//     trong 1 giao dịch + tự invalidate cache liên tiến trình (PM2 cluster), không có ai ghi đè giữa
//     chừng.
//
// KHUYẾN NGHỊ BẮT BUỘC trước khi chạy trên server thật: sao lưu CSDL trước.
//
// CHẠY NHƯ THẾ NÀO (từ thư mục server/, .env phải có sẵn ở đó — script tự nạp qua db.js):
//   1. node scripts/migrate-hrviewall-to-hrprocessmanage.js            -> chỉ LIỆT KÊ & XEM TRƯỚC
//                                                                          (dry-run), KHÔNG ghi gì.
//   2. node scripts/migrate-hrviewall-to-hrprocessmanage.js --confirm  -> GHI THẬT.

const { getPool } = require('../db');
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');

function describeUser(u) {
  const groupNote = (u.groupIds && u.groupIds.length) || u.groupId ? ' [thuộc Nhóm Phân Quyền]' : '';
  return `${u.username} (${u.name || ''})${groupNote}`;
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const pool = await getPool();

  console.log(confirm
    ? '🚀 GHI THẬT — sẽ cấp thêm perms.hrProcessManage (+ permOverrides nếu thuộc Nhóm Phân Quyền) cho mọi user đang có hrViewAll và chưa có hrProcessManage.'
    : 'ℹ️  DRY-RUN — chỉ liệt kê, CHƯA ghi gì. Chạy lại với --confirm để ghi thật.');

  const usersNow = await getAppDataValue('users');
  if (!Array.isArray(usersNow)) {
    console.error('⛔ Không đọc được dữ liệu users từ AppData (không phải mảng) — dừng, không ghi gì.');
    await pool.close();
    process.exit(1);
  }

  const candidates = usersNow.filter(u => u?.perms?.hrViewAll === true && u?.perms?.hrProcessManage !== true);
  const alreadyDone = usersNow.filter(u => u?.perms?.hrViewAll === true && u?.perms?.hrProcessManage === true);

  console.log(`\n📦 users: tổng ${usersNow.length} | đang có hrViewAll: ${candidates.length + alreadyDone.length} | cần cấp thêm hrProcessManage: ${candidates.length} | đã có sẵn (bỏ qua, idempotent): ${alreadyDone.length}`);
  if (candidates.length) {
    console.log('\n   Danh sách sẽ được cấp thêm hrProcessManage:');
    for (const u of candidates) console.log(`   - ${describeUser(u)}`);
  }
  if (alreadyDone.length) {
    console.log('\n   Đã có hrProcessManage từ trước (bỏ qua):');
    for (const u of alreadyDone) console.log(`   - ${describeUser(u)}`);
  }

  if (!confirm || candidates.length === 0) {
    console.log(candidates.length === 0
      ? '\n✅ Không có user nào cần cập nhật — không phải ghi gì.'
      : '\nℹ️  Đây là DRY-RUN — chưa ghi gì cả. Chạy lại với --confirm để ghi thật.');
    await pool.close();
    return;
  }

  const candidateUsernames = new Set(candidates.map(u => u.username));
  const updated = await withLockedAppDataValue('users', (list) => list.map((u) => {
    if (!candidateUsernames.has(u.username)) return u;
    const perms = { ...u.perms, hrProcessManage: true };
    const hasGroup = (u.groupIds && u.groupIds.length) || u.groupId;
    const permOverrides = hasGroup ? { ...(u.permOverrides || {}), hrProcessManage: true } : u.permOverrides;
    return { ...u, perms, permOverrides };
  }));

  const nowHas = updated.filter(u => candidateUsernames.has(u.username) && u.perms?.hrProcessManage === true).length;
  console.log(`\n✅ Đã cấp hrProcessManage cho ${nowHas}/${candidates.length} user${nowHas === candidates.length ? '' : ' — ⚠️ CÓ SAI LỆCH, kiểm tra lại thủ công'}.`);

  await pool.close();
}

main().catch(err => {
  console.error('⛔ Lỗi khi chạy script migrate hrViewAll -> hrProcessManage:', err);
  process.exit(1);
});
