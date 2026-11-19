/* 追更提醒 · Surge iOS · 许舟 */
(function () {
  'use strict';
  var P = 'episode_watch_v1_';
  var BGM = 'https://api.bgm.tv', TV = 'https://api.tvmaze.com';
  var DAY = 86400000;
  var clean = function (v) { return String(v == null ? '' : v).replace(/[\x00-\x1f\x7f]/g, ' ').trim(); };
  var error = function (s) { throw new Error(s); };
  function norm(s) { return clean(s).normalize('NFKC').toLowerCase().replace(/[\s·._:：\-《》]/g, ''); }
  function parse(arg) {
    var pair = String(arg || 'panel|-').split('|');
    if (pair.length !== 2 || !/^(panel|cron|preview)$/.test(pair[0])) error('模块参数格式错误，剧单不能包含竖线。');
    var list = pair[1].trim();
    var rows = list && list !== '-' ? list.split(/[;；\r\n]+/).filter(function (x) { return x.trim(); }) : [];
    if (rows.length > 5) error('剧单最多 5 部，请分批管理。');
    return { mode: pair[0], items: rows.map(function (line) {
      line = clean(line);
      var normalized = line.normalize('NFKC');
      var directId = /^(?:bgm|tvmaze):\d{1,9}$/i.test(normalized.replace(/^《(.+)》$/, '$1'));
      var m = directId ? null : /^(.*?)\s*(?:S(\d{1,2})\s*E\s*(\d{1,4})|第\s*(\d{1,4})\s*[集话話]|[:：]\s*(\d{1,4}))$/i.exec(normalized);
      var title, season = 0, episode = null, automatic = false;
      if (m) { if (m[2] && Number(m[2]) < 1) error('季度编号须大于零。'); title=m[1].trim(); season=m[2]?+m[2]:0; episode=+(m[3]||m[4]||m[5]); }
      else {
        title = normalized.trim();
        if (!title || title.length > 120) error('填写剧名即可自动追更；海外剧也可写剧名 S02E03。');
        automatic = true;
      }
      if (!title || title.length > 120 || (season && season < 1)) error('剧名格式错误。');
      title = title.replace(/^《(.+)》$/, '$1');
      var id = /^(bgm|tvmaze):(\d{1,9})$/i.exec(title);
      return { title:title, id:id&&+id[2], source:id&&id[1].toLowerCase(), season:season, episode:episode, automatic:automatic };
    }) };
  }
  function exact(candidates, title) {
    var needle = norm(title), unique = Object.create(null);
    candidates.forEach(function (c) {
      if (c.id > 0 && c.names.some(function (n) { return n && norm(n) === needle; })) unique[c.id] = c;
    });
    var keys = Object.keys(unique);
    if (keys.length === 1) return unique[keys[0]];
    return null;
  }
  function suggestions(list) {
    return list.slice(0, 3).map(function (c) { return clean(c.title).slice(0, 26) + ' ' + c.source + ':' + c.id; }).join('\n');
  }
  function getStored(key) {
    try { return JSON.parse($persistentStore.read(key) || 'null'); } catch (_) { return null; }
  }
  function save(key, value) {
    try { return $persistentStore.write(JSON.stringify(value), key) === true; } catch (_) { return false; }
  }
  function req(url, body, format) {
    return new Promise(function (resolve, reject) {
      var opts = {url: url, timeout: 8, 'auto-cookie': false, headers: {'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 Surge-EpisodeWatch/1.3 (personal use)'}};
      if (format==='text') opts.headers.Accept='text/html';
      if (url.indexOf('https://pbaccess.video.qq.com/')===0) { opts.headers.Origin='https://v.qq.com';opts.headers.Referer='https://v.qq.com/'; }
      if (body) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
      var cb = function (err, response, raw) {
        if (err) { reject(new Error('网络超时或连接失败')); return; }
        var status = Number(response && response.status);
        if (status !== 200) { reject(new Error(status === 429 ? '数据源限流，稍后再查' : '数据源 HTTP ' + (status || '无响应'))); return; }
        if (typeof raw!=='string' || raw.length>2500000) {reject(new Error('数据源响应过大或无效'));return;}
        if (format==='text') {resolve(raw);return;}
        try { resolve(JSON.parse(raw)); } catch (_) { reject(new Error('数据源返回格式异常')); }
      };
      if (body) $httpClient.post(opts, cb); else $httpClient.get(opts, cb);
    });
  }
  function mapBgm(x) { return {source:'bgm', id:x.id, title:x.name_cn || x.name, names:[x.name_cn, x.name]}; }
  function mapTv(x) { return {source:'tvmaze', id:x.id, title:x.name, names:[x.name]}; }
  var KAN_SEARCH = 'https://api.so.360kan.com/index?kw=';
  var KAN_DETAIL = 'https://api.web.360kan.com/v1/detail?';
  function kanNumber(v) {
    return (typeof v === 'number' || typeof v === 'string') && /^\d+$/.test(String(v)) ? Number(v) : NaN;
  }
  function kanCandidates(payload) {
    if (!payload || payload.code !== 0 || !payload.data || !payload.data.longData || !Array.isArray(payload.data.longData.rows)) error('中文影视搜索返回异常。');
    return payload.data.longData.rows.filter(function (r) {
      return r && ['2','4'].indexOf(String(r.cat_id)) >= 0 && /^[a-zA-Z0-9_-]+$/.test(r.en_id || '') && typeof r.titleTxt === 'string';
    }).map(function (r) {
      var title = clean(r.titleTxt), year = /^\d{4}$/.test(String(r.year)) ? String(r.year) : '';
      return {source:'kan360', id:r.en_id, cat:String(r.cat_id), title:title, year:year,
        names:[title].concat(year ? [title+'（'+year+'年）',title+'（'+year+'）',title+' ('+year+')'] : []),
        url:'https://www.360kan.com/'+(String(r.cat_id)==='4'?'ct':'tv')+'/'+r.en_id+'.html'};
    });
  }
  async function resolveKan(item, request) {
    var candidates = kanCandidates(await request(KAN_SEARCH + encodeURIComponent(item.title)));
    var hits = candidates.filter(function (c) { return c.names.some(function (n) { return norm(n) === norm(item.title); }); });
    var unique = Object.create(null);
    hits.forEach(function (c) { unique[c.cat+':'+c.id]=c; });
    var keys = Object.keys(unique);
    if (keys.length > 1) error('中文影视有同名版本，请加年份：\n' + keys.slice(0,3).map(function (k) { var c=unique[k];return c.title+(c.year?'（'+c.year+'年）':''); }).join('\n'));
    return keys.length === 1 ? unique[keys[0]] : null;
  }
  function kanEpisodes(payload, match) {
    if (!payload || payload.errno !== 0 || !payload.data || norm(payload.data.title) !== norm(match.title)) error('中文影视详情与剧名不一致，暂不判断更新。');
    var d=payload.data, latest=kanNumber(d.upinfo), total=kanNumber(d.total);
    if (!Number.isInteger(latest) || latest < 0 || latest > 100000 || (Number.isInteger(total) && total > 0 && latest > total)) error('中文影视尚无可信的更新进度。');
    var by=Object.create(null), groups=d.allepidetail || {};
    Object.keys(groups).forEach(function (site) {
      if (!Array.isArray(groups[site])) return;
      groups[site].forEach(function (e) {
        var n=kanNumber(e && e.playlink_num);
        if (!Number.isInteger(n) || n < 1 || n > latest) return;
        // These are explicitly listed platform episodes, not inferred from total or schedule.
        by[n]={key:'0:'+n,s:0,n:n,at:0,url:match.url};
      });
    });
    var list=Object.keys(by).map(function (n) { return by[n]; }).sort(function (a,b) { return a.n-b.n; });
    if (latest > 0 && (!list.length || list[list.length-1].n !== latest)) error('中文影视更新集数和正片目录不一致，稍后重试。');
    list.info={sourceLabel:'360影视 · 平台收录进度',total:Number.isInteger(total)&&total>0?total:null,latest:latest,url:match.url};
    return list;
  }



const search = 'https://so.youku.com/search/q_';

function initial(html) {
  const m = /\bwindow\.__INITIAL_DATA__\s*=\s*(?=\{)/.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); }
      catch (_) { return null; }
    }
  }
  return null;
}

