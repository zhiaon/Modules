/* Surge Dual IP v1.1.0 — HTTPS only, explicit per-request policy. */
(function () {
  "use strict";
  var policy = typeof $argument === "string" && $argument.trim() ? $argument.trim() : "Proxy";
  var started = Date.now(), finished = false, count = 0;
  var lanes = [{ policy: "DIRECT" }, { policy: policy }];
  var providers = [
    { name: "ipwho.is", url: "https://ipwho.is/" },
    { name: "api.ip.sb", url: "https://api.ip.sb/geoip" }
  ];
  function clean(value) { return String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").trim(); }
  function validIP(ip) {
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return ip.split(".").every(function (s) { return Number(s) <= 255; });
    return ip.indexOf(":") >= 0 && /^[0-9a-f:]+$/i.test(ip);
  }
  function parse(data, provider) {
    var d = JSON.parse(data);
    if (d.success === false || d.error) throw new Error(clean(d.message || d.reason || "接口拒绝查询"));
    var ip = clean(d.ip);
    if (!validIP(ip)) throw new Error("响应缺少有效 IP");
    var country = clean(d.country_code).toUpperCase();
    var connection = d.connection || {};
    var org = clean(connection.org || d.organization || connection.isp || d.isp);
    var isp = clean(connection.isp || d.isp);
    var asn = clean(connection.asn || d.asn).replace(/^AS/i, "");
    var region = clean(d.region), city = clean(d.city);
    var place = [country.toLowerCase(), region, city].filter(function (v, i, a) { return v && a.indexOf(v) === i; }).join(" · ");
    var timezone = typeof d.timezone === "object" && d.timezone ? clean(d.timezone.id) : clean(d.timezone);
    return { ip: ip, country: country, location: place || "未提供", operator: org || "未提供", isp: isp, asn: asn ? "AS" + asn : "未提供", family: ip.indexOf(":") >= 0 ? "IPv6" : "IPv4", timezone: timezone, provider: provider };
  }
  function line(lane, index) {
    var label = index === 0 ? "直连出口" : "代理出口";
    if (!lane.result) return "● " + label + " · 查询失败\n策略：" + lane.policy + "\n原因：" + clean(lane.errors.join("；"));
    var r = lane.result;
    var lines = ["● " + label + " · " + r.family,
      "策略：" + lane.policy,
      "IP：" + r.ip,
      "地区：" + r.location,
      "运营商 / 组织：" + r.operator];
    lines.push("自治系统：" + r.asn);
    if (r.timezone) lines.push("时区：" + r.timezone);
    lines.push("查询：" + r.provider + " · " + lane.elapsedMs + " ms" + (lane.errors.length ? " · 已用备用接口" : ""));
    return lines.join("\n");
  }
  function complete() {
    if (finished) return;
    finished = true;
    var ok = lanes.filter(function (lane) { return !!lane.result; }).length;
    var now = new Date();
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    var time = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
    // Do not log full IP addresses; they are returned only in the panel result.
    console.log("DualIP " + JSON.stringify({ policy: policy, success: ok, elapsedMs: Date.now() - started, providers: lanes.map(function (l) { return l.result ? l.result.provider : null; }) }));
    var summary = "成功 " + ok + "/2";
    if (ok === 2) summary += lanes[0].result.ip === lanes[1].result.ip ? " · 两路返回相同 IP" : " · 两路返回不同 IP";
    var date = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    $done({ title: "双出口 IP · 详细", content: lanes.map(line).join("\n\n") + "\n\n" + summary + "\n更新：" + date + " " + time + "\n总耗时：" + ((Date.now() - started) / 1000).toFixed(2) + " 秒\n地区为 IP 数据库标注；耗时为接口查询时间", style: ok === 2 ? "good" : ok === 1 ? "alert" : "error" });
  }
  function settle(lane) {
    if (finished || lane.settled) return;
    lane.settled = true;
    lane.elapsedMs = Date.now() - started;
    count += 1;
    if (count === lanes.length) complete();
  }
  function query(lane, index) {
    if (finished || lane.settled) return;
    if (index >= providers.length) { settle(lane); return; }
    var source = providers[index], called = false;
    function receive(error, response, body) {
      if (called || finished || lane.settled) return;
      called = true;
      try {
        if (error) throw new Error(clean(error));
        if (!response || Number(response.status) !== 200) throw new Error("HTTP " + (response ? response.status : "无响应"));
        lane.result = parse(body, source.name);
        settle(lane);
      } catch (e) {
        lane.errors.push(source.name + ": " + clean(e.message || e).slice(0, 160));
        query(lane, index + 1);
      }
    }
    try {
      $httpClient.get({ url: source.url, policy: lane.policy, timeout: 5, headers: { Accept: "application/json", "User-Agent": "Surge-Dual-IP/1.0" }, "auto-redirect": false, "auto-cookie": false }, receive);
    } catch (e) { receive(e, null, null); }
  }
  if (!policy || /[\r\n\x00]/.test(policy)) {
    $done({ title: "双出口 IP", content: "代理策略组参数无效", style: "error" });
    return;
  }
  lanes.forEach(function (lane) { lane.errors = []; });
  setTimeout(function () {
    if (finished) return;
    lanes.forEach(function (lane) { if (!lane.settled) lane.errors.push("总等待超过 12 秒"); });
    complete();
  }, 12000);
  // Both lanes start before either callback finishes. Fallback keeps the same explicit policy.
  lanes.forEach(function (lane) { query(lane, 0); });
}());
