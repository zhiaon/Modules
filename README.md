# Surge Modules

<p align="center">
  <img src="https://img.shields.io/badge/Surge-iOS%20%7C%20macOS-blue?style=flat-square" alt="Surge">
  <img src="https://img.shields.io/badge/Modules-45-brightgreen?style=flat-square" alt="Modules">
  <img src="https://img.shields.io/github/last-commit/zhiaon/Modules?style=flat-square" alt="Last Commit">
</p>

自用与整理的 **Surge 模块（`.sgmodule`）** 仓库，共收录 **45 个** 模块，涵盖去广告净化、功能增强、自动签到、网络监控面板、生活效率提醒与分流修复。

---

## 目录

- [仓库结构](#仓库结构)
- [模块列表](#模块列表)
  - [去广告与净化](#去广告与净化)
  - [功能增强与解锁](#功能增强与解锁)
  - [自动签到与任务](#自动签到与任务)
  - [网络与监控面板](#网络与监控面板)
  - [生活、效率与提醒](#生活效率与提醒)
  - [分流与网络修复](#分流与网络修复)
- [使用教程](#使用教程)
  - [1. 导入模块](#1-导入模块)
  - [2. 配置 MitM（如模块需要）](#2-配置-mitm如模块需要)
  - [3. 自定义模块参数](#3-自定义模块参数)
- [常见问题 (FAQ)](#常见问题-faq)
- [安全与免责声明](#安全与免责声明)

---

## 仓库结构

```text
Modules/
├── *.sgmodule          # Surge 模块文件（根目录）
├── surge_scripts/      # 模块配套脚本
└── docs/               # 部分模块的说明与更新日志
```

---

## 模块列表

> **提示**：点击「Raw 链接」可直接复制地址并在 Surge 中安装；带 `可配参数` 标签的模块支持在 Surge 内直接修改 `#!arguments`。

### 去广告与净化

| 模块名称 | 版本 | 功能说明 | 能力 / 依赖 | Raw 链接 |
| :--- | :---: | :--- | :--- | :---: |
| **酷安去广告** | `v1.0.1` | 清理酷安三个列表接口中明确标记为 sponsorCard 的推广卡片；普通推荐、热帖与未知结构原样放行，全广告页为避免分页异常保留原响应。 | `Script` `MITM` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/coolapk.sgmodule) |
| **番茄小说去广告** | `v1.26.1` | 番茄小说去广告：拦截广告素材、广告 SDK 与统计回传域名，保留正文、书架与抖音商城等共享电商链路。番茄存在证书固定，模块以域名与规则集为主，不依赖脚本改写接口。 | `MITM` `Rule` `URL Rewrite` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/fanqie.sgmodule) |
| **黑料不打烊净化** | `v1.0.0` | 拦截黑料网各线路的统计与广告域名请求，并覆盖网页请求的 Accept-Encoding 头，避免响应被压缩后无法处理。 | `MITM` `URL Rewrite` `Header Rewrite` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/heiliao-adblock.sgmodule) |
| **红果短剧去广告** | `v1.4.1` | 红果短剧去广告：域名与广告 SDK 规则，并对正常业务域内的 /api/ad/ 请求返回空 JSON。接口内下发的广告需该响应改写才能拦截，需开启 MITM；若遇证书固定导致异常可停用本模块。 | `MITM` `Rule` `URL Rewrite` `Map Local` `Host` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/hongguo.sgmodule) |
| **PAKO 自用去广告** | `v1.0.0` | 拦截插件中列出的开屏广告、广告接口及相关广告资源请求。 | `MITM` `URL Rewrite` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/pako-adblock.sgmodule) |
| **拼多多去广告** | `v1.0.1` | 拼多多去广告：过滤首页接口中明确标记的推广商品，开屏接口返回已观察到的空结果；未知结构与全广告页原样放行。 | `Script` `MITM` `Map Local` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/pinduoduo.sgmodule) |
| **七猫小说去广告** | `v1.1.6` | 七猫小说去广告：拦截广告 SDK、广告素材与统计回传域名，保留正文与书籍数据。 | `Script` `MITM` `Rule` `URL Rewrite` `Map Local` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/qimao.sgmodule) |
| **淘宝去广告** | `v1.0.1` | 淘宝开屏净化：仅处理开屏接口中明确标记的广告容器，关闭开屏控制字段并清空广告素材地址；商品、搜索、购物车、订单与支付数据原样保留。需开启脚本与 MITM 并信任 Surge CA。 | `Script` `MITM` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/taobao.sgmodule) |
| **小红书去广告** | `v1.0.0` | 拦截小红书 QUIC 流量，替换惊喜弹窗与信息流推广接口为空响应，清除评论区图片水印，并对搜索、开屏、详情、信息流与水印接口应用净化脚本。 | `Script` `MITM` `Rule` `Map Local` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/xiaohongshu-adblock.sgmodule) |
| **YouTube 去广告** | `v1.0.0` | 拦截 YouTube 播放与信息流接口的广告配置，提供后台播放、字幕目标语言与日志记录开关；依赖当前 YouTube 接口协议与 MITM。 | `Script` `MITM` `Rule` `Header Rewrite` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/youtube-adblock.sgmodule) |

### 功能增强与解锁

| 模块名称 | 版本 | 功能说明 | 能力 / 依赖 | Raw 链接 |
| :--- | :---: | :--- | :--- | :---: |
| **AdGuard Safari 扩展解锁** | `v1.0.0` | 修改 AdGuard Safari 扩展收据校验响应，将产品状态设为 ACTIVE 以解锁高级功能 | `Script` `MITM` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/adguard-safari-unlock.sgmodule) |
| **彩云天气VIP解锁** | `v1.0.1` | 彩云天气净化与会员解锁：拦截广告请求，清空首页活动与推荐位，改写会员接口返回长期 SVIP，为卫星云图与 48 小时预报请求补充鉴权头。 | `Script` `MITM` `Rule` `Map Local` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/caiyun-weather.sgmodule) |
| **Spotify 增强** | `v1.0.0` | 移除音频广告并恢复歌手列表正常展示，可选移除底栏创建按钮、关闭 Apple 设备接力；通过百度翻译 API 将非中文歌词汉化。 | `Script` `MITM` `Rule` `URL Rewrite` `Map Local` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/spotify-enhance.sgmodule) |
| **Trakt 中文与播放器跳转** | `v1.0.0` | 为 Trakt 电影、剧集与单集详情补全简体中文标题和简介，并在简介中添加 Infuse、Forward 与 Rex 搜索跳转链接。 | `Script` `MITM` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/trakt-zh-redirect.sgmodule) |
| **Telegram 外链跳转** | `v1.0.0` | 将 t.me 外链按所选第三方 Telegram 客户端跳转打开；sg = Swiftgram，turrit = Turrit。未命中或参数非法时原样放行。 | `Script` `MITM` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/telegram-jump.sgmodule) |
| **Telegram 跳转 Nagram** | `v1.0.0` | 将 t.me 链接通过 307 重定向至 Telegram 的 Nagram 解析链接。 | `MITM` `URL Rewrite` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/telegram-nagram-redirect.sgmodule) |

