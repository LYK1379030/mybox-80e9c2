#!/usr/bin/env node
/**
 * CI 侧每日构建器：按「大区 + 年代」分组多条 TVBox 动态线路（零账号 / 零服务器）。
 *
 * ── 废弃方案的说明（脚本级留痕）──────────────────────────────────────
 * 原 scripts/build-cats.mjs（静态 cats.json + cat-*.json）与
 * scripts/tvbox-cats.js（drpy/js 骨架）已整套删除，原因是 cat-verifier 的
 * FongMi/TV 源码级对抗报告：
 *   · SiteApi.java 每次交互固定拼 ac/t/pg/wd/ids/f 参数分派；静态托管忽略 query
 *     （带 ?ac=videolist&t=...&wd=... 与裸 URL 返回完全相同字节）→ 协议层互斥；
 *   · bean/Class.java 没有 type_pid 字段，层级靠 type_flag:"1" folder；
 *     VodActivity.setTypes() 把 class[] 全平铺成横向 tab → 两级树会被 Gson 丢弃；
 *   · Result.filters 结构不对时 FilterAdapter 抛异常，objectFrom() 的 catch 让
 *     整份 home 静默变空（比闪退更隐蔽）→ 配置里绝不能出现 filters；
 *   · FongMi/CatVodSpider 无 drpy 引擎（只有 Java / Python / QuickJS）→ drpy 骨架无宿主。
 * 因此本脚本不产出任何静态 cats.json / cat-*.json / filters / drpy，
 * 只产出「完整 TVBox 子仓配置」，每份配置的 sites[] 一律是源站原生动态 api。
 *
 * ── 输出（固定文件名，Pages 直接分发）────────────────────────────────
 *   dist/line-<catId>.json          每个语义大区 / 虚拟专区一份完整配置
 *   dist/line-decade-<slug>.json    每个年代档一份完整配置（空档也固定生成，防缓存滞后 R28）
 *   dist/lines-manifest.json        线路清单 + 显示名 + 归属 + 站点数 + 年代真实条目数
 *                                  + 非法 vod_year 过滤计数，供 build.py 的 entries 接线
 *
 * ── 协议层硬限制（如实记录，不要试图绕过）────────────────────────────
 * 分组发生在「子仓/线路」层级：用户切到「🎬电影」或「⏰2020年代」线路，
 * 看到的是该组覆盖的源站集合；每个站点点进去仍由源站 ?ac=list 动态返回它自己的
 * 分类平铺 tab。FongMi 的 type:1 macCMS 站点不支持在配置里强制注入 t / 年份筛选，
 * 所以站点内不做大区或年代裁剪（这正是 filterable:0 的原因）。
 *
 * ── 容错 ────────────────────────────────────────────────────────────
 * 任何源挂掉 / 返回非 JSON / 超时都跳过并打印警告；极端情况下仍产出
 * 「全部大区 + 全部年代档」骨架配置与合法 manifest；绝不以非 0 退出码中断 CI。
 * 单测 / 本地烟囱：CATS_OUT、CATS_POOL 环境变量可覆盖输出目录与源池路径。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const distDir = process.env.CATS_OUT || process.env.FS4K_OUT || join(rootDir, "dist");
const poolPath = process.env.CATS_POOL || join(distDir, "source-pool.json");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT_MS = 8000;         // 单请求 8s 超时
const CONCURRENCY = 8;           // 并发闸门
const VOD_PAGES = 2;             // 每源只取 ?ac=videolist&pg=1..2，防放大

// 与现有★1 / ② / build-fs4k.js 保持同一个 jar，避免影视仓切线闪退；别留空、别用大 jar。
const CANDYMUJ_JAR = "https://gh-proxy.com/raw.githubusercontent.com/CandyMuj/ResourceInterface/main/TVBox/candymuj.jar";
const CANDYMUJ_MD5 = "9f391d889e28d3c40092fabb562f408c";
const SPIDER = CANDYMUJ_JAR + ";md5;" + CANDYMUJ_MD5;
const WALLPAPER = "https://picsum.photos/1280/720";

// 顶层兜底：任何漏网异常都吞掉，脚本始终以 0 退出码结束（CI 绝不中断）。
process.on("unhandledRejection", (e) => warn("unhandledRejection", e));
process.on("uncaughtException", (e) => warn("uncaughtException", e));

function fmt(x) {
  if (x instanceof Error) return x.message || String(x);
  if (typeof x === "string") return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}
function warn(...args) {
  try { console.warn("[lines] WARN " + args.map(fmt).join(" ")); } catch { /* 日志不致命 */ }
}
function log(...args) {
  try { console.log("[lines] " + args.map(fmt).join(" ")); } catch { /* 日志不致命 */ }
}

