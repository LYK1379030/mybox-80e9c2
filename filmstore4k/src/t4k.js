/**
 * 4K 判定与降级策略。
 *
 * ⚠️ 实证结论（2026-11 实测 11 个存活苹果CMS源、扫 1500+ 条）：
 *   采集站里**没有真正的 4K 片源**。remarks 全是「更新至第X集/已完结」，
 *   搜 "4K" 命中的是「四天王」「24k氪金神眼」这类片名误匹配。
 *   原因很直白：4K 单集 2-8GB，采集站靠广告变现，带宽成本撑不住。
 *
 * 所以本模块做两件事：
 *   1) 诚实的 4K 识别（有就标，没有就是没有，不造假）
 *   2) 画质分级降级：4K > 1080P > HD > 标清，让"清晰度优先"能真的用起来
 */

const STRONG_PATTERNS = [
  { re: /(^|[^0-9a-z])2160\s*p/i, tag: "2160P", score: 100 },
  { re: /(^|[^0-9a-z])4\s*k([^0-9a-z]|$)/i, tag: "4K", score: 100 },
  { re: /\buhd\b/i, tag: "UHD", score: 100 },
  { re: /3840\s*[x×*]\s*2160/i, tag: "3840x2160", score: 100 },
  { re: /蓝光原盘|bdmv|remux/i, tag: "原盘", score: 90 },
  { re: /dolby\s*vision|杜比视界/i, tag: "杜比视界", score: 90 },
];

const TIER_PATTERNS = [
  { re: /(^|[^0-9])1080\s*p/i, tag: "1080P", score: 60 },
  { re: /(^|[^0-9])720\s*p/i, tag: "720P", score: 40 },
  { re: /\bhd\b|高清|hd中字|hd国语/i, tag: "HD", score: 30 },
  { re: /(^|[^0-9])480\s*p|标清/i, tag: "标清", score: 10 },
];

const URL_4K = [
  { re: /\/2160p?\//i, tag: "片源2160", score: 80 },
  { re: /\/4k\//i, tag: "片源4K", score: 80 },
  { re: /3840\s*[x×*]\s*2160/i, tag: "3840x2160", score: 80 },
  { re: /\/uhd\//i, tag: "片源UHD", score: 70 },
];

/** 片名误匹配黑名单：这些词里含 4K 但不是分辨率 */
const FALSE_POSITIVE = /四天王|24k|24K|4千|4个字|4个月|4颗|4块|第4集|4号|4季|2046|1917/i;

export function guessKind(item) {
  const t = [item.type_name, item.vod_name, item.vod_remarks].filter(Boolean).join(" ");
  if (/动漫|动画|番剧|国漫/.test(t)) return "anime";
  if (/综艺|脱口秀|真人秀/.test(t)) return "variety";
  if (/纪录|记录片|纪录片/.test(t)) return "doc";
  if (/剧|电视剧|连续剧|短剧|美剧|韩剧|日剧/.test(t)) return "tv";
  if (/电影|片|movie/i.test(t)) return "movie";
  return "other";
}

/**
 * @returns {{is4k:boolean, tags:string[], score:number, tier:string}}
 */
export function detect4k(item) {
  const strongBlob = [item.vod_name, item.vod_remarks, item.type_name, item.vod_class]
    .filter(Boolean)
    .join(" ");
  const urlBlob = item.vod_play_url || "";

  const tags = [];
  let score = 0;

  // 片名误匹配保护：如果整串里有黑名单词，且没有明确 2160P/UHD，就不算 4K
  const suspicious = FALSE_POSITIVE.test(strongBlob);
  const definite = /2160\s*p|\buhd\b|3840\s*[x×*]\s*2160/i.test(strongBlob);

  for (const p of STRONG_PATTERNS) {
    if (p.re.test(strongBlob)) {
      if (suspicious && !definite && (p.tag === "4K" || p.tag === "原盘")) continue;
      tags.push(p.tag);
      score = Math.max(score, p.score);
    }
  }
  for (const p of URL_4K) {
    if (p.re.test(urlBlob)) {
      tags.push(p.tag);
      score = Math.max(score, p.score);
    }
  }

  let tier = "unknown";
  if (score >= 70) tier = "4k";
  else {
    for (const p of TIER_PATTERNS) {
      if (p.re.test(strongBlob)) {
        tags.push(p.tag);
        score = Math.max(score, p.score);
      }
    }
    if (score >= 50) tier = "1080p";
    else if (score >= 25) tier = "hd";
    else if (score > 0) tier = "sd";
  }

  return {
    is4k: score >= 70,
    tags: [...new Set(tags)],
    score,
    tier,
  };
}

export function annotate4k(item) {
  const d = detect4k(item);
  return {
    ...item,
    vod_is4k: d.is4k ? 1 : 0,
    vod_4k_tags: d.tags.join(","),
    vod_quality_tier: d.tier,
    vod_quality_score: d.score,
    vod_kind: guessKind(item),
  };
}

/** 虚拟分类（4K 为空时前端会给出说明，不展示空列表） */
export const VIRTUAL_CATS = [
  { type_id: "new", type_name: "🆕最新更新" },
  { type_id: "hd", type_name: "✨高清优先" },
  { type_id: "4k", type_name: "🔥4K专区" },
  { type_id: "4k-movie", type_name: "🎬4K电影" },
  { type_id: "4k-tv", type_name: "📺4K剧集" },
  { type_id: "4k-anime", type_name: "🌸4K动漫" },
];

export function isVirtualTypeId(t) {
  return typeof t === "string" && (t === "new" || t === "hd" || t.startsWith("4k"));
}

export function matchVirtualCat(item, typeId) {
  if (!typeId || !isVirtualTypeId(typeId)) return null;
  if (typeId === "new") return true;

  const d = detect4k(item);

  if (typeId === "hd") {
    // 高清优先：1080P / HD / 4K 都算，按分数排序由上层负责
    return d.score >= 25;
  }
  if (!d.is4k) return false;
  if (typeId === "4k") return true;

  const kind = guessKind(item);
  if (typeId === "4k-movie") return kind === "movie" || kind === "other";
  if (typeId === "4k-tv") return kind === "tv";
  if (typeId === "4k-anime") return kind === "anime";
  return false;
}
