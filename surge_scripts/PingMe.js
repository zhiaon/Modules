// PingMe_Task.js (神级日志排版 + 参数时间结算 + 断网直连防丢 + 废号过滤+简繁识别+邮箱脱敏)
const scriptStartTime = new Date();
const scriptName = 'PingMe'; 
const storeKey = 'pingme_accounts_v1';
const statsKey = 'pingme_daily_stats_v2'; 
const SECRET = '0fOiukQq7jXZV2GRi9LGlO';
const API_HOST = 'api.pingmeapp.net';

const MAX_VIDEO = 5;

// ================= 底层 API 封装 =================
function readVal(key) {
    if (typeof $persistentStore !== "undefined") return $persistentStore.read(key);
    if (typeof $prefs !== "undefined") return $prefs.valueForKey(key);
    return null;
}
function writeVal(val, key) {
    if (typeof $persistentStore !== "undefined") return $persistentStore.write(String(val), key);
    if (typeof $prefs !== "undefined") return $prefs.setValueForKey(String(val), key);
    return false;
}
function notify(title, subtitle, body) {
    if (typeof $notification !== "undefined") {
        $notification.post(String(title), String(subtitle), String(body));
    } else if (typeof $notify !== "undefined") {
        $notify(String(title), String(subtitle), String(body));
    } else {
        console.log(`[通知发送失败] 标题: ${title}\n内容:\n${body}`);
    }
}

// ⭐️ 参数解析：提取自定义测试时间、强制结算指令、邮箱过滤
let rawArgument = typeof $argument !== "undefined" && $argument ? $argument.trim() : "";
let forceSummary = false;
let targetHour = 23; 
let targetMin = 50;  
let customEmails = [];

if (rawArgument) {
    let args = rawArgument.split(/[,，|]+/).map(e => e.trim()).filter(e => e);
    for (let arg of args) {
        let timeMatch = arg.match(/^(\d{1,2})[:：](\d{1,2})$/);
        if (timeMatch) {
            targetHour = parseInt(timeMatch[1], 10);
            targetMin = parseInt(timeMatch[2], 10);
        } else if (arg === "结算" || arg === "summary") {
            forceSummary = true;
        } else if (arg.includes("@")) {
            customEmails.push(arg);
        }
    }
}

const IOS_VERSIONS = ['17.5.1','17.6.1','17.4.1','17.2.1','16.7.8','17.6','17.3.1','18.0.1','17.1.2','16.6.1'];
const IOS_SCALES = ['2.00','3.00','3.00','2.00','3.00'];
const IPHONE_MODELS = ['iPhone14,3','iPhone13,3','iPhone15,3','iPhone16,1','iPhone14,7','iPhone13,2','iPhone15,2','iPhone12,1'];
const CFN_VERS = ['1410.0.3','1494.0.7','1568.100.1','1209.1','1474.0.4','1568.200.2'];
const DARWIN_VERS = ['22.6.0','23.5.0','23.6.0','24.0.0','22.4.0'];

function getRandomIP() { return `${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}`; }
function getAccName(acc) {
    if (acc.capture && acc.capture.paramsRaw && acc.capture.paramsRaw.email) return decodeURIComponent(acc.capture.paramsRaw.email); 
    return acc.alias || acc.id;
}

// ⭐️ 邮箱脱敏功能：保留首尾字符，中间用***代替
function maskEmail(email) {
    if (typeof email !== 'string' || !email.includes('@')) return email;
    let [name, domain] = email.split('@');
    if (name.length <= 2) {
        name = name.charAt(0) + '*';
    } else {
        name = name.substring(0, 2) + '***' + name.slice(-1);
    }
    return `${name}@${domain}`;
}

function getTodayStr() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }

function getDailyStats() {
    const today = getTodayStr();
    let stats = { date: today, counts: {}, startBal: {}, endBal: {} };
    const raw = readVal(statsKey);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed.date === today) {
                stats = Object.assign(stats, parsed);
                stats.startBal = stats.startBal || {};
                stats.endBal = stats.endBal || {};
            }
        } catch (e) {}
    }
    return stats;
}
function saveDailyStats(stats) { writeVal(JSON.stringify(stats), statsKey); }

