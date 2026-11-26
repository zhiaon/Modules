/* Domain Collector v0.1 — storage / normalizer / generator core.
 * ES5-compatible UMD. No auto run, no network, no timers, no cross-run globals.
 * Bundle target: Surge iOS JSC engine (rule script hot path).
 *
 * Storage layout (all keys under the DomainCollectorData namespace):
 *   DomainCollectorData                     small root config  (< ~2 KB)
 *   DomainCollectorData.s.<gen>.<shard>     one bounded shard    (<=256 recs / <=64 KiB, 48 shards)
 *   DomainCollectorData.token               manager-only CSRF token
 *   DomainCollectorData.recovery.<n>        bounded raw corruption snapshot (write-once)
 */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = api;
  }
  /* Surge JSC has no module system: expose a plain global. Written through
   * globalThis when present, and through `this`/self as a fallback, so the
   * bundle works whether or not the wrapper is called with a real `this`. */
  if (typeof globalThis !== 'undefined' && globalThis) globalThis.DomainCollectorCore = api;
  else {
    try { this.DomainCollectorCore = api; } catch (e) { /* strict wrapper: ignore */ }
    try { if (typeof self !== 'undefined' && self) self.DomainCollectorCore = api; } catch (e2) { /* ignore */ }
  }
}).call(this, function () {
  'use strict';

  var VERSION = 1;

  var KEY_ROOT = 'DomainCollectorData';
  var KEY_PREFIX = 'DomainCollectorData.';
  var KEY_TOKEN = 'DomainCollectorData.token';
  var KEY_RECOVERY = 'DomainCollectorData.recovery.';
  var KEY_SHARD = 'DomainCollectorData.s.';

  var SHARD_COUNT = 48;                 /* fixed, deterministic, never rehashed */
  var MAX_SHARD_RECORDS = 256;          /* hard cap per shard */
  var MAX_SHARD_BYTES = 65536;          /* hard cap per shard value (64 KiB) */
  var MAX_ROOT_BYTES = 163840;          /* hard cap before JSON.parse (160 KiB:
                                          256 excludes + counters with headroom) */
  var LIMIT_BYTES = 3145728;            /* recommended total dataset budget 3 MiB */
  var VALUE_GUARD_BYTES = 3670016;      /* Surge per-value guard 3.5 MiB */
  var RECOVERY_SLOTS = 3;
  var RECOVERY_MAX_BYTES = 32768;       /* bounded raw preservation */

  var DEFAULT_MAX_DOMAINS = 5000;
  var HARD_MAX_DOMAINS = 10000;
  var COALESCE_MS = 60000;              /* stats coalescing window */
  var MAX_EXCLUDE = 256;
  var MAX_WARNINGS = 16;
  var MAX_HISTORY = 6;
  var MAX_HOST_LEN = 253;
  var MAX_LABEL_LEN = 63;

  var PROTO_CODES = { HTTP: 'h', HTTPS: 's', TCP: 't', UDP: 'u', QUIC: 'q', STUN: 'n' };
  var CODE_PROTOS = { h: 'HTTP', s: 'HTTPS', t: 'TCP', u: 'UDP', q: 'QUIC', n: 'STUN', o: 'OTHER' };

  /* The manager UI is served from this host with a map-local rule. Its own
   * requests must never enter the catalog (self-observation loop). */
  var RESERVED_HOSTS = ['domain-collector.invalid'];

  /* ------------------------------------------------------------------ errors */

  function fail(code, message) {
    var e = new Error(message || code);
    e.code = code;
    e.name = 'DomainCollectorError';
    throw e;
  }

  /* ------------------------------------------------------------------ helpers */

  function isArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function clampInt(v, lo, hi) {
    var n = Math.floor(Number(v));
    if (!isFinite(n)) return null;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }
  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }
  function safeParse(raw) {
    if (typeof raw !== 'string' || raw === '') return { ok: false, reason: 'empty' };
    try {
      var v = JSON.parse(raw);
      if (!v || typeof v !== 'object' || isArray(v)) return { ok: false, reason: 'not-object' };
      return { ok: true, value: v };
    } catch (e) {
      return { ok: false, reason: 'parse' };
    }
  }
  function utf8Bytes(s) {
    /* UTF-8 byte length without allocating; lone surrogates encode as U+FFFD. */
    var n = 0, i = 0, c, next;
    for (; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) {
        next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
        if (next >= 0xDC00 && next <= 0xDFFF) { n += 4; i++; }
        else n += 3;
      } else n += 3;
    }
    return n;
  }
  /* Device-local calendar day. "todayNew" is a local-day counter so it matches
   * what the user sees on their own clock; the snapshot exposes dayMode:'local'. */
  function dayKeyOf(ms) {
    var d = new Date(ms);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }
  function hash32(s) {
    var h = 5381, i = 0, c;
    for (; i < s.length; i++) {
      c = s.charCodeAt(i);
      h = ((h * 33) ^ c) >>> 0;
    }
    return h >>> 0;
  }

  /* --------------------------------------------------------------- normalize */

  function looksIPv4(s) {
    var parts = s.split('.');
    if (parts.length !== 4) return false;
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(parts[i])) return false;
      if (parts[i].length > 1 && parts[i].charAt(0) === '0') return false;
      if (Number(parts[i]) > 255) return false;
    }
    return true;
  }

  /* Covers the odd forms resolvers accept: 0x7f000001, 0x7f.1, 127.1,
   * 2130706433, 0177.0.0.1 — all of them denote an address, not a hostname. */
  function looksAddressLiteral(s) {
    var parts = s.split('.');
    if (parts.length > 4) return false;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(p)) return false;
      if (/^0[0-7]+$/.test(p) && p.length > 1) continue;      /* octal form */
      if (/^0[xX]/.test(p)) continue;                          /* hex form */
      if (Number(p) > 255) {
        /* a lone oversized decimal is the packed form, still an address */
        return parts.length === 1 || true;
      }
    }
    return true;
  }

  function allLabelsNumeric(s) {
    var parts = s.split('.');
    for (var i = 0; i < parts.length; i++) if (!/^\d+$/.test(parts[i])) return false;
    return true;
  }

  /* Returns {ok:boolean, domain:string|null, reason:string} — never throws. */
  function normalizeHost(input) {
    if (typeof input !== 'string') return { ok: false, domain: null, reason: 'not-string' };
    /* Bounded work first: an absurd value is rejected before any scan. */
    if (input.length > MAX_HOST_LEN + 8) return { ok: false, domain: null, reason: 'too-long' };
    var s = input.replace(/^[\s\u0000-\u001F]+|[\s\u0000-\u001F]+$/g, '');
    if (!s) return { ok: false, domain: null, reason: 'empty' };
    s = s.toLowerCase();
    /* strip every trailing root dot */
    while (s.length && s.charAt(s.length - 1) === '.') s = s.slice(0, -1);
    if (!s) return { ok: false, domain: null, reason: 'empty' };
    if (s.indexOf('/') >= 0 || s.indexOf('@') >= 0 || s.indexOf('?') >= 0 ||
        s.indexOf('#') >= 0 || s.indexOf(' ') >= 0 || s.indexOf('\t') >= 0 ||
        s.indexOf('\\') >= 0) {
      return { ok: false, domain: null, reason: 'invalid-char' };
    }
    if (s.charAt(0) === '[' || s.indexOf(']') >= 0) return { ok: false, domain: null, reason: 'ip' };
    if (s.indexOf(':') >= 0) return { ok: false, domain: null, reason: 'ip' };
    if (looksIPv4(s) || allLabelsNumeric(s) || looksAddressLiteral(s)) {
      return { ok: false, domain: null, reason: 'ip' };
    }
    if (s.length > MAX_HOST_LEN) return { ok: false, domain: null, reason: 'too-long' };
    var labels = s.split('.');
    for (var i = 0; i < labels.length; i++) {
      var lab = labels[i];
      if (!lab) return { ok: false, domain: null, reason: 'empty-label' };
      if (lab.length > MAX_LABEL_LEN) return { ok: false, domain: null, reason: 'label-too-long' };
      if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(lab)) {
        return { ok: false, domain: null, reason: 'invalid-char' };
      }
    }
    return { ok: true, domain: s, reason: 'ok' };
  }

  /* Protocol seen in $request.protocol (connection level: HTTP/HTTPS/TCP/UDP/QUIC/STUN).
   * Normalised to a one-char code; anything else collapses to 'o' (OTHER).
   * This is the transport-level protocol only — it never implies HTTP-layer visibility. */
  function normalizeProtocol(p) {
    if (typeof p !== 'string') return { code: 'o', label: 'OTHER', known: false };
    var s = p.replace(/[\s\u0000-\u001F]/g, '').toUpperCase();
    if (has(PROTO_CODES, s)) return { code: PROTO_CODES[s], label: s, known: true };
    if (s.length > 0 && s.length <= 16 && /^[A-Z0-9._-]+$/.test(s)) {
      return { code: 'o', label: 'OTHER', known: false, unmapped: s };
    }
    return { code: 'o', label: 'OTHER', known: false, unmapped: null };
  }

  /* protocol string "hs" -> ["HTTP","HTTPS"] sorted by label, deduped */
  function codesToProtocols(codeStr) {
    var out = [], seen = {}, i, ch;
    var s = str(codeStr);
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (!CODE_PROTOS[ch] || seen[ch]) continue;
      seen[ch] = 1;
      out.push(CODE_PROTOS[ch]);
    }
    out.sort();
    return out;
  }
  /* Canonical order is fixed, so merging never sorts on the hot path. */
  var CODE_ORDER = 'hstunqo';
  function addCode(codeStr, code) {
    var s = str(codeStr);
    if (s.indexOf(code) >= 0) return { value: s, added: false };
    var merged = codesToCodeString(s + code);
    var out = '';
    for (var i = 0; i < CODE_ORDER.length; i++) {
      var ch = CODE_ORDER.charAt(i);
      if (merged.indexOf(ch) >= 0) out += ch;
    }
    return { value: out, added: true };
  }
  function codesToCodeString(s) {
    var seen = {}, out = '', i;
    for (i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (!CODE_PROTOS[ch] || seen[ch]) continue;
      seen[ch] = 1;
      out += ch;
    }
    return out;
  }

  function isReservedHost(domain) {
    for (var i = 0; i < RESERVED_HOSTS.length; i++) {
      var r = RESERVED_HOSTS[i];
      if (domain === r) return true;
      if (domain.length > r.length + 1 && domain.slice(domain.length - r.length - 1) === '.' + r) return true;
    }
    return false;
  }

  function shardIndexFor(domain, shardCount) {
    var n = shardCount && shardCount > 0 ? shardCount : SHARD_COUNT;
    return hash32(domain) % n;
  }
  function shardKeyFor(gen, index) { return KEY_SHARD + gen + '.' + index; }

  /* ------------------------------------------------------------------ store io */

  function rawRead(store, key, counters) {
    try {
      var v = store.read(key);
      if (counters) counters.reads++;
      if (v === null) return { ok: true, value: null };
      if (typeof v !== 'string') return { ok: false, value: null, error: 'unexpected-store-type' };
      return { ok: true, value: v };
    } catch (e) {
      if (counters) counters.readErrors++;
      return { ok: false, value: null, error: String(e && e.message ? e.message : e) };
    }
  }
  function rawWrite(store, value, key, counters) {
    try {
      if (typeof value === 'string') {
        var bytes = utf8Bytes(value);
        if (bytes > VALUE_GUARD_BYTES ||
            (key === KEY_ROOT && bytes > MAX_ROOT_BYTES) ||
            (typeof key === 'string' && key.indexOf(KEY_SHARD) === 0 && bytes > MAX_SHARD_BYTES) ||
            (typeof key === 'string' && key.indexOf(KEY_RECOVERY) === 0 && bytes > RECOVERY_MAX_BYTES)) return false;
      }
      var r = store.write(value, key);
      if (counters) counters.writes++;
      /* Surge returns true on success. Anything else is a failed write. */
      return r === true;
    } catch (e) {
      if (counters) { counters.writes++; counters.writeErrors++; }
      return false;
    }
  }

  /* --------------------------------------------------------------- root model */

  function newRoot(now, opts) {
    var o = opts || {};
    var root = {
      v: VERSION,
      gen: str(o.gen) || 'g' + now.toString(36),
      cfgRev: 1,
      seq: 0,
      enabled: o.enabled === true,
      paused: o.paused === true,
      maxDomains: clampInt(o.maxDomains, 1, HARD_MAX_DOMAINS) || DEFAULT_MAX_DOMAINS,
      count: 0,
      dayKey: dayKeyOf(now),
      todayNew: 0,
      lastSeen: null,
      exclude: [],
      shards: SHARD_COUNT,
      shardBytes: [],
      shardCounts: [],
      history: [],
      warnings: [],
      createdAt: now,
      updatedAt: now,
      recovered: o.recovered === true
    };
    var i;
    for (i = 0; i < SHARD_COUNT; i++) { root.shardBytes.push(0); root.shardCounts.push(0); }
    if (isArray(o.warnings)) for (i = 0; i < o.warnings.length && i < MAX_WARNINGS; i++) root.warnings.push(o.warnings[i]);
    return root;
  }

  /* Returns null when the parsed root is structurally sound, else a reason.
   * A schema-broken root must NOT be silently "repaired" with zeroed counters
   * and written back: that would destroy the only record of what was stored. */
  function schemaError(r) {
    if (!r || typeof r !== 'object' || isArray(r)) return 'not-object';
    if (r.v !== VERSION) return 'version';
    if (typeof r.gen !== 'string' || !r.gen) return 'gen';
    if (!isFiniteNum(r.cfgRev) || r.cfgRev < 1) return 'cfgRev';
    if (!isFiniteNum(r.maxDomains) || r.maxDomains < 1) return 'maxDomains';
    if (!isFiniteNum(r.count) || r.count < 0) return 'count';
    if (typeof r.enabled !== 'boolean') return 'enabled';
    if (typeof r.paused !== 'boolean') return 'paused';
    if (!isArray(r.shardBytes) && r.shardBytes !== undefined) return 'shardBytes';
    if (!isArray(r.shardCounts) && r.shardCounts !== undefined) return 'shardCounts';
    if (isArray(r.shardCounts) && r.shardCounts.length !== SHARD_COUNT) return 'shardCounts-length';
    if (isArray(r.shardBytes) && r.shardBytes.length !== SHARD_COUNT) return 'shardBytes-length';
    if (r.exclude !== undefined && !isArray(r.exclude)) return 'exclude';
    return null;
  }

  /* fast=true is the request path: it must not run normalizeHost over the whole
   * exclude list. Entries were normalised when written, so a cheap structural
   * check is enough; anything suspicious falls back to full normalisation. */
  function sanitizeRootFastExclude(list) {
    if (!isArray(list)) return { list: [], clean: true };
    if (list.length > MAX_EXCLUDE) return { list: [], clean: false };
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (typeof e !== 'string' || e.length === 0 || e.length > MAX_HOST_LEN) return { list: [], clean: false };
      if (e !== e.toLowerCase()) return { list: [], clean: false };
      if (e.charAt(0) === '.' || e.charAt(e.length - 1) === '.') return { list: [], clean: false };
      if (e.indexOf('..') >= 0 || e.indexOf(' ') >= 0 || e.indexOf('/') >= 0) return { list: [], clean: false };
      if (!/[a-z0-9]/.test(e)) return { list: [], clean: false };
    }
    return { list: list.slice(0), clean: true };
  }

  function sanitizeRoot(r, fast) {
    var root = newRoot(Number(r.createdAt) || 0, { gen: r.gen, enabled: r.enabled === true, paused: r.paused === true });
    root.v = VERSION;
    root.cfgRev = clampInt(r.cfgRev, 1, 1e9) || 1;
    root.seq = clampInt(r.seq, 0, 1e15) || 0;
    root.maxDomains = clampInt(r.maxDomains, 1, HARD_MAX_DOMAINS) || DEFAULT_MAX_DOMAINS;
    root.count = Math.max(0, clampInt(r.count, 0, 1e6) || 0);
    root.dayKey = /^\d{4}-\d{2}-\d{2}$/.test(str(r.dayKey)) ? r.dayKey : dayKeyOf(Number(r.updatedAt) || 0);
    root.todayNew = Math.max(0, clampInt(r.todayNew, 0, 1e6) || 0);
    root.lastSeen = isFiniteNum(r.lastSeen) ? r.lastSeen : null;
    if (fast) {
      var fx = sanitizeRootFastExclude(r.exclude);
      root.exclude = fx.clean ? fx.list : normalizeExcludeList(r.exclude).list;
    } else {
      root.exclude = normalizeExcludeList(r.exclude).list;
    }
    root.shards = SHARD_COUNT;
    root.shardBytes = [];
    root.shardCounts = [];
    var i, sb = isArray(r.shardBytes) ? r.shardBytes : [], sc = isArray(r.shardCounts) ? r.shardCounts : [];
    for (i = 0; i < SHARD_COUNT; i++) {
      root.shardBytes.push(Math.max(0, clampInt(sb[i], 0, MAX_SHARD_BYTES) || 0));
      root.shardCounts.push(Math.max(0, clampInt(sc[i], 0, MAX_SHARD_RECORDS) || 0));
    }
    root.history = [];
    if (isArray(r.history)) {
      for (i = 0; i < r.history.length && i < MAX_HISTORY; i++) {
        var h = r.history[i];
        if (!h || typeof h !== 'object') continue;
        root.history.push({
          gen: str(h.gen), records: Math.max(0, clampInt(h.records, 0, 1e6) || 0),
          bytes: Math.max(0, clampInt(h.bytes, 0, 1e9) || 0),
          at: isFiniteNum(h.at) ? h.at : null, reason: str(h.reason) || 'clear'
        });
      }
    }
    root.warnings = [];
    if (isArray(r.warnings)) {
      for (i = 0; i < r.warnings.length && i < MAX_WARNINGS; i++) {
        if (typeof r.warnings[i] === 'string') root.warnings.push(r.warnings[i]);
      }
    }
    root.updatedAt = isFiniteNum(r.updatedAt) ? r.updatedAt : root.createdAt;
    root.recovered = r.recovered === true;
    if (r.purge && typeof r.purge === 'object') {
      root.purge = {
        gens: isArray(r.purge.gens) ? r.purge.gens.slice(0, MAX_HISTORY) : [],
        deleted: Math.max(0, clampInt(r.purge.deleted, 0, 1e6) || 0),
        failed: Math.max(0, clampInt(r.purge.failed, 0, 1e6) || 0),
        skipped: Math.max(0, clampInt(r.purge.skipped, 0, 1e6) || 0),
        at: isFiniteNum(r.purge.at) ? r.purge.at : null
      };
    }
    return root;
  }

  function revisionOf(root) {
    if (!root) return 'g0-c0';
    return String(root.gen) + '.' + String(root.cfgRev);
  }

  function pushWarning(root, w) {
    if (!root || !w) return;
    for (var i = 0; i < root.warnings.length; i++) if (root.warnings[i] === w) return;
    root.warnings.push(w);
    while (root.warnings.length > MAX_WARNINGS) root.warnings.shift();
  }

  /* Normalisation only. Sorting is a management-time concern, so the hot path
   * never sorts; callers that want a stable display order sort a copy. */
  function normalizeExcludeList(input) {
    var out = [], seen = Object.create(null), warnings = [];
    if (!isArray(input)) return { list: out, warnings: warnings, invalid: [] };
    var invalid = [];
    for (var i = 0; i < input.length && out.length < MAX_EXCLUDE; i++) {
      var n = normalizeHost(input[i]);
      if (!n.ok) { invalid.push(String(input[i])); continue; }
      if (seen[n.domain] === 1) continue;
      seen[n.domain] = 1;
      out.push(n.domain);
    }
    if (invalid.length) warnings.push('exclude-rejected:' + invalid.length);
    return { list: out, warnings: warnings, invalid: invalid };
  }

  /* ---------------------------------------------------------------- shard model */

  function parseShard(raw) {
    if (raw === null) return { ok: true, records: [] };
    /* Bound the work before JSON.parse: a corrupted 4 MB value must never be
     * parsed (or looped over) on the request path. */
    if (typeof raw !== 'string') return { ok: false, records: [], reason: 'not-string' };
    if (utf8Bytes(raw) > MAX_SHARD_BYTES) {
      return { ok: false, records: [], reason: 'oversize', length: raw.length, bytes: utf8Bytes(raw), limit: MAX_SHARD_BYTES };
    }
    var p = safeParse(raw);
    if (!p.ok) return { ok: false, records: [], reason: p.reason };
    if (p.value.v !== VERSION) return { ok: false, records: [], reason: 'version', version: p.value.v };
    var arr = p.value.r;
    if (!isArray(arr)) return { ok: false, records: [], reason: 'shape' };
    if (arr.length > MAX_SHARD_RECORDS) {
      return { ok: false, records: [], reason: 'too-many-records', length: arr.length, limit: MAX_SHARD_RECORDS };
    }
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      /* One malformed entry invalidates the shard. Skipping the bad entry and
       * re-writing the shard would silently erase a stored domain. */
      if (!e || typeof e !== 'object' || isArray(e)) {
        return { ok: false, records: [], reason: 'record-shape', index: i };
      }
      var d = normalizeHost(e.d);
      if (!d.ok) return { ok: false, records: [], reason: 'record-domain', index: i };
      if (!isFiniteNum(e.f) || !isFiniteNum(e.l) || !isFiniteNum(e.v) || typeof e.p !== 'string') {
        return { ok: false, records: [], reason: 'record-fields', index: i };
      }
      out.push({
        d: d.domain,
        f: e.f,
        l: e.l,
        p: codesToCodeString(str(e.p)),
        v: Math.max(1, clampInt(e.v, 1, 1e9) || 1)
      });
    }
    return { ok: true, records: out };
  }

  function serializeShard(records) {
    return JSON.stringify({ v: VERSION, r: records });
  }

  function recordToPublic(rec) {
    return {
      domain: rec.d,
      firstSeen: rec.f,
      lastSeen: rec.l,
      protocols: codesToProtocols(rec.p),
      visits: rec.v
    };
  }

  /* ------------------------------------------------------------------ snapshot */

  function emptySnapshot(now) {
    return {
      version: VERSION,
      /* Default-on: the collector will start on the first observed host. This
       * mirrors collect() and never writes anything while merely read. */
      enabled: true,
      maxDomains: DEFAULT_MAX_DOMAINS,
      count: 0,
      todayNew: 0,
      lastSeen: null,
      records: [],
      exclude: [],
      storage: { bytes: 0, limitBytes: LIMIT_BYTES, status: 'empty', warnings: [] },
      revision: 'g0-c0',
      statsMode: 'coalesced',
      paused: false,
      initialized: false,
      collecting: false,
      awaitingFirstDomain: true,
      defaultEnabled: true,
      generation: null,
      todayKey: dayKeyOf(now),
      dayMode: 'local',
      history: [],
      notes: {
        visits: 'persisted coalesced observations (lower bound, 60s merge)',
        lastSeen: 'coalesced precision: at most 60s stale while traffic continues',
        firstSeen: 'first persisted observation'
      }
    };
  }

  function snapshotFrom(root, store, counters, nowMs) {
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var records = [];
    var bytes = 0;
    var warnings = [];
    var shardIssues = [];
    var lostRecords = 0;
    var i;
    var rootRaw = rawRead(store, KEY_ROOT, counters);
    if (rootRaw.ok && rootRaw.value) bytes += utf8Bytes(rootRaw.value);
    for (i = 0; i < root.shards; i++) {
      var key = shardKeyFor(root.gen, i);
      var rd = rawRead(store, key, counters);
      if (!rd.ok) { warnings.push('shard-read-error:' + i); shardIssues.push({ shard: i, issue: 'read-error' }); continue; }
      if (rd.value === null) {
        /* root claims records here but the shard is gone: say so, never skip */
        if (root.shardCounts[i] > 0) {
          warnings.push('shard-missing:' + i + ':' + root.shardCounts[i]);
          shardIssues.push({ shard: i, issue: 'missing', expected: root.shardCounts[i] });
          lostRecords += root.shardCounts[i];
        }
        continue;
      }
      bytes += utf8Bytes(rd.value);
      var sh = parseShard(rd.value);
      if (!sh.ok) {
        warnings.push('shard-corrupt:' + i + ':' + (sh.reason || '?'));
        shardIssues.push({ shard: i, issue: 'corrupt', reason: sh.reason || null });
        lostRecords += root.shardCounts[i];
        continue;
      }
      if (root.shardCounts[i] !== sh.records.length) {
        warnings.push('shard-count-mismatch:' + i + ':' + root.shardCounts[i] + '!=' + sh.records.length);
        shardIssues.push({ shard: i, issue: 'count-mismatch', expected: root.shardCounts[i], found: sh.records.length });
      }
      for (var j = 0; j < sh.records.length; j++) records.push(recordToPublic(sh.records[j]));
    }
    records.sort(function (a, b) { return a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0; });
    if (records.length !== root.count) {
      warnings.push('count-mismatch:root=' + root.count + ' actual=' + records.length);
    }
    for (i = 0; i < root.history.length; i++) bytes += root.history[i].bytes;
    var allWarnings = root.warnings.slice(0);
    for (i = 0; i < warnings.length; i++) pushWarnArr(allWarnings, warnings[i]);
    var status;
    if (root.paused) status = 'paused';
    else if (bytes >= LIMIT_BYTES) status = 'full';
    else if (bytes >= LIMIT_BYTES * 0.8) status = 'near-limit';
    else status = 'ok';
    if (root.recovered) status = root.paused ? 'paused' : status;
    return {
      version: VERSION,
      enabled: root.enabled === true,
      maxDomains: root.maxDomains,
      count: root.count,
      todayNew: root.dayKey === dayKeyOf(now) ? root.todayNew : 0,
      lastSeen: root.lastSeen,
      records: records,
      exclude: root.exclude.slice(0),
      storage: {
        bytes: bytes,
        limitBytes: LIMIT_BYTES,
        valueGuardBytes: VALUE_GUARD_BYTES,
        status: status,
        warnings: allWarnings,
        shardIssues: shardIssues,
        lostRecords: lostRecords,
        declaredCount: root.count,
        actualCount: records.length,
        shardCount: root.shards,
        shardMaxRecords: MAX_SHARD_RECORDS,
        shardMaxBytes: MAX_SHARD_BYTES
      },
      revision: revisionOf(root),
      statsMode: 'coalesced',
      paused: root.paused === true,
      collecting: root.paused !== true && root.enabled === true,
      initialized: true,
      generation: root.gen,
      todayKey: dayKeyOf(now),
      history: root.history.slice(0),
      purge: root.purge || null,
      coalesceMs: COALESCE_MS,
      notes: {
        visits: 'persisted coalesced observations (lower bound, 60s merge)',
        lastSeen: 'coalesced precision: at most 60s stale while traffic continues',
        firstSeen: 'first persisted observation'
      }
    };
  }

  function pushWarnArr(arr, w) {
    for (var i = 0; i < arr.length; i++) if (arr[i] === w) return arr;
    arr.push(w);
    return arr;
  }

  function failclosedSnapshot(now, reason) {
    var s = emptySnapshot(now);
    /* A blocked store is not a running collector. */
    s.enabled = false;
    s.paused = true;
    s.awaitingFirstDomain = false;
    s.blocked = true;
    s.storage.status = 'failclosed';
    s.storage.warnings = [reason || 'unknown-version'];
    s.revision = 'failclosed';
    s.notes = { failclosed: 'storage holds a newer or unknown schema version; nothing is written or destroyed' };
    return s;
  }

  /* ------------------------------------------------------------------- factory */

  function create(store, nowFn) {
    if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') {
      fail('bad-store', 'store must expose read(key) and write(string|null,key)');
    }
    var clock = typeof nowFn === 'function' ? nowFn : function () { return Date.now(); };

    function nowMs() {
      var t = clock();
      if (!isFiniteNum(t)) t = Date.now();
      return t;
    }

    /* counters are per-instance and per-call only; never used for logic */
    function readRoot(forWrite, fast) {
      var counters = { reads: 0, writes: 0, readErrors: 0, writeErrors: 0 };
      var rr = rawRead(store, KEY_ROOT, counters);
      if (!rr.ok) return { state: 'read-error', raw: null, root: null, counters: counters };
      if (rr.value === null) {
        return { state: 'empty', raw: rr.value, root: null, counters: counters };
      }
      if (utf8Bytes(rr.value) > MAX_ROOT_BYTES) {
        /* Oversize is kept verbatim and never parsed on the hot path. */
        return { state: 'corrupt', raw: rr.value, root: null, counters: counters, reason: 'oversize', oversize: true };
      }
      var p = safeParse(rr.value);
      if (!p.ok) return { state: 'corrupt', raw: rr.value, root: null, counters: counters, reason: p.reason };
      if (p.value.v !== VERSION) {
        return { state: 'unknown-version', raw: rr.value, root: null, counters: counters, version: p.value.v };
      }
      var schema = schemaError(p.value);
      if (schema) {
        return { state: 'schema', raw: rr.value, root: null, counters: counters, schema: schema };
      }
      return { state: 'ok', raw: rr.value, root: sanitizeRoot(p.value, fast === true), counters: counters };
    }

    /* Preserve the unparseable raw value once, in a bounded write-once slot,
     * then start a paused root. Old data and old shards are never overwritten. */
    /* Corruption recovery. The invariant is: the original root is NEVER
     * overwritten unless a complete raw copy is already durably stored.
     *  - copy written (new slot or an identical existing slot) -> new paused root
     *  - slots full / write failed / raw larger than the bound -> leave the
     *    original bytes in place and report the failure; only an explicit user
     *    clear may replace them.
     */
    function recoverCorrupt(raw) {
      var i, identicalSlot = -1, freeSlot = -1;
      for (i = 0; i < RECOVERY_SLOTS; i++) {
        var r = rawRead(store, KEY_RECOVERY + i, null);
        if (!r.ok) { freeSlot = -1; return { preserved: false, wrote: false, blocked: 'store-read-error' }; }
        if (r.value === null) { if (freeSlot < 0) freeSlot = i; continue; }
        if (r.value === raw) { identicalSlot = i; break; }
      }

      var preserved = false, blocked = null;
      if (identicalSlot >= 0) preserved = true;
      else if (utf8Bytes(raw) > RECOVERY_MAX_BYTES) blocked = 'recovery-oversize';
      else if (freeSlot < 0) blocked = 'recovery-slots-full';
      else {
        preserved = rawWrite(store, raw, KEY_RECOVERY + freeSlot, null);
        if (preserved) {
          var chk = rawRead(store, KEY_RECOVERY + freeSlot, null);
          preserved = chk.ok && chk.value === raw;
        }
        if (!preserved) blocked = 'recovery-preserve-failed';
      }

      if (!preserved) return { preserved: false, wrote: false, blocked: blocked };

      var now = nowMs();
      var base = newRoot(now, { enabled: false, paused: true, recovered: true });
      base.gen = 'g' + now.toString(36) + '-r';
      pushWarning(base, 'corrupt-root-preserved');
      pushWarning(base, 'recovery-paused-review-required');
      for (i = 0; i < SHARD_COUNT; i++) { base.shardBytes[i] = 0; base.shardCounts[i] = 0; }
      var okw = rawWrite(store, JSON.stringify(base), KEY_ROOT, null);
      if (!okw) pushWarning(base, 'recovery-root-write-failed');
      return { root: base, preserved: true, wrote: okw, blocked: okw ? null : 'root-write-failed' };
    }

    /* --------------------------------------------------------------- collect */

    function collect(input) {
      var out = {
        version: VERSION, ok: false, accepted: false, wrote: false,
        reason: '', domain: null, count: 0, maxDomains: DEFAULT_MAX_DOMAINS,
        visits: 0, coalesced: false, warnings: [], statsMode: 'coalesced'
      };
      try {
        return collectInner(input, out);
      } catch (e) {
        out.ok = false;
        out.accepted = false;
        out.wrote = false;
        out.reason = 'internal-error';
        out.error = String(e && e.message ? e.message : e);
        return out;
      }
    }

    function collectInner(input, out) {
      if (!input || typeof input !== 'object') { out.reason = 'bad-input'; return out; }

      var norm = normalizeHost(input.hostname);
      if (!norm.ok) {
        out.reason = norm.reason === 'ip' ? 'ip-host' : 'invalid-host';
        out.detail = norm.reason;
        return out;
      }
      var domain = norm.domain;
      out.domain = domain;
      if (isReservedHost(domain)) {
        out.reason = 'reserved-host';
        out.domain = null;
        return out;
      }
      var proto = normalizeProtocol(input.protocol);

      var rd = readRoot(true, true);   /* hot: no exclude re-normalisation. rd.raw is the CAS token */
      var now = nowMs();
      var root;

      if (rd.state === 'read-error') { out.reason = 'store-read-error'; return out; }
      if (rd.state === 'unknown-version') {
        out.reason = 'failclosed-unknown-version';
        out.failclosed = true;
        return out;
      }
      if (rd.state === 'schema') {
        /* structurally broken root: never assume counts are zero, never rewrite */
        out.reason = 'failclosed-root-schema';
        out.failclosed = true;
        out.detail = rd.schema;
        return out;
      }
      if (rd.state === 'corrupt') {
        if (rd.oversize) {
          /* never parse, never back up, never overwrite: report and stop */
          out.reason = 'corrupt-root-not-recovered';
          out.recovered = false;
          out.blocked = 'root-oversize';
          out.detail = 'root ' + rd.raw.length + ' chars > ' + MAX_ROOT_BYTES;
          return out;
        }
        var rec = recoverCorrupt(rd.raw);
        if (!rec.preserved) {
          /* cannot safe-guard the old bytes: do not initialise, do not write */
          out.reason = 'corrupt-root-not-recovered';
          out.recovered = false;
          out.blocked = rec.blocked || 'recovery-unavailable';
          out.count = 0;
          return out;
        }
        out.reason = rec.wrote ? 'corrupt-root-recovered-paused' : 'corrupt-root-recovered-root-write-failed';
        out.recovered = true;
        out.count = 0;
        return out;
      }
      if (rd.state === 'empty') {
        /* Auto-collection starts on first observed event; manager read never enables. */
        root = newRoot(now, { enabled: true });
        out.initialized = true;
      } else {
        root = rd.root;
      }

      if (root.paused) { out.reason = 'paused'; out.count = root.count; out.maxDomains = root.maxDomains; return out; }
      if (root.enabled !== true) { out.reason = 'disabled'; out.count = root.count; out.maxDomains = root.maxDomains; return out; }
      out.count = root.count;
      out.maxDomains = root.maxDomains;

      if (isExcluded(root.exclude, domain)) { out.reason = 'excluded'; return out; }

      var idx = shardIndexFor(domain, root.shards);
      var key = shardKeyFor(root.gen, idx);
      var sr = rawRead(store, key, null);
      if (!sr.ok) { out.reason = 'store-read-error'; return out; }
      var prevShardRaw = sr.value;

      /* The root claims this shard holds records but the value is gone: that is
       * data loss, so stop instead of silently re-creating an empty shard. */
      if (prevShardRaw === null && root.shardCounts[idx] > 0) {
        out.reason = 'failclosed-shard-missing';
        out.failclosed = true;
        out.detail = 'shard ' + idx + ' missing, root expected ' + root.shardCounts[idx];
        return out;
      }

      var sh = parseShard(sr.value);
      if (!sh.ok) {
        if (sh.reason === 'version') {
          out.reason = 'failclosed-shard-version';
          out.failclosed = true;
          out.detail = 'shard ' + idx + ' version ' + String(sh.version);
        } else {
          out.reason = 'shard-corrupt';
          out.detail = sh.reason;
        }
        return out;
      }

      var records = sh.records;
      var pos = -1, i;
      for (i = 0; i < records.length; i++) { if (records[i].d === domain) { pos = i; break; } }

      var changed = false;
      var record;
      if (pos < 0) {
        if (root.count >= root.maxDomains) {
          out.reason = 'capacity-full';
          persistRootWarning(root, now, 'capacity-full:' + root.maxDomains, rd.raw);
          return out;
        }
        if (records.length >= MAX_SHARD_RECORDS) {
          out.reason = 'shard-full';
          out.shard = idx;
          persistRootWarning(root, now, 'shard-full:' + idx + ':records', rd.raw);
          return out;
        }
        record = { d: domain, f: now, l: now, p: proto.code, v: 1 };
        records.push(record);
        /* No sort here: shard order is arrival order, snapshot() sorts. */
        root.count += 1;
        if (root.dayKey !== dayKeyOf(now)) { root.dayKey = dayKeyOf(now); root.todayNew = 0; }
        root.todayNew += 1;
        changed = true;
        out.accepted = true;
        out.isNew = true;
        out.visits = 1;
      } else {
        record = records[pos];
        var protoMerge = addCode(record.p, proto.code);
        var dueTime = (now - record.l) >= COALESCE_MS;
        if (now < record.l) dueTime = false; /* clock went backwards: stay put */
        if (!protoMerge.added && !dueTime) {
          out.ok = true;
          out.coalesced = true;
          out.reason = 'coalesced';
          out.visits = record.v;
          out.count = root.count;
          return out;
        }
        if (dueTime) { record.v = Math.min(1e9, record.v + 1); record.l = now; changed = true; }
        if (protoMerge.added) { record.p = protoMerge.value; changed = true; out.newProtocol = proto.label; }
        out.accepted = true;
        out.visits = record.v;
      }

      if (!changed) { out.ok = true; out.reason = 'coalesced'; return out; }

      var shardJson = serializeShard(records);
      var shardBytes = utf8Bytes(shardJson);
      if (shardBytes > MAX_SHARD_BYTES) {
        out.ok = false;
        out.accepted = false;
        out.reason = 'shard-full';
        out.detail = 'shard-bytes';
        out.shard = idx;
        /* Same visibility as the record cap: latched once per state. */
        persistRootWarning(root, now, 'shard-full:' + idx + ':bytes', rd.raw);
        return out;
      }

      /* Two best-effort guards. $persistentStore has no atomic CAS, so this can
       * only narrow the race window, never close it:
       *   A. before writing the shard, the root must be byte-identical to rd.raw
       *   B. after writing the shard, the root must still be byte-identical;
       *      otherwise the shard is undone (but only if it is still ours). */
      var gA = guardRoot(rd, root, pos);
      if (gA.stale) {
        out.ok = false; out.accepted = false; out.wrote = false;
        out.reason = gA.reason; out.detail = gA.stale;
        return out;
      }
      var gShard = rawRead(store, key, null);
      if (!gShard.ok || gShard.value !== prevShardRaw) {
        out.ok = false; out.accepted = false; out.wrote = false;
        out.reason = 'race-detected';
        out.detail = gShard.ok ? 'shard-bytes-changed' : 'store-read-error';
        return out;
      }

      var shardWritten = rawWrite(store, shardJson, key, null);
      if (!shardWritten) {
        out.ok = false; out.accepted = false; out.wrote = false;
        out.reason = 'write-failed'; out.detail = 'shard-write';
        return out;
      }

      var gB = guardRoot(rd, root, pos);
      if (gB.stale) {
        undoShard(key, shardJson, prevShardRaw);
        out.ok = false; out.accepted = false; out.wrote = false;
        out.reason = gB.reason; out.detail = gB.stale;
        return out;
      }

      root.seq += 1;
      root.lastSeen = now;
      root.updatedAt = now;
      root.shardBytes[idx] = shardBytes;
      root.shardCounts[idx] = records.length;
      if (root.dayKey !== dayKeyOf(now)) { root.dayKey = dayKeyOf(now); root.todayNew = 0; }
      var rootJson = JSON.stringify(root);
      var rootBytes = utf8Bytes(rootJson);
      if (rootBytes > MAX_ROOT_BYTES || rootBytes > VALUE_GUARD_BYTES) {
        undoShard(key, shardJson, prevShardRaw);
        out.ok = false; out.accepted = false;
        out.reason = 'root-too-large';
        return out;
      }
      if (!rawWrite(store, rootJson, KEY_ROOT, null)) {
        undoShard(key, shardJson, prevShardRaw);
        out.ok = false; out.accepted = false; out.wrote = false;
        out.reason = 'write-failed'; out.detail = 'root-write';
        return out;
      }
      out.ok = true;
      out.wrote = true;
      out.count = root.count;
      out.maxDomains = root.maxDomains;
      out.reason = pos < 0 ? 'created' : 'updated';
      return out;
    }

    function guardRoot(rd, root, pos) {
      var re = rawRead(store, KEY_ROOT, null);
      if (!re.ok) return { stale: 'store-read-error', reason: 'store-read-error' };
      if (rd.state === 'empty') {
        if (re.value !== null) return { stale: 'root-created-concurrently', reason: 'race-detected' };
        return { stale: null };
      }
      if (re.value !== rd.raw) return { stale: 'root-bytes-changed', reason: 'race-detected' };
      var p = safeParse(re.value);
      if (!p.ok || p.value.v !== VERSION) return { stale: 'root-changed', reason: 'race-detected' };
      var cur = sanitizeRoot(p.value);
      if (cur.gen !== root.gen) return { stale: 'generation-changed', reason: 'generation-changed' };
      if (cur.paused || cur.enabled !== true) return { stale: cur.paused ? 'paused-meanwhile' : 'disabled-meanwhile', reason: 'race-detected' };
      if (cur.count >= cur.maxDomains && pos < 0) return { stale: 'capacity-full-meanwhile', reason: 'capacity-full' };
      return { stale: null };
    }

    /* Only undo the shard when it still holds exactly what this call wrote.
     * Restoring blindly could clobber a concurrent writer's newer value. */
    function undoShard(key, mineJson, prevRaw) {
      var now2 = rawRead(store, key, null);
      if (!now2.ok || now2.value !== mineJson) return false;
      if (prevRaw === null) return rawWrite(store, null, key, null);
      return rawWrite(store, prevRaw, key, null);
    }

    function isExcluded(list, domain) {
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (domain === e) return true;
        if (domain.length > e.length + 1 && domain.slice(domain.length - e.length - 1) === '.' + e) return true;
      }
      return false;
    }

    /* Warning is latched once. A rejected request must not become a writer, so
     * an already-recorded warning costs zero writes on the hot path. */
    /* A rejected request may record one warning, once per state. The write is
     * only attempted when the root still holds exactly the bytes we read, so a
     * concurrent writer never loses its update to this bookkeeping. */
    function persistRootWarning(root, now, warning, expectedRaw) {
      var already = false, i;
      for (i = 0; i < root.warnings.length; i++) if (root.warnings[i] === warning) { already = true; break; }
      if (already) return false;
      var re = rawRead(store, KEY_ROOT, null);
      if (!re.ok || re.value !== expectedRaw) return false;
      pushWarning(root, warning);
      root.updatedAt = now;
      return rawWrite(store, JSON.stringify(root), KEY_ROOT, null);
    }

    /* -------------------------------------------------------------- snapshot */

    function snapshot() {
      var rd = readRoot(false);
      var now = nowMs();
      if (rd.state === 'read-error') {
        var e = emptySnapshot(now);
        e.enabled = false;
        e.paused = true;
        e.awaitingFirstDomain = false;
        e.blocked = true;
        e.storage.status = 'read-error';
        e.storage.warnings = ['store-read-error'];
        return e;
      }
      if (rd.state === 'unknown-version') return failclosedSnapshot(now, 'unknown-version:' + String(rd.version));
      if (rd.state === 'schema') return failclosedSnapshot(now, 'root-schema:' + String(rd.schema));
      if (rd.state === 'corrupt') {
        var c = emptySnapshot(now);
        c.storage.status = 'corrupt';
        c.enabled = false;
        c.paused = true;
        c.blocked = true;
        c.awaitingFirstDomain = false;
        c.storage.warnings = [rd.oversize ? 'root-oversize-unparsed' : 'root-unparseable', 'not-recovered-yet'];
        c.revision = 'corrupt';
        return c;
      }
      if (rd.state === 'empty') return emptySnapshot(now);
      return snapshotFrom(rd.root, store, null, now);
    }

    /* --------------------------------------------------------- quick summary */

    function summary() {
      var rd = readRoot(false, true);
      var now = nowMs();
      var out, bytes, i, root;
      if (rd.state === 'empty') out = emptySnapshot(now);
      else if (rd.state === 'read-error') {
        out = emptySnapshot(now);
        out.enabled = false; out.paused = true; out.awaitingFirstDomain = false;
        out.blocked = true; out.storage.status = 'read-error';
        out.storage.warnings = ['store-read-error'];
      } else if (rd.state === 'unknown-version') out = failclosedSnapshot(now, 'unknown-version:' + String(rd.version));
      else if (rd.state === 'schema') out = failclosedSnapshot(now, 'root-schema:' + String(rd.schema));
      else if (rd.state === 'corrupt') {
        out = emptySnapshot(now);
        out.enabled = false; out.paused = true; out.awaitingFirstDomain = false;
        out.blocked = true; out.storage.status = 'corrupt';
        out.storage.warnings = [rd.oversize ? 'root-oversize-unparsed' : 'root-unparseable'];
        out.revision = 'corrupt';
      } else {
        root = rd.root;
        bytes = utf8Bytes(rd.raw);
        /* Root metadata contains the last committed byte size per shard;
         * never read or parse shards just to paint the dashboard. */
        for (i = 0; i < root.shardBytes.length; i++) bytes += root.shardBytes[i];
        for (i = 0; i < root.history.length; i++) bytes += root.history[i].bytes;
        out = {
          version: VERSION, enabled: root.enabled === true, maxDomains: root.maxDomains,
          count: root.count, todayNew: root.dayKey === dayKeyOf(now) ? root.todayNew : 0,
          lastSeen: root.lastSeen, storage: {bytes: bytes, limitBytes: LIMIT_BYTES,
            valueGuardBytes: VALUE_GUARD_BYTES,
            status: root.paused ? 'paused' : (bytes >= LIMIT_BYTES ? 'full' : (bytes >= LIMIT_BYTES * 0.8 ? 'near-limit' : 'ok')),
            warnings: root.warnings.slice(0), bytesFromRootMetadata: true},
          revision: revisionOf(root), paused: root.paused === true,
          collecting: root.paused !== true && root.enabled === true,
          initialized: true, awaitingFirstDomain: false, defaultEnabled: true,
          generation: root.gen, todayKey: dayKeyOf(now), statsMode: 'coalesced',
          dayMode: 'local', coalesceMs: COALESCE_MS
        };
      }
      delete out.records;
      delete out.exclude;
      delete out.history;
      delete out.notes;
      out.quick = true;
      return out;
    }

    /* --------------------------------------------------------------- mutate */

    function loadForMutation(allowVirgin) {
      var rd = readRoot(true);
      if (rd.state === 'read-error') fail('store-read-error', 'cannot read DomainCollectorData');
      if (rd.state === 'unknown-version') fail('failclosed-unknown-version', 'storage version ' + String(rd.version) + ' is newer; refuse to modify');
      if (rd.state === 'corrupt') fail('corrupt-root', 'root is unparseable; only an explicit clear may replace it');
      if (rd.state === 'schema') fail('failclosed-root-schema', 'root is structurally invalid (' + rd.schema + '); refusing to modify');
      if (rd.state === 'empty') {
        if (!allowVirgin) fail('not-initialized', 'no data yet; collection has not started');
        /* Virgin namespace: settings may pre-configure it. No domains are
         * invented — count stays 0 and no shard is touched. */
        var virginRoot = newRoot(nowMs(), { enabled: true });
        virginRoot.virgin = true;
        return virginRoot;
      }
      return rd.root;
    }

    /* Only restore a shard when it still holds exactly what this batch wrote,
     * so a concurrent writer's newer value is never overwritten. */
    function rollbackShards(list) {
      for (var i = list.length - 1; i >= 0; i--) {
        var cur = rawRead(store, list[i].key, null);
        if (!cur.ok) continue;
        if (list[i].mine !== undefined && cur.value !== list[i].mine) continue;
        if (list[i].raw === null) rawWrite(store, null, list[i].key, null);
        else rawWrite(store, list[i].raw, list[i].key, null);
      }
    }

    /* Re-read and confirm nothing moved before a destructive mutation. */
    function assertNotMovedAndLoad(rd) {
      var re = rawRead(store, KEY_ROOT, null);
      if (!re.ok) fail('store-read-error', 'cannot re-read root before commit');
      if (re.value !== rd.raw) fail('revision-conflict', 'root changed concurrently; retry');
      return sanitizeRoot(safeParse(re.value).value);
    }

    /* No atomic CAS: re-read the small root right before committing a mutation. */
    function assertNotMoved(root) {
      var re = rawRead(store, KEY_ROOT, null);
      if (!re.ok) fail('store-read-error', 'cannot re-read root before commit');
      var p = safeParse(re.value || '');
      if (!p.ok || p.value.v !== VERSION) fail('revision-conflict', 'root changed concurrently; retry');
      var cur = sanitizeRoot(p.value);
      if (cur.gen !== root.gen || cur.cfgRev !== root.cfgRev) {
        fail('revision-conflict', 'root changed concurrently (' + revisionOf(cur) + '), retry');
      }
    }

    function requireRevision(root, payload) {
      if (!payload || typeof payload !== 'object') fail('payload-required', 'payload object required');
      if (typeof payload.revision !== 'string' || payload.revision === '') fail('revision-required', 'payload.revision is required');
      if (payload.revision !== revisionOf(root)) {
        fail('revision-conflict', 'stale revision ' + payload.revision + ' != ' + revisionOf(root));
      }
    }

    function mutate(action, payload) {
      var now = nowMs();
      if (action !== 'settings' && action !== 'delete' && action !== 'clear') {
        fail('unknown-action', 'action must be settings|delete|clear');
      }
      if (!payload || typeof payload !== 'object' || isArray(payload)) {
        fail('payload-required', 'payload object with revision is required');
      }
      var p = payload;
      /* clear has its own loader: it is the one action allowed to replace an
       * unusable root, so it must not go through the strict loader. */
      var root = null;
      if (action === 'settings') {
        root = loadForMutation(true);
        if (root.virgin) {
          /* first-use configuration: the only valid token is the empty revision */
          if (typeof p.revision !== 'string' || p.revision === '') fail('revision-required', 'payload.revision is required');
          if (p.revision !== 'g0-c0') fail('revision-conflict', 'not initialized yet; expected revision g0-c0, got ' + p.revision);
        } else {
          requireRevision(root, p);
        }
      } else if (action !== 'clear') {
        root = loadForMutation(false);
        requireRevision(root, p);
      }

      if (action === 'settings') {
        if (has(p, 'enabled')) {
          if (typeof p.enabled !== 'boolean') fail('invalid-enabled', 'enabled must be boolean');
          root.enabled = p.enabled;
          /* Explicitly arming collection by an authorised user also lifts a
           * recoverable pause; paused:false does the same on its own. */
          if (p.enabled === true && root.paused === true && !has(p, 'paused')) root.paused = false;
        }
        if (has(p, 'maxDomains')) {
          var rawMd = Number(p.maxDomains);
          if (!isFinite(rawMd) || Math.floor(rawMd) !== rawMd) {
            fail('invalid-maxDomains', 'maxDomains must be an integer');
          }
          if (rawMd < 1 || rawMd > HARD_MAX_DOMAINS) {
            fail('invalid-maxDomains', 'maxDomains must be 1..' + HARD_MAX_DOMAINS);
          }
          var md = rawMd;
          if (md < root.count) fail('maxDomains-below-count', 'maxDomains ' + md + ' < count ' + root.count);
          root.maxDomains = md;
        }
        if (has(p, 'exclude')) {
          if (!isArray(p.exclude)) fail('invalid-exclude', 'exclude must be an array');
          if (p.exclude.length > MAX_EXCLUDE) fail('invalid-exclude', 'exclude longer than ' + MAX_EXCLUDE);
          var ex = normalizeExcludeList(p.exclude);
          if (ex.invalid.length) fail('invalid-exclude', 'invalid exclude entries: ' + ex.invalid.slice(0, 3).join(','));
          root.exclude = ex.list;
        }
        if (has(p, 'paused')) {
          if (typeof p.paused !== 'boolean') fail('invalid-paused', 'paused must be boolean');
          root.paused = p.paused;
        }
        if (root.virgin) {
          var re0 = rawRead(store, KEY_ROOT, null);
          if (!re0.ok) fail('store-read-error', 'cannot confirm the namespace is still empty');
          if (re0.value !== null) fail('revision-conflict', 'namespace was initialised concurrently; reload');
          delete root.virgin;
          root.cfgRev = 1;
          root.updatedAt = now;
          if (!rawWrite(store, JSON.stringify(root), KEY_ROOT, null)) fail('write-failed', 'settings write failed; nothing kept');
          return snapshot();
        }
        assertNotMoved(root);
        root.cfgRev += 1;
        root.updatedAt = now;
        if (!rawWrite(store, JSON.stringify(root), KEY_ROOT, null)) fail('write-failed', 'settings write failed; old root kept');
        return snapshot();
      }

      if (action === 'delete') {
        if (!isArray(p.domains) || p.domains.length === 0) fail('invalid-domains', 'domains array required');
        if (p.domains.length > HARD_MAX_DOMAINS) fail('invalid-domains', 'too many domains');
        var del = [], seen = Object.create(null), k;
        for (k = 0; k < p.domains.length; k++) {
          var n = normalizeHost(p.domains[k]);
          if (!n.ok) fail('invalid-domains', 'invalid domain: ' + String(p.domains[k]));
          if (seen[n.domain] === 1) continue;
          seen[n.domain] = 1;
          del.push(n.domain);
        }

        /* Phase 1 — read and validate every target shard, write nothing yet.
         * A corrupt shard anywhere aborts the whole bulk delete. */
        var plan = [], touched = Object.create(null);
        for (k = 0; k < del.length; k++) touched[shardIndexFor(del[k], root.shards)] = 1;
        for (var tk in touched) {
          if (!has(touched, tk)) continue;
          var tidx = Number(tk);
          var tkey = shardKeyFor(root.gen, tidx);
          var tRead = rawRead(store, tkey, null);
          if (!tRead.ok) fail('store-read-error', 'cannot read shard ' + tidx);
          var tSh = parseShard(tRead.value);
          if (!tSh.ok) fail('shard-corrupt', 'shard ' + tidx + ' unparseable (' + (tSh.reason || '?') + '); nothing deleted');
          plan.push({ idx: tidx, key: tkey, raw: tRead.value, records: tSh.records });
        }
        plan.sort(function (a, b) { return a.idx - b.idx; });

        /* Phase 2 — compute all new payloads first (still no writes). */
        var writes = [], removedTotal = 0, j;
        for (k = 0; k < plan.length; k++) {
          var keep = [], removed = 0;
          for (j = 0; j < plan[k].records.length; j++) {
            if (seen[plan[k].records[j].d] === 1) removed += 1;
            else keep.push(plan[k].records[j]);
          }
          if (!removed) continue;
          writes.push({ idx: plan[k].idx, key: plan[k].key, before: plan[k].raw,
                        json: serializeShard(keep), count: keep.length, removed: removed });
          removedTotal += removed;
        }

        var originals = [];
        if (removedTotal) {
          /* Phase 3 — apply. Any failure restores everything applied so far. */
          assertNotMoved(root);
          for (k = 0; k < writes.length; k++) {
            var cur0 = rawRead(store, writes[k].key, null);
            if (!cur0.ok || cur0.value !== writes[k].before) {
              rollbackShards(originals);
              fail('revision-conflict', 'shard ' + writes[k].idx + ' changed during delete; nothing deleted');
            }
            if (!rawWrite(store, writes[k].json, writes[k].key, null)) {
              rollbackShards(originals);
              fail('write-failed', 'shard ' + writes[k].idx + ' write failed; earlier shards rolled back');
            }
            originals.push({ key: writes[k].key, raw: writes[k].before, idx: writes[k].idx, mine: writes[k].json });
            root.shardBytes[writes[k].idx] = writes[k].json.length;
            root.shardCounts[writes[k].idx] = writes[k].count;
          }
          root.count = Math.max(0, root.count - removedTotal);
        }

        root.cfgRev += 1;
        root.updatedAt = now;
        if (!rawWrite(store, JSON.stringify(root), KEY_ROOT, null)) {
          rollbackShards(originals);
          fail('write-failed', 'root write failed; shard deletions rolled back');
        }
        return snapshot();
      }

      /* clear — explicit user action only; this is the one path allowed to
       * replace an unusable root, and it physically removes the domain shards
       * it knows about instead of leaving browsing history behind. */
      if (p.confirm !== 'CLEAR') fail('confirm-required', "clear requires confirm:'CLEAR'");

      var prevGens = [];
      var purgeHistory = p.purgeHistory !== false;

      function rememberGen(g) {
        if (!purgeHistory) return;
        if (!g || typeof g !== 'string') return;
        if (prevGens.indexOf(g) >= 0) return;
        prevGens.push(g);
      }

      var clearRoot;
      var rdClear = readRoot(true);
      if (rdClear.state === 'corrupt') {
        /* preserve the raw bytes first when that is possible; if it is not,
         * the user's explicit clear is still honoured (they asked for it). */
        var rc = recoverCorrupt(rdClear.raw);
        clearRoot = rc.root || newRoot(now, { enabled: false, paused: false });
        if (rc.preserved) pushWarning(clearRoot, 'corrupt-root-preserved-before-clear');
        else pushWarning(clearRoot, 'corrupt-root-clear-without-backup:' + String(rc.blocked || 'unknown'));
      } else if (rdClear.state === 'ok') {
        clearRoot = assertNotMovedAndLoad(rdClear);
        requireRevision(clearRoot, p);
        if (purgeHistory) for (var hi = 0; hi < clearRoot.history.length; hi++) rememberGen(clearRoot.history[hi].gen);
      } else if (rdClear.state === 'empty') {
        fail('not-initialized', 'nothing to clear');
      } else if (rdClear.state === 'unknown-version') {
        fail('failclosed-unknown-version', 'storage version is newer; clear would destroy it');
      } else {
        fail('failclosed-root-schema', 'root is structurally invalid; only a full reset is possible');
      }

      var oldGen = clearRoot.gen, oldCount = clearRoot.count;
      rememberGen(oldGen);
      var oldBytes = 0, i;
      for (i = 0; i < clearRoot.shardBytes.length; i++) oldBytes += clearRoot.shardBytes[i];
      clearRoot.history.push({ gen: oldGen, records: oldCount, bytes: oldBytes, at: now, reason: 'clear' });
      while (clearRoot.history.length > MAX_HISTORY) clearRoot.history.shift();

      var newGen = 'g' + now.toString(36) + '-' + (clearRoot.cfgRev + 1);
      clearRoot.gen = newGen;
      clearRoot.cfgRev += 1;
      clearRoot.count = 0;
      clearRoot.todayNew = 0;
      clearRoot.dayKey = dayKeyOf(now);
      clearRoot.lastSeen = null;
      clearRoot.updatedAt = now;
      clearRoot.recovered = false;
      for (i = 0; i < SHARD_COUNT; i++) { clearRoot.shardBytes[i] = 0; clearRoot.shardCounts[i] = 0; }

      /* phase 1: switch generation. If this fails nothing was deleted. */
      if (!rawWrite(store, JSON.stringify(clearRoot), KEY_ROOT, null)) {
        fail('write-failed', 'clear aborted; old data kept');
      }

      /* phase 2: delete only keys that provably belong to our own namespace
       * shape `DomainCollectorData.s.<knownGen>.<0..47>`. The token, recovery
       * slots and anything outside this namespace are never touched. */
      var purged = 0, purgeFailed = 0, purgeSkipped = 0;
      for (var gi = 0; gi < prevGens.length; gi++) {
        var gen = prevGens[gi];
        if (gen === newGen) { purgeSkipped++; continue; }
        for (i = 0; i < SHARD_COUNT; i++) {
          var pkey = KEY_SHARD + gen + '.' + i;
          var cur = rawRead(store, pkey, null);
          if (!cur.ok) { purgeFailed++; continue; }
          if (cur.value === null) continue;
          if (rawWrite(store, null, pkey, null)) purged++;
          else purgeFailed++;
        }
      }

      if (purged > 0 || purgeFailed > 0 || purgeSkipped > 0) {
        var report = { gens: prevGens.slice(0), deleted: purged, failed: purgeFailed, skipped: purgeSkipped, at: now };
        var reportWarn = purgeFailed > 0 ? 'clear-purge-partial:' + purgeFailed + 'keys' : 'clear-purged:' + purged + 'keys';
        var switchedRaw = JSON.stringify(clearRoot);

        /* Collection may have resumed on the new generation while we deleted.
         * Re-read and merge onto the freshest root instead of overwriting it;
         * if that is not safe, skip the report and say so. */
        var lateRd = rawRead(store, KEY_ROOT, null);
        var lateOk = false;
        if (lateRd.ok && lateRd.value !== null) {
          var lateP = safeParse(lateRd.value);
          if (lateP.ok && lateP.value.v === VERSION && !schemaError(lateP.value)) {
            var lateRoot = sanitizeRoot(lateP.value);
            if (lateRoot.gen === newGen) {
              lateRoot.purge = report;
              pushWarning(lateRoot, reportWarn);
              lateOk = rawWrite(store, JSON.stringify(lateRoot), KEY_ROOT, null);
              if (lateOk) clearRoot = lateRoot;
            }
          }
        }
        if (!lateOk && lateRd.ok && lateRd.value === switchedRaw) {
          /* nobody moved it: the plain report is still consistent */
          clearRoot.purge = report;
          pushWarning(clearRoot, reportWarn);
          lateOk = rawWrite(store, JSON.stringify(clearRoot), KEY_ROOT, null);
        }
        if (!lateOk) {
          var fr = rawRead(store, KEY_ROOT, null);
          if (fr.ok && fr.value !== null) {
            var fp = safeParse(fr.value);
            if (fp.ok && fp.value.v === VERSION && !schemaError(fp.value)) {
              var frRoot = sanitizeRoot(fp.value);
              if (frRoot.gen === newGen) {
                pushWarning(frRoot, 'clear-purge-report-unsaved');
                pushWarning(frRoot, reportWarn);
                rawWrite(store, JSON.stringify(frRoot), KEY_ROOT, null);
              }
            }
          }
        }
      }

      return snapshot();
    }

    /* ----------------------------------------------------------------- token */

    /* Manager-only. The collector entry never calls this, so request traffic can
     * never mint a CSRF token.
     * token()        -> always returns a non-empty string, creating it on first
     *                   manager call; throws on storage failure (never returns ''
     *                   or null, so auth can never silently degrade to no-CSRF).
     * token(false)   -> read-only probe, null when absent. */
    function token(createIfMissing) {
      var wantCreate = createIfMissing !== false; /* default: create */
      var r = rawRead(store, KEY_TOKEN, null);
      if (!r.ok) fail('store-read-error', 'cannot read token slot');
      if (typeof r.value === 'string' && r.value.length >= 16) return r.value;
      if (!wantCreate) return null;
      var t = 'dc' + nowMs().toString(36) + '-' +
        Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12) +
        Math.random().toString(36).slice(2, 12);
      if (t.length < 16) fail('token-generation-failed', 'generated token too short');
      if (!rawWrite(store, t, KEY_TOKEN, null)) fail('write-failed', 'token write failed; refusing to run without CSRF');
      /* read back so a silently dropped write is detected instead of trusted */
      var chk = rawRead(store, KEY_TOKEN, null);
      if (!chk.ok || chk.value !== t) fail('write-failed', 'token write not persisted');
      return t;
    }

    /* -------------------------------------------------------------- diagnostics */

    function inspect() {
      var rd = readRoot(false);
      return {
        state: rd.state,
        version: rd.state === 'ok' ? VERSION : (rd.version || null),
        generation: rd.root ? rd.root.gen : null,
        revision: rd.root ? revisionOf(rd.root) : null,
        paused: rd.root ? rd.root.paused : null,
        counters: rd.counters
      };
    }

    return {
      collect: collect,
      snapshot: snapshot,
      summary: summary,
      mutate: mutate,
      token: token,
      inspect: inspect
    };
  }

  return {
    version: VERSION,
    create: create,
    normalizeHost: normalizeHost,
    normalizeProtocol: normalizeProtocol,
    normalizeExcludeList: normalizeExcludeList,
    codesToProtocols: codesToProtocols,
    shardIndexFor: shardIndexFor,
    shardKeyFor: shardKeyFor,
    hash32: hash32,
    revisionOf: revisionOf,
    KEYS: {
      root: KEY_ROOT, prefix: KEY_PREFIX, token: KEY_TOKEN,
      recovery: KEY_RECOVERY, shard: KEY_SHARD
    },
    LIMITS: {
      version: VERSION, shardCount: SHARD_COUNT, maxShardRecords: MAX_SHARD_RECORDS,
      maxShardBytes: MAX_SHARD_BYTES, limitBytes: LIMIT_BYTES, valueGuardBytes: VALUE_GUARD_BYTES,
      recoverySlots: RECOVERY_SLOTS, recoveryMaxBytes: RECOVERY_MAX_BYTES,
      defaultMaxDomains: DEFAULT_MAX_DOMAINS, hardMaxDomains: HARD_MAX_DOMAINS,
      coalesceMs: COALESCE_MS, maxExclude: MAX_EXCLUDE
    }
  };
});

