// WeTalk_Task.js (任务参数绝对最高权限 + 兼容旧定时习惯 + 单号必推 + 自动补发结算)
const scriptStartTime = new Date();
const scriptName = 'WeTalk'; 
const storeKey = 'wetalk_accounts_v1';
const statsKey = 'wetalk_daily_stats_v2'; 
const SECRET = '0fOiukQq7jXZV2GRi9LGlO';
const API_HOST = 'api.wetalkapp.com';

const MAX_VIDEO = 5;

// ================= 底层 API 封装 =================
function readVal(key) { return typeof $persistentStore !== "undefined" ? $persistentStore.read(key) : (typeof $prefs !== "undefined" ? $prefs.valueForKey(key) : null); }
function writeVal(val, key) { return typeof $persistentStore !== "undefined" ? $persistentStore.write(String(val), key) : (typeof $prefs !== "undefined" ? $prefs.setValueForKey(String(val), key) : false); }
function notify(title, subtitle, body) {
    if (typeof $notification !== "undefined") $notification.post(String(title), String(subtitle), String(body));
    else if (typeof $notify !== "undefined") $notify(String(title), String(subtitle), String(body));
}

// ⭐️ 参数双通道智能解析
let rawTaskArg = "";
let rawCronTime = "";

if (typeof $argument !== "undefined" && $argument) {
    if (typeof $argument === "object") {
        rawTaskArg = String($argument.task_arg || "").trim();
        rawCronTime = String($argument.cron_time || "").trim();
        if (!rawTaskArg) {
            const vals = Object.values($argument);
            rawTaskArg = String(vals[0] || "").trim();
        }
    } else {
        rawTaskArg = String($argument).trim();
    }
}

let forceSummary = false;
let targetHour = null, targetMin = null; 
let customEmails = [], deleteEmails = [];

// ⭐️ 1. 绝对最高优先级：任务参数（只要填了时间，无论如何以参数为主）
if (rawTaskArg) {
    let args = rawTaskArg.split(/[,，|]+/).map(e => e.trim()).filter(e => e);
    for (let arg of args) {
        let timeMatch = arg.match(/^(\d{1,2})[:：](\d{1,2})$/);
        let hourOnlyMatch = arg.match(/^(\d{1,2})[点hH]?$/);
        if (arg.startsWith("删除:") || arg.startsWith("rm:")) {
            deleteEmails.push(arg.replace(/^(删除|rm):/i, "").trim());
        } else if (timeMatch) {
            targetHour = parseInt(timeMatch[1], 10);
            targetMin = parseInt(timeMatch[2], 10);
        } else if (hourOnlyMatch) {
            targetHour = parseInt(hourOnlyMatch[1], 10);
            targetMin = 0;
        } else if (arg.includes("结算") || arg.toLowerCase().includes("summary") || arg.includes("force")) {
            forceSummary = true;
        } else if (arg.includes("@")) {
            customEmails.push(arg);
        }
    }
}

// ⭐️ 2. 次级兼容优先级：参数只写邮箱时，自动继承旧定时签到的时间习惯
if (targetHour === null && rawCronTime) {
    const parts = rawCronTime.trim().split(/\s+/);
    if (parts.length >= 5) {
        const minPart = parts[0] === '0' ? parts[1] : parts[0];
        const hourPart = parts[0] === '0' ? parts[2] : parts[1];
        
        const m = parseInt(minPart, 10);
        if (!isNaN(m)) targetMin = m;

        const specialHourMatch = hourPart.match(/(?:^|,)(\d{1,2})(?:$|,)/);
        if (specialHourMatch) {
            targetHour = parseInt(specialHourMatch[1], 10);
        }
    }
}

// ⭐️ 3. 兜底保护：默认 23:50
if (targetHour === null) targetHour = 23;
if (targetMin === null) targetMin = 50;

