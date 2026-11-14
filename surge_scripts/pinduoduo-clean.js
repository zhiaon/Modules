/* Pinduoduo 8.31.0 capture-based filter, v1.0.
 * Only the observed home feed schema is supported. No network or storage access.
 * Unknown schemas and all-ad pages pass through to avoid empty-page loops.
 */
(function () {
  'use strict';
  var result = {};
  try {
    if (/^https:\/\/api\.pinduoduo\.com\/api\/alexa\/cells\/hub\/v3(?:\?|$)/.test($request.url) &&
        $response && typeof $response.body === 'string') {
      var obj = JSON.parse($response.body);
      var list = obj && obj.data && obj.data.goods_list;
      if (Array.isArray(list)) {
        var kept = list.filter(function (item) {
          var ad = item && item.data && item.data.ad;
          if (!ad || typeof ad !== 'object' || Array.isArray(ad)) return true;
          var info = ad.openinfo;
          if (typeof info === 'string') {
            try { info = JSON.parse(info); } catch (_) { return true; }
          }
          var id = info && info.ad_id;
          return !(typeof id === 'number' && Number.isFinite(id) && id > 0 ||
                   typeof id === 'string' && /^[1-9][0-9]*$/.test(id));
        });
        var removed = list.length - kept.length;
        if (removed > 0 && kept.length > 0) {
          obj.data.goods_list = kept;
          result = {body: JSON.stringify(obj)};
          console.log('[PDD] home ads removed=' + removed + ', kept=' + kept.length);
        } else if (removed > 0) {
          console.log('[PDD] all-ad page: passthrough to preserve pagination');
        }
      }
    }
  } catch (_) {
    console.log('[PDD] unsupported response: passthrough');
  }
  $done(result);
})();