### 自动签到与任务

| 模块名称 | 版本 | 功能说明 | 能力 / 依赖 | Raw 链接 |
| :--- | :---: | :--- | :--- | :---: |
| **百度贴吧签到** | `v1.0.0` | 百度贴吧每日签到：自动捕获登录 Cookie，按设定时间调度签到，账号信息仅保存在本机。 | `Script` `MITM` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/baidu-tieba-checkin.sgmodule) |
| **iKuuu 每日签到** | `v1.3.1` | iKuuu 每日签到：按设定时间签到，另有每 10 分钟本地补签检查；Cookie 失效时等待重新登录，当天成功后不重复提交，可选通知服务器回执与剩余流量。 | `Script` `MITM` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/ikuuu.sgmodule) |
| **多平台签到** | `v1.0.1` | 多平台签到中心：统一调度贴吧与 B 站签到，支持 Cookie 自动捕获、各平台独立开关与时间、失败重试与只读面板；账号数据仅保存在本机，签到结果以接口回执为准。 | `Panel` `Script` `MITM` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/multi-platform-checkin.sgmodule) |
| **PingMe 自动助手** | `v1.0.2` | 自动抓取多个账号凭据并按定时执行签到与视频奖励；运行后输出每个账号的余额、签到与视频结果，到结算时间推送当日汇总。 | `Script` `MITM` `Rule` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/pingme-auto.sgmodule) |
| **WeTalk 自动助手** | `v1.0.0` | 自动抓取账号凭据并按定时执行签到与刷视频奖励；运行后输出每个账号的余额、签到与视频结果，到结算时间推送当日汇总。 | `Script` `MITM` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/wetalk-auto.sgmodule) |
| **小黑盒签到** | `v1.0.0` | 打开小黑盒App自动获取Cookie与签名参数，按设定时间每日定时发起签到；凭据仅保存在本机，通知内容脱敏。 | `Script` `MITM` `Rule` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/xiaoheihe-checkin.sgmodule) |

