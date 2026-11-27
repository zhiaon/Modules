// PingMe_Clean.js — Surge 兼容版：优先 $persistentStore，Loon/QX 作为后备
const storeKey = 'pingme_accounts_v1';

function cleanNotify(title, subtitle, body) {
    if (typeof $notification !== 'undefined' && $notification && $notification.post) $notification.post(title, subtitle, body);
    else if (typeof $notify === 'function') $notify(title, subtitle, body);
}

try {
    if (typeof $persistentStore !== 'undefined' && $persistentStore) {
        $persistentStore.write('', storeKey);
    } else if (typeof $prefs !== 'undefined' && $prefs) {
        $prefs.removeValueForKey(storeKey);
    }
    cleanNotify('PingMe 清理', '✅ 历史账号数据已清空', '请重新打开 PingMe App 获取最新的账号数据！');
    console.log('PingMe 历史账号数据已清空，请重新抓包获取！');
} catch (e) {
    console.log('清理失败: ' + (e && e.message));
}
$done();
