/*
 * 新6V磁力 (xb6v.com) - drpy2 规则 (var rule 声明式格式)
 * drpy2约定: js脚本结果写 VODS 数组; searchUrl 用 url;post;params
 */
var rule = {
    title: '新6V磁力',
    host: 'https://www.xb6v.com',
    url: '/donghuapian/',
    searchUrl: 'https://www.xb6v.com/e/search/so.php;post;show=title&tempid=1&tbname=article&mid=1&dopost=search&keyboard=**',
    headers: {'User-Agent': 'MOBILE_UA', 'Content-Type': 'application/x-www-form-urlencoded'},
    timeout: 8000,
    class_name: '电影&纪录片&科幻&动画',
    class_url: 'dianyingpian&jilupian&kehuanpian&donghuapian',
    searchable: 1,
    quickSearch: 1,
    play_parse: true,
    一级: 'js:let h=input;' +
        'let re=/href="(\\/[a-z]+\\/\\d+\\.html)"[\\s\\S]{0,250}?<img src="([^"]+)"[^>]*alt="([^"]*)"/g;' +
        'let m,vs=[];' +
        'while((m=re.exec(h))!==null){' +
        'let t=(m[3]||"").replace(/<[^>]+>/g,"").trim();' +
        'if(!t)continue;' +
        'vs.push({vod_id:urljoin(input,m[1]),vod_name:t,vod_pic:m[2],vod_remarks:"6V磁力"});' +
        '}' +
        'VODS=vs;',
    搜索: 'js:let h=input;' +
        'let re=/href="(\\/[a-z]+\\/\\d+\\.html)"[\\s\\S]{0,250}?<img src="([^"]+)"[^>]*alt="([^"]*)"/g;' +
        'let m,vs=[],seen={};' +
        'while((m=re.exec(h))!==null){' +
        'let u="https://www.xb6v.com"+m[1];' +
        'if(seen[u])continue;seen[u]=1;' +
        'let t=(m[3]||"").replace(/<[^>]+>/g,"").trim();' +
        'if(!t)continue;' +
        'vs.push({vod_id:u,vod_name:t,vod_pic:m[2],vod_remarks:"6V磁力"});' +
        '}' +
        'VODS=vs;',
    二级: 'js:let h=input;' +
        'let tm=h.match(/<title>([^<]+)<\\/title>/i);' +
        'let t=tm?tm[1].replace(/\\s*-[^-]*$/, "").trim():"6V资源";' +
        'let pm=h.match(/<img src="(https?:\\/\\/[^"]+)"/);' +
        'let pic=pm?pm[1]:"";' +
        'let re=/magnet:\\?xt=urn:btih:[0-9a-fA-F]{40}[^"\'\\s<>]*/g;' +
        'let m,mags=[];' +
        'while((m=re.exec(h))!==null){let u=m[0].replace(/&amp;/g,"&");if(mags.indexOf(u)<0)mags.push(u);}' +
        'let pl="";' +
        'if(mags.length){let seg=[];for(let i=0;i<mags.length;i++)seg.push(t+(mags.length>1?(i+1):"")+"$"+mags[i]);pl=seg.join("#");}' +
        'VOD={vod_id:input,vod_name:t,vod_pic:pic,vod_play_from:"6V磁力",vod_play_url:pl||"暂无$"+input};',
}
