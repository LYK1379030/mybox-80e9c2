/**
 * 4K 网盘聚合源 —— 真正承载 4K 片源的载体。
 *
 * 背景（实测结论，不猜）：
 *   苹果CMS 采集站 0 个 4K（32 个候选实测全灭，scripts/harvest-4k-sources.js 可复现）。
 *   真正的 4K 片源（原盘/REMUX/HDR）在网盘里：阿里云盘、夸克、115、天翼。
 *   TVBox 生态里网盘源用的是 drpy/py 插件协议，不走 api.php。
 *
 * 本模块做的事：
 *   1. 聚合公开的网盘搜索接口（阿里云盘搜索、夸克搜索的公开镜像）
 *   2. 对每个结果标注画质（片名里的 4K/2160P/REMUX/HDR/原盘标记）
 *   3. 输出 TVBox 网盘源兼容的格式
 *
 * 数据源：公开网盘搜索引擎（无需登录即可搜，资源来自分享链接）
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 画质标记识别（片名驱动的，网盘资源片名里画质信息非常全） */
const QUALITY_PATTERNS = [
  { re: /2160\s*[pP]|\b4K\b(?!\d)|3840x2160/i, tag: "4K", score: 100 },
  { re: /REMUX|原盘|BDMV|BD\b/i, tag: "原盘", score: 95 },
  { re: /HDR10\+?|Dolby\s*Vision|杜比视界|\bDV\b/i, tag: "HDR", score: 90 },
  { re: /1080\s*[pP]/i, tag: "1080P", score: 70 },
  { re: /720\s*[pP]/i, tag: "720P", score: 40 },
];

/** 声轨/字幕信息（片名里的） */
const AUDIO_PATTERNS = [
  { re: /杜比全景声|Atmos/i, tag: "全景声" },
  { re: /TrueHD|DTS-?HD|LPCM/i, tag: "无损音轨" },
  { re: /简繁|双语|中字|简中|繁中/i, tag: "中字" },
];

/** 网盘类型识别 */
const PAN_PATTERNS = [
  { re: /阿里|aliyun|alipan/i, tag: "阿里云盘" },
  { re: /夸克|quark/i, tag: "夸克网盘" },
  { re: /115|115盘/i, tag: "115网盘" },
  { re: /天翼|189/i, tag: "天翼云盘" },
  { re: /百度|baidu/i, tag: "百度网盘" },
  { re: /迅雷|xunlei/i, tag: "迅雷云盘" },
  { re: /移动|彩云/i, tag: "移动云盘" },
];

export function detectQuality(item) {
  const name = String(item.name || item.vod_name || "");
  const hits = [];
  let score = 0;
  for (const p of QUALITY_PATTERNS) {
    if (p.re.test(name)) {
      hits.push(p.tag);
      score = Math.max(score, p.score);
    }
  }
  const audio = AUDIO_PATTERNS.filter((p) => p.re.test(name)).map((p) => p.tag);
  const pans = PAN_PATTERNS.filter((p) => p.re.test(name)).map((p) => p.tag);
  return { score, tags: hits, audio, pans, is4k: score >= 90 };
}

/** 网盘搜索源配置（公开接口，无需 key） */
const PAN_SOURCES = [
  {
    key: "pansearch",
    name: "网盘搜索聚合",
    // 顶点网盘搜索的公开接口（聚合阿里/夸克/115/天翼）
    api: "https://so.252035.xyz/api/search",
    type: "pansearch",
    enabled: true,
  },
  {
    key: "yunpanxun",
    name: "云盘搜索引擎",
    api: "https://www.yunso.net/api/search",
    type: "yunso",
    enabled: true,
  },
];

async function fetchJson(url, params, timeoutMs = 8000) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  try {
    const res = await fetch(u.toString(), {
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return { err: `HTTP ${res.status}` };
    const txt = await res.text();
    return JSON.parse(txt.replace(/^\uFEFF/, ""));
  } catch (e) {
    return { err: e.name === "TimeoutError" ? "超时" : String(e.message || e).slice(0, 50) };
  }
}

/** 统一化网盘搜索结果 */
function normalizePanResult(raw, sourceKey) {
  // 不同引擎字段名不一样，做一层归一
  const name = String(raw.name || raw.title || raw.filename || "").trim();
  if (!name) return null;
  return {
    name,
    url: String(raw.url || raw.link || raw.page || ""),
    pan: String(raw.pan || raw.drive || ""),
    size: String(raw.size || raw.filesize || ""),
    time: String(raw.time || raw.date || raw.created_at || ""),
    source: sourceKey,
  };
}

/**
 * 聚合网盘 4K 搜索
 * @returns {{ok, keyword, count, list, sources}}
 */
export async function searchPan4k(keyword, { limit = 30, timeoutMs = 8000 } = {}) {
  const kw = String(keyword || "").trim();
  if (!kw) return { ok: false, keyword: "", count: 0, list: [], sources: [], error: "空关键词" };

  const results = [];
  const stats = [];

  await Promise.all(
    PAN_SOURCES.filter((s) => s.enabled).map(async (s) => {
      const t0 = Date.now();
      const data = await fetchJson(s.api, { kw, wd: kw, q: kw, page: 1, limit: 50 }, timeoutMs);
      if (data.err) {
        stats.push({ key: s.key, ok: false, ms: Date.now() - t0, error: data.err });
        return;
      }
      // 兼容 {list:[]} / {data:[]} / {results:[]} / 数组直接返回
      const rawList = Array.isArray(data) ? data : data.list || data.data || data.results || [];
      const items = rawList.map((r) => normalizePanResult(r, s.key)).filter(Boolean);
      stats.push({ key: s.key, ok: true, ms: Date.now() - t0, count: items.length });
      results.push(...items);
    })
  );

  // 画质标注 + 排序（4K 优先）
  const annotated = results.map((r) => {
    const q = detectQuality(r);
    return { ...r, ...q, vod_name: r.name };
  });
  annotated.sort((a, b) => {
    const d = b.score - a.score;
    if (d !== 0) return d;
    return (b.time || "").localeCompare(a.time || "");
  });

  return {
    ok: true,
    keyword: kw,
    count: annotated.length,
    list: annotated.slice(0, limit),
    sources: stats,
  };
}

/** TVBox 网盘源配置格式 */
export function buildPanSiteConfig(origin) {
  return {
    key: "pan_4k",
    name: "🔥 4K网盘聚合",
    type: 3,
    api: `${origin}/api/pan4k?wd=`,
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    ext: { note: "聚合阿里/夸克/115/天翼网盘的 4K 原盘资源，点击结果跳转网盘链接" },
  };
}
