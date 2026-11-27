/*
 * ============================================================
 * 彩云天气 VIP / 广告净化 —— Surge 版
 * ------------------------------------------------------------
 * 逻辑参照：
 *   Loon 插件「彩云天气vip」 6otho/Loon_tool/Plugin/Caiyuntianqi.plugin
 *   脚本来源：chxm1023/Rewrite caiyuntianqi.js
 *
 * 与 Loon 原版的差异（均为 Surge 语法/健壮性适配）：
 *   1. 全程防御式改写，任一字段缺失或 JSON 解析失败都原样透传，不阻断 App；
 *   2. 不注入作者自用的推广卡片（features / homefeatures 保持原样）；
 *   3. 广告接口改为在模块层用 [URL Rewrite] reject-dict 直接拦，
 *      脚本内只在拿到响应体时兜底清空；
 *   4. 会员接口用「增量合并」而非整包替换，只覆盖 VIP 相关字段。
 *
 * 入口由 $request/$response 是否存在自动判定：
 *   无 $response  → 请求阶段：注入 device-token / authorization
 *   有 $response  → 响应阶段：按 URL 分类改写
 * ============================================================
 */

var CY_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2ZXJzaW9uIjoxLCJ1c2VyX2lkIjoiNWY1YmZjNTdkMmM2ODkwMDE0ZTI2YmI4Iiwic3ZpcF9leHBpcmVkX2F0IjoxNzA1MzMxMTY2LjQxNjc3MSwidmlwX2V4cGlyZWRfYXQiOjB9.h_Cem89QarTXxVX9Z_Wt-Mak6ZHAjAJqgv3hEY6wpps';
var CY_EXPIRED_AT = 4092599349;      /* 2099-10-13，等价于长期有效 */

/* ---------- 工具函数 ---------- */

function cyLowerHeaders(h) {
  var out = {};
  if (!h || typeof h !== 'object') return out;
  for (var k in h) {
    if (Object.prototype.hasOwnProperty.call(h, k)) {
      out[String(k).toLowerCase()] = h[k];
    }
  }
  return out;
}

function cySetHeader(h, name, value) {
  var out = {}, lower = String(name).toLowerCase();
  if (h && typeof h === 'object') {
    for (var k in h) {
      if (!Object.prototype.hasOwnProperty.call(h, k)) continue;
      if (String(k).toLowerCase() === lower) continue;
      out[k] = h[k];
    }
  }
  out[name] = value;
  return out;
}

function cyCmpVer(a, b) {
  var pa = String(a == null || a === '' ? '0' : a).split('.');
  var pb = String(b == null || b === '' ? '0' : b).split('.');
  var n = Math.max(pa.length, pb.length);
  for (var i = 0; i < n; i++) {
    var x = parseInt(pa[i], 10); if (isNaN(x)) x = 0;
    var y = parseInt(pb[i], 10); if (isNaN(y)) y = 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function cyIsObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function cyVipBlock() {
  return { is_auto_renewal: true, expires_time: CY_EXPIRED_AT };
}

/* ---------- 主流程 ---------- */

(function () {
  var req = (typeof $request !== 'undefined' && $request) ? $request : {};
  var url = String(req.url || '');
  var rawHeaders = req.headers || {};
  var lower = cyLowerHeaders(rawHeaders);
  var hasResponse = (typeof $response !== 'undefined' && $response !== null);

  /* ========== 阶段一：请求头注入（卫星云图 / 48 小时预报） ========== */
  if (!hasResponse) {
    var h = cySetHeader(rawHeaders, 'device-token', CY_TOKEN);
    var av = String(lower['app-version'] || '');
    if (cyCmpVer(av, '7.19.0') > 0) {
      h = cySetHeader(h, 'Authorization', 'Bearer ' + CY_TOKEN);
    }
    $done({ headers: h });
    return;
  }

  /* ========== 阶段二：响应体改写 ========== */
  var appVer = String(lower['app-version'] || '');

  /* ---- 2.1 首页悬浮活动模块：直接清空活动列表 ---- */
  if (/\/activity(?:\?|$)/.test(url) && /app_name=/.test(url)) {
    var emptyActivity = cyCmpVer(appVer, '7.20.0') < 0
      ? '{"status":"ok","activities":[{"items":[{}]}]}'
      : '{"status":"ok","activities":[]}';
    $done({ body: emptyActivity });
    return;
  }

  /* ---- 2.2 纯广告位：整包清空（不读 body，省一次解压） ---- */
  if (/(?:trial_card\/info|friend_cards|banners|entries)|\boperation\b|req\?app_name=weather/.test(url)) {
    $done({ body: '{}' });
    return;
  }

  /* ---- 2.3 会员接口：增量合并 VIP 字段 ---- */
  var body = (typeof $response.body !== 'undefined') ? $response.body : null;
  if (typeof body !== 'string' || body.length === 0) {
    $done({});
    return;
  }

  var data;
  try { data = JSON.parse(body); } catch (e) { $done({}); return; }
  if (!cyIsObj(data)) { $done({}); return; }

  try {
    /* 旧版接口：biz.cyapi.cn/v2/user?app_name=... */
    if (/\/v\d+\/user\?app_name/.test(url)) {
      var result = cyIsObj(data.result) ? data.result : (data.result = {});
      result.is_vip = true;
      result.vip_expired_at = CY_EXPIRED_AT;
      result.svip_given = 1;
      result.is_xy_vip = true;
      result.xy_svip_expire = CY_EXPIRED_AT;
      result.vip_take_effect = 1;
      result.xy_vip_expire = CY_EXPIRED_AT;
      result.svip_expired_at = CY_EXPIRED_AT;
      result.svip_take_effect = 1;
      result.vip_type = 's';

      var wt = cyIsObj(result.wt) ? result.wt : (result.wt = {});
      var vip = cyIsObj(wt.vip) ? wt.vip : (wt.vip = {});
      vip.expired_at = 0;
      vip.enabled = true;
      vip.svip_apple_expired_at = CY_EXPIRED_AT;
      vip.is_auto_renewal = true;
      vip.svip_expired_at = CY_EXPIRED_AT;
      wt.svip_given = 1;
    }

    /* 新版接口：.../v1/vip_info */
    if (/\/v\d\/vip_info(?:\?|$)/.test(url)) {
      data.show_upcoming_renewal = false;
      data.svip = cyVipBlock();
    }

    /* 新版接口：.../v1/user_detail（VIP 信息嵌在 vip_info 里） */
    if (/\/v\d\/user_detail(?:\?|$)/.test(url)) {
      if (cyIsObj(data.vip_info)) {
        data.vip_info.show_upcoming_renewal = false;
        data.vip_info.svip = cyVipBlock();
      }
    }
  } catch (err) {
    /* 任何结构异常都原样放行，宁可看不懂也不让 App 崩 */
    $done({});
    return;
  }

  $done({ body: JSON.stringify(data) });
})();
