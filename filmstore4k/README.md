# 影视仓 4K · 自建聚合接口

把十几个苹果CMS采集站聚合成**一个** TVBox / 影视仓能用的接口，自带画质识别、熔断、缓存。
部署到 Cloudflare Workers（免费）或直接本机跑。

---

## 先说一句实话：4K 这件事

我实测了 **11 个存活源、扫了 1500+ 条数据**，结论是：

> **这些采集站里没有真正的 4K 片源。**

证据（`npm run find4k` 可复现）：

| 源 | 扫描条数 | remarks 实际分布 | 4K 标记 |
|---|---|---|---|
| 暴风资源 | 160 | 更新至正片(29) / 更新至20261107(11) / 更新至第5集(9) | **无** |
| 量子资源 | 160 | 已完结(127) / 更新至20261108期(9) | **无** |
| 非凡影视 | 160 | 更新至第06集(17) / HD中字(10) | **无** |
| 电影天堂 | 160 | 更新至20261107期(17) / 已完结(11) | **无** |
| 建安资源 | 160 | 更新至2026-11-08期期(8) / 全剧集(7) | **无** |
| 极速资源 | 120 | 第6集(9) / 正片(4) | **无** |
| 360资源 | 160 | 更新至06集(12) / 全50集(4) | **无** |
| 金鹰资源 | 100 | 第6集(9) / 第5集(4) | **无** |

搜 "4K" 命中的全是片名误匹配：`四天王`、`我的24k氪金神眼`、`2024 KBS演技大赏`。

**原因很直白**：4K 单集 2–8GB，采集站靠贴片广告变现，带宽成本根本撑不住。
真正的 4K 只存在于网盘（阿里云盘/115/夸克）和 PT 站，那些走的是 **alist / 网盘挂载**，
不是 `api.php/provide/vod` 这种苹果CMS 接口——两套东西不通。

### 那这个项目怎么处理 4K

不造假。做法是**画质分级**，让"要清晰"这个真实需求能落地：

| 等级 | 判定 | 分数 |
|---|---|---|
| `4k` | 2160P / UHD / 蓝光原盘 / 3840x2160 | 70–100 |
| `1080p` | 1080P | 50–69 |
| `hd` | HD / 高清 / HD中字 | 25–49 |
| `sd` | 720P / 480P / 标清 | 1–24 |
| `unknown` | 无任何标记（占绝大多数） | 0 |

带**片名误匹配黑名单**（`四天王` / `24k` / `第4集` 等不会被误判成 4K）。

接口里 `🔥4K专区` 会如实返回 0 条——因为确实没有。`✨高清优先` 才有真实内容。

**真要 4K，得走另一条路**（见文末「关于真 4K」）。

---

## 快速开始

### 本机跑（30 秒）

```bash
cd filmstore-4k
npm run smoke      # 先验链路
npm start          # 起服务 → http://127.0.0.1:8787
```

打开 `http://127.0.0.1:8787` 就是带搜索和播放器的网页。

### 部署到 Cloudflare Workers（免费，推荐）

```bash
npm install
npx wrangler login
npx wrangler deploy
```

拿到 `https://filmstore-4k.<你的子域>.workers.dev`，收工。

**可选**：加 KV 缓存（跨边缘节点，回源更少）

```bash
npx wrangler kv:namespace create FILMSTORE
# 把返回的 id 填进 wrangler.toml 的 [[kv_namespaces]]
npx wrangler deploy
```

### 推到 GitHub

```bash
git init
git add .
git commit -m "feat: 影视仓 4K 聚合接口"
git remote add origin git@github.com:<你>/filmstore-4k.git
git push -u origin main
```

> `.gitignore` 已排除 `harvest/`、`*.log`、`sources-health.json` 等本地产物。

---

## 接口一览

### 给 TVBox / 影视仓用

| 地址 | 说明 |
|---|---|
| `/config.json` | **TVBox 配置**（聚合站 + 11 个直连源） |
| `/config.json?mode=lite` | 精简版，只留聚合站 |
| `/cms/all/api.php/provide/vod/` | 聚合接口（macCMS 兼容） |
| `/cms/4k/api.php/provide/vod/` | 只走画质筛选的接口 |

影视仓/ TVBox 里「配置地址」填 `https://你的域名/config.json` 即可。

### 自己调 / 做前端用

| 地址 | 说明 |
|---|---|
| `GET /api/list?pg=1&limit=20` | 聚合列表，多源合并按时间倒序 |
| `GET /api/4k?cat=hd&pg=1` | 画质筛选（`hd`/`4k`/`4k-movie`/`4k-tv`/`4k-anime`） |
| `GET /api/search?wd=沙丘` | 跨源搜索，按名称匹配度排序 |
| `GET /api/detail?source=bfzy&id=1` | 详情 + 播放线路 + 分集地址 |
| `GET /api/types` | 全源分类合并 |
| `GET /api/sources` | 源清单 |
| `GET /api/sources/check` | **源体检**，返回存活/耗时/总量/样本 |
| `GET /api/breaker` | 熔断状态（`?reset=all` 重置） |
| `GET /health` | 健康检查 |

