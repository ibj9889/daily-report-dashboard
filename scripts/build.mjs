// 일일보고 대시보드 빌드
//
//   node scripts/build.mjs          카톡 txt 를 읽어 docs/data.enc.js (암호화 데이터)를 만든다
//   node scripts/build.mjs --dump   위 작업 + AI 요약 작성용 원문(private/dump)을 만든다
//
// 입력: 프로젝트 폴더 또는 raw 폴더의 KakaoTalk*.txt (여러 개면 합치고 중복 제거)
// 설정: private/members.json, private/keywords.json, private/settings.json, private/password.txt
// 요약: private/summaries.json (Claude 가 작성, 없으면 요약 없이 빌드)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';
import { parseKakaoText, convertTimeZone, processMessages } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE = path.join(ROOT, 'private');
const OUT_FILE = path.join(ROOT, 'docs', 'data.enc.js');
const DUMP_DIR = path.join(PRIVATE, 'dump');
const args = new Set(process.argv.slice(2));

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  return JSON.parse(text);
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function fail(message) {
  console.error('\n[오류] ' + message + '\n');
  process.exit(1);
}

// ---------------------------------------------------------------- 날짜 도우미

function parseIso(iso) {
  return new Date(iso + 'T00:00:00Z');
}

function isoOf(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
}

function weekStart(iso) {
  const d = parseIso(iso);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  d.setUTCDate(d.getUTCDate() - dow);
  return isoOf(d);
}

// 그 주의 목요일이 속한 달을 기준으로 "9월 1주" 식 이름을 붙인다.
function weekLabel(mondayIso) {
  const thu = parseIso(addDays(mondayIso, 3));
  const month = thu.getUTCMonth() + 1;
  const nth = Math.ceil(thu.getUTCDate() / 7);
  return `${month}월 ${nth}주`;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
function weekdayOf(iso) {
  return WEEKDAY[parseIso(iso).getUTCDay()];
}

// ---------------------------------------------------------------- 입력 파일

function findSourceFiles() {
  const dirs = [ROOT, path.join(ROOT, 'raw')];
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (/^KakaoTalk.*\.txt$/i.test(name)) files.push(path.join(dir, name));
    }
  }
  return files;
}

// 파일을 처음 읽을 때의 PC 시간대를 기록해 두고 이후에도 그대로 쓴다.
// (출장에서 돌아와 PC 시간대를 한국으로 바꿔도 예전 파일 시각이 틀어지지 않게)
function resolveTimeZones(files, settings) {
  const manifestFile = path.join(PRIVATE, 'sources.json');
  const manifest = readJson(manifestFile, { files: {} });
  const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let changed = false;
  const result = new Map();
  for (const file of files) {
    const name = path.basename(file);
    let zone = settings.sourceTimeZone;
    if (!zone || zone === 'auto') {
      if (manifest.files[name]) {
        zone = manifest.files[name].timeZone;
      } else {
        zone = systemZone;
        manifest.files[name] = { timeZone: zone, firstSeen: new Date().toISOString() };
        changed = true;
      }
    }
    result.set(file, zone);
  }
  if (changed) writeJson(manifestFile, manifest);
  return result;
}

// "저장한 날짜"와 파일 수정 시각을 비교해 시간대 설정이 맞는지 확인한다.
function checkTimeZone(file, savedAt, zone) {
  if (!savedAt) return;
  const m = savedAt.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return;
  const probe = [{ local: { y: +m[1], m: +m[2], d: +m[3], h: +m[4], mi: +m[5] }, text: '' }];
  convertTimeZone(probe, zone, 'UTC');
  const savedUtc = Date.parse(probe[0].date + 'T' + probe[0].time + ':00Z');
  const mtime = fs.statSync(file).mtimeMs;
  const gapHours = Math.abs(savedUtc - mtime) / 3600000;
  if (gapHours > 0.5) {
    console.warn(`  [주의] ${path.basename(file)}: 시간대 ${zone} 기준 저장 시각과 파일 시각이 ${gapHours.toFixed(1)}시간 차이 납니다.`);
    console.warn('         다른 PC에서 내보낸 파일이면 private/settings.json 의 sourceTimeZone 을 확인하세요.');
  }
}

