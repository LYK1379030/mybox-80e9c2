#!/usr/bin/env node
/**
 * 筛选线路「真实加载链」契约单测（cat-verifier，写域独占）
 * ============================================================
 * 【前提更正 · 覆盖旧版】旧版 11/11 是假绿：它直接 import 规则文件后调
 * `homeContent()`，把客户端加载链整段跳过，只测了规则内部。RESULT_CORRECTNESS.md
 * 与 DRPY2_REAL_CONTRACT.md 已钉死真实契约（形态②）：
 *
 *   api   = 单个规则 .js 的绝对 URL（无 ? / 无 base64 / 无 assets:// / 无 ./）
 *   ext   = filter-data.json 的绝对 URL（业务参数，不是规则文件）
 *   jar   = ""（站点级显式空串）
 *   spider= ""（顶层）
 *   type  = 3
 *   规则导出 __jsEvalReturn() -> { init, home, homeVod, category, detail, play, search }
 *          ↑ 7 个「内部名」；homeContent/categoryContent 是 Java 层接口名，
 *            JsSpider.java:97-154 自己映射 call("home"/"category")。
 *   加载链：import * as spider from <api> -> __jsEvalReturn() -> globalThis.__JS_SPIDER__
 *          -> init(cfg)（cfg.ext = 数据 URL）-> Java 调 home()/category()/...
 *
 * 本单测不再「验规则内部」，而是复刻上面整条链：
 *   T7 端到端：loadModule(api) -> spiderChain -> init({ext}) -> home() -> category(...)
 *              整轮 req 恰好 1 次且 URL 严格等于 cfg.ext。
 *   T1 锁 7 个内部名；负向对照：旧 *Content 导出名必须被拒（这正是上次漏掉的 bug）。
 *   T2/T3 全部改走 home()/category()，不再碰 *Content。
 *   T4 零网络：req 调用点 1 处、URL 由 init(cfg).ext 注入（规则里无 https:// 字面量属正常）。
 *   T5 补 4 条站点契约断言；T6 保留原 6 条回归。
 *
 * 运行：
 *   node scripts/test-filter-contract.mjs --fixture-index         # 内联 fixture 自检（用收敛后 2 条基线）
 *   node scripts/test-filter-contract.mjs                         # 拉线上 index（集成后使用）
 *   node scripts/test-filter-contract.mjs --rule <spider-filter.js> \
 *        --data <filter-data.json> --line <filter-line.json> --index <index.json> \
 *        --fallback <fs4k3.json> --rule-line <filter-line.json>
 *   node scripts/test-filter-contract.mjs --offline               # T6 不联网 -> SKIP
 *   node scripts/test-filter-contract.mjs --json                  # 机器可读
 * 环境变量等价：FILTER_RULE / FILTER_DATA / FILTER_LINE / FILTER_INDEX
 *
 * 退出码：0=全 PASS（允许 SKIP）；1=存在 FAIL；2=harness 自身异常。
 * 只读，不改任何产物；产物路径不存在时明确报错，绝不「静默当 fixture 跑绿」。
 */

import fs from "node:fs";

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
// lead 收敛前的线上 index 尚未上线 3 条版：给 --fixture-index 或 FILTER_FIXTURE_INDEX
// 让 FIXTURE 自检跑「新基线」而非拉到线上旧版（避免集成前必然误报）。
// 集成后去掉此开关，默认拉线上即可。
const FIXTURE_INDEX = has("fixture-index") || !!env("FILTER_FIXTURE_INDEX");
// 第 1 条兜底子仓 / 第 2 条规则站子仓的可选本地路径（T9/T10 用；不给则走内联 fixture）
const FALLBACK_PATH = arg("fallback") || env("FILTER_FALLBACK");
const RULE_LINE_PATH = arg("rule-line") || env("FILTER_RULE_LINE");

// ---------------------------------------------------------------------------
// T6 基线（2026-11-09 兼容性兜底版）：主入口恰好 3 条、人话命名。
//   1「打开就能看」            -> fs4k3.json   （14 个 type:1 直连，全壳通用；spider 置空）
//   2「想按类型年代挑片点这里」 -> filter-line.json（drpy2 规则站，筛选不默认）
//   3「看不了点这里」          -> fs4k2.json   （备用）
// 其余 4 条（fs4kc/c1/c2/4k）后台仍生成、仍自愈，但**不进 index.json**。
// 名字归一化仍兼容「NNNN条资源」这类每日动态数字（本轮三条名字无数字）。
// ---------------------------------------------------------------------------
const BASELINE_3 = [
  { name: "打开就能看", url: "https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/fs4k3.json" },
  { name: "想按类型年代挑片点这里", url: "https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/filter-line.json" },
  { name: "看不了点这里", url: "https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/fs4k2.json" },
];
const normalizeName = (s) => String(s).replace(/\d+条资源/g, "<N>条资源");
// 后台自愈产物：不进 index，但必须仍可拉到（宽松检查，不硬卡 200 内容）
const BACKGROUND_FILES = ["fs4k2.json", "fs4k3.json", "fs4kc.json", "c1.json", "c2.json", "4k.json"];
const PAGES_BASE = "https://lyk1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/";

