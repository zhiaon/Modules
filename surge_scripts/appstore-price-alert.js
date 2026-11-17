/* App Store 降价提醒 · V1.0 · 许舟
 * Monitors the app's own App Store price through Apple's public lookup endpoint.
 * It does not read in-app purchase or subscription prices.
 */
(function () {
  'use strict';
  var PREFIX = 'appstore_price_alert_v1_';
  var MAX = 12;
  var started = Date.now();
  var deadline = started + 52000;
  var arg = typeof $argument === 'string' ? $argument : '';
  var p = arg.split('|');
  var finished = false, timer = null, items = [], notices = [];
  var cfg;

  function s(v) { return v == null ? '' : String(v); }
  function clean(v) { return s(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); }
  function real(v) { v = clean(v); return v === '-' ? '' : v; }
  function truth(v, fallback) { return v == null || v === '' ? fallback : /^(true|1|yes|on|开|开启)$/i.test(s(v).trim()); }
  function nowText(ms) {
    var d = new Date(ms || Date.now());
    function z(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + '/' + z(d.getMonth() + 1) + '/' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  function load(key) {
    try { var x = JSON.parse($persistentStore.read(key) || 'null'); return x && typeof x === 'object' ? x : {}; }
    catch (_) { return {}; }
  }
  function save(key, value) {
    try { return $persistentStore.write(JSON.stringify(value), key) !== false; }
    catch (_) { return false; }
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function formatPrice(price, currency, formatted) {
    if (formatted) return clean(formatted);
    if (price === 0) return '免费';
    return (currency ? currency + ' ' : '') + (price == null ? '未知' : Number(price).toFixed(2));
  }
  function keyFor(item) {
    return PREFIX + item.id + '_' + item.country;
  }
  function parseApp(raw, defaultCountry) {
    raw = clean(raw);
    if (!raw) return null;
    var label = '', eq = raw.indexOf('=');
    if (eq > 0) { label = clean(raw.slice(0, eq)); raw = clean(raw.slice(eq + 1)); }
    var country = defaultCountry;
    var at = raw.lastIndexOf('@');
    if (at > 0 && /^[A-Za-z]{2}$/.test(raw.slice(at + 1))) {
      country = raw.slice(at + 1).toUpperCase(); raw = raw.slice(0, at);
    }
    var m = raw.match(/\/id(\d+)/i) || raw.match(/(?:^|[^\d])(\d{5,12})(?:[^\d]|$)/);
    var id = m ? m[1] : '';
    if (!id || !/^[A-Z]{2}$/.test(country)) return {invalid: true, raw: raw, label: label};
    return {id: id, country: country, label: label || id, key: PREFIX + id + '_' + country};
  }
  function parseConfig() {
    var defaultCountry = real(p[1] || 'CN').toUpperCase();
    if (!/^[A-Z]{2}$/.test(defaultCountry)) throw new Error('默认地区必须是两位国家代码，例如 CN、US、TR');
    var raw = real(p[0]), seen = {}, apps = [];
    if (raw) raw.split(/[;；\n]+/).forEach(function (part) {
      var item = parseApp(part, defaultCountry);
      if (!item) return;
      if (item.invalid) throw new Error('应用格式有误：' + item.raw + '；请填 App Store ID 或应用链接');
      if (seen[item.id + '_' + item.country]) return;
      seen[item.id + '_' + item.country] = true;
      apps.push(item);
    });
    if (apps.length > MAX) throw new Error('最多监测 12 个应用');
    var threshold = real(p[4]);
    threshold = threshold === '' ? 0 : Number(threshold);
    if (!isFinite(threshold) || threshold < 0) throw new Error('降价阈值必须是 0 或正数');
    return {apps: apps, country: defaultCountry, notify: truth(p[2], true), policy: real(p[3]), threshold: threshold};
  }
  function card(error) {
    return {title: 'App Store 降价提醒', style: error ? 'error' : 'info', content:
      (error ? '⚠ ' + error + '\n\n' : '尚未配置应用\n\n') +
      '打开模块 → 参数 → 应用列表\n' +
      '格式：名称=App Store ID@地区\n' +
      '多个应用用英文分号分隔\n' +
      '例：ChatGPT=6448311069@US\n\n' +
      '首次只记录当前价格，后续降价才通知\n仅监测应用本体价格，不含内购订阅'};
  }
  function request(item, done) {
    var old = load(item.key);
    var url = 'https://itunes.apple.com/lookup?id=' + encodeURIComponent(item.id) + '&country=' + item.country + '&entity=software';
    var opts = {url: url, timeout: 10, headers: {'Accept': 'application/json', 'User-Agent': 'Surge-AppStore-Price-Alert/1.0'}, 'auto-redirect': true, 'auto-cookie': false};
    if (cfg.policy) opts.policy = cfg.policy;
    $httpClient.get(opts, function (err, resp, body) {
      var status = resp && Number(resp.status) || 0;
      if (err || !resp || status < 200 || status >= 300) {
        item.error = err ? clean(err) : (status ? 'HTTP ' + status : '无响应');
        item.cached = old.price !== undefined;
        item.old = old;
        return done();
      }
      try {
        var data = JSON.parse(body || '{}');
        var r = data.results && data.results[0];
        if (!r || !r.trackId) throw new Error('该地区未找到应用');
        var price = num(r.price);
        if (price === null) throw new Error('返回结果没有应用价格');
        var current = {price: price, currency: clean(r.currency), formatted: formatPrice(price, r.currency, r.formattedPrice),
          name: clean(r.trackName) || item.label, version: clean(r.version), url: clean(r.trackViewUrl), checked: Date.now()};
        var had = old.price !== undefined && old.price !== null;
        item.info = current;
        item.old = old;
        item.first = !had;
        item.dropped = had && Number(old.price) - price > cfg.threshold;
        if (item.dropped) notices.push({item: item, from: formatPrice(Number(old.price), old.currency, old.formatted), to: current.formatted});
        save(item.key, current);
        done();
      } catch (e) {
        item.error = clean(e && e.message ? e.message : e);
        item.cached = old.price !== undefined;
        item.old = old;
        done();
      }
    });
  }
  function render() {
    var lines = ['监测 ' + items.length + ' 个应用 · 地区 ' + cfg.country, ''];
    items.forEach(function (it, i) {
      if (i) lines.push('');
      var title = it.info && it.info.name ? it.info.name : it.label;
      if (it.info) {
        lines.push((it.dropped ? '🆕 ' : '✅ ') + title + ' · ' + it.country);
        lines.push('当前价格  ' + it.info.formatted + (it.info.version ? ' · v' + it.info.version : ''));
        if (it.dropped) lines.push('降价      ' + (it.old.formatted || formatPrice(it.old.price, it.old.currency, '')) + ' → ' + it.info.formatted);
      } else if (it.cached) {
        lines.push('⚠️ ' + title + ' · ' + it.country);
        lines.push('本次获取失败，保留：' + (it.old.formatted || formatPrice(it.old.price, it.old.currency, '')));
        lines.push('原因：' + it.error);
      } else {
        lines.push('⚠️ ' + title + ' · ' + it.country + ' · ' + it.error);
      }
    });
    lines.push('', '检查于 ' + nowText() + ' · 面板刷新可立即检查');
    if (notices.length) lines.unshift('发现 ' + notices.length + ' 个应用降价\n');
    var failed = items.filter(function (x) { return x.error; }).length;
    return {title: 'App Store 降价提醒 · ' + items.length + ' 个', content: lines.join('\n'), style: failed && !items.some(function (x) { return x.info; }) ? 'error' : (notices.length || failed ? 'alert' : 'good')};
  }
  function notify() {
    var isCron = typeof $script !== 'undefined' && $script.type === 'cron';
    if (!isCron || !cfg.notify || !notices.length || typeof $notification === 'undefined') return;
    var lines = notices.slice(0, 8).map(function (n) { return n.item.label + '  ' + n.from + ' → ' + n.to; });
    if (notices.length > 8) lines.push('还有 ' + (notices.length - 8) + ' 个应用降价');
    var url = notices[0].item.info.url;
    $notification.post('App Store 降价提醒', notices.length + ' 个应用降价', lines.join('\n'), {action: 'open-url', url: url, sound: false, 'auto-dismiss': true});
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
    if (!cfg.apps.length) {
      if (typeof $script !== 'undefined' && $script.type === 'cron') $done(); else $done(card(false));
    } else {
      items = cfg.apps;
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