function loadMessages(files, zones, targetZone) {
  const all = [];
  const seen = new Set();
  const sources = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = parseKakaoText(raw);
    const zone = zones.get(file);
    checkTimeZone(file, parsed.savedAt, zone);
    convertTimeZone(parsed.messages, zone, targetZone);
    let added = 0;
    for (const msg of parsed.messages) {
      const key = msg.date + '|' + msg.time + '|' + msg.speaker + '|' + msg.text;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(msg);
      added++;
    }
    sources.push({ file: path.basename(file), savedAt: parsed.savedAt, timeZone: zone, messages: parsed.messages.length, added });
  }
  all.sort((a, b) => {
    const ka = a.date + ' ' + a.time;
    const kb = b.date + ' ' + b.time;
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
  return { messages: all, sources };
}

// ---------------------------------------------------------------- 묶음(bundle) 만들기

function compactMessage(msg, index) {
  const out = {
    i: index,
    p: msg.memberId,
    d: msg.day,
    t: msg.time,
    k: msg.kind,
    x: msg.text,
  };
  if (msg.day !== msg.date) out.pd = msg.date;
  if (msg.keywords.length) out.kw = msg.keywords;
  if (msg.items.length) {
    out.it = msg.items.map((it) => {
      const o = { y: it.type, l: it.line, x: it.text };
      if (it.to) o.to = it.to;
      if (it.dates) o.ds = it.dates;
      if (it.remark) o.r = 1;
      return o;
    });
  }
  return out;
}

function periodCounts(messages) {
  const weeks = {};
  const months = {};
  for (const m of messages) {
    if (m.kind === 'media' || m.kind === 'ack') continue;
    const w = weekStart(m.day);
    const mo = m.day.slice(0, 7);
    weeks[w] = (weeks[w] || 0) + 1;
    months[mo] = (months[mo] || 0) + 1;
  }
  return { weeks, months };
}

async function encrypt(plainText, password, iterations) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plainText));
  const b64 = (buf) => Buffer.from(buf).toString('base64');
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64(salt), iv: b64(iv), ct: b64(cipher) };
}

// ---------------------------------------------------------------- 요약 작성용 원문

function memberLabel(member) {
  if (!member) return '';
  const title = member.title ? ' ' + member.title : '';
  const team = member.team ? ` (${member.team})` : '';
  return member.name + title + team;
}

const KIND_LABEL = { report: '일일보고', minutes: '회의록', directive: '지시/공지', chat: '대화' };

function writeDump(bundle, rawMessages, memberById, summaries, counts) {
  // 기존 파일은 지우지 않고 같은 이름으로 덮어쓴다
  fs.mkdirSync(path.join(DUMP_DIR, 'weeks'), { recursive: true });
  fs.mkdirSync(path.join(DUMP_DIR, 'months'), { recursive: true });
  writeJson(path.join(DUMP_DIR, 'bundle.json'), bundle);

  const byWeek = new Map();
  const byMonth = new Map();
  for (const m of rawMessages) {
    if (m.kind === 'media' || m.kind === 'ack') continue;
    const w = weekStart(m.day);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(m);
    const mo = m.day.slice(0, 7);
    if (!byMonth.has(mo)) byMonth.set(mo, []);
    byMonth.get(mo).push(m);
  }

  const renderDays = (list) => {
    const lines = [];
    let curDay = '';
    const sorted = [...list].sort((a, b) => (a.day + a.time < b.day + b.time ? -1 : 1));
    for (const m of sorted) {
      if (m.day !== curDay) {
        curDay = m.day;
        lines.push('', `## ${m.day} (${weekdayOf(m.day)})`);
      }
      const posted = m.day !== m.date ? ` [게시 ${m.date} ${m.time}]` : ` [${m.time}]`;
      const who = memberLabel(memberById.get(m.memberId)) || m.speaker;
      lines.push('', `### ${who} / ${KIND_LABEL[m.kind] || m.kind}${posted}`, m.text.trim());
    }
    return lines.join('\n');
  };

  const todo = { weeks: [], months: [] };
  for (const [w, list] of byWeek) {
    const end = addDays(w, 6);
    const head = `# ${weekLabel(w)} (${w} ~ ${end}) 메시지 ${list.length}건`;
    fs.writeFileSync(path.join(DUMP_DIR, 'weeks', w + '.txt'), head + '\n' + renderDays(list) + '\n', 'utf8');
    const existing = summaries.weeks?.[w];
    if (!existing || (existing.basis?.count || 0) !== counts.weeks[w]) {
      todo.weeks.push({ key: w, label: weekLabel(w), start: w, end, count: counts.weeks[w], file: `private/dump/weeks/${w}.txt` });
    }
  }
  for (const [mo, list] of byMonth) {
    const head = `# ${+mo.slice(5)}월 (${mo}) 메시지 ${list.length}건`;
    fs.writeFileSync(path.join(DUMP_DIR, 'months', mo + '.txt'), head + '\n' + renderDays(list) + '\n', 'utf8');
    const existing = summaries.months?.[mo];
    if (!existing || (existing.basis?.count || 0) !== counts.months[mo]) {
      todo.months.push({ key: mo, label: `${+mo.slice(5)}월`, count: counts.months[mo], file: `private/dump/months/${mo}.txt` });
    }
  }
  writeJson(path.join(DUMP_DIR, 'todo.json'), todo);
  return todo;
}

