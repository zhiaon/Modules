// ============================================================
// Surge 网络 IP 信息面板  V1.6
//
//   SSID: ZTE_5G
//
//   本地 IP: 117.66.221.40
//   位置: 🇨🇳 安徽省 宣城市
//   运营商: 中国电信
//
//   ────────────────
//   ◆策略: Proxy → ikuuu-香港Z05 | IEPL
//   入口: 14.23.28.96
//   位置: 🇨🇳 广东省 广州市
//   运营商: 中国电信
//
//   落地 IP: 103.151.172.84
//   位置: 🇭🇰 香港 油尖旺區 旺角
//   运营商: IP Transit
//
//   执行时间: 19:48:39
//
// 参数：目标
//   填策略组名 / 节点名，多个用 | 分隔
//   无论填什么，FINAL 那条兜底策略组都会额外单独显示一份
// ============================================================

var ARG = (typeof $argument === 'undefined' || $argument === null) ? '' : String($argument);

var OUT = [];
var LOCAL = { ip: '', cc: '', loc: '', isp: '' };
var NET = { ssid: '', carrier: '', radio: '' };
var PENDING = 0;
var RENDERED = false;

// ---------------- 参数清洗 ----------------

function isBlank(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return true;
  if (/^(空|无|自动|默认|不填|留空|none|null|auto|default|auto-select)$/i.test(s)) return true;
  if (/^留空/.test(s)) return true;
  if (/^填/.test(s)) return true;
  if (/^<.*>$/.test(s)) return true;
  return false;
}

function splitTargets(s) {
  var parts = String(s || '').split(/[|,，、;；\n]+/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (!isBlank(p)) out.push(p);
  }
  return out;
}

// ---------------- 国家 / 旗帜 / 地名 ----------------

var NAME2CC = {
  '中国': 'CN', '中国大陆': 'CN', '中华人民共和国': 'CN',
  '香港': 'HK', '中国香港': 'HK', '台湾': 'TW', '中国台湾': 'TW', '澳门': 'MO', '中国澳门': 'MO',
  '日本': 'JP', '韩国': 'KR', '新加坡': 'SG', '马来西亚': 'MY', '泰国': 'TH', '越南': 'VN',
  '菲律宾': 'PH', '印尼': 'ID', '印度尼西亚': 'ID', '印度': 'IN', '巴基斯坦': 'PK', '孟加拉': 'BD',
  '阿联酋': 'AE', '以色列': 'IL', '土耳其': 'TR', '沙特阿拉伯': 'SA', '哈萨克斯坦': 'KZ',
  '美国': 'US', '加拿大': 'CA', '墨西哥': 'MX', '巴西': 'BR', '阿根廷': 'AR', '智利': 'CL',
  '英国': 'GB', '德国': 'DE', '法国': 'FR', '荷兰': 'NL', '俄罗斯': 'RU', '意大利': 'IT',
  '西班牙': 'ES', '瑞典': 'SE', '瑞士': 'CH', '波兰': 'PL', '芬兰': 'FI', '挪威': 'NO',
  '丹麦': 'DK', '爱尔兰': 'IE', '奥地利': 'AT', '比利时': 'BE', '捷克': 'CZ', '葡萄牙': 'PT',
  '乌克兰': 'UA', '罗马尼亚': 'RO', '匈牙利': 'HU', '希腊': 'GR',
  '澳大利亚': 'AU', '新西兰': 'NZ', '南非': 'ZA', '埃及': 'EG', '尼日利亚': 'NG',
  '柬埔寨': 'KH', '老挝': 'LA', '缅甸': 'MM', '蒙古': 'MN', '尼泊尔': 'NP', '斯里兰卡': 'LK'
};