function loadStore() {
  const raw = readVal(storeKey);
  if (!raw) return { version: 1, accounts: {}, order: [] };
  try {
    const obj = JSON.parse(raw);
    if (!obj.accounts) obj.accounts = {};
    if (!Array.isArray(obj.order)) obj.order = Object.keys(obj.accounts);
    return obj;
  } catch (e) { return { version: 1, accounts: {}, order: [] }; }
}
function saveStore(store) { writeVal(JSON.stringify(store), storeKey); }

function autoCleanDuplicates(store) {
    const uniqueMap = {};
    let hasDuplicate = false;
    const newOrder = [];
    for (let i = store.order.length - 1; i >= 0; i--) {
        const id = store.order[i];
        const acc = store.accounts[id];
        if (!acc) continue;
        const email = getAccName(acc);
        if (!uniqueMap[email]) {
            uniqueMap[email] = id;
            newOrder.unshift(id); 
        } else {
            hasDuplicate = true;
            delete store.accounts[id];
        }
    }
    if (hasDuplicate) {
        store.order = newOrder;
        saveStore(store); 
    }
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

function getUTCSignDate() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
}

function pickItem(arr, seed) { return arr[seed % arr.length]; }

function buildUA(baseUA, seed) {
  const iosVer = pickItem(IOS_VERSIONS, seed);
  const scale = pickItem(IOS_SCALES, seed + 1);
  const model = pickItem(IPHONE_MODELS, seed + 2);
  const cfn = pickItem(CFN_VERS, seed + 3);
  const darwin = pickItem(DARWIN_VERS, seed + 4);
  
  if (baseUA && typeof baseUA === 'string') {
    let ua = baseUA;
    let changed = false;
    if (/iOS \d+(\.\d+){0,2}/.test(ua)) { ua = ua.replace(/iOS \d+(\.\d+){0,2}/, `iOS ${iosVer}`); changed = true; }
    if (/Scale\/\d+(\.\d+)?/.test(ua)) { ua = ua.replace(/Scale\/\d+(\.\d+)?/, `Scale/${scale}`); changed = true; }
    if (/iPhone\d+,\d+/.test(ua)) { ua = ua.replace(/iPhone\d+,\d+/, model); changed = true; }
    if (/CFNetwork\/[\d.]+/.test(ua)) { ua = ua.replace(/CFNetwork\/[\d.]+/, `CFNetwork/${cfn}`); changed = true; }
    if (/Darwin\/[\d.]+/.test(ua)) { ua = ua.replace(/Darwin\/[\d.]+/, `Darwin/${darwin}`); changed = true; }
    if (changed) return ua;
  }
  return `PingMe/1.0.0 (${model}; iOS ${iosVer}; Scale/${scale}) CFNetwork/${cfn} Darwin/${darwin}`;
}

function buildSignedParamsRaw(capture) {
  const params = {};
  Object.keys(capture.paramsRaw || {}).forEach(k => {
    if (k !== 'sign' && k !== 'signDate') params[k] = capture.paramsRaw[k];
  });
  params.signDate = getUTCSignDate();
  const signBase = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  params.sign = MD5(signBase + SECRET);
  return params;
}

function buildUrl(path, capture) {
  const params = buildSignedParamsRaw(capture);
  const qs = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  return `https://${API_HOST}/app/${path}?${qs}`;
}

function cloneHeaders(headers) {
  const out = {};
  Object.keys(headers || {}).forEach(k => out[k] = headers[k]);
  return out;
}

