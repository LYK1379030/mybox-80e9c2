# clean/index.json 修复报告（cat-builder，2026-11-11）

> 目标：让 `https://LYK1379030.github.io/mybox-80e9c2/clean/index.json` 返回 200 且为 4 条多仓，
> `/clean/yg.json` 返回 YGSpider v3 单仓，`/yg/ygfilter.jar` 返回 7,502 B。
> 基准 main HEAD：`5ded9f6ed877a54e85c13516bef43c11ac856707`（`chore: sync 2026-11-11T14:29Z`）。

---

## 1. 旧 clean/index.json 是谁写的 + Pages 404 根因（确凿证据）

### 1.1 线上/仓库实测

| 路径 | 实测 | 内容 |
|---|---|---|
| 仓库 `clean/index.json`（main） | 1,573 B | 单仓 `{"sites":[4 站]}`，含 `spider:"https://gh-proxy.com/.../4konly/moyu-spider.jar"`、`csp_Kanqiu`、`s_bfzy/s_360/s_lzi` |
| Pages `.../mybox-80e9c2/clean/index.json` | **404** | verifier FAIL-2 复现 |
| Pages `.../mybox-80e9c2/a/index.json` | **200 / 6,196 B** | 5 个 type:1 纯净直连站、无 spider |
| Pages `.../mybox-80e9c2/x/f1345f4a17efd9/index.json` | **200 / 664 B** | 4 条 `urls[]` 多仓 |

### 1.2 生成者判定

`scripts/build.py`（最新 main）里与 clean 相关的全部命中：

| 行号 | 内容 | 是否写 `clean/` |
|---|---|---|
| L333-340 | `parse_config()` 里的局部变量 `clean = []`（存放纯净 site dict） | 否，纯变量名 |
| L1049 / L1056 | `year-variants.json` 与 index 第 4 条 | 否 |
| L1180-1182 | `_emit()` pages 分支调用 `_emit_clean(site_root, templates)` | 间接 |
| L1227-1269 | `CLEAN_SITES` 定义（5 个 type:1 站） | 否 |
| **L1342-1383** | **`_emit_clean()` 定义，L1379 `d = os.path.join(site_root, "a")`，L1381 写 `a/index.json`** | **否，写 `a/`** |
| L1386+ | `_emit_4konly()` 写 `b/` | 否 |

→ **build.py 里没有任何一处写 `clean/`**。当前 `_emit_clean()` 的产物就是线上 200 的 `/a/index.json`（6,196 B / 5 站），与仓库根 `clean/index.json`（1,573 B / 4 站 / 带 3.86MB jar）**不是同一份**。后者是 CI 里另一个生成器或历史提交直接落进仓库根目录的残留，与 `_emit_clean()` 无关（lead 的判断成立）。

### 1.3 Pages 404 根因（两层，逐条对 workflow/build.py）

1. **写入层**：`build.py` L1166-1188 只在 `ch["name"] == "pages"` 时构造 `site_root = os.path.join(OUT, "_site")`，附加目录全部写进它：`_emit_clean()` → `_site/a/`，`_emit_4konly()` → `_site/b/`。**`_site/clean/` 从未被创建**。
2. **发布层**：`.github/workflows/sync.yml` L187-190 `actions/upload-pages-artifact@v3` 的 `path: _site` 是整体上传 `_site/` 目录，机制本身正确（`/a/index.json` 能 200 就是证明）。但 L137 的提交段 `git add .nojekyll .last-sync "$sub" ...` 只提交 `x/f1345f4a17efd9/` 与若干 `filmstore4k/dist/` 文件，**仓库根 `clean/` 既不在 `$sub`、也不在 `_site`** → 它只留在 git 仓库里，永远到不了 Pages。
3. `box.json` 的 `pages` 是 `https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9`；用户给的 `.../mybox-80e9c2/clean/index.json` 是**站点根**路径，对应 `_site/clean/index.json`。补写这个目录即可 200，不需要改 Pages 站点配置或 workflow 的 `path`。

**结论**：404 不是「Pages 只发布 _site 的某些子目录」（它整体发布 _site），而是「没人把 clean/ 写进 _site」+「仓库根 clean/ 没被发布」。

---

## 2. 格式选择依据（smali，两者都支持 → 选 urls[]）

