/**
 * @name: Trakt Simplified Chinese & Player Redirect (Infuse / Forward / Rex)
 * @author: 6otho
 * @desc: 优先补全简体中文标题与简介，并在详情页原生添加 Infuse、Forward、Rex 跳转按钮
 */

const url = $request.url;
let body = $response.body;

(function () {
    if (!body) {
        $done({});
        return;
    }

    // 匹配电影、剧集、单集详情接口 (排除 watchnow/comments 等辅助接口)
    const isMediaDetail = /https?:\/\/api\.trakt\.tv\/(movies|shows)\/([^\/?#]+)/.test(url);
    const isExcluded = /\/(watchnow|comments|ratings|stats|watching|people|aliases|releases|translations)/.test(url);

    if (!isMediaDetail || isExcluded) {
        $done({ body });
        return;
    }

    try {
        let data = JSON.parse(body);

        // 如果不是详情数据对象，直接放行
        if (!data || (!data.title && !data.name)) {
            $done({ body });
            return;
        }

        // 构造 Trakt 官方中文翻译接口地址
        // 例如: https://api.trakt.tv/movies/123/translations/zh
        let cleanUrl = url.split("?")[0];
        let transUrl = `${cleanUrl}/translations/zh`;

        // 复制请求头（携带 trakt-api-key 等认证信息）
        let headers = Object.assign({}, $request.headers);
        delete headers["Content-Length"];

        // 发起异步请求拉取中文翻译，设置 3 秒超时容错
        let timeoutTriggered = false;
        const timer = setTimeout(() => {
            timeoutTriggered = true;
            // 超时兜底：直接注入原名按钮
            injectButtons(data, data.title || "");
            $done({ body: JSON.stringify(data) });
        }, 3000);

        $httpClient.get({ url: transUrl, headers: headers }, function (error, response, resBody) {
            if (timeoutTriggered) return;
            clearTimeout(timer);

            let searchTitle = data.title || "";

            if (!error && response.status === 200 && resBody) {
                try {
                    let transList = JSON.parse(resBody);
                    if (Array.isArray(transList) && transList.length > 0) {
                        let zh = transList[0];
                        // 替换为简体中文标题
                        if (zh.title) {
                            data.title = zh.title;
                            searchTitle = zh.title;
                        }
                        // 替换为简体中文简介
                        if (zh.overview) {
                            data.overview = zh.overview;
                        }
                    }
                } catch (e) {}
            }

            // 注入 Infuse / Forward / Rex 跳转按钮
            injectButtons(data, searchTitle);
            $done({ body: JSON.stringify(data) });
        });

    } catch (e) {
        $done({ body });
    }

    // 按钮构造与注入函数
    function injectButtons(item, title) {
        if (!title) return;
        const encoded = encodeURIComponent(title);

        // 构造三大播放器的 URL Scheme
        const infuseLink = `infuse://search?q=${encoded}`;
        const forwardLink = `forward://search?query=${encoded}`;
        const rexLink = `rex://search?keyword=${encoded}`;

        const buttons = `[▶️ Infuse](${infuseLink})  ·  [Forward](${forwardLink})  ·  [Rex](${rexLink})`;
        const jumpBlock = `\n\n🍿 **播放跳转**\n${buttons}`;

        if (item.overview) {
            item.overview = item.overview + jumpBlock;
        } else {
            item.overview = jumpBlock;
        }
    }
})();
