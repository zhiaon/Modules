/**
 * iKuuu 签到小组件 · Egern 版
 *
 * 读 ikuuu-checkin.js 写入缓存的签到结果，渲染成小组件。
 * 与 Surge 版的「面板」等价：不做签到，只看状态。
 *
 * 支持的尺寸：
 *   systemSmall / systemMedium / systemLarge / systemExtraLarge
 *   accessoryCircular / accessoryRectangular / accessoryInline（锁屏）
 *
 * env:
 *   REFRESH  缓存超过多少分钟才去站点刷新流量，0 = 只读缓存
 */
const RESULT_KEY = "ikuuu_result";
const COOKIE_KEY = "ikuuu_cookie";
const HOST_KEY = "ikuuu_host";
const CRON_KEY = "ikuuu_cron";
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/**
 * 每组配色：三色渐变（左上 → 中间 → 右下）+ 强调色
 * 只用深色系，保证白色文字对比度。
 */
const THEME = {
  success: {
    colors: ["#041713", "#0A4A39", "#128A63"],
    accent: "#5EEBA6",
    glow: "#8EF7C8",
    label: "已签到"
  },
  already: {
    colors: ["#04121F", "#0B3C63", "#1E88D6"],
    accent: "#7CC7FF",
    glow: "#A9DBFF",
    label: "已签到"
  },
  expired: {
    colors: ["#22150A", "#6B3F0C", "#D08A16"],
    accent: "#FFC964",
    glow: "#FFDF9C",
    label: "Cookie 失效"
  },
  nocookie: {
    colors: ["#22150A", "#6B3F0C", "#D08A16"],
    accent: "#FFC964",
    glow: "#FFDF9C",
    label: "待登录"
  },
  failed: {
    colors: ["#230A0C", "#6E1420", "#C0303F"],
    accent: "#FF8C96",
    glow: "#FFB9BF",
    label: "签到失败"
  },
  error: {
    colors: ["#230A0C", "#6E1420", "#C0303F"],
    accent: "#FF8C96",
    glow: "#FFB9BF",
    label: "请求失败"
  },
  unknown: {
    colors: ["#0F1020", "#2B2E5C", "#5A63C4"],
    accent: "#B9C1FF",
    glow: "#D6DAFF",
    label: "还没签到"
  }
};

/* ---------- 工具 ---------- */