function buildHeaders(capture, ua, fakeIp) {
  const headers = cloneHeaders(capture.headers || {});
  delete headers['Content-Length']; delete headers['content-length'];
  delete headers[':authority']; delete headers[':method']; delete headers[':path']; delete headers[':scheme'];
  headers['Host'] = API_HOST;
  headers['Accept'] = headers['Accept'] || 'application/json';
  Object.keys(headers).forEach(k => { if (k.toLowerCase() === 'user-agent') delete headers[k]; });
  headers['User-Agent'] = ua;
  headers['X-Forwarded-For'] = fakeIp;
  headers['X-Real-IP'] = fakeIp;
  headers['Client-IP'] = fakeIp;
  headers['True-Client-IP'] = fakeIp;
  return headers;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function requestWithTimeout(options, timeout = 12000) {
  return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
          reject("请求超时(无网络响应)");
      }, timeout);

      if (typeof $httpClient !== "undefined") {
          $httpClient.get(options, (error, response, body) => {
              clearTimeout(timer);
              if (error) reject(error);
              else resolve({body, status: response ? (response.status || response.statusCode) : 200});
          });
      } else if (typeof $task !== "undefined") {
          options.method = 'GET';
          $task.fetch(options).then(res => {
              clearTimeout(timer);
              resolve({body: res.body, status: res.statusCode});
          }).catch(err => {
              clearTimeout(timer);
              reject(err.error || err);
          });
      } else {
          reject("未知的网络请求环境");
      }
  });
}

// ================= 核心执行逻辑 =================
async function runAccount(acc, currentRunCount) {
  const accountName = getAccName(acc);
  const ua = buildUA(acc.baseUA, acc.uaSeed);
  const fakeIp = getRandomIP(); 
  const headers = buildHeaders(acc.capture, ua, fakeIp);
  
  let initialBal = "?";
  let finalBal = "?";
  let checkInStr = "签×"; 
  let videoCount = 0;    
  let captchaIndex = 0; // 记录第几次触发风控

  // ⭐️ 树形排版 - 账号头部 (已应用脱敏)
  console.log(`\n👤 ${maskEmail(accountName)} [今日第${currentRunCount}次]`);
  console.log(`├ 🌐 伪装节点: ${fakeIp}`);

  async function fetchApi(path, retries = 3) {
      const url = buildUrl(path, acc.capture);
      let useDirect = false; 
      for (let i = 0; i < retries; i++) {
          try {
              let reqOpts = { url, headers };
              if (useDirect) {
                  reqOpts.policy = 'DIRECT'; 
                  reqOpts.node = 'DIRECT';   
                  reqOpts.opts = { policy: 'DIRECT' }; 
              }
              return await requestWithTimeout(reqOpts);
          } catch (err) {
              if (i === retries - 1) throw err;
              if (!useDirect) {
                  console.log(`├ ⚠️ ${path} 节点失效，已自动切换成【直连】模式抢救 (${i + 1}/${retries})...`);
                  useDirect = true; 
              } else {
                  console.log(`├ ⚠️ ${path} 直连网络依然超时，继续重连 (${i + 1}/${retries})...`);
              }
              await sleep(3000); 
          }
      }
  }

  try {
      try {
          const res = await fetchApi('queryBalanceAndBonus');
          const d = JSON.parse(res.body);
          if (d.retcode === 0) {
              initialBal = d.result.balance;
              console.log(`├ 💰 初始余额: ${initialBal} Coins`);
          } else {
              console.log(`├ ⚠️ 查询失败: ${d.retmsg}`);
          }
      } catch (e) { console.log(`├ ❌ 查询异常`); }
      
      await sleep(2000 + Math.random() * 1500);

      try {
          const res = await fetchApi('checkIn');
          const d = JSON.parse(res.body);
          if (d.retcode === 0) {
              console.log(`├ 📅 签到结果: 成功 (+0.010)`);
              checkInStr = "签✓"; 
          } else {
              // ⭐️ 【破案】：增加 '已经签过' 和 '已經簽過' 以及 'already' 多重匹配
              if (d.retmsg.includes('已經簽過') || d.retmsg.includes('已经签过') || d.retmsg.includes('already')) {
                  console.log(`├ 📅 签到状态: 今日已完成`);
                  checkInStr = "已签"; 
              } else {
                  console.log(`├ ⚠️ 签到异常: ${d.retmsg}`);
              }
          }
      } catch (e) { console.log(`├ ❌ 签到异常`); }
      
      for (let i = 1; i <= MAX_VIDEO; i++) {
          const randomDelay = Math.floor(Math.random() * 8000) + 35000; 
          await sleep(i === 1 ? (2000 + Math.random() * 2000) : randomDelay); 
          try {
              const res = await fetchApi('videoBonus');
              const d = JSON.parse(res.body);
              if (d.retcode === 0) {
                  console.log(`├ 🎬 视频第${i}次: +${d.result?.bonus || '?'} Coins`);
                  videoCount++; 
              } else {
                  if (d.retmsg.includes('圖形驗證碼') || d.retmsg.includes('验证码')) {
                      console.log(`├ ⚠️ 风控提醒: 第${i}次触发验证码限制，收手等待`);
                      captchaIndex = i;
                  } else {
                      console.log(`├ ⏸ 视频第${i}次: ${d.retmsg} (可能已达上限)`);
                  }
                  break; 
              }
          } catch (e) { console.log(`├ ❌ 视频第${i}次异常 (已跳过)`); }
      }

      try {
          const res = await fetchApi('queryBalanceAndBonus');
          const d = JSON.parse(res.body);
          if (d.retcode === 0) {
              finalBal = d.result.balance;
          }
      } catch (e) {}
      
      console.log(`└ 💎 最终余额: ${finalBal} Coins`);
      
      return { accountName, initialBal, finalBal, checkInStr, videoCount, captchaIndex, currentRunCount };

  } catch (globalErr) {
      console.log(`└ ❌ 发生致命错误停止`);
      return { accountName, initialBal, finalBal: "错误", checkInStr: "签×", videoCount: 0, captchaIndex: 0, currentRunCount };
  }
}

