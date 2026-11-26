/*
 * Taobao Ad Cleaner for Surge, v1.0
 * Original implementation. No network calls, storage, cookies or account access.
 * Only explicitly allowlisted response routes may be changed. Unknown input passes through.
 * SPDX-License-Identifier: MIT
 */
(function () {
  'use strict';
  var VERSION = '1.0';
  var LIMIT = 2097152;
  function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function headerValue(headers, name) {
    var target = name.toLowerCase();
    if (Array.isArray(headers)) {
      for (var i = 0; i < headers.length; i++) {
        if (String(headers[i].field).toLowerCase() === target) return String(headers[i].value);
      }
    } else if (object(headers)) {
      var keys = Object.keys(headers);
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase() === target) return String(headers[keys[j]]);
      }
    }
    return '';
  }
  function bodyHeaders(headers) {
    var stale = /^(?:content-length|content-encoding|transfer-encoding|content-md5|etag)$/i;
    if (Array.isArray(headers)) {
      return headers.filter(function (h) { return !stale.test(String(h.field)); });
    }
    var out = {};
    Object.keys(headers || {}).forEach(function (key) {
      if (!stale.test(key)) out[key] = headers[key];
    });
    return out;
  }
  function parseSafeJSON(text) {
    // Refuse any value that native JSON round-tripping could change. String contents
    // are skipped lexically; a long product ID written as a string remains safe.
    var stack = [], i = 0;
    while (i < text.length) {
      var ch = text.charAt(i), start;
      if (ch === '"') {
        start = i++;
        var closed = false;
        while (i < text.length) {
          ch = text.charAt(i++);
          if (ch === '\\') i++;
          else if (ch === '"') { closed = true; break; }
        }
        if (!closed) throw new Error('Unterminated string');
        var next = i;
        while (/\s/.test(text.charAt(next)) && next < text.length) next++;
        if (text.charAt(next) === ':') {
          var keys = stack[stack.length - 1];
          if (!keys) throw new Error('Invalid object key');
          var key = JSON.parse(text.slice(start, i));
          if (Object.prototype.hasOwnProperty.call(keys, key)) throw new Error('Duplicate key');
          keys[key] = true;
        }
      } else if (ch === '{' || ch === '[') {
        stack.push(ch === '{' ? Object.create(null) : null);
        if (stack.length > 128) throw new Error('Nesting limit');
        i++;
      } else if (ch === '}' || ch === ']') {
        stack.pop(); i++;
      } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
        start = i++;
        while (i < text.length && /[0-9eE+.\-]/.test(text.charAt(i))) i++;
        var token = text.slice(start, i), number = Number(token);
        if (!isFinite(number) || Math.abs(number) > 9007199254740991 ||
            JSON.stringify(number) !== token) throw new Error('Non-lossless number');
      } else {
        i++;
      }
    }
    return JSON.parse(text);
  }
  function unpack(body) {
    if (typeof body !== 'string' || !body || body.length > LIMIT) return null;
    var plain = /^(\s*)(\{[\s\S]*\})(\s*)$/.exec(body);
    if (plain) return {document: parseSafeJSON(plain[2]), before: plain[1], after: plain[3]};
    // Parse JSONP as data, never evaluate JavaScript. Callback spelling is kept byte-for-byte.
    var jsonp = /^(\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(\s*)(\{[\s\S]*\})(\s*\)\s*;?\s*)$/.exec(body);
    if (jsonp) return {document: parseSafeJSON(jsonp[2]), before: jsonp[1], after: jsonp[3]};
    return null;
  }
  var API = 'mtop.taobao.wireless.home.splash.awesome.get';
  var ROUTE = /^https:\/\/guide-acs\.m\.taobao\.com\/gw\/mtop\.taobao\.wireless\.home\.splash\.awesome\.get(?:\/|\?|$)/;
  function own(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }
  function cleanDocument(url, document) {
    if (!ROUTE.test(url) || !object(document)) return 0;
    if (own(document, 'api') && document.api !== API) return 0;
    if (own(document, 'ret')) {
      if (!Array.isArray(document.ret) || !document.ret.length ||
          !document.ret.every(function (value) {
            return typeof value === 'string' && /^SUCCESS(?:::|$)/.test(value);
          })) return 0;
    }
    var data = document.data;
    if (!object(data) || !object(data.containers)) return 0;
    var splash = data.containers.splash_home_base;
    if (!object(splash) || !object(splash.base)) return 0;
    var sections = splash.base.sections;
    if (!Array.isArray(sections) || sections.length > 100) return 0;
    var cards = [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      if (!object(section) || !object(section.bizData) ||
          !own(section.bizData, 'taobao-splash')) continue;
      var block = section.bizData['taobao-splash'];
      if (!object(block) || !Array.isArray(block.data)) continue;
      if (block.data.length > 200 || cards.length + block.data.length > 1000) return 0;
      for (var j = 0; j < block.data.length; j++) {
        if (object(block.data[j])) cards.push(block.data[j]);
      }
    }
    var changes = 0;
    cards.forEach(function (card) {
      // Preserve original types and structure; never invent missing control fields.
      ['times', 'waitTime'].forEach(function (key) {
        if (own(card, key) && typeof card[key] === 'string' &&
            /^\d+(?:\.\d+)?$/.test(card[key]) && card[key] !== '0') {
          card[key] = '0'; changes++;
        }
      });
      ['hotStart', 'coldStart', 'haveVoice'].forEach(function (key) {
        if (own(card, key) && card[key] === 'true') {
          card[key] = 'false'; changes++;
        }
      });
      // Only creative URLs within the explicit splash-ad container, never product media.
      ['imgUrl', 'videoUrl'].forEach(function (key) {
        if (own(card, key) && typeof card[key] === 'string' && card[key] !== '') {
          card[key] = ''; changes++;
        }
      });
    });
    return changes;
  }
  function rewrite(url, response) {
    try {
      if (!object(response)) return {};
      var status = Number(response.status || response.statusCode || 200);
      if (status !== 200) return {};
      var contentType = headerValue(response.headers, 'content-type');
      if (contentType && !/(?:json|javascript|ecmascript)/i.test(contentType)) return {};
      var envelope = unpack(response.body);
      if (!envelope || !object(envelope.document)) return {};
      var changed = cleanDocument(String(url || ''), envelope.document);
      if (!changed) return {};
      return {
        headers: bodyHeaders(response.headers),
        body: envelope.before + JSON.stringify(envelope.document) + envelope.after
      };
    } catch (_) {
      return {};
    }
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {version: VERSION, rewrite: rewrite, unpack: unpack, cleanDocument: cleanDocument};
  } else if (typeof $done === 'function') {
    $done(rewrite(typeof $request !== 'undefined' ? $request.url : '',
      typeof $response !== 'undefined' ? $response : null));
  }
}());
