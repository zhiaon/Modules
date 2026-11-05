// ============================================================
// 机场流量面板 · Surge 通用版  v1.1
// 数据源：订阅链接响应头 subscription-userinfo（V2board / SSPanel / 新V2 通用）
// 参数：机场名|订阅链接|每月重置日|UA|指定策略
//   · 支持多个机场：机场名与订阅链接都用分号 ; 分隔，按顺序一一对应
//   · 例：花云;云梯 | https://a/sub;https://b/sub | 1 | Clash/1.18.0 | none
// ============================================================

var ARG = (typeof $argument !== 'undefined' && $argument) ? String($argument) : '';
var P = ARG.split('|');

function part(i, def) {
  var v = (P[i] === undefined ? '' : String(P[i])).trim();
  return v ? v : def;
}
function real(v) {
  v = String(v || '').trim();
  if (/^(空|无|none|null|undefined|1)$/i.test(v)) return '';
  if (/^<.+>$/.test(v)) return '';
  if (/^填/.test(v)) return '';
  return v;
}
function list(s) {
  var out = [];
  String(s || '').split(/[;；]/).forEach(function (x) {
    x = x.trim();
    if (x) out.push(x);
  });
  return out;
}

var NAMES = list(part(0, ''));
var SUBS = list(part(1, ''));
var RDAY = parseInt(part(2, '1'), 10);
if (!(RDAY >= 1 && RDAY <= 31)) RDAY = 1;
var UA = part(3, 'Clash/1.18.0');
var POLICY = real(part(4, ''));

var GB = 1073741824;

