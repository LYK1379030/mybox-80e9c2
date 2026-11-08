/**
 * 播放地址解析器（parse）。
 *
 * ⚠️ 关键发现（实测得出的，不是猜的）：
 *   苹果CMS 采集源返回的 vod_play_url 里，很多不是 m3u8 直链，而是形如
 *     https://vip.ffzy-play10.com/share/242cf910a10a071d305411486959674e
 *   的**分享网页**。真链藏在页面 JS 变量里：
 *     const url = "/20261108/75248_242cf910/index.m3u8?sign=...";
 *     var main = "/20261105/13746_88cba749/index.m3u8?sign=...";
 *
 *   所以「拿到播放地址」≠「能播」，必须再做一次网页解析 + 相对路径补全。
 *   不做这步，接口看着正常，实际全军覆没。
 */

import { fetchWithTimeout } from "./util.js";

/** JS 变量里可能放 m3u8 的名字，按优先级排 */
const URL_VAR_NAMES = ["url", "main", "video", "src", "m3u8", "playurl", "videoUrl", "file", "source"];

/** 从 HTML 文本里抠所有候选的 m3u8 地址（可能是相对路径） */
export function extractM3u8FromHtml(html) {
  const s = String(html || "");
  const found = [];

  // 1) 显式 m3u8 字面量（相对或绝对）
  const re = /["']([^"']*?\.m3u8[^"']*)["']/gi;
  let m;
  while ((m = re.exec(s))) {
    const u = m[1];
    if (u && !found.includes(u)) found.push(u);
  }

  // 2) 变量赋值形式：var main = "..." / const url = '...'
  for (const name of URL_VAR_NAMES) {
    const vre = new RegExp(
      `(?:var|let|const)\\s+${name}\\s*=\\s*["']([^"']+)["']`,
      "i"
    );
    const vm = s.match(vre);
    if (vm && vm[1] && !found.includes(vm[1])) {
      if (/\.m3u8|\.mp4|\/index\./i.test(vm[1])) found.unshift(vm[1]);
    }
  }

  // 3) JSON 里的 "url":"..."
  const jre = /"(?:url|playurl|video|src)"\s*:\s*"([^"]*?\.m3u8[^"]*)"/gi;
  while ((m = jre.exec(s))) {
    if (m[1] && !found.includes(m[1])) found.unshift(m[1]);
  }

  return found;
}

/** 相对路径补全 */
export function absolutize(candidate, baseUrl) {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
}

function isDirectStream(url) {
  return /\.m3u8(\?|$)|\.mp4(\?|$)/i.test(String(url || ""));
}

/**
 * 解析一个播放地址到真实可播的直链。
 *
 * @returns {{ok, direct, url, from, steps, error?}}
 *   direct=true  url 就是可直接播的 m3u8/mp4
 *   direct=false 解析失败，url 回落为原始地址（让播放器自己试）
 */
export async function resolvePlayUrl(rawUrl, { timeoutMs = 7000, maxDepth = 2, candidates = null } = {}) {
  const steps = [];

  if (!/^https?:\/\//i.test(String(rawUrl || ""))) {
    return { ok: false, direct: false, url: rawUrl, from: "invalid", steps, error: "非 http(s) 协议" };
  }

  // 已经是直链，直接返回（但还要验一下能不能真拿到 m3u8）
  if (isDirectStream(rawUrl)) {
    steps.push({ step: "already-direct", url: rawUrl });
    return { ok: true, direct: true, url: rawUrl, from: "direct", steps };
  }

  // 多线路 fallback：candidates 是同一集的多个地址（不同线路），依次试
  const queue = [rawUrl, ...(Array.isArray(candidates) ? candidates.filter((c) => c && c !== rawUrl) : [])];
  const tried = new Set();
  let lastResult = null;

  for (const target of queue) {
    if (tried.has(target)) continue;
    tried.add(target);

    const r = await resolveSingle(target, { timeoutMs, maxDepth, steps });
    if (r.ok) return { ...r, candidates: [...tried] };
    lastResult = r;
  }

  // 全部失败：回落到原始地址，让客户端播放器自己处理
  return {
    ok: false,
    direct: false,
    url: rawUrl,
    from: "fallback",
    steps,
    error: lastResult?.error || "所有线路均解析失败",
    candidates: [...tried],
  };
}

/** 单地址解析（内部），失败原因写在返回里 */
async function resolveSingle(rawUrl, { timeoutMs, maxDepth, steps }) {
  let current = rawUrl;

  for (let depth = 0; depth < maxDepth; depth++) {
    let res;
    try {
      res = await fetchWithTimeout(current, {
        timeoutMs,
        headers: { accept: "text/html,application/xhtml+xml,*/*" },
      });
    } catch (e) {
      steps.push({ step: "fetch-fail", url: current, error: String(e?.message || e).slice(0, 80) });
      break;
    }

    steps.push({ step: "fetch", url: current, status: res.status });

    if (!res.ok) break;

    const ct = res.headers.get("content-type") || "";

    // 直接就是 m3u8
    if (/mpegurl|m3u8/i.test(ct)) {
      steps.push({ step: "content-type-hls", url: current });
      return { ok: true, direct: true, url: current, from: "content-type", steps };
    }

    let body;
    try {
      body = await res.text();
    } catch {
      break;
    }

    // 本身就是 m3u8 内容
    if (/^#EXTM3U/.test(body.trim())) {
      steps.push({ step: "body-is-hls", url: current });
      return { ok: true, direct: true, url: current, from: "body", steps };
    }

    // 是网页：抠 m3u8
    const candidates = extractM3u8FromHtml(body);
    steps.push({ step: "extract", found: candidates.length, samples: candidates.slice(0, 3) });

    if (!candidates.length) break;

    // 优先选绝对地址；否则用当前页面做 base 补全
    let picked = null;
    for (const c of candidates) {
      if (/^https?:\/\//i.test(c)) { picked = c; break; }
    }
    if (!picked) picked = absolutize(candidates[0], current);
    if (!picked) break;

    current = picked;
    steps.push({ step: "resolved", url: current });

    if (isDirectStream(current)) {
      // 再验一次能不能真取到（防止 404 的假直链）
      try {
        const check = await fetchWithTimeout(current, { timeoutMs, headers: { accept: "*/*" } });
        const txt = await check.text();
        const okHls = /^#EXTM3U/.test(txt.trim());
        steps.push({ step: "verify", url: current, status: check.status, isHls: okHls });
        if (okHls) return { ok: true, direct: true, url: current, from: "page-script", steps };
        // 拿到 404 或非 HLS，这条线路失败（外层会试下一条线路）
        break;
      } catch (e) {
        steps.push({ step: "verify-fail", url: current, error: String(e?.message || e).slice(0, 60) });
        break;
      }
    }
  }

  return { ok: false, direct: false, url: rawUrl, error: "本线路未解析出可用直链" };
}

/** 批量解析（给详情接口用，限并发） */
export async function resolveMany(urls, { concurrency = 4, timeoutMs = 6000 } = {}) {
  const out = new Array(urls.length);
  let idx = 0;
  await Promise.all(
    new Array(Math.min(concurrency, urls.length)).fill(0).map(async () => {
      for (;;) {
        const i = idx++;
        if (i >= urls.length) return;
        out[i] = await resolvePlayUrl(urls[i], { timeoutMs });
      }
    })
  );
  return out;
}