var CCNAME = {
  CN: '中国', HK: '中国香港', TW: '中国台湾', MO: '中国澳门',
  JP: '日本', KR: '韩国', SG: '新加坡', US: '美国', GB: '英国', DE: '德国',
  FR: '法国', NL: '荷兰', RU: '俄罗斯', CA: '加拿大', AU: '澳大利亚',
  MY: '马来西亚', TH: '泰国', VN: '越南', PH: '菲律宾', ID: '印尼',
  IN: '印度', TR: '土耳其', BR: '巴西', AE: '阿联酋', IL: '以色列'
};

function ccName(c) {
  c = String(c || '').toUpperCase();
  return CCNAME[c] || c;
}

function flagOf(cc) {
  cc = String(cc || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  var a = cc.charCodeAt(0) - 65, b = cc.charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return '';
  return String.fromCodePoint(0x1F1E6 + a, 0x1F1E6 + b);
}

function ccGuess(name) {
  var s = String(name || '').trim();
  if (!s) return '';
  if (NAME2CC[s]) return NAME2CC[s];
  if (s.indexOf('香港') >= 0) return 'HK';
  if (s.indexOf('台湾') >= 0) return 'TW';
  if (s.indexOf('澳门') >= 0) return 'MO';
  if (s.indexOf('中国') === 0) return 'CN';
  for (var k in NAME2CC) {
    if (NAME2CC.hasOwnProperty(k) && k.length > 2 && s.indexOf(k) >= 0) return NAME2CC[k];
  }
  return '';
}

var SAR = { '香港': 'HK', '台湾': 'TW', '澳门': 'MO' };

function normGeo(country, region, city, cc) {
  var o = {
    cc: String(cc || '').toUpperCase(),
    country: String(country || '').trim(),
    region: String(region || '').trim(),
    city: String(city || '').trim()
  };
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(o.city)) o.city = '';
  var names = [o.region, o.city, o.country];
  for (var i = 0; i < names.length; i++) {
    var v = names[i];
    if (!v) continue;
    for (var k in SAR) {
      if (!SAR.hasOwnProperty(k)) continue;
      if (v.indexOf(k) >= 0) {
        o.cc = SAR[k];
        if (o.region === k) o.region = '';
        if (o.country === k || o.country === '中国' + k || o.country === '中国') o.country = '';
        return o;
      }
    }
  }
  return o;
}

var EN2CN = {
  'beijing': '北京', 'tianjin': '天津', 'hebei': '河北', 'shanxi': '山西',
  'inner mongolia': '内蒙古', 'nei mongol': '内蒙古', 'liaoning': '辽宁',
  'jilin': '吉林', 'heilongjiang': '黑龙江', 'shanghai': '上海', 'jiangsu': '江苏',
  'zhejiang': '浙江', 'anhui': '安徽', 'fujian': '福建', 'jiangxi': '江西',
  'shandong': '山东', 'henan': '河南', 'hubei': '湖北', 'hunan': '湖南',
  'guangdong': '广东', 'guangxi': '广西', 'hainan': '海南', 'chongqing': '重庆',
  'sichuan': '四川', 'guizhou': '贵州', 'yunnan': '云南', 'tibet': '西藏',
  'xizang': '西藏', 'shaanxi': '陕西', 'gansu': '甘肃', 'qinghai': '青海',
  'ningxia': '宁夏', 'xinjiang': '新疆',
  'guangzhou': '广州', 'shenzhen': '深圳', 'dongguan': '东莞', 'foshan': '佛山',
  'zhuhai': '珠海', 'hangzhou': '杭州', 'ningbo': '宁波', 'wenzhou': '温州',
  'nanjing': '南京', 'suzhou': '苏州', 'wuxi': '无锡', 'xuzhou': '徐州',
  'hefei': '合肥', 'wuhu': '芜湖', 'fuyang': '阜阳', 'fuzhou': '福州',
  'xiamen': '厦门', 'quanzhou': '泉州', 'nanchang': '南昌', 'jinan': '济南',
  'qingdao': '青岛', 'yantai': '烟台', 'zhengzhou': '郑州', 'wuhan': '武汉',
  'changsha': '长沙', 'chengdu': '成都', 'kunming': '昆明', 'guiyang': '贵阳',
  'xian': '西安', "xi'an": '西安', 'lanzhou': '兰州', 'urumqi': '乌鲁木齐',
  'shenyang': '沈阳', 'dalian': '大连', 'harbin': '哈尔滨', 'changchun': '长春',
  'shijiazhuang': '石家庄', 'taiyuan': '太原', 'hohhot': '呼和浩特',
  'nanning': '南宁', 'haikou': '海口', 'hong kong': '香港', 'macau': '澳门',
  'macao': '澳门', 'taipei': '台北', 'tokyo': '东京', 'osaka': '大阪',
  'seoul': '首尔', 'singapore': '新加坡', 'los angeles': '洛杉矶',
  'san jose': '圣何塞', 'new york': '纽约', 'seattle': '西雅图',
  'london': '伦敦', 'frankfurt': '法兰克福', 'amsterdam': '阿姆斯特丹',
  'paris': '巴黎', 'sydney': '悉尼', 'toronto': '多伦多',
  'central singapore': '中区'
};

