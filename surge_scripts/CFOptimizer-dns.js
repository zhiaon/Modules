(function(){var ip='';try{ip=String($persistentStore.read('CFOptimizer.pin.v1')||'')}catch(e){}
if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)&&ip.split('.').every(function(x){return String(+x)===x&&+x<=255}))return $done({address:ip,ttl:1});
if(/^[0-9a-fA-F:]+$/.test(ip)&&ip.indexOf(':')>0&&ip.length<40)return $done({address:ip,ttl:1});
$done({})})();
