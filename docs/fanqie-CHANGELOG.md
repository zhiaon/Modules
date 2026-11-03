# 更新日志

## V1.18 (2026-11-03)

V1.17 之后**底部广告仍然常驻**。再抓一轮发现根本原因：V1.17 是"逐主机列举"，而字节电商广告是整族动态下发，落地哪里不固定。

### 教训：必须整族拦截
V1.17 只拦了当次抓到的 `isaas5-normal-lf` / `ecom5-normal-lf` / `ecom3-normal-lf` / `ecset5-core-gl2` / `ecset3-core-gl2`。同族继续直连的还有：

- `ecom-normal-m.ecombdapi.com`
- `ec5-core-lf.ecombdapi.com`
- `ecset5-core-m-zjg.ecombdapi.com`
- `ecom5-normal-m-zjg.ecombdapi.com`
- `isaas3-normal-lf.ecombdapi.com`
- `mix.ecombdapi.com`

改为后缀整族拒绝：
```
DOMAIN-SUFFIX,ecombdapi.com,REJECT
DOMAIN-SUFFIX,ecombdstatic.com,REJECT
DOMAIN-SUFFIX,yingt.fun,REJECT
DOMAIN-SUFFIX,ndcpp.com,REJECT
```

### 新发现的两条常驻轮询
- `orzonera.yingt.fun` —— 30 秒内连打 9 次，每次 3.5–4.7KB，间隔中位数 **0.3 秒**。APISIX 网关，根路径返回 `{"error_msg":"404 Route Not Found"}`，无正式产品页，证书却是 DigiCert RapidSSL。
- `vc-brain-lf.ndcpp.com:9681` —— UDP 心跳，间隔 **0.8 秒**。

两者特征都不像正常业务，与广告展示周期同步，整族拒绝。

### 修复规则顺序坑（关键）
原文件第 46 行有 `DOMAIN-SUFFIX,bytegecko.com,DIRECT`，而短剧广告源规则写在它**后面**。Surge 按顺序匹配、先命中就定，所以：

```
lf-webcast-gr-sourcecdn.bytegecko.com  →  命中 bytegecko DIRECT（广告源一直没被拦）
```

V1.17 加的那条 `DOMAIN-KEYWORD,webcast-gr-sourcecdn.bytegecko.com,REJECT` 从来没生效过。本版把三条关键词规则提到 bytegecko DIRECT 之前：
```
DOMAIN-KEYWORD,webcast-gr-sourcecdn,REJECT
DOMAIN-KEYWORD,webcastcdn-tos,REJECT
DOMAIN-KEYWORD,webcast-cdn-tos,REJECT
```

### 验证
- 广告侧全部 REJECT：`isaas5` / `ec5-core-lf` / `lf1-fe.ecombdstatic` / `orzonera.yingt.fun` / `vc-brain-lf.ndcpp` / `lf-webcast-gr-sourcecdn` / `lf5-webcast-cdn-tos` / `lf1-webcastcdn-tos`
- 正文侧零误伤：`api5-normal-lf.fqnovel.com`、`p3-reading-sign.fqnovelpic.com`、`reading.snssdk.com`、`n98-lf-cdn-tos-ncdn.bytegecko.com`、`p3-novel.byteimg.com`、`v95-se-zjwztc-reading-video.fqnovelvod.com` 全部 DIRECT

### 一个无法绕开的限制
这次试过给 `*.ecombdapi.com` 开 MITM 想抓路径，结果：`Replica=1` 开了 HTTP 捕获，`dump recent` 里完整 URL **始终 0 条**；`isaas5` 直接变成 `QUIC-BLOCK`。番茄全系（fqnovel / amemv / ecombdapi / douyin）走 QUIC 优先且证书固定，**只能做域名层拦截，拿不到响应体**。所以不要指望用脚本改广告 JSON。

---

## V1.17 (2026-11-03)

阅读页两条**常驻**广告链路封堵。用户截图确认：正文中部一张「短剧推荐卡」（*下山先结婚这个神医会功夫 / 全集免费 / 全90集 / 播放全集*），底部一条浮层（*重生1990之美女如云 / 互动剧 / 查看详情*）。V1.16 后两条都还在。

抓包方法（番茄有 pinning，只能看 SNI）：`capture-filter set in-memory type=off`，高频轮询 `dump active` + `dump recent`，按 `remoteHost` 聚合。

### 正文中部「短剧推荐卡」
- `frontier100-toutiao-lf.fqnovel.com` —— 投放接口。**此前只列在模块的 MITM hostname 里，从未被 Rule 拦截**，是这版最关键的一条。
- `webcast-open.douyin.com`、`webcast5-open-lf.douyin.com` —— 短剧开放平台（后者 90 秒内刷 124 次）
- `content-open.douyin.com` —— 内容开放接口
- `p11-webcast-sign.douyinpic.com`、`p3-webcast-sign.douyinpic.com` —— 封面素材（红衣女主那张）
- `DOMAIN-KEYWORD,webcast-gr-sourcecdn.bytegecko.com` —— 短剧视频源

### 底部「互动剧 / 查看详情」浮层
- `isaas5-normal-lf.ecombdapi.com` —— 广告位下发
- `ecset5-core-gl2.ecombdapi.com`、`ecset3-core-gl2.ecombdapi.com`
- `DOMAIN-KEYWORD,ecom5-normal-lf.ecombdapi.com`、`ecom3-normal-lf.ecombdapi.com`
- 素材 `p3-aio.ecombdimg.com`、`p26-item.ecombdimg.com` 早在 V1.15 已拦

### 验证
- `rule match` 全部返回 `#!FROM-MODULE:番茄小说去广告` 且 policy=REJECT
- 正文侧零误伤：`api5-normal-lf.fqnovel.com`、`api3-normal-sinfonlinec.fqnovel.com`、`p3-reading-sign.fqnovelpic.com`、`lf3-reading.fqnovelpic.com`、`reading.snssdk.com` 均 DIRECT

### 已知限制
番茄对 `api5-normal-sinfonlinec.fqnovel.com`、`frontier100-toutiao-lf.fqnovel.com` 做了证书固定。把它们加进 MITM 会直接 `MITM failed ... certificate pinning`、`in=0B`，App 断连。所以**不要**为了抓路径或改响应体把这些域名加进 MITM，`fanqie_clean.js` 在番茄上无法生效，只能做 SNI/域名层拦截。

---

## V1.16 (2026-11-02)

- 新增 `DOMAIN-KEYWORD,mgsdk-sign.byteimg.com,REJECT` —— 底部推广卡片素材，实测一次拉 3 张共 327KB。

---

## V1.15 (2026-11-02)

- `ecomuser.snssdk.com`: DIRECT → REJECT
- applog / misc 家族补 `-lf` / `-hl` / `-lq` 后缀（原写法 `applog.fqnovel.com` 永远匹配不到真实主机 `log0-applog-lf.fqnovel.com`）
- 新增 `applog.zijieapi.com`、`-misc-lf.amemv.com`、`applog-lf.amemv.com`
- 新增 `luckycat.byteimg.com`、`abtest3-misc-lf.zijieapi.com`
- `p3-aio.ecombdimg.com` 扩展为 `-item` / `-aio` / `-ad.ecombdimg.com` 家族
- `frontier-aweme` 保持精确域名（关键词版本会打掉 `frontier-aweme-jj-ipainner.amemv.com` 段评接口，导致段评白屏）
