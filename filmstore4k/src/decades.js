/**
 * 年代归并规则（纯函数模块 · 无副作用 · 可独立单测）
 *
 * 用途：scripts/build-lines.mjs 用它把「按大区 / 年代分组的动态线路」算出来。
 * 废弃说明：原「静态 cats.json + drpy 骨架」方案已由 cat-verifier 源码级报告否定
 *   （SiteApi.java 固定拼 ac/t/pg/wd/ids/f；Class.java 无 type_pid；Result.filters
 *     结构不对会让整份 home 静默变空；FongMi/CatVodSpider 无 drpy 引擎）。
 *   本文件只保留「年代归并纯函数」并被新方案复用，不再产出任何静态分类树 / filters。
 *
 * 年份口径（lead 追加需求，硬性）：
 *   1. 只从影片条目的 vod_year 解析；禁止用 vod_time（如 20261108）推年份；
 *      禁止用当前年份填缺失值；禁止硬编码具体年份数字。
 *   2. 只接受 /^(19|20)\d{2}$/ 且 1900 <= y <= CURRENT_UTC_YEAR + 1。
 *      "" / "0" / "2026-11-08" / "未知" / 中文 / 8 位日期串 / 未来年份
 *      一律解析为 null，归入 UNKNOWN_DECADE（"年代不详"）。
 *   3. 年代档位由 CURRENT_UTC_YEAR 动态生成：从当前十年档一路下探到 80年代，
 *      再补「更早」「年代不详」。禁止硬编码 2020年代 这类字面量。
 *   4. 空档固定生成（由 build-lines.mjs 保证，防缓存滞后 R28）；本模块只统计真实条目数。
 *   5. 跨源同名去重键用归一化片名（去 4K/蓝光/HD/全集/第X季 后缀），
 *      不带年份，避免多源年份冲突产生重复键（R29）；年份由调用方取多源最早有效值。
 *
 * 单测入口：
 *   node --input-type=module -e "import {parseVodYear,decadeOf,buildDecadeKeys,normalizeVodName} from './src/decades.js'; ..."
 */

/** 当前 UTC 年份：唯一的时间来源，绝不硬编码具体年份 */
export const CURRENT_UTC_YEAR = new Date().getUTCFullYear();
/** 可解析的 4 位年份下界 */
export const YEAR_MIN = 1900;
/** lead 口径严格有效年份下界（1990-2030 语义，保留供核对） */
export const YEAR_VALID_MIN = 1990;
/** 年份上界：当前 UTC 年 + 1，动态计算，超界视为脏数据 */
export const YEAR_MAX = CURRENT_UTC_YEAR + 1;
/** 无合法年份的统一档名 */
export const UNKNOWN_DECADE = "年代不详";
/** 「更早」档名 */
export const OLDER_DECADE = "更早";
/** 档位下探的最低十年起点（"80年代" 是该固定档位方案的定义边界，不是年份选项） */
export const LOWEST_DECADE_START = 1980;
/** 中文数字档名与四位档名的分界（2000 起用 "2020年代"，之前用 "90年代"） */
export const FULL_LABEL_FROM = 2000;

/**
 * 解析 vod_year → 4 位年份整数；非法返回 null。
 * B-A06：先做 NFKC 归一（全角数字 → 半角）、剥尾部「年」字与空白，
 *        再过 /^(19|20)\d{2}$/ 与 1900 <= y <= YEAR_MAX。
 *        8 位日期串、带横杠日期、空串、中文、0、未来年份仍全部挡掉。
 */
export function parseVodYear(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).normalize("NFKC").trim();
  s = s.replace(/年$/, "").trim();
  if (!/^(19|20)\d{2}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < YEAR_MIN || n > YEAR_MAX) return null;
  return n;
}

/** lead 口径的严格有效年份（1990 ~ CURRENT_UTC_YEAR+1），供单测核对 */
export function isValidYear(raw) {
  const y = parseVodYear(raw);
  return y !== null && y >= YEAR_VALID_MIN && y <= YEAR_MAX;
}

/** 原始 vod_year 是否属于「缺失」（空 / 0 / 未知 / 暂无），区别于「非法脏值」 */
export function isMissingYear(raw) {
  if (raw === null || raw === undefined) return true;
  const s = String(raw).trim();
  return s === "" || /^(0|未知|暂无|不详|unknown|n\/a|-)$/i.test(s);
}

/** 十年起点 → 档名；动态生成，无硬编码年份数字 */
function decadeLabel(decadeStart) {
  if (decadeStart >= FULL_LABEL_FROM) return String(decadeStart) + "年代";
  return String(decadeStart % 100) + "年代"; // 1990 → "90年代"，1980 → "80年代"
}

/**
 * 动态生成标准年代档列表（顺序即 UI 展示顺序）。
 * 从当前十年档下探到 80年代，再补「更早」「年代不详」。
 * 例：CURRENT_UTC_YEAR=2026 → ["2020年代","2010年代","2000年代","90年代","80年代","更早","年代不详"]
 *     CURRENT_UTC_YEAR=2035 → 自动多出 "2030年代" 顶档。
 * @param {number} currentYear 传入年份便于单测（默认 CURRENT_UTC_YEAR）
 */
