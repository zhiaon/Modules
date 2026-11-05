// ============================================================
// 机场流量面板 · Surge 通用版  v1.2
// 数据源：订阅链接响应头 subscription-userinfo（V2board / SSPanel / 新V2 通用）
// 参数槽位（argument 用竖线 | 分隔）：
//   0 机场名（分号分隔，与订阅顺序一一对应）
//   1 订阅链接 ①（分号分隔）
//   2 每月重置日 1-31
//   3 UA
//   4 指定策略（可空 / none）
//   5 订阅链接 ②（分号分隔）
//   6 订阅链接 ③（分号分隔）
// 三格订阅槽合计可放 6 个以上机场
// ============================================================

var ARG = (typeof $argument !== 'undefined' && $argument) ? String($argument) : '';
var P = ARG.split('|');

function raw(i) { return (P[i] === undefined ? '' : String(P[i])).trim(); }
function part(i, def) {
  var v = raw(i);
  return v ? v : def;
}
function isBlank(v) {
  v = String(v || '').trim();
  if (!v) return true;
  if (/^(空|无|none|null|undefined|nil)$/i.test(v)) return true;
  if (/^<.+>$/.test(v)) return true;
  if (/^请?填写?|^填/.test(v)) return true;
  return false;
}
function real(v) { return isBlank(v) ? '' : String(v).trim(); }
function list(s) {
  var out = [];
  String(s || '').split(/[;；]/).forEach(function (x) {
    x = x.trim();
    if (x && !isBlank(x)) out.push(x);
  });
  return out;
}

// ---- 机场名 ----
var NAMES = list(raw(0));

// ---- 订阅链接：三格合并 ----
var SUBS = [];
[1, 5, 6].forEach(function (idx) {
  list(raw(idx)).forEach(function (u) { SUBS.push(u); });
});

// ---- 其它 ----
var RDAY = parseInt(part(2, '1'), 10);
if (!(RDAY >= 1 && RDAY <= 31)) RDAY = 1;
var UA = part(3, 'Clash/1.18.0');
var POLICY = real(raw(4));

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
  if (g >= 10) return g.toFixed(1) + ' GB';
  return g.toFixed(2) + ' GB';
}
// 紧凑写法：多机场时省宽度
function fmtS(b) {
  if (b === null || b === undefined || isNaN(b)) return '--';
  var g = b / GB;
  if (g >= 1024) return (g / 1024).toFixed(1) + 'T';
  if (g >= 10) return g.toFixed(0) + 'G';
  if (g >= 1) return g.toFixed(1) + 'G';
  return (g * 1024).toFixed(0) + 'M';
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

function parseUserInfo(s) {
  var o = {};
  String(s || '').split(';').forEach(function (seg) {
    var i = seg.indexOf('=');
    if (i < 0) return;
    var k = seg.slice(0, i).trim().toLowerCase();
    var v = seg.slice(i + 1).trim();
    if (/^\d+$/.test(v)) o[k] = parseInt(v, 10);
  });
  return o;
}

// 少数机场把用量塞在 body JSON 里
function parseBody(s) {
  if (!s || s.length > 400000) return null;
  var j;
  try { j = JSON.parse(s); } catch (e) { return null; }
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

function daysTo(d) {
  var t0 = new Date();
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) -
    new Date(t0.getFullYear(), t0.getMonth(), t0.getDate())) / 86400000);
}

