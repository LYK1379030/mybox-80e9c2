#!/usr/bin/env node
/**
 * 自有筛选线路生成器 · 最终零风险定稿
 * ===================================================================
 * 基准：DESIGN_ZERO_RISK.md（8 条可验证指标）+ DESIGN_RISKS.md（R01/R02/R03/R04/R07/R11）
 *       + DESIGN_RESEARCH.md（cat-researcher 的零 jar drpy2 契约，稍后对齐）
 *
 * 与上一版（复用第三方 URL 配置 / 规则运行时并发抓 14 源）彻底切割：
 *   · 零 jar            → filter-line.json 的 spider 为空，CI 断言
 *   · 零运行时外网      → spider-filter.js 全文恰好 1 个 req() 调用点、1 个 URL
 *   · 零第三方依赖      → 规则/数据/配置全在用户自己仓库，Pages + jsDelivr 同源分发
 *   · 零 ANR            → CI 每日预生成 filter-data.json（≤500KB），规则只本地过滤
 *   · 零停更            → 任何失败 exit 0；源站全挂沿用上一版数据 + stale:true
 *
 * 产出（4 个，全部纯静态、固定文件名）：
 *   dist/filter-data.json       CI 预生成静态片单 + 四排 filters + 索引
 *   dist/spider-filter.js       drpy2 规则（export __jsEvalReturn，1 次 req）
 *   dist/filter-line.json       完整 TVBox 子仓配置（spider 空、type:3）
 *   dist/filter-manifest.json   说明 + 校验信息（零 jar / req 计数 / filters 形状 / stale）
 *
 * 本地跑：FILTER_OUT / FILTER_POOL / FILTER_LIST 可覆盖；CI 里默认写
 *   <repo>/filmstore4k/dist（与 build.py 的读取路径一致）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

/** 解析输出目录：CI 里是 <repo>/filmstore4k/dist；本地是 <project>/dist
 *  生成器位于 <repo>/filmstore4k/scripts/，故仓库根 = dirname(dirname(dirname(__dirname)))。
 *  build.py 读的正是 <repo>/filmstore4k/dist/filter-*.json，必须对齐。 */
function resolveDist() {
  if (process.env.FILTER_OUT) return process.env.FILTER_OUT;
  const repoRoot = dirname(dirname(rootDir));          // filmstore4k/scripts -> <repo>
  const ciDist = join(repoRoot, "filmstore4k", "dist");
  if (existsSync(ciDist)) return ciDist;
  const localDist = join(rootDir, "dist");            // 本地开发：filmstore4k/dist
  if (existsSync(localDist)) return localDist;
  return ciDist;                                     // 首跑目录不存在也按 CI 路径返回，由 ensureDir 创建
}
function resolvePool(dist) {
  if (process.env.FILTER_POOL) return process.env.FILTER_POOL;
  const p = join(dist, "source-pool.json");
  if (existsSync(p)) return p;
  const repoRoot = dirname(dirname(rootDir));
  const ci = join(repoRoot, "filmstore4k", "dist", "source-pool.json");
  return existsSync(ci) ? ci : p;
}
const outDir = resolveDist();
const poolPath = resolvePool(outDir);
const listPath = process.env.FILTER_LIST || join(rootDir, "scripts", "filter-lines.json");

const CURRENT_UTC_YEAR = new Date().getUTCFullYear();
const GENERATED_AT = new Date().toISOString();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_DATA_URL = "https://lyk1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/filter-data.json";
const TIMEOUT_MS = 8000;
const CONCURRENCY = 8;

// ═══════════════════════════════════════════════════════════════════
// drpy2 契约常量（lead 要求集中在顶部；researcher 结论回来只改这一处）
// ═══════════════════════════════════════════════════════════════════
const DRPY2_CONTRACT = {
  source: "DESIGN_RESEARCH.md / DESIGN_ZERO_RISK.md / DESIGN_RISKS.md",
  engine: "drpy2-builtin（APK 内置 QuickJS，零 jar）",
  exportFn: "__jsEvalReturn",
  globalName: "__JS_SPIDER__",
  methods: ["homeContent", "homeVodContent", "categoryContent", "detailContent", "searchContent", "playerContent"],
  returnType: "JSON-string",
  filtersShape: "object-of-arrays: {'<type_id>':[{key,name,value:[{n,v}]}]}",
  filterKeys: ["类型", "地区", "排序", "年代"],
  categoryArg: "extend（第 4 参）；第 3 参 filter 是布尔开关，绝不作为值字典",
  siteType: 3,
  siteApi: "__SELF__/spider-filter.js",  // build.py _emit 时替换成各通道绝对前缀
  spider: "",                            // 零 jar：CI 断言必须为空
  ext: "",                               // Site.ext 是 String
  requestCallPoints: 1,
  pendingResearcher: [
    "site.type 精确取值（当前按同壳惯例 3，DESIGN_RISKS §1 标为真机未验）",
    "site.api 是否必须含 .js 之外还要 assets:// 前缀（当前纯同源 URL）",
    "__JS_SPIDER__ 方法返回 String 还是 Object（当前按 String）",
    "extend 里筛选键名是中文『类型/地区/年代/排序』还是英文 key（当前中文优先 + 英文兜底）",
  ],
};

