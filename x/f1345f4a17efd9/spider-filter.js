/**
 * spider-filter.js —— 自有 drpy2 规则（scripts/build-filter-lines.mjs 每日生成）
 *
 * 契约来源：DRPY2_REAL_CONTRACT.md（cat-researcher 最终契约，形态②）
 *           + bili_open.js L609-620（真实能跑规则的导出形状）
 *           + DESIGN_ZERO_RISK.md（8 条零风险指标）/ DESIGN_RISKS.md（R01/R02/R03/R04）。
 * 加载链：APK assets/js/lib/spider.js
 *   import * as spider from '%s'
 *   globalThis.__JS_SPIDER__ = spider.__jsEvalReturn()
 * → 本文件导出 __jsEvalReturn()，返回 7 个【内部名】
 *   {init, home, homeVod, category, detail, play, search}；
 *   客户端 JsSpider 负责把这 7 个内部名映射成自己的接口方法（R01）。
 *
 * 零 jar：filter-line.json 顶层 spider:"" + 站点级 jar:""，走内置 QuickJS，不触发 JarLoader。
 * 零运行时外网：全文只有 1 处网络读取，数据地址由 init 参数注入；
 *   无循环抓源、无第二个地址、无同步并发（R04 防 ANR）。
 * 零白屏：数据拉取失败时返回固定 class + 固定四排 filters + 空 list（R11）。
 *
 * 三处静默空页陷阱已按真实契约锁死：
 *   R01 导出名：7 个内部名，见 __jsEvalReturn 返回对象
 *   R02 category(tid, page, filter, ext) 只用第 4 参 ext 取点选值，第 3 参 filter 仅布尔
 *   R03 filters 为 object-of-arrays，首层 key 严格等于 class[].type_id
 */

var CONTRACT = {
  "source": "DRPY2_REAL_CONTRACT.md（最终契约）/ DESIGN_ZERO_RISK.md / DESIGN_RISKS.md",
  "exportFn": "__jsEvalReturn",
  "methods": [
    "init",
    "home",
    "homeVod",
    "category",
    "detail",
    "play",
    "search"
  ],
  "returnType": "JSON-string",
  "filtersShape": "object-of-arrays: {'<type_id>':[{key,name,value:[{n,v}]}]}",
  "filterKeys": [
    "类型",
    "地区",
    "排序",
    "年代"
  ],
  "categoryArg": "category(tid, page, filter, ext)：第 4 参 ext 拿点选值；第 3 参 filter 是布尔开关",
  "dataFile": "filter-data.json"
};
var GENERATED_AT = "2026-11-09T06:33:28.749Z";
var CURRENT_UTC_YEAR = 2026;
var DECADE_KEYS = ["2020年代","2010年代","2000年代","90年代","80年代","更早","年代不详"];
var CLASSES = [{"type_id":"all","type_name":"全部"},{"type_id":"movie","type_name":"电影"},{"type_id":"tv","type_name":"剧集"},{"type_id":"anime","type_name":"动漫"},{"type_id":"variety","type_name":"综艺"},{"type_id":"doc","type_name":"纪录"},{"type_id":"short","type_name":"短剧"},{"type_id":"sports","type_name":"体育"}];
var TYPE_WORDS = ["喜剧","爱情","动作","科幻","动画","悬疑","犯罪","惊悚","冒险","历史","奇幻","恐怖","战争","传记","歌舞","武侠","灾难","西部","纪录片","剧情","短剧","综艺"];
var AREA_WORDS = ["华语","中国大陆","中国香港","中国台湾","欧美","美国","韩国","日本","英国","法国","德国","意大利","西班牙","印度","泰国","俄罗斯","加拿大","其他"];
var SORT_OPTIONS = [{"n":"近期热度","v":"hot"},{"n":"首映时间","v":"time"},{"n":"高分优先","v":"score"}];
var PAGE_SIZE = 20;

var DATA = null;
var DATA_ATTEMPTED = false;
// 数据地址由 init 参数注入；规则文本里不写死任何域名或字面地址。
// 双通道前缀由构建器在配置层替换，主备各自正确，不再分叉。
var DATA_URL = '';
function init(cfg) {
  try {
    var e = cfg && cfg.ext;
    if (typeof e === 'string' && e) DATA_URL = e;
    else if (e && typeof e === 'object' && e.ext) DATA_URL = String(e.ext);
  } catch (err) { logMsg('init(cfg) 读取 ext 失败', err && err.message); }
  logMsg('init', GENERATED_AT, 'dataUrl=' + DATA_URL);
  return '';
}

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

