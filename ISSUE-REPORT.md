# 给第三方看的问题清单（影视仓/TVBox 配置调试求助）

## 一、软件环境（真机）
- App：**摸鱼4K盒 v5.0.44**（包名 `moyu.tvcang.xi`，壳为 `com.github.tvbox.osc.base.App`）
- APK 内证据（我本地解包实测）：
  - `assets/js/lib/drpy2.js`(149,971B)、`drpy2.min.js`(67,332B)、`drpy.min.js`(46,102B)、`spider.js`(303B)、`cat.js`(486,451B)、`模板.js`(19,622B)
  - `lib/armeabi-v7a/libquickjs-android-wrapper.so`(825,780B)、`libpython3.8.so` + chaquopy
  - `res/layout/dialog_grid_filter.xml`、`item_grid_filter.xml`、`item_grid_filter_value.xml`、`shape_dialog_filter_bg.xml`
  - `assets/js/lib/spider.js` 全文：`import * as spider from '%s'` + `if(!globalThis.__JS_SPIDER__){ if(spider.__jsEvalReturn) globalThis.__JS_SPIDER__=spider.__jsEvalReturn(); else if(spider.default) ... }`
- **注意**：桌面上的 `摸鱼4K盒_v5.0.44_非加固版.apk`（32,171,405B）与我实际在用的是**不同包**——用户实际用的是「加360锁的版本」，那个 APK 我手上没有。

## 二、当前线上配置（可复现）
主地址：
```
https://lyk1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/index.json
```
现在只有 1 条线路（能出片的那条）：
```json
{"urls":[{"name":"打开就能看","url":".../fs4k3.json"}]}
```
`fs4k3.json` 结构：`spider` = `https://gh-proxy.com/raw.githubusercontent.com/CandyMuj/ResourceInterface/main/TVBox/candymuj.jar;md5;9f391d889e28d3c40092fabb562f408c`，`sites` 14 个全部 `type:1`（苹果CMS 直连），`filterable/searchable/quickSearch=1`。

## 三、我遇到的核心问题（这是求助重点）

### 问题1：自制 drpy2 规则站完全不生效
我做了一条 `type:3` + `api` 指向自制 `.js` 的规则站：
- `filter-line.json`：`{"spider":"", "sites":[{"key":"own_filter","type":3, "api":".../spider-filter.js", "ext":".../filter-data.json", "jar":"", "filterable":1,"searchable":1,"quickSearch":1,"changeable":0}]}`
- `spider-filter.js`：`export function __jsEvalReturn(){return {init,home,homeVod,category,detail,play,search, homeContent,homeVodContent,categoryContent,detailContent,searchContent,playerContent, __contract}}`（两套方法名都导出，均已实测等价）
- 规则 `home(true)` 本地实测返回：`{"class":[8个...],"filters":{"all":[4排...],...},"list":[20条]}`，格式与 FongMi/CatVod 的 `Result.filters` 一致
- **真机表现**：切到这条线路 → 顶部只有「主页」一个 tab，**没有任何分类 tab、没有任何筛选按钮**；海报区能出少量图（现也全空）

**已排除的猜测**：
- 数据格式正确（本地用真实线上 `filter-data.json` 跑通，`class` 8 个、`filters` 4 排、`list` 20 条）
- 两套方法名都已导出（catvod 内部名 + TVBox `*Content`）
- `req()` 只调用 1 次，URL 由 `init(cfg).ext` 注入，无 ANR 风险
- `spider:""`（零 jar），`api` 是绝对 `.js` URL，`ext` 是绝对 `.json` URL

**求判断**：这个壳（`moyu.tvcang.xi`）到底认哪种 JS spider 契约？`type:3` + `api` 指向 `.js` 时，它是走 `spider.js` 的 `__jsEvalReturn` 链，还是走 drpy2 的 `init(ext)` eval 链（`api` 必须指向引擎库、`ext` 指向 `var rule={}` 规则文件）？两套我都试了，都不出分类。是否还有第三种（例如必须 `assets://js/lib/drpy2.min.js` + `ext` 指向 `var rule` 对象）？

### 问题2：直连源在本机也不出内容（但服务器端正常）
`fs4k3.json` 的 14 个 `type:1` 直连源，我在服务器上用 `?ac=videolist&pg=1` 逐个实测：
```
建安资源 200 list=20 ✅    非凡影视 200 ✅    暴风资源 200 ✅
电影天堂 200 ✅   360资源 200 ✅   量子资源 200 ✅
金鹰 200 ✅   索尼 200 ✅            （9/14 出片，5 个超时）
```
但**真机上点进去是空的**。用户截图里唯一能出片的是「建安资源」这条（图一顶部显示「建安资源·489ms」）。

**求判断**：真机空列表但服务端能取到 20 条，最可能是哪一层的问题？
（候选：①客户端 cleartext HTTP 被拦——配置里有 `http://` 源；②`;md5;` jar 下载/校验失败导致整条线路被跳过；③该壳只认 `ac=videolist` 不认 `ac=detail`；④源站对安卓 UA/Referer 有校验；⑤`gh-proxy.com` 域名在该设备网络被墙导致 jar 取不到，进而整条线路失效）

### 问题3：筛选面板（图二那种）到底怎么才能出
用户提供的参考配置链（我实测过）：
- `https://gh-proxy.com/https://raw.githubusercontent.com/wxrjck/-YSC-/refs/heads/main/wx.json` → 是 `storeHouse` 索引
- 指向 `yx.txt` / `jh.txt` → 是多仓 `urls` 索引
- 再指向各线路：`摸鱼`(107站)、`王二小`(63站)、`王二小备用`(100站)、`短剧专线`(35站)
- 这些配置的顶层 `filters` **全部为 false**，`sites[]` 全是 `type:3` + `api:"csp_XXX"` + 大 jar

**求判断**：图二那个「类型/地区/排序/年代」面板，是靠 `csp_*` jar 里的 spider 类在运行时返回 `Result.filters` 实现的吗？如果是，**有没有办法不依赖那个大 jar、用自己写的 `.js` 规则实现同样效果**？如果有，这个壳要求的 `.js` 规则确切换约是什么（导出名、`api`/`ext` 指向、是否需要 `assets://` 前缀）？

## 四、我在本地有哪些东西（可直接接管）
项目目录：`D:\总文件夹\个人资料\文档\deepseek-harness\default-workspace\filmstore-4k\`
- `scripts/build.py`（CI 主构建，生成 index.json 与各子仓）
- `scripts/build-filter-lines.mjs`（生成自制规则站 4 件套）
- `scripts/filter-lines.json`（清单：samplePages=12、wd 种子、白名单源）
- `scripts/test-filter-contract.mjs`（18 项契约单测）
- 各类 DESIGN/RISKS 文档（都是我自己分析，仅供参考，可能含错误结论）

GitHub 仓库：`https://github.com/LYK1379030/mybox-80e9c2`（public，branch `main`）
- 可用版本已打标签：**`stable-2026-11-09`**（用户实测「能看」那一刻，可随时整仓回档）

## 五、我最需要的三句话判断
1. 这个壳（`moyu.tvcang.xi` v5.0.44）支持的 JS 规则确切格式是什么？给一份能出分类+筛选的最小示例。
2. 真机空列表、服务端有数据的根因最可能是哪个？怎么验证（一句命令/一个操作）？
3. 如果这个壳根本不吃自制 JS 规则，那么"能出筛选面板"的唯一现实路径是什么？
