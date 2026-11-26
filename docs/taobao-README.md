# 淘宝去广告（Surge 模块）

保守净化淘宝开屏接口中的明确广告容器。保留商品、搜索、购物车、订单与支付数据；未知结构一律透传。

## 订阅

```
https://raw.githubusercontent.com/zhiaon/Modules/main/taobao.sgmodule
```

脚本自动同步（`script-update-interval=86400`，即 24 小时）。

## 作用范围

- 拦截对象：仅 `guide-acs.m.taobao.com` 上的 `mtop.taobao.wireless.home.splash.awesome.get` 开屏接口。
- 处理方式：关闭该响应中已有的开屏控制字段，并清空明确的广告素材地址。
- 明确不做：不添加整域 REJECT、不改证书、不读 Cookie、不删除 App 缓存、不清空首页配置、不拦通用商品视频与共享活动模板。

## 依赖

1. Surge 已开启「脚本」与「MITM」。
2. 已安装并信任 Surge CA 证书（否则 HTTPS 解密失败，模块不生效）。

```surge
[MITM]
hostname = %APPEND% guide-acs.m.taobao.com
```

模块内已包含该 MITM 追加行，启用模块时会自动追加。

## 兼容性说明

- 设计取向为**开屏保守兼容**：只动结构明确的广告键，遇到无法确认的字段一律原样返回，避免误改页面数据。
- 淘宝接口结构会变化。若新版 App 改了开屏字段名，本模块可能不生效（表现为广告照常显示），此时不会损坏其他数据。
- 当前版本**尚未经淘宝真实流量或真机界面验证**，验证依据为合成样本：69 项 Node 回归用例 + 14 项 Surge 脚本引擎用例，全部通过。
- 不声称可去全部广告，也不声称适配最新版淘宝。

## 版本

当前 `1.0`。无参数项，无需配置。

## 许可

MIT。脚本为独立实现，无网络请求、无存储、无账号访问。