var DOMAIN_COLLECTOR_HTML = "<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n<title>Surge\u57df\u540d\u89c4\u5219\u91c7\u96c6\u5668</title>\n<style>\n:root{color-scheme:dark;--bg:#070a10;--surface:#111826;--surface-2:#0c121d;--line:rgba(148,170,204,.16);--line-soft:rgba(148,170,204,.09);--text:#eef3fb;--muted:#93a3b8;--accent:#7fa8ff;--accent-2:#63e0c0;--good:#5fdca4;--warn:#ffc866;--bad:#ff7688;--radius:16px;--mono:ui-monospace,SFMono-Regular,\"SF Mono\",Menlo,monospace}\n*{box-sizing:border-box}\nhtml{-webkit-text-size-adjust:100%}\n[hidden]{display:none!important}\nbody{margin:0;min-height:100vh;background:radial-gradient(120% 70% at 50% -12%,rgba(90,132,220,.20),transparent 62%),radial-gradient(90% 60% at 100% 0%,rgba(80,220,190,.09),transparent 60%),var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"PingFang SC\",sans-serif;padding:0;overflow-x:hidden}\nbutton,input,select,textarea{font:inherit;color:inherit}\nbutton{appearance:none;min-height:44px;padding:10px 14px;border:1px solid var(--line);border-radius:11px;background:linear-gradient(180deg,rgba(40,52,74,.95),rgba(24,32,48,.95));font-weight:600;cursor:pointer;transition:transform .12s ease,border-color .15s ease,background .15s ease;white-space:nowrap}\nbutton:active{transform:scale(.985)}\nbutton:disabled{opacity:.42;cursor:default;transform:none}\nbutton.primary{background:linear-gradient(180deg,#9dbdff,#7fa8ff);border-color:#9dbdff;color:#0a1020;font-weight:700;box-shadow:0 8px 24px -14px rgba(127,168,255,.95)}\nbutton.danger{border-color:rgba(255,118,136,.42);color:#ff9fae;background:linear-gradient(180deg,rgba(64,26,38,.95),rgba(42,18,27,.95))}\nbutton svg{width:17px;height:17px;vertical-align:-3px;margin-right:6px}\n@media(hover:hover){button:hover:not(:disabled){border-color:rgba(148,170,204,.34)}button.primary:hover:not(:disabled){filter:brightness(1.06)}}\n.app{width:100%;max-width:960px;margin:0 auto;padding:calc(env(safe-area-inset-top) + 20px) 18px calc(env(safe-area-inset-bottom) + 36px)}\n.top{display:flex;align-items:center;gap:12px;margin:0 0 16px;min-width:0}\n.top>div:first-child{flex:1 1 auto;min-width:0}\n.eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.16em;color:var(--accent);opacity:.85;margin-bottom:3px}\n.title{font-size:25px;font-weight:800;letter-spacing:-.025em;line-height:1.15}\n.status{font-size:11.5px;line-height:1.35;color:var(--muted);text-align:right;max-width:150px;min-width:0}\n.status.ok{color:var(--good)}\n.status.error{color:var(--bad)}\n.top .small{flex:0 0 auto}\n.tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:4px;background:rgba(14,20,32,.92);border:1px solid var(--line);border-radius:14px;position:sticky;top:calc(env(safe-area-inset-top) + 6px);z-index:5;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 18px 40px -30px #000}\n.tabs button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:50px;padding:6px 4px;border:0;border-radius:10px;background:transparent;color:var(--muted);font-size:11.5px;font-weight:600;white-space:nowrap}\n.tabs button svg{width:18px;height:18px;margin:0}\n.tabs button.active{background:linear-gradient(180deg,rgba(60,80,116,.9),rgba(34,46,68,.95));color:#f4f8ff;box-shadow:0 1px 0 rgba(255,255,255,.08) inset,0 10px 24px -18px #000}\n.tabs button.active svg{color:var(--accent)}\n.panel{display:none;min-width:0}\n.panel.active{display:block;animation:fade .18s ease}\n@keyframes fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}\n.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0 12px}\n.card{position:relative;min-width:0;padding:14px 14px 15px;border-radius:14px;background:linear-gradient(180deg,rgba(31,42,62,.92),rgba(15,21,33,.96));border:1px solid var(--line-soft);overflow:hidden}\n.card::before{content:'';position:absolute;inset:0 0 auto 0;height:1px;background:linear-gradient(90deg,transparent,rgba(127,168,255,.7),transparent)}\n.card b{display:block;margin-top:6px;font-size:23px;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.label{color:var(--muted);font-size:11.5px;letter-spacing:.02em}\n.hint{color:var(--muted);font-size:12px;line-height:1.5}\n.section{min-width:0;margin:12px 0;padding:16px;border-radius:var(--radius);background:linear-gradient(180deg,rgba(20,28,43,.96),rgba(14,20,31,.96));border:1px solid var(--line);box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 20px 44px -38px #000}\n.section .section{padding:0;border:0;background:none;box-shadow:none;margin:12px 0}\n.section h2{display:flex;align-items:center;gap:8px;margin:0 0 12px;font-size:15px;font-weight:700;letter-spacing:-.01em}\n.section h2::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px rgba(127,168,255,.9);flex:0 0 auto}\n.row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-width:0}\n.stack{display:grid;gap:10px;min-width:0}\n.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;min-width:0}\n.input,select,textarea{width:100%;min-width:0;min-height:44px;padding:11px 12px;border:1px solid var(--line);border-radius:11px;background:rgba(8,12,20,.85);color:var(--text);outline:none;transition:border-color .15s ease,box-shadow .15s ease}\n.input::placeholder,textarea::placeholder{color:#6d7d92}\n.input:focus,select:focus,textarea:focus{border-color:rgba(127,168,255,.75);box-shadow:0 0 0 3px rgba(127,168,255,.16)}\ntextarea{min-height:132px;resize:vertical;font-family:var(--mono);font-size:12.5px;line-height:1.6}\nselect{appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 18px) 20px,calc(100% - 13px) 20px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:34px}\n.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0;min-width:0}\n.toolbar>*{min-width:0}\n.toolbar .grow{flex:1 1 170px}\n.toolbar select{flex:1 1 150px;width:auto}\n.toolbar label{display:flex;align-items:center;gap:7px;min-height:44px;color:var(--muted);font-size:13px}\n.domain-list{display:grid;gap:8px;min-width:0}\n.domain-item{display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:8px;min-width:0;padding:11px 10px;border-radius:12px;background:linear-gradient(180deg,rgba(20,28,42,.92),rgba(12,18,28,.92));border:1px solid var(--line-soft)}\n.domain-main{min-width:0}\n.domain-name{font-weight:650;font-size:13.5px;word-break:break-all;overflow-wrap:anywhere}\n.domain-meta{margin-top:4px;font-size:11.5px;line-height:1.5;color:var(--muted);font-variant-numeric:tabular-nums}\n.checkbox{width:22px;height:22px;min-height:22px;accent-color:var(--accent);justify-self:center}\n.empty{padding:30px 18px;text-align:center;color:var(--muted);font-size:13px;border:1px dashed rgba(148,170,204,.22);border-radius:12px;background:rgba(10,15,24,.5)}\n.notice{margin:10px 0;padding:11px 13px;border-radius:11px;border:1px solid rgba(255,200,102,.32);background:rgba(255,200,102,.09);color:#ffe0a3;font-size:12.5px}\n.errorbox{margin:10px 0;padding:12px 13px;border-radius:11px;border:1px solid rgba(255,118,136,.38);background:rgba(255,118,136,.1);color:#ffb3be;font-size:12.5px;white-space:pre-wrap;overflow-wrap:anywhere}\n.pill{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;background:rgba(127,168,255,.14);border:1px solid rgba(127,168,255,.3);color:#bcd5ff;font-size:10.5px;font-weight:700;letter-spacing:.02em;white-space:nowrap}\n.rule-line{padding:8px 0;border-bottom:1px solid var(--line-soft);font-family:var(--mono);font-size:12.5px;white-space:pre-wrap;word-break:break-all}\n.rule-line:last-child{border-bottom:0}\n.switch{display:flex;align-items:center;gap:10px;min-height:44px;font-size:14px}\n.switch input{width:20px;height:20px;accent-color:var(--accent)}\n.exclude-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}\n.exclude-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line-soft);font-size:13px;word-break:break-all}\n.small{min-height:40px;padding:8px 12px;font-size:12.5px}\n.footer{margin-top:16px;color:#7d8da3;font-size:11.5px;line-height:1.65}\n.top .title{font-size:22px}\n.app[data-locked=true]>.tabs,.app[data-locked=true]>.panel,.app[data-locked=true] .top button{display:none!important}\n.app[data-locked=true]{max-width:520px}\n.deferred{margin:12px 0 0;padding:13px 14px;border-radius:12px;border:1px dashed rgba(148,170,204,.28);background:rgba(12,18,28,.72);display:flex;flex-wrap:wrap;align-items:center;gap:10px}\n.deferred .deferred-copy{flex:1 1 180px;min-width:0;font-size:12px;color:var(--muted);line-height:1.55}\n.deferred b{display:block;color:var(--text);font-size:13px;font-weight:650;margin-bottom:2px}\n.loading{position:relative;overflow:hidden}\n.loading::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent);animation:sweep 1.1s linear infinite}\n@keyframes sweep{from{transform:translateX(-100%)}to{transform:translateX(100%)}}\n@media(max-width:640px){\n.app{padding:calc(env(safe-area-inset-top) + 16px) 13px calc(env(safe-area-inset-bottom) + 28px)}\n.cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}\n.card{padding:12px}\n.card b{font-size:21px}\n.grid2{grid-template-columns:minmax(0,1fr)}\n.section{padding:14px;border-radius:14px}\n.title{font-size:20px}\n.status{max-width:104px;font-size:11px}\n.top{gap:9px}\n.tabs button{min-height:48px;font-size:11px}\n.domain-item{grid-template-columns:38px minmax(0,1fr) auto;padding:10px 8px}\n.checkbox{width:20px;height:20px}\n.toolbar{gap:7px}\n}\n@media(max-width:380px){\n.cards{grid-template-columns:minmax(0,1fr)}\n.top .status{display:none}\n}\n@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}\n\n/* header reflow: title owns its row on narrow screens so nothing overlaps */\n.top{flex-wrap:wrap;row-gap:8px}\n.top>div:first-child{flex:1 1 100%;min-width:0}\n.top .status{flex:1 1 auto;text-align:left;max-width:none;min-width:0}\n.top .small{margin-left:auto}\n.title{overflow-wrap:anywhere}\n@media(min-width:641px){\n.top{flex-wrap:nowrap}\n.top>div:first-child{flex:1 1 auto}\n.top .status{flex:0 1 auto;text-align:right;max-width:190px}\n.top .small{margin-left:0}\n}\n</style>\n</head>\n<body>\n<main class=\"app\" data-locked=\"true\">\n<header class=\"top\"><div><div class=\"eyebrow\">LOCAL \u00b7 SURGE</div><div class=\"title\">Surge\u57df\u540d\u89c4\u5219\u91c7\u96c6\u5668</div></div><div id=\"connection\" class=\"status\">\u6b63\u5728\u8fde\u63a5\u2026</div><button id=\"refresh-state\" class=\"small\" aria-label=\"\u5237\u65b0\u672c\u5730\u72b6\u6001\"><svg aria-hidden=\"true\" focusable=\"false\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" />\n  <path d=\"M21 3v5h-5\" />\n  <path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" />\n  <path d=\"M8 16H3v5\" />\n</svg>\n\u5237\u65b0</button></header>\n<nav class=\"tabs\" aria-label=\"\u4e3b\u5bfc\u822a\"><button class=\"tab active\" data-tab=\"overview\"><svg aria-hidden=\"true\" focusable=\"false\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <rect width=\"7\" height=\"9\" x=\"3\" y=\"3\" rx=\"1\" />\n  <rect width=\"7\" height=\"5\" x=\"14\" y=\"3\" rx=\"1\" />\n  <rect width=\"7\" height=\"9\" x=\"14\" y=\"12\" rx=\"1\" />\n  <rect width=\"7\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\" />\n</svg>\n\u6982\u89c8</button><button class=\"tab\" data-tab=\"domains\"><svg aria-hidden=\"true\" focusable=\"false\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\" />\n  <path d=\"M2 12h20\" />\n</svg>\n\u57df\u540d</button><button class=\"tab\" data-tab=\"rules\"><svg aria-hidden=\"true\" focusable=\"false\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M3 6h18\" />\n  <path d=\"M7 12h10\" />\n  <path d=\"M10 18h4\" />\n</svg>\n\u89c4\u5219</button><button class=\"tab\" data-tab=\"settings\"><svg aria-hidden=\"true\" focusable=\"false\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M20 7h-9\" />\n  <path d=\"M14 17H5\" />\n  <circle cx=\"17\" cy=\"17\" r=\"3\" />\n  <circle cx=\"7\" cy=\"7\" r=\"3\" />\n</svg>\n\u8bbe\u7f6e</button></nav>\n<section id=\"unlock-panel\" class=\"section\"><h2>\u672c\u673a\u8bbf\u95ee\u6388\u6743</h2><p class=\"hint\">\u8bf7\u70b9 Surge \u7684 Surge\u57df\u540d\u89c4\u5219\u91c7\u96c6\u5668 \u9762\u677f\u5237\u65b0\u5e76\u6253\u5f00\u901a\u77e5</p><div class=\"stack\"><input id=\"access-input\" class=\"input\" type=\"password\" autocomplete=\"off\" autocapitalize=\"none\" spellcheck=\"false\" placeholder=\"\u53ef\u9009\uff1a\u7c98\u8d34\u901a\u77e5\u6574\u94fe\u63a5\u621632\u4f4d\u8bbf\u95ee\u5bc6\u94a5\" aria-label=\"\u672c\u673a\u8bbf\u95ee\u5bc6\u94a5\"><button id=\"unlock\" class=\"primary\"><svg aria-hidden=\"true\" focusable=\"false\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z\" />\n  <circle cx=\"16.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />\n</svg>\n\u672c\u5730\u89e3\u9501</button></div><p class=\"hint\">\u8bbf\u95ee\u5bc6\u94a5\u4ec5\u7559\u5728\u5f53\u524d\u9875\u9762\u5185\u5b58\uff1b\u5237\u65b0\u6216\u5173\u95ed\u9875\u9762\u540e\u9700\u91cd\u65b0\u6388\u6743\u3002</p></section><div id=\"error\" class=\"errorbox\" hidden></div>\n<section id=\"overview\" class=\"panel active\"><div class=\"cards\"><div class=\"card\"><span class=\"label\">\u5df2\u6536\u96c6</span><b id=\"stat-count\">\u2014</b></div><div class=\"card\"><span class=\"label\">\u4eca\u65e5\u65b0\u589e</span><b id=\"stat-today\">\u2014</b></div><div class=\"card\"><span class=\"label\">\u4e0a\u9650</span><b id=\"stat-limit\">\u2014</b></div><div class=\"card\"><span class=\"label\">\u72b6\u6001</span><b id=\"stat-enabled\">\u2014</b></div></div><div class=\"section\"><div class=\"row\"><div><h2>\u91c7\u96c6\u63a7\u5236</h2><div id=\"last-collected\" class=\"hint\">\u6700\u8fd1\u91c7\u96c6\uff1a\u2014</div></div><button id=\"overview-toggle\">\u5207\u6362\u91c7\u96c6</button></div></div><div class=\"section\"><div class=\"row\"><h2>\u6700\u8fd1\u53d1\u73b0</h2><span id=\"recent-mode\" class=\"pill\">\u6458\u8981\u6a21\u5f0f</span></div><div id=\"recent-deferred\" class=\"deferred\"><div class=\"deferred-copy\"><b>\u6309\u9700\u52a0\u8f7d</b>\u6982\u89c8\u4ec5\u7528\u4e00\u6b21\u8f7b\u91cf\u6458\u8981\u6e32\u67d3\uff0c\u6700\u8fd1 host \u9700\u8981\u5b8c\u6574\u5feb\u7167\u65f6\u624d\u8bfb\u53d6\u5206\u7247\u3002</div><button id=\"load-recent\" class=\"small\">\u52a0\u8f7d\u8bb0\u5f55</button></div><div id=\"recent\" class=\"domain-list\"></div></div><div class=\"section\"><h2>\u5b58\u50a8\u4e0e\u91c7\u6837</h2><div id=\"storage\" class=\"stack\"></div><div class=\"footer\">\u8bbf\u95ee\u6b21\u6570\u4e3a\u6301\u4e45\u5316\u91c7\u6837\u6b21\u6570\uff0860 \u79d2\u5408\u5e76\uff09\u7684\u4e0b\u754c\uff0c\u4e0d\u662f\u7cbe\u786e\u8fde\u63a5\u6570\uff1blastSeen \u4e5f\u53ef\u80fd\u6709 60 \u79d2\u8bef\u5dee\u3002\u9996\u6b21\u53d1\u73b0\u65f6\u95f4\u662f\u9996\u6b21\u6301\u4e45\u5316\u89c2\u5bdf\u65f6\u95f4\u3002</div></div></section>\n<section id=\"domains\" class=\"panel\"><div class=\"section\"><div class=\"toolbar\"><input id=\"search\" class=\"input grow\" placeholder=\"\u641c\u7d22\u57df\u540d\u2026\" autocomplete=\"off\"><select id=\"sort\" aria-label=\"\u6392\u5e8f\"><option value=\"last\">\u6700\u8fd1\u53d1\u73b0</option><option value=\"first\">\u9996\u6b21\u53d1\u73b0</option><option value=\"name\">\u540d\u79f0</option><option value=\"visits\">\u91c7\u6837\u6b21\u6570</option></select></div><div class=\"toolbar\"><label><input id=\"select-all\" class=\"checkbox\" type=\"checkbox\"> \u5168\u9009\u5f53\u524d</label><span id=\"selected-count\" class=\"hint\">\u5df2\u9009 0</span><button id=\"delete-selected\" class=\"danger small\">\u6279\u91cf\u5220\u9664</button></div><div id=\"domain-list\" class=\"domain-list\"></div><div class=\"toolbar\"><button id=\"prev-page\">\u2039 \u4e0a\u4e00\u9875</button><span id=\"page-label\" class=\"hint\"></span><button id=\"next-page\">\u4e0b\u4e00\u9875 \u203a</button></div></div></section>\n<section id=\"rules\" class=\"panel\"><div class=\"section\"><h2>\u89c4\u5219\u751f\u6210\u5668</h2><div class=\"stack\"><div class=\"grid2\"><label class=\"stack\"><span class=\"label\">\u89c4\u5219\u7c7b\u578b</span><select id=\"rule-type\"><option>DOMAIN</option><option>DOMAIN-SUFFIX</option></select></label><label class=\"stack\"><span class=\"label\">\u9ed8\u8ba4\u7b56\u7565</span><select id=\"policy\"><option>Proxy</option><option>DIRECT</option><option>REJECT</option><option value=\"custom\">\u81ea\u5b9a\u4e49</option></select></label></div><label id=\"custom-wrap\" class=\"stack\" hidden><span class=\"label\">\u81ea\u5b9a\u4e49\u7b56\u7565\uff08\u7981\u6b62\u9017\u53f7\u3001\u6362\u884c\u3001\u63a7\u5236\u7b26\u3001//\uff09</span><input id=\"custom-policy\" class=\"input\" placeholder=\"\u4f8b\u5982 MyPolicy\"></label><label class=\"switch\"><input id=\"group-preview\" type=\"checkbox\"> \u6309\u7b56\u7565\u5206\u7ec4\uff08\u9884\u89c8 / \u590d\u5236 / \u5bfc\u51fa\uff09</label><div class=\"hint\">\u7c98\u8d34\u73b0\u6709\u89c4\u5219\u7528\u4e8e\u672c\u5730\u6bd4\u8f83\uff1b\u4ec5\u8bc6\u522b DOMAIN / DOMAIN-SUFFIX\uff0c\u5ffd\u7565 #\u3001;\u3001// \u6ce8\u91ca\u3002\u4e0d\u8bfb\u53d6\u6216\u5199\u5165 Surge \u914d\u7f6e\u3002</div><textarea id=\"existing\" placeholder=\"\u7c98\u8d34\u5df2\u6709 Surge \u89c4\u5219\uff0c\u6bcf\u884c\u5982 DOMAIN,example.com,Proxy\"></textarea><div class=\"toolbar\"><button id=\"make-rules\" class=\"primary\">\u751f\u6210\u9009\u4e2d\u89c4\u5219</button><button id=\"apply-policy\">\u5c06\u9ed8\u8ba4\u7b56\u7565\u5e94\u7528\u5168\u90e8\u9009\u4e2d</button><button id=\"copy-rules\"><svg aria-hidden=\"true\" focusable=\"false\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" />\n  <path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />\n</svg>\n\u590d\u5236</button><button id=\"export-rules\"><svg aria-hidden=\"true\" focusable=\"false\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />\n  <polyline points=\"7 10 12 15 17 10\" />\n  <line x1=\"12\" x2=\"12\" y1=\"15\" y2=\"3\" />\n</svg>\n\u5bfc\u51fa .conf</button></div><div class=\"hint\">DOMAIN / DOMAIN-SUFFIX \u5747\u4f7f\u7528\u5b57\u9762\u9009\u4e2d\u7684 host\uff1b\u4e0d\u4f1a\u731c\u6d4b\u6839\u57df\u3002\u53ef\u5728\u4e0b\u65b9\u4e3a\u6bcf\u4e2a\u9009\u4e2d host \u6307\u5b9a\u7b56\u7565\u3002</div><datalist id=\"policy-options\"><option value=\"Proxy\"><option value=\"DIRECT\"><option value=\"REJECT\"></datalist><div id=\"rule-hosts\" class=\"stack\"></div><div id=\"rule-output\" class=\"stack\"></div></div></div></section>\n<section id=\"settings\" class=\"panel\"><div class=\"section\"><h2>\u5b58\u50a8\u72b6\u6001</h2><div id=\"settings-storage\" class=\"stack\"></div></div><div class=\"section\"><h2>\u91c7\u96c6\u8bbe\u7f6e</h2><div class=\"stack\"><label class=\"switch\"><input id=\"enabled\" type=\"checkbox\"> \u542f\u7528\u6536\u96c6</label><label class=\"stack\"><span class=\"label\">\u6700\u5927\u57df\u540d\u6570\uff08\u4e0d\u80fd\u5c0f\u4e8e\u5f53\u524d\u6570\u91cf\uff09</span><input id=\"max-domains\" class=\"input\" type=\"number\" min=\"1\" max=\"10000\" step=\"1\"></label><div><div class=\"label\">\u6392\u9664\u5217\u8868\uff08\u6bcf\u884c\u4e00\u6761\uff09</div><textarea id=\"exclude-input\" placeholder=\"ads.example.com&#10;telemetry.example.com\" aria-label=\"\u6392\u9664\u57df\u540d\uff0c\u6bcf\u884c\u4e00\u6761\"></textarea></div><button id=\"save-settings\" class=\"primary\"><svg aria-hidden=\"true\" focusable=\"false\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  width=\"24\"\n  height=\"24\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\" />\n  <path d=\"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7\" />\n  <path d=\"M7 3v4a1 1 0 0 0 1 1h7\" />\n</svg>\n\u4fdd\u5b58\u8bbe\u7f6e</button></div></div><div class=\"section\"><h2>\u6570\u636e\u64cd\u4f5c</h2><p class=\"hint\">\u6e05\u7a7a\u4f1a\u5220\u9664\u6240\u6709\u5df2\u6536\u96c6\u57df\u540d\uff0c\u4e0d\u4f1a\u81ea\u52a8\u6267\u884c\u3002</p><button id=\"clear-data\" class=\"danger\">\u6e05\u7a7a\u5168\u90e8\u6570\u636e</button></div><div class=\"footer\">\u6240\u6709\u8bf7\u6c42\u4ec5\u53d1\u5f80\u540c\u6e90\u672c\u5730\u63a5\u53e3\uff1b\u4e0d\u4f1a\u4fee\u6539 Surge \u914d\u7f6e\u3002\u89c4\u5219\u4ec5\u5728\u672c\u9875\u9762\u751f\u6210\u3002</div></section>\n</main>\n<script>\n(function(root){\n'use strict';\nvar TEST={\n validPolicy:function(p){return typeof p==='string'&&p.trim().length>0&&!/[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029,#;]/.test(p)&&p.indexOf('//')<0},\n accessKey:function(input){var s=String(input||'').trim();if(/^[a-f0-9]{32}$/.test(s))return s;var m=s.match(/(?:^#|#)k=([a-f0-9]{32})$/);return m?m[1]:''},\n page:function(items,page,size){return items.slice(Math.max(0,page)*size,(Math.max(0,page)+1)*size)},\n normalizeHost:function(h){if(typeof h!=='string')return '';var s=h.trim().toLowerCase();if(s.endsWith('.'))s=s.slice(0,-1);if(!s||s.length>253)return '';return s.split('.').every(function(l){return l.length>0&&l.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l)})?s:''},\n ruleKey:function(t,h){return t+'|'+h},\n parseExisting:function(text){var out=[],lines=String(text||'').split(/\\r?\\n/);lines.forEach(function(line){var p=line.replace(/\\s*(?:#|;|\\/\\/).*$/,'').trim().split(',').map(function(x){return x.trim()});if(p.length===3&&(p[0]==='DOMAIN'||p[0]==='DOMAIN-SUFFIX')){var h=TEST.normalizeHost(p[1]);var pol=p[2].trim();if(h&&TEST.validPolicy(pol))out.push({type:p[0],host:h,policy:pol,line:line.trim()})}});return out},\n generate:function(items,type,defaultPolicy,existing){var ex=TEST.parseExisting(existing),exact=Object.create(null),policies=Object.create(null),conflicts=[],errors=[],lines=[];if(type!=='DOMAIN'&&type!=='DOMAIN-SUFFIX')errors.push('\u4e0d\u652f\u6301\u7684\u89c4\u5219\u7c7b\u578b');ex.forEach(function(x){var k=TEST.ruleKey(x.type,x.host);exact[k]=1;(policies[k]||(policies[k]=[])).push(x.policy)});items.forEach(function(x){var host=TEST.normalizeHost(x.host),policy=x.policy===undefined?defaultPolicy:x.policy,k=TEST.ruleKey(type,host);if(!host||!TEST.validPolicy(policy)){errors.push('\u57df\u540d\u6216\u7b56\u7565\u65e0\u6548');return}if((policies[k]||[]).some(function(p){return p!==policy})){conflicts.push({key:k,policies:(policies[k]||[]).concat([policy])});return}if(!exact[k]||!(policies[k]||[]).includes(policy)){lines.push(type+','+host+','+policy);exact[k]=1;(policies[k]||(policies[k]=[])).push(policy)}});return {lines:conflicts.length||errors.length?[]:lines,conflicts:conflicts,errors:errors,existing:ex}},\n serialize:function(lines,grouped){if(!grouped)return lines.join('\\n');var groups=TEST.group(lines);return Object.keys(groups).map(function(policy){return '# '+policy+'\\n'+groups[policy].join('\\n')}).join('\\n\\n')},\n group:function(lines){var out=Object.create(null);lines.forEach(function(l){var p=l.split(',');(out[p[2]]||(out[p[2]]=[])).push(l)});return out}\n};\nroot.DCUI_TEST=TEST;if(typeof document==='undefined')return;\nvar state=null,summary=null,stateLoaded=false,stateLoading=null,activeTab='overview',csrf='',selected=Object.create(null),hostPolicies=Object.create(null),busy=false,access='',domainPage=0,rulePage=0,PAGE=75;\nfunction $(id){return document.getElementById(id)}\nfunction text(el,v){el.textContent=v==null?'':String(v)}\nfunction showError(v){var e=$('error');if(v){text(e,v);e.hidden=false;$('connection').className='status error';text($('connection'),'\u63a5\u53e3\u9519\u8bef')}else{e.hidden=true;$('connection').className='status ok';text($('connection'),'\u672c\u5730\u63a5\u53e3\u5df2\u8fde\u63a5')}}\nfunction fmtTime(v){return v?new Date(v).toLocaleString('zh-CN',{hour12:false}):'\u2014'}\nfunction applyState(s,token){if(!s||!Array.isArray(s.records)||typeof s.revision!=='string')throw new Error('\u63a5\u53e3 snapshot \u683c\u5f0f\u4e0d\u7b26\u5408\u5408\u540c');state=s;if(token)csrf=token;var live=Object.create(null);s.records.forEach(function(x){live[x.domain]=1});Object.keys(selected).forEach(function(h){if(!live[h]){delete selected[h];delete hostPolicies[h]}});stateLoaded=true;dismissDeferred();document.querySelector('.app').dataset.locked='false';$('unlock-panel').hidden=true;render();showError('')}\nfunction applySummary(s,token){if(!s||typeof s.revision!=='string'||typeof s.count!=='number')throw new Error('\u63a5\u53e3 summary \u683c\u5f0f\u4e0d\u7b26\u5408\u5408\u540c');if(Array.isArray(s.records))throw new Error('\u63a5\u53e3 summary \u4e0d\u5e94\u5305\u542b\u8bb0\u5f55');summary=s;if(token)csrf=token;document.querySelector('.app').dataset.locked='false';$('unlock-panel').hidden=true;renderSummary();showError('')}\nfunction dismissDeferred(){var d=$('recent-deferred');if(d)d.hidden=true;var m=$('recent-mode');if(m)text(m,'\u5b8c\u6574\u5feb\u7167')}\nfunction paintStorage(st){st=st||{};var warn=(st.warnings||[]).join('\uff1b');$('storage').replaceChildren();var a=document.createElement('div');text(a,'\u5bb9\u91cf\uff1a'+(st.bytes||0)+' / '+(st.limitBytes||0)+' bytes \u00b7 '+(st.status||'unknown'));$('storage').append(a);if(warn){var w=document.createElement('div');w.className='notice';text(w,'\u26a0 '+warn);$('storage').append(w)}$('settings-storage').replaceChildren();Array.from($('storage').childNodes).forEach(function(n){$('settings-storage').append(n.cloneNode(true))})}\nfunction lockUI(){access=csrf='';state=null;summary=null;stateLoaded=false;stateLoading=null;selected=Object.create(null);hostPolicies=Object.create(null);document.querySelector('.app').dataset.locked='true';$('unlock-panel').hidden=false;document.querySelectorAll('textarea,input').forEach(function(n){n.value=''});['domain-list','recent','rule-hosts','rule-output','storage','settings-storage'].forEach(function(id){$(id).replaceChildren()});['stat-count','stat-today','stat-limit','stat-enabled','last-collected'].forEach(function(id){text($(id),'\u2014')});var d=$('recent-deferred');if(d)d.hidden=false;var m=$('recent-mode');if(m)text(m,'\u6458\u8981\u6a21\u5f0f')}\nfunction request(path,opts){if(!access)return Promise.reject(new Error('\u8bf7\u70b9 Surge \u7684 Surge\u57df\u540d\u89c4\u5219\u91c7\u96c6\u5668 \u9762\u677f\u5237\u65b0\u5e76\u6253\u5f00\u901a\u77e5'));opts=opts||{};opts.credentials='omit';opts.cache='no-store';opts.headers=Object.assign({'Accept':'application/json','X-DC-Access':access},opts.headers||{});return fetch(path,opts).then(function(r){return r.json().catch(function(){return {error:'\u63a5\u53e3\u8fd4\u56de\u4e0d\u662f JSON\uff08HTTP '+r.status+'\uff09'}}).then(function(d){if(!r.ok){if(r.status===403){lockUI()}throw new Error(typeof d.error==='string'?d.error:(d.error&&d.error.message)||d.message||('HTTP '+r.status))}return d})})}\nfunction apiAction(action,payload){if(!state||!csrf){showError('\u672c\u5730\u72b6\u6001\u5c1a\u672a\u5c31\u7eea\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5');return Promise.resolve(false)}if(busy){showError('\u6b63\u5728\u4fdd\u5b58\uff0c\u8bf7\u7b49\u5f85\u5f53\u524d\u64cd\u4f5c\u5b8c\u6210');return Promise.resolve(false)}busy=true;var body={action:action,payload:Object.assign({},payload,{revision:state.revision}),csrf:csrf};return request('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Domain-Collector':csrf},body:JSON.stringify(body)}).then(function(d){applyState(d.snapshot||d,d.csrf);return true}).catch(function(e){showError(e.message+'\uff1b\u5982\u7248\u672c\u51b2\u7a81\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u65b0\u786e\u8ba4\u64cd\u4f5c');return false}).finally(function(){busy=false})}\nfunction render(){if(!state)return;var r=state.records||[],st=state.storage||{};text($('stat-count'),state.count);text($('stat-today'),state.todayNew);text($('stat-limit'),state.maxDomains);text($('stat-enabled'),state.enabled?'\u8fd0\u884c\u4e2d':'\u5df2\u6682\u505c');text($('overview-toggle'),state.enabled?'\u2161 \u6682\u505c\u91c7\u96c6':'\u25b7 \u5f00\u59cb\u91c7\u96c6');text($('last-collected'),'\u6700\u8fd1\u91c7\u96c6\uff1a'+fmtTime(state.lastSeen)+'\uff0860 \u79d2\u5408\u5e76\u8bef\u5dee\uff09');paintStorage(st);$('enabled').checked=!!state.enabled;$('max-domains').value=state.maxDomains;renderRecent(r);renderDomains();renderExclude();renderRuleHosts()}\nfunction renderSummary(){var s=summary;if(!s)return;text($('stat-count'),s.count);text($('stat-today'),s.todayNew);text($('stat-limit'),s.maxDomains);text($('stat-enabled'),s.enabled?'\u8fd0\u884c\u4e2d':'\u5df2\u6682\u505c');text($('overview-toggle'),s.enabled?'\u2161 \u6682\u505c\u91c7\u96c6':'\u25b7 \u5f00\u59cb\u91c7\u96c6');text($('last-collected'),'\u6700\u8fd1\u91c7\u96c6\uff1a'+fmtTime(s.lastSeen)+'\uff0860 \u79d2\u5408\u5e76\u8bef\u5dee\uff09');paintStorage(s.storage);var d=$('recent-deferred');if(d)d.hidden=!!stateLoaded;var m=$('recent-mode');if(m)text(m,stateLoaded?'\u5b8c\u6574\u5feb\u7167':'\u6458\u8981\u6a21\u5f0f')}\nfunction mini(rec){var d=document.createElement('div');d.className='domain-item';var spacer=document.createElement('span');d.append(spacer);var main=document.createElement('div');main.className='domain-main';var n=document.createElement('div');n.className='domain-name';text(n,rec.domain);var m=document.createElement('div');m.className='domain-meta';text(m,(rec.protocols||[]).join(' \u00b7 ')+' \u00b7 '+(rec.visits||0)+' \u6b21\u91c7\u6837 \u00b7 '+fmtTime(rec.lastSeen));main.append(n,m);d.append(main);var p=document.createElement('span');p.className='pill';text(p,'\u6700\u8fd1');d.append(p);return d}\nfunction renderRecent(r){var box=$('recent');box.replaceChildren();r.slice().sort(function(a,b){return (b.lastSeen||0)-(a.lastSeen||0)}).slice(0,5).forEach(function(x){box.append(mini(x))});if(!box.children.length){var e=document.createElement('div');e.className='empty';text(e,'\u5c1a\u672a\u53d1\u73b0\u57df\u540d');box.append(e)}}\nfunction filtered(){var q=$('search').value.trim().toLowerCase(),sort=$('sort').value;var r=((state&&state.records)||[]).filter(function(x){return !q||x.domain.toLowerCase().includes(q)}).slice();r.sort(function(a,b){if(sort==='name')return a.domain.localeCompare(b.domain);if(sort==='first')return (b.firstSeen||0)-(a.firstSeen||0);if(sort==='visits')return (b.visits||0)-(a.visits||0);return (b.lastSeen||0)-(a.lastSeen||0)});return r}\nfunction renderDomains(){var box=$('domain-list');box.replaceChildren();var r=filtered();domainPage=Math.min(domainPage,Math.max(0,Math.ceil(r.length/PAGE)-1));text($('page-label'),(domainPage+1)+' / '+Math.max(1,Math.ceil(r.length/PAGE))+' \u00b7 '+r.length+' \u9879');$('prev-page').disabled=domainPage===0;$('next-page').disabled=(domainPage+1)*PAGE>=r.length;TEST.page(r,domainPage,PAGE).forEach(function(rec){var d=document.createElement('div');d.className='domain-item';var cb=document.createElement('input');cb.type='checkbox';cb.className='checkbox';cb.checked=!!selected[rec.domain];cb.setAttribute('aria-label','\u9009\u62e9 '+rec.domain);cb.addEventListener('change',function(){if(cb.checked)selected[rec.domain]=1;else delete selected[rec.domain];updateSelected();invalidateRules()});d.append(cb);var main=document.createElement('div');main.className='domain-main';var n=document.createElement('div');n.className='domain-name';text(n,rec.domain);var m=document.createElement('div');m.className='domain-meta';text(m,'\u9996\u6b21 '+fmtTime(rec.firstSeen)+' \u00b7 \u6700\u8fd1 '+fmtTime(rec.lastSeen)+' \u00b7 '+(rec.protocols||[]).join(' / ')+' \u00b7 \u6301\u4e45\u5316\u91c7\u6837 '+(rec.visits||0)+'\uff08\u4e0b\u754c\uff09');main.append(n,m);d.append(main);var del=document.createElement('button');del.className='danger small';text(del,'\u5220\u9664');del.addEventListener('click',function(){if(window.confirm('\u786e\u8ba4\u5220\u9664 '+rec.domain+'\uff1f'))apiAction('delete',{domains:[rec.domain]})});d.append(del);box.append(d)});if(!r.length){var e=document.createElement('div');e.className='empty';text(e,state&&state.count?'\u6ca1\u6709\u5339\u914d\u7ed3\u679c':'\u6682\u65e0\u57df\u540d');box.append(e)}updateSelected()}\nfunction updateSelected(){var n=Object.keys(selected).length;text($('selected-count'),'\u5df2\u9009 '+n);$('select-all').checked=!!n&&filtered().every(function(x){return selected[x.domain]})}\nfunction renderExclude(){$('exclude-input').value=(state.exclude||[]).join('\\n')}\nfunction renderRuleHosts(){var box=$('rule-hosts');box.replaceChildren();var hosts=((state&&state.records)||[]).filter(function(x){return selected[x.domain]});rulePage=Math.min(rulePage,Math.max(0,Math.ceil(hosts.length/PAGE)-1));TEST.page(hosts,rulePage,PAGE).forEach(function(x){var row=document.createElement('div');row.className='stack';var s=document.createElement('span');s.className='domain-name';text(s,x.domain);var input=document.createElement('input');input.className='input';input.setAttribute('aria-label',x.domain+' \u7684\u7b56\u7565');input.setAttribute('list','policy-options');input.placeholder='Proxy / DIRECT / REJECT / \u81ea\u5b9a\u4e49\u7b56\u7565';input.value=hostPolicies[x.domain]||currentPolicy();input.addEventListener('input',function(){hostPolicies[x.domain]=input.value;invalidateRules()});row.append(s,input);box.append(row)});if(!box.children.length){var n=document.createElement('div');n.className='notice';text(n,'\u5148\u5728\u201c\u57df\u540d\u201d\u6807\u7b7e\u9009\u62e9\u4e00\u4e2a\u6216\u591a\u4e2a host\uff0c\u518d\u6307\u5b9a\u7b56\u7565\u3002');box.append(n)}if(hosts.length>PAGE){var bar=document.createElement('div');bar.className='toolbar';var prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');text(prev,'\u2039 \u4e0a\u4e00\u9875');text(next,'\u4e0b\u4e00\u9875 \u203a');text(label,(rulePage+1)+' / '+Math.ceil(hosts.length/PAGE));prev.disabled=rulePage===0;next.disabled=(rulePage+1)*PAGE>=hosts.length;prev.addEventListener('click',function(){rulePage--;renderRuleHosts()});next.addEventListener('click',function(){rulePage++;renderRuleHosts()});bar.append(prev,label,next);box.append(bar)}}\nfunction currentPolicy(){return $('policy').value==='custom'?$('custom-policy').value:$('policy').value}\nfunction invalidateRules(){$('rule-output').replaceChildren()}\nfunction chosenItems(){return ((state&&state.records)||[]).filter(function(x){return selected[x.domain]}).map(function(x){var p=Object.prototype.hasOwnProperty.call(hostPolicies,x.domain)?hostPolicies[x.domain]:currentPolicy();return {host:x.domain,policy:p}})}\nfunction makeRules(){var type=$('rule-type').value,def=currentPolicy(),items=chosenItems();invalidateRules();if(!items.length){showError('\u8bf7\u5148\u5728\u57df\u540d\u6807\u7b7e\u9009\u62e9 host');return null}if(items.some(function(x){return !TEST.validPolicy(x.policy)})){showError('\u9009\u4e2d host \u7684\u7b56\u7565\u65e0\u6548\uff1a\u7981\u6b62\u7a7a\u767d\u3001\u9017\u53f7\u3001\u6362\u884c\u3001\u63a7\u5236\u7b26\u548c\u53cc\u659c\u6760');return null}var result=TEST.generate(items,type,def,$('existing').value);if(result.errors.length){showError(result.errors.join('\uff1b'));return null}var out=$('rule-output');out.replaceChildren();if(result.conflicts.length){var e=document.createElement('div');e.className='errorbox';text(e,'\u68c0\u6d4b\u5230\u540c\u4e00\u76ee\u6807\u5b58\u5728\u4e0d\u540c\u7b56\u7565\uff0c\u5df2\u963b\u6b62\u751f\u6210\uff1a'+result.conflicts.map(function(x){return x.key+' \u2192 '+x.policies.join(' / ')}).join('\uff1b'));out.append(e);return null}var lines=result.lines,groups=$('group-preview').checked?TEST.group(lines):{\u89c4\u5219:lines};Object.keys(groups).forEach(function(k){var h=document.createElement('div');h.className='section';var t=document.createElement('h2');text(t,k+'\uff08'+groups[k].length+'\uff09');h.append(t);var q=document.createElement('textarea');q.readOnly=true;q.setAttribute('aria-label',k+' \u89c4\u5219\u9884\u89c8');q.value=groups[k].join('\\n');q.rows=Math.min(12,Math.max(3,groups[k].length));h.append(q);out.append(h)});if(!lines.length){var e2=document.createElement('div');e2.className='notice';text(e2,'\u6ca1\u6709\u65b0\u89c4\u5219\uff1a\u53ef\u80fd\u672a\u9009\u62e9\u57df\u540d\uff0c\u6216\u5df2\u6709\u89c4\u5219\u5df2\u7cbe\u786e\u53bb\u91cd\u3002');out.append(e2)}return TEST.serialize(lines,$('group-preview').checked)}\nfunction selectTab(name){document.querySelectorAll('.tab').forEach(function(b){b.classList.toggle('active',b.dataset.tab===name)});document.querySelectorAll('.panel').forEach(function(p){p.classList.toggle('active',p.id===name)});activeTab=name;if(name!=='overview')ensureState();if(name==='rules'&&stateLoaded)renderRuleHosts()}\nfunction bind(){\n document.querySelectorAll('.tab').forEach(function(b){b.addEventListener('click',function(){selectTab(b.dataset.tab)})});\n $('refresh-state').addEventListener('click',refreshAll);$('load-recent').addEventListener('click',function(){ensureState()});\n $('search').addEventListener('input',function(){domainPage=0;renderDomains()});$('sort').addEventListener('change',function(){domainPage=0;renderDomains()});\n $('prev-page').addEventListener('click',function(){domainPage=Math.max(0,domainPage-1);renderDomains()});$('next-page').addEventListener('click',function(){domainPage++;renderDomains()});\n $('unlock').addEventListener('click',function(){var key=TEST.accessKey($('access-input').value);$('access-input').value='';if(!key)return showError('\u8bbf\u95ee\u5bc6\u94a5\u65e0\u6548\uff0c\u8bf7\u7c98\u8d34\u901a\u77e5\u6574\u94fe\u63a5\u621632\u4f4d\u5c0f\u5199hex');access=key;$('unlock-panel').hidden=true;loadSummary()});\n $('overview-toggle').addEventListener('click',function(){ensureState().then(function(ok){if(!ok)return;if(window.confirm(state.enabled?'\u786e\u8ba4\u6682\u505c\u91c7\u96c6\uff1f':'\u786e\u8ba4\u5f00\u542f\u91c7\u96c6\uff1f'))apiAction('settings',{enabled:!state.enabled,paused:false,maxDomains:state.maxDomains,exclude:state.exclude.slice()})})});\n $('select-all').addEventListener('change',function(){var on=this.checked;filtered().forEach(function(x){if(on)selected[x.domain]=1;else delete selected[x.domain]});renderDomains();renderRuleHosts();invalidateRules()});\n $('delete-selected').addEventListener('click',function(){var ds=Object.keys(selected);if(!ds.length)return showError('\u8bf7\u5148\u9009\u62e9\u57df\u540d');if(window.confirm('\u786e\u8ba4\u6279\u91cf\u5220\u9664 '+ds.length+' \u4e2a\u57df\u540d\uff1f'))apiAction('delete',{domains:ds})});\n $('enabled').addEventListener('change',function(){if(!state){this.checked=false;showError('\u8bf7\u5148\u8fde\u63a5\u672c\u5730\u63a5\u53e3');return}var value=this.checked;if(!window.confirm(value?'\u786e\u8ba4\u542f\u7528\u57df\u540d\u91c7\u96c6\uff1f':'\u786e\u8ba4\u6682\u505c\u57df\u540d\u91c7\u96c6\uff1f')){this.checked=state.enabled;return}apiAction('settings',{enabled:value,paused:false,maxDomains:state.maxDomains,exclude:state.exclude.slice()}).then(function(ok){if(!ok)$('enabled').checked=state.enabled})});\n $('save-settings').addEventListener('click',function(){if(!state)return showError('\u8bf7\u5148\u8fde\u63a5\u672c\u5730\u63a5\u53e3');var max=Number($('max-domains').value);if(!Number.isInteger(max)||max<state.count||max<1||max>10000){showError('\u4e0a\u9650\u5fc5\u987b\u662f 1\u201310000 \u4e14\u4e0d\u80fd\u5c0f\u4e8e\u5f53\u524d\u6570\u91cf '+state.count);return}var ex=$('exclude-input').value.split(/\\r?\\n/).map(function(x){return x.trim()}).filter(Boolean);if(window.confirm('\u786e\u8ba4\u4fdd\u5b58\u5bb9\u91cf\u4e0a\u9650\u53ca '+ex.length+' \u6761\u6392\u9664\u9879\uff1f'))apiAction('settings',{enabled:state.enabled,maxDomains:max,exclude:ex})});\n $('clear-data').addEventListener('click',function(){if(!state)return showError('\u8bf7\u5148\u8fde\u63a5\u672c\u5730\u63a5\u53e3');if(!window.confirm('\u786e\u8ba4\u6e05\u7a7a\u5168\u90e8 '+state.count+' \u4e2a\u57df\u540d\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\u3002'))return;var code=window.prompt('\u7b2c\u4e8c\u6b21\u4e3b\u52a8\u786e\u8ba4\uff1a\u8bf7\u8f93\u5165 CLEAR\uff08\u533a\u5206\u5927\u5c0f\u5199\uff09\uff1a');if(code==='CLEAR')apiAction('clear',{confirm:'CLEAR'});else if(code!==null)showError('\u672a\u8f93\u5165 CLEAR\uff0c\u5df2\u53d6\u6d88')});\n $('policy').addEventListener('change',function(){$('custom-wrap').hidden=this.value!=='custom';renderRuleHosts();invalidateRules()});\n $('custom-policy').addEventListener('input',function(){renderRuleHosts();invalidateRules()});\n $('apply-policy').addEventListener('click',function(){var p=currentPolicy();if(!TEST.validPolicy(p))return showError('\u9ed8\u8ba4\u7b56\u7565\u65e0\u6548');Object.keys(selected).forEach(function(h){hostPolicies[h]=p});renderRuleHosts();invalidateRules()});\n $('existing').addEventListener('input',invalidateRules);$('rule-type').addEventListener('change',invalidateRules);$('group-preview').addEventListener('change',invalidateRules);\n $('make-rules').addEventListener('click',makeRules);\n $('copy-rules').addEventListener('click',function(){var val=makeRules();if(val===null)return;var done=function(){text($('connection'),'\u5df2\u590d\u5236\u89c4\u5219')};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(val).then(done).catch(function(){fallbackCopy(val,done)});else fallbackCopy(val,done)});\n $('export-rules').addEventListener('click',function(){var val=makeRules();if(val===null)return;var blob=new Blob([val+'\\n'],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='domain-collector-rules.conf';document.body.append(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href)},1000)});\n}\nfunction fallbackCopy(v,done){var t=document.createElement('textarea');t.value=v;t.setAttribute('aria-label','\u624b\u52a8\u590d\u5236\u751f\u6210\u89c4\u5219');document.body.append(t);t.focus();t.select();try{if(document.execCommand('copy')){done();t.remove()}else{showError('\u81ea\u52a8\u590d\u5236\u4e0d\u53ef\u7528\uff1a\u8bf7\u957f\u6309\u4e0b\u65b9\u6587\u672c\u6846\u624b\u52a8\u590d\u5236');t.scrollIntoView()}}catch(e){showError('\u81ea\u52a8\u590d\u5236\u4e0d\u53ef\u7528\uff1a\u8bf7\u957f\u6309\u4e0b\u65b9\u6587\u672c\u6846\u624b\u52a8\u590d\u5236');t.scrollIntoView()}}\nfunction loadState(){if(!access){$('unlock-panel').hidden=false;text($('connection'),'\u7b49\u5f85\u672c\u673a\u6388\u6743');return Promise.resolve(false)}return ensureState()}\nfunction loadSummary(){if(!access){$('unlock-panel').hidden=false;text($('connection'),'\u7b49\u5f85\u672c\u673a\u6388\u6743');return Promise.resolve(false)}text($('connection'),'\u6b63\u5728\u8bfb\u53d6\u6982\u89c8\u2026');return request('/api/summary',{method:'GET'}).then(function(d){applySummary(d.summary||d,d.csrf);return true}).catch(function(e){showError('\u65e0\u6cd5\u8bfb\u53d6\u6982\u89c8\uff1a'+e.message);return false})}\nfunction ensureState(force){if(!force&&stateLoaded&&state)return Promise.resolve(true);if(stateLoading)return stateLoading;if(!access){$('unlock-panel').hidden=false;text($('connection'),'\u7b49\u5f85\u672c\u673a\u6388\u6743');return Promise.resolve(false)}text($('connection'),'\u6b63\u5728\u8bfb\u53d6\u5b8c\u6574\u8bb0\u5f55\u2026');var p=request('/api/state',{method:'GET'}).then(function(d){applyState(d.snapshot||d,d.csrf);return true}).catch(function(e){showError('\u65e0\u6cd5\u8bfb\u53d6\u672c\u5730\u8bb0\u5f55\uff1a'+e.message);return false});stateLoading=p.then(function(ok){stateLoading=null;return ok});return stateLoading}\nfunction refreshAll(){var p=loadSummary();if(stateLoaded)p=p.then(function(){return ensureState(true)});return p}\nfunction boot(){var fragment=location.hash;access=TEST.accessKey(fragment);if(fragment)history.replaceState(null,'',location.pathname+location.search);fragment='';bind();TEST.hooks={selectTab:selectTab,loadSummary:loadSummary,loadState:loadState,ensureState:ensureState,refreshAll:refreshAll,flags:function(){return {stateLoaded:stateLoaded,loading:!!stateLoading,tab:activeTab}},summary:function(){return summary},state:function(){return state}};loadSummary()}\nboot();\n})(typeof window!=='undefined'?window:globalThis);\n</script>\n</body>\n</html>\n";
/* Domain Collector local management adapter. No outgoing network or profile API. */
(function () {
  'use strict';
  var BASE = 'http://domain-collector.invalid';
  var done = false;
  function send(status, value, html) {
    if (done) return;
    done = true;
    $done({response:{status:status,headers:{
      'Content-Type':html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control':'no-store, max-age=0', 'Pragma':'no-cache',
      'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY',
      'Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; font-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    },body:html ? value : JSON.stringify(value)}});
  }
  function header(headers, name) {
    var keys = Object.keys(headers || {}), i;
    for (i=0; i<keys.length; i++) if (keys[i].toLowerCase() === name.toLowerCase()) return String(headers[keys[i]]);
    return '';
  }
  try {
    var req = typeof $request === 'object' && $request ? $request : {};
    var url = String(req.url || ''), method = String(req.method || 'GET').toUpperCase();
    // Do not accept alternate ports, userinfo, encoded hosts, suffixes, or HTTPS.
    if (url !== BASE && url.indexOf(BASE + '/') !== 0) { send(400,{error:'Invalid management origin'}); return; }
    var path = url.slice(BASE.length).split('?')[0] || '/';
    var origin = header(req.headers, 'Origin');
    var referer = header(req.headers, 'Referer');
    if (origin && origin !== BASE) { send(403,{error:'Cross-origin access denied'}); return; }
    if (referer && referer !== BASE && referer.indexOf(BASE + '/') !== 0) { send(403,{error:'Cross-origin referrer denied'}); return; }
    if (method === 'GET' && path === '/') { send(200, DOMAIN_COLLECTOR_HTML, true); return; }
    if (method === 'GET' && path === '/favicon.ico') { send(204,{}); return; }
    if (!((method==='GET' && (path==='/api/state' || path==='/api/summary')) || (method==='POST' && path==='/api/action'))) { send(404,{error:'Not found'}); return; }
    var supplied=header(req.headers,'X-DC-Access');
    var ticket=null;
    if (/^[a-f0-9]{32}$/.test(supplied)) {
      try {ticket=JSON.parse($persistentStore.read('DomainCollectorData.access'));} catch (_) {ticket=null;}
    }
    if (!ticket || ticket.v!==1 || ticket.k!==supplied || typeof ticket.expires!=='number' || !(ticket.expires>Date.now())) { send(403,{error:'请从本机 Surge 面板重新授权'}); return; }
    var core = DomainCollectorCore.create($persistentStore, function(){return Date.now();});
    function state() { var result = core.snapshot(); result.csrf = core.token(); return result; }
    if (method === 'GET' && path === '/api/summary') { var brief = core.summary(); brief.csrf = core.token(); send(200,brief); return; }
    if (method === 'GET' && path === '/api/state') { send(200,state()); return; }
    if (method !== 'POST' || path !== '/api/action') { send(404,{error:'Not found'}); return; }
    var type = header(req.headers, 'Content-Type');
    if (!/^application\/json(?:\s*;|$)/i.test(type)) { send(415,{error:'JSON Content-Type required'}); return; }
    if (typeof req.body !== 'string' || req.body.length > 131072) { send(413,{error:'Action body too large or absent'}); return; }
    var body = JSON.parse(req.body), token = core.token();
    if (typeof token!=='string' || !token || !body || body.csrf !== token || header(req.headers,'X-Domain-Collector') !== token) { send(403,{error:'Invalid CSRF token'}); return; }
    if (body.action !== 'settings' && body.action !== 'delete' && body.action !== 'clear') { send(400,{error:'Unknown action'}); return; }
    var result = core.mutate(body.action,body.payload || {});
    result.csrf = core.token(); send(200,result);
  } catch (error) {
    var message = String(error && error.message || 'Management failure');
    send(/revision|conflict|stale/i.test(message) ? 409 : 400,{error:message.slice(0,400)});
  }
}());
