# 更新日志

## v1.1.5 (2026-10-28)

第 10 章截图确认 v1.1.4 后广告仍在：同一淘宝双 11 创意同时出现在章节间大卡片和底部横幅，角标均为汇川广告。v1.1.4 的 `api-cfg operation` 拒绝与 UC 生态域名没有去掉它，说明下发路径不是 `huichuan.sm.cn` 主域名。

- 新增 `hc-ssp.sm.cn`（汇川 SSP，公开广告规则表中与 `huichuan.sm.cn` 同列）
- 新增 `ai.advertisement.alibabacorp.sm.cn`（阿里广告，CNAME 指向阿里广告桥接域名）
- 新增 `DOMAIN-SUFFIX,reachmax.cn`（阿里 ReachMax 程序化广告，含 `v2.reachmax.cn`）
- 模块描述保持简化版“移除七猫小说广告。”，版本 1.1.4 的描述简化改动已包含在内

如 v1.1.5 更新并重启清缓存后广告仍在，则下发极可能走七猫自家证书固定接口，域名拦截已无法覆盖，届时需要 Surge 请求日志才能继续定位。

---

## v1.1.4 (2026-10-28)

针对阅读页底部汇川横幅（第 6 章截图，底部视频横幅标“汇川广告”）在 v1.1.3 后仍在：

- **补 `api-cfg.wtzw.com/v*/operation` 拒绝**：此前模块只对带 `ad_personal_switch` 参数的 operation 接口返回空 JSON，运营位配置仍可下发；其他七猫模块（如 fmz200/wool_scripts）对该接口是直接拒绝，本版跟进。
- **补 UC / 汇川生态广告域名**：`partner.sm.cn`、`iflow.sm.cn`、`iflow.uczzd.cn`、`m.uczzd.cn`、`client.video.ucweb.com`、`cms.ucweb.com`、`dispatcher.upmc.uc.cn`、`log.cs.pp.cn`、`patriot.cs.pp.cn`、`server.m.pp.cn`、`u.uc123.com`，均与 `huichuan.sm.cn` 同列于公开广告规则表（AWAvenue、Cats-Team/AdRules 等），非猜测。
- 注意：七猫对 MitM 与 VPN 状态有检测，且广告素材可缓存；更新后需在 Surge 刷新模块并彻底退出七猫重进、清除缓存后再验证，否则旧横幅素材仍可显示。
- 模块文件改名：`七猫小说去广告.sgmodule` → `qimao.sgmodule`，raw 链接改为纯 ASCII，不再出现中文百分号编码；旧中文文件名文件已删除，Surge 里请用新链接重新导入或刷新。

---

## v1.1.3 (2026-10-28)

补七猫自建广告交换平台域名（来源：DD-AD 七猫段，标注为七猫自建广告交换平台（纯广告））。此前模块只覆盖了其中 `api-adx.52qumao.com` 和 `a-remad.qm989.com`，其余全部直通：

- `52qumao.com`：`api-cfg` / `t-adx` / `t-cfg` / `api-eas`
- `wtzw.com`：`mkt` / `tj-adc` / `tjjs` / `dig-cfg` / `t-cfg`
- `qm989.com`：`a-qmad` / `a6-remad` / `t-remad`
- `qimao.com`：`a-qmad` / `t-qmad`

---

## v1.1.2 (2026-10-28)

### 新增

- **UBiX 天璇广告**：`DOMAIN-SUFFIX,ubixioe.com`。UBIX 即 UBiX 天璇（ubixai，官方 SDK 仓库 `ubixai/UBiXAdSDK`），域名取自官方 SDK 二进制硬编码，不是猜测：`adx-cfg-u1.ubixioe.com`（配置）、`adx-data-u1.ubixioe.com`（数据）、`entry-su1.ubixioe.com`（入口），路径 `/mob/sdk/v2/endpoint`、`/mob/sdk/v3/init`。独立广告规则列表亦印证这三个域名，另有 `entry.ubixioe.com` 变体，同样在 `ubixioe.com` 通配内。
- **UC 汇川变体**：`DOMAIN-SUFFIX,huichuan-mc.sm.cn`，`huichuan.sm.cn` 的通配盖不住它。