### 网络与监控面板

| 模块名称 | 版本 | 功能说明 | 能力 / 依赖 | Raw 链接 |
| :--- | :---: | :--- | :--- | :---: |
| **CF IP 优选工具** | `v3.7.3` | Cloudflare 官方 IP 段优选：以 DIRECT 直连测速，扫描期间仅 speed.cloudflare.com 走固定地址并直连，结束后恢复；结果在网页工作台查看与调整。 | `Panel` `Script` `MITM` `Rule` `Host` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/cf-ip-optimizer.sgmodule) |
| **DNS 清理缓存** | `v1.0.1` | 一键刷新 Surge DNS 缓存：卡片显示缓存条目数与上次刷新时间，点击后执行刷新并回读条目数核对，成功、未生效或失败都如实显示。 | `Panel` `Script` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/dnsrefresh.sgmodule) |
| **双出口 IP 面板** | `v1.1.1` | 双出口面板：分别显示两路出口的 IP、IPv4/IPv6、国家省市、运营商、ASN、时区与每路查询耗时，右上角可立即刷新。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/dual-ip.sgmodule) |
| **网络IP信息** | `v1.2.1` | 网络 IP 信息面板：显示本机公网 IP，以及各策略组的真实入口 IP 与节点落地 IP、位置与运营商；兜底组常驻不受参数影响，首行显示 Wi-Fi 名。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/ipinfo.sgmodule) |
| **IP纯净度** | `v1.1.1` | 出口风险面板：显示 IP、位置、ASN、风险分与 VPN/代理/Tor/机房标签，可点击刷新，每 30 分钟自动刷新。风险分不是纯净度百分比，未匹配不代表安全。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/ippurity.sgmodule) |
| **机场流量** | `v1.1.1` | 机场流量面板：填写机场名、订阅链接与每月重置日，显示各机场已用与剩余流量；不用的组留空即可。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/jichang.sgmodule) |
| **内存流量Tailscale实时监控** | `v2.1.0` | 显示 Surge 内存、运行时长、接口实时上下行速率和累计流量，自动识别 Tailscale 策略并展示出口、DERP、TCP/UDP 连接及在线设备。通过内置 MCP 只读获取数据，无需填写端口或密钥。 | `Panel` `Script` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/memory-traffic.sgmodule) |
| **网络信息 𝕏** | `v1.0.0` | 查询并展示当前网络信息：直连与落地 IP、运营商与位置、代理策略、SSID 与局域网地址；支持通知推送与 Surge 面板定时刷新显示。 | `Panel` `Script` `MITM` `Rule` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/network-info.sgmodule) |
| **流媒体解锁** | `v1.3.1` | 流媒体解锁检测：对每个策略组发真实请求，逐平台显示 Netflix、Disney+、YouTube、Prime Video、Spotify、HBO Max、Hulu、Paramount+、Peacock、Viu、Abema、巴哈动画疯、B站港澳台与 ChatGPT、Claude、Gemini 的实际可见地区。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/streaming.sgmodule) |
| **Surge 运行监控** | `v1.2.1` | Surge 运行监控卡片：显示运行时长、启动时间、配置重载、物理内存、采样峰值与活动连接；20 秒内连点两次刷新才会重启引擎。需 Surge iOS 6 以上并开启 http-api-mcp。 | `Panel` `Script` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/surge-runtime.sgmodule) |
| **Surge域名规则采集器** | `v0.1.1` | 本地采集命中域名并生成分流规则候选：按 60 秒合并同一域名的命中次数，提供管理页面查看与导出。无需 MITM；无法覆盖 IP 直连、预匹配或更早终结的规则，采集规则需放在普通规则最前，不会自动写入配置。 | `Panel` `Script` `Rule` `Host` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/DomainCollector.sgmodule) |