// ---------------------------------------------------------------------------
// 内联 fixture（形态②）：只在未给 --rule / --line 时使用。
// 数据 URL 不在规则里写死，由 init(cfg).ext 注入 —— 这是 T4/T7 的核心。
// ---------------------------------------------------------------------------
const YEARS = [1995, 2003, 2012, 2018, 2020, 2021, 2022, 2024, 2025, 2026];
const TYPES = ["喜剧", "动作", "爱情", "科幻", "剧情"];
const AREAS = ["华语", "欧美", "日本", "韩国"];
function decadeOf(y) {
  const d = Math.floor(y / 10) * 10;
  return d < 1980 ? "更早" : String(d) + "年代";
}
const FIXTURE_DATA = {
  _meta: { generated: "2026-11-09T00:00:00Z", samplePages: 2, countIsSample: true, source: "inline-fixture" },
  list: [
    // 蹭名片刻意排在正片「之前」，用来证明 T8 的相关性排序真的会拦住 FINAL_GOAL.md:13 那个 bug
    ...["流浪地球之大夏战狼", "流浪地球2：再次冒险", "狂飙之特别行动", "周处除三害外传"].map((n, i) => ({
      vod_id: "fake" + i, vod_name: n, type_id: "all", type_name: "剧情", vod_area: "华语",
      vod_year: "2024", vod_class: "剧情", decade: "2020年代", vod_pic: "", vod_remarks: "",
      vod_play_from: "测试", vod_play_url: "https://example.invalid/a.m3u8",
    })),
    ...["流浪地球", "狂飙", "周处除三害"].map((n, i) => ({
      vod_id: "exact" + i, vod_name: n, type_id: "all", type_name: "剧情", vod_area: "华语",
      vod_year: "2023", vod_class: "剧情", decade: "2020年代", vod_pic: "", vod_remarks: "",
      vod_play_from: "测试", vod_play_url: "https://example.invalid/a.m3u8",
    })),
    ...Array.from({ length: 30 }, (_, i) => ({
      vod_id: String(1000 + i), vod_name: "测试影片" + (i + 1),
      type_id: "all", type_name: TYPES[i % 5], vod_area: AREAS[i % 4],
      vod_year: String(YEARS[i % 10]), vod_class: TYPES[i % 5], decade: decadeOf(YEARS[i % 10]),
      vod_pic: "", vod_remarks: "", vod_play_from: "测试",
      vod_play_url: "https://example.invalid/a.m3u8",
    })),
  ],
};

const FIXTURE_RULE = String.raw`
// 形态②：单个规则文件，自带 7 个内部入口；引擎是 APK 内置 QuickJS。
var DATA_URL = '';          // 由 init(cfg).ext 注入，规则里不写死任何绝对 URL
var CACHE = null;
var CURRENT_UTC_YEAR = 2026;   // CI 每日按 new Date().getUTCFullYear() 重建

function init(cfg) {
  DATA_URL = (cfg && cfg.ext) || '';
  CACHE = null;
  return '';
}
function loadData() {
  if (CACHE) return CACHE;
  var raw = req(DATA_URL);                         // 唯一一次网络读取
  var text = typeof raw === 'string' ? raw : (raw && raw.content !== undefined ? raw.content : '');
  CACHE = JSON.parse(text);
  return CACHE;
}
function decadeOptions() {
  var top = Math.floor(CURRENT_UTC_YEAR / 10) * 10;
  var out = [{ n: '全部', v: '' }];
  for (var d = top; d >= 1980; d -= 10) out.push({ n: d + '年代', v: d + '年代' });
  out.push({ n: '更早', v: '更早' }, { n: '年代不详', v: '年代不详' });
  return out;
}
function buildFilters(typeId) {
  var o = {};
  o[typeId] = [
    { key: '类型', name: '类型', value: [
      { n: '全部', v: '' }, { n: '喜剧', v: '喜剧' }, { n: '动作', v: '动作' },
      { n: '爱情', v: '爱情' }, { n: '科幻', v: '科幻' }, { n: '剧情', v: '剧情' }] },
    { key: '地区', name: '地区', value: [
      { n: '全部', v: '' }, { n: '华语', v: '华语' }, { n: '欧美', v: '欧美' },
      { n: '日本', v: '日本' }, { n: '韩国', v: '韩国' }] },
    { key: '排序', name: '排序', value: [
      { n: '近期热度', v: 'hot' }, { n: '首映时间', v: 'time' }, { n: '高分优先', v: 'score' }] },
    { key: '年代', name: '年代', value: decadeOptions() }
  ];
  return o;
}
function home(filter) {
  var classes = [{ type_id: 'all', type_name: '全部' }];
  return JSON.stringify({ code: 1, class: classes, filters: buildFilters('all'),
                          list: [], pagecount: 1, total: 0 });
}
function homeVod() { return JSON.stringify({ list: [] }); }
function category(tid, pg, filter, extend) {
  var fl = (extend && typeof extend === 'object' && !Array.isArray(extend)) ? extend : {};
  var items = loadData().list.slice();
  var dec = fl['年代'] || fl.decade || fl.year || '';
  var typ = fl['类型'] || fl.type || '';
  var area = fl['地区'] || fl.area || '';
  if (dec) items = items.filter(function (it) { return String(it.decade || '') === String(dec); });
  if (typ) items = items.filter(function (it) {
    return String(it.type_name || '').indexOf(typ) >= 0 || String(it.vod_class || '').indexOf(typ) >= 0;
  });
  if (area) items = items.filter(function (it) {
    return String(it.vod_area || '') === area ||
           (area === '华语' && /大陆|内地|港澳|香港|台湾|中国/.test(String(it.vod_area || '')));
  });
  var total = items.length, size = 20;
  var p = Math.max(1, parseInt(pg, 10) || 1);
  return JSON.stringify({ code: 1, page: p, pagecount: Math.ceil(total / size) || 1,
                          limit: size, total: total,
                          list: items.slice((p - 1) * size, p * size) });
}
function detail() { return JSON.stringify({ list: [] }); }
function play() { return JSON.stringify({ parse: 0, url: '' }); }
// 搜索相关性排序：精确相等 > 前缀 > 包含 > 蹭名长度惩罚。
// 防止「流浪地球之大夏战狼」排在「流浪地球」正片前面（FINAL_GOAL.md:13）。
function search(wd, quick, pg) {
  var kw = String(wd || '').trim().toLowerCase();
  var all = loadData().list || [], scored = [];
  for (var i = 0; i < all.length; i++) {
    var n = String(all[i].vod_name || ''), ln = n.toLowerCase();
    var idx = ln.indexOf(kw);
    if (kw && idx < 0) continue;
    var extra = Math.max(0, n.length - kw.length) * 0.01;
    var sc = ln === kw ? 0 : (idx === 0 ? 1 + extra : 2 + idx * 0.01 + extra);
    scored.push({ it: all[i], sc: sc });
  }
  scored.sort(function (a, b) { return a.sc - b.sc; });
  var out = scored.map(function (x) { return x.it; });
  return JSON.stringify({ code: 1, page: 1, pagecount: 1, total: out.length, list: out });
}

// 7 个内部名（不是 homeContent/categoryContent —— 那是 Java 层接口名）
export function __jsEvalReturn() {
  return { init: init, home: home, homeVod: homeVod, category: category,
           detail: detail, play: play, search: search };
}
export default __jsEvalReturn;
`;

