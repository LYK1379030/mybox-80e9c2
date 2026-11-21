import sourcesConfig from "./sources.gen.js";
import { json, text, html, noContent, str, int, clamp, CORS } from "./util.js";
import { aggregateHome, aggregate4k, searchAll, aggregateTypes } from "./aggregator.js";
import { listFromSource, detailFromSource, typesFromSource } from "./adapter.js";
import { annotate4k, VIRTUAL_CATS, isVirtualTypeId } from "./t4k.js";
import { cached, cacheStats } from "./cache.js";
import { buildTvboxConfig, buildMinimalConfig } from "./tvbox.js";
import { LANDING_HTML, PLAYER_HTML } from "./pages.js";
import { breakerSnapshot, resetBreaker } from "./breaker.js";
import { rateLimit, clientKey, clampScan, sanitizeKeyword } from "./ratelimit.js";
import { resolvePlayUrl } from "./parse.js";
import { probeStream } from "./quality.js";
import { memGet, memSet } from "./cache.js";
import { searchPan4k, buildPanSiteConfig } from "./pan4k.js";

function getSources(env) {
  let cfg = sourcesConfig;
  // env.SOURCES 允许覆盖源清单，但畸形 JSON 不能把服务打崩
  if (env?.SOURCES) {
    try {
      const parsed = JSON.parse(env.SOURCES);
      if (parsed && typeof parsed === "object") cfg = parsed;
    } catch {
      // 畸形 JSON：忽略，回落到内置 sources.gen.js
      console.warn("[getSources] env.SOURCES 畸形 JSON，已回落内置清单");
    }
  }
  const all = (cfg.sources || []).map((s) => ({
    timeout: cfg.defaults?.timeout ?? 8000,
    ...s,
  }));
  const only = str(env?.ONLY_SOURCES);
  const deny = str(env?.DENY_SOURCES);
  let list = all;
  if (only) {
    const keep = new Set(only.split(",").map((x) => x.trim()).filter(Boolean));
    list = list.filter((s) => keep.has(s.key));
  }
  if (deny) {
    const drop = new Set(deny.split(",").map((x) => x.trim()).filter(Boolean));
    list = list.filter((s) => !drop.has(s.key));
  }
  return list;
}

/** 限流守卫：返回 Response 或 null（放行） */
function guard(request, { max = 120, windowMs = 60000 } = {}) {
  const r = rateLimit(clientKey(request), { max, windowMs });
  if (r.ok) return null;
  return json(
    { error: "请求过于频繁", retry_after_sec: r.reset, limit: r.limit },
    429,
    {
      "retry-after": String(r.reset),
      "x-ratelimit-limit": String(r.limit),
      "x-ratelimit-remaining": String(r.remaining),
    }
  );
}

function ttl(env, fallback = 120) {
  const n = int(env?.CACHE_TTL, fallback);
  return clamp(n, 10, 86400);
}

// ---------- macCMS 兼容层 ----------

function toCmsItem(it) {
  return {
    vod_id: it.vod_id,
    vod_name: it.vod_name,
    vod_sub: it.vod_sub || "",
    type_id: it.type_id || "",
    type_name: it.type_name || "",
    vod_class: it.vod_class || "",
    vod_pic: it.vod_pic || "",
    vod_pic_slide: it.vod_pic_slide || it.vod_pic || "",
    vod_actor: it.vod_actor || "",
    vod_director: it.vod_director || "",
    vod_area: it.vod_area || "",
    vod_lang: it.vod_lang || "",
    vod_year: it.vod_year || "",
    vod_remarks: it.vod_remarks || "",
    vod_time: it.vod_time || "",
    vod_duration: it.vod_duration || "",
    vod_score: it.vod_score || "",
    vod_content: it.vod_content || "",
    vod_play_from: it.vod_play_from || "",
    vod_play_url: it.vod_play_url || "",
  };
}

function cmsResponse({ page = 1, pagecount = 1, limit = 20, total = 0, list = [] }) {
  return {
    code: 1,
    msg: "数据列表",
    page,
    pagecount,
    limit,
    total,
    list: list.map(toCmsItem),
  };
}

// ---------- 路由 ----------