// ---------------- 工具 ----------------
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function md(d) { return pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function ymd(d) { return d.getFullYear() + '-' + md(d); }
function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

function fmtB(b) {
  if (b === null || b === undefined || isNaN(b)) return '--';
  var g = b / GB;
  if (g >= 1024) return (g / 1024).toFixed(2) + ' TB';
  if (g >= 100) return g.toFixed(1) + ' GB';
  return g.toFixed(2) + ' GB';
}

function bar(pct, n) {
  n = n || 12;
  var f = Math.round(pct / 100 * n);
  if (!isFinite(f) || f < 0) f = 0;
  if (f > n) f = n;
  var s = '';
  for (var i = 0; i < n; i++) s += (i < f ? '\u2588' : '\u2591');
  return s;
}

function hash(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function getHeader(h, key) {
  if (!h) return '';
  var lk = String(key).toLowerCase();
  for (var k in h) {
    if (String(k).toLowerCase() === lk) return h[k];
  }
  return '';
}

function parseUserInfo(raw) {
  var o = {};
  String(raw || '').split(';').forEach(function (seg) {
    var i = seg.indexOf('=');
    if (i < 0) return;
    var k = seg.slice(0, i).trim().toLowerCase();
    var v = seg.slice(i + 1).trim();
    if (/^\d+$/.test(v)) o[k] = parseInt(v, 10);
  });
  return o;
}

// 少数机场把用量塞在 body JSON 里
function parseBody(raw) {
  if (!raw || raw.length > 400000) return null;
  var j;
  try { j = JSON.parse(raw); } catch (e) { return null; }
  var cands = [j, j && j.data, j && j.data && j.data.user, j && j.user];
  for (var i = 0; i < cands.length; i++) {
    var c = cands[i];
    if (!c || typeof c !== 'object') continue;
    var up = c.upload !== undefined ? c.upload : c.up;
    var down = c.download !== undefined ? c.download : c.down;
    var total = c.total !== undefined ? c.total : c.transfer_enable;
    var expire = c.expire !== undefined ? c.expire : c.expired_at;
    if (up !== undefined || down !== undefined || total !== undefined) {
      return {
        upload: Number(up) || 0,
        download: Number(down) || 0,
        total: Number(total) || 0,
        expire: Number(expire) || undefined
      };
    }
  }
  return null;
}

// 下次重置日：每月固定某天，小月自动取月末
function resetInfo() {
  var now = new Date();
  var y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  var dayCur = Math.min(RDAY, new Date(y, m + 1, 0).getDate());
  var next, days;
  if (d <= dayCur) {
    next = new Date(y, m, dayCur);
    days = dayCur - d;
  } else {
    var nd = Math.min(RDAY, new Date(y, m + 2, 0).getDate());
    next = new Date(y, m + 1, nd);
    days = Math.round((next - new Date(y, m, d)) / 86400000);
  }
  return { date: next, days: days };
}

function expireOf(v) {
  var t = Number(v) || 0;
  if (t <= 0) return null;
  if (t > 1e12) t = Math.floor(t / 1000);
  var d = new Date(t * 1000);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return null;
  return d;
}

function loadCache(key) {
  try {
    var raw = $persistentStore.read(key);
    if (!raw) return null;
    var o = JSON.parse(raw);
    if (o && (o.total || o.upload || o.download)) return o;
  } catch (e) {}
  return null;
}
function saveCache(key, o) {
  try { $persistentStore.write(JSON.stringify(o), key); } catch (e) {}
}

function pctOf(d) {
  var t = Number(d.total) || 0;
  if (t <= 0) return null;
  return ((Number(d.upload) || 0) + (Number(d.download) || 0)) / t * 100;
}

// ---------------- 单机场区块 ----------------
function blockOf(d, showName, name, stale) {
  var up = Number(d.upload) || 0;
  var down = Number(d.download) || 0;
  var used = up + down;
  var total = Number(d.total) || 0;
  var L = [];

  if (showName) L.push('\u2708\ufe0f ' + name);

  if (total > 0) {
    var pct = used / total * 100;
    L.push('\u603b\u6d41\u91cf  ' + fmtB(total));
    L.push('\u5df2\u6d88\u8017  ' + fmtB(used) + '  ' + pct.toFixed(1) + '%');
    L.push('\u5269\u4f59    ' + fmtB(Math.max(0, total - used)));
    L.push(bar(pct) + ' ' + pct.toFixed(0) + '%');
  } else {
    L.push('\u603b\u6d41\u91cf  \u4e0d\u9650');
    L.push('\u5df2\u6d88\u8017  ' + fmtB(used));
  }

  L.push('\u2191 ' + fmtB(up) + '   \u2193 ' + fmtB(down));

  var r = resetInfo();
  L.push('\u91cd\u7f6e  \u6bcf\u6708 ' + RDAY + ' \u53f7 \u00b7 ' + md(r.date) +
    (r.days === 0 ? '\uff08\u4eca\u5929\uff09' : '\uff08' + r.days + ' \u5929\u540e\uff09'));

  var exp = expireOf(d.expire);
  if (exp) {
    var t0 = new Date();
    var days = Math.round((new Date(exp.getFullYear(), exp.getMonth(), exp.getDate()) -
      new Date(t0.getFullYear(), t0.getMonth(), t0.getDate())) / 86400000);
    L.push('\u5230\u671f  ' + ymd(exp) +
      (days >= 0 ? '\uff08' + days + ' \u5929\u540e\uff09' : '\uff08\u5df2\u8fc7\u671f\uff09'));
  }

  if (stale) {
    var c0 = new Date(d.t || Date.now());
    L.push('\u26a0\ufe0f \u672c\u6b21\u62c9\u53d6\u5931\u8d25\uff0c\u4e3a ' + md(c0) + ' ' + hhmm(c0) + ' \u7f13\u5b58');
  }

  return L;
}

// ---------------- 汇总渲染 ----------------
function render(items) {
  var okN = 0, sumT = 0, sumU = 0, anyUnlimited = false, maxPct = -1, stale = false, badN = 0;
  items.forEach(function (it) {
    if (!it.info) { badN++; return; }
    okN++;
    if (it.stale) stale = true;
    sumU += (Number(it.info.upload) || 0) + (Number(it.info.download) || 0);
    var t = Number(it.info.total) || 0;
    if (t > 0) sumT += t; else anyUnlimited = true;
    var p = pctOf(it.info);
    if (p !== null && p > maxPct) maxPct = p;
  });

  var title = items.length === 1 ? items[0].name : ('\u673a\u573a\u6d41\u91cf \u00b7 ' + items.length + ' \u4e2a');
  var L = [];
  var multi = items.length > 1;

  items.forEach(function (it, idx) {
    if (multi && idx > 0) L.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    if (!it.info) {
      if (multi) L.push('\u2708\ufe0f ' + it.name);
      L.push('\u26a0\ufe0f \u83b7\u53d6\u5931\u8d25' + (it.err ? '\uff1a' + it.err : ''));
      return;
    }
    L = L.concat(blockOf(it.info, multi, it.name, it.stale));
  });

  // 多机场时给出合计（只有一个带流量的机场则不重复显示）
  if (multi && okN > 1) {
    L.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    L.push('\u5408\u8ba1\uff08' + okN + ' \u4e2a\u673a\u573a\uff09');
    L.push('\u5df2\u6d88\u8017  ' + fmtB(sumU));
    if (sumT > 0) {
      L.push('\u603b\u6d41\u91cf  ' + fmtB(sumT) + (anyUnlimited ? ' + \u4e0d\u9650' : ''));
      L.push('\u5269\u4f59    ' + fmtB(Math.max(0, sumT - sumU)));
      if (!anyUnlimited) L.push(bar(sumU / sumT * 100) + ' ' + (sumU / sumT * 100).toFixed(0) + '%');
    }
  }

  if (!multi) L.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  L.push('\u66f4\u65b0  ' + md(new Date()) + ' ' + hhmm(new Date()));

  var style = 'good';
  if (okN === 0) style = 'error';
  else if (stale) style = 'alert';
  else if (badN > 0) style = 'alert';
  else if (maxPct >= 100) style = 'error';
  else if (maxPct >= 90) style = 'alert';
  else if (maxPct < 0) style = 'info';

  $done({
    title: (stale ? '\u26a0\ufe0f ' : '') + title,
    content: L.join('\n'),
    style: style
  });
}

// ---------------- 主流程 ----------------
if (SUBS.length === 0) {
  $done({
    title: '\u673a\u573a\u6d41\u91cf',
    content: '\u5c1a\u672a\u914d\u7f6e\u8ba2\u9605\u94fe\u63a5\n\n' +
      '\u70b9\u300c\u673a\u573a\u6d41\u91cf\u300d\u6a21\u5757\u7684\u53c2\u6570\u6309\u987a\u5e8f\u586b\uff1a\n' +
      '\u2460 \u673a\u573a\u540d\n\u2461 \u8ba2\u9605\u94fe\u63a5\n\u2462 \u6bcf\u6708\u91cd\u7f6e\u65e5\n' +
      '\u2463 UA\uff08\u9ed8\u8ba4 Clash\uff09\n\u2464 \u6307\u5b9a\u7b56\u7565\uff08\u53ef\u7a7a\uff09',
    style: 'info'
  });
} else {
  var items = SUBS.map(function (u, i) {
    return {
      name: NAMES[i] || NAMES[0] || ('\u673a\u573a' + (i + 1)),
      sub: u,
      key: 'apt_' + hash(u),
      info: null,
      stale: false,
      err: ''
    };
  });

  var valid = items.filter(function (it) {
    return /^https?:\/\/[^\s]+\./i.test(it.sub) && !/example\.com/i.test(it.sub);
  });
  var pending = valid.length;

  if (!pending) {
    var isPlaceholder = SUBS.every(function (u) { return /example\.com/i.test(u); });
    $done({
      title: '\u673a\u573a\u6d41\u91cf',
      content: isPlaceholder
        ? '\u5c1a\u672a\u914d\u7f6e\u8ba2\u9605\u94fe\u63a5\n\n' +
          '\u6253\u5f00 \u8bbe\u7f6e \u2192 \u6a21\u5757 \u2192 \u673a\u573a\u6d41\u91cf \u2192 \u53c2\u6570\uff0c\u4f9d\u6b21\u586b\uff1a\n' +
          '\u2460 \u673a\u573a\u540d\uff08\u5982 \u82b1\u4e91\uff09\n\u2461 \u8ba2\u9605\u94fe\u63a5\uff08\u5b8c\u6574 https\uff09\n' +
          '\u2462 \u6bcf\u6708\u91cd\u7f6e\u65e5\uff081-31\uff09\n\u2463 UA\uff08\u9ed8\u8ba4 Clash/1.18.0\uff09\n' +
          '\u2464 \u6307\u5b9a\u7b56\u7565\uff08\u53ef\u7a7a\uff09'
        : '\u8ba2\u9605\u94fe\u63a5\u683c\u5f0f\u4e0d\u5bf9\n\n\u5fc5\u987b\u662f\u5b8c\u6574 https \u94fe\u63a5\uff0c\u4f8b\u5982\uff1a\n' +
          'https://xxx.com/api/v1/client/subscribe?token=xxxx',
      style: isPlaceholder ? 'info' : 'error'
    });
  } else {
    valid.forEach(function (it) {
      var req = {
        url: it.sub,
        headers: {
          'User-Agent': UA,
          'Accept': '*/*',
          'Accept-Encoding': 'identity'
        },
        timeout: 15
      };
      if (POLICY) req.policy = POLICY;

      $httpClient.get(req, function (err, resp, data) {
        var info = null;
        if (!err && resp) {
          var hdr = getHeader(resp.headers, 'subscription-userinfo');
          if (!hdr) {
            var alts = ['userinfo', 'x-userinfo', 'traffic-userinfo'];
            for (var i = 0; i < alts.length && !hdr; i++) hdr = getHeader(resp.headers, alts[i]);
          }
          if (hdr) info = parseUserInfo(hdr);
          if (info && info.total === undefined && info.download === undefined && info.upload === undefined) info = null;
          if (!info && data) info = parseBody(data);
        }

        if (info) {
          info.t = Date.now();
          saveCache(it.key, info);
          it.info = info;
        } else {
          var c = loadCache(it.key);
          if (c) { it.info = c; it.stale = true; }
          else {
            it.err = err ? String(err) : (resp ? 'HTTP ' + resp.status + ' \u65e0\u6d41\u91cf\u5934' : '\u65e0\u54cd\u5e94');
          }
        }

        if (--pending === 0) render(items);
      });
    });
  }
}