| 位置 | 指令 | 结论 |
|---|---|---|
| `com/androidx/pa0.smali` **L557-597** | `JSONObject.has("urls")` → L595 `OooO0Oo(sourceUrl, name)` 展开多仓 | 支持 urls[] 多仓 |
| `com/androidx/pa0.smali` **L600-618** | `JSONObject.has("sites")` → 单仓分支 | 支持 sites[] 单仓 |
| `com/androidx/nb0.smali` **L591-668** | `json.getJSONArray("urls")` → 逐条 `getString("url")`/`getString("name")` → `MoreSourceBean.setSourceUrl/setSourceName` | 多仓逐条解析的确切实现 |
| `com/androidx/wx.smali` **L1246-1253** | `JsonObject.get("sites").getAsJsonArray()` → `SourceBean` | 单仓直读 sites 的确切实现 |
| `com/androidx/wx.smali` L4145 | 直播 `urls`（与点播多仓无关，不混淆） | — |

`x/f1345f4a17efd9/index.json` 线上是 `{"urls":[...4 条...]}` 且此前能用，与 L557 分支一致。
**按 lead 指示：两者都支持时选 `urls[]` 多仓**，与 x/ 线路结构一致。

---

## 3. 改了什么

### `scripts/build.py`（基于最新 main）

1. 新增常量 `YG_SPIDER_JAR` / `YG_SPIDER_MD5 = "313a7a0b2f324f135cc17297267fb8d7"`（jar v3 7,502 B，含 YGSpider+Init+Proxy，包名 `com.github.catvod.spider`）。
2. 新增 `_emit_clean_multi(site_root)`（**首版曾误传 `built/hd_sites` 两个 main() 局部变量，CI 日志 `name 'built' is not defined` 被 try/except 吞掉导致首轮 clean 仍未写出，已修**：函数内根本没用到它们，调用改为只传 `site_root`）：
   - 写 `_site/clean/index.json` = **4 条 urls[] 多仓**：`① 直连点开即播（主力）→ c1.json`、`② 更多直连线路（补充）→ c2.json`、`④ 直连专区·点开即播（9 条·免授权）→ 4k.json`、`✅影片筛选（原生四排）→ clean/yg.json`。前 3 条用 `PAGES_BASE` 绝对前缀（与 x/ 同源），第 4 条用站点根 `/clean/yg.json`。
   - 写 `_site/clean/yg.json` = 单仓：`spider = gh-proxy .../yg/ygfilter.jar;md5;313a7a0b...`，`sites` 恰好 1 条 `{"key":"yg_filter","name":"✅影片筛选","type":3,"api":"csp_YGSpider","searchable":1,"quickSearch":1,"filterable":1,"changeable":1}`。
   - 同时写仓库根 `clean/index.json` + `clean/yg.json`（覆盖旧的 1,573 B 单仓残留，双通道一致）。
   - 复制 `yg/ygfilter.jar` 到 `_site/yg/ygfilter.jar`（同时查 `ROOT/yg` 与 `OUT/yg` 两个来源），让 Pages 的 `/yg/ygfilter.jar` 也 200。
   - **不用 `__SELF__` 占位符**：`clean/` 不属于 `templates`，`_emit()` 的 `SELF→base` 替换覆盖不到它，直接写绝对 URL（本地实测 `has_SELF_in_clean=False`）。
3. `_emit()` pages 分支 L1181 调 `_emit_clean_multi(site_root)`，原 `_emit_clean()`（写 `a/`）保留不动，互不影响。
4. `x/` 多仓前 3 条线路**结构一字未动**；第 4 条 `按年代找片（30 个）` → `按年代找片（30 个）（实验）`（verifier FAIL-1 证实壳强制发 `t=<class[0].type_id>` 与 year 组合 5 源全空，诚实标注且不进 clean/）。
5. `year-variants.json` 本身及其生成逻辑保留不动（双轨 PASS 过）。

### `.github/workflows/sync.yml`

- L137 `git add` 补 `clean yg` 两目录，让仓库根 `clean/` 的新内容真正提交回去（不再只留在工作区）。
- `path: _site` / `BOX_PAGES` / 校验段（L93-110 按 `$sub/index.json` 的 urls 逐个查）**未改**：clean 不在 `$sub`，不参与该校验，也不干扰主 6 条。

### `filmstore-4k/CLEAN_FIX_REPORT.md`

本文件。

---

## 4. 本地验收（提交前）

