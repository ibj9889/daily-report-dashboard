// 카카오톡 PC 대화 내보내기(txt) 파서와 보고 항목 추출 로직
// build.mjs 에서 불러 쓴다. 외부 패키지 없이 Node 기본 기능만 사용한다.

const DATE_LINE = /^-{5,}\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*\S*요일\s*-{5,}\s*$/;
const MSG_LINE = /^\[([^\]]+)\]\s\[(오전|오후)\s(\d{1,2}):(\d{2})\]\s?(.*)$/;
const SAVED_LINE = /^저장한 날짜\s*:\s*(.+)$/;

const MEDIA_TEXT = /^(사진|사진 \d+장|동영상|이모티콘|음성메시지|파일: .+|삭제된 메시지입니다\.?|샵검색: .*)$/;
const ACK_TEXT = /^(네+|넵+|예+|넹|넵넵|네네|알겠습니다|확인했습니다|확인하였습니다|확인 했습니다|감사합니다|수고하셨습니다|고생하셨습니다|좋습니다)/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ---------------------------------------------------------------- 시간대 변환

// 특정 시간대의 벽시계 시각(y,m,d,h,mi)을 UTC 밀리초로 바꾼다.
function zonedWallTimeToUtc(y, m, d, h, mi, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const wallAsUtc = Date.UTC(y, m - 1, d, h, mi);
  let guess = wallAsUtc;
  // 두 번 보정하면 서머타임 경계 근처도 맞는다.
  for (let i = 0; i < 2; i++) {
    const parts = {};
    for (const p of fmt.formatToParts(new Date(guess))) parts[p.type] = p.value;
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    const offset = shown - guess;
    guess = wallAsUtc - offset;
  }
  return guess;
}

