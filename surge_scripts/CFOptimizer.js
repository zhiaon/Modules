var CFEngine = (function () {
  'use strict';
  const host = 'speed.cloudflare.com', key = 'CFOptimizer.VerifiedRanges.v1';
  const sources = ['https://www.cloudflare.com/ips-v4','https://www.cloudflare.com/ips-v6'];
  const defaults = Object.freeze({family:'both',count:8,seed:null,exclude:Object.freeze([]),rounds:3,bytes:65536,timeout:4});
  const capabilities = Object.freeze({candidateBinding:false,domainBaseline:true});
  const day = 86400000, trusted = new WeakSet();
  let updating, used = false, memory;
  function fail(msg) { throw new Error(msg); }
  function integer(x,d,lo,hi) { const n = Number(x == null ? d : x); return Number.isSafeInteger(n) ? Math.max(lo,Math.min(hi,n)) : d; }
  function addr(s) {
    if (typeof s !== 'string' || !s || s.length > 48) fail('invalid-ip');
    if (!s.includes(':')) {
      const a = s.split('.');
      if (a.length !== 4 || a.some(x=>! /^(0|[1-9]\d{0,2})$/.test(x) || +x > 255)) fail('invalid-ipv4');
      return {w:32,n:a.reduce((v,x)=>(v<<8n)|BigInt(x),0n)};
    }
    const p = s.toLowerCase().split('::');
    const parts = x=>x ? x.split(':') : [];
    const a = parts(p[0]), b = parts(p[1]);
    if (p.length > 2 || [...a,...b].some(x=>! /^[a-f0-9]{1,4}$/.test(x)) ||
        (p.length===1 ? a.length!==8 : a.length+b.length>=8)) fail('invalid-ipv6');
    const words = a.concat(Array(8-a.length-b.length).fill('0'),b);
    return {w:128,n:words.reduce((v,x)=>(v<<16n)|BigInt('0x'+x),0n)};
  }
  function fmt(w,n) {
    if (w===32) return [24n,16n,8n,0n].map(k=>String((n>>k)&255n)).join('.');
    const a = Array.from({length:8},(_,i)=>((n>>BigInt((7-i)*16))&65535n).toString(16));
    let at=-1,len=1;
    for (let i=0;i<8;) { if (a[i]!=='0') {i++;continue;} let j=i+1; while(j<8&&a[j]==='0') j++; if(j-i>len){at=i;len=j-i;} i=j; }
    return at<0 ? a.join(':') : a.slice(0,at).join(':')+'::'+a.slice(at+len).join(':');
  }
  function net(s, exact) {
    if (typeof s!=='string') fail('invalid-range');
    const p=s.split('/'), a=addr(p[0]);
    if (p.length>2 || (exact&&p.length!==2) || (p.length===2&&!/^(0|[1-9]\d{0,2})$/.test(p[1]))) fail('invalid-prefix');
    const len=p.length===2?+p[1]:a.w; if (len>a.w) fail('invalid-prefix');
    const span=1n<<BigInt(a.w-len), n=(a.n/span)*span;
    if (exact && n!==a.n) fail('misaligned-range');
    return {w:a.w,n,end:n+span-1n,len,text:fmt(a.w,n)+'/'+len};
  }
  // Safety ceiling only; NEVER used as a fallback source of candidates.
  const ceiling=('173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32').split(' ').map(s=>net(s,true));
  function validate(list,w) {
    if (!Array.isArray(list)||!list.length||list.length>128) fail('invalid-list');
    const result=new Set();
    for (const s of list) { const r=net(s,true);
      if (r.w!==w || !ceiling.some(c=>c.w===w && r.n>=c.n && r.end<=c.end)) fail('range-outside-reviewed-ceiling');
      result.add(r.text);
    }
    return Object.freeze(Array.from(result));
  }
  function release(c,source) {
    if (!c || c.schema!==1 || !Number.isSafeInteger(c.fetchedAt) || Date.now()<c.fetchedAt || Date.now()-c.fetchedAt>7*day) fail('invalid-cache');
    const r=Object.freeze({v4:validate(c.v4,32),v6:validate(c.v6,128),fetchedAt:c.fetchedAt,source}); trusted.add(r);return r;
  }
  function canRequest() {
    if (typeof $environment!=='object' || !/^ios$/i.test($environment.system||'')) return false;
    const m=/^(\d+)\.(\d+)/.exec(String($environment['surge-version']||''));
    return !!m && (+m[1]>5 || (+m[1]===5&&+m[2]>=9)) && typeof $httpClient==='object' && typeof $httpClient.get==='function';
  }
  function get(url,binary,timeout) {
    if (!canRequest()) fail('supported-surge-ios-required');
    return new Promise((resolve,reject)=>$httpClient.get({url,timeout,policy:'DIRECT',insecure:false,'auto-redirect':false,'auto-cookie':false,'binary-mode':binary,headers:{'Cache-Control':'no-cache','Accept-Encoding':'identity'}},(err,res,data)=>{
      if (err||!res) return reject(new Error('request-failed'));
      if (+res.status!==200) return reject(new Error('http-'+(+res.status||0)));
      const h={}; for(const k of Object.keys(res.headers||{})) h[k.toLowerCase()]=String(res.headers[k]);
      resolve({h,data});
    }));
  }
  async function load(force) {
    let saved;
    try { const raw=typeof $persistentStore==='object' && $persistentStore.read(key); const c=memory || (typeof raw==='string'&&raw.length<=32768&&JSON.parse(raw)); saved=release(c,'cache'); } catch (_) {}
    if (!force && saved && Date.now()-saved.fetchedAt<day) return saved;
    try {
      const lists=await Promise.all(sources.map(async (url,i)=>{
        const {h,data}=await get(url,false,5);
        if (typeof data!=='string'||data.length>16384||!/^text\/plain(?:\s*;|$)/i.test(h['content-type']||'')) fail('invalid-range-response');
        return validate(data.trim().split(/\r?\n/).map(x=>x.trim()),i?128:32);
      }));
      const c={schema:1,v4:lists[0],v6:lists[1],fetchedAt:Date.now()}; const r=release(c,'live'); memory=c;
      try { $persistentStore.write(JSON.stringify(c),key); } catch (_) {} return r;
    } catch (err) { if (!saved) throw err; return release({schema:1,...saved},'stale-cache'); }
  }
  async function update(force=false) { if (updating) return updating; updating=load(force===true);try{return await updating;}finally{updating=null;} }
  function candidates(ranges,cfg={}) {
    if (!trusted.has(ranges) || Date.now()<ranges.fetchedAt || Date.now()-ranges.fetchedAt>7*day) fail('verified-ranges-required');
    const f=cfg.family||'both'; if (!['v4','v6','both'].includes(f)) fail('invalid-family');
    const e=cfg.exclude==null?[]:cfg.exclude; if (!Array.isArray(e)||e.length>256) fail('invalid-exclusions');
    const ex=e.map(s=>net(s,false)); const count=integer(cfg.count,defaults.count,1,1000);
    let state=2166136261; const seed=String(cfg.seed==null?Math.random()+':'+Date.now():cfg.seed);
    if (seed.length>256) fail('seed-too-long');
    for (let i=0;i<seed.length;i++) state=Math.imul(state^seed.charCodeAt(i),16777619)>>>0;
    function word() { state=(state+0x6d2b79f5)>>>0; let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return (t^(t>>>14))>>>0; }
    const pools=(f==='both'?[ranges.v4,ranges.v6]:[ranges[f]]).map(arr=>arr.map(s=>net(s,true)).filter(r=>!ex.some(x=>x.w===r.w&&x.n<=r.n&&x.end>=r.end))).filter(a=>a.length);
    const seen=new Set(); if (!pools.length) return [];
    const start=word()%pools.length;
    for (let i=0;i<64*count && seen.size<count;i++) {
      const a=pools[(i+start)%pools.length], r=a[word()%a.length]; let rand=0n;
      for(let j=0;j<r.w-r.len;j+=32) rand=(rand<<32n)|BigInt(word());
      const n=r.n+(rand&(r.end-r.n)); if (r.w===32&&r.len<=30&&(n===r.n||n===r.end)) continue;
      if (ex.some(x=>x.w===r.w&&x.n<=n&&x.end>=n)) continue; seen.add(fmt(r.w,n));
    }
    return Array.from(seen);
  }
  function median(a) { const s=a.slice().sort((x,y)=>x-y),i=s.length>>1;return s.length%2?s[i]:(s[i-1]+s[i])/2; }
  function now() { return typeof performance==='object'&&typeof performance.now==='function'?performance.now():Date.now(); }
  async function sample(n,timeout) {
    const t=now(),{h,data}=await get('https://'+host+'/__down?bytes='+String(n),true,timeout),ms=now()-t;
    if (!(ms>0) || !Number.isFinite(ms)) fail('unusable-timer');
    if (Object.prototype.toString.call(data)!=='[object Uint8Array]' || data.byteLength!==n || !/^application\/octet-stream(?:\s*;|$)/i.test(h['content-type']||'') || (h['content-length']!==undefined && h['content-length']!==String(n)) || (h['content-encoding']&&!/^identity$/i.test(h['content-encoding']))) fail('unexpected-download');
    const ray=/^[a-f\d]+-([A-Z]{3})$/i.exec(h['cf-ray']||'');
    if (!ray && !/\bcfSpeed(?:Edge|Worker)\b/i.test(h['server-timing']||'')) fail('missing-speed-service-evidence');
    const c=h['cf-meta-colo']||h.colo||'';return {ms,bytes:data.byteLength,colo:/^[A-Z]{3}$/.test(c)?c:(ray?ray[1].toUpperCase():null)};
  }
  async function baseline(cfg={},stopped=()=>false) {
    const r={ok:false,scope:'domain-baseline',ip:null,host,attempts:0,successes:0,samplesMs:[],medianMs:null,jitterMs:null,lossPct:null,bytes:0,downloadMs:null,mbps:null,colo:null,reason:null};
    const stop=()=>typeof stopped==='function'&&stopped(); const bad=m=>Object.assign(r,{ok:false,mbps:null,reason:m});
    if(stop()) return bad('stopped'); if(used) return bad('baseline-already-used'); used=true;
    if(!canRequest()) return bad('supported-surge-ios-required');
    const rounds=integer(cfg.rounds,defaults.rounds,1,3), timeout=integer(cfg.timeout,defaults.timeout,1,8);
    const bytes=integer(cfg.bytes,defaults.bytes,16384,262144); let last='no-successful-samples';
    for(let i=0;i<rounds;i++) {
      if(stop()) return bad('stopped'); r.attempts++;
      try { const s=await sample(1,timeout);r.successes++;r.samplesMs.push(s.ms);r.colo=s.colo; }
      catch(e) {last=e.message;}
      r.lossPct=(r.attempts-r.successes)*100/r.attempts;
      if(r.successes) r.medianMs=median(r.samplesMs);
      if(r.successes>=2) r.jitterMs=median(r.samplesMs.slice(1).map((x,j)=>Math.abs(x-r.samplesMs[j])));
    }
    if(stop()) return bad('stopped');if(!r.successes) return bad(last);
    try {
      const s=await sample(bytes,timeout);r.bytes=s.bytes;r.downloadMs=s.ms;r.colo=s.colo;
      if(stop()) return bad('stopped'); r.mbps=s.bytes*8/(s.ms*1000);r.ok=true;return r;
    }catch(e){return bad(stop()?'stopped':e.message);}
  }
  async function measure(ip,cfg={},stopped=()=>false) {
    if(ip===null) return baseline(cfg,stopped);
    const unavailable={ok:false,scope:'candidate',ip:null,reason:'binding-unavailable'};
    try {const a=addr(ip);unavailable.ip=fmt(a.w,a.n);}catch(_){unavailable.reason='invalid-ip';}
    return unavailable;
  }
  return Object.freeze({defaults,capabilities,update,candidates,measure,baseline});
})();