const IOS_VERSIONS = ['17.5.1','17.6.1','17.4.1','17.2.1','16.7.8','17.6','17.3.1','18.0.1','17.1.2','16.6.1'];
const IOS_SCALES = ['2.00','3.00','3.00','2.00','3.00'];
const IPHONE_MODELS = ['iPhone14,3','iPhone13,3','iPhone15,3','iPhone16,1','iPhone14,7','iPhone13,2','iPhone15,2','iPhone12,1'];
const CFN_VERS = ['1410.0.3','1494.0.7','1568.100.1','1209.1','1474.0.4','1568.200.2'];
const DARWIN_VERS = ['22.6.0','23.5.0','23.6.0','24.0.0','22.4.0'];

function getRandomIP() { return `${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}`; }
function getAccName(acc) { return (acc.capture && acc.capture.paramsRaw && acc.capture.paramsRaw.email) ? decodeURIComponent(acc.capture.paramsRaw.email) : (acc.alias || acc.id); }
function getTodayStr() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }

function getDailyStats() {
    let stats = { date: getTodayStr(), counts: {}, startBal: {}, endBal: {}, lastSummaryDate: "" };
    const raw = readVal(statsKey);
    if (raw) { try { const p = JSON.parse(raw); if (p.date === stats.date) { stats = Object.assign(stats, p); stats.startBal = stats.startBal || {}; stats.endBal = stats.endBal || {}; } } catch (e) {} }
    return stats;
}
function saveDailyStats(stats) { writeVal(JSON.stringify(stats), statsKey); }

function loadStore() {
  const raw = readVal(storeKey);
  if (!raw) return { version: 1, accounts: {}, order: [] };
  try { const obj = JSON.parse(raw); if (!obj.accounts) obj.accounts = {}; if (!Array.isArray(obj.order)) obj.order = Object.keys(obj.accounts); return obj; } catch (e) { return { version: 1, accounts: {}, order: [] }; }
}
function saveStore(store) { writeVal(JSON.stringify(store), storeKey); }

function autoCleanDuplicates(store) {
    const uniqueMap = {}; let hasDup = false; const newOrder = [];
    for (let i = store.order.length - 1; i >= 0; i--) {
        const id = store.order[i]; const acc = store.accounts[id];
        if (!acc) continue;
        const email = getAccName(acc);
        if (!uniqueMap[email]) { uniqueMap[email] = id; newOrder.unshift(id); } 
        else { hasDup = true; delete store.accounts[id]; }
    }
    if (hasDup) { store.order = newOrder; saveStore(store); }
    return store;
}

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

function pickItem(arr, seed) { return arr[seed % arr.length]; }
function getUTCSignDate() { const now = new Date(); const pad = n => String(n).padStart(2, '0'); return `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`; }
function buildUA(baseUA, seed) {
  const iosVer = pickItem(IOS_VERSIONS, seed);
  const scale = pickItem(IOS_SCALES, seed + 1);
  const model = pickItem(IPHONE_MODELS, seed + 2);
  const cfn = pickItem(CFN_VERS, seed + 3);
  const darwin = pickItem(DARWIN_VERS, seed + 4);
  if (baseUA && typeof baseUA === 'string') {
    let ua = baseUA; let changed = false;
    if (/iOS \d+(\.\d+){0,2}/.test(ua)) { ua = ua.replace(/iOS \d+(\.\d+){0,2}/, `iOS ${iosVer}`); changed = true; }
    if (/Scale\/\d+(\.\d+)?/.test(ua)) { ua = ua.replace(/Scale\/\d+(\.\d+)?/, `Scale/${scale}`); changed = true; }
    if (/iPhone\d+,\d+/.test(ua)) { ua = ua.replace(/iPhone\d+,\d+/, model); changed = true; }
    if (/CFNetwork\/[\d.]+/.test(ua)) { ua = ua.replace(/CFNetwork\/[\d.]+/, `CFNetwork/${cfn}`); changed = true; }
    if (/Darwin\/[\d.]+/.test(ua)) { ua = ua.replace(/Darwin\/[\d.]+/, `Darwin/${darwin}`); changed = true; }
    if (changed) return ua;
  }
  return `WeTalk/30.6.0 (com.innovationworks.wetalk; build:28; iOS ${iosVer}) Alamofire/5.4.3`;
}
function buildUrl(path, capture) {
  const params = {};
  Object.keys(capture.paramsRaw || {}).forEach(k => { if (k !== 'sign' && k !== 'signDate') params[k] = capture.paramsRaw[k]; });
  params.signDate = getUTCSignDate();
  params.sign = MD5(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + SECRET);
  return `https://${API_HOST}/app/${path}?${Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&')}`;
}

