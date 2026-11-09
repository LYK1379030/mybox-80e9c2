#!/usr/bin/env node
/**
 * 筛选线路契约冒烟单测（cat-verifier，写域独占）
 * ============================================================
 * 用途：锁死 DESIGN_RISKS.md 的 R01/R02/R03 三处「静默空页」陷阱，
 *       外加 DESIGN_ZERO_RISK.md 指标 1/2/3 的回归断言。
 *
 * 运行：
 *   node scripts/test-filter-contract.mjs                 # 内联 fixture 自检（现在就能跑，给真实 PASS/FAIL）
 *   node scripts/test-filter-contract.mjs \
 *       --rule  filmstore4k/filter/spider-filter.js \
 *       --data  filmstore4k/filter/filter-data.json \
 *       --line  x/f1345f4a17efd9/filter-line.json \
 *       --index x/f1345f4a17efd9/index.json              # 对 builder 最终产物跑
 *   node scripts/test-filter-contract.mjs --offline       # T6 不联网（只做基线自比，标 SKIP）
 *   node scripts/test-filter-contract.mjs --json          # 机器可读输出
 *
 * 环境变量等价：FILTER_RULE / FILTER_DATA / FILTER_LINE / FILTER_INDEX
 *
 * 模拟方式：把规则当 ES module import（data: URL 或 file: URL），
 *          在 globalThis 上装 mock 的 req / request（返回 filter-data.json 内容），
 *          再复刻 assets/js/lib/spider.js 的加载链：
 *              if (!globalThis.__JS_SPIDER__) {
 *                  if (spider.__jsEvalReturn) globalThis.__JS_SPIDER__ = spider.__jsEvalReturn()
 *                  else if (spider.default) globalThis.__JS_SPIDER__ = typeof spider.default === 'function' ? spider.default() : spider.default
 *              }
 *
 * 说明：本脚本只读，不改任何产物；退出码 0=全 PASS（允许 SKIP），1=存在 FAIL。
 *      单测自身带 3 个「负向对照」，用来证明断言真的会拦住坏输入，而不是恒真。
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes("--" + n);
const env = (n) => process.env[n] || undefined;

const RULE_PATH = arg("rule") || env("FILTER_RULE");
const DATA_PATH = arg("data") || env("FILTER_DATA");
const LINE_PATH = arg("line") || env("FILTER_LINE");
const INDEX_PATH = arg("index") || env("FILTER_INDEX");
const OFFLINE = has("offline");
const AS_JSON = has("json");

const ONLINE_INDEX = "https://lyk1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/index.json";

// ---------------------------------------------------------------------------
// T6 基线：2026-11-08 从线上 index.json 真拉的 6 条（bytes=956 / urls=6）
// 注意：★1 的「1513628条资源」是每日 CI 动态数字，逐字比对会天天误报。
//       因此 T6 对 name 做 normalizeName() 后再比，url 仍逐字严格比对。
// ---------------------------------------------------------------------------
const BASELINE_6 = [
  { name: "★1 主用·聚合全站（15 站·1513628条资源）", url: "https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/fs4k2.json" },
  { name: " 2 备用·纯直连保底（最稳）", url: "https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/fs4k3.json" },
  { name: " 3 进阶·4K网盘专线（低配设备勿试）", url: "https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/fs4kc.json" },
  { name: "老线·直连合集（21条）", url: "https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/c1.json" },
  { name: "老线·直连合集（46条）", url: "https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/c2.json" },
  { name: " 5 老线·4K直连专区（8 条·免授权）", url: "https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/4k.json" },
];
const normalizeName = (s) => String(s).replace(/\d+条资源/g, "<N>条资源");

// ---------------------------------------------------------------------------
// 内联 fixture：一份「满足契约」的最小规则 + 数据 + 子仓配置
// 只在未给 --rule / --line 时使用，用来证明单测本身会给真实 PASS/FAIL。
// ---------------------------------------------------------------------------
const YEARS = [1995, 2003, 2012, 2018, 2020, 2021, 2022, 2024, 2025, 2026];
const TYPES = ["喜剧", "动作", "爱情", "科幻", "剧情"];
const AREAS = ["华语", "欧美", "日本", "韩国"];
// 真实 filter-data.json 每条带 decade（中文年代名），规则按 it.decade 比较；
// 内联 fixture 必须同形，否则 T3 用英文 2020s 喂进去会被规则全过滤掉。
function decadeOf(y) {
  const d = Math.floor(y / 10) * 10;
  return d < 1980 ? "更早" : d + "年代";
}
const FIXTURE_DATA = {
  _meta: { generated: "2026-11-08T00:00:00Z", samplePages: 2, countIsSample: true, source: "inline-fixture" },
  list: Array.from({ length: 30 }, (_, i) => ({
    vod_id: String(1000 + i), vod_name: "测试影片" + (i + 1),
    type_id: "1", type_name: TYPES[i % 5], vod_area: AREAS[i % 4],
    vod_year: String(YEARS[i % 10]), vod_class: TYPES[i % 5], decade: decadeOf(YEARS[i % 10]),
    vod_pic: "", vod_remarks: "", vod_play_from: "测试",
    vod_play_url: "https://example.invalid/a.m3u8",
  })),
};

// 规则里恰好 1 个 req 调用点；唯一的 http(s) 字面量指向自托管 filter-data.json。
const FIXTURE_RULE = String.raw`
const DATA_URL = 'https://lyk1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/filter-data.json';
let CACHE = null;
function loadData() {
  if (CACHE) return CACHE;
  const raw = globalThis.req(DATA_URL);
  const text = typeof raw === 'string' ? raw : (raw && raw.content !== undefined ? raw.content : '');
  CACHE = JSON.parse(text);
  return CACHE;
}
function yearKey(v) {
  const y = parseInt(String(v || '').slice(0, 4), 10);
  if (!Number.isInteger(y) || y < 1900) return 'unknown';
  const d = Math.floor(y / 10) * 10;
  return d < 1980 ? 'older' : d + 's';
}
function areaOf(v) {
  const s = String(v || '');
  if (/大陆|内地|华语|中国|香港|台湾|港澳/.test(s)) return '华语';
  if (/欧美|美国|英国|法国|德国|意大利|西班牙|加拿大|俄罗斯/.test(s)) return '欧美';
  if (/日本/.test(s)) return '日本';
  if (/韩国|韩/.test(s)) return '韩国';
  return s;
}
function decadeOptions() {
  const cur = new Date().getUTCFullYear();
  const top = Math.floor(cur / 10) * 10;
  const out = [{ n: '全部', v: '' }];
  for (let d = top; d >= 1980; d -= 10) out.push({ n: d + '年代', v: d + 's' });
  out.push({ n: '更早', v: 'older' }, { n: '年代不详', v: 'unknown' });
  return out;
}
function buildFilters(typeId) {
  const o = {};
  o[typeId] = [
    { key: 'type', name: '类型', value: [
      { n: '全部', v: '' }, { n: '喜剧', v: '喜剧' }, { n: '动作', v: '动作' },
      { n: '爱情', v: '爱情' }, { n: '科幻', v: '科幻' }, { n: '剧情', v: '剧情' }] },
    { key: 'area', name: '地区', value: [
      { n: '全部', v: '' }, { n: '华语', v: '华语' }, { n: '欧美', v: '欧美' },
      { n: '日本', v: '日本' }, { n: '韩国', v: '韩国' }] },
    { key: 'sort', name: '排序', value: [
      { n: '近期热度', v: 'hot' }, { n: '首映时间', v: 'time' }, { n: '高分优先', v: 'score' }] },
    { key: 'year', name: '年代', value: decadeOptions() }
  ];
  return o;
}
function homeContent() {
  const classes = [{ type_id: '1', type_name: '电影' }];
  return { code: 1, class: classes, filters: buildFilters(classes[0].type_id), list: [], pagecount: 1, total: 0 };
}
function homeVodContent() { return { list: [] }; }
function categoryContent(tid, pg, filter, extend) {
  const fl = (extend && typeof extend === 'object' && !Array.isArray(extend)) ? extend : {};
  let items = loadData().list.slice();
  if (fl.year) items = items.filter(it => yearKey(it.vod_year) === fl.year);
  if (fl.type) items = items.filter(it => String(it.type_name || '') === fl.type || String(it.vod_class || '').indexOf(fl.type) >= 0);
  if (fl.area) items = items.filter(it => areaOf(it.vod_area) === fl.area || String(it.vod_area || '').indexOf(fl.area) >= 0);
  if (fl.sort === 'time') items.sort((a, b) => String(b.vod_year).localeCompare(String(a.vod_year)));
  const total = items.length;
  const size = 20;
  const p = Math.max(1, parseInt(pg, 10) || 1);
  return { code: 1, page: p, pagecount: Math.ceil(total / size) || 1, limit: size, total: total,
           list: items.slice((p - 1) * size, p * size) };
}
function detailContent() { return { list: [] }; }
function searchContent() { return { list: [] }; }
function playerContent() { return { parse: 0, url: '' }; }
export function __jsEvalReturn() {
  return { homeContent, homeVodContent, categoryContent, detailContent, searchContent, playerContent };
}
export default __jsEvalReturn;
`;

// 负向对照用：故意导出 drpy2 库风格的内部名（R01 陷阱）
const BAD_RULE = String.raw`
function home() { return '{}'; }
function category() { return '{}'; }
export default { home, category };
`;

const FIXTURE_LINE = {
  spider: "",
  notice: "按类型/地区/年代筛选由本仓库自有规则本地实现；片量为每日抽样，非全量",
  sites: [{
    key: "own_filter", name: "筛选·自有（每日抽样·本地过滤）", type: 3,
    api: "https://lyk1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/spider-filter.js",
    ext: "https://lyk1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/filter-data.json",
    filterable: 1, searchable: 1, quickSearch: 1, changeable: 0,
  }],
  lives: [], parses: [], flags: [],
};

// ---------------------------------------------------------------------------
// 测试框架
// ---------------------------------------------------------------------------
const results = [];
function rec(id, name, status, detail) {
  results.push({ id, name, status, detail: String(detail ?? "") });
  if (!AS_JSON) {
    const tag = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "SKIP";
    console.log(`[${tag}] ${id} ${name}${detail ? " :: " + String(detail).slice(0, 260) : ""}`);
  }
}
// 必须是 async：T1 的 fn 里含 `await import(...)`，同步 check 会把 Promise 当 PASS，
// 造成「断言根本没跑就报绿」的假阳性。所有调用点均 `await check(...)`。
async function check(id, name, fn) {
  try { const d = await fn(); rec(id, name, "PASS", d ?? ""); }
  catch (e) { rec(id, name, "FAIL", e && e.message ? e.message : String(e)); }
}
function skip(id, name, why) { rec(id, name, "SKIP", why); }
function expectReject(id, name, fn) {
  // 负向对照：fn 必须抛错（证明断言不是恒真）
  try { fn(); rec(id, name, "FAIL", "负向对照未抛错：断言形同虚设"); }
  catch (e) { rec(id, name, "PASS", "已正确拒绝坏输入: " + String(e.message).slice(0, 120)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function parseResult(r) {
  if (typeof r === "string") return JSON.parse(r);   // drpy2 规则常返回 JSON 字符串
  if (r && typeof r === "object") return r;
  throw new Error("返回值既非 JSON 字符串也非对象: " + typeof r);
}
const isPlainObject = (o) => !!o && typeof o === "object" && !Array.isArray(o);

// T2 的纯断言函数（正负对照共用）
function assertFiltersShape(home, ruleSource) {
  assert(isPlainObject(home), "homeContent 返回值不是对象");
  assert(Array.isArray(home.class) && home.class.length > 0, "class 缺失或为空数组");
  const ids = home.class.map(c => String(c.type_id));
  assert(isPlainObject(home.filters), "filters 不是 object-of-arrays（数组/false/字符串会触发 FilterAdapter 静默空页）");
  const keys = Object.keys(home.filters);
  assert(keys.length === ids.length && keys.every(k => ids.includes(k)),
    "filters 首层 key 与 class[].type_id 不一致: filters=" + JSON.stringify(keys) + " class=" + JSON.stringify(ids));
  const allRows = [];
  for (const k of keys) {
    assert(Array.isArray(home.filters[k]), `filters["${k}"] 不是数组`);
    for (const row of home.filters[k]) {
      assert(isPlainObject(row), "筛选行不是对象");
      assert(typeof row.key === "string" && row.key.length > 0, "筛选行缺 key");
      assert(typeof row.name === "string" && row.name.length > 0, "筛选行缺 name");
      assert(Array.isArray(row.value), `筛选行 ${row.key} 的 value 不是数组`);
      for (const v of row.value) {
        assert(isPlainObject(v), `筛选行 ${row.key} 的 value 元素不是对象`);
        assert(JSON.stringify(Object.keys(v).sort()) === JSON.stringify(["n", "v"]),
          `value 元素字段名必须是 n/v，实际=${JSON.stringify(Object.keys(v))}`);
      }
      allRows.push(row);
    }
  }
  // 筛选行 key：researcher 零 jar 契约里中文键（类型/地区/排序/年代）优先，英文兜底。
  // 单测两种都接受，只要求「四类语义齐全」——用 name 匹配，不锁死 key 语言。
  const names = allRows.map(r => r.name);
  for (const need of ["类型", "地区", "排序", "年代"]) assert(names.includes(need), "四排筛选缺: " + need);
  const yearRow = allRows.find(r => r.name === "年代" || r.key === "year");
  assert(yearRow, "缺 year 行");
  // 真实规则年代档用中文名（如「2020年代」），旧契约用英文 slug（2020s），两种都接受。
  const cur = new Date().getUTCFullYear();
  const top = Math.floor(cur / 10) * 10;
  const topLabels = [top + "s", top + "年代", String(top) + "年代"];
  assert(yearRow.value.some(v => topLabels.includes(String(v.v))),
    `年代档缺当前十年档 ${top}（疑似硬编码；实际值=${JSON.stringify(yearRow.value.map(v=>v.v).slice(0,6))}）`);
  assert(!/20\d\d&20\d\d&20\d\d/.test(ruleSource), "规则源码出现 & 分隔的硬编码年份列表");
  // 「不硬编码年份」的实质：年代档由 CI 生成器按 CURRENT_UTC_YEAR 注入。
  // 生成器把值写进规则顶部常量（每天重建时刷新），故检查该常量 == 当前 UTC 年即可，
  // 不再要求规则源码里出现 getUTCFullYear() 字符串（那是生成器里的，不是规则里的）。
  const curYear = new Date().getUTCFullYear();
  const mYear = ruleSource.match(/CURRENT_UTC_YEAR\s*=\s*(\d{4})/);
  assert(mYear && Number(mYear[1]) === curYear,
    `规则缺少由生成器注入的当前年份常量 CURRENT_UTC_YEAR=${curYear}（疑似硬编码/未重建）`);
  return `class=${JSON.stringify(ids)} rows=${JSON.stringify(names)} topDecade=${top} curYear=${curYear}`;
}

// T3 的纯断言函数
function assertFiltering(plain, year, comedy, hua, p1, p2) {
  const a = parseResult(plain), b = parseResult(year), c = parseResult(comedy),
        d = parseResult(hua), e = parseResult(p1), f = parseResult(p2);
  for (const [n, r] of [["plain", a], ["year", b], ["comedy", c], ["hua", d], ["pg1", e], ["pg2", f]])
    assert(Array.isArray(r.list), n + " 返回缺 list 数组");
  assert(a.list.length > 0, "无筛选时列表为空，无法比对");
  const nPlain = a.list.length, nYear = b.list.length;
  // 语义断言（不依赖「数量必须变」）：2020年代筛出的每条 decade 必须是 2020年代，
  // 且结果集合是无筛选结果的真子集或 total 不同。某个分类恰好全是 2020 年代片时
  // 数量可以相同，不能据此误判 R02 陷阱。
  assert(nYear > 0, "2020s 筛选结果为空");
  for (const it of b.list) {
    const dec = String(it.decade || "");
    const y = Number(String(it.vod_year).slice(0, 4));
    assert(dec === "2020年代" || (y >= 2020 && y <= 2029), `2020s 结果混入: decade=${dec} vod_year=${it.vod_year}`);
  }
  const idsPlain = new Set(a.list.map(x => String(x.vod_id)));
  const idsYear = new Set(b.list.map(x => String(x.vod_id)));
  const subset = [...idsYear].every(id => idsPlain.has(id));
  assert(subset && (Number(b.total) !== Number(a.total) || [...idsYear].some(id => !idsPlain.has(id)) || [...idsPlain].some(id => !idsYear.has(id)) || nYear <= nPlain),
    "第 4 参 extend 未生效：筛选结果与无筛选结果完全一致且无任何年代约束证据（R02 陷阱）");
  // 类型/地区同样用语义断言：该分类里可能恰好没有喜剧/华语片（返回空或全部命中都合法），
  // 关键是「结果里不能混入不匹配的条目」，而不是「数量必须变」。
  assert(c.list.length > 0, "{type:'喜剧'} 结果为空（该分类无喜剧片属正常，但单测需有数据；换 probe 分类）");
  for (const it of c.list) assert(/喜剧/.test(String(it.type_name) + String(it.vod_class || "")), "喜剧筛选混入: " + it.type_name);
  assert(d.list.length > 0, "{area:'华语'} 结果为空（聚合词展开应命中 中国大陆/内地/香港/台湾 等）");
  const HUA = /华语|中国大陆|中国香港|中国台湾|大陆|内地|港澳|香港|台湾|中国/;
  for (const it of d.list) assert(HUA.test(String(it.vod_area)), "华语筛选混入: " + it.vod_area);
  assert(e.list.length > 0 && f.list.length > 0, "pg=1/pg=2 有一页为空，无法验证不重复");
  const s1 = new Set(e.list.map(x => String(x.vod_id)));
  const overlap = f.list.filter(x => s1.has(String(x.vod_id)));
  assert(overlap.length === 0, "pg=1 与 pg=2 出现重复条目 " + overlap.length + " 条");
  return `plain=${nPlain} year=${nYear} comedy=${c.list.length} hua=${d.list.length} pg1=${e.list.length} pg2=${f.list.length} overlap=0`;
}

// ---------------------------------------------------------------------------
// 载入目标（fixture / builder 产物）
// ---------------------------------------------------------------------------
function readText(p, label) {
  if (!p) return null;
  if (!fs.existsSync(p)) throw new Error(`${label} 路径不存在: ${p}`);
  // 剥 UTF-8 BOM：Windows/PowerShell 生成的文件常带 BOM，会让 JSON.parse 直接炸，
  // 掩盖掉真正要测的 jar / 结构断言。客户端 OkHttp 一般也按无 BOM 处理。
  return fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
}
const ruleSrc = readText(RULE_PATH, "rule") ?? FIXTURE_RULE;
const lineSrc = readText(LINE_PATH, "line") ?? JSON.stringify(FIXTURE_LINE, null, 2);
const _prodData = DATA_PATH ? JSON.parse(readText(DATA_PATH, "data")) : null;
// PRODUCT 模式下若源站全挂 → 生成器按设计产出 stale 空数据（0 条）。
// 此时 T3 测的是「第 4 参 extend 是否驱动本地过滤」这个逻辑本身，
// 与当天有无片源无关：空数据回落到内联 FIXTURE_DATA，并在输出里如实标注 DATA_FALLBACK。
const DATA_FALLBACK = !!(_prodData && Array.isArray(_prodData.list) && _prodData.list.length === 0);
const dataFixture = _prodData && !DATA_FALLBACK ? _prodData : FIXTURE_DATA;
const MODE = (RULE_PATH || LINE_PATH || DATA_PATH) ? "PRODUCT" : "FIXTURE";

if (!AS_JSON) {
  console.log("=".repeat(78));
  console.log("筛选线路契约冒烟单测  mode=" + MODE + "  node=" + process.version);
  console.log("rule=" + (RULE_PATH || "<inline fixture>") + "  data=" + (DATA_PATH || "<inline fixture>"));
  console.log("line=" + (LINE_PATH || "<inline fixture>") + "  index=" + (INDEX_PATH || "<live fetch>"));
  if (DATA_FALLBACK) console.log("DATA_FALLBACK: 产物数据为空(stale)，T3 逻辑改用内联 fixture 测，真实数据待源站恢复后复跑");
  console.log("=".repeat(78));
}

// mock 的 req / request：返回「String 对象 + content 字段」的混合体，
// 同时兼容 JSON.parse(req(url)) 与 req(url).content 两种写法。
const reqCalls = [];
// 先留一份原生 fetch 给 T6 的线上基线拉取，再覆盖成 undefined：
// 规则里若误用 fetch 会立刻 TypeError（属 FAIL，而不是静默通过）。
const NATIVE_FETCH = globalThis.fetch;
globalThis.req = (url) => {
  reqCalls.push(String(url));
  const s = new String(JSON.stringify(dataFixture));
  s.content = String(s); s.ok = true; s.status = 200; s.url = String(url);
  return s;
};
globalThis.request = globalThis.req;
globalThis.fetch = undefined;

async function loadModule(src, label) {
  const url = "data:text/javascript;base64," + Buffer.from(src).toString("base64");
  try { return await import(url); }
  catch (e) { throw new Error(`${label} ES module 加载失败: ${e.message}`); }
}
// 复刻 assets/js/lib/spider.js 的加载链
function spiderChain(mod) {
  globalThis.__JS_SPIDER__ = undefined;
  if (mod.__jsEvalReturn) globalThis.__JS_SPIDER__ = mod.__jsEvalReturn();
  else if (mod.default) globalThis.__JS_SPIDER__ = typeof mod.default === "function" ? mod.default() : mod.default;
  return globalThis.__JS_SPIDER__;
}

const REQUIRED = ["homeContent", "homeVodContent", "categoryContent", "detailContent", "searchContent", "playerContent"];
function assertExports(sp) {
  assert(isPlainObject(sp), "__JS_SPIDER__ 不是对象（导出形状错）");
  const miss = REQUIRED.filter(k => typeof sp[k] !== "function");
  assert(miss.length === 0, "缺方法: " + miss.join(","));
  return REQUIRED.join(",");
}

let SPIDER = null;
let MOD = null;

async function main() {
  // ---------------- T1 导出形状 ----------------
  await check("T1", "__jsEvalReturn 导出 6 个 Spider 方法", async () => {
    MOD = await loadModule(ruleSrc, "rule");
    SPIDER = spiderChain(MOD);
    return assertExports(SPIDER);
  });
  // 负向对照：drpy2 库风格导出（home/category 而非 homeContent/...）必须被拦
  try {
    const bad = await loadModule(BAD_RULE, "bad rule");
    const badSp = spiderChain(bad);
    expectReject("T1-NEG", "负向对照：错误导出必须被拒", () => assertExports(badSp));
  } catch (e) { rec("T1-NEG", "负向对照：错误导出必须被拒", "FAIL", e.message); }

  // ---------------- T2 filters 形状 ----------------
  await check("T2", "filters 为 object-of-arrays / 四排齐全 / 年代动态", () => {
    assert(SPIDER, "T1 未通过，跳过");
    const home = parseResult(SPIDER.homeContent());
    const r = assertFiltersShape(home, ruleSrc);
    // 配置顶层不得出现 filters（由 homeContent 运行时返回）
    const cfg = JSON.parse(lineSrc);
    assert(!("filters" in cfg), "filter-line.json 顶层出现 filters 字段（会触发 FilterAdapter 静默空页）");
    return r;
  });
  expectReject("T2-NEG1", "负向对照：filters 为数组必须被拒", () =>
    assertFiltersShape({ class: [{ type_id: "1" }], filters: [] }, ruleSrc));
  expectReject("T2-NEG2", "负向对照：value 元素字段名非 n/v 必须被拒", () =>
    assertFiltersShape({ class: [{ type_id: "1" }], filters: { "1": [
      { key: "type", name: "类型", value: [{ label: "全部", val: "" }] },
      { key: "area", name: "地区", value: [{ n: "全部", v: "" }] },
      { key: "sort", name: "排序", value: [{ n: "默认", v: "" }] },
      { key: "year", name: "年代", value: [{ n: "全部", v: "" }] },
    ] } }, ruleSrc));

  // ---------------- T3 本地过滤真生效（第 4 参） ----------------
  await check("T3", "categoryContent 第 4 参 extend 生效 + 分页不重复", () => {
    assert(SPIDER, "T1 未通过，跳过");
    // 用 "all"（全部）分类做筛选测试：它包含全部片源，喜剧/华语/年代各档都有数据，
    // 避免某个细分分类恰好没有某类片导致误判（语义断言仍需结果里不混入不匹配项）。
    const tid = "all";
    const plain = SPIDER.categoryContent(tid, 1, false, {});
    // 真实规则按 it.decade（中文年代名，如「2020年代」）比较；
    // 同时喂中英文两种写法，确保兼容 researcher 契约的中文优先 + 英文兜底。
    const year = SPIDER.categoryContent(tid, 1, false, { 年代: "2020年代", year: "2020s" });
    const comedy = SPIDER.categoryContent(tid, 1, false, { type: "喜剧" });
    const hua = SPIDER.categoryContent(tid, 1, false, { area: "华语" });
    const p1 = SPIDER.categoryContent(tid, 1, false, {});
    const p2 = SPIDER.categoryContent(tid, 2, false, {});
    return assertFiltering(plain, year, comedy, hua, p1, p2);
  });
  expectReject("T3-NEG", "负向对照：忽略 extend（结果不变）必须被拒", () => {
    const same = { code: 1, total: 30, list: FIXTURE_DATA.list.slice(0, 20) };
    assertFiltering(same, same, same, same, same, same);
  });

  // ---------------- T4 零运行时外网 ----------------
  await check("T4", "规则静态：req/request/fetch 恰好 1 处且只指向 filter-data.json", () => {
    const calls = [...ruleSrc.matchAll(/\b(?:req|request|fetch)\s*\(/g)];
    assert(calls.length === 1, `网络调用点=${calls.length}，要求恰好 1`);
    const urls = ruleSrc.match(/https?:\/\/[^\s'"`)]+/g) || [];
    assert(urls.length >= 1, "规则里没有任何数据文件 URL");
    for (const u of urls) assert(/filter-data\.json/.test(u), "出现非数据文件 URL: " + u);
    assert(!/Promise\.all\s*\(/.test(ruleSrc), "出现 Promise.all（同步并发抓源）");
    assert(!/from\s*['"][^'"]*(?:http|net)\.js/.test(ruleSrc), "规则直接 import http.js/net.js");
    const idx = calls[0].index;
    const before = ruleSrc.slice(Math.max(0, idx - 300), idx).split("\n").slice(-4).join("\n");
    assert(!/(?:for\s*\(|while\s*\(|\.forEach\s*\(|\.map\s*\()/.test(before), "网络调用疑似位于循环内（循环抓源）");
    return `calls=1 urls=${JSON.stringify([...new Set(urls)])}`;
  });
  await check("T4b", "运行时：整轮调用 req 恰好 1 次（数据已缓存）", () => {
    assert(reqCalls.length === 1, `req 实际调用 ${reqCalls.length} 次，要求 1（每次筛选重拉数据会 ANR）`);
    return "reqCalls=1 url=" + reqCalls[0];
  });

  // ---------------- T5 零 jar ----------------
  await check("T5", "filter-line.json 零 jar / type:3 / .js api / 无 csp_ / 无 ;md5;", () => {
    const cfg = JSON.parse(lineSrc);
    assert(!(";md5;" in cfg) && !lineSrc.includes(";md5;"), "全文出现 ;md5; 绑定");
    assert(!lineSrc.includes("csp_"), "全文出现 csp_ jar 站点");
    const topSpider = cfg.spider;
    assert(topSpider === undefined || topSpider === null || topSpider === "", "顶层 spider 非空: " + JSON.stringify(topSpider));
    assert(Array.isArray(cfg.sites) && cfg.sites.length > 0, "sites 为空");
    for (const [i, s] of cfg.sites.entries()) {
      assert(s.spider === undefined || s.spider === "" || s.spider === null, `sites[${i}].spider 非空`);
      assert(s.jar === undefined || s.jar === "" || s.jar === null, `sites[${i}].jar 非空`);
      assert(s.type === 3, `sites[${i}].type=${s.type}，要求 3（待真机确认，见 DESIGN_VERIFY 未覆盖项）`);
      assert(typeof s.api === "string" && s.api.includes(".js"), `sites[${i}].api 不含 .js: ${s.api}`);
      assert(!String(s.api).startsWith("csp_"), `sites[${i}].api 是 csp_ 站点`);
    }
    assert(!("filters" in cfg), "顶层存在 filters");
    return `sites=${cfg.sites.length} topSpider=${JSON.stringify(topSpider)}`;
  });

  // ---------------- T6 回归：原 6 条字节不变 ----------------
  let idxText = null, idxSrc = "<none>";
  if (INDEX_PATH) { idxText = readText(INDEX_PATH, "index"); idxSrc = INDEX_PATH; }
  else if (!OFFLINE) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await NATIVE_FETCH(ONLINE_INDEX, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Android TV)" } });
      clearTimeout(t);
      if (!r.ok) throw new Error("HTTP " + r.status);
      idxText = await r.text(); idxSrc = ONLINE_INDEX;
    } catch (e) { idxText = null; idxSrc = "fetch failed: " + e.message; }
  }
  if (!idxText) {
    skip("T6", "原 6 条主线路名字/顺序/url 不变", OFFLINE ? "--offline 且未给 --index" : idxSrc);
  } else {
    await check("T6", "原 6 条主线路名字/顺序/url 不变（新增只在尾部）", () => {
      const j = JSON.parse(idxText);
      assert(Array.isArray(j.urls) && j.urls.length >= 6, `urls 数量=${j.urls && j.urls.length}，至少 6`);
      for (let i = 0; i < 6; i++) {
        const got = j.urls[i], want = BASELINE_6[i];
        assert(normalizeName(got.name) === normalizeName(want.name),
          `第 ${i + 1} 条 name 变更: got=${JSON.stringify(got.name)} want=${JSON.stringify(want.name)}`);
        assert(got.url === want.url, `第 ${i + 1} 条 url 变更: got=${got.url} want=${want.url}`);
      }
      for (let i = 6; i < j.urls.length; i++) {
        assert(String(j.urls[i].name).startsWith("筛选·"), `尾部新增第 ${i + 1} 条命名未用「筛选·」前缀: ${j.urls[i].name}`);
      }
      return `first6=unchanged urls=${j.urls.length} extra=${j.urls.length - 6} src=${idxSrc}`;
    });
  }

  // ---------------- 汇总 ----------------
  const pass = results.filter(r => r.status === "PASS").length;
  const fail = results.filter(r => r.status === "FAIL");
  const skipN = results.filter(r => r.status === "SKIP").length;
  if (!AS_JSON) {
    console.log("-".repeat(78));
    console.log(`SUMMARY mode=${MODE} PASS=${pass} FAIL=${fail.length} SKIP=${skipN} TOTAL=${results.length}`);
    if (fail.length) for (const f of fail) console.log("  FAILED: " + f.id + " " + f.name + " :: " + f.detail);
    console.log("=".repeat(78));
  } else {
    console.log(JSON.stringify({ mode: MODE, pass, fail: fail.length, skip: skipN, results }, null, 2));
  }
  process.exit(fail.length ? 1 : 0);
}

main().catch(e => { console.error("HARNESS ERROR", e); process.exit(2); });