async function handleCms(url, env, sources, profile) {
  const p = url.searchParams;
  const ac = str(p.get("ac")) || "list";
  const only4k = profile === "4k";

  if (ac === "list") {
    // ── v2 层级分类体系 ──
    // 顶级 8 个大区（语义归并）+ 二级子类（源站子类归并到标准名）
    // type_id 格式：
    //   "m:<catId>"            顶级虚拟聚合（点击跨源路由）
    //   "s:<源key>:<源type_id>" 二级单源精确路由
    //   "q4k" / "new"          虚拟分类（画质/最新）
    if (only4k) {
      return json({
        code: 1,
        msg: "数据列表",
        page: 1,
        pagecount: 1,
        limit: 20,
        total: 0,
        class: VIRTUAL_CATS.map((c) => ({ type_id: c.type_id, type_pid: 0, type_name: c.type_name })),
        list: [],
      });
    }

    // 拉全部源的分类，映射进大区
    const types = await aggregateTypes(sources, env);
    const { TOP_CATS, VIRTUAL_TOP, classifySourceCat } = await import("./cats.js");

    // 大区 → 子类归并桶
    const topBuckets = new Map(); // topId -> { name, subs: Map<std -> [{source_key,type_id}]> }
    for (const t of TOP_CATS) {
      topBuckets.set(t.id, { name: t.name, subs: new Map() });
    }

    for (const t of types) {
      for (const c of t.class || []) {
        const mapped = classifySourceCat({ ...c, source_key: t.source_key });
        if (!mapped) continue;
        const bucket = topBuckets.get(mapped.topId);
        if (!bucket) continue;
        if (mapped.sub) {
          // 有归并子类：同一标准子名下的多个源类目共用一个二级入口，
          // 点击时跨源路由（同顶级虚拟路由逻辑）
          if (!bucket.subs.has(mapped.sub.std)) {
            bucket.subs.set(mapped.sub.std, { typeId: mapped.sub.typeId, sources: [] });
          }
          bucket.subs.get(mapped.sub.std).sources.push({
            source_key: t.source_key,
            type_id: c.type_id,
          });
        }
      }
    }

    // 组装 class 数组（两级：pid=0 顶级，pid=顶级id 二级）
    const cls = [];
    // 虚拟分类排最前
    for (const v of VIRTUAL_TOP) {
      cls.push({ type_id: v.id, type_pid: "0", type_name: v.name });
    }
    // 大区 + 二级
    for (const t of TOP_CATS) {
      const tid = `m:${t.id}`;
      cls.push({ type_id: tid, type_pid: "0", type_name: t.name });
      const bucket = topBuckets.get(t.id);
      if (bucket) {
        for (const [std, info] of bucket.subs) {
          cls.push({
            type_id: `x:${t.id}:${encodeURIComponent(std)}`, // 跨源二级路由
            type_pid: tid,
            type_name: "  " + std, // 缩进表示层级
          });
        }
      }
    }

    return json({
      code: 1,
      msg: "数据列表",
      page: 1,
      pagecount: 1,
      limit: 20,
      total: 0,
      class: cls,
      list: [],
    });
  }

  const pg = clamp(int(p.get("pg"), 1), 1, 200);
  const typeId = str(p.get("t"));
  const wd = str(p.get("wd") || p.get("wd_name") || p.get("key"));
  const ids = str(p.get("ids"));
  const lim = clamp(int(p.get("limit"), 20), 1, 100);

  if (ids) {
    // 详情：ids 形如 "源key:vodid" 或纯数字（全源搜）
    const parts = ids.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20); // 批量上限
    const out = [];
    for (const spec of parts) {
      if (spec.includes(":")) {
        const [sk, id] = spec.split(":");
        if (sk.length > 32 || id.length > 64) continue;
        const src = sources.find((s) => s.key === sk);
        if (!src) continue;
        try {
          const r = await detailFromSource(src, id, src.timeout);
          out.push(...r.list.map(annotate4k));
        } catch {}
      }
    }
    return json(
      cmsResponse({ page: 1, pagecount: 1, limit: out.length, total: out.length, list: out })
    );
  }

  if (wd) {
    const kw = sanitizeKeyword(wd);
    if (!kw) return json(cmsResponse({ page: pg, list: [] }));
    const r = await cached(`cms:s:${kw}:${pg}:${profile}`, ttl(env, 300), () =>
      searchAll(sources, kw, { limit: 100 })
    , env);
    const list = r.value.list || [];
    return json(
      cmsResponse({ page: pg, pagecount: 1, limit: list.length, total: r.value.count, list })
    );
  }

  // 分类列表
  if (!typeId) {
    const r = await cached(`cms:home:${pg}:${profile}`, ttl(env), () =>
      aggregateHome(sources, { pg, limit: 60 })
    , env);
    return json(
      cmsResponse({ page: pg, pagecount: 99, limit: 60, total: 9999, list: r.value.list || [] })
    );
  }

  if (isVirtualTypeId(typeId)) {
    const scan = clampScan(url.searchParams.get("scan"), 3);
    const r = await cached(`cms:4k:${typeId}:${pg}:${scan}`, ttl(env, 300), () =>
      aggregate4k(sources, { typeId, pg, limit: 60, scanPages: scan })
    , env);
    return json(
      cmsResponse({ page: pg, pagecount: 20, limit: 60, total: r.value.count || 0, list: r.value.list || [] })
    );
  }

  // ── v2 层级分类路由 ──

  // "m:<catId>" 顶级虚拟聚合：跨源拉对应大区的条目
  if (typeId.startsWith("m:")) {
    const catId = typeId.slice(2);
    const { TOP_CATS } = await import("./cats.js");
    const top = TOP_CATS.find((t) => t.id === catId);
    if (!top) return json(cmsResponse({ page: pg, list: [] }));
    const r = await cached(`cms:top:${catId}:${pg}`, ttl(env, 300), async () => {
      // 每源查其所属该大区的主类目第一页，聚合去重
      const results = await Promise.all(sources.map(async (s) => {
        try {
          const cls = (await typesFromSource(s, s.timeout)).class || [];
          // 找该源里匹配大区的类目（优先 pid=0 根类目，其次子类）
          const matched = cls.filter((c) => top.re.test(String(c.type_name || "")));
          if (!matched.length) return [];
          // 优先根类目（条目最全），否则取第一个匹配子类
          const root = matched.find((c) => String(c.type_pid) === "0") || matched[0];
          const d = await listFromSource(s, { pg, typeId: root.type_id, timeoutMs: s.timeout });
          return d.list || [];
        } catch { return []; }
      }));
      const merged = results.flat().map(annotate4k);
      merged.sort((a, b) => (b.vod_time || "").localeCompare(a.vod_time || ""));
      return { list: merged.slice(0, 60), count: merged.length };
    }, env);
    return json(
      cmsResponse({ page: pg, pagecount: 20, limit: 60, total: r.value.count || 0, list: r.value.list || [] })
    );
  }

  // "x:<catId>:<std>" 跨源二级：聚合所有源里该子类的条目
  if (typeId.startsWith("x:")) {
    const parts = typeId.split(":");
    const catId = parts[1];
    const std = decodeURIComponent(parts[2] || "");
    const { TOP_CATS } = await import("./cats.js");
    const top = TOP_CATS.find((t) => t.id === catId);
    if (!top || !std) return json(cmsResponse({ page: pg, list: [] }));
    const subRule = top.subs.find((s) => s.std === std);
    if (!subRule) return json(cmsResponse({ page: pg, list: [] }));
    const r = await cached(`cms:sub:${catId}:${std}:${pg}`, ttl(env, 300), async () => {
      const results = await Promise.all(sources.map(async (s) => {
        try {
          const cls = (await typesFromSource(s, s.timeout)).class || [];
          // 该源里名字匹配子规则的类目（可能有多个，全部取）
          const matched = cls.filter((c) => subRule.re.test(String(c.type_name || "")) && top.re.test(String(c.type_name || "")));
          const lists = [];
          for (const c of matched.slice(0, 2)) { // 每源最多查 2 个匹配类目
            try {
              const d = await listFromSource(s, { pg, typeId: c.type_id, timeoutMs: s.timeout });
              lists.push(...(d.list || []));
            } catch {}
          }
          return lists;
        } catch { return []; }
      }));
      const merged = results.flat().map(annotate4k);
      // 跨源同名去重
      const seen = new Set();
      const uniq = merged.filter((it) => {
        const k = `${it.vod_name}|${it.vod_year || ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      uniq.sort((a, b) => (b.vod_time || "").localeCompare(a.vod_time || ""));
      return { list: uniq.slice(0, 60), count: uniq.length };
    }, env);
    return json(
      cmsResponse({ page: pg, pagecount: 20, limit: 60, total: r.value.count || 0, list: r.value.list || [] })
    );
  }

  // "s:<源key>:<源type_id>" 单源精确路由
  if (typeId.startsWith("s:")) {
    const seg = typeId.split(":");
    const sk = seg[1];
    const rawTid = seg[2];
    const src = sources.find((s) => s.key === sk);
    if (src) {
      const r = await cached(`cms:st:${sk}:${rawTid}:${pg}`, ttl(env), async () => {
        const d = await listFromSource(src, { pg, typeId: rawTid, timeoutMs: src.timeout });
        return { list: d.list.map(annotate4k), total: d.total, pagecount: d.pagecount };
      }, env);
      return json(
        cmsResponse({
          page: pg,
          pagecount: r.value.pagecount || 1,
          limit: 60,
          total: r.value.total || 0,
          list: r.value.list || [],
        })
      );
    }
  }

  // 旧格式兼容："源key-原始typeid"
  if (typeId.includes("-")) {
    const cut = typeId.indexOf("-");
    const sk = typeId.slice(0, cut);
    const rawTid = typeId.slice(cut + 1);
    const src = sources.find((s) => s.key === sk);
    if (src) {
      const r = await cached(`cms:t:${sk}:${rawTid}:${pg}`, ttl(env), async () => {
        const d = await listFromSource(src, { pg, typeId: rawTid, timeoutMs: src.timeout });
        return { list: d.list.map(annotate4k), total: d.total, pagecount: d.pagecount };
      }, env);
      return json(
        cmsResponse({
          page: pg,
          pagecount: r.value.pagecount || 1,
          limit: 60,
          total: r.value.total || 0,
          list: r.value.list || [],
        })
      );
    }
  }

  return json(cmsResponse({ page: pg, list: [] }));
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const sources = getSources(env);
  const origin = url.origin;

  // 限流：所有 API 打上游有放大效应，统一保护
  const heavy = ["/api/sources/check", "/api/search", "/api/4k", "/api/types"].includes(path);
  const limited = guard(request, { max: heavy ? 30 : 180, windowMs: 60000 });
  if (limited) return limited;

  // macCMS 兼容：/cms/all|4k/api.php/provide/vod/
  const mCms = path.match(/^\/cms\/(all|4k)\/api\.php\/provide\/vod$/);
  if (mCms) return handleCms(url, env, sources, mCms[1]);
  // 也接受简写 /cms?profile=all
  if (path === "/cms" || path === "/api.php/provide/vod") {
    return handleCms(url, env, sources, str(url.searchParams.get("profile")) || "all");
  }

  // /play 端点：share 页 -> 真实 m3u8，302 重定向
  // 用法：/play?u=https://vip.ffzy-play10.com/share/xxx
  if (path === "/play") {
    const raw = str(url.searchParams.get("u"));
    if (!raw) return json({ error: "缺少 u 参数" }, 400);
    if (!/^https?:\/\//i.test(raw)) return json({ error: "仅支持 http(s)" }, 400);

    // 解析结果缓存 30 分钟（成功）/ 5 分钟（失败），share 页不会秒变
    const ck = `play:${raw}`;
    const hit = memGet(ck);
    let resolved = hit;

    if (!resolved) {
      // 多线路候选：传同集的其它线路，失败可切换
      const cands = str(url.searchParams.get("cands"))
        ? str(url.searchParams.get("cands")).split("|").map(decodeURIComponent).filter(Boolean)
        : null;
      resolved = await resolvePlayUrl(raw, { timeoutMs: 7000, candidates: cands });
      memSet(ck, resolved, resolved.ok ? 1800 : 300);
    }

    if (resolved.ok && resolved.direct && /^https?:\/\//i.test(resolved.url)) {
      return new Response(null, {
        status: 302,
        headers: {
          location: resolved.url,
          "cache-control": "public, max-age=300",
          "x-resolved-from": resolved.from || "?",
          ...CORS,
        },
      });
    }

    // 解析失败：402 让客户端明确知道（不 302 到假地址）
    return json(
      { error: "解析失败", detail: resolved.error || "无法解析出直链", raw },
      502,
      { "cache-control": "no-store" }
    );
  }

  // /quality 端点：探测一个 m3u8 的真实分辨率
  if (path === "/quality" || path === "/api/quality") {
    const raw = str(url.searchParams.get("u"));
    if (!raw) return json({ error: "缺少 u 参数" }, 400);
    if (!/^https?:\/\//i.test(raw)) return json({ error: "仅支持 http(s)" }, 400);
    const q = await probeStream(raw, { timeoutMs: 6000 });
    return json(q, 200, { "cache-control": "public, max-age=600" });
  }

  // 4K 网盘聚合搜索：真正的 4K 片源载体（阿里/夸克/115/天翼）
  if (path === "/api/pan4k" || path === "/api/pan") {
    const kw = sanitizeKeyword(str(url.searchParams.get("wd") || url.searchParams.get("q")));
    if (!kw) return json({ error: "缺少 wd 参数" }, 400);
    const limit = clamp(int(url.searchParams.get("limit"), 30), 1, 100);
    const r = await cached(`pan4k:${kw}:${limit}`, ttl(env, 600), () => searchPan4k(kw, { limit }), env);
    return json({ ...r.value, cache: r.cache });
  }

  // 聚合详情：同片名跨源（含网盘源），把最清晰的排前面
  if (path === "/api/best") {
    const kw = sanitizeKeyword(str(url.searchParams.get("wd") || url.searchParams.get("q")));
    if (!kw) return json({ error: "缺少 wd 参数" }, 400);
    const r = await cached(`best:${kw}`, ttl(env, 600), async () => {
      // 并行拿 CMS 源 + 网盘源
      const [cms, pan] = await Promise.all([
        searchAll(sources, kw, { limit: 40 }),
        searchPan4k(kw, { limit: 20 }).catch(() => ({ ok: false, list: [] })),
      ]);
      return { cms, pan };
    }, env);
    return json({
      keyword: kw,
      cms: { count: r.value.cms.count, list: r.value.cms.list },
      pan: { count: r.value.pan?.count || 0, list: r.value.pan?.list || [] },
      cache: r.cache,
    });
  }

  if (path === "/" || path === "/index.html") return html(LANDING_HTML);
  if (path === "/player") return html(PLAYER_HTML);

  if (path === "/health") {
    return json({
      ok: true,
      now: new Date().toISOString(),
      sources: sources.length,
      cache: cacheStats(),
      breaker: breakerSnapshot(),
    });
  }

  if (path === "/api/breaker") {
    if (url.searchParams.get("reset")) {
      resetBreaker(str(url.searchParams.get("reset")) === "all" ? null : str(url.searchParams.get("reset")));
    }
    return json({ breaker: breakerSnapshot() });
  }

  if (path === "/api/sources") {
    return json({
      count: sources.length,
      sources: sources.map((s) => ({
        key: s.key,
        name: s.name,
        api: s.direct === false ? null : s.api,
        direct: s.direct !== false,
      })),
    });
  }

  // 源体检
  if (path === "/api/sources/check") {
    const results = await Promise.all(
      sources.map(async (s) => {
        const t0 = Date.now();
        try {
          const r = await listFromSource(s, { pg: 1, timeoutMs: Math.min(s.timeout || 8000, 8000) });
          return {
            key: s.key,
            name: s.name,
            ok: true,
            ms: Date.now() - t0,
            total: r.total,
            sample: r.list[0]?.vod_name || null,
          };
        } catch (e) {
          return { key: s.key, name: s.name, ok: false, ms: Date.now() - t0, error: String(e?.message || e) };
        }
      })
    );
    const ok = results.filter((r) => r.ok);
    return json({ total: results.length, alive: ok.length, dead: results.length - ok.length, results });
  }

  if (path === "/api/types") {
    const source = str(url.searchParams.get("source"));
    const picked = source && source !== "all" ? sources.filter((s) => s.key === source) : sources;
    const r = await cached(`types:${source || "all"}`, ttl(env, 3600), () => aggregateTypes(picked, env), env);
    return json({ virtual: VIRTUAL_CATS, sources: r.value });
  }

  if (path === "/api/list") {
    const pg = clamp(int(url.searchParams.get("pg"), 1), 1, 100);
    const limit = clamp(int(url.searchParams.get("limit"), 20), 1, 100);
    const hours = clamp(int(url.searchParams.get("hours"), 0), 0, 720);
    const source = str(url.searchParams.get("source"));
    const typeId = str(url.searchParams.get("type"));
    const picked = source && source !== "all" ? sources.filter((s) => s.key === source) : sources;

    if (typeId && isVirtualTypeId(typeId)) {
      const r = await cached(`list4k:${typeId}:${pg}:${limit}`, ttl(env, 300), () =>
        aggregate4k(picked, { typeId, pg, limit, scanPages: 3, hours })
      , env);
      return json({ ...r.value, cache: r.cache });
    }

    if (typeId && typeId.includes("-")) {
      const cut = typeId.indexOf("-");
      const sk = typeId.slice(0, cut);
      const rawTid = typeId.slice(cut + 1);
      const src = picked.find((s) => s.key === sk);
      if (src) {
        const r = await cached(`list:${sk}:${rawTid}:${pg}`, ttl(env), async () => {
          const d = await listFromSource(src, { pg, typeId: rawTid, hours, timeoutMs: src.timeout });
          return { ...d, list: d.list.map(annotate4k) };
        }, env);
        return json({ ...r.value, cache: r.cache });
      }
    }

    const r = await cached(`list:home:${pg}:${limit}:${hours}:${source || "all"}`, ttl(env), () =>
      aggregateHome(picked, { pg, limit, hours })
    , env);
    return json({ ...r.value, cache: r.cache });
  }

  if (path === "/api/4k") {
    const cat = str(url.searchParams.get("cat")) || "4k";
    const pg = clamp(int(url.searchParams.get("pg"), 1), 1, 100);
    const limit = clamp(int(url.searchParams.get("limit"), 20), 1, 100);
    const scanPages = clampScan(url.searchParams.get("scan"), 3); // 防放大
    const r = await cached(`4k:${cat}:${pg}:${limit}:${scanPages}`, ttl(env, 300), () =>
      aggregate4k(sources, { typeId: cat, pg, limit, scanPages })
    , env);
    return json({ cat, ...r.value, cache: r.cache });
  }

  if (path === "/api/search") {
    const wd = sanitizeKeyword(str(url.searchParams.get("wd") || url.searchParams.get("q") || url.searchParams.get("key")));
    if (!wd) return json({ error: "缺少 wd 参数" }, 400);
    const limit = clamp(int(url.searchParams.get("limit"), 40), 1, 100);
    const r = await cached(`search:${wd}:${limit}`, ttl(env, 300), () => searchAll(sources, wd, { limit }), env);
    return json({ ...r.value, cache: r.cache });
  }

  if (path === "/api/detail") {
    const source = str(url.searchParams.get("source"));
    const id = str(url.searchParams.get("id"));
    if (!source || !id) return json({ error: "缺少 source / id 参数" }, 400);
    if (source.length > 32 || id.length > 64) return json({ error: "参数过长" }, 400);
    const src = sources.find((s) => s.key === source);
    if (!src) return json({ error: `未知源 ${source}` }, 404);
    const r = await cached(`detail:${source}:${id}`, ttl(env, 600), () => detailFromSource(src, id, src.timeout), env);
    return json({ ...r.value, list: (r.value.list || []).map(annotate4k), cache: r.cache });
  }

  if (path === "/config.json" || path === "/tvbox.json") {
    const mode = str(url.searchParams.get("mode")) || "full";
    const cfg =
      mode === "lite"
        ? buildMinimalConfig(origin, sources, sourcesConfig)
        : buildTvboxConfig(origin, sources, sourcesConfig);
    return json(cfg, 200, { "cache-control": "public, max-age=300" });
  }

  return json({ error: "not found", path }, 404);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return noContent();
    try {
      return await route(request, env || {});
    } catch (e) {
      // 生产环境不泄漏 stack，只给 message
      return json({ error: String(e?.message || e) }, 500);
    }
  },
};

// Node 本地运行 / 自测入口
export { route, getSources };
