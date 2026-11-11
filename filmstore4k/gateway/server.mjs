/**
 * 筛选增强网关（路线 A 实现，零 jar / 零 smali patch / 纯 Node 标准库）
 *
 * 本机未发现 cloudflared / frp / ngrok / VPS 配置，未启用；代码保留供有公网
 * 运行时时一键启用。启用后把 sites[].api 从源站 URL 换成本网关 URL 即可，
 * 壳的 GridFilterDialog 四排面板由 ac=list 响应顶层 filters 驱动。
 *
 * 端点：
 *   E1  GET /api.php/provide/vod?ac=list            → 源站 ac=list + 顶层 filters + 6 大类 class
 *   E2  GET /api.php/provide/vod?ac=videolist&pg=1&t=&year=&area=&by=
 *                                                  → 真过滤（t/year 透传源站，area/by 本地）
 *   E3  GET /api.php/provide/vod?ac=detail&ids=...  → 原样透传
 *
 * 证据（本 APK smali，见 GATEWAY_REPORT.md）：
 *   ng0.smali L2157-2388：has("filters") → getAsJsonObject → keySet → 按 SortData.id 挂 SortData.filters
 *   ng0.smali L1884-1988：{key,name,value:[{n,v}]} → MovieSort.SortFilter
 *   ng0.smali L1612-1617：filterSelect 每个 key 独立拼 query；L1651-1653 额外 f={json} 冗余
 *   k40.smali L249-287 / de0.smali L116-166：filters 非空才创建 GridFilterDialog
 *
 * 本机实测（2026-11-11）：
 *   year=2024 → 360 total 74870→4015、bfzy 171460→13125，列表 vod_year 全 2024
 *   t=6 → 360 生效、bfzy 返回 0（bfzy 动作片是 21）→ 必须按 ac=list.class 动态映射
 *   by=time/hits → 两源均忽略 → 网关本地排序
 *   area=大陆 → bfzy 生效(51905)、360 忽略 → 网关本地按 vod_area 过滤
 */

import http from "node:http";
import { URL } from "node:url";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILTERS = JSON.parse(readFileSync(join(__dirname, "filters.json"), "utf8"));

// 上游：默认用实测可用的 5 个直连源；可用 UPSTREAMS 环境变量覆盖（JSON 数组）
const DEFAULT_UPSTREAMS = [
  { key: "360", name: "360", api: "https://caiji.360zy.com/api.php/provide/vod/" },
  { key: "bfzy", name: "暴风", api: "https://bfzyapi.com/api.php/provide/vod/" },
  { key: "lzi", name: "量子", api: "https://cj.lziapi.com/api.php/provide/vod/" },
  { key: "ffzy", name: "非凡", api: "http://cj.ffzyapi.com/api.php/provide/vod/" },
  { key: "dytt", name: "电影天堂", api: "https://caiji.dyttzyapi.com/api.php/provide/vod/" },
];
const UPSTREAMS = (() => {
  try { return JSON.parse(process.env.UPSTREAMS || "null") || DEFAULT_UPSTREAMS; }
  catch { return DEFAULT_UPSTREAMS; }
})();
const PORT = Number(process.env.PORT || 8787);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 8000);
const CACHE_MS = Number(process.env.CACHE_MS || 600000);
const CACHE_DIR = join(__dirname, ".cache");
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const cache = new Map();          // key -> {at, body}
const typeMaps = new Map();       // upstreamKey -> {type_name: type_id}

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  return null;
}
function cacheSet(key, body) {
  cache.set(key, { at: Date.now(), body });
  try { writeFileSync(join(CACHE_DIR, key.replace(/[^a-z0-9._-]/gi, "_") + ".json"), body); } catch {}
}
function diskGet(key) {
  try { return readFileSync(join(CACHE_DIR, key.replace(/[^a-z0-9._-]/gi, "_") + ".json"), "utf8"); }
  catch { return null; }
}

