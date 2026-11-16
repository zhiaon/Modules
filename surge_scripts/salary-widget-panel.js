/* 今日入账 · Surge generic Panel. Local calculation only; no I/O.
 * $argument: KEY=value|KEY=value. Dates use the device's local timezone.
 * Overnight shifts before/at end belong to their starting date. During the
 * daytime gap the upcoming shift is shown. Monthly totals exclude that date.
 */
(function () {
  'use strict';
  const DEFAULTS = {
    WORK_START: '-', LUNCH_START: '-', LUNCH_END: '-',
    WORK_END: '-', DINNER_START: '-', DINNER_END: '-', REST_DAYS: '-', CUSTOM_DAYS: '-', HOURLY_WAGE: '-'
  };
  const pad = n => String(n).padStart(2, '0');
  const empty = s => s === '' || s === '-';
  const LABELS = { WORK_START: '上班时间', WORK_END: '下班时间',
    LUNCH_START: '午饭加休息开始', LUNCH_END: '午饭加休息结束',
    DINNER_START: '晚饭加休息开始', DINNER_END: '晚饭加休息结束', REST_DAYS: '本月休息日',
    CUSTOM_DAYS: '自定义记录', HOURLY_WAGE: '每小时工资' };
  const fail = message => { throw new Error(message.replace(/[A-Z_]+/g, key => LABELS[key] || key)); };
  const money = cents => (cents / 100).toFixed(2);
  const cents = value => {
    const parts = String(value).split('e');
    return Math.round(Number(`${parts[0]}e${Number(parts[1] || 0) + 2}`));
  };
  const md = date => `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
  const hm = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  function parseTime(value, key) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.replace(/：/g, ':'));
    if (!match || +match[1] > 23 || +match[2] > 59) fail(`${key} 请填写有效时间，如 09:00（00:00–23:59）`);
    return +match[1] * 60 + +match[2];
  }
  function number(value, key, maximum) {
    if (!/^\d+(?:\.\d+)?$/.test(value)) fail(`${key} 必须是非负数字`);
    const n = Number(value);
    if (!Number.isFinite(n) || n > maximum) fail(`${key} 超出范围（0–${maximum}）`);
    return n;
  }
  function day(value, key) {
    if (!/^\d{1,2}$/.test(value) || +value < 1 || +value > 31) fail(`${key} 日期号须为 1–31`);
    return +value;
  }
  function parseArguments(argument) {
    if (argument != null && typeof argument !== 'string') fail('脚本参数须为 KEY=值|KEY=值');
    const values = Object.assign({}, DEFAULTS);
    const seen = new Set();
    if (argument && argument.trim()) argument.split('|').forEach(part => {
      const match = /^\s*([A-Z_]+)\s*=([\s\S]*)$/.exec(part);
      if (!match) fail('参数格式错误，请使用 KEY=值，并用 | 分隔');
      const key = match[1];
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) fail(`未知参数 ${key}`);
      if (seen.has(key)) fail(`参数 ${key} 重复`);
      seen.add(key);
      values[key] = match[2].trim();
    });
    const missing = ['WORK_START', 'WORK_END', 'HOURLY_WAGE'].filter(key => empty(values[key]));
    if (missing.length) {
      const error = new Error(`请先填写：${missing.map(key => LABELS[key]).join('、')}。\n位置：Surge → 模块 → 今日入账 → 参数设置\n午饭加休息、晚饭加休息、休息日及自定义记录按需填写。\n尚未配置，不计算或显示收入。`);
      error.code = 'UNCONFIGURED';
      throw error;
    }
    const start = parseTime(values.WORK_START, 'WORK_START');
    let end = parseTime(values.WORK_END, 'WORK_END');
    if (end <= start) end += 1440; // Same start/end means a 24-hour shift, as in the source.
    const breaks = [];
    for (const [prefix, label] of [['LUNCH', '午饭加休息'], ['DINNER', '晚饭加休息']]) {
      const sv = values[prefix + '_START'], ev = values[prefix + '_END'];
      if (empty(sv) && empty(ev)) continue;
      if (empty(sv) || empty(ev)) fail(`${label}开始和结束须同时填写，或都不填`);
      let bs = parseTime(sv, prefix + '_START'), be = parseTime(ev, prefix + '_END');
      if (bs === be) fail(`${label}开始与结束不能相同`);
      if (be < bs) be += 1440;
      if (bs < start) { bs += 1440; be += 1440; }
      breaks.push({ start: bs, end: be, label });
    }
    const rest = new Set();
    if (!empty(values.REST_DAYS)) values.REST_DAYS.split(/[,，、;；\s]+/).forEach(token => {
      if (!token) fail('REST_DAYS 存在空日期号');
      rest.add(day(token, 'REST_DAYS'));
    });
    const custom = Object.create(null);
    if (!empty(values.CUSTOM_DAYS)) values.CUSTOM_DAYS.split(/[;；\n]+/).forEach(part => {
      const fields = part.trim().replace(/：/g, ':').split(':').map(s => s.trim());
      if (fields.length !== 3) fail('CUSTOM_DAYS 格式须为 日:小时:金额;日:小时:金额');
      const d = day(fields[0], 'CUSTOM_DAYS');
      const hours = number(fields[1], '自定义工时', 24);
      const amount = cents(number(fields[2], '自定义金额', 1000000000));
      custom[d] = { hours, cents: amount }; // Duplicate dates: last record wins, as in the source.
    });
    return { start, end, breaks, rest, custom,
      wage: number(values.HOURLY_WAGE, 'HOURLY_WAGE', 1000000000) };
  }

  function shiftFor(config, date) {
    const at = minutes => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, minutes).getTime();
    const start = at(config.start), end = at(config.end);
    const breaks = (config.breaks || []).map(b => ({
      start: Math.max(start, at(b.start)), end: Math.min(end, at(b.end)), label: b.label
    })).filter(b => b.end > b.start).sort((a, b) => a.start - b.start);
    const merged = [];
    for (const b of breaks) {
      const last = merged[merged.length - 1];
      if (last && b.start <= last.end) { last.end = Math.max(last.end, b.end); last.label += ' / ' + b.label; }
      else merged.push({ ...b });
    }
    const hours = (end - start - merged.reduce((sum, b) => sum + b.end - b.start, 0)) / 3600000;
    return { start, end, breaks, merged, hours };
  }

  function calculate(config, now) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('当前时间无效');
    const current = now.getTime();
    let workDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let shift = shiftFor(config, workDate);
    if (config.end >= 1440 && current < shift.start) {
      const previous = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const previousShift = shiftFor(config, previous);
      if (current <= previousShift.end) { workDate = previous; shift = previousShift; }
    }
    const d = workDate.getDate(), custom = config.custom[d] || null;
    const rest = config.rest.has(d) && !custom;
    const workedTo = Math.max(shift.start, Math.min(current, shift.end));
    const paused = shift.merged.reduce((sum, b) => sum + Math.max(0, Math.min(workedTo, b.end) - b.start), 0);
    const elapsed = (workedTo - shift.start - paused) / 3600000;
    const activeBreak = shift.merged.find(b => current >= b.start && current < b.end);
    const nextBreak = shift.merged.find(b => current < b.start);
    let status, target = null, countdownLabel = '';
    if (rest) status = '今日休息';
    else if (current < shift.start) { status = '未上班'; target = shift.start; countdownLabel = '距上班'; }
    else if (current >= shift.end) status = '已下班';
    else if (activeBreak) { status = activeBreak.label + '中'; target = activeBreak.end; countdownLabel = '距恢复计薪'; }
    else { status = '赚钱中'; target = nextBreak ? nextBreak.start : shift.end; countdownLabel = nextBreak ? '距' + nextBreak.label : '距下班'; }
    let monthCents = 0, monthHours = 0;
    for (let n = 1; n < d; n++) {
      if (config.custom[n]) {
        monthCents += config.custom[n].cents; monthHours += config.custom[n].hours;
      } else if (!config.rest.has(n)) {
        const past = shiftFor(config, new Date(workDate.getFullYear(), workDate.getMonth(), n));
        monthCents += cents(past.hours * config.wage); monthHours += past.hours;
      }
    }
    const minutes = target === null ? 0 : Math.max(0, Math.floor((target - current) / 60000));
    return { now, workDate, shift, status, countdownLabel, activeBreak, nextBreak,
      countdown: target === null ? '' : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
      custom: !!custom, rest, hours: custom ? custom.hours : rest ? 0 : elapsed,
      todayCents: custom ? custom.cents : rest ? 0 : cents(elapsed * config.wage),
      monthCents, monthHours, wage: config.wage, overnight: config.end >= 1440 };
  }
  function render(state) {
    const s = state, sh = s.shift;
    const cutoff = s.workDate.getDate() === 1 ? '月初暂无历史' : `截至${pad(s.workDate.getMonth() + 1)}/${pad(s.workDate.getDate() - 1)}`;
    const duration = hours => {
      const minutes = Math.max(0, Math.floor(hours * 60 + 1e-7));
      return `${Math.floor(minutes / 60)}小时${pad(minutes % 60)}分`;
    };
    const remain = target => duration((target - s.now.getTime()) / 3600000);
    const status = s.custom ? '自定义记录（今日金额固定）' : s.rest ? '今日休息（不计薪）' : s.status === '赚钱中' ? '工作中（正在计薪）' : s.activeBreak ? `${s.activeBreak.label}中（暂停计薪）` : s.status === '未上班' ? '尚未上班（收入为零）' : '已下班（今日计薪结束）';
    let countdown;
    if (s.custom) countdown = '记录规则：采用填写金额，不随时间增加';
    else if (s.rest) countdown = '今日安排：休息，无工作倒计时';
    else if (s.now.getTime() < sh.start) countdown = `距离上班：${remain(sh.start)}`;
    else if (s.now.getTime() >= sh.end) countdown = '今日安排：工作已结束';
    else {
      countdown = `距离下班：${remain(sh.end)}`;
      if (s.activeBreak) countdown += `\n${s.activeBreak.label}剩余：${remain(s.activeBreak.end)}`;
      else if (s.nextBreak) countdown += `\n距离${s.nextBreak.label}：${remain(s.nextBreak.start)}`;
    }
    const range = `${hm(new Date(sh.start))}–${s.overnight ? '次日' : ''}${hm(new Date(sh.end))}`;
    const breakText = ['午饭加休息', '晚饭加休息'].map(label => {
      const b = sh.breaks.find(item => item.label === label);
      const relativeTime = ms => `${new Date(ms).getDate() !== s.workDate.getDate() ? '次日' : ''}${hm(new Date(ms))}`;
      return b ? `${label}\n${relativeTime(b.start)}–${relativeTime(b.end)}（不计薪）` : `${label}：未设置，不扣时`;
    }).join('\n');
    const progress = !s.rest && sh.hours > 0 ? Math.max(0, Math.min(1, s.hours / sh.hours)) : 0;
    const filled = Math.floor(progress * 10);
    const bar = `进度 ${'■'.repeat(filled)}${'□'.repeat(10 - filled)} ${Math.floor(progress * 100)}%`;
    const expected = s.custom ? `今日记录金额：¥${money(s.todayCents)}` : `今日预计总额：¥${money(s.rest ? 0 : cents(sh.hours * s.wage))}`;
    const hours = s.custom ? `记录工时：${duration(s.hours)}（手动填写）` : `已计薪工时：${duration(s.hours)}\n今日计划工时：${duration(s.rest ? 0 : sh.hours)}（已扣已设休息）`;
    const lines = [
      `工作日期　${s.workDate.getFullYear()}/${md(s.workDate)}${s.overnight ? '（开工日）' : ''}`,
      '',
      '【当前状态】', status, countdown, bar,
      '',
      '【今日收入】',
      `今日${s.custom ? '记录' : '已赚'}　¥${money(s.todayCents)}`, expected,
      hours.replace('（已扣已设休息）', ''),
      `每小时工资　¥${s.wage.toFixed(2)}`,
      '',
      '【作息安排】', `上下班　${range}`, breakText,
      '',
      '【本月累计】',
      `历史累计　¥${money(s.monthCents)}`,
      `统计截止　${cutoff.replace('截至', '')}（不含本班）`,
      `历史工时　${duration(s.monthHours)}`,
      `含本班合计　¥${money(s.monthCents + s.todayCents)}`,
      '',
      `更新于 ${hm(s.now)} · 金额为估算`
    ];
    return {
      title: `${s.overnight ? `${md(s.workDate)}班次` : '今日入账'} ¥${money(s.todayCents)} · ${s.custom ? '自定义' : '估算'}`,
      icon: 'banknote', 'icon-color': '#34C759',
      content: lines.join('\n')
    };
  }
  function panel(argument, now) {
    try { return render(calculate(parseArguments(argument), now === undefined ? new Date() : now)); }
    catch (error) { return { title: error.code === 'UNCONFIGURED' ? '今日入账 · 待配置' : '今日入账 · 参数错误', content: error.message, style: error.code === 'UNCONFIGURED' ? 'info' : 'error' }; }
  }
  const api = { parseArguments, shiftFor, calculate, render, panel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof $done === 'function') $done(panel(typeof $argument === 'undefined' ? '' : $argument));
}());
