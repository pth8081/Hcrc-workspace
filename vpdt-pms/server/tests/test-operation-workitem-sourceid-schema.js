// server/tests/test-operation-workitem-sourceid-schema.js
//
// Test THUẦN (không cần SQL Server thật) cho bug production "Vận Hành > Siêu Thị > Thực hiện: không
// tạo được công việc GỐC — toast chung chung ⛔ Không thể xử lý yêu cầu".
//
// GỐC RỄ THẬT (xác nhận qua trace tay + POST thật vào routes/records.js với SQL layer giả lập kiểu dữ
// liệu SQL Server, KHÔNG chỉ qua testHarness.js — testHarness mock thẳng state.operationWorkItems, bỏ
// qua hoàn toàn lib/operationWorkItemStore.js nên KHÔNG thể lộ bug lớp này):
//   dbo.OperationWorkItems.SourceId từng bị tạo kiểu INT (tối đa ~2.1 tỷ) trong khi giá trị luôn là id
//   kiểu Date.now() (~1.7 nghìn tỷ — VƯỢT TRẦN INT ngay lập tức). Bug này ĐÃ được phát hiện + fix trong
//   sql/schema.sql (khối ALTER COLUMN tự chạy an toàn nhiều lần, xem comment ngay trên CREATE TABLE
//   dbo.OperationWorkItems) từ 1 đợt merge trước (VERSION.md bản 6.4) — NHƯNG đó là script CHẠY TAY,
//   quản trị viên phải tự chạy lại trên SQL Server thật mỗi khi schema.sql đổi (xem CLAUDE.md). Nếu quên
//   chạy lại, cột SourceId trên CSDL thật VẪN còn INT dù code đã đúng từ lâu — MỌI lần tạo công việc Thực
//   hiện thật vẫn lỗi, nhưng giờ lỗi SQL Server thô (không phải HttpError) lọt qua handleError()
//   (routes/records.js) thành toast chung chung, không ai biết đường sửa.
//
// FIX (lib/operationWorkItemStore.js): assertSourceIdColumnIsBigInt() dò TRỰC TIẾP kiểu cột thật qua
// INFORMATION_SCHEMA.COLUMNS trước khi insert/update — nếu vẫn INT, ném HttpError với thông báo RÕ RÀNG,
// chỉ đúng hướng khắc phục (chạy lại schema.sql) thay vì để lỗi SQL Server thô lọt ra ngoài. Test này
// giả lập 1 "pool" tối thiểu (không cần SQL Server thật) để xác nhận đúng hành vi 3 tình huống: cột còn
// INT (phải chặn + thông báo rõ), cột đã BIGINT (phải cho qua), và cache (không dò lại 1 khi đã xác nhận
// BIGINT, tự dò lại nếu CHƯA xác nhận — không cần khởi động lại server sau khi quản trị chạy schema.sql).
//
// Chạy: node server/tests/test-operation-workitem-sourceid-schema.js
const assert = require('assert');
const { HttpError } = require('../lib/httpErrors');

let passed = 0, failed = 0;
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}

// Pool giả tối thiểu: chỉ cần .request().query() trả về đúng hình dạng recordset mà
// assertSourceIdColumnIsBigInt() đọc (SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS ...).
function fakePool(dataType) {
  let queryCount = 0;
  return {
    request: () => ({
      query: async () => { queryCount++; return { recordset: dataType ? [{ DATA_TYPE: dataType }] : [] }; }
    }),
    get queryCount() { return queryCount; }
  };
}

