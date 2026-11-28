/**
 * 小黑盒（Heybox）签到脚本 —— Surge 版
 * 由 Loon 版 heybox.js 转换：适配 Surge API，存储读写加 try/catch，通知内容脱敏。
 * 单文件双模式：
 *   - http-request 抓包：$request 存在时，保存 Cookie 与完整请求 URL（含签名参数）
 *   - cron 定时签到：$request 不存在时，读取已存凭据发起签到
 */

const cookieKey = "xhh_cookie";
const urlKey = "xhh_sign_url";
const scriptName = "小黑盒";

function notify(title, subtitle, body) {
    try {
        if (typeof $notification !== "undefined") {
            $notification.post(String(title), String(subtitle), String(body));
        }
    } catch (e) {}
}

// 脱敏：避免异常信息或 URL 意外携带完整 Cookie / 签名被推送到通知
function mask(str) {
    try {
        if (!str) return "";
        const s = String(str);
        if (s.length <= 12) return "***";
        return s.slice(0, 4) + "..." + s.slice(-4);
    } catch (e) {
        return "***";
    }
}

function readVal(key) {
    try {
        if (typeof $persistentStore !== "undefined") return $persistentStore.read(key);
    } catch (e) {}
    return null;
}

function writeVal(val, key) {
    try {
        if (typeof $persistentStore !== "undefined") return $persistentStore.write(String(val), key);
    } catch (e) {}
    return false;
}

function getCookie() {
    try {
        if ($request && $request.url && $request.headers) {
            const cookie = $request.headers["Cookie"] || $request.headers["cookie"];
            if (cookie) {
                writeVal(cookie, cookieKey);
                writeVal($request.url, urlKey);
                notify(scriptName, "凭据获取成功 🟢", "已保存最新 Cookie 与请求签名参数（仅存本机）");
            }
        }
    } catch (e) {}
    $done();
}

function checkIn() {
    const cookie = readVal(cookieKey);
    const savedUrl = readVal(urlKey);

    if (!cookie) {
        notify("小黑盒签到", "签到失败 ❌", "未找到 Cookie，请先打开小黑盒 App 触发抓包");
        $done();
        return;
    }

    // 若抓到的就是 task/sign 请求（签名参数最完整），直接复用；否则把 home_v2 换成 task/sign
    let signUrl = "https://api.xiaoheihe.cn/task/sign/";
    if (savedUrl) {
        if (savedUrl.indexOf("/task/sign") !== -1) {
            signUrl = savedUrl;
        } else if (savedUrl.indexOf("/account/home_v2/") !== -1) {
            signUrl = savedUrl.replace("/account/home_v2/", "/task/sign/");
        }
    }

    const request = {
        url: signUrl,
        headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
            "Cookie": cookie,
            "Referer": "http://api.maxjia.com/"
        }
    };

    try {
        $httpClient.get(request, (error, response, data) => {
            if (error) {
                notify("小黑盒签到", "请求异常 ❌", mask(error));
            } else {
                try {
                    const res = JSON.parse(data);
                    if (res.status === "ok") {
                        const streak = (res.result && res.result.sign_in_streak) || 1;
                        notify("小黑盒签到", "签到成功 🎉", "已连续签到 " + streak + " 天");
                    } else if (res.status === "login" || (res.msg && res.msg.indexOf("已签到") !== -1)) {
                        notify("小黑盒签到", "重复签到 ℹ️", res.msg || "今日已完成签到");
                    } else {
                        notify("小黑盒签到", "签到提示 ⚠️", res.msg || ("返回状态: " + res.status));
                    }
                } catch (e) {
                    notify("小黑盒签到", "解析失败 ❌", "返回数据非 JSON 格式");
                }
            }
            $done();
        });
    } catch (e) {
        notify("小黑盒签到", "请求异常 ❌", mask(e && e.message ? e.message : e));
        $done();
    }
}

if (typeof $request !== "undefined") {
    getCookie();
} else {
    checkIn();
}
