/*
 * 新6V磁力 (xb6v.com) - drpy2 搜索规则
 * 站是帝国CMS，搜索接口 /e/search/so.php (POST 表单)
 * 详情页提取 magnet 磁力链接作为播放地址
 */
var XB = 'https://www.xb6v.com';

function xbpost(kw) {
  var body = 'show=title&tempid=1&tbname=article&mid=1&dopost=search&keyboard=' + encodeURIComponent(kw);
  var H = {
    'User-Agent': 'Mozilla/5.0',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': XB + '/'
  };
  return req(XB + '/e/search/so.php', body, {headers: H, timeout: 12000});
}

function xbparse(str) {
  var s = String(str || '').replace(/<font[^>]*>|<\/font>/g, '');
  s = s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  s = s.replace(/<[^>]+>/g, '').trim();
  return s;
}

function home() {
  return JSON.stringify({
    class: [
      {type_id: 'movie', type_name: '电影'},
      {type_id: 'jilupian', type_name: '纪录片'},
      {type_id: 'kehuanpian', type_name: '科幻'}
    ],
    list: []
  });
}

function category(tid, pg) {
  pg = pg || 1;
  var path = tid === 'movie' ? '' : tid + '/';
  var url = XB + '/' + path;
  if (pg > 1) url = XB + '/' + path + 'list_' + pg + '.html';
  try {
    var html = req(url, {headers: {'User-Agent': 'Mozilla/5.0'}, timeout: 12000});
    var list = [];
    var re = /href="(\/[a-z]+\/\d+\.html)"[\s\S]{0,250}?<img src="([^"]+)"[^>]*alt="([^"]*)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var title = xbparse(m[3]);
      if (!title) continue;
      list.push({
        vod_id: XB + m[1],
        vod_name: title,
        vod_pic: m[2],
        vod_remarks: '6V磁力'
      });
    }
    return JSON.stringify({page: pg, pagecount: 99, limit: 20, total: 9999, list: list});
  } catch (e) {
    return JSON.stringify({page: pg, pagecount: 1, limit: 20, total: 0, list: []});
  }
}

function search(wd) {
  try {
    var html = xbpost(wd);
    var list = [];
    var seen = {};
    // title 属性里含 <font color='red'> 标签(带>)，不能靠 "a标签结束>" 定位。
    // 改用：href 后非贪婪跨到 <img，标题取 alt（font 用单引号，[^"]* 安全）。
    var re = /href="(\/[a-z]+\/\d+\.html)"[\s\S]{0,250}?<img src="([^"]+)"[^>]*alt="([^"]*)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var url = XB + m[1];
      if (seen[url]) continue;
      seen[url] = 1;
      var title = xbparse(m[3]);
      if (!title) continue;
      list.push({
        vod_id: url,
        vod_name: title,
        vod_pic: m[2],
        vod_year: '',
        vod_area: '',
        vod_remarks: '6V磁力',
        vod_content: '新6V磁力资源'
      });
    }
    return JSON.stringify({list: list});
  } catch (e) {
    return JSON.stringify({list: []});
  }
}

function detail(id) {
  try {
    var html = req(id, {headers: {'User-Agent': 'Mozilla/5.0'}, timeout: 12000});
    var title = '';
    var tm = html.match(/<title>([^<]+)<\/title>/i);
    if (tm) title = xbparse(tm[1]).replace(/\s*-[^-]*$/, '').trim();
    // 提取所有磁力链接
    var mags = [];
    var mre = /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}[^"'\s<>]*/g;
    var mm;
    while ((mm = mre.exec(html)) !== null) {
      var u = mm[0].replace(/&amp;/g, '&');
      if (mags.indexOf(u) < 0) mags.push(u);
    }
    // 提取封面
    var pic = '';
    var pm = html.match(/<img src="(https?:\/\/[^"]+)"/);
    if (pm) pic = pm[1];
    var playUrl = '';
    if (mags.length) {
      // 多磁力用 # 分隔；每个以标题命名
      var segs = [];
      for (var i = 0; i < mags.length; i++) segs.push((title || '资源') + (mags.length > 1 ? (i + 1) : '') + '$' + mags[i]);
      playUrl = segs.join('#');
    }
    var vlist = [{
      vod_id: id,
      vod_name: title,
      vod_pic: pic,
      vod_play_from: '6V磁力',
      vod_play_url: playUrl || '暂无磁力$' + id
    }];
    return JSON.stringify({list: vlist});
  } catch (e) {
    return JSON.stringify({list: []});
  }
}

function play(flag, id, flags) { return id; }
