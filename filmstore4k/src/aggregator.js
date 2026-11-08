import { mapLimit, int } from "./util.js";
import { listFromSource, typesFromSource } from "./adapter.js";
import { annotate4k, matchVirtualCat } from "./t4k.js";
import { isOpen, recordSuccess, recordFailure } from "./breaker.js";

/** 单源硬超时：再慢也不许超过这个 */
const HARD_TIMEOUT = 5000;
/** 聚合整体 deadline：到点就用手上已有的数据返回，不等慢源 */
const DEADLINE = 6000;

function tmo(s) {
  return Math.min(int(s.timeout, 8000), HARD_TIMEOUT);
}

/**
 * 整体 deadline 包装：fn 超时或抛错都当失败，返回 fallback。
 * 关键点：不让任何一个慢源把整个请求拖死。
 */
function withDeadline(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

/** 带熔断的源调用 */
async function guarded(source, fn) {
  if (isOpen(source.key)) {
    return { skipped: true, error: "熔断中", list: [] };
  }
  try {
    const r = await fn();
    recordSuccess(source.key);
    return r;
  } catch (e) {
    recordFailure(source.key, e?.message || e);
    return { error: String(e?.message || e), list: [] };
  }
}

/** 聚合列表：所有源并发，整体到点即返回 */
export async function aggregateHome(sources, { pg = 1, limit = 20, hours = 0, deadline = DEADLINE } = {}) {
  const t0 = Date.now();

  const tasks = sources.map((s) =>
    withDeadline(
      guarded(s, () => listFromSource(s, { pg, hours, timeoutMs: tmo(s) })).then((r) => ({
        ...r,
        source_key: s.key,
        source_name: s.name,
        elapsed: Date.now() - t0,
      })),
      deadline,
      { error: "聚合超时", list: [], source_key: s.key, source_name: s.name, timedOut: true }
    )
  );

  const results = await Promise.all(tasks);

  const merged = [];
  const perSource = [];
  for (const r of results) {
    perSource.push({
      key: r.source_key,
      ok: !r.error && !r.skipped,
      skipped: !!r.skipped,
      timedOut: !!r.timedOut,
      error: r.error || null,
      count: r.list?.length || 0,
      total: r.total || 0,
      ms: r.elapsed || null,
    });
    for (const it of r.list || []) {
      merged.push(annotate4k({ ...it, source_key: r.source_key, source_name: r.source_name }));
    }
  }

  merged.sort((a, b) => (b.vod_time || "").localeCompare(a.vod_time || ""));

  return {
    page: pg,
    limit,
    count: merged.length,
    elapsed: Date.now() - t0,
    alive: perSource.filter((p) => p.ok).length,
    sources: perSource,
    list: merged.slice(0, limit),
    all: merged,
  };
}

/** 高清 / 4K 专区：多页扫源 + 画质过滤，按画质分排序 */
export async function aggregate4k(sources, { typeId = "4k", pg = 1, limit = 20, scanPages = 2, hours = 0, deadline = DEADLINE } = {}) {
  const t0 = Date.now();
  const jobs = [];
  for (const s of sources) {
    for (let i = 0; i < scanPages; i++) {
      const p = pg + i;
      jobs.push(
        withDeadline(
          guarded(s, () => listFromSource(s, { pg: p, hours, timeoutMs: tmo(s) })).then((r) => ({
            source: s,
            list: r.list || [],
          })),
          deadline,
          { source: s, list: [] }
        )
      );
    }
  }

  const results = await mapLimit(jobs, 10, (f) => f);
  const seen = new Set();
  const out = [];

  for (const r of results) {
    if (!r || !r.source) continue;
    for (const it of r.list || []) {
      const key = `${r.source.key}:${it.vod_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!matchVirtualCat(it, typeId)) continue;
      out.push(annotate4k({ ...it, source_key: r.source.key, source_name: r.source.name }));
    }
  }

  out.sort((a, b) => {
    // 画质分优先，其次更新时间
    const d = (b.vod_quality_score || 0) - (a.vod_quality_score || 0);
    if (d !== 0) return d;
    return (b.vod_time || "").localeCompare(a.vod_time || "");
  });
  return {
    page: pg,
    count: out.length,
    limit,
    elapsed: Date.now() - t0,
    list: out.slice(0, limit),
    all: out,
  };
}

/** 跨源搜索 */
export async function searchAll(sources, keyword, { limit = 40, deadline = DEADLINE } = {}) {
  const kw = String(keyword || "").trim();
  if (!kw) return { keyword: "", count: 0, list: [], sources: [] };

  const t0 = Date.now();
  const results = await mapLimit(sources, 10, async (s) => {
    const r = await withDeadline(
      guarded(s, () => listFromSource(s, { keyword: kw, timeoutMs: tmo(s) })),
      deadline,
      { error: "搜索超时", list: [], timedOut: true }
    );
    return { source: s, ...r };
  });

  const merged = [];
  const stats = [];
  for (const r of results) {
    stats.push({
      key: r.source?.key,
      ok: !r.error && !r.skipped,
      skipped: !!r.skipped,
      timedOut: !!r.timedOut,
      count: r.list?.length || 0,
      error: r.error || null,
    });
    for (const it of r.list || []) {
      merged.push(annotate4k({ ...it, source_key: r.source.key, source_name: r.source.name }));
    }
  }

  const lower = kw.toLowerCase();
  const score = (it) => {
    const name = (it.vod_name || "").toLowerCase();
    if (name === lower) return 0;
    if (name.startsWith(lower)) return 1;
    if (name.includes(lower)) return 2;
    return 3;
  };
  merged.sort((a, b) => {
    const d = score(a) - score(b);
    if (d !== 0) return d;
    return (b.vod_time || "").localeCompare(a.vod_time || "");
  });

  return { keyword: kw, count: merged.length, elapsed: Date.now() - t0, sources: stats, list: merged.slice(0, limit) };
}

/** 全源分类合并 */
export async function aggregateTypes(sources, { deadline = DEADLINE } = {}) {
  const results = await mapLimit(sources, 10, async (s) => {
    const r = await withDeadline(
      guarded(s, () => typesFromSource(s, tmo(s))),
      deadline,
      { error: "超时", class: [] }
    );
    return { source: s, ...r };
  });

  return results.map((r) => ({
    source_key: r.source?.key,
    source_name: r.source?.name,
    ok: !r.error && !r.skipped,
    skipped: !!r.skipped,
    error: r.error || null,
    total: r.total || 0,
    class: r.class || [],
  }));
}
