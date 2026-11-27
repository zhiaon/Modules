// PingMe_GetCookie.js (自愈去重 + 幽灵账号自动清理 + 真实序号校准)
const scriptName = 'PingMe Cookie获取';
const storeKey = 'pingme_accounts_v1';
// Surge has no plugin-level conditional, so honour the module switch here.
if (typeof $argument === 'string' && /^\s*capture=false\s*$/.test($argument)) { $done({}); }

const isLoon = typeof $loon !== "undefined" || typeof $httpClient !== "undefined";
const isQX = typeof $task !== "undefined";

function readVal(key) {
    if (isLoon) return $persistentStore.read(key);
    if (isQX) return $prefs.valueForKey(key);
    return null;
}

function writeVal(val, key) {
    if (isLoon) return $persistentStore.write(String(val), key);
    if (isQX) return $prefs.setValueForKey(String(val), key);
    return false;
}

function notify(title, subtitle, body) {
    if (isLoon) $notification.post(String(title), String(subtitle), String(body));
    if (isQX) $notify(String(title), String(subtitle), String(body));
}

// 5秒防抖：避免连续请求导致同一个账号瞬间连弹多次通知
function isDebounced(identifier, intervalMs = 5000) {
    const now = Date.now();
    const lastKey = `pingme_cookie_notify_${identifier}`;
    let lastTime = 0;
    try {
        const val = readVal(lastKey);
        if (val) lastTime = parseInt(val, 10);
    } catch (e) {}

    if (now - lastTime < intervalMs) return true;
    writeVal(String(now), lastKey);
    return false;
}

function normalizeHeaderNameMap(headers) {
    const out = {};
    Object.keys(headers || {}).forEach(k => out[k] = headers[k]);
    return out;
}

function parseRawQuery(url) {
    const query = (url.split('?')[1] || '').split('#')[0];
    const rawMap = {};
    query.split('&').forEach(pair => {
        if (!pair) return;
        const idx = pair.indexOf('=');
        if (idx < 0) return;
        rawMap[pair.slice(0, idx)] = pair.slice(idx + 1);
    });
    return rawMap;
}

function loadStore() {
    const raw = readVal(storeKey);
    if (!raw) return { version: 1, accounts: {}, order: [] };
    try {
        const obj = JSON.parse(raw);
        if (!obj.accounts) obj.accounts = {};
        if (!Array.isArray(obj.order)) obj.order = Object.keys(obj.accounts);
        return obj;
    } catch (e) {
        return { version: 1, accounts: {}, order: [] };
    }
}

function saveStore(store) {
    writeVal(JSON.stringify(store), storeKey);
}

// ⭐️ 核心自愈函数：彻底清除老版本留下的 12 位 MD5 幽灵哈希账号，确保序号真实不虚标
function cleanAndNormalizeStore(store) {
    const cleanAccounts = {};
    const cleanOrder = [];
    const seenEmails = new Set();

    const allKeys = Array.from(new Set([...(store.order || []), ...Object.keys(store.accounts || {})]));

    for (const key of allKeys) {
        const acc = store.accounts[key];
        if (!acc) continue;

        // 提取并强行归一化邮箱 (小写 + 解码)
        let email = '';
        if (acc.capture && acc.capture.paramsRaw && acc.capture.paramsRaw.email) {
            try { email = decodeURIComponent(acc.capture.paramsRaw.email).trim().toLowerCase(); } catch (e) {}
        }
        if (!email && acc.alias && acc.alias.includes('@')) {
            email = acc.alias.trim().toLowerCase();
        }
        if (!email && key && key.includes('@')) {
            email = key.trim().toLowerCase();
        }

        // 过滤：如果这个账号既没有邮箱也不是有效账号（纯旧版幽灵哈希），直接彻底丢弃！
        if (!email || email.length < 5) continue;

        if (!seenEmails.has(email)) {
            seenEmails.add(email);
            acc.id = email;
            acc.alias = email;
            cleanAccounts[email] = acc;
            cleanOrder.push(email);
        }
    }

    store.accounts = cleanAccounts;
    store.order = cleanOrder;
    return store;
}

// ================= 主逻辑 =================
try {
    if (typeof $request !== 'undefined' && $request.url) {
        const paramsRaw = parseRawQuery($request.url);
        const headersMap = normalizeHeaderNameMap($request.headers || {});
        
        let baseUA = '';
        Object.keys(headersMap).forEach(k => { 
            if (k.toLowerCase() === 'user-agent') baseUA = headersMap[k]; 
        });

        // 1. 提取并强行归一化邮箱
        let rawEmail = paramsRaw['email'] || '';
        let email = '';
        try { 
            email = rawEmail ? decodeURIComponent(rawEmail).trim().toLowerCase() : ''; 
        } catch (e) { 
            email = rawEmail.toLowerCase(); 
        }

        // 如果不是包含 @ 的有效邮箱直接跳过
        if (!email || !email.includes('@')) {
            $done({});
            return;
        }

        let store = loadStore();
        // ⭐️ 每次捕获前先自动自愈清理一次，干掉之前堆积的所有幽灵垃圾数据
        store = cleanAndNormalizeStore(store);

        const now = Date.now();
        const existed = !!store.accounts[email];

        if (existed) {
            const oldAcc = store.accounts[email];
            store.accounts[email] = {
                id: email,
                alias: email,
                uaSeed: oldAcc.uaSeed !== undefined ? oldAcc.uaSeed : store.order.indexOf(email),
                baseUA: baseUA || oldAcc.baseUA,
                capture: { url: $request.url, paramsRaw, headers: headersMap },
                createdAt: oldAcc.createdAt || now,
                updatedAt: now
            };

            // 重新校准绝对序号
            if (!store.order.includes(email)) {
                store.order.push(email);
            }
            saveStore(store);

            const accIndex = store.order.indexOf(email) + 1;
            const total = store.order.length;

            console.log(`[${scriptName}] 🔄 账号已存在: ${email} (实际序号: ${accIndex}/${total})`);

            if (!isDebounced(email, 5000)) {
                notify(
                    `${scriptName} 🔄 账号已存在`,
                    `邮箱: ${email}`,
                    `📌 真实序号: 第 ${accIndex} 个 (共 ${total} 个有效账号)\n✅ Token 凭证已静默更新！`
                );
            }
        } else {
            // 新账号入库
            store.order.push(email);
            store.accounts[email] = {
                id: email,
                alias: email,
                uaSeed: store.order.length - 1,
                baseUA,
                capture: { url: $request.url, paramsRaw, headers: headersMap },
                createdAt: now,
                updatedAt: now
            };
            saveStore(store);

            const accIndex = store.order.length;
            const total = store.order.length;

            console.log(`[${scriptName}] 🎉 新增有效账号: ${email} (真实序号: ${accIndex}/${total})`);

            notify(
                `${scriptName} 🎉 发现新账号`,
                `邮箱: ${email}`,
                `✅ 账号已录入！\n📊 真实库中共有 ${total} 个有效账号`
            );
        }
    }
} catch (error) {
    console.log(`❌ [${scriptName}] 运行崩溃: \n${error.message}`);
} finally {
    $done({});
}
