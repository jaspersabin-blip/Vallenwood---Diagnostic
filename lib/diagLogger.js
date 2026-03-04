// lib/diagLogger.js

export function createDiagLogger(req) {
  const startedAt = Date.now();
  const steps = [];

  return {
    start() {
      console.log("[diag] start", { path: req?.url, method: req?.method });
    },
    mark() {
      return Date.now();
    },
    step(name, t0, extra) {
      steps.push({ name, ms: Date.now() - t0, ...extra });
      console.log("[diag] step", { name, ms: Date.now() - t0, ...extra });
    },
    log(msg, obj) {
      console.log("[diag]", msg, obj || "");
    },
    error(msg, obj) {
      console.error("[diag]", msg, obj || "");
    },
    finish(status) {
      console.log("[diag] finish", { status, ms: Date.now() - startedAt, steps });
    },
  };
}