// ============================================================
// 服务器流量 · Surge 面板脚本（纯本地，直连 AWS API）
// 不经过任何中转/中间层，AK/SK 只存在本机模块参数里
// ============================================================

var SHA256 = (function () {
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function digest(bytes) {
    var len = bytes.length, bitLen = len * 8;
    var total = Math.ceil((len + 9) / 64) * 64;
    var m = new Uint8Array(total);
    for (var i = 0; i < len; i++) m[i] = bytes[i];
    m[len] = 0x80;
    var hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
    m[total - 8] = (hi >>> 24) & 0xff; m[total - 7] = (hi >>> 16) & 0xff;
    m[total - 6] = (hi >>> 8) & 0xff;  m[total - 5] = hi & 0xff;
    m[total - 4] = (lo >>> 24) & 0xff; m[total - 3] = (lo >>> 16) & 0xff;
    m[total - 2] = (lo >>> 8) & 0xff;  m[total - 1] = lo & 0xff;

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
        h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = new Int32Array(64);

    for (var off = 0; off < total; off += 64) {
      for (var t = 0; t < 16; t++) {
        w[t] = (m[off + t * 4] << 24) | (m[off + t * 4 + 1] << 16) | (m[off + t * 4 + 2] << 8) | m[off + t * 4 + 3];
      }
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var T1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var T2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + T1) | 0;
        d = c; c = b; b = a; a = (T1 + T2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    var out = new Uint8Array(32), hs = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (var j = 0; j < 8; j++) {
      out[j * 4] = (hs[j] >>> 24) & 0xff; out[j * 4 + 1] = (hs[j] >>> 16) & 0xff;
      out[j * 4 + 2] = (hs[j] >>> 8) & 0xff; out[j * 4 + 3] = hs[j] & 0xff;
    }
    return out;
  }

  function hmac(keyBytes, msgBytes) {
    var block = 64, k = keyBytes;
    if (k.length > block) k = digest(k);
    var p = new Uint8Array(block);
    for (var i = 0; i < k.length; i++) p[i] = k[i];
    var ipad = new Uint8Array(block + msgBytes.length);
    var opad = new Uint8Array(block + 32);
    for (i = 0; i < block; i++) { ipad[i] = p[i] ^ 0x36; opad[i] = p[i] ^ 0x5c; }
    for (i = 0; i < msgBytes.length; i++) ipad[block + i] = msgBytes[i];
    var inner = digest(ipad);
    for (i = 0; i < 32; i++) opad[block + i] = inner[i];
    return digest(opad);
  }

  function utf8(str) {
    var arr = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) arr.push(c);
      else if (c < 0x800) arr.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c < 0xd800 || c >= 0xe000) arr.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      else {
        i++;
        var cp = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
        arr.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      }
    }
    return new Uint8Array(arr);
  }

  function hex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  return { digest: digest, hmac: hmac, utf8: utf8, hex: hex };
})();

// ============================================================
// 服务器流量 · 通用版（参数化，不写死任何域名/IP/密钥）
// 数据源：AWS Lightsail API（SigV4 本机签名，无中转）
// 所有配置通过模块 argument 传入
// ============================================================

// ---------------- AWS SigV4 签名 ----------------
function pad2(n) { return (n < 10 ? '0' : '') + n; }

function amzDateNow() {
  var d = new Date();
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
         'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}

function awsSign(opts) {
  var region = opts.region;
  var service = 'lightsail';
  var host = service + '.' + region + '.amazonaws.com';
  var target = opts.target;
  var body = opts.body || '{}';
  var amzDate = amzDateNow();
  var dateStamp = amzDate.slice(0, 8);

  var payloadHash = SHA256.hex(SHA256.digest(SHA256.utf8(body)));

  var canonicalHeaders =
    'content-type:application/x-amz-json-1.1\n' +
    'host:' + host + '\n' +
    'x-amz-date:' + amzDate + '\n' +
    'x-amz-target:' + target + '\n';
  var signedHeaders = 'content-type;host;x-amz-date;x-amz-target';
  var canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  var scope = dateStamp + '/' + region + '/' + service + '/aws4_request';
  var stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope,
    SHA256.hex(SHA256.digest(SHA256.utf8(canonicalRequest)))].join('\n');

  var k = SHA256.hmac(SHA256.utf8('AWS4' + opts.secretKey), SHA256.utf8(dateStamp));
  k = SHA256.hmac(k, SHA256.utf8(region));
  k = SHA256.hmac(k, SHA256.utf8(service));
  k = SHA256.hmac(k, SHA256.utf8('aws4_request'));
  var signature = SHA256.hex(SHA256.hmac(k, SHA256.utf8(stringToSign)));

  var auth = 'AWS4-HMAC-SHA256 Credential=' + opts.accessKey + '/' + scope +
             ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  return {
    url: 'https://' + host + '/',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Date': amzDate,
      'X-Amz-Target': target,
      'Authorization': auth
    },
    body: body
  };
}

