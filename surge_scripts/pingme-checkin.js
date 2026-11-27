/* Local-only PingMe. Never publish this generated file: local signing material.
 * Receipt accounting only; no balance-difference or advertised reward accounting.
 * All network operations are GET because that is the verified legacy protocol.
 */
(function (root) {
'use strict';
// Local build step inserts the exact legacy constant and MD5 without logging them.
const SECRET = '0fOiukQq7jXZV2GRi9LGlO';
function MD5(string) {
  function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
  function AddUnsigned(lX, lY) { const lX4=lX&0x40000000,lY4=lY&0x40000000,lX8=lX&0x80000000,lY8=lY&0x80000000;const lResult=(lX&0x3FFFFFFF)+(lY&0x3FFFFFFF);if(lX4&lY4)return lResult^0x80000000^lX8^lY8;if(lX4|lY4)return(lResult&0x40000000)?(lResult^0xC0000000^lX8^lY8):(lResult^0x40000000^lX8^lY8);return lResult^lX8^lY8; }
  function F(x, y, z) { return (x & y) | ((~x) & z); } function G(x, y, z) { return (x & z) | (y & (~z)); } function H(x, y, z) { return x ^ y ^ z; } function I(x, y, z) { return y ^ (x | (~z)); }
  function FF(a,b,c,d,x,s,ac){a=AddUnsigned(a,AddUnsigned(AddUnsigned(F(b,c,d),x),ac));return AddUnsigned(RotateLeft(a,s),b);} function GG(a,b,c,d,x,s,ac){a=AddUnsigned(a,AddUnsigned(AddUnsigned(G(b,c,d),x),ac));return AddUnsigned(RotateLeft(a,s),b);} function HH(a,b,c,d,x,s,ac){a=AddUnsigned(a,AddUnsigned(AddUnsigned(H(b,c,d),x),ac));return AddUnsigned(RotateLeft(a,s),b);} function II(a,b,c,d,x,s,ac){a=AddUnsigned(a,AddUnsigned(AddUnsigned(I(b,c,d),x),ac));return AddUnsigned(RotateLeft(a,s),b);}
  function ConvertToWordArray(str){const lMessageLength=str.length;const lNumberOfWords_temp1=lMessageLength+8;const lNumberOfWords_temp2=(lNumberOfWords_temp1-(lNumberOfWords_temp1%64))/64;const lNumberOfWords=(lNumberOfWords_temp2+1)*16;const lWordArray=Array(lNumberOfWords-1).fill(0);let lBytePosition=0,lByteCount=0;while(lByteCount<lMessageLength){const lWordCount=(lByteCount-(lByteCount%4))/4;lBytePosition=(lByteCount%4)*8;lWordArray[lWordCount]|=str.charCodeAt(lByteCount)<<lBytePosition;lByteCount++;}const lWordCount=(lByteCount-(lByteCount%4))/4;lBytePosition=(lByteCount%4)*8;lWordArray[lWordCount]|=0x80<<lBytePosition;lWordArray[lNumberOfWords-2]=lMessageLength<<3;lWordArray[lNumberOfWords-1]=lMessageLength>>>29;return lWordArray;}
  function WordToHex(lValue){let WordToHexValue='';for(let lCount=0;lCount<=3;lCount++){const lByte=(lValue>>>(lCount*8))&255;const WordToHexValue_temp='0'+lByte.toString(16);WordToHexValue+=WordToHexValue_temp.substr(WordToHexValue_temp.length-2,2);}return WordToHexValue;}
  const x=ConvertToWordArray(string);let a=0x67452301,b=0xEFCDAB89,c=0x98BADCFE,d=0x10325476;const S11=7,S12=12,S13=17,S14=22,S21=5,S22=9,S23=14,S24=20;const S31=4,S32=11,S33=16,S34=23,S41=6,S42=10,S43=15,S44=21;
  for(let k=0;k<x.length;k+=16){const AA=a,BB=b,CC=c,DD=d;a=FF(a,b,c,d,x[k+0],S11,0xD76AA478);d=FF(d,a,b,c,x[k+1],S12,0xE8C7B756);c=FF(c,d,a,b,x[k+2],S13,0x242070DB);b=FF(b,c,d,a,x[k+3],S14,0xC1BDCEEE);a=FF(a,b,c,d,x[k+4],S11,0xF57C0FAF);d=FF(d,a,b,c,x[k+5],S12,0x4787C62A);c=FF(c,d,a,b,x[k+6],S13,0xA8304613);b=FF(b,c,d,a,x[k+7],S14,0xFD469501);a=FF(a,b,c,d,x[k+8],S11,0x698098D8);d=FF(d,a,b,c,x[k+9],S12,0x8B44F7AF);c=FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1);b=FF(b,c,d,a,x[k+11],S14,0x895CD7BE);a=FF(a,b,c,d,x[k+12],S11,0x6B901122);d=FF(d,a,b,c,x[k+13],S12,0xFD987193);c=FF(c,d,a,b,x[k+14],S13,0xA679438E);b=FF(b,c,d,a,x[k+15],S14,0x49B40821);a=GG(a,b,c,d,x[k+1],S21,0xF61E2562);d=GG(d,a,b,c,x[k+6],S22,0xC040B340);c=GG(c,d,a,b,x[k+11],S23,0x265E5A51);b=GG(b,c,d,a,x[k+0],S24,0xE9B6C7AA);a=GG(a,b,c,d,x[k+5],S21,0xD62F105D);d=GG(d,a,b,c,x[k+10],S22,0x02441453);c=GG(c,d,a,b,x[k+15],S23,0xD8A1E681);b=GG(b,c,d,a,x[k+4],S24,0xE7D3FBC8);a=GG(a,b,c,d,x[k+9],S21,0x21E1CDE6);d=GG(d,a,b,c,x[k+14],S22,0xC33707D6);c=GG(c,d,a,b,x[k+3],S23,0xF4D50D87);b=GG(b,c,d,a,x[k+8],S24,0x455A14ED);a=GG(a,b,c,d,x[k+13],S21,0xA9E3E905);d=GG(d,a,b,c,x[k+2],S22,0xFCEFA3F8);c=GG(c,d,a,b,x[k+7],S23,0x676F02D9);b=GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);a=HH(a,b,c,d,x[k+5],S31,0xFFFA3942);d=HH(d,a,b,c,x[k+8],S32,0x8771F681);c=HH(c,d,a,b,x[k+11],S33,0x6D9D6122);b=HH(b,c,d,a,x[k+14],S34,0xFDE5380C);a=HH(a,b,c,d,x[k+1],S31,0xA4BEEA44);d=HH(d,a,b,c,x[k+4],S32,0x4BDECFA9);c=HH(c,d,a,b,x[k+7],S33,0xF6BB4B60);b=HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);a=HH(a,b,c,d,x[k+13],S31,0x289B7EC6);d=HH(d,a,b,c,x[k+0],S32,0xEAA127FA);c=HH(c,d,a,b,x[k+3],S33,0xD4EF3085);b=HH(b,c,d,a,x[k+6],S34,0x04881D05);a=HH(a,b,c,d,x[k+9],S31,0xD9D4D039);d=HH(d,a,b,c,x[k+12],S32,0xE6DB99E5);c=HH(c,d,a,b,x[k+15],S33,0x1FA27CF8);b=HH(b,c,d,a,x[k+2],S34,0xC4AC5665);a=II(a,b,c,d,x[k+0],S41,0xF4292244);d=II(d,a,b,c,x[k+7],S42,0x432AFF97);c=II(c,d,a,b,x[k+14],S43,0xAB9423A7);b=II(b,c,d,a,x[k+5],S44,0xFC93A039);a=II(a,b,c,d,x[k+12],S41,0x655B59C3);d=II(d,a,b,c,x[k+3],S42,0x8F0CCC92);c=II(c,d,a,b,x[k+10],S43,0xFFEFF47D);b=II(b,c,d,a,x[k+1],S44,0x85845DD1);a=II(a,b,c,d,x[k+8],S41,0x6FA87E4F);d=II(d,a,b,c,x[k+15],S42,0xFE2CE6E0);c=II(c,d,a,b,x[k+6],S43,0xA3014314);b=II(b,c,d,a,x[k+13],S44,0x4E0811A1);a=II(a,b,c,d,x[k+4],S41,0xF7537E82);d=II(d,a,b,c,x[k+11],S42,0xBD3AF235);c=II(c,d,a,b,x[k+2],S43,0x2AD7D2BB);b=II(b,c,d,a,x[k+9],S44,0xEB86D391);a=AddUnsigned(a,AA);b=AddUnsigned(b,BB);c=AddUnsigned(c,CC);d=AddUnsigned(d,DD);}
  return(WordToHex(a)+WordToHex(b)+WordToHex(c)+WordToHex(d)).toLowerCase();
}
const NS = 'pingme_local_v3:';
const HOST = 'api.pingmeapp.net';
const LEASE_MS = 720000, BUDGET_MS = 570000, HTTP_MS = 15000;
const GAP_MS = 35000, MAX_REQUESTS = 48;
const OWN = 'x-pingme-local-task';
const hex = '0123456789abcdef';
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const fail = code => { const e = new Error(code); e.safeCode = code; throw e; };
const localDay = t => { const d=new Date(t); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); };
function config(arg) {
  const c={mode:'checkin',interval_hours:null,capture:true}; const seen={};
  if (arg !== undefined && arg !== null && typeof arg !== 'string') fail('BAD_ARGUMENT');
  if (arg) for (const bit of arg.split('&')) {
    const m=/^(mode|interval_hours|capture)=([^=&]+)$/.exec(bit);
    if (!m || seen[m[1]]) fail('BAD_ARGUMENT'); seen[m[1]]=true; c[m[1]]=m[2];
  }
  if (!/^(capture|checkin|summary|migrate|status)$/.test(c.mode)) fail('BAD_ARGUMENT');
  if(c.interval_hours!==null){
    if (!/^(?:[1-9]|[1-9][0-9]|1[0-5][0-9]|16[0-8])$/.test(String(c.interval_hours))) fail('BAD_ARGUMENT');
    c.interval_hours=Number(c.interval_hours);
  }
  if(c.capture!==true&&c.capture!=='true'&&c.capture!=='false')fail('BAD_ARGUMENT');
  c.capture=c.capture===true||c.capture==='true';
  return c;
}
function identity(raw) {
  if (typeof raw !== 'string' || raw.length>512) fail('BAD_IDENTITY');
  let s; try { s=decodeURIComponent(raw); } catch (_) { fail('BAD_IDENTITY'); }
  if (/[\s\x00-\x1f\x7f%]/.test(s) || !/^[^@]+@[^@]+\.[^@]+$/.test(s)) fail('BAD_IDENTITY');
  const at=s.lastIndexOf('@'); s=s.slice(0,at)+'@'+s.slice(at+1).toLowerCase();
  return {email:s,id:MD5('pingme-local-email:'+s)}; // local mapping, NOT server UID
}
function query(url) {
  if (typeof url !== 'string' || url.length>32768) fail('BAD_CAPTURE');
  const m=/^https:\/\/api\.pingmeapp\.net\/app\/queryBalanceAndBonus\?([^#]+)$/.exec(url);
  if (!m) fail('BAD_CAPTURE'); const p={};
  for (const part of m[1].split('&')) {
    const i=part.indexOf('='); if(i<1) fail('BAD_CAPTURE');
    const k=part.slice(0,i),v=part.slice(i+1);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(k) || own(p,k) || /[\r\n]/.test(v)) fail('BAD_CAPTURE');
    p[k]=v; // deliberately NOT decoded: preserve legacy signature bytes
  }
  identity(p.email);
  if (typeof p.callpin!=='string' || !p.callpin || /^(null|undefined)$/i.test(p.callpin)) fail('BAD_CAPTURE');
  return p;
}
function headers(raw) {
  if (!plain(raw)) fail('BAD_CAPTURE'); const out={};
  for (const k of Object.keys(raw)) {
    const l=k.toLowerCase();
    if (k[0]===':' || /^(host|content-length|connection|transfer-encoding|x-forwarded-for|x-real-ip|client-ip|true-client-ip)$/.test(l) || l===OWN) continue;
    if (typeof raw[k]!=='string' || /[\r\n]/.test(raw[k])) fail('BAD_CAPTURE');
    out[l]=raw[k];
  }
  return out;
}
function captureValid(c) {
  if (!plain(c) || !plain(c.paramsRaw) || !plain(c.headers)) fail('BAD_CAPTURE');
  const p=c.paramsRaw;
  for (const k of Object.keys(p)) if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(k) || typeof p[k]!=='string' || /[\r\n]/.test(p[k])) fail('BAD_CAPTURE');
  const who=identity(p.email);
  if (!p.callpin || /^(null|undefined)$/i.test(p.callpin)) fail('BAD_CAPTURE');
  // Validate original URL too, never accepting an alternate replay target.
  const q=query(c.url); if(JSON.stringify(q)!==JSON.stringify(p)) fail('BAD_CAPTURE');
  headers(c.headers); return who;
}
function signed(path,c,t) {
  if (!/^(queryBalanceAndBonus|checkIn|videoBonus)$/.test(path)) fail('BAD_ENDPOINT');
  const p={}; for(const k of Object.keys(c.paramsRaw)) if(k!=='sign'&&k!=='signDate') p[k]=c.paramsRaw[k];
  p.signDate=new Date(t).toISOString().slice(0,19).replace('T',' ');
  p.sign=MD5(Object.keys(p).sort().map(k=>k+'='+p[k]).join('&')+SECRET);
  return 'https://'+HOST+'/app/'+path+'?'+Object.keys(p).map(k=>k+'='+encodeURIComponent(p[k])).join('&');
}
function parseResponse(r) {
  if (!r || r.error) return {status:'unknown',reason:'NETWORK_UNKNOWN'};
  if(r.status===401||r.status===403) return {status:'failed',reason:'AUTH_DENIED'};
  if(r.status===429) return {status:'failed',reason:'RATE_LIMIT'};
  if(r.status<200||r.status>=300||typeof r.status!=='number') return {status:'unknown',reason:'HTTP_UNKNOWN'};
  let b; try { b=JSON.parse(r.body); } catch(_){return {status:'unknown',reason:'FORMAT_UNKNOWN'};}
  if(!plain(b)||typeof b.retcode!=='number') return {status:'unknown',reason:'FORMAT_UNKNOWN'};
  const msg=typeof b.retmsg==='string'?b.retmsg:'';
  if(b.retcode!==0) {
    if (/圖形驗證碼|验证码|captcha|watch|观看|觀看|上限|limit/i.test(msg)) return {status:'failed',reason:'SERVER_STOP'};
    if (/已經簽過|已经签过|already/i.test(msg)) return {status:'already',reason:'ALREADY'};
    return {status:'failed',reason:'SERVER_DENIED'};
  }
  return {status:'success',reason:'OK',result:plain(b.result)?b.result:{}};
}
function reward(r) {
  const v=r&&r.bonus;
  return typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1000000 ? v : null;
}
function create(env) {
  let halted=false, requests=0; const started=env.now();
  const token=String(started)+'-'+String(env.random());
  function read(k) { try { const x=env.read(NS+k); if(x===undefined) fail('STORE_READ'); return x; } catch(_){fail('STORE_READ');} }
  function obj(k) { const v=read(k); if(v===null||v==='') return null; try {return JSON.parse(v);}catch(_){fail('STORE_CORRUPT');} }
  function write(k,v) {
    if(halted) fail('STORE_HALTED'); const s=JSON.stringify(v);
    try { if(env.write(s,NS+k)!==true || read(k)!==s) fail('STORE_WRITE'); }
    catch(_){halted=true;fail('STORE_WRITE');}
  }
  function mark(id) { // Immutable radix markers: no shared read-modify-write index to lose accounts.
    for(let i=1;i<=32;i++) if(read('tree:'+id.slice(0,i))!=='1') write('tree:'+id.slice(0,i),1);
  }
  function list() {
    const ids=[];
    function walk(p) { for(const c of hex) { const n=p+c,v=read('tree:'+n); if(v===null||v==='') continue; if(v!=='1') fail('STORE_CORRUPT'); if(n.length===32) ids.push(n); else walk(n); } }
    walk(''); return ids;
  }
  function account(id) {
    const a=obj('account:'+id);
    if(!plain(a)||a.schemaVersion!==3||a.id!==id||!Array.isArray(a.legacyIds)||captureValid(a.capture).id!==id) fail('STORE_CORRUPT'); return a;
  }
  function runtime(id) {
    const s=obj('state:'+id);
    if(s===null) return {schemaVersion:3,lastAttemptAt:null,days:{},events:{}};
    if(!plain(s)||s.schemaVersion!==3||!plain(s.days)||!plain(s.events)||(s.lastAttemptAt!==null&&(!Number.isFinite(s.lastAttemptAt)||s.lastAttemptAt<0))) fail('STORE_CORRUPT');
    const statuses=['unobserved','pending','success','already','failed','unknown','unavailable'];
    for(const date of Object.keys(s.days)){const d=s.days[date];if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!plain(d)||!statuses.includes(d.checkin)||!statuses.includes(d.video)||typeof d.reason!=='string'||(own(d,'checkinAttempted')&&typeof d.checkinAttempted!=='boolean')||(own(d,'videoBlocked')&&typeof d.videoBlocked!=='boolean'))fail('STORE_CORRUPT');}
    for(const k of Object.keys(s.events)) {
      const e=s.events[k];
      if(!plain(e)||!['checkin','video'].includes(e.kind)||!['pending','success','already','failed','unknown'].includes(e.status)||!Number.isFinite(e.startedAt)||(e.receivedAt!==null&&!Number.isFinite(e.receivedAt))||(e.receivedDay!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(e.receivedDay))||(e.reward!==null&&(e.status!=='success'||typeof e.reward!=='number'||!Number.isFinite(e.reward)||e.reward<0||e.reward>1000000)))fail('STORE_CORRUPT');
    }
    return s;
  }
  function saveAccount(c,legacyId,verified) {
    const who=captureValid(c),k='account:'+who.id,old=obj(k);
    if(old!==null && (!plain(old)||old.id!==who.id||old.email!==who.email)) fail('STORE_CORRUPT');
    const legacyIds=old?old.legacyIds.slice():[];
    if(legacyId&&!legacyIds.includes(legacyId)) legacyIds.push(legacyId);
    const a={schemaVersion:3,id:who.id,email:who.email,capture:c,legacyIds,createdAt:old?old.createdAt:env.now(),updatedAt:env.now(),verified:verified===true};
    write(k,a); mark(who.id); return who.id;
  }
  function migrate() {
    let raw; try{raw=env.read('pingme_accounts_v1');}catch(_){fail('STORE_READ');}
    if(raw===null||raw==='') return {mode:'migrate',imported:0,accounts:list().length};
    let old;try{old=JSON.parse(raw);}catch(_){fail('LEGACY_CORRUPT');}
    if(!plain(old)||old.version!==1||!plain(old.accounts)||!Array.isArray(old.order)) fail('LEGACY_CORRUPT');
    if(old.order.some(x=>typeof x!=='string'||!own(old.accounts,x)) || new Set(old.order).size!==old.order.length || Object.keys(old.accounts).some(k=>!old.order.includes(k))) fail('LEGACY_CORRUPT');
    // Validate every source record before writing any import. Never modify old keys.
    const records=old.order.map(id=>{const a=old.accounts[id];if(!plain(a)||!plain(a.capture))fail('LEGACY_CORRUPT');captureValid(a.capture);return {id,capture:a.capture};});
    let n=0;
    for(const r of records) {
      const who=captureValid(r.capture),existing=obj('account:'+who.id);
      // Repeat migration never rolls a newly captured credential back to the legacy one.
      if(existing) {account(who.id);mark(who.id);continue;}
      saveAccount(r.capture,r.id,false);n++;
    }
    return {mode:'migrate',imported:n,accounts:list().length};
  }
  async function capture(request,response) {
    if(!request||!response) return {mode:'capture',status:'ignored',reason:'CONTEXT_MISSING'};
    if(request.method!=='GET') return {mode:'capture',status:'ignored',reason:'METHOD_UNSUPPORTED'};
    const h=request.headers||{};
    if(Object.keys(h).some(k=>k.toLowerCase()===OWN)) return {mode:'capture',status:'ignored',reason:'SELF_REQUEST'};
    const p=query(request.url),r=parseResponse(response);
    if(r.status!=='success') return {mode:'capture',status:'unconfirmed',reason:r.reason};
    if(typeof r.result.balance!=='number'||!Number.isFinite(r.result.balance)) return {mode:'capture',status:'unconfirmed',reason:'BALANCE_UNCONFIRMED'};
    const who=identity(p.email);
    // A successful authenticated balance response binds this exact request, not a server UID.
    // If the response explicitly supplies email, a mismatch is never silently accepted.
    if(own(r.result,'email')&&identity(r.result.email).email!==who.email) fail('IDENTITY_MISMATCH');
    const c={url:request.url,paramsRaw:p,headers:headers(h)};
    const isNew=obj('account:'+who.id)===null; // one read; also drives the one-time notice
    if(!own(runtime(who.id),'authBlockedFingerprint')) {
      saveAccount(c,null,true);
    } else {
      if(!lease(who.id)) return {mode:'capture',status:'unconfirmed',reason:'LEASE_BUSY'};
      try {
        await env.sleep(120);
        guard(who.id);
        const s=runtime(who.id); // Reload under the account lease; preserve all day/event fields.
        saveAccount(c,null,true);
        if(own(s,'authBlockedFingerprint')) {delete s.authBlockedFingerprint;saveState(who.id,s);}
      } finally {
        if(!halted) {
          const l=obj('lease:'+who.id);
          if(l&&l.token===token)write('lease:'+who.id,{token,until:env.now()});
        }
      }
    }
    // One switch: if capture is on, every successful save is announced, so opening
    // the app or refreshing the coin page always confirms itself. Never log or
    // notify the full address: masked local part plus a short id prefix only.
    try {
      const local=who.email.split('@')[0];
      const mask=(local.length>2?local.slice(0,2):local.slice(0,1))+'***';
      env.notify('PingMe多账号签到',isNew?'已抓取新账号':'已更新账号',mask+' ['+who.id.slice(0,6)+']');
    } catch(_) { /* a failed notice must never break or reopen the capture */ }
    // Do NOT walk the whole account tree here: each $persistentStore.read is a
    // synchronous disk access, and ~2500 of them per capture blew past the
    // http-response script timeout. The count is only for display, never needed.
    return {mode:'capture',status:'saved',reason:'OK',isNew};
  }
  function lease(id) {
    const k='lease:'+id,old=obj(k),now=env.now();
    if(old!==null&&(!plain(old)||typeof old.token!=='string'||!Number.isFinite(old.until))) fail('STORE_CORRUPT');
    if(old&&old.until>now)return false;
    write(k,{token,until:now+LEASE_MS});return true;
  }
  function guard(id) {
    if(halted||env.now()-started>=BUDGET_MS) fail('BUDGET_STOP');
    const l=obj('lease:'+id);if(!l||l.token!==token||l.until<=env.now()) fail('LEASE_LOST');
  }
  async function request(id,path,a) {
    guard(id);if(requests>=MAX_REQUESTS||env.now()-started+HTTP_MS>=BUDGET_MS)fail('BUDGET_STOP');requests++;
    const h=headers(a.capture.headers); h[OWN]='1';
    let raw;try{raw=await env.http({url:signed(path,a.capture,env.now()),headers:h,timeout:HTTP_MS/1000,'auto-cookie':false,'auto-redirect':false});}
    catch(_){return {status:'unknown',reason:'NETWORK_UNKNOWN'};}
    return parseResponse(raw);
  }
  function saveState(id,s){guard(id);write('state:'+id,s);}
  function dayState(s,date) {
    if(!own(s.days,date))s.days[date]={checkin:'unobserved',video:'unobserved',reason:'NOT_OBSERVED'};
    if(!plain(s.days[date]))fail('STORE_CORRUPT');return s.days[date];
  }
  async function operate(id,a,s,kind,seq) {
    const date=localDay(env.now()),d=dayState(s,date),eventId=token+':'+kind+':'+seq;
    const e={kind,status:'pending',reward:null,startedAt:env.now(),receivedAt:null,receivedDay:null,reason:'IN_FLIGHT'};
    s.events[eventId]=e;
    if(kind==='checkin'){d.checkin='pending';d.checkinAttempted=true;}
    else d.video='pending';
    saveState(id,s); // durable intent BEFORE the side-effecting GET; no blind retry
    const r=await request(id,kind==='checkin'?'checkIn':'videoBonus',a);
    e.status=r.status;e.reason=r.reason;e.receivedAt=env.now();e.receivedDay=localDay(e.receivedAt);
    // Explicit success and actual result.bonus only. Known zero is valid; absence is null.
    e.reward=r.status==='success'?reward(r.result):null;
    d[kind]=r.status; d.reason=r.reason;
    if(r.reason==='AUTH_DENIED')s.authBlockedFingerprint=MD5(JSON.stringify(a.capture));
    if(r.reason==='SERVER_STOP'||(kind==='video'&&(r.status==='unknown'||(r.status==='success'&&e.reward===null))))d.videoBlocked=true;
    saveState(id,s);return r;
  }
  async function runAccount(id,c) {
    let a,s;
    try {
      a=account(id);s=runtime(id);
      if(s.authBlockedFingerprint===MD5(JSON.stringify(a.capture)))return 'AUTH_BLOCKED';
      if(s.lastAttemptAt!==null && env.now()-s.lastAttemptAt<(c.interval_hours===null?60000:c.interval_hours*3600000))return 'THROTTLED';
      if(!lease(id))return 'LEASE_BUSY';
      await env.sleep(120); // settle competing acquisitions before checking owner again
      guard(id); s=runtime(id);
      if(s.lastAttemptAt!==null && env.now()-s.lastAttemptAt<(c.interval_hours===null?60000:c.interval_hours*3600000))return 'THROTTLED';
      s.lastAttemptAt=env.now();saveState(id,s);
      const q=await request(id,'queryBalanceAndBonus',a),d=dayState(s,localDay(env.now()));
      if(q.status!=='success') {
        d.reason=q.reason;
        if(q.reason==='AUTH_DENIED')s.authBlockedFingerprint=MD5(JSON.stringify(a.capture));
        saveState(id,s);return q.reason;
      }
      // A successful query is read-only. Advertised amounts and balance are NEVER rewards.
      if(q.result.isallowcheckin===true && d.checkinAttempted!==true) {
        const r=await operate(id,a,s,'checkin',0);
        if(r.status!=='success'&&r.status!=='already')return r.reason;
      } else if(d.checkin==='unobserved') {
        d.checkin=q.result.isallowcheckin===false?'unavailable':'unknown';
        d.reason=q.result.isallowcheckin===false?'CURRENTLY_UNAVAILABLE':'ELIGIBILITY_UNKNOWN';
        saveState(id,s);
      }
      // Eligibility is re-evaluated next round; a persisted attempt is never replayed that day.
      if(d.videoBlocked||d.video==='pending')return d.reason;
      if(q.result.isallowvideobonus!==true) {
        d.video=q.result.isallowvideobonus===false?'unavailable':'unknown';
        d.reason=q.result.isallowvideobonus===false?'CURRENTLY_UNAVAILABLE':'ELIGIBILITY_UNKNOWN';
        saveState(id,s);return d.reason;
      }
      let lastVideoAt=null;
      for(let i=0;i<5;i++) {
        if(lastVideoAt!==null)await env.sleep(Math.max(0,GAP_MS-(env.now()-lastVideoAt)));
        // Re-check the actual boolean before every video after the first; never use order/source.
        if(i>0) {
          const next=await request(id,'queryBalanceAndBonus',a);
          if(next.status!=='success'||next.result.isallowvideobonus!==true){d.video='unavailable';d.reason=next.reason==='OK'?'CURRENTLY_UNAVAILABLE':next.reason;saveState(id,s);break;}
        }
        lastVideoAt=env.now();
        const r=await operate(id,a,s,'video',i);
        if(r.status!=='success'||reward(r.result)===null)break;
      }
      return 'COMPLETE';
    } catch(e) {if(e.safeCode==='STORE_WRITE'||e.safeCode==='STORE_READ'||e.safeCode==='STORE_CORRUPT')halted=true;return e.safeCode||'INTERNAL_ERROR';}
    finally {
      if(!halted){try{const l=obj('lease:'+id);if(l&&l.token===token)write('lease:'+id,{token,until:env.now()+60000});}catch(_){halted=true;}}
    }
  }
  async function checkin(c) {
    // Fail closed on any malformed account/state BEFORE sending the first request.
    const ids=list(); for(const id of ids){account(id);runtime(id);}
    let cursor=0;const results=[];
    async function worker(){while(cursor<ids.length&&!halted&&env.now()-started<BUDGET_MS){const id=ids[cursor++];results.push(await runAccount(id,c));}}
    await Promise.all([worker(),worker()]);
    return {mode:'checkin',accounts:ids.length,processed:results.length,requests,statuses:results};
  }
  async function summary() {
    const now=env.now(),d=new Date(now),date=localDay(now);
    if(d.getHours()!==23||d.getMinutes()!==0)return {mode:'summary',status:'outside_window'};
    if(read('summary:'+date)!==null)return {mode:'summary',status:'duplicate'};
    // A separate daily lease settles concurrent summary invocations before claiming delivery.
    const lk='summaryLease:'+date,old=obj(lk);
    if(old!==null&&(!plain(old)||typeof old.token!=='string'||!Number.isFinite(old.until)))fail('STORE_CORRUPT');
    if(old&&old.until>now)return {mode:'summary',status:'busy'};
    write(lk,{token,until:now+LEASE_MS});await env.sleep(120);
    const held=obj(lk);if(!held||held.token!==token)return {mode:'summary',status:'busy'};
    if(read('summary:'+date)!==null)return {mode:'summary',status:'duplicate'};
    const cutoff=new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,0,0,0).getTime();
    const ids=list(),lines=[];let total=0,unknown=0;
    const fmt=n=>String(Number(n.toPrecision(15)));
    for(let i=0;i<ids.length;i++) {
      const id=ids[i],a=account(id),local=identity(a.capture.paramsRaw.email).email.split('@')[0];
      const mask=(local.length>2?local.slice(0,2):local.slice(0,1))+'***';
      const s=runtime(id);let ci=0,vi=0,ciKnown=0,viKnown=0,known=0,uncertain=false,cs='未观测',vs='未观测';
      for(const k of Object.keys(s.events)) {
        const e=s.events[k];if(e.startedAt>cutoff)continue;
        const received=e.receivedAt!==null&&e.receivedAt<=cutoff;
        if(received&&e.receivedDay===date) {
          if(e.kind==='checkin')cs=e.status;else vs=e.status;
          if(e.status==='success'&&e.reward!==null) {if(e.kind==='checkin'){ci+=e.reward;ciKnown++;}else{vi+=e.reward;viKnown++;}known++;}
          else if(e.status!=='already')uncertain=true;
        } else if(localDay(e.startedAt)===date&&!received)uncertain=true;
      }
      const ds=s.days[date];
      if(!ds||ds.checkin!=='success'||cs==='未观测')uncertain=true;
      if(ciKnown===0||viKnown===0)uncertain=true;
      if(uncertain)unknown++;
      const state=ds?ds.reason:'NOT_OBSERVED';
      const labels={OK:'成功',CURRENTLY_UNAVAILABLE:'当前不可领取',ELIGIBILITY_UNKNOWN:'资格未明',NOT_OBSERVED:'未观测',NETWORK_UNKNOWN:'网络结果未知',AUTH_DENIED:'认证拒绝',RATE_LIMIT:'请求受限',SERVER_STOP:'服务端校验停止',SERVER_DENIED:'服务端拒绝',ALREADY:'已签到',IN_FLIGHT:'处理中',FORMAT_UNKNOWN:'回执未明',HTTP_UNKNOWN:'HTTP结果未明'};
      lines.push('账号'+(i+1)+' '+mask+' ['+id.slice(0,6)+']：'+(known?'已确认 '+fmt(ci+vi)+' Coins（签到 '+(ciKnown?fmt(ci):'无已确认记录')+'，视频 '+(viKnown?fmt(vi):'无已确认记录')+'）':'尚无已确认记录')+(uncertain?'；未完整确认':'')+'；'+(labels[state]||'状态未明'));
      total+=ci+vi;
    }
    const body=lines.join('\n')+'\n已确认合计 '+fmt(total)+' Coins；未知/未完整确认账号 '+unknown+'/'+ids.length+'。\n仅含本模块截至23:00已确认回执；非余额，23点后入账不在本次汇总。';
    // Persist the delivery claim FIRST: a crash can miss a notification, never intentionally duplicate it.
    const notifyTime=new Date(env.now());
    if(notifyTime.getHours()!==23||notifyTime.getMinutes()!==0||localDay(env.now())!==date)return {mode:'summary',status:'outside_window'};
    write('summary:'+date,{claimedAt:env.now(),cutoff,accounts:ids.length});
    env.notify('多账号金币签到(本地)',date+' 截至23:00',body); // THE ONLY notification exit
    return {mode:'summary',status:'sent',accounts:ids.length,confirmed:Number(total.toPrecision(15)),unknown};
  }
  async function run(arg,requestArg,responseArg) {
    const c=config(arg);
    if(c.mode==='capture')return c.capture?capture(requestArg,responseArg):{mode:'capture',status:'disabled'};
    if(c.mode==='migrate')return migrate();
    if(c.mode==='status'){const ids=list();for(const id of ids){account(id);runtime(id);}return {mode:'status',accounts:ids.length};}
    if(c.mode==='summary')return summary();
    return checkin(c);
  }
  return {run,list,account,runtime,saveAccount};
}
const api={create,config,identity,query,parseResponse,reward,signed,localDay,NS,constants:{LEASE_MS,BUDGET_MS,HTTP_MS,GAP_MS,MAX_REQUESTS}};
root.PingMeCore=api;
if(root.__PINGME_TEST_ONLY__===true)return;
function captureDiagnostic(status,reason) {
  const statuses=['saved','ignored','unconfirmed'];
  const reasons=['OK','CONTEXT_MISSING','METHOD_UNSUPPORTED','SELF_REQUEST','BALANCE_UNCONFIRMED','LEASE_BUSY','LEASE_LOST','BUDGET_STOP','NETWORK_UNKNOWN','AUTH_DENIED','RATE_LIMIT','HTTP_UNKNOWN','FORMAT_UNKNOWN','SERVER_STOP','ALREADY','SERVER_DENIED','BAD_CAPTURE','BAD_IDENTITY','IDENTITY_MISMATCH','STORE_READ','STORE_WRITE','STORE_CORRUPT','STORE_HALTED','BAD_ARGUMENT'];
  console.log('PINGME_LOCAL capture status='+(statuses.includes(status)?status:'unconfirmed')+' reason='+(reasons.includes(reason)?reason:'INTERNAL_ERROR'));
}
let doneCalled=false;
function done(){if(!doneCalled){doneCalled=true;if(typeof $done==='function')$done({});}}
const env={
  now:()=>Date.now(),random:()=>Math.random(),
  read:k=>$persistentStore.read(k),write:(v,k)=>$persistentStore.write(v,k),
  sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  notify:(a,b,c)=>$notification.post(a,b,c),
  http:options=>new Promise(resolve=>{
    let settled=false,timer;
    function finish(v){if(settled)return;settled=true;if(typeof clearTimeout==='function'&&timer!==undefined)clearTimeout(timer);resolve(v);}
    timer=setTimeout(()=>finish({error:'TIMEOUT'}),HTTP_MS);
    try {
      options['auto-cookie']=false;options['auto-redirect']=false;
      $httpClient.get(options,(error,response,body)=>finish(error?{error:'NETWORK'}:{status:response&&(response.status||response.statusCode),body}));
    }catch(_){finish({error:'NETWORK'});}
  })
};
Promise.resolve().then(()=>{
  const arg=typeof $argument==='string'?$argument:'';
  const req=typeof $request!=='undefined'?$request:null;
  const resp=typeof $response!=='undefined'?{status:$response.status||$response.statusCode,body:$response.body}:null;
  return create(env).run(arg,req,resp);
}).then(result=>{
  // Only safe enum values and counts; never stringify API replies, credentials or URLs.
  if(result.mode==='migrate'||result.mode==='status')console.log('PINGME_LOCAL '+result.mode+' accounts='+result.accounts+' imported='+(result.imported||0));
  if(result.mode==='capture'&&result.status!=='disabled')captureDiagnostic(result.status,result.reason);
  done();
},error=>{
  if(typeof $argument==='string'&&/(?:^|&)mode=capture(?:&|$)/.test($argument))captureDiagnostic('unconfirmed',error&&error.safeCode);
  else console.log('PINGME_LOCAL '+(error&&/^[A-Z_]+$/.test(error.safeCode||'')?error.safeCode:'INTERNAL_ERROR'));
  done();
});
})(this);
