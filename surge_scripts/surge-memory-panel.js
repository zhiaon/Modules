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
  function finish(text, bad) {
    $done({title:'Surge 内存监控',content:text,style:bad?'error':'info'});
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
    var lines=['当前内存  '+mib(bytes),'观测峰值  '+mib(state.peak)+' · 最低 '+mib(state.low)];
    if (typeof previous==='number') {
      var delta=(bytes-previous)/1048576;
      lines.push('较上次  '+(delta>=0?'+':'')+delta.toFixed(1)+' MiB');
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
