# 酷安去广告 V1.0

适用于 Surge 的保守列表卡片清理模块；不是全广告屏蔽方案。

## 覆盖

仅匹配 `https://api.coolapk.com` 的 `/v6/main/dataList`、`/v6/main/indexV8`、`/v6/page/dataList`，可带查询串。仅在混合列表中删除顶层 `data` 数组对象自身字段 `entityTemplate === "sponsorCard"` 的卡片。保留顺序、分页字段、普通推荐、热帖、下载卡、通用模板和嵌套内容。

全广告页、空页、错误响应、无匹配和未知结构保持原响应；仅处理成功且通过保守检查的 JSON/JSONP。保留重复响应头，仅在改写时移除失效实体头。脚本不调用网络、持久化或通知 API。

## 安装

在 Surge 的模块管理中添加远程模块：

```
https://raw.githubusercontent.com/zhiaon/Modules/main/coolapk.sgmodule
```

模块引用 `surge_scripts/coolapk-clean.js`，脚本更新间隔为 86400 秒。启用前确认已按 Surge 指引安装并信任 MITM 证书，且 MITM 与脚本功能可用。模块只追加 `api.coolapk.com`，不提供个人参数。

## 互斥与回退

本地版和远程版只启用一个；同时停用其他对上述接口进行响应改写的酷安去广告模块，避免重复处理。停用本模块即可停止其改写，无需清除 App 数据。

## 限制与验证边界

仅有合成输入验证：Node 回归 31/31；原生 Surge 引擎已有 20 项合成检查及 4 项已安装源码入口检查通过。这些结果不证明真实响应或当前 App 界面效果。远程安装、自动更新、当前 App 平台/版本、证书信任与证书固定行为未实测。

开屏、搜索、帖子详情、评论、嵌套广告、其他主机/API/SDK、旧缓存和全部广告不在覆盖承诺内。全广告页有意透传。接口或字段改变仍有失效或误删风险。

脚本版本保持 1.0，SPDX：MIT；安全框架复用自 MIT 标记的 `taobao-clean.js`。
