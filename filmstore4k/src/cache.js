/**
 * 两级缓存：
 *  1) 进程内 Map（同一个 Worker isolate 内命中，最快）
 *  2) 可选 KV（跨 isolate / 跨边缘节点，配置了 FILMSTORE 命名空间才启用）
 * 都取不到才真正回源。
 */

const mem = new Map();
const MAX_MEM_ENTRIES = 400;

export function memGet(key) {
  const e = mem.get(key);
  if (!e) return null;
  if (e.exp < Date.now()) {
    mem.delete(key);
    return null;
  }
  return e.val;
}

export function memSet(key, val, ttlSec) {
  if (mem.size >= MAX_MEM_ENTRIES) {
    // 简单淘汰：清掉最早插入的 1/4
    const keys = [...mem.keys()].slice(0, Math.ceil(MAX_MEM_ENTRIES / 4));
    for (const k of keys) mem.delete(k);
  }
  mem.set(key, { val, exp: Date.now() + ttlSec * 1000 });
}

/**
 * @param {string} key
 * @param {number} ttlSec
 * @param {() => Promise<any>} producer
 * @param {any} env  Worker 环境（可选，用于 KV）
 */
export async function cached(key, ttlSec, producer, env) {
  const hit = memGet(key);
  if (hit !== null) return { value: hit, cache: "mem" };

  const kv = env?.FILMSTORE;
  if (kv) {
    try {
      const raw = await kv.get(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        memSet(key, parsed, Math.min(ttlSec, 60));
        return { value: parsed, cache: "kv" };
      }
    } catch {}
  }

  const value = await producer();
  if (value !== undefined && value !== null) {
    memSet(key, value, ttlSec);
    if (kv) {
      try {
        await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSec) });
      } catch {}
    }
  }
  return { value, cache: "miss" };
}

export function cacheStats() {
  return { entries: mem.size, keys: [...mem.keys()].slice(0, 50) };
}