function buildHeaders(capture, ua, fakeIp) {
  const headers = Object.assign({}, capture.headers || {});
  delete headers['Content-Length']; delete headers['content-length']; delete headers[':authority']; delete headers[':method']; delete headers[':path']; delete headers[':scheme'];
  headers['Host'] = API_HOST; 
  headers['Accept'] = headers['Accept'] || 'application/json';
  headers['Connection'] = 'close';
  Object.keys(headers).forEach(k => { if (k.toLowerCase() === 'user-agent') delete headers[k]; });
  headers['User-Agent'] = ua; 
  headers['X-Forwarded-For'] = fakeIp; 
  headers['X-Real-IP'] = fakeIp; 
  headers['Client-IP'] = fakeIp; 
  headers['True-Client-IP'] = fakeIp;
  return headers;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function requestWithTimeout(options, timeout = 12000) {
  return new Promise((resolve, reject) => {
      let isDone = false;
      let timer = setTimeout(() => { 
          if (!isDone) { isDone = true; reject("请求超时(无网络响应)"); } 
      }, timeout);
      if (typeof $httpClient !== "undefined") {
          $httpClient.get(options, (error, response, body) => { 
              if (isDone) return;
              isDone = true;
              clearTimeout(timer); 
              if (error) reject(error); 
              else resolve({body, status: response ? (response.status || response.statusCode) : 200}); 
          });
      } else if (typeof $task !== "undefined") {
          options.method = 'GET';
          $task.fetch(options).then(res => { 
              if (isDone) return;
              isDone = true;
              clearTimeout(timer); 
              resolve({body: res.body, status: res.statusCode}); 
          }).catch(err => { 
              if (isDone) return;
              isDone = true;
              clearTimeout(timer); 
              reject(err.error || err); 
          });
      } else { 
          clearTimeout(timer);
          reject("未知的网络环境"); 
      }
  });
}

// ================= 核心执行逻辑 =================
async function runAccount(acc, currentRunCount) {
  const accountName = getAccName(acc);
  const fakeIp = getRandomIP(); 
  const headers = buildHeaders(acc.capture, buildUA(acc.baseUA, acc.uaSeed), fakeIp);
  
  let initialBal = "?", finalBal = "?", checkInStr = "签×", videoCount = 0, captchaIndex = 0; 
  let isNetworkFail = false;
  
  console.log(`\n👤 ${accountName} [今日第${currentRunCount}次]\n├ 🌐 伪装节点: ${fakeIp}`);
  function logMsg(text) { console.log(text); }

  async function fetchApi(path, retries = 3) {
      const url = buildUrl(path, acc.capture);
      let useDirect = false;
      for (let i = 0; i < retries; i++) {
          try {
              let reqOpts = { url, headers };
              if (useDirect) {
                  reqOpts.node = 'DIRECT';
              }
              return await requestWithTimeout(reqOpts, 12000);
          } catch (err) {
              if (i === retries - 1) throw err;
              if (!useDirect) {
                  logMsg(`├ ⚠️ ${path} 节点超时，已自动切【直连】抢救 (${i + 1}/${retries})...`);
                  useDirect = true;
              } else {
                  logMsg(`├ ⚠️ ${path} 直连依然超时，继续重试 (${i + 1}/${retries})...`);
              }
              await sleep(2500); 
          }
      }
  }

  try {
      try {
          const res = await fetchApi('queryBalanceAndBonus');
          const d = JSON.parse(res.body);
          if (d.retcode === 0) { initialBal = d.result.balance; logMsg(`├ 💰 初始余额: ${initialBal} Coins`); } 
          else { logMsg(`├ ⚠️ 查询失败: ${d.retmsg}`); }
      } catch (e) { logMsg(`├ ❌ 查询异常`); }
      await sleep(1500);

      try {
          const res = await fetchApi('checkIn');
          const d = JSON.parse(res.body);
          if (d.retcode === 0) { 
              logMsg(`├ 📅 签到结果: 成功 (+0.010)`); 
              checkInStr = "签✓"; 
          } else {
              const msg = d.retmsg || "";
              if (msg.includes('已經簽過') || msg.includes('已经签过') || msg.includes('already') ||
                  msg.includes('次數過多') || msg.includes('次数过多') || msg.includes('稍後再試') || msg.includes('稍后再试')) { 
                  logMsg(`├ 📅 签到状态: 今日已完成/上限`); 
                  checkInStr = "已签"; 
              } else { 
                  logMsg(`├ ⚠️ 签到异常: ${msg}`); 
              }
          }
      } catch (e) { 
          logMsg(`├ ❌ 签到异常: 网络完全超时无响应`); 
          isNetworkFail = true; 
      }
      
      for (let i = 1; i <= MAX_VIDEO; i++) {
          const randomDelay = Math.floor(Math.random() * 5000) + 18000; 
          await sleep(i === 1 ? 2000 : randomDelay); 
          try {
              const res = await fetchApi('videoBonus');
              const d = JSON.parse(res.body);
              if (d.retcode === 0) { 
                  logMsg(`├ 🎬 视频第${i}次: +${d.result?.bonus || '?'} Coins`); 
                  videoCount++; 
              } else {
                  const msg = d.retmsg || "";
                  if (msg.includes('圖形驗證碼') || msg.includes('验证码')) { 
                      logMsg(`├ ⚠️ 风控提醒: 第${i}次触发验证码限制，收手等待`); 
                      captchaIndex = i; 
                  } else { 
                      logMsg(`├ ⏸ 视频第${i}次: ${msg} (可能已达上限)`); 
                  }
                  break; 
              }
          } catch (e) { logMsg(`├ ❌ 视频第${i}次异常 (已跳过)`); }
      }

      try { const res = await fetchApi('queryBalanceAndBonus'); const d = JSON.parse(res.body); if (d.retcode === 0) finalBal = d.result.balance; } catch (e) {}
      logMsg(`└ 💎 最终余额: ${finalBal} Coins`);
      return { accountName, initialBal, finalBal, checkInStr, videoCount, captchaIndex, currentRunCount, isNetworkFail };
  } catch (globalErr) {
      logMsg(`└ ❌ 发生致命错误停止: ${globalErr}`);
      return { accountName, initialBal, finalBal: "错误", checkInStr: "签×", videoCount: 0, captchaIndex: 0, currentRunCount, isNetworkFail: true };
  }
}

// ================= 启动逻辑 =================
(async () => {
  let store = loadStore();
  store = autoCleanDuplicates(store);

  if (deleteEmails.length > 0) {
      let deletedCount = 0;
      let deletedList = [];
      for (let delEmail of deleteEmails) {
          for (let id of Object.keys(store.accounts)) {
              if (getAccName(store.accounts[id]) === delEmail) {
                  delete store.accounts[id];
                  store.order = store.order.filter(x => x !== id);
                  deletedCount++;
                  deletedList.push(delEmail);
                  console.log(`✅ 已从本地缓存中彻底清除废弃账号: ${delEmail}`);
              }
          }
      }
      if (deletedCount > 0) {
          saveStore(store);
          notify(scriptName + " 账号清理", "✅ 清理成功", `已成功删除以下 ${deletedCount} 个账号缓存：\n${deletedList.join('\n')}`);
      } else {
          notify(scriptName + " 账号清理", "❌ 清理失败", `未在本地找到对应的账号，请检查邮箱拼写：\n${deleteEmails.join('\n')}`);
      }
      return $done(); 
  }
  
  const validIds = store.order.filter(id => {
      const acc = store.accounts[id];
      if (!acc) return false;
      const accName = getAccName(acc);
      return accName && accName.includes('@'); 
  });

  if (!validIds.length) {
      notify(scriptName, '⚠️ 账号库为空或无有效邮箱账号', `请打开 ${scriptName} 触发抓包`);
      return $done();
  } 

  let executeIds = [];
  if (customEmails.length > 0) {
      executeIds = validIds.filter(id => customEmails.includes(getAccName(store.accounts[id])));
      if (executeIds.length === 0) {
          console.log(`❌ 找不到填写的参数邮箱，已自动切换为跑满全部有效账号！`);
          executeIds = validIds;
      }
  } else { executeIds = validIds; }

  const dailyStats = getDailyStats();
  const tasks = [];
  
  for (let idx = 0; idx < executeIds.length; idx++) {
      const id = executeIds[idx];
      const accAlias = getAccName(store.accounts[id]);
      dailyStats.counts[accAlias] = (dailyStats.counts[accAlias] || 0) + 1;
      const currentRunCount = dailyStats.counts[accAlias];
      
      tasks.push((async () => {
          await sleep(Math.floor(Math.random() * 1500) + 100); 
          return await runAccount(store.accounts[id], currentRunCount);
      })());
  }

  const results = await Promise.all(tasks);
  
  const nowStr = String(scriptStartTime.getHours()).padStart(2, '0') + ':' + String(scriptStartTime.getMinutes()).padStart(2, '0');
  let finalLog = `━━━━━━━━━━━━━━\n💰 ${scriptName} 任务结束统计\n🕒 ${nowStr}\n\n`;
  let totalVideos = 0, totalCaptcha = 0;
  const manualNotifyLines = [], summaryNotifyLines = [];
  const networkFailedList = [];

  for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const accAlias = res.accountName;
      if (res.initialBal !== "?" && dailyStats.startBal[accAlias] === undefined) dailyStats.startBal[accAlias] = parseFloat(res.initialBal);
      if (res.finalBal !== "?") dailyStats.endBal[accAlias] = parseFloat(res.finalBal);

      let checkStatus = res.checkInStr.includes('已签') ? '已完成' : (res.checkInStr.includes('✓') ? '成功' : '失败/未签');
      let earn = (res.videoCount * 0.004).toFixed(3);
      finalLog += `👤 ${res.accountName}\n├ 📅 签到：${checkStatus}\n├ 🎬 视频：${res.videoCount}次 (+${earn})\n`;
      if (res.captchaIndex > 0) { finalLog += `├ ⚠️ 风控：第${res.captchaIndex}次触发\n`; totalCaptcha++; }
      finalLog += `└ 💎 余额：${res.initialBal} → ${res.finalBal}\n\n`;
      
      totalVideos += res.videoCount;
      const solidCount = res.videoCount; const hollowCount = MAX_VIDEO - solidCount;
      const progressBar = '■'.repeat(solidCount) + '□'.repeat(hollowCount);
      const shortName = res.accountName.split('@')[0];
      const checkMark = res.checkInStr.includes('×') ? '×' : '✓';
      let vtStr = String(earn); if (vtStr.startsWith('0.')) vtStr = vtStr.substring(1); vtStr = '+' + vtStr;

      manualNotifyLines.push(`☻ ${shortName}｜${res.initialBal}▸${res.finalBal} 〔${checkMark}${res.currentRunCount}次 | ${progressBar} ${vtStr}〕`);
      const start = dailyStats.startBal[accAlias]; const end = dailyStats.endBal[accAlias];
      let earnedStr = "?";
      if (start !== undefined && end !== undefined) { let diff = parseFloat((end - start).toFixed(3)); earnedStr = diff >= 0 ? `+${diff}` : `${diff}`; }
      summaryNotifyLines.push(`☻ ${shortName}｜共签${res.currentRunCount}次 ◂ 日总计 ${earnedStr} (余${end})`);

      if (res.isNetworkFail) {
          networkFailedList.push(`✗ ${shortName}｜网络超时无响应`);
      }
  }

  let totalEarn = (totalVideos * 0.004).toFixed(3);
  finalLog += `━━━━━━━━━━━━━━\n📊 今日统计\n├ 👥 账号：${results.length}\n├ 🎬 视频：${totalVideos}次\n├ 💰 收益：+${totalEarn} Coins\n└ ⚠️ 风控：${totalCaptcha}次\n━━━━━━━━━`;

  const currentHour = scriptStartTime.getHours(); 
  const currentMin = scriptStartTime.getMinutes();

  // ⭐️ 核心判定：计算当天总分钟数，过了设定点且今天还没结过账，立刻触发补发
  const currentTotalMins = currentHour * 60 + currentMin;
  const targetTotalMins = targetHour * 60 + targetMin;
  const alreadySummarizedToday = (dailyStats.lastSummaryDate === getTodayStr());

  const isTimeForSummary = (currentTotalMins >= targetTotalMins && !alreadySummarizedToday);
  const shouldSummary = isTimeForSummary || forceSummary;

  if (shouldSummary && !forceSummary) {
      dailyStats.lastSummaryDate = getTodayStr();
  }
  saveDailyStats(dailyStats);

  // ⭐️ 只要指定了单号测试 (customEmails.length > 0)，必推通知！
  const isTargetAccountTest = (customEmails.length > 0);

  const isManualRun = (() => {
      if (typeof $environment !== 'undefined') {
          const execType = String($environment['execution-type'] || $environment['execute-type'] || '').toLowerCase();
          if (execType.includes('manual') || execType === '0') return true;
          if (execType.includes('cron')) return false;
      }
      if (scriptStartTime.getSeconds() > 2) return true;
      return false; 
  })();

  const targetTimeStr = `${String(targetHour).padStart(2,'0')}:${String(targetMin).padStart(2,'0')}`;
  let notifyLog = `\n🤖 通知状态\n├ 🕒 当前时间：${nowStr}\n├ 🎯 结算时间：${targetTimeStr}${forceSummary ? " (强制结算)" : ""}\n`;

  // ⭐️ 顺畅通知分流：
  if (networkFailedList.length > 0) {
      notify(scriptName + " ⚠️ 断网超时告警", `❌ 有 ${networkFailedList.length} 个账号网络请求超时`, networkFailedList.join('\n'));
      notifyLog += `└ ⚠️ 检测到网络超时无响应，已推送断网异常告警！`;
  } else if (shouldSummary) {
      let titleSuffix = forceSummary ? " 📊 强制总结算" : " 🌙 每日结算";
      notify(scriptName + titleSuffix, `✓${executeIds.length}个账号今日签到完成`, summaryNotifyLines.join('\n'));
      notifyLog += `└ 🔔 达到结算时段，已推送今日总结算！`;
  } else if (isTargetAccountTest) {
      // ⭐️ 填邮箱单测：必定推送单号测试结果！
      notify(scriptName + " 👤 单号测试完成", `✓${executeIds.length}个指定账号执行完毕`, manualNotifyLines.join('\n'));
      notifyLog += `└ 👤 检测到指定单号测试，已推送测试结果！`;
  } else if (isManualRun) {
      notify(scriptName + " ✋ 手动执行", `✓${executeIds.length}个账号单次完毕`, manualNotifyLines.join('\n'));
      notifyLog += `└ ✋ 触发手动执行，已推送单次进度！`;
  } else {
      notifyLog += `└ 🔕 接口响应正常且未到结算时段，本次不打扰推送通知`;
  }
  
  console.log(finalLog + notifyLog + '\n------ Script done -------\n');
  $done();
})().catch(err => { 
  console.log("❌ 脚本出错: " + err); 
  notify(scriptName + " ❌ 运行崩溃", "脚本底层发生严重异常", String(err));
  $done(); 
});