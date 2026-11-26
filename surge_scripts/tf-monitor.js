/* TestFlight public-page monitor 1.0.1. Native cron; legacy argument compatibility. */
(function () {
  'use strict';
  var ended = false, active = 0, cursor = 0, jobs = [], interval = 5, nativeSchedule = false;
  var run = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  function log(s) { console.log('[TF] ' + s); }
  function done() { if (!ended) { ended = true; $done(); } }
  function canonical(s) {
    var m = /^https:\/\/testflight\.apple\.com\/join\/([A-Za-z0-9]{8})\/?(?:\?([A-Za-z0-9._~!$&()*+;=:@%/?-]*))?$/.exec(s);
    if (!m || /%(?![0-9a-f]{2})/i.test(m[2] || '')) { return null; }
    return {code: m[1], url: 'https://testflight.apple.com/join/' + m[1]};
  }
  function inputs(raw) {
    raw = String(raw || '').trim();
    nativeSchedule = raw.indexOf('schedule=native&') === 0;
    if (nativeSchedule) { raw = raw.slice('schedule=native&'.length); }
    var prefix = /^interval_minutes=([^&]*)&tf_links=([\s\S]*)$/.exec(raw);
    var minutes = prefix ? prefix[1] : '5';
    interval = /^[1-9][0-9]{0,3}$/.test(minutes) && Number(minutes) <= 1440 ? Number(minutes) : 5;
    if (String(interval) !== minutes) { log('interval_minutes 无效，安全回退5分钟（合法整数1-1440）'); }
    if (nativeSchedule && (!prefix || !/^[1-9][0-9]?$/.test(minutes) || Number(minutes) > 59)) {
      log('原生调度参数无效；合法分钟数1-59，本轮不请求'); return [];
    }
    raw = (prefix ? prefix[2] : raw).trim();
    if (!raw || raw === '-') { return []; }
    if (raw.length > 8192) { log('参数过长（上限8192字符），本轮不请求'); return []; }
    var seen = {}, out = [], bad = 0, over = 0;
    raw.split(/[,，|\s]+/).forEach(function (s, i) {
      if (!s) { return; }
      var c = canonical(s);
      if (!c) { bad++; log('无效项 #' + (i + 1) + '：仅接受 https://testflight.apple.com/join/8位字母数字；拒绝端口、凭据及引号'); return; }
      if (seen[c.code]) { return; }
      seen[c.code] = true;
      if (out.length === 10) { over++; return; }
      out.push(c);
    });
    if (over) { log('最多监控10个不同链接；额外 ' + over + ' 项已忽略'); }
    if (!out.length && !bad) { log('未填写有效链接'); }
    return out;
  }
  function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function (all, x) {
      var names = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
      if (x[0] !== '#') { return names[x.toLowerCase()]; }
      var n = x[1].toLowerCase() === 'x' ? parseInt(x.slice(2),16) : parseInt(x.slice(1),10);
      return n > 0 && n <= 65535 ? String.fromCharCode(n) : ' ';
    });
  }
  function attrs(s) {
    var a = {}, re = /([^\s=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>]+)))?/g, m;
    while ((m = re.exec(s))) {
      var k = m[1].toLowerCase();
      if (Object.prototype.hasOwnProperty.call(a,k)) { throw new Error('重复属性'); }
      a[k] = decode(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || '');
    }
    return a;
  }
  /* Deliberately small, bounded HTML reader, not a browser/JS interpreter.
     Raw-text elements and template contents are excluded before interpretation. */
  function page(html, code) {
    if (typeof html !== 'string' || html.length > 524288) { return 'unknown'; }
    html = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
      .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    if (/<(?:script|style|template|noscript)\b/i.test(html)) { return 'unknown'; }
    var stack = [], nodes = [], meta = false, re = /<[^>]*>|[^<]+/g, m, count = 0;
    while ((m = re.exec(html))) {
      if (++count > 12000) { return 'unknown'; }
      var t = m[0];
      if (t[0] !== '<') {
        var text = decode(t);
        stack.forEach(function (n) { if (!n.hidden) { n.text += text; } });
        continue;
      }
      if (/^<!/.test(t) || /^<\?/.test(t)) { continue; }
      var close = /^<\/\s*([a-z0-9-]+)\s*>$/i.exec(t);
      if (close) {
        for (var j = stack.length - 1; j >= 0; j--) {
          if (stack[j].tag === close[1].toLowerCase()) { stack.length = j; break; }
        }
        continue;
      }
      var tag = /^<([a-z][a-z0-9-]*)\b([\s\S]*?)\/?\s*>$/i.exec(t);
      if (!tag) { return 'unknown'; }
      var a = attrs(tag[2]), parent = stack.length ? stack[stack.length - 1] : null;
      var special = (a.id === 'status' || a.id === 'steps') && tag[1].toLowerCase() === 'div';
      var hidden = !!(parent && parent.hidden) || a.hidden !== undefined || a['aria-hidden'] === 'true' ||
        (!special && /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(a.style || ''));
      var n = {tag:tag[1].toLowerCase(), a:a, parent:parent, text:'', hidden:hidden};
      nodes.push(n);
      if (n.tag === 'meta' && a.name === 'apple-itunes-app' && !hidden &&
          a.content === 'app-id=899247664, app-argument=https://testflight.apple.com/join/' + code) { meta = true; }
      if (!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(n.tag)) { stack.push(n); }
      if (stack.length > 80) { return 'unknown'; }
    }
    if (!meta) { return 'unknown'; }
    function hasClass(n, c) { return (' ' + (n.a['class'] || '') + ' ').replace(/\s+/g,' ').indexOf(' ' + c + ' ') >= 0; }
    function ancestor(n, predicate) { for (var p = n.parent; p; p = p.parent) { if (predicate(p)) { return true; } } return false; }
    var statuses = nodes.filter(function (n) { return !n.hidden && hasClass(n,'beta-status') && ancestor(n,function (p) { return p.a.id === 'status'; }); });
    if (statuses.length !== 1) { return 'unknown'; }
    var status = statuses[0].text.replace(/\s+/g,' ').trim();
    if (status === 'This beta is full.') { return 'full'; }
    if (status === "This beta isn't accepting any new testers right now.") { return 'closed'; }
    if (!/^To join the .{1,160} beta, open the link on your iPhone, iPad, or Mac after you install TestFlight\.$/.test(status)) { return 'unknown'; }
    var buttons = nodes.filter(function (n) {
      return n.tag === 'a' && !n.hidden && n.a.href === 'itms-beta://testflight.apple.com/join/' + code &&
        n.a.disabled === undefined && n.a['aria-disabled'] !== 'true' &&
        n.text.replace(/\s+/g,' ').trim() === 'View in TestFlight' &&
        hasClass(n,'button') && ancestor(n,function (p) { return hasClass(p,'st-button'); }) &&
        ancestor(n,function (p) { return p.a.id === 'steps'; });
    });
    return buttons.length === 1 ? 'open' : 'unknown';
  }
  function key(c) { return 'tfmonitor_v1_' + c.code; }
  function read(c) {
    var raw = $persistentStore.read(key(c));
    if (raw === null || raw === undefined || raw === '') { return {v:1,code:c.code,state:null,lastAttemptAt:0,lock:null}; }
    var r = JSON.parse(raw);
    if (!r || r.v !== 1 || r.code !== c.code || [null,'open','full','closed'].indexOf(r.state) < 0 ||
        typeof r.lastAttemptAt !== 'number' || !isFinite(r.lastAttemptAt) || r.lastAttemptAt < 0 ||
        (r.lock && (typeof r.lock.token !== 'string' || typeof r.lock.at !== 'number' || !isFinite(r.lock.at)))) {
      throw new Error('缓存损坏；为避免重报已跳过，请人工检查键 ' + key(c));
    }
    return r;
  }
  function save(c, r) {
    if ($persistentStore.write(JSON.stringify(r),key(c)) !== true) { throw new Error('持久化写入失败；不请求或不通知'); }
  }
  function release(c) {
    try { var r = read(c); if (r.lock && r.lock.token === run) { r.lock = null; save(c,r); } }
    catch (e) { log(c.code + ' 释放锁失败：' + e.message); }
  }
  function claim(c) {
    var r = read(c), now = Date.now();
    if (r.lock && now >= r.lock.at && now - r.lock.at < 20000) { log(c.code + ' 已有运行中任务'); return false; }
    if (r.lastAttemptAt > now) { log(c.code + ' 检测到时钟回退，重新建立检查基准'); }
    else if (r.lastAttemptAt > 0 && now - r.lastAttemptAt < (nativeSchedule ? 20000 : interval * 60000)) { return false; }
    r.lock = {token:run,at:now}; r.lastAttemptAt = now;
    save(c,r);
    r = read(c);
    return !!r.lock && r.lock.token === run;
  }
  function settle(c, state) {
    var r = read(c);
    if (!r.lock || r.lock.token !== run) { log(c.code + ' 锁归属改变，丢弃迟到结果'); return; }
    var notify = state === 'open' && r.state !== 'open';
    if (state === 'open' || state === 'full' || state === 'closed') { r.state = state; }
    r.lock = null;
    /* Reserve notification persistently BEFORE posting: fail closed on storage error.
       A crash/OS suppression between save and post can lose one alert; never claim delivery. */
    save(c,r);
    if (notify) {
      var check = read(c);
      if (check.state !== 'open' || check.lastAttemptAt !== r.lastAttemptAt || check.lock) { return; }
      try {
        $notification.post('TestFlight 公开邀请可加入',c.code,'公开邀请页显示 View in TestFlight；点击手动查看，名额及设备条件以 TestFlight 为准。',{url:c.url});
        log(c.code + ' 已调用通知API（不代表系统已展示）');
      } catch (e) { log(c.code + ' 通知API异常；为防刷屏本次不重试'); }
    }
    log(c.code + ' 状态=' + state);
  }
  function pump() {
    if (ended) { return; }
    while (active < 2 && cursor < jobs.length) {
      var c = jobs[cursor++];
      try { if (!claim(c)) { continue; } }
      catch (e) { log(c.code + ' ' + e.message); continue; }
      active++;
      request(c);
    }
    if (!active && cursor >= jobs.length) { done(); }
  }
  function request(c) {
    var finished = false;
    function finish(error, response, body) {
      if (finished || ended) { return; }
      finished = true;
      try {
        var state = 'unknown';
        if (!error && response && Number(response.status) === 200) { state = page(body,c.code); }
        settle(c,state);
      } catch (e) { log(c.code + ' 检查失败：' + e.message); release(c); }
      active--; pump();
    }
    setTimeout(function () { finish('watchdog',null,null); },9000);
    try {
      $httpClient.get({url:c.url,timeout:8,'auto-redirect':false,'auto-cookie':false,
        headers:{'Accept-Language':'en-US','Accept':'text/html'}},finish);
    } catch (e) { finish('request-exception',null,null); }
  }
  try {
    jobs = inputs(typeof $argument === 'string' ? $argument : '');
    if (!jobs.length) { done(); return; }
    setTimeout(function () {
      if (ended) { return; }
      jobs.forEach(release);
      log('本轮达到50秒上限；未完成项保持保守状态'); done();
    },50000);
    pump();
  } catch (e) { log('运行终止：' + e.message); done(); }
}());
