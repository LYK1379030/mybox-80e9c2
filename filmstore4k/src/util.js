export const UA_STRING =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      ...CORS,
      ...extra,
    },
  });
}

export function text(s, status = 200, extra = {}) {
  return new Response(String(s), {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...CORS, ...extra },
  });
}

export function html(s, status = 200) {
  return new Response(String(s), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export function noContent() {
  return new Response(null, { status: 204, headers: CORS });
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 并发上限受控的 map */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = { ok: false, error: String(e?.message || e) };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/** 带超时的 fetch（AbortController，Workers / Node18+ 均可用） */
export async function fetchWithTimeout(url, { timeoutMs = 8000, headers = {}, method = "GET" } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      headers: { "user-agent": UA_STRING, accept: "application/json, text/plain, */*", ...headers },
      signal: ctrl.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

export function str(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

export function int(v, d = 0) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** 从任意文本里抠出第一个 JSON 对象/数组（应对部分源返回 BOM、多余前后缀） */
export function looseJsonParse(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/^\uFEFF/, "").trim();
  try {
    return JSON.parse(s);
  } catch {}
  const objStart = s.search(/[[{]/);
  if (objStart < 0) return null;
  const lastCurly = s.lastIndexOf("}");
  const lastBracket = s.lastIndexOf("]");
  const end = Math.max(lastCurly, lastBracket);
  if (end <= objStart) return null;
  const slice = s.slice(objStart, end + 1);
  try {
    return JSON.parse(slice);
  } catch {}
  return null;
}
