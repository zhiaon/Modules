/*
 * DNS Cache Refresh — Surge iOS 面板脚本  V1.0
 *
 * 原理
 *   Surge 自带 HTTP API（iOS 4.4.0+）：
 *     POST /v1/dns/flush  清空 Surge 的 DNS 缓存（官方接口，无需 key）
 *     GET  /v1/dns        读取当前缓存内容（dnsCache = 已缓存解析，local = [Host] 静态映射）
 *   脚本内用 $httpAPI 直接调这两个接口，不发外部请求、不依赖第三方服务。
 *
 * 触发区分
 *   $trigger === "button"        用户点了卡片右上角刷新 → 执行刷新
 *   $trigger === "auto-interval" 按 update-interval 自动重算 → 只读状态，绝不清缓存
 *
 * 不清理什么（如实告知，不假装成功）
 *   · 设备系统 DNS 缓存（mDNSResponder）和 App 自带的 DoH/DoT 缓存 —— Surge 无权清理
 *   · [Host] / 模块里的静态映射（local 字段）—— 那是配置，不是缓存
 */

(function () {
    var PANEL_TITLE   = "DNS 清理缓存";
    var COOLDOWN_SEC  = 5;                    // 两次手动刷新的最小间隔，防连点刷爆
    var KEY_TS        = "dnsRefresh.lastTs";  // 上次刷新时间戳（毫秒）
    var KEY_TXT       = "dnsRefresh.lastText";// 上次刷新结果摘要

    var trigger  = (typeof $trigger === "string") ? $trigger : "";
    var isButton = (trigger === "button");

    // ---------- 工具 ----------
    function pad2(n) { return (n < 10 ? "0" : "") + n; }

    function clock(ms) {
        var d = new Date(ms);
        return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    }

    function finish(content, style) {
        $done({ title: PANEL_TITLE, content: content, style: style || "info" });
    }

    function save(tsMs, text) {
        try {
            $persistentStore.write(String(tsMs), KEY_TS);
            $persistentStore.write(text, KEY_TXT);
        } catch (e) { /* 存储失败不影响主流程 */ }
    }

    function lastText() {
        var t = null;
        try { t = $persistentStore.read(KEY_TXT); } catch (e) {}
        return t || "从未刷新";
    }

    function notify(sub, body) {
        try { $notification.post(PANEL_TITLE, sub, body); } catch (e) {}
    }

    // ---------- 读缓存快照 ----------
    // cb(err, {cache, local})
    function readCache(cb) {
        var called = false;
        function once(err, val) { if (called) return; called = true; cb(err, val); }

        if (typeof $httpAPI !== "function") {
            return once(new Error("当前 Surge 不支持 $httpAPI（需 iOS 4.4.0+）"));
        }
        try {
            $httpAPI("GET", "/v1/dns", null, function (r) {
                if (!r || typeof r !== "object") return once(new Error("GET /v1/dns 无返回"));
                if (r.error) return once(new Error(String(r.error)));
                var cache = (r.dnsCache && r.dnsCache.length !== undefined) ? r.dnsCache : [];
                var local = (r.local    && r.local.length    !== undefined) ? r.local    : [];
                once(null, { cache: cache.length, local: local.length });
            });
        } catch (e) {
            once(e);
        }
    }

    // ---------- 调官方清缓存接口 ----------
    function flushCache(cb) {
        var called = false;
        function once(err) { if (called) return; called = true; cb(err); }
        try {
            $httpAPI("POST", "/v1/dns/flush", {}, function (r) {
                if (r && r.error) return once(new Error(String(r.error)));
                once(null);
            });
        } catch (e) {
            once(e);
        }
    }

    // ---------- 分支一：自动刷新 / 其他触发，只显示状态 ----------
    function showStatus() {
        readCache(function (err, st) {
            if (err) {
                return finish(
                    "状态: 读取失败\n" +
                    "原因: " + err.message + "\n\n" +
                    "点卡片右上角 ⟳ 可尝试执行一次刷新",
                    "error");
            }
            finish(
                "缓存条目: " + st.cache + " 条\n" +
                "本地映射: " + st.local + " 条（配置，不清理）\n" +
                "上次刷新: " + lastText() + "\n" +
                "点右上角 ⟳ 执行刷新",
                "info");
        });
    }

    // ---------- 分支二：点按钮，真刷新 ----------
    function doFlush() {
        var lastTs = 0;
        try { lastTs = parseInt($persistentStore.read(KEY_TS) || "0", 10) || 0; } catch (e) {}
        var since = Date.now() - lastTs;

        // 冷却：连点不重复清，省资源
        if (lastTs && since < COOLDOWN_SEC * 1000) {
            var wait = Math.ceil((COOLDOWN_SEC * 1000 - since) / 1000);
            return finish(
                "状态: 已跳过\n" +
                "原因: " + Math.floor(since / 1000) + " 秒前刚刷过\n" +
                "冷却: " + wait + " 秒后可再执行\n" +
                "上次结果: " + lastText(),
                "alert");
        }

        readCache(function (err, before) {
            if (err) {
                return finish(
                    "状态: 刷新失败\n" +
                    "阶段: 读取刷新前状态\n" +
                    "原因: " + err.message,
                    "error");
            }

            flushCache(function (ferr) {
                // 接口本身报错：这是真失败，不粉饰
                if (ferr) {
                    save(Date.now(), "刷新失败: " + ferr.message);
                    notify("刷新失败", ferr.message);
                    return finish(
                        "状态: 刷新失败\n" +
                        "刷新前: " + before.cache + " 条\n" +
                        "原因: " + ferr.message,
                        "error");
                }

                // 接口成功后再回读一次做交叉验证（稍等，让内核释放条目）
                setTimeout(function () {
                    readCache(function (err2, after) {
                        var t = clock(Date.now());

                        if (err2) {
                            save(Date.now(), "已执行，未复核 · " + t);
                            notify("已执行，未复核", "清缓存接口调用成功，回读失败: " + err2.message);
                            return finish(
                                "状态: 已执行（未复核）\n" +
                                "刷新前: " + before.cache + " 条\n" +
                                "原因: 回读失败 · " + err2.message + "\n" +
                                "时间: " + t,
                                "alert");
                        }

                        // 本来就没有缓存
                        if (before.cache === 0) {
                            save(Date.now(), "缓存本来为空 · " + t);
                            notify("DNS 缓存刷新完成", "缓存原本为空，无条目可清");
                            return finish(
                                "状态: 刷新完成（缓存本来为空）\n" +
                                "刷新前: 0 条 / 刷新后: " + after.cache + " 条\n" +
                                "时间: " + t,
                                "good");
                        }

                        // 条数减少 = 确实清掉了
                        if (after.cache < before.cache) {
                            save(Date.now(), "刷新完成 " + before.cache + " → " + after.cache + " 条 · " + t);
                            notify("DNS 缓存刷新完成",
                                "已清 " + (before.cache - after.cache) + " 条（" + before.cache + " → " + after.cache + "）");
                            return finish(
                                "状态: 刷新完成\n" +
                                "刷新前: " + before.cache + " 条\n" +
                                "刷新后: " + after.cache + " 条\n" +
                                "已清: " + (before.cache - after.cache) + " 条 · " + t,
                                "good");
                        }

                        // 接口返回成功但条数没降：可能刚被 App 重新查询，也可能没生效 —— 如实说，不算成功
                        save(Date.now(), "已执行，复核未减少 · " + t);
                        notify("DNS 刷新已执行",
                            "复核时条目未减少（" + before.cache + " → " + after.cache + "），详情见面板");
                        finish(
                            "状态: 已执行，复核未减少\n" +
                            "刷新前: " + before.cache + " 条\n" +
                            "刷新后: " + after.cache + " 条\n" +
                            "原因: 接口返回成功，但复核条数未降 —— 多为刚被 App 重新查询，也可能是接口未生效\n" +
                            "建议: 关掉正在联网的 App 再点一次\n" +
                            "时间: " + t,
                            "alert");
                    });
                }, 500);
            });
        });
    }

    // ---------- 入口 ----------
    try {
        if (isButton) {
            doFlush();
        } else {
            showStatus();
        }
    } catch (e) {
        finish("状态: 脚本异常\n原因: " + (e && e.message ? e.message : String(e)), "error");
    }
})();