// ---------------- 参数解析 ----------------
function parseArgs(raw) {
  var out = {};
  String(raw || '').split('&').forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf('=');
    if (i < 0) { out[kv.trim()] = ''; return; }
    out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return out;
}

var A = parseArgs(typeof $argument !== 'undefined' ? $argument : '');

function arg() {
  for (var i = 0; i < arguments.length; i++) {
    var k = arguments[i];
    if (A[k] !== undefined && A[k] !== '') return A[k];
  }
  return '';
}

// Surge 要求 #!arguments 的默认值非空，所以模块里填的是占位符；
// 这里把占位符/未填统一视作空值，避免把占位当密钥去签名。
function real(v) {
  v = String(v || '').trim();
  if (!v) return '';
  // 精确匹配占位词；不能用 /^(ak|sk)/i，那会把真实密钥 AKIA... / AKIA 开头的 key 误杀
  if (/^(空|无|none|null|undefined)$/i.test(v)) return '';
  if (/^(YOUR_|填入|填写|请填写)/i.test(v)) return '';
  if (/^<.+>$/.test(v)) return '';
  if (v === 'ak' || v === 'sk' || v === 'AK' || v === 'SK') return '';
  return v;
}

var ACCESS_KEY = real(arg('ak', 'AK'));
var SECRET_KEY = real(arg('sk', 'SK'));
var REGION = arg('region') || 'ap-southeast-1';
var QUOTA_GB = Number(arg('quota') || 2048);
var TIMEOUT = Number(arg('timeout') || 20);

// 实例清单："Debian-1" 或 "Debian-1,Debian-2"；留空则自动读取账号下所有实例
var INSTANCES = arg('instances').split(/[;|]/).map(function (s) { return s.trim(); })
  .filter(function (s) { return s && s !== 'ALL' && s !== 'none'; });

// 每台实例的展示名 / 绑定域名 / 计费日 / 到期日，支持三种写法：
//   hosts=Debian-1:ls1.zhiaon.top,Debian-2:ls2.zhiaon.top
//   labels=Debian-1:ls1,Debian-2:ls2
//   billdays=Debian-1:17,Debian-2:1
//   expiry=Debian-1:2026-12-31,Debian-2:2027-01-15
function parsePair(raw) {
  var out = {};
  String(raw || '').split(/[;|,]/).forEach(function (pair) {
    if (!pair) return;
    var i = pair.indexOf(':');
    if (i < 0) return;
    var k = pair.slice(0, i).trim();
    var v = pair.slice(i + 1).trim();
    // 占位符当空处理，例如 实例名:ls1.zhiaon.top 这种示例值不算配置
    if (/^(实例名|域名|显示名|日期|示例|<.+>)$/.test(k)) return;
    if (/^(ls1\.zhiaon\.top|ls2\.zhiaon\.top)$/.test(v)) return;
    if (k === 'none' || v === 'none' || v === 'ALL') return;
    if (k && v) out[k] = v;
  });
  return out;
}

var HOSTS = parsePair(arg('hosts'));
var LABELS = parsePair(arg('labels'));
var BILLDAYS = parsePair(arg('billdays'));
var EXPIRY = parsePair(arg('expiry'));

// ---------------- 单位与格式化 ----------------
var G = 1073741824;
var DAY = 86400000;