// 规则内也要用的契约副本（序列化注入规则顶部）
const RULE_CONTRACT = {
  source: DRPY2_CONTRACT.source,
  exportFn: DRPY2_CONTRACT.exportFn,
  methods: DRPY2_CONTRACT.methods,
  returnType: DRPY2_CONTRACT.returnType,
  filtersShape: DRPY2_CONTRACT.filtersShape,
  filterKeys: DRPY2_CONTRACT.filterKeys,
  categoryArg: DRPY2_CONTRACT.categoryArg,
  dataFile: "filter-data.json",
};

process.on("unhandledRejection", (e) => warn("unhandledRejection", e));
process.on("uncaughtException", (e) => warn("uncaughtException", e));

function fmt(x) {
  if (x instanceof Error) return x.message || String(x);
  if (typeof x === "string") return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}
function warn(...a) { try { console.warn("[filter] WARN " + a.map(fmt).join(" ")); } catch {} }
function log(...a) { try { console.log("[filter] " + a.map(fmt).join(" ")); } catch {} }
function ensureOut() { try { if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true }); } catch (e) { warn("建输出目录失败", e); } }
function writeText(name, text) {
  try { ensureOut(); writeFileSync(join(outDir, name), text, "utf8"); return true; }
  catch (e) { warn("写入失败 " + name, e); return false; }
}
function writeJson(name, obj) { return writeText(name, JSON.stringify(obj, null, 2)); }

/** 清单：坏掉/缺失都用内置默认，绝不中断 */
function readList() {
  const def = {
    name: "筛选·自有（每日抽样·本地过滤）",
    enabled: true, samplePages: 2, perBucketMax: 60, maxItems: 400,
    maxBytes: 512000, dataUrl: DEFAULT_DATA_URL,
    note: "按类型/地区/年代筛选由本仓库自有规则本地实现；片量为每日抽样，非全量。",
  };
  try {
    if (!existsSync(listPath)) { warn("清单不存在，用默认配置"); return def; }
    const j = JSON.parse(readFileSync(listPath, "utf8").replace(/^\uFEFF/, ""));
    const l = (Array.isArray(j?.lines) ? j.lines : []).find((x) => x && x.enabled !== false) || {};
    return { ...def, ...l };
  } catch (e) { warn("清单读取失败，用默认配置", e); return def; }
}

/** 源池：只取 http(s) CMS 接口，去重；异常/空池返回 []（不中断） */
function readSources() {
  try {
    if (!existsSync(poolPath)) { warn("source-pool.json 不存在，使用空源列表"); return []; }
    const j = JSON.parse(readFileSync(poolPath, "utf8").replace(/^\uFEFF/, ""));
    const alive = Array.isArray(j?.alive) ? j.alive : (Array.isArray(j?.sources) ? j.sources : []);
    const seen = new Set(), out = [];
    for (const s of alive) {
      const api = String(s?.api || "").trim();
      if (!/^https?:\/\//i.test(api)) continue;
      if (!/api\.php|provide\/vod/i.test(api)) continue;
      if (seen.has(api)) continue;
      seen.add(api);
      out.push({
        key: String(s.key || s.name || ("src" + out.length)).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32),
        name: String(s.name || s.key || "未命名").replace(/[\u0000-\u001f<>"'&]/g, "").trim().slice(0, 24),
        api,
      });
    }
    return out;
  } catch (e) { warn("读取源池失败，使用空源列表", e); return []; }
}

// ═══════════════════════════════════════════════════════════════════
// 年代 / 片名归一化：优先复用 src/decades.js（只读 import，不改它），失败则内置兜底
// ═══════════════════════════════════════════════════════════════════
let D = null;
try { D = await import("../src/decades.js"); log("已复用 src/decades.js 的年份/年代/归一化规则"); }
catch (e) { warn("src/decades.js 载入失败，改用内置同口径实现", e); }

const YEAR_MIN = 1900;
const YEAR_MAX = CURRENT_UTC_YEAR + 1;
const UNKNOWN_DECADE = D?.UNKNOWN_DECADE || "年代不详";
const OLDER_DECADE = D?.OLDER_DECADE || "更早";
const LOWEST_DECADE_START = D?.LOWEST_DECADE_START || 1980;
const FULL_LABEL_FROM = D?.FULL_LABEL_FROM || 2000;

function parseVodYear(raw) {
  if (D?.parseVodYear) return D.parseVodYear(raw);
  if (raw === null || raw === undefined) return null;
  let s = String(raw);
  try { s = s.normalize("NFKC").trim(); } catch { s = s.trim(); }
  s = s.replace(/年$/, "").trim();
  if (!/^(19|20)\d{2}$/.test(s)) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX ? n : null;
}
function decadeLabel(d) {
  if (d >= FULL_LABEL_FROM) return String(d) + "年代";
  return String(d % 100) + "年代";
}
function buildDecadeKeys() {
  if (D?.DECADE_KEYS?.length) return [...D.DECADE_KEYS];
  const top = Math.floor(CURRENT_UTC_YEAR / 10) * 10;
  const keys = [];
  for (let d = top; d >= LOWEST_DECADE_START; d -= 10) keys.push(decadeLabel(d));
  keys.push(OLDER_DECADE, UNKNOWN_DECADE);
  return keys;
}
const DECADE_KEYS = buildDecadeKeys();
function decadeOf(raw) {
  if (D?.decadeOf) return D.decadeOf(raw);
  const y = parseVodYear(raw);
  if (y === null) return UNKNOWN_DECADE;
  const d = Math.floor(y / 10) * 10;
  if (d < LOWEST_DECADE_START) return OLDER_DECADE;
  const label = decadeLabel(d);
  return DECADE_KEYS.includes(label) ? label : DECADE_KEYS[0];
}
/** R29 归一化：只剥画质后缀，保留季/部序号，避免续集被误合并 */
function normalizeName(name) {
  if (D?.normalizeVodName) return D.normalizeVodName(name);
  let s = String(name || "");
  try { s = s.normalize("NFKC"); } catch {}
  s = s.toLowerCase().replace(/[\s\-_.·•【】\[\]()（）「」《》:：,，!！?？'"]+/g, "");
  const seq = s.match(/第([0-9一二三四五六七八九十百零两]+)(季|部|集)$/);
  if (seq) s = s.slice(0, -seq[0].length) + "-seq" + (seq[2] === "季" ? "s" : seq[2] === "部" ? "p" : "e") + seq[1];
  const tail = /(4k|8k|2k|蓝光|原盘|超清|高清|标清|hdr|杜比|remux|uhd|hd|bd|dvd|ts|tc|抢先|完整|全集|完结|国语|粤语|中字|字幕|修复|未删减|导演剪辑|加长|完整版|tv版|剧场版|dolby|vision|10bit|60帧|无损)+$/;
  let prev; do { prev = s; s = s.replace(tail, ""); } while (s !== prev);
  return s;
}

// ═══════════════════════════════════════════════════════════════════
// 网络：CI 侧并发抓 ?ac=videolist&pg=1..samplePages；单源失败跳过
// ═══════════════════════════════════════════════════════════════════
function buildUrl(api, params) {
  const u = new URL(api);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}
async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*" },
      signal: ctrl.signal, redirect: "follow",
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}
function parseLoose(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").trim();
  const tries = [raw, raw.replace(/\/\/[^\n]*/g, "").replace(/,(\s*[}\]])/g, "$1")];
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) tries.push(raw.slice(a, b + 1));
  for (const t of tries) { try { return JSON.parse(t); } catch {} }
  return null;
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(new Array(Math.min(limit, Math.max(items.length, 1))).fill(0).map(async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); } catch (e) { warn("取数任务异常", e); out[i] = null; }
    }
  }));
  return out;
}

