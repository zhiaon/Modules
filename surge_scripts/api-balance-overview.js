/* API 余额总览 · V1.0 · 许舟
 * Compatible with One API / New API style self-balance endpoints.
 * Account format: name~baseURL~token~path~unitsPerCurrency~currency
 */
(function () {
  'use strict';
  var PREFIX = 'api_balance_overview_v1_';
  var MAX = 8;
  var deadline = Date.now() + 56000;
  var p = (typeof $argument === 'string' ? $argument : '').split('|');
  var finished = false, timer = null, items = [], notices = [], cfg;

  function s(v) { return v == null ? '' : String(v); }
  function clean(v) { return s(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); }
  function real(v) { v = clean(v); return v === '-' ? '' : v; }
  function truth(v, fallback) { return v == null || v === '' ? fallback : /^(true|1|yes|on|开|开启)$/i.test(s(v).trim()); }
  function num(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'object') return null;
    if (typeof v === 'string') v = v.replace(/[,，\s]/g, '');
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function load(key) {
    try { var x = JSON.parse($persistentStore.read(key) || 'null'); return x && typeof x === 'object' ? x : {}; }
    catch (_) { return {}; }
  }
  function save(key, value) {
    try { return $persistentStore.write(JSON.stringify(value), key) !== false; }
    catch (_) { return false; }
  }
  function hash(v) {
    var n = 2166136261, t = s(v);
    for (var i = 0; i < t.length; i++) n = Math.imul(n ^ t.charCodeAt(i), 16777619);
    return (n >>> 0).toString(36);
  }
  function time(ms) {
    var d = new Date(ms || Date.now());
    function z(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + '/' + z(d.getMonth() + 1) + '/' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  function money(v, currency) {
    if (v === null || v === undefined || !isFinite(v)) return '未知';
    var n = Number(v);
    return (currency || '') + ' ' + n.toFixed(Math.abs(n) < 100 ? 2 : 1);
  }
  function parseConfig() {
    var raw = real(p[0]), accounts = [], seen = {};
    if (raw) raw.split(/[;；\n]+/).forEach(function (part) {
      var f = part.split('~');
      if (f.length < 3) throw new Error('账户格式有误；请用 名称~BaseURL~密钥~接口~倍率~货币');
      if (f.length > 6) throw new Error('账户格式有误：字段只能用 ~ 分成最多 6 段');
      var name = clean(f[0]), base = real(f[1]).replace(/\/+$/, ''), token = real(f[2]);
      var path = real(f[3]) || '/api/user/self';
      var units = real(f[4]); units = units === '' ? 100000 : Number(units);
      var currency = clean(f[5] || 'USD').toUpperCase();
      if (!name || !/^https?:\/\/[^\s]+$/i.test(base)) throw new Error('账户名称或 BaseURL 无效：' + name);
      if (!/^\//.test(path) && !/^https?:\/\//i.test(path)) path = '/' + path;
      if (!isFinite(units) || units <= 0) throw new Error('倍率必须是正数：' + name);
      if (/[\r\n|]/.test(token)) throw new Error('密钥含换行或竖线：' + name);
      var key = PREFIX + hash(name + '|' + base + '|' + path);
      if (seen[key]) return;
      seen[key] = true;
      accounts.push({name: name.slice(0, 40), base: base, token: token, path: path, units: units, currency: currency, key: key});
    });
    if (accounts.length > MAX) throw new Error('最多监测 8 个 API 账户');
    var threshold = real(p[3]);
    threshold = threshold === '' ? null : Number(threshold);
    if (threshold !== null && (!isFinite(threshold) || threshold < 0)) throw new Error('低余额阈值必须是 0 或正数');
    return {accounts: accounts, notify: truth(p[1], true), policy: real(p[2]), threshold: threshold};
  }
  function card(error) {
    return {title: 'API 余额总览', style: error ? 'error' : 'info', content:
      (error ? '⚠ ' + error + '\n\n' : '尚未配置 API 账户\n\n') +
      '打开模块 → 参数 → 账户列表\n' +
      '格式：名称~BaseURL~密钥~接口~倍率~货币\n' +
      '多个账户用英文分号分隔\n\n' +
      '例：中转站~https://api.example.com~sk-xxx~/api/user/self~100000~USD\n' +
      'One API/New API 常用接口：/api/user/self\n' +
      '倍率是接口单位换算成 1 元的数量；常见 quota 填 100000\n' +
      '密钥不会显示在面板；首次成功只建立低余额提醒基线'};
  }
  function getPath(root, names) {
    var found = null, wanted = {};
    names.forEach(function (x) { wanted[x] = true; });
    function walk(v) {
      if (found !== null || v === null || v === undefined) return;
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v !== 'object') return;
      Object.keys(v).some(function (k) {
        if (wanted[k] && num(v[k]) !== null) { found = num(v[k]); return true; }
        walk(v[k]); return found !== null;
      });
    }
    walk(root);
    return found;
  }
  function extract(body, account) {
    var data;
    try { data = JSON.parse(body || '{}'); } catch (_) { throw new Error('返回内容不是 JSON'); }
    var remaining = getPath(data, ['remain_quota', 'remaining_quota', 'quota_balance', 'balance', 'remaining', 'credits', 'credit', 'quota']);
    var used = getPath(data, ['used_quota', 'consumed_quota', 'used', 'consumed', 'usage']);
    var total = getPath(data, ['total_quota', 'quota_total', 'total', 'limit', 'max_quota']);
    if (remaining === null && total !== null && used !== null) remaining = total - used;
    if (remaining === null) throw new Error('响应中没有可识别的余额字段');
    if (total === null && used !== null) total = remaining + used;
    var scale = account.units;
    return {remaining: remaining / scale, used: used === null ? null : used / scale,
      total: total === null ? null : total / scale, currency: account.currency, checked: Date.now()};
  }
  function request(item, done) {
    var old = load(item.key), url = /^https?:\/\//i.test(item.path) ? item.path : item.base + item.path;
    var headers = {'Accept': 'application/json', 'User-Agent': 'Surge-API-Balance/1.0'};
    if (item.token) headers.Authorization = 'Bearer ' + item.token;
    var opts = {url: url, headers: headers, timeout: 12, 'auto-redirect': true, 'auto-cookie': false};
    if (cfg.policy) opts.policy = cfg.policy;
    $httpClient.get(opts, function (err, resp, body) {
      var status = resp && Number(resp.status) || 0;
      if (err || !resp || status < 200 || status >= 300) {
        item.error = err ? clean(err) : (status ? 'HTTP ' + status : '无响应');
        item.old = old; item.cached = old.remaining !== undefined;
        return done();
      }
      try {
        var value = extract(body, item), had = old.remaining !== undefined && old.remaining !== null;
        item.info = value; item.old = old; item.first = !had;
        item.low = cfg.threshold !== null && value.remaining <= cfg.threshold;
        item.crossed = item.low && had && Number(old.remaining) > cfg.threshold;
        if (item.crossed) notices.push({item: item});
        save(item.key, value); done();
      } catch (e) {
        item.error = clean(e && e.message ? e.message : e); item.old = old; item.cached = old.remaining !== undefined; done();
      }
    });
  }
  function fmt(value, currency) { return money(value, currency); }
  function render() {
    var lines = ['监测 ' + items.length + ' 个 API 账户', ''];
    items.forEach(function (it, i) {
      if (i) lines.push('');
      if (it.info) {
        lines.push((it.low ? '⚠️ ' : '✅ ') + it.name);
        var line = '剩余  ' + fmt(it.info.remaining, it.info.currency);
        if (it.info.total !== null) line += ' / ' + fmt(it.info.total, it.info.currency);
        lines.push(line);
        if (it.info.used !== null) lines.push('已用  ' + fmt(it.info.used, it.info.currency));
        lines.push('同步  ' + time(it.info.checked));
      } else if (it.cached) {
        lines.push('⚠️ ' + it.name + ' · 本次查询失败');
        lines.push('保留  ' + fmt(it.old.remaining, it.old.currency) + ' · ' + it.error);
      } else lines.push('⚠️ ' + it.name + ' · ' + it.error);
    });
    lines.push('', '检查于 ' + time() + ' · 面板刷新可立即查询');
    if (notices.length) lines.unshift('发现 ' + notices.length + ' 个账户余额低于阈值\n');
    var failed = items.filter(function (x) { return x.error; }).length;
    return {title: 'API 余额总览 · ' + items.length + ' 个', content: lines.join('\n'), style: failed && !items.some(function (x) { return x.info; }) ? 'error' : (notices.length || failed ? 'alert' : 'good')};
  }
  function notify() {
    var isCron = typeof $script !== 'undefined' && $script.type === 'cron';
    if (!isCron || !cfg.notify || !notices.length || typeof $notification === 'undefined') return;
    var lines = notices.map(function (x) { return x.item.name + ' · 剩余 ' + fmt(x.item.info.remaining, x.item.info.currency); });
    $notification.post('API 余额提醒', '有 ' + notices.length + ' 个账户余额偏低', lines.join('\n'), {sound: false, 'auto-dismiss': true});
  }
  function finish() {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    notify();
    if (typeof $script !== 'undefined' && $script.type === 'cron') $done(); else $done(render());
  }
  function fail(message) {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    if (typeof $script !== 'undefined' && $script.type === 'cron') $done(); else $done(card(message));
  }
  try {
    cfg = parseConfig();
    if (!cfg.accounts.length) {
      if (typeof $script !== 'undefined' && $script.type === 'cron') $done(); else $done(card(false));
    } else {
      items = cfg.accounts;
      timer = setTimeout(finish, Math.max(1000, deadline - Date.now()));
      var next = 0, active = 0, complete = 0, limit = Math.min(4, items.length);
      function launch() {
        while (active < limit && next < items.length && Date.now() < deadline) {
          active++;
          request(items[next++], function () { active--; complete++; if (complete >= items.length) finish(); else launch(); });
        }
      }
      launch();
    }
  } catch (e) { fail(clean(e && e.message ? e.message : e)); }
}());
