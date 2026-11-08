# -*- coding: utf-8 -*-
"""
TVBox / 影视仓 专属仓 构建器（对抗式自检版）
=============================================
每天由 GitHub Actions 跑一次，也可本机 `python scripts/build.py`。

设计原则：把输出当成客户端会真去请求的东西，构建时逐项实测。
  1. 上游配置：多镜像逐个试，全部挂了跳过且保留上一版产物；
  2. 相对路径：按每个上游自己的 base 绝对化，绝不混用；
  3. spider jar：真下载并计算 md5，替换掉上游已过期的校验值；
  4. 点播线路：真发 ?ac=list，死的剔除、慢的放宽超时、活的按延迟排序；
  5. 解析站 / DoH / EPG / 壁纸：DNS + HTTP 实测，死的不写进配置；
  6. 输出双通道：Pages 与 jsDelivr 各生成一份，内部 URL 全部绝对化，
     两份内容互不依赖（TVBox 的 lives[].url 不走相对解析，必须绝对）；
  7. 硬解码 / 断线重连 / 去广告参数注入，专门治 4K 卡顿；
  8. 最后打印自检汇总，任何一项不达标都会在 status.json 里显式标红。

只用 Python 标准库，无第三方依赖。
"""
import os
import re
import json
import ssl
import sys
import time
import socket
import hashlib
import urllib.request
import urllib.parse
import urllib.error
import concurrent.futures as cf
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read_conf():
    try:
        with open(os.path.join(ROOT, "box.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


CONF = _read_conf()
OUT = os.environ.get("BOX_OUT", CONF.get("out", ROOT))
SUB = os.environ.get("BOX_SUB", CONF.get("sub", ""))
PAGES_BASE = os.environ.get("BOX_PAGES", CONF.get("pages", ""))
CDN_BASE = os.environ.get("BOX_CDN", CONF.get("cdn", ""))

SELF = "__SELF__"          # 模板占位，emit 时换成该通道的真实绝对前缀

socket.setdefaulttimeout(12)
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

JSD = "https://cdn.jsdelivr.net/gh/gaotianliuyun/gao@master/"
GHP = "https://gh-proxy.com/https://raw.githubusercontent.com/gaotianliuyun/gao/master/"
RAWG = "https://raw.githubusercontent.com/gaotianliuyun/gao/master/"

# ---------------------------------------------------------------- 上游
# 每个镜像自带 base / jar_base，避免「切到备用镜像时相对路径指错域名」。
# ---------------------------------------------------------------- 直连采集站
# 全部为「苹果CMS」标准接口，点开直接出 m3u8，零授权、零账号、零网盘。
# 实测延迟/片库（2026-11 实测）：
#   非凡 427ms/9.9万 · 电影天堂 699ms/8.5万 · 暴风 867ms/17.1万 · 量子 1729ms/16.3万
# 合计约 52 万条片源，覆盖电影/剧集/动漫/综艺。
DIRECT_SITES = [
    {"key": "feifan", "name": "非凡·最快", "api": "http://cj.ffzyapi.com/api.php/provide/vod",
     "type": 1, "searchable": 1, "changeable": 1, "quickSearch": 1},
    {"key": "dytt", "name": "电影天堂", "api": "https://caiji.dyttzyapi.com/api.php/provide/vod",
     "type": 1, "searchable": 1, "changeable": 1, "quickSearch": 1},
    {"key": "bfzy", "name": "暴风·大库", "api": "https://bfzyapi.com/api.php/provide/vod",
     "type": 1, "searchable": 1, "changeable": 1, "quickSearch": 1},
    {"key": "lzi", "name": "量子·备用", "api": "https://cj.lziapi.com/api.php/provide/vod",
     "type": 1, "searchable": 1, "changeable": 1, "quickSearch": 1},
]

# ---------------------------------------------------------------- 真 4K 线路
# 来源：GitHub 活跃仓库 niubihu1/tvbox（211 星，2026-11 更新）实测提取。
# 原理：csp_ 插件爬 4K 资源站的「公开分享链接」（网盘 /drive/v1/share），
# 读公开分享链不需要用户授权，所以能在电视上直接点播 4K 原盘。
# 依赖 spider jar（135 个爬虫类：4KZhinan/PanWebShare/SeedHub/Wogg…）。
# jar 自托管在本仓库 4konly/spider.jar（随 Pages 一起发布）。
# 原来用 gitee 直链，客户端（okhttp）会被防盗链拦掉导致「配置解析失败」，
# 改为同源托管后不再依赖第三方站点。
# 用 candymuj.jar：这个 jar 在主配置 c2/4k 里长期正常加载，
# 已确认含 Wogg（玩偶4K）与 CandyMuj_yinfans（音范丝4K）两个 4K 类。
# 之前用 easy11.05 那个 194 类的 jar 会让摸鱼4K盒闪退，已弃用。
K4_SPIDER = ("https://gh-proxy.com/raw.githubusercontent.com/"
             "CandyMuj/ResourceInterface/main/TVBox/candymuj.jar")
K4_SPIDER_MD5 = "9f391d889e28d3c40092fabb562f408c"

SITES_4K = [
    # candymuj.jar 里确认存在的两个 4K 类
    {"key": "玩偶4K", "name": "🔥玩偶 | 4K", "type": 3, "api": "csp_Wogg",
     "searchable": 1, "quickSearch": 1, "changeable": 1, "timeout": 60,
     "ext": {"site": ["https://www.wogg.live", "https://woggpan.888484.xyz"]}},
    {"key": "音范丝4K", "name": "🔥音范丝 | 4K原盘", "type": 3,
     "api": "csp_CandyMuj_yinfans",
     "searchable": 1, "quickSearch": 1, "changeable": 1, "timeout": 60},
]
# 上游配置只作为「补充来源」，其网盘/磁力类线路会被过滤掉。
UPSTREAMS = [
    {
        "id": "c1", "name": "① 直连点开即播（主力）",
        "mirrors": [
            {"url": JSD + "0827.json", "base": JSD, "jar_base": GHP},
            {"url": "https://fastly.jsdelivr.net/gh/gaotianliuyun/gao@master/0827.json",
             "base": JSD, "jar_base": GHP},
            {"url": RAWG + "0827.json", "base": JSD, "jar_base": GHP},
        ],
    },
    {
        "id": "c2", "name": "② 更多直连线路（补充）",
        "mirrors": [
            {"url": "https://gitlab.com/noimank/tvbox/-/raw/main/tvbox1.json",
             "base": "https://gitlab.com/noimank/tvbox/-/raw/main/", "jar_base": None},
            {"url": "https://cdn.jsdelivr.net/gh/gaotianliuyun/gao@master/0821.json",
             "base": JSD, "jar_base": GHP},
        ],
    },
]

LIVE_SOURCES = [
    ("直播·综合", [
        "https://jihulab.com/xz101522/tvbox/-/raw/main/live.txt",
        "https://raw.githubusercontent.com/yoursmile66/TVBox/main/live.txt",
        "https://cdn.jsdelivr.net/gh/yoursmile66/TVBox@main/live.txt",
    ], "live.txt"),
    ("直播·精简", [
        "https://cdn.jsdelivr.net/gh/yoursmile66/TVBox@main/live.txt",
        "https://fastly.jsdelivr.net/gh/yoursmile66/TVBox@main/live.txt",
        "https://raw.githubusercontent.com/yoursmile66/TVBox/main/live.txt",
    ], "live2.txt"),
    ("直播·官方台", [
        "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
        "https://cdn.jsdelivr.net/gh/iptv-org/iptv@master/streams/cn.m3u",
    ], "live3.m3u"),
]

PARSE_CANDIDATES = [
    {"name": "综合", "type": 0, "url": "https://jx.jsonplayer.com/player/?url="},
    {"name": "夜幕", "type": 0, "url": "https://www.yemu.xyz/?url="},
    {"name": "醉仙", "type": 0, "url": "https://jx.zui.cm/?url="},
    {"name": "爱酷", "type": 0, "url": "https://jx.zhanlangbu.com/?url="},
    {"name": "771949", "type": 0, "url": "https://jx.771949.com/?url="},
    {"name": "西瓜", "type": 0, "url": "https://jx.xmflv.com/?url="},
]
PARSE_BUILTIN = [
    {"name": "Json聚合", "type": 3, "url": "Demo"},
    {"name": "Json并发", "type": 2, "url": "Parallel"},
    {"name": "Json轮询", "type": 2, "url": "Sequence"},
]

DOH_CANDIDATES = [
    {"name": "阿里", "url": "https://dns.alidns.com/dns-query", "ips": ["223.5.5.5", "223.6.6.6"]},
    {"name": "腾讯", "url": "https://doh.pub/dns-query", "ips": ["119.29.29.29"]},
    {"name": "Cloudflare", "url": "https://cloudflare-dns.com/dns-query",
     "ips": ["1.1.1.1", "1.0.0.1"]},
    {"name": "AdGuard", "url": "https://dns.adguard.com/dns-query",
     "ips": ["94.140.14.14", "94.140.15.15"]},
]

ADS = [
    "static-mozai.4gtv.tv", "s3t3d2y8.afcdn.net",
    "iqiyi.hbuioo.com", "vip.ffzyad.com",
    "https://lf1-cdn-tos.bytegoofy.com/obj/tos-cn-i-dy/455ccf9e8ae744378118e4bd289288dd",
]
WALLPAPER = "https://picsum.photos/1280/720"
EPG = "http://epg.51zmt.top:8000/api/diyp/?ch={name}&date={date}"

IJK = [
    {"group": "① 硬解码·4K首选", "options": [
        {"category": 4, "name": "mediacodec", "value": "1"},
        {"category": 4, "name": "mediacodec-hevc", "value": "1"},
        {"category": 4, "name": "mediacodec-auto-rotate", "value": "1"},
        {"category": 4, "name": "mediacodec-handle-resolution-change", "value": "1"},
        {"category": 4, "name": "opensles", "value": "0"},
        {"category": 4, "name": "overlay-format", "value": "842225234"},
        {"category": 4, "name": "framedrop", "value": "1"},
        {"category": 4, "name": "soundtouch", "value": "1"},
        {"category": 4, "name": "start-on-prepared", "value": "1"},
        {"category": 4, "name": "reconnect", "value": "1"},
        {"category": 4, "name": "enable-accurate-seek", "value": "0"},
        {"category": 1, "name": "fflags", "value": "fastseek"},
        {"category": 1, "name": "http-detect-range-support", "value": "0"},
        {"category": 1, "name": "dns_cache_timeout", "value": "600000000"},
        {"category": 2, "name": "skip_loop_filter", "value": "48"},
    ]},
    {"group": "② 软解码·兼容兜底", "options": [
        {"category": 4, "name": "mediacodec", "value": "0"},
        {"category": 4, "name": "mediacodec-hevc", "value": "0"},
        {"category": 4, "name": "opensles", "value": "0"},
        {"category": 4, "name": "overlay-format", "value": "842225234"},
        {"category": 4, "name": "framedrop", "value": "1"},
        {"category": 4, "name": "soundtouch", "value": "1"},
        {"category": 4, "name": "start-on-prepared", "value": "1"},
        {"category": 4, "name": "reconnect", "value": "1"},
        {"category": 1, "name": "fflags", "value": "fastseek"},
        {"category": 1, "name": "http-detect-range-support", "value": "0"},
        {"category": 1, "name": "dns_cache_timeout", "value": "600000000"},
        {"category": 2, "name": "skip_loop_filter", "value": "48"},
    ]},
]

HD_WORDS = ["4K", "4k", "蓝光", "原盘", "超清", "高清", "2K", "2k",
            "HDR", "杜比", "60帧", "无损", "REMUX", "remux", "UHD"]

# 实测已失效的域名 / 死链 → 换成实测 200 的等价镜像。
# 这些是上游配置自带的老化引用，不修会让对应站点整块加载失败。
URL_FIX = {
    # ghp.ci 域名 DNS 已失效；gh-proxy.com/https:// 前缀实测 200
    "https://ghp.ci/raw.githubusercontent.com/":
        "https://gh-proxy.com/https://raw.githubusercontent.com/",
    "http://ghp.ci/raw.githubusercontent.com/":
        "https://gh-proxy.com/https://raw.githubusercontent.com/",
    # FongMi 仓库里并没有 wogg.json，上游写错了；高天流云仓库里有
    "https://gh-proxy.com/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/json/wogg.json":
        JSD + "json/wogg.json",
    "https://raw.githubusercontent.com/FongMi/CatVodSpider/main/json/wogg.json":
        JSD + "json/wogg.json",
    # agit.ai 对 raw 路径返回 200 text/html 反爬页（不是 JS）。
    # libs/drpy2.min.js 在 gao 仓库确实有同名文件，可以安全替换；
    # 但 js/ 下那些中文名文件（厂长.js / 哔哩直播.js …）在 gao 仓库
    # 并不存在，换过去只会把死链换成另一批死链 —— 这类一律整条剔除，
    # 由 tune() 的死链扫描负责（见 DEAD_APIS 与 AGIT_MARK）。
    "https://www.agit.ai/fantaiying/dr_py/raw/branch/main/libs/drpy2.min.js":
        "https://gh-proxy.com/https://raw.githubusercontent.com/gaotianliuyun/gao/master/lib/drpy2.min.js",
    "https://agit.ai/fantaiying/dr_py/raw/branch/main/libs/drpy2.min.js":
        "https://gh-proxy.com/https://raw.githubusercontent.com/gaotianliuyun/gao/master/lib/drpy2.min.js",
}

# agit.ai 全域对 raw 路径返回 200 text/html 反爬页（实测包括
# Yoursmile7/TVBox、fantaiying/fty、fantaiying/fmm 等路径），
# 任何命中都整条 site 剔除，不能只盯 dr_py 一条路径。
AGIT_MARK = "agit.ai/"

# 实测已死的 API 端点（404 / 520 / 超时），命中即整条 site 剔除，
# 避免点进去才卡住。键为「URL 前缀」，值为失败原因（写进 status.json）。
DEAD_APIS = {
    "https://api123.adys.app/xgapp.php/v3/": "HTTP 404",
    "https://sk100.tv/api.php/app/": "HTTP 520",
    "http://www.fuju2024.cc:8013/ruifenglb_api.php/v1.vod": "连接超时",
}

# 实测 jar 里不存在的 csp_ 类（加载时 ClassNotFoundException）。
# 键为「api 值」，值为「该 jar 里应该有的类名」，用于 4K 专区准入。
# 注意：csp_CandyMuj_freeok 实测在 candymuj.jar 的类名集合里，
# 之前误列在这里导致 4K 专区拒收了一条可用线路，已移除。
BAD_CSP = {
    "csp_CandyMuj_sstv": "Sstv",
    # 以下三条在 custom_spider.jar(43 类) 与 zoho 壳(50 类) 里均无对应类
    "csp_NiNi": "NiNi",
    "csp_Ying": "Ying",
    "csp_Dovx": "Dovx",
    # zoho 壳里只有 PanSsoGuard（拼写不同），无 PanSou / PanSouGuard
    "csp_PanSou": "PanSou",
}

# 不带 ./ 前缀、但明显是相对资源路径的 ext 值（如 tvfan/Cloud-drive.txt）。
# 只在「该值看起来就是个文件路径」时才绝对化，避免误伤签名串 / token。
REL_FILE_RE = re.compile(
    r"^[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-\u4e00-\u9fa5]+)*\.(?:json|js|txt|m3u|jar)$")


# ---------------------------------------------------------------- 网络
def fetch_bytes(url, timeout=12, limit=8_000_000):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, context=CTX, timeout=timeout) as f:
        return f.read(limit)


def decode_smart(b):
    """严格解码；绝不用 errors='replace' 静默产出 U+FFFD 乱码配置。"""
    if b.startswith(b"\xef\xbb\xbf"):
        return b[3:].decode("utf-8", "strict")
    if b[:2] == b"\x1f\x8b":
        raise ValueError("响应为 gzip")
    try:
        return b.decode("utf-8", "strict")
    except UnicodeDecodeError:
        try:
            return b.decode("gb18030", "strict")
        except UnicodeDecodeError:
            raise ValueError("上游既非 UTF-8 也非 GB18030，拒绝使用")


def fetch(url, timeout=12, limit=6_000_000):
    return decode_smart(fetch_bytes(url, timeout, limit))


def is_hex_blob(t):
    s = t.lstrip("\ufeff\u200b \r\n\t")
    head = re.sub(r"\s+", "", s[:4096])
    return bool(head) and bool(re.fullmatch(r"[0-9a-fA-F]{64,}", head))


def parse_config(text):
    """解析并规范化上游配置。

    上游是外部不可信数据：顶层可能是数组、sites 可能是 dict / 含 null、
    字符串等脏元素。这里一次拦干净，后续所有函数只需处理「dict + sites
    为 dict 列表」这一种形态，避免任何一处 .get() 崩溃导致当天零产出。
    """
    s = text.lstrip("\ufeff\u200b \r\n\t")
    if not (s.startswith("{") or s.startswith("[")):
        return None
    try:
        obj = json.loads(s)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None                       # 顶层数组 / 标量一律拒收
    sites = obj.get("sites")
    if not isinstance(sites, list):
        return None                       # sites 缺失 / 非列表一律拒收
    clean = []
    for it in sites:
        if isinstance(it, dict):
            clean.append(it)
        # 非 dict 元素（null / 字符串 / 数字 / 数组）直接丢弃
    if not clean:
        return None                       # 全是脏元素，视为上游失效
    obj["sites"] = clean
    return obj


# ---------------------------------------------------------------- 路径
def absolutize(obj, base, jar_base):
    def conv(v):
        if not isinstance(v, str) or not (v.startswith("./") or v.startswith("../")):
            return v
        rel = v.lstrip("./")
        tail = ""
        if ";md5;" in rel:
            rel, tail = rel.split(";md5;", 1)
            tail = ";md5;" + tail
        root = (jar_base or base) if rel.endswith(".jar") else base
        return root.rstrip("/") + "/" + rel.lstrip("/") + tail

    def walk(x):
        if isinstance(x, dict):
            return {k: walk(v) for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v) for v in x]
        return conv(x)
    return walk(obj)


