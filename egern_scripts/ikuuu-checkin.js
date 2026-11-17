/**
 * iKuuu 每日签到 · Egern 版
 *
 * 由 Surge 版 iKuuu 每日签到 V1.2 移植：
 *   $argument 竖线串  → ctx.env 键值对
 *   $httpClient       → ctx.http（timeout 单位是毫秒）
 *   $persistentStore  → ctx.storage
 *   $notification     → ctx.notify
 *
 * 触发方式：
 *   schedule 脚本  → 按模块里的 cron 每日签到
 *   generic 脚本   → 小组件读取缓存（见 ikuuu-widget.js）
 *
 * 流程：POST {site}/user/checkin → 解析 {ret,msg} → GET {site}/user 读剩余流量
 */
const COOKIE_KEY = "ikuuu_cookie";
const HOST_KEY = "ikuuu_host";
const RESULT_KEY = "ikuuu_result";
const CRON_KEY = "ikuuu_cron";
const MAX_ATTEMPTS = 2;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const SITE_RE = /^(?:[a-z0-9-]+\.)*ikuuu\.(?:org|pw|me)$/;

/* ---------- 基础工具 ---------- */

function txt(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function isOff(v) {
  const s = txt(v).toLowerCase();
  if (!s) return false;
  return ["0", "false", "off", "no", "关", "否", "关闭"].indexOf(s) >= 0;
}

function onByDefault(v) {
  const s = txt(v);
  return s === "" ? true : !isOff(s);
}

// 模块界面上的「-」表示留空
function clean(v) {
  const s = txt(v);
  return s === "-" || s === "none" || s === "null" ? "" : s;
}

function store(ctx) {
  return {
    get(key) {
      try {
        return ctx.storage.get(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        ctx.storage.set(key, value);
        return true;
      } catch (e) {
        return false;
      }
    }
  };
}

function clockText(ts) {
  const d = new Date(ts || Date.now());
  const p = (n) => (n < 10 ? "0" : "") + n;
  return (d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function normalizeHost(value) {
  let s = txt(value).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!s || s === "-" || s === "none" || s === "null" || s === "auto") return "";
  return SITE_RE.test(s) ? s : "";
}

/* ---------- Base64 / UTF-8（站点把正文 base64 塞在 var originBody 里） ---------- */

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Decode(bytes) {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b >= 0xc0 && b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b >= 0xe0 && b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      let cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

function base64Decode(str) {
  const s = String(str).replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charAt(i) === "=") break;
    const v = B64_CHARS.indexOf(s.charAt(i));
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  return utf8Decode(bytes);
}

function plainText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractHtml(data) {
  const text = String(data || "");
  const m = text.match(/var\s+originBody\s*=\s*["']([^"']+)["']/);
  if (!m) return text;
  try {
    return base64Decode(m[1]);
  } catch (e) {
    return text;
  }
}

const UNIT = { B: 1 / 1024 / 1024 / 1024, KB: 1 / 1024 / 1024, MB: 1 / 1024, GB: 1, TB: 1024, PB: 1048576 };

function pickSize(html, labels) {
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const re = new RegExp(
      label + "[\\s\\S]{0,400}?<span[^>]*class=\"[^\"]*counter[^\"]*\"[^>]*>\\s*([\\d.]+)\\s*<\\/span>\\s*([KMGTP]?B)",
      "i"
    );
    const m = html.match(re);
    if (m) return { text: m[1] + " " + m[2].toUpperCase(), gb: Number(m[1]) * (UNIT[m[2].toUpperCase()] || 1) };
    const flat = plainText(html);
    const m2 = flat.match(new RegExp(label + "\\s*[:：]?\\s*([\\d.]+)\\s*([KMGTP]?B)", "i"));
    if (m2) return { text: m2[1] + " " + m2[2].toUpperCase(), gb: Number(m2[1]) * (UNIT[m2[2].toUpperCase()] || 1) };
  }
  return null;
}

function pickExpire(html) {
  const flat = plainText(html);
  const m = flat.match(/(?:到期时间|过期时间|到期日|有效期至|下次重置)[^\d]{0,12}(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);
  if (m) return m[1].replace(/[/.]/g, "-");
  const m2 = flat.match(/(\d{4}-\d{1,2}-\d{1,2})(?=\s*(?:到期|过期))/);
  return m2 ? m2[1] : "";
}

/* ---------- 站点请求 ---------- */

function httpOptions(env, extra) {
  const opts = Object.assign({
    timeout: 20000,
    insecureTls: true,
    credentials: "omit",
    redirect: "manual"
  }, extra || {});
  const node = clean(env.NODE);
  if (node) opts.policy = node;
  return opts;
}

async function callCheckin(ctx, url, cookie, env) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await ctx.http.post(url, httpOptions(env, {
        headers: {
          "Cookie": cookie,
          "User-Agent": UA,
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Referer": url.replace(/\/user\/checkin$/, "/user"),
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        }
      }));
      return { resp: resp, error: null, attempts: attempt };
    } catch (e) {
      lastError = e;
    }
  }
  return { resp: null, error: lastError, attempts: MAX_ATTEMPTS };
}

