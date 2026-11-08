#!/usr/bin/env node
/**
 * 聚合线路构建器（耐久自愈版）
 *
 * 核心设计：源池不是硬编码清单，而是「实测存活池 + 社区自动发现」：
 *   1. core:  人工维护的核心源（下方 CORE_SOURCES）——每次构建实测，死源剔除
 *   2. pool:  上一轮构建确认存活的源（dist/source-pool.json）——跨构建记忆，
 *             构建产物随 git 提交，下次 CI 自动带上
 *   3. fresh: 每天从社区聚合配置收割的新候选——实测合格自动入池
 *   死源连续失败 3 次才出池（防网络抖动误杀），池子永不枯竭。
 *
 * 输出：
 *   dist/fs4k.json          TVBox 聚合线路配置（build.py 自动接入③号线）
 *   dist/source-pool.json   存活源池记忆（下次构建的种子）
 *
 * CI 由 workflow 调用；本地直接 node build-fs4k.js
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = process.env.FS4K_OUT || join(__dirname, "dist");
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─────────────────────────────────────────────
// 第一层：核心源（人工维护，域名变更时改这里）
// ─────────────────────────────────────────────
const CORE_SOURCES = [
  { key: "bfzy",    name: "暴风资源", api: "https://bfzyapi.com/api.php/provide/vod/" },
  { key: "lzi",     name: "量子资源", api: "https://cj.lziapi.com/api.php/provide/vod/" },
  { key: "ffzy",    name: "非凡影视", api: "https://cj.ffzyapi.com/api.php/provide/vod/" },
  { key: "dytt",    name: "电影天堂", api: "http://caiji.dyttzyapi.com/api.php/provide/vod/" },
  { key: "jian",    name: "建安资源", api: "http://154.219.117.232:9981/jacloudapi.php/provide/vod/" },
  { key: "tyys",    name: "天涯资源", api: "http://tyyszy.com/api.php/provide/vod/" },
  { key: "360zy",   name: "360资源",  api: "https://360zy.com/api.php/provide/vod/" },
  { key: "yinghua", name: "樱花资源", api: "https://m3u8.apiyhzy.com/api.php/provide/vod/" },
  { key: "jinying", name: "金鹰资源", api: "https://jyzyapi.com/api.php/provide/vod/" },
  { key: "modu",    name: "魔都资源", api: "https://www.mdzyapi.com/api.php/provide/vod/" },
  { key: "sony",    name: "索尼资源", api: "https://suoniapi.com/api.php/provide/vod/" },
  { key: "subo",    name: "速播资源", api: "https://subocaiji.com/api.php/provide/vod/" },
];

// ─────────────────────────────────────────────
// 第二层：社区自动发现（每天从聚合配置收割新候选）
// ─────────────────────────────────────────────
const DISCOVERY_FEEDS = [
  "https://cdn.jsdelivr.net/gh/gaotianliuyun/gao@master/0827.json",
  "https://gitlab.com/noimank/tvbox/-/raw/main/tvbox1.json",
  "https://cdn.jsdelivr.net/gh/qist/tvbox@master/jsm.json",
];

// 4K 原盘站（csp 插件；jar 内已确认的 16 个类里挑的，缺类会闪退）
const PAN_4K_SITES = [
  { key: "玩偶4K", name: "🔥玩偶 | 4K原盘", api: "csp_Wogg",
    ext: { site: ["https://www.wogg.live", "https://woggpan.888484.xyz"] } },
  { key: "快映4K", name: "🔥快映 | 4K", api: "csp_PanWebShare",
    ext: { site: ["http://xsayang.fun"] } },
  { key: "八零4K", name: "🔥八零 | 4K", api: "csp_PanWebShare",
    ext: { site: ["https://www.80yy3.com", "https://woog.430520.xyz"] } },
  { key: "闪电4K", name: "🔥闪电 | 4K", api: "csp_PanWebShare",
    ext: { site: ["http://xhban.xyz"] } },
];

// jar 自托管 + 实测 md5（与 jar 文件成对维护：换 jar 必须同步改这里，
// 上一轮攻击就抓到过 md5 配错导致电视端拒载的 bug）
const SPIDER_JAR = "https://gh-proxy.com/raw.githubusercontent.com/LYK1379030/mybox-80e9c2/main/4konly/spider.jar";
const SPIDER_JAR_MD5 = "c07ab2794d358d27d4a4e842712d3c16";

// ─────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────
const normKey = (api) => api.toLowerCase().replace(/^https?:\/\//, "").replace(/[?/]+$/, "");

async function fetchText(url, timeout = 25000) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeout), redirect: "follow" });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

/** 实测一个源：ac=videolist 必须返回 code=1 + 非空 list */
async function probeSource(s) {
  const t0 = Date.now();
  const u = new URL(s.api);
  u.searchParams.set("ac", "videolist");
  u.searchParams.set("pg", "1");
  try {
    const r = await fetch(u.toString(), {
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!r.ok) return { ...s, ok: false, ms: Date.now() - t0, err: `HTTP ${r.status}` };
    const data = JSON.parse((await r.text()).replace(/^\uFEFF/, ""));
    const list = data.list || [];
    if (Number(data.code) !== 1 || !list.length) {
      return { ...s, ok: false, ms: Date.now() - t0, err: "空列表" };
    }
    return { ...s, ok: true, ms: Date.now() - t0, total: data.total ?? list.length };
  } catch (e) {
    return { ...s, ok: false, ms: Date.now() - t0, err: e.name === "TimeoutError" ? "超时" : String(e.message || e).slice(0, 40) };
  }
}

/** 从社区配置抽直连 api（宽容解析：注释/尾随逗号都吃） */
function harvestApis(jsonText, seen, keyByApi) {
  const out = [];
  let j = null;
  const raw = jsonText.replace(/^\uFEFF/, "");
  try { j = JSON.parse(raw); }
  catch {
    try { j = JSON.parse(raw.replace(/\/\/[^\n]*/g, "").replace(/,(\s*[}\]])/g, "$1")); }
    catch { return out; }
  }
  const sites = Array.isArray(j?.sites) ? j.sites : [];
  for (const s of sites) {
    const api = String(s.api || "");
    if (!/^https?:\/\//i.test(api) || !/api\.php|provide\/vod/i.test(api)) continue;
    const k = normKey(api);
    if (seen.has(k)) continue;
    seen.add(k);
    // key 冲突防护：同名 key 已被其它 api 占用则加后缀（否则 TVBox 里站点互相覆盖）
    let key = String(s.key || s.name || k.split("/")[0]).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || `c${out.length}`;
    if (keyByApi.has(key) && keyByApi.get(key) !== k) {
      key = (key + Math.abs(hashStr(k)) % 100).slice(0, 16);
    }
    keyByApi.set(key, k);
    out.push({
      key,
      name: String(s.name || s.key || "").trim().slice(0, 12) || k.split("/")[0],
      api: api.replace(/\/+$/, "") + "/",
      from: "discovered",
    });
  }
  return out;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return h;
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────
console.log("═".repeat(60));
console.log("聚合线路构建（耐久自愈版）");
console.log("═".repeat(60));

// 1. 加载上一轮源池记忆
const poolPath = join(distDir, "source-pool.json");
let pool = { alive: [], dead: {}, updatedAt: null };
if (existsSync(poolPath)) {
  try { pool = JSON.parse(readFileSync(poolPath, "utf8")); } catch { /* 首跑 */ }
}
console.log(`\n[记忆] 上轮存活源 ${(pool.alive || []).length} 个，死源计数 ${Object.keys(pool.dead || {}).length} 条`);

// 2. 合并候选：核心 + 上轮存活 + 社区发现
const seen = new Set();
const keyByApi = new Map(); // key -> normApi（防 key 冲突导致站点互相覆盖）
const candidates = [];
for (const s of CORE_SOURCES) {
  const k = normKey(s.api);
  if (!seen.has(k)) { seen.add(k); keyByApi.set(s.key, k); candidates.push(s); }
}
for (const s of pool.alive || []) {
  const k = normKey(s.api);
  if (!seen.has(k)) { seen.add(k); keyByApi.set(s.key, k); candidates.push({ key: s.key, name: s.name, api: s.api, from: "pool" }); }
}
const fresh = [];
for (const feed of DISCOVERY_FEEDS) {
  const txt = await fetchText(feed);
  if (txt) {
    const got = harvestApis(txt, seen, keyByApi);
    fresh.push(...got);
    console.log(`[发现] ${feed.split("/").pop().slice(0, 28)}: +${got.length} 候选`);
  } else {
    console.log(`[发现] ${feed.split("/").pop().slice(0, 28)}: 拉取失败（跳过，不影响主流程）`);
  }
}
candidates.push(...fresh.slice(0, 20)); // 新候选上限 20，控构建时长
console.log(`\n候选池: ${candidates.length}（核心 ${CORE_SOURCES.length} + 记忆 ${(pool.alive || []).length} + 发现 ${Math.min(fresh.length, 20)}）`);

// 3. 全量实测（并发 6）
console.log("\n实测中…");
const results = [];
const queue = [...candidates];
await Promise.all(new Array(6).fill(0).map(async () => {
  for (;;) {
    const s = queue.shift();
    if (!s) return;
    results.push(await probeSource(s));
  }
}));

const alive = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
const dead = results.filter((r) => !r.ok);
console.log(`\n实测 ${results.length} → 存活 ${alive.length}，死 ${dead.length}`);
for (const d of dead.slice(0, 12)) console.log(`  ✗ ${d.key.padEnd(12)} ${d.err}`);
for (const a of alive.slice(0, 14)) console.log(`  ✓ ${a.key.padEnd(12)} ${String(a.ms).padStart(5)}ms  ${a.total ?? "?"}条`);

// 4. 死源连续计数：连续 3 次才出池（防网络抖动误杀）
const deadCount = { ...(pool.dead || {}) };
for (const d of dead) deadCount[normKey(d.api)] = (deadCount[normKey(d.api)] || 0) + 1;
for (const a of alive) delete deadCount[normKey(a.api)];
const hardDead = Object.entries(deadCount).filter(([, n]) => n >= 3).map(([k]) => k);

// 5. 生成 fs4k.json（存活源上限 14，实测延迟升序）
const picked = alive.slice(0, 14);
const config = {
  spider: `${SPIDER_JAR};md5;${SPIDER_JAR_MD5}`,
  wallpaper: "https://picsum.photos/1280/720",
  sites: [
    ...PAN_4K_SITES.map((s) => ({ ...s, searchable: 1, quickSearch: 1, filterable: 1, timeout: 60 })),
    ...picked.map((s) => ({
      key: s.key,
      name: `${s.name}·${s.ms}ms`,
      type: 1,
      api: s.api,
      searchable: 1,
      quickSearch: 1,
      changeable: 1,
    })),
  ],
  lives: [],
  parses: [],
  flags: ["m3u8", "mp4"],
  ads: [],
  _meta: {
    generated: new Date().toISOString(),
    probed: results.length,
    alive: alive.length,
    hardDead: hardDead.length,
    totalResources: picked.reduce((s, x) => s + (x.total || 0), 0),
    note: "4K 原盘走 csp 网盘插件（jar 内置 16 类），1080P/HD 走构建期实测存活直连源。源池自愈：死源连续3次失败自动出池，社区新源每天自动入池。",
  },
};
writeFileSync(join(distDir, "fs4k.json"), JSON.stringify(config, null, 2), "utf8");

// 6. 源池记忆落盘（下次构建种子 = 本轮存活全量）
writeFileSync(poolPath, JSON.stringify({
  updatedAt: new Date().toISOString(),
  alive: alive.map(({ key, name, api, ms, total }) => ({ key, name, api, ms, total })),
  dead: deadCount,
  hardDead,
}, null, 2), "utf8");

console.log(`\n✅ fs4k.json（${config.sites.length} 站，${config._meta.totalResources.toLocaleString()} 条资源）`);
console.log(`✅ source-pool.json（存活记忆 ${alive.length}，硬死出池 ${hardDead.length}）`);
if (hardDead.length) console.log(`   硬死出池: ${hardDead.join(", ")}`);