/** 唯一一次网络读取：只在 home() 内、只调 1 次、地址来自 init 参数 */
function home(filter) {
  if (!DATA_ATTEMPTED) {
    DATA_ATTEMPTED = true;
    try {
      var raw = req(DATA_URL);
      DATA = JSON.parse(raw);
      if (!DATA || !DATA.list) DATA = null;
    } catch (e) {
      DATA = null;
      logMsg('静态数据读取失败，使用空数据兜底', e && e.message);
    }
  }
  // bili_open.js L144-152：filter 为真才挂 filters；我们的 filters 恒定四排，
  // 无论 filter 真假都返回，保证面板一定出现（filter 只当布尔开关用）。
  var cls = DATA && DATA['class'] && DATA['class'].length ? DATA['class'] : CLASSES;
  var filters = DATA && DATA.filters ? DATA.filters : fallbackFilters();
  var list = DATA && DATA.list ? DATA.list.slice(0, PAGE_SIZE) : [];
  return jstr({ 'class': cls, filters: filters, list: list });
}

/** 其余方法只触发一次数据读取，之后全在内存里跑，绝不再次联网 */
function ensure() {
  if (!DATA_ATTEMPTED) home(false);
  return DATA;
}
function pool() { var d = ensure(); return d && d.list ? d.list : []; }

function homeVod() {
  return jstr({ list: pool().slice(0, PAGE_SIZE) });
}

