// 功能参考：mickeu 的 Memory Traffic 面板。此版本使用 Surge 内置只读 MCP。
(function () {
    'use strict';

    var policyCacheKey = 'zhiaon.memory-traffic.policy.v1';
    var policyGenerationKey = policyCacheKey + '.generation';
    var policyCacheTtl = 5 * 60 * 1000;
    if ((typeof $event !== 'undefined' && $event
            && ($event.name === 'profile-reloaded' || $event.name === 'engine-started'))
            || (typeof $argument !== 'undefined' && $argument === 'invalidate-policy-cache')) {
        // Use a new marker so an in-flight discovery cannot restore the old entry.
        writeCache(policyGenerationKey, Date.now() + ':' + Math.random());
        $done();
        return;
    }

    var title = '内存流量Tailscale实时监控';
    var iosReference = 50 * 1024 * 1024;
    var panels = {}, errors = {}, tunnelPhase = '策略识别';
    var pending = 4, closed = false, requestId = 0;
    var deadline = setTimeout(render, 7000);

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function decodeReply(reply, parse) {
        if (reply == null || reply === '') return { error: '无响应' };
        try {
            var rpc = typeof reply === 'string' ? JSON.parse(reply) : reply;
            if (isObject(rpc)) {
                if (rpc.error) return { error: Number(rpc.error.code) === -32601 ? '接口不支持' : '读取失败' };
                var result = rpc.result;
                if (isObject(result)) {
                    if (result.isError) return { error: '读取失败' };
                    var value = result.structuredContent;
                    if (value == null && Array.isArray(result.content)) {
                        var text = result.content.filter(function (item) {
                            return item && item.type === 'text' && typeof item.text === 'string';
                        }).map(function (item) { return item.text; }).join('\n');
                        if (text.trim()) value = parse ? JSON.parse(text) : text;
                    }
                    if (isObject(value) || (!parse && typeof value === 'string' && value.trim())) {
                        return { value: value };
                    }
                }
            }
        } catch (_) {}
        return { error: '响应格式异常' };
    }

    function call(tool, args, parse, cb) {
        var answered = false;
        function complete(value, error) {
            if (answered || closed) return;
            answered = true;
            cb(value, error);
        }
        try {
            $httpAPI('POST', '/v1/mcp', {
                jsonrpc: '2.0', id: ++requestId, method: 'tools/call',
                params: { name: tool, arguments: args }
            }, function (reply) {
                if (closed || answered) return;
                var decoded = decodeReply(reply, parse);
                complete(decoded.value, decoded.error);
            });
        } catch (_) { complete(null, '读取失败'); }
    }

    function setPanel(section, value, error) {
        if (closed || Object.prototype.hasOwnProperty.call(panels, section)) return;
        panels[section] = value;
        if (error) errors[section] = error;
        if (--pending === 0) render();
    }

    function readCache(key) {
        try { return $persistentStore.read(key) || ''; } catch (_) { return ''; }
    }

    function writeCache(key, value) {
        try { $persistentStore.write(value, key); } catch (_) {}
    }

    function profilePolicy(value) {
        var text = typeof value === 'string' ? value : value && value.profile;
        if (typeof text !== 'string') return null;
        var lines = text.split(/\r?\n/), inProxy = false, recognized = false;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/^\uFEFF/, '').trim();
            var section = line.match(/^\[([^\]]+)\]/);
            if (section) {
                if (inProxy) break;
                var name = section[1].trim().toLowerCase();
                inProxy = name === 'proxy';
                if (inProxy || name === 'general' || name === 'rule') recognized = true;
                continue;
            }
            if (!inProxy || /^(?:#|;|\/\/)/.test(line)) continue;
            var match = line.match(/^([^=]+?)\s*=\s*tailscale\s*(?:[,;#]|\/\/|$)/i);
            if (match) {
                var policy = match[1].trim().replace(/^(["'])(.*)\1$/, '$2');
                if (policy) return policy;
            }
        }
        return recognized ? '' : null;
    }

    function loadTunnel() {
        var generation = readCache(policyGenerationKey);
        var cached, now = Date.now();
        try { cached = JSON.parse(readCache(policyCacheKey)); } catch (_) {}
        if (isObject(cached) && cached.generation === generation && typeof cached.policy === 'string'
                && Number.isFinite(cached.at) && cached.at <= now && now - cached.at < policyCacheTtl) {
            return loadTunnelStatus(cached.policy, generation);
        }
        call('get_profile', { variant: 'effective' }, false, function (profile, error) {
            if (error) return setPanel('tunnel', null, '策略识别' + error);
            var policy = profilePolicy(profile);
            if (policy === null) return setPanel('tunnel', null, '策略识别响应格式异常');
            if (readCache(policyGenerationKey) !== generation) {
                return setPanel('tunnel', null, '配置已更新，等待下次刷新');
            }
            // Persist only the policy name (or a confirmed absence), never the profile text.
            writeCache(policyCacheKey, JSON.stringify({ generation: generation, at: Date.now(), policy: policy }));
            loadTunnelStatus(policy, generation);
        });
    }

    function loadTunnelStatus(policy, generation) {
        if (!policy) return setPanel('tunnel', { note: '当前配置未设置 Tailscale 策略' });
        tunnelPhase = '运行状态';
        call('get_proxy_runtime_status', { policy: policy }, true, function (runtime, error) {
            if (readCache(policyGenerationKey) !== generation) {
                return setPanel('tunnel', null, '配置已更新，等待下次刷新');
            }
            if (error) return setPanel('tunnel', null, '运行状态' + error);
            if (!isObject(runtime.tailscale)) return setPanel('tunnel', null, '策略运行状态暂不可用');
            setPanel('tunnel', { data: runtime.tailscale });
        });
    }

    function number(value) {
        if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
        var n = Number(value);
        return isFinite(n) && n >= 0 ? n : null;
    }

    function size(value) {
        if (value === null) return '—';
        var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'], i = 0;
        while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
        return (i ? value.toFixed(2) : Math.round(value)) + ' ' + units[i];
    }

    function duration(value) {
        if (value === null) return '—';
        var seconds = Math.floor(value), days = Math.floor(seconds / 86400);
        var hours = Math.floor(seconds / 3600) % 24, minutes = Math.floor(seconds / 60) % 60;
        return (days ? days + ' 天 ' : '') + (hours || days ? hours + ' 小时 ' : '')
            + (hours || days || minutes ? minutes + ' 分钟' : seconds % 60 + ' 秒');
    }

    function interfaceTotal(traffic, field) {
        var counters = traffic && traffic.interface;
        if (!isObject(counters)) return null;
        var names = Object.keys(counters).filter(function (name) { return !/^lo\d*$/i.test(name); });
        if (!names.length) return null;
        var total = 0;
        for (var i = 0; i < names.length; i++) {
            var row = counters[names[i]];
            var value = isObject(row) ? number(row[field]) : null;
            if (value === null) return null;
            total += value;
        }
        return number(total);
    }

    function speed(value) {
        return value === null ? '—' : size(value) + '/s';
    }

    function label(value, limit) {
        if (typeof value !== 'string' && typeof value !== 'number') return '';
        return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit || 40);
    }

    function pathKind(peer) {
        var route = label(peer.status).toLowerCase();
        if (route === 'direct') return '直连';
        if (/^(?:relay|relayed|derp)$/.test(route) || (number(peer.derpRegionID) || 0) > 0
                || label(peer.derpRegionCode)) return '中继';
        return '未知';
    }

    var cities = {
        ams: '阿姆斯特丹', blr: '班加罗尔', bom: '孟买', cdg: '巴黎', dfw: '达拉斯',
        fra: '法兰克福', hel: '赫尔辛基', hkg: '香港', jnb: '约翰内斯堡', kix: '大阪',
        lax: '洛杉矶', lhr: '伦敦', mad: '马德里', mia: '迈阿密', nue: '纽伦堡',
        nyc: '纽约', ord: '芝加哥', par: '巴黎', sao: '圣保罗', sea: '西雅图',
        sel: '首尔', sfo: '旧金山', sin: '新加坡', sjc: '圣何塞', sto: '斯德哥尔摩',
        syd: '悉尼', tok: '东京', tor: '多伦多', tpe: '台北', waw: '华沙', yyz: '多伦多'
    };

    function region(code, id) {
        var key = label(code, 12).toLowerCase();
        var name = key && (Object.prototype.hasOwnProperty.call(cities, key) ? cities[key] : key.toUpperCase());
        var suffix = label(id, 10);
        return [name, suffix && '#' + suffix].filter(Boolean).join(' ') || '—';
    }

    function shortPeer(peer, ts, kind) {
        var name = label(label(peer.name, 128).split('.')[0], 24) || '未命名设备';
        var prefix = kind === '直连' ? '● ' : '○ ';
        var info = [prefix + kind, name];
        if (kind === '中继' && (peer.derpRegionCode || peer.derpRegionID)) {
            info.push(region(peer.derpRegionCode, peer.derpRegionCode ? null : peer.derpRegionID));
        }
        var latency = number(peer.latencyMs);
        if (latency > 0) {
            info.push(Math.round(latency) + ' ms');
        } else if (kind === '中继' && number(peer.derpRegionID) > 0) {
            var map = ts.netcheck && ts.netcheck.regionLatencyMs;
            var probe = map && number(map[String(peer.derpRegionID)]);
            if (probe > 0) info.push('DERP 探测 ' + Math.round(probe) + ' ms');
        }
        return info.join(' · ');
    }

    function count(value) {
        var n = number(value);
        return n === null ? '—' : String(Math.floor(n));
    }

    function tunnelLines(tunnel) {
        var ts = tunnel && tunnel.data;
        if (!ts) return ['Tailscale · ' + (tunnel ? tunnel.note : '状态暂不可用')];

        var stage = label(ts.controlStage);
        var lines = ['Tailscale · ' + (label(ts.state) || '状态未知') + (stage ? ' · ' + stage : '')];
        lines.push('本机：' + (label(ts.selfIPv4) || label(ts.selfIPv6) || '—'));
        var derp = Array.isArray(ts.derpConnections) ? ts.derpConnections : null;
        var connected = derp ? derp.filter(function (item) { return item && item.connected === true; }).length : null;
        lines.push('DERP：' + region(ts.homeDERPRegionCode, ts.homeDERPRegionID)
            + (derp ? ' · ' + connected + '/' + derp.length + ' 已连' : ''));
        var exit = ts.exitNode || {};
        var exitStatus = label(exit.status);
        var who = label(exit.selector);
        var exitLabel = exit.enabled && exitStatus !== 'disabled' ? (who && who !== 'auto' ? who : '自动')
            : (exit.enabled === false || exitStatus === 'disabled' ? '未使用' : '—');
        lines.push('出口：' + exitLabel + (exitStatus && exitStatus !== 'disabled' ? ' · ' + exitStatus : ''));
        lines.push('连接：TCP ' + count(ts.activeTCPConnections) + ' / UDP ' + count(ts.activeUDPConnections));

        if (!Array.isArray(ts.peers)) return lines.concat('设备：—');
        var peers = ts.peers.filter(function (peer) { return peer && typeof peer === 'object'; });
        var online = peers.filter(function (peer) { return peer.online === true || peer.online === 1; });
        var direct = 0, relay = 0;
        online.forEach(function (peer) {
            var kind = pathKind(peer);
            if (kind === '直连') direct++;
            if (kind === '中继') relay++;
        });
        var unknown = online.length - direct - relay;
        lines.push('设备：' + online.length + '/' + peers.length + ' 在线 · 直连 ' + direct + ' / 中继 ' + relay
            + (unknown ? ' / 未知 ' + unknown : ''));
        online.sort(function (a, b) {
            var aAge = number(a.lastActivityAgo), bAge = number(b.lastActivityAgo);
            return (aAge === null ? Infinity : aAge) - (bAge === null ? Infinity : bAge) || 0;
        });
        online.slice(0, 6).forEach(function (peer) { lines.push(shortPeer(peer, ts, pathKind(peer))); });
        if (online.length > 6) lines.push('另有 ' + (online.length - 6) + ' 台在线');
        return lines;
    }

    function issue(section, incomplete) {
        if (!Object.prototype.hasOwnProperty.call(panels, section)) return '读取超时';
        return errors[section] || (incomplete ? '数据缺失' : '');
    }

    function render() {
        if (closed) return;
        closed = true;
        clearTimeout(deadline);
        var perf = panels.performance || {}, status = panels.status || {};
        var memory = number(perf['memory-bytes']), uptime = number(perf.uptime);
        var down = interfaceTotal(panels.traffic, 'in'), up = interfaceTotal(panels.traffic, 'out');
        var downSpeed = interfaceTotal(panels.traffic, 'inCurrentSpeed');
        var upSpeed = interfaceTotal(panels.traffic, 'outCurrentSpeed');
        var hasStats = [memory, uptime, down, up, downSpeed, upSpeed].some(function (n) { return n !== null; });
        var used = memory !== null && label(status.system).toLowerCase() === 'ios'
            ? Math.min(10, Math.round(10 * memory / iosReference)) : null;
        var bar = used === null ? '' : '  ' + '▮'.repeat(used) + '▯'.repeat(10 - used);
        var lines = [
            '内存：' + size(memory) + bar,
            '运行：' + duration(uptime),
            '速率：↓ ' + speed(downSpeed) + '  ↑ ' + speed(upSpeed),
            '接口累计：↓ ' + size(down) + '  ↑ ' + size(up)
        ];
        var performanceIssue = issue('performance', memory === null || uptime === null);
        var trafficIssue = issue('traffic', [down, up, downSpeed, upSpeed].some(function (n) { return n === null; }));
        if (performanceIssue) lines.push('性能：' + performanceIssue);
        if (trafficIssue) lines.push('流量：' + trafficIssue);
        if (!hasStats && errors.performance === '无响应' && errors.traffic === '无响应') {
            lines.push('请检查 Surge MCP 是否已开启');
        }
        var tunnelIssue = Object.prototype.hasOwnProperty.call(panels, 'tunnel')
            ? errors.tunnel : tunnelPhase + '超时';
        lines = lines.concat('', tunnelLines(tunnelIssue ? { note: tunnelIssue } : panels.tunnel));
        var version = label(status.version), build = label(status.build);
        var statusIssue = issue('status', !version);
        if (version || statusIssue) lines.push('');
        if (version) lines.push('Surge ' + version + (build ? ' · Build ' + build : ''));
        if (statusIssue) lines.push('版本：' + statusIssue);
        var partial = performanceIssue || trafficIssue || statusIssue || tunnelIssue;
        $done({ title: title, content: lines.join('\n'),
            style: hasStats ? 'info' : 'error',
            icon: partial || !hasStats ? 'exclamationmark.triangle.fill' : 'speedometer',
            'icon-color': !hasStats ? '#FF3B30' : partial ? '#FF9500' : '#4A90E2' });
    }

    call('dump_runtime_data', { type: 'performance' }, true, function (data, error) {
        setPanel('performance', data, error);
    });
    call('dump_runtime_data', { type: 'traffic' }, true, function (data, error) {
        setPanel('traffic', data, error);
    });
    call('get_status', {}, true, function (data, error) { setPanel('status', data, error); });
    loadTunnel();
})();
