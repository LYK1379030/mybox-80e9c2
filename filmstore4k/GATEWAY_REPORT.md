# 筛选增强网关设计 + 路线 B 落地报告（cat-builder，2026-11-11）

> 任务：**零 jar、零 smali patch、纯配置**让壳的原生 GridFilterDialog 四排筛选出现并真实过滤。
> 结论先行：**本机无公网运行时，选路线 B（GitHub Actions 定时预生成静态变体）**。
> 路线 B 下四排面板**不会出现**，只有「按年代切好的站点列表」伪筛选——这是壳的机制决定的硬局限，如实写在 §5。
> 路线 A 的完整可运行代码已一并交付 `gateway/server.mjs`，一旦有公网运行时即可切到真四排。

---

## 0. 决定性证据（本机 smali + GitHub 上游源码 + 本机 HTTP 实测）

### 0.1 壳怎么读 filters（本机 `mb/decompile/apk_full/smali/com/androidx/ng0.smali`）

| 位置 | 指令/行为 | 结论 |
|---|---|---|
| L2157-2205 `OooOO0o(String)` | `JsonParser.parseString` → `Gson.fromJson(..., AbsSortJson)` → `toAbsSortXml()` | 先解析 `ac=list` 响应的 `class/list` |
| L2213-2320 | `p1.has("filters")` → `getAsJsonObject("filters")` → `keySet()` 遍历，每个 key 下可以是**单个 object 或 array** → 逐个 `OooOO0(JsonObject)` → `LinkedHashMap<type_id, ArrayList<SortFilter>>` | **filters 来自 `ac=list` 响应顶层**，不是配置、不是 spider、不是 jar |
| L2326-2374 | 遍历 `AbsSortXml.classes.sortList`，`v2.containsKey(sortData.id)` → `iput-object v3, v0, SortData->filters` | 按 `type_id` 把四排挂到每个分类的 `SortData` |
| L1884-1988 `OooOO0(JsonObject)` | 读 `key` / `name` / `value:[{n,v}]` → `MovieSort$SortFilter` | 结构必须是 `{"key":"year","name":"年代","value":[{"n":"2024","v":"2024"}]}` |
| L1612-1617 | `params(p2, SortData.filterSelect)` 把 Map 每个 key 独立拼成 query | 点「2024」→ 请求自动带 `?year=2024` |
| L1651-1653 | 额外 `params("f", JSONObject(filterSelect).toString())` | `f={json}` 是冗余；lead 实测源站忽略它，不影响 `year=` 生效 |
| `k40.smali` L249-287 / `de0.smali` L116-166 | `SortData.filters.isEmpty()` 为假才 new `GridFilterDialog` | filters 非空 = 面板出现 |

`MovieSort$SortData.smali` L95-107：构造函数里 `filters = new ArrayList<>()`，`filterSelect = new HashMap<>()`；**默认空数组就是「顶部只有主页一个 tab、没有筛选按钮」的根因**。

### 0.2 GitHub 上游交叉佐证