function loadCache(key) {
  try {
    var s = $persistentStore.read(key);
    if (!s) return null;
    var o = JSON.parse(s);
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

// ---------------- 区块：详细（单机场） ----------------
function blockFull(d, stale) {
  var up = Number(d.upload) || 0;
  var down = Number(d.download) || 0;
  var used = up + down;
  var total = Number(d.total) || 0;
  var L = [];

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
    var dd = daysTo(exp);
    L.push('\u5230\u671f  ' + ymd(exp) + (dd >= 0 ? '\uff08' + dd + ' \u5929\u540e\uff09' : '\uff08\u5df2\u8fc7\u671f\uff09'));
  }

  if (stale) {
    var c0 = new Date(d.t || Date.now());
    L.push('\u26a0\ufe0f \u672c\u6b21\u62c9\u53d6\u5931\u8d25\uff0c\u4e3a ' + md(c0) + ' ' + hhmm(c0) + ' \u7f13\u5b58');
  }
  return L;
}

// ---------------- 区块：紧凑（多机场） ----------------
function blockTight(d, name, stale) {
  var up = Number(d.upload) || 0;
  var down = Number(d.download) || 0;
  var used = up + down;
  var total = Number(d.total) || 0;
  var L = [];
  var pct = pctOf(d);

  L.push('\u2708\ufe0f ' + name + '   ' + (total > 0 ? fmtS(total) : '\u4e0d\u9650'));

  if (total > 0) {
    L.push('\u5df2\u7528 ' + fmtS(used) + '  \u5269 ' + fmtS(Math.max(0, total - used)) +
      '  ' + bar(pct, 8) + ' ' + pct.toFixed(0) + '%');
  } else {
    L.push('\u5df2\u7528 ' + fmtS(used) + '  \u4e0d\u9650');
  }

  L.push('\u2191' + fmtS(up) + '  \u2193' + fmtS(down) + '  ' + md(resetInfo().date) + ' \u91cd\u7f6e');

  var exp = expireOf(d.expire);
  if (stale) L.push('\u26a0\ufe0f \u672c\u6b21\u62c9\u53d6\u5931\u8d25\uff0c\u663e\u793a\u7f13\u5b58');
  else if (exp) L.push('\u5230\u671f ' + ymd(exp) + ' \u00b7 ' + daysTo(exp) + ' \u5929');

  return L;
}

// ---------------- 汇总渲染 ----------------
function render(items) {
  var okN = 0, badN = 0, sumT = 0, sumU = 0;
  var anyUnlimited = false, maxPct = -1, stale = false;

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

  var multi = items.length > 1;
  var title = multi ? ('\u673a\u573a\u6d41\u91cf \u00b7 ' + items.length + ' \u4e2a')
                    : (items[0] && items[0].name ? items[0].name : '\u673a\u573a\u6d41\u91cf');

  var L = [];

  items.forEach(function (it, idx) {
    if (multi && idx > 0) L.push('');
    if (!it.info) {
      L.push('\u2708\ufe0f ' + it.name);
      L.push('\u26a0\ufe0f \u83b7\u53d6\u5931\u8d25' + (it.err ? '\uff1a' + it.err : ''));
      return;
    }
    L = L.concat(multi ? blockTight(it.info, it.name, it.stale)
                       : blockFull(it.info, it.stale));
  });

  if (multi && okN > 1) {
    L.push('');
    L.push('\u5408\u8ba1\uff08' + okN + ' \u4e2a\u673a\u573a\uff09');
    L.push('\u5df2\u6d88\u8017 ' + fmtS(sumU) +
      (sumT > 0 ? ' / ' + fmtS(sumT) + (anyUnlimited ? '+\u4e0d\u9650' : '') : ''));
    if (sumT > 0) {
      L.push('\u5269\u4f59 ' + fmtS(Math.max(0, sumT - sumU)) +
        (anyUnlimited ? '' : '   ' + (sumU / sumT * 100).toFixed(0) + '%'));
      if (!anyUnlimited) L.push(bar(sumU / sumT * 100) + ' ' + (sumU / sumT * 100).toFixed(0) + '%');
    }
  }

  L.push('');
  L.push('\u66f4\u65b0 ' + md(new Date()) + ' ' + hhmm(new Date()));

  var style = 'good';
  if (okN === 0) style = 'error';
  else if (stale || badN > 0) style = 'alert';
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
      '\u70b9\u6a21\u5757 \u2192 \u53c2\u6570\uff0c\u4f9d\u6b21\u586b\uff1a\n' +
      '\u2460 \u673a\u573a\u540d\uff08\u591a\u4e2a\u7528\u5206\u53f7\u9694\u5f00\uff09\n' +
      '\u2461 \u8ba2\u9605\u94fe\u63a5 \u2460\n' +
      '\u2462 \u6bcf\u6708\u91cd\u7f6e\u65e5\n' +
      '\u2463 UA\uff08\u9ed8\u8ba4 Clash\uff09\n' +
      '\u2464 \u6307\u5b9a\u7b56\u7565\uff08\u53ef\u7a7a\uff09\n' +
      '\u2465 \u8ba2\u9605\u94fe\u63a5 \u2461\n' +
      '\u2466 \u8ba2\u9605\u94fe\u63a5 \u2462\n\n' +
      '\u4e09\u683c\u8ba2\u9605\u90fd\u53ef\u7528\u5206\u53f7\u653e\u591a\u4e2a\uff0c\u5408\u8ba1\u652f\u6301 6 \u4e2a\u4ee5\u4e0a\u673a\u573a',
    style: 'info'
  });
} else {
  var items = SUBS.map(function (u, i) {
    return {
      name: NAMES[i] || ('\u673a\u573a' + (i + 1)),
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
    var isPlaceholder = items.every(function (it) { return /example\.com/i.test(it.sub); });
    $done({
      title: '\u673a\u573a\u6d41\u91cf',
      content: isPlaceholder
        ? '\u5c1a\u672a\u914d\u7f6e\u8ba2\u9605\u94fe\u63a5\n\n' +
          '\u70b9\u6a21\u5757 \u2192 \u53c2\u6570\uff0c\u4f9d\u6b21\u586b\uff1a\n' +
          '\u2460 \u673a\u573a\u540d\uff08\u591a\u4e2a\u7528\u5206\u53f7\u9694\u5f00\uff09\n' +
          '\u2461 \u8ba2\u9605\u94fe\u63a5 \u2460\n' +
          '\u2462 \u6bcf\u6708\u91cd\u7f6e\u65e5\n' +
          '\u2463 UA\uff08\u9ed8\u8ba4 Clash\uff09\n' +
          '\u2464 \u6307\u5b9a\u7b56\u7565\uff08\u53ef\u7a7a\uff09\n' +
          '\u2465 \u8ba2\u9605\u94fe\u63a5 \u2461\n' +
          '\u2466 \u8ba2\u9605\u94fe\u63a5 \u2462'
        : '\u8ba2\u9605\u94fe\u63a5\u683c\u5f0f\u4e0d\u5bf9\n\n\u5fc5\u987b\u662f\u5b8c\u6574 https \u94fe\u63a5',
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
          else it.err = err ? String(err) : (resp ? 'HTTP ' + resp.status + ' \u65e0\u6d41\u91cf\u5934' : '\u65e0\u54cd\u5e94');
        }

        if (--pending === 0) render(items);
      });
    });
  }
}
