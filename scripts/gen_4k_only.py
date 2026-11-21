# -*- coding: utf-8 -*-
"""生成「纯 4K」独立配置 —— 只包含 jar 里已确认存在的爬虫类。

设计原则（防止客户端闪退）：
  1. 只用一个 spider jar，仓内所有 csp_ 类必须能在该 jar 的 dex 里找到，
     否则 JarLoader.loadClass 抛 ClassNotFoundException → 影视仓崩溃。
  2. 独立子目录 /4konly/，与主配置完全隔离，切换过去只加载它自己的 jar。
  3. 生成后自动做「类名 vs jar 内容」交叉校验，任何不匹配直接拒收。

运行：python scripts/gen_4k_only.py   （会自动下载 jar 并核对）
"""
import json
import os
import re
import ssl
import sys
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "4konly")

# 单一 jar（135→194 个类，含 4KZhinan / PanWebShare / SeedHub / Wogg / Sou4K 等）
JAR_URL = "https://gitee.com/easy999/test1/raw/main/easy11.05.png"
JAR_MD5 = "c07ab2794d358d27d4a4e842712d3c16"

# 候选线路：api 类名必须真实存在于上面的 jar 中
CANDIDATES = [
    # ---- 网盘分享类（读公开分享链，免用户授权）----
    {"key": "玩偶4K", "name": "🔥玩偶 4K", "api": "csp_Wogg",
     "ext": {"site": ["https://www.wogg.live", "https://woggpan.888484.xyz"]}},
    {"key": "快映4K", "name": "🔥快映 4K", "api": "csp_PanWebShare",
     "ext": {"site": ["http://xsayang.fun"]}},
    {"key": "八零4K", "name": "🔥八零 4K", "api": "csp_PanWebShare",
     "ext": {"site": ["https://www.80yy3.com", "https://woog.430520.xyz"]}},
    {"key": "虎斑4K", "name": "🔥虎斑 4K", "api": "csp_PanWebShare",
     "ext": {"site": ["http://xhban.xyz"]}},
    {"key": "闪电4K", "name": "🔥闪电 4K", "api": "csp_PanWebShare",
     "ext": {"site": ["http://shandian.blog"]}},
    {"key": "蜡笔4K", "name": "🔥蜡笔 4K", "api": "csp_PanWebShare",
     "ext": {"site": ["http://tvpanpan.site"]}},
    {"key": "花卷4K", "name": "🔥花卷 4K", "api": "csp_PanWebShareHJ",
     "ext": {"site": ["https://www.hjzhencai.top"]}},
    # ---- 4K 资源站爬虫 ----
    {"key": "指南4K", "name": "💎指南 4K", "api": "csp_4KZhinan",
     "ext": {"site": ["https://4kzn.cc"]}},
    {"key": "小丑4K", "name": "💎小丑 4K", "api": "csp_4KZhinan",
     "ext": {"site": ["https://4kxc.com"]}},
    {"key": "搜4K", "name": "🔍搜4K", "api": "csp_Sou4K",
     "ext": {"site": ["https://sou4k.com"]}},
    # ---- 种子 / 网盘综合 ----
    {"key": "种子4K", "name": "🧲种子 4K", "api": "csp_SeedHub",
     "ext": {"site": ["https://sidhub.cc", "https://seeduck.cc", "https://hubdog.cc"]}},
    {"key": "搬运4K", "name": "📦搬运 4K", "api": "csp_BanYunDao"},
    {"key": "爱盼4K", "name": "🎬爱盼 4K", "api": "csp_AiPan"},
    {"key": "移动4K", "name": "⚡移动 4K", "api": "csp_Yidong4K"},
    {"key": "KK网盘", "name": "☁️KK网盘", "api": "csp_KKPan"},
    {"key": "米盘", "name": "☁️米盘", "api": "csp_MiPan"},
]

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122"


def fetch(url, timeout=60, limit=20_000_000):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "application/octet-stream,*/*",
        "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, context=CTX, timeout=timeout) as f:
        return f.read(limit)


def jar_classes(raw):
    """解 jar 取全部 com.github.catvod.spider.X 类名。"""
    import io
    import hashlib
    got = hashlib.md5(raw).hexdigest()
    if got != JAR_MD5:
        raise RuntimeError("jar md5 不匹配：%s != %s" % (got, JAR_MD5))
    z = zipfile.ZipFile(io.BytesIO(raw))
    names = set()
    for n in z.namelist():
        if not n.endswith(".dex"):
            continue
        d = z.read(n)
        for m in re.finditer(rb"Lcom/github/catvod/spider/([A-Za-z0-9_$]+);", d):
            try:
                names.add(m.group(1).decode())
            except Exception:
                pass
    return names


def build():
    print(">> 下载 spider jar 并核对类名 ...")
    raw = fetch(JAR_URL)
    classes = jar_classes(raw)
    print("   jar %.2f MB，%d 个类" % (len(raw) / 1048576.0, len(classes)))

    sites, rejected = [], []
    for c in CANDIDATES:
        cls = c["api"][4:]
        if cls not in classes:
            rejected.append({"name": c["name"], "api": c["api"],
                             "why": "jar 里没有 %s 类，点开必闪退" % cls})
            print("   ❌ 拒收 %-14s (缺 %s)" % (c["api"], cls))
            continue
        s = {
            "key": c["key"], "name": c["name"], "type": 3, "api": c["api"],
            "searchable": 1, "quickSearch": 1, "filterable": 1,
            "changeable": 1, "timeout": 60,
        }
        if c.get("ext"):
            s["ext"] = c["ext"]
        sites.append(s)
        print("   ✅ 收入 %-14s -> %s" % (c["api"], cls))

    if not sites:
        raise SystemExit("没有任何可用线路，中止")

    cfg = {
        "wallpaper": "https://picsum.photos/1280/720",
        "spider": JAR_URL + ";md5;" + JAR_MD5,
        "sites": sites,
        "lives": [],
        "parses": [
            {"name": "聚合", "type": 0, "url": "Web"},
            {"name": "并行", "type": 0, "url": "Parallel"},
        ],
        "flags": ["youku", "qq", "iqiyi", "qiyi", "letv", "sohu", "tudou",
                  "pptv", "mgtv", "wasu", "bilibili"],
        "ads": ["mimg.0c1q0l.cn", "www.googletagmanager.com", "www.google-analytics.com"],
        "doh": [
            {"name": "阿里", "url": "https://dns.alidns.com/dns-query",
             "ips": ["223.5.5.5", "223.6.6.6"]},
            {"name": "腾讯", "url": "https://doh.pub/dns-query",
             "ips": ["1.12.12.12", "120.53.53.53"]},
        ],
    }
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, "index.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print("\n>> 已生成 %s（%d 条线路）" % (p, len(sites)))
    if rejected:
        print("   拒收 %d 条：" % len(rejected))
        for r in rejected:
            print("     -", r["name"], r["why"])
    return sites, rejected


if __name__ == "__main__":
    build()