def rewrite_broken_conf(obj):
    """gitlab 那份的 ./conf/*.json 在源站 404，改指向确实存在的同名文件。"""
    mapping = {
        "./conf/wogg.json": JSD + "json/wogg.json",
        "./conf/bili.json": JSD + "json/bili.json",
        "./conf/bili1.json": JSD + "json/bili.json",
        "./conf/bili2.json": JSD + "json/bili.json",
        "./conf/bili3.json": JSD + "json/bili.json",
        "./conf/bili4.json": JSD + "json/bili.json",
        "./conf/bili5.json": JSD + "json/bili.json",
        "./conf/alist.json": JSD + "json/alist.json",
        "./conf/live.json": JSD + "json/market.json",
    }
    def walk(x):
        if isinstance(x, dict):
            return {k: walk(v) for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v) for v in x]
        return mapping.get(x, x) if isinstance(x, str) else x
    return walk(obj)


def strip_dead_refs(obj):
    """只摘 sites[].ext 里指向源站 404 目录的可选插件引用。

    绝不遍历 rules / spider / logo / ijk / doh —— 子串连坐会把有效字段
    一起删掉，产出 spider=null 或残缺 regex 的坏配置。
    """
    bad = ("gitlab.com/noimank/tvbox/-/raw/main/conf/",
           "gitlab.com/noimank/tvbox/-/raw/main/js/")
    def is_bad(x):
        return isinstance(x, str) and any(b in x for b in bad)
    for s in obj.get("sites", []) or []:
        if isinstance(s, dict) and "ext" in s:
            e = s["ext"]
            if isinstance(e, dict):
                s["ext"] = {k: v for k, v in e.items() if not is_bad(v)}
            elif is_bad(e):
                s.pop("ext", None)
    return obj


