// IP 纯净度 v1.1.0 — Surge generic panel
// Source: https://api.ipquery.io/?format=json (no API key).
// argument: AUTO (FINAL policy), RULE (normal routing), DIRECT, or an exact policy name.
(function () {
  'use strict';
  var finished = false;
  var target = typeof $argument === 'string' ? $argument.trim() : '';
  var label = target || 'AUTO';
  var policy = null;          // null = follow normal rules; '' = DIRECT is passed as a name
  var started = Date.now();
  var CACHE_KEY = 'ipPurityLastGood';

  function finish(title, lines, color) {
    if (finished) return;
    finished = true;
    $done({title: title, content: lines.join('\n'), style: 'info',
      icon: 'checkmark.shield', 'icon-color': color || '#8E8E93'});
  }
  function fail(reason) {
    finish('IP 纯净度 · 查询失败', ['策略：' + label, reason,
      '本次未取得风险结论，请稍后点击刷新。'], '#FF9500');
  }
  function clean(value) {
    if (value === null || value === undefined || value === '') return '未知';
    return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, 180);
  }
  // Boolean fact: true/false is meaningful here.
  function tri(value) { return value === true ? '是' : value === false ? '否' : '未知'; }
  // Classification hit: false only means "not matched in the provider database".
  function flag(value) { return value === true ? '匹配' : value === false ? '未匹配' : '未知'; }
  function validIP(ip) {
    if (typeof ip !== 'string') return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      return ip.split('.').every(function (part) { return Number(part) <= 255; });
    }
    return ip.indexOf(':') >= 0 && /^[0-9a-fA-F:.]+$/.test(ip) && ip.length <= 45;
  }
  function cacheWrite(policyName, data) {
    try {
      $persistentStore.write(JSON.stringify({t: Date.now(), policy: policyName || 'RULE', data: data}), CACHE_KEY);
    } catch (_) {}
  }
  function cacheRead(policyName) {
    try {
      var raw = $persistentStore.read(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.data || !validIP(obj.data.ip)) return null;
      if (String(obj.policy || '') !== String(policyName || 'RULE')) return null;
      if (!(obj.t > 0)) return null;
      return obj;
    } catch (_) { return null; }
  }
  function show(data, staleMs, reason) {
    var risk = data.risk || {};
    var keys = ['is_proxy', 'is_vpn', 'is_tor', 'is_datacenter'];
    var labels = ['代理', 'VPN', 'Tor', '机房'];
    var hits = [], missing = [];
    keys.forEach(function (key, index) {
      if (risk[key] === true) hits.push(labels[index]);
      else if (risk[key] !== false) missing.push(labels[index]);
    });
    var score = risk.risk_score;
    var scoreOK = typeof score === 'number' && isFinite(score) && score >= 0 && score <= 100;
    if (!scoreOK) missing.push('风险分');
    var verdict, color;
    if (missing.length) {
      verdict = '数据不完整'; color = '#8E8E93';
    } else if (hits.length) {
      verdict = '标签：' + hits.join(' / '); color = '#FF9500';
    } else if (score > 0) {
      verdict = '风险分 ' + score; color = '#FF9500';
    } else {
      verdict = '未命中风险标签'; color = '#34C759';
    }
    if (staleMs > 0) { verdict = '上次结果'; color = '#8E8E93'; }
    var loc = data.location || {}, isp = data.isp || {};
    var place = [loc.country_code, loc.state, loc.city]
      .filter(function (v, i, a) { return !!v && a.indexOf(v) === i; }).join(' · ');
    var lines = ['策略：' + label, '出口 IP：' + data.ip,
      '位置：' + (place || '未知'), 'ASN：' + clean(isp.asn) + ' · ' + clean(isp.org),
      '运营商：' + clean(isp.isp),
      'IPQuery 风险分：' + (scoreOK ? score + '/100（越低越好）' : '未知'),
      '机房：' + tri(risk.is_datacenter) + '   移动网络：' + tri(risk.is_mobile),
      '代理：' + flag(risk.is_proxy) + '   VPN：' + flag(risk.is_vpn) + '   Tor：' + flag(risk.is_tor)];
    if (missing.length) lines.push('缺失字段：' + missing.join('、'));
    if (staleMs > 0) {
      lines.push('本次失败：' + reason + '；上为 ' + Math.round(staleMs / 60000) + ' 分钟前结果。');
    }
    lines.push('来源：IPQuery · 风险分为 0–100 策略分');
    lines.push('未匹配/0 分均非安全保证，机房不加分。');
    lines.push('更新：' + new Date().toLocaleTimeString() + ' · ' + ((Date.now() - started) / 1000).toFixed(1) + 's');
    finish('IP 纯净度 · ' + verdict, lines, color);
  }
  function fallback(reason) {
    var hit = cacheRead(policy);
    var age = hit ? Date.now() - hit.t : 0;
    if (hit && age < 86400000) { show(hit.data, age, reason); return; }
    fail(reason);
  }
  function query(attempt) {
    if (finished) return;
    var options = {url: 'https://api.ipquery.io/?format=json', timeout: 10,
      headers: {'Accept': 'application/json'}, 'auto-redirect': false, 'auto-cookie': false};
    if (policy) options.policy = policy;
    try {
      $httpClient.get(options, function (error, response, body) {
        if (finished) return;
        var status = Number(response && (response.status || response.statusCode));
        var retriable = !!error || !status || status >= 500;
        if (retriable && attempt < 1) { setTimeout(function () { query(attempt + 1); }, 700); return; }
        if (error) return fallback('连接失败，请检查策略与接口可达性');
        if (status === 429) return fallback('接口限流（HTTP 429）');
        if (status !== 200) return fallback('接口异常（HTTP ' + (status || '未知') + '）');
        var data;
        try { data = JSON.parse(body); } catch (_) { return fallback('接口响应不是有效 JSON'); }
        if (!data || data.error || !validIP(data.ip)) return fallback('接口未返回有效 IP');
        cacheWrite(policy, data);
        show(data, 0, '');
      });
    } catch (_) { fail('请求未能启动，请检查 Surge 脚本设置。'); }
  }
  setTimeout(function () { fail('检测超时。'); }, 18000);
  function resolve() {
    if (finished) return;
    var upper = label.toUpperCase();
    if (upper === 'RULE') { query(0); return; }
    if (upper === 'AUTO') {
      try {
        $httpAPI('GET', '/v1/rules', null, function (result) {
          if (finished) return;
          var rules = result && result.rules;
          if (!Array.isArray(rules)) return fail('无法读取 FINAL，请在模块参数填写策略组名。');
          for (var i = rules.length - 1; i >= 0; i--) {
            var match = /^\s*FINAL\s*,\s*([^,]+)/i.exec(String(rules[i]));
            if (match) {
              var found = match[1].trim();
              if (!found) break;
              policy = found;
              label = found + '（FINAL）';
              return query(0);
            }
          }
          fail('未找到 FINAL，请在模块参数填写策略组名。');
        });
      } catch (_) { fail('无法读取规则，请在模块参数填写策略组名。'); }
      return;
    }
    policy = label;   // exact policy name, including DIRECT
    query(0);
  }
  resolve();
}());
