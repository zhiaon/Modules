// PingMe_UnlockLogin.js (纯净版：彻底移除启动监听，杜绝权限越权报错)
const SECRET = '0fOiukQq7jXZV2GRi9LGlO';
const APP_NAME = 'PingMe';

// ================= MD5 核心算法 =================
function MD5(string) {
  function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
  function AddUnsigned(lX, lY) {
    const lX4 = lX & 0x40000000, lY4 = lY & 0x40000000, lX8 = lX & 0x80000000, lY8 = lY & 0x80000000;
    const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) return (lResult & 0x40000000) ? (lResult ^ 0xC0000000 ^ lX8 ^ lY8) : (lResult ^ 0x40000000 ^ lX8 ^ lY8);
    return lResult ^ lX8 ^ lY8;
  }
  function F(x, y, z) { return (x & y) | ((~x) & z); }
  function G(x, y, z) { return (x & z) | (y & (~z)); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | (~z)); }
  function FF(a,b,c,d,x,s,ac){a=AddUnsigned(a,AddUnsigned(AddUnsigned(F(b,c,d),x),ac));return AddUnsigned(RotateLeft(a,s),b);}
  function GG(a,b,c,d,x,s,ac){a=AddUnsigned(a,AddUnsigned(AddUnsigned(G(b,c,d),x),ac));return AddUnsigned(RotateLeft(a,s),b);}
  function HH(a,b,c,d,x,s,ac){a=AddUnsigned(a,AddUnsigned(AddUnsigned(H(b,c,d),x),ac));return AddUnsigned(RotateLeft(a,s),b);}
  function II(a,b,c,d,x,s,ac){a=AddUnsigned(a,AddUnsigned(AddUnsigned(I(b,c,d),x),ac));return AddUnsigned(RotateLeft(a,s),b);}
  function ConvertToWordArray(str){
    const lMessageLength=str.length;
    const lNumberOfWords_temp1=lMessageLength+8;
    const lNumberOfWords_temp2=(lNumberOfWords_temp1-(lNumberOfWords_temp1%64))/64;
    const lNumberOfWords=(lNumberOfWords_temp2+1)*16;
    const lWordArray=Array(lNumberOfWords).fill(0);
    let lBytePosition=0,lByteCount=0;
    while(lByteCount<lMessageLength){
      const lWordCount=(lByteCount-(lByteCount%4))/4;
      lBytePosition=(lByteCount%4)*8;
      lWordArray[lWordCount]|=str.charCodeAt(lByteCount)<<lBytePosition;
      lByteCount++;
    }
    const lWordCount=(lByteCount-(lByteCount%4))/4;
    lBytePosition=(lByteCount%4)*8;
    lWordArray[lWordCount]|=0x80<<lBytePosition;
    lWordArray[lNumberOfWords-2]=lMessageLength<<3;
    lWordArray[lNumberOfWords-1]=lMessageLength>>>29;
    return lWordArray;
  }
  function WordToHex(lValue){
    let WordToHexValue='';
    for(let lCount=0;lCount<=3;lCount++){
      const lByte=(lValue>>>(lCount*8))&255;
      const WordToHexValue_temp='0'+lByte.toString(16);
      WordToHexValue+=WordToHexValue_temp.substr(WordToHexValue_temp.length-2,2);
    }
    return WordToHexValue;
  }
  const x=ConvertToWordArray(string);
  let a=0x67452301,b=0xEFCDAB89,c=0x98BADCFE,d=0x10325476;
  const S11=7,S12=12,S13=17,S14=22,S21=5,S22=9,S23=14,S24=20;
  const S31=4,S32=11,S33=16,S34=23,S41=6,S42=10,S43=15,S44=21;
  for(let k=0;k<x.length;k+=16){
    const AA=a,BB=b,CC=c,DD=d;
    a=FF(a,b,c,d,x[k+0],S11,0xD76AA478);d=FF(d,a,b,c,x[k+1],S12,0xE8C7B756);c=FF(c,d,a,b,x[k+2],S13,0x242070DB);b=FF(b,c,d,a,x[k+3],S14,0xC1BDCEEE);
    a=FF(a,b,c,d,x[k+4],S11,0xF57C0FAF);d=FF(d,a,b,c,x[k+5],S12,0x4787C62A);c=FF(c,d,a,b,x[k+6],S13,0xA8304613);b=FF(b,c,d,a,x[k+7],S14,0xFD469501);
    a=FF(a,b,c,d,x[k+8],S11,0x698098D8);d=FF(d,a,b,c,x[k+9],S12,0x8B44F7AF);c=FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1);b=FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
    a=FF(a,b,c,d,x[k+12],S11,0x6B901122);d=FF(d,a,b,c,x[k+13],S12,0xFD987193);c=FF(c,d,a,b,x[k+14],S13,0xA679438E);b=FF(b,c,d,a,x[k+15],S14,0x49B40821);
    a=GG(a,b,c,d,x[k+1],S21,0xF61E2562);d=GG(d,a,b,c,x[k+6],S22,0xC040B340);c=GG(c,d,a,b,x[k+11],S23,0x265E5A51);b=GG(b,c,d,a,x[k+0],S24,0xE9B6C7AA);
    a=GG(a,b,c,d,x[k+5],S21,0xD62F105D);d=GG(d,a,b,c,x[k+10],S22,0x02441453);c=GG(c,d,a,b,x[k+15],S23,0xD8A1E681);b=GG(b,c,d,a,x[k+4],S24,0xE7D3FBC8);
    a=GG(a,b,c,d,x[k+9],S21,0x21E1CDE6);d=GG(d,a,b,c,x[k+14],S22,0xC33707D6);c=GG(c,d,a,b,x[k+3],S23,0xF4D50D87);b=GG(b,c,d,a,x[k+8],S24,0x455A14ED);
    a=GG(a,b,c,d,x[k+13],S21,0xA9E3E905);d=GG(d,a,b,c,x[k+2],S22,0xFCEFA3F8);c=GG(c,d,a,b,x[k+7],S23,0x676F02D9);b=GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
    a=HH(a,b,c,d,x[k+5],S31,0xFFFA3942);d=HH(d,a,b,c,x[k+8],S32,0x8771F681);c=HH(c,d,a,b,x[k+11],S33,0x6D9D6122);b=HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
    a=HH(a,b,c,d,x[k+1],S31,0xA4BEEA44);d=HH(d,a,b,c,x[k+4],S32,0x4BDECFA9);c=HH(c,d,a,b,x[k+7],S33,0xF6BB4B60);b=HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
    a=HH(a,b,c,d,x[k+13],S31,0x289B7EC6);d=HH(d,a,b,c,x[k+0],S32,0xEAA127FA);c=HH(c,d,a,b,x[k+3],S33,0xD4EF3085);b=HH(b,c,d,a,x[k+6],S34,0x04881D05);
    a=HH(a,b,c,d,x[k+9],S31,0xD9D4D039);d=HH(d,a,b,c,x[k+12],S32,0xE6DB99E5);c=HH(c,d,a,b,x[k+15],S33,0x1FA27CF8);b=HH(b,c,d,a,x[k+2],S34,0xC4AC5665);
    a=II(a,b,c,d,x[k+0],S41,0xF4292244);d=II(d,a,b,c,x[k+7],S42,0x432AFF97);c=II(c,d,a,b,x[k+14],S43,0xAB9423A7);b=II(b,c,d,a,x[k+5],S44,0xFC93A039);
    a=II(a,b,c,d,x[k+12],S41,0x655B59C3);d=II(d,a,b,c,x[k+3],S42,0x8F0CCC92);c=II(c,d,a,b,x[k+10],S43,0xFFEFF47D);b=II(b,c,d,a,x[k+1],S44,0x85845DD1);
    a=II(a,b,c,d,x[k+8],S41,0x6FA87E4F);d=II(d,a,b,c,x[k+15],S42,0xFE2CE6E0);c=II(c,d,a,b,x[k+6],S43,0xA3014314);b=II(b,c,d,a,x[k+13],S44,0x4E0811A1);
    a=II(a,b,c,d,x[k+4],S41,0xF7537E82);d=II(d,a,b,c,x[k+11],S42,0xBD3AF235);c=II(c,d,a,b,x[k+2],S43,0x2AD7D2BB);b=II(b,c,d,a,x[k+9],S44,0xEB86D391);
    a=AddUnsigned(a,AA);b=AddUnsigned(b,BB);c=AddUnsigned(c,CC);d=AddUnsigned(d,DD);
  }
  return(WordToHex(a)+WordToHex(b)+WordToHex(c)+WordToHex(d)).toLowerCase();
}

function randomUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.toUpperCase().replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function sendDebouncedNotification(type, title, subtitle, body) {
    var now = Date.now();
    var lastTimeKey = 'pingme_last_notify_' + type;
    var lastTime = 0;
    try {
        if (typeof $persistentStore !== 'undefined') {
            lastTime = parseInt($persistentStore.read(lastTimeKey) || '0', 10);
        }
    } catch (e) {}

    if (now - lastTime < 5000) return;

    try {
        if (typeof $persistentStore !== 'undefined') {
            $persistentStore.write(String(now), lastTimeKey);
        }
        if (typeof $notification !== 'undefined' && $notification.post) {
            $notification.post(title, subtitle, body);
        } else if (typeof $notify !== 'undefined') {
            $notify(title, subtitle, body);
        }
    } catch (e) {}
}

function parseRawQuery(qs) {
    var params = {};
    if (!qs) return params;
    qs.split('&').forEach(function(pair) {
        if (!pair) return;
        var idx = pair.indexOf('=');
        if (idx === -1) {
            params[pair] = '';
        } else {
            params[pair.substring(0, idx)] = pair.substring(idx + 1);
        }
    });
    return params;
}

function buildRawQuery(params) {
    var keys = Object.keys(params);
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
        parts.push(keys[i] + '=' + params[keys[i]]);
    }
    return parts.join('&');
}

