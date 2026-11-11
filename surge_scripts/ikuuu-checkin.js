/**
 * iKuuu 自动签到（Surge 版 · cron / generic 两用）
 *
 * 移植自 Yjwj205/loon-modules 的 iKuuu 插件（Loon → Surge API 转换）
 *
 * 参数由模块参数表按竖线拼接：
 *   cookie  ｜ 手动 Cookie，留空则用自动抓取到的
 *   notify  ｜ 是否发系统通知，默认 true
 *   node    ｜ 指定策略组/节点名（如 Proxy、DIRECT），留空跟随规则
 *   enabled ｜ 定时签到开关，false 时 cron 触发直接退出
 *
 * 触发方式：
 *   type=cron     → 按 cronexp 定时签到
 *   面板刷新按钮 → $trigger=button，立即签到
 *   面板自动刷新 → $trigger=auto-interval，只显示上次结果，不发请求
 *
 * 流程：POST https://ikuuu.org/user/checkin → 解析 {ret,msg} → GET /user 读剩余流量
 */
(function () {
  "use strict";

  var HOST = "https://ikuuu.org";   // 会在解析参数后被实际站点覆盖
  var COOKIE_KEY = "ikuuu_org_cookie";
  var HOST_KEY = "ikuuu_site_host";
  var RESULT_KEY = "ikuuu_last_result";
  var MAX_ATTEMPTS = 3;
  var UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

  /* ---------- 参数 ---------- */

  function isOff(value) {
    var s = String(value === null || value === undefined ? "" : value).trim().toLowerCase();
    if (s === "") return false;
    return s === "0" || s === "false" || s === "off" || s === "no" ||
      s === "关" || s === "否" || s === "关闭";
  }

  function onByDefault(value) {
    var s = String(value === null || value === undefined ? "" : value).trim();
    if (s === "") return true;
    return !isOff(s);
  }

  // Surge 的模块参数必须有默认值，界面上的「-」代表留空
  function cleanEmpty(value) {
    var s = String(value === null || value === undefined ? "" : value).trim();
    return (s === "-" || s === "none" || s === "null") ? "" : s;
  }

  var rawArg = (typeof $argument === "string") ? $argument : "";
  var parts = rawArg.split("|");
  var manualCookie = cleanEmpty(parts[0])
    .replace(/^\s*cookie\s*:\s*/i, "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  var notifyEnabled = onByDefault(parts[1]);
  var requestNode = cleanEmpty(parts[2]);
  var cronEnabled = onByDefault(parts[3]);

  // 站点：参数指定 > 抓 Cookie 时记下的 > ikuuu.org，只允许 ikuuu 自家域名
  function normalizeHost(value) {
    var s = String(value === null || value === undefined ? "" : value).trim().toLowerCase();
    s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!s || s === "-" || s === "none" || s === "null") return "";
    return /^(?:[a-z0-9-]+\.)*ikuuu\.(?:org|pw|me)$/.test(s) ? s : "";
  }

  var siteArg = cleanEmpty(parts[4]);
  var savedHost = "";
  try {
    savedHost = String($persistentStore.read(HOST_KEY) || "").trim();
  } catch (e) {}
  var siteHost = normalizeHost(siteArg) || normalizeHost(savedHost) || "ikuuu.org";
  HOST = "https://" + siteHost;

  var trigger = (typeof $trigger === "string") ? $trigger : "";
  var cronRun = (typeof $cronexp === "string" && $cronexp !== "");

  if (cronRun && !cronEnabled) {
    console.log("[iKuuu] 定时签到已关闭，本次触发跳过");
    return $done();
  }

  var savedCookie = "";
  try {
    savedCookie = String($persistentStore.read(COOKIE_KEY) || "").trim();
  } catch (e) {
    console.log("[iKuuu] 读取本地 Cookie 失败：" + e);
  }

  var cookie = manualCookie || savedCookie;

  /* ---------- 面板 / 通知 ---------- */

  function clockText() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return (d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function finish(subtitle, content, style) {
    style = style || "info";
    var body = String(content === null || content === undefined ? "" : content);
    try {
      $persistentStore.write(
        JSON.stringify({ t: clockText(), s: subtitle, c: body, k: style }),
        RESULT_KEY
      );
    } catch (e) {}

    if (notifyEnabled) {
      try {
        $notification.post("iKuuu 签到", subtitle, body);
      } catch (e) {
        console.log("[iKuuu] 通知发送失败：" + e);
      }
    }
    console.log("[iKuuu] " + subtitle + " | " + body.replace(/\n/g, " / "));

    $done({
      title: "iKuuu 签到",
      content: "【" + subtitle + "】\n" + body + "\n\n" + clockText() + " · " + siteHost,
      style: style
    });
  }

  function showLast() {
    var raw = "";
    try {
      raw = String($persistentStore.read(RESULT_KEY) || "");
    } catch (e) {}
    if (!raw) {
      return $done({
        title: "iKuuu 签到",
        content: "还没有签到记录\n\n点右上角刷新按钮立即签到",
        style: "info"
      });
    }
    var o = {};
    try { o = JSON.parse(raw) || {}; } catch (e) {}
    $done({
      title: "iKuuu 签到",
      content: "【" + String(o.s || "-") + "】\n" + String(o.c || "") +
        "\n\n" + String(o.t || "") + " · " + siteHost + "\n点右上角刷新按钮立即签到",
      style: String(o.k || "info")
    });
  }

  if (trigger === "auto-interval" && !cronRun) return showLast();

  /* ---------- 请求 ---------- */

  function requestOptions(url, headers, useNode) {
    var options = {
      url: url,
      timeout: 15,
      insecure: true,
      "auto-cookie": false,
      headers: headers
    };
    if (useNode && requestNode) options.policy = requestNode;
    return options;
  }

  /* ---------- Base64 / UTF-8（站点页面把正文 base64 塞在 var originBody 里） ---------- */

  var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function utf8Decode(bytes) {
    var out = "", i = 0;
    while (i < bytes.length) {
      var b = bytes[i++];
      if (b < 0x80) {
        out += String.fromCharCode(b);
      } else if (b >= 0xC0 && b < 0xE0) {
        out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F));
      } else if (b >= 0xE0 && b < 0xF0) {
        out += String.fromCharCode(((b & 0x0F) << 12) |
          ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
      } else {
        var cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12) |
          ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F);
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      }
    }
    return out;
  }

  function base64Decode(str) {
    str = String(str).replace(/[^A-Za-z0-9+/=]/g, "");
    var bytes = [], buf = 0, bits = 0, i, v;
    for (i = 0; i < str.length; i++) {
      if (str.charAt(i) === "=") break;
      v = B64_CHARS.indexOf(str.charAt(i));
      if (v < 0) continue;
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buf >> bits) & 0xFF);
      }
    }
    return utf8Decode(bytes);
  }

  function extractHtml(data) {
    var text = String(data || "");
    var m = text.match(/var\s+originBody\s*=\s*["']([^"']+)["']/);
    if (!m) return text;
    try {
      return base64Decode(m[1]);
    } catch (e) {
      return text;
    }
  }

  function pick(html, label) {
    var re = new RegExp(
      label + "[\\s\\S]{0,400}?<span[^>]*class=\"[^\"]*counter[^\"]*\"[^>]*>" +
      "\\s*([\\d.]+)\\s*<\\/span>\\s*([KMGTP]?B)", "i");
    var m = html.match(re);
    if (m) return m[1] + " " + m[2].toUpperCase();
    var plain = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    var m2 = plain.match(new RegExp(label + "\\s*[:：]?\\s*([\\d.]+)\\s*([KMGTP]?B)", "i"));
    return m2 ? m2[1] + " " + m2[2].toUpperCase() : null;
  }

  /* ---------- 签到后读剩余流量（失败不影响签到结论） ---------- */

  function fetchTraffic(callback, attempt) {
    attempt = attempt || 1;
    var options = requestOptions(HOST + "/user", {
      "Cookie": cookie,
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": HOST + "/user"
    }, attempt === 1);

    $httpClient.get(options, function (error, response, data) {
      if (error && attempt < 2) {
        return setTimeout(function () {
          fetchTraffic(callback, attempt + 1);
        }, 1000);
      }
      if (error || !data) return callback(null);
      try {
        var html = extractHtml(data);
        var rest = pick(html, "剩余流量");
        callback(rest ? "剩余流量：" + rest : null);
      } catch (e) {
        console.log("[iKuuu] 解析流量失败：" + e);
        callback(null);
      }
    });
  }

  /* ---------- 主流程 ---------- */

  function handleCheckin(error, response, data, attempts) {
    if (error) {
      var errText = String(error);
      if (/certificate|SSL|TLS/i.test(errText)) {
        return finish("TLS 校验失败", [
          "签到请求连续 " + attempts + " 次没通过证书校验（insecure 已开启）。",
          "① 在模块参数「请求节点」里指定一个节点/策略组，排除线路证书问题；",
          "② 检查 Surge 的 MITM 证书是否已安装并信任；",
          "③ 不需要自动抓 Cookie 的话，到模块里删掉 [MITM] 段、改用手动 Cookie。",
          "",
          errText.slice(0, 160)
        ].join("\n"), "error");
      }
      return finish("请求失败", "签到接口请求出错（已试 " + attempts + " 次）：" + errText, "error");
    }

    var status = (response && response.status) ? response.status : 0;
    var text = String(data === null || data === undefined ? "" : data).trim();
    var json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {}

    if (!json || typeof json !== "object") {
      if (status === 302 || /<html|<script/i.test(text)) {
        return finish("Cookie 已失效",
          "服务器返回的是登录页，请在 Safari 重新登录 https://" + siteHost + "（模块会自动更新 Cookie）。", "alert");
      }
      return finish("签到失败",
        "返回内容无法解析（HTTP " + status + "）：" + text.slice(0, 120), "error");
    }

    var ret = Number(json.ret);
    var msg = String(json.msg || "").trim() || "服务器没有返回说明";
    var already = /已经?签到|重复签到|签到过了|明天再来/.test(msg);
    var subtitle, style;
    if (ret === 1) {
      subtitle = "签到成功";
      style = "good";
    } else if (already) {
      subtitle = "今日已签到";
      style = "info";
    } else if (/未登录|登录.*(?:失效|过期)|请重新登录|请先登录/.test(msg)) {
      subtitle = "Cookie 已失效";
      style = "alert";
    } else {
      subtitle = "签到失败";
      style = "error";
    }

    fetchTraffic(function (traffic) {
      var content = msg;
      if (traffic) content += "\n" + traffic;
      finish(subtitle, content, style);
    });
  }

  function attemptCheckin(attempt) {
    var options = requestOptions(HOST + "/user/checkin", {
      "Cookie": cookie,
      "User-Agent": UA,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": HOST + "/user",
      "Origin": HOST,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    }, attempt === 1);

    $httpClient.post(options, function (error, response, data) {
      if (error && attempt < MAX_ATTEMPTS) {
        console.log("[iKuuu] 第 " + attempt + " 次请求失败：" + error + "，1.5 秒后重试");
        return setTimeout(function () {
          attemptCheckin(attempt + 1);
        }, 1500);
      }
      handleCheckin(error, response, data, attempt);
    });
  }

  if (!cookie) {
    return finish("没有 Cookie", [
      "还没拿到登录 Cookie。",
      "① 让模块的「抓取 Cookie」保持 true，在 Safari 打开 https://" + siteHost + " 登录一次；",
      "② 或在模块参数的「Cookie」里手动粘贴。"
    ].join("\n"), "alert");
  }

  attemptCheckin(1);
})();
