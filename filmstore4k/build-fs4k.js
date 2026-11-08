#!/usr/bin/env node
/**
 * 生成聚合接口配置（filmstore4k/）—— 静态构建版
 *
 * 输出（写入 x/f1345f4a17efd9/）：
 *   fs4k.json    聚合接口的 TVBox 配置（多仓子线路，直连即播）
 *               sites = 聚合站(经本服务) + 各直连源（按实测延迟排序）
 *
 * 由 scripts/build.py 流水线调用：node filmstore4k/build-fs4k.js
 * 也可以独立跑：node filmstore4k/build-fs4k.js
 *
 * 关键：所有源都实测过 ac=videolist 才写进去（死源剔除），延迟排序。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname; // 本项目根（build-fs4k.js 位于 filmstore-4k/ 下）
const outDir = process.env.FS4K_OUT || join(root, "dist");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// 实测存活源（scripts/check-sources.js 验证过，标注延迟 ms）
const LIVE_SOURCES = [
  { key: "bfzy",    name: "暴风资源", api: "https://bfzyapi.com/api.php/provide/vod/",                ms: 767 },
  { key: "lzi",     name: "量子资源", api: "https://cj.lziapi.com/api.php/provide/vod/",              ms: 687 },
  { key: "ffzy",    name: "非凡影视", api: "https://cj.ffzyapi.com/api.php/provide/vod/",             ms: 696 },
  { key: "dytt",    name: "电影天堂", api: "http://caiji.dyttzyapi.com/api.php/provide/vod/",         ms: 780 },
  { key: "jian",    name: "建安资源", api: "http://154.219.117.232:9981/jacloudapi.php/provide/vod/", ms: 499 },
  { key: "tyys",    name: "天涯资源", api: "http://tyyszy.com/api.php/provide/vod/",                  ms: 1495 },
  { key: "360zy",   name: "360资源",  api: "https://360zy.com/api.php/provide/vod/",                  ms: 823 },
  { key: "yinghua", name: "樱花资源", api: "https://m3u8.apiyhzy.com/api.php/provide/vod/",           ms: 1828 },
  { key: "jinying", name: "金鹰资源", api: "https://jyzyapi.com/api.php/provide/vod/",                ms: 961 },
  { key: "modu",    name: "魔都资源", api: "https://www.mdzyapi.com/api.php/provide/vod/",            ms: 1200 },
  { key: "sony",    name: "索尼资源", api: "https://suoniapi.com/api.php/provide/vod/",               ms: 1600 },
];

async function checkSource(s) {
  const u = new URL(s.api);
  u.searchParams.set("ac", "videolist");
  u.searchParams.set("pg", "1");
  const t0 = Date.now();
  try {
    const res = await fetch(u.toString(), {
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*" },
      signal: AbortSignal.timeout(9000),
      redirect: "follow",
    });
    if (!res.ok) return { ...s, ok: false, ms: Date.now() - t0, err: `HTTP ${res.status}` };
    const data = JSON.parse((await res.text()).replace(/^\uFEFF/, ""));
    const list = data.list || [];
    if (Number(data.code) !== 1 || !list.length) return { ...s, ok: false, ms: Date.now() - t0, err: "空列表" };
    return { ...s, ok: true, ms: Date.now() - t0, total: data.total ?? list.length };
  } catch (e) {
    return { ...s, ok: false, ms: Date.now() - t0, err: e.name === "TimeoutError" ? "超时" : String(e.message || e).slice(0, 40) };
  }
}

console.log("实测所有源…");
const checked = await Promise.all(LIVE_SOURCES.map(checkSource));
const alive = checked.filter((s) => s.ok).sort((a, b) => a.ms - b.ms);
const dead = checked.filter((s) => !s.ok);

console.log(`存活 ${alive.length}/${checked.length}`);
for (const d of dead) console.log(`  ✗ ${d.key}: ${d.err}`);
for (const a of alive) console.log(`  ✓ ${a.key.padEnd(9)} ${String(a.ms).padStart(5)}ms  ${a.total ?? "?"}条`);

// 生成聚合配置：全部存活源并列，TVBox 内建搜索聚合
const config = {
  spider: "https://cdn.jsdelivr.net/gh/LYK1379030/mybox-80e9c2@main/4konly/spider.jar;md5;9f391d889e28d3c40092fabb562f408c",
  wallpaper: "https://picsum.photos/1280/720",
  sites: [
    // 4K 网盘原盘站（csp 插件，仓库 jar 已含）
    { key: "玩偶4K", name: "🔥玩偶 | 4K原盘", type: 3, api: "csp_Wogg", searchable: 1, quickSearch: 1, filterable: 1, changeable: 1, timeout: 60,
      ext: { site: ["https://www.wogg.live", "https://woggpan.888484.xyz"] } },
    { key: "快映4K", name: "🔥快映 | 4K", type: 3, api: "csp_PanWebShare", searchable: 1, quickSearch: 1, filterable: 1, timeout: 60,
      ext: { site: ["http://xsayang.fun"] } },
    { key: "八零4K", name: "🔥八零 | 4K", type: 3, api: "csp_PanWebShare", searchable: 1, quickSearch: 1, filterable: 1, timeout: 60,
      ext: { site: ["https://www.80yy3.com", "https://woog.430520.xyz"] } },
    { key: "闪电4K", name: "🔥闪电 | 4K", type: 3, api: "csp_PanWebShare", searchable: 1, quickSearch: 1, filterable: 1, timeout: 60,
      ext: { site: ["http://xhban.xyz"] } },
    // 实测存活的直连源（按延迟排序，前面最快）
    ...alive.map((s) => ({
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
    alive: alive.length,
    totalResources: alive.reduce((s, x) => s + (x.total || 0), 0),
    note: "4K 原盘走 csp 网盘插件（仓库 jar 内置），1080P/HD 走实测直连源。所有源构建时实测存活。",
  },
};

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "fs4k.json");
writeFileSync(outPath, JSON.stringify(config, null, 2), "utf8");
console.log(`\n✅ 已写入 ${outPath}`);
console.log(`   站点数: ${config.sites.length}（4K原盘 4 + 直连 ${alive.length}）`);
console.log(`   资源总量: ${config._meta.totalResources.toLocaleString()} 条`);
