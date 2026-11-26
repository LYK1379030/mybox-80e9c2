# 高清转换器 · 接口规范（供第三方审查）

## 1. 接口基址

```
https://<你的worker名>.<你的账号>.workers.dev
```
示例（临时账号，已失效，仅作格式参考）：
```
https://hdsearch.impossible-harpymimus.workers.dev
```

## 2. 接口清单

### 2.1 分类列表
```
GET /?ac=list
```
响应（苹果CMS标准）：
```json
{
  "code": 1,
  "msg": "ok",
  "class": [
    {"type_id": "1", "type_name": "电影"},
    {"type_id": "2", "type_name": "电视剧"}
  ],
  "list": []
}
```
用途：影视仓首页分类筛选栏。

### 2.2 关键词搜索
```
GET /?ac=detail&wd=<URL编码的片名>&pg=<页码>
```
示例：
```
GET /?ac=detail&wd=%E6%B5%81%E6%B5%AA%E5%9C%B0%E7%90%83&pg=1
```
响应：
```json
{
  "code": 1,
  "msg": "ok",
  "page": 1,
  "pagecount": 5,
  "limit": 20,
  "total": 3,
  "list": [
    {
      "vod_id": "/jilupian/25020.html",
      "vod_name": "流浪地球2：再次冒险",
      "vod_pic": "https://tu.66tutup.com:667/2024/1207.jpg",
      "vod_remarks": "高清",
      "type_id": "20",
      "vod_year": "",
      "vod_area": "",
      "vod_content": ""
    }
  ]
}
```

### 2.3 详情/播放地址
```
GET /?ac=detail&ids=<vod_id>
```
示例：
```
GET /?ac=detail&ids=%2Fjilupian%2F25020.html
```
响应：
```json
{
  "code": 1,
  "list": [{
    "vod_id": "/jilupian/25020.html",
    "vod_name": "流浪地球2：再次冒险",
    "vod_pic": "...",
    "vod_play_from": "1线$$$2线$$$3线",
    "vod_play_url": "1线$magnet:?xt=urn:btih:...#2线$https://pan.quark.cn/s/...#3线$..."
  }]
}
```

## 3. 播放地址类型与已知问题

| 类型 | 格式 | TVBox能否直接播 | 证据状态 |
|---|---|---|---|
| 磁力 | `magnet:?xt=urn:btih:...` | **存疑** | 实施者先说"不能播"，用户说"平铺点开能看"，矛盾未解决 |
| 夸克网盘 | `https://pan.quark.cn/s/...` | 需插件/跳转 | 未验证 |
| 阿里云盘 | `https://www.alipan.com/s/...` | 需插件/跳转 | 未验证 |
| m3u8 | `https://.../index.m3u8` | 能 | 标准，但新6V详情页未提取到 |

**重点**：用户实测"平铺点开高清片能看"，但转换器提取的链接格式与客户端原生插件播放流程的关系**未验证**。这是方案最大不确定点（见总览 R2）。

## 4. 成人过滤规则

黑名单正则（对片名、分类、播放URL生效）：
```
伦理|三级|理论|福利|写真|两性|擦边|情色|成人|无码|里番|艳|肉|偷拍|自拍|调教|私房|裸|性爱|乱伦|强奸|丝袜|制服|SM|口交|群交|人兽|萝莉|御宅|同人
```
- 优点：覆盖常见成人词
- 缺点：可能漏判（无敏感词的成人内容）、可能误伤（正常片名含"肉"字等）
- 待第三方评估：是否需要改为"白名单分类"为主、黑名单为辅

## 5. 影视仓站点配置格式

```json
{
  "key": "hdsearch",
  "name": "高清搜索",
  "type": 1,
  "api": "https://<worker地址>",
  "searchable": 1,
  "quickSearch": 1,
  "changeable": 0
}
```
`type:1` = 苹果CMS JSON 接口，是用户客户端实测唯一稳定支持的类型。

## 6. 未实现的接口能力（诚实列出）

- 搜索分页：`pagecount:5` 硬编码，未解析真实页数
- 分类筛选参数：`ac=detail&t=<分类ID>` 未实现（用户要求首页筛选，目前只返回分类表，点分类后的数据拉取未验证）
- Cookie/验证码：未处理
- 缓存：未启用（每次请求实时抓目标站，慢且依赖目标站在线）

## 7. 待第三方确认

1. `ac=detail&t=<type_id>` 分类筛选是否必须实现？还是 `ac=list` 返回分类表就够首页筛选？
2. 播放地址格式与 TVBox 兼容性如何提前验证？
3. 是否需要增加缓存层（Workers KV）减轻目标站压力？
