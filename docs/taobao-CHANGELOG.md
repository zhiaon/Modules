# 变更记录：淘宝去广告

## 1.0

首个公开发布版本。

- 新增模块 `taobao.sgmodule`，匹配 `guide-acs.m.taobao.com` 的开屏接口 `mtop.taobao.wireless.home.splash.awesome.get`。
- 新增脚本 `surge_scripts/taobao-clean.js`，`type=http-response`，`requires-body=true`，`max-size=2097152`，`full-header-mode=true`，`timeout=10`。
- 处理逻辑：关闭响应中已存在的开屏控制字段，清空明确的广告素材地址；商品、搜索、购物车、订单、支付数据保持不变；无法识别的结构原样透传。
- 安全边界：不添加整域 REJECT、不修改证书、不读取 Cookie、不删除 App 缓存、不清空首页配置、不拦截通用商品视频与共享活动模板。
- 脚本无网络请求、无本地存储、无账号访问。
- 附加 `[MITM] hostname = %APPEND% guide-acs.m.taobao.com`。
- 脚本自动同步周期 `86400` 秒。
- 验证：69 项 Node 合成回归用例 + 14 项 Surge 脚本引擎合成用例，全部通过。尚未进行淘宝真实响应抓取与真机界面验证。