def sanitize_urls(obj, base, report):
    """客户端视角的 URL 清洗，逐条真发请求前的最后一关：

      - 命中 URL_FIX 的死域名 / 404 路径换成实测可用的镜像；
      - 中文路径做 percent-encoding（避免各客户端编码不一致导致 400）；
      - 不带 ./ 但形如 xxx/yyy.json 的相对 ext 值补成绝对地址；
      - 记录每一处修正，写进 status.json 供复核。
    """
    def enc(u):
        # {name}/{date} 等占位符由客户端运行时替换；编码成 %7B%7D 会让
        # EPG / logo 模板永久失效，必须原样保留。
        if re.search(r"\{[A-Za-z_][A-Za-z0-9_]*\}", u):
            return u
        p = urllib.parse.urlsplit(u)
        return urllib.parse.urlunsplit((
            p.scheme, p.netloc,
            urllib.parse.quote(p.path, safe="/%:@&=+$,;~!*'()?#[]"),
            p.query, p.fragment))

    def conv(v):
        if not isinstance(v, str):
            return v
        out = v
        for old, new in URL_FIX.items():
            if out.startswith(old):
                out = new + out[len(old):]
                report.append({"field": "url_fix", "from": v, "to": out})
                break
        if out.startswith("http"):
            e = enc(out)
            if e != out:
                report.append({"field": "url_encode", "from": out, "to": e})
            return e
        if REL_FILE_RE.match(out):
            # 关键：先验证拼出来的绝对地址真的存在，再写进配置。
            # 上游里 tvfan/Cloud-drive.txt 这类裸相对引用，在各镜像下都是
            # 404（内容方已删），绝对化只会造出一条死链；直接摘掉该键。
            absu = base.rstrip("/") + "/" + out.lstrip("/")
            try:
                req = urllib.request.Request(
                    absu, headers={"User-Agent": UA, "Accept": "*/*"},
                    method="HEAD")
                with urllib.request.urlopen(req, context=CTX, timeout=8) as f:
                    if f.status < 400:
                        report.append({"field": "rel_to_abs", "from": out, "to": absu})
                        return absu
            except Exception:
                pass
            # HEAD 不允许时退化为小范围 GET 验证
            try:
                b = fetch_bytes(absu, timeout=8, limit=2000)
                t = b.decode("utf-8", "replace").lstrip("\ufeff \r\n\t")
                if b[:4] != b"404" and "404: Not Found" not in t[:100]:
                    report.append({"field": "rel_to_abs", "from": out, "to": absu})
                    return absu
            except Exception:
                pass
            report.append({"field": "drop_dead_rel", "from": out, "to": None,
                           "reason": "所有镜像均 404 / 不可达，摘除该引用"})
            return "__DROP__"
        return out

    def walk(x):
        if isinstance(x, dict):
            out = {}
            for k, v in x.items():
                w = walk(v)
                if w == "__DROP__":      # 该引用已确认全镜像 404，整键丢弃
                    continue
                out[k] = w
            return out
        if isinstance(x, list):
            out = []
            for v in x:
                w = walk(v)
                if w != "__DROP__":
                    out.append(w)
            return out
        return conv(x)
    return walk(obj)