// ================= 启动逻辑 =================
(async () => {
  let store = loadStore();
  store = autoCleanDuplicates(store);
  
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
  } else {
      executeIds = validIds; 
  }

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
  
  // -----------------------------------------------------------
  // ⭐️ 核心：生成完美的 ASCII Tree 总结算日志
  // -----------------------------------------------------------
  const nowStr = String(scriptStartTime.getHours()).padStart(2, '0') + ':' + String(scriptStartTime.getMinutes()).padStart(2, '0');
  let finalLog = `━━━━━━━━━━━━━━\n💰 ${scriptName} 任务结束统计\n🕒 ${nowStr}\n\n`;
  
  let totalVideos = 0;
  let totalCaptcha = 0;
  const manualNotifyLines = [];
  const summaryNotifyLines = [];

  for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const accAlias = res.accountName;
      
      if (res.initialBal !== "?" && dailyStats.startBal[accAlias] === undefined) {
          dailyStats.startBal[accAlias] = parseFloat(res.initialBal);
      }
      if (res.finalBal !== "?") {
          dailyStats.endBal[accAlias] = parseFloat(res.finalBal);
      }

      // --- Console 树状排版 (已应用脱敏) ---
      let checkStatus = res.checkInStr.includes('已签') ? '已完成' : (res.checkInStr.includes('✓') ? '成功' : '失败/未签');
      let earn = (res.videoCount * 0.004).toFixed(3);
      finalLog += `👤 ${maskEmail(res.accountName)}\n`;
      finalLog += `├ 📅 签到：${checkStatus}\n`;
      finalLog += `├ 🎬 视频：${res.videoCount}次 (+${earn})\n`;
      if (res.captchaIndex > 0) {
          finalLog += `├ ⚠️ 风控：第${res.captchaIndex}次触发\n`;
          totalCaptcha++;
      }
      finalLog += `└ 💎 余额：${res.initialBal} → ${res.finalBal}\n\n`;
      
      totalVideos += res.videoCount;

      // --- 通知排版 (已应用脱敏) ---
      const solidCount = res.videoCount;
      const hollowCount = MAX_VIDEO - solidCount;
      const progressBar = '■'.repeat(solidCount) + '□'.repeat(hollowCount);
      const shortName = maskEmail(res.accountName).split('@')[0];
      const checkMark = res.checkInStr.includes('×') ? '×' : '✓';
      
      let vtStr = String(earn);
      if (vtStr.startsWith('0.')) vtStr = vtStr.substring(1); 
      vtStr = '+' + vtStr;

      manualNotifyLines.push(`☻ ${shortName}｜${res.initialBal}▸${res.finalBal} 〔${checkMark}${res.currentRunCount}次 | ${progressBar} ${vtStr}〕`);

      const start = dailyStats.startBal[accAlias];
      const end = dailyStats.endBal[accAlias];
      let earnedStr = "?";
      if (start !== undefined && end !== undefined) {
          let diff = parseFloat((end - start).toFixed(3));
          earnedStr = diff >= 0 ? `+${diff}` : `${diff}`;
      }
      summaryNotifyLines.push(`☻ ${shortName}｜共签${res.currentRunCount}次 ◂ 日总计 ${earnedStr} (余${end})`);
  }

  // --- 补全底部统计 ---
  let totalEarn = (totalVideos * 0.004).toFixed(3);
  finalLog += `━━━━━━━━━━━━━━\n📊 今日统计\n`;
  finalLog += `├ 👥 账号：${results.length}\n`;
  finalLog += `├ 🎬 视频：${totalVideos}次\n`;
  finalLog += `├ 💰 收益：+${totalEarn} Coins\n`;
  finalLog += `└ ⚠️ 风控：${totalCaptcha}次\n━━━━━━━━━`;

  saveDailyStats(dailyStats);

  // ⭐️ 核心判定：当前时间是否匹配参数里的 targetHour:targetMin (容错5分钟，保证一定触发)
  const currentHour = scriptStartTime.getHours();
  const currentMin = scriptStartTime.getMinutes();
  const isTargetTime = (currentHour === targetHour && currentMin >= targetMin && currentMin < targetMin + 5);
  
  const shouldSummary = isTargetTime || forceSummary;

  const isManualRun = (() => {
      if (typeof $environment !== 'undefined') {
          const execType = String($environment['execution-type'] || $environment['execute-type'] || '').toLowerCase();
          if (execType.includes('manual') || execType === '0') return true;
          if (execType.includes('cron')) return false;
      }
      if (scriptStartTime.getSeconds() > 2) return true;
      return false; 
  })();

  // -----------------------------------------------------------
  // ⭐️ 底部系统状态日志（完美契合树形风格）
  // -----------------------------------------------------------
  const targetTimeStr = `${String(targetHour).padStart(2,'0')}:${String(targetMin).padStart(2,'0')}`;
  let notifyLog = `\n🤖 通知状态\n`;
  notifyLog += `├ 🕒 当前时间：${nowStr}\n`;
  notifyLog += `├ 🎯 结算时间：${targetTimeStr}${forceSummary ? " (参数强制结算)" : ""}\n`;

  if (shouldSummary) {
      let titleSuffix = forceSummary ? " 📊 手动测试结算" : " 🌙 每日结算";
      notify(scriptName + titleSuffix, `✓${executeIds.length}个账号今日签到完成`, summaryNotifyLines.join('\n'));
      notifyLog += `└ 🔔 达到结算条件，已推送今日总结算！`;
  } else if (isManualRun) {
      notify(scriptName + " ✋ 手动执行", `✓${executeIds.length}个账号单次完毕`, manualNotifyLines.join('\n'));
      notifyLog += `└ ✋ 触发手动执行，已推送单次进度！`;
  } else {
      notifyLog += `└ 🔕 未到结算时段，本次不推送通知`;
  }

  console.log(finalLog + notifyLog + '\n');

  $done();

})().catch(err => {
  console.log("❌ 脚本全局环境出错: " + err);
  $done();
});