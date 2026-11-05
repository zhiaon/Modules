# 机场流量（Surge 面板模块）

在 Surge 的「策略 → 面板」里显示机场订阅的真实用量：总流量、已消耗、剩余、进度条、↑上行 ↓下行、下次重置日期、到期日。支持一屏看多个机场。

## 安装

```
surge:///install-module?url=https%3A%2F%2Fraw.githubusercontent.com%2Fzhiaon%2FModules%2Fmain%2Fairport.sgmodule
```

或手动：Surge → 首页 → 模块 → 右上角 + → 粘贴

```
https://raw.githubusercontent.com/zhiaon/Modules/main/airport.sgmodule
```

jsDelivr 备用地址：

```
https://cdn.jsdelivr.net/gh/zhiaon/Modules@main/airport.sgmodule
```

## 参数（装好后点模块 → 参数）

| 参数 | 说明 | 默认 |
|---|---|---|
| 机场名 `name` | 面板标题显示的名字。多个机场用 `;` 分隔，与订阅链接顺序一一对应 | 机场 |
| 订阅链接 `url` | 机场给的完整 https 订阅地址，带 `?token=` 和 `&` 的部分全部照抄。多个用 `;` 分隔 | https://example.com/sub |
| 重置日 `resetday` | 每月几号清零，1–31。填 31 遇到小月自动取月末 | 1 |
| UA `ua` | 拉订阅用的 User-Agent。提示「无流量头」时改成 `Surge/5.16.0` 或机场指定 UA | Clash/1.18.0 |
| 策略 `policy` | 拉订阅时强制的策略名，默认 `none` 跟随规则。机场域名直连拉不到时填节点组名 | none |

多机场示例：

```
机场名：花云;云梯
订阅链接：https://a.com/api/v1/client/subscribe?token=xx;https://b.com/api/v1/client/subscribe?token=yy
```

## 数据来源

订阅响应的 `Subscription-Userinfo` 响应头（V2board / SSPanel / 新 V2 通用）：

```
subscription-userinfo: upload=10737418240; download=53687091200; total=214748364800; expire=1798761600
```

脚本在本机发起请求，链接和 token 只存在本机模块参数里，不经过任何第三方中转。若机场不返回该头，会自动退化解析响应 body 的 JSON（`upload/download/total/expire`、`up/down/transfer_enable/expired_at` 等字段）。

拉取失败时优先显示上一次成功的缓存，并在内容里标注缓存时间，卡片变黄。

## 状态色

- 绿 `good`：用量 < 90%
- 黄 `alert`：≥ 90%，或部分机场拉取失败，或本次为缓存
- 红 `error`：≥ 100% 或全部失败
- 灰 `info`：未配置

## 自动刷新

`update-interval=600`，即打开面板时若距上次更新超过 10 分钟会自动刷新；也可点卡片刷新按钮手动拉。

## 文件

- `airport.sgmodule` — 模块本体（参数表 + Panel + Script）
- `surge_scripts/airport-panel.js` — 面板脚本