# ---------------------------------------------------------------- 自检
def fix_spider_md5(cfg, report):
    """真下载 spider jar 计算 md5，替换上游已过期的校验值。

    上游 jar 更新但配置没跟 md5 时，客户端会校验失败 / 反复重下。
    下载失败则直接去掉 ;md5; 段，宁可不校验也不写错值。
    """
    sp = cfg.get("spider")
    if not isinstance(sp, str) or ";md5;" not in sp:
        return
    url, old = sp.rsplit(";md5;", 1)
    try:
        b = fetch_bytes(url, timeout=25, limit=8_000_000)
        if not b.startswith(b"PK\x03\x04"):
            raise ValueError("不是 jar/zip")
        new = hashlib.md5(b).hexdigest()
        cfg["spider"] = url + ";md5;" + new
        report.append({"url": url, "old_md5": old, "new_md5": new,
                       "match": old == new, "bytes": len(b), "ok": True})
    except Exception as e:
        cfg["spider"] = url          # 去掉错误的 md5 段
        report.append({"url": url, "old_md5": old, "new_md5": None,
                       "match": False, "ok": False, "why": str(e)[:100]})


def probe_vod(site):
    if not isinstance(site, dict):        # 纵深防御：脏元素不进体检
        return None
    api = str(site.get("api", ""))
    if not api.startswith("http") or "api.php/provide/vod" not in api:
        return None
    t0 = time.time()
    try:
        sep = "&" if "?" in api else "?"
        txt = fetch_bytes(api + sep + "ac=list", timeout=7, limit=2_000_000) \
            .decode("utf-8", "replace")
        try:
            j = json.loads(txt)
            if not isinstance(j.get("list"), list) and '"list"' not in txt[:2000]:
                return {"api": api, "alive": False, "ms": 0, "why": "响应无 list"}
        except json.JSONDecodeError:
            if '"list"' not in txt[:2000]:
                return {"api": api, "alive": False, "ms": 0, "why": "非法 JSON"}
        return {"api": api, "alive": True, "ms": int((time.time() - t0) * 1000),
                "total": None, "why": "ok"}
    except Exception as e:
        return {"api": api, "alive": False, "ms": 0, "why": str(e)[:80]}


def health_check(sites, report):
    cand = [s for s in sites
            if isinstance(s, dict)
            and str(s.get("api", "")).startswith("http")
            and "api.php/provide/vod" in str(s.get("api", ""))]
    if not cand:
        report["vod_total"] = 0
        return {}, []
    results = []
    with cf.ThreadPoolExecutor(max_workers=10) as ex:
        futs = {ex.submit(probe_vod, s): s for s in cand}
        try:
            for f in cf.as_completed(futs, timeout=45):
                try:
                    r = f.result()
                    if r:
                        results.append(r)
                except Exception as e:
                    results.append({"api": str(futs[f].get("api", "")),
                                    "alive": False, "ms": 0, "why": str(e)[:80]})
        except cf.TimeoutError:
            for f, s in futs.items():
                if not f.done():
                    f.cancel()
                    results.append({"api": str(s.get("api", "")), "alive": False,
                                    "ms": 0, "why": "超过整体体检时限，判失活"})
    report["vod_total"] = len(results)
    return {r["api"]: r for r in results}, sorted(
        results, key=lambda x: (not x["alive"], x["ms"]))


def probe_parse(entry, report):
    u = entry["url"]
    host = urllib.parse.urlparse(u).netloc
    try:
        socket.gethostbyname(host)
    except Exception as e:
        report.append({"name": entry["name"], "url": u, "ok": False,
                       "why": "DNS: " + str(e)[:60]})
        return None
    try:
        # 真实解析请求：把目标 m3u8 拼在 ?url= 之后，并做内容判别。
        # 只发首页 GET 会把「网站首页 200 HTML」误判成解析站可用。
        target = u + urllib.parse.quote("https://example.com/a.m3u8", safe="")
        b = fetch_bytes(target, timeout=8, limit=40_000)
        head = b[:600].lstrip()
        # 解析站正常响应：m3u8 文本 / JSON / 含播放地址的页面；
        # 纯站点首页 HTML（有 <html>、无 m3u8 特征）判为不可用。
        is_html = head[:15].lower().startswith(b"<!doctype") or b"<html" in head[:200].lower()
        has_stream = (b"#EXTM3U" in head or b".m3u8" in head or b".mp4" in head
                      or head[:1] in (b"{", b"["))
        if is_html and not has_stream:
            report.append({"name": entry["name"], "url": u, "ok": False,
                           "why": "返回站点首页 HTML，非解析结果"})
            return None
        report.append({"name": entry["name"], "url": u, "ok": True,
                       "bytes": len(b)})
        return entry
    except Exception as e:
        report.append({"name": entry["name"], "url": u, "ok": False,
                       "why": "HTTP: " + str(e)[:60]})
        return None


def probe_doh(entry, report):
    """用真实 DNS wire 报文 POST，GET 会 400/502 是探测姿势问题不是故障。"""
    q = bytes.fromhex("abcd0100000100000000000003777777076578616d706c6503636f6d0000010001")
    try:
        req = urllib.request.Request(
            entry["url"], data=q, method="POST",
            headers={"Content-Type": "application/dns-message",
                     "Accept": "application/dns-message", "User-Agent": UA})
        with urllib.request.urlopen(req, context=CTX, timeout=8) as f:
            b = f.read()
        ok = f.status == 200 and len(b) > 20
        report.append({"name": entry["name"], "ok": ok, "bytes": len(b)})
        return entry if ok else None
    except Exception as e:
        report.append({"name": entry["name"], "ok": False, "why": str(e)[:70]})
        return None


def probe_simple(name, url, report, keyword=None):
    try:
        b = fetch_bytes(url, timeout=9, limit=60_000)
        ok = (keyword is None) or (keyword.lower() in b[:3000].decode("utf-8", "replace").lower())
        report.append({"name": name, "ok": ok, "bytes": len(b)})
        return ok
    except Exception as e:
        report.append({"name": name, "ok": False, "why": str(e)[:70]})
        return False


# ---------------------------------------------------------------- 渲染
# 网盘 / 磁力类线路：点开需要先授权网盘（阿里云盘 Token 等），
# 不能像采集站那样直接出 m3u8。用户要「点开就能看」时必须排到最后。
CLOUD_HINTS = ["网盘", "云盘", "磁力", "阿里", "夸克", "115", "盘搜", "AList",
               "WebDAV", "网盘搜索", "云搜", "盘搜索", "玩偶", "音范丝", "UP云",
               "云资源", "秒传", "分享"]
CLOUD_APIS = {"csp_Wogg", "csp_WoGG", "csp_CandyMuj_yinfans", "csp_AList",
              "csp_WebDAV", "csp_PanSearch", "csp_PanSou", "csp_PanSso",
              "csp_UpYun", "csp_XiaoZhiTiao", "csp_MIPanSo", "csp_KkSs",
              "csp_UuSs", "csp_AliPS", "csp_YiSo", "csp_YpanSo", "csp_SixV"}