### macCMS 兼容层

聚合接口完整实现苹果CMS v10 协议，任何支持 `type=3` 的播放器都能接：

```
?ac=list                          分类
?ac=videolist&pg=1&t=<type>&wd=<kw>&h=24
?ids=<id>
```

聚合源的 `type_id` 格式是 `源key-原始id`（如 `bfzy-1`），避免多源 ID 冲突。

---

## 工程上解决的真问题

### 1. 慢源拖死整个请求

11 个源里总有 3–4 个响应 5–10 秒。做法：

- **整体 deadline 6 秒**：到点就用手上已有的返回，不等慢源
- **单源硬超时 5 秒**
- **并发 10 路**

效果：冷启动 6 秒出 140+ 条，热缓存 **1 秒**。

### 2. 死源反复拖后腿

`src/breaker.js` 熔断器：连续失败 2 次 → 冷却 10 分钟 → 半开放一个请求试探。
`/api/breaker` 看状态，`?reset=all` 手动重置。

### 3. 源会死

`npm run check` 实测所有源，自动写出 `sources-health.json`：

```bash
npm run check           # 体检
npm run check --prune   # 顺带打印该剔除的 key
```

**实测结果：18 → 11 个存活**。死掉的包括黑木耳（返回 HTML）、天空/无尽/最大/魔都（超时）、如意/快车（连不上）。

### 4. 4K 误判

`四天王`、`24k氪金神眼`、`2024 KBS演技大赏` 全都含 "4K" 字样但不 4K。
黑名单 + 必须命中 `2160P`/`UHD`/`3840x2160` 才算硬证据。

---

## 脚本

```bash
npm run check      # 源体检 → sources-health.json
npm run find4k     # 4K 实证探测
npm run smoke      # 核心链路冒烟测试
npm run gen        # 改完 sources.json 后重新生成
npm run collect    # 从社区仓库广度采集 api
npm run rank       # 批量实测并按 4K 密度排序
```

改源流程：

```bash
vim sources.json      # 加/删源
npm run gen           # 生成 sources.gen.js
npm run check         # 验证真的能用
npm start             # 本地看效果
```

---

## 项目结构

```
filmstore-4k/
├── src/
│   ├── index.js          # 路由（Workers + Node 共用）
│   ├── adapter.js        # 苹果CMS 适配器（含播放地址解析）
│   ├── aggregator.js     # 聚合 + deadline + 熔断
│   ├── t4k.js            # 画质识别（4K/1080P/HD）+ 误判黑名单
│   ├── breaker.js        # 熔断器
│   ├── cache.js          # 两级缓存（内存 + KV）
│   ├── tvbox.js          # TVBox 配置生成
│   └── pages.js          # 内置网页 + 播放器
├── scripts/
│   ├── gen-sources.js    # json → js 模块
│   ├── check-sources.js  # 源体检
│   ├── find-4k.js        # 4K 实证
│   ├── collect-apis.js   # 社区仓库采集
│   ├── rank-apis.js      # 批量实测排序
│   └── smoke.js          # 冒烟测试
├── sources.json          # 源清单（人工维护）
├── wrangler.toml         # Workers 配置
└── server.js             # Node 本地入口
```

---

## 关于真 4K

如果 4K 是硬需求，苹果CMS 这条路走不通，得换：

| 方案 | 说明 | 代价 |
|---|---|---|
| **Alist + 网盘** | 阿里云盘/115/夸克挂载，真正的 4K 原盘都在网盘 | 需要网盘会员、自己的 Alist 服务 |
| **PT 站** | 原盘资源最全 | 需要邀请、保种、NAS |
| **Emby / Jellyfin** | 自建媒体库，配 4K 片源 | 需要硬件和片源 |
| **TVBox 网盘源** | 部分配置走 `wpys`/`ali` 网盘线路 | 不稳定，需要 token |

这些都不是 `api.php/provide/vod` 形态，接不进同一个 TVBox 配置——需要单独的 Alist/Emby 源。

**这个项目能给你的是**：一个稳定的、多源冗余的、带画质分级的**在线播放接口**，
覆盖 96 万+ 条资源（HD/1080P），部署 5 分钟，零成本。

---

## 免责

本项目只是接口聚合工具，不存储、不托管任何音视频内容。
所有内容来自第三方公开采集接口，播放地址由源站提供。
仅供个人学习与技术研究使用。

## License

MIT