async function collectRaw(sources, samplePages) {
  const jobs = [];
  for (const s of sources) for (let pg = 1; pg <= samplePages; pg++) jobs.push({ s, pg });
  log("取数计划 " + jobs.length + " 个请求（每源 " + samplePages + " 页），并发 " + CONCURRENCY);
  const results = await mapLimit(jobs, CONCURRENCY, async (job) => {
    try {
      const j = parseLoose(await fetchText(buildUrl(job.s.api, { ac: "videolist", pg: job.pg })));
      return Array.isArray(j?.list) ? j.list : [];
    } catch (e) { warn("跳过 " + job.s.key + " pg=" + job.pg, e); return []; }
  });
  const pool = [], seen = new Set();
  let okSources = 0;
  const perSource = {};
  for (let i = 0; i < jobs.length; i++) {
    const sk = jobs[i].s.key;
    const list = results[i] || [];
    if (list.length) okSources++;
    perSource[sk] = (perSource[sk] || 0) + list.length;
    for (const it of list) {
      if (!it || typeof it !== "object" || !String(it.vod_name || "").trim()) continue;
      const k = normalizeName(it.vod_name);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      pool.push({ ...it, _source: sk, _source_name: jobs[i].s.name });
    }
  }
  return { pool, okSources, perSource };
}