function gb(b) {
  if (b == null) return '--';
  if (b >= G) {
    var g = (b / G).toFixed(2);
    while (g.length > 1 && g.charAt(g.length - 1) === '0') g = g.slice(0, -1);
    if (g.charAt(g.length - 1) === '.') g = g.slice(0, -1);
    return g + 'G';
  }
  return (b / 1048576).toFixed(0) + 'M';
}

function bar(p) {
  var n = Math.max(0, Math.min(10, Math.round(p / 10)));
  var s = '';
  for (var i = 0; i < 10; i++) s += i < n ? '▰' : '▱';
  return s;
}

function color(p) {
  if (p == null) return '#8E8E93';
  if (p >= 90) return '#FF3B30';
  if (p >= 75) return '#FF9500';
  if (p >= 50) return '#FFCC00';
  return '#34C759';
}

function md(s) { return String(s).slice(5).replace('-', '/'); }

function cycleRange(now, day) {
  var d = Math.min(28, Math.max(1, Number(day) || 1));
  var start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d));
  if (start > now) start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, d));
  var end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, d));
  return { start: start, end: end, totalDays: Math.round((end - start) / DAY) };
}

function fail(msg) {
  $done({
    title: '服务器流量',
    content: msg,
    icon: 'exclamationmark.triangle.fill',
    'icon-color': '#FF3B30'
  });
}

if (!ACCESS_KEY || !SECRET_KEY) {
  fail('缺少密钥\n请在模块参数里填 ak 和 sk');
} else {
  main();
}

