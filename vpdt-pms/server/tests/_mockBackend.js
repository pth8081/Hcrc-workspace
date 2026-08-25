// tests/_mockBackend.js — Mô phỏng backend THẬT bằng cách require() thẳng các module logic thuần của
// server (lib/createValidation.js, lib/workflowEngine.js, lib/recordActions.js) — KHÔNG tự chép lại
// luật nghiệp vụ bằng tay (tránh test tự kiểm chứng chính giả định của nó thay vì kiểm chứng app thật).
// Các file lib/* này không đụng SQL Server trực tiếp (chỉ nhận appData/collection do caller đọc sẵn),
// nên chạy được nguyên vẹn trong Node thuần — chỉ có "nơi lưu" (routes/*.js + lib/recordStore.js, có
// gọi SQL Server thật) là được thay bằng các mảng trong bộ nhớ ở đây, mô phỏng đúng hành vi routes/*.js
// đã đọc ở server: routes/create.js, routes/workflow.js, routes/records.js.
'use strict';

const path = require('path');
const LIB = path.join(__dirname, '..', 'lib');

const { HttpError } = require(path.join(LIB, 'httpErrors'));
const { CREATE_MODULE_CONFIGS, validateAndPrepareCreate } = require(path.join(LIB, 'createValidation'));
const { MODULE_CONFIGS, applyWorkflowAction } = require(path.join(LIB, 'workflowEngine'));
const recordActions = require(path.join(LIB, 'recordActions'));

// Date.now() là nguồn sinh id (validateAndPrepareCreate: `id: Date.now()`, và paymentRequests/id khi
// insert) — kịch bản test tạo nhiều bản ghi liên tiếp trong CÙNG 1 tick JS thực tế (không như người
// dùng thật gõ tay cách nhau vài giây) nên rất dễ trùng mili-giây, sinh trùng id. Ép Date.now() luôn
// tăng dần (chỉ trong tiến trình Node của bộ test này, không đụng gì tới app thật) để loại hẳn khả năng
// trùng id mà không phải sửa bất kỳ file nào của app.
let __fakeNow = Date.now();
Date.now = () => (++__fakeNow);

const ACTION_MAP = { approve: 'APPROVE', reject: 'REJECT', 'request-info': 'REQUEST_INFO', 'request-changes': 'REQUEST_CHANGES' };

function findOr404(collection, id) {
  const item = (collection || []).find(x => x.id === id);
  if (!item) throw new HttpError(404, 'Không tìm thấy hồ sơ');
  return item;
}

