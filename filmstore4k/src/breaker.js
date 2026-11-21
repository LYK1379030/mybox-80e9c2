/**
 * 熔断器：某个源连续失败就进入冷却期，冷却期内直接跳过，
 * 不再让死源拖垮整个聚合请求。
 *
 * 状态是进程内的（Workers isolate 各自一份），够用：
 * 边缘节点第一次请求付一次代价，之后自动剔除死源。
 */

const state = new Map(); // key -> { fails, until, lastErr, lastOkAt, okCount }

const FAIL_THRESHOLD = 2;      // 连续失败 2 次
const COOLDOWN_MS = 10 * 60_000; // 冷却 10 分钟

export function isOpen(key) {
  const s = state.get(key);
  if (!s) return false;
  if (s.until && s.until > Date.now()) return true;
  // 冷却到期，半开：放一个请求过去试
  if (s.until && s.until <= Date.now()) {
    s.until = 0;
    s.fails = Math.max(0, s.fails - 1);
  }
  return false;
}

export function recordSuccess(key) {
  const s = state.get(key) || { fails: 0, until: 0, okCount: 0 };
  s.fails = 0;
  s.until = 0;
  s.lastOkAt = Date.now();
  s.okCount = (s.okCount || 0) + 1;
  s.lastErr = null;
  state.set(key, s);
}

export function recordFailure(key, err) {
  const s = state.get(key) || { fails: 0, until: 0, okCount: 0 };
  s.fails = (s.fails || 0) + 1;
  s.lastErr = String(err || "").slice(0, 120);
  s.lastFailAt = Date.now();
  if (s.fails >= FAIL_THRESHOLD) {
    s.until = Date.now() + COOLDOWN_MS;
  }
  state.set(key, s);
}

export function breakerSnapshot() {
  const now = Date.now();
  return [...state.entries()].map(([key, s]) => ({
    key,
    open: !!(s.until && s.until > now),
    fails: s.fails || 0,
    okCount: s.okCount || 0,
    cooldownLeftSec: s.until && s.until > now ? Math.ceil((s.until - now) / 1000) : 0,
    lastErr: s.lastErr || null,
  }));
}

export function resetBreaker(key) {
  if (key) state.delete(key);
  else state.clear();
}