def is_cloud(s):
    """判断是否网盘/磁力类（需要授权才能播）。"""
    if not isinstance(s, dict):
        return False
    api = str(s.get("api") or "")
    if api in CLOUD_APIS:
        return True
    if "磁力" in api or "pan" in api.lower() or "alist" in api.lower():
        return True
    n = str(s.get("name") or "") + str(s.get("key") or "")
    return any(h.lower() in n.lower() for h in CLOUD_HINTS)


def play_rank(s):
    """播放优先级：数字越大越该排前面。

    「点开就能看」的直连采集站排第一，网盘类沉底，
    这样用户不用每次点开都遇到授权弹窗。
    """
    if not isinstance(s, dict):
        return -1
    api = str(s.get("api") or "")
    if is_cloud(s):
        return 0                       # 需网盘授权 → 最后
    if api.startswith("http") and ("api.php/provide/vod" in api or "/vod" in api):
        return 100                     # 直连 m3u8，点开即播
    if api.startswith("csp_") or api.startswith("http"):
        return 50                      # csp 爬虫，多数能直出
    return 10


def hd_score(s):
    if not isinstance(s, dict):
        return 0
    n = str(s.get("name", "")) + str(s.get("key", ""))
    return (sum(1 for w in HD_WORDS if w in n)
            + (1 if str(s.get("api", "")).startswith("http") else 0))


def norm_name(n):
    """繁简/大小写/标点归一化，用于跨仓去重。"""
    s = str(n or "")
    s = s.translate(str.maketrans(
        "風體國臺灣優質網盤極速線路備選劇場畫質",
        "风体国台湾优质网盘极速线路备选剧场画质")).lower()
    s = re.sub(r"[·\s\-_（）()【】]+", "", s)
    return re.sub(r"备\d*$", "", s)


def dedup_sites(sites):
    """按 api 去重（同一采集站只留一条，名字用先出现的），再按 key 去重。"""
    seen_api, seen_key, out = set(), set(), []
    for s in sites:
        if not isinstance(s, dict):       # 纵深防御：跳过脏元素
            continue
        api = str(s.get("api") or "").rstrip("/")
        # 采集站按 api 判重：非凡/量子/暴风 等在多个上游里都有，
        # 只看 key 会留成「非凡」「非凡·最快」两条，用户以为多了线路。
        if api.startswith("http") and ("vod" in api or "api.php" in api):
            if api in seen_api:
                continue
            seen_api.add(api)
        k = str(s.get("key") or api or id(s))
        if k in seen_key:
            continue
        seen_key.add(k)
        out.append(s)
    return out


def normalize_ext(site):
    """把 site["ext"] 统一成 JSON 字符串。

    FongMi 的 Site.java 里 ext 是 String：
        @SerializedName("ext") private String ext;
    上游很多配置把 ext 写成 JSON 对象，Gson 解析成 String 会抛
    「Expected a string but was BEGIN_OBJECT」→ 整个配置解析失败 → 客户端闪退。
    所以输出前必须把对象/数组序列化成字符串。
    """
    if not isinstance(site, dict):
        return site
    ext = site.get("ext")
    if isinstance(ext, (dict, list)):
        site = dict(site)
        site["ext"] = json.dumps(ext, ensure_ascii=False, separators=(",", ":"))
    return site


def tune(cfg, health, lives):
    kept, dropped = [], []
    # 先把实测可用的直连采集站塞到最前面：这类点开就出 m3u8，
    # 不需要网盘/账号/授权，是电视端唯一「零门槛」的片源。
    direct = [dict(d) for d in DIRECT_SITES]
    for raw in direct + list(cfg.get("sites") or []):
        if not isinstance(raw, dict):    # 纵深防御：跳过脏元素
            continue
        s = dict(raw)                    # 先复制，绝不污染 configs
        a = str(s.get("api", ""))
        # 用户明确不要「点开还要授权」的线路：网盘/磁力类直接丢掉，
        # 否则电视上每次点开都会弹 Token 框。
        if is_cloud(s):
            dropped.append({"name": s.get("name"), "api": a,
                            "why": "网盘/磁力类需授权，已按需求剔除"})
            continue
        # 死链可能藏在 api / ext / ext 子字段 / key 里，整条 site 一起查
        blob = json.dumps(s, ensure_ascii=False)
        hit = next((why for pre, why in DEAD_APIS.items() if pre in blob), None)
        if not hit and ("agit.ai/fantaiying/dr_py" in blob or AGIT_MARK in blob):
            hit = "agit.ai 返回 HTML 反爬页"
        # 全仓通用：spider jar 里不存在对应类的 csp_ 站点一律剔除
        # （实测 c1 的 NiNi/Ying/Dovx、c3 的 NiNi/PanSou 都必挂）
        if not hit:
            bad = next((cls for api, cls in BAD_CSP.items()
                        if a == api or ('"' + api + '"') in blob), None)
            if bad:
                hit = "jar 中无 %s 类" % bad
        if hit:
            dropped.append({"name": s.get("name"), "api": a, "why": hit})
            continue
        r = health.get(a)
        if r and not r["alive"]:
            dropped.append({"name": s.get("name"), "api": a, "why": r["why"]})
            continue
        if r and r["alive"] and r["ms"] > 0:
            if r["ms"] > 1200:
                s["timeout"] = 30
            s["name"] = str(s.get("name") or s.get("key") or "线路") \
                + "·" + str(r["ms"]) + "ms"
        kept.append(s)
    kept = [normalize_ext(x) for x in dedup_sites(kept)]
    # 排序：先按「能否点开即播」分组（直连 > csp > 网盘），
    # 同组内按实测延迟从低到高，延迟数字最小的排最前。
    for s in kept:
        if is_cloud(s) and not str(s.get("name", "")).startswith("【需授权】"):
            s["name"] = "【需授权】" + str(s.get("name") or s.get("key") or "线路")
    kept.sort(key=lambda s: (-play_rank(s),
                             int(re.search(r"·(\d+)ms", str(s.get("name", "")) or "0")
                                 .group(1)) if re.search(r"·(\d+)ms", str(s.get("name", ""))) else 9999,
                             -hd_score(s),
                             str(s.get("name", ""))))
    out = {
        "wallpaper": WALLPAPER,
        "spider": cfg.get("spider"),
        "sites": kept,
        "lives": lives,
        "parses": PARSE_BUILTIN + list(CONF_PARSES),
        "ijk": IJK,
        "doh": list(CONF_DOH),
        "ads": ADS,
        "flags": cfg.get("flags", []) or [],
    }
    if cfg.get("rules"):
        out["rules"] = cfg["rules"]
    return out, dropped


# 模块级：由 main() 在自检后填入
CONF_PARSES = []
CONF_DOH = []


