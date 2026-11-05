using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace KakaoAutoUpdate
{
    /// <summary>
    /// 팀장 일일보고 자동 업데이트
    ///   1) 카카오톡 실행, 로그인 확인 (로그인 안 돼 있으면 멈춤)
    ///   2) 팀장 톡방을 열어 ≡ 메뉴 > 대화 내용 > 대화 내보내기, 프로젝트 폴더에 저장
    ///   3) Claude Code 로 AI 요약, 대시보드 빌드, GitHub 게시
    ///
    /// 옵션
    ///   --no-pause     끝나고 키 입력을 기다리지 않음 (예약 실행용)
    ///   --export-only  카톡 저장까지만 하고 요약, 게시는 하지 않음
    ///
    /// 종료 코드: 0 성공, 1 기타 오류, 2 로그인 안 됨, 3 방을 못 엶, 4 저장 실패, 5 갱신 실패
    /// </summary>
    internal static class Program
    {
        private const int ExitOk = 0;
        private const int ExitError = 1;
        private const int ExitNotLoggedIn = 2;
        private const int ExitRoomNotFound = 3;
        private const int ExitExportFailed = 4;
        private const int ExitUpdateFailed = 5;

        private static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            // 화면 배율(125%, 150%)에서도 창 좌표와 캡처 픽셀이 일치하도록 DPI 인식을 켠다 (PER_MONITOR_AWARE_V2)
            NativeMethods.SetProcessDpiAwarenessContext(new IntPtr(-4));
            // 진단용: KakaoAutoUpdate.exe --ocr-test 메뉴캡처.png 대화내용
            if (args.Length >= 3 && args[0] == "--ocr-test")
            {
                RunOcrTest(args[1], args[2]);
                return ExitOk;
            }
            bool noPause = HasArg(args, "--no-pause");
            bool exportOnly = HasArg(args, "--export-only");

            int exitCode = ExitError;
            try
            {
                exitCode = Run(exportOnly);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[실패] 예상하지 못한 오류: " + ex);
                exitCode = ExitError;
            }

            if (!noPause)
            {
                Console.WriteLine();
                Console.WriteLine("아무 키나 누르면 창이 닫힙니다.");
                Console.ReadKey(true);
            }
            return exitCode;
        }

        private static int Run(bool exportOnly)
        {
            string root = FindProjectRoot();
            Logger log = new Logger(Path.Combine(root, "logs"));
            log.Step("팀장 일일보고 자동 업데이트 시작");
            log.Info("프로젝트 폴더: " + root);

            try
            {
                int result = RunSteps(root, log, exportOnly);
                log.Info("기록 파일: " + log.FilePath);
                return result;
            }
            catch (Exception ex)
            {
                log.Error("예상하지 못한 오류: " + ex);
                return ExitError;
            }
        }

        private static int RunSteps(string root, Logger log, bool exportOnly)
        {
            string configPath = Path.Combine(root, "private", "auto-update.json");
            bool created;
            AppConfig config = AppConfig.LoadOrCreate(configPath, out created);
            if (created)
            {
                log.Info("설정 파일을 기본값으로 만들었습니다: " + configPath);
            }
            if (string.IsNullOrWhiteSpace(config.RoomName))
            {
                log.Error("설정 파일의 roomName 이 비어 있습니다. 카카오톡 방 이름을 그대로 적고 다시 실행하세요: " + configPath);
                return ExitError;
            }
            string saveFolder = config.SaveFolder;
            if (string.IsNullOrWhiteSpace(saveFolder))
            {
                saveFolder = root;
            }

            bool ocrReady = OcrReader.IsKoreanAvailable();
            if (!ocrReady)
            {
                log.Error("Windows 한국어 OCR 을 쓸 수 없어 메뉴 글자를 확인할 수 없습니다. 설정 > 시간 및 언어에서 한국어 언어 팩을 설치하세요.");
                return ExitError;
            }

            // 1. 카카오톡 실행과 로그인 확인
            log.Step("1/4 카카오톡 로그인 확인");
            KakaoTalk kakao = new KakaoTalk(config, log);
            bool running = kakao.EnsureRunning();
            if (!running)
            {
                log.Error("카카오톡을 실행하지 못해 멈춥니다.");
                return ExitError;
            }
            LoginState state = kakao.GetLoginState();
            log.Info("로그인 상태: " + DescribeState(state));
            if (state != LoginState.LoggedIn)
            {
                log.Error("카카오톡이 로그인되어 있지 않아 멈춥니다. 로그인한 뒤 다시 실행하세요.");
                return ExitNotLoggedIn;
            }

            // 2. 채팅방 열기
            log.Step("2/4 채팅방 열기: " + config.RoomName);
            bool openedByUs;
            IntPtr room = kakao.OpenRoom(out openedByUs);
            if (room == IntPtr.Zero)
            {
                return ExitRoomNotFound;
            }

            // 3. 대화 내보내기
            log.Step("3/4 대화 내보내기");
            string savedPath = kakao.ExportRoom(room, saveFolder);
            if (openedByUs && config.CloseRoomAfterExport)
            {
                kakao.CloseRoom(room);
            }
            if (savedPath == null)
            {
                return ExitExportFailed;
            }
            CheckExportedFile(savedPath, config.RoomName, log);

            if (exportOnly)
            {
                log.Step("--export-only 옵션이라 저장까지만 하고 마칩니다.");
                return ExitOk;
            }

            // 4. AI 요약과 대시보드 갱신
            log.Step("4/4 AI 요약과 대시보드 갱신");
            DashboardUpdater updater = new DashboardUpdater(config, log, root);
            bool updated;
            if (config.RunAiSummary)
            {
                updated = updater.RunAiUpdate();
            }
            else
            {
                updated = updater.RunDataOnlyUpdate();
            }
            if (!updated)
            {
                log.Error("대시보드 갱신을 마치지 못했습니다.");
                return ExitUpdateFailed;
            }

            log.Step("완료. 1~2분 뒤 대시보드에 반영됩니다.");
            return ExitOk;
        }

        /// <summary>내보낸 파일 첫 줄이 "방이름 님과 카카오톡 대화" 인지 확인한다.</summary>
        private static void CheckExportedFile(string path, string roomName, Logger log)
        {
            string firstLine = "";
            using (StreamReader reader = new StreamReader(path, Encoding.UTF8))
            {
                string line = reader.ReadLine();
                if (line != null)
                {
                    firstLine = line.Trim();
                }
            }
            bool looksRight = firstLine.Contains(roomName) && firstLine.Contains("카카오톡 대화");
            if (looksRight)
            {
                log.Info("내보낸 파일 확인: " + firstLine);
            }
            else
            {
                log.Warn("내보낸 파일 첫 줄이 예상과 다릅니다: " + firstLine);
            }
        }

        private static string DescribeState(LoginState state)
        {
            switch (state)
            {
                case LoginState.LoggedIn:
                    return "로그인됨";
                case LoginState.Locked:
                    return "잠금 모드";
                case LoginState.NotLoggedIn:
                    return "로그인 안 됨";
                case LoginState.NoMainWindow:
                    return "메인 창 없음";
                default:
                    return "실행 안 됨";
            }
        }

        /// <summary>실행 파일 위치에서 위로 올라가며 scripts/build.mjs 가 있는 폴더를 찾는다.</summary>
        private static string FindProjectRoot()
        {
            DirectoryInfo current = new DirectoryInfo(AppContext.BaseDirectory);
            while (current != null)
            {
                string marker = Path.Combine(current.FullName, "scripts", "build.mjs");
                if (File.Exists(marker))
                {
                    return current.FullName;
                }
                current = current.Parent;
            }
            string fallback = Directory.GetCurrentDirectory();
            return fallback;
        }

        /// <summary>저장해 둔 메뉴 캡처를 OCR 로 읽고 항목 판정 결과를 보여준다. 카카오톡은 건드리지 않는다.</summary>
        private static void RunOcrTest(string pngPath, string wanted)
        {
            PixelImage image = OcrReader.LoadPng(Path.GetFullPath(pngPath));
            List<OcrLineInfo> lines = OcrReader.ReadLines(image);
            foreach (OcrLineInfo line in lines)
            {
                string hangul = MenuMatcher.HangulOnly(line.Text);
                int distance = MenuMatcher.EditDistance(hangul, MenuMatcher.HangulOnly(wanted));
                Console.WriteLine("  '" + line.Text + "'  거리 " + distance + "  위치 x=" + (int)line.FirstWordCenterX + " y=" + (int)line.CenterY);
            }
            string reason;
            OcrLineInfo match = MenuMatcher.FindLine(lines, wanted, out reason);
            Console.WriteLine("판정: " + reason);
        }

        private static bool HasArg(string[] args, string name)
        {
            foreach (string arg in args)
            {
                if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }
    }
}
