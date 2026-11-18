/* 汇率显示面板 · V1.0 · 许舟
 * Multi-currency rates from the free, keyless open.er-api.com endpoint.
 */
(function () {
  'use strict';
  var CACHE_PREFIX = 'exchange_rates_v1_';
  var arg = typeof $argument === 'string' ? $argument : '';
  var p = arg.split('|');
  var finished = false, timer = null, cfg;
  var deadline = Date.now() + 26000;
  var NAMES = {
    CNY: '人民币', USD: '美元', EUR: '欧元', GBP: '英镑', JPY: '日元',
    HKD: '港元', TWD: '新台币', KRW: '韩元', SGD: '新加坡元', THB: '泰铢',
    AUD: '澳元', CAD: '加元', CHF: '瑞士法郎', TRY: '土耳其里拉', INR: '印度卢比',
    MYR: '马来西亚林吉特', IDR: '印尼卢比', PHP: '菲律宾比索', NZD: '新西兰元',
    AED: '阿联酋迪拉姆', VND: '越南盾', BRL: '巴西雷亚尔', MXN: '墨西哥比索',
    RUB: '俄罗斯卢布', ZAR: '南非兰特', SEK: '瑞典克朗', NOK: '挪威克朗',
    DKK: '丹麦克朗', PLN: '波兰兹罗提', CZK: '捷克克朗'
  };
  function s(v) { return v == null ? '' : String(v); }
  function clean(v) { return s(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); }
  function real(v) { v = clean(v); return v === '-' ? '' : v; }
  function z(n) { return ('0' + n).slice(-2); }
  function localTime(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '/' + z(d.getMonth() + 1) + '/' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  function load(key) {
    try { var x = JSON.parse($persistentStore.read(key) || 'null'); return x && typeof x === 'object' ? x : null; }
    catch (_) { return null; }
  }
  function save(key, value) {
    try { return $persistentStore.write(JSON.stringify(value), key) !== false; }
    catch (_) { return false; }
  }
  function parseConfig() {
    var base = (real(p[0]) || 'CNY').toUpperCase();
    if (!/^[A-Z]{3}$/.test(base)) throw new Error('基准货币请填三位代码，例如 CNY 或 USD');
    var raw = real(p[1]) || 'USD;EUR;GBP;JPY;HKD;TWD;KRW;SGD;THB;AUD;CAD;CHF;TRY;INR;MYR;IDR;PHP;NZD;AED;VND';
    var seen = {}, targets = [];
    raw.split(/[;；,，\s]+/).forEach(function (x) {
      var code = clean(x).toUpperCase();
      if (!code) return;
      if (!/^[A-Z]{3}$/.test(code)) throw new Error('目标货币代码无效：' + code);
      if (code === base || seen[code]) return;
      seen[code] = true;
      targets.push(code);
    });
    if (!targets.length) throw new Error('至少填写一种不同于基准币种的目标货币');
    if (targets.length > 20) throw new Error('最多显示 20 种目标货币');
    return {base: base, targets: targets, policy: real(p[2])};
  }
  function number(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : null;
  }
  function formatRate(v) {
    var n = Number(v);
    if (!isFinite(n)) return '—';
    var digits = n >= 100 ? 2 : (n >= 1 ? 4 : 5);
    var parts = n.toFixed(digits).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function formatDate(raw) {
    if (!raw) return '未知';
    var d = new Date(raw);
    if (isNaN(d.getTime())) return clean(raw);
    return d.getFullYear() + '/' + z(d.getMonth() + 1) + '/' + z(d.getDate());
  }
  function httpGet(url, done) {
    var opts = {url: url, timeout: 16, headers: {'Accept': 'application/json', 'User-Agent': 'Surge-Exchange-Rates/1.0'}, 'auto-redirect': true, 'auto-cookie': false};
    if (cfg.policy) opts.policy = cfg.policy;
    $httpClient.get(opts, function (err, resp, body) {
      var status = resp && Number(resp.status) || 0;
      if (err || !resp || status < 200 || status >= 300) return done(new Error(err ? clean(err) : (status ? 'HTTP ' + status : '无响应')));
      done(null, body);
    });
  }
  function rateDate(data) {
    if (data.time_last_update_unix) return localTime(Number(data.time_last_update_unix) * 1000);
    return formatDate(data.time_last_update_utc || data.time_last_update || data.date);
  }
  function makePanel(payload, staleError) {
    var rates = payload.rates || {}, lines = [];
    var baseName = NAMES[cfg.base] || cfg.base;
    lines.push('📅 汇率更新：' + rateDate(payload));
    lines.push('基准：1 ' + cfg.base + '（' + baseName + '）');
    lines.push('');
    cfg.targets.forEach(function (code) {
      var value = number(rates[code]);
      var name = NAMES[code] || code;
      if (value == null) {
        lines.push('⚠️ ' + code + '  ' + name + '  暂无数据');
        return;
      }
      // 反算：1 单位目标币 = 多少基准币
      var inverse = 1 / value;
      // 数值过小时按 100 / 1000 单位显示，避免出现 0.00026 这种读不清的数字
      if (inverse < 0.01) {
        var unit = inverse < 0.001 ? 1000 : 100;
        lines.push(unit + ' ' + code + '（' + name + '） = ' + formatRate(inverse * unit) + ' ' + cfg.base);
      } else {
        lines.push('1 ' + code + '（' + name + '） = ' + formatRate(inverse) + ' ' + cfg.base);
      }
    });
    lines.push('');
    lines.push('读法：每行是「1 单位该币种能换多少 ' + cfg.base + '」');
    lines.push('来源：ExchangeRate-API · 每日更新');
    if (payload.fetchedAt) lines.push('查询于：' + localTime(payload.fetchedAt));
    if (staleError) lines.push('\n⚠️ 本次更新失败，以下为缓存数据：' + staleError);
    return {title: '💱 汇率面板 · ' + cfg.base, content: lines.join('\n'), style: staleError ? 'alert' : 'good'};
  }
  function errorPanel(error) {
    if (!cfg || !cfg.base) {
      return {title: '汇率面板', style: 'error', content: '⚠ ' + error + '\n\n基准货币需为 ISO 4217 三位代码，例如 CNY、USD。\n目标货币用三位代码并以英文分号分隔。'};
    }
    var cached = load(CACHE_PREFIX + cfg.base);
    if (cached && cached.rates) return makePanel(cached, error);
    return {title: '汇率面板', style: 'error', content: '⚠ 汇率获取失败：' + error + '\n\n请检查基准货币代码和网络连接。\n基准货币需为 ISO 4217 三位代码，例如 CNY、USD。'};
  }
  function finish(payload) {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    if (typeof $script !== 'undefined' && $script.type === 'cron') $done();
    else $done(makePanel(payload));
  }
  function fail(error) {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    if (typeof $script !== 'undefined' && $script.type === 'cron') $done();
    else $done(errorPanel(error));
  }
  try {
    cfg = parseConfig();
    var cacheKey = CACHE_PREFIX + cfg.base;
    timer = setTimeout(function () { fail('请求超时'); }, Math.max(1000, deadline - Date.now()));
    httpGet('https://open.er-api.com/v6/latest/' + encodeURIComponent(cfg.base), function (err, body) {
      if (err) return fail(err.message);
      try {
        var data = JSON.parse(body || '{}');
        if (data.result !== 'success' || data.base_code !== cfg.base || !data.rates) {
          throw new Error(clean(data['error-type'] || (data.result === 'success' ? '接口返回格式异常' : data.result) || '接口返回格式异常'));
        }
        var payload = {
          base: cfg.base,
          rates: data.rates,
          updatedAt: data.time_last_update_utc || '',
          time_last_update_utc: data.time_last_update_utc || '',
          time_last_update_unix: data.time_last_update_unix || null,
          nextUpdate: data.time_next_update_utc || '',
          fetchedAt: Date.now()
        };
        save(cacheKey, payload);
        finish(payload);
      } catch (e) { fail(clean(e && e.message ? e.message : e)); }
    });
  } catch (e) { fail(clean(e && e.message ? e.message : e)); }
}());
