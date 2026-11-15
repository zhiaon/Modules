// Surge 运行时长 v1.0
// 记录：type=event(engine-started / profile-reloaded) → 写启动/重载时间戳
// 展示：type=generic（面板） → 用启动时间戳计算已运行时长

var K_START   = "surge_uptime_start";
var K_APPROX  = "surge_uptime_approx";
var K_VERSION = "surge_uptime_version";
var K_RCOUNT  = "surge_uptime_reload_count";
var K_RLAST   = "surge_uptime_reload_last";

function str(v) { return (v === null || typeof v === "undefined") ? "" : String(v); }
function read(k) { try { return $persistentStore.read(k); } catch (e) { return null; } }
function write(v, k) { try { $persistentStore.write(v, k); } catch (e) {} }

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  var d = Math.floor(sec / 86400);
  var h = Math.floor((sec % 86400) / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  if (d > 0) return d + " 天 " + h + " 小时 " + m + " 分";
  if (h > 0) return h + " 小时 " + m + " 分";
  if (m > 0) return m + " 分 " + s + " 秒";
  return s + " 秒";
}

function pad(n) { return (n < 10 ? "0" : "") + n; }

function ts(t) {
  var d = new Date(t * 1000);
  return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
         pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function short(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return "刚刚";
  if (sec < 3600) return Math.floor(sec / 60) + " 分钟前";
  if (sec < 86400) return Math.floor(sec / 3600) + " 小时前";
  return Math.floor(sec / 86400) + " 天前";
}

function engineVersion() {
  try {
    return str($environment["surge-version"]) + " (" + str($environment["surge-build"]) + ")";
  } catch (e) { return ""; }
}

// 当前运行模式
function pickMode() {
  var a = str(typeof $argument !== "undefined" ? $argument : "").trim();
  if (a === "record" || a === "panel") return a;
  if (typeof $event !== "undefined" && $event && $event.name) return "record";
  if (typeof $input !== "undefined" && $input) return "panel";
  return "panel";
}

// ---- 记录分支：引擎启动 / 配置重载 ----
function doRecord() {
  var now = Math.floor(Date.now() / 1000);
  var name = (typeof $event !== "undefined" && $event && $event.name) ? String($event.name) : "";

  if (name === "profile-reloaded") {
    var c = parseInt(str(read(K_RCOUNT)) || "0", 10);
    if (isNaN(c)) c = 0;
    write(String(c + 1), K_RCOUNT);
    write(String(now), K_RLAST);
  } else {
    // engine-started（或手动触发，同样按"新起点"处理）
    write(String(now), K_START);
    write("0", K_APPROX);
    write(engineVersion(), K_VERSION);
    write("0", K_RCOUNT);
    write(null, K_RLAST);
  }
  return now;
}

// ---- 面板分支 ----
function doPanel() {
  var now = Math.floor(Date.now() / 1000);
  var start = parseInt(str(read(K_START)) || "0", 10);
  if (isNaN(start)) start = 0;
  var approx = str(read(K_APPROX)) === "1";
  var ver = str(read(K_VERSION));
  var rc = parseInt(str(read(K_RCOUNT)) || "0", 10);
  if (isNaN(rc)) rc = 0;
  var rlast = parseInt(str(read(K_RLAST)) || "0", 10);
  if (isNaN(rlast)) rlast = 0;

  var lines = [];

  if (!start || start <= 0) {
    // 首次安装：先把当前时刻记为起点，并标注为近似
    start = now;
    approx = true;
    write(String(now), K_START);
    write("1", K_APPROX);
  }

  if (start > now) start = now; // 系统时间回拨
  var up = now - start;

  lines.push("已运行 " + fmt(up));
  lines.push("启动于 " + ts(start) + (approx ? "（首次运行，起点为近似值）" : ""));

  if (rc > 0 || rlast > 0) {
    lines.push("");
    lines.push("配置重载 " + rc + " 次");
    if (rlast > 0) lines.push("最近重载 " + ts(rlast) + "（" + short(now - rlast) + "）");
  }

  var v = ver || engineVersion();
  if (v) {
    lines.push("");
    lines.push("Surge " + v);
  }

  lines.push("");
  lines.push("上次刷新 " + ts(now) + " · 每分钟自动更新");

  return {
    title: "Surge 运行时长",
    content: lines.join("\n"),
    style: "info"
  };
}

var mode = pickMode();
if (mode === "record") {
  doRecord();
  $done();
} else {
  $done(doPanel());
}