// ---------------------------------------------------------------- AI 요약 병합

// private/summary-parts 에 Claude 가 써 둔 요약 조각을 summaries.json 으로 합친다.
// basis.count 는 요약 당시 그 기간의 메시지 수. 이후 메시지가 늘면 "갱신 필요"로 표시된다.
function mergeSummaryParts(summaries, counts) {
  const partsDir = path.join(PRIVATE, 'summary-parts');
  if (!fs.existsSync(partsDir)) return 0;
  summaries.weeks = summaries.weeks || {};
  summaries.months = summaries.months || {};
  let merged = 0;
  for (const name of fs.readdirSync(partsDir)) {
    const m = name.match(/^(week|month)-(\d{4}-\d{2}(?:-\d{2})?)\.json$/);
    if (!m) continue;
    const file = path.join(partsDir, name);
    let part;
    try {
      part = readJson(file, null);
    } catch (err) {
      console.warn(`  [주의] ${name} JSON 문법 오류로 건너뜀: ${err.message}`);
      continue;
    }
    const isWeek = m[1] === 'week';
    const key = m[2];
    const count = isWeek ? counts.weeks[key] : counts.months[key];
    part.basis = { count: count || 0 };
    part.generatedAt = new Date().toISOString();
    if (isWeek) summaries.weeks[key] = part;
    else summaries.months[key] = part;
    // 병합한 조각은 지우지 않고 보관 폴더로 옮겨 둔다 (요약 이력 백업 겸용)
    const archiveDir = path.join(PRIVATE, 'summary-archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    fs.renameSync(file, path.join(archiveDir, stamp + '-' + name));
    merged++;
  }
  if (merged) writeJson(path.join(PRIVATE, 'summaries.json'), summaries);
  return merged;
}

// ---------------------------------------------------------------- 실행

async function main() {
  console.log('일일보고 대시보드 빌드');

  const settings = {
    title: '2차전지사업부 팀장 일일보고',
    sourceTimeZone: 'auto',
    targetTimeZone: 'Asia/Seoul',
    minReportsForWorkday: 3,
    pbkdf2Iterations: 250000,
    ...readJson(path.join(PRIVATE, 'settings.json'), {}),
  };
  const members = readJson(path.join(PRIVATE, 'members.json'), null)?.members;
  if (!members) fail('private/members.json 이 없습니다. 인원 매핑 파일을 먼저 만드세요.');
  const keywords = readJson(path.join(PRIVATE, 'keywords.json'), { keywords: [] }).keywords;
  const summaries = readJson(path.join(PRIVATE, 'summaries.json'), { weeks: {}, months: {} });

  const pwFile = path.join(PRIVATE, 'password.txt');
  if (!fs.existsSync(pwFile)) fail('private/password.txt 가 없습니다. 메모장으로 열람 비밀번호 한 줄을 적어 저장하세요.');
  const password = fs.readFileSync(pwFile, 'utf8').replace(/^﻿/, '').trim();
  if (password.length < 8) fail('비밀번호는 8자 이상으로 정하세요 (공개 저장소라서 짧으면 뚫릴 수 있습니다).');

  const files = findSourceFiles();
  if (!files.length) fail('KakaoTalk 로 시작하는 txt 파일을 찾지 못했습니다. 프로젝트 폴더나 raw 폴더에 넣으세요.');
  const zones = resolveTimeZones(files, settings);
  const { messages: rawMessages, sources } = loadMessages(files, zones, settings.targetTimeZone);
  for (const s of sources) {
    console.log(`  읽음: ${s.file} (시간대 ${s.timeZone}, 메시지 ${s.messages}건, 신규 ${s.added}건)`);
  }

  const { messages, unknownSpeakers } = processMessages(rawMessages, members, keywords);
  if (unknownSpeakers.length) {
    console.warn('  [주의] members.json 에 없는 대화명: ' + unknownSpeakers.join(', '));
    console.warn('         새 인원이면 private/members.json 에 추가하세요. 지금은 대화명 그대로 표시됩니다.');
  }

  const memberById = new Map(members.map((m) => [m.id, m]));
  const counts = periodCounts(messages);
  const mergedParts = mergeSummaryParts(summaries, counts);
  if (mergedParts) console.log(`  AI 요약 조각 ${mergedParts}개를 private/summaries.json 에 병합`);
  const days = messages.map((m) => m.day).sort();
  const bundle = {
    v: 1,
    title: settings.title,
    generatedAt: new Date().toISOString(),
    timeZone: settings.targetTimeZone,
    minReportsForWorkday: settings.minReportsForWorkday,
    range: { first: days[0], last: days[days.length - 1] },
    sources,
    members: [...members].sort((a, b) => a.order - b.order),
    unknownSpeakers,
    keywords,
    counts,
    summaries,
    messages: messages.map(compactMessage),
  };

  const kinds = {};
  for (const m of messages) kinds[m.kind] = (kinds[m.kind] || 0) + 1;
  console.log(`  기간: ${bundle.range.first} ~ ${bundle.range.last}, 메시지 ${messages.length}건`);
  console.log(`  분류: 일일보고 ${kinds.report || 0}, 회의록 ${kinds.minutes || 0}, 지시/공지 ${kinds.directive || 0}, 대화 ${kinds.chat || 0}, 짧은응답/사진 ${(kinds.ack || 0) + (kinds.media || 0)}`);
  const summaryWeeks = Object.keys(summaries.weeks || {}).length;
  const summaryMonths = Object.keys(summaries.months || {}).length;
  console.log(`  AI 요약: 주간 ${summaryWeeks}개, 월간 ${summaryMonths}개 반영`);

  const plain = JSON.stringify(bundle);
  const payload = await encrypt(plain, password, settings.pbkdf2Iterations);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, 'window.DASHBOARD_DATA = ' + JSON.stringify(payload) + ';\n', 'utf8');
  console.log(`  암호화 데이터 저장: docs/data.enc.js (${Math.round(fs.statSync(OUT_FILE).size / 1024)} KB)`);

  // GitHub Pages 캐시(약 10분) 때문에 옛 파일이 보이지 않도록 index.html 의 파일 주소에 버전을 붙인다
  const indexFile = path.join(ROOT, 'docs', 'index.html');
  if (fs.existsSync(indexFile)) {
    const version = Date.now().toString(36);
    const html = fs.readFileSync(indexFile, 'utf8');
    const updated = html.replace(/(src|href)="(data\.enc\.js|app\.js|style\.css)(\?v=[^"]*)?"/g, `$1="$2?v=${version}"`);
    fs.writeFileSync(indexFile, updated, 'utf8');
  }

  if (args.has('--dump')) {
    const todo = writeDump(bundle, messages, memberById, summaries, counts);
    console.log(`  요약 작성용 원문 저장: private/dump (요약 필요: 주간 ${todo.weeks.length}개, 월간 ${todo.months.length}개)`);
  } else {
    const stale = [];
    for (const w of Object.keys(counts.weeks)) {
      if ((summaries.weeks?.[w]?.basis?.count || 0) !== counts.weeks[w]) stale.push(weekLabel(w));
    }
    if (stale.length) console.log(`  요약이 없거나 이전 데이터 기준인 주: ${stale.join(', ')} (Claude Code 에서 /update-dashboard 로 갱신)`);
  }
  console.log('완료');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