async function fetchUpstream(up, params) {
  const u = new URL(up.api);
  for (const [k, v] of Object.entries(params)) if (v !== "" && v !== undefined) u.searchParams.set(k, String(v));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(u, {
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*" },
      signal: ctrl.signal, redirect: "follow",
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(timer); }
}

/** 启动时对每个上游拉 ac=list，用真实 class[].type_name 建动态 t 映射，绝不写死编号 */
async function loadTypeMaps() {
  await Promise.all(UPSTREAMS.map(async (up) => {
    try {
      const txt = cacheGet("list:" + up.key) || await fetchUpstream(up, { ac: "list" });
      cacheSet("list:" + up.key, txt);
      const j = JSON.parse(txt);
      const m = {};
      for (const c of (j.class || [])) if (c.type_name) m[String(c.type_name)] = String(c.type_id);
      typeMaps.set(up.key, m);
    } catch (e) {
      const stale = diskGet("list:" + up.key);
      if (stale) {
        const m = {};
        for (const c of (JSON.parse(stale).class || [])) if (c.type_name) m[String(c.type_name)] = String(c.type_id);
        typeMaps.set(up.key, m);
      }
      console.error("[typemap] " + up.key + " 失败: " + e.message);
    }
  }));
}

/** 把 filters.json 的 t 值（360 基准名）动态重映射到目标源的真实 type_id */
function filtersFor(upKey) {
  const m = typeMaps.get(upKey) || {};
  const NAME_OF_V = {
    "": "", "6": "动作片", "7": "喜剧片", "8": "爱情片", "9": "科幻片",
    "10": "恐怖片", "11": "剧情片", "12": "战争片", "4": "动漫片",
    "3": "综艺片", "28": "纪录片",
  };
  const rows = FILTERS.rows.map((row) => {
    if (row.key !== "t") return row;
    return {
      ...row,
      value: row.value.map((v) => {
        const nm = NAME_OF_V[String(v.v)];
        const mapped = nm && m[nm] ? m[nm] : (v.v === "" ? "" : v.v);
        return { n: v.n, v: mapped };
      }),
    };
  });
  // 6 大类 × 四排；首层 key 严格等于 class[].type_id（R03）
  const out = {};
  for (const tid of Object.keys(FILTERS.typeIds)) out[tid] = rows;
  return out;
}

function classFor(upKey) {
  const m = typeMaps.get(upKey) || {};
  const want = ["电影", "连续剧", "综艺", "动漫", "短剧", "纪录片"];
  const aliases = {
    "电影": ["电影", "电影片"], "连续剧": ["连续剧", "电视剧"], "综艺": ["综艺", "综艺片"],
    "动漫": ["动漫", "动漫片", "动画片"], "短剧": ["短剧", "短剧大全"],
    "纪录片": ["纪录片", "记录片", "纪录"],
  };
  const ids = ["1", "2", "3", "4", "5", "6"];
  return want.map((nm, i) => {
    let tid = ids[i];
    for (const a of aliases[nm]) if (m[a]) { tid = String(m[a]); break; }
    return { type_id: tid, type_name: nm, type_flag: "" };
  });
}

function localFilter(list, q) {
  const area = (q.get("area") || "").trim();
  let out = list;
  if (area) out = out.filter((x) => String(x.vod_area || "").includes(area));
  const by = (q.get("by") || "").trim();
  if (by === "time") out = [...out].sort((a, b) => String(b.vod_time || "").localeCompare(String(a.vod_time || "")));
  else if (by === "hits") out = [...out].sort((a, b) => Number(b.vod_hits || 0) - Number(a.vod_hits || 0));
  else if (by === "score") out = [...out].sort((a, b) => Number(b.vod_score || 0) - Number(a.vod_score || 0));
  return out;
}

async function handle(req, res) {
  const q = new URL(req.url, "http://127.0.0.1").searchParams;
  const ac = q.get("ac") || "list";
  const upKey = q.get("src") || UPSTREAMS[0].key;
  const up = UPSTREAMS.find((x) => x.key === upKey) || UPSTREAMS[0];

  // 透传给源站的参数（f={json} 是壳冗余加的，绝不转发）
  const pass = {};
  for (const k of ["ac", "pg", "t", "year", "wd", "ids", "h", "play", "flag"]) {
    const v = q.get(k); if (v !== null && v !== "") pass[k] = v;
  }
  // by/area 不转发：源站支持不一致，统一本地处理，避免 360 收到 area 却返回全库
  const cacheKey = up.key + ":" + new URLSearchParams(pass).toString();
  let txt = cacheGet(cacheKey);
  if (!txt) {
    try {
      txt = await fetchUpstream(up, pass);
      cacheSet(cacheKey, txt);
    } catch (e) {
      txt = diskGet(cacheKey) || diskGet("list:" + up.key);
      if (!txt) {
        res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ code: -1, msg: "上游全挂且无缓存", list: [], class: [], filters: filtersFor(up.key) }));
        return;
      }
    }
  }

  let j;
  try { j = JSON.parse(txt); } catch {
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ code: -1, msg: "上游非 JSON", list: [] }));
    return;
  }

  if (ac === "list") {
    // E1：注入顶层 filters + 规范化 6 大类，壳据此渲染四排 GridFilterDialog
    j.class = classFor(up.key);
    j.filters = filtersFor(up.key);
  } else if (ac === "videolist") {
    // E2：t/year 已由源站过滤；area/by 本地兜底
    j.list = localFilter(Array.isArray(j.list) ? j.list : [], q);
    j.limit = j.list.length;
  }
  // E3 detail 原样透传

  const body = JSON.stringify(j);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=600",
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

await loadTypeMaps();
http.createServer((req, res) => { handle(req, res).catch((e) => {
  res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ code: -1, msg: e.message, list: [] }));
}); }).listen(PORT, () => {
  console.log("[gateway] listening 127.0.0.1:" + PORT + " upstreams=" + UPSTREAMS.map((x) => x.key).join(","));
});