function cnPlaceName(s) {
  var raw = String(s || '').trim();
  if (!raw) return '';
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw;
  var k = raw.toLowerCase()
    .replace(/\s+(sheng|shi|city|province|municipality|prefecture)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (EN2CN[k]) return EN2CN[k];
  var nospace = k.replace(/\s+/g, '');
  if (EN2CN[nospace]) return EN2CN[nospace];
  return raw;
}

function cnSuffix(region, city) {
  var r = String(region || '').trim();
  var c = String(city || '').trim();
  var isCJK = function (s) { return /[\u4e00-\u9fa5]/.test(s); };
  // 「中国」「中国香港」这类国家级名字不能再补「省」
  var isCountryLevel = /^(中国|中华人民共和国|中国香港|中国台湾|中国澳门|香港|台湾|澳门)$/.test(r);
  if (r && isCJK(r) && !isCountryLevel && !/(省|自治区|市|特别行政区)$/.test(r)) r += '省';
  if (c && isCJK(c) && !/(市|区|县|盟|地区)$/.test(c) && !/自治州$/.test(c)) c += '市';
  if (r === c) c = '';
  return [r, c];
}

function buildLoc(country, region, city, cc) {
  var g = normGeo(country, region, city, cc);
  var SHORT = { CN: '中国', HK: '香港', TW: '台湾', MO: '澳门' };
  var parts = [];

  if (g.cc === 'CN') {
    var rc = cnSuffix(cnPlaceName(g.region), cnPlaceName(g.city));
    parts = [rc[0], rc[1]];
  } else if (SHORT[g.cc]) {
    parts = [SHORT[g.cc], cnPlaceName(g.region), cnPlaceName(g.city)];
  } else {
    parts = [ccName(g.cc) || g.country, cnPlaceName(g.region), cnPlaceName(g.city)];
  }

  var seen = {}, out = [];
  for (var i = 0; i < parts.length; i++) {
    var v = String(parts[i] || '').trim();
    if (!v || seen[v]) continue;
    seen[v] = 1;
    out.push(v);
  }
  var flag = flagOf(g.cc);
  var body = out.join(' ');
  return flag ? (flag + ' ' + body) : body;
}

function ispName(isp) {
  var s = String(isp || '').trim();
  if (!s) return '';
  if (/^电信$/.test(s)) return '中国电信';
  if (/^联通$/.test(s)) return '中国联通';
  if (/^移动$/.test(s)) return '中国移动';
  if (/^广电$/.test(s)) return '中国广电';
  if (/chinanet|china\s*telecom|chinatelecom|jin-rong\s*street/i.test(s)) return '中国电信';
  if (/china\s*unicom|^cucc/i.test(s)) return '中国联通';
  if (/china\s*mobile|^cmnet|^cmcc/i.test(s)) return '中国移动';
  if (/cernet|china\s*education/i.test(s)) return '中国教育网';
  return s;
}

// ---------------- 小工具 ----------------

function stripSuffix(a) {
  return String(a || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function isIP(s) {
  s = String(s || '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return true;
  if (s.indexOf(':') >= 0 && /^[0-9a-fA-F:]+$/.test(s)) return true;
  return false;
}

function isV6(s) {
  return String(s || '').indexOf(':') >= 0;
}

function shortIP(ip) {
  ip = String(ip || '');
  if (ip.indexOf(':') < 0) return ip;
  var g = ip.split(':');
  if (g.length <= 4) return ip;
  return g.slice(0, 4).join(':') + '::';
}

function joinNice(parts) {
  var seen = {}, out = [];
  for (var i = 0; i < parts.length; i++) {
    var v = String(parts[i] === null || parts[i] === undefined ? '' : parts[i]).trim();
    if (!v || seen[v]) continue;
    seen[v] = 1;
    out.push(v);
  }
  return out.join(' · ');
}

function splitISP(txt) {
  var s = String(txt || '').replace(/\s+/g, ' ').trim();
  if (!s) return { loc: '', isp: '' };
  var m = /(电信|联通|移动|广电|铁通|教育网|鹏博士|长城宽带|歌华|方正宽带|有线通|有线|中信网络)$/.exec(s);
  if (m) return { loc: s.slice(0, s.length - m[1].length).trim(), isp: m[1] };
  return { loc: s, isp: '' };
}

// ---------------- API 封装 ----------------

function apiGet(path, cb) {
  try {
    $httpAPI('GET', path, null, function (r) { cb(r || {}); });
  } catch (e) {
    cb({});
  }
}

function parseFinal(rules) {
  for (var i = rules.length - 1; i >= 0; i--) {
    var m = /^\s*FINAL\s*,\s*([^,\s]+)/i.exec(String(rules[i] || ''));
    if (m) return m[1].trim();
  }
  return '';
}

function refFor(node, pol, fallback) {
  var ext = pol['external-policies'] || [];
  for (var i = 0; i < ext.length; i++) {
    if (ext[i] && ext[i].name === node && ext[i].identifier) return ext[i].identifier;
  }
  return node || fallback;
}

function isGroup(name, pol) {
  var gs = pol['policy-groups'] || [];
  for (var i = 0; i < gs.length; i++) if (gs[i] === name) return true;
  return false;
}

// ---------------- 数据源 ----------------

var SOURCES = [
  {
    url: 'http://ip-api.com/json/?lang=zh-CN&fields=status,message,country,countryCode,regionName,city,isp,as,query',
    parse: function (t) {
      var j = JSON.parse(t);
      if (j.status && j.status !== 'success') return null;
      if (!j.query) return null;
      return {
        ip: j.query,
        cc: j.countryCode || ccGuess(j.country),
        country: j.country || '',
        region: j.regionName || '',
        city: j.city || '',
        isp: j.isp || j.as || ''
      };
    }
  },
  {
    url: 'http://myip.ipip.net/',
    parse: function (t) {
      var s = String(t).replace(/\s+/g, ' ');
      var mIP = /IP[：:]\s*([0-9a-fA-F:.]+)/.exec(s);
      var mLoc = /来自于[：:]\s*(.+)$/.exec(s);
      if (!mIP) return null;
      var raw = mLoc ? mLoc[1].trim() : '';
      var p = splitISP(raw);
      var seg = p.loc.split(' ').filter(function (x) { return x; });
      return {
        ip: mIP[1],
        cc: ccGuess(seg[0] || ''),
        country: seg[0] || '',
        region: seg[1] || '',
        city: seg.slice(2).join(' '),
        isp: p.isp || ''
      };
    }
  },
  {
    url: 'http://ipinfo.io/json',
    parse: function (t) {
      var j = JSON.parse(t);
      if (!j.ip) return null;
      return {
        ip: j.ip,
        cc: j.country || '',
        country: '',
        region: j.region || '',
        city: j.city || '',
        isp: j.org || ''
      };
    }
  }
];

// ---------------- 出口 + 入口 探测 ----------------

function probe(target, cb) {
  var tok = 'nz' + Math.random().toString(36).slice(2, 10);
  var st = { entry: '', done: false, polls: 0 };
  target.isDirect = /direct/i.test(String(target.ref || '')) || /direct/i.test(String(target.node || ''));

  function stop() {
    if (st.done) return;
    st.done = true;
    if (st.entry) {
      target.entryIP = st.entry;
      if (target.isDirect) return cb();
      ipDetail(st.entry, function (d) {
        target.entryCC = d.cc ? ccName(d.cc) : (target.entryCC || '');
        target.entryLoc = d.loc || '';
        target.entryISP = ispName(d.isp || '');
        cb();
      });
      return;
    }
    cb();
  }

  function scan() {
    if (st.entry) return;
    apiGet('/v1/requests/active', function (a) {
      if (st.entry) return;
      var arr = (a && a.requests) || [];
      for (var i = 0; i < arr.length; i++) {
        if (String(arr[i].URL || '').indexOf(tok) >= 0) {
          var ra = stripSuffix(arr[i].remoteAddress);
          if (isIP(ra)) { st.entry = ra; target.entryIP = ra; return; }
        }
      }
      // 活动连接里没有（长连接复用/请求过快），退到最近连接里找
      if (st.polls >= 4 && !st.entry) {
        apiGet('/v1/requests/recent', function (b) {
          if (st.entry) return;
          var arr2 = (b && b.requests) || [];
          for (var j = 0; j < arr2.length; j++) {
            if (String(arr2[j].URL || '').indexOf(tok) >= 0) {
              var ra2 = stripSuffix(arr2[j].remoteAddress);
              if (isIP(ra2)) { st.entry = ra2; target.entryIP = ra2; return; }
            }
          }
        });
      }
    });
  }

  function poll() {
    if (st.done || st.entry) return;
    st.polls++;
    scan();
    if (st.polls < 20) setTimeout(poll, 120);
  }

  function finalScan(n) {
    if (st.done || st.entry) return stop();
    scan();
    if (n > 0) setTimeout(function () { finalScan(n - 1); }, 300);
    else setTimeout(stop, 400);
  }

  function trySource(i) {
    if (st.done) return;
    if (i >= SOURCES.length) {
      target.err = '查询接口全部失败';
      return stop();
    }
    var src = SOURCES[i];
    var url = src.url + (src.url.indexOf('?') >= 0 ? '&' : '?') + '_=' + tok;
    try {
      $httpClient.get({ url: url, timeout: 10, policy: target.ref }, function (err, resp, data) {
        if (st.done) return;
        if (err) {
          target.err = String(err);
          return trySource(i + 1);
        }
        var got = null;
        try { got = src.parse(String(data)); } catch (e) { got = null; }
        if (!got) {
          target.err = '返回无法解析';
          return trySource(i + 1);
        }
        target.outIP = got.ip || '';
        target.outCC = got.cc || '';
        target.outLoc = buildLoc(got.country, got.region, got.city, got.cc);
        target.outISP = ispName(got.isp || '');
        target.err = '';
        finalScan(2);
      });
    } catch (e) {
      target.err = '请求失败';
      trySource(i + 1);
    }
  }

  setTimeout(poll, 50);
  trySource(0);
  setTimeout(stop, 12000);
}

function enrich(target) {
  if (!target.outISP && target.outIP && $utils && $utils.ipaso) {
    try { target.outISP = ispName($utils.ipaso(target.outIP) || ''); } catch (e) {}
  }
  if (target.entryIP && !target.isDirect) {
    if (!target.entryISP && $utils && $utils.ipaso) {
      try { target.entryISP = ispName($utils.ipaso(target.entryIP) || ''); } catch (e) {}
    }
    if (!target.entryCC && $utils && $utils.geoip) {
      try {
        var cc = String($utils.geoip(target.entryIP) || '').toUpperCase();
        target.entryCC = ccName(cc);
      } catch (e) {}
    }
  }
}

// ---------------- 单 IP 反查（位置 + 运营商） ----------------

var DETAIL_SRC = [
  {
    url: function (ip) {
      return 'http://ip-api.com/json/' + ip + '?lang=zh-CN&fields=status,country,countryCode,regionName,city,isp,org,as,query';
    },
    parse: function (t) {
      var j = JSON.parse(t);
      if (j.status && j.status !== 'success') return null;
      if (!j.query) return null;
      return {
        cc: j.countryCode || ccGuess(j.country),
        country: j.country || '',
        region: j.regionName || '',
        city: j.city || '',
        isp: j.isp || j.org || j.as || ''
      };
    }
  },
  {
    url: function (ip) { return 'https://ipwho.is/' + ip + '?lang=zh-CN'; },
    parse: function (t) {
      var j = JSON.parse(t);
      if (j.success === false) return null;
      if (!j.ip) return null;
      return {
        cc: j.country_code || '',
        country: j.country || '',
        region: j.region || '',
        city: j.city || '',
        isp: (j.connection && (j.connection.isp || j.connection.org)) || ''
      };
    }
  },
  {
    url: function (ip) { return 'http://ipinfo.io/' + ip + '/json'; },
    parse: function (t) {
      var j = JSON.parse(t);
      if (!j.ip) return null;
      return {
        cc: j.country || '',
        country: '',
        region: j.region || '',
        city: j.city || '',
        isp: j.org || ''
      };
    }
  }
];

function ipDetail(ip, cb) {
  var done = false;
  function fin(v) {
    if (done) return;
    done = true;
    cb(v);
  }

  function localOnly() {
    var o = { cc: '', loc: '', isp: '' };
    if ($utils && $utils.ipaso) {
      try { o.isp = ispName($utils.ipaso(ip) || ''); } catch (e) {}
    }
    if ($utils && $utils.geoip) {
      try { o.cc = String($utils.geoip(ip) || '').toUpperCase(); } catch (e) {}
    }
    o.loc = o.cc ? buildLoc('', ccName(o.cc), '', o.cc) : '';
    fin(o);
  }

  function attempt(i) {
    if (done) return;
    if (i >= DETAIL_SRC.length) return localOnly();
    var src = DETAIL_SRC[i];
    try {
      $httpClient.get({ url: src.url(ip), timeout: 9, policy: 'DIRECT' }, function (err, resp, data) {
        if (done) return;
        if (err) return attempt(i + 1);
        var got = null;
        try { got = src.parse(String(data)); } catch (e) { got = null; }
        if (!got) return attempt(i + 1);
        fin({
          cc: got.cc || '',
          loc: buildLoc(got.country, got.region, got.city, got.cc),
          isp: ispName(got.isp || '')
        });
      });
    } catch (e) {
      attempt(i + 1);
    }
  }

  attempt(0);
  setTimeout(function () { if (!done) localOnly(); }, 8000);
}

// ---------------- 策略目标 ----------------

function resolveAndProbe(name, cb) {
  var res = { input: name, title: name, node: '', ref: name, err: '' };

  apiGet('/v1/policies?include_external=true', function (pol) {
    if (!isGroup(name, pol)) {
      res.ref = refFor(name, pol, name);
      res.node = '';
      res.title = name;
      return probe(res, function () { enrich(res); cb(res); });
    }
    apiGet('/v1/policy_groups/select?group_name=' + encodeURIComponent(name), function (s) {
      var chosen = (s && s.policy) ? String(s.policy) : '';
      if (!chosen) chosen = name;
      res.ref = refFor(chosen, pol, name);
      res.node = (chosen && chosen !== name) ? chosen : '';
      res.title = name;
      probe(res, function () { enrich(res); cb(res); });
    });
  });
}

// ---------------- 网络环境 + 本机 ----------------

function readNet() {
  NET.ssid = '';
  NET.isWifi = false;
  try {
    var n = $network || {};
    var w = n.wifi || {};
    var iface = (n.v4 && n.v4.primaryInterface) || '';

    // Wi-Fi 名可能落在 ssid / SSID / network 几个位置，逐个试
    var cands = [w.ssid, w.SSID, n.ssid, n.SSID];
    for (var i = 0; i < cands.length; i++) {
      var s = String(cands[i] === null || cands[i] === undefined ? '' : cands[i]).trim();
      if (s && s !== 'null' && s !== 'undefined') { NET.ssid = s; break; }
    }

    // iOS 上 en0 = Wi-Fi，pdp_ip0 = 蜂窝
    NET.isWifi = !!NET.ssid || !!(w && w.bssid) || iface === 'en0';

    if (n['cellular-data']) {
      NET.carrier = n['cellular-data'].carrier || '';
      NET.radio = n['cellular-data'].radio || '';
    }
  } catch (e) {}
}

function probeLocal(cb) {
  var done = false;
  function fin() {
    if (done) return;
    done = true;
    cb();
  }

  $httpClient.get({ url: 'http://myip.ipip.net/', timeout: 10, policy: 'DIRECT' }, function (err, resp, data) {
    if (!err && data) {
      var s = String(data).replace(/\s+/g, ' ').trim();
      var mIP = /IP[：:]\s*([0-9a-fA-F:.]+)/.exec(s);
      var mLoc = /来自于[：:]\s*(.+)$/.exec(s);
      if (mIP) LOCAL.ip = mIP[1];
      if (mLoc) {
        var p = splitISP(mLoc[1]);
        var seg = p.loc.split(' ').filter(function (x) { return x; });
        LOCAL.cc = ccGuess(seg[0] || '') || 'CN';
        LOCAL.loc = buildLoc(seg[0] || '', seg[1] || '', seg.slice(2).join(' '), LOCAL.cc);
        LOCAL.isp = ispName(p.isp);
      }
    }
    if (LOCAL.ip) return fin();

    $httpClient.get({ url: 'http://cp.cloudflare.com/cdn-cgi/trace', timeout: 10, policy: 'DIRECT' }, function (e2, r2, d2) {
      if (!e2 && d2) {
        var m = /(?:^|\n)ip=([^\n]+)/.exec(String(d2));
        if (m) LOCAL.ip = m[1].trim();
      }
      if (LOCAL.ip && $utils && $utils.geoip) {
        try {
          LOCAL.cc = String($utils.geoip(LOCAL.ip) || '').toUpperCase() || 'CN';
          if (!LOCAL.loc) LOCAL.loc = buildLoc('', ccName(LOCAL.cc), '', LOCAL.cc);
        } catch (e3) {}
      }
      fin();
    });
  });

  setTimeout(fin, 12000);
}

// ---------------- 渲染 ----------------

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function nowText() {
  var d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function render() {
  if (RENDERED) return;
  RENDERED = true;

  var L = [];
  var list = [];
  for (var i = 0; i < OUT.length; i++) if (OUT[i]) list.push(OUT[i]);

  // 兜底组单独拎出来，永远显示；其余为用户填的目标
  var fin = null;
  var users = [];
  for (var q = 0; q < list.length; q++) {
    if (list[q].isFinal) { if (!fin) fin = list[q]; }
    else users.push(list[q]);
  }
  var all = users.slice();
  if (fin) all.push(fin);

  // 同一节点只探测一次，缺入口的块用同节点的结果补上
  var byNode = {};
  for (var bn = 0; bn < all.length; bn++) {
    var bk = all[bn];
    if (bk.entryIP && bk.node && !byNode[bk.node]) byNode[bk.node] = bk;
  }
  for (var bm = 0; bm < all.length; bm++) {
    var bj = all[bm];
    if (!bj.entryIP && bj.node && byNode[bj.node]) {
      bj.entryIP = byNode[bj.node].entryIP;
      bj.entryLoc = byNode[bj.node].entryLoc;
      bj.entryISP = byNode[bj.node].entryISP;
    }
  }

  function policyLine(o) {
    return '◆策略: ' + (o.node ? (o.title + ' → ' + o.node) : o.title);
  }

  function divider() {
    L.push('────────────────');
  }

  function pushEntry(o) {
    if (!o.entryIP || o.isDirect) return false;
    L.push('入口: ' + shortIP(o.entryIP));
    L.push('位置: ' + (o.entryLoc || '-'));
    L.push('运营商: ' + (o.entryISP || '-'));
    return true;
  }

  function pushLand(o) {
    if (o.outIP) {
      L.push('落地 IP: ' + shortIP(o.outIP));
      L.push('位置: ' + (o.outLoc || '-'));
      L.push('运营商: ' + (o.outISP || '-'));
    } else {
      L.push('落地 IP: -');
      L.push('位置: -');
      L.push('运营商: ' + (o.pending ? '检测中' : (o.err || '无响应')));
    }
  }

  // ① 网络名：连着 Wi-Fi 就显示那家的名字（不管是谁的热点）；走蜂窝显示「蜂窝流量」
  L.push('SSID: ' + (NET.ssid || (NET.isWifi ? '（未知）' : '蜂窝流量')));

  L.push('');

  // ② 本机
  L.push('本地 IP: ' + (LOCAL.ip ? shortIP(LOCAL.ip) : '-'));
  L.push('位置: ' + (LOCAL.loc || '-'));
  L.push('运营商: ' + (LOCAL.isp || '-'));

  // ③ 兜底组
  if (fin) {
    L.push('');
    divider();
    L.push(policyLine(fin));
    if (pushEntry(fin)) L.push('');
    pushLand(fin);
  }

  // ④ 其他目标
  for (var u = 0; u < users.length; u++) {
    var o = users[u];
    L.push('');
    divider();
    L.push(policyLine(o));
    if (pushEntry(o)) L.push('');
    pushLand(o);
  }

  L.push('');
  L.push('执行时间: ' + nowText());

  $done({ title: '网络IP信息', content: L.join('\n'), icon: 'network', 'icon-color': '#3B82F6' });
}

function addJob() {
  PENDING++;
  var called = false;
  return function () {
    if (called) return;
    called = true;
    if (--PENDING === 0) render();
  };
}

// 兜底收尾：任何一个探测卡住都不能让面板永远空白
function watchdog(ms) {
  setTimeout(function () {
    if (!RENDERED) render();
  }, ms);
}

// ---------------- 主流程 ----------------

function run() {
  readNet();
  watchdog(30000);

  var typed = splitTargets(ARG);

  probeLocal(addJob());

  var jRules = addJob();
  apiGet('/v1/rules', function (r) {
    var finName = parseFinal(r.rules || []) || 'Proxy';

    var list = typed.slice();
    if (list.indexOf(finName) < 0) list.push(finName);

    for (var i = 0; i < list.length; i++) {
      (function (nm, idx) {
        // 先占位：即使探测超时，策略行也一定能在面板上出现
        OUT[idx] = {
          input: nm, title: nm, node: '', ref: nm, err: '',
          isFinal: (nm === finName), pending: true,
          outIP: '', outLoc: '', outISP: '', entryIP: '',
          entryLoc: '', entryISP: '', entryCC: ''
        };
        var jOne = addJob();
        resolveAndProbe(nm, function (res) {
          res.isFinal = (nm === finName);
          res.pending = false;
          OUT[idx] = res;
          jOne();
        });
      })(list[i], i);
    }
    jRules();
  });
}

run();
