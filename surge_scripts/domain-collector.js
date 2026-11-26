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

/* Domain Collector v0.1 — rule script entry (Surge SCRIPT rule).
 *
 * Hot path. The core is appended above this block by build.py; keeping the
 * entry last means the guard below can reference the bundled symbol directly.
 *
 * Contract compliance:
 *  - reads ONLY $request.hostname, $request.protocol, $request.destPort
 *  - never performs network I/O, never calls $httpClient/$httpAPI
 *  - never sorts and never scans the whole catalog
 *  - always calls $done({matched:false}) exactly once, success or failure
 *  - a SCRIPT rule cannot be pre-matching, so this runs only where the user
 *    placed the rule; it never changes routing because it never matches
 *
 * Storage adapter rule: exceptions from $persistentStore are NOT converted to
 * null. A failed read must propagate to the core as a read error, otherwise an
 * unreadable root would look like an empty namespace and get overwritten.
 */
(function () {
  'use strict';

  var done = false;
  function finish() {
    if (done) return;
    done = true;
    try { $done({ matched: false }); } catch (e) { /* first call wins; ignore */ }
  }

  try {
    if (typeof $request === 'undefined' || !$request) { finish(); return; }

    var Core = null;
    if (typeof DomainCollectorCore !== 'undefined' && DomainCollectorCore) Core = DomainCollectorCore;
    else if (typeof globalThis !== 'undefined' && globalThis && globalThis.DomainCollectorCore) Core = globalThis.DomainCollectorCore;
    else if (typeof module !== 'undefined' && module && module.exports && typeof module.exports.create === 'function') Core = module.exports;
    if (!Core || typeof Core.create !== 'function') { finish(); return; }

    var hostname = typeof $request.hostname === 'string' ? $request.hostname : null;
    if (!hostname) { finish(); return; }

    /* Cheap pre-filters only. Single-label hosts are legal hostnames, so they
     * are NOT filtered here; the core decides. The manager's own host is
     * skipped before any KV access to avoid a self-observation loop. */
    var lowerHost = hostname.toLowerCase();
    var stripped = lowerHost;
    while (stripped.length && stripped.charAt(stripped.length - 1) === '.') stripped = stripped.slice(0, -1);
    if (stripped === 'domain-collector.invalid' ||
        (stripped.length > 25 && stripped.slice(-25) === '.domain-collector.invalid')) { finish(); return; }

    var store = {
      /* throws on failure, exactly like $persistentStore does */
      read: function (key) { return $persistentStore.read(key); },
      write: function (value, key) { return $persistentStore.write(value, key); }
    };

    var core = Core.create(store, function () { return Date.now(); });
    core.collect({
      hostname: hostname,
      protocol: typeof $request.protocol === 'string' ? $request.protocol : null,
      destPort: typeof $request.destPort === 'number' ? $request.destPort : null
    });
  } catch (e) {
    /* Swallow so traffic is never disturbed. Never log e.message: it can carry
     * a hostname or a key name. A constant tag keeps the log line PII-free. */
    try { console.log('[domain-collector] request-path error (details suppressed)'); } catch (e2) { /* ignore */ }
  } finally {
    finish();
  }
})();