export function buildDecadeKeys(currentYear = CURRENT_UTC_YEAR) {
  const y = Number.isInteger(currentYear) ? currentYear : CURRENT_UTC_YEAR;
  const top = Math.floor(y / 10) * 10;
  const keys = [];
  for (let d = top; d >= LOWEST_DECADE_START; d -= 10) keys.push(decadeLabel(d));
  keys.push(OLDER_DECADE, UNKNOWN_DECADE);
  return keys;
}

/** 本进程生效的标准档位（冻结，避免误改） */
export const DECADE_KEYS = Object.freeze(buildDecadeKeys(CURRENT_UTC_YEAR));

/**
 * 年份 → 标准年代档名。
 * 无合法年份 / 越界 → UNKNOWN_DECADE；1900-1979 → 「更早」。
 * @param {number|null} year parseVodYear 的结果
 * @param {string[]} keys 档位列表，默认 DECADE_KEYS
 */
export function decadeKeyOf(year, keys = DECADE_KEYS) {
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) return UNKNOWN_DECADE;
  const d = Math.floor(year / 10) * 10;
  if (d < LOWEST_DECADE_START) return keys.includes(OLDER_DECADE) ? OLDER_DECADE : UNKNOWN_DECADE;
  const label = decadeLabel(d);
  if (keys.includes(label)) return label;
  // 年份落在档位列表之外（例如未来档已被 YEAR_MAX 挡掉）：稳妥回落到顶档
  return keys[0] || UNKNOWN_DECADE;
}

/** 一步到位：原始 vod_year → 年代档名 */
export function decadeOf(raw) {
  return decadeKeyOf(parseVodYear(raw));
}

/** 年代档中文名 → 稳定 ASCII 文件名 slug（Pages 分发零编码坑） */
export function decadeSlug(key) {
  const k = String(key || "");
  const m = k.match(/^(\d{2,4})年代$/);
  if (m) return m[1] + "s";                       // 2020年代→2020s，90年代→90s
  if (k === OLDER_DECADE) return "older";
  if (k === UNKNOWN_DECADE) return "unknown";
  return "x" + k.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * 归一化片名（R29 跨源同名去重键）。
 * 只剥离画质 / 版本 / 完结后缀（4K / 蓝光 / HD / 全集 …），
 * **保留季 / 部 / 集序号**（B-A05）：原先直接把「第2部 / 第二部」删掉，
 * 会把「流浪地球」「流浪地球 第2部」「流浪地球 第二部」误合并成一部并取最早年份，
 * 续集被写成第一部年份、归错年代档。现在把它们转成稳定后缀 -s2 / -sⅡ 之类，
 * 使不同续集互不相同；「流浪地球2」（数字紧连）本来就是独立 key，保持不变。
 * 只做字符归一，不猜年份、不补缺失值。
 */
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 零: 0, 百: 100 };
function seqSuffix(numText, kind) {
  let n = 0;
  if (/^\d+$/.test(numText)) n = Number(numText);
  else {
    // 中文数字（十 / 十二 / 二十 / 二十三）做有限解析，够覆盖「第一季~第十季」
    const s = String(numText);
    if (s === "十") n = 10;
    else if (s.startsWith("十")) n = 10 + (CN_NUM[s[1]] || 0);
    else if (s.endsWith("十")) n = (CN_NUM[s[0]] || 0) * 10;
    else n = CN_NUM[s] || 0;
    if (!n) n = s; // 解析不了就原样保留，绝不丢信息
  }
  const k = kind === "季" ? "s" : kind === "部" ? "p" : "e";
  return "-seq" + k + String(n);
}