// ═══════════════════════════════════════════════════════════════════
// 静态数据：class / 四排 filters / list / 索引（每档 ≤60、总量与字节上限）
// ═══════════════════════════════════════════════════════════════════
const TYPE_WORDS = ["喜剧", "爱情", "动作", "科幻", "动画", "悬疑", "犯罪", "惊悚", "冒险", "历史", "奇幻", "恐怖", "战争", "传记", "歌舞", "武侠", "灾难", "西部", "纪录片", "剧情", "短剧", "综艺"];
const AREA_WORDS = ["华语", "中国大陆", "中国香港", "中国台湾", "欧美", "美国", "韩国", "日本", "英国", "法国", "德国", "意大利", "西班牙", "印度", "泰国", "俄罗斯", "加拿大", "其他"];
const SORT_OPTIONS = [{ n: "近期热度", v: "hot" }, { n: "首映时间", v: "time" }, { n: "高分优先", v: "score" }];
const CLASSES = [
  { type_id: "all", type_name: "全部" },
  { type_id: "movie", type_name: "电影" },
  { type_id: "tv", type_name: "剧集" },
  { type_id: "anime", type_name: "动漫" },
  { type_id: "variety", type_name: "综艺" },
  { type_id: "doc", type_name: "纪录" },
  { type_id: "short", type_name: "短剧" },
  { type_id: "sports", type_name: "体育" },
];
function classOf(it) {
  const s = String(it.vod_class || "") + " " + String(it.type_name || "") + " " + String(it.vod_name || "");
  if (/短剧|爽文/.test(s)) return "short";
  if (/动漫|动画/.test(s)) return "anime";
  if (/综艺|真人秀|脱口秀/.test(s)) return "variety";
  if (/纪录|记录/.test(s)) return "doc";
  if (/体育|NBA|足球|篮球|斯诺克/.test(s)) return "sports";
  if (/剧|连续剧/.test(s)) return "tv";
  return "movie";
}
function typeTags(it) {
  const s = String(it.vod_class || "") + " " + String(it.type_name || "");
  const out = [];
  for (const w of TYPE_WORDS) if (s.includes(w)) out.push(w);
  return out;
}
function areaTag(it) {
  const a = String(it.vod_area || "").trim();
  return a && a !== "未知" && a !== "暂无" ? a : "";
}
function cleanItem(it, i) {
  const play = String(it.vod_play_url || "");
  let playUrl = "";
  const m = play.match(/https?:\/\/[^\s$,#]+/);
  if (m) playUrl = m[0];
  else if (/^https?:\/\//.test(play)) playUrl = play;
  return {
    vod_id: String(it._source || "src") + ":" + String(it.vod_id || it.vod_name || i),
    vod_name: String(it.vod_name || ""),
    vod_pic: String(it.vod_pic || ""),
    vod_remarks: String(it.vod_remarks || ""),
    vod_year: String(it.vod_year || ""),
    vod_area: areaTag(it),
    vod_class: String(it.vod_class || ""),
    vod_score: String(it.vod_score || ""),
    vod_time: String(it.vod_time || ""),
    type_name: String(it.type_name || ""),
    type_id: classOf(it),
    decade: decadeOf(it.vod_year),
    types: typeTags(it),
    _source: String(it._source || ""),
    vod_play_from: String(it.vod_play_from || ""),
    vod_play_url: playUrl,
    vod_content: String(it.vod_content || it.vod_name || ""),
    vod_actor: String(it.vod_actor || ""),
    vod_director: String(it.vod_director || ""),
  };
}

/** 四排 filters：object-of-arrays，首层 key 严格等于 class[].type_id（R03） */
function buildFilters(items) {
  const typeSet = new Set(TYPE_WORDS), areaSet = new Set(AREA_WORDS), decadeSet = new Set(DECADE_KEYS);
  for (const it of items) {
    for (const t of it.types) typeSet.add(t);
    if (it.vod_area) areaSet.add(it.vod_area);
  }
  // 年代档固定全列（动态生成，防缓存滞后），类型/地区为固定词表 + 真实出现项
  const typeVals = [{ n: "全部", v: "" }].concat([...typeSet].map((x) => ({ n: x, v: x })));
  const areaVals = [{ n: "全部", v: "" }].concat([...areaSet].map((x) => ({ n: x, v: x })));
  const sortVals = [{ n: "全部", v: "" }].concat(SORT_OPTIONS);
  const decVals = [{ n: "全部", v: "" }].concat(DECADE_KEYS.map((k) => ({ n: k, v: k })));
  const rows = [
    { key: "类型", name: "类型", value: typeVals },
    { key: "地区", name: "地区", value: areaVals },
    { key: "排序", name: "排序", value: sortVals },
    { key: "年代", name: "年代", value: decVals },
  ];
  const filters = {};
  for (const c of CLASSES) filters[c.type_id] = rows;
  return filters;
}

function buildIndexes(items, perBucketMax) {
  const byType = {}, byArea = {}, byDecade = {}, byClass = {};
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    for (const t of it.types) (byType[t] ||= []).push(i);
    if (it.vod_area) (byArea[it.vod_area] ||= []).push(i);
    (byDecade[it.decade] ||= []).push(i);
    (byClass[it.type_id] ||= []).push(i);
    (byClass.all ||= []).push(i);
  }
  const cap = (o) => { for (const k of Object.keys(o)) o[k] = o[k].slice(0, perBucketMax); return o; };
  return { byType: cap(byType), byArea: cap(byArea), byDecade: cap(byDecade), byClass: cap(byClass) };
}

/** 组装数据并强制 ≤ maxBytes：超出就逐条裁剪 list 与索引后重写 */
function buildData(rawPool, cfg, metaExtra) {
  const maxItems = Number(cfg.maxItems) || 400;
  const perBucketMax = Number(cfg.perBucketMax) || 60;
  let items = rawPool.slice(0, maxItems).map(cleanItem);
  let data = null;
  for (;;) {
    data = {
      _meta: {
        generated: GENERATED_AT,
        samplePages: Number(cfg.samplePages) || 2,
        countIsSample: true,
        currentUtcYear: CURRENT_UTC_YEAR,
        decadeKeys: DECADE_KEYS,
        ...metaExtra,
        note: "片量为每日抽样（每源 pg=1..samplePages），非全量片库；按类型/地区/年代筛选由本仓库自有规则本地实现，不代表用户可见全库条数。",
      },
      "class": CLASSES,
      filters: buildFilters(items),
      list: items,
      index: buildIndexes(items, perBucketMax),
      buckets: {
        type: Object.fromEntries(Object.entries(buildIndexes(items, perBucketMax).byType).map(([k, v]) => [k, v.length])),
        area: Object.fromEntries(Object.entries(buildIndexes(items, perBucketMax).byArea).map(([k, v]) => [k, v.length])),
        decade: Object.fromEntries(DECADE_KEYS.map((k) => [k, items.filter((x) => x.decade === k).length])),
      },
    };
    const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
    if (bytes <= Number(cfg.maxBytes || 512000) || items.length <= 0) { data._meta.bytes = bytes; break; }
    items = items.slice(0, Math.max(0, Math.floor(items.length * 0.8)));
  }
  return data;
}

/** 合法空数据：四排选项仍在、list 空、索引空（R11 不白屏） */
function emptyData(cfg, metaExtra) { return buildData([], cfg, metaExtra); }

// ═══════════════════════════════════════════════════════════════════
// drpy2 规则模板
// 硬约束：全文恰好 1 个 req( 调用点、恰好 1 个 http(s) URL、无其它网络调用
// ═══════════════════════════════════════════════════════════════════
const RULE_TEMPLATE = String.raw`/**
 * spider-filter.js —— 自有 drpy2 规则（scripts/build-filter-lines.mjs 每日生成）
 *
 * 契约来源：DESIGN_RESEARCH.md（cat-researcher 零 jar drpy2 版）、
 *           DESIGN_ZERO_RISK.md（8 条零风险指标）、DESIGN_RISKS.md（R01/R02/R03/R04）。
 * 加载链：APK assets/js/lib/spider.js
 *   import * as spider from '%s'
 *   globalThis.__JS_SPIDER__ = spider.__jsEvalReturn()
 * → 本文件必须导出 __jsEvalReturn()，返回 6 个 *Content 方法（R01）。
 *
 * 零 jar：filter-line.json 的 spider 为空，走内置 QuickJS，不触发 JarLoader。
 * 零运行时外网：全文只有 1 个网络读取调用点（homeContent 内），指向自托管静态数据；
 *   无循环抓源、无第二个 URL、无同步并发（R04 防 ANR）。
 * 零白屏：数据拉取失败时返回固定 class + 固定四排 filters + 空 list（R11）。
 *
 * 三处静默空页陷阱已按契约锁死：
 *   R01 导出名：见 __jsEvalReturn 返回对象
 *   R02 categoryContent 只用第 4 参 extend 取点选值，第 3 参 filter 仅当布尔开关
 *   R03 filters 为 object-of-arrays，首层 key 严格等于 class[].type_id
 */

var CONTRACT = /*__CONTRACT__*/;
var GENERATED_AT = /*__GENERATED_AT__*/;
var CURRENT_UTC_YEAR = /*__CURRENT_YEAR__*/;
var DECADE_KEYS = /*__DECADE_KEYS__*/;
var CLASSES = /*__CLASSES__*/;
var TYPE_WORDS = /*__TYPE_WORDS__*/;
var AREA_WORDS = /*__AREA_WORDS__*/;
var SORT_OPTIONS = /*__SORT_OPTIONS__*/;
var PAGE_SIZE = 20;

var DATA = null;
var DATA_ATTEMPTED = false;

function jstr(o) { try { return JSON.stringify(o); } catch (e) { return '{}'; } }
function s(x) { return x === null || x === undefined ? '' : String(x); }
function logMsg() {
  try {
    var a = []; for (var i = 0; i < arguments.length; i++) a.push(s(arguments[i]));
    if (typeof log === 'function') log('[own-filter] ' + a.join(' '));
    else if (typeof print === 'function') print('[own-filter] ' + a.join(' '));
  } catch (e) {}
}

/** 固定四排 filters（数据缺失时兜底；首层 key 严格等于 class type_id） */
function fallbackFilters() {
  var typeVals = [{ n: '全部', v: '' }];
  for (var i = 0; i < TYPE_WORDS.length; i++) typeVals.push({ n: TYPE_WORDS[i], v: TYPE_WORDS[i] });
  var areaVals = [{ n: '全部', v: '' }];
  for (var j = 0; j < AREA_WORDS.length; j++) areaVals.push({ n: AREA_WORDS[j], v: AREA_WORDS[j] });
  var sortVals = [{ n: '全部', v: '' }];
  for (var k = 0; k < SORT_OPTIONS.length; k++) sortVals.push(SORT_OPTIONS[k]);
  var decVals = [{ n: '全部', v: '' }];
  for (var d = 0; d < DECADE_KEYS.length; d++) decVals.push({ n: DECADE_KEYS[d], v: DECADE_KEYS[d] });
  var rows = [
    { key: '类型', name: '类型', value: typeVals },
    { key: '地区', name: '地区', value: areaVals },
    { key: '排序', name: '排序', value: sortVals },
    { key: '年代', name: '年代', value: decVals }
  ];
  var f = {};
  for (var c = 0; c < CLASSES.length; c++) f[CLASSES[c].type_id] = rows;
  return f;
}

/** 唯一一次网络读取：只在 homeContent 内、只调 1 次、只指向自托管静态数据 */
function homeContent() {
  if (!DATA_ATTEMPTED) {
    DATA_ATTEMPTED = true;
    try {
      var raw = req(/*__DATA_URL__*/);
      DATA = JSON.parse(raw);
      if (!DATA || !DATA.list) DATA = null;
    } catch (e) {
      DATA = null;
      logMsg('静态数据读取失败，使用空数据兜底', e && e.message);
    }
  }
  var cls = DATA && DATA['class'] && DATA['class'].length ? DATA['class'] : CLASSES;
  var filters = DATA && DATA.filters ? DATA.filters : fallbackFilters();
  var list = DATA && DATA.list ? DATA.list.slice(0, PAGE_SIZE) : [];
  return jstr({ 'class': cls, filters: filters, list: list });
}

/** 其余方法只触发一次数据读取，之后全在内存里跑，绝不再次联网 */
function ensure() {
  if (!DATA_ATTEMPTED) homeContent();
  return DATA;
}
function pool() { var d = ensure(); return d && d.list ? d.list : []; }

function homeVodContent() {
  return jstr({ list: pool().slice(0, PAGE_SIZE) });
}

/** 第 4 参 extend = 点选值字典；第 3 参 filter 只是布尔开关，绝不读它当值（R02） */
function categoryContent(tid, pg, filter, extend) {
  var fl = extend;
  if (typeof fl === 'string') { try { fl = JSON.parse(fl); } catch (e) { fl = {}; } }
  if (!fl || typeof fl !== 'object') fl = {};
  var type = pick(fl, ['类型', 'type', 'genre']);
  var area = pick(fl, ['地区', 'area', 'region']);
  var decade = pick(fl, ['年代', 'year', 'decade']);
  var sort = pick(fl, ['排序', 'sort', 'by']);
  // 面板里的聚合选项（华语/欧美…）在源站数据里是具体国家（中国大陆/内地/美国…），
  // 精确子串匹配会 0 条。把聚合词展开成别名集合，命中任一即算该档。
  var AREA_ALIAS = {
    '华语': ['华语', '中国大陆', '中国香港', '中国台湾', '大陆', '内地', '港澳', '香港', '台湾', '中国'],
    '欧美': ['欧美', '美国', '英国', '法国', '德国', '意大利', '西班牙', '加拿大', '俄罗斯', '澳大利亚', '比利时', '荷兰', '巴西'],
    '韩国': ['韩国', '韩'],
    '日本': ['日本', '日'],
    '泰国': ['泰国', '泰'],
    '印度': ['印度']
  };
  function areaHit(cell, want) {
    if (!want) return true;
    var c = s(cell);
    var words = AREA_ALIAS[want] || [want];
    for (var w = 0; w < words.length; w++) if (c.indexOf(words[w]) >= 0) return true;
    return false;
  }
  var arr = [];
  var all = pool();
  for (var i = 0; i < all.length; i++) {
    var it = all[i];
    if (tid && tid !== 'all' && s(it.type_id) !== s(tid)) continue;
    if (type && s(it.vod_class).indexOf(type) < 0 && s(it.type_name).indexOf(type) < 0 && !(it.types || []).join(',').includes(type)) continue;
    if (!areaHit(it.vod_area, area)) continue;
    if (decade && s(it.decade) !== decade) continue;
    arr.push(it);
  }
  if (sort === 'score' || sort === '高分优先') {
    arr.sort(function (a, b) { return (parseFloat(b.vod_score) || 0) - (parseFloat(a.vod_score) || 0); });
  } else {
    arr.sort(function (a, b) { return s(b.vod_time).localeCompare(s(a.vod_time)); });
  }
  var p = parseInt(pg, 10) || 1;
  var start = (p - 1) * PAGE_SIZE;
  return jstr({
    list: arr.slice(start, start + PAGE_SIZE),
    page: p,
    pagecount: Math.max(1, Math.ceil(arr.length / PAGE_SIZE)),
    limit: PAGE_SIZE,
    total: arr.length
  });
}
function pick(fl, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = fl[keys[i]];
    if (v !== undefined && v !== null && s(v) !== '' && s(v) !== '全部') return s(v);
  }
  return '';
}

function searchContent(wd, quick, pg) {
  var kw = s(wd).trim().toLowerCase();
  if (!kw) return jstr({ list: [] });
  var out = [], all = pool();
  for (var i = 0; i < all.length && out.length < PAGE_SIZE * 3; i++) {
    if (s(all[i].vod_name).toLowerCase().indexOf(kw) >= 0) out.push(all[i]);
  }
  return jstr({ list: out, page: parseInt(pg, 10) || 1, pagecount: 1, total: out.length });
}

/** 详情：入参可能是数组或字符串；只从内存数据取，不联网 */
function detailContent(ids) {
  var list = Array.isArray(ids) ? ids : [ids];
  var out = [], all = pool();
  for (var n = 0; n < list.length && n < 20; n++) {
    var id = s(list[n]);
    for (var i = 0; i < all.length; i++) {
      if (s(all[i].vod_id) !== id) continue;
      var v = {};
      for (var k in all[i]) if (Object.prototype.hasOwnProperty.call(all[i], k)) v[k] = all[i][k];
      v.vod_content = s(v.vod_content || v.vod_name);
      out.push(v);
      break;
    }
  }
  return jstr({ list: out });
}

/** 播放：返回数据里的播放地址；无解析、无嗅探、无联网 */
function playerContent(flag, id, flags) {
  var all = pool(), url = '';
  for (var i = 0; i < all.length; i++) {
    var it = all[i];
    if (s(it.vod_id) === s(id) || s(it.vod_play_url) === s(id)) { url = s(it.vod_play_url); break; }
  }
  if (!url && /^https?:\/\//.test(s(id))) url = s(id);
  return jstr({ parse: 0, url: url, header: {} });
}

/** R01：导出名严格为 6 个 *Content 方法，形状集中由 CONTRACT.methods 声明 */
export function __jsEvalReturn() {
  return {
    homeContent: homeContent,
    homeVodContent: homeVodContent,
    categoryContent: categoryContent,
    detailContent: detailContent,
    searchContent: searchContent,
    playerContent: playerContent,
    __contract: CONTRACT
  };
}
// fallback 分支（spider.js 的 default 分支）；同样导出 6 个方法名
export default __jsEvalReturn;
`;

function renderRule(cfg) {
  return RULE_TEMPLATE
    .replace("/*__CONTRACT__*/", JSON.stringify(RULE_CONTRACT, null, 2))
    .replace("/*__GENERATED_AT__*/", JSON.stringify(GENERATED_AT))
    .replace("/*__CURRENT_YEAR__*/", String(CURRENT_UTC_YEAR))
    .replace("/*__DECADE_KEYS__*/", JSON.stringify(DECADE_KEYS))
    .replace("/*__CLASSES__*/", JSON.stringify(CLASSES))
    .replace("/*__TYPE_WORDS__*/", JSON.stringify(TYPE_WORDS))
    .replace("/*__AREA_WORDS__*/", JSON.stringify(AREA_WORDS))
    .replace("/*__SORT_OPTIONS__*/", JSON.stringify(SORT_OPTIONS))
    .replace("/*__DATA_URL__*/", JSON.stringify(String(cfg.dataUrl || DEFAULT_DATA_URL)));
}

function renderConfig(cfg) {
  return {
    spider: DRPY2_CONTRACT.spider, // 零 jar：CI 断言为空
    notice: "自有规则本地筛选·每日抽样·零第三方依赖；按类型/地区/年代筛选由本仓库规则本地实现，片量为每日抽样，非全量。",
    wallpaper: "",
    sites: [{
      key: "own_filter",
      name: String(cfg.name || "筛选·自有（每日抽样·本地过滤）"),
      type: DRPY2_CONTRACT.siteType,
      api: DRPY2_CONTRACT.siteApi, // __SELF__/spider-filter.js，emit 时替换成通道绝对前缀
      ext: DRPY2_CONTRACT.ext,
      filterable: 1,
      searchable: 1,
      quickSearch: 1,
      changeable: 0,
    }],
    lives: [],
    parses: [],
    flags: [],
    _meta: {
      generated: GENERATED_AT,
      producer: "scripts/build-filter-lines.mjs",
      engine: DRPY2_CONTRACT.engine,
      zeroJar: true,
      dataFile: "filter-data.json",
      ruleFile: "spider-filter.js",
    },
  };
}

/** 静态断言：返回 {reqCalls, urls, md5, csp, spiderEmpty, filtersShapeValid, checks[]} */
function audit(ruleText, config, data) {
  const reqCalls = (ruleText.match(/\b(?:req|request|fetch)\s*\(/g) || []).length;
  const urls = (ruleText.match(/https?:\/\//g) || []).length;
  const cfgText = JSON.stringify(config);
  const md5 = cfgText.includes(";md5;");
  const csp = cfgText.includes("csp_");
  const spiderEmpty = !config.spider;
  const classIds = (data?.["class"] || CLASSES).map((c) => c.type_id);
  const f = data?.filters || {};
  let filtersShapeValid = !!f && typeof f === "object" && !Array.isArray(f) &&
    classIds.every((id) => Array.isArray(f[id]) && f[id].length === 4 &&
      f[id].every((row) => row && typeof row.key === "string" && typeof row.name === "string" &&
        Array.isArray(row.value) && row.value.every((v) => v && "n" in v && "v" in v))) &&
    Object.keys(f).every((k) => classIds.includes(k));
  const checks = [
    { name: "零 jar（spider 为空）", pass: spiderEmpty, actual: JSON.stringify(config.spider) },
    { name: "无 ;md5;", pass: !md5, actual: md5 ? "found" : "none" },
    { name: "无 csp_ 站点", pass: !csp, actual: csp ? "found" : "none" },
    { name: "request 调用点恰好 1", pass: reqCalls === 1, actual: reqCalls },
    { name: "规则内 URL 恰好 1", pass: urls === 1, actual: urls },
    { name: "filters object-of-arrays + key=type_id", pass: filtersShapeValid, actual: Object.keys(f).join(",") },
  ];
  return { reqCalls, urls, md5, csp, spiderEmpty, filtersShapeValid, checks };
}

async function main() {
  const t0 = Date.now();
  const cfg = readList();
  const sources = readSources();
  log("源池存活 " + sources.length + " 个，CURRENT_UTC_YEAR=" + CURRENT_UTC_YEAR + "，输出目录 " + outDir);

  // ① 抓样本
  let rawPool = [], okSources = 0, perSource = {};
  try {
    const r = await collectRaw(sources, Number(cfg.samplePages) || 2);
    rawPool = r.pool; okSources = r.okSources; perSource = r.perSource;
  } catch (e) { warn("取数阶段异常，按全失败处理", e); }
  log("归一化去重后 " + rawPool.length + " 条，有效源 " + okSources + "/" + sources.length);

  // ② 全失败：沿用上一版数据 + stale:true；否则写合法空数据（R11）
  let data, stale = false, staleReason = null;
  const prevPath = join(outDir, "filter-data.json");
  if (!rawPool.length) {
    stale = true;
    staleReason = "本轮源站全部超时 / 池为空 / 无有效条目";
    let prev = null;
    try {
      if (existsSync(prevPath)) {
        const j = JSON.parse(readFileSync(prevPath, "utf8"));
        if (j && Array.isArray(j.list) && j.filters) prev = j;
      }
    } catch (e) { warn("上一版数据读取失败", e); }
    if (prev) {
      prev._meta = { ...(prev._meta || {}), stale: true, stale_reason: staleReason, reusedAt: GENERATED_AT };
      data = prev;
      log("源站全挂：沿用上一版 filter-data.json（" + (data.list || []).length + " 条）并标 stale:true");
    } else {
      data = emptyData(cfg, { stale: true, stale_reason: staleReason, freshEmpty: true });
      log("源站全挂且无上一版：产出合法空数据（四排选项仍在、list 空）");
    }
  } else {
    data = buildData(rawPool, cfg, {
      stale: false, sources: sources.length, okSources,
      rawSampled: rawPool.length, perSource,
    });
  }

  // ③ 三个产物 + manifest
  const ruleText = renderRule(cfg);
  const config = renderConfig(cfg);
  const okData = writeJson("filter-data.json", data);
  const okRule = writeText("spider-filter.js", ruleText);
  const okCfg = writeJson("filter-line.json", config);

  const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
  const a = audit(ruleText, config, data);
  const allOk = okData && okRule && okCfg && a.checks.every((c) => c.pass) && bytes <= Number(cfg.maxBytes || 512000);

  const manifest = {
    generated: GENERATED_AT,
    producer: "scripts/build-filter-lines.mjs",
    currentUtcYear: CURRENT_UTC_YEAR,
    contract: DRPY2_CONTRACT,
    line: {
      name: config.sites[0].name,
      file: "filter-line.json",
      ruleFile: "spider-filter.js",
      dataFile: "filter-data.json",
      sitesCount: config.sites.length,
      jar: null,
      success: allOk,
    },
    data: {
      items: (data.list || []).length,
      bytes,
      maxBytes: Number(cfg.maxBytes || 512000),
      samplePages: Number(cfg.samplePages) || 2,
      countIsSample: true,
      perBucketMax: Number(cfg.perBucketMax) || 60,
      stale,
      stale_reason: staleReason,
      decades: DECADE_KEYS,
      buckets: data.buckets || {},
    },
    audit: a,
    degradation: [
      "任何源挂掉 / 全失败都 exit 0，产出合法 filter-data.json（沿用上一版 stale:true 或空数据）",
      "规则全文恰好 1 个 req 调用点、1 个 URL，零运行时抓源（R04 防 ANR）",
      "spider 为空 → 走内置 QuickJS，零 jar（DESIGN_ZERO_RISK 指标 2）",
      "filters 为 object-of-arrays，首层 key 严格等于 class type_id（R03）",
      "categoryContent 只用第 4 参 extend 取点选值（R02）",
    ],
    lines: [{ name: config.sites[0].name, file: "filter-line.json", success: allOk, sitesCount: 1 }],
  };
  writeJson("filter-manifest.json", manifest);

  // ④ 自检（全部可读 + JSON.parse + 断言）
  let parseOk = 0, parseBad = 0;
  for (const f of ["filter-data.json", "filter-line.json", "filter-manifest.json"]) {
    try { JSON.parse(readFileSync(join(outDir, f), "utf8")); parseOk++; }
    catch (e) { parseBad++; warn("自检解析失败 " + f, e); }
  }
  try {
    const js = readFileSync(join(outDir, "spider-filter.js"), "utf8");
    if (!js.includes("export function __jsEvalReturn")) throw new Error("缺少导出函数");
    if (!js.includes("categoryContent(tid, pg, filter, extend)")) throw new Error("第 4 参契约缺失");
    parseOk++;
  } catch (e) { parseBad++; warn("规则脚本自检失败", e); }

  log("＝＝＝ 汇总 ＝＝＝");
  log("产物 4 个：filter-data.json / spider-filter.js / filter-line.json / filter-manifest.json");
  log("数据 " + (data.list || []).length + " 条 / " + bytes + " 字节（上限 " + cfg.maxBytes + "），stale=" + stale);
  for (const c of a.checks) log("  " + (c.pass ? "PASS" : "FAIL") + " " + c.name + " = " + JSON.stringify(c.actual));
  log("自检：JSON.parse OK " + parseOk + " / 失败 " + parseBad + "，耗时 " + (Date.now() - t0) + "ms");
}

// 顶层兜底：任何异常都吞掉，保证 exit 0（绝不中断 CI）
main().catch((e) => warn("顶层异常（已忽略）", e));
