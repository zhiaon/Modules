/* Root-only panel summary; pairing requires an explicit native panel button. */
(function(){
  'use strict';
  var title='Surge域名规则采集器', key='DomainCollectorData.access';
  var hint='刷新后点通知进入管理页';
  var response={title:title,content:'',style:'info'};
  var summary='状态：尚未开始\n已收集 0/5000 · 今日新增 0\n最近发现：暂无';
  function pad(n){return ('0'+n).slice(-2);}
  function day(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
  function integer(n,min,max){return typeof n==='number' && isFinite(n) && n===Math.floor(n) && n>=min && n<=max;}
  function utf8Bytes(s){var n=0,i=0,c,d;for(;i<s.length;i++){c=s.charCodeAt(i);if(c<128)n++;else if(c<2048)n+=2;else if(c>=55296&&c<=56319&&i+1<s.length&&(d=s.charCodeAt(i+1))>=56320&&d<=57343){n+=4;i++;}else n+=3;}return n;}
  try {
    /* One bounded root read only. Never enumerate keys, shards, excludes or warnings. */
    var raw=$persistentStore.read('DomainCollectorData');
    if(raw!==null && raw!==undefined){
      if(typeof raw!=='string' || raw.length===0 || utf8Bytes(raw)>163840) throw Error('root');
      var r=JSON.parse(raw);
      if(!r || Object.prototype.toString.call(r)!=='[object Object]' || r.v!==1 ||
         !integer(r.count,0,10000) || !integer(r.maxDomains,1,10000) || r.count>r.maxDomains ||
         !integer(r.todayNew,0,1000000) || typeof r.dayKey!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.dayKey) ||
         typeof r.enabled!=='boolean' || typeof r.paused!=='boolean' ||
         (r.lastSeen!==null && !integer(r.lastSeen,0,8640000000000000))) throw Error('root');
      var now=new Date(), last=r.lastSeen===null?null:new Date(r.lastSeen);
      summary='状态：'+(r.enabled && !r.paused?'采集中':'已暂停')+
        '\n已收集 '+r.count+'/'+r.maxDomains+' · 今日新增 '+(r.dayKey===day(now)?r.todayNew:0)+
        '\n最近发现：'+(last?day(last)+' '+pad(last.getHours())+':'+pad(last.getMinutes()):'暂无');
    }
  } catch (_) {
    response.style='error';
    summary='状态：存储异常\n已收集 --/-- · 今日新增 --\n最近发现：未知';
  }
  try {
    if (typeof $trigger==='string' && $trigger==='button' && typeof $input==='object' && $input && $input.purpose==='panel') {
      if (typeof crypto==='undefined' || typeof crypto.getRandomValues!=='function') throw Error('无安全随机源');
      var current=$persistentStore.read(key);
      if(current!=null){var old=JSON.parse(current);if(!old || old.v!==1) throw Error('未知授权记录');}
      var b=new Uint8Array(16); crypto.getRandomValues(b);
      var s='',i;for(i=0;i<b.length;i++) s+=('0'+b[i].toString(16)).slice(-2);
      var ticket=JSON.stringify({v:1,k:s,expires:Date.now()+60*60*1000});
      if($persistentStore.write(ticket,key)!==true || $persistentStore.read(key)!==ticket) throw Error('授权未保存');
      $notification.post(title,'本机管理','轻点打开，授权在一小时后失效。',{action:'open-url',url:'http://domain-collector.invalid/#k='+s});
      hint='已发送通知，轻点进入管理页（1小时有效）';
    }
  } catch (_) {response.style='error';hint='授权失败，请检查存储、随机源或通知权限';}
  response.content=summary+'\n'+hint;
  $done(response);
}());
