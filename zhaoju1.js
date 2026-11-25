var rule = {
	title:'找剧AI',
	host:'https://zhaoju1.com',
	homeUrl:'https://zhaoju1.com',
	url:'https://zhaoju1.com',
	searchUrl:'https://zhaoju1.com/v1/browse/catalog?q=**',
	searchable:2,
	quickSearch:0,
	headers:{'User-Agent':'Mozilla/5.0'},
	timeout:10000,
	// 逆向 HMAC-SHA256 签名：HMAC(secret, "METHOD\n/path?q\nts\nnonce")
	搜索:`js:
let S="8f18c8e472a9fefbab7108f5c447f69b48a4b5d34f662ed83163167fc10fb3b8";
let BASE="https://zhaoju1.com";
let VER="zhaoju-ai-v2026.11.22.1-default-directory-45542fa343be-web";
let PROTO="2026-07-05.library-v2.playback-v1";
function uid(){let s="",h="0123456789abcdef";for(let i=0;i<32;i++)s+=h[Math.floor(Math.random()*16)];return s;}
function signed(method,path,params,body){
	let q="";if(params){let a=[];for(let k in params)a.push(encodeURIComponent(k)+"="+encodeURIComponent(params[k]));q="?"+a.join("&");}
	let ts=String(Date.now()),nonce=uid();
	let NL=String.fromCharCode(10);
	let msg=method+NL+path+q+NL+ts+NL+nonce;
	let sig=CryptoJS.HmacSHA256(msg,S).toString(CryptoJS.enc.Hex);
	let H={"User-Agent":"Mozilla/5.0","x-ai-movie-timestamp":ts,"x-ai-movie-nonce":nonce,
		"x-ai-movie-signature":sig,"x-ai-movie-protocol-version":PROTO,
		"x-ai-movie-build-version":VER,"x-ai-movie-client-name":"movie-search-frontend",
		"x-ai-movie-client-version":"1.0.0"};
	let opt={headers:H,timeout:10000};
	if(method==="POST"){H["Content-Type"]="application/json";opt.method="POST";opt.body=JSON.stringify(body||{});}
	return request(BASE+path+q,opt,true);
}
let kw=KEY;
let d=[];
try{
	signed("POST","/v1/users/anonymous",null,{anonymous_id:"web_"+uid()});
	let tr=signed("POST","/v1/threads",null,{title:kw,metadata:{source:"session_search"}});
	let tj=JSON.parse(tr),tid=tj.id;
	let r=signed("GET","/v1/browse/catalog",{page:1,limit:30,query_mode:"fast_v3",thread_id:tid,search_fields:"all",q:kw});
	let j=JSON.parse(r),cards=j.cards||[];
	cards.forEach(function(c){
		d.push({
			title:c.title||"",
			img:c.poster_url||"",
			desc:(c.area||"")+" "+(c.year||""),
			content:"找剧AI资源",
			url:c.id||""
		});
	});
}catch(e){log("zhaoju search err:"+e);}
setResult(d);
`,
	二级:`js:
let id=input;
let d=[{title:"找剧AI",url:id}];
setResult(d);
`,
}
