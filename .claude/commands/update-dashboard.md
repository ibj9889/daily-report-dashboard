---
description: 새 카톡 대화 txt 로 대시보드 데이터와 AI 일일/주간/월간 요약을 갱신하고 GitHub Pages 에 올린다
---

팀장 일일보고 대시보드를 업데이트한다. 진행 상황과 결과 보고는 모두 한국어로 쓴다.

1. 프로젝트 폴더나 `raw/` 폴더에 `KakaoTalk*.txt` 가 있는지 확인한다. 없으면 사용자에게 카톡 PC 에서 대화 내보내기(대화방 메뉴 > 대화 내용 > 대화 내보내기 > 텍스트)를 한 뒤 이 폴더에 넣으라고 안내하고 멈춘다.
2. `node scripts/build.mjs --dump` 를 실행한다. 출력에 `[주의]` 가 있으면 그 내용을 사용자에게 알린다.
   - "members.json 에 없는 대화명" 이 나오면 새 인원이거나 대화명이 바뀐 것이다. 사용자에게 실명과 팀을 물어 `private/members.json` 에 반영한 뒤 2번을 다시 실행한다.
3. `private/dump/todo.json` 을 읽어 요약을 새로 써야 할 일일(`days`), 주간(`weeks`), 월간(`months`) 목록을 확인한다. 모두 비어 있으면 6번으로 간다.
4. `scripts/summary-guide.md` 를 끝까지 읽고 그 기준대로 요약을 쓴다. 순서는 일일, 주간, 월간이다.
   - 일일: 각 날짜 원문(`private/dump/days/<날짜>.txt`)을 읽고 `private/summary-parts/day-<날짜>.json` 으로 저장한다.
   - 주간: 그 주 원문(`private/dump/weeks/<월요일>.txt`)을 처음부터 끝까지 읽고 `week-<월요일>.json` 으로 저장한다.
   - 월간: 같은 달 주간 요약(`private/summaries.json` 또는 방금 쓴 `week-*.json`)을 먼저 보고, 월 원문으로 사실을 확인해 `month-<YYYY-MM>.json` 으로 저장한다.
   - 쓸 것이 많으면(일일 8개 이상 또는 주간 3개 이상) 하위 에이전트에 주 단위로 나눠 맡겨 병렬로 쓴다. 한 에이전트가 주간 원문을 한 번 읽고 그 주 일일 요약과 주간 요약을 같이 쓰게 하면 빠르다. 에이전트에게도 summary-guide.md 를 먼저 읽게 한다.
5. 저장한 요약 파일마다 확인한다: JSON 문법, 가운뎃점(U+00B7) 문자 없음, byMember 와 owner 의 id 가 members.json 에 있고 exclude 인원이 아님.
6. `node scripts/build.mjs` 를 실행해 요약을 병합하고 암호화 데이터를 만든다. 출력의 "AI 요약 조각 N개를 병합" 과 "요약이 없거나 이전 데이터 기준" 줄을 확인한다.
7. `git add docs` 후 `데이터 업데이트 YYYY-MM-DD` 형식 메시지로 커밋하고 `git push` 한다. 커밋 메시지에 공동 작성자나 생성 도구 서명 줄을 넣지 않는다.
8. 사용자에게 짧게 보고한다: 데이터 기간, 새로 쓴 요약 목록(날짜나 주차와 headline 한 줄씩), 1~2분 뒤 페이지에 반영된다는 안내.

주의: `private/` 폴더와 카톡 txt 는 절대 커밋하지 않는다(.gitignore 에 들어 있다). 파일 삭제 명령은 쓰지 않는다.
