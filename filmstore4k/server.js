/**
 * 本机 Node 运行入口（不依赖 wrangler）。
 *
 *   node server.js            # 默认 http://127.0.0.1:8787
 *   PORT=3000 node server.js
 *
 * 用的是 Web 标准 Request/Response，Node 18+ 原生支持，
 * 所以 src/index.js 里的路由代码在 Workers 和本地是同一份。
 */
import { createServer } from "node:http";
import app, { getSources } from "./src/index.js";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

const server = createServer(async (req, res) => {
  const t0 = Date.now();
  try {
    const url = `http://${req.headers.host || `${HOST}:${PORT}`}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, v);
    }

    const request = new Request(url, { method: req.method, headers });

    const response = await app.fetch(request, process.env, {});
    const body = Buffer.from(await response.arrayBuffer());

    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(body);

    const ms = Date.now() - t0;
    if (!url.includes("/health")) {
      console.log(`${String(response.status).padEnd(4)} ${String(ms).padStart(5)}ms  ${req.method} ${req.url}`);
    }
  } catch (e) {
    console.error("500", req.url, e);
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
});

server.listen(PORT, HOST, () => {
  const n = getSources(process.env).length;
  console.log(`
┌──────────────────────────────────────────────────────────┐
│  影视仓 4K · 本地服务已启动                                │
├──────────────────────────────────────────────────────────┤
│  首页      http://${HOST}:${PORT}/
│  TVBox 配置 http://${HOST}:${PORT}/config.json
│  聚合接口   http://${HOST}:${PORT}/cms/all/api.php/provide/vod/
│  4K 接口    http://${HOST}:${PORT}/cms/4k/api.php/provide/vod/
│  源体检     http://${HOST}:${PORT}/api/sources/check
├──────────────────────────────────────────────────────────┤
│  已加载 ${String(n).padEnd(2)} 个源                                        │
└──────────────────────────────────────────────────────────┘
`);
});
