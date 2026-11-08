/**
 * 限流 + 防放大。
 *
 * 攻击面：本项目所有接口都是公开无鉴权的读接口，
 * 但每次调用会放大成 N 次上游请求（N = 源数量，现在 11）。
 * 不加限制的话，一个脚本就能把上游全打一遍、把我们额度耗光。
 */

const buckets = new Map();

/** 令牌桶：每个 key 每分钟 max 次 */
export function rateLimit(key, { max = 120, windowMs = 60_000 } = {}) {
  const now = Date.now();
  let b = buckets.get(key);

  if (!b || now - b.start >= windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }

  b.count++;

  // 顺手清理过期桶，防止 Map 无限增长（内存泄漏）
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now - v.start >= windowMs) buckets.delete(k);
    }
  }

  const remaining = Math.max(0, max - b.count);
  const reset = Math.ceil((b.start + windowMs - now) / 1000);
  return {
    ok: b.count <= max,
    limit: max,
    remaining,
    reset,
    used: b.count,
  };
}

/** 取客户端标识：Workers 用 CF-Connecting-IP，本地用 x-forwarded-for */
export function clientKey(request) {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    (h.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "local"
  );
}

/**
 * 上游放大预算：
 * 每次请求最多打多少个上游，防止 ?scan=999 这种参数把源打穿。
 */
export function clampScan(n, hardMax = 3) {
  const v = parseInt(String(n), 10);
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(hardMax, v));
}

/** 搜索词护栏：限制长度、去掉控制字符 */
export function sanitizeKeyword(kw, maxLen = 50) {
  let s = String(kw || "");
  // 去掉控制字符和零宽字符
  s = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, "");
  s = s.trim().slice(0, maxLen);
  return s;
}
