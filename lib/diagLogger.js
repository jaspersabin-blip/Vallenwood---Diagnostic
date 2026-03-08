// lib/diagLogger.js
// Minimal request logger used by api/diagnostic.js

export function createDiagLogger(req) {
  const startedAt = Date.now();
  const id = `${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;

  function baseCtx() {
    return {
      id,
      method: req?.method,
      path: req?.url,
      ua: req?.headers?.["user-agent"],
      ip:
        req?.headers?.["x-forwarded-for"] ||
        req?.headers?.["x-real-ip"] ||
        req?.socket?.remoteAddress,
    };
  }

  return {
    id,

    start() {
      console.log("[diag] start", baseCtx());
    },

    mark() {
      return Date.now();
    },

    step(name, t0, extra) {
      console.log("[diag] step", {
        ...baseCtx(),
        step: name,
        ms: Date.now() - (t0 || startedAt),
        ...(extra || {}),
      });
    },

    log(message, extra) {
      console.log("[diag] log", { ...baseCtx(), message, ...(extra || {}) });
    },

    error(message, extra) {
      console.error("[diag] error", { ...baseCtx(), message, ...(extra || {}) });
    },

    finish(status) {
      console.log("[diag] finish", {
        ...baseCtx(),
        status,
        total_ms: Date.now() - startedAt,
      });
    },
  };
}