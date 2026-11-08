/**
 * 画质实证：直接读 m3u8 母带（master playlist）里的真实分辨率。
 *
 * 为什么要这么干：
 *   采集站的 vod_remarks 全是「更新至第X集」，靠片名猜清晰度纯属瞎蒙。
 *   但 HLS 母带里有硬信息：
 *     #EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028"
 *     https://cdn.example.com/1080p/index.m3u8
 *   读这个才是真画质，不是猜的。
 *
 * 判定链：
 *   master 里取 RESOLUTION 最大的一路 → 得到真实 WxH + 码率
 *   media playlist（含 #EXTINF）→ 没有分辨率信息，只能给码率线索，标 unknown
 */

import { fetchWithTimeout } from "./util.js";
import { memGet, memSet } from "./cache.js";

/** 分辨率 -> 画质档 */
export function tierFromResolution(w, h) {
  if (!w || !h) return { tier: "unknown", score: 0, label: "" };
  const px = w * h;
  if (w >= 3600 || h >= 2000) return { tier: "4k", score: 100, label: `${w}x${h}` };
  if (w >= 1800 || h >= 1000) return { tier: "1080p", score: 80, label: `${w}x${h}` };
  if (w >= 1200 || h >= 700) return { tier: "720p", score: 55, label: `${w}x${h}` };
  if (w >= 800 || h >= 460) return { tier: "480p", score: 30, label: `${w}x${h}` };
  return { tier: "sd", score: 10, label: `${w}x${h}` };
}

/** 解析 master playlist，返回所有 variant（按码率降序） */
export function parseMaster(text) {
  const lines = String(text || "").split(/\r?\n/);
  const variants = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;

    const attrs = line.slice("#EXT-X-STREAM-INF:".length);
    const get = (name) => {
      const m = attrs.match(new RegExp(`${name}=("[^"]*"|[^,]*)`, "i"));
      return m ? m[1].replace(/^"|"$/g, "").trim() : "";
    };

    const res = get("RESOLUTION");
    const bw = parseInt(get("BANDWIDTH"), 10) || 0;
    const avgBw = parseInt(get("AVERAGE-BANDWIDTH"), 10) || 0;
    const codecs = get("CODECS");
    const frameRate = parseFloat(get("FRAME-RATE")) || 0;

    // 下一条非注释行就是 URL
    let uri = "";
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (!l || l.startsWith("#")) continue;
      uri = l;
      break;
    }

    let w = 0, h = 0;
    if (/^\d+x\d+$/i.test(res)) {
      [w, h] = res.toLowerCase().split("x").map(Number);
    }

    variants.push({ width: w, height: h, bandwidth: bw, avgBandwidth: avgBw, codecs, frameRate, uri });
  }

  variants.sort((a, b) => (b.height - a.height) || (b.bandwidth - a.bandwidth));
  return variants;
}

/** 判断是不是 master */
export function isMaster(text) {
  return /#EXT-X-STREAM-INF:/.test(String(text || ""));
}

/** 判断是不是合法 HLS */
export function isHls(text) {
  return /^#EXTM3U/m.test(String(text || ""));
}

/** 从 media playlist 粗略估码率线索（不精确，只做参考） */
export function mediaHints(text) {
  const s = String(text || "");
  const hasFmp4 = /#EXT-X-MAP:/.test(s);
  const targetDuration = parseInt((s.match(/#EXT-X-TARGETDURATION:(\d+)/) || [])[1], 10) || 0;
  const variants = (s.match(/#EXT-X-STREAM-INF/g) || []).length;
  return { hasFmp4, targetDuration, variants };
}

/**
 * 探测一个播放地址的真实画质。
 * @returns {{ok, tier, score, label, width, height, bandwidth, variants, kind, error?}}
 */
export async function probeStream(url, { timeoutMs = 6000, useCache = true } = {}) {
  if (!/^https?:\/\//i.test(String(url || ""))) {
    return { ok: false, tier: "unknown", score: 0, error: "非法协议" };
  }

  const cacheKey = `q:${url}`;
  if (useCache) {
    const hit = memGet(cacheKey);
    if (hit) return { ...hit, cached: true };
  }

  let result;
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs,
      headers: { accept: "*/*", referer: "" },
    });

    if (!res.ok) {
      result = { ok: false, tier: "unknown", score: 0, error: `HTTP ${res.status}` };
    } else {
      // 只读前 64KB，母带不可能比这大
      const reader = res.body?.getReader();
      let text = "";
      if (reader) {
        const chunks = [];
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          bytes += value.length;
          if (bytes > 65536) { try { await reader.cancel(); } catch {} break; }
        }
        text = new TextDecoder("utf-8", { fatal: false }).decode(
          chunks.reduce((acc, c) => {
            const out = new Uint8Array(acc.length + c.length);
            out.set(acc); out.set(c, acc.length);
            return out;
          }, new Uint8Array(0))
        );
      } else {
        text = await res.text();
      }

      if (!isHls(text)) {
        // 不是 m3u8，可能是 mp4 直链
        const type = res.headers.get("content-type") || "";
        if (/video\/mp4|video\//.test(type)) {
          result = { ok: true, tier: "unknown", score: 0, kind: "mp4", note: "mp4 直链，无法从清单读分辨率" };
        } else {
          result = { ok: false, tier: "unknown", score: 0, error: "不是 HLS/视频流" };
        }
      } else if (isMaster(text)) {
        const variants = parseMaster(text);
        const best = variants[0];
        if (!best) {
          result = { ok: false, tier: "unknown", score: 0, error: "母带无 variant" };
        } else {
          const t = tierFromResolution(best.width, best.height);
          result = {
            ok: true,
            kind: "master",
            tier: t.tier,
            score: t.score,
            label: t.label,
            width: best.width,
            height: best.height,
            bandwidth: best.bandwidth,
            frameRate: best.frameRate,
            codecs: best.codecs,
            variants: variants.map((v) => ({
              resolution: v.width ? `${v.width}x${v.height}` : "?",
              bandwidth: v.bandwidth,
              codecs: v.codecs,
            })),
          };
        }
      } else {
        const hints = mediaHints(text);
        result = {
          ok: true,
          kind: "media",
          tier: "unknown",
          score: 0,
          note: "单码率清单，无分辨率元数据",
          ...hints,
        };
      }
    }
  } catch (e) {
    result = {
      ok: false,
      tier: "unknown",
      score: 0,
      error: e?.name === "AbortError" ? "超时" : String(e?.message || e).slice(0, 80),
    };
  }

  // 缓存：成功 1 小时，失败 10 分钟
  memSet(cacheKey, result, result.ok ? 3600 : 600);
  return result;
}

/** 批量探测（限并发，给列表用） */
export async function probeStreams(urls, { concurrency = 6, timeoutMs = 5000 } = {}) {
  const out = new Array(urls.length);
  let idx = 0;
  await Promise.all(
    new Array(Math.min(concurrency, urls.length)).fill(0).map(async () => {
      for (;;) {
        const i = idx++;
        if (i >= urls.length) return;
        out[i] = await probeStream(urls[i], { timeoutMs });
      }
    })
  );
  return out;
}
