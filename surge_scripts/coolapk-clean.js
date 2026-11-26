/*
 * Coolapk Ad Cleaner for Surge v1.0. SPDX-License-Identifier: MIT
 * Original route/filter logic; MIT safety framework reused from taobao-clean.js.
 * No network, storage, account, or cookie APIs. Unknown input passes through.
 */
(function () {
  'use strict';
  var LIMIT = 2097152;
  var ROUTE = /^https:\/\/api\.coolapk\.com\/v6\/(?:main\/(?:dataList|indexV8)|page\/dataList)(?:\?[^#]*)?$/;
  function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function own(v, k) { return Object.prototype.hasOwnProperty.call(v, k); }
  function headerValue(headers, name) {
    var target = name.toLowerCase(), i, keys;
    if (Array.isArray(headers)) {
      for (i = 0; i < headers.length; i++) {
        if (String(headers[i].field).toLowerCase() === target) return String(headers[i].value);
      }
    } else if (object(headers)) {
      keys = Object.keys(headers);
      for (i = 0; i < keys.length; i++) {
        if (keys[i].toLowerCase() === target) return String(headers[keys[i]]);
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
    Object.keys(headers || {}).forEach(function (k) { if (!stale.test(k)) out[k] = headers[k]; });
    return out;
  }
  function parseSafeJSON(text) {
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
        while (next < text.length && /\s/.test(text.charAt(next))) next++;
        if (text.charAt(next) === ':') {
          var keys = stack[stack.length - 1];
          if (!keys) throw new Error('Invalid object key');
          var key = JSON.parse(text.slice(start, i));
          if (own(keys, key)) throw new Error('Duplicate key');
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
      } else { i++; }
    }
    return JSON.parse(text);
  }
  function unpack(body) {
    if (typeof body !== 'string' || !body || body.length > LIMIT) return null;
    var plain = /^(\s*)(\{[\s\S]*\})(\s*)$/.exec(body);
    if (plain) return {document: parseSafeJSON(plain[2]), before: plain[1], after: plain[3]};
    var jsonp = /^(\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(\s*)(\{[\s\S]*\})(\s*\)\s*;?\s*)$/.exec(body);
    if (jsonp) return {document: parseSafeJSON(jsonp[2]), before: jsonp[1], after: jsonp[3]};
    return null;
  }
  function cleanDocument(url, doc) {
    if (!ROUTE.test(url) || !object(doc)) return 0;
    // Error/unknown envelopes must not be converted to successful pages.
    if (own(doc, 'status') && doc.status !== 1) return 0;
    if (own(doc, 'error') || own(doc, 'errorCode') || own(doc, 'message')) return 0;
    if (!Array.isArray(doc.data) || !doc.data.length || doc.data.length > 2000) return 0;
    if (!doc.data.every(object)) return 0;
    var kept = doc.data.filter(function (card) {
      return !(own(card, 'entityTemplate') && card.entityTemplate === 'sponsorCard');
    });
    var removed = doc.data.length - kept.length;
    // All-ad pages are deliberately unchanged: empty-list pagination is unverified.
    if (!removed || !kept.length) return 0;
    doc.data = kept;
    return removed;
  }
  function rewrite(url, response) {
    try {
      if (!ROUTE.test(String(url || '')) || !object(response)) return {};
      var status = Number(response.status || response.statusCode || 200);
      if (status !== 200) return {};
      var type = headerValue(response.headers, 'content-type');
      if (type && !/(?:json|javascript|ecmascript)/i.test(type)) return {};
      var envelope = unpack(response.body);
      if (!envelope || !cleanDocument(String(url), envelope.document)) return {};
      return {headers: bodyHeaders(response.headers),
        body: envelope.before + JSON.stringify(envelope.document) + envelope.after};
    } catch (_) { return {}; }
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {version: '1.0', rewrite: rewrite};
  } else if (typeof $done === 'function') {
    $done(rewrite(typeof $request !== 'undefined' ? $request.url : '',
      typeof $response !== 'undefined' ? $response : null));
  }
}());