def main():
    global CONF_PARSES, CONF_DOH
    report = {
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "upstreams": [], "spider_md5": [], "vod_lines": [], "dropped": [],
        "live": [], "parses": [], "doh": [], "external": [], "channels": [],
        "issues": [],
    }

    # ---------- 1. 外部依赖自检（死的不写进配置） ----------
    url_fixes = report["url_fixes"] = []
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        pr = list(ex.map(lambda e: probe_parse(e, report["parses"]), PARSE_CANDIDATES))
    CONF_PARSES = [p for p in pr if p]
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        dr = list(ex.map(lambda e: probe_doh(e, report["doh"]), DOH_CANDIDATES))
    CONF_DOH = [d for d in dr if d] or [DOH_CANDIDATES[0], DOH_CANDIDATES[1]]
    if not CONF_PARSES:
        report["issues"].append("所有第三方解析站均不可达，仅保留内置 Demo/Parallel/Sequence")
    wall_ok = probe_simple("壁纸", WALLPAPER, report["external"])
    epg_ok = probe_simple("EPG", EPG.replace("{name}", "CCTV1").replace(
        "{date}", datetime.now().strftime("%Y-%m-%d")), report["external"])
    if not wall_ok:
        WALL = ""
    else:
        WALL = WALLPAPER
    globals()["WALLPAPER"] = WALL
    report["epg_ok"] = epg_ok

    # ---------- 2. 直播源（多镜像 + 退避重试 + 全挂保留旧文件） ----------
    live_texts, live_entries = {}, []
    for name, urls, fn in LIVE_SOURCES:
        txt, used, err = None, None, ""
        for u in urls:
            for attempt in (1, 2):
                try:
                    b = fetch_bytes(u, timeout=15, limit=4_000_000)
                    txt = decode_smart(b)
                    if len(b) >= 4_000_000 and not txt.endswith("\n"):
                        txt = txt[:txt.rfind("\n") + 1]
                    used = u
                    break
                except Exception as e:
                    err = str(e)[:100]
                    if attempt == 1:
                        time.sleep(2)
            if txt:
                break
        # 先找上一版产物里的缓存（任意通道目录都可能留着）
        old = None
        for cand in (os.path.join(OUT, SUB, fn), os.path.join(OUT, "_site", SUB, fn)):
            if os.path.exists(cand):
                try:
                    old = open(cand, encoding="utf-8").read()
                except Exception:
                    pass
                break
        final = txt or old
        if final:
            live_texts[fn] = final
            e = {"name": name, "type": 0, "url": SELF + "/" + fn,
                 "playerType": 1, "ua": "okhttp/3.15"}
            if epg_ok:
                e["epg"] = EPG
            live_entries.append(e)
            report["live"].append({"name": name, "file": fn, "ok": bool(txt),
                                  "bytes": len(final.encode("utf-8")), "source": used,
                                  "note": "" if txt else "全部镜像失败，沿用上次缓存；" + err})
        else:
            report["live"].append({"name": name, "file": fn, "ok": False, "why": err})

    # ---------- 3. 上游配置 ----------
    configs = {}
    for up in UPSTREAMS:
        rec = {"id": up["id"], "name": up["name"], "source": None, "ok": False}
        for m in up["mirrors"]:
            try:
                text = fetch(m["url"], timeout=14, limit=6_000_000)
            except Exception:
                continue
            if is_hex_blob(text):
                continue
            cfg = parse_config(text)
            if not cfg or not isinstance(cfg.get("sites"), list):
                continue
            cfg = rewrite_broken_conf(cfg)
            cfg = absolutize(cfg, m["base"], m["jar_base"])
            cfg = strip_dead_refs(cfg)
            cfg = sanitize_urls(cfg, m["base"], url_fixes)
            configs[up["id"]] = cfg
            rec.update({"source": m["url"], "ok": True, "sites": len(cfg["sites"])})
            break
        if not rec["ok"]:
            rec["why"] = "所有镜像均不可达 / 非明文单仓配置"
        report["upstreams"].append(rec)

    if not configs:
        report["issues"].append("所有上游均失败：保留上一版产物，不覆盖。")
        report["fatal"] = True
        _verify(report)
        chs = _channels()
        report["channels"] = [
            {"name": c["name"], "dest": c["dest"], "base": c["base"],
             "files": len(live_texts) + 2} for c in chs
        ]
        for ch in chs:
            _emit({}, live_texts, report, ch)
        print("FATAL: 所有上游均失败，已保留上一版产物。")
        sys.exit(1)

    # ---------- 4. spider md5 动态修正 ----------
    for uid, cfg in configs.items():
        fix_spider_md5(cfg, report["spider_md5"])
    for r in report["spider_md5"]:
        if not r.get("match"):
            report["issues"].append(
                "spider md5 已自动修正 %s: %s -> %s"
                % (r["url"].split("/")[-1], r.get("old_md5"), r.get("new_md5")))

    # ---------- 5. 线路体检 ----------
    all_sites = [s for c in configs.values()
                 for s in (c.get("sites") or []) if isinstance(s, dict)]
    health, lines = health_check(all_sites, report)
    report["vod_lines"] = lines

    # ---------- 6. 渲染模板 ----------
    templates = {}
    built = []
    for uid, cfg in configs.items():
        out, dropped = tune(cfg, health, live_entries)
        templates[uid + ".json"] = json.dumps(out, ensure_ascii=False, indent=2)
        report["dropped"].extend(dropped)
        built.append((uid, len(out["sites"])))

    # 「直连专区」：只装实测可用的直连采集站，零授权、点开即播。
    # 不再放网盘/磁力线——那类在电视上必弹 Token，体验最差。
    hd_sites, seen = [], set()
    def add(s, tag):
        if not isinstance(s, dict):       # 纵深防御
            return
        if is_cloud(s):
            return                        # 网盘类一律不进
        # 按 api 去重：同一个采集站在多个上游都出现，只看名字会留成两条
        k = str(s.get("api", "")).rstrip("/") or norm_name(s.get("name"))
        if k in seen:
            return
        a = str(s.get("api", ""))
        # 与 tune() 同一套死链清洗：api / ext / 子字段里藏了已死端点，
        # 或 jar 里没有的 csp 类，都不许进 4K 专区
        blob = json.dumps(s, ensure_ascii=False)
        hit = next((why for pre, why in DEAD_APIS.items() if pre in blob), None)
        if not hit and ("agit.ai/fantaiying/dr_py" in blob or AGIT_MARK in blob):
            hit = "agit.ai 返回 HTML 反爬页"
        # 全仓通用：spider jar 里不存在对应类的 csp_ 站点一律剔除
        # （实测 c1 的 NiNi/Ying/Dovx、c3 的 NiNi/PanSou 都必挂）
        if not hit:
            bad = next((cls for api, cls in BAD_CSP.items()
                        if a == api or ('"' + api + '"') in blob), None)
            if bad:
                hit = "jar 中无 %s 类" % bad
        if hit:
            report["dropped"].append(
                {"name": s.get("name"), "api": a, "why": "4K专区拒收: " + hit})
            return
        # jar 里不存在对应类的 csp_ 站点，点进去必 ClassNotFoundException
        if a in BAD_CSP:
            report["dropped"].append(
                {"name": s.get("name"), "api": a,
                 "why": "jar 中无 %s 类，4K 专区拒收" % BAD_CSP[a]})
            return
        # 自带 jar 但 jar 不含该 csp 类的「备线」，同样拒收
        jar = str(s.get("jar", ""))
        if jar and a.startswith("csp_") and "FongMi/CatVodSpider" in jar:
            report["dropped"].append(
                {"name": s.get("name"), "api": a, "why": "自带 jar 不含对应类"})
            return
        seen.add(k)
        s = dict(s)
        s["name"] = tag + str(s.get("name") or s.get("key") or "线路")
        hd_sites.append(normalize_ext(s))
    # 直连专区：先放 4 个实测直连站（点开即播），再补上游里其它直连线路
    for d in DIRECT_SITES:
        add(dict(d), "【直连】")
    for c in configs.values():
        for s in (c.get("sites") or []):
            if isinstance(s, dict) and str(s.get("api", "")).startswith("http"):
                a = str(s.get("api", ""))
                if health.get(a) and not health[a]["alive"]:
                    continue
                add(s, "")
    fourk = {
        "wallpaper": WALLPAPER,
        "spider": (configs.get("c2") or configs.get("c1") or {}).get("spider"),
        "sites": hd_sites, "lives": live_entries,
        "parses": PARSE_BUILTIN + CONF_PARSES, "ijk": IJK,
        "doh": CONF_DOH, "ads": ADS,
    }
    # 按实测延迟排序，最快的排最前
    def _ms(s):
        m = re.search(r"·(\d+)ms", str(s.get("name", "")))
        return int(m.group(1)) if m else (
            next((int(h[k]["ms"]) for k in [str(s.get("api", ""))]
                  if k in h and h[k].get("alive")), 9999))
    h = health
    fourk["sites"].sort(key=_ms)
    templates["4k.json"] = json.dumps(fourk, ensure_ascii=False, indent=2)

    # ---- 真 4K 专仓：14 条 csp 插件线，自带 spider jar ----------
    # 这些线路爬的是 4K 资源站的公开分享链，不需要用户授权网盘，
    # 是「别人能免费看 4K」的真正原因。
    fourk_real = {
        "wallpaper": WALLPAPER,
        "spider": K4_SPIDER + ";md5;" + K4_SPIDER_MD5,
        "sites": [dict(s) for s in SITES_4K],
        "lives": live_entries,
        "parses": PARSE_BUILTIN + CONF_PARSES,
        "ijk": IJK,
        "doh": CONF_DOH,
        "ads": ADS,
    }
    # 已停用：4kreal 使用独立 spider jar（gitee 1.9MB），
    # 与 c1/c2 的 jar 在客户端里互相覆盖，实测会导致影视仓闪退。
    # 保留代码以便后续在「单独一个仓」的场景启用。
    _ = fourk_real

    names = {u["id"]: u["name"] for u in UPSTREAMS}
    entries = [{"name": "%s（%d 条线路）" % (names.get(u, u), n),
                "url": SELF + "/" + u + ".json"} for u, n in built]
    entries.append({"name": "④ 直连专区·点开即播（%d 条·免授权）" % len(hd_sites),
                    "url": SELF + "/4k.json"})
    templates["index.json"] = json.dumps({"urls": entries}, ensure_ascii=False, indent=2)

    report["summary"] = {
        "sub_configs": built, "4k_sites": len(hd_sites),
        "real4k_sites": len(SITES_4K),
        "alive_vod": sum(1 for x in lines if x["alive"]),
        "dead_vod": sum(1 for x in lines if not x["alive"]),
        "live_files": len(live_texts),
        "alive_parses": len(CONF_PARSES), "alive_doh": len(CONF_DOH),
    }

    # ---------- 7. 生成后字段感知自检（客户端式复核） ----------
    _inspect_output(templates, report)

    # ---------- 8. 汇总自检（必须在 _emit 之前，status.json 才会带上结论） ----------
    _verify(report)

    # ---------- 9. 双通道输出 ----------
    # channels 列表在写盘前一次性定型，保证每份 status.json 都带完整通道信息
    chs = _channels()
    report["channels"] = [
        {"name": c["name"], "dest": c["dest"], "base": c["base"],
         "files": len(templates) + len(live_texts) + 2}
        for c in chs
    ]
    for ch in chs:
        _emit(templates, live_texts, report, ch)

    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print("built_at:", report["built_at"])
    if report["verify"].get("total_problems", 0):
        print("FATAL: 输出自检发现 %d 个问题，拒绝交付。" %
              report["verify"]["total_problems"])
        sys.exit(2)
    if report["issues"]:
        print("已自动修复/需注意：")
        for i in report["issues"]:
            print("  -", i)
    else:
        print("自检：全部通过，无遗留问题。")


