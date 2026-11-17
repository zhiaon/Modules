/* 版本更新雷达 · V1.0 · 许舟
 * Public GitHub Releases; no credentials bundled. Panel auto-refresh reads cache.
 * First successful observation is a silent baseline, independently per channel.
 */
(function () {
  'use strict';
  var PREFIX = 'release_radar_v1_';
  var MAX_REPOS = 12;
  var START = Date.now();
  var FINISH_BY = START + 76000;
  var trigger = typeof $trigger === 'string' ? $trigger : '';
  var isCron = typeof $script !== 'undefined' && $script.type === 'cron';
  var finished = false, ownedLock = '', timer = null, items = [], notices = [];
  var warnings = [], cfg, gateKey = '', gate = {}, lockKey = PREFIX + 'lock';

  function text(v) { return v == null ? '' : String(v); }
  function clean(v) { return text(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); }
  function real(v) { v = text(v).trim(); return v === '-' ? '' : v; }
  function on(v, fallback) {
    if (v == null || v === '') return fallback;
    return /^(true|1|on|yes|开|开启)$/i.test(text(v).trim());
  }
  function hash(s) {
    var n = 2166136261;
    for (var i = 0; i < s.length; i++) n = Math.imul(n ^ s.charCodeAt(i), 16777619);
    return (n >>> 0).toString(36);
  }
  function load(key) {
    try { var x = JSON.parse($persistentStore.read(key) || 'null'); return x && typeof x === 'object' ? x : {}; }
    catch (_) { return {}; }
  }
  function save(key, value) {
    try { return $persistentStore.write(JSON.stringify(value), key) !== false; }
    catch (_) { return false; }
  }
  function stamp(value) {
    var d = new Date(value);
    if (!isFinite(d.getTime())) return '未知';
    function p(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function brief(body, limit) {
    var t = text(body).replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/(^|\n)\s{0,3}[#>*-]+\s*/g, '$1')
      .replace(/[`*_~]/g, '').replace(/\s+/g, ' ').trim();
    return t.length > limit ? t.slice(0, limit - 1) + '…' : t;
  }
  function parseConfig() {
    var p = (typeof $argument === 'string' ? $argument : '').split('|');
    if (p.length > 5) throw new Error('参数中不能包含竖线 |，多个仓库请用分号分隔');
    var list = real(p[0]), repos = [], seen = {};
    var parts = list ? list.split(/[;；,，\n]+/) : [];
    parts.forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var eq = part.indexOf('='), label = '';
      if (eq > -1) { label = clean(part.slice(0, eq)); part = part.slice(eq + 1).trim(); }
      part = part.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
        .replace(/[?#].*$/, '').replace(/\/(?:releases|tags)(?:\/.*)?$/i, '')
        .replace(/\/$/, '').replace(/\.git$/i, '');
      if (!/^[a-z\d][a-z\d-]{0,38}\/[a-z\d_.-]{1,100}$/i.test(part) || /\/(\.|\.\.)$/.test(part)) {
        throw new Error('仓库格式有误，请填写 owner/repo 或 GitHub 仓库链接');
      }
      var id = part.toLowerCase();
      if (seen[id]) return;
      seen[id] = true;
      repos.push({repo: part, label: label.slice(0, 40) || part.split('/')[1]});
    });
    if (repos.length > MAX_REPOS) throw new Error('单个模块最多监测 12 个仓库，请减少仓库数量');
    var token = real(p[4]), policy = real(p[3]);
    if (/[\r\n]/.test(token) || /\s/.test(token)) throw new Error('访问令牌含空格或换行，请检查参数');
    return {repos: repos, beta: on(p[1], false), notify: on(p[2], true), policy: policy, token: token};
  }
  function keyFor(repo) {
    return PREFIX + repo.toLowerCase().replace('/', '__') + (cfg.beta ? '_all' : '_stable');
  }
  function stateFor(repo) {
    var s = load(keyFor(repo));
    if (!Array.isArray(s.seen)) s.seen = [];
    if (!s.release || typeof s.release !== 'object') s.release = null;
    return s;
  }
  function readItems() {
    return cfg.repos.map(function (r) {
      return {repo: r.repo, label: r.label, key: keyFor(r.repo), state: stateFor(r.repo)};
    });
  }
  function releaseInfo(r, repo) {
    if (!r || !r.id || !clean(r.tag_name) || r.draft) throw new Error('Release 数据格式异常');
    var url = text(r.html_url);
    if (!/^https:\/\/github\.com\/[a-z\d_.-]+\/[a-z\d_.-]+\/releases\//i.test(url)) {
      url = 'https://github.com/' + repo + '/releases';
    }
    return {identity: text(r.id) + ':' + text(r.tag_name), id: text(r.id),
      tag: clean(r.tag_name).slice(0, 120), name: clean(r.name).slice(0, 160),
      beta: r.prerelease === true, published: text(r.published_at || r.created_at),
      url: url, notes: brief(r.body, 280)};
  }
  function configurationCard(error) {
    return {title: '版本更新雷达', style: error ? 'error' : 'info', content:
      (error ? '⚠ ' + error + '\n\n' : '尚未添加关注的仓库\n\n') +
      '打开模块 → 参数 → 仓库列表\n' +
      '格式：owner/repo；owner/repo\n' +
      '也支持：显示名=owner/repo\n\n' +
      '默认每两小时检查一次\n首次只记录版本，后续更新才通知\n面板右上角刷新可立即检查'};
  }
  function acquire() {
    var now = Date.now();
    var old = load(lockKey);
    if (old.ts && now - Number(old.ts) < 180000 && old.id) return false;
    ownedLock = hash(String(now) + ':' + String(Math.random()));
    save(lockKey, {id: ownedLock, ts: now});
    return true;
  }
  function releaseLock() {
    if (!ownedLock) return;
    var old = load(lockKey);
    if (old.id === ownedLock) $persistentStore.write(null, lockKey);
    ownedLock = '';
  }
  function header(headers, name) {
    if (!headers) return '';
    var target = name.toLowerCase(), out = '';
    Object.keys(headers).some(function (k) {
      if (k.toLowerCase() === target) { out = text(headers[k]); return true; }
      return false;
    });
    return out;
  }
  function endpoint(repo) {
    return cfg.beta
      ? 'https://api.github.com/repos/' + repo + '/releases?per_page=10'
      : 'https://api.github.com/repos/' + repo + '/releases/latest';
  }
  function requestOne(item, done) {
    var old = item.state;
    var headers = {'Accept':'application/vnd.github+json','User-Agent':'Surge-Release-Radar/1.0','X-GitHub-Api-Version':'2022-11-28'};
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    if (old.etag) headers['If-None-Match'] = old.etag;
    var options = {url: endpoint(item.repo), headers: headers, timeout: 8};
    if (cfg.policy) options.policy = cfg.policy;
    $httpClient.get(options, function (err, resp, data) {
      var status = resp && Number(resp.status) || 0;
      var etag = header(resp && resp.headers, 'etag');
      if (etag) old.etag = etag;
      old.lastCheck = Date.now();
      if (!err && status === 304 && old.release) {
        old.lastError = ''; save(item.key, old); item.info = old.release; item.cached = true; return done();
      }
      if (!err && status >= 200 && status < 300) {
        try {
          var body = JSON.parse(data || (cfg.beta ? '[]' : '{}')), raw = body;
          if (cfg.beta) {
            if (!Array.isArray(body)) throw new Error('列表格式异常');
            raw = body.filter(function (x) { return x && !x.draft; })[0];
            if (!raw) { old.release = null; old.lastError = ''; save(item.key, old); item.noRelease = true; return done(); }
          }
          var info = releaseInfo(raw, item.repo), previous = old.release;
          var changed = previous && previous.identity !== info.identity;
          var fresh = old.seen.indexOf(info.identity) < 0;
          old.release = info; old.lastError = '';
          if (old.seen.indexOf(info.identity) < 0) old.seen.push(info.identity);
          if (old.seen.length > 40) old.seen = old.seen.slice(-40);
          save(item.key, old); item.info = info;
          item.updated = !!(changed && fresh);
          if (item.updated) notices.push({repo:item.repo,label:item.label,info:info});
          return done();
        } catch (parseErr) { old.lastError = '返回内容无法解析'; save(item.key, old); item.error = old.lastError; return done(); }
      }
      if (status === 404) { old.lastError = '暂无公开 Release，或仓库不存在'; save(item.key, old); item.error = old.lastError; return done(); }
      var remain = header(resp && resp.headers, 'x-ratelimit-remaining'), reset = header(resp && resp.headers, 'x-ratelimit-reset');
      var msg = status ? 'GitHub HTTP ' + status : (err ? clean(err) : '无响应');
      if (status === 403 && remain === '0' && reset) msg = 'GitHub API 限流，约 ' + Math.ceil(Math.max(0, Number(reset) * 1000 - Date.now()) / 60000) + ' 分钟后重试';
      else if (status === 429) msg = 'GitHub API 请求过于频繁，请稍后重试';
      old.lastError = msg.slice(0, 180); save(item.key, old); item.error = old.lastError; done();
    });
  }
  function runRequests(done) {
    var next = 0, active = 0, completed = 0, limit = Math.min(4, items.length || 1);
    function launch() {
      if (finished) return;
      while (active < limit && next < items.length && Date.now() < FINISH_BY) (function (item) { active++; requestOne(item, function () { active--; completed++; if (completed >= items.length) done(); else launch(); }); }(items[next++]));
      if (items.length === 0 || completed >= items.length) done();
    }
    launch();
  }
  function row(item) {
    var title = item.label || item.repo;
    if (item.updated && item.info) return '🆕 ' + title + '  ' + item.info.tag + '  · 有新版本';
    if (item.info) return '✅ ' + title + '  ' + item.info.tag + '  · ' + stamp(item.info.published);
    if (item.noRelease) return '—  ' + title + '  · 暂无公开 Release';
    if (item.error) return '⚠️ ' + title + '  · ' + item.error;
    var cached = item.state && item.state.release;
    return cached ? '⚠️ ' + title + '  ' + cached.tag + '  · 使用缓存' : '⏳ ' + title + '  · 未获取';
  }
  function panelResult() {
    var fresh = items.filter(function (x) { return x.updated; }).length, failed = items.filter(function (x) { return x.error; }).length, lines = [];
    lines.push('监测 ' + items.length + ' 个仓库 · ' + (cfg.beta ? '包含测试版' : '仅稳定版'), '');
    items.forEach(function (item, i) { if (i) lines.push(''); lines.push(row(item)); if (item.info && item.updated) { lines.push('  ' + (item.info.name || item.info.tag)); if (item.info.notes) lines.push('  ' + item.info.notes); } else if (item.info && item.state.lastCheck) lines.push('  发布于 ' + stamp(item.info.published)); });
    lines.push('', '检查于 ' + stamp(Date.now()) + ' · 面板刷新可立即检查');
    if (fresh) lines.unshift('发现 ' + fresh + ' 个新版本\n');
    if (failed) lines.push('有 ' + failed + ' 个仓库本次获取失败，保留上次结果');
    return {title:'版本更新雷达 · ' + items.length + ' 个', content:lines.join('\n'), style:failed && !items.some(function (x) { return x.info; }) ? 'error' : (fresh || failed ? 'alert' : 'good')};
  }
  function notify() {
    if (!isCron || !cfg.notify || notices.length === 0 || typeof $notification === 'undefined') return;
    var lines = notices.slice(0, 8).map(function (n) { return n.label + '  ' + n.info.tag + (n.info.name && n.info.name !== n.info.tag ? ' · ' + n.info.name : ''); });
    if (notices.length > 8) lines.push('还有 ' + (notices.length - 8) + ' 个更新');
    var first = notices[0].info;
    $notification.post('版本更新雷达', notices.length + ' 个项目有新版本', lines.join('\n'), {action:'open-url',url:first.url,sound:false,'auto-dismiss':true});
  }
  function finish() { if (finished) return; finished = true; if (timer) clearTimeout(timer); releaseLock(); notify(); if (isCron) $done(); else $done(panelResult()); }
  function fail(message) { if (finished) return; finished = true; if (timer) clearTimeout(timer); releaseLock(); if (isCron) $done(); else $done(configurationCard(message)); }
  try {
    cfg = parseConfig();
    if (cfg.repos.length === 0) { if (isCron) $done(); else $done(configurationCard(false)); }
    else if (!acquire()) { if (isCron) $done(); else $done({title:'版本更新雷达',content:'已有一次检查正在进行，请稍后刷新',style:'info'}); }
    else { items = readItems(); timer = setTimeout(function () { finish(); }, Math.max(1000, FINISH_BY - Date.now())); runRequests(finish); }
  } catch (e) { fail(clean(e && e.message ? e.message : e)); }
}());