function main() {
  var now = new Date();
  var quota = QUOTA_GB * G;
  var results = [];

  function post(target, payload, cb) {
    var signed = awsSign({
      region: REGION,
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      target: target,
      body: JSON.stringify(payload)
    });
    $httpClient.post({
      url: signed.url,
      headers: signed.headers,
      body: signed.body,
      timeout: TIMEOUT
    }, function (err, resp, data) {
      if (err) { cb(String(err), null); return; }
      if (resp && resp.status && resp.status !== 200) {
        cb('HTTP ' + resp.status + ' ' + String(data || '').slice(0, 160), null);
        return;
      }
      try { cb(null, JSON.parse(data)); } catch (e) { cb('解析失败', null); }
    });
  }

  post('Lightsail_20161128.GetInstances', {}, function (err, j) {
    if (err) { fail('获取实例失败：' + err); return; }

    var all = (j && j.instances) || [];
    var insts = INSTANCES.length
      ? all.filter(function (x) { return INSTANCES.indexOf(x.name) >= 0; })
      : all;

    if (!insts.length) {
      fail(INSTANCES.length
        ? '找不到实例：' + INSTANCES.join(',') + '\n请检查 instances 参数'
        : '账号下没有 Lightsail 实例');
      return;
    }

    var idx = 0;
    next();

    function next() {
      if (idx >= insts.length) { render(); return; }
      var inst = insts[idx++];
      var c = cycleRange(now, BILLDAYS[inst.name] || 1);
      var elapsed = Math.max(1, Math.round((now - c.start) / DAY));

      var r = {
        id: inst.name,
        host: HOSTS[inst.name] || '',
        label: LABELS[inst.name] || HOSTS[inst.name] || inst.name,
        ip: inst.publicIpAddress || '',
        state: (inst.state && inst.state.name) || '',
        quotaGb: QUOTA_GB,
        cycleStart: c.start.toISOString().slice(0, 10),
        reset: c.end.toISOString().slice(0, 10),
        resetDays: Math.round((c.end - now) / DAY),
        elapsedDays: elapsed,
        totalDays: c.totalDays,
        expire: EXPIRY[inst.name] || null,
        daysLeft: EXPIRY[inst.name]
          ? Math.round((new Date(EXPIRY[inst.name] + 'T00:00:00Z') - now) / DAY)
          : null,
        dnsMismatch: null,
        err: null
      };

      // 域名解析比对：换 IP 后立刻可见
      if (r.host) {
        $httpClient.get({
          url: 'https://cloudflare-dns.com/dns-query?name=' + r.host + '&type=A',
          headers: { accept: 'application/dns-json' },
          timeout: 8
        }, function (de, dresp, dbody) {
          if (!de && dbody) {
            try {
              var dj = JSON.parse(dbody);
              var got = (dj.Answer || []).filter(function (a) { return a.type === 1; })
                .map(function (a) { return a.data; });
              if (got.length && got.indexOf(r.ip) < 0) r.dnsMismatch = got;
            } catch (e2) {}
          }
          metrics();
        });
      } else {
        metrics();
      }

      function metrics() {
        pull('NetworkOut', function (e1, outB) {
          pull('NetworkIn', function (e2, inB) {
            if (e1 && e2) r.err = e1;
            r.outBytes = outB;
            r.inBytes = inB;
            r.totalBytes = (outB == null && inB == null) ? null : (outB || 0) + (inB || 0);
            r.remaining = outB == null ? null : Math.max(0, quota - outB);
            var pct = outB == null ? null : (outB / quota) * 100;
            r.pct = pct == null ? null : (pct < 1 ? Math.round(pct * 100) / 100 : Math.round(pct * 10) / 10);
            r.outDaily = outB == null ? null : outB / elapsed;
            r.inDaily = inB == null ? null : inB / elapsed;
            r.outForecast = r.outDaily == null ? null : r.outDaily * c.totalDays;
            r.inForecast = r.inDaily == null ? null : r.inDaily * c.totalDays;
            results.push(r);
            next();
          });
        });
      }

      function pull(metricName, cb) {
        post('Lightsail_20161128.GetInstanceMetricData', {
          instanceName: inst.name,
          metricName: metricName,
          period: 21600,
          startTime: Math.floor(c.start.getTime() / 1000),
          endTime: Math.floor(now.getTime() / 1000),
          statistics: ['Sum'],
          unit: 'Bytes'
        }, function (e, d) {
          if (e) { cb(e, null); return; }
          var sum = 0;
          (d.metricData || []).forEach(function (p) { sum += Number(p.sum) || 0; });
          cb(null, sum);
        });
      }
    }
  });

  function render() {
    var lines = [], maxPct = 0, alerts = 0;

    results.forEach(function (s, i) {
      if (i > 0) lines.push('');
      if (s.pct != null && s.pct > maxPct) maxPct = s.pct;
      if ((s.pct != null && s.pct >= 85) || (s.daysLeft != null && s.daysLeft <= 7) || s.dnsMismatch) alerts++;

      lines.push(s.label + (s.state && s.state !== 'running' ? ' [' + s.state + ']' : ''));

      if (s.dnsMismatch) {
        lines.push('⚠️ ' + s.host + ' 解析到 ' + s.dnsMismatch.join(',') + '，实例已是 ' + s.ip);
      } else if (s.host) {
        lines.push('🔗 ' + s.host + ' → ' + s.ip);
      }

      lines.push('配额用度 ' + bar(s.pct || 0) + ' ' + (s.pct == null ? '--' : s.pct + '%'));

      if (s.outBytes == null && s.inBytes == null) {
        lines.push('采集失败：' + (s.err || '未知'));
        return;
      }

      lines.push('↑ 出站 ' + gb(s.outBytes) + '  ·  ↓ 入站 ' + gb(s.inBytes));
      lines.push('双向合计 ' + gb(s.totalBytes));
      lines.push('出站剩余 ' + gb(s.remaining) + '（配额 ' + s.quotaGb + 'G，仅计↑）');
      lines.push('日均 ↑' + gb(s.outDaily) + '  ↓' + gb(s.inDaily));
      lines.push('预估 ↑' + gb(s.outForecast) + '  ↓' + gb(s.inForecast));
      lines.push('周期 ' + md(s.cycleStart) + '-' + md(s.reset) + '，' + s.resetDays + ' 天后重置');
      if (s.expire) lines.push('到期 ' + s.expire + '（剩 ' + s.daysLeft + ' 天）');
    });

    $done({
      title: '服务器流量' + (alerts ? ' ⚠️' : '') + ' · ' + md(now.toISOString().slice(0, 10)),
      content: lines.join('\n'),
      icon: 'server.rack',
      'icon-color': color(maxPct)
    });
  }
}