// ── 模块载入失败时的「空骨架」兜底（只保结构，不重写业务规则）──────────
// 降级时分类映射为空、年代档由当前 UTC 年动态推出，站点数可能为 0，
// 但 manifest 与所有 line-*.json 仍必须是合法 JSON。
const FALLBACK_TOP_CATS = [
  { id: "movie", name: "🎬电影" }, { id: "tv", name: "📺剧集" },
  { id: "anime", name: "🌸动漫" }, { id: "variety", name: "🎤综艺" },
  { id: "doc", name: "🌍纪录" }, { id: "short", name: "📱短剧" },
  { id: "sports", name: "⚽体育" },
];
const FALLBACK_VIRTUAL_TOP = [
  { id: "q4k", name: "🔥4K专区" }, { id: "new", name: "🆕最新更新" },
];
function fallbackDecadeKeys() {
  const y = new Date().getUTCFullYear();
  const top = Math.floor(y / 10) * 10;
  const keys = [];
  for (let d = top; d >= 1980; d -= 10) keys.push(d >= 2000 ? d + "年代" : (d % 100) + "年代");
  keys.push("更早", "年代不详");
  return keys;
}

// ── 通用工具 ──────────────────────────────────────────────────────────

function ensureDist() {
  try { if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true }); }
  catch (e) { warn("创建输出目录失败", e); }
}
function writeJson(filename, obj) {
  try {
    ensureDist();
    writeFileSync(join(distDir, filename), JSON.stringify(obj, null, 2), "utf8");
    return true;
  } catch (e) { warn("写入失败 " + filename, e); return false; }
}
function buildUrl(api, params) {
  const u = new URL(api);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}
