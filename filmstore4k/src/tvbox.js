/**
 * TVBox / 影视仓 配置生成。
 *
 * 输出标准 TVBox 配置（JSON）：
 *   sites[]  type=3 走苹果CMS json 接口
 *   lives[]  直播（留空，可自行加）
 *   parses[] 解析（留空；用直链 m3u8 不需要）
 *
 * 两种模式：
 *   mode=full  聚合站 + 每个直连源各一个站（源多、容错好）
 *   mode=lite  只有聚合站（干净，源变化由本服务兜底）
 */

function siteOf(o) {
  return {
    key: o.key,
    name: o.name,
    type: 3,
    api: o.api,
    searchable: o.searchable ?? 1,
    quickSearch: o.quickSearch ?? 1,
    filterable: o.filterable ?? 0,
    ext: o.ext ?? "",
  };
}

import { buildPanSiteConfig } from "./pan4k.js";

export function buildTvboxConfig(origin, sources, rawConfig) {
  const sites = [];

  // 聚合站（推荐主用）：走本服务的 macCMS 兼容层
  sites.push(
    siteOf({
      key: "agg_all",
      name: "🎞 聚合全站",
      api: `${origin}/cms/all/api.php/provide/vod/`,
    })
  );
  sites.push(
    siteOf({
      key: "agg_4k",
      name: "🔥 4K专区",
      api: `${origin}/cms/4k/api.php/provide/vod/`,
    })
  );
  // 网盘 4K 源：真正的 4K 原盘（阿里/夸克/115/天翼）
  sites.push(buildPanSiteConfig(origin));
  // 社区网盘 jar 源：TVBox 生态里 4K 原盘的真实载体（客户端跑 spider）
  sites.push(
    siteOf({
      key: "pan_quark",
      name: "夸克网盘·4K原盘",
      api: "csp_PanQuark",
      ext: "",
    })
  );
  sites.push(
    siteOf({
      key: "pan_uc",
      name: "UC网盘·4K原盘",
      api: "csp_PanUC",
      ext: "",
    })
  );
  sites.push(
    siteOf({
      key: "pan_tianyi",
      name: "天翼云盘·4K",
      api: "csp_PanTianyi",
      ext: "",
    })
  );
  sites.push(
    siteOf({
      key: "pan_baidu",
      name: "百度网盘·资源",
      api: "csp_PanBaidu",
      ext: "",
    })
  );

  // jar：网盘插件依赖的 spider 运行时（实测可下载，1.8MB，qist/tvbox 活跃维护）
  const jar = "https://raw.githubusercontent.com/qist/tvbox/master/jar/spider.jar";

  // 直连源
  for (const s of sources) {
    if (s.direct === false) continue;
    sites.push(
      siteOf({
        key: s.key,
        name: s.name,
        api: s.api,
      })
    );
  }

  return {
    spider: jar,
    wallpaper: "",
    logo: "",
    sites,
    lives: [],
    parses: [],
    flags: ["youku", "qq", "iqiyi", "qiyi", "letv", "sohu", "tudou", "pptv", "mgtv", "wasu", "bilibili", "m3u8", "mp4"],
    ijk: [
      { group: "软解码", options: [{ name: "开启软解", flag: true }] },
      { group: "播放器", options: [{ name: "IJK播放器", flag: true }] },
    ],
    ads: [],
    rules: [],
    header: { "User-Agent": "Mozilla/5.0" },
    _note: {
      generated: new Date().toISOString(),
      aggregated: ["agg_all", "agg_4k", "pan_4k"],
      panJarSites: ["pan_quark", "pan_uc", "pan_tianyi", "pan_baidu"],
      direct: sources.filter((s) => s.direct !== false).length,
      sources_version: rawConfig?.version ?? 1,
    },
  };
}

export function buildMinimalConfig(origin, sources, rawConfig) {
  return {
    spider: "",
    wallpaper: "",
    logo: "",
    sites: [
      siteOf({ key: "agg_all", name: "🎞 聚合全站", api: `${origin}/cms/all/api.php/provide/vod/` }),
      siteOf({ key: "agg_4k", name: "🔥 4K专区", api: `${origin}/cms/4k/api.php/provide/vod/` }),
    ],
    lives: [],
    parses: [],
    flags: ["m3u8", "mp4"],
    ads: [],
    _note: { generated: new Date().toISOString(), mode: "lite" },
  };
}
