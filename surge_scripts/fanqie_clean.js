// Fanqie ad cleaner for Surge
(function () {
  function done(body) { $done({ body: body }); }
  function safeParse(raw) {
    if (!raw) return null;
    var s = raw;
    var t = s.trim();
    if (!t) return null;
    var m = t.match(/^[A-Za-z_][\w$]*\(([\s\S]*)\);?$/);
    if (m) t = m[1];
    try { return { json: JSON.parse(t), prefix: m ? s.slice(0, s.indexOf('(') + 1) : '', suffix: m ? s.slice(s.lastIndexOf(')')) : '' }; }
    catch (e) { return null; }
  }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function low(s) { return String(s || '').toLowerCase(); }
  function hasAdText(s) {
    return /(广告|推广|赞助|立即下载|下载应用|应用下载|下载安装|点击下载|看视频免广告|免广告|领金币|金币|红包|福利|赚钱|提现|京东|京东金融|黄金新用户|金融|借钱|贷款|信用卡)/.test(String(s || ''));
  }
  function isAdSignal(k, v) {
    var key = low(k);
    var val = low(v);
    return /(^|[_\-])(ad|ads|advert|banner|promo|promotion|sponsor|sponsored|commercial|topview|splash|reward|coin|videoad|feedad|insertad|interstitial|float|popup|drawer|card)([_\-]|$)/.test(key)
      || /(^|[_\-])(jdjr|kepler|jzt|360buy|jd\.com|pangolin|gromore|mssdk|applog|mon|toblog|aweme|toutiao|snssdk|zijieapi)([_\-]|$)/.test(key)
      || /(button|btn|download|install|landing|open_url|schema|web_url|app_name|package|creative|material|advertiser|source|track|log_extra|show_url|click_url|play_url|video_url)/.test(key)
      || /(^|[_\-])(ad|banner|promo|sponsor|commercial|topview|splash|reward|coin|jdjr|kepler|jzt|360buy|jd\.com|jdmall|shop|view|detail|download|video|card|popup|float)([_\-]|$)/.test(val)
      || /\b(jdjr|kepler|jzt|360buyimg|360buy|jd\.com|pangolin|gromore|snssdk|zijieapi|pglstatp|pstatp|aweme|toutiao|mssdk|bytead|adunion)\b/.test(val)
      || (hasAdText(val) && /(button|btn|download|install|landing|open|schema|app|title|desc|text|label|source)/.test(key));
  }
  function isPureAdObject(obj) {
    if (!isObj(obj)) return false;
    var keys = Object.keys(obj);
    if (keys.length === 0) return false;
    var score = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = obj[k];
      if (isAdSignal(k, v)) score += 2;
      if (/^(ad|ads|banner|promo|sponsor|reward|coin|topview|splash|popup|card|float|video|jump|download|detail|goods|product|shop|install|app)/i.test(k)) score += 1;
      if (typeof v === 'string' && /(下载|安装|立即下载|去广告|看视频免广告|领金币|金币|红包|下载应用|应用下载|金融|推广|广告|赞助)/.test(v)) score += 1;
    }
    return score >= 2;
  }
  function clean(node, parentKey) {
    if (Array.isArray(node)) {
      var arr = [];
      for (var i = 0; i < node.length; i++) {
        var item = clean(node[i], parentKey);
        if (item !== undefined) {
          if (Array.isArray(item) && item.length === 0) continue;
          if (isObj(item) && Object.keys(item).length === 0) continue;
          arr.push(item);
        }
      }
      return arr;
    }
    if (isObj(node)) {
      if (parentKey && isPureAdObject(node)) return undefined;
      var out = {};
      var keys = Object.keys(node);
      for (var j = 0; j < keys.length; j++) {
        var k = keys[j];
        var v = node[k];
        if (isAdSignal(k, v) || isPureAdObject(v)) continue;
        var c = clean(v, k);
        if (c === undefined) continue;
        if (Array.isArray(c) && c.length === 0) continue;
        if (isObj(c) && Object.keys(c).length === 0) continue;
        out[k] = c;
      }
      return out;
    }
    if (typeof node === 'string') {
      if (isAdSignal(parentKey || '', node)) return undefined;
      return node;
    }
    return node;
  }
  try {
    var raw = ($response && $response.body) ? $response.body : '';
    if (!raw) return done(raw);
    var ct = '';
    try { ct = (($response.headers && ($response.headers['Content-Type'] || $response.headers['content-type'])) || '').toLowerCase(); } catch (e) {}
    // 番茄部分接口会把 JSON 伪装成 application/octet-stream，所以先尝试解析；解析失败再原样放行。
    var parsed = safeParse(raw);
    if (!parsed) return done(raw);
    var obj = clean(parsed.json, '');
    if (obj === undefined) obj = {};
    var body = JSON.stringify(obj);
    if (parsed.prefix) body = parsed.prefix + body + parsed.suffix;
    return done(body);
  } catch (e) {
    return done(($response && $response.body) || '');
  }
})();
