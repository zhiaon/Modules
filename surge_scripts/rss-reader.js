/* RSS 订阅面板 · V1.0 · 许舟
 * Reads RSS 2.0 / RSS 1.0 (RDF) / Atom feeds and lists the newest entries.
 * First run only records a baseline; new entries after that are notified.
 */
(function () {
  'use strict';
  var PREFIX = 'rss_reader_v1_';
  var MAX = 8, MAX_KEEP = 60;
  var started = Date.now();
  var deadline = started + 50000;
  var arg = typeof $argument === 'string' ? $argument : '';
  var p = arg.split('|');
  var finished = false, timer = null, cfg, items = [], fresh = [];

  function s(v) { return v == null ? '' : String(v); }
  function clean(v) { return s(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function real(v) { v = clean(v); return v === '-' ? '' : v; }
  function truth(v, fallback) { return v == null || v === '' ? fallback : /^(true|1|yes|on|开|开启)$/i.test(s(v).trim()); }
  function z(n) { return ('0' + n).slice(-2); }
  function timeText(ms) {
    var d = new Date(ms || Date.now());
    return d.getFullYear() + '/' + z(d.getMonth() + 1) + '/' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  function agoText(ms) {
    if (!ms) return '';
    var diff = Date.now() - ms;
    if (diff < 0) diff = 0;
    var m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    var d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    return new Date(ms).getFullYear() + '/' + z(new Date(ms).getMonth() + 1) + '/' + z(new Date(ms).getDate());
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function load(key) {
    try { var x = JSON.parse($persistentStore.read(key) || 'null'); return x && typeof x === 'object' ? x : {}; }
    catch (_) { return {}; }
  }
  function save(key, value) { try { return $persistentStore.write(JSON.stringify(value), key) !== false; } catch (_) { return false; } }
  function hash(v) {
    var n = 2166136261, t = s(v);
    for (var i = 0; i < t.length; i++) n = Math.imul(n ^ t.charCodeAt(i), 16777619);
    return (n >>> 0).toString(36);
  }
  function decodeEntities(v) {
    var t = s(v);
    if (!t) return '';
    t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    t = t.replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
    t = t.replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); });
    var named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
    t = t.replace(/&([a-zA-Z]+);/g, function (m, k) { return named[k] || m; });
    return t;
  }
  function stripTags(v) {
    return decodeEntities(s(v).replace(/<[^>]*>/g, ' '));
  }
  function pick(block, names) {
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var re = new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + n + '>', 'i');
      var m = block.match(re);
      if (m && clean(decodeEntities(m[1]))) return m[1];
      var self = block.match(new RegExp('<' + n + '(?:\\s[^>]*)?\\/>', 'i'));
      if (self) return '';
    }
    return '';
  }
  function attr(block, tag, name) {
    var re = new RegExp('<' + tag + '\\b([^>]*)>', 'i'), m = block.match(re);
    if (!m) return '';
    var a = m[1].match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
    return a ? a[1] : '';
  }
  function parseDate(v) {
    var raw = clean(v);
    if (!raw) return null;
    var t = Date.parse(raw);
    if (!isNaN(t)) return t;
    var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return null;
  }
  function entryLink(block, feedLink) {
    var link = clean(decodeEntities(pick(block, ['link'])));
    if (link && /^https?:\/\//i.test(link)) return link;
    var href = attr(block, 'link', 'href');
    if (href) return href;
    var guid = clean(decodeEntities(pick(block, ['guid', 'id'])));
    if (/^https?:\/\//i.test(guid)) return guid;
    var links = block.match(/<link\b[^>]*href\s*=\s*["']([^"']+)["']/ig) || [];
    for (var i = 0; i < links.length; i++) {
      var h = links[i].match(/href\s*=\s*["']([^"']+)["']/i);
      if (h && /^https?:\/\//i.test(h[1])) return h[1];
    }
    return feedLink || '';
  }
  function parseFeed(body, item) {
    var text = s(body);
    if (!text) throw new Error('返回内容为空');
    var m = text.match(/<channel\b[\s\S]*?<\/channel>/i);
    var channel = m ? m[0] : text;
    var isAtom = /<feed\b/i.test(text) && !/<rss\b/i.test(text);
    var feedTitle = clean(stripTags(pick(channel, ['title']))) || item.label;
    var feedLink = clean(decodeEntities(pick(channel, ['link'])));
    if (!/^https?:\/\//i.test(feedLink)) feedLink = attr(channel, 'link', 'href') || '';
    var blocks = [], re = /<item\b[\s\S]*?<\/item>/ig, mm;
    while ((mm = re.exec(text))) blocks.push(mm[0]);
    if (!blocks.length) {
      re = /<entry\b[\s\S]*?<\/entry>/ig;
      while ((mm = re.exec(text))) blocks.push(mm[0]);
    }
    if (!blocks.length) throw new Error('没有找到条目，可能不是 RSS/Atom 地址');
    var list = [], i;
    for (i = 0; i < blocks.length && i < 30; i++) {
      var b = blocks[i];
      var title = clean(stripTags(pick(b, ['title'])));
      var link = entryLink(b, feedLink);
      var dateRaw = pick(b, ['pubDate', 'published', 'updated', 'dc:date', 'date']);
      var ts = parseDate(dateRaw);
      var summary = clean(stripTags(pick(b, ['description', 'summary', 'content:encoded', 'content'])));
      if (!title && !link) continue;
      if (summary.length > 120) summary = summary.slice(0, 120) + '…';
      var id = clean(decodeEntities(pick(b, ['guid', 'id']))) || link || title;
      list.push({id: hash(id || title || link), title: title || '(无标题)', link: link, date: ts, summary: summary});
    }
    list.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
    return {title: feedTitle, link: feedLink, entries: list};
  }
  function parseConfig() {
    var raw = real(p[0]), seen = {}, feeds = [];
    if (raw) raw.split(/[;；\n]+/).forEach(function (part) {
      var t = clean(part);
      if (!t) return;
      var label = '', url = t, eq = t.indexOf('=');
      if (eq > 0 && /^https?:\/\//i.test(t.slice(eq + 1).trim())) {
        label = clean(t.slice(0, eq)); url = t.slice(eq + 1).trim();
      }
      if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('订阅地址格式有误：' + t);
      var key = PREFIX + hash(url);
      if (seen[key]) return;
      seen[key] = true;
      feeds.push({url: url, label: label || url.replace(/^https?:\/\//i, '').split('/')[0], key: key});
    });
    if (feeds.length > MAX) throw new Error('最多订阅 8 个源');
    var per = real(p[2]); per = per === '' ? 5 : Number(per);
    if (!isFinite(per) || per < 1 || per > 10) per = 5;
    return {feeds: feeds, notify: truth(p[1], true), policy: real(p[3]), perFeed: Math.round(per)};
  }
  function card(error) {
    return {title: 'RSS 订阅', style: error ? 'error' : 'info', content:
      (error ? '⚠ ' + error + '\n\n' : '尚未添加订阅\n\n') +
      '打开模块 → 参数 → 订阅列表\n每个源填 RSS / Atom 地址\n多个用英文分号分隔\n\n' +
      '支持两种写法：\n' +
      '· https://sspai.com/feed\n' +
      '· 少数派=https://sspai.com/feed\n\n' +
      'GitHub 仓库可用 releases.atom 跟新版本\n' +
      '首次只记录现有条目，之后新增才通知'};
  }
  function httpGet(url, done) {
    var opts = {url: url, timeout: 14, headers: {'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*', 'User-Agent': 'Surge-RSS-Reader/1.0'}, 'auto-redirect': true, 'auto-cookie': false};
    if (cfg && cfg.policy) opts.policy = cfg.policy;
    $httpClient.get(opts, function (err, resp, body) {
      var status = resp && Number(resp.status) || 0;
      if (err || !resp || status < 200 || status >= 300) return done(new Error(err ? clean(err) : (status ? 'HTTP ' + status : '无响应')));
      done(null, body);
    });
  }
  function request(feed, done) {
    var old = load(feed.key);
    var seenIds = old.ids && typeof old.ids === 'object' ? old.ids : null;
    httpGet(feed.url, function (err, body) {
      if (err) {
        feed.error = err.message;
        feed.cached = old && old.entries ? old : null;
        return done();
      }
      try {
        var parsed = parseFeed(body, feed);
        feed.title = parsed.title;
        feed.link = parsed.link;
        feed.entries = parsed.entries;
        feed.first = !seenIds;
        var ids = {};
        var newOnes = [];
        var newSet = {};
        if (seenIds) {
          parsed.entries.forEach(function (e) { if (!seenIds[e.id]) { newOnes.push(e); newSet[e.id] = 1; } });
          feed.newCount = newOnes.length;
          feed.newSet = newSet;
          if (newOnes.length) fresh.push({feed: feed, entries: newOnes.slice(0, cfg.perFeed)});
        } else {
          feed.newCount = 0;
          feed.newSet = {};
        }
        parsed.entries.slice(0, MAX_KEEP).forEach(function (e) { ids[e.id] = 1; });
        if (seenIds) Object.keys(seenIds).forEach(function (k) { ids[k] = 1; });
        save(feed.key, {ids: ids, entries: parsed.entries.slice(0, 12), title: parsed.title, link: parsed.link, at: Date.now()});
        done();
      } catch (e) {
        feed.error = clean(e && e.message ? e.message : e);
        feed.cached = old && old.entries ? old : null;
        done();
      }
    });
  }
  function render() {
    var ok = items.filter(function (f) { return f.entries; });
    var lines = [], totalNew = fresh.reduce(function (n, f) { return n + f.entries.length; }, 0);
    lines.push('订阅 ' + items.length + ' 个源' + (totalNew ? ' · ' + totalNew + ' 条新内容' : ' · 暂无新内容'));
    lines.push('');
    items.forEach(function (feed) {
      var show = feed.entries || (feed.cached && feed.cached.entries) || null;
      lines.push('━━━━━━━━━━━━');
      lines.push('📡 ' + (feed.title || feed.label) + (feed.error ? '  ⚠️' : '') + (feed.newCount ? '  🔴 ' + feed.newCount + ' 新' : ''));
      if (feed.error && !show) {
        lines.push('  获取失败：' + feed.error);
        return;
      }
      if (feed.error) lines.push('  ⚠️ 本次更新失败：' + feed.error + '（显示上次内容）');
      if (!show || !show.length) { lines.push('  暂无条目'); return; }
      show.slice(0, cfg.perFeed).forEach(function (e, i) {
        lines.push('  ' + (i + 1) + '. ' + e.title);
        var meta = [];
        if (e.date) meta.push(agoText(e.date));
        if (feed.newSet && feed.newSet[e.id]) meta.push('🆕 新');
        if (meta.length) lines.push('     ' + meta.join(' · '));
      });
    });
    lines.push('');
    lines.push('🔄 每 30 分钟刷新 · 首次只建立基线');
    var failed = items.filter(function (f) { return f.error; }).length;
    return {title: '📡 RSS 订阅 · ' + ok.length + '/' + items.length, content: lines.join('\n'),
      style: failed === items.length ? 'error' : (totalNew || failed ? 'alert' : 'good')};
  }
  function notify() {
    var isCron = typeof $script !== 'undefined' && $script.type === 'cron';
    if (!isCron || !cfg.notify || !fresh.length || typeof $notification === 'undefined') return;
    var total = fresh.reduce(function (n, f) { return n + f.entries.length; }, 0);
    var lines = [];
    fresh.slice(0, 4).forEach(function (f) {
      lines.push('📡 ' + (f.feed.title || f.feed.label) + ' · ' + f.entries.length + ' 条');
      f.entries.slice(0, 2).forEach(function (e) { lines.push('· ' + e.title); });
    });
    var first = fresh[0].entries[0];
    var payload = {sound: false, 'auto-dismiss': true};
    if (first && first.link) { payload.action = 'open-url'; payload.url = first.link; }
    $notification.post('RSS 有新内容', total + ' 条更新 · ' + fresh.length + ' 个源', lines.join('\n'), payload);
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
    if (!cfg.feeds.length) {
      if (typeof $script !== 'undefined' && $script.type === 'cron') $done(); else $done(card(false));
    } else {
      items = cfg.feeds;
      timer = setTimeout(finish, Math.max(1000, deadline - Date.now()));
      var next = 0, active = 0, complete = 0, limit = Math.min(3, items.length);
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
