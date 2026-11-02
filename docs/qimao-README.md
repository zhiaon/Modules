# 七猫小说去广告 · Surge 模块

当前版本：**v1.1.5**（2026-10-28，模块文件 `#!version=1.1.5`）。

适用于 [Surge](https://nssurge.com) 的七猫免费小说去广告模块。

## 功能

- 屏蔽开屏广告、章节间广告、阅读页底部 banner、书城推荐广告、个人中心广告位
- 屏蔽七猫自家广告/统计域名（`wtzw.com`、`52qumao.com`、`qm989.com`、`qimao.com` 等，含七猫自建广告交换平台域名）
- 屏蔽第三方广告 SDK：穿山甲（字节）、优量汇 GDT（腾讯）、UBiX 天璇、UC 汇川（含 `huichuan-mc.sm.cn` 变体）、快手联盟、百度联盟、京东 DSP 等
- 返回空 JSON 保持 App 正常逻辑，避免白屏/崩溃

> 受限于七猫对 MitM 与 VPN 状态的检测，少量页面广告可能仍残留，可清除 App 缓存或重装后重试。

## v1.1.5 更新（2026-10-28，针对第 10 章淘宝汇川广告仍在）

- **补汇川 SSP 与阿里广告域名**：`hc-ssp.sm.cn`（汇川 SSP）、`ai.advertisement.alibabacorp.sm.cn`（阿里广告）、`reachmax.cn`（阿里 ReachMax 程序化广告），均与 `huichuan.sm.cn` 同列于公开广告规则表
- v1.1.4 补的 `api-cfg operation` 拒绝与 UC 生态域名未能去掉该广告，说明该淘宝双 11 广告不是走 `huichuan.sm.cn` 主域名下发的

## v1.1.4 更新（2026-10-28，针对阅读页底部汇川横幅）

- **补七猫运营配置接口拒绝**：`api-cfg.wtzw.com/v*/operation` 直接拒绝，此前只空返回了带 `ad_personal_switch` 参数的版本，运营位配置仍可下发底部横幅（其他七猫模块亦拒绝该接口）
- **补 UC / 汇川生态广告域名**：`partner.sm.cn`、`iflow.sm.cn`、`iflow.uczzd.cn`、`m.uczzd.cn`、`client.video.ucweb.com`、`cms.ucweb.com`、`dispatcher.upmc.uc.cn`、`log.cs.pp.cn`、`patriot.cs.pp.cn`、`server.m.pp.cn`、`u.uc123.com`（均与 `huichuan.sm.cn` 同列于公开广告规则表）
- 更新后如底部横幅仍在：先在 Surge 刷新模块，再彻底退出七猫重进并清除缓存（部分 App 需清缓存或重装后拦截才生效）
- 模块文件已改名为 `qimao.sgmodule`（原中文文件名已删除），raw 链接不再含中文，不会出现百分号编码

## v1.1.3 更新（2026-10-28）

- **补七猫自建广告交换平台域名**：`api-cfg` / `t-adx` / `t-cfg` / `api-eas.52qumao.com`，`mkt` / `tj-adc` / `tjjs` / `dig-cfg` / `t-cfg.wtzw.com`，`a-qmad` / `a6-remad` / `t-remad.qm989.com`，`a-qmad` / `t-qmad.qimao.com`（来源：DD-AD 七猫段）
- **v1.1.2**：新增 UBiX 天璇广告 `ubixioe.com`（域名取自官方 UBiXAdSDK 二进制：`adx-cfg-u1` / `adx-data-u1` / `entry-su1.ubixioe.com`），新增 UC 汇川变体 `huichuan-mc.sm.cn`
- **v1.1.1**：`huichuan.sm.cn` 与 `c.sm.cn` 由精确域名改为子域名通配，堵住子域漏网

## 安装

在 Surge 中导入模块（任选其一）：

**方式一：远程模块 URL**

```
https://raw.githubusercontent.com/zhiaon/qimao-novel-adblock/main/qimao.sgmodule
```

**方式二：本地模块**

下载 [`qimao.sgmodule`](qimao.sgmodule) 与 [`qimao.js`](qimao.js) 置于同一目录后导入。

升级后需在 Surge 中刷新模块（配置 → 模块 → 七猫小说去广告 → 刷新），或卸载后重新用 URL 安装，否则 Surge 私有缓存可能仍用旧版。

## 要求

- Surge ≥ 5.x（支持 `[Map Local]` 与 `[Script]` http-response）
- 在「设置 → MITM → 配置证书」中信任 Surge CA 证书

## 规则来源 / 致谢

本模块综合参考以下开源项目（致谢）：

- [luestr/ProxyResource](https://github.com/luestr/ProxyResource)（可莉🅥，QingRex 转载）
- [fmz200/wool_scripts](https://github.com/fmz200/wool_scripts)（奶思）
- [zirawell/R-Store](https://github.com/zirawell/R-Store)
- [afwfv/DD-AD](https://github.com/afwfv/DD-AD)（七猫自建广告交换平台域名）

将 Loon 专有的 `http-response-jq` 改写为 Surge 兼容的 `[Script]` JS 实现。

## 免责声明

仅供学习与个人使用，请支持正版。使用本模块即视为你已了解并自行承担相应风险。
