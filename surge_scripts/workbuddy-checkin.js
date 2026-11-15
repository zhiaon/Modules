(function () {
  "use strict";
  var RESULT_KEY = "workbuddy_surge_last_checkin_v1";
  var p = (typeof $argument === "string" ? $argument : "").split("|");
  function clean(v) { v = String(v || "").trim(); return v === "-" ? "" : v; }
  var KEY = clean(p[3]);
  var BASE = clean(p[4]).replace(/\/+$/, "");
  var schedule = clean(p[5]) || "0 9 * * *";
  if (!/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(BASE) || !KEY) {
    return $done({title: "WorkBuddy 积分", content: "请在模块参数填写服务器接口地址与专用密钥。手机号支持逗号分隔；需先在服务器登录账号。", style: "error"});
  }
  var cronEnabled = String(p[0] || "true").toLowerCase() !== "false";
  var notify = String(p[1] || "true").toLowerCase() !== "false";
  var phones = [];
  String(p[2] || "").split(/[,，、;\s]+/).forEach(function (raw) {
    var d = String(raw || "").replace(/[^0-9]/g, "");
    if (/^1\d{10}$/.test(d) && phones.indexOf(d) < 0 && phones.length < 20) phones.push(d);
  });
  var isCron = (typeof $script !== "undefined" && $script.type === "cron") || (typeof $cronexp === "string" && $cronexp.length > 0);
  var trigger = typeof $trigger === "string" ? $trigger : "";
  var headers = { "Content-Type": "application/json", "Accept": "application/json" };

  function clock() {
    var d = new Date();
    return (d.getMonth()+1) + "-" + d.getDate() + " " +
      ("0"+d.getHours()).slice(-2) + ":" + ("0"+d.getMinutes()).slice(-2);
  }
  function save(summary) {
    try { $persistentStore.write(JSON.stringify({ summary: summary, at: clock() }), RESULT_KEY); } catch (_) {}
  }
  function lastText() {
    try {
      var o = JSON.parse($persistentStore.read(RESULT_KEY) || "{}");
      return o.summary ? "上次签到：" + o.summary + "（" + (o.at || "") + "）\n\n" : "";
    } catch (_) { return ""; }
  }
  function fmtTime(s) {
    if (!s) return "未知";
    var d = new Date(s);
    return isNaN(d.getTime()) ? String(s) :
      (d.getMonth()+1) + "-" + d.getDate() + " " +
      ("0"+d.getHours()).slice(-2) + ":" + ("0"+d.getMinutes()).slice(-2);
  }
  function reply(text, style) {
    $done({ title: "WorkBuddy 积分", content: text, style: style || "info" });
  }
  function showBalance(prefix) {
    var body = { key: KEY };
    if (phones.length) body.phones = phones;
    $httpClient.post({
      url: BASE + "/balance", headers: headers, body: JSON.stringify(body),
      timeout: 15, policy: "DIRECT", "auto-cookie": false
    }, function (err, resp, raw) {
      if (err || !resp || resp.status < 200 || resp.status >= 300) {
        reply((prefix || lastText()) + "余额读取失败：" + (err || (resp && resp.status) || "网络错误"), "error");
        return;
      }
      var d;
      try { d = JSON.parse(raw || "{}"); } catch (_) { d = null; }
      if (!d || !d.ok) {
        reply((prefix || lastText()) + ((d && d.summary) || "未找到对应账号") +
          (phones.length ? "" : "\n请先在模块参数填写手机号"), "error");
        return;
      }
      var lines = (d.accounts || []).map(function (a, idx) {
        return "账号" + (idx + 1) + " " + (a.name || "") + "：" +
          Number(a.remain || 0).toLocaleString() + " / " + Number(a.total || 0).toLocaleString();
      });
      var missing = (d.missing || []).length ? "\n未匹配：" + d.missing.join("、") : "";
      reply((prefix || lastText()) + lines.join("\n") + missing +
        "\n合计剩余：" + Number(d.sum_remain || 0).toLocaleString() +
        "\n余额同步：" + fmtTime((d.accounts && d.accounts[0] && d.accounts[0].synced_at)) +
        "\n\n刷新按钮立即签到；计划：" + schedule, "info");
    });
  }
  function doCheckin() {
    $httpClient.post({
      url: BASE + "/checkin", headers: headers, body: JSON.stringify({ key: KEY }),
      timeout: 35, policy: "DIRECT", "auto-cookie": false
    }, function (err, resp, body) {
      if (err || !resp || resp.status < 200 || resp.status >= 300) {
        var f = "签到请求失败：" + (err || (resp && resp.status) || "网络错误");
        save(f); if (notify && isCron) $notification.post("WorkBuddy 签到", "未完成", f);
        showBalance(f + "\n\n");
        return;
      }
      var d;
      try { d = JSON.parse(body || "{}"); } catch (_) { d = null; }
      if (!d) { save("签到响应解析失败"); showBalance("签到响应解析失败\n\n"); return; }
      var summary = d.summary || ("已领取 " + (d.claimed || 0) + " 个账号，新增 " + (d.credit || 0) + " 积分");
      save(summary);
      if (notify && isCron) $notification.post("WorkBuddy 签到", d.ok === false || d.failed > 0 ? "未完成" : "签到完成", summary);
      showBalance(summary + "\n\n");
    });
  }

  if (isCron) {
    if (!cronEnabled) return $done();
    doCheckin();
  } else if (trigger === "button") {
    doCheckin();
  } else {
    showBalance(lastText());
  }
})();