(async function(){
 'use strict';
 const KEY='CFOptimizer.state.v3', PIN='CFOptimizer.pin.v1';
 const P=f=>new Promise(r=>f(r));
 const ARG=String(typeof $argument==='undefined'?'':$argument).split('|');
 const PARAM_COUNT=(function(){var n=parseInt(String(ARG[0]||'').trim(),10);return Number.isFinite(n)&&n>=1&&n<=500?n:10})();
 const read=()=>{try{const s=JSON.parse($persistentStore.read(KEY)||'{}');return s&&typeof s==='object'?s:{}}catch(_){return {}}};
 const save=s=>$persistentStore.write(JSON.stringify(s),KEY)!==false;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const nowMs=()=>Date.now();
 const num=(x,d,a,b)=>Number.isInteger(+x)&&String(x).trim()!==''?Math.max(a,Math.min(b,+x)):d;
 function api(method,path){return P(r=>$httpAPI(method,path,null,x=>r(x||{})))}
 function get(url,bin,timeout,policy){return P(r=>{const t=nowMs();$httpClient.get({url,timeout,policy,'insecure':false,'auto-redirect':false,'auto-cookie':false,'binary-mode':!!bin,headers:{'Cache-Control':'no-cache','Accept-Encoding':'identity'}},function(e,x,d){r({err:e?String(e).slice(0,90):null,status:x?+x.status:0,data:d,ms:nowMs()-t})})})}
 async function recs(){const r=await api('GET','/v1/requests/recent?filter=speed.cloudflare.com&limit=20');return r.requests||[]}
 const hostOk=x=>x&&String(x.remoteHost||'').indexOf('speed.cloudflare.com')===0;
 async function directPeer(ip){return (await recs()).some(x=>hostOk(x)&&x.remoteAddress===ip)}
 async function pinIp(ip){if($persistentStore.write(ip,PIN)===false)throw Error('pin-store-failed');await api('POST','/v1/dns/flush');await sleep(180)}
 const clearPin=()=>{try{$persistentStore.write('none',PIN)}catch(_){}}
 async function probe(ip,cfg,mode,policy){
  const r={ip:mode==='proxy'?'':ip,mode,policy:mode==='proxy'?policy:null,version:ip.indexOf(':')>=0?'IPv6':'IPv4',tries:0,ok:0,samples:[],avg:null,min:null,max:null,mbps:null,bytes:0,downloadMs:null,colo:null,verified:false,verify:'none',peer:null,status:'unavailable',reason:null,time:nowMs()};
  const pol=mode==='proxy'?policy:'DIRECT';
  for(let i=0;i<cfg.tries;i++){
   r.tries++;
   try{
    if(mode==='direct')await pinIp(ip);
    const t0=nowMs();
    const t=await get('https://speed.cloudflare.com/cdn-cgi/trace',false,cfg.timeout,pol);
    if(t.status!==200)throw Error(t.err||('http-'+t.status));
    const list=await recs();
    const fresh=list.filter(x=>hostOk(x)&&(x.startDate||0)>=(t0/1000-1));
    const hit=mode==='direct'?fresh.find(x=>x.remoteAddress===ip):fresh.sort((a,b)=>(b.startDate||0)-(a.startDate||0))[0];
    if(mode==='direct'&&!hit)throw Error('peer-mismatch');
    r.peer=hit?hit.remoteAddress:null;r.policy=hit&&hit.policyName?hit.policyName:r.policy;
    r.verified=mode==='direct';r.verify=mode==='direct'?'ip':'line';
    r.ok++;r.samples.push(t.ms);
    const c=/(?:^|\n)colo=([A-Z]{3})/.exec(String(t.data||''));if(c)r.colo=c[1];
    if(cfg.download&&r.mbps===null){
     const d=await get('https://speed.cloudflare.com/__down?bytes=65536',true,Math.max(cfg.timeout,5),pol);
     const b=d.data&&d.data.byteLength||0;
     if(d.status===200&&b===65536&&d.ms>0){r.bytes=b;r.downloadMs=d.ms;r.mbps=b*8/(d.ms*1000)}
    }
   }catch(e){r.reason=String(e.message||e).slice(0,70)}
  }
  if(r.samples.length){r.min=Math.min(...r.samples);r.max=Math.max(...r.samples);r.avg=r.samples.reduce((a,b)=>a+b,0)/r.samples.length}
  r.success=r.tries?r.ok/r.tries:0;r.status=r.ok>0?'ok':'unavailable';r.time=nowMs();
  return r;
 }
 function fmtMs(v){return Number.isFinite(v)?Math.round(v)+' ms':'—'}
 function fmtSp(v){return Number.isFinite(v)&&v>0?v.toFixed(3)+' MB/s':'—'}
 function bar(a,b){var n=8,t=b>0?Math.round(a/b*n):0;return '▰'.repeat(Math.max(0,Math.min(n,t)))+'▱'.repeat(Math.max(0,n-t))}
 function bestOf(a){return a.length?a.slice().sort(function(x,y){return x.avg-y.avg})[0]:null}
 function info(s){
  var d=(s.direct||[]).filter(function(x){return x.status==='ok'});
  var p=(s.proxy||[]).filter(function(x){return x.status==='ok'});
  var bd=bestOf(d),bp=bestOf(p);
  var done=s.done||0,total=s.total||0,st=s.status||'idle';
  var pct=total?Math.round(done/total*100):0;
  var cfg=s.cfg||{};
  var mode=cfg.mode==='proxy'?('PROXY'+(cfg.policy?' · '+cfg.policy:'')):'DIRECT 直连';
  var out=[];
  out.push('━ 直连 ━ '+(d.length?('✅ '+d.length+' 可用'):'—'));
  if(bd)out.push('   最佳  '+bd.ip+'\n   '+fmtMs(bd.avg)+' ・ '+fmtSp(bd.mbps));
  out.push('');
  out.push('━ 代理 ━ '+(p.length?('✅ '+p.length+' 线路'):'—'));
  if(bp)out.push('   最佳  '+(bp.policy||'')+'\n   '+fmtMs(bp.avg)+' ・ '+fmtSp(bp.mbps));
  out.push('');
  out.push((st==='running'?'⏳ 进行中':'🕒 '+st)+'   '+bar(done,total)+' '+done+'/'+total+' ('+pct+'%)');
  if(st==='running'&&s.current)out.push('   正在 '+s.current);
  out.push('⚙ '+(cfg.count||s.paramCount||PARAM_COUNT)+' 候选 ・ 每 IP '+(cfg.tries||2)+' 次 ・ 超时 '+(cfg.timeout||5)+'s');
  out.push('🌐 '+mode+(s.updated?' ・ 网段 '+new Date(s.updated).toLocaleString():''));
  if(s.error)out.push('⚠ '+String(s.error).slice(0,60));
  out.push('');
  out.push('点右上角进入工作台 →');
  return out.join('\n');
 }
 function reply(status,body,ct){$done({response:{status,headers:{'Content-Type':ct||'application/json; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"},body:typeof body==='string'?body:JSON.stringify(body)}})}
 const ORIGIN='http://cfoptimizer.invalid';
 const VER='3.7.2';
 if(typeof $request==='undefined'){
  if(typeof $trigger!=='undefined'&&$trigger==='button')$notification.post('CF IP 优选工具','双模式测速','点击打开工作台，选择 DIRECT 或 PROXY 后点「开始优选」。不会后台自动测速。',{url:ORIGIN+'/?v='+VER});
  const s=read();
  return $done({title:'CF IP 优选工具',content:info(s),style:'info'})
 }
 try{
  const url=String($request.url);if(!/^https?:\/\/cfoptimizer\.invalid(?:\/|$)/.test(url))return reply(403,{error:'非本地入口'});
  const path=(url.replace(/^https?:\/\/cfoptimizer\.invalid/,'')||'/').split('?')[0],method=$request.method,h={};Object.keys($request.headers||{}).forEach(k=>h[k.toLowerCase()]=$request.headers[k]);
  if(h.host&&h.host!==ORIGIN.slice(7))return reply(403,{error:'Host 不匹配：'+h.host,type:'host-mismatch',hint:'请用 '+ORIGIN.slice(7)+' 打开'});
  if(h.origin&&!/^https?:\/\/cfoptimizer\.invalid$/.test(h.origin))return reply(403,{error:'跨站请求被拒绝',type:'origin-rejected',origin:h.origin,target:'cfoptimizer.invalid',hint:'仅允许本机工作台自身发起的请求'});
  let s=read();s.direct=s.direct||[];s.proxy=s.proxy||[];s.cfg=s.cfg||{};
  if(path==='/api/ping')return reply(200,{ok:true,ts:nowMs(),paramCount:PARAM_COUNT});
  if(path==='/api/state'&&method==='GET'){console.log('STATE param='+PARAM_COUNT+' raw='+String(typeof $argument==='undefined'?'none':$argument));s.paramCount=PARAM_COUNT;if(s.status==='running'&&(!s.lastTick||nowMs()-s.lastTick>120000)){s.status='stopped';s.error=s.error||'任务已超时停止';clearPin()}s.running=s.status==='running';if(!s.running){clearPin();s.cfg=s.cfg||{};s.cfg.count=PARAM_COUNT}return reply(200,s)}
  if(path==='/api/policies'&&method==='GET'){
   const r=await api('GET','/v1/policy_groups');const g=Object.keys(r||{}).filter(k=>Array.isArray(r[k])).sort();
   return reply(200,{policies:g})
  }
  if(method!=='POST'||h['x-cf-local']!=='1'||!['/api/start','/api/batch','/api/stop'].includes(path))return reply(403,{error:'请求被拒绝',type:method!=='POST'?'method-not-allowed':'missing-local-header',path,status:403,hint:'请从本机工作台页面操作'});
  const b=JSON.parse($request.body||'{}');
  if(path==='/api/start'){ console.log('START count='+b.count+' param='+PARAM_COUNT); if(s.status==='running'&&s.lastTick&&nowMs()-s.lastTick<15000)return reply(409,{error:'已有扫描在运行，请先停止或等它结束',type:'busy',status:409,hint:'等待进度或点停止后再开始'});
   const cfg={mode:b.mode==='proxy'?'proxy':'direct',policy:String(b.policy||'').slice(0,64),count:num(b.count,PARAM_COUNT,1,500),tries:num(b.tries,2,1,3),timeout:num(b.timeout,5,1,8),download:b.download!==false,family:['v4','v6','both'].includes(b.family)?b.family:'both'};
   if(cfg.mode==='proxy'&&!cfg.policy)return reply(400,{error:'PROXY 模式必须选择代理策略'});
   const ranges=await CFEngine.update(false);
   const queue=CFEngine.candidates(ranges,{family:cfg.family,count:cfg.mode==='proxy'?1:cfg.count,seed:nowMs()+''});
   s={cfg,updated:ranges.fetchedAt,source:ranges.source,queue,queueTotal:queue.length,direct:cfg.mode==='direct'?[]:s.direct,proxy:s.proxy,results:[],done:0,total:queue.length,status:'running',running:true,error:null,started:nowMs()};save(s);return reply(200,s)
  }
  if(path==='/api/stop'){s.status='stopped';s.running=false;clearPin();save(s);return reply(200,s)}
  if(s.status!=='running'){s.running=false;clearPin();return reply(200,s)}
  const cfg=s.cfg,t0=nowMs(),K=Math.max(1,Math.min(5,cfg.mode==='proxy'?1:cfg.count));
  let n=0;
  while(s.queue.length&&nowMs()-t0<9000&&n<K){
   const ip=s.queue.shift();s.current=ip;s.lastTick=nowMs();save(s);
   try{
    const res=await probe(ip,cfg,cfg.mode,cfg.policy);
    if(cfg.mode==='proxy'){s.proxy=s.proxy.filter(x=>x.policy!==res.policy).concat(res)}else{s.direct.push(res)}
    s.results=(cfg.mode==='proxy'?s.proxy:s.direct);
   }catch(e){s.error=String(e.message||e).slice(0,80)}
   s.done=(s.done||0)+1;n++;s.lastTick=nowMs();
   save(s);
  }
  s.running=s.queue.length>0;s.status=s.running?'running':'done';
  if(!s.running)clearPin();
  save(s);return reply(200,s)
 }catch(e){return reply(503,{error:String(e.message||e)})}
})().catch(e=>$done(typeof $request==='undefined'?{title:'CF IP 优选工具',content:'运行失败：'+String(e),style:'error'}:{response:{status:500,body:'本地处理失败'}}));