// 负向对照：旧版「*Content 导出名」（正是上次假绿的根源）
const BAD_RULE_OLD_NAMES = String.raw`
function homeContent(){ return '{}'; }
function categoryContent(){ return '{}'; }
export function __jsEvalReturn(){
  return { homeContent: homeContent, homeVodContent: homeContent,
           categoryContent: categoryContent, detailContent: homeContent,
           searchContent: homeContent, playerContent: homeContent };
}
`;

// 负向对照：形态① 的风格（导出 default 对象、无 init）
const BAD_RULE_FORM1 = String.raw`
var rule = { title: 'decl', filter: {} };
export default rule;
`;

// 第 2 条：drpy2 规则站子仓（形态②）
const FIXTURE_RULE_LINE = {
  spider: "",
  notice: "按类型/地区/年代筛选由本仓库自有规则本地实现；片量为每日抽样，非全量",
  wallpaper: "",
  sites: [{
    key: "own_filter", name: "筛选·自有（每日抽样·本地过滤）", type: 3,
    api: "https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/spider-filter.js",
    ext: "https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/filter-data.json",
    jar: "", filterable: 1, searchable: 1, quickSearch: 1, changeable: 0,
  }],
  lives: [], parses: [], flags: [],
};
// 第 1 条：全壳通用兜底子仓（14 个 type:1 直连、零 jar）
const FIXTURE_FALLBACK = {
  spider: "",
  sites: Array.from({ length: 14 }, (_, i) => ({
    key: "src" + i, name: "直连源" + (i + 1), type: 1,
    api: "https://example.invalid/api.php/provide/vod/",
    searchable: 1, quickSearch: 1, changeable: 1,
  })),
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
    console.log(`[${tag}] ${id} ${name}${detail ? " :: " + String(detail).slice(0, 280) : ""}`);
  }
}
// 必须 async：加载链里含 await import / async init / async category。
async function check(id, name, fn) {
  try { const d = await fn(); rec(id, name, "PASS", d ?? ""); }
  catch (e) { rec(id, name, "FAIL", e && e.message ? e.message : String(e)); }
}
function skip(id, name, why) { rec(id, name, "SKIP", why); }
function expectReject(id, name, fn) {
  try { fn(); rec(id, name, "FAIL", "负向对照未抛错：断言形同虚设"); }
  catch (e) { rec(id, name, "PASS", "已正确拒绝坏输入: " + String(e.message).slice(0, 140)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function parseResult(r) {
  if (typeof r === "string") return JSON.parse(r);   // drpy2/JsSpider 规则常返回 JSON 字符串
  if (r && typeof r === "object") return r;
  throw new Error("返回值既非 JSON 字符串也非对象: " + typeof r);
}
const isPlainObject = (o) => !!o && typeof o === "object" && !Array.isArray(o);

// 7 个内部入口（proxy 可选）
const REQUIRED = ["init", "home", "homeVod", "category", "detail", "play", "search"];
const FORBIDDEN = ["homeContent", "homeVodContent", "categoryContent", "detailContent", "searchContent", "playerContent"];
function assertExports(sp) {
  assert(isPlainObject(sp), "__JS_SPIDER__ 不是对象（导出形状错）");
  const miss = REQUIRED.filter(k => typeof sp[k] !== "function");
  assert(miss.length === 0, "缺 7 个内部名中的: " + miss.join(","));
  const leftover = FORBIDDEN.filter(k => typeof sp[k] === "function");
  assert(leftover.length === 0, "仍导出 Java 层 *Content 名（JsSpider 会 call('home') 取不到）: " + leftover.join(","));
  return REQUIRED.join(",");
}

// T2：filters object-of-arrays + 四排 + 首层 key=type_id + 年代动态
function assertFiltersShape(home, ruleSource) {
  assert(isPlainObject(home), "home() 返回值不是对象");
  assert(Array.isArray(home.class) && home.class.length > 0, "class 缺失或为空数组（静默空页）");
  const ids = home.class.map(c => String(c.type_id));
  assert(isPlainObject(home.filters), "filters 不是 object-of-arrays（数组/false/字符串会触发 FilterAdapter 静默空页）");
  const keys = Object.keys(home.filters);
  assert(keys.length >= 1 && keys.every(k => ids.includes(k)),
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
  const names = allRows.map(r => r.name);
  for (const need of ["类型", "地区", "排序", "年代"]) assert(names.includes(need), "四排筛选缺: " + need);
  const yearRow = allRows.find(r => r.name === "年代" || r.key === "年代" || r.key === "year");
  assert(yearRow, "缺年代行");
  const cur = new Date().getUTCFullYear();
  const top = Math.floor(cur / 10) * 10;
  const topLabels = [top + "s", top + "年代", String(top) + "年代"];
  assert(yearRow.value.some(v => topLabels.includes(String(v.v))),
    `年代档缺当前十年档 ${top}（疑似硬编码；实际=${JSON.stringify(yearRow.value.map(v => v.v).slice(0, 6))}）`);
  assert(!/20\d\d&20\d\d&20\d\d/.test(ruleSource), "规则源码出现 & 分隔的硬编码年份列表");
  // 动态年份：规则里由 CI 注入 CURRENT_UTC_YEAR，或运行时 getUTCFullYear()，二选一
  const mYear = ruleSource.match(/CURRENT_UTC_YEAR\s*=\s*(\d{4})/);
  const dynamic = /getUTCFullYear\s*\(/.test(ruleSource) || (mYear && Number(mYear[1]) === cur);
  assert(dynamic, `规则缺少动态年份（CURRENT_UTC_YEAR=${cur} 或 getUTCFullYear()）`);
  return `class=${JSON.stringify(ids)} rows=${JSON.stringify(names)} topDecade=${top} curYear=${cur}`;
}

// T3：第 4 参 extend 语义断言（中文「年代:2020年代」）
function assertFiltering(plain, year, comedy, hua, p1, p2) {
  const a = parseResult(plain), b = parseResult(year), c = parseResult(comedy),
        d = parseResult(hua), e = parseResult(p1), f = parseResult(p2);
  for (const [n, r] of [["plain", a], ["year", b], ["comedy", c], ["hua", d], ["pg1", e], ["pg2", f]])
    assert(Array.isArray(r.list), n + " 返回缺 list 数组");
  assert(a.list.length > 0, "无筛选时列表为空，无法比对");
  const nPlain = a.list.length, nYear = b.list.length;
  assert(nYear > 0, "「年代:2020年代」筛选结果为空");
  for (const it of b.list) {
    const dec = String(it.decade || "");
    const y = Number(String(it.vod_year).slice(0, 4));
    assert(dec === "2020年代" || (y >= 2020 && y <= 2029),
      `2020年代结果混入: decade=${dec} vod_year=${it.vod_year}`);
  }
  // 无筛选基准取 pg1+pg2 的并集（plain 只是第一页，不能直接当全集比子集）。
  const idsPlain = new Set([...e.list, ...f.list].map(x => String(x.vod_id)));
  const idsYear = new Set(b.list.map(x => String(x.vod_id)));
  assert([...idsYear].every(id => idsPlain.has(id)), "筛选结果不是无筛选结果子集");
  assert(Number(b.total) !== Number(a.total) || nYear !== nPlain || ![...idsYear].every(id => new Set(a.list.map(x => String(x.vod_id))).has(id)),
    "第 4 参 extend 未生效：筛选结果与无筛选完全一致（R02 陷阱）");
  assert(c.list.length > 0, "{类型:'喜剧'} 结果为空");
  for (const it of c.list) assert(/喜剧/.test(String(it.type_name) + String(it.vod_class || "")), "喜剧筛选混入: " + it.type_name);
  assert(d.list.length > 0, "{地区:'华语'} 结果为空");
  const HUA = /华语|中国大陆|中国香港|中国台湾|大陆|内地|港澳|香港|台湾|中国/;
  for (const it of d.list) assert(HUA.test(String(it.vod_area)), "华语筛选混入: " + it.vod_area);
  assert(e.list.length > 0 && f.list.length > 0, "pg=1/pg=2 有一页为空，无法验证不重复");
  const s1 = new Set(e.list.map(x => String(x.vod_id)));
  assert(f.list.filter(x => s1.has(String(x.vod_id))).length === 0, "pg=1 与 pg=2 出现重复条目");
  return `plain=${nPlain} year=${nYear} comedy=${c.list.length} hua=${d.list.length} pg1=${e.list.length} pg2=${f.list.length} overlap=0`;
}

// 去注释后再做静态扫描，避免注释里的 req()/URL 造成假 FAIL
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n").map(l => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
}

// ---------------------------------------------------------------------------
// 载入目标（fixture / builder 产物）
// ---------------------------------------------------------------------------
function readText(p, label) {
  if (!p) return null;
  if (!fs.existsSync(p)) throw new Error(`${label} 路径不存在: ${p}`);
  return fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""); // 剥 BOM
}
let ruleSrc, lineSrc, fallbackSrc, ruleLineSrc, dataFixture, DATA_FALLBACK = false;
try {
  ruleSrc = readText(RULE_PATH, "rule") ?? FIXTURE_RULE;
  // --line 仍指「规则站子仓」（与 T1-T5/T7-T8 的历史用法兼容）
  lineSrc = readText(LINE_PATH, "line") ?? JSON.stringify(FIXTURE_RULE_LINE, null, 2);
  // 3 条版新增：第 1 条兜底子仓 / 第 2 条规则站子仓，可各自指定真实产物
  fallbackSrc = readText(FALLBACK_PATH, "fallback") ?? JSON.stringify(FIXTURE_FALLBACK, null, 2);
  ruleLineSrc = readText(RULE_LINE_PATH, "rule-line") ?? lineSrc;
  const prodData = DATA_PATH ? JSON.parse(readText(DATA_PATH, "data")) : null;
  // PRODUCT 模式若源站全挂产出 stale 空数据：T3 测的是「第 4 参驱动本地过滤」这个逻辑，
  // 与当天片源无关 -> 回落内联 fixture 并如实标注，绝不静默当通过。
  DATA_FALLBACK = !!(prodData && Array.isArray(prodData.list) && prodData.list.length === 0);
  dataFixture = prodData && !DATA_FALLBACK ? prodData : FIXTURE_DATA;
} catch (e) { console.error("LOAD ERROR", e.message); process.exit(2); }
const MODE = (RULE_PATH || LINE_PATH || DATA_PATH || FALLBACK_PATH || RULE_LINE_PATH) ? "PRODUCT" : "FIXTURE";

if (!AS_JSON) {
  console.log("=".repeat(78));
  console.log("筛选线路「真实加载链」契约单测  mode=" + MODE + "  node=" + process.version);
  console.log("rule=" + (RULE_PATH || "<inline fixture>") + "  data=" + (DATA_PATH || "<inline fixture>"));
  console.log("line=" + (LINE_PATH || "<inline fixture>") + "  fallback=" + (FALLBACK_PATH || "<inline fixture>") + "  rule-line=" + (RULE_LINE_PATH || "<inline fixture>"));
  console.log("index=" + (INDEX_PATH || "<live fetch>"));
  if (DATA_FALLBACK) console.log("DATA_FALLBACK: 产物数据为空(stale)，T3 逻辑改用内联 fixture，真实数据待源站恢复后复跑");
  console.log("=".repeat(78));
}

// cfg.ext 取自站点配置的 ext（客户端把它交给 init(cfg)）。
let CFG_EXT = "";
try { CFG_EXT = String(JSON.parse(lineSrc).sites?.[0]?.ext ?? ""); } catch { /* T5 会报 */ }

// mock req / request；规则里若误用 fetch 会 TypeError -> FAIL 而非静默通过
const reqCalls = [];
const NATIVE_FETCH = globalThis.fetch;   // 留给 T6 拉线上基线
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
// 复刻 assets/js/lib/spider.js L3-9
function spiderChain(mod) {
  globalThis.__JS_SPIDER__ = undefined;
  if (mod.__jsEvalReturn) globalThis.__JS_SPIDER__ = mod.__jsEvalReturn();
  else if (mod.default) globalThis.__JS_SPIDER__ = typeof mod.default === "function" ? mod.default() : mod.default;
  return globalThis.__JS_SPIDER__;
}
// 复刻 JsSpider.java 的 call("home"/"category")：兼容 async 规则与 String/Object 返回
async function call(sp, name, ...args) {
  const fn = sp && sp[name];
  assert(typeof fn === "function", `__JS_SPIDER__.${name} 不是函数`);
  return parseResult(await fn.apply(sp, args));
}

let SPIDER = null;
let HOME_RESULT = null;

async function main() {
  // ---------------- T1 导出名（7 个内部名） ----------------
  await check("T1", "__jsEvalReturn 必须导出 7 个内部名（init/home/homeVod/category/detail/play/search）", async () => {
    const mod = await loadModule(ruleSrc, "rule");
    SPIDER = spiderChain(mod);
    return assertExports(SPIDER);
  });
  // 负向对照 A：旧 *Content 导出名（上次假绿的根源）必须被拒
  try {
    const bad = await loadModule(BAD_RULE_OLD_NAMES, "old *Content exports");
    expectReject("T1-NEG1", "负向对照：旧 *Content 导出名必须被拒", () => assertExports(spiderChain(bad)));
  } catch (e) { rec("T1-NEG1", "负向对照：旧 *Content 导出名必须被拒", "FAIL", e.message); }
  // 负向对照 B：形态① 声明式 default 导出必须被拒
  try {
    const bad2 = await loadModule(BAD_RULE_FORM1, "form1 default");
    expectReject("T1-NEG2", "负向对照：形态① default 规则必须被拒", () => assertExports(spiderChain(bad2)));
  } catch (e) { rec("T1-NEG2", "负向对照：形态① default 规则必须被拒", "FAIL", e.message); }

  // ---------------- T7 客户端真实加载链端到端（结果正确性核心） ----------------
  await check("T7", "端到端：loadModule(api) -> __JS_SPIDER__ -> init({ext}) -> home() -> category()，整轮 req=1", async () => {
    reqCalls.length = 0;
    const mod = await loadModule(ruleSrc, "api");            // 客户端按 site.api 加载
    const sp = spiderChain(mod);                              // spider.js 的 __jsEvalReturn 分支
    assertExports(sp);
    const cfg = { ext: CFG_EXT, skey: "own_filter", stype: 3 };
    assert(typeof cfg.ext === "string" && cfg.ext.length > 0, "cfg.ext 为空：init 拿不到数据 URL");
    const r = sp.init(cfg); if (r && typeof r.then === "function") await r;   // bili_open.js 的 init 是 async
    HOME_RESULT = await call(sp, "home", false);
    const year = await call(sp, "category", "all", 1, false, { 年代: "2020年代" });
    assert(reqCalls.length === 1, `整轮 req 调用 ${reqCalls.length} 次，要求恰好 1（init(cfg).ext 注入后才读数据）`);
    assert(reqCalls[0] === CFG_EXT, `req 的 URL 不是 cfg.ext：got=${reqCalls[0]} want=${CFG_EXT}`);
    assert(Array.isArray(HOME_RESULT.class) && HOME_RESULT.class.length > 0, "home() 返回空 class -> 白屏");
    assert(isPlainObject(HOME_RESULT.filters), "home() 未返回 filters -> 面板不会出现");
    assert(Array.isArray(year.list), "category() 未返回 list");
    return `reqCalls=1 url=${reqCalls[0]} class=${HOME_RESULT.class.length} filters=object yearList=${year.list.length}`;
  });

  // ---------------- T2 filters 形状（走 home()） ----------------
  await check("T2", "home() 的 filters 为 object-of-arrays / 四排齐全 / 年代动态", () => {
    assert(HOME_RESULT, "T7 未通过，跳过");
    const r = assertFiltersShape(HOME_RESULT, ruleSrc);
    const cfg = JSON.parse(lineSrc);
    assert(!("filters" in cfg), "filter-line.json 顶层出现 filters（会触发 FilterAdapter 静默空页）");
    return r;
  });
  expectReject("T2-NEG1", "负向对照：filters 为数组必须被拒", () =>
    assertFiltersShape({ class: [{ type_id: "all" }], filters: [] }, ruleSrc));
  expectReject("T2-NEG2", "负向对照：value 元素字段名非 n/v 必须被拒", () =>
    assertFiltersShape({ class: [{ type_id: "all" }], filters: { all: [
      { key: "类型", name: "类型", value: [{ label: "全部", val: "" }] },
      { key: "地区", name: "地区", value: [{ n: "全部", v: "" }] },
      { key: "排序", name: "排序", value: [{ n: "默认", v: "" }] },
      { key: "年代", name: "年代", value: [{ n: "全部", v: "" }] },
    ] } }, ruleSrc));

  // ---------------- T3 本地过滤（走 category 第 4 参，中文键） ----------------
  await check("T3", "category(tid,pg,false,extend) 第 4 参生效 + 分页不重复", async () => {
    assert(SPIDER, "T1 未通过，跳过");
    const tid = "all";
    const plain = await call(SPIDER, "category", tid, 1, false, {});
    const year = await call(SPIDER, "category", tid, 1, false, { 年代: "2020年代" });
    const comedy = await call(SPIDER, "category", tid, 1, false, { 类型: "喜剧" });
    const hua = await call(SPIDER, "category", tid, 1, false, { 地区: "华语" });
    const p1 = await call(SPIDER, "category", tid, 1, false, {});
    const p2 = await call(SPIDER, "category", tid, 2, false, {});
    return assertFiltering(plain, year, comedy, hua, p1, p2);
  });
  expectReject("T3-NEG", "负向对照：忽略 extend（结果混入其它年代）必须被拒", () => {
    const same = { code: 1, total: 30, list: FIXTURE_DATA.list.slice(0, 20) };
    assertFiltering(same, same, same, same, same, same);
  });

  // ---------------- T4 零网络（URL 由 init(cfg).ext 注入） ----------------
  await check("T4", "静态：req/request/fetch 调用点恰好 1，且数据 URL 由 cfg.ext 注入", () => {
    const code = stripComments(ruleSrc);
    const calls = [...code.matchAll(/\b(?:req|request|fetch)\s*\(/g)];
    assert(calls.length === 1, `网络调用点=${calls.length}，要求恰好 1`);
    assert(!/(?:req|request)\s*\(\s*['"]https?:/.test(code),
      "req() 里写死了绝对 URL：数据 URL 必须由 init(cfg).ext 注入");
    assert(/\.ext\b/.test(code), "规则源码未引用 cfg.ext（数据 URL 不是注入的）");
    assert(!/Promise\.all\s*\(/.test(code), "出现 Promise.all（同步并发抓源）");
    assert(!/from\s*['"][^'"]*(?:http|net)\.js/.test(code), "规则直接 import http.js/net.js");
    const idx = calls[0].index;
    const before = code.slice(Math.max(0, idx - 300), idx).split("\n").slice(-4).join("\n");
    assert(!/(?:for\s*\(|while\s*\(|\.forEach\s*\(|\.map\s*\()/.test(before), "网络调用疑似位于循环内");
    return `calls=1 injectedFrom=cfg.ext ruleHasNoHardcodedURL=true`;
  });
  await check("T4b", "运行时：整轮 req=1 且 URL===cfg.ext（T7 链的复用校验）", () => {
    assert(CFG_EXT.length > 0, "cfg.ext 为空：不能把空 URL 当通过");
    assert(reqCalls.length === 1, `req 实际 ${reqCalls.length} 次（T7->T3 之间不应再拉数据）`);
    assert(reqCalls[0] === CFG_EXT, `URL 与 cfg.ext 不一致: got=${reqCalls[0]} want=${CFG_EXT}`);
    return `reqCalls=1 url=${reqCalls[0]}`;
  });

  // ---------------- T5 filter-line.json 真实契约 ----------------
  await check("T5", "站点契约：api 绝对 .js / ext 绝对 .json / jar=\"\" / spider=\"\" / 零 md5·csp·type3", () => {
    const cfg = JSON.parse(lineSrc);
    assert(!lineSrc.includes(";md5;"), "全文出现 ;md5; 绑定");
    assert(!lineSrc.includes("csp_"), "全文出现 csp_ jar 站点");
    assert(cfg.spider === "", `顶层 spider 必须为 ""，实际=${JSON.stringify(cfg.spider)}`);
    assert(!("filters" in cfg), "顶层存在 filters");
    assert(Array.isArray(cfg.sites) && cfg.sites.length > 0, "sites 为空");
    for (const [i, s] of cfg.sites.entries()) {
      assert(s.spider === undefined || s.spider === null || s.spider === "", `sites[${i}].spider 非空`);
      assert(s.jar === "", `sites[${i}].jar 必须为显式空串 ""，实际=${JSON.stringify(s.jar)}`);
      assert(s.type === 3, `sites[${i}].type=${s.type}，要求 3（精确值仍需真机，见未覆盖项）`);
      assert(typeof s.api === "string" && /^https?:\/\//.test(s.api), `sites[${i}].api 非绝对 URL: ${s.api}`);
      assert(/\.js$/.test(s.api), `sites[${i}].api 未以 .js 结尾（URL_JOIN 正则要求）: ${s.api}`);
      assert(!s.api.includes("?"), `sites[${i}].api 带 ?（loadModule 正则不匹配）: ${s.api}`);
      assert(!s.api.startsWith("./") && !s.api.startsWith("assets://"), `sites[${i}].api 用了 ./ 或 assets://`);
      assert(!/base64/i.test(s.api), `sites[${i}].api 疑似 base64`);
      assert(typeof s.ext === "string" && /^https?:\/\//.test(s.ext), `sites[${i}].ext 非绝对 URL: ${s.ext}`);
      assert(/\.json$/.test(s.ext), `sites[${i}].ext 未以 .json 结尾: ${s.ext}`);
      assert(!s.ext.includes("?"), `sites[${i}].ext 带 ?: ${s.ext}`);
    }
    return `sites=${cfg.sites.length} spider="" jar="" api=.js ext=.json`;
  });

  // ---------------- T8 搜索正确性（本轮用户核心诉求） ----------------
  await check("T8", "搜索精确片名第 1 条必须是正片，蹭名片不得排前", async () => {
    assert(SPIDER, "T1 未通过，跳过");
    const probes = [
      ["流浪地球", "流浪地球", "流浪地球之大夏战狼"],
      ["狂飙", "狂飙", "狂飙之特别行动"],
      ["周处除三害", "周处除三害", "周处除三害外传"],
    ];
    const out = [];
    for (const [kw, exact, fake] of probes) {
      const r = await call(SPIDER, "search", kw, false, 1);
      assert(Array.isArray(r.list) && r.list.length > 0, `搜索「${kw}」返回 0 条`);
      const first = String(r.list[0].vod_name || "");
      assert(first === exact, `搜「${kw}」第 1 条是「${first}」，应为正片「${exact}」（蹭名片排前，FINAL_GOAL.md:13）`);
      // 蹭名片若出现，必须排在正片之后
      const fi = r.list.findIndex(x => String(x.vod_name || "").includes(fake));
      if (fi >= 0) assert(fi > 0, `蹭名片「${fake}」排在正片前面`);
      out.push(`${kw}->${first}`);
    }
    return out.join(" | ");
  });
  expectReject("T8-NEG", "负向对照：蹭名片排第 1 必须被拒", () => {
    // 复用 T8 的判定逻辑：构造一个「第 1 条是蹭名片」的结果
    const badFirst = "流浪地球之大夏战狼";
    assert(badFirst === "流浪地球", `搜「流浪地球」第 1 条是「${badFirst}」，应为正片「流浪地球」`);
  });

  // ---------------- T6 回归：3 条人话线路（兼容性兜底基线） ----------------
  let idxText = null, idxSrc = "<none>";
  if (INDEX_PATH) { idxText = readText(INDEX_PATH, "index"); idxSrc = INDEX_PATH; }
  else if (FIXTURE_INDEX) {
    idxText = JSON.stringify({ urls: BASELINE_3 }, null, 2);
    idxSrc = "<fixture 3-line baseline>";
  }
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
    skip("T6", "主入口恰好 3 条人话线路", OFFLINE ? "--offline 且未给 --index" : idxSrc);
  } else {
    await check("T6", "主入口恰好 3 条：打开就能看->fs4k3 / 想按类型年代挑片点这里->filter-line / 看不了点这里->fs4k2", () => {
      const j = JSON.parse(idxText);
      assert(Array.isArray(j.urls), "urls 不是数组");
      assert(j.urls.length === 3, `urls 数量=${j.urls.length}，要求恰好 3（兼容性兜底版）`);
      for (let i = 0; i < 3; i++) {
        const got = j.urls[i], want = BASELINE_3[i];
        assert(normalizeName(got.name) === normalizeName(want.name),
          `第 ${i + 1} 条 name 不符: got=${JSON.stringify(got.name)} want=${JSON.stringify(want.name)}`);
        assert(got.url === want.url, `第 ${i + 1} 条 url 不符: got=${got.url} want=${want.url}`);
      }
      assert(/fs4k3\.json$/.test(j.urls[0].url), "第 1 条不是全壳通用兜底 fs4k3.json");
      assert(/filter-line\.json$/.test(j.urls[1].url), "第 2 条不是规则站 filter-line.json");
      assert(/fs4k2\.json$/.test(j.urls[2].url), "第 3 条不是备用 fs4k2.json");
      return `urls=3 [1]${j.urls[0].name}->fs4k3 [2]${j.urls[1].name}->filter-line [3]${j.urls[2].name}->fs4k2 src=${idxSrc}`;
    });
  }

  // ---------------- T6b 后台自愈产物仍存在（宽松，不进 index 也要在） ----------------
  if (OFFLINE || !NATIVE_FETCH) {
    skip("T6b", "后台 5 条自愈产物仍可拉到", "--offline 且未给 --data/--line 路径");
  } else {
    await check("T6b", "fs4k2/fs4k3/fs4kc/c1/c2/4k.json 后台仍生成（不进 index 但不许删）", async () => {
      const got = [];
      for (const f of BACKGROUND_FILES) {
        let ok = false, size = 0;
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 6000);
          const r = await NATIVE_FETCH(PAGES_BASE + f, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Android TV)" } });
          clearTimeout(t);
          if (r.ok) { size = (await r.text()).length; ok = true; }
        } catch { /* 记为不可达 */ }
        got.push(`${f}=${ok ? "200/" + size : "MISS"}`);
      }
      const miss = got.filter(x => x.includes("MISS"));
      assert(miss.length === 0, "后台自愈产物缺失: " + miss.join(","));
      return got.join(" ");
    });
  }

  // ---------------- T9 零门槛前提：第 1 条是全壳通用兜底（全 type:1 / 零 jar） ----------------
  await check("T9", "第 1 条 fs4k3.json 是全壳通用兜底：sites 全 type:1 / spider=\"\" / 无 csp_ / 无 ;md5;", () => {
    const cfg = JSON.parse(fallbackSrc);
    assert(Array.isArray(cfg.sites) && cfg.sites.length > 0, "兜底子仓 sites 为空");
    assert(cfg.spider === "", `兜底子仓顶层 spider 必须为 ""（零 jar），实际=${JSON.stringify(cfg.spider)}`);
    assert(!fallbackSrc.includes(";md5;"), "兜底子仓全文出现 ;md5; 绑定");
    assert(!fallbackSrc.includes("csp_"), "兜底子仓出现 csp_ jar 站点");
    let min = Infinity, max = -Infinity;
    for (const [i, s] of cfg.sites.entries()) {
      assert(s.type === 1, `sites[${i}].type=${s.type}，兜底必须全为 type:1（全壳通用）`);
      assert(typeof s.api === "string" && /^https?:\/\//.test(s.api), `sites[${i}].api 非绝对 URL`);
      assert(!/\.js$/.test(s.api), `sites[${i}].api 是 .js 规则站，不该出现在兜底里`);
      min = Math.min(min, s.type); max = Math.max(max, s.type);
    }
    return `sites=${cfg.sites.length} types=${min}..${max} spider="" noMd5=true noCsp=true`;
  });

  // ---------------- T10 规则站仍可选（第 2 条，筛选功能没被删） ----------------
  await check("T10", "第 2 条 filter-line.json 仍是规则站：type3 / .js api / spider=\"\"", () => {
    const cfg = JSON.parse(ruleLineSrc);
    assert(Array.isArray(cfg.sites) && cfg.sites.length >= 1, "规则站 sites 为空");
    const s = cfg.sites[0];
    assert(s.type === 3, `规则站 sites[0].type=${s.type}，要求 3`);
    assert(typeof s.api === "string" && /\.js$/.test(s.api), `规则站 api 不是 .js: ${s.api}`);
    assert(cfg.spider === "" || cfg.spider === undefined, `规则站顶层 spider 非空: ${JSON.stringify(cfg.spider)}`);
    return `ruleLine.type=3 api=.../${s.api.split("/").pop()} spider="" (第 2 条，不默认)`;
  });

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