async function main() {
  // Mỗi kịch bản cần state module-level (sourceIdColumnConfirmedBigInt) SẠCH — xoá cache require để mỗi
  // testAsync() dưới đây lấy 1 bản instance riêng, không rò trạng thái giữa các kịch bản khác nhau.
  function freshStore() {
    delete require.cache[require.resolve('../lib/operationWorkItemStore')];
    return require('../lib/operationWorkItemStore');
  }

  await testAsync('assertSourceIdColumnIsBigInt: cột CÒN "int" (chưa chạy lại schema.sql) — chặn với thông báo RÕ hướng khắc phục', async () => {
    const { assertSourceIdColumnIsBigInt } = freshStore();
    const pool = fakePool('int');
    await assert.rejects(
      () => assertSourceIdColumnIsBigInt(pool),
      (err) => {
        assert(err instanceof HttpError, 'Phải là HttpError (không phải lỗi SQL Server thô lọt ra ngoài)');
        assert.strictEqual(err.status, 500);
        assert(err.message.includes('SourceId'), 'Thông báo phải nêu rõ tên cột');
        assert(err.message.includes('schema.sql'), 'Thông báo phải chỉ rõ hướng khắc phục (chạy lại schema.sql)');
        return true;
      }
    );
  });

  await testAsync('assertSourceIdColumnIsBigInt: cột đã "bigint" (đã chạy lại schema.sql đúng) — cho qua, không lỗi', async () => {
    const { assertSourceIdColumnIsBigInt } = freshStore();
    const pool = fakePool('bigint');
    await assertSourceIdColumnIsBigInt(pool); // không throw = pass
  });

  await testAsync('assertSourceIdColumnIsBigInt: đã xác nhận "bigint" 1 lần thì KHÔNG dò lại (cache trong tiến trình)', async () => {
    const store = freshStore();
    const pool = fakePool('bigint');
    await store.assertSourceIdColumnIsBigInt(pool);
    assert.strictEqual(pool.queryCount, 1);
    await store.assertSourceIdColumnIsBigInt(pool);
    assert.strictEqual(pool.queryCount, 1, 'Lần gọi thứ 2 phải dùng cache, không query lại INFORMATION_SCHEMA');
  });

  await testAsync('assertSourceIdColumnIsBigInt: CHƯA xác nhận (còn "int") thì TỰ DÒ LẠI mỗi lần — tự nhận ra ngay khi quản trị vừa chạy xong schema.sql, không cần khởi động lại server', async () => {
    const store = freshStore();
    const poolStillInt = fakePool('int');
    await assert.rejects(() => store.assertSourceIdColumnIsBigInt(poolStillInt));
    assert.strictEqual(poolStillInt.queryCount, 1);
    // Quản trị viên vừa chạy xong schema.sql — lần gọi kế tiếp (dù cùng tiến trình, không restart) phải
    // dò lại và thấy đã đúng "bigint", không bị kẹt ở kết quả lỗi cache từ lần trước.
    const poolNowBigint = fakePool('bigint');
    await store.assertSourceIdColumnIsBigInt(poolNowBigint);
    assert.strictEqual(poolNowBigint.queryCount, 1);
  });

  await testAsync('insertWorkItem(): cột còn "int" — HttpError rõ ràng thay vì lỗi SQL Server thô, KHÔNG chạm tới INSERT thật', async () => {
    const store = freshStore();
    let insertCalled = false;
    const pool = {
      request: () => ({
        input() { return this; },
        query: async (sqlText) => {
          if (/INFORMATION_SCHEMA/.test(sqlText)) return { recordset: [{ DATA_TYPE: 'int' }] };
          insertCalled = true; // KHÔNG được tới đây — phải chặn trước khi build câu INSERT thật
          return { recordset: [] };
        }
      })
    };
    // Monkeypatch getPool() nội bộ module qua require cache của '../db' — đơn giản hơn: gọi thẳng hàm
    // exported assertSourceIdColumnIsBigInt() với pool giả (đã test ở trên) là đủ để phủ đúng logic; ở
    // đây xác nhận thêm insertWorkItem() THẬT SỰ gọi guard này trước khi insert bằng cách require lại db.js.
    require.cache[require.resolve('../db')] = { exports: { getPool: async () => pool, sql: require('../db').sql } };
    delete require.cache[require.resolve('../lib/operationWorkItemStore')];
    const { insertWorkItem } = require('../lib/operationWorkItemStore');
    await assert.rejects(
      () => insertWorkItem({ id: Date.now(), status: 'CHUA_BAT_DAU', parentWorkItemId: null, sourceType: 'OPERATION_REPAIR', sourceId: Date.now() }),
      (err) => { assert(err instanceof HttpError); assert(err.message.includes('schema.sql')); return true; }
    );
    assert.strictEqual(insertCalled, false, 'insertWorkItem() phải chặn TRƯỚC khi build câu INSERT, không được thử insert rồi mới lỗi mập mờ');
    delete require.cache[require.resolve('../db')];
    delete require.cache[require.resolve('../lib/operationWorkItemStore')];
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