const text = v => typeof v === 'string' ? v.trim() : '';
const count = v => (typeof v === 'number' || /^\d+$/.test(text(v))) &&
  Number.isSafeInteger(+v) && +v > 0 ? +v : null;
const progress = /^更新至\s*(\d+)(?:\s*[/／]\s*(\d+))?\s*集\s*(?:$|[（(])/;
const complete = /^(?:已完结\s*(\d+)\s*集|(\d+)\s*集全)$/;

function parseYouku(html, title) {
  title = text(title);
  if (!title || typeof html !== 'string') return [];
  const stack = [initial(html)], results = new Map();
  while (stack.length) {
    const c = stack.pop();
    if (!c || typeof c !== 'object') continue;
    const keys = Object.keys(c);
    for (let i = keys.length - 1; i >= 0; i--) stack.push(c[keys[i]]);
    if (norm(text(c.tempTitle)) !== norm(title) || c.cats !== '电视剧' ||
        (c.isTrailer !== 0 && c.isTrailer !== '0') || !text(c.showId)) continue;

    let updated = null, total = count(c.episodeTotal);
    for (const label of [text(c.stripeBottom), text(c.updateNotice)]) {
      const p = progress.exec(label), f = complete.exec(label);
      const n = count(p ? p[1] : f && (f[1] || f[2]));
      const statedTotal = p ? count(p[2]) : f ? n : null;
      total = total || statedTotal;
      if (n && (!total || n <= total) && (!statedTotal || n <= statedTotal) &&
          (!f || n === total) &&
          (c.episodeCollect == null || count(c.episodeCollect) === n)) updated = n;
      if (updated !== null && total !== null) break;
    }
    const year = text(c.featureDTO && c.featureDTO.text).split('·')
      .map(text).find(v => /^(?:19|20)\d{2}$/.test(v));
    const id = text(c.showId), old = results.get(id);
    if (!old || (old.updated === null && updated !== null)) {
      results.set(id, {source: 'youku', id, title, year: year ? +year : null,
        updated, total, url: search + encodeURIComponent(title)});
    }
  }
  return Array.from(results.values());
}

  var PLATFORM_NAMES={youku:'优酷',tencent:'腾讯视频'};
  function explicitProgress(text) {
    if (typeof text!=='string') return null;
    text=text.replace(/<[^>]*>/g,'').trim();
    if (/预告|片花|花絮|解说|剪辑/.test(text)) return null;
    var p=/^(?:更新至|更新到|已更新至)\s*(\d+)(?:\s*[\/／]\s*(\d+))?\s*集(?:$|[（(])/.exec(text);
    var full=/^(?:全\s*(\d+)\s*集|(\d+)\s*集全|已完结\s*(\d+)\s*集)$/.exec(text);
    if (!p&&!full) return null;
    var n=Number(p?p[1]:(full[1]||full[2]||full[3]));
    var total=p&&p[2]?Number(p[2]):full?n:null;
    return Number.isInteger(n)&&n>=0&&n<=5000&&(!total||n<=total)?{updated:n,total:total}:null;
  }
  function platformTitleMatches(name,title) {
    var n=norm(name),q=norm(title);
    if(n===q)return true;
    var suffix=n.slice(q.length);
    return n.indexOf(q)===0 && /^(?:第)?(?:[0-9]+|[一二三四五六七八九十]+)季$/.test(suffix);
  }
  function parseTencent(data, title) {
    if (!data || Number(data.ret)!==0 || !data.data || !data.data.normalList || !Array.isArray(data.data.normalList.itemList)) error('腾讯搜索响应异常。');
    var out=[], seen=Object.create(null);
    data.data.normalList.itemList.forEach(function (item) {
      var doc=item.doc, video=item.videoInfo;
      if (!doc||doc.dataType!==2||!video||video.typeName!=='电视剧'||!/^\w{6,64}$/.test(doc.id||'')) return;
      var name=clean(String(video.title||'').replace(/<[^>]*>/g,''));
      if (norm(name)!==norm(title)) return;
      var labels=[video.episodeUpdated,video.extraFields&&video.extraFields.updateInfo];
      if (typeof video.imgTag==='string' && video.imgTag.length<20000) {
        try {
          var tags=JSON.parse(video.imgTag);
          Object.keys(tags).forEach(function(k){var info=tags[k]&&tags[k].info;if(info&&typeof info.text==='string')labels.push(info.text);});
        } catch (_) {}
      }
      var points=labels.map(explicitProgress).filter(Boolean);
      if (!points.length || points.some(function(p){return p.updated!==points[0].updated;})) return;
      var total=points.filter(function(p){return p.total;})[0];
      if (!seen[doc.id]) {
        seen[doc.id]=true;
        out.push({source:'tencent',id:doc.id,title:name,year:String(video.year||''),updated:points[0].updated,total:total?total.total:null,
          url:'https://v.qq.com/x/cover/'+doc.id+'.html'});
      }
    });
    return out;
  }
  var PLATFORM_QUERIES={
    youku:async function(title,request) {
      var html=await request('https://so.youku.com/search/q_'+encodeURIComponent(title),null,'text');
      return parseYouku(html,title);
    },
    tencent:async function(title,request) {
      var body={version:'26022601',clientType:1,filterValue:'',uuid:'episodewatch-public-search',retry:0,query:title,pagenum:0,pagesize:30,queryFrom:0,isneedQc:true,searchDatakey:'',transInfo:'',untouched:true,
        featureList:['DEFAULT_FEFEATURE','PC_SHORT_VIDEOS_WATERFALL','PC_WANT_EPISODE_V2','PC_WANT_EPISODE','RECOMMEND_AI_QUERY']};
      return parseTencent(await request('https://pbaccess.video.qq.com/trpc.videosearch.mobile_search.MultiTerminalSearch/MbSearch?vversion_platform=2',body),title);
    }
  };

  function platformTitleQuery(title) {
    var match=/^(.*?)\s*[（(](\d{4})(?:年)?[）)]$/.exec(title);
    return {title:match?match[1].trim():title,year:match?match[2]:''};
  }
  function platformPick(rows, requested) {
    var query=platformTitleQuery(requested), hits=[], unique=Object.create(null);
    rows.forEach(function (r) {
      if (!r || !r.id || norm(r.title)!==norm(query.title) || (query.year && String(r.year)!==query.year)) return;
      var n=kanNumber(r.updated), total=kanNumber(r.total);
      if (!Number.isInteger(n) || n<0 || n>5000 || (Number.isInteger(total)&&total>0&&n>total)) return;
      var k=r.source+':'+r.id;
      if (!unique[k]) {unique[k]=true;hits.push(r);}
    });
    if (hits.length>1) error('平台有同名版本，请填写剧名和年份。');
    return hits[0] || null;
  }
  function platformList(match) {
    var rows=[];
    for (var n=1;n<=Number(match.updated);n++) rows.push({key:'0:'+n,s:0,n:n,at:0,url:match.url});
    rows.info={sourceLabel:PLATFORM_NAMES[match.source]+' · 平台标注进度',total:kanNumber(match.total)>0?Number(match.total):null,latest:Number(match.updated),url:match.url};
    return rows;
  }
  async function extraSources(item, request, persist) {
    var query=platformTitleQuery(item.title), enabled=Object.keys(PLATFORM_QUERIES);
    var preferred=persist && getStored(P+'platform_preferred_'+encodeURIComponent(norm(item.title)));
    var results=await Promise.all(enabled.map(async function (source) {
      try {
        var candidates=await PLATFORM_QUERIES[source](query.title,request);
        var found=platformPick(candidates,item.title);
        return {source:source,found:found};
      } catch (e) { return {source:source,error:clean(e.message)}; }
    }));
    if (results.some(function(r){return r.error&&r.error.indexOf('同名')>=0;})) error('平台有同名版本，请填写剧名和年份。');
    var hits=results.filter(function (r) {return r.found;});
    if (!hits.length) {
      error('补充平台未找到可信的更新进度，请检查完整剧名或年份。');
    }
    var years=Array.from(new Set(hits.map(function(r){return String(r.found.year||'');}).filter(Boolean)));
    if (!query.year && years.length>1) error('平台有同名不同年份版本，请在剧名后加年份。');
    // Do not choose the largest count from unrelated services or membership tiers.
    var picked=hits.filter(function(r){return r.source===preferred;})[0] || hits[0];
    if (persist) save(P+'platform_preferred_'+encodeURIComponent(norm(item.title)),picked.source);
    return {match:picked.found,list:platformList(picked.found)};
  }
  async function loadEpisodes(item,mode,request) {
    var oldError;
    try {
      var match=await resolve(item,request,mode!=='preview');
      var queryItem=item.automatic?Object.assign({},item,{season:0}):item;
      var list=await episodes(match,queryItem,request);
      if (!list.length && !(list.info&&list.info.latest===0)) error('没有可核实的已播集数。');
      return {match:match,list:list};
    } catch (e) {oldError=e;}
    if (!item.source && !item.season && /[\u2e80-\u9fff]/.test(item.title)) {
      // Ambiguous results are never repaired by guessing on another platform.
      if (/同名|多个版本/.test(String(oldError.message))) throw oldError;
      try {return await extraSources(item,request,mode!=='preview');}
      catch(e){error(clean(oldError.message)+'\n补充源：'+clean(e.message));}
    }
    throw oldError;
  }

  async function resolve(item, request, persist) {
    if (item.source) {
      if (!item.id || (item.source === 'bgm' && item.season)) error('Bangumi 请用指定季度条目，并填写「第 N 集」。');
      var detail = await request(item.source === 'bgm' ? BGM + '/v0/subjects/' + item.id : TV + '/shows/' + item.id);
      if (!detail || detail.id !== item.id || (item.source === 'bgm' && [2, 6].indexOf(detail.type) < 0)) error('条目不是可追踪的剧集。');
      return item.source === 'bgm' ? mapBgm(detail) : mapTv(detail);
    }
    // Chinese titles prefer a current platform-index source before legacy metadata.
    if (!item.season && /[\u2e80-\u9fff]/.test(item.title)) {
      var cnKey=P+'match_v12_cn_'+encodeURIComponent(norm(item.title));
      var cnOld=persist && getStored(cnKey);
      if (cnOld && cnOld.source==='kan360' && /^[a-zA-Z0-9_-]+$/.test(cnOld.id) && ['2','4'].indexOf(cnOld.cat)>=0) return cnOld;
      var cnMatch=null;
      try { cnMatch=await resolveKan(item,request); }
      catch (e) { if (String(e.message).indexOf('同名版本')>=0) throw e; }
      if (cnMatch) { if (persist) save(cnKey,cnMatch); return cnMatch; }
      try {return (await extraSources(item,request,persist)).match;}
      catch(e){if (/同名/.test(String(e.message))) throw e;}
    }
    var key = P + 'match_' + (item.season ? 'tv_' : '') + encodeURIComponent(norm(item.title));
    var old = persist && getStored(key);
    if (old && old.id > 0 && (old.source === 'bgm' || old.source === 'tvmaze')) return old;
    var order = item.season ? ['tvmaze'] : /[\u2e80-\u9fff\u3040-\u30ff]/.test(item.title) ? ['bgm','tvmaze'] : ['tvmaze','bgm'];
    var near = [], failed = false;
    for (var i = 0; i < order.length; i++) {
      var hits;
      try {
        if (order[i] === 'bgm') {
          var bgm = await request(BGM + '/v0/search/subjects?limit=15', {keyword:item.title, filter:{type:[2,6], nsfw:false}});
          if (!bgm || !Array.isArray(bgm.data)) error('搜索响应异常');
          hits = bgm.data.filter(function (x) { return x && [2,6].indexOf(x.type) >= 0; }).map(mapBgm);
        } else {
          var tv = await request(TV + '/search/shows?q=' + encodeURIComponent(item.title));
          if (!Array.isArray(tv)) error('搜索响应异常');
          hits = tv.filter(function (x) { return x && x.show; }).map(function (x) { return mapTv(x.show); });
        }
      } catch (_) { failed = true; continue; }
      var hit = exact(hits, item.title);
      if (hit) { if (persist) save(key, hit); return hit; }
      near = near.concat(hits);
      if (hits.filter(function (c) { return c.names.some(function (n) { return n && norm(n) === norm(item.title); }); }).length > 1) break;
    }
    error(near.length ? '请写完整剧名，或用条目编号：\n' + suggestions(near) : failed ? '剧名查询未完成，稍后重试。' : '未找到剧集，可试完整剧名或条目编号。');
  }
  function dateOnly(s, tz) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
    var utc = Date.parse(s + 'T00:00:00Z');
    return isFinite(utc) && new Date(utc).toISOString().slice(0, 10) === s ? utc + DAY + tz : NaN;
  }
  function decode(rows, source, season) {
    var by = Object.create(null);
    rows.forEach(function (r) {
      if (!r || (source === 'bgm' && r.type !== 0) || (source === 'tvmaze' && ((r.type && r.type !== 'regular') || (season && r.season !== season)))) return;
      var n = source === 'bgm' ? r.sort : r.number;
      var s = source === 'bgm' ? 0 : r.season;
      if (!Number.isInteger(n) || n < 1 || !Number.isInteger(s) || s < 0 || (source === 'tvmaze' && !s)) return;
      var stamp = source === 'tvmaze' && typeof r.airstamp === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(r.airstamp) ? Date.parse(r.airstamp) : NaN;
      if (!isFinite(stamp)) stamp = dateOnly(source === 'bgm' ? r.airdate : null, -8 * 3600000);
      if (!isFinite(stamp)) return;
      var key = s + ':' + n;
      if (!by[key] || stamp > by[key].at) by[key] = { key:key, s:s, n:n, at:stamp, date:r.airdate, url:source === 'bgm' && r.id > 0 ? 'https://bgm.tv/ep/' + r.id : '' };
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a,b) { return a.at-b.at || a.s-b.s || a.n-b.n; });
  }
  async function episodes(match, item, request) {
    if (PLATFORM_NAMES[match.source]) return platformList(match);
    if (match.source==='kan360') {
      return kanEpisodes(await request(KAN_DETAIL+'cat='+encodeURIComponent(match.cat)+'&id='+encodeURIComponent(match.id)),match);
    }
    var list = [], prefix = BGM + '/v0/episodes?subject_id=' + match.id + '&type=0&limit=100&offset=';
    if (match.source === 'bgm') {
      for (var page = 0; page < 6; page++) {
        var res = await request(prefix + list.length);
        if (!res || !Array.isArray(res.data) || !Number.isInteger(res.total) || res.total < 0) error('单集列表格式异常。');
        list = list.concat(res.data);
        if (list.length >= res.total) break;
        if (!res.data.length || page === 5) error('单集列表未取全，暂不判断是否更新。');
      }
    } else {
      list = await request(TV + '/shows/' + match.id + '/episodes');
      if (!Array.isArray(list)) error('单集列表格式异常。');
      if (!item.season && !item.automatic && list.some(function (r) { return r && r.season > 1; })) error('该剧按季编号，请改用「' + item.title + ' S02E03」格式。');
    }
    return decode(list, match.source, item.season);
  }
  function assess(list, watched, previous, now, automatic) {
    var aired = list.filter(function (e) { return e.at <= now; }).sort(function (a,b) { return a.at-b.at || a.s-b.s || a.n-b.n; });
    var known = new Set(previous || []);
    if (automatic) {
      var future = list.filter(function (e) { return e.at > now; }).sort(function (a,b) { return a.at-b.at || a.s-b.s || a.n-b.n; });
      return {latest:aired.length ? aired[aired.length-1] : null,next:future[0] || null,unseen:0,
        fresh:previous == null ? [] : aired.filter(function (e) { return !known.has(e.key); }),
        seen:Array.from(new Set((previous || []).concat(aired.map(function (e) { return e.key; })) ))};
    }
    var latest = aired.length ? aired[aired.length - 1].n : 0;
    var next = list.filter(function (e) { return e.at > now && e.n > Math.max(watched, latest); })
      .sort(function (a, b) { return a.at - b.at || a.n - b.n; })[0];
    return {latest:latest,next:next,unseen:aired.filter(function (e) { return e.n > watched; }).length,
      fresh:previous == null ? [] : aired.filter(function (e) { return e.n > watched && !known.has(e.n); }),
      seen:Array.from(new Set((previous || []).concat(aired.map(function (e) { return e.n; }))))};
  }
  function dateText(ms) {
    var x = new Date(ms);
    return (x.getMonth()+1) + '月' + x.getDate() + '日 ' + String(x.getHours()).padStart(2,'0') + ':' + String(x.getMinutes()).padStart(2,'0');
  }
  function tag(s, n) { return s ? 'S' + String(s).padStart(2,'0') + 'E' + String(n).padStart(2,'0') : '第 ' + n + ' 集'; }
  function compose(rows, now) {
    var blocks = rows.map(function (r) {
      if (r.error) return r.title + '\n' + r.error;
      var latest = r.latest && typeof r.latest === 'object' ? r.latest : null;
      var next = r.next || null;
      var line = r.automatic ? (latest ? '最新已播 ' + tag(latest.s,latest.n) : '尚无已播集数') : '已看到 ' + tag(r.season,r.watched) + ' · ' + (r.latest ? '已播至 ' + tag(r.season,r.latest) : '暂无已播');
      if (r.info) {
        line=line.replace('最新已播','平台更新至').replace('已播至','平台更新至');
        if (r.info.total) line+=' / 共 '+r.info.total+' 集';
      }
      return r.title + (r.unseen ? ' · 待看 ' + r.unseen + ' 集' : '') + '\n' + line + (next ? '\n预计 ' + tag(next.s || r.season,next.n) + ' · ' + (r.source === 'bgm' ? next.date : dateText(next.at)) : '') + (r.info ? '\n'+r.info.sourceLabel+'（含会员档位）' : '');
    });
    return {title:'追更提醒 · ' + rows.length + ' 部', content:blocks.join('\n\n') + '\n\n检测于 ' + dateText(now) + ' · 每 30 分钟', icon:'play.rectangle', 'icon-color':rows.some(function (r) { return r.error; }) ? '#FF9F0A' : '#0A84FF'};
  }
  async function check(item, mode, request, store, notify, clock) {
    var loaded=await loadEpisodes(item,mode,request);
    var match=loaded.match, list=loaded.list;
    if (!list.length && !(list.info && list.info.latest===0)) error('没有可核实播出时间的正片，暂不提醒。');
    var key = P + 'seen_' + match.source + '_' + match.id + '_' + (item.automatic ? 'all' : match.source === 'tvmaze' ? item.season || 1 : 0);
    var previous = mode === 'preview' ? null : store.get(key);
    if (!Array.isArray(previous) || !previous.every(function (n) { return typeof n === 'string' || (Number.isInteger(n) && n > 0); })) previous = null;
    var sharedKey=null, shared=null;
    if (list.info && !item.source && !item.season) {
      sharedKey=P+'platform_seen_v13_'+encodeURIComponent(norm(item.title))+'_'+(item.automatic?'all':'manual');
      shared=mode==='preview'?null:store.get(sharedKey);
      if (!Array.isArray(shared)||!shared.every(function(n){return item.automatic?typeof n==='string':Number.isInteger(n)&&n>0;})) shared=null;
      if (shared) previous=Array.from(new Set((previous||[]).concat(shared)));
      // Migrate existing source records without consuming newly discovered episodes.
      if (mode!=='preview' && shared===null && previous!==null && !store.set(sharedKey,previous)) error('无法保存跨源通知记录。');
    }
    function storeSeen(value) {
      if (!store.set(key,value)) return false;
      return !sharedKey || store.set(sharedKey,value);
    }
    var r = assess(list, item.episode == null ? 0 : item.episode, previous, clock(), item.automatic);
    if (mode !== 'preview' && previous == null) {
      if (!storeSeen(r.seen)) error('无法保存追更记录。');
    } else if (mode === 'cron' && r.seen.length !== previous.length) {
      // Save the episode IDs before notifying so panel refreshes cannot consume alerts.
      if (!storeSeen(r.seen)) error('无法保存追更记录。');
      if (r.fresh.length && (item.automatic || item.episode == null || r.fresh.some(function (e) { return e.n > item.episode; }))) {
        var last = r.fresh[r.fresh.length - 1];
        var url = last.url || (match.source === 'bgm' ? 'https://bgm.tv/subject/' + match.id : 'https://www.tvmaze.com/shows/' + match.id);
        var freshLine = item.automatic ? (r.fresh.length > 1 ? '新增 ' + r.fresh.length + ' 集' : '更新了 ' + tag(last.s,last.n)) : '更新了 ' + r.fresh.length + ' 集 · 已播至 ' + tag(item.season,last.n);
        if (item.automatic && r.fresh.length > 1) freshLine += ' · 最新 ' + tag(last.s,last.n);
        if (list.info) freshLine += ' · 平台收录进度';
        try { notify('追更提醒', clean(match.title), freshLine, {action:'open-url',url:url}); }
        catch (e) { storeSeen(previous); throw e; }
      }
    }
    return {title:clean(match.title), latest:r.latest, watched:item.episode, season:item.season,
      automatic:item.automatic, unseen:r.unseen, next:r.next, source:match.source, info:list.info || null};
  }
  async function main(arg) {
    var cfg = parse(arg);
    if (!cfg.items.length) return {title:'追更提醒', content:'尚未添加追更条目\n\n自动追更：直接填剧名\n例：庆余年 第二季\n\n指定进度：剧名 第12集\n海外剧：Breaking Bad S02E03\n多部用分号分开。', icon:'play.rectangle', 'icon-color':'#0A84FF'};
    var store = {get:getStored,set:save};
    var out = await Promise.all(cfg.items.map(async function (item) {
      try { return await check(item,cfg.mode,req,store,function () { $notification.post.apply($notification,arguments); },Date.now); }
      catch (e) { return {title:item.title,error:String(e.message || e).split('\n').map(clean).join('\n')}; }
    }));
    return compose(out, Date.now());
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {parse:parse,exact:exact,dateOnly:dateOnly,decode:decode,episodes:episodes,assess:assess,check:check,kanCandidates:kanCandidates,kanEpisodes:kanEpisodes,resolveKan:resolveKan,compose:compose,parseYouku:parseYouku,parseTencent:parseTencent,platformPick:platformPick,platformList:platformList,extraSources:extraSources,loadEpisodes:loadEpisodes,explicitProgress:explicitProgress,queries:PLATFORM_QUERIES};
  if (typeof $done === 'function') {
    var arg = typeof $argument === 'string' ? $argument : 'panel|-';
    var cron = arg.indexOf('cron|') === 0;
    main(arg).then(function (panel) { if (cron) $done(); else $done(panel); },function (e) {
      if (cron) { console.log('追更提醒：' + clean(e.message)); $done(); }
      else $done({title:'追更提醒 · 参数检查',content:clean(e.message),style:'alert'});
    });
  }
}());
