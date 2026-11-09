/**
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

var CONTRACT = {
  "source": "DESIGN_RESEARCH.md / DESIGN_ZERO_RISK.md / DESIGN_RISKS.md",
  "exportFn": "__jsEvalReturn",
  "methods": [
    "homeContent",
    "homeVodContent",
    "categoryContent",
    "detailContent",
    "searchContent",
    "playerContent"
  ],
  "returnType": "JSON-string",
  "filtersShape": "object-of-arrays: {'<type_id>':[{key,name,value:[{n,v}]}]}",
  "filterKeys": [
    "类型",
    "地区",
    "排序",
    "年代"
  ],
  "categoryArg": "extend（第 4 参）；第 3 参 filter 是布尔开关，绝不作为值字典",
  "dataFile": "filter-data.json"
};
var GENERATED_AT = "2026-11-09T00:34:42.234Z";
var CURRENT_UTC_YEAR = 2026;
var DECADE_KEYS = ["2020年代","2010年代","2000年代","90年代","80年代","更早","年代不详"];
var CLASSES = [{"type_id":"all","type_name":"全部"},{"type_id":"movie","type_name":"电影"},{"type_id":"tv","type_name":"剧集"},{"type_id":"anime","type_name":"动漫"},{"type_id":"variety","type_name":"综艺"},{"type_id":"doc","type_name":"纪录"},{"type_id":"short","type_name":"短剧"},{"type_id":"sports","type_name":"体育"}];
var TYPE_WORDS = ["喜剧","爱情","动作","科幻","动画","悬疑","犯罪","惊悚","冒险","历史","奇幻","恐怖","战争","传记","歌舞","武侠","灾难","西部","纪录片","剧情","短剧","综艺"];
var AREA_WORDS = ["华语","中国大陆","中国香港","中国台湾","欧美","美国","韩国","日本","英国","法国","德国","意大利","西班牙","印度","泰国","俄罗斯","加拿大","其他"];
var SORT_OPTIONS = [{"n":"近期热度","v":"hot"},{"n":"首映时间","v":"time"},{"n":"高分优先","v":"score"}];
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
      var raw = req("https://lyk1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/filter-data.json");
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
