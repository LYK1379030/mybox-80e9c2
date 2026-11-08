export const LANDING_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>影视仓 4K · 自建聚合接口</title>
<style>
:root{
  --bg:#0b0d12; --panel:#141822; --panel2:#1b2130; --line:#252c3d;
  --fg:#e8ecf5; --dim:#8b95ab; --acc:#4d8dff; --acc2:#ff6b4d; --ok:#3ddc84; --warn:#ffb020;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--fg);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
a{color:inherit;text-decoration:none}
.wrap{max-width:1180px;margin:0 auto;padding:18px 16px 80px}
header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 0 18px}
.logo{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,var(--acc),var(--acc2));
  display:grid;place-items:center;font-size:19px;box-shadow:0 6px 20px rgba(77,141,255,.35)}
h1{font-size:19px;margin:0;font-weight:700;letter-spacing:.3px}
.sub{color:var(--dim);font-size:12.5px;margin-top:1px}
.spacer{flex:1}
.bar{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:16px}
input[type=search]{flex:1;min-width:200px;background:var(--panel);border:1px solid var(--line);
  color:var(--fg);border-radius:11px;padding:11px 14px;font-size:14px;outline:none}
input[type=search]:focus{border-color:var(--acc)}
button{cursor:pointer;border:1px solid var(--line);background:var(--panel2);color:var(--fg);
  border-radius:11px;padding:10px 16px;font-size:14px;transition:.15s}
