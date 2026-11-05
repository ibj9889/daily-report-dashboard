@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ===== 팀장 일일보고 대시보드 업데이트 =====
echo.
echo [1/2] 카카오톡 대화를 읽어 암호화 데이터를 만드는 중...
node scripts\build.mjs
if errorlevel 1 goto fail
echo.
echo [2/2] GitHub 에 올리는 중...
git add docs
for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"') do set NOW=%%i
git commit -q -m "데이터 업데이트 %NOW%"
git push -q
if errorlevel 1 goto fail
echo.
echo 완료했습니다. 1~2분 뒤 페이지에 반영됩니다.
echo AI 주간/월간 요약까지 새로 쓰려면 Claude Code 에서 /update-dashboard 를 실행하세요.
goto done

:fail
echo.
echo [실패] 위 메시지를 확인하세요. 해결이 어려우면 이 창 내용을 Claude Code 에 붙여넣어 물어보세요.

:done
echo.
pause