async function fetchTraffic(ctx, host, cookie, env) {
  try {
    const resp = await ctx.http.get("https://" + host + "/user", httpOptions(env, {
      headers: {
        "Cookie": cookie,
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://" + host + "/user"
      }
    }));
    const data = await resp.text();
    const html = extractHtml(data);
    const rest = pickSize(html, ["剩余流量", "流量剩余"]);
    const total = pickSize(html, ["总流量", "流量总额", "可用流量"]);
    const used = pickSize(html, ["已用流量", "已使用流量", "已用"]);
    const expire = pickExpire(html);
    if (!rest && !total && !used && !expire) return null;
    return {
      rest: rest ? rest.text : "",
      restGB: rest ? rest.gb : null,
      total: total ? total.text : "",
      totalGB: total ? total.gb : null,
      used: used ? used.text : "",
      usedGB: used ? used.gb : null,
      expire: expire
    };
  } catch (e) {
    return null;
  }
}

/* ---------- 结果 ---------- */

function save(ctx, payload) {
  const s = store(ctx);
  const data = Object.assign({ ts: Date.now() }, payload);
  s.set(RESULT_KEY, JSON.stringify(data));
  return data;
}

export default async function (ctx) {
  const env = ctx.env || {};
  const s = store(ctx);
  const notifyOn = onByDefault(env.NOTIFY);

  // 记住 cron，供小组件推算下次签到时间
  if (ctx.cron && s.get(CRON_KEY) !== ctx.cron) s.set(CRON_KEY, ctx.cron);

  // 定时开关
  if (env.ENABLE !== undefined && isOff(env.ENABLE)) {
    console.log("[iKuuu] 定时签到已关闭，本次跳过");
    return;
  }

  // 站点：env.SITE > 抓 Cookie 时记下的 > ikuuu.org
  const host = normalizeHost(env.SITE) || normalizeHost(s.get(HOST_KEY)) || "ikuuu.org";

  // Cookie：env.COOKIE > 自动抓取的
  const manual = clean(env.COOKIE).replace(/^\s*cookie\s*:\s*/i, "").replace(/[\r\n]+/g, " ").trim();
  const cookie = manual || txt(s.get(COOKIE_KEY));
  const now = Date.now();

  if (!cookie) {
    save(ctx, {
      state: "nocookie",
      title: "没有 Cookie",
      msg: "先让「Cookie 自动抓取」保持开启，用 Safari 打开 https://" + host + " 登录一次，再回来签到。",
      host: host
    });
    if (notifyOn) {
      ctx.notify({
        title: "iKuuu 签到",
        subtitle: "没有 Cookie",
        body: "在 Safari 打开 https://" + host + " 登录一次，模块会自动保存登录状态。"
      });
    }
    return;
  }

  const url = "https://" + host + "/user/checkin";
  const result = await callCheckin(ctx, url, cookie, env);

  const fail = (state, subtitle, body, extra) => {
    save(ctx, Object.assign({ state: state, title: subtitle, msg: body, host: host }, extra || {}));
    if (notifyOn) ctx.notify({ title: "iKuuu 签到", subtitle: subtitle, body: body });
    console.log("[iKuuu] " + subtitle + " | " + String(body).replace(/\n/g, " / "));
  };

  if (result.error) {
    const msg = String(result.error && result.error.message ? result.error.message : result.error);
    if (/certificate|SSL|TLS|handshake/i.test(msg)) {
      return fail("error", "TLS 校验失败", "签到请求没通过证书校验（已开 insecureTls）。\n① 在模块 Env 里给 NODE 指定一个节点或策略组；\n② 或关掉 MITM 后改用手填 COOKIE。\n\n" + msg.slice(0, 160));
    }
    return fail("error", "请求失败", "签到接口请求出错（已试 " + result.attempts + " 次）：" + msg.slice(0, 160));
  }

  const status = result.resp.status;
  const text = txt(await result.resp.text());
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {}

  if (!json || typeof json !== "object") {
    if (status === 302 || status === 301 || /<html|<script|auth\/login/i.test(text)) {
      return fail("expired", "Cookie 已失效", "服务器返回登录页，请在 Safari 重新登录 https://" + host + "。");
    }
    return fail("error", "签到失败", "返回内容无法解析（HTTP " + status + "）：" + text.slice(0, 120));
  }

  const ret = Number(json.ret);
  const msg = txt(json.msg) || "服务器没有返回说明";
  let state = "failed";
  let title = "签到失败";
  if (ret === 1) {
    state = "success";
    title = "签到成功";
  } else if (/已经?签到|重复签到|签到过了|明天再来/.test(msg)) {
    state = "already";
    title = "今日已签到";
  } else if (/未登录|登录.*(?:失效|过期)|请重新登录|请先登录/.test(msg)) {
    state = "expired";
    title = "Cookie 已失效";
  }

  const traffic = (state === "success" || state === "already")
    ? await fetchTraffic(ctx, host, cookie, env)
    : null;

  const content = msg + (traffic && traffic.rest ? "\n剩余流量：" + traffic.rest : "");
  save(ctx, {
    state: state,
    title: title,
    msg: msg,
    host: host,
    traffic: traffic,
    checkedAt: clockText(now)
  });

  if (notifyOn) {
    ctx.notify({
      title: "iKuuu 签到",
      subtitle: title,
      body: content + "\n" + clockText(now) + " · " + host
    });
  }
  console.log("[iKuuu] " + title + " | " + content.replace(/\n/g, " / "));
}