/** 第 4 参 ext = 点选值字典；第 3 参 filter 只是布尔开关，绝不读它当值（R02） */
function category(tid, page, filter, ext) {
  var fl = ext;
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
  var p = parseInt(page, 10) || 1;
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

// ── 搜索相关性（照抄 SEARCH_DIAGNOSIS.md §②，纯本地、无网络） ──
var S2T = { '飆': '飙', '週': '周', '處': '处', '灣': '湾', '臺': '台', '國': '国', '劇': '剧', '電影': '电影' };
function norm(x) {
  var t = s(x);
  try { t = t.normalize('NFKC').toLowerCase(); } catch (e) { t = t.toLowerCase(); }
  t = t.replace(/[ⅡⅢⅣ]/g, function (m) { return ({ 'Ⅱ': '2', 'Ⅲ': '3', 'Ⅳ': '4' })[m] || m; });
  for (var k in S2T) if (Object.prototype.hasOwnProperty.call(S2T, k)) t = t.split(k).join(S2T[k]);
  return t.replace(/[\s\-_.·•【】\[\]()（）「」《》:：,，!！?？'"]+/g, '');
}
var SPIN = /(之|外传|番外|前传|后传|大夏|宿命|风云|再次冒险|特别版|解说|预告|花絮|片花|短剧|动态漫|抢先|完整版|国语|粤语|中字|字幕|199\d|ai$|人生|商界|傲视|至尊)/;
var DERIV = /(解说|预告|花絮|片花|动态漫|电影解说|抢先版)/;
var SEQ_PURE = /^[0-9一二三四五六七八九十]+(季|部|集)?$/;
function relScore(name, kw) {
  var n = norm(name), k = norm(kw);
  if (!n || !k) return -1;
  if (n === k) return 1000;
  if (n.indexOf(k) === 0) {
    var tail = n.slice(k.length);
    if (SEQ_PURE.test(tail)) return 600;
    var sc = 300 - tail.length * 15;
    if (SPIN.test(tail)) sc -= 220;
    if (DERIV.test(tail)) sc -= 180;
    return sc;
  }
  if (n.indexOf(k) >= 0) return 150 - (n.length - k.length) * 8;
  return -1;
}
/** 索引取候选：精确 key 命中优先，2gram 召回补充；无索引时退化为全池扫描 */
function searchCandidates(kw) {
  var d = ensure();
  var all = pool();
  var idx = d && d.searchIndex;
  var k = norm(kw);
  var seen = {}, order = [], out = [];
  if (idx && idx.byName) {
    for (var key in idx.byName) {
      if (!Object.prototype.hasOwnProperty.call(idx.byName, key)) continue;
      if (key === k || key.indexOf(k) >= 0 || k.indexOf(key) >= 0) {
        var arr = idx.byName[key];
        for (var a = 0; a < arr.length; a++) if (!seen[arr[a]]) { seen[arr[a]] = 1; order.push(arr[a]); }
      }
    }
    if (idx.terms) for (var g in idx.terms) {
      if (!Object.prototype.hasOwnProperty.call(idx.terms, g) || k.indexOf(g) < 0) continue;
      var t = idx.terms[g];
      for (var b = 0; b < t.length; b++) if (!seen[t[b]]) { seen[t[b]] = 1; order.push(t[b]); }
    }
  }
  if (!order.length) for (var i = 0; i < all.length; i++) { seen[i] = 1; order.push(i); }
  for (var j = 0; j < order.length; j++) if (all[order[j]]) out.push(all[order[j]]);
  return out;
}
function search(wd, quick, pg) {
  var kw = s(wd).trim();
  if (!kw) return jstr({ list: [] });
  var cand = searchCandidates(kw);
  var scored = [], dedup = {};
  for (var i = 0; i < cand.length; i++) {
    var it = cand[i];
    var sc = relScore(it.vod_name, kw);
    if (sc < 0) continue;
    var dk = norm(it.vod_name);
    // 归一化片名去重：同键只留分最高那条（正片优先于解说/蹭名片）
    if (dedup[dk] !== undefined) {
      if (sc <= scored[dedup[dk]].s) continue;
      scored[dedup[dk]] = { it: it, s: sc };
    } else { dedup[dk] = scored.length; scored.push({ it: it, s: sc }); }
  }
  scored.sort(function (a, b) {
    return b.s - a.s
      || (Number(b.it.vod_year) || 0) - (Number(a.it.vod_year) || 0)
      || s(b.it.vod_time).localeCompare(s(a.it.vod_time));
  });
  var rows = [];
  for (var k2 = 0; k2 < scored.length; k2++) rows.push(scored[k2].it);
  var p = parseInt(pg, 10) || 1;
  var start = (p - 1) * PAGE_SIZE;
  var size = quick ? Math.min(10, PAGE_SIZE) : PAGE_SIZE;
  var list = rows.slice(start, start + size);
  return jstr({
    list: list, page: p,
    pagecount: Math.max(1, Math.ceil(rows.length / size)),
    limit: size, total: rows.length
  });
}

/** 详情：入参可能是数组或字符串（bili_open 的 detail(id) 形态）；只从内存数据取，不联网。
 *  数据已按 8 字段精简，这里把缺失的长文本字段用片名/播放串回填成可播结构。 */
function detail(id) {
  var list = Array.isArray(id) ? id : [id];
  var out = [], all = pool();
  for (var n = 0; n < list.length && n < 20; n++) {
    var id = s(list[n]);
    for (var i = 0; i < all.length; i++) {
      if (s(all[i].vod_id) !== id) continue;
      var v = {};
      for (var k in all[i]) if (Object.prototype.hasOwnProperty.call(all[i], k)) v[k] = all[i][k];
      v.vod_content = s(v.vod_content || v.vod_name);
      v.vod_actor = s(v.vod_actor || '');
      v.vod_director = s(v.vod_director || '');
      v.vod_play_from = s(v.vod_play_from || '自有');
      v.vod_play_url = s(v.vod_play_url || '');
      out.push(v);
      break;
    }
  }
  return jstr({ list: out });
}

/** 播放：返回数据里的播放地址；无解析、无嗅探、无联网 */
function play(flag, id, flags) {
  var all = pool(), url = '';
  for (var i = 0; i < all.length; i++) {
    var it = all[i];
    if (s(it.vod_id) === s(id) || s(it.vod_play_url) === s(id)) { url = s(it.vod_play_url); break; }
  }
  if (!url && (s(id).indexOf('http:') === 0 || s(id).indexOf('https:') === 0)) url = s(id);
  return jstr({ parse: 0, url: url, header: {} });
}

/** R01（DRPY2_REAL_CONTRACT）：导出 7 个内部名，Java 层自行映射 *Content */
export function __jsEvalReturn() {
  return {
    init: init,
    home: home,
    homeVod: homeVod,
    category: category,
    detail: detail,
    play: play,
    search: search,
    __contract: CONTRACT
  };
}
// fallback 分支（spider.js 的 default 分支）；同样返回 7 个内部名
export default __jsEvalReturn;
