/* 出门天气卡 · V1.1 · 许舟
 * Detailed going-out weather card, powered by Open-Meteo (no API key).
 */
(function () {
  'use strict';
  var CACHE = 'going_out_weather_v2';
  var PLACE_KEY = 'going_out_weather_place_v1';
  var NOTIFY_KEY = 'going_out_weather_notified';
  var started = Date.now();
  var deadline = started + 42000;
  var arg = typeof $argument === 'string' ? $argument : '';
  var p = arg.split('|');
  var finished = false, timer = null, cfg, place, data;

  function s(v) { return v == null ? '' : String(v); }
  function clean(v) { return s(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); }
  function real(v) { v = clean(v); return v === '-' ? '' : v; }
  function truth(v, fallback) { return v == null || v === '' ? fallback : /^(true|1|yes|on|开|开启)$/i.test(s(v).trim()); }
  function z(n) { return ('0' + n).slice(-2); }
  function timeText(ms) {
    var d = new Date(ms || Date.now());
    return d.getFullYear() + '/' + z(d.getMonth() + 1) + '/' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  function dateText(ms) {
    var d = new Date(ms || Date.now());
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  }
  function hhmm(iso) { var m = s(iso).match(/T(\d{2}:\d{2})/); return m ? m[1] : ''; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function round(v, digits) {
    if (v == null) return null;
    var f = Math.pow(10, digits == null ? 0 : digits);
    return Math.round(v * f) / f;
  }
  function loadJson(key) {
    try { var x = JSON.parse($persistentStore.read(key) || 'null'); return x && typeof x === 'object' ? x : null; }
    catch (_) { return null; }
  }
  function saveJson(key, value) { try { $persistentStore.write(JSON.stringify(value), key); } catch (_) {} }

  function weather(code) {
    var map = {
      0: ['晴', '☀️'], 1: ['大部晴朗', '🌤'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
      45: ['雾', '🌫'], 48: ['雾凇', '🌫'],
      51: ['毛毛雨', '🌦'], 53: ['毛毛雨', '🌦'], 55: ['密集毛毛雨', '🌦'],
      56: ['冻毛毛雨', '🌧'], 57: ['冻毛毛雨', '🌧'],
      61: ['小雨', '🌧'], 63: ['中雨', '🌧'], 65: ['大雨', '🌧'],
      66: ['冻雨', '🌧'], 67: ['冻雨', '🌧'],
      71: ['小雪', '🌨'], 73: ['中雪', '🌨'], 75: ['大雪', '❄️'], 77: ['雪粒', '🌨'],
      80: ['阵雨', '🌦'], 81: ['阵雨', '🌧'], 82: ['强阵雨', '⛈'],
      85: ['阵雪', '🌨'], 86: ['强阵雪', '❄️'],
      95: ['雷阵雨', '⛈'], 96: ['雷阵雨伴冰雹', '⛈'], 99: ['雷阵雨伴冰雹', '⛈']
    };
    var x = map[code] || ['未知天气', '🌡'];
    return {text: x[0], icon: x[1]};
  }
  function windDir(deg) {
    var names = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    if (deg == null) return '';
    return names[Math.round(((deg % 360) / 45)) % 8] + '风';
  }
  function uvLevel(v) {
    if (v == null) return '';
    if (v < 3) return '低';
    if (v < 6) return '中等';
    if (v < 8) return '强';
    if (v < 11) return '很强';
    return '极强';
  }
  function aqiLevel(v) {
    if (v == null) return '';
    if (v <= 50) return '优';
    if (v <= 100) return '良';
    if (v <= 150) return '轻度污染';
    if (v <= 200) return '中度污染';
    if (v <= 300) return '重度污染';
    return '严重污染';
  }
  function tempText(v) { return v == null ? '--' : round(v, 0) + '°'; }

  function httpGet(url, headers, done) {
    var opts = {url: url, timeout: 12, headers: headers || {}, 'auto-redirect': true, 'auto-cookie': false};
    if (cfg && cfg.policy) opts.policy = cfg.policy;
    $httpClient.get(opts, function (err, resp, body) {
      var status = resp && Number(resp.status) || 0;
      if (err || !resp || status < 200 || status >= 300) return done(new Error(err ? clean(err) : (status ? 'HTTP ' + status : '无响应')));
      done(null, body);
    });
  }
  function nominatim(city, done) {
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh-CN&q=' + encodeURIComponent(city);
    httpGet(url, {'Accept': 'application/json', 'User-Agent': 'Surge-GoingOutWeather/1.1 (personal panel)'}, function (err, body) {
      if (err) return done(err);
      try {
        var list = JSON.parse(body || '[]'), r = list && list[0];
        if (!r || !r.lat || !r.lon) return done(new Error('地名未找到'));
        var label = clean(r.display_name || r.name || city).split(',')[0];
        done(null, {lat: Number(r.lat), lon: Number(r.lon), name: label || city});
      } catch (e) { done(new Error('地名解析失败')); }
    });
  }
  function openMeteoGeo(city, done) {
    var url = 'https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&format=json&name=' + encodeURIComponent(city);
    httpGet(url, {'Accept': 'application/json'}, function (err, body) {
      if (err) return done(err);
      try {
        var r = (JSON.parse(body || '{}').results || [])[0];
        if (!r) return done(new Error('地名未找到'));
        done(null, {lat: Number(r.latitude), lon: Number(r.longitude), name: clean((r.name || city) + (r.admin1 && r.admin1 !== r.name ? '（' + r.admin1 + '）' : ''))});
      } catch (e) { done(new Error('地名解析失败')); }
    });
  }
  function ipLocate(done) {
    httpGet('http://ip-api.com/json/?lang=zh-CN&fields=status,message,country,regionName,city,lat,lon', {'Accept': 'application/json'}, function (err, body) {
      if (!err) {
        try {
          var d = JSON.parse(body || '{}');
          if (d.status === 'success' && d.lat && d.lon) return done(null, {lat: Number(d.lat), lon: Number(d.lon), name: clean([d.city, d.regionName].filter(Boolean).join(' · ') || '自动定位')});
        } catch (_) {}
      }
      httpGet('https://ipapi.co/json/', {'Accept': 'application/json'}, function (err2, body2) {
        if (err2) return done(new Error('自动定位失败'));
        try {
          var d2 = JSON.parse(body2 || '{}');
          if (!d2.latitude || !d2.longitude) return done(new Error('自动定位失败'));
          done(null, {lat: Number(d2.latitude), lon: Number(d2.longitude), name: clean([d2.city, d2.region].filter(Boolean).join(' · ') || '自动定位')});
        } catch (e) { done(new Error('自动定位失败')); }
      });
    });
  }
  function locate(city, done) {
    if (/^(自动|auto|ip)$/i.test(city)) return ipLocate(done);
    var m = city.match(/^(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return done(null, {lat: Number(m[1]), lon: Number(m[2]), name: Number(m[1]).toFixed(2) + ', ' + Number(m[2]).toFixed(2)});
    var cached = loadJson(PLACE_KEY);
    if (cached && cached.cityInput === city && cached.lat && cached.lon) {
      return done(null, {lat: Number(cached.lat), lon: Number(cached.lon), name: cached.name});
    }
    nominatim(city, function (err, r) {
      if (!err && r) { saveJson(PLACE_KEY, {cityInput: city, lat: r.lat, lon: r.lon, name: r.name, at: Date.now()}); return done(null, r); }
      openMeteoGeo(city, function (err2, r2) {
        if (!err2 && r2) saveJson(PLACE_KEY, {cityInput: city, lat: r2.lat, lon: r2.lon, name: r2.name, at: Date.now()});
        done(err2, r2);
      });
    });
  }
  function forecastUrl(lat, lon) {
    return 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + encodeURIComponent(round(lat, 4)) + '&longitude=' + encodeURIComponent(round(lon, 4)) +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset,wind_gusts_10m_max' +
      '&hourly=temperature_2m,precipitation_probability,weather_code,visibility,dew_point_2m,wind_gusts_10m' +
      '&timezone=auto&forecast_days=1&wind_speed_unit=kmh';
  }
  function airUrl(lat, lon) {
    return 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + encodeURIComponent(round(lat, 4)) +
      '&longitude=' + encodeURIComponent(round(lon, 4)) + '&current=us_aqi,pm2_5,pm10&timezone=auto';
  }
  function nowIndex(times, currentTime) {
    var nowKey = s(currentTime).slice(0, 13);
    for (var i = 0; i < times.length; i++) if (s(times[i]).slice(0, 13) === nowKey) return i;
    return 0;
  }
  function hourlyRows(f, currentTime) {
    var h = f.hourly || {}, times = h.time || [], out = [], idx = nowIndex(times, currentTime), i;
    for (i = idx; i < times.length && out.length < 6; i++) {
      out.push({
        hh: s(times[i]).slice(11, 16),
        temp: num((h.temperature_2m || [])[i]),
        rain: num((h.precipitation_probability || [])[i]),
        code: num((h.weather_code || [])[i])
      });
    }
    return out;
  }
  function parseAir(body) {
    try {
      var c = JSON.parse(body || '{}').current || {};
      var aqi = num(c.us_aqi);
      if (aqi == null) return null;
      return {aqi: aqi, pm25: num(c.pm2_5), pm10: num(c.pm10)};
    } catch (_) { return null; }
  }
  function clothesFor(t) {
    if (t == null) return '—';
    if (t <= 0) return '羽绒服';
    if (t <= 5) return '厚外套';
    if (t <= 11) return '外套';
    if (t <= 17) return '薄外套';
    if (t <= 23) return '长袖';
    if (t <= 29) return '短袖';
    return '清凉短袖';
  }
  function adviceFor(cur, day, rain6, threshold, air) {
    var rain = num(day && day.rain), tmin = num(day && day.tmin), tmax = num(day && day.tmax);
    var aqi = air && air.aqi != null ? air.aqi : null;
    var gust = num(cur && cur.gust);
    var umbrella;
    if ((cur && num(cur.precipitation) > 0) || (rain != null && rain >= 80) || (rain6 != null && rain6 >= 80)) umbrella = '一定要带';
    else if ((rain != null && rain >= threshold) || (rain6 != null && rain6 >= threshold)) umbrella = '建议带';
    else if (rain != null && rain >= 20) umbrella = '可带可不带';
    else umbrella = '不用带';
    var sport;
    if ((rain != null && rain >= 70) || (gust != null && gust >= 50) || (aqi != null && aqi > 150)) sport = '不宜户外';
    else if ((rain != null && rain >= 40) || (aqi != null && aqi > 100) || (gust != null && gust >= 40)) sport = '建议室内';
    else if ((tmax != null && tmax >= 35) || (tmin != null && tmin <= 0)) sport = '谨慎户外';
    else sport = '适合户外';
    var feel = '舒适';
    if (cur && num(cur.feels) != null && num(cur.temp) != null) {
      var diff = num(cur.temp) - num(cur.feels);
      if (diff >= 4) feel = '偏冷 -' + round(diff, 0) + '°';
      else if (diff <= -4) feel = '偏热 +' + round(Math.abs(diff), 0) + '°';
    }
    var clothesBase = cur && cur.temp != null ? cur.temp : null;
    if (tmin != null && (clothesBase == null || tmin < clothesBase)) clothesBase = tmin;
    return {umbrella: umbrella, clothes: clothesFor(clothesBase), sport: sport, feel: feel};
  }
  function parseForecast(body, air) {
    var f = JSON.parse(body || '{}');
    if (!f.current || !f.daily) throw new Error('天气数据不完整');
    var c = f.current, d = f.daily;
    var day = {
      code: num((d.weather_code || [])[0]),
      tmax: num((d.temperature_2m_max || [])[0]),
      tmin: num((d.temperature_2m_min || [])[0]),
      rain: num((d.precipitation_probability_max || [])[0]),
      rainSum: num((d.precipitation_sum || [])[0]),
      uv: num((d.uv_index_max || [])[0]),
      sunrise: hhmm((d.sunrise || [])[0]),
      sunset: hhmm((d.sunset || [])[0])
    };
    var cur = {
      temp: num(c.temperature_2m), feels: num(c.apparent_temperature),
      humidity: num(c.relative_humidity_2m), precipitation: num(c.precipitation),
      code: num(c.weather_code), wind: num(c.wind_speed_10m), gust: num(c.wind_gusts_10m),
      windDir: num(c.wind_direction_10m), pressure: num(c.pressure_msl),
      cloud: num(c.cloud_cover), isDay: num(c.is_day) === 1, time: c.time
    };
    var hours = hourlyRows(f, c.time);
    var rain6 = null, i;
    for (i = 0; i < hours.length; i++) if (hours[i].rain != null && (rain6 == null || hours[i].rain > rain6)) rain6 = hours[i].rain;
    var h = f.hourly || {}, idx = nowIndex(h.time || [], c.time);
    var visibility = num((h.visibility || [])[idx]);
    var dew = num((h.dew_point_2m || [])[idx]);
    return {
      cityInput: cfg.city, place: place, at: Date.now(), current: cur, day: day,
      hours: hours, rain6: rain6, visibility: visibility, dew: dew, air: air,
      advice: adviceFor(cur, day, rain6, cfg.threshold, air)
    };
  }
  function saveData() { saveJson(CACHE, data); }

  function panel() {
    var cur = data.current, day = data.day, w = weather(cur.code), dw = weather(day.code), a = data.air, adv = data.advice || adviceFor(cur, day, data.rain6, cfg.threshold, a);
    var lines = [], rain = day.rain == null ? '--' : round(day.rain, 0) + '%';
    lines.push('📅 ' + dateText(data.at) + ' · ' + timeText(data.at).slice(11) + ' 更新');
    lines.push('');
    lines.push(w.icon + ' ' + w.text + '  ' + tempText(cur.temp) + '  体感 ' + tempText(cur.feels));
    lines.push('🌡 今日 ' + dw.text + ' ' + tempText(day.tmin) + ' ~ ' + tempText(day.tmax));
    lines.push('💧 湿度 ' + (cur.humidity == null ? '--' : round(cur.humidity, 0) + '%') + '   🌬 ' + (windDir(cur.windDir) || '风') + ' ' + (cur.wind == null ? '--' : round(cur.wind, 0) + ' km/h'));
    lines.push('🌧 降水 ' + rain + (data.rain6 == null ? '' : ' · 未来6h ' + round(data.rain6, 0) + '%') + (day.rainSum != null && day.rainSum > 0 ? ' · ' + round(day.rainSum, 1) + ' mm' : ''));
    if (day.uv != null) lines.push('☀️ 紫外线 ' + round(day.uv, 1) + ' · ' + uvLevel(day.uv));
    if (a && a.aqi != null) lines.push('😷 空气 ' + round(a.aqi, 0) + ' · ' + aqiLevel(a.aqi));
    lines.push('🌅 日出 ' + (day.sunrise || '--') + '   🌇 日落 ' + (day.sunset || '--'));
    lines.push('');
    lines.push('━━━━ 出门指数 ━━━━');
    lines.push('☂️ 雨伞  ' + adv.umbrella);
    lines.push('🧥 穿衣  ' + adv.clothes);
    lines.push('🏃 运动  ' + adv.sport);
    lines.push('💨 体感  ' + adv.feel);
    var hours = data.hours || [];
    if (hours.length) {
      lines.push('');
      lines.push('━━━━ 未来几小时 ━━━━');
      hours.forEach(function (h) {
        lines.push(h.hh + ' ' + weather(h.code).icon + ' ' + tempText(h.temp) + '  ' + (h.rain == null ? '--' : round(h.rain, 0) + '%'));
      });
    }
    var details1 = [], details2 = [];
    if (cur.pressure != null) details1.push('气压 ' + round(cur.pressure, 0) + ' hPa');
    if (data.visibility != null) details1.push('能见度 ' + round(data.visibility / 1000, 0) + ' km');
    if (cur.gust != null) details2.push('阵风 ' + round(cur.gust, 0) + ' km/h');
    if (cur.cloud != null) details2.push('云量 ' + round(cur.cloud, 0) + '%');
    if (details1.length || details2.length) {
      lines.push('');
      if (details1.length) lines.push('📋 ' + details1.join(' · '));
      if (details2.length) lines.push('💨 ' + details2.join(' · '));
    }
    if (a && a.pm25 != null) lines.push('🧪 PM2.5 ' + round(a.pm25, 0) + ' · PM10 ' + (a.pm10 == null ? '--' : round(a.pm10, 0)));
    lines.push('🔄 每 30 分钟更新 · Open-Meteo');
    var alert = (day.rain != null && day.rain >= 70) || (cur.code != null && cur.code >= 95) ||
      (day.tmin != null && day.tmin <= 0) || (cur.gust != null && cur.gust >= 50) || (a && a.aqi != null && a.aqi > 150);
    var nice = (cur.code != null && cur.code <= 1) && (day.rain == null || day.rain < 20) && (!a || a.aqi == null || a.aqi <= 100);
    return {title: w.icon + ' 出门天气 · ' + data.place.name, content: lines.join('\n'), style: alert ? 'alert' : (nice ? 'good' : 'info')};
  }
  function errorPanel(error) {
    var cached = loadJson(CACHE);
    var samePlace = !place || !cached || !cached.place ||
      (Math.abs(Number(cached.place.lat) - Number(place.lat)) < 0.2 && Math.abs(Number(cached.place.lon) - Number(place.lon)) < 0.2);
    if (cached && cached.current && cached.cityInput === cfg.city && samePlace) {
      data = cached;
      var r = panel();
      r.content += '\n\n⚠️ 本次更新失败，显示上次数据：' + error;
      r.style = 'alert';
      return r;
    }
    if (!cfg.city) {
      return {title: '出门天气', style: 'info', content: '尚未填写城市\n\n打开模块 → 参数 → 城市\n可填城市名、经纬度或 自动\n例：杭州 / 30.94,118.75 / 自动\n\n城市为必填项，没有预填默认值'};
    }
    return {title: '出门天气', style: 'error', content: '⚠ ' + error + '\n\n打开模块 → 参数 → 城市\n可填城市名、经纬度或 自动\n例：杭州 / 30.94,118.75 / 自动'};
  }
  function notify() {
    var isCron = typeof $script !== 'undefined' && $script.type === 'cron';
    if (!isCron || !cfg.notify || typeof $notification === 'undefined') return;
    var cur = data.current, day = data.day, w = weather(cur.code), adv = data.advice || adviceFor(cur, day, data.rain6, cfg.threshold, data.air);
    var today = new Date(), key = today.getFullYear() + '-' + z(today.getMonth() + 1) + '-' + z(today.getDate());
    try { if ($persistentStore.read(NOTIFY_KEY) === key) return; } catch (_) {}
    var lines = [
      tempText(cur.temp) + ' ' + w.text + ' · 今日 ' + tempText(day.tmin) + '~' + tempText(day.tmax),
      '🌧 降水 ' + (day.rain == null ? '--' : round(day.rain, 0) + '%') + (data.rain6 == null ? '' : ' · 未来6h ' + round(data.rain6, 0) + '%'),
      '☂️ 带伞 ' + adv.umbrella + '   🧥 ' + adv.clothes,
      '🏃 运动 ' + adv.sport
    ];
    if (data.air && data.air.aqi != null) lines.push('😷 空气 ' + round(data.air.aqi, 0) + ' ' + aqiLevel(data.air.aqi));
    $notification.post('出门天气 · ' + data.place.name, w.icon + ' ' + w.text, lines.join('\n'), {sound: false, 'auto-dismiss': true});
    try { $persistentStore.write(key, NOTIFY_KEY); } catch (_) {}
  }
  function finish() {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    notify();
    if (typeof $script !== 'undefined' && $script.type === 'cron') $done(); else $done(panel());
  }
  function fail(message) {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    if (typeof $script !== 'undefined' && $script.type === 'cron') $done(); else $done(errorPanel(message));
  }
  try {
    var city = real(p[0]);
    var threshold = real(p[3]);
    threshold = threshold === '' ? 50 : Number(threshold);
    if (!isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error('降雨提醒阈值需在 0~100 之间');
    cfg = {city: city, notify: truth(p[1], true), policy: real(p[2]), threshold: threshold};
    if (!city) throw new Error('尚未填写城市');
    timer = setTimeout(function () { fail('查询超时'); }, Math.max(1000, deadline - Date.now()));
    locate(city, function (err, loc) {
      if (err) return fail('地名解析失败：' + err.message);
      place = loc;
      var pending = 2, fBody = null, fErr = null, aBody = null;
      function step() {
        pending--;
        if (pending > 0) return;
        if (fErr) return fail('天气查询失败：' + fErr.message);
        try { data = parseForecast(fBody, parseAir(aBody)); saveData(); finish(); }
        catch (e) { fail(clean(e && e.message ? e.message : e)); }
      }
      httpGet(forecastUrl(loc.lat, loc.lon), {'Accept': 'application/json'}, function (e, b) {
        if (e) fErr = e; else fBody = b;
        step();
      });
      httpGet(airUrl(loc.lat, loc.lon), {'Accept': 'application/json'}, function (e, b) {
        if (!e) aBody = b;
        step();
      });
    });
  } catch (e) { fail(clean(e && e.message ? e.message : e)); }
}());