async function fetchText(url, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}
/** macCMS 偶发 BOM / 尾逗号 / 前后噪声，有限次宽容解析；仍失败即抛，由上层跳过 */
function parseJsonLoose(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").trim();
  const tries = [raw, raw.replace(/\/\/[^\n]*/g, "").replace(/,(\s*[}\]])/g, "$1")];
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) tries.push(raw.slice(a, b + 1));
  for (const t of tries) { try { return JSON.parse(t); } catch { /* 继续 */ } }
  throw new Error("非法 JSON");
}
/** 带并发上限的 map；单任务异常降级为 null，不影响其它任务 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(limit, Math.max(items.length, 1))).fill(0).map(async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); }
      catch (e) { warn("任务异常", e); out[i] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}
/** 读存活源：只取 http(s) 开头的 api，按 api 去重；异常回落空列表 */
function readPool() {
  try {
    if (!existsSync(poolPath)) { warn("source-pool.json 不存在，使用空源列表"); return []; }
    const j = JSON.parse(readFileSync(poolPath, "utf8"));
    const alive = Array.isArray(j?.alive) ? j.alive : (Array.isArray(j?.sources) ? j.sources : []);
    const seen = new Set();
    const out = [];
    for (const s of alive) {
      const api = String(s?.api || "").trim();
      if (!/^https?:\/\//i.test(api)) continue;
      if (seen.has(api)) continue;
      seen.add(api);
      out.push({
        key: String(s.key || s.name || ("src" + out.length)).slice(0, 32),
        name: String(s.name || s.key || "未命名").trim().slice(0, 24),
        api,
      });
    }
    return out;
  } catch (e) { warn("读取 source-pool.json 失败，使用空源列表", e); return []; }
}
/** 显示名 → 去 emoji 的中文短标签，用作站点名前缀 "【电影】" */
function shortLabel(name) {
  const s = String(name || "").replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
  return s || String(name || "专区");
}

// ── 配置构造（严格对齐 FongMi/Gson 与 cat-verifier 报告）────────────────

/**
 * 构造一个 type:1 macCMS 站点。
 * 硬约束：
 *   · api 为源站原生动态地址（保持动态，绝不静态替代）
 *   · type 是数字 1；ext 是字符串（Site.java 的 ext 是 String，给对象会 Gson 抛异常）
 *   · filterable:0，不下发 filters / class / type_pid / 层级树
 */
function siteFor(source, label, prefix, idx) {
  const rawKey = String(prefix).replace(/[^A-Za-z0-9_-]/g, "_") + "_" +
    String(source.key).replace(/[^A-Za-z0-9_-]/g, "_") + "_" + idx;
  return {
    key: rawKey.slice(0, 32),
    name: "【" + shortLabel(label) + "】" + source.name,
    type: 1,
    api: source.api,
    searchable: 1,
    quickSearch: 1,
    filterable: 0,
    changeable: 1,
    ext: "",
  };
}

/** 完整 TVBox 子仓配置：spider 与现有★1/②一致；顶层绝无 filters 键 */
function buildConfig(sites, meta) {
  return {
    spider: SPIDER,
    wallpaper: WALLPAPER,
    sites,
    lives: [],
    parses: [],
    flags: ["m3u8", "mp4"],
    ads: [],
    _meta: {
      generated: new Date().toISOString(),
      producer: "scripts/build-lines.mjs",
      jar: "candymuj（与★1/②一致，切线零重载）",
      protocol: "type:1 macCMS 动态 api；无 filters / 无 type_pid / 无 class 树",
      ...meta,
    },
  };
}

// ── 主流程 ────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  const generated = new Date().toISOString();

  // ① 载入语义规则与年代纯函数（动态 import，模块坏掉也不中断 CI）
  let topCats = FALLBACK_TOP_CATS;
  let virtualTop = FALLBACK_VIRTUAL_TOP;
  let classify = null;
  let decades = null;
  try {
    const m = await import("../src/cats.js");
    if (Array.isArray(m.TOP_CATS) && m.TOP_CATS.length) topCats = m.TOP_CATS;
    if (Array.isArray(m.VIRTUAL_TOP)) virtualTop = m.VIRTUAL_TOP;
    if (typeof m.classifySourceCat === "function") classify = m.classifySourceCat;
    log("已加载 src/cats.js（TOP_CATS " + topCats.length + " 项 / VIRTUAL_TOP " + virtualTop.length + " 项）");
  } catch (e) { warn("src/cats.js 载入失败，改用空骨架规则", e); }
  try {
    decades = await import("../src/decades.js");
    log("已加载 src/decades.js（CURRENT_UTC_YEAR=" + decades.CURRENT_UTC_YEAR +
      ", YEAR_MAX=" + decades.YEAR_MAX + ", 档位 " + decades.DECADE_KEYS.join("/") + "）");
  } catch (e) { warn("src/decades.js 载入失败，改用空骨架档位", e); }

  const decadeKeys = decades?.DECADE_KEYS ? [...decades.DECADE_KEYS] : fallbackDecadeKeys();
  const currentUtcYear = decades?.CURRENT_UTC_YEAR ?? new Date().getUTCFullYear();
  const yearMax = decades?.YEAR_MAX ?? (currentUtcYear + 1);

  // ② 先定义「空骨架」输出，保证 finally 任何分支都能落地合法文件
  const outputs = new Map();   // filename -> config 对象
  const manifestLines = [];
  let report = {
    categoryLines: 0, virtualLines: 0, decadeLines: 0,
    siteCounts: {}, decadeCounts: {},
    presentDecades: [], invalidVodYear: 0, missingVodYear: 0,
    poolSize: 0, mergedSize: 0, aliveSources: 0, listOkSources: 0,
  };

  function putLine(file, name, kind, extra, config, metaLine) {
    outputs.set(file, config);
    manifestLines.push({
      file,
      name,
      kind,
      ...extra,
      sitesCount: (config.sites || []).length,
      ...metaLine,
    });
  }

  const sources = readPool();
  report.aliveSources = sources.length;
  log("存活源 " + sources.length + " 个，开始并发拉取 ?ac=list …");

  try {
    // ③ 阶段 A：并发拿各源 class[]（单源失败不影响整体）
    const sourceTypes = [];
    const listResults = await mapLimit(sources, CONCURRENCY, async (s) => {
      try {
        const j = parseJsonLoose(await fetchText(buildUrl(s.api, { ac: "list" }), TIMEOUT_MS));
        let cls = null;
        if (Array.isArray(j?.class)) cls = j.class;
        else if (Array.isArray(j?.classes)) cls = j.classes;
        else if (Array.isArray(j?.types)) cls = j.types;
        if (!cls || !cls.length) { warn("源 " + s.key + " ?ac=list 无 class 数组，跳过"); return null; }
        return { source: s, class: cls.filter((c) => c && typeof c === "object") };
      } catch (e) { warn("源 " + s.key + " ?ac=list 失败，跳过", e); return null; }
    });
    for (const r of listResults) if (r && r.class.length) sourceTypes.push(r);
    report.listOkSources = sourceTypes.length;
    log("分类响应有效 " + sourceTypes.length + "/" + sources.length + " 源");

    // ④ 语义归并：大区 → [ {source_key, source_api, type_id, type_name, sub} ]
    const catMap = new Map(); // catId -> { entries: [], sourceKeys: Set }
    for (const t of topCats) catMap.set(t.id, { entries: [], sourceKeys: new Set() });
    for (const st of sourceTypes) {
      for (const c of st.class) {
        let mapped = null;
        try {
          if (classify) mapped = classify({ ...c, source_key: st.source.key });
          else mapped = { topId: null, sub: null }; // 空骨架降级：不猜测分类
        } catch (e) { warn("classifySourceCat 异常，跳过该类目", e); }
        if (!mapped?.topId || !catMap.has(mapped.topId)) continue;
        const bucket = catMap.get(mapped.topId);
        bucket.entries.push({
          source_key: st.source.key,
          source_api: st.source.api,
          type_id: String(c?.type_id ?? ""),
          type_name: String(c?.type_name ?? ""),
          sub: mapped.sub?.std ? String(mapped.sub.std) : "",
        });
        bucket.sourceKeys.add(st.source.key);
      }
    }

    // ⑤ 生成大区线路：sites = 覆盖该大区的各源站（原生动态 api）
    for (const t of topCats) {
      const id = t.id;
      const bucket = catMap.get(id) || { entries: [], sourceKeys: new Set() };
      const covered = sources.filter((s) => bucket.sourceKeys.has(s.key));
      const picked = covered.length ? covered : sources; // 无命中时保留全部源，线路仍可用
      const sites = picked.map((s, i) => siteFor(s, t.name, id, i));
      const file = "line-" + String(id).replace(/[^A-Za-z0-9_-]/g, "_") + ".json";
      const cfg = buildConfig(sites, {
        kind: "category", catId: id, label: shortLabel(t.name),
        matchedClasses: bucket.entries.length,
        fallbackSites: covered.length === 0,
      });
      putLine(file, String(t.name), "category", { catId: id, label: shortLabel(t.name) }, cfg, {
        matchedClasses: bucket.entries.length,
        catMap: bucket.entries,
        sources: picked.map((s) => s.key),
      });
      report.siteCounts[id] = sites.length;
      report.categoryLines++;
    }

    // 虚拟专区（4K / 最新更新）也是独立线路：全局聚合，sites = 全部存活源
    for (const v of virtualTop) {
      const id = v.id;
      const sites = sources.map((s, i) => siteFor(s, v.name, id, i));
      const file = "line-" + String(id).replace(/[^A-Za-z0-9_-]/g, "_") + ".json";
      const cfg = buildConfig(sites, { kind: "virtual", virtualId: id });
      putLine(file, String(v.name), "virtual", { virtualId: id }, cfg, {
        sources: sources.map((s) => s.key),
      });
      report.siteCounts[id] = sites.length;
      report.virtualLines++;
    }

    // ⑥ 阶段 B：每源 ?ac=videolist&pg=1..2 拉真实条目（只用 vod_year 判年代）
    const vodJobs = [];
    for (const s of sources) {
      for (let pg = 1; pg <= VOD_PAGES; pg++) vodJobs.push({ source: s, pg });
    }
    log("年代取数 " + vodJobs.length + " 个请求（每源 " + VOD_PAGES + " 页），并发 " + CONCURRENCY);
    const vodResults = await mapLimit(vodJobs, CONCURRENCY, async (job) => {
      try {
        const url = buildUrl(job.source.api, { ac: "videolist", pg: job.pg });
        const j = parseJsonLoose(await fetchText(url, TIMEOUT_MS));
        return Array.isArray(j?.list) ? j.list : [];
      } catch (e) {
        warn("取数跳过 " + job.source.key + " pg=" + job.pg, e);
        return [];
      }
    });

    const rawPool = [];
    for (let i = 0; i < vodJobs.length; i++) {
      const s = vodJobs[i].source;
      for (const it of (vodResults[i] || [])) {
        if (!it || typeof it !== "object") continue;
        rawPool.push({
          ...it,
          _source: s.key,
          _source_name: s.name,
          _source_api: s.api,
        });
      }
    }
    report.poolSize = rawPool.length;

    // 原始口径统计非法 / 缺失 vod_year（合并前，避免 R29 写回年份后丢失计数）
    let invalidRaw = 0, missingRaw = 0;
    if (decades) {
      for (const it of rawPool) {
        if (decades.isMissingYear(it.vod_year)) missingRaw++;
        else if (decades.parseVodYear(it.vod_year) === null) invalidRaw++;
      }
    }
    report.invalidVodYear = invalidRaw;
    report.missingVodYear = missingRaw;
    log("原始条目池 " + rawPool.length + " 条；非法 vod_year " + invalidRaw +
      " 条，缺失/未知 " + missingRaw + " 条");

    // ⑦ R29：跨源同名合并（归一化片名去重，年份取多源最早有效值）
    const merged = decades?.dedupeByNormalizedName
      ? decades.dedupeByNormalizedName(rawPool)
      : rawPool;
    report.mergedSize = merged.length;
    log("归一化合并后 " + merged.length + " 部（去 4K/蓝光/HD/全集/第X季 后缀）");

    // ⑧ 年代归档（档位动态、空档不裁剪）
    const decadeResult = decades?.buildDecadeBuckets
      ? decades.buildDecadeBuckets(merged, { keys: decadeKeys, limit: 60 })
      : null;
    const bucketOf = (k) => decadeResult?.buckets?.get(k) || null;
    for (const k of decadeKeys) {
      const b = bucketOf(k);
      report.decadeCounts[k] = b ? b.count : 0;
    }
    report.presentDecades = decadeKeys.filter((k) => (report.decadeCounts[k] || 0) > 0);
    log("年代档有片 " + report.presentDecades.length + "/" + decadeKeys.length +
      "：" + (report.presentDecades.join(" / ") || "无"));

    // ⑨ 生成年代档线路：sites = 该档条目涉及的源站；空档回落全部源（固定生成防 R28）
    for (const k of decadeKeys) {
      const b = bucketOf(k);
      const keysInBucket = new Set();
      if (b) {
        for (const it of b.rawItems || []) {
          const arr = Array.isArray(it?._sources) ? it._sources : [];
          for (const sk of arr) keysInBucket.add(String(sk));
        }
      }
      let picked = sources.filter((s) => keysInBucket.has(s.key));
      if (!picked.length) picked = sources; // 空档也保留完整线路骨架
      const sites = picked.map((s, i) => siteFor(s, k, "decade_" + (decades?.decadeSlug?.(k) || i), i));
      const slug = decades?.decadeSlug ? decades.decadeSlug(k) : String(k).replace(/[^A-Za-z0-9_-]/g, "_");
      const file = "line-decade-" + slug + ".json";
      const cfg = buildConfig(sites, {
        kind: "decade", decade: k, slug,
        realCount: report.decadeCounts[k] || 0,
        emptyFallback: keysInBucket.size === 0,
      });
      putLine(file, "⏰" + k, "decade", { decade: k, slug }, cfg, {
        realCount: report.decadeCounts[k] || 0,
        listed: b ? b.list.length : 0,
        sources: picked.map((s) => s.key),
      });
      report.decadeLines++;
    }
  } catch (e) {
    warn("主流程异常，回落到空骨架输出", e);
  } finally {
    // ⑩ 骨架补齐：即使主流程在中途挂掉（已生成一部分线路），也逐个检查
    //    预期文件清单，缺哪条补哪条，保证「全部大区 + 全部虚拟专区 + 全部年代档」都在。
    function ensureSkeleton(file, name, kind, extra, metaCfg, metaLine) {
      if (outputs.has(file)) return; // 主流程已生成，保留真实数据
      const cfg = buildConfig([], { skeleton: true, ...metaCfg });
      putLine(file, name, kind, extra, cfg, { ...metaLine, sources: [] });
    }
    for (const t of topCats) {
      const id = t.id;
      const file = "line-" + String(id).replace(/[^A-Za-z0-9_-]/g, "_") + ".json";
      ensureSkeleton(file, String(t.name), "category", { catId: id },
        { kind: "category", catId: id }, { catMap: [], sources: [] });
      if (!(id in report.siteCounts)) report.siteCounts[id] = 0;
    }
    for (const v of virtualTop) {
      const id = v.id;
      const file = "line-" + String(id).replace(/[^A-Za-z0-9_-]/g, "_") + ".json";
      ensureSkeleton(file, String(v.name), "virtual", { virtualId: id },
        { kind: "virtual", virtualId: id }, { sources: [] });
      if (!(id in report.siteCounts)) report.siteCounts[id] = 0;
    }
    for (const k of decadeKeys) {
      const slug = decades?.decadeSlug ? decades.decadeSlug(k) : String(k).replace(/[^A-Za-z0-9_-]/g, "_");
      const file = "line-decade-" + slug + ".json";
      ensureSkeleton(file, "⏰" + k, "decade", { decade: k, slug },
        { kind: "decade", decade: k, slug }, { realCount: 0, listed: 0, sources: [] });
      if (!(k in report.decadeCounts)) report.decadeCounts[k] = 0;
    }
    // 计数以「实际落盘的文件」为准，避免部分生成时统计虚高 / 虚低
    report.categoryLines = manifestLines.filter((l) => l.kind === "category").length;
    report.virtualLines = manifestLines.filter((l) => l.kind === "virtual").length;
    report.decadeLines = manifestLines.filter((l) => l.kind === "decade").length;

    // ⑪ 写盘：所有线路 + manifest
    for (const [file, cfg] of outputs) writeJson(file, cfg);

    const manifest = {
      generated,
      producer: "scripts/build-lines.mjs",
      currentUtcYear,
      yearMax,
      decadeKeys,
      spider: SPIDER,
      lines: manifestLines,
      totals: {
        lines: manifestLines.length,
        categoryLines: report.categoryLines,
        virtualLines: report.virtualLines,
        decadeLines: report.decadeLines,
        aliveSources: report.aliveSources,
        listOkSources: report.listOkSources,
        rawVodItems: report.poolSize,
        mergedVodItems: report.mergedSize,
      },
      categorySiteCounts: report.siteCounts,
      decadeCounts: report.decadeCounts,
      presentDecades: report.presentDecades,
      yearFilter: {
        invalidVodYear: report.invalidVodYear,
        missingVodYear: report.missingVodYear,
        rule: "只认 /^(19|20)\\d{2}$/ 且 1900<=y<=CURRENT_UTC_YEAR+1；" +
              "vod_time 不参与；当前年份不补缺失；无硬编码年份选项",
      },
      // lead 接进 build.py 的 entries 时，用 SELF + "/" + file 拼绝对地址
      entries: manifestLines.map((l) => ({ name: l.name, file: l.file })),
      protocolNotes: [
        "SiteApi.java 固定拼 ac/t/pg/wd/ids/f；静态托管忽略 query → sites[].api 必须为源站原生动态 api",
        "bean/Class.java 无 type_pid；层级靠 type_flag folder → 不下发 class 树 / type_pid",
        "Result.filters 结构不对会让整份 home 静默变空 → 顶层与站点均无 filters，filterable:0",
        "分组发生在子仓/线路层级；站点内分类由源站 ?ac=list 动态平铺，配置无法强制按大区/年代裁剪",
        "年代档空档固定生成，防客户端缓存滞后（R28）",
        "spider 复用★1/②的 candymuj.jar，切线零重载，避免 BadTokenException 闪退",
      ],
      deprecated: "静态 cats.json + cat-*.json + drpy 骨架已废弃，详见本脚本顶部说明",
    };
    writeJson("lines-manifest.json", manifest);

    // ⑫ 自检：每个输出都能 JSON.parse，且不含 filters / 站点字段类型正确
    let parseOk = 0, parseBad = 0, shapeBad = 0;
    for (const [file] of outputs) {
      try {
        const j = JSON.parse(readFileSync(join(distDir, file), "utf8"));
        parseOk++;
        if ("filters" in j) { shapeBad++; warn(file + " 出现禁用的 filters 顶层键"); }
        if (!j.spider || !Array.isArray(j.sites)) { shapeBad++; warn(file + " 缺少 spider / sites"); }
        for (const s of j.sites || []) {
          if (s.type !== 1 || typeof s.ext !== "string" || s.filterable !== 0 ||
              !/^https?:\/\//i.test(String(s.api || ""))) {
            shapeBad++; warn(file + " 站点字段不合规: " + s.key);
          }
        }
      } catch (e) { parseBad++; warn("自检解析失败 " + file, e); }
    }
    try {
      const m = JSON.parse(readFileSync(join(distDir, "lines-manifest.json"), "utf8"));
      if (!Array.isArray(m.lines) || !m.lines.length) throw new Error("manifest.lines 为空");
      parseOk++;
    } catch (e) { parseBad++; warn("manifest 自检失败", e); }

    log("＝＝＝ 汇总 ＝＝＝");
    log("线路总数 " + manifestLines.length +
      "（语义大区 " + report.categoryLines + " / 虚拟专区 " + report.virtualLines +
      " / 年代档 " + report.decadeLines + "）");
    for (const t of topCats) log("  " + t.name + " → " + (report.siteCounts[t.id] ?? 0) + " 站");
    for (const v of virtualTop) log("  " + v.name + " → " + (report.siteCounts[v.id] ?? 0) + " 站");
    for (const k of decadeKeys) {
      log("  ⏰" + k + " → 真实 " + (report.decadeCounts[k] ?? 0) + " 条，" +
        (outputs.get("line-decade-" + (decades?.decadeSlug?.(k) || k) + ".json")?.sites || []).length + " 站");
    }
    log("非法 vod_year " + report.invalidVodYear + " 条，缺失/未知 " + report.missingVodYear + " 条");
    log("自检：JSON.parse OK " + parseOk + " / 失败 " + parseBad + " / 形状问题 " + shapeBad +
      "，耗时 " + (Date.now() - t0) + "ms");
  }
}

// 顶层再兜一层：main 内部任何未捕获异常也不会变成非 0 退出码
main().catch((e) => warn("顶层异常（已忽略）", e));
