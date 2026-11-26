/**
 * Cloudflare Worker: 把 xb6v.com（帝国CMS，高清片源）转换成苹果CMS标准JSON接口
 * 让任意 TVBox/影视仓/FongMi 客户端能直接搜索并播放高清片源
 *
 * 部署：https://dash.cloudflare.com → Workers & Pages → Create Worker → 粘贴本文件 → Deploy
 * 免费额度：每天10万次请求，无需信用卡
 *
 * 接口用法：
 *   https://你的worker域名.workers.dev/?ac=detail&wd=流浪地球
 *   https://你的worker域名.workers.dev/?ac=detail&ids=片ID
 *   https://你的worker域名.workers.dev/?ac=list
 */

const SITE = 'https://www.xb6v.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

// 成人分类黑名单——纯净版绝不返回这些
const ADULT = /伦理|三级|理论|福利|写真|两性|擦边|情色|成人|无码|里番|艳|肉|偷拍|自拍|调教|私房|裸|性爱|乱伦|强奸|丝袜|制服|SM|口交|群交|人兽|萝莉|御宅|同人/;

// 帝国CMS分类 → 苹果CMS type 映射（只保留正常分类）
const CAT_MAP = {
  '电影':'1','电视剧':'2','综艺':'3','动漫':'4','动作片':'6','喜剧片':'7','爱情片':'8',
  '科幻片':'9','恐怖片':'10','剧情片':'11','战争片':'12','国产剧':'13','欧美剧':'14',
  '韩剧':'15','日剧':'16','港剧':'17','台剧':'18','电视剧':'19','纪录片':'20','动画片':'39',
  'jilupian':'20','kehuanpian':'9','donghuapian':'39','dianyingpian':'1','dianshiju':'2',
  'ZongYi':'3','xijupian':'7','dongzuopian':'6','aiqingpian':'8','kongbupian':'10',
  'juqingpian':'11','zhanzhengpian':'12'
};

function isAdult(s){ return ADULT.test(String(s||'')); }

// HTML 实体/标签清理
function clean(s){
  return String(s||'')
    .replace(/<font[^>]*>|<\/font>/gi,'')
    .replace(/<[^>]+>/g,'')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .trim();
}
function attr(html, tag, name){
  const m = html.match(new RegExp('<'+tag+'[^>]*\\b'+name+'="([^"]*)"','i'));
  return m ? m[1] : '';
}

export default {
  async fetch(request, env, ctx){
    try {
      const url = new URL(request.url);
      const ac = url.searchParams.get('ac') || 'list';
      const wd = url.searchParams.get('wd') || '';
      const ids = url.searchParams.get('ids') || '';
      const pg = parseInt(url.searchParams.get('pg')||'1');

      if (ac === 'list'){
        const list = Object.keys(CAT_MAP).filter(k=>!/[a-z]/.test(k)).map((k,i)=>({
          type_id: CAT_MAP[k], type_name: k
        }));
        return json({code:1,msg:'ok',page:1,pagecount:1,limit:20,total:list.length,class:list,list:[]});
      }

      if (ac === 'detail' && wd){
        const html = await searchPage(wd, pg);
        const list = parseList(html);
        return json({code:1,msg:'ok',page:pg,pagecount:5,limit:20,total:list.length,list});
      }

      if (ac === 'detail' && ids){
        const html = await detailPage(ids);
        const vod = parseDetail(ids, html);
        return json({code:1,msg:'ok',page:1,pagecount:1,limit:1,total:1,list:[vod]});
      }

      return json({code:0,msg:'need ac=detail&wd= keyword or ac=list',list:[]});
    } catch(e){
      return json({code:0,msg:'error: '+e.message,list:[]});
    }
  }
};

function json(obj){
  return new Response(JSON.stringify(obj),{
    headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-cache'}
  });
}

async function searchPage(kw, pg){
  const body = new URLSearchParams({
    show:'title', tempid:'1', tbname:'article', mid:'1',
    dopost:'search', submit:'', keyboard:kw, page:String(pg)
  });
  const r = await fetch(SITE+'/e/search/so.php',{
    method:'POST', headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded','Referer':SITE+'/'},
    body:body.toString()
  });
  return await r.text();
}

async function detailPage(id){
  // id 形如 /jilupian/123.html 或完整URL
  const u = id.startsWith('http') ? id : SITE + (id.startsWith('/')?id:'/'+id);
  const r = await fetch(u,{headers:{'User-Agent':UA,'Referer':SITE+'/'}});
  return await r.text();
}

function parseList(html){
  const out = [];
  const re = /href="(\/[a-z]+\/\d+\.html)"[\s\S]{0,900}?<img src="([^"]+)"[^>]*alt="([^"]*)"/g;
  let m, seen = {};
  while ((m = re.exec(html)) !== null){
    const title = clean(m[3]);
    if (!title || isAdult(title)) continue;
    const id = m[1];
    if (seen[id]) continue; seen[id]=1;
    let pic = m[2];
    if (pic.startsWith('/')) pic = SITE + pic;
    // 从路径猜分类
    const cm = id.match(/\/([a-z]+)\//);
    const cate = cm ? (CAT_MAP[cm[1]]||'1') : '1';
    out.push({
      vod_id: id,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: '高清',
      type_id: cate,
      vod_year: '',
      vod_area: '',
      vod_content: ''
    });
  }
  return out;
}

function parseDetail(id, html){
  const tm = html.match(/<title>([^<]+)<\/title>/i);
  const title = clean(tm ? tm[1].split(/[-_]/)[0] : '影视');
  const pm = html.match(/<img src="(https?:\/\/[^"]+)"/);
  const pic = pm ? pm[1] : '';

  // 提取所有播放链接：magnet / ed2k / 网盘 / m3u8
  const links = [];
  const re = /(magnet:\?xt=urn:btih:[0-9a-fA-F]{40}[^"'<>\s]*|ed2k:\/\/\|file\|[^"'<>\s]+|https?:\/\/(?:pan\.quark\.cn|www\.aliyundrive\.com|www\.alipan\.com)\/s\/[^"'<>\s]+|https?:\/\/[^"'<>\s]+\.m3u8[^"'<>\s]*)/g;
  let m;
  while ((m = re.exec(html)) !== null){
    let u = m[1].replace(/&amp;/g,'&');
    if (isAdult(u)) continue;
    if (!links.some(x=>x.url===u)) links.push({name:(links.length+1)+'线',url:u});
  }

  const playFrom = links.length ? links.map(x=>x.name).join('$$$') : '暂无';
  const playUrl  = links.length ? links.map(x=>x.name+'$'+x.url).join('#') : '暂无线路$'+id;

  return {
    vod_id: id,
    vod_name: title,
    vod_pic: pic,
    vod_remarks: '高清',
    vod_play_from: playFrom,
    vod_play_url: playUrl,
    vod_content: clean((html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]{0,600}?)<\/div>/i)||[])[1]||'').slice(0,300)
  };
}
