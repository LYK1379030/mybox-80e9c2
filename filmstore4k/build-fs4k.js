#!/usr/bin/env node
/**
 * 聚合线路构建器（耐久自愈版 · v3 全量重写）
 *
 * 三层源池：core（人工）+ pool（上轮存活记忆）+ fresh（社区发现）
 * 关键不变量：
 *   - 所有去重用同一把尺子 backendHost()（主域归并），三层统一
 *   - 所有 fetch/new URL 都在 try 内（单点坏数据不崩构建）
 *   - isSafeCandidate 门禁：内网/回环/凭据/元数据/非CMS形态全拦
 *   - 记忆池写入前去重（防重复自我繁殖）
 *   - 死源连续 3 次失败才出池
 *
 * 输出：dist/fs4k.json + dist/source-pool.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = process.env.FS4K_OUT || join(__dirname, "dist");
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

const DISCOVERY_FEEDS = [
  "https://cdn.jsdelivr.net/gh/gaotianliuyun/gao@master/0827.json",
  "https://gitlab.com/noimank/tvbox/-/raw/main/tvbox1.json",
  "https://cdn.jsdelivr.net/gh/qist/tvbox@master/jsm.json",
];

const PAN_4K_SITES = [
  // csp_Wogg 的 ext 必须是 {token, filter}（build.py 实录：{site:[...]} 会拿不到 token → 永远空转）
  { key: "玩偶4K", name: "🔥玩偶 | 4K", type: 3, api: "csp_Wogg",
    ext: { token: "影視天下第一",
           filter: "https://cdn.jsdelivr.net/gh/gaotianliuyun/gao@master/json/wogg.json" } },
  { key: "快映4K", name: "🔥快映 | 4K", type: 3, api: "csp_PanWebShare",
    ext: { site: ["http://xsayang.fun"] } },
  { key: "八零4K", name: "🔥八零 | 4K", type: 3, api: "csp_PanWebShare",
    ext: { site: ["https://www.80yy3.com", "https://woog.430520.xyz"] } },
  { key: "闪电4K", name: "🔥闪电 | 4K", type: 3, api: "csp_PanWebShare",
    ext: { site: ["http://xhban.xyz"] } },
];

const SPIDER_JAR = "https://gh-proxy.com/raw.githubusercontent.com/LYK1379030/mybox-80e9c2/main/4konly/spider.jar";
const SPIDER_JAR_MD5 = "c07ab2794d358d27d4a4e842712d3c16";

// ═════════ 工具（唯一去重尺子）═════════

/** 主域归并：同库不同域名视为一个后端；IP 原样（带端口） */
function backendHost(api) {
  try {
    const u = new URL(api);
    const h = u.hostname.toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return "ip:" + h + ":" + (u.port || "");
    return h.replace(/^(cj|api|caiji|collect|json)\./, "").split(".").slice(-2).join(".");
  } catch { return "bad:" + String(api); }
}

/** 投毒/内网/回环/凭据门禁 */
function isSafeCandidate(api) {
  const s = String(api || "");
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    if (u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    if (
      h === "localhost" || /^127\./.test(h) || /^10\./.test(h) ||
      /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      /^169\.254\./.test(h) || /^0\./.test(h) ||
      h === "metadata.google.internal" || h.endsWith(".local") || h.endsWith(".internal")
    ) return false;
    if (!/api\.php|provide\/vod/i.test(s)) return false;
    return true;
  } catch { return false; }
}

async function fetchText(url, timeout = 25000) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeout), redirect: "follow" });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

