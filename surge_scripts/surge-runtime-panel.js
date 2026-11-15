// Surge 运行监控 V1.2 — 单卡运行时长、内存与手动重启
if ((typeof $argument !== 'undefined' && $argument === 'record') || (typeof $event !== 'undefined' && $event && ($event.name === 'engine-started' || $event.name === 'profile-reloaded'))) {
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

} else {
// Surge 内存监控与重启 V1.0
// Requires HTTP API MCP enabled (Surge iOS 6+).
// Auto/cron/editor/API runs only monitor. Two genuine panel button presses
// within 20 seconds restart the engine and drop existing connections.
(function () {
  'use strict';
  var KEY = 'surge_memory_monitor_v1';
  var now = Date.now() / 1000;
  var button = typeof $trigger !== 'undefined' && $trigger === 'button';
  var state = {};
  try { state = JSON.parse($persistentStore.read(KEY) || '{}'); } catch (_) {}
  function save() { return $persistentStore.write(JSON.stringify(state), KEY); }
  function mib(n) { return (n / 1048576).toFixed(1) + ' MiB'; }
  function clock(t) {
    var d = new Date(t * 1000);
    return [d.getHours(),d.getMinutes(),d.getSeconds()].map(function(n){return ('0'+n).slice(-2);}).join(':');
  }
  function duration(sec) {
    sec = Math.max(0, Math.floor(sec));
    var d = Math.floor(sec / 86400);
    var h = Math.floor((sec % 86400) / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (d > 0) return d + ' 天 ' + h + ' 小时 ' + m + ' 分';
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    if (m > 0) return m + ' 分 ' + s + ' 秒';
    return s + ' 秒';
  }
  function stamp(t) {
    var d = new Date(t * 1000);
    function p(n) { return ('0' + n).slice(-2); }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function store(k) {
    try { return $persistentStore.read(k); } catch (_) { return null; }
  }
  function finish(text, bad) {
    $done({title:'Surge 运行监控',content:text,style:bad?'error':'info'});
  }
  function rpc(name, args, callback) {
    try {
      $httpAPI('POST','/v1/mcp',{
        jsonrpc:'2.0',id:1,method:'tools/call',params:{name:name,arguments:args}
      },function(r){
        if (!r || r.error || !r.result || r.result.isError) {
          callback(new Error('MCP 接口不可用或调用失败')); return;
        }
        var items = r.result.content || [];
        var text = items.filter(function(x){return x.type==='text';}).map(function(x){return x.text;}).join('\n');
        callback(null,text);
      });
    } catch(e) { callback(e); }
  }
  rpc('dump_runtime_data',{type:'performance'},function(err,text){
    if (err) {
      finish('内存读取失败：'+err.message+'\n需 Surge iOS 6+ 并启用 http-api-mcp。\n本次未执行重启。',true); return;
    }
    var p;
    try { p=JSON.parse(text); } catch (_) { finish('性能数据解析失败，本次未执行重启。',true); return; }
    var bytes=Number(p['memory-bytes']), up=Number(p.uptime);
    if (!isFinite(bytes)||bytes<=0||!isFinite(up)||up<0) {finish('性能数据缺少有效内存或运行时间，本次未执行重启。',true);return;}
    var start=now-up;
    var changed=typeof state.start!=='number'||Math.abs(start-state.start)>5;
    if (changed) {
      var pending=state.pending;
      state={start:start,peak:bytes,low:bytes,samples:[],pending:pending};
    }
    if (state.pending && start>=state.pending-2 && changed) {
      state.lastRestart=now; delete state.pending;
    }
    var previous=state.previous;
    state.peak=Math.max(Number(state.peak)||bytes,bytes);
    state.low=Math.min(Number(state.low)||bytes,bytes);
    state.previous=bytes;
    state.samples=Array.isArray(state.samples)?state.samples:[];
    state.samples.push(bytes); state.samples=state.samples.slice(-20);
    var lines=['已运行时长  '+duration(up),'启动于  '+stamp(start)];
    var reloads=parseInt(store('surge_uptime_reload_count')||'0',10);
    var lastReload=Number(store('surge_uptime_reload_last'));
    var recordedStart=Number(store('surge_uptime_start'));
    if (recordedStart>0 && Math.abs(recordedStart-start)<10 && reloads>0) {
      lines.push('配置重载  '+reloads+' 次'+(lastReload>0?' · '+stamp(lastReload):''));
    }
    lines.push('','当前内存占比  '+mib(bytes),'观测峰值  '+mib(state.peak)+' · 最低 '+mib(state.low));
    if (typeof previous==='number') {
      var delta=(bytes-previous)/1048576;
      var rounded=Number(delta.toFixed(1));
      lines.push('较上次  '+(rounded>=0?'+':'')+rounded.toFixed(1)+' MiB');
    }
    lines.push('活动连接  '+p['active-requests']+' · DNS 缓存 '+p['dns-cache-entries']);
    if (state.samples.length>=2) {
      var min=Math.min.apply(null,state.samples),max=Math.max.apply(null,state.samples);
      var bars='▁▂▃▄▅▆▇█';
      lines.push('近期采样  '+state.samples.map(function(v){return bars.charAt(max===min?0:Math.round((v-min)/(max-min)*7));}).join(''));
    }
    lines.push('更新 '+clock(now)+' · 自动刷新 60 秒');
    if (state.lastRestart) lines.push('已确认引擎重启 '+clock(state.lastRestart));
    if (state.pending) {
      var age=now-state.pending;
      if (age<30) {save();finish(lines.join('\n')+'\n\n已发送重启请求，等待下次采样确认。');return;}
      lines.push('上次重启请求未获确认，请查看 Surge 状态。');
      delete state.pending;
    }
    if (button && state.armed && now-state.armed>=0 && now-state.armed<=20) {
      delete state.armed;
      state.pending=now;
      if (!save()) {finish('无法保存重启状态，本次未执行重启。',true);return;}
      rpc('restart_engine',{},function(e){
        if (e) {
          delete state.pending; save();
          finish(lines.join('\n')+'\n\n重启接口未确认成功，请检查 Surge 状态。',true);
        } else {
          finish(lines.join('\n')+'\n\n已发送重启请求；连接会断开后重连。\n下次刷新确认结果。');
        }
      });
      return;
    }
    if (button) state.armed=now;
    else if (state.armed && now-state.armed>20) delete state.armed;
    if (!save()) {finish('无法保存监控记录，本次未执行重启。',true);return;}
    if (state.armed && now-state.armed<=20) {
      lines.push('\n确认重启：20 秒内再点一次右上角刷新。\n所有连接将断开，运行时间与临时规则会重置。\n不再点击即取消；自动刷新不会执行重启。');
    } else {
      lines.push('\n手动重启：连续点两次右上角刷新（20 秒内）。\n重启会断开全部连接并清空临时规则。\n峰值仅统计本模块采样；重启后重新记录。');
    }
    finish(lines.join('\n'));
  });
})();

}
