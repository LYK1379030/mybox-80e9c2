/**
 * 聚合线分类体系（v2 层级版）
 *
 * 设计目标：把"几百个源站分类平铺"变成"8 个大区 + 二级子类"，
 * TVBox/影视仓的两级折叠直接可用。
 *
 * 结构：
 *   顶级 type_id = "m:电影" 形式（虚拟聚合，点击时跨源路由到各源的对应组）
 *   二级 type_id = "s:<源key>:<源type_id>"（单源精确路由）
 *
 * 语义归并：源站分类名 → 标准名（国产剧/内地剧 → 国产 等）。
 * 顶级点击路由：每个源最多查 1 个主类目（电影→查该源"电影片"组根类目），成本可控。
 */

// 顶级大区定义：标准名 → 匹配规则（对源站分类名做语义识别）
export const TOP_CATS = [
  {
    id: "movie", name: "🎬电影",
    // 该大区的匹配：分类名含这些词（不含"剧"）
    re: /电影|^动作片$|^喜剧片$|^爱情片$|^科幻片$|^恐怖片$|^剧情片$|^战争片$|^伦理片$|^记录片$|^纪录片$|^理论与实践|^理论片$/,
    // 二级归并规则：源名 → 标准子名
    subs: [
      { std: "动作", re: /动作|武打|枪战/ },
      { std: "喜剧", re: /喜剧/ },
      { std: "爱情", re: /爱情|浪漫/ },
      { std: "科幻", re: /科幻/ },
      { std: "恐怖", re: /恐怖|惊悚/ },
      { std: "剧情", re: /剧情|故事/ },
      { std: "战争", re: /战争|军事/ },
      { std: "伦理", re: /伦理|理论/ },
      { std: "动画电影", re: /动漫电影|动画电影/ },
    ],
  },
  {
    id: "tv", name: "📺剧集",
    re: /剧|连续剧/,
    subs: [
      { std: "国产", re: /国产|内地|大陆/ },
      { std: "港台", re: /香港|台湾|港澳|港台/ },
      { std: "韩国", re: /韩/ },
      { std: "日本", re: /日(?!本动漫)/ },
      { std: "欧美", re: /欧美|美剧|海外/ },
      { std: "泰国", re: /泰/ },
    ],
  },
  {
    id: "anime", name: "🌸动漫",
    re: /动漫|动画/,
    subs: [
      { std: "国产", re: /国产|中国/ },
      { std: "日韩", re: /日韩|日本/ },
      { std: "欧美", re: /欧美/ },
      { std: "港台", re: /港台/ },
    ],
  },
  { id: "variety", name: "🎤综艺", re: /综艺|真人秀|脱口秀/, subs: [] },
  { id: "doc", name: "🌍纪录", re: /纪录|记录| documentary /i, subs: [] },
  { id: "short", name: "📱短剧", re: /短剧|爽文/, subs: [] },
  { id: "sports", name: "⚽体育", re: /体育|NBA|足球|篮球|斯诺克/, subs: [] },
];

/** 虚拟分类（不需要源路由，走专门的聚合逻辑） */
export const VIRTUAL_TOP = [
  { id: "q4k", name: "🔥4K专区", pid: "0" },
  { id: "new", name: "🆕最新更新", pid: "0" },
];

/**
 * 把一个源站的分类列表映射进大区体系。
 * @returns {{topId: string, sub: {std: string, typeId: string, typeName: string} | null} | null}
 */
export function classifySourceCat(cat) {
  const name = String(cat.type_name || "").trim();
  if (!name) return null;
  for (const top of TOP_CATS) {
    if (!top.re.test(name)) continue;
    // 找二级归并
    let sub = null;
    for (const s of top.subs) {
      if (s.re.test(name)) {
        sub = { std: s.std, typeId: `s:${cat.source_key}:${cat.type_id}`, typeName: s.std };
        break;
      }
    }
    return { topId: top.id, sub };
  }
  return null;
}
