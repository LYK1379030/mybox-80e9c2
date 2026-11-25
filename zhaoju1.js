/*
 * zhaoju1.com (找剧AI) - drpy2 规则
 * 逆向签名: HMAC-SHA256(secret, "METHOD\n/path?q\nts\nnonce")
 * 签约头: x-ai-movie-timestamp/nonce/signature + 固定头
 * 流程: anonymous -> threads -> browse/catalog(搜索) -> 详情
 */
var ZJ_SECRET = '8f18c8e472a9fefbab7108f5c447f69b48a4b5d34f662ed83163167fc10fb3b8';
var ZJ_BASE = 'https://zhaoju1.com';
var ZJ_VER = 'zhaoju-ai-v2026.11.22.1-default-directory-45542fa343be-web';
var ZJ_PROTO = '2026-07-05.library-v2.playback-v1';
var _zj_init = 0;

function zjuuid() {
  var s = '', h = '0123456789abcdef';
  for (var i = 0; i < 32; i++) s += h[Math.floor(Math.random() * 16)];
  return s;
}
function zjhmac(msg) {
  // drpy2 内置 CryptoJS，同步 HMAC-SHA256
  return CryptoJS.HmacSHA256(msg, ZJ_SECRET).toString(CryptoJS.enc.Hex);
}
function zjreq(method, path, params, body) {
  var q = '';
  if (params) {
    var arr = [];
    for (var k in params) arr.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    q = '?' + arr.join('&');
  }
  var ts = String(Date.now());
  var nonce = zjuuid();
  var msg = method + '\n' + path + q + '\n' + ts + '\n' + nonce;
  var sig = zjhmac(msg);
  var headers = {
    'User-Agent': 'Mozilla/5.0',
    'x-ai-movie-timestamp': ts,
    'x-ai-movie-nonce': nonce,
    'x-ai-movie-signature': sig,
    'x-ai-movie-protocol-version': ZJ_PROTO,
    'x-ai-movie-build-version': ZJ_VER,
    'x-ai-movie-client-name': 'movie-search-frontend',
    'x-ai-movie-client-version': '1.0.0'
  };
  var url = ZJ_BASE + path + q;
  var opt = {headers: headers, timeout: 12000};
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    return req(url, JSON.stringify(body || {}), opt);
  }
  return req(url, opt);
}
function zjsearch(kw, pg) {
  pg = pg || 1;
  if (!_zj_init) {
    zjreq('POST', '/v1/users/anonymous', null,
      {anonymous_id: 'web_' + zjuuid()});
    _zj_init = 1;
  }
  var t = zjreq('POST', '/v1/threads', null,
    {title: kw, metadata: {source: 'session_search'}});
  var tj = JSON.parse(t);
  var tid = tj.id;
  var r = zjreq('GET', '/v1/browse/catalog', {
    page: pg, limit: 30, query_mode: 'fast_v3',
    thread_id: tid, search_fields: 'all', q: kw
  });
  var j = JSON.parse(r);
  var cards = j.cards || [];
  var list = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    list.push({
      vod_id: c.id,
      vod_name: c.title,
      vod_pic: c.poster_url || '',
      vod_year: String(c.year || ''),
      vod_area: c.area || '',
      vod_remarks: '找剧AI',
      vod_actor: (c.actors || []).join(','),
      vod_content: '找剧AI资源'
    });
  }
  return list;
}

function home() {
  return JSON.stringify({class: [{type_id: '1', type_name: '找剧AI'}], list: []});
}

function category(tid, pg) {
  return JSON.stringify({page: pg, pagecount: 1, limit: 30, total: 0, list: []});
}

function search(wd) {
  try {
    var list = zjsearch(wd, 1);
    return JSON.stringify({list: list});
  } catch (e) {
    return JSON.stringify({list: []});
  }
}

function detail(id) {
  try {
    // 播放走AI会话action签发的ticket，TVBox端需二次resolve；
    // 搜索已完整可用，详情返回提示，避免"能搜不能播"的静默失败。
    var vlist = [{
      vod_id: id,
      vod_name: '找剧AI',
      vod_play_from: '找剧AI',
      vod_play_url: '请在找剧AI应用内播放$' + ZJ_BASE + '/session/' + id
    }];
    return JSON.stringify({list: vlist});
  } catch (e) {
    return JSON.stringify({list: []});
  }
}

function play(flag, id, flags) { return id; }
