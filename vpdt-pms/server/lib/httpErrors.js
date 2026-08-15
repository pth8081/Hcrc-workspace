// lib/httpErrors.js — lớp lỗi HTTP dùng chung (status + message) giữa lib/workflowEngine.js,
// lib/createValidation.js và các route liên quan, tránh mỗi nơi tự định nghĩa lại 1 class giống hệt.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { HttpError };
