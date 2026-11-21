/**
 * 门禁单元测试：isSafeCandidate 对恶意样本的拦截率
 * 独立实现（与 build-fs4k.js 保持一致），10 个样本全验。
 */
function isSafeCandidate(api) {
  const s = String(api || "");
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (
      host === "localhost" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^0\./.test(host) ||
      host === "metadata.google.internal" ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) return false;
    if (!/api\.php|provide\/vod/i.test(s)) return false;
    return true;
  } catch { return false; }
}

const cases = [
  // [url, 期望(是否放行), 说明]
  ["https://bfzyapi.com/api.php/provide/vod/", true, "正常源"],
  ["http://caiji.dyttzyapi.com/api.php/provide/vod/", true, "正常http源"],
  ["http://192.168.1.1/api.php/provide/vod/", false, "内网C段"],
  ["http://127.0.0.1:8793/api.php/provide/vod/", false, "回环"],
  ["https://user:pass@steal.com/api.php/provide/vod/", false, "带凭据"],
  ["ftp://x.com/api.php/provide/vod/", false, "非http协议"],
  ["https://10.0.0.5/api.php/provide/vod/", false, "内网A段"],
  ["https://172.16.0.9/api.php/provide/vod/", false, "内网B段"],
  ["https://172.32.0.9/api.php/provide/vod/", true, "172.32不是私网段(边界)"],
  ["https://169.254.169.254/latest/meta-data/", false, "云元数据"],
  ["not-a-url::::", false, "非法URL"],
  ["https://metadata.google.internal/api.php/provide/vod/", false, "GCP元数据"],
  ["https://evil.internal/api.php/provide/vod/", false, "internal后缀"],
  ["https://x.local/api.php/provide/vod/", false, "local后缀"],
  ["https://0.0.0.0/api.php/provide/vod/", false, "0.0.0.0"],
  ["javascript:alert(1)", false, "js协议"],
];

let bad = 0;
for (const [u, want, why] of cases) {
  const got = isSafeCandidate(u);
  if (got !== want) { bad++; console.log(`  ❌ [${why}] ${u.slice(0, 52)} 期望=${want} 实得=${got}`); }
  else console.log(`  ✅ [${why}] ${got ? "放行" : "拦截"}`);
}
console.log(bad === 0 ? `\n门禁测试 16/16 全过` : `\n❌ ${bad} 例失败`);
process.exit(bad ? 1 : 0);
