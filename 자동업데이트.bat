@echo off
chcp 65001 >nul
cd /d "%~dp0"
set EXE=tools\KakaoAutoUpdate\bin\Release\net8.0-windows10.0.19041.0\KakaoAutoUpdate.exe
if not exist "%EXE%" (
  echo 처음 실행이라 자동 업데이트 프로그램을 빌드합니다...
  dotnet build tools\KakaoAutoUpdate -c Release -nologo -v q
  if errorlevel 1 (
    echo [실패] 빌드하지 못했습니다. .NET SDK 가 설치되어 있는지 확인하세요.
    pause
    exit /b 1
  )
)
"%EXE%" %*
exit /b %errorlevel%