---

## v1.1.1 (2026-10-28)

### 修复

- `huichuan.sm.cn` 与 `c.sm.cn` 由精确 `DOMAIN` 改为 `DOMAIN-SUFFIX`，子域名不再漏网。

---

## v1.1.0 (2026-10-26)

真机抓包验证后的修正版。规则数 **40 → 55**。

### 修复

**穿山甲域名写错** — 原写 `pglstatp-toutiao.com`，抓包显示七猫实际用 `pangolin-sdk-toutiao.com`，等于白写了。改为 `DOMAIN-SUFFIX` 覆盖全部三个变体：

- `pangolin-sdk-toutiao.com`
- `pangolin-sdk-toutiao1.com`
- `pangolin-sdk-toutiao-b.com`

另补字节素材 CDN：`pglstatp-toutiao.com`、`pstatp.com`。

### 新增

真机抓 22 秒 / 38 条请求，发现以下广告网络**完全未覆盖**（原先直通），现已阻断：

| 广告网络 | 新增域名 | 来源证据 |
|---|---|---|
| 优量汇 GDT | `e.qq.com` | 原只写了 `gdt.qq.com`，实测七猫用 `sdk.e.qq.com` |
| 阿里妈妈 Alimama | `alimama.com` / `tanx.com` / `mmstat.com` | 插页\"淘宝下载\"广告，角标 **AM** |
| 1RTB 广告聚合 | `1rtb.net` | 实测 `sdk.1rtb.net` |
| UC 联盟 | `sdk-log.partner.sm.cn` / `huichuan.sm.cn` / `c.sm.cn` | 实测，仅取广告子域，不影响神马搜索 |
| 快手 | `adukwai.com` / `kwaix.com` | 原只写了单域 `p1-lm.adukwai.com` |
| 百度 / 京东 | `mobads.baidu.com` / `adx.jd.com` / `dsp-x.jd.com` | 百度联盟与京东 DSP |

### 已知限制（真机验证）

七猫核心接口 `xiaoshuo.wtzw.com` 启用**证书固定（certificate pinning）**，Surge 无法解密：

```
TLS handshake with xiaoshuo.wtzw.com failed
Client closed connection ... because of certificate pinning
```

因此章节末尾插页广告的**广告位配置**仍会下发，广告位本身无法移除——这是该 App 的硬限制。但所有广告素材域名已阻断，**重启 App 清除已缓存素材后**，插页无法加载内容（显示空框）。

---

## v1.0.0 (2026-10-26)

初版。综合 luestr(可莉🅥)、fmz200(奶思)、zirawell 三个开源实现，适配 Surge。

**七猫自家广告域**

- `wtzw.com`：`ad` / `cdn-ad` / `cdn-new-ad` / `drs-ipv6`
- `52qumao.com`：`ad-drs` / `ad-drs-ipv6` / `api-adx`
- `qm989.com`：`a-remad`

**广告配置接口拒绝**

`api-cfg.wtzw.com` 的 `splash`（开屏）/ `adv` / `reward` / `offline-adv`。

**8 条 Map Local 空 JSON**

书城 `config` / `push-book`、搜索运营位、红包任务、提现初始化、段落复制、`ad_personal_switch`。

**1 条 Script**

`my-center` 响应改写，删除 `func_area[1,2]` 广告位——等价于 luestr 的 `http-response-jq delpaths`，用 Surge `[Script]` JS 实现。

**13 个 MITM hostname**（`%APPEND%` 追加，不改 CA）

**风控域名处理**

峰控云 `fp-it.fengkongcloud.com` 默认**不拦截**——风控/设备指纹服务，拦截可能影响 App 登录。

---

## 规则来源 / 致谢

- [luestr/ProxyResource](https://github.com/luestr/ProxyResource)（可莉🅥）
- [fmz200/wool_scripts](https://github.com/fmz200/wool_scripts)（奶思）
- [zirawell/R-Store](https://github.com/zirawell/R-Store)

## 免责声明

仅供学习与个人使用，请支持正版。使用本模块即视为你已了解并自行承担相应风险。