- [takagen99/Box `AbsSortJson.java`](https://raw.githubusercontent.com/takagen99/Box/master/app/src/main/java/com/github/tvbox/osc/bean/AbsSortJson.java)：`toAbsSortXml()` 只映射 `class → SortData{id=type_id,name=type_name,flag=type_flag}`，**不解析 filters**；filters 的注入在 `SourceViewModel.sortJson()` 里另做，与本机 smali `OooOO0o` 完全一致。
- [takagen99/Box `SourceViewModel.java`](https://raw.githubusercontent.com/takagen99/Box/master/app/src/main/java/com/github/tvbox/osc/viewmodel/SourceViewModel.java)：`sortJson()` 的 `has("filters")` 分支与 `getList()` 的 `params(filterSelect)` / `params("f", ...)`，逐行对应本机 `ng0.smali` L2157-2388 / L1612-1653。

### 0.3 本机 HTTP 实测（2026-11-11，5 源并发）

`ac=list` 五源顶层键均为 `["class","code","limit","list","msg","page","pagecount","total"]`，**`hasFiltersTop=false`** → 直接连源站永远没有四排面板。子分类 id 实测：

| 源 | 电影 | 动作 | 喜剧 | 爱情 | 科幻 | 恐怖 | 剧情 | 战争 | 纪录 |
|---|---|---|---|---|---|---|---|---|---|
| 360 | 1 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | — |
| bfzy | 20 | 21 | 22 | 25 | 24 | 23 | 26 | 27 | 28 |
| lzi / ffzy / dytt | 1 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | — |

→ **t 值必须按源动态映射，写死必错**（`t=6` 在 bfzy 返回 `total=0`，动作片是 21）。

过滤参数实测（`ac=videolist&pg=1`）：

| 参数 | 360 | bfzy | 判定 |
|---|---|---|---|
| `year=2024` | total 74870→4015，列表 `vod_year` 全 2024 | 171460→13125，全 2024 | ✅ 真过滤，五源通用 |
| `t=6` | total 3867，动作片 | total 0 | ⚠️ 仅 360 系生效，需动态映射 |
| `by=time` / `by=hits` | 与裸 pg=1 首片完全相同 | 同 | ❌ 源站忽略，只能网关本地排序 |
| `area=大陆` | total 不变 | 171460→51905 | ⚠️ 仅部分源生效，只能网关本地过滤 |
| `year=2024&t=6` | total 156 | total 0 | ✅ 组合参数源站接受 |

---

## 1. 三条路线可行性判定

### 路线 A：自托管筛选增强网关（**可行，本机缺公网运行时，代码已交付未启用**）

- 壳把 `sites[].api` 当裸 URL，任意 https 可填；把 api 指向网关，网关在 `ac=list` 响应里补顶层 `filters`（按 6 个 `type_id` 各挂四排），`GridFilterDialog` 立即出现。
- 点选后 `year/t/area/by` 独立拼进 query：网关把 `year/t` 透传源站（真过滤），`area/by` 本地兜底（避开源站支持不一致），`f={json}` 不转发。
- 实现：`filmstore-4k/gateway/server.mjs`（单文件，Node 标准库，无依赖，3 端点 + 600s 缓存 + 磁盘 stale 兜底 + 启动时 `ac=list` 动态建 t 映射）。
- 判定：**可行 / 需公网运行时**。本机检查 `cloudflared / frp / frpc / ngrok / gh` 全 ABSENT，无 `VPS|TUNNEL|SSH|TOKEN` 环境变量，无 VPS/穿透配置文件 → 无部署条件。

### 路线 B：GitHub Actions 预生成静态变体（**已落地并提交**）

- 做法：在 `scripts/build.py` 的 `_emit_clean()` 同层新增 `build_year_variants()`，构建期对 5 源 × 6 年代逐个真发 `?ac=videolist&pg=1&year=YYYY`，**只有返回结果里至少一条 `vod_year` 命中才算通过**，否则剔除（宁缺不假）。通过的变体写成 `year-variants.json` 里的 type:1 站，`api` 直接带 `year=YYYY`。
- 判定：**可行，但只是伪筛选**。壳只从 `ac=list` 响应顶层读 filters，Pages 纯静态文件无法按 query 改写响应，配置里写 `sites[].filters` 无效（`AbsSortJson.java` 不解析它）→ **GridFilterDialog 四排面板不会出现**。用户看到的是「按年代找片（N 个）」这条线路里多出 N 个已按年份切好的站点。
- 本机实跑：30/30 变体通过（5 源 × 6 年代，notes=0），`allType1=true`、`noCsp=true`、`keysUnique=true`、`_inspect_output total_problems=0`。

### 路线 C：YGSpider jar 为什么加载失败（**已定位，已弃用**）

本机 `com/github/catvod/crawler/JarLoader.smali`：

| 位置 | 要求 |
|---|---|
| L128-144 `loadClassLoader` | `new DexClassLoader(jarPath, cacheDir/catvod_csp, null, parent)` → **jar 内必须是 `classes.dex`，普通 JVM `.class` jar 加载不到** |
| L154-185 | 尝试 `loadClass("com.github.catvod.spider.Init")` 并反射调 `init(Context)`；失败重试 5 次每次 sleep 200ms |
| L191-214 | 尝试 `loadClass("com.github.catvod.spider.Proxy")` 取 `proxy(Map)` |
| L657-680 `getSpider` | `loadClass("com.github.catvod.spider." + api.replace("csp_",""))`，`newInstance()` 后强转 `com.github.catvod.crawler.Spider` |
| L646-653 / L698-709 | 任一环节失败 → 返回 `SpiderNull`（静默空页，就是用户看到的「加载失败/白屏」） |
| L559-589 | `spider` 字段按 `;md5;` 拆两段，第二段做本地文件 md5 校验；**只认一个 URL，不是多 jar 分号列表** |
| `com/androidx/wx.smali` L2989-3008 `getCSP` | 传给 JarLoader 的 jar URL 来自 `SourceBean.getJar()`（站点级 `jar` 字段），api 以 `.js` 结尾走 JsLoader、`py_` 开头走 PythonLoader，其余走 JarLoader |

→ 6KB jar 被拒的确切原因（按可能性排序，均会让 `getSpider` 落到 `SpiderNull`）：
1. **【已证实机制】jar 里是 `.class` 而非 `classes.dex`**：`DexClassLoader` 只认 dex；普通 `javac` + `jar cf` 产物必然 `loadClass` 抛 `ClassNotFoundException`，L240-259 还会把缓存 jar 删掉，表现为反复「加载失败」。
2. **【已证实机制】缺 `com.github.catvod.spider.Init` / `Proxy`**：L154/L191 是硬性探测，缺任意一个都会拖满 5×200ms 后失败。
3. **【已证实机制】类未继承/实现 `com.github.catvod.crawler.Spider`**：L680 `check-cast` 会抛 `ClassCastException` → L705 `SpiderNull`。
4. **【推测】`spider` 写成 `https://gh-proxy.com/.../yg/ygfilter.jar` 而站点级 `jar` 为空**：`getCSP` 取的是 `SourceBean.getJar()`，顶层 `spider` 只用于 md5 修正/继承，包名迁移到 `com.github.catvod.spider.YGSpider` 本身方向对，但上面 1-3 任一不满足都白搭。
5. **【推测】`api:"csp_YGSpider"` 与 `;md5;` 校验值不匹配**：L559-589 校验不过会重新下载，若 gh-proxy 返回 HTML 页则 `DexClassLoader` 直接失败。

→ **结论：路线 C 不可行且违反「零 jar」铁律**。已从 `CLEAN_SITES` 删除 `csp_Kanqiu`，纯净仓现在 6 个站全是 type:1、顶层无 `spider`。

---

## 2. 交付物

| 文件 | 路线 | 内容 |
|---|---|---|
| `filmstore-4k/gateway/filters.json` | A+B | 6 大类 × 四排完整词表；`key=t/area/by/year`，`v` 用源站参数名/值；`dynamicTypeMap` 记录 5 源实测子分类 id；`staticVariants` 记录 B 的 6 年代 × 2 排序口径 |
| `filmstore-4k/gateway/server.mjs` | A | 单文件 Node 网关，E1 注入 filters+class / E2 真过滤+本地 area/by / E3 详情透传；`Cache-Control: public, max-age=600`；源站全挂用 `.cache/` stale 兜底；启动时按 `ac=list.class` 动态建 t 映射 |
| `scripts/build.py`（main） | B | `GATEWAY_VARIANT_YEARS` / `GATEWAY_VARIANT_BASES` / `_variant_probe()` / `build_year_variants()`；`entries` 追加 `按年代找片（N 个）→ year-variants.json`；`_emit_clean` 去掉 csp 插件线；`report["gateway"]` 记录路线与剔除原因 |
| `filmstore-4k/GATEWAY_REPORT.md` | — | 本文件 |

**`_wf.yml` 零改动**：产物文件名 `year-variants.json` 落在 `$sub/` 目录内，`sync.yml` 的 `git add "$sub"` 与 purge 段的 `filter-*.json / fs4k*.json` 通配虽不精确覆盖它，但 `git add` 已整目录提交；jsDelivr 对新增文件名无历史缓存，双通道内容一致。（若后续要主动 purge，加一行 `year-variants.json` 即可，非必需。）

---

## 3. 启用步骤

### 路线 B（当前生效，零操作）

1. CI 每日 `python scripts/build.py` 自动跑 `build_year_variants()`，真实探测 30 个 `year=` 组合。
2. 产出 `<sub>/year-variants.json` 与 `<sub>/index.json` 里的第 5 条 `按年代找片（30 个）`。
3. 用户在「线路」里切到 `按年代找片`，会看到 `360·2024年` / `暴风·2023年` … 每个站点进去就是该年份的片单。
4. 某源某年探测失败 → 该变体不生成，index 里的数字动态变小，绝不留空壳。

### 路线 A（有公网运行时后切真四排）

```bash
# 1) 有 VPS：直接跑；无 VPS 但有 cloudflared：加一条 tunnel
cd filmstore-4k/gateway
PORT=8787 node server.mjs
# cloudflared tunnel --url http://127.0.0.1:8787   → 得到 https://xxx.trycloudflare.com
# frp：frpc 把 8787 映射到 VPS:8787；chisel：chisel server --reverse / client R:8787:127.0.0.1:8787

# 2) 把 sub 配置里的直连站 api 换成网关（每源一个 src 参数，t 动态映射）
"api": "https://xxx.trycloudflare.com/api.php/provide/vod?src=360"
"api": "https://xxx.trycloudflare.com/api.php/provide/vod?src=bfzy"

# 3) 验证（应看到顶层 filters 且 6 个 type_id 各 4 排）
curl -s "https://xxx.trycloudflare.com/api.php/provide/vod?ac=list&src=360" | jq '.filters | keys, .["1"] | map(.key)'
curl -s "https://xxx.trycloudflare.com/api.php/provide/vod?ac=videolist&pg=1&year=2024&src=360" | jq '.list[0].vod_year'
```

网关默认 `UPSTREAMS` 是 5 个实测直连源，可用 `UPSTREAMS='[{"key":"x","name":"X","api":"https://..."}]'` 覆盖；`CACHE_MS` 默认 600000；源站全挂自动读 `.cache/` 上次结果。

---

## 4. 最小实现步骤清单（已按此执行）

1. 拉 main 最新 `scripts/build.py`（HEAD `91bffc2f6c15469999fd4143bc07fd4476dfaf83`，`chore: sync 2026-11-11T13:47Z`）——**已确认上轮 clean_ygfilter/spider 改动确被覆盖回退，当前是无 spider 的 6 站版**。
2. 本机检查公网运行时 → 全部缺失 → 选 B，同时保留 A 代码。
3. 实测 5 源 `ac=list` / `year` / `t` / `by` / `area` → 写进 `filters.json` 的 `_evidence` / `_paramSemantics`。
4. 写 `filters.json`（6 大类四排 + 动态 t 映射 + 12 份静态变体口径）。
5. 写 `server.mjs`（路线 A 完整实现，`node --check` 通过）。
6. 改 `scripts/build.py`：加变体生成 + 构建期健康探测 + index 第 5 条；删 `csp_Kanqiu`；保留 `_stale/_filter_notes` 等原有定义（本版 main 已无这些字段，未误删任何东西）。
7. 本地验：`py_compile=0`、`node --check=0`、30/30 变体、`_inspect_output total_problems=0`、emit 后无 `__SELF__` 残留、无 BOM。
8. GitHub `git/trees` API 提交到 main → 触发 CI → curl 验线上产物。

---

## 5. 局限（如实写，不粉饰）

1. **路线 B 没有四排面板**。壳只从 `ac=list` 响应顶层读 `filters`；Pages 是纯静态托管，收到 `?year=2024` 也不会改写文件内容，配置里写 `sites[].filters` 被 `AbsSortJson.toAbsSortXml()` 直接丢弃。用户得到的是「30 个按年份切好的站点」，不是 `类型/地区/排序/年代` 四排 GridFilterDialog。
2. **`by` 变体是假排序**。实测 `by=time/hits` 在 360 与 bfzy 都被忽略（首片与裸 pg=1 完全一致），所以 `filters.json.staticVariants` 里虽列了 time/hits 两份口径，路线 B 生成时**没有**为它们各生成一份站点（那会是两份内容相同的复制品）。真排序只有路线 A 的 `localFilter()` 能做。
3. **`area` 不能静态变体化**。360 忽略、bfzy 生效，写死 `area=` 会在一半源上退化成全库；路线 A 统一本地按 `vod_area` 过滤。
4. **`t` 不能静态写死**。360 动作=6、bfzy 动作=21，同一份 `t=6` 在 bfzy 返回 `total=0`；`server.mjs` 启动时按每个源 `ac=list.class` 动态映射，`filters.json.dynamicTypeMap` 只作实测存档。
5. **30 个变体 = 30 次构建期 HTTP**（5 源 × 6 年，8s 超时，串行约 2-5s 视网络；本机实跑一次全绿）。CI `continue-on-error` 未加，任一失败只剔除该变体不 FATAL；`build_year_variants()` 内部 try/except 兜住。
6. **双通道**：`year-variants.json` 是新文件名，jsDelivr 无历史缓存；但 `_site/` 与仓库 `$sub/` 由同一 `templates` 写出，内容逐字一致。
7. **【推测】壳缓存**：用户客户端可能缓存旧 `index.json` 最多 24h，新增第 5 条线路不会立刻出现；`f={json}` 冗余参数即使被源站忽略也不影响 `year=` 生效。
8. **真机未覆盖**：四排面板在路线 A 下是否 100% 渲染、点选后 `filterSelect` 的 key 是否严格等于 `year/t/area/by`、5 轮切线是否闪退，均需真机；本报告全部结论来自 smali + 上游源码 + HTTP 实测。

---

## 6. 风险点

| # | 风险 | 触发条件 | 影响 | 规避 |
|---|---|---|---|---|
| R1 | `_inspect_output` 报「重复站点 key」 | 变体 key 冲突 | `total_problems>0` → `sys.exit(2)` 整份拒交付 | key 用 `v_<源>_<年>`，实测 `keysUnique=true`；门禁实跑 0 问题 |
| R2 | `year-variants.json` 被判 `sites 为空` | 30 个探测全失败 | 同上 | `if _variant_sites:` 才注册 templates、才追加 index 条目；空则整条线路消失 |
| R3 | api 带 `?year=` 被客户端拼接冲掉 | 壳在 api 后自己补 `?ac=videolist&pg=1` | 变体退化成全库 | lead 已实测「api 带参数会被客户端保留拼接」；且 `_variant_probe` 用的就是同一拼法 |
| R4 | 源站返回超 2MB 被 `fetch_bytes(limit)` 截断 | 个别源 pg=1 返回巨大字段 | JSON 解析失败 → 误剔变体 | 已把 `limit` 从 400_000 提到 2_000_000；复验 30/30 通过、notes=0 |
| R5 | 顶层 `spider` 残留 | `_emit_clean` 曾带 csp 线 | 与零 jar 铁律冲突 | 已删 `csp_Kanqiu`，`CLEAN_SITES` 全 type:1、`noCsp=true` |
| R6 | 路线 A 网关单点 | 有公网后把所有 api 指向它 | 网关挂 = 全站空 | `.cache/` stale 兜底 + `Cache-Control 600s`；站点可同时保留原直连站 |
| R7 | GitHub token 泄漏 | 报告/日志里回显 | 仓库被写 | 提交脚本只在内存用 token，未写入任何交付文件 |

---

## 7. 线上验证（提交后补）

见 `send_message` 给 lead 的最终回报：CI run 状态 + `curl` 线上 `index.json` / `year-variants.json` 的真实输出。
