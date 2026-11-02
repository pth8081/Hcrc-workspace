#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression: email "Cần phê duyệt" gửi lúc NỘP đề xuất giá (submitItPriceApproval(),
// module-itsupport-price.js) PHẢI ghi đúng loại giá (Bán Lẻ/Bán Buôn) theo newItem.priceType, không
// còn hardcode "Bán Buôn" cho mọi đề xuất (LỖI ĐÃ VÁ 11/2026, người dùng phản ánh "quản lý lúc nhận
// được email lúc không" cho cả Mua Hàng > Phê Duyệt Giá Bán Lẻ lẫn Vận Hành > Phê Duyệt Giá Bán Buôn —
// nguyên nhân gốc là email luôn ghi sai "Bán Buôn" khiến người duyệt Bán Lẻ dễ tưởng nhầm/bỏ qua).
//
// Test THUẦN đọc lại mã nguồn (không cần Playwright) — mirror cách kiểm seedDefaults() ở
// tests/test-operation-order-receiving.js: xác nhận đúng 1 điểm gọi notifyUsersByEmail(...,
// 'NOTIFY_APPROVAL_NEEDED', ...) trong submitItPriceApproval() dùng ĐÚNG khuôn điều kiện theo
// newItem.priceType (giống hệt khuôn đã có sẵn, đúng, ở approveItPriceConfirmed() ngay bên dưới).
//
// Chạy: node tests/test-itprice-submit-email-label.js
// ==========================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${!pass && detail ? ' -- ' + detail : ''}`);
}

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'module-itsupport-price.js'), 'utf8');
const submitFnStart = src.indexOf('async function submitItPriceApproval');
const submitFnEnd = src.indexOf('\nasync function ', submitFnStart + 10);
const submitFnBody = src.slice(submitFnStart, submitFnEnd);

record('submitItPriceApproval() tồn tại và đọc được thân hàm',
  submitFnStart !== -1 && submitFnEnd !== -1 && submitFnBody.length > 100);

record('submitItPriceApproval() KHÔNG còn hardcode "Phê Duyệt Giá IT (Bán Buôn)" làm literal cố định',
  !/ticketType:\s*'Phê Duyệt Giá IT \(Bán Buôn\)'/.test(submitFnBody),
  'vẫn còn literal cố định, chưa sửa thành điều kiện theo priceType');

record('submitItPriceApproval() ghi ticketType theo ĐÚNG điều kiện newItem.priceType === \'WHOLESALE\'',
  /ticketType:\s*newItem\.priceType === 'WHOLESALE' \? 'Phê Duyệt Giá IT \(Bán Buôn\)' : 'Phê Duyệt Giá IT \(Bán Lẻ\)'/.test(submitFnBody),
  'không tìm thấy đúng biểu thức điều kiện mong đợi');

record('submitItPriceApproval() lấy summary từ wholesaleApplyUnit HOẶC priceZone (không còn luôn rỗng cho Bán Lẻ)',
  /summary:\s*newItem\.wholesaleApplyUnit \|\| \(newItem\.priceZone \? `Khu vực giá: \$\{newItem\.priceZone\}` : ''\)/.test(submitFnBody),
  'không tìm thấy đúng biểu thức summary mong đợi');

const passed = results.filter(r => r.pass).length;
const failed = results.length - passed;
console.log(`\n==== ${passed}/${results.length} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
if (failed) process.exitCode = 1;