### 生活、效率与提醒

| 模块名称 | 版本 | 功能说明 | 能力 / 依赖 | Raw 链接 |
| :--- | :---: | :--- | :--- | :---: |
| **API余额总览** | `v1.0.1` | 汇总 OpenAI / One API / New API 风格账户的余额，面板显示各账户余额与更新时间，余额跌破阈值时通知。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/api-balance-overview.sgmodule) |
| **App Store降价提醒** | `v1.0.1` | 监测指定应用在指定地区的 App Store 本体价格：首次静默建立基线，之后降价才通知，面板显示当前价格与更新时间。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/appstore-price-alert.sgmodule) |
| **地震速报（中国地震台网）** | `v1.2.2` | 中国地震台网速报提醒：按手动填写的位置与半径筛选地震事件，为新事件发送带系统声音的通知。这是震后速报，不是震前预警；脚本不能读取手机 GPS。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/earthquake-alert.sgmodule) |
| **追更提醒** | `v1.4.1` | 追更提醒：从 360 影视、优酷、腾讯视频搜索中文剧，Bangumi 与 TVmaze 补充信息，仅匹配精确的正片更新标记，首次静默、跨源去重后通知。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/episode-watch.sgmodule) |
| **汇率显示面板** | `v1.1.1` | 汇率面板：显示 1 单位外币等于多少基准货币，小面值币种自动按 100 或 1000 单位显示，并标注数据更新时间。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/exchange-rates.sgmodule) |
| **出门天气卡** | `v1.1.1` | 出门天气卡：显示当前天气与体感、今日高低温、降水概率与雨量、湿度风力、紫外线、空气质量、日出日落、气压能见度阵风及未来 6 小时逐时预报，并给出雨伞、穿衣、运动、体感四项出门指数；每天 07:30 推送摘要。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/going-out-weather.sgmodule) |
| **版本更新雷达** | `v1.0.1` | 版本更新雷达：监测指定 GitHub 仓库的 Release，首次静默建立基线，之后出现新版本才通知并在面板列出。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/release-radar.sgmodule) |
| **RSS订阅** | `v1.0.1` | RSS 订阅面板：订阅 RSS 与 Atom 源并列出最新条目，首次只建立基线，之后出现新内容才通知。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/rss-reader.sgmodule) |
| **今日入账** | `v1.3.1` | 今日入账面板：显示今日收入、预计总额、计薪工时、工作进度、两段用餐休息与下班倒计时，以及本月累计与含本班合计；纯本地计算，每 60 秒刷新。 | `Panel` `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/salary-widget.sgmodule) |
| **TestFlight 多链接名额监控** | `v1.0.2` | TestFlight 名额监控：按分钟步进检查多个公开 TF 链接，名额重新开放或状态变化时通知；多链接独立去重，不强制唤醒，不自动报名。 | `Script` `可配参数` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/tf-monitor.sgmodule) |

### 分流与网络修复

| 模块名称 | 版本 | 功能说明 | 能力 / 依赖 | Raw 链接 |
| :--- | :---: | :--- | :--- | :---: |
| **Apple 推送代理** | `v1.0.0` | 将 Apple Push 与相关 CDN 域名及 IP 网段流量分流至 Proxy 策略组。 | `Rule` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/apple-push-proxy.sgmodule) |
| **GitHub 429 繁中修复** | `v1.0.0` | 将 GitHubusercontent 请求的 Accept-Language 覆盖为 zh-Hant。 | `MITM` `Header Rewrite` | [获取](https://raw.githubusercontent.com/zhiaon/Modules/main/github-429-zh-hant.sgmodule) |

---

## 使用教程

### 1. 导入模块

#### Surge iOS
1. 复制上方表格中对应模块的 **Raw 链接**。
2. 打开 Surge，进入 **「模块」** 页面。
3. 点击右上角 **「安装新模块」** → **「从 URL 下载」**，粘贴链接并确认。
4. 在模块列表中开启对应开关即可。

#### Surge macOS
1. 打开 Surge 主界面，进入 **「模块 (Module)」** 标签页。
2. 点击左下角 **`+`** → **「从 URL 安装」**，粘贴 Raw 链接并启用。

---

### 2. 配置 MitM（如模块需要）

标注了 `MITM` 与 `Script` 的模块依赖 **MitM（中间人解密）** 与 **脚本** 功能，首次使用请按以下步骤配置：

1. 在 Surge 中开启 **「MitM」** 与 **「脚本」** 总开关。
2. 进入 **MitM → 配置根证书**：
   - 点击 **「生成新的 CA 证书」** 并安装描述文件。
   - **iOS**：前往系统 `设置 → 通用 → 关于本机 → 证书信任设置`，开启对 Surge 根证书的完全信任。
   - **macOS**：在「钥匙串访问」中找到 Surge 证书，将其信任设置改为 **「始终信任」**。
3. 确保模块中声明的 `hostname` 未被其他配置覆盖或禁用。

---

### 3. 自定义模块参数

标注了 `可配参数` 的模块在头部包含 `#!arguments` 字段，可在 Surge 中直接修改参数而无需编辑源码：