function utcToZonedParts(utcMs, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

// ---------------------------------------------------------------- 원문 파싱

export function parseKakaoText(raw) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  let title = (lines[0] || '').trim();
  let savedAt = null;
  let curDate = null;
  let cur = null;
  const messages = [];
  const systemEvents = [];

  const flush = () => {
    if (cur) {
      cur.text = cur.lines.join('\n').replace(/\s+$/, '');
      delete cur.lines;
      messages.push(cur);
      cur = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const saved = line.match(SAVED_LINE);
    if (saved && i < 5) {
      savedAt = saved[1].trim();
      continue;
    }

    const dm = line.match(DATE_LINE);
    if (dm) {
      flush();
      curDate = { y: +dm[1], m: +dm[2], d: +dm[3] };
      continue;
    }

    const mm = curDate ? line.match(MSG_LINE) : null;
    if (mm) {
      flush();
      let hour = +mm[3] % 12;
      if (mm[2] === '오후') hour += 12;
      cur = {
        speaker: mm[1].trim(),
        local: { ...curDate, h: hour, mi: +mm[4] },
        lines: [mm[5]],
      };
      continue;
    }

    if (cur) {
      cur.lines.push(line);
    } else if (curDate && line.trim()) {
      systemEvents.push({ local: { ...curDate, h: 0, mi: 0 }, text: line.trim() });
    }
  }
  flush();

  return { title, savedAt, messages, systemEvents };
}

// 내보낸 PC 시간대의 시각을 한국 시간으로 옮긴다.
export function convertTimeZone(messages, sourceTimeZone, targetTimeZone) {
  for (const msg of messages) {
    const l = msg.local;
    let date;
    let time;
    if (sourceTimeZone === targetTimeZone) {
      date = `${l.y}-${pad2(l.m)}-${pad2(l.d)}`;
      time = `${pad2(l.h)}:${pad2(l.mi)}`;
    } else {
      const utc = zonedWallTimeToUtc(l.y, l.m, l.d, l.h, l.mi, sourceTimeZone);
      const z = utcToZonedParts(utc, targetTimeZone);
      date = z.date;
      time = z.time;
    }
    msg.date = date;
    msg.time = time;
    delete msg.local;
  }
  // 시간대를 옮기면 원본 순서와 날짜 순서가 같다. 혹시 모를 역전을 막기 위해 안정 정렬.
  messages.sort((a, b) => {
    const ka = a.date + ' ' + a.time;
    const kb = b.date + ' ' + b.time;
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
  return messages;
}

// ---------------------------------------------------------------- 인원 매핑

export function buildMemberIndex(members) {
  const bySpeaker = new Map();
  for (const m of members) {
    bySpeaker.set(m.speaker, m);
  }
  return bySpeaker;
}

// 본문에서 사람을 찾을 때 쓰는 별칭 목록. 긴 별칭부터 검사한다.
function buildMentionPatterns(members) {
  const list = [];
  for (const m of members) {
    const names = new Set([m.name, ...(m.aliases || [])]);
    for (const n of names) {
      if (!n || n.length < 2) continue;
      list.push({ id: m.id, alias: n });
    }
  }
  list.sort((a, b) => b.alias.length - a.alias.length);
  return list;
}

// ---------------------------------------------------------------- 메시지 분류

// 사내 회의록 머리글. "UL 위클리 미팅"처럼 고객사 회의 이름은 일일보고 본문에 자주 나오므로 넣지 않는다.
const MINUTES_HEAD = /(데일리\s*미팅|숏\s*미팅|주간\s*(전체\s*)?미팅|회의\s*내용|회의록|주요\s*안건)/;
// 첫 줄이 이런 형식이면 회의 이야기가 있어도 일일보고로 본다
const DAILY_FIRST_LINE = /(업무\s*(내용|보고|공유)|진행\s*업무|보고\s*드립니다|보고드립니다)/;

function classify(msg, member) {
  const text = msg.text.trim();
  if (!text) return 'media';
  if (MEDIA_TEXT.test(text)) return 'media';

  const compact = text.replace(/\s+/g, ' ');
  if (compact.length <= 25 && ACK_TEXT.test(compact)) return 'ack';

  if (member && member.role === 'leader') {
    if (compact.length >= 8) return 'directive';
    return 'ack';
  }

  const nonEmptyLines = text.split('\n').filter((l) => l.trim()).length;
  const head = text.split('\n').slice(0, 3).join(' ');
  const hasReportHead = /(보고|업무\s*내용|업무내용|업무 공유|공유\s*드|공유드|입니다|^\s*\d{1,2}\s*\/\s*\d{1,2}|^\s*\d{6}\b)/.test(head);
  const hasReportBody = /특이\s*사항/.test(text);
  const isLong = nonEmptyLines >= 3 && text.length >= 60;
  const isQuestion = /(\?|까요|할지요)/.test(head) && !hasReportBody;
  const meaningful = text.split('\n').filter((l) => l.trim());
  const firstLine = meaningful[0] || '';
  const firstTwo = meaningful.slice(0, 2).join(' ');
  const isMinutes = MINUTES_HEAD.test(firstTwo) && !DAILY_FIRST_LINE.test(firstLine);

  if (isLong && isMinutes) return 'minutes';
  if (isQuestion) return 'chat';
  if (isLong && (hasReportHead || hasReportBody)) return 'report';
  if (nonEmptyLines >= 6 && text.length >= 150) return 'report';
  return 'chat';
}

// 보고 머리글의 날짜("9/1", "09/02", "260902", "(9/03)")를 읽어 보고 대상일을 정한다.
// 해외 출장자가 다음 날 한국 오전에 전날 보고를 올리는 경우를 바로잡기 위함.
function findHeaderDate(text, postDate) {
  const head = text.split('\n').slice(0, 3).join(' ');
  const candidates = [];
  const yymmdd = head.match(/(?<!\d)(2\d)(\d{2})(\d{2})(?!\d)/);
  if (yymmdd) candidates.push(toIsoDate(2000 + +yymmdd[1], +yymmdd[2], +yymmdd[3]));
  const md = head.match(/(?<![\d.\/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d\/])/);
  if (md) {
    const m = +md[1];
    const d = +md[2];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) candidates.push(toIsoDate(inferYear(m, postDate), m, d));
  }
  for (const c of candidates) {
    if (Number.isNaN(Date.parse(c))) continue;
    const back = dayDiff(c, postDate);
    // 게시일보다 하루 앞서거나 최대 4일 늦게 올린 보고까지만 인정
    if (back >= -1 && back <= 4) return c;
  }
  return null;
}

// ---------------------------------------------------------------- 키워드(프로젝트/고객사)

function buildKeywordMatchers(keywords) {
  const out = [];
  keywords.forEach((k, idx) => {
    const terms = [k.name, ...(k.aliases || [])];
    for (const t of terms) {
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 영문 약어는 앞뒤가 영문이 아닐 때만 인정한다 (UL 이 ULS 에 걸리지 않도록)
      const isAscii = /^[A-Za-z0-9_\- ]+$/.test(t);
      const re = isAscii
        ? new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, k.caseSensitive ? '' : 'i')
        : new RegExp(escaped);
      out.push({ idx, re });
    }
  });
  return out;
}

function findKeywords(text, matchers) {
  const found = new Set();
  for (const m of matchers) {
    if (m.re.test(text)) found.add(m.idx);
  }
  return [...found].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- 줄 단위 추출

const ISSUE_RE = /(이슈|문제|불량|fault|에러|오류|지연|클레임|고장|파손|누수|미입고|중단|재발|이상\s*(현상|발생|동작)|불가|긴급|리스크|차질|튐|소손|알람 발생|NG)/i;
const ISSUE_NEGATIVE = /(없음|없습니다|없었|이상\s*없|문제\s*없|이슈\s*없|특이\s*사항\s*없)/;
const REQUEST_VERB = /(필요|요청|부탁|검토|확인|협의|회신|공유|지원|전달)/;
const LEAVE_RE = /(연차|반차|휴가|병가|입원|퇴원|조퇴|예비군|민방위|경조)/;
const TRIP_RE = /(출장|직출|직퇴|현장\s*방문|출국|귀국|입국)/;
const SCHEDULE_HINT = /(예정|출하|납품|셋업|SOP|출장|방문|미팅|회의|체결|입고|설치|목표|마감|까지|완료|검수|교육|시험|테스트|발송|출국|귀국|오픈)/i;

const DATE_SLASH = /(?<![\d.\/])(\d{1,2})\s?\/\s?(\d{1,2})(?![\d\/]|\s*(차|호|개|대|ch|CH|EA|ea|건|%|V|A|kW|명|부|층|라인|단계|분기))/g;
const DATE_KOR = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;

function cleanLine(line) {
  return line
    .replace(/^[\s\-–—•*>※#\u00B7ㄴ└→=]+/, '')
    .replace(/^\(?\d{1,2}[\)\.>]\s*/, '')
    .replace(/^[\s\-–—•*>ㄴ└→]+/, '')
    .trim();
}

function toIsoDate(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function inferYear(month, msgDate) {
  const [my, mm] = msgDate.split('-').map(Number);
  if (month < mm - 6) return my + 1;
  if (month > mm + 6) return my - 1;
  return my;
}

function dayDiff(a, b) {
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  return Math.round((db - da) / 86400000);
}

function extractDates(line, msgDate) {
  const found = [];
  const push = (m, d) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return;
    const y = inferYear(m, msgDate);
    const iso = toIsoDate(y, m, d);
    if (Number.isNaN(Date.parse(iso))) return;
    found.push(iso);
  };
  for (const mt of line.matchAll(DATE_SLASH)) push(+mt[1], +mt[2]);
  for (const mt of line.matchAll(DATE_KOR)) push(+mt[1], +mt[2]);
  return [...new Set(found)];
}

function findMentions(line, mentionPatterns, authorId) {
  const ids = new Set();
  let rest = line;
  for (const p of mentionPatterns) {
    if (p.id === authorId) continue;
    if (rest.includes(p.alias)) {
      ids.add(p.id);
      rest = rest.split(p.alias).join(' ');
    }
  }
  return [...ids];
}

// 특이사항 블록: "특이사항" 줄 다음부터 빈 줄이나 다음 머리글 전까지
function extractRemarkLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/특이\s*사항/.test(line)) continue;
    const after = line.split(/특이\s*사항/)[1] || '';
    const inline = after.replace(/^[\s:：\-은는]+/, '').trim();
    if (inline) {
      if (!ISSUE_NEGATIVE.test(line) && !/^(없|無)/.test(inline)) out.push(i);
      continue;
    }
    if (ISSUE_NEGATIVE.test(line)) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (!t) {
        if (out.length && j > i + 1) break;
        continue;
      }
      if (/^(※|\*|#|\[|\d+[\.\)])/.test(t) && j > i + 1) break;
      if (/^(없음|없습니다|특이사항 없|無|-\s*없음)/.test(t)) break;
      out.push(j);
    }
  }
  return out;
}

export function extractItems(msg, ctx) {
  const items = [];
  const rawLines = msg.text.split('\n');
  const remarkIdx = new Set(msg.kind === 'report' ? extractRemarkLines(rawLines) : []);

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const line = cleanLine(raw);
    if (line.length < 4) continue;
    if (/^(안녕하세요|감사합니다|검토 부탁)/.test(line)) continue;
    // 보고 머리글(예: "9/1 품질팀 오세웅 차장입니다")은 추출 대상이 아니다
    const isHeader = i <= 1 && /(입니다|보고|공유)/.test(line) && line.length < 45;
    if (isHeader) continue;

    // 1) 협조 요청 / 연계 사항
    const mentions = findMentions(line, ctx.mentionPatterns, msg.memberId);
    const atMentions = [...line.matchAll(/@([^\s@]+(?:\s[^\s@]+)?)/g)].map((x) => x[1]);
    for (const a of atMentions) {
      const target = ctx.memberBySpeakerLoose(a);
      if (target && target.id !== msg.memberId && !mentions.includes(target.id)) mentions.push(target.id);
    }
    const nonLeaderMentions = mentions.filter((id) => ctx.memberById.get(id)?.role !== 'leader');
    if (nonLeaderMentions.length && (REQUEST_VERB.test(line) || atMentions.length)) {
      // "@오세웅" 처럼 멘션만 있는 줄은 이어지는 내용을 붙여 보여준다
      let requestText = line;
      const withoutMentions = line.replace(/@[^\s@]+(?:\s[^\s@]+)?/g, '').trim();
      if (withoutMentions.length < 6) {
        const following = rawLines.slice(i + 1).map(cleanLine).filter((l) => l.length >= 2).slice(0, 2);
        requestText = (line + ' ' + following.join(' ')).trim();
      }
      const hasContent = requestText.replace(/@[^\s@]+(?:\s[^\s@]+)?/g, '').trim().length >= 6;
      if (hasContent) {
        items.push({ type: 'request', line: i, text: requestText, to: nonLeaderMentions });
      }
    }

    // 2) 이슈 / 특이사항 (근태나 출장 안내는 이슈가 아니라 아래 4번에서 따로 모은다)
    const isAttendance = LEAVE_RE.test(line) || /휴가자/.test(line) || TRIP_RE.test(line);
    const inRemark = remarkIdx.has(i) && !isAttendance;
    const hasIssueWord = ISSUE_RE.test(line) && !ISSUE_NEGATIVE.test(line);
    if (inRemark || hasIssueWord) {
      items.push({ type: 'issue', line: i, text: line, remark: inRemark || undefined });
    }

    // 3) 일정
    const dates = extractDates(line, msg.date).filter((d) => {
      const diff = dayDiff(msg.date, d);
      return diff >= 0 && diff <= 120;
    });
    const looksLikeHeaderDate = i <= 2 && dates.length === 1 && dates[0] === msg.date;
    if (dates.length && !looksLikeHeaderDate && SCHEDULE_HINT.test(line)) {
      items.push({ type: 'schedule', line: i, text: line, dates });
    }

    // 4) 근태 / 출장
    if (LEAVE_RE.test(line)) {
      items.push({ type: 'leave', line: i, text: line });
    } else if (TRIP_RE.test(line) && msg.kind !== 'report') {
      items.push({ type: 'trip', line: i, text: line });
    } else if (TRIP_RE.test(line) && /(예정|진행|출발|복귀|중|완료)/.test(line)) {
      items.push({ type: 'trip', line: i, text: line });
    }
  }
  return items;
}

// ---------------------------------------------------------------- 전체 가공

export function processMessages(messages, members, keywords) {
  const bySpeaker = buildMemberIndex(members);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const mentionPatterns = buildMentionPatterns(members);
  const kwMatchers = buildKeywordMatchers(keywords);

  const memberBySpeakerLoose = (s) => {
    const key = s.trim();
    if (bySpeaker.has(key)) return bySpeaker.get(key);
    for (const m of members) {
      if (key.startsWith(m.speaker) || key.startsWith(m.name)) return m;
    }
    return null;
  };

  const ctx = { mentionPatterns, memberById, memberBySpeakerLoose };
  const unknownSpeakers = new Set();
  const out = [];

  for (const msg of messages) {
    const member = bySpeaker.get(msg.speaker);
    if (!member) unknownSpeakers.add(msg.speaker);
    msg.memberId = member ? member.id : 'unknown:' + msg.speaker;
    msg.kind = classify(msg, member);
    // day: 화면에서 묶는 기준일. 보고와 회의록은 머리글 날짜, 나머지는 게시일.
    msg.day = msg.date;
    if (msg.kind === 'report' || msg.kind === 'minutes') {
      const headerDate = findHeaderDate(msg.text, msg.date);
      if (headerDate) msg.day = headerDate;
    }
    const isNoise = msg.kind === 'media' || msg.kind === 'ack';
    msg.keywords = isNoise ? [] : findKeywords(msg.text, kwMatchers);
    msg.items = isNoise ? [] : extractItems(msg, ctx);
    out.push(msg);
  }
  return { messages: out, unknownSpeakers: [...unknownSpeakers] };
}
