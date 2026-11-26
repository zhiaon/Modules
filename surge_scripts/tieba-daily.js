/* 百度贴吧签到 · Standalone Surge iOS 6 module. */
(function () {
  'use strict';
  var ROOT = 'https://tieba.baidu.com';
  var NS = 'surge.tieba.daily.v1.';
  var PATH = { login: '/dc/common/tbs', list: '/mo/q/newmoindex', sign: '/sign/add' };
  var fields = ['BDUSS', 'BDUSS_BFESS'];
  var MAX_BOARDS = 40;
  var PAUSE = 1250;
  var BUDGET = 78000;
  var MSG = {
    config: '模块参数无效', storage: '本地存储异常', busy: '另一个任务正在运行',
    network: '网络异常', timeout: '请求超时', budget: '本轮时间不足',
    expired: '登录已失效，请重新绑定', forbidden: '访问受限，请到官方页面检查',
    rate: '请求受限，请稍后再试', verify: '需要在官方页面完成人工验证',
    server: '贴吧服务异常', redirect: '接口发生跳转，已停止', schema: '接口返回无法确认',
    invalid: '输入不含完整的本人贴吧会话', scope: '本轮关注列表超过安全上限',
    failed: '平台未确认成功', interrupted: '上轮没有留下最终回执',
    http: '接口请求失败', signed: '签到成功', already: '已经签到',
    missing: '未绑定贴吧会话', skipped: '今天已执行过自动签到'
  };
  function fail(k) { var e = new Error(k); e.k = k; return e; }
  function now() { return Date.now(); }
  function day(t) { var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function pad(n) { return ('0' + n).slice(-2); }
  function hm(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function plain(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
  function safeNumber(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 0 && n <= 9007199254740991; }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function read(key, fallback) {
    try {
      var raw = $persistentStore.read(NS + key);
      if (raw === null || raw === undefined || raw === '') return fallback;
      var value = JSON.parse(raw);
      if (!plain(value) || value.v !== 1) throw 0;
      return value;
    } catch (e) { throw fail('storage'); }
  }
  function write(key, value) {
    try {
      var ok = $persistentStore.write(value === null ? null : JSON.stringify(value), NS + key);
      if (ok !== true) throw 0;
    } catch (e) { throw fail('storage'); }
  }
  function args(raw) {
    var p = String(raw || '').split('|');
    if (p.length !== 4 || ['auto', 'manual', 'panel', 'bind', 'forget', 'capture'].indexOf(p[0]) < 0) throw fail('config');
    if (['true', 'false'].indexOf(p[1]) < 0 || ['true', 'false'].indexOf(p[2]) < 0) throw fail('config');
    var m = /^(0?[0-9]|[1-5][0-9]) (0?[0-9]|1[0-9]|2[0-3]) \* \* \*$/.exec(p[3]);
    if (!m) {
      var legacy = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(p[3]);
      if (legacy) { var bits = p[3].split(':'); m = [p[3], String(Number(bits[1])), String(Number(bits[0]))]; }
    }
    if (!m) throw fail('config');
    var cron = String(Number(m[1])) + ' ' + String(Number(m[2])) + ' * * *';
    return { action: p[0], auto: p[1] === 'true', capture: p[2] === 'true', cron: cron, time: pad(Number(m[2])) + ':' + pad(Number(m[1])) };
  }
  function status() {
    var s = read('status', { v: 1, autoDay: '', lastStart: 0, running: false, last: null, history: [] });
    if (typeof s.autoDay !== 'string' || !safeNumber(s.lastStart) || typeof s.running !== 'boolean' || !Array.isArray(s.history) || (s.last !== null && !plain(s.last))) throw fail('storage');
    return s;
  }
  function session() {
    var c = read('session', null);
    if (!c) return null;
    if (!plain(c.values) || !safeNumber(c.bound) || !safeNumber(c.updated) || typeof c.invalid !== 'boolean') throw fail('storage');
    if (!own(c.values, 'BDUSS') || !good(c.values.BDUSS)) throw fail('storage');
    Object.keys(c.values).forEach(function (k) { if (fields.indexOf(k) < 0 || !good(c.values[k])) throw fail('storage'); });
    return c;
  }
  function good(value) { return typeof value === 'string' && value.length > 0 && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value) && !/[\s,;"\\]/.test(value); }
  function cookieText(c) {
    if (!c || c.invalid) throw fail('expired');
    return fields.filter(function (k) { return c.values[k]; }).map(function (k) { return k + '=' + c.values[k]; }).join('; ');
  }
  function parseCookie(raw) {
    if (typeof raw !== 'string' || raw.length > 16384 || /[\x00-\x1f\x7f]/.test(raw)) throw fail('invalid');
    var values = {};
    raw.replace(/^Cookie:\s*/i, '').split(';').forEach(function (part) {
      var i = part.indexOf('='); if (i < 1) return;
      var key = part.slice(0, i).trim(), value = part.slice(i + 1).trim();
      if (fields.indexOf(key) < 0) return;
      if (own(values, key) || !good(value)) throw fail('invalid');
      values[key] = value;
    });
    if (!values.BDUSS) throw fail('invalid');
    return { v: 1, values: values, bound: now(), updated: 0, invalid: false };
  }
  function captureCookie(raw, source) {
    var incoming = parseCookie(raw), old = session();
    if (old && old.values.BDUSS === incoming.values.BDUSS && (!incoming.values.BDUSS_BFESS || old.values.BDUSS_BFESS === incoming.values.BDUSS_BFESS)) {
      old.updated = now(); old.invalid = false; write('session', old); return false;
    }
    incoming.source = source; write('session', incoming); return true;
  }
  function requestCookieHeader() {
    var c = session(); if (!c) throw fail('missing'); return cookieText(c);
  }
  function isTiebaRequest(url) {
    // Cookie capture is limited to exact official Tieba and Baidu login origins.
    return typeof url === 'string' && /^https:\/\/(?:tieba|passport)\.baidu\.com(?:\/|\?|$)/i.test(url);
  }
  function notifyCapture() {
    try { $notification.post('百度贴吧 Cookie', '自动抓取成功', '登录会话已安全保存到本机。'); } catch (e) {}
  }
  function captureRequest() {
    if (typeof $request === 'undefined' || !$request || typeof $request.url !== 'string' || !isTiebaRequest($request.url)) return {};
    var cfg = args(typeof $argument === 'undefined' ? '' : $argument);
    if (!cfg.capture) return {};
    var headers = $request.headers || {}, found = [];
    Object.keys(headers).forEach(function (k) { if (k.toLowerCase() === 'cookie') found.push(headers[k]); });
    if (found.length !== 1 || typeof found[0] !== 'string') return {};
    try { captureCookie(found[0], 'first-party-request'); notifyCapture(); } catch (e) {}
    return {};
  }
  function setCookieRows(headers) {
    var rows = [];
    if (Array.isArray(headers)) {
      headers.forEach(function (row) { if (row && typeof row.field === 'string' && row.field.toLowerCase() === 'set-cookie') rows.push(row.value); });
    } else if (headers && typeof headers === 'object') {
      Object.keys(headers).forEach(function (key) {
        if (key.toLowerCase() !== 'set-cookie') return;
        var value = headers[key]; if (Array.isArray(value)) rows = rows.concat(value); else rows.push(value);
      });
    }
    return rows;
  }
  function validSetCookie(line) {
    if (typeof line !== 'string' || line.length > 8192 || /[\r\n]/.test(line)) return null;
    var parts = line.split(';'), first = parts.shift(), i = first.indexOf('='); if (i < 1) return null;
    var key = first.slice(0, i).trim(), value = first.slice(i + 1).trim(); if (fields.indexOf(key) < 0 || !good(value)) return null;
    var attrs = {};
    parts.forEach(function (part) { var j = part.indexOf('='); var name = (j < 0 ? part : part.slice(0, j)).trim().toLowerCase(); if (name) attrs[name] = j < 0 ? '' : part.slice(j + 1).trim(); });
    if (attrs.path !== '/') return null;
    if (attrs.domain && ['baidu.com', 'tieba.baidu.com'].indexOf(attrs.domain.toLowerCase().replace(/^\./, '')) < 0) return null;
    return key + '=' + value;
  }
  function captureResponse() {
    if (typeof $request === 'undefined' || !$request || typeof $request.url !== 'string' || !isTiebaRequest($request.url)) return {};
    var cfg = args(typeof $argument === 'undefined' ? '' : $argument);
    if (!cfg.capture || typeof $response === 'undefined' || !$response) return {};
    try {
      var rows = setCookieRows($response.headers), pairs = [];
      rows.forEach(function (line) { var pair = validSetCookie(line); if (pair) pairs.push(pair); });
      if (!pairs.length) return {};
      var old = session();
      if (old) {
        renewSession($response.headers); notifyCapture();
        return {};
      }
      if (pairs.some(function (pair) { return pair.indexOf('BDUSS=') === 0; })) {
        captureCookie(pairs.join('; '), 'first-party-response'); notifyCapture();
      }
    } catch (e) {}
    return {};
  }
  function lock() {
    var old = read('guard', null);
    if (old && (!safeNumber(old.until) || typeof old.token !== 'string')) throw fail('storage');
    if (old && old.until > now()) throw fail('busy');
    var token = now().toString(36) + '-' + Math.random().toString(36).slice(2);
    write('guard', { v: 1, token: token, until: now() + 92000 });
    return wait(70).then(function () {
      var check = read('guard', null);
      if (!check || check.token !== token || check.until <= now()) throw fail('busy');
      return {
        check: function () { var x = read('guard', null); if (!x || x.token !== token || x.until <= now()) throw fail('busy'); },
        release: function () { var x = read('guard', null); if (x && x.token === token) write('guard', { v: 1, token: '', until: 0 }); }
      };
    });
  }
  function renewSession(headers) {
    var c = session(); if (!c || !headers) return false;
    var rows = setCookieRows(headers), changed = false;
    rows.forEach(function (line) {
      if (typeof line !== 'string' || line.length > 8192 || /[\r\n]/.test(line)) return;
      var parts = line.split(';'), first = parts.shift(), i = first.indexOf('='); if (i < 1) return;
      var key = first.slice(0, i).trim(), value = first.slice(i + 1).trim(); if (fields.indexOf(key) < 0) return;
      var attrs = {};
      parts.forEach(function (part) { var j = part.indexOf('='); var name = (j < 0 ? part : part.slice(0, j)).trim().toLowerCase(); if (name) attrs[name] = j < 0 ? '' : part.slice(j + 1).trim(); });
      if (attrs.path !== '/') return;
      if (attrs.domain && ['baidu.com', 'tieba.baidu.com'].indexOf(attrs.domain.toLowerCase().replace(/^\./, '')) < 0) return;
      if (!value || !good(value)) return;
      if (c.values[key] !== value) { c.values[key] = value; changed = true; }
    });
    if (changed) { c.updated = now(); c.invalid = false; write('session', c); }
    return changed;
  }
  function http(method, path, body, deadline, mutating, allowRenew) {
    var left = Math.floor((deadline - now()) / 1000);
    if (left < 2) return Promise.reject(fail('budget'));
    var options = {
      url: ROOT + path, timeout: Math.min(12, left - 1), 'auto-redirect': false, 'auto-cookie': false,
      headers: { Cookie: requestCookieHeader(), Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' }
    };
    if (method === 'POST') { options.body = body; options.headers['Content-Type'] = 'application/x-www-form-urlencoded'; options.headers.Referer = ROOT + '/'; }
    return new Promise(function (resolve, reject) {
      var settled = false;
      function finish(fn, value) { if (settled) return; settled = true; fn(value); }
      var timer = setTimeout(function () { finish(reject, fail('timeout')); }, (options.timeout + 1) * 1000);
      try {
        $httpClient[method.toLowerCase()](options, function (error, response, data) {
          if (typeof clearTimeout === 'function') clearTimeout(timer);
          if (error) return finish(reject, fail('network'));
          if (!response || !safeNumber(Number(response.status))) return finish(reject, fail('http'));
          var code = Number(response.status);
          if (code >= 300 && code < 400) return finish(reject, fail('redirect'));
          if (code === 401) return finish(reject, fail('expired'));
          if (code === 403) return finish(reject, fail('forbidden'));
          if (code === 429) return finish(reject, fail('rate'));
          if (code >= 500) return finish(reject, fail('server'));
          if (code < 200 || code >= 300) return finish(reject, fail('http'));
          if (allowRenew) { try { renewSession(response.headers); } catch (e) {} }
          if (typeof data !== 'string' || data.length > 1000000) return finish(reject, fail('schema'));
          var value;
          try { value = JSON.parse(data); } catch (e) { return finish(reject, fail('schema')); }
          if (!plain(value)) return finish(reject, fail('schema'));
          finish(resolve, value);
        });
      } catch (e) { clearTimeout(timer); finish(reject, fail('network')); }
    });
  }
  function form(obj) {
    return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(obj[k])); }).join('&');
  }
  function result(status, message, details) {
    var clean = {};
    Object.keys(details || {}).forEach(function (k) { var v = details[k]; if (/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(k) && (typeof v === 'string' || typeof v === 'boolean' || safeNumber(v))) clean[k] = v; });
    return { v: 1, status: status, message: message, at: now(), details: clean };
  }
  function run(cfg, automatic) {
    var s = status(), today = day(now());
    if (automatic) {
      if (!cfg.auto) return Promise.resolve(result('skipped', '自动签到已关闭', {}));
      if (s.autoDay === today) return Promise.resolve(result('skipped', MSG.skipped, {}));
      if (hm(now()) !== cfg.time) return Promise.resolve(result('skipped', '未到设定时间', { time: cfg.time }));
      // Reserve the automatic attempt before authenticated traffic. A failed attempt is not blindly retried today.
      s.autoDay = today;
    }
    if (s.running) return Promise.reject(fail('busy'));
    s.running = true; s.lastStart = now(); write('status', s);
    var deadline = now() + BUDGET, guard = null, c = null;
    function finish(r) {
      var latest = status(); latest.running = false; latest.last = r; latest.history.push(r);
      latest.history = latest.history.filter(function (x) { return x && safeNumber(x.at) && x.at >= now() - 30 * 86400000; }).slice(-120);
      write('status', latest); return r;
    }
    return lock().then(function (g) {
      guard = g; guard.check(); c = session();
      if (!c) return finish(result('skipped', MSG.missing, {}));
      return http('GET', PATH.login, null, deadline, false, cfg.capture).then(function (j) {
        guard.check();
        if (j.is_login === 0 || j.is_login === '0') throw fail('expired');
        if ((j.is_login !== 1 && j.is_login !== '1') || typeof j.tbs !== 'string' || !/^[a-zA-Z0-9]{8,128}$/.test(j.tbs)) throw fail('schema');
        return http('GET', PATH.list, null, deadline, false, cfg.capture).then(function (list) {
          guard.check();
          if (!plain(list.data) || !Array.isArray(list.data.like_forum)) throw fail('schema');
          var boards = list.data.like_forum, selected = [], seen = {};
          if (boards.length > MAX_BOARDS) throw fail('scope');
          boards.forEach(function (b) {
            if (!plain(b) || typeof b.forum_name !== 'string' || !b.forum_name || b.forum_name.length > 80 || [0, 1, '0', '1'].indexOf(b.is_sign) < 0 || own(seen, b.forum_name)) throw fail('schema');
            seen[b.forum_name] = true;
            if (String(b.is_sign) !== '1') selected.push(b);
          });
          if (!selected.length) return finish(result('already', MSG.already, { observed: boards.length, unsigned: 0, completeCatalogue: false }));
          var signed = 0, already = 0, failed = 0, stopped = false;
          function one(i) {
            guard.check();
            if (i >= selected.length) {
              if (failed) return finish(result('failed', MSG.failed, { observed: boards.length, signed: signed, already: already, failed: failed, completeCatalogue: false }));
              return finish(result(signed ? 'success' : 'already', signed ? MSG.signed : MSG.already, { observed: boards.length, signed: signed, already: already, failed: 0, completeCatalogue: false }));
            }
            if (now() + 5000 >= deadline) throw fail('budget');
            if (stopped) { failed++; return one(i + 1); }
            return (i ? wait(PAUSE) : Promise.resolve()).then(function () {
              guard.check();
              return http('POST', PATH.sign, form({ ie: 'utf-8', kw: selected[i].forum_name, tbs: j.tbs }), deadline, true, cfg.capture).then(function (reply) {
                guard.check();
                if (reply.no === 0) signed++;
                else if (reply.no === 1101) already++;
                else { failed++; stopped = true; }
                return one(i + 1);
              });
            });
          }
          return one(0);
        });
      });
    }).catch(function (e) {
      var k = e && e.k && own(MSG, e.k) ? e.k : 'failed';
      if (k === 'expired' && c) { c.invalid = true; write('session', c); }
      return finish(result(k === 'expired' ? 'expired' : 'failed', MSG[k], {}));
    }).then(function (r) {
      if (guard) guard.release();
      return r;
    }, function (e) {
      if (guard) guard.release();
      var k = e && e.k && own(MSG, e.k) ? e.k : 'failed';
      return finish(result(k === 'expired' ? 'expired' : 'failed', MSG[k], {}));
    });
  }
  function panel(cfg) {
    var s = status(), c = null;
    try { c = session(); } catch (e) { c = null; }
    var lines = ['百度贴吧签到', '版本 V1.0.0', '', '会话：' + (c && !c.invalid ? '已绑定' : '未绑定'), '自动签到：' + (cfg.auto ? '开启' : '关闭'), '自动抓取Cookie：' + (cfg.capture ? '开启' : '关闭'), '签到时间：' + cfg.time, '最近执行：' + (s.last ? s.last.message + ' · ' + hm(s.last.at) : '暂无记录'), '今日自动：' + (s.autoDay === day(now()) ? '已执行' : '待执行'), '', '手动入口：TB立即签到 / TB绑定贴吧会话', '注意：列表仅代表接口返回的可见范围，不等同于全部关注贴吧。'];
    return { title: '百度贴吧签到', content: lines.join('\n'), icon: 'checkmark.circle.fill', 'icon-color': '3B82F6' };
  }
  function bind(cfg) {
    if (typeof $trigger === 'undefined' || $trigger !== 'intent' || typeof $intent === 'undefined' || typeof $intent.parameter !== 'string') throw fail('invalid');
    var c = parseCookie($intent.parameter); write('session', c);
    return http('GET', PATH.login, null, now() + 12000, false, cfg.capture).then(function (j) {
      if (j.is_login === 0 || j.is_login === '0') { c.invalid = true; write('session', c); throw fail('expired'); }
      if ((j.is_login !== 1 && j.is_login !== '1') || typeof j.tbs !== 'string' || !/^[a-zA-Z0-9]{8,128}$/.test(j.tbs)) throw fail('schema');
      return { title: '百度贴吧签到', content: '贴吧会话已保存并通过登录检查。' };
    }).catch(function (e) {
      var k = e && e.k && own(MSG, e.k) ? e.k : 'failed';
      throw fail(k);
    });
  }
  function forget() { write('session', null); return { title: '百度贴吧签到', content: '贴吧会话已清除。' }; }
  function notify(r) {
    if (!r || r.status !== 'success') return;
    try { $notification.post('百度贴吧签到', '签到成功', '新签到 ' + (r.details.signed || 0) + ' 个贴吧。'); } catch (e) {}
  }
  var finished = false;
  function done(value) { if (finished) return; finished = true; $done(value || {}); }
  function main() {
    var cfg, action;
    try {
      cfg = args(typeof $argument === 'undefined' ? '' : $argument); action = cfg.action;
      if (action === 'capture') {
        if (typeof $response !== 'undefined' && $response) done(captureResponse());
        else done(captureRequest());
        return;
      }
      if (action === 'panel') { done(panel(cfg)); return; }
      if (action === 'bind') { bind(cfg).then(done).catch(function (e) { done({ title: '百度贴吧签到', content: MSG[e.k] || MSG.failed, style: 'error' }); }); return; }
      if (action === 'forget') { done(forget()); return; }
      run(cfg, action === 'auto').then(function (r) { if (r.status === 'success') notify(r); done({}); }).catch(function (e) { done({ title: '百度贴吧签到', content: MSG[e.k] || MSG.failed, style: 'error' }); });
    } catch (e) { done({ title: '百度贴吧签到', content: MSG[e.k] || MSG.failed, style: 'error' }); }
  }
  main();
}());