// state = { appData: {...}, collections: { contracts:[], paymentRequests:[], officeReqs:[],
//   budgetTemplates:[], budgetPeriods:[], budgetEntries:[] }, users: [...] }
function createMockApi(state) {
  function getUser(username) {
    const u = (state.users || []).find(x => x.username === username);
    if (!u) throw new HttpError(401, 'Chưa đăng nhập');
    return u;
  }

  // ===== POST /api/create/:module =====
  function handleCreate(moduleKey, payload, user) {
    const config = CREATE_MODULE_CONFIGS[moduleKey];
    if (!config) throw new HttpError(400, `Module không hợp lệ: ${moduleKey}`);
    const collection = state.collections[config.dbKey];
    const appDataForCreate = Object.assign({}, state.appData);
    // Khớp routes/create.js — 2 module ngân sách cần tra cứu chéo sang collection khác (không có trong
    // AppData chung, xem chú thích ở routes/create.js).
    if (moduleKey === 'budgetEntries') {
      appDataForCreate.budgetPeriods = state.collections.budgetPeriods;
      appDataForCreate.budgetTemplates = state.collections.budgetTemplates;
    }
    if (moduleKey === 'budgetPeriods') {
      appDataForCreate.budgetTemplates = state.collections.budgetTemplates;
    }
    const record = validateAndPrepareCreate(moduleKey, payload, user, collection, appDataForCreate);
    collection.unshift(record);
    return record;
  }

  // ===== POST /api/workflow/:module/:id/:action =====
  function handleWorkflow(moduleKey, idStr, rawAction, payload, user) {
    if (!MODULE_CONFIGS[moduleKey]) throw new HttpError(400, `Module không hợp lệ: ${moduleKey}`);
    const action = ACTION_MAP[rawAction];
    if (!action) throw new HttpError(400, `Hành động không hợp lệ: ${rawAction}`);
    const itemId = Number(idStr);
    if (!Number.isFinite(itemId)) throw new HttpError(400, 'id không hợp lệ');
    const dbKey = MODULE_CONFIGS[moduleKey].dbKey;
    const item = findOr404(state.collections[dbKey], itemId);
    const outcome = applyWorkflowAction({
      moduleKey, item, action, user,
      comment: payload && payload.comment, extraFields: payload && payload.extraFields,
      appData: state.appData, existingCollection: null
    });
    return { item: outcome.item, transition: outcome.transition, createdTask: null };
  }

  // ===== POST /api/records/:module/:id/:action (+ vài route không có :id) =====
  function handleRecords(segments, payload, user) {
    const [module1, idOrAction, action] = segments;

    if (module1 === 'contracts') {
      const id = Number(idOrAction);
      const item = findOr404(state.collections.contracts, id);
      if (action === 'edit') {
        const all = state.collections.contracts;
        const hasAddenda = all.some(c => c.isAddendum && c.rootContractId === id);
        const root = item.isAddendum ? all.find(c => c.id === item.rootContractId) : undefined;
        const appDataForEdit = item.isAddendum ? null : state.appData;
        const result = recordActions.editContract(payload, user, item, hasAddenda, root && root.dept, appDataForEdit, root && root.custodianDept);
        return { item: result };
      }
      if (action === 'upload-signed') {
        const result = recordActions.uploadContractSignedFile(payload, user, item);
        return { item: result };
      }
      if (action === 'start-payment') {
        const draft = recordActions.startContractPayment(user, item);
        const paymentRequest = Object.assign({}, draft, { id: Date.now() });
        state.collections.paymentRequests.unshift(paymentRequest);
        return { item, paymentRequest };
      }
      if (action === 'delete') {
        state.collections.contracts = state.collections.contracts.filter(c => c.id !== id);
        return { ok: true };
      }
      throw new HttpError(400, `Hành động không hợp lệ: ${action}`);
    }

    if (module1 === 'officeReqs') {
      const id = Number(idOrAction);
      const item = findOr404(state.collections.officeReqs, id);
      if (action === 'upload-signed') {
        const result = recordActions.uploadOfficeSignedFile(payload, user, item);
        return { item: result };
      }
      if (action === 'start-payment') {
        const draft = recordActions.startOfficePayment(user, item);
        const paymentRequest = Object.assign({}, draft, { id: Date.now() });
        state.collections.paymentRequests.unshift(paymentRequest);
        return { item, paymentRequest };
      }
      throw new HttpError(400, `Hành động không hợp lệ: ${action}`);
    }

    if (module1 === 'paymentRequests') {
      if (idOrAction === 'from-source') {
        if (!recordActions.canManagePaymentRequests(user)) throw new HttpError(403, 'Bạn không có quyền tạo đề nghị thanh toán');
        const sourceModule = String((payload && payload.sourceModule) || '');
        const sourceId = Number(payload && payload.sourceId);
        if (!Number.isFinite(sourceId)) throw new HttpError(400, 'sourceId không hợp lệ');
        const overrides = { title: payload && payload.title, installments: payload && payload.installments, skipManageGate: true };
        let draft, result;
        if (sourceModule === 'CONTRACT') {
          result = findOr404(state.collections.contracts, sourceId);
          draft = recordActions.startContractPayment(user, result, overrides);
        } else if (['MUA_BAN', 'SUA_CHUA', 'DAU_TU'].includes(sourceModule)) {
          result = findOr404(state.collections.officeReqs, sourceId);
          draft = recordActions.startOfficePayment(user, result, overrides);
        } else {
          throw new HttpError(400, 'Loại đề nghị không hợp lệ');
        }
        const paymentRequest = Object.assign({}, draft, { id: Date.now() });
        state.collections.paymentRequests.unshift(paymentRequest);
        return { item: result, paymentRequest };
      }

      const id = Number(idOrAction);
      if (action === 'edit') {
        const item = findOr404(state.collections.paymentRequests, id);
        return { item: recordActions.editPaymentRequest(payload, user, item) };
      }
      if (action === 'request-info') {
        const item = findOr404(state.collections.paymentRequests, id);
        return { item: recordActions.requestPaymentInfo(payload, user, item) };
      }
      if (action === 'approve') {
        const item = findOr404(state.collections.paymentRequests, id);
        return { item: recordActions.approvePaymentRequest(user, item) };
      }
      if (action === 'delete') {
        const item = findOr404(state.collections.paymentRequests, id);
        recordActions.assertCanDeletePaymentRequest(user, item);
        state.collections.paymentRequests = state.collections.paymentRequests.filter(x => x.id !== id);
        if (item.sourceModule && item.sourceId != null) {
          const sourceCollection = item.sourceModule === 'CONTRACT' ? state.collections.contracts : state.collections.officeReqs;
          const src = sourceCollection.find(x => x.id === item.sourceId);
          if (src && src.paymentStatus === 'CHO_THANH_TOAN') src.paymentStatus = 'CHUA_THANH_TOAN';
        }
        return { ok: true };
      }
      if (action === 'confirm-installment') {
        const item = findOr404(state.collections.paymentRequests, id);
        const outcome = recordActions.confirmPaymentInstallment(payload, user, item);
        if (outcome.justCompleted && outcome.item.sourceModule && outcome.item.sourceId != null) {
          const sourceCollection = outcome.item.sourceModule === 'CONTRACT' ? state.collections.contracts : state.collections.officeReqs;
          const src = sourceCollection.find(x => x.id === outcome.item.sourceId);
          if (src) src.paymentStatus = 'DA_THANH_TOAN';
        }
        return { item: outcome.item, justCompleted: outcome.justCompleted };
      }
      throw new HttpError(400, `Hành động không hợp lệ: ${action}`);
    }

    if (module1 === 'budgetPeriods') {
      const id = Number(idOrAction);
      const item = findOr404(state.collections.budgetPeriods, id);
      if (action === 'close') return { item: recordActions.closeBudgetPeriod(user, item) };
      if (action === 'reopen') return { item: recordActions.reopenBudgetPeriod(user, item, payload && payload.endTime) };
      throw new HttpError(400, `Hành động không hợp lệ: ${action}`);
    }

    if (module1 === 'budgetEntries') {
      const id = Number(idOrAction);
      const item = findOr404(state.collections.budgetEntries, id);
      if (action === 'submit') {
        const period = state.collections.budgetPeriods.find(p => p.id === item.periodId);
        return { item: recordActions.submitBudgetEntry(user, item, period) };
      }
      if (action === 'update') {
        const period = state.collections.budgetPeriods.find(p => p.id === item.periodId);
        return { item: recordActions.updateBudgetEntryDraft(user, item, payload, period, state.collections.budgetTemplates) };
      }
      throw new HttpError(400, `Hành động không hợp lệ: ${action}`);
    }

    if (module1 === 'budgetTemplates') {
      const id = Number(idOrAction);
      const item = findOr404(state.collections.budgetTemplates, id);
      if (action === 'update') return { item: recordActions.updateBudgetTemplate(user, item, payload) };
      throw new HttpError(400, `Hành động không hợp lệ: ${action}`);
    }

    throw new HttpError(404, `Không có route cho module: ${module1}`);
  }

  // handle(method, url, bodyStr, username) — url luôn bắt đầu bằng "/api/..." (đường dẫn tương đối).
  async function handle(method, url, bodyStr, username) {
    let payload = {};
    if (bodyStr) {
      try { payload = JSON.parse(bodyStr); } catch (e) { payload = {}; }
    }
    const pathname = url.split('?')[0];
    const parts = pathname.split('/').filter(Boolean); // ['api','create','contracts'] v.v.

    try {
      const user = username ? getUser(username) : null;

      if (parts[0] === 'api' && parts[1] === 'create' && parts.length === 3) {
        const item = handleCreate(parts[2], payload, user);
        return { status: 200, body: { ok: true, item } };
      }
      if (parts[0] === 'api' && parts[1] === 'workflow' && parts.length === 5) {
        const result = handleWorkflow(parts[2], parts[3], parts[4], payload, user);
        return { status: 200, body: Object.assign({ ok: true }, result) };
      }
      if (parts[0] === 'api' && parts[1] === 'records') {
        const result = handleRecords(parts.slice(2), payload, user);
        return { status: 200, body: Object.assign({ ok: true }, result) };
      }
      return { status: 404, body: { error: `Không rõ route: ${pathname}` } };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
      // Lỗi không lường trước — in ra để dễ debug thay vì nuốt im lặng, khớp hành vi console.error() ở
      // các route thật khi rơi vào nhánh 500.
      console.error(`MOCK API lỗi (${method} ${url}):`, err.stack || err.message);
      return { status: 500, body: { error: err.message || 'Lỗi không xác định' } };
    }
  }

  return { handle };
}

module.exports = { createMockApi };
