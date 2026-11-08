/**
 * 苹果CMS V10（MacCMS）采集接口适配器。
 *
 * 标准接口形态：
 *   {base}?ac=list                                   分类 + 总数
 *   {base}?ac=videolist&pg=1&t=<typeId>&wd=<kw>&h=24 列表
 *   {base}?ac=videolist&ids=<id,id>                  详情（部分源用 ac=detail）
 *
 * 返回：{ code:1, page, pagecount, limit, total, list:[{vod_id, vod_name, ...}] }
 * 播放：vod_play_from / vod_play_url 用 "$$$" 分隔多线路，组内用 "#" 分隔剧集、每集 "名称$地址"。
 */

import { fetchWithTimeout, looseJsonParse, str, int } from "./util.js";

const SEP_SRC = "$$$";
const SEP_EP = "#";

/** 把 "第01集$http://a.m3u8#第02集$http://b.m3u8" 解析成 [{name,url}] */
export function parseEpisodes(group) {
  if (!group) return [];
  return String(group)
    .split(SEP_EP)
    .map((chunk, i) => {
      const s = chunk.trim();
      if (!s) return null;
      let name = "";
      let url = s;
      const cut = s.lastIndexOf("$");
      if (cut >= 0) {
        name = s.slice(0, cut).trim();
        url = s.slice(cut + 1).trim();
      }
      if (!url) return null;
      return { name: name || `第${i + 1}集`, url };
    })
    .filter(Boolean);
}

/** vod_play_from / vod_play_url 双串 -> 线路数组 */
export function parsePlaySources(playFrom, playUrl) {
  const froms = String(playFrom || "").split(SEP_SRC);
  const groups = String(playUrl || "").split(SEP_SRC);
  const out = [];
  const n = Math.max(froms.length, groups.length);
  for (let i = 0; i < n; i++) {
    const from = str(froms[i]) || `线路${i + 1}`;
    const episodes = parseEpisodes(groups[i]);
    if (!episodes.length) continue;
    out.push({
      from,
      flag: normalizeFlag(from),
      episodes,
      count: episodes.length,
    });
  }
  return out;
}

/** 线路名 -> flag，形如 youku / qiyi / m3u8 / ffm3u8 */
export function normalizeFlag(from) {
  const s = str(from).toLowerCase();
  if (!s) return "m3u8";
  if (/m3u8|hls/.test(s)) return "m3u8";
  if (/优酷|youku/.test(s)) return "youku";
  if (/爱奇艺|奇艺|qiyi|iqiyi/.test(s)) return "qiyi";
  if (/腾讯|qq|tencent/.test(s)) return "qq";
  if (/芒果|mgtv/.test(s)) return "mgtv";
  if (/搜狐|sohu/.test(s)) return "sohu";
  if (/哔哩|bili/.test(s)) return "bilibili";
  if (/mp4/.test(s)) return "mp4";
  return s.replace(/[^a-z0-9]/g, "") || "m3u8";
}

function joinApi(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function callApi(source, params, timeoutMs) {
  const url = joinApi(source.api, params);
  const res = await fetchWithTimeout(url, { timeoutMs: timeoutMs || source.timeout || 8000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.text();
  const data = looseJsonParse(raw);
  if (!data || typeof data !== "object") throw new Error("非 JSON 响应");
  if (data.code !== undefined && Number(data.code) !== 1) {
    throw new Error(str(data.msg) || `code=${data.code}`);
  }
  return data;
}

/** 规范化单个 vod 条目（列表态，字段可能不全） */
function normalizeListItem(item, source) {
  const playSources = parsePlaySources(item.vod_play_from, item.vod_play_url);
  return {
    vod_id: int(item.vod_id),
    vod_name: str(item.vod_name),
    vod_sub: str(item.vod_sub),
    type_id: str(item.type_id),
    type_name: str(item.type_name),
    vod_class: str(item.vod_class),
    vod_pic: str(item.vod_pic),
    vod_pic_slide: str(item.vod_pic_slide) || str(item.vod_pic),
    vod_actor: str(item.vod_actor),
    vod_director: str(item.vod_director),
    vod_area: str(item.vod_area),
    vod_lang: str(item.vod_lang),
    vod_year: str(item.vod_year),
    vod_remarks: str(item.vod_remarks),
    vod_time: str(item.vod_time),
    vod_duration: str(item.vod_duration),
    vod_score: str(item.vod_score),
    vod_content: str(item.vod_blurb) || str(item.vod_content),
    vod_play_from: str(item.vod_play_from),
    vod_play_url: str(item.vod_play_url),
    vod_play_sources: playSources,
    source_key: source.key,
    source_name: source.name,
  };
}

/**
 * 列表查询。
 * @param {object} source  sources.json 里的一条
 * @param {{pg?:number, typeId?:string, keyword?:string, hours?:number, ids?:string}} q
 */
export async function listFromSource(source, q = {}) {
  const params = { ac: "videolist" };
  if (q.ids) params.ids = q.ids;
  if (q.pg) params.pg = q.pg;
  if (q.typeId) params.t = q.typeId;
  if (q.keyword) params.wd = q.keyword;
  if (q.hours) params.h = q.hours;

  const data = await callApi(source, params, q.timeoutMs);
  const list = Array.isArray(data.list) ? data.list : [];
  return {
    source_key: source.key,
    source_name: source.name,
    page: int(data.page, q.pg || 1),
    pagecount: int(data.pagecount, 1),
    limit: int(data.limit, 20),
    total: int(data.total, list.length),
    list: list.map((it) => normalizeListItem(it, source)),
  };
}

/** 分类列表（ac=list） */
export async function typesFromSource(source, timeoutMs) {
  const data = await callApi(source, { ac: "list" }, timeoutMs);
  const classes = Array.isArray(data.class) ? data.class : [];
  const list = Array.isArray(data.list) ? data.list : [];
  return {
    source_key: source.key,
    source_name: source.name,
    class: classes.map((c) => ({
      type_id: str(c.type_id),
      type_pid: str(c.type_pid),
      type_name: str(c.type_name),
    })),
    total: int(data.total, 0),
    latest: list.slice(0, 5).map((it) => normalizeListItem(it, source)),
  };
}

/** 详情（ids 支持逗号分隔批量） */
export async function detailFromSource(source, ids, timeoutMs) {
  const tryOrders = [{ ac: "videolist", ids }, { ac: "detail", ids }];
  let lastErr;
  for (const params of tryOrders) {
    try {
      const data = await callApi(source, params, timeoutMs);
      const list = Array.isArray(data.list) ? data.list : [];
      if (list.length) {
        return {
          source_key: source.key,
          source_name: source.name,
          list: list.map((it) => normalizeListItem(it, source)),
        };
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("详情为空");
}