export function normalizeVodName(name) {
  let s = String(name || "").normalize("NFKC").trim().toLowerCase();
  // 统一分隔符与全角括号
  s = s.replace(/[\s\-_.·•【】\[\]()（）「」《》:：,，!！?？'"]+/g, "");

  // B-A05：季 / 部 / 集序号转成稳定后缀（保留信息，而不是删掉）
  s = s.replace(/第([0-9一二三四五六七八九十百零两]+)(季|部|集)$/g, (_m, num, kind) => seqSuffix(num, kind));

  // 画质 / 版本 / 完结后缀，可连续出现多次；不含「季/部/集」，避免再吃掉序号
  const tail = /(4k|8k|2k|蓝光|原盘|超清|高清|标清|hdr|杜比|remux|uhd|hd|bd|dvd|ts|tc|抢先|完整|全集|完结|国语|粤语|中字|字幕|修复|未删减|导演剪辑|加长|完整版|tv版|剧场版|dolby|vision|10bit|60帧|无损)+$/;
  let prev;
  do { prev = s; s = s.replace(tail, ""); } while (s !== prev);
  // 序号后缀若被画质词包在中间（如「第2部4k」），上面的 tail 已剥掉画质，后缀仍在末尾
  return s;
}

/** 跨源同名去重键：归一化片名，不带年份（R29） */
export function dedupKey(it) {
  return normalizeVodName(it?.vod_name);
}

/**
 * R29：跨源同名条目合并。
 * 同一部片在多个源里年份可能不一致（A 标 2020、B 标 2018）或带不同画质后缀，
 * 若按 "name|vod_year" 归档会产生重复。这里按归一化片名合并：
 *   - 年份取所有源里「最早的有效年份」，写回 vod_year（字符串）；
 *     没有任何有效年份则置 ""（归入「年代不详」），绝不拿当前年份 / vod_time 补值；
 *   - _sources 记录贡献该片的所有源 key，供 build-lines.mjs 反查年代档覆盖哪些源站；
 *   - 代表条目保留首次出现条目的其它字段（vod_time / vod_area 等）。
 * @param {Array<object>} items 影片条目
 * @returns {Array<object>} 合并后的条目（每项含 _sources: string[]）
 */
export function dedupeByNormalizedName(items) {
  const map = new Map();
  for (const it of items || []) {
    if (!it || typeof it !== "object") continue;
    const k = dedupKey(it);
    if (!k) continue; // 归一化后为空（纯符号片名）跳过
    const y = parseVodYear(it.vod_year);
    let rec = map.get(k);
    if (!rec) {
      rec = { ...it, _sources: [], _years: [] };
      map.set(k, rec);
    }
    const sk = String(it._source || it.source_key || "unknown");
    if (rec._sources.indexOf(sk) < 0) rec._sources.push(sk);
    if (y !== null && rec._years.indexOf(y) < 0) rec._years.push(y);
    // 保留较新的 vod_time 作为代表（归档排序用），不参与年份判定
    if (String(it.vod_time || "") > String(rec.vod_time || "")) rec.vod_time = it.vod_time;
  }
  const out = [];
  for (const rec of map.values()) {
    const years = rec._years.slice().sort((a, b) => a - b);
    rec.vod_year = years.length ? String(years[0]) : ""; // 多源最早有效值
    delete rec._years;
    out.push(rec);
  }
  return out;
}

/** 本地统计用：只列出「真实有片」的年代档，按 keys 顺序 */
export function listDecadeOptions(items, keys = DECADE_KEYS) {
  const seen = new Set();
  for (const it of items || []) seen.add(decadeOf(it?.vod_year));
  return keys.filter((k) => seen.has(k));
}

/** 本地统计用：真实出现过的地区，按出现次数降序 */
export function listAreaOptions(items, max = 8) {
  const freq = new Map();
  for (const it of items || []) {
    const a = String(it?.vod_area || "").trim();
    if (!a || a === "未知" || a === "暂无") continue;
    freq.set(a, (freq.get(a) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([a]) => a);
}

/**
 * 把条目池按年代归档（统计真实条目数 / 输出列表）。
 * 空档不会出现在 present 里，但调用方应以 DECADE_KEYS 全档固定生成线路。
 * @param {Array<object>} items 影片条目
 * @param {{limit?:number, keys?:string[]}} opts
 * @returns {{
 *   buckets: Map<string,{key:string,count:number,rawItems:Array,list:Array}>,
 *   present: string[],
 *   summary: Array<{key,count,listed}>,
 *   invalidCount: number,   // 有值但解析不出合法年份（日期串 / 中文 / 未来年份…）
 *   missingCount: number    // 空 / 0 / 未知
 * }}
 */
export function buildDecadeBuckets(items, opts = {}) {
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 60;
  const keys = Array.isArray(opts.keys) && opts.keys.length ? opts.keys : DECADE_KEYS;
  const buckets = new Map();
  let invalidCount = 0;
  let missingCount = 0;

  for (const it of items || []) {
    if (!it || typeof it !== "object") continue;
    const raw = it.vod_year;
    if (isMissingYear(raw)) missingCount++;
    else if (parseVodYear(raw) === null) invalidCount++;
    const key = decadeOf(raw);
    if (!buckets.has(key)) buckets.set(key, { key, count: 0, rawItems: [], list: [] });
    const b = buckets.get(key);
    b.count++;
    b.rawItems.push(it);
    b.list.push(it);
  }

  for (const b of buckets.values()) {
    const seen = new Set();
    const uniq = [];
    for (const it of b.list) {
      const k = dedupKey(it);
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(it);
    }
    uniq.sort((a, c) => String(c?.vod_time || "").localeCompare(String(a?.vod_time || "")));
    b.list = uniq.slice(0, limit);
  }

  const present = keys.filter((k) => buckets.has(k) && buckets.get(k).count > 0);
  const summary = present.map((k) => ({
    key: k, count: buckets.get(k).count, listed: buckets.get(k).list.length,
  }));
  return { buckets, present, summary, invalidCount, missingCount, keys };
}

// B-A13：makeFilters 已删除。
// 原因：cat-verifier 报告 Result.filters 结构不对时 FilterAdapter 抛异常，
// objectFrom() 的 catch 会让整份 home 静默变空（比闪退更隐蔽）。
// 静态 cats.json + drpy 方案已废弃，本模块不再提供任何 filters 生成能力，
// 防止后续误用。build-lines.mjs 生成的配置顶层 / 站点一律 filterable:0。
