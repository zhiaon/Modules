/**
 * iKuuu Cookie 自动抓取 · Egern 版
 *
 * 对应 Surge 版的 ikuuu-cookie.js（http-request 脚本）。
 * 已登录状态下访问 ikuuu.org / ikuuu.pw / ikuuu.me 时，
 * 把请求头里的登录 Cookie 存进 Egern 本地存储，供签到脚本使用。
 *
 * 只读不改，最后不 return 即原样透传。
 */
const COOKIE_KEY = "ikuuu_cookie";
const HOST_KEY = "ikuuu_host";
const SITE_RE = /^(?:[a-z0-9-]+\.)*ikuuu\.(?:org|pw|me)$/i;
const LOGIN_COOKIE = /(?:^|;\s*)(?:auth|uid|key|session|remember_[^=;]*)=[^;]/i;

function isOff(v) {
  const s = String(v === null || v === undefined ? "" : v).trim().toLowerCase();
  if (!s) return false;
  return ["0", "false", "off", "no", "关", "否", "关闭"].indexOf(s) >= 0;
}

function notifyOn(v) {
  const s = String(v === null || v === undefined ? "" : v).trim();
  return s === "" ? true : !isOff(s);
}

function readStore(ctx, key) {
  try {
    return ctx.storage.get(key);
  } catch (e) {
    return null;
  }
}

function writeStore(ctx, key, value) {
  try {
    ctx.storage.set(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

export default async function (ctx) {
  const env = ctx.env || {};

  if (isOff(env.CAPTURE)) {
    console.log("[iKuuu] Cookie 抓取已关闭，放行");
    return;
  }

  const headers = ctx.request && ctx.request.headers;
  if (!headers) return;

  const cookie = String(headers.get("cookie") || "").trim();
  if (!cookie) {
    console.log("[iKuuu] 本次请求没有 Cookie，跳过");
    return;
  }
  if (!LOGIN_COOKIE.test(cookie)) {
    console.log("[iKuuu] 当前是未登录状态，忽略本次 Cookie");
    return;
  }

  const existing = String(readStore(ctx, COOKIE_KEY) || "");
  if (existing === cookie) {
    console.log("[iKuuu] Cookie 没有变化，跳过写入");
    return;
  }

  const saved = writeStore(ctx, COOKIE_KEY, cookie);

  // 记住这份 Cookie 是从哪个域名登录来的
  let host = "";
  try {
    const m = String((ctx.request && ctx.request.url) || "").match(/^https?:\/\/([^/:?#]+)/i);
    host = m ? m[1].toLowerCase() : "";
    if (host && SITE_RE.test(host)) {
      writeStore(ctx, HOST_KEY, host);
    } else {
      host = "";
    }
  } catch (e) {}

  if (notifyOn(env.NOTIFY)) {
    try {
      if (saved) {
        ctx.notify({
          title: "iKuuu",
          subtitle: "已获取登录 Cookie",
          body: (host ? "站点：" + host + "\n" : "") +
            "可以到模块 Env 里把 CAPTURE 改成 false 关掉抓取，签到会继续用这份 Cookie。"
        });
      } else {
        ctx.notify({ title: "iKuuu", subtitle: "Cookie 保存失败", body: "写入本地存储失败，请重试。" });
      }
    } catch (e) {}
  }

  console.log("[iKuuu] " + (saved ? "已保存登录 Cookie（" + cookie.length + " 字节）" : "写入失败") +
    (host ? "，站点 " + host : ""));
}