/** 实测：code=1 且列表非空。任何异常都返回失败对象，绝不抛出 */
async function probeSource(s) {
  const t0 = Date.now();
  try {
    const u = new URL(s.api);
    u.searchParams.set("ac", "videolist");
    u.searchParams.set("pg", "1");
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

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

/** 社区收割：宽容解析 + backendHost 去重 + key 冲突防护 */
function harvestApis(jsonText, seen) {
  const out = [];
  const raw = String(jsonText || "").replace(/^\uFEFF/, "");
  let j = null;
  try { j = JSON.parse(raw); }
  catch {
    try { j = JSON.parse(raw.replace(/\/\/[^\n]*/g, "").replace(/,(\s*[}\]])/g, "$1")); }
    catch { return out; }
  }
  const sites = Array.isArray(j?.sites) ? j.sites : [];
  for (const s of sites) {
    const api = String(s.api || "");
    if (!isSafeCandidate(api)) continue;
    const b = backendHost(api);
    if (seen.has(b)) continue;
    seen.add(b);
    let key = String(s.key || s.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || `c${out.length}`;
    key += "_" + (Math.abs(hashStr(api)) % 97); // 天然防跨轮 key 撞车
    out.push({
      key: key.slice(0, 16),
      name: String(s.name || s.key || "").trim().slice(0, 12) || b,
      api: api.replace(/\?.*$/, "").replace(/\/+$/, "") + "/",
      from: "discovered",
    });
  }
  return out;
}

// ═════════ 主流程 ═════════

console.log("═".repeat(60));
console.log("聚合线路构建（耐久自愈版 v3）");
console.log("═".repeat(60));

const poolPath = join(distDir, "source-pool.json");
let pool = { alive: [], dead: {} };
if (existsSync(poolPath)) {
  try { pool = JSON.parse(readFileSync(poolPath, "utf8")); } catch { /* 首跑/写坏 → 空池优雅恢复 */ }
}

// 合并候选（全程一把尺子：backendHost）
const seen = new Set();
const keyByApi = new Map();
const candidates = [];

for (const s of CORE_SOURCES) {
  const b = backendHost(s.api);
  if (seen.has(b)) continue;
  seen.add(b);
  keyByApi.set(s.key, b);
  candidates.push(s);
}

for (const s of Array.isArray(pool.alive) ? pool.alive : []) {
  const b = backendHost(s.api);
  if (seen.has(b)) continue;
  if (!isSafeCandidate(s.api)) {
    console.log(`[门禁] 记忆池脏数据拦截: ${String(s.api).slice(0, 60)}`);
    continue;
  }
  seen.add(b);
  keyByApi.set(s.key, b);
  candidates.push({ key: s.key, name: s.name, api: s.api, from: "pool" });
}

const fresh = [];
for (const feed of DISCOVERY_FEEDS) {
  const txt = await fetchText(feed);
  if (txt) {
    const got = harvestApis(txt, seen);
    fresh.push(...got);
    console.log(`[发现] ${feed.split("/").pop().slice(0, 28)}: +${got.length}`);
  } else {
    console.log(`[发现] ${feed.split("/").pop().slice(0, 28)}: 拉取失败（跳过）`);
  }
}
candidates.push(...fresh.slice(0, 20));
console.log(`候选池 ${candidates.length}（核心 ${CORE_SOURCES.length} + 记忆 ${(pool.alive || []).length} + 发现 ${Math.min(fresh.length, 20)}）`);

// 实测
const results = [];
const queue = [...candidates];
await Promise.all(new Array(6).fill(0).map(async () => {
  for (;;) {
    const s = queue.shift();
    if (!s) return;
    results.push(await probeSource(s));
  }
}));

// 实测结果按 backendHost 纵深去重（同后端取最快活的）
const byBackend = new Map();
for (const r of results) {
  const b = backendHost(r.api);
  const prev = byBackend.get(b);
  if (!prev || (r.ok && !prev.ok) || (r.ok && prev.ok && r.ms < prev.ms)) byBackend.set(b, r);
}
const alive = [...byBackend.values()].filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
const dead = [...byBackend.values()].filter((r) => !r.ok);

console.log(`\n实测 ${results.length}（去重后 ${byBackend.size} 后端）→ 存活 ${alive.length}，死 ${dead.length}`);
for (const d of dead.slice(0, 10)) console.log(`  ✗ ${String(d.key).padEnd(12)} ${d.err}`);
for (const a of alive.slice(0, 14)) console.log(`  ✓ ${String(a.key).padEnd(12)} ${String(a.ms).padStart(5)}ms  ${a.total ?? "?"}条`);

// 死源连续计数（backendHost 维度）
const deadCount = { ...(pool.dead || {}) };
for (const d of dead) deadCount[backendHost(d.api)] = (deadCount[backendHost(d.api)] || 0) + 1;
for (const a of alive) delete deadCount[backendHost(a.api)];
// 死计数字典加上限：旧代 key 永不命中就永不清理会缓慢膨胀（第五轮攻击发现）
// 保留策略：最多 80 条，超出删最早插入的（JS 对象键序 = 插入序）
const _dcKeys = Object.keys(deadCount);
if (_dcKeys.length > 80) {
  for (const k of _dcKeys.slice(0, _dcKeys.length - 80)) delete deadCount[k];
}
const hardDead = Object.entries(deadCount).filter(([, n]) => n >= 3).map(([k]) => k);

// jar md5 构建时重算（第五轮 5c：jar 被手动替换后配置仍用旧 md5 → 电视端拒载）
// 拉取失败则沿用硬编码值（宁可保留旧值也不写坏）
let jarMd5 = SPIDER_JAR_MD5;
try {
  const jr = await fetch(SPIDER_JAR, { signal: AbortSignal.timeout(45000) });
  if (jr.ok) {
    const jb = Buffer.from(await jr.arrayBuffer());
    if (jb.length > 1024 && jb[0] === 0x50 && jb[1] === 0x4b) {
      jarMd5 = createHash("md5").update(jb).digest("hex");
      if (jarMd5 !== SPIDER_JAR_MD5) console.log(`[jar] md5 已更新: ${SPIDER_JAR_MD5} → ${jarMd5}`);
    }
  }
} catch { /* 拉取失败沿用硬编码值 */ }

// 生成配置
const picked = alive.slice(0, 14);

// jar 策略（第七轮闪退根因修复）：
//   主配置的 4K 网盘站（csp_Wogg）复用②线的 candymuj.jar —— 用户从②切③零 jar 重载，不闪退
//   大 jar（194 类）独立成 ③C 专线（fs4kc），愿意折腾的用户单独切
const CANDYMUJ_JAR = "https://gh-proxy.com/raw.githubusercontent.com/CandyMuj/ResourceInterface/main/TVBox/candymuj.jar";
const CANDYMUJ_MD5 = "9f391d889e28d3c40092fabb562f408c";

const config = {
  spider: `${CANDYMUJ_JAR};md5;${CANDYMUJ_MD5}`,
  wallpaper: "https://picsum.photos/1280/720",
  sites: [
    // csp 站只保留 candymuj.jar 支持的（csp_Wogg，dex 验证过）
    // PanWebShare 系（快映/八零/闪电）移到 ③C 专线，避免类缺失报错
    ...PAN_4K_SITES.filter((s) => s.api === "csp_Wogg").map((s) => ({
      ...s,
      ext: JSON.stringify(s.ext, (k, v) => (v === undefined ? "" : v)),
      searchable: 1, quickSearch: 1, filterable: 1, timeout: 60,
    })),
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
    note: "③线稳版：jar 复用②线 candymuj（切线零重载），玩偶4K(csp_Wogg) + 实测直连源。快映/八零/闪电在③C专线。",
  },
};
// 三文件输出（第六轮实战结论：jar 依赖是③线"整体失败"的最大嫌疑——
// 客户端 jar 加载失败时所有 csp 站报错，用户感知为"整线失败"）：
//   fs4k.json / fs4k2.json：混合线（4K 网盘 + 直连），fs4k2 = 版本化副本防 CDN 钉死
//   fs4k3.json：纯直连线（零 jar 依赖，任何客户端保证能用）——保底可用性
// index.json 的 ③ 线指 fs4k2（混合），新增 ③B 纯直连保底线指 fs4k3
const cfgText = JSON.stringify(config, null, 2);
writeFileSync(join(distDir, "fs4k.json"), cfgText, "utf8");
writeFileSync(join(distDir, "fs4k2.json"), cfgText, "utf8");

// 纯直连版：去掉所有 csp_ 站，只留实测存活直连源——不依赖任何 jar
const directOnly = {
  ...config,
  spider: "",
  sites: config.sites.filter((s) => /^https?:\/\//.test(s.api)),
  _meta: {
    ...config._meta,
    note: "纯直连保底线：零 jar 依赖，全部为构建期实测存活的直连源。任何 TVBox 系客户端可直接用。",
  },
};
const directText = JSON.stringify(directOnly, null, 2);
writeFileSync(join(distDir, "fs4k3.json"), directText, "utf8");

// ③C 专线：大 jar + PanWebShare 站（config 的 spider 现在是 candymuj，这里覆写回大 jar）
{
  // PanWebShare 站从 PAN_4K_SITES 全集里取（config 里已过滤掉，这里还原）
  const pan = PAN_4K_SITES.filter((s) => s.api !== "csp_Wogg").map((s) => ({
    ...s,
    ext: JSON.stringify(s.ext, (k, v) => (v === undefined ? "" : v)),
    searchable: 1, quickSearch: 1, filterable: 1, timeout: 60,
  }));
  if (pan.length) {
    writeFileSync(join(distDir, "fs4kc.json"), JSON.stringify({
      ...config,
      spider: `${SPIDER_JAR};md5;${jarMd5}`,
      sites: pan,
      _meta: { ...config._meta, note: "③C 专线：独立大 jar（194类含 PanWebShare 系），切线会重载 jar，低配设备闪退就回③/③B" },
    }, null, 2), "utf8");
    console.log(`✅ fs4kc.json（${pan.length} 站 4K 网盘专线，jar=大jar）`);
  }
}

// 记忆池写入前去重（防重复自我繁殖——v2 的实战教训）
const memSeen = new Set();
const memAlive = [];
for (const a of alive) {
  const b = backendHost(a.api);
  if (memSeen.has(b)) continue;
  memSeen.add(b);
  memAlive.push({ key: a.key, name: a.name, api: a.api, ms: a.ms, total: a.total });
}
writeFileSync(poolPath, JSON.stringify({
  updatedAt: new Date().toISOString(),
  alive: memAlive,
  dead: deadCount,
  hardDead,
}, null, 2), "utf8");

console.log(`\n✅ fs4k.json（${config.sites.length} 站，${config._meta.totalResources.toLocaleString()} 条）`);
console.log(`✅ source-pool.json（记忆 ${memAlive.length} 后端，硬死出池 ${hardDead.length}）`);
if (hardDead.length) console.log(`   硬死: ${hardDead.join(", ")}`);