button:hover{border-color:var(--acc);color:#fff}
button.primary{background:linear-gradient(135deg,var(--acc),#3a6fe0);border:none;font-weight:600}
button.ghost{background:transparent}
.tabs{display:flex;gap:8px;overflow-x:auto;padding-bottom:10px;margin-bottom:14px;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{flex:0 0 auto;padding:8px 14px;border-radius:999px;background:var(--panel);
  border:1px solid var(--line);font-size:13.5px;color:var(--dim);white-space:nowrap;cursor:pointer}
.tab.on{background:linear-gradient(135deg,var(--acc),#3a6fe0);color:#fff;border-color:transparent;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:13px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:13px;overflow:hidden;
  cursor:pointer;transition:.16s;position:relative}
.card:hover{transform:translateY(-3px);border-color:var(--acc);box-shadow:0 10px 26px rgba(0,0,0,.5)}
.pic{aspect-ratio:2/3;background:var(--panel2) center/cover no-repeat;position:relative}
.badge{position:absolute;top:7px;left:7px;background:linear-gradient(135deg,var(--acc2),#ff3d6e);
  color:#fff;font-size:11px;font-weight:800;padding:2px 7px;border-radius:6px;letter-spacing:.5px}
.badge.src{left:auto;right:7px;background:rgba(10,12,18,.82);backdrop-filter:blur(6px);
  border:1px solid rgba(255,255,255,.12);font-weight:500;color:#c7d0e0}
.meta{padding:8px 9px 10px}
.name{font-size:13px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;
  -webkit-box-orient:vertical;overflow:hidden;height:2.7em}
.rem{font-size:11.5px;color:var(--dim);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tip{color:var(--dim);font-size:13px;padding:26px 0;text-align:center}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:16px}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kv div{font-size:12.5px;color:var(--dim)}
.kv b{display:block;color:var(--fg);font-size:17px;margin-top:3px;font-weight:700}
code{background:var(--panel2);padding:2px 6px;border-radius:5px;font-size:12.5px;color:#9fc0ff;
  font-family:ui-monospace,Consolas,monospace;word-break:break-all}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.copy{font-size:12px;padding:6px 11px;border-radius:8px}
.hr{height:1px;background:var(--line);margin:14px 0}
.srclist{display:flex;flex-wrap:wrap;gap:7px}
.pill{font-size:12px;padding:4px 10px;border-radius:999px;background:var(--panel2);border:1px solid var(--line);color:var(--dim)}
.pill.ok{color:var(--ok);border-color:rgba(61,220,132,.35)}
.pill.bad{color:var(--acc2);border-color:rgba(255,107,77,.35)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">🎬</div>
    <div>
      <h1>影视仓 · 4K 聚合接口</h1>
      <div class="sub">macCMS 兼容 · 多源聚合 · 4K 识别 · Cloudflare Workers 免费部署</div>
    </div>
    <div class="spacer"></div>
    <button class="ghost" id="checkBtn">体检全部源</button>
  </header>

  <div class="panel">
    <div class="kv" id="stats">
      <div>状态<b id="st">检测中…</b></div>
      <div>聚合源<b id="sc">-</b></div>
      <div>TVBox 配置<b><code>/config.json</code></b></div>
      <div>接口地址<b><code id="apiUrl">/cms/all/api.php/provide/vod/</code></b></div>
    </div>
    <div class="hr"></div>
    <div class="row">
      <span style="font-size:12.5px;color:var(--dim)">TVBox / 影视仓 订阅地址：</span>
      <code id="cfgUrl"></code>
      <button class="copy" data-copy="cfg">复制</button>
      <button class="copy" data-copy="lite">复制精简版</button>
    </div>
    <div class="hr"></div>
    <div class="srclist" id="srclist"><span class="pill">加载中…</span></div>
  </div>

  <div class="bar">
    <input type="search" id="q" placeholder="搜片名，例如：沙丘 / 奥本海默 / 繁花">
    <button class="primary" id="searchBtn">搜索</button>
  </div>

  <div class="tabs" id="tabs"></div>
  <div class="grid" id="grid"></div>
  <div class="tip" id="tip">加载中…</div>
  <div class="row" style="justify-content:center;margin-top:22px">
    <button id="moreBtn" style="display:none">加载更多</button>
  </div>
</div>

<script>
const ORIGIN = location.origin;
let state = { tab: "4k", pg: 1, kw: "", loading: false, done: false };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

const TABS = [
  { id: "4k", name: "🔥 4K专区" },
  { id: "4k-movie", name: "🎬 4K电影" },
  { id: "4k-tv", name: "📺 4K剧集" },
  { id: "4k-anime", name: "🌸 4K动漫" },
  { id: "4k-doc", name: "🌍 4K纪录片" },
  { id: "new", name: "🆕 最新更新" },
];

function renderTabs() {
  $("#tabs").innerHTML = TABS.map(
    (t) => '<div class="tab' + (t.id === state.tab ? " on" : "") + '" data-id="' + t.id + '">' + esc(t.name) + "</div>"
  ).join("");
  document.querySelectorAll(".tab").forEach((el) =>
    el.addEventListener("click", () => {
      if (state.tab === el.dataset.id && !state.kw) return;
      state.tab = el.dataset.id; state.pg = 1; state.kw = ""; state.done = false;
      $("#q").value = ""; $("#grid").innerHTML = "";
      renderTabs(); load();
    })
  );
}

function card(it) {
  // URL 净化：只放行 http(s)，并强制编码 CSS/HTML 危险字符。
  // 注意 encodeURIComponent 本身不编码 ' ( ) ! * —— 必须手写映射（实测踩过的坑）。
  let pic = String(it.vod_pic || it.vod_pic_slide || "");
  if (!/^https?:\/\//i.test(pic)) pic = "";
  else {
    pic = pic
      .replace(/[\r\n]/g, "")
      .replace(/['"()\\<>\s]/g, (c) =>
        ({ "'": "%27", '"': "%22", "(": "%28", ")": "%29", "\\": "%5C", "<": "%3C", ">": "%3E", " ": "%20" }[c])
      );
  }
  const is4k = it.vod_is4k === 1;
  const tags = (it.vod_4k_tags || "").split(",").filter(Boolean).slice(0, 1).join("");
  const badge = is4k ? '<div class="badge">' + esc(tags || "4K") + "</div>" : "";
  const src = it.source_name ? '<div class="badge src">' + esc(it.source_name) + "</div>" : "";
  const bg = pic ? 'style="background-image:url(&quot;' + esc(pic) + '&quot;)"' : "";
  return '<div class="card" data-k="' + esc(it.source_key) + '" data-i="' + esc(it.vod_id) + '">' +
    '<div class="pic" ' + bg + ">" + badge + src + "</div>" +
    '<div class="meta"><div class="name">' + esc(it.vod_name) + "</div>" +
    '<div class="rem">' + esc(it.vod_remarks || it.vod_year || "") + "</div></div></div>";
}

async function load() {
  if (state.loading || state.done) return;
  state.loading = true;
  $("#tip").style.display = "block";
  $("#tip").textContent = "加载中…";
  try {
    let url;
    if (state.kw) {
      url = ORIGIN + "/api/search?wd=" + encodeURIComponent(state.kw) + "&limit=60";
    } else if (state.tab === "new") {
      url = ORIGIN + "/api/list?pg=" + state.pg + "&limit=60";
    } else {
      url = ORIGIN + "/api/4k?cat=" + encodeURIComponent(state.tab) + "&pg=" + state.pg + "&limit=60&scan=3";
    }
    const r = await fetch(url).then((x) => x.json());
    const list = r.list || [];
    if (!list.length) {
      state.done = true;
      $("#tip").textContent = "没有更多了";
      if (state.pg === 1) $("#grid").innerHTML = "";
    } else {
      $("#grid").insertAdjacentHTML("beforeend", list.map(card).join(""));
      $("#tip").style.display = list.length < 60 ? "block" : "none";
      if (list.length < 60) { state.done = true; $("#tip").textContent = "已经到底了"; }
      else $("#tip").style.display = "none";
    }
    $("#moreBtn").style.display = state.done ? "none" : "inline-block";
  } catch (e) {
    $("#tip").textContent = "加载失败：" + e.message;
  } finally {
    state.loading = false;
  }
}

function openItem(k, i) {
  const u = ORIGIN + "/api/detail?source=" + encodeURIComponent(k) + "&id=" + encodeURIComponent(i);
  location.href = "/player?u=" + encodeURIComponent(u);
}

async function boot() {
  renderTabs();
  $("#cfgUrl").textContent = ORIGIN + "/config.json";
  $("#apiUrl").textContent = "/cms/all/api.php/provide/vod/";
  try {
    const h = await fetch("/health").then((r) => r.json());
    $("#st").textContent = "正常运行";
    $("#sc").textContent = h.sources;
  } catch { $("#st").textContent = "异常"; }
  try {
    const s = await fetch("/api/sources").then((r) => r.json());
    $("#srclist").innerHTML = s.sources
      .map((x) => '<span class="pill" data-k="' + esc(x.key) + '">' + esc(x.name) + "</span>")
      .join("");
  } catch {}

  $("#checkBtn").onclick = async () => {
    $("#checkBtn").textContent = "体检中…";
    try {
      const r = await fetch("/api/sources/check").then((x) => x.json());
      const map = new Map(r.results.map((x) => [x.key, x]));
      document.querySelectorAll("#srclist .pill").forEach((el) => {
        const d = map.get(el.dataset.k);
        el.className = "pill " + (d?.ok ? "ok" : "bad");
        el.title = d?.ok ? (d.ms + "ms · 共 " + d.total + " 条 · 例：" + (d.sample || "-")) : ("失败：" + (d?.error || "?"));
      });
      $("#checkBtn").textContent = "存活 " + r.alive + " / " + r.total;
    } catch { $("#checkBtn").textContent = "体检失败"; }
  };

  document.querySelectorAll(".copy").forEach((b) =>
    b.addEventListener("click", () => {
      const t = b.dataset.copy === "lite" ? ORIGIN + "/config.json?mode=lite" : ORIGIN + "/config.json";
      navigator.clipboard?.writeText(t);
      const old = b.textContent; b.textContent = "已复制"; setTimeout(() => (b.textContent = old), 1200);
    })
  );

  $("#searchBtn").onclick = () => {
    const kw = $("#q").value.trim();
    if (!kw) { state.kw = ""; state.pg = 1; state.done = false; $("#grid").innerHTML = ""; load(); return; }
    state.kw = kw; state.pg = 1; state.done = false; $("#grid").innerHTML = ""; load();
  };
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#searchBtn").click(); });

  $("#moreBtn").onclick = () => { state.pg++; if (!state.kw) { state.done = false; load(); } };

  $("#grid").addEventListener("click", (e) => {
    const c = e.target.closest(".card");
    if (c) openItem(c.dataset.k, c.dataset.i);
  });

  window.addEventListener("scroll", () => {
    if (state.loading || state.done || state.kw) return;
    if (window.innerHeight + window.scrollY > document.body.offsetHeight - 500) {
      state.pg++; load();
    }
  }, { passive: true });

  load();
}
boot();
</script>
</body>
</html>`;

export const PLAYER_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>播放 · 影视仓 4K</title>
<style>
:root{--bg:#0b0d12;--panel:#141822;--panel2:#1b2130;--line:#252c3d;--fg:#e8ecf5;
  --dim:#8b95ab;--acc:#4d8dff;--acc2:#ff6b4d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:14px 14px 60px}
.top{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.back{width:34px;height:34px;border-radius:10px;background:var(--panel2);border:1px solid var(--line);
  display:grid;place-items:center;cursor:pointer;font-size:16px}
h1{font-size:17px;margin:0;font-weight:700}
.sub{color:var(--dim);font-size:12px}
video{width:100%;aspect-ratio:16/9;background:#000;border-radius:13px;border:1px solid var(--line)}
.info{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:14px;margin-top:14px}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:9px;font-size:12.5px;color:var(--dim)}
.kv b{display:block;color:var(--fg);font-size:14px;margin-top:2px;font-weight:600}
.line{display:flex;gap:8px;overflow-x:auto;margin:12px 0 6px;padding-bottom:6px;scrollbar-width:none}
.line::-webkit-scrollbar{display:none}
.ln{flex:0 0 auto;padding:7px 14px;border-radius:999px;background:var(--panel2);border:1px solid var(--line);
  font-size:13px;color:var(--dim);cursor:pointer;white-space:nowrap}
.ln.on{background:linear-gradient(135deg,var(--acc),#3a6fe0);color:#fff;border-color:transparent;font-weight:600}
.eps{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:7px;max-height:340px;overflow:auto}
.ep{padding:8px 6px;text-align:center;border-radius:9px;background:var(--panel2);border:1px solid var(--line);
  font-size:12.5px;color:var(--dim);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ep:hover{border-color:var(--acc);color:#fff}
.ep.on{background:linear-gradient(135deg,var(--acc),#3a6fe0);color:#fff;border-color:transparent;font-weight:600}
.err{color:var(--acc2);font-size:13px;padding:20px;text-align:center}
.desc{color:var(--dim);font-size:13px;margin-top:10px;max-height:120px;overflow:auto}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="back" onclick="history.back()">←</div>
    <div><h1 id="title">加载中…</h1><div class="sub" id="subtitle"></div></div>
  </div>
  <video id="v" controls playsinline preload="metadata"></video>
  <div class="info">
    <div class="kv" id="kv"></div>
    <div class="line" id="lines"></div>
    <div class="eps" id="eps"></div>
    <div class="desc" id="desc"></div>
  </div>
</div>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const params = new URLSearchParams(location.search);
const apiUrl = params.get("u");
let data = null, li = 0, ei = 0;

function play(src) {
  const v = $("#v");
  v.src = src;
  v.load();
  v.play().catch(() => {});
}

function renderLines() {
  const srcs = data.vod_play_sources || [];
  if (!srcs.length) {
    $("#eps").innerHTML = '<div class="err">该条目没有可用播放线路（部分源列表态不返回播放地址，可换源试试）</div>';
    return;
  }
  $("#lines").innerHTML = srcs.map((s, i) =>
    '<div class="ln' + (i === li ? " on" : "") + '" data-i="' + i + '">' + esc(s.from) + " (" + s.count + ")</div>").join("");
  document.querySelectorAll(".ln").forEach((el) =>
    el.onclick = () => { li = +el.dataset.i; ei = 0; renderLines(); }
  );
  const cur = srcs[li];
  $("#eps").innerHTML = cur.episodes.map((e, i) =>
    '<div class="ep' + (i === ei ? " on" : "") + '" data-i="' + i + '" title="' + esc(e.url) + '">' + esc(e.name) + "</div>").join("");
  document.querySelectorAll(".ep").forEach((el) =>
    el.onclick = () => {
      ei = +el.dataset.i;
      document.querySelectorAll(".ep").forEach((x) => x.classList.remove("on"));
      el.classList.add("on");
      play(cur.episodes[ei].url);
    }
  );
  if (cur.episodes[0]) play(cur.episodes[0].url);
}

function renderMeta() {
  const it = (data.list && data.list[0]) || data;
  $("#title").textContent = it.vod_name || "未知";
  $("#subtitle").textContent = [it.source_name, it.vod_year, it.vod_area, it.vod_remarks].filter(Boolean).join(" · ");
  $("#kv").innerHTML = [
    ["类型", it.type_name], ["导演", it.vod_director], ["主演", it.vod_actor],
    ["年份", it.vod_year], ["地区", it.vod_area], ["4K", it.vod_is4k ? (it.vod_4k_tags || "是") : "—"],
  ].map(([k, v]) => "<div>" + k + "<b>" + esc(v || "—") + "</b></div>").join("");
  $("#desc").textContent = (it.vod_content || "").replace(/<[^>]+>/g, "");
}

async function boot() {
  if (!apiUrl) { $("#title").textContent = "缺少参数"; return; }
  try {
    data = await fetch(apiUrl).then((r) => r.json());
    const item = (data.list && data.list[0]) || data;
    // 列表态没播放地址时，回源拿详情
    if (!(item.vod_play_sources || []).length && item.source_key && item.vod_id) {
      try {
        const d = await fetch("/api/detail?source=" + encodeURIComponent(item.source_key) + "&id=" + encodeURIComponent(item.vod_id)).then((r) => r.json());
        if (d.list && d.list[0]) { d.list[0].source_name = d.source_name || item.source_name; data = d; }
      } catch {}
    }
    renderMeta();
    renderLines();
  } catch (e) {
    $("#title").textContent = "加载失败";
    $("#eps").innerHTML = '<div class="err">' + esc(e.message) + "</div>";
  }
}
boot();
</script>
</body>
</html>`;