// ================= 主逻辑 =================
try {
    var url = $request.url;
    var lowerUrl = url.toLowerCase();

    // 1. 只有主动点【退出登录】时介入：拦截注销，阻断退出，保留 Token
    if (lowerUrl.indexOf('/logout') !== -1 || lowerUrl.indexOf('/signout') !== -1) {
        console.log(`[${APP_NAME} 拦截注销] 命中退出操作，已阻断！`);
        sendDebouncedNotification('logout', APP_NAME + ' ✅', '拦截退出成功', '已阻断注销请求，Token 永久保留');
        $done({
            response: {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ retcode: 0, retmsg: 'success', result: {} })
            }
        });
    } 
    // 2. 只有主动点【登录/发验证码/注册】时介入：伪造全新设备号
    else if (
        lowerUrl.indexOf('/login') !== -1 || 
        lowerUrl.indexOf('/signin') !== -1 || 
        lowerUrl.indexOf('/sendcode') !== -1 || 
        lowerUrl.indexOf('/register') !== -1 ||
        lowerUrl.indexOf('/signup') !== -1
    ) {
        var qmarkIdx = url.indexOf('?');
        var baseUrl = (qmarkIdx !== -1) ? url.substring(0, qmarkIdx) : url;
        var params = qmarkIdx !== -1 ? parseRawQuery(url.substring(qmarkIdx + 1)) : {};

        var newUUID = randomUUID();
        var deviceKeys = ['uniquedeviceid', 'deviceId', 'device_id', 'uuid', 'mac', 'hardwareId'];
        var hasModified = false;

        for (var i = 0; i < deviceKeys.length; i++) {
            var k = deviceKeys[i];
            if (params[k] !== undefined) {
                params[k] = (k === 'uniquedeviceid') ? (newUUID + 'PingMeIOS') : newUUID;
                hasModified = true;
            }
        }

        if (!hasModified) {
            params['uniquedeviceid'] = newUUID + 'PingMeIOS';
        }

        // 重新计算签名
        delete params['sign'];
        var sortedKeys = Object.keys(params).sort();
        var baseParts = [];
        for (var si = 0; si < sortedKeys.length; si++) {
            baseParts.push(sortedKeys[si] + '=' + params[sortedKeys[si]]);
        }
        params['sign'] = MD5(baseParts.join('&') + SECRET);

        var newUrl = baseUrl + '?' + buildRawQuery(params);
        console.log(`[${APP_NAME} 登录多开] 已生成全新设备号: ${newUUID}`);
        sendDebouncedNotification('login', APP_NAME + ' ✅', '免卸载登录生效', '已伪装全新设备号');

        $done({ url: newUrl });
    } 
    // 3. 其他所有日常请求（包括打开 App 的所有动作）：100% 原样放行，绝不干扰！
    else {
        $done({});
    }
} catch (e) {
    console.log(`[${APP_NAME} 解锁报错]: ` + e.message);
    $done({});
}