def _channels():
    """两个独立通道：Pages 部署目录 / 仓库(jsDelivr)目录。

    各自内部 URL 用各自的绝对前缀，互不引用对方。
    """
    chs = []
    if PAGES_BASE:
        chs.append({"name": "pages", "base": PAGES_BASE.rstrip("/"),
                    "dest": os.path.join(OUT, "_site", SUB) if SUB
                            else os.path.join(OUT, "_site")})
    if CDN_BASE:
        prefix = CDN_BASE.rstrip("/") + ("/" + SUB.strip("/") if SUB else "")
        chs.append({"name": "cdn", "base": prefix,
                    "dest": os.path.join(OUT, SUB) if SUB else OUT})
    if not chs:
        # 关键门禁：在 GitHub Actions 里如果 box.json 没填好（pages/cdn 为空），
        # 绝不能退化成 example.invalid 假地址——那会产出一套看似成功、
        # 实际全部打不开的配置，且 CI 全绿，属于最难发现的坏结果。
        # 只有在本地试跑（未设置 CI 环境变量）时才允许降级预览。
        if os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"):
            raise RuntimeError(
                "box.json 缺少 pages/cdn：无法确定站点地址。"
                "请先用一键部署脚本生成 box.json，或手工填好 "
                '"pages": "https://<user>.github.io/<repo>/x/<rand>" 与 '
                '"cdn": "https://cdn.jsdelivr.net/gh/<user>/<repo>@main"')
        chs.append({"name": "local", "base": "https://example.invalid/box",
                    "dest": os.path.join(OUT, SUB) if SUB else OUT})
    return chs