```
py_compile _cur_build.py = 0
_emit_clean_multi 实跑：
  _site/clean/index.json  exists=True bytes=631   urls=4
  _site/clean/yg.json     exists=True bytes=1027  spider md5=313a7a0b...
  clean/index.json        exists=True bytes=631   （仓库根同文）
  clean/yg.json           exists=True bytes=1027
  _site/yg/ygfilter.jar   exists=True （复制分支命中）
  4 条 name/url 逐字：
    ① 直连点开即播（主力）        -> https://LYK1379030.github.io/mybox-80e9c2/x/f1345f4a17efd9/c1.json
    ② 更多直连线路（补充）        -> .../c2.json
    ④ 直连专区·点开即播（9 条·免授权） -> .../4k.json
    ✅影片筛选（原生四排）         -> https://LYK1379030.github.io/mybox-80e9c2/clean/yg.json
  yg.sites = [{"key":"yg_filter","name":"✅影片筛选","type":3,"api":"csp_YGSpider",...}]
  has_SELF_in_clean = False
```

---

## 5. 线上三连测（提交 + CI 后）

| # | URL | 期望 | 实测 |
|---|---|---|---|
| 1 | `https://LYK1379030.github.io/mybox-80e9c2/clean/index.json` | 200 / 4 条 urls[] 多仓 | 见下方最终结果 |
| 2 | `https://LYK1379030.github.io/mybox-80e9c2/clean/yg.json` | 200 / spider md5 与实际 jar 一致 | 200 / 1,567 B / md5=`d20e965738e2fe3211aa445c9c758b28` |
| 3 | `https://LYK1379030.github.io/mybox-80e9c2/yg/ygfilter.jar` | 200 / 7,502 B / md5 一致 | 200 / 7,502 B / md5=`d20e965738e2fe3211aa445c9c758b28` |

### 最终结果

**TRIPLE 1/2/3 全过**（md5 口径见下）：`/clean/index.json` 200 / 4 条 urls[] 多仓；`/clean/yg.json` 200 / sites 恰好 1 条 `csp_YGSpider`；`/yg/ygfilter.jar` 200 / 7,502 B；`/a/index.json` 仍 200（未破坏原有纯净仓）；`x/` 第 4 条 name 已带「（实验）」。

### md5 修正（lead 给的 `313a7a0b...` 与实际 jar 不符）

实测仓库 `yg/ygfilter.jar`（blob `6120b6c187`）与 Pages `/yg/ygfilter.jar` 逐字相同：7,502 B，**md5 = `d20e965738e2fe3211aa445c9c758b28`**，与任务书给的 `313a7a0b2f324f135cc17297267fb8d7` 不一致。`JarLoader.smali` L559-589 会按 `;md5;` 第二段校验本地缓存，写错值会导致反复重下/静默 `SpiderNull`。按「确保所有添加的接口都能用」铁律，`yg.json` 的 spider 已改用**实测 md5**，并在 `build.py` 的 `YG_SPIDER_MD5` 同步。若 lead 手上的 `313a7a0b...` 对应的是另一版待替换的 jar，则需先把那版 jar 推到 `yg/` 再把 md5 改回；当前仓库里只有 `d20e9657...` 这一版。

---

## 6. 风险点 / 未覆盖

1. **【推测】`spider` 走 gh-proxy 绝对地址**：`JarLoader.getSpider()` 取的其实是 `SourceBean.getJar()`（站点级 `jar` 字段，`wx.smali` L3004），顶层 `spider` 只用于 md5 修正/继承。若真机 v3 仍加载失败，需在 `yg.json` 的 site 里补 `"jar": "<同源 ygfilter.jar>;md5;..."`，或把 spider 换成同源 `https://LYK1379030.github.io/mybox-80e9c2/yg/ygfilter.jar`。本次按 lead 拍板的字面值实现，未擅自改。
2. **【推测】Pages 缓存**：GitHub Pages 约 10 分钟缓存，新目录首次可能短暂 404；三连测带重试。
3. **真机未覆盖**：YGSpider v3 的 `homeContent()` 是否真返回顶层 `filters`、`GridFilterDialog` 四排是否渲染、5 轮切线是否闪退，需 verifier 真机验收；本报告只保证配置与发布链路正确。
4. `/a/index.json`（原纯净仓）继续保留，不影响新 `/clean/`。
5. `year-variants` 已加「（实验）」后缀，但 x/ 多仓里仍可见；用户若只填 clean 地址则完全看不到它。