function txt(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function readJSON(ctx, key) {
  try {
    const raw = ctx.storage.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clockText(ts) {
  const d = new Date(ts || Date.now());
  const p = (n) => (n < 10 ? "0" : "") + n;
  return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function fmtGB(v) {
  const n = num(v);
  if (n === null) return "--";
  if (n >= 1000) return n.toFixed(0);
  if (n >= 100) return n.toFixed(1);
  if (n >= 10) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  if (n > 0) return n.toFixed(2);
  return "0.00";
}

/* 剩余天数：到期日减今天 */
function daysLeft(expire) {
  const m = txt(expire).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  const diff = end.getTime() - Date.now();
  if (!isFinite(diff)) return null;
  return Math.max(0, Math.ceil(diff / 86400000));
}

/* 下次签到时间：从 cron 里取 时/分，简单按每天算 */
function nextCheckin(cron) {
  const parts = txt(cron).split(/\s+/);
  if (parts.length < 5) return null;
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (!isFinite(minute) || !isFinite(hour) || minute > 59 || hour > 23) return null;
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

/* ---------- SVG ---------- */

function ringSVG(pct, accent, track, dashed) {
  const p = dashed ? 1 : Math.max(0, Math.min(1, pct));
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
    "<circle cx='50' cy='50' r='" + r + "' fill='none' stroke='" + track + "' stroke-width='9'/>" +
    "<circle cx='50' cy='50' r='" + r + "' fill='none' stroke='" +
    (dashed ? track : accent) + "' stroke-width='9' " +
    "stroke-linecap='round' stroke-dasharray='" +
    (dashed ? "4 8" : (c * p).toFixed(2) + " " + c.toFixed(2)) + "' " +
    "transform='rotate(-90 50 50)'/>" +
    "</svg>"
  );
}

/**
 * 锁屏圆形：环 + 中心文字都画进同一张 SVG
 * 因为 accessoryCircular 只有一个小方块，分两个节点会串位。
 */
function gaugeSVG(pct, accent, track, label, unit) {
  const p = Math.max(0, Math.min(1, pct));
  const r = 41;
  const c = 2 * Math.PI * r;
  const dash = (c * p).toFixed(2) + " " + c.toFixed(2);
  // 数字越长字号越小，保证始终待在环内（环内可用直径约 70）
  const len = String(label).length;
  const fs = len <= 3 ? 30 : len === 4 ? 26 : len === 5 ? 21 : 17;
  return (
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
    "<circle cx='50' cy='50' r='" + r + "' fill='none' stroke='" + track + "' stroke-width='6.5'/>" +
    "<circle cx='50' cy='50' r='" + r + "' fill='none' stroke='" + accent + "' stroke-width='6.5' " +
    "stroke-linecap='round' stroke-dasharray='" + dash + "' transform='rotate(-90 50 50)'/>" +
    "<text x='50' y='" + (unit ? 45 : 54) + "' fill='#FFFFFF' font-size='" + fs + "' font-weight='700' " +
    "font-family='-apple-system, Helvetica' text-anchor='middle' " +
    "dominant-baseline='middle'>" + label + "</text>" +
    (unit
      ? "<text x='50' y='65' fill='#FFFFFFAA' font-size='11' " +
        "font-family='-apple-system, Helvetica' text-anchor='middle' " +
        "dominant-baseline='middle'>" + unit + "</text>"
      : "") +
    "</svg>"
  );
}

function sparkSVG(values, accent) {
  if (!values || values.length < 2) return null;
  const max = Math.max.apply(null, values);
  const min = Math.min.apply(null, values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 28 - ((v - min) / span) * 24;
      return x.toFixed(1) + "," + y.toFixed(1);
    })
    .join(" ");
  return (
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 30'>" +
    "<polyline points='" + pts + "' fill='none' stroke='" + accent + "' stroke-width='2.5' " +
    "stroke-linejoin='round' stroke-linecap='round'/></svg>"
  );
}

/* ---------- 布局 ---------- */

function bar(pct, accent) {
  const p = Math.max(0, Math.min(100, pct));
  const fill = Math.max(0.5, p);
  const rest = Math.max(0.5, 100 - p);
  return {
    type: "stack",
    direction: "row",
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FFFFFF26",
    children: [
      { type: "stack", height: 6, borderRadius: 3, flex: fill, backgroundColor: accent },
      { type: "stack", height: 6, flex: rest }
    ]
  };
}

function dot(color) {
  return { type: "stack", width: 8, height: 8, borderRadius: 4, backgroundColor: color };
}

function header(theme, host) {
  return {
    type: "stack",
    direction: "row",
    alignItems: "center",
    gap: 6,
    children: [
      { type: "image", src: "sf-symbol:bolt.horizontal.circle.fill", color: theme.accent, width: 15, height: 15 },
      { type: "text", text: "iKuuu", font: { size: "caption1", weight: "bold" }, textColor: "#FFFFFFCC" },
      { type: "spacer" },
      dot(theme.accent),
      {
        type: "text",
        text: theme.label,
        font: { size: "caption2", weight: "semibold" },
        textColor: theme.accent,
        maxLines: 1
      }
    ]
  };
}

/**
 * 背景渐变：左上最深 → 中部主色 → 右下亮色
 * stops 往后压，让亮色只出现在右下角一小块，避免压住左侧文字。
 */
function grad(theme, angle) {
  const pts = {
    diag: [{ x: -0.1, y: -0.2 }, { x: 1, y: 1.1 }],
    down: [{ x: 0.25, y: -0.15 }, { x: 0.75, y: 1.1 }],
    flat: [{ x: 0, y: 0 }, { x: 1, y: 0.7 }]
  }[angle || "diag"];
  return {
    type: "linear",
    colors: theme.colors,
    stops: [0, 0.62, 1],
    startPoint: pts[0],
    endPoint: pts[1]
  };
}

/**
 * 背景层：一张 SVG 同时画「三色线性渐变 + 右上柔光 + 底部暗角」
 * 之所以不用 backgroundGradient 叠加 backgroundImage，是因为
 * Egern 文档写明 backgroundImage 优先级最高，会把渐变盖掉。
 */
function backdrop(theme, angle) {
  const [c0, c1, c2] = theme.colors;
  const pts = {
    diag: ["0%", "0%", "100%", "100%"],
    down: ["25%", "0%", "75%", "100%"],
    flat: ["0%", "0%", "100%", "70%"]
  }[angle || "diag"];
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 200' preserveAspectRatio='none'>" +
    "<defs>" +
    "<linearGradient id='base' x1='" + pts[0] + "' y1='" + pts[1] + "' x2='" + pts[2] + "' y2='" + pts[3] + "'>" +
    "<stop offset='0%' stop-color='" + c0 + "'/>" +
    "<stop offset='62%' stop-color='" + c1 + "'/>" +
    "<stop offset='100%' stop-color='" + c2 + "'/>" +
    "</linearGradient>" +
    "<radialGradient id='glow' cx='0.86' cy='0.92' r='0.85'>" +
    "<stop offset='0%' stop-color='" + theme.glow + "' stop-opacity='0.30'/>" +
    "<stop offset='55%' stop-color='" + theme.glow + "' stop-opacity='0.05'/>" +
    "<stop offset='100%' stop-color='" + theme.glow + "' stop-opacity='0'/>" +
    "</radialGradient>" +
    "<radialGradient id='vig' cx='0.1' cy='0.15' r='0.9'>" +
    "<stop offset='0%' stop-color='#000000' stop-opacity='0.28'/>" +
    "<stop offset='100%' stop-color='#000000' stop-opacity='0'/>" +
    "</radialGradient>" +
    "</defs>" +
    "<rect width='400' height='200' fill='url(%23base)'/>" +
    "<rect width='400' height='200' fill='url(%23glow)'/>" +
    "<rect width='400' height='200' fill='url(%23vig)'/>" +
    "</svg>";
  return "data:image/svg+xml," + svg;
}

function root(theme, children, gap) {
  return {
    type: "widget",
    alignItems: "start",
    backgroundGradient: grad(theme, "diag"),
    backgroundImage: backdrop(theme, "diag"),
    padding: 14,
    gap: gap === undefined ? 8 : gap,
    children: children
  };
}

/* ---------- 数据 ---------- */

async function refreshIfStale(ctx, data, minutes) {
  if (!data || !(minutes > 0)) return data;
  const age = (Date.now() - Number(data.ts || 0)) / 60000;
  if (!isFinite(age) || age < minutes) return data;

  const host = txt(data.host) || "ikuuu.org";
  let cookie = "";
  try {
    cookie = txt(ctx.storage.get(COOKIE_KEY));
  } catch (e) {}
  const manual = txt(ctx.env && ctx.env.COOKIE).replace(/^\s*cookie\s*:\s*/i, "");
  if (!cookie && manual) cookie = manual;
  if (!cookie) return data;

  try {
    const resp = await ctx.http.get("https://" + host + "/user", {
      timeout: 8000,
      insecureTls: true,
      credentials: "omit",
      redirect: "manual",
      headers: { "Cookie": cookie, "User-Agent": UA, "Referer": "https://" + host + "/user" }
    });
    const html = await resp.text();

    const pick = (labels) => {
      for (const label of labels) {
        const re = new RegExp(
          label + "[\\s\\S]{0,400}?<span[^>]*class=\"[^\"]*counter[^\"]*\"[^>]*>\\s*([\\d.]+)\\s*<\\/span>\\s*([KMGTP]?B)",
          "i"
        );
        const m = html.match(re);
        if (m) {
          const unit = { B: 1 / 1073741824, KB: 1 / 1048576, MB: 1 / 1024, GB: 1, TB: 1024, PB: 1048576 }[m[2].toUpperCase()] || 1;
          return { text: m[1] + " " + m[2].toUpperCase(), gb: Number(m[1]) * unit };
        }
      }
      return null;
    };

    const flat = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const rest = pick(["剩余流量", "流量剩余"]);
    const total = pick(["总流量", "流量总额", "可用流量"]);
    const used = pick(["已用流量", "已使用流量", "已用"]);
    const em = flat.match(/(?:到期时间|过期时间|到期日|有效期至|下次重置)[^\d]{0,12}(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/);

    const fresh = Object.assign({}, data, {
      traffic: Object.assign({}, data.traffic || {}, {
        rest: rest ? rest.text : (data.traffic || {}).rest,
        restGB: rest ? rest.gb : (data.traffic || {}).restGB,
        total: total ? total.text : (data.traffic || {}).total,
        totalGB: total ? total.gb : (data.traffic || {}).totalGB,
        used: used ? used.text : (data.traffic || {}).used,
        usedGB: used ? used.gb : (data.traffic || {}).usedGB,
        expire: em ? em[1].replace(/[/.]/g, "-") : (data.traffic || {}).expire
      })
    });
    try {
      ctx.storage.set(RESULT_KEY, JSON.stringify(fresh));
    } catch (e) {}
    return fresh;
  } catch (e) {
    return data;
  }
}

/* ---------- 主函数 ---------- */

export default async function (ctx) {
  const env = ctx.env || {};
  const family = ctx.widgetFamily || "systemMedium";

  let data = readJSON(ctx, RESULT_KEY);
  const refreshMinutes = num(env.REFRESH);
  if (refreshMinutes && refreshMinutes > 0) {
    data = await refreshIfStale(ctx, data, refreshMinutes);
  }

  const state = data && THEME[data.state] ? data.state : "unknown";
  const theme = THEME[state];
  const traffic = (data && data.traffic) || {};

  const restGB = num(traffic.restGB);
  const totalGB = num(traffic.totalGB);
  const usedGB = num(traffic.usedGB);

  let usedPct = 0;
  if (totalGB && usedGB !== null) usedPct = (usedGB / totalGB) * 100;
  else if (restGB !== null && totalGB) usedPct = ((totalGB - restGB) / totalGB) * 100;
  else if (usedGB) usedPct = 0;
  if (!isFinite(usedPct)) usedPct = 0;
  usedPct = Math.max(0, Math.min(100, usedPct));
  const leftPct = 100 - usedPct;

  const hasData = restGB !== null || usedGB !== null || !!txt(traffic.total);
  const emptyRing = !hasData;

  const expire = txt(traffic.expire);
  const dLeft = daysLeft(expire);
  const cron = (() => {
    try {
      return txt(ctx.storage.get(CRON_KEY)) || txt(env.CRON);
    } catch (e) {
      return txt(env.CRON);
    }
  })();
  const next = nextCheckin(cron);
  const nextText = next ? clockText(next.getTime()).slice(6) : "--";

  const checkedAt = data && data.checkedAt ? data.checkedAt : (data && data.ts ? clockText(data.ts) : "--");
  const msgLine = data && data.msg ? txt(data.msg).replace(/\s+/g, " ").slice(0, 42) : "";
  const host = (data && data.host) || "ikuuu.org";

  /* ---- 锁屏：圆形 ---- */
  if (family === "accessoryCircular") {
    return {
      type: "widget",
      padding: 0,
      children: [
        {
          type: "image",
          src: emptyRing
            ? ringSVG(1, theme.accent, "#FFFFFF33", true)
            : gaugeSVG(leftPct / 100, theme.accent, "#FFFFFF33",
                fmtGB(restGB).replace(/\.00$/, ""), "GB 可用"),
          width: 76,
          height: 76
        }
      ]
    };
  }

  /* ---- 锁屏：内联 ---- */
  if (family === "accessoryInline") {
    return {
      type: "widget",
      padding: 0,
      children: [
        {
          type: "text",
          text: "iKuuu " + (restGB !== null ? fmtGB(restGB) + "GB" : theme.label),
          font: { size: "caption1", weight: "semibold" }
        }
      ]
    };
  }

  /* ---- 锁屏：矩形 ---- */
  if (family === "accessoryRectangular") {
    return {
      type: "widget",
      padding: 2,
      gap: 3,
      children: [
        {
          type: "stack",
          direction: "row",
          alignItems: "center",
          gap: 4,
          children: [
            { type: "image", src: "sf-symbol:bolt.horizontal.fill", width: 11, height: 11 },
            { type: "text", text: "iKuuu " + theme.label, font: { size: "caption1", weight: "semibold" } },
            { type: "spacer" },
            { type: "text", text: checkedAt, font: { size: "caption2" }, opacity: 0.75 }
          ]
        },
        {
          type: "text",
          text: (restGB !== null ? "剩 " + fmtGB(restGB) + " GB" : theme.label) +
            (dLeft !== null ? " · " + dLeft + " 天到期" : ""),
          font: { size: "headline", weight: "bold" },
          maxLines: 1,
          minScale: 0.7
        },
        bar(leftPct, "#FFFFFF")
      ]
    };
  }

  /* ---- 小尺寸 ---- */
  if (family === "systemSmall") {
    return root(theme, [
      header(theme, host),
      { type: "spacer", length: 2 },
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        gap: 3,
        children: [
          {
            type: "text",
            text: restGB !== null ? fmtGB(restGB) : (hasData ? "--" : "—"),
            font: { size: "largeTitle", weight: "heavy" },
            textColor: "#FFFFFF",
            maxLines: 1,
            minScale: 0.5
          },
          { type: "text", text: "GB", font: { size: "caption1", weight: "semibold" }, textColor: "#FFFFFFAA" }
        ]
      },
      {
        type: "text",
        text: hasData ? "剩余流量 · 共 " + (traffic.total || "--") : "先在 Safari 登录一次",
        font: { size: "caption2" },
        textColor: "#FFFFFF99",
        maxLines: 1,
        minScale: 0.7
      },
      bar(leftPct, theme.accent),
      { type: "spacer" },
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 4,
        children: [
          { type: "image", src: "sf-symbol:hourglass", color: theme.accent, width: 10, height: 10 },
          {
            type: "text",
            text: (dLeft !== null ? dLeft + " 天到期" : "到期未知"),
            font: { size: "caption2", weight: "medium" },
            textColor: "#FFFFFFDD",
            maxLines: 1,
            minScale: 0.6
          },
          { type: "spacer" },
          {
            type: "text",
            text: checkedAt,
            font: { size: "caption2" },
            textColor: "#FFFFFF88",
            maxLines: 1,
            minScale: 0.6
          }
        ]
      }
    ]);
  }

  /* ---- 大尺寸：中尺寸放大版 + 明细 ---- */
  if (family === "systemLarge" || family === "systemExtraLarge") {
    const rows = [
      ["总流量", traffic.total || "--"],
      ["已用", traffic.used || "--"],
      ["剩余", traffic.rest || "--"],
      ["到期", expire || "--"],
      ["站点", host]
    ].map(([k, v]) => ({
      type: "stack",
      direction: "row",
      alignItems: "center",
      children: [
        { type: "text", text: k, font: { size: "footnote" }, textColor: "#FFFFFF88", flex: 1 },
        { type: "text", text: v, font: { size: "footnote", weight: "semibold" }, textColor: "#FFFFFF", maxLines: 1, minScale: 0.7 }
      ]
    }));

    return root(theme, [
      header(theme, host),
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 14,
        children: [
          {
            type: "stack",
            direction: "column",
            alignItems: "start",
            gap: 4,
            flex: 1,
            children: [
              {
                type: "text",
                text: "剩余流量",
                font: { size: "caption1", weight: "medium" },
                textColor: "#FFFFFF99"
              },
              {
                type: "stack",
                direction: "row",
                alignItems: "end",
                gap: 4,
                children: [
                  {
                    type: "text",
                    text: restGB !== null ? fmtGB(restGB) : "--",
                    font: { size: "largeTitle", weight: "heavy" },
                    textColor: "#FFFFFF",
                    maxLines: 1,
                    minScale: 0.5
                  },
                  { type: "text", text: "GB", font: { size: "body", weight: "semibold" }, textColor: "#FFFFFFAA" }
                ]
              },
              bar(leftPct, theme.accent),
              {
                type: "text",
                text: msgLine || theme.label,
                font: { size: "caption2" },
                textColor: "#FFFFFFAA",
                maxLines: 2
              }
            ]
          },
          {
            type: "stack",
            direction: "column",
            alignItems: "center",
            gap: 2,
            children: [
              { type: "image", src: ringSVG(leftPct / 100, theme.accent, "#FFFFFF26", emptyRing), width: 96, height: 96 },
              { type: "text", text: emptyRing ? "待登录" : "剩余 " + Math.round(leftPct) + "%", font: { size: "caption2", weight: "semibold" }, textColor: "#FFFFFFCC" }
            ]
          }
        ]
      },
      { type: "spacer", length: 2 },
      {
        type: "stack",
        direction: "column",
        gap: 6,
        padding: [10, 10, 10, 10],
        borderRadius: 12,
        backgroundColor: "#FFFFFF14",
        children: rows
      },
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 8,
        children: [
          {
            type: "stack",
            direction: "column",
            alignItems: "start",
            gap: 2,
            flex: 1,
            padding: [8, 10, 8, 10],
            borderRadius: 10,
            backgroundColor: "#FFFFFF10",
            children: [
              { type: "text", text: "下次签到", font: { size: "caption2" }, textColor: "#FFFFFF88" },
              { type: "text", text: nextText, font: { size: "subheadline", weight: "bold" }, textColor: "#FFFFFF" }
            ]
          },
          {
            type: "stack",
            direction: "column",
            alignItems: "start",
            gap: 2,
            flex: 1,
            padding: [8, 10, 8, 10],
            borderRadius: 10,
            backgroundColor: "#FFFFFF10",
            children: [
              { type: "text", text: "距离到期", font: { size: "caption2" }, textColor: "#FFFFFF88" },
              { type: "text", text: dLeft !== null ? dLeft + " 天" : "—", font: { size: "subheadline", weight: "bold" }, textColor: "#FFFFFF" }
            ]
          }
        ]
      },
      { type: "spacer" },
      {
        type: "text",
        text: "签到结果更新于 " + checkedAt + (data && data.state === "success" ? " · 今日已自动签到" : ""),
        font: { size: "caption2" },
        textColor: "#FFFFFF77",
        maxLines: 1
      }
    ], 10);
  }

  /* ---- 中尺寸（默认） ---- */
  return root(theme, [
    header(theme, host),
    { type: "spacer" },
    {
      type: "stack",
      direction: "row",
      alignItems: "center",
      gap: 12,
      children: [
        {
          type: "stack",
          direction: "column",
          alignItems: "start",
          gap: 4,
          flex: 1,
          children: hasData ? [
            {
              type: "text",
              text: "剩余流量",
              font: { size: "caption2", weight: "medium" },
              textColor: "#FFFFFF99"
            },
            {
              type: "stack",
              direction: "row",
              alignItems: "end",
              gap: 3,
              children: [
                {
                  type: "text",
                  text: fmtGB(restGB),
                  font: { size: "title", weight: "heavy" },
                  textColor: "#FFFFFF",
                  maxLines: 1,
                  minScale: 0.5
                },
                { type: "text", text: "GB", font: { size: "caption1", weight: "semibold" }, textColor: "#FFFFFFAA" }
              ]
            },
            bar(leftPct, theme.accent),
            {
              type: "stack",
              direction: "row",
              alignItems: "center",
              gap: 8,
              children: [
                {
                  type: "stack",
                  direction: "row",
                  alignItems: "center",
                  gap: 3,
                  children: [
                    { type: "image", src: "sf-symbol:hourglass", color: "#FFFFFF88", width: 9, height: 9 },
                    {
                      type: "text",
                      text: dLeft !== null ? dLeft + " 天" : "到期未知",
                      font: { size: "caption2" },
                      textColor: "#FFFFFF99"
                    }
                  ]
                },
                {
                  type: "stack",
                  direction: "row",
                  alignItems: "center",
                  gap: 3,
                  children: [
                    { type: "image", src: "sf-symbol:alarm", color: "#FFFFFF88", width: 9, height: 9 },
                    {
                      type: "text",
                      text: nextText,
                      font: { size: "caption2" },
                      textColor: "#FFFFFF99"
                    }
                  ]
                }
              ]
            }
          ] : [
            {
              type: "text",
              text: "还没拿到账号数据",
              font: { size: "subheadline", weight: "semibold" },
              textColor: "#FFFFFF",
              maxLines: 2
            },
            {
              type: "text",
              text: "Safari 登录一次即可自动记住",
              font: { size: "caption2" },
              textColor: "#FFFFFFAA",
              maxLines: 3
            }
          ]
        },
        emptyRing ? { type: "stack", width: 0, height: 0, children: [] } : {
          type: "stack",
          direction: "column",
          alignItems: "center",
          gap: 1,
          children: [
            { type: "image", src: ringSVG(leftPct / 100, theme.accent, "#FFFFFF26", emptyRing), width: 76, height: 76 },
            {
              type: "text",
              text: emptyRing ? "待登录" : Math.round(leftPct) + "%",
              font: { size: "caption2", weight: "bold" },
              textColor: "#FFFFFFCC",
              maxLines: 1
            }
          ]
        }
      ]
    },
    { type: "spacer", length: 4 },
    {
      type: "stack",
      direction: "row",
      alignItems: "center",
      gap: 5,
      children: [
        { type: "image", src: (emptyRing ? "sf-symbol:lock.fill" : "sf-symbol:bolt.horizontal.fill"), color: "#FFFFFF66", width: 9, height: 9 },
        {
          type: "text",
          text: emptyRing ? theme.label : (msgLine || theme.label),
          font: { size: "caption2" },
          textColor: "#FFFFFF88",
          maxLines: 1,
          minScale: 0.7
        },
        { type: "spacer" },
        {
          type: "text",
          text: checkedAt,
          font: { size: "caption2" },
          textColor: "#FFFFFF77",
          maxLines: 1
        }
      ]
    }
  ]);
}