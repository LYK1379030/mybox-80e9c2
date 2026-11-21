/**
 * 共享安全门禁与核心源清单（零依赖 · 纯函数 · 可被 .js / .mjs 同时 import）
 *
 * 背景（A09 SSRF 门禁缺失）：
 *   isSafeCandidate 原先只存在于 build-fs4k.js:76，scripts/build-lines.mjs 的
 *   readPool() 只校验 /^https?:\/\//i，导致合成池里的
 *   127.0.0.1 / 169.254.169.254 / 192.168.1.1 / 带凭据 URL 全部被放行并写入
 *   电视客户端配置。现在抽到本模块，两个构建器共用同一份，避免两份逻辑漂移。
 *
 * 背景（A01 空池级联 P0）：
 *   CORE_SOURCES 原先是 build-fs4k.js 的私有常量。build-fs4k.js 若某天全源超时
 *   会写出 alive:[] 的 source-pool.json，同 run 的 build-lines.mjs 读到空池 →
 *   16 条线路全空 → build.py 自检 sys.exit(2) 静默停更。现在两个构建器共享
 *   同一份核心源，build-lines.mjs 在空池时回落到它。
 *
 * 注意：本模块只做「静态字符串 / URL 结构」判定，不解析 DNS，也不阻止重定向
 * 后的内网目标；调用方如需更强保证应配合 redirect:"error" 或解析后复核。
 */

/** 投毒 / 内网 / 回环 / 链路本地 / 元数据 / 凭据 / 非 CMS 形态门禁 */
export function isSafeCandidate(api) {
  const s = String(api || "");
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    if (u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    if (
      h === "localhost" ||
      h === "metadata.google.internal" ||
      h.endsWith(".local") ||
      h.endsWith(".internal") ||
      /^127\./.test(h) ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      /^169\.254\./.test(h) ||
      /^0\./.test(h) ||
      /^::$/.test(h) ||
      /^\[?::1\]?$/.test(h) ||
      /^\[?fc[0-9a-f]{2}:/i.test(h) ||
      /^\[?fe80:/i.test(h)
    ) return false;
    // 只收 macCMS 形态的采集接口，顺带挡掉任意路径投毒
    if (!/api\.php|provide\/vod/i.test(s)) return false;
    return true;
  } catch { return false; }
}

/**
 * 更严格的「可用源站」门禁：在 isSafeCandidate 基础上再要求 api.php/provide/vod
 * 路径里不含可疑查询串与片段（防止把 ?url= 之类参数透传到客户端）。
 */
export function isSafeSourceApi(api) {
  if (!isSafeCandidate(api)) return false;
  try {
    const u = new URL(String(api));
    if (u.hash) return false;
    for (const [k, v] of u.searchParams) {
      if (/^(url|uri|host|ip|redirect|next|target)$/i.test(k)) return false;
      if (/[<>\"'\x00-\x1f]/.test(String(v))) return false;
    }
    return true;
  } catch { return false; }
}

/**
 * 人工维护的核心源清单（12 个，与 build-fs4k.js 原 CORE_SOURCES 完全一致）。
 * 两个构建器共享；build-lines.mjs 在 source-pool.json 为空 / 全被门禁拦掉时回落。
 * 注意：门禁要求 api 形如 api.php/provide/vod，本清单全部满足。
 */
export const CORE_SOURCES = Object.freeze([
  { key: "bfzy",    name: "暴风资源", api: "https://bfzyapi.com/api.php/provide/vod/" },
  { key: "lzi",     name: "量子资源", api: "https://cj.lziapi.com/api.php/provide/vod/" },
  { key: "ffzy",    name: "非凡影视", api: "https://cj.ffzyapi.com/api.php/provide/vod/" },
  { key: "dytt",    name: "电影天堂", api: "http://caiji.dyttzyapi.com/api.php/provide/vod/" },
  { key: "jian",    name: "建安资源", api: "http://154.219.117.232:9981/jacloudapi.php/provide/vod/" },
  { key: "tyys",    name: "天涯资源", api: "http://tyyszy.com/api.php/provide/vod/" },
  { key: "360zy",   name: "360资源",  api: "https://360zy.com/api.php/provide/vod/" },
  { key: "yinghua", name: "樱花资源", api: "https://m3u8.apiyhzy.com/api.php/provide/vod/" },
  { key: "jinying", name: "金鹰资源", api: "https://jyzyapi.com/api.php/provide/vod/" },
  { key: "modu",    name: "魔都资源", api: "https://www.mdzyapi.com/api.php/provide/vod/" },
  { key: "sony",    name: "索尼资源", api: "https://suoniapi.com/api.php/provide/vod/" },
  { key: "subo",    name: "速播资源", api: "https://subocaiji.com/api.php/provide/vod/" },
]);

/** 净化文本：去控制字符 / 零宽字符 / HTML 尖括号与引号，限长（B-A10） */
export function sanitizeText(raw, maxLen = 64) {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, "")
    .replace(/[<>\"'&]/g, "")
    .trim()
    .slice(0, maxLen);
}