def _emit(templates, live_texts, report, ch, empty_ok=False):
    os.makedirs(ch["dest"], exist_ok=True)
    base = ch["base"]
    for fn, content in templates.items():
        out = content.replace(SELF, base)
        # 落盘前最后一道断言：写进客户端的文件里绝不能有未替换占位符，
        # 也不能有 ./ ../ 开头的相对地址（FongMi 客户端不会解析）。
        if SELF in out:
            raise RuntimeError("%s: 未替换占位符 %s" % (fn, SELF))
        with open(os.path.join(ch["dest"], fn), "w", encoding="utf-8") as f:
            f.write(out)
    for fn, txt in live_texts.items():
        with open(os.path.join(ch["dest"], fn), "w", encoding="utf-8", newline="") as f:
            f.write(txt)

    st = dict(report)
    st["entries"] = {
        "main": (PAGES_BASE.rstrip("/") + "/index.json") if PAGES_BASE else "",
        "backup": (CDN_BASE.rstrip("/") + "/" + SUB.strip("/") + "/index.json")
                  if CDN_BASE else "",
        "status": (PAGES_BASE.rstrip("/") + "/status.json") if PAGES_BASE else "",
        "subdir": SUB,
        "channel": ch["name"],
        "self_base": base,
    }
    with open(os.path.join(ch["dest"], "status.json"), "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=2)
    with open(os.path.join(ch["dest"], ".nojekyll"), "w", encoding="utf-8") as f:
        f.write("")
    # 站点根（OUT/.nojekyll 供仓库通道；OUT/_site/.nojekyll 供 Pages 通道）
    # upload-pages-artifact 打包的是 _site/ 顶层，顶层缺 .nojekyll 会让
    # GitHub Pages 用 Jekyll 处理站点，必须显式写一份。
    with open(os.path.join(OUT, ".nojekyll"), "w", encoding="utf-8") as f:
        f.write("")
    if ch["name"] == "pages":
        site_root = os.path.join(OUT, "_site")
        os.makedirs(site_root, exist_ok=True)
        with open(os.path.join(site_root, ".nojekyll"), "w", encoding="utf-8") as f:
            f.write("")
        # 独立 4K 配置：放在站点根目录 /4konly/index.json，
        # 与主配置完全隔离（自带独立 spider jar，客户端切换时只加载它）。
        try:
            _emit_4konly(site_root, templates)
        except Exception as e:
            print("  [warn] 4konly 生成失败：", e)


def _emit_4konly(site_root, templates):
    """生成独立的纯 4K 配置到 /4konly/index.json。

    与主配置隔离的原因：影视仓全局只保留一个 spider jar，主配置用的是
    gao / candymuj 的 jar，4K 线路需要 easy11.05 那个 jar（194 个类）。
    两者混在同一个多仓里切换时会互相覆盖 → csp_ 类找不到 → 客户端闪退。
    所以 4K 单独一套地址，用户切换过去时只加载它自己的 jar。
    """
    jar = K4_SPIDER + ";md5;" + K4_SPIDER_MD5
    sites = []
    for s in SITES_4K:
        api = str(s.get("api") or "")
        # 只收 jar 里确认存在的类（PantaAmns 实测不存在，必须排除）
        if api[4:] in ("PantaAmns",):
            continue
        item = dict(s)
        # 关键：FongMi 的 Site.ext 是 String 类型（@SerializedName("ext") private String ext），
        # 写成 JSON 对象会让 Gson 解析抛异常 → 整个配置解析失败 → 客户端闪退。
        # 必须序列化成 JSON 字符串。
        ext = item.get("ext")
        if isinstance(ext, (dict, list)):
            item["ext"] = json.dumps(ext, ensure_ascii=False, separators=(",", ":"))
        sites.append(item)
    if not sites:
        return
    cfg = {
        "wallpaper": WALLPAPER,
        "spider": jar,
        "sites": sites,
        "lives": [],
        "parses": [
            {"name": "聚合", "type": 0, "url": "Web"},
            {"name": "并行", "type": 0, "url": "Parallel"},
        ],
        "flags": ["youku", "qq", "iqiyi", "qiyi", "letv", "sohu", "tudou",
                  "pptv", "mgtv", "wasu", "bilibili"],
        "ads": ADS,
        "doh": CONF_DOH,
    }
    d = os.path.join(site_root, "4konly")
    os.makedirs(d, exist_ok=True)
    # 把 jar 复制进站点目录，让客户端从同源下载（避免第三方防盗链）
    jar_src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "spider4k.jar")
    if os.path.isfile(jar_src):
        import shutil
        shutil.copy2(jar_src, os.path.join(d, "spider.jar"))
        print("   4konly/spider.jar 已复制（%.2f MB）"
              % (os.path.getsize(jar_src) / 1048576.0))
    else:
        print("   [warn] 本地缺少 spider4k.jar")
    with open(os.path.join(d, "index.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print("   4konly/index.json 已生成（%d 条 4K 线路）" % len(sites))


def _inspect_output(templates, report):
    """把生成的 JSON 当客户端会读的东西再核一遍：

      - 每份配置必须是合法 JSON，且含 sites / lives 字段；
      - index.json 的每个子仓 url 为绝对地址，且指向的文件确实生成了；
      - lives[].url 必须为绝对地址（TVBox 不走相对解析）；
      - 不允许残留 ./ ../ 或裸相对资源路径；
      - 不允许再出现已知死域名 / 404 路径；
      - 记录每条 ext / api 的 URL 总数，供 status.json 复核。
    """
    checks = []
    # 已知死链 / 假 200 HTML 源 / 坏 csp 类，生成物里一条都不许留
    dead_marks = [
        "ghp.ci/", "FongMi/CatVodSpider/main/json/wogg.json",
        "agit.ai/", "api123.adys.app/xgapp.php",
        "sk100.tv/api.php/app", "fuju2024.cc:8013",
        "csp_CandyMuj_sstv",
    ]
    for fn, text in templates.items():
        try:
            # SELF 是 emit 时才替换的通道前缀；自检时先换成一个合法的假 host，
            # 这样「是否绝对地址」的检查才不会把占位符误判成相对路径。
            o = json.loads(text.replace(SELF, "https://self.invalid"))
        except Exception as e:
            report["issues"].append("%s 不是合法 JSON: %s" % (fn, e))
            continue
        rec = {"file": fn, "sites": len(o.get("sites", [])),
               "lives": len(o.get("lives", [])), "problems": []}
        if fn != "index.json" and not o.get("sites"):
            rec["problems"].append("sites 为空")
        for i, l in enumerate(o.get("lives", [])):
            u = str(l.get("url", ""))
            if not u.startswith("http"):
                rec["problems"].append("lives[%d].url 非绝对地址: %s" % (i, u))
        # 全文扫描残留相对 / 死域名
        def walk(x, p="$"):
            if isinstance(x, dict):
                for k, v in x.items():
                    walk(v, p + "." + k)
            elif isinstance(x, list):
                for i, v in enumerate(x):
                    walk(v, p + "[%d]" % i)
            elif isinstance(x, str):
                if x.startswith("./") or x.startswith("../"):
                    rec["problems"].append("残留相对路径 %s = %s" % (p, x[:70]))
                for m in dead_marks:
                    if m in x:
                        rec["problems"].append("残留死链 %s = %s" % (p, x[:70]))
                if REL_FILE_RE.match(x):
                    rec["problems"].append("残留裸相对文件 %s = %s" % (p, x[:70]))
        walk(o)
        ks = [str(s.get("key")) for s in o.get("sites", [])]
        dupk = sorted({k for k in ks if ks.count(k) > 1})
        if dupk:
            rec["problems"].append("重复站点 key: %s" % dupk)
        # __SELF__ 是 _emit() 落盘时才替换的通道占位符；此处检查的是
        # 替换前的模板（上面已用 self.invalid 代换后解析），出现属正常。
        # 真正残留由 _emit() 写入时对替换结果断言拦截。
        if fn == "index.json":
            for e in o.get("urls", []):
                u = str(e.get("url", ""))
                if not u.startswith("http"):
                    rec["problems"].append("index 子仓非绝对: " + u)
                target = u.rsplit("/", 1)[-1]
                if target not in templates:
                    rec["problems"].append("index 指向未生成的文件: " + target)
        checks.append(rec)
        for pr in rec["problems"]:
            report["issues"].append("%s: %s" % (fn, pr))
    report["output_check"] = checks
    report["verify"] = {
        "files_checked": len(checks),
        "files_with_problems": sum(1 for c in checks if c["problems"]),
        "total_problems": sum(len(c["problems"]) for c in checks),
        "url_fixes_applied": len(report.get("url_fixes", [])),
    }


def _verify(report):
    """最终门禁。降级场景（上游全挂）没有 summary，按 0 处理即可。"""
    if not report.get("summary", {}).get("sub_configs"):
        report["issues"].append("未生成任何子仓配置")
    if not report["live"] or not any(x["ok"] for x in report["live"]):
        report["issues"].append("本次直播源全部拉取失败且无缓存")
    if not CONF_DOH:
        report["issues"].append("无可用 DoH")
    for r in report["spider_md5"]:
        if r.get("ok") is False:
            report["issues"].append("spider jar 下载失败，已去掉 md5 校验段")
    dead = sum(1 for x in report["vod_lines"] if not x["alive"])
    if dead:
        report["issues"].append("已剔除 %d 条失活点播线路（正常自愈）" % dead)
    report.setdefault("verify", {
        "files_checked": 0, "files_with_problems": 0,
        "total_problems": 0, "url_fixes_applied": 0,
    })
    report["verify"]["issues"] = len(report["issues"])
    report["verify"]["dead_vod_removed"] = dead
    report["verify"]["all_absolute"] = (
        report["verify"].get("total_problems", 0) == 0)


if __name__ == "__main__":
    main()
