/*
 * 七猫小说 - 个人中心去广告
 * 移除「我的」页面功能区（func_area）中的广告位，等价于 luestr 的 jq:
 *   delpaths([["data","func_area",1]])
 *   delpaths([["data","func_area",2]])
 * Surge http-response 脚本
 */

let body = $response.body;

try {
  let obj = JSON.parse(body);
  if (obj && obj.data && Array.isArray(obj.data.func_area)) {
    // 倒序删除，避免索引错位
    [2, 1].forEach(function (i) {
      if (obj.data.func_area.length > i) {
        obj.data.func_area.splice(i, 1);
      }
    });
  }
  $done({ body: JSON.stringify(obj) });
} catch (e) {
  $done({});
}
