// 팀장 일일보고 대시보드
// data.enc.js 의 암호화 데이터를 비밀번호로 풀고 화면을 그린다. 외부 라이브러리 없음.
(function () {
  'use strict';

  // ============================================================ 공통 도우미

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const PW_KEY = 'teamDailyDashboard.pw';

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* 저장 불가 환경은 무시 */ }
  }
  function storageRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* 무시 */ }
  }

  function parseIso(iso) { return new Date(iso + 'T00:00:00Z'); }
  function isoOf(d) { return d.toISOString().slice(0, 10); }
  function addDays(iso, n) {
    const d = parseIso(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return isoOf(d);
  }
  function weekStart(iso) {
    const d = parseIso(iso);
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    return isoOf(d);
  }
  function weekLabel(monday) {
    const thu = parseIso(addDays(monday, 3));
    return (thu.getUTCMonth() + 1) + '월 ' + Math.ceil(thu.getUTCDate() / 7) + '주';
  }
  function monthEnd(ym) {
    const y = +ym.slice(0, 4);
    const m = +ym.slice(5, 7);
    return isoOf(new Date(Date.UTC(y, m, 0)));
  }
  function prevMonth(ym) {
    const y = +ym.slice(0, 4);
    const m = +ym.slice(5, 7);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return isoOf(d).slice(0, 7);
  }
  function wd(iso) { return WD[parseIso(iso).getUTCDay()]; }
  function md(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function mdw(iso) { return md(iso) + '(' + wd(iso) + ')'; }
  function monthLabel(ym) { return (+ym.slice(5, 7)) + '월'; }
  function weekRangeText(monday) { return md(monday) + '~' + md(addDays(monday, 6)); }
  function pct(a, b) {
    if (!b) return '-';
    return Math.round((a / b) * 100) + '%';
  }

  // ============================================================ 복호화

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function decrypt(payload, password) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64ToBytes(payload.salt), iterations: payload.iter, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(payload.iv) }, key, b64ToBytes(payload.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ============================================================ 데이터 준비

  const S = {};
  const KIND_LABEL = { report: '일일보고', minutes: '회의록', directive: '지시/공지', chat: '대화', ack: '응답', media: '사진/파일' };

  function prepare(bundle) {
    S.bundle = bundle;
    S.members = bundle.members.slice().sort((a, b) => a.order - b.order);
    S.memberById = new Map(S.members.map((m) => [m.id, m]));
    S.reporters = S.members.filter((m) => m.role === 'member');
    S.summaries = bundle.summaries || { weeks: {}, months: {} };
    S.summaries.weeks = S.summaries.weeks || {};
    S.summaries.months = S.summaries.months || {};

    S.msgs = bundle.messages.map((m) => {
      const out = Object.assign({}, m);
      out.w = weekStart(m.d);
      out.mo = m.d.slice(0, 7);
      out.noise = m.k === 'ack' || m.k === 'media';
      return out;
    });

    // 대화명이 members.json 에 없는 사람
    for (const m of S.msgs) {
      if (!S.memberById.has(m.p)) {
        const name = m.p.replace(/^unknown:/, '');
        const pseudo = { id: m.p, name: name, title: '', team: '', role: 'support', order: 99 };
        S.memberById.set(m.p, pseudo);
        S.members.push(pseudo);
      }
    }

    // 날짜별 보고자
    S.reportsByDay = new Map();
    for (const m of S.msgs) {
      if (m.k !== 'report') continue;
      if (!S.reportsByDay.has(m.d)) S.reportsByDay.set(m.d, new Map());
      const dayMap = S.reportsByDay.get(m.d);
      if (!dayMap.has(m.p)) dayMap.set(m.p, []);
      dayMap.get(m.p).push(m);
    }
    const minReports = bundle.minReportsForWorkday || 3;
    S.workdays = [];
    for (const [day, dayMap] of S.reportsByDay) {
      if (dayMap.size >= minReports) S.workdays.push(day);
    }
    S.workdays.sort();
    S.workdaySet = new Set(S.workdays);

    const daySet = new Set(S.msgs.map((m) => m.d));
    S.allDays = Array.from(daySet).sort();
    S.weeks = Array.from(new Set(S.msgs.map((m) => m.w))).sort();
    S.months = Array.from(new Set(S.msgs.map((m) => m.mo))).sort();
    S.anchor = bundle.range.last;

    S.items = [];
    for (const m of S.msgs) {
      if (!m.it) continue;
      for (const it of m.it) S.items.push({ y: it.y, x: it.x, to: it.to || [], ds: it.ds || [], r: !!it.r, msg: m });
    }

    S.keywords = (bundle.keywords || []).map((k, idx) => ({
      idx: idx,
      name: k.name,
      group: k.group || '기타',
      aliases: k.aliases || [],
      regex: keywordRegex(k),
    }));
  }

  function keywordRegex(k) {
    const terms = [k.name].concat(k.aliases || []);
    const parts = terms.map((t) => {
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isAscii = /^[A-Za-z0-9_\- ]+$/.test(t);
      if (isAscii) return '(?<![A-Za-z])' + escaped + '(?![A-Za-z])';
      return escaped;
    });
    return new RegExp(parts.join('|'), k.caseSensitive ? 'g' : 'gi');
  }

  function person(id) {
    return S.memberById.get(id) || { id: id, name: String(id).replace(/^unknown:/, ''), team: '', title: '' };
  }
  function whoHtml(id, withTeam) {
    const p = person(id);
    let html = '<a class="who" href="#member/' + encodeURIComponent(id) + '">' + esc(p.name) + '</a>';
    if (withTeam !== false && p.team) html += ' <span class="team">' + esc(p.team) + '</span>';
    return html;
  }
  function dayLink(iso) {
    return '<a href="#day/' + iso + '">' + mdw(iso) + '</a>';
  }

  function inPeriod(day, per) { return day >= per.start && day <= per.end; }

  // ============================================================ 기간 선택

  function presets() {
    const a = S.anchor;
    const lastWork = S.workdays.length ? S.workdays[S.workdays.length - 1] : a;
    const tw = weekStart(a);
    const lw = addDays(tw, -7);
    const tm = a.slice(0, 7);
    const lm = prevMonth(tm);
    return [
      { id: 'day', label: '최근 보고일 ' + mdw(lastWork), start: lastWork, end: lastWork },
      { id: 'thisweek', label: '이번 주', start: tw, end: addDays(tw, 6) },
      { id: 'lastweek', label: '지난 주', start: lw, end: addDays(lw, 6) },
      { id: 'thismonth', label: '이번 달', start: tm + '-01', end: monthEnd(tm) },
      { id: 'lastmonth', label: '지난 달', start: lm + '-01', end: monthEnd(lm) },
      { id: 'all', label: '전체', start: S.allDays[0], end: a },
    ];
  }

  function resolvePeriod(params, defaultId) {
    if (params.from && params.to) {
      const start = params.from <= params.to ? params.from : params.to;
      const end = params.from <= params.to ? params.to : params.from;
      return { id: 'custom', label: md(start) + '~' + md(end), start: start, end: end };
    }
    const list = presets();
    const wanted = params.p || defaultId;
    for (const p of list) {
      if (p.id === wanted) return p;
    }
    return list[1];
  }

  function periodPicker(per) {
    const buttons = presets().map((p) => {
      const on = p.id === per.id ? ' on' : '';
      return '<button type="button" class="' + on + '" data-preset="' + p.id + '">' + esc(p.label) + '</button>';
    }).join('');
    return '<div class="toolbar no-print">' +
      '<div class="seg">' + buttons + '</div>' +
      '<input type="date" data-from value="' + per.start + '" aria-label="시작일">' +
      '<span class="muted">~</span>' +
      '<input type="date" data-to value="' + per.end + '" aria-label="종료일">' +
      '</div>';
  }

  function bindPeriodPicker(root, view, args, extraParams) {
    $$('[data-preset]', root).forEach((btn) => {
      btn.addEventListener('click', () => go(view, args, Object.assign({}, extraParams, { p: btn.dataset.preset })));
    });
    const from = $('[data-from]', root);
    const to = $('[data-to]', root);
    const apply = () => {
      if (from.value && to.value) go(view, args, Object.assign({}, extraParams, { from: from.value, to: to.value }));
    };
    if (from) from.addEventListener('change', apply);
    if (to) to.addEventListener('change', apply);
  }

  // ============================================================ 라우터

  function parseHash() {
    const h = location.hash.replace(/^#/, '');
    const qi = h.indexOf('?');
    const path = qi >= 0 ? h.slice(0, qi) : h;
    const query = qi >= 0 ? h.slice(qi + 1) : '';
    const parts = path.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
    const params = {};
    new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
    return { view: parts[0] || 'brief', args: parts.slice(1), params: params };
  }

  function buildHash(view, args, params) {
    const path = [view].concat(args || []).map((p) => encodeURIComponent(p)).join('/');
    const q = new URLSearchParams();
    Object.keys(params || {}).forEach((k) => {
      const v = params[k];
      if (v !== '' && v != null) q.set(k, v);
    });
    const qs = q.toString();
    return '#' + path + (qs ? '?' + qs : '');
  }

  function go(view, args, params) {
    const hash = buildHash(view, args, params);
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  let lastView = '';
  function render() {
    const r = parseHash();
    $$('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.view === r.view));
    const root = $('#view');
    const renderers = {
      brief: renderBrief,
      day: renderDay,
      member: renderMember,
      summary: renderSummary,
      project: renderProject,
      status: renderStatus,
      search: renderSearch,
      guide: renderGuide,
    };
    const fn = renderers[r.view] || renderBrief;
    fn(root, r.args, r.params);
    if (r.view !== lastView) window.scrollTo(0, 0);
    lastView = r.view;
  }

  // ============================================================ 공통 조각

  function msgCard(m, opts) {
    const o = opts || {};
    const posted = m.pd ? '게시 ' + md(m.pd) + ' ' + m.t : m.t;
    let body = esc(m.x.replace(/\n{3,}/g, '\n\n').trim());
    if (o.highlight) body = highlightHtml(body, o.highlight);
    const clamp = o.clamp && m.x.length > 600;
    let kw = '';
    if (m.kw && m.kw.length && o.showKeywords !== false) {
      kw = '<div class="msg-foot">' + m.kw.map((idx) => {
        const k = S.keywords[idx];
        if (!k) return '';
        return '<a class="pill" href="#project/' + encodeURIComponent(k.name) + '">' + esc(k.name) + '</a>';
      }).join('') + '</div>';
    }
    return '<article class="msg" id="m' + m.i + '">' +
      '<div class="msg-head"><div>' + whoHtml(m.p) + ' <span class="kind">' + (KIND_LABEL[m.k] || m.k) + '</span></div>' +
      '<div class="small muted">' + (o.showDate ? dayLink(m.d) + ' ' : '') + esc(posted) + '</div></div>' +
      '<div class="msg-body' + (clamp ? ' clamp' : '') + '">' + body + '</div>' +
      (clamp ? '<div class="msg-more"><button class="btn small" data-unclamp>전체 보기</button></div>' : '') +
      kw + '</article>';
  }

  function bindUnclamp(root) {
    $$('[data-unclamp]', root).forEach((b) => {
      b.addEventListener('click', () => {
        const art = b.closest('.msg');
        $('.msg-body', art).classList.remove('clamp');
        b.parentElement.remove();
      });
    });
  }

  // 이미 escape 된 HTML 안에서 검색어를 표시한다 (태그는 없으므로 단순 치환)
  function highlightHtml(escapedText, terms) {
    const list = (Array.isArray(terms) ? terms : [terms]).filter((t) => t && t.length);
    if (!list.length) return escapedText;
    const pattern = list.map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const re = new RegExp('(' + pattern + ')', 'gi');
    return escapedText.replace(re, '<mark>$1</mark>');
  }

  function itemRow(it, opts) {
    const o = opts || {};
    const m = it.msg;
    let meta = whoHtml(m.p) + '<span>' + dayLink(m.d) + '</span>';
    if (it.y === 'request' && it.to.length) {
      meta += '<span>요청 대상</span>' + it.to.map((id) => whoHtml(id, false)).join(', ');
    }
    if (o.kind) meta += '<span class="kind">' + (KIND_LABEL[m.k] || m.k) + '</span>';
    return '<li><div>' + esc(it.x) + '</div><div class="item-meta">' + meta + '</div></li>';
  }

  function listOrEmpty(rows, emptyText) {
    if (!rows.length) return '<div class="empty">' + esc(emptyText) + '</div>';
    return '<ul class="plain">' + rows.join('') + '</ul>';
  }

  function statusFlag(status) {
    if (!status) return '';
    let cls = 'info';
    if (status === '진행중') cls = 'warning';
    if (status === '해결') cls = 'good';
    return ' <span class="flag ' + cls + '">' + esc(status) + '</span>';
  }

  function renderAiSummary(sum, type, opts) {
    const o = opts || {};
    if (!sum) return '<div class="empty">AI 요약이 아직 없습니다. 다음 업데이트 때 작성됩니다.</div>';
    let html = '<div class="ai-box">';
    html += '<div><span class="ai-tag">AI 요약</span><span class="small muted">' + esc(o.label || '') + '</span></div>';
    html += '<div class="headline">' + esc(sum.headline || '') + '</div>';
    if (sum.overview) html += '<p class="overview">' + esc(sum.overview) + '</p>';

    const expected = type === 'week' ? S.bundle.counts.weeks[o.key] : S.bundle.counts.months[o.key];
    const basis = sum.basis && sum.basis.count;
    if (basis && expected && basis !== expected) {
      const diff = expected - basis;
      html += '<div class="stale">요약 작성 이후 메시지 ' + (diff > 0 ? diff + '건이 추가' : Math.abs(diff) + '건이 변경') + '되었습니다. 다음 업데이트 때 다시 요약됩니다.</div>';
    }

    const sub = (title, inner) => '<div class="ai-sub"><h4>' + title + '</h4>' + inner + '</div>';
    const simpleList = (arr) => '<ul class="dots">' + arr.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>';

    if (type === 'week' && sum.questions && sum.questions.length) html += sub('회의에서 확인할 질문', simpleList(sum.questions));
    if (type === 'month' && sum.highlights && sum.highlights.length) html += sub('주요 성과', simpleList(sum.highlights));
    if (sum.issues && sum.issues.length) {
      const rows = sum.issues.map((x) => {
        const owner = x.owner ? ' <span class="small muted">담당</span> ' + whoHtml(x.owner, false) : '';
        return '<li>' + esc(x.text) + statusFlag(x.status) + owner + '</li>';
      });
      html += sub('주요 이슈', '<ul class="dots">' + rows.join('') + '</ul>');
    }
    if (sum.directives && sum.directives.length) html += sub('지시 및 결정 사항', simpleList(sum.directives));
    if (type === 'week' && sum.upcoming && sum.upcoming.length) {
      const rows = sum.upcoming.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((u) => '<li><b class="num">' + (u.date ? mdw(u.date) : '') + '</b> ' + esc(u.text) + '</li>');
      html += sub('예정 일정', '<ul class="dots">' + rows.join('') + '</ul>');
    }
    if (type === 'month' && sum.carryOver && sum.carryOver.length) html += sub('다음 달로 이어지는 과제', simpleList(sum.carryOver));
    if (!o.hideMembers && sum.byMember && sum.byMember.length) {
      const rows = sum.byMember.map((b) => '<li><div>' + esc(b.text) + '</div><div class="item-meta">' + whoHtml(b.id) + '</div></li>');
      const inner = '<ul class="plain">' + rows.join('') + '</ul>';
      if (o.foldMembers) {
        html += '<details class="fold ai-sub"><summary><span class="grow"><b>팀별 요약</b></span><span class="muted small">' + sum.byMember.length + '명</span></summary><div class="fold-body">' + inner + '</div></details>';
      } else {
        html += sub('팀별 요약', inner);
      }
    }
    html += '</div>';
    return html;
  }

  function barsChart(points, opts) {
    const o = opts || {};
    const max = Math.max(1, ...points.map((p) => p.value));
    const cols = points.map((p) => {
      const h = Math.round((p.value / max) * 100);
      const zero = p.value === 0 ? ' zero' : '';
      const tip = esc(p.tip || (p.label + ': ' + p.value));
      const link = p.href ? ' data-href="' + esc(p.href) + '" style="cursor:pointer"' : '';
      return '<div class="bar-col" data-tip="' + tip + '"' + link + '>' +
        (p.value && o.showValues !== false ? '<span class="v">' + p.value + '</span>' : '') +
        '<div class="bar' + zero + '" style="height:' + h + '%"></div></div>';
    }).join('');
    const axis = points.map((p) => '<span>' + esc(p.short || '') + '</span>').join('');
    return '<div class="bars">' + cols + '</div><div class="bar-axis">' + axis + '</div>';
  }

  function bindBarLinks(root) {
    $$('.bar-col[data-href]', root).forEach((el) => {
      el.addEventListener('click', () => { location.hash = el.dataset.href; });
    });
  }

  function submissionStats(per, memberIds) {
    const days = S.workdays.filter((d) => inPeriod(d, per));
    const result = new Map();
    for (const id of memberIds) {
      let done = 0;
      const missing = [];
      for (const d of days) {
        const dayMap = S.reportsByDay.get(d);
        if (dayMap && dayMap.has(id)) done++;
        else missing.push(d);
      }
      result.set(id, { done: done, total: days.length, missing: missing });
    }
    return { days: days, byMember: result };
  }

  // ============================================================ 1. 회의 브리핑

  function renderBrief(root, args, params) {
    const per = resolvePeriod(params, 'thisweek');
    const msgs = S.msgs.filter((m) => inPeriod(m.d, per));
    const reports = msgs.filter((m) => m.k === 'report');
    const directives = msgs.filter((m) => m.k === 'directive');
    const minutes = msgs.filter((m) => m.k === 'minutes');
    const items = S.items.filter((it) => inPeriod(it.msg.d, per));
    const requests = items.filter((it) => it.y === 'request');
    const remarks = items.filter((it) => it.y === 'issue' && it.r);
    const issueWords = items.filter((it) => it.y === 'issue' && !it.r);
    const attendance = items.filter((it) => it.y === 'leave' || it.y === 'trip');
    const sub = submissionStats(per, S.reporters.map((m) => m.id));
    let done = 0;
    let total = 0;
    sub.byMember.forEach((v) => { done += v.done; total += v.total; });

    let html = '<div class="view-head"><div><h2>회의 브리핑</h2><div class="sub">' +
      esc(per.label) + ' (' + mdw(per.start) + ' ~ ' + mdw(per.end) + ')</div></div>' +
      '<div class="toolbar no-print"><button class="btn small" id="print-btn">인쇄 / PDF</button></div></div>';
    html += periodPicker(per);
    html += '<div class="section-gap"></div>';

    html += '<div class="kpis">' +
      kpi('일일보고', reports.length, '건', '보고일 ' + sub.days.length + '일') +
      kpi('보고 제출률', total ? Math.round((done / total) * 100) : '-', total ? '%' : '', done + ' / ' + total + ' (보고일 기준)') +
      kpi('특이사항', remarks.length, '건', '보고자가 특이사항으로 적은 줄') +
      kpi('협조 요청', requests.length, '건', '다른 팀장 이름이 들어간 요청') +
      kpi('지시/회의록', directives.length + minutes.length, '건', '지시 ' + directives.length + ', 회의록 ' + minutes.length) +
      '</div>';

    // AI 요약
    let aiHtml = '';
    if (per.id === 'thismonth' || per.id === 'lastmonth') {
      const key = per.start.slice(0, 7);
      aiHtml = renderAiSummary(S.summaries.months[key], 'month', { key: key, label: monthLabel(key) + ' 월간', foldMembers: true });
    } else {
      const weeks = S.weeks.filter((w) => w <= per.end && addDays(w, 6) >= per.start);
      if (weeks.length && weeks.length <= 2) {
        aiHtml = weeks.slice().reverse().map((w) => renderAiSummary(S.summaries.weeks[w], 'week', {
          key: w, label: weekLabel(w) + ' (' + weekRangeText(w) + ')', foldMembers: true,
        })).join('');
      } else if (weeks.length) {
        aiHtml = '<div class="empty">기간이 길어 주간 요약은 <a href="#summary/week">주간/월간 요약</a> 화면에서 확인하세요.</div>';
      } else {
        aiHtml = '<div class="empty">이 기간에는 메시지가 없습니다.</div>';
      }
    }
    html += '<section class="card"><div class="card-head"><h3>AI 요약</h3></div>' + aiHtml + '</section>';
    html += '<div class="section-gap"></div>';

    // 지시사항, 협조요청 / 특이사항, 일정
    const directiveRows = directives.concat(minutes).sort((a, b) => (a.d + a.t < b.d + b.t ? 1 : -1)).map((m) => {
      const text = m.k === 'minutes' ? m.x.split('\n').filter((l) => l.trim()).slice(0, 6).join('\n') + (m.x.split('\n').length > 6 ? '\n...' : '') : m.x;
      return '<li><div style="white-space:pre-wrap">' + esc(text) + '</div><div class="item-meta">' + whoHtml(m.p) +
        '<span>' + dayLink(m.d) + ' ' + esc(m.t) + '</span><span class="kind">' + KIND_LABEL[m.k] + '</span>' +
        (m.k === 'minutes' ? '<a href="#day/' + m.d + '">전문 보기</a>' : '') + '</div></li>';
    });

    const scheduleRows = upcomingSchedule(per);

    html += '<div class="grid two">';
    html += '<section class="card"><div class="card-head"><h3>사업부장 지시 / 회의록</h3><span class="count">' + directiveRows.length + '건</span></div>' +
      listOrEmpty(directiveRows, '이 기간에 지시나 회의록이 없습니다.') + '</section>';
    html += '<section class="card"><div class="card-head"><h3>특이사항</h3><span class="count">' + remarks.length + '건</span></div>' +
      listOrEmpty(remarks.map((it) => itemRow(it)), '보고에 적힌 특이사항이 없습니다.') + '</section>';
    html += '<section class="card"><div class="card-head"><h3>팀 간 협조 요청</h3><span class="count">' + requests.length + '건</span></div>' +
      listOrEmpty(requests.map((it) => itemRow(it, { kind: true })), '이 기간에 다른 팀장을 지목한 요청이 없습니다.') + '</section>';
    html += '<section class="card"><div class="card-head"><h3>보고에 나온 일정</h3><span class="count">' + mdw(per.start) + ' 이후 3주</span></div>' +
      scheduleRows + '</section>';
    html += '</div><div class="section-gap"></div>';

    // 보고 누락, 근태
    const missingRows = [];
    sub.byMember.forEach((v, id) => {
      if (!v.missing.length) return;
      missingRows.push('<li><div>' + whoHtml(id) + ' <span class="muted small">' + v.missing.length + '일</span></div><div class="item-meta">' +
        v.missing.map((d) => dayLink(d)).join(' ') + '</div></li>');
    });
    html += '<div class="grid two">';
    html += '<section class="card"><div class="card-head"><h3>보고가 없는 날</h3><span class="count">보고일 ' + sub.days.length + '일 기준</span></div>' +
      listOrEmpty(missingRows, '모든 보고일에 전원 보고가 올라왔습니다.') +
      '<p class="small muted" style="margin-top:8px">연차, 출장, 회의록으로 대신한 경우도 포함됩니다. 근태 목록과 같이 보세요.</p></section>';
    html += '<section class="card"><div class="card-head"><h3>근태 / 출장</h3><span class="count">' + attendance.length + '건</span></div>' +
      listOrEmpty(attendance.map((it) => itemRow(it)), '보고에 적힌 근태나 출장 내용이 없습니다.') + '</section>';
    html += '</div><div class="section-gap"></div>';

    html += '<section class="card"><details class="fold"><summary><span class="grow"><b>이슈 단어가 들어간 보고 줄</b> <span class="small muted">(지연, 불량, 알람, 클레임 등)</span></span><span class="muted small">' + issueWords.length + '건</span></summary>' +
      '<div class="fold-body">' + listOrEmpty(issueWords.map((it) => itemRow(it)), '해당 줄이 없습니다.') + '</div></details></section>';

    root.innerHTML = html;
    bindPeriodPicker(root, 'brief', [], {});
    const printBtn = $('#print-btn', root);
    if (printBtn) printBtn.addEventListener('click', () => {
      $$('details', root).forEach((d) => { d.open = true; });
      window.print();
    });
  }

  function kpi(label, value, unit, note) {
    return '<div class="kpi"><div class="label">' + esc(label) + '</div><div class="value num">' + esc(value) +
      (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div><div class="note">' + esc(note || '') + '</div></div>';
  }

  // 기간 시작일부터 3주 안의 날짜가 적힌 일정 줄. 같은 문장은 한 번만.
  function upcomingSchedule(per) {
    const limit = addDays(per.end, 21);
    const seen = new Set();
    const rows = [];
    for (const it of S.items) {
      if (it.y !== 'schedule') continue;
      if (it.msg.d > per.end) continue;
      if (it.msg.d < addDays(per.start, -30)) continue;
      for (const d of it.ds) {
        if (d < per.start || d > limit) continue;
        const key = d + '|' + it.x.replace(/\s+/g, '');
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ date: d, it: it });
      }
    }
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (!rows.length) return '<div class="empty">이 기간 보고에서 찾은 일정이 없습니다.</div>';
    const html = rows.map((r) => {
      const past = r.date < S.anchor ? ' muted' : '';
      return '<li><div class="' + past + '"><b class="num">' + mdw(r.date) + '</b> ' + esc(r.it.x) + '</div><div class="item-meta">' +
        whoHtml(r.it.msg.p) + '<span>언급 ' + dayLink(r.it.msg.d) + '</span></div></li>';
    });
    return '<ul class="plain">' + html.join('') + '</ul>';
  }

  // ============================================================ 2. 일자별

  function renderDay(root, args) {
    const fallback = S.workdays.length ? S.workdays[S.workdays.length - 1] : S.anchor;
    let day = args[0] && /^\d{4}-\d{2}-\d{2}$/.test(args[0]) ? args[0] : fallback;
    const idx = S.allDays.indexOf(day);
    const prev = idx > 0 ? S.allDays[idx - 1] : (idx < 0 ? S.allDays.filter((d) => d < day).pop() : null);
    const next = idx >= 0 && idx < S.allDays.length - 1 ? S.allDays[idx + 1] : (idx < 0 ? S.allDays.find((d) => d > day) : null);

    const msgs = S.msgs.filter((m) => m.d === day && !m.noise);
    const dayMap = S.reportsByDay.get(day) || new Map();
    const isWorkday = S.workdaySet.has(day);

    let html = '<div class="view-head"><div><h2>' + (+day.slice(5, 7)) + '월 ' + (+day.slice(8, 10)) + '일 (' + wd(day) + ')</h2>' +
      '<div class="sub">' + weekLabel(weekStart(day)) + ', 일일보고 ' + dayMap.size + '명' + (isWorkday ? '' : ' (보고일 아님)') + '</div></div>' +
      '<div class="toolbar no-print">' +
      '<button class="btn small" id="day-prev"' + (prev ? '' : ' disabled') + '>이전 날</button>' +
      '<input type="date" id="day-pick" value="' + day + '" min="' + S.allDays[0] + '" max="' + S.anchor + '">' +
      '<button class="btn small" id="day-next"' + (next ? '' : ' disabled') + '>다음 날</button>' +
      '</div></div>';

    // 날짜 띠
    const strip = S.allDays.map((d) => {
      const n = S.reportsByDay.has(d) ? S.reportsByDay.get(d).size : 0;
      const cls = (d === day ? ' on' : '') + (S.workdaySet.has(d) ? '' : ' off');
      return '<a class="day-chip' + cls + '" href="#day/' + d + '" data-day="' + d + '" data-tip="' + mdw(d) + ' 보고 ' + n + '명"><b>' + md(d) + '</b>' + wd(d) + '</a>';
    }).join('');
    html += '<div class="day-strip no-print" id="day-strip">' + strip + '</div><div class="section-gap"></div>';

    // 보고
    const reportCards = [];
    for (const m of S.members) {
      const list = dayMap.get(m.id);
      if (!list) continue;
      for (const r of list) reportCards.push(msgCard(r));
    }
    const missing = S.reporters.filter((m) => !dayMap.has(m.id));
    let missingHtml = '';
    if (isWorkday && missing.length) {
      missingHtml = '<div class="missing small" style="margin-bottom:12px"><span class="muted">보고 없음</span>' +
        missing.map((m) => whoHtml(m.id)).join(' ') + '</div>';
    }
    html += '<section class="card"><div class="card-head"><h3>일일보고</h3><span class="count">' + reportCards.length + '건</span></div>' +
      missingHtml + (reportCards.length ? reportCards.join('') : '<div class="empty">이 날 올라온 일일보고가 없습니다.</div>') + '</section>';

    const directives = msgs.filter((m) => m.k === 'directive' || m.k === 'minutes');
    if (directives.length) {
      html += '<section class="card"><div class="card-head"><h3>지시 / 회의록</h3><span class="count">' + directives.length + '건</span></div>' +
        directives.map((m) => msgCard(m)).join('') + '</section>';
    }
    const chats = msgs.filter((m) => m.k === 'chat');
    if (chats.length) {
      html += '<section class="card"><details class="fold"' + (chats.length <= 4 ? ' open' : '') + '><summary><span class="grow"><b>그 밖의 대화</b></span><span class="muted small">' + chats.length + '건</span></summary><div class="fold-body">' +
        chats.map((m) => msgCard(m, { showKeywords: false })).join('') + '</div></details></section>';
    }

    root.innerHTML = html;
    bindUnclamp(root);
    const pick = $('#day-pick', root);
    pick.addEventListener('change', () => { if (pick.value) go('day', [pick.value], {}); });
    $('#day-prev', root).addEventListener('click', () => { if (prev) go('day', [prev], {}); });
    $('#day-next', root).addEventListener('click', () => { if (next) go('day', [next], {}); });
    const chip = $('.day-chip.on', root);
    if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // ============================================================ 3. 인원별

  function renderMember(root, args, params) {
    const withMessages = new Set(S.msgs.filter((m) => !m.noise).map((m) => m.p));
    const choices = S.members.filter((m) => withMessages.has(m.id));
    const id = args[0] && S.memberById.has(args[0]) ? args[0] : (S.reporters[0] ? S.reporters[0].id : choices[0].id);
    const p = person(id);
    const per = resolvePeriod(params, 'all');

    const chips = choices.map((m) => '<a class="pill' + (m.id === id ? ' on' : '') + '" href="' + buildHash('member', [m.id], params) + '">' + esc(m.name) +
      (m.team ? ' <span class="n">' + esc(m.team) + '</span>' : '') + '</a>').join('');

    const mine = S.msgs.filter((m) => m.p === id && !m.noise && inPeriod(m.d, per));
    const reports = mine.filter((m) => m.k === 'report');
    const myItems = S.items.filter((it) => it.msg.p === id && inPeriod(it.msg.d, per));
    const received = S.items.filter((it) => it.y === 'request' && it.to.indexOf(id) >= 0 && inPeriod(it.msg.d, per));
    const sent = myItems.filter((it) => it.y === 'request');
    const remarks = myItems.filter((it) => it.y === 'issue' && it.r);
    const sub = submissionStats(per, [id]).byMember.get(id);
    const isReporter = p.role === 'member';

    let html = '<div class="view-head"><div><h2>' + esc(p.name) + (p.title ? ' ' + esc(p.title) : '') + '</h2><div class="sub">' +
      esc(p.team || '') + (p.speaker && p.speaker !== p.name ? ' / 대화명 ' + esc(p.speaker) : '') + '</div></div></div>';
    html += '<div class="member-chips no-print">' + chips + '</div>';
    html += periodPicker(per) + '<div class="section-gap"></div>';

    html += '<div class="kpis">' +
      (isReporter
        ? kpi('일일보고', reports.length, '건', '') + kpi('보고 제출률', sub.total ? Math.round((sub.done / sub.total) * 100) : '-', sub.total ? '%' : '', sub.done + ' / ' + sub.total + ' 보고일')
        : kpi('메시지', mine.length, '건', '') + kpi('지시/공지', mine.filter((m) => m.k === 'directive').length, '건', '')) +
      kpi('특이사항', remarks.length, '건', '') +
      kpi('받은 협조 요청', received.length, '건', '') +
      kpi('보낸 협조 요청', sent.length, '건', '') +
      '</div>';

    // 주별 보고 수
    const weeks = S.weeks.filter((w) => w <= per.end && addDays(w, 6) >= per.start);
    const points = weeks.map((w) => {
      const n = mine.filter((m) => m.w === w && (isReporter ? m.k === 'report' : true)).length;
      return { label: weekLabel(w), short: weekLabel(w).replace(' ', ''), value: n, tip: weekLabel(w) + ' (' + weekRangeText(w) + ')\n' + (isReporter ? '일일보고 ' : '메시지 ') + n + '건' };
    });

    // 키워드
    const kwCount = new Map();
    for (const m of mine) for (const k of (m.kw || [])) kwCount.set(k, (kwCount.get(k) || 0) + 1);
    const kwPills = Array.from(kwCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => {
      const kw = S.keywords[k];
      return '<a class="pill" href="#project/' + encodeURIComponent(kw.name) + '">' + esc(kw.name) + ' <span class="n">' + n + '</span></a>';
    }).join('');

    html += '<div class="grid two">';
    html += '<section class="card"><div class="card-head"><h3>주별 ' + (isReporter ? '일일보고' : '메시지') + ' 수</h3><span class="count">막대에 마우스를 올리면 기간 표시</span></div>' + barsChart(points) + '</section>';
    html += '<section class="card"><div class="card-head"><h3>자주 다룬 프로젝트</h3><span class="count">언급한 메시지 수</span></div>' +
      (kwPills ? '<div class="pills">' + kwPills + '</div>' : '<div class="empty">키워드 사전에 있는 프로젝트 언급이 없습니다.</div>') + '</section>';
    html += '</div><div class="section-gap"></div>';

    // AI 주간 흐름
    const flow = weeks.slice().reverse().map((w) => {
      const s = S.summaries.weeks[w];
      if (!s || !s.byMember) return '';
      const entry = s.byMember.find((b) => b.id === id);
      if (!entry) return '';
      return '<li><div>' + esc(entry.text) + '</div><div class="item-meta"><a href="#summary/week/' + w + '">' + weekLabel(w) + ' (' + weekRangeText(w) + ')</a></div></li>';
    }).filter(Boolean);
    html += '<div class="grid two">';
    html += '<section class="card"><div class="card-head"><h3>주간 흐름</h3><span class="count"><span class="ai-tag">AI 요약</span></span></div>' +
      listOrEmpty(flow, '이 기간의 주간 요약이 없습니다.') + '</section>';
    html += '<section class="card"><div class="card-head"><h3>받은 협조 요청</h3><span class="count">' + received.length + '건</span></div>' +
      listOrEmpty(received.slice().reverse().map((it) => itemRow(it)), '다른 팀장이 이름을 들어 요청한 내용이 없습니다.') + '</section>';
    html += '</div><div class="section-gap"></div>';

    // 원문 타임라인
    const byWeek = new Map();
    for (const m of mine) {
      if (!byWeek.has(m.w)) byWeek.set(m.w, []);
      byWeek.get(m.w).push(m);
    }
    const weekKeys = Array.from(byWeek.keys()).sort().reverse();
    const folds = weekKeys.map((w, i) => {
      const list = byWeek.get(w).sort((a, b) => (a.d + a.t < b.d + b.t ? 1 : -1));
      return '<details class="fold"' + (i === 0 ? ' open' : '') + '><summary><span class="grow"><b>' + weekLabel(w) + '</b> <span class="muted small">' + weekRangeText(w) + '</span></span><span class="muted small">' + list.length + '건</span></summary>' +
        '<div class="fold-body">' + list.map((m) => msgCard(m, { showDate: true, clamp: true })).join('') + '</div></details>';
    });
    html += '<section class="card"><div class="card-head"><h3>보고 원문</h3><span class="count">' + mine.length + '건</span></div>' +
      (folds.length ? folds.join('') : '<div class="empty">이 기간 메시지가 없습니다.</div>') + '</section>';

    root.innerHTML = html;
    bindPeriodPicker(root, 'member', [id], {});
    bindUnclamp(root);
  }

  // ============================================================ 4. 주간/월간 요약

  function renderSummary(root, args) {
    const type = args[0] === 'month' ? 'month' : 'week';
    const keys = type === 'week' ? S.weeks.slice().reverse() : S.months.slice().reverse();
    const key = args[1] && keys.indexOf(args[1]) >= 0 ? args[1] : keys[0];
    const pos = keys.indexOf(key);
    const newer = pos > 0 ? keys[pos - 1] : null;
    const older = pos < keys.length - 1 ? keys[pos + 1] : null;
    const per = type === 'week'
      ? { id: 'custom', start: key, end: addDays(key, 6) }
      : { id: 'custom', start: key + '-01', end: monthEnd(key) };
    const label = type === 'week' ? weekLabel(key) + ' (' + weekRangeText(key) + ')' : monthLabel(key) + ' (' + key.slice(0, 4) + '년)';
    const store = type === 'week' ? S.summaries.weeks : S.summaries.months;

    const options = keys.map((k) => {
      const l = type === 'week' ? weekLabel(k) + ' (' + weekRangeText(k) + ')' : monthLabel(k);
      const mark = store[k] ? '' : ' - 요약 없음';
      return '<option value="' + k + '"' + (k === key ? ' selected' : '') + '>' + esc(l + mark) + '</option>';
    }).join('');

    let html = '<div class="view-head"><div><h2>' + (type === 'week' ? '주간 요약' : '월간 요약') + '</h2><div class="sub">' + esc(label) + '</div></div>' +
      '<div class="toolbar no-print">' +
      '<div class="seg"><button class="' + (type === 'week' ? 'on' : '') + '" data-type="week">주간</button><button class="' + (type === 'month' ? 'on' : '') + '" data-type="month">월간</button></div>' +
      '<button class="btn small" id="sum-older"' + (older ? '' : ' disabled') + '>이전</button>' +
      '<select id="sum-pick" aria-label="기간 선택">' + options + '</select>' +
      '<button class="btn small" id="sum-newer"' + (newer ? '' : ' disabled') + '>다음</button>' +
      '<a class="btn small" href="' + buildHash('brief', [], { from: per.start, to: per.end }) + '">이 기간 브리핑</a>' +
      '</div></div>';

    html += '<section class="card">' + renderAiSummary(store[key], type, { key: key, label: label }) + '</section>';
    html += '<div class="section-gap"></div>';

    // 자동 집계
    const msgs = S.msgs.filter((m) => inPeriod(m.d, per) && !m.noise);
    const items = S.items.filter((it) => inPeriod(it.msg.d, per));
    const sub = submissionStats(per, S.reporters.map((m) => m.id));
    const rows = S.reporters.map((m) => {
      const r = msgs.filter((x) => x.p === m.id && x.k === 'report').length;
      const s = sub.byMember.get(m.id);
      const remark = items.filter((it) => it.msg.p === m.id && it.y === 'issue' && it.r).length;
      const reqOut = items.filter((it) => it.msg.p === m.id && it.y === 'request').length;
      const reqIn = items.filter((it) => it.y === 'request' && it.to.indexOf(m.id) >= 0).length;
      return '<tr><td>' + whoHtml(m.id) + '</td><td class="r">' + r + '</td><td class="r">' + s.done + ' / ' + s.total + '</td><td class="r">' + remark + '</td><td class="r">' + reqOut + '</td><td class="r">' + reqIn + '</td></tr>';
    }).join('');

    const kwCount = new Map();
    for (const m of msgs) for (const k of (m.kw || [])) kwCount.set(k, (kwCount.get(k) || 0) + 1);
    const topKw = Array.from(kwCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const maxKw = topKw.length ? topKw[0][1] : 1;
    const kwBars = topKw.map(([k, n]) => {
      const kw = S.keywords[k];
      return '<a class="hbar-label" href="#project/' + encodeURIComponent(kw.name) + '?from=' + per.start + '&to=' + per.end + '">' + esc(kw.name) + '</a>' +
        '<div class="hbar-track" data-tip="' + esc(kw.name + ': ' + n + '건') + '"><div class="hbar-fill" style="width:' + Math.max(2, Math.round((n / maxKw) * 100)) + '%"></div></div>' +
        '<div class="hbar-val">' + n + '</div>';
    }).join('');

    html += '<div class="grid two">';
    html += '<section class="card"><div class="card-head"><h3>인원별 집계</h3><span class="count">보고일 ' + sub.days.length + '일</span></div>' +
      '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>이름</th><th class="r">보고</th><th class="r">제출</th><th class="r">특이사항</th><th class="r">요청 보냄</th><th class="r">요청 받음</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
    html += '<section class="card"><div class="card-head"><h3>많이 언급된 프로젝트</h3><span class="count">메시지 수</span></div>' +
      (kwBars ? '<div class="hbar-list">' + kwBars + '</div>' : '<div class="empty">언급된 프로젝트가 없습니다.</div>') + '</section>';
    html += '</div>';

    root.innerHTML = html;
    $$('[data-type]', root).forEach((b) => b.addEventListener('click', () => go('summary', [b.dataset.type], {})));
    $('#sum-pick', root).addEventListener('change', (e) => go('summary', [type, e.target.value], {}));
    $('#sum-older', root).addEventListener('click', () => { if (older) go('summary', [type, older], {}); });
    $('#sum-newer', root).addEventListener('click', () => { if (newer) go('summary', [type, newer], {}); });
  }

  // ============================================================ 5. 프로젝트

  function renderProject(root, args, params) {
    const per = resolvePeriod(params, 'all');
    const msgs = S.msgs.filter((m) => !m.noise && inPeriod(m.d, per));
    const stats = S.keywords.map((k) => {
      const list = msgs.filter((m) => m.kw && m.kw.indexOf(k.idx) >= 0);
      return { k: k, list: list, people: new Set(list.map((m) => m.p)) };
    });
    const active = stats.filter((s) => s.list.length).sort((a, b) => b.list.length - a.list.length);
    let selected = null;
    if (args[0]) selected = stats.find((s) => s.k.name === args[0]) || null;
    if (!selected && active.length) selected = active[0];

    const groups = new Map();
    for (const s of active) {
      if (!groups.has(s.k.group)) groups.set(s.k.group, []);
      groups.get(s.k.group).push(s);
    }
    const max = active.length ? active[0].list.length : 1;
    let listHtml = '';
    groups.forEach((list, g) => {
      listHtml += '<h4 style="margin:12px 0 6px">' + esc(g) + '</h4><div class="hbar-list">';
      listHtml += list.map((s) => {
        const on = selected && s.k.idx === selected.k.idx ? ' on' : '';
        return '<a class="hbar-label' + on + '" href="' + buildHash('project', [s.k.name], params) + '">' + esc(s.k.name) + '</a>' +
          '<div class="hbar-track" data-tip="' + esc(s.k.name + '\n메시지 ' + s.list.length + '건, 관련 인원 ' + s.people.size + '명') + '"><div class="hbar-fill" style="width:' + Math.max(2, Math.round((s.list.length / max) * 100)) + '%"></div></div>' +
          '<div class="hbar-val">' + s.list.length + '</div>';
      }).join('');
      listHtml += '</div>';
    });

    let html = '<div class="view-head"><div><h2>프로젝트별 보기</h2><div class="sub">고객사, 현장, 과제 이름이 나온 보고를 모아 봅니다. 여러 팀에 흩어진 같은 건을 한 번에 확인할 때 씁니다.</div></div></div>';
    html += periodPicker(per) + '<div class="section-gap"></div>';
    html += '<div class="grid" style="grid-template-columns:minmax(0,340px) minmax(0,1fr)" id="proj-grid">';
    html += '<section class="card"><div class="card-head"><h3>언급 순위</h3><span class="count">메시지 수</span></div>' +
      (listHtml || '<div class="empty">이 기간에 언급된 프로젝트가 없습니다.</div>') + '</section>';

    if (selected) {
      const k = selected.k;
      const peopleCount = new Map();
      for (const m of selected.list) peopleCount.set(m.p, (peopleCount.get(m.p) || 0) + 1);
      const peoplePills = Array.from(peopleCount.entries()).sort((a, b) => b[1] - a[1]).map(([pid, n]) =>
        '<a class="pill" href="#member/' + encodeURIComponent(pid) + '">' + esc(person(pid).name) + ' <span class="n">' + n + '</span></a>').join('');
      const weeks = S.weeks.filter((w) => w <= per.end && addDays(w, 6) >= per.start);
      const points = weeks.map((w) => {
        const n = selected.list.filter((m) => m.w === w).length;
        return { label: weekLabel(w), short: weekLabel(w).replace(' ', ''), value: n, tip: weekLabel(w) + ' (' + weekRangeText(w) + ')\n' + n + '건' };
      });
      const terms = [k.name].concat(k.aliases);
      const timeline = selected.list.slice().sort((a, b) => (a.d + a.t < b.d + b.t ? 1 : -1)).map((m) => {
        const lines = m.x.split('\n').filter((l) => { k.regex.lastIndex = 0; return k.regex.test(l); }).map((l) => l.trim()).slice(0, 4);
        const text = highlightHtml(esc(lines.join('\n')), terms);
        return '<li><div style="white-space:pre-wrap">' + text + '</div><div class="item-meta">' + whoHtml(m.p) + '<span>' + dayLink(m.d) + '</span><span class="kind">' + KIND_LABEL[m.k] + '</span></div></li>';
      });
      // 언급이 많은 건은 40건씩 끊어서 보여준다
      const PAGE = 40;
      const firstPage = timeline.slice(0, PAGE).join('');
      const rest = timeline.slice(PAGE);
      const moreBtn = rest.length ? '<button class="btn small no-print" id="proj-more" style="margin-top:10px">나머지 ' + rest.length + '건 더 보기</button>' : '';
      html += '<section class="card"><div class="card-head"><h3>' + esc(k.name) + '</h3><span class="count">' +
        (k.aliases.length ? '같이 찾는 표기: ' + esc(k.aliases.join(', ')) : '') + '</span></div>' +
        '<div class="pills" style="margin-bottom:12px">' + peoplePills + '</div>' +
        barsChart(points) +
        '<div class="section-gap"></div><h4 style="margin-bottom:4px">언급된 줄 (최신순, ' + timeline.length + '건)</h4>' +
        '<ul class="plain" id="proj-lines">' + firstPage + '</ul>' + moreBtn + '</section>';
      S.projectRest = rest;
    }
    html += '</div>';
    root.innerHTML = html;
    bindPeriodPicker(root, 'project', selected ? [selected.k.name] : [], {});
    const more = $('#proj-more', root);
    if (more) {
      more.addEventListener('click', () => {
        $('#proj-lines', root).insertAdjacentHTML('beforeend', S.projectRest.join(''));
        more.remove();
      });
    }
    const grid = $('#proj-grid', root);
    if (window.matchMedia('(max-width: 900px)').matches) grid.style.gridTemplateColumns = 'minmax(0,1fr)';
  }

  // ============================================================ 6. 보고 현황

  function renderStatus(root, args, params) {
    const per = resolvePeriod(params, 'all');
    const sub = submissionStats(per, S.reporters.map((m) => m.id));
    const days = sub.days;

    // 주 단위 머리글
    const weekSpans = [];
    for (const d of days) {
      const w = weekStart(d);
      const last = weekSpans[weekSpans.length - 1];
      if (last && last.w === w) last.n++;
      else weekSpans.push({ w: w, n: 1 });
    }
    const weekStarts = new Set();
    let pos = 0;
    for (const s of weekSpans) { weekStarts.add(pos); pos += s.n; }

    let head1 = '<tr><th class="name"></th>' + weekSpans.map((s) => '<th class="wk" colspan="' + s.n + '">' + weekLabel(s.w) + '</th>').join('') + '<th></th></tr>';
    let head2 = '<tr><th class="name"></th>' + days.map((d, i) => '<th class="' + (weekStarts.has(i) ? 'wk' : '') + '">' + (+d.slice(8, 10)) + '</th>').join('') + '<th>제출</th></tr>';
    const body = S.reporters.map((m) => {
      const s = sub.byMember.get(m.id);
      const cells = days.map((d) => {
        const dayMap = S.reportsByDay.get(d);
        const list = dayMap ? dayMap.get(m.id) : null;
        if (list) {
          const first = list[0].x.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join('\n');
          const tip = m.name + ' ' + mdw(d) + '\n' + first;
          return '<td class="cell y" data-tip="' + esc(tip) + '" data-href="#day/' + d + '" style="cursor:pointer"></td>';
        }
        return '<td class="cell" data-tip="' + esc(m.name + ' ' + mdw(d) + '\n보고 없음') + '"></td>';
      }).join('');
      return '<tr><th class="name"><a href="#member/' + m.id + '">' + esc(m.name) + '</a> <span class="team">' + esc(m.team) + '</span></th>' + cells +
        '<td class="rate">' + s.done + '/' + s.total + ' (' + pct(s.done, s.total) + ')</td></tr>';
    }).join('');

    // 날짜별 보고 인원
    const points = days.map((d) => ({ label: mdw(d), short: '', value: S.reportsByDay.get(d).size, tip: mdw(d) + '\n보고 ' + S.reportsByDay.get(d).size + '명 / ' + S.reporters.length + '명', href: '#day/' + d }));

    let html = '<div class="view-head"><div><h2>보고 현황</h2><div class="sub">보고일마다 누가 일일보고를 올렸는지 보여줍니다. 칸을 누르면 그날 보고로 이동합니다.</div></div></div>';
    html += periodPicker(per) + '<div class="section-gap"></div>';
    html += '<section class="card"><div class="heat-wrap"><table class="heat"><thead>' + head1 + head2 + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="legend"><span><i style="background:var(--seq-2)"></i>보고 있음</span><span><i style="background:var(--seq-0)"></i>보고 없음 (연차, 출장, 회의록 대체 포함)</span></div></section>';
    html += '<div class="section-gap"></div>';
    html += '<section class="card"><div class="card-head"><h3>보고일별 보고 인원</h3><span class="count">대상 ' + S.reporters.length + '명</span></div>' + barsChart(points, { showValues: days.length <= 30 }) + '</section>';
    html += '<div class="section-gap"></div>';
    html += '<section class="card small ink2"><b>보는 법</b><ul class="dots">' +
      '<li>보고일은 하루에 ' + (S.bundle.minReportsForWorkday || 3) + '명 이상 일일보고가 올라온 날입니다. 주말과 추석 연휴처럼 보고가 거의 없는 날은 자동으로 빠집니다.</li>' +
      '<li>해외 출장자가 다음 날 아침(한국 시간)에 올린 보고는 보고 머리글에 적힌 날짜로 셉니다.</li>' +
      '<li>사장님 메시지는 지시사항, 회의 내용 공유는 회의록으로 따로 분류해 이 표에는 넣지 않았습니다.</li>' +
      '</ul></section>';

    root.innerHTML = html;
    bindPeriodPicker(root, 'status', [], {});
    $$('td[data-href]', root).forEach((td) => td.addEventListener('click', () => { location.hash = td.dataset.href; }));
    bindBarLinks(root);
  }

  // ============================================================ 7. 검색

  let searchTimer = null;
  function renderSearch(root, args, params) {
    const q = params.q || '';
    const who = params.who || '';
    const kind = params.kind || '';
    const memberOpts = '<option value="">전체 인원</option>' + S.members.map((m) => '<option value="' + m.id + '"' + (m.id === who ? ' selected' : '') + '>' + esc(m.name) + (m.team ? ' (' + esc(m.team) + ')' : '') + '</option>').join('');
    const kindOpts = [['', '전체 종류'], ['report', '일일보고'], ['minutes', '회의록'], ['directive', '지시/공지'], ['chat', '대화']]
      .map(([v, l]) => '<option value="' + v + '"' + (v === kind ? ' selected' : '') + '>' + l + '</option>').join('');

    let html = '<div class="view-head"><div><h2>검색</h2><div class="sub">띄어쓰기로 여러 단어를 넣으면 모두 들어간 메시지만 찾습니다.</div></div></div>';
    html += '<div class="toolbar"><input type="search" id="q" placeholder="예: BNYE 알람" value="' + esc(q) + '" style="flex:1;min-width:200px">' +
      '<select id="who">' + memberOpts + '</select><select id="kind">' + kindOpts + '</select></div><div class="section-gap"></div>';

    const terms = q.trim().split(/\s+/).filter(Boolean);
    let resultHtml = '';
    if (terms.length || who || kind) {
      const lowered = terms.map((t) => t.toLowerCase());
      const found = S.msgs.filter((m) => {
        if (m.noise) return false;
        if (who && m.p !== who) return false;
        if (kind && m.k !== kind) return false;
        const text = m.x.toLowerCase();
        for (const t of lowered) if (text.indexOf(t) < 0) return false;
        return true;
      }).sort((a, b) => (a.d + a.t < b.d + b.t ? 1 : -1));
      const shown = found.slice(0, 120);
      resultHtml = '<div class="small muted" style="margin-bottom:10px">' + found.length + '건' + (found.length > shown.length ? ', 최신 ' + shown.length + '건 표시' : '') + '</div>' +
        shown.map((m) => msgCard(m, { highlight: terms, showDate: true, clamp: true })).join('');
    } else {
      resultHtml = '<div class="empty">검색어를 입력하세요. 고객사명, 장비명, 사람 이름 모두 됩니다.</div>';
    }
    html += '<div id="results">' + resultHtml + '</div>';
    root.innerHTML = html;
    bindUnclamp(root);

    const input = $('#q', root);
    const update = () => {
      const hash = buildHash('search', [], { q: input.value, who: $('#who', root).value, kind: $('#kind', root).value });
      history.replaceState(null, '', hash);
      const caret = input.selectionStart;
      renderSearch(root, [], parseHash().params);
      const again = $('#q', root);
      again.focus();
      try { again.setSelectionRange(caret, caret); } catch (e) { /* 일부 브라우저 미지원 */ }
    };
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(update, 250);
    });
    $('#who', root).addEventListener('change', update);
    $('#kind', root).addEventListener('change', update);
    if (!q) input.focus();
  }

  // ============================================================ 8. 활용 안내

  function renderGuide(root) {
    const html = '<div class="view-head"><div><h2>활용 안내</h2><div class="sub">회의 종류별로 어떤 화면을 보면 되는지 정리했습니다.</div></div></div>' +
      '<div class="grid two">' +
      '<section class="card guide"><h3>아침 데일리 미팅</h3><ol>' +
      '<li><b>회의 브리핑</b>에서 <b>최근 보고일</b>을 고릅니다. 전날 올라온 특이사항, 팀 간 협조 요청, 사장님 지시가 한 화면에 모입니다.</li>' +
      '<li><b>보고에 나온 일정</b>에서 이번 주 안에 걸린 출하, 출장, 셋업 날짜를 확인합니다.</li>' +
      '<li>세부 내용이 필요하면 날짜를 눌러 <b>일자별</b> 화면에서 원문을 봅니다.</li></ol></section>' +
      '<section class="card guide"><h3>주간 회의</h3><ol>' +
      '<li><b>회의 브리핑</b>에서 <b>지난 주</b>를 고르면 AI 주간 요약과 회의에서 확인할 질문이 먼저 나옵니다.</li>' +
      '<li>팀별 요약을 펼쳐 각 팀장 업무를 한 줄씩 짚습니다.</li>' +
      '<li><b>프로젝트</b> 화면에서 LGES, BNYE처럼 여러 팀이 같이 움직이는 건을 골라 팀별 진행을 이어서 봅니다.</li>' +
      '<li><b>인쇄 / PDF</b> 버튼으로 회의 자료를 바로 출력할 수 있습니다.</li></ol></section>' +
      '<section class="card guide"><h3>월간 점검</h3><ol>' +
      '<li><b>주간/월간 요약</b>에서 <b>월간</b>을 고르면 그 달의 성과, 이슈, 다음 달로 넘어가는 과제가 정리돼 있습니다.</li>' +
      '<li><b>인원별</b> 화면의 주간 흐름으로 한 사람의 한 달 업무를 주 단위로 훑어볼 수 있습니다.</li>' +
      '<li><b>보고 현황</b>은 누락 확인용이 아니라 출장, 연차로 비는 날을 파악하는 데 쓰는 편이 좋습니다.</li></ol></section>' +
      '<section class="card guide"><h3>링크 공유</h3><ul>' +
      '<li>주소창의 주소가 지금 보는 화면을 그대로 가리킵니다. 특정 날짜나 사람 화면을 톡방에 링크로 붙이면 받은 사람도 같은 화면을 엽니다.</li>' +
      '<li>처음 여는 기기에서는 비밀번호를 한 번 입력해야 합니다. 공용 PC에서는 다 본 뒤 오른쪽 위 <b>잠금</b>을 누르세요.</li></ul></section>' +
      '<section class="card guide"><h3>데이터를 읽을 때 주의할 점</h3><ul>' +
      '<li>보고 분류, 특이사항, 협조 요청, 일정은 문장 규칙으로 자동 추출한 결과입니다. 빠지거나 잘못 잡힌 줄이 있을 수 있으니 판단은 원문 기준으로 합니다.</li>' +
      '<li>AI 요약은 원문을 바탕으로 쓰지만 놓친 내용이 있을 수 있습니다. 중요한 건은 원문 링크로 확인하세요.</li>' +
      '<li>시각은 모두 한국 시간입니다. 카톡을 내보낸 PC가 해외 시간대여도 한국 시간으로 바꿔 표시합니다.</li>' +
      '<li>보고 머리글 형식을 "날짜 - 팀명 이름"으로 맞추면 자동 분류가 더 정확해집니다. 특이사항은 "특이사항" 줄 아래에 적어 주세요.</li></ul></section>' +
      '<section class="card guide"><h3>데이터 갱신</h3><ul>' +
      '<li>담당자가 카톡 대화를 내보내 업데이트하면 1~2분 뒤 이 페이지에 반영됩니다. 오른쪽 위에 마지막 갱신 시각이 나옵니다.</li>' +
      '<li>AI 요약은 업데이트할 때 새로 생긴 주차만 추가로 작성합니다.</li></ul></section>' +
      '</div>';
    root.innerHTML = html;
  }

  // ============================================================ 툴팁

  function setupTooltip() {
    const tip = $('#tip');
    let current = null;
    const place = (x, y) => {
      const pad = 12;
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      let left = x + pad;
      let top = y + pad;
      if (left + w > window.innerWidth - 8) left = x - w - pad;
      if (top + h > window.innerHeight - 8) top = y - h - pad;
      tip.style.left = Math.max(8, left) + 'px';
      tip.style.top = Math.max(8, top) + 'px';
    };
    document.addEventListener('pointerover', (e) => {
      const el = e.target.closest('[data-tip]');
      if (!el) return;
      current = el;
      tip.textContent = el.getAttribute('data-tip');
      tip.classList.add('show');
      place(e.clientX, e.clientY);
    });
    document.addEventListener('pointermove', (e) => {
      if (!current) return;
      place(e.clientX, e.clientY);
    });
    document.addEventListener('pointerout', (e) => {
      if (!current) return;
      const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('[data-tip]') : null;
      if (to === current) return;
      current = null;
      tip.classList.remove('show');
    });
    window.addEventListener('scroll', () => { current = null; tip.classList.remove('show'); }, { passive: true });
  }

  // ============================================================ 시작

  function formatKst(isoString) {
    try {
      return new Date(isoString).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) {
      return isoString;
    }
  }

  function start(bundle) {
    prepare(bundle);
    document.title = bundle.title || '팀장 일일보고';
    $('#app-title').textContent = bundle.title || '팀장 일일보고';
    $('#app-range').textContent = '데이터 ' + md(bundle.range.first) + ' ~ ' + mdw(bundle.range.last) + ', 갱신 ' + formatKst(bundle.generatedAt);
    $('#gate').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $$('#tabs .tab').forEach((t) => t.addEventListener('click', () => go(t.dataset.view, [], {})));
    $('#logout').addEventListener('click', () => {
      storageRemove(PW_KEY);
      location.hash = '';
      location.reload();
    });
    window.addEventListener('hashchange', render);
    setupTooltip();
    render();
  }

  async function boot() {
    const form = $('#gate-form');
    const err = $('#gate-error');
    const btn = $('#gate-btn');
    const payload = window.DASHBOARD_DATA;

    if (!payload) {
      err.textContent = '데이터 파일을 불러오지 못했습니다. 잠시 뒤 새로고침하세요.';
      btn.disabled = true;
      return;
    }
    if (!window.crypto || !window.crypto.subtle) {
      err.textContent = '이 브라우저에서는 열 수 없습니다. 크롬이나 엣지 최신 버전으로 https 주소에서 여세요.';
      btn.disabled = true;
      return;
    }

    const saved = storageGet(PW_KEY);
    if (saved) {
      try {
        const bundle = await decrypt(payload, saved);
        start(bundle);
        return;
      } catch (e) {
        storageRemove(PW_KEY);
      }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('#gate-pw').value;
      if (!pw) return;
      btn.disabled = true;
      btn.textContent = '확인 중...';
      err.textContent = '';
      try {
        const bundle = await decrypt(payload, pw);
        if ($('#gate-remember').checked) storageSet(PW_KEY, pw);
        start(bundle);
      } catch (ex) {
        err.textContent = '비밀번호가 맞지 않습니다. 비밀번호가 바뀌었을 수 있으니 담당자에게 확인하세요.';
        btn.disabled = false;
        btn.textContent = '열기';
        $('#gate-pw').select();
      }
    });
    $('#gate-pw').focus();
  }

  boot();
})();