1. 在 Surge 模块列表中长按（或右键）已安装的模块，选择 **「编辑参数」**（或进入模块详情页）。
2. 按参数说明填入对应值（如 Cron 定时、策略组名、订阅链接、开关选项等）。
3. 保存后重新加载配置即可生效。

---

## 常见问题 (FAQ)

<details>
<summary><strong>Q1：安装模块后没有效果怎么办？</strong></summary>

1. 确认 **MitM** 和 **脚本** 总开关已开启。
2. 检查系统设置中是否已**完全信任** Surge 的 CA 根证书。
3. 尝试彻底关闭目标 App（从后台划掉）后重新打开，或清除 App 缓存。
4. 检查是否同时启用了多个功能重叠的模块导致规则/脚本冲突。

</details>

<details>
<summary><strong>Q2：开启太多模块会耗电或卡顿吗？</strong></summary>

会的。MitM 解密域名越多、正则匹配脚本越复杂，CPU 与内存开销越大。建议**只启用自己日常使用的模块**，不用的模块及时关闭。

</details>

<details>
<summary><strong>Q3：如何更新已安装的模块？</strong></summary>

在 Surge 的「模块」页面中，点击右上角菜单选择 **「更新所有外部模块」**，或长按单个模块选择 **「更新」**。

</details>

<details>
<summary><strong>Q4：为什么部分 App 依然有开屏广告？</strong></summary>

部分 App 会在本地缓存广告素材，或使用 QUIC / HTTP3 协议绕过 MitM。可尝试：
- 卸载重装或清除 App 缓存；
- 在 Surge 中开启 **「丢弃 QUIC 流量」**（或使用拦截 QUIC 的规则）。

</details>

<details>
<summary><strong>Q5：监控类面板提示需要 http-api-mcp 怎么办？</strong></summary>

部分系统监控面板（如 `Surge 运行监控`、`内存流量Tailscale实时监控`）通过 Surge 6 内置 MCP 只读接口获取数据，请确保使用 **Surge iOS 6+** 并在配置中开启 `http-api-mcp`。

</details>

---

## 安全与免责声明

1. **隐私安全**：启用 MitM 意味着 Surge 将解密对应 `hostname` 的 HTTPS 流量。本仓库所有自研与整理脚本均开源透明，签到类模块的账号凭据仅保存在本机 `persistentStore` 中，**不包含任何上传用户隐私的代码**。建议在安装任何第三方模块前自行审查脚本内容。
2. **使用范围**：本仓库内容仅供个人学习、研究与网络调试使用，**严禁用于任何商业用途或违反当地法律法规的行为**。
3. **版权归属**：部分脚本与规则收集整理自开源社区，版权归原作者所有。如有侵权，请提交 Issue 联系删除。
