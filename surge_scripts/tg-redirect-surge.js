/*
 * ============================================================
 * Telegram 外链跳转 —— Surge 版
 * ------------------------------------------------------------
 * 原脚本：dcpengx/Loon JavaScript/tg-redirect.js
 * 转换要点：
 *   1. Loon 的 $argument 是对象（[{jump}] 数组传参），
 *      Surge 的 $argument 是字符串 "jump=sg"，必须自行解析；
 *   2. 原脚本 if 分支缺少 return，参数为空时仍会往下执行；
 *   3. Surge 用 URL Rewrite 的 307 即可完成跳转，
 *      本脚本作为备选方案（需要按参数动态切换目标 scheme 时使用）。
 * ============================================================
 */

(function () {
  /* ---------- 解析 Surge 的 argument 字符串 ---------- */
  function cyParseArgument(raw) {
    var out = {};
    if (raw === null || raw === undefined) return out;
    if (typeof raw === 'object') {
      for (var k in raw) {
        if (Object.prototype.hasOwnProperty.call(raw, k)) out[k] = raw[k];
      }
      return out;
    }
    String(raw).split('&').forEach(function (pair) {
      if (!pair) return;
      var idx = pair.indexOf('=');
      var key = idx === -1 ? pair : pair.slice(0, idx);
      var val = idx === -1 ? '' : pair.slice(idx + 1);
      if (!key) return;
      try { val = decodeURIComponent(val); } catch (e) { /* 保留原值 */ }
      out[key.trim()] = val;
    });
    return out;
  }

  /* ---------- 目标 scheme 白名单，防止拼出异常 URL ---------- */
  var ALLOWED = {
    sg: 'sg',
    swiftgram: 'sg',
    turrit: 'turrit'
  };

  var args = cyParseArgument(typeof $argument !== 'undefined' ? $argument : '');
  var raw = String(args.jump || 'sg').toLowerCase().trim();
  var scheme = ALLOWED[raw];

  /* 非法参数：原样放行 */
  if (!scheme) {
    $done({});
    return;
  }

  var url = String(($request && $request.url) || '');
  var match = url.match(/(?:https?:\/\/)?t\.me\/([^\/?#]+)/);

  /* 不匹配或没有域名可跳：原样放行 */
  if (!match || !match[1]) {
    $done({});
    return;
  }

  var domain = match[1];
  /* 已编码的域名先解一次，再统一编码，避免 %25 双重转义 */
  try { domain = decodeURIComponent(domain); } catch (e) { /* 保留原值 */ }
  var target = scheme + '://resolve?domain=' + encodeURIComponent(domain);

  $done({
    response: {
      status: 302,
      headers: { Location: target }
    }
  });
})();
