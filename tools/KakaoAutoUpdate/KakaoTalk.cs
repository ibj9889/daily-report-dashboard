using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;

namespace KakaoAutoUpdate
{
    internal enum LoginState
    {
        NotRunning,
        NoMainWindow,
        Locked,
        NotLoggedIn,
        LoggedIn,
    }

    /// <summary>
    /// PC 카카오톡 조작. 메시지 입력칸에는 글자나 Enter 를 보내지 않는다.
    /// 하는 동작은 다음뿐이다.
    ///   1) 메인 창 채팅 검색칸에 방 이름을 넣고 Enter (방 열기)
    ///   2) 방 창 오른쪽 위 ≡ 아이콘을 픽셀로 확인한 뒤 실제 마우스로 클릭
    ///   3) 메뉴를 OCR 로 읽어 "대화 내용" 위에 마우스를 올리고, 하위 메뉴의 "대화 내보내기" 를 클릭
    ///   4) 다른 이름으로 저장 창의 파일 이름 칸에 경로를 넣고 저장 버튼
    /// 단체방 ≡ 옆에는 영상통화, 음성통화 버튼이 있고 메뉴에는 "채팅방 나가기", "대화 내용 모두 삭제" 가 있다.
    /// 그래서 모양이나 글자를 확인하지 못하면 누르지 않고 멈춘다.
    /// </summary>
    internal sealed class KakaoTalk
    {
        private const string WindowClass = "EVA_Window_Dblclk";
        private const string MainTitle = "카카오톡";
        private const string MenuClass = "EVA_Menu";
        private const string SaveDialogClass = "#32770";
        private const int FileNameEditId = 1001;
        private const int SaveButtonId = 1;

        private readonly AppConfig config;
        private readonly Logger log;

        public KakaoTalk(AppConfig config, Logger log)
        {
            this.config = config;
            this.log = log;
        }

        // ------------------------------------------------------------ 실행과 로그인

        public static Process FindProcess()
        {
            Process[] list = Process.GetProcessesByName("KakaoTalk");
            if (list.Length == 0)
            {
                return null;
            }
            Process first = list[0];
            return first;
        }

        /// <summary>꺼져 있으면 켜고, 로그인 화면이나 메인 화면이 나올 때까지 기다린다.</summary>
        public bool EnsureRunning()
        {
            Process process = FindProcess();
            if (process != null)
            {
                log.Info("카카오톡 실행 중 (PID " + process.Id + ")");
                return true;
            }

            if (!File.Exists(config.KakaoTalkPath))
            {
                log.Error("카카오톡 실행 파일을 찾지 못했습니다: " + config.KakaoTalkPath);
                return false;
            }

            log.Info("카카오톡이 꺼져 있어 실행합니다.");
            ProcessStartInfo startInfo = new ProcessStartInfo(config.KakaoTalkPath);
            startInfo.UseShellExecute = true;
            Process.Start(startInfo);

            DateTime deadline = DateTime.Now.AddSeconds(config.StartupWaitSeconds);
            while (DateTime.Now < deadline)
            {
                Thread.Sleep(1000);
                LoginState state = GetLoginState();
                if (state == LoginState.LoggedIn || state == LoginState.NotLoggedIn || state == LoginState.Locked)
                {
                    // 자동 로그인이면 OnlineMainView 가 생길 때까지 조금 더 기다린다
                    Thread.Sleep(3000);
                    return true;
                }
            }
            log.Warn("카카오톡 창이 " + config.StartupWaitSeconds + "초 안에 준비되지 않았습니다.");
            Process started = FindProcess();
            bool alive = started != null;
            return alive;
        }

        /// <summary>
        /// 메인 창 구조로 로그인 여부를 판단한다.
        ///   OnlineMainView 가 있고 크기가 있으면 로그인 상태
        ///   LockModeView 가 화면에 보이면 잠금 모드
        /// 판단이 애매하면 로그인 안 됨으로 본다 (멈추는 쪽이 안전).
        /// </summary>
        public LoginState GetLoginState()
        {
            Process process = FindProcess();
            if (process == null)
            {
                return LoginState.NotRunning;
            }

            IntPtr main = NativeMethods.FindWindow(WindowClass, MainTitle);
            if (main == IntPtr.Zero)
            {
                return LoginState.NoMainWindow;
            }

            IntPtr lockView = Win.FindChildByTitlePrefix(main, "EVA_ChildWindow_Dblclk", "LockModeView");
            if (lockView != IntPtr.Zero)
            {
                int lockWidth = Win.GetWidth(lockView);
                bool lockVisible = NativeMethods.IsWindowVisible(lockView);
                if (lockWidth > 0 && lockVisible)
                {
                    return LoginState.Locked;
                }
            }

            IntPtr online = Win.FindChildByTitlePrefix(main, "EVA_ChildWindow", "OnlineMainView");
            if (online == IntPtr.Zero)
            {
                return LoginState.NotLoggedIn;
            }
            int onlineWidth = Win.GetWidth(online);
            if (onlineWidth <= 0)
            {
                return LoginState.NotLoggedIn;
            }

            IntPtr chatList = Win.FindChildByTitlePrefix(online, "EVA_Window", "ChatRoomListView");
            if (chatList == IntPtr.Zero)
            {
                return LoginState.NotLoggedIn;
            }
            return LoginState.LoggedIn;
        }

        // ------------------------------------------------------------ 채팅방 열기

        public IntPtr FindRoomWindow()
        {
            IntPtr room = NativeMethods.FindWindow(WindowClass, config.RoomName);
            return room;
        }

        /// <summary>방 창을 찾고, 없으면 메인 창 채팅 검색으로 연다. openedByUs 는 이번에 새로 열었는지.</summary>
        public IntPtr OpenRoom(out bool openedByUs)
        {
            openedByUs = false;
            IntPtr existing = FindRoomWindow();
            if (existing != IntPtr.Zero)
            {
                log.Info("채팅방 창이 이미 열려 있습니다: " + config.RoomName);
                return existing;
            }

            IntPtr searchEdit = FindChatSearchEdit();
            if (searchEdit == IntPtr.Zero)
            {
                log.Error("카카오톡 채팅 목록의 검색칸을 찾지 못했습니다.");
                return IntPtr.Zero;
            }

            log.Info("채팅 검색칸에 방 이름을 넣고 엽니다: " + config.RoomName);
            NativeMethods.SendMessage(searchEdit, NativeMethods.WM_SETTEXT, IntPtr.Zero, config.RoomName);
            Thread.Sleep(1200);
            NativeMethods.PostMessage(searchEdit, NativeMethods.WM_KEYDOWN, (IntPtr)NativeMethods.VK_RETURN, IntPtr.Zero);
            NativeMethods.PostMessage(searchEdit, NativeMethods.WM_KEYUP, (IntPtr)NativeMethods.VK_RETURN, IntPtr.Zero);

            IntPtr room = WaitForRoomWindow(10);
            // 검색어는 원래대로 비워 둔다
            NativeMethods.SendMessage(searchEdit, NativeMethods.WM_SETTEXT, IntPtr.Zero, "");

            if (room == IntPtr.Zero)
            {
                log.Error("'" + config.RoomName + "' 창이 열리지 않았습니다. 방 이름이 카카오톡과 똑같은지 확인하세요.");
                return IntPtr.Zero;
            }
            openedByUs = true;
            // 방 창이 대화를 다 불러올 때까지 기다린다
            Thread.Sleep(3000);
            return room;
        }

        private IntPtr FindChatSearchEdit()
        {
            IntPtr main = NativeMethods.FindWindow(WindowClass, MainTitle);
            if (main == IntPtr.Zero)
            {
                return IntPtr.Zero;
            }
            IntPtr online = Win.FindChildByTitlePrefix(main, "EVA_ChildWindow", "OnlineMainView");
            if (online == IntPtr.Zero)
            {
                return IntPtr.Zero;
            }
            IntPtr chatList = Win.FindChildByTitlePrefix(online, "EVA_Window", "ChatRoomListView");
            if (chatList == IntPtr.Zero)
            {
                return IntPtr.Zero;
            }
            IntPtr edit = NativeMethods.FindWindowEx(chatList, IntPtr.Zero, "Edit", null);
            return edit;
        }

        private IntPtr WaitForRoomWindow(int seconds)
        {
            DateTime deadline = DateTime.Now.AddSeconds(seconds);
            while (DateTime.Now < deadline)
            {
                Thread.Sleep(300);
                IntPtr room = FindRoomWindow();
                if (room != IntPtr.Zero)
                {
                    return room;
                }
            }
            return IntPtr.Zero;
        }

        public void CloseRoom(IntPtr room)
        {
            bool alive = NativeMethods.IsWindow(room);
            if (!alive)
            {
                return;
            }
            NativeMethods.PostMessage(room, NativeMethods.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            log.Info("이번에 연 채팅방 창을 닫았습니다.");
        }

        // ------------------------------------------------------------ 대화 내보내기

        /// <summary>방 창 메뉴로 대화 내보내기를 열고 saveFolder 에 저장한다. 저장한 파일 경로를 돌려준다.</summary>
        public string ExportRoom(IntPtr room, string saveFolder)
        {
            uint kakaoProcessId = Win.GetProcessId(room);
            IntPtr previousForeground = NativeMethods.GetForegroundWindow();
            NativeMethods.POINT previousCursor;
            NativeMethods.GetCursorPos(out previousCursor);

            IntPtr dialog = IntPtr.Zero;
            try
            {
                dialog = OpenSaveDialogByMenu(room, kakaoProcessId);
            }
            finally
            {
                NativeMethods.SetCursorPos(previousCursor.X, previousCursor.Y);
            }
            if (dialog == IntPtr.Zero)
            {
                RestoreForeground(previousForeground);
                return null;
            }

            string savedPath = SaveWithDialog(dialog, saveFolder);
            RestoreForeground(previousForeground);
            return savedPath;
        }

        /// <summary>≡ 클릭, "대화 내용" 위로 이동, "대화 내보내기" 클릭 순서로 저장 창을 연다.</summary>
        private IntPtr OpenSaveDialogByMenu(IntPtr room, uint kakaoProcessId)
        {
            bool front = BringToFront(room);
            if (!front)
            {
                log.Error("채팅방 창을 맨 앞으로 가져오지 못했습니다. 화면 잠금 상태이거나 다른 창이 막고 있습니다.");
                return IntPtr.Zero;
            }

            // 1) ≡ 아이콘
            double scale = GetScale(room);
            PixelImage roomImage = ScreenCapture.CaptureWindow(room);
            if (roomImage == null)
            {
                log.Error("채팅방 창을 캡처하지 못했습니다.");
                return IntPtr.Zero;
            }
            int iconX;
            int iconY;
            string iconDetail;
            bool iconFound = MenuIconFinder.TryFind(roomImage, scale, out iconX, out iconY, out iconDetail);
            log.Info("메뉴 아이콘 판정: " + iconDetail);
            if (!iconFound)
            {
                log.Error("오른쪽 위 메뉴(≡) 아이콘을 확인하지 못해 누르지 않고 멈춥니다.");
                return IntPtr.Zero;
            }

            HashSet<long> menusBefore = ListWindows(kakaoProcessId, MenuClass);
            bool stillFront = NativeMethods.GetForegroundWindow() == room;
            if (!stillFront)
            {
                log.Error("클릭 직전에 맨 앞 창이 바뀌어 멈춥니다.");
                return IntPtr.Zero;
            }
            log.Info("메뉴(≡) 클릭: (" + iconX + ", " + iconY + ")");
            ClickAt(iconX, iconY);

            IntPtr mainMenu = WaitForNewWindow(kakaoProcessId, MenuClass, menusBefore, 4);
            if (mainMenu == IntPtr.Zero)
            {
                log.Error("메뉴가 열리지 않았습니다.");
                return IntPtr.Zero;
            }

            // 2) "대화 내용" 위로 마우스 (하위 메뉴가 열린다)
            OcrLineInfo contentLine = FindMenuLine(mainMenu, "대화내용");
            if (contentLine == null)
            {
                log.Error("메뉴에서 '대화 내용' 항목을 읽지 못해 멈춥니다.");
                CloseMenus();
                return IntPtr.Zero;
            }
            NativeMethods.RECT mainRect;
            NativeMethods.GetWindowRect(mainMenu, out mainRect);
            int contentX = mainRect.Left + (int)contentLine.FirstWordCenterX;
            int contentY = mainRect.Top + (int)contentLine.CenterY;
            HashSet<long> menusWithMain = ListWindows(kakaoProcessId, MenuClass);
            log.Info("'대화 내용' 위로 이동: (" + contentX + ", " + contentY + ")");
            HoverAt(contentX, contentY);

            IntPtr subMenu = WaitForNewWindow(kakaoProcessId, MenuClass, menusWithMain, 3);
            if (subMenu == IntPtr.Zero)
            {
                log.Error("'대화 내용' 하위 메뉴가 열리지 않았습니다.");
                CloseMenus();
                return IntPtr.Zero;
            }

            // 3) "대화 내보내기" 클릭
            OcrLineInfo exportLine = FindMenuLine(subMenu, "대화내보내기");
            if (exportLine == null)
            {
                log.Error("하위 메뉴에서 '대화 내보내기' 항목을 읽지 못해 멈춥니다.");
                CloseMenus();
                return IntPtr.Zero;
            }
            NativeMethods.RECT subRect;
            NativeMethods.GetWindowRect(subMenu, out subRect);
            int exportX = subRect.Left + (int)exportLine.FirstWordCenterX;
            int exportY = subRect.Top + (int)exportLine.CenterY;

            HashSet<long> dialogsBefore = ListWindows(kakaoProcessId, SaveDialogClass);
            log.Info("'대화 내보내기' 클릭: (" + exportX + ", " + exportY + ")");
            ClickAt(exportX, exportY);

            IntPtr dialog = WaitForNewWindow(kakaoProcessId, SaveDialogClass, dialogsBefore, 15);
            if (dialog == IntPtr.Zero)
            {
                log.Error("다른 이름으로 저장 창이 뜨지 않았습니다.");
                CloseMenus();
                return IntPtr.Zero;
            }
            // 창이 뜨자마자 칸을 건드리면 값이 덮어써질 수 있어 잠깐 기다린다
            Thread.Sleep(700);
            return dialog;
        }

        /// <summary>
        /// 메뉴 창을 OCR 로 읽어 wanted 항목 줄을 찾는다. 고르는 규칙은 MenuMatcher 참고.
        /// "삭제", "나가기" 가 들어간 줄은 어떤 경우에도 고르지 않는다.
        /// </summary>
        private OcrLineInfo FindMenuLine(IntPtr menu, string wanted)
        {
            PixelImage image = ScreenCapture.CaptureWindow(menu);
            if (image == null)
            {
                return null;
            }
            List<OcrLineInfo> lines = OcrReader.ReadLines(image);
            List<string> texts = new List<string>();
            foreach (OcrLineInfo line in lines)
            {
                texts.Add(line.Text);
            }
            log.Info("메뉴 글자: " + string.Join(" / ", texts));

            string reason;
            OcrLineInfo match = MenuMatcher.FindLine(lines, wanted, out reason);
            log.Info("메뉴 항목 판정: " + reason);
            return match;
        }

        private static double GetScale(IntPtr hWnd)
        {
            uint dpi = NativeMethods.GetDpiForWindow(hWnd);
            if (dpi == 0)
            {
                return 1.0;
            }
            double scale = dpi / 96.0;
            return scale;
        }

        private static void ClickAt(int x, int y)
        {
            NativeMethods.SetCursorPos(x, y);
            Thread.Sleep(150);
            NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(300);
        }

        /// <summary>마우스를 올려 두기만 한다. 한 번 더 1px 움직여 메뉴가 위치를 확실히 받게 한다.</summary>
        private static void HoverAt(int x, int y)
        {
            NativeMethods.SetCursorPos(x, y);
            Thread.Sleep(200);
            NativeMethods.SetCursorPos(x + 1, y);
            Thread.Sleep(300);
        }

        /// <summary>열린 메뉴를 Esc 두 번으로 닫는다.</summary>
        private void CloseMenus()
        {
            for (int i = 0; i < 2; i++)
            {
                NativeMethods.keybd_event(NativeMethods.VK_ESCAPE, 0, 0, UIntPtr.Zero);
                NativeMethods.keybd_event(NativeMethods.VK_ESCAPE, 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
                Thread.Sleep(200);
            }
            log.Info("열린 메뉴를 닫았습니다.");
        }

        /// <summary>파일 이름 칸에 경로를 넣고 저장을 누른 뒤 파일이 생길 때까지 기다린다.</summary>
        private string SaveWithDialog(IntPtr dialog, string saveFolder)
        {
            IntPtr fileNameEdit = FindFileNameEdit(dialog);
            if (fileNameEdit == IntPtr.Zero)
            {
                log.Error("저장 창의 파일 이름 칸을 찾지 못해 취소합니다.");
                NativeMethods.PostMessage(dialog, NativeMethods.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                return null;
            }

            string suggested = Win.GetControlText(fileNameEdit);
            string fileName = Path.GetFileName(suggested);
            if (string.IsNullOrWhiteSpace(fileName))
            {
                fileName = "KakaoTalk_" + DateTime.Now.ToString("yyyyMMdd_HHmm_ss") + "_group.txt";
            }
            if (!fileName.EndsWith(".txt", StringComparison.OrdinalIgnoreCase))
            {
                fileName = fileName + ".txt";
            }
            string targetPath = MakeUniquePath(Path.Combine(saveFolder, fileName));
            log.Info("저장 경로: " + targetPath);

            NativeMethods.SendMessage(fileNameEdit, NativeMethods.WM_SETTEXT, IntPtr.Zero, targetPath);
            Thread.Sleep(300);
            string written = Win.GetControlText(fileNameEdit);
            if (written != targetPath)
            {
                log.Error("파일 이름 칸에 경로가 들어가지 않아 취소합니다.");
                NativeMethods.PostMessage(dialog, NativeMethods.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                return null;
            }

            IntPtr saveButton = FindChildById(dialog, "Button", SaveButtonId);
            if (saveButton == IntPtr.Zero)
            {
                log.Error("저장 버튼을 찾지 못해 취소합니다.");
                NativeMethods.PostMessage(dialog, NativeMethods.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                return null;
            }
            NativeMethods.PostMessage(saveButton, NativeMethods.BM_CLICK, IntPtr.Zero, IntPtr.Zero);

            bool saved = WaitForFile(targetPath, 90);
            if (!saved)
            {
                log.Error("저장 파일이 만들어지지 않았습니다: " + targetPath);
                return null;
            }
            return targetPath;
        }

        /// <summary>Alt 키를 한 번 눌렀다 떼면 다른 프로그램 창도 앞으로 가져올 수 있다.</summary>
        private bool BringToFront(IntPtr hWnd)
        {
            for (int attempt = 1; attempt <= 3; attempt++)
            {
                bool minimized = NativeMethods.IsIconic(hWnd);
                if (minimized)
                {
                    NativeMethods.ShowWindow(hWnd, NativeMethods.SW_RESTORE);
                }
                NativeMethods.keybd_event(NativeMethods.VK_MENU, 0, 0, UIntPtr.Zero);
                NativeMethods.keybd_event(NativeMethods.VK_MENU, 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
                NativeMethods.SetForegroundWindow(hWnd);
                Thread.Sleep(500);

                IntPtr front = NativeMethods.GetForegroundWindow();
                if (front == hWnd)
                {
                    return true;
                }
            }
            return false;
        }

        private static void RestoreForeground(IntPtr previous)
        {
            if (previous == IntPtr.Zero)
            {
                return;
            }
            bool alive = NativeMethods.IsWindow(previous);
            if (alive)
            {
                NativeMethods.SetForegroundWindow(previous);
            }
        }

        private static HashSet<long> ListWindows(uint processId, string className)
        {
            HashSet<long> result = new HashSet<long>();
            List<IntPtr> windows = Win.GetTopWindowsOfProcess(processId);
            foreach (IntPtr hWnd in windows)
            {
                string windowClass = Win.GetClass(hWnd);
                bool visible = NativeMethods.IsWindowVisible(hWnd);
                if (windowClass == className && visible)
                {
                    result.Add(hWnd.ToInt64());
                }
            }
            return result;
        }

        private static IntPtr WaitForNewWindow(uint processId, string className, HashSet<long> before, int seconds)
        {
            DateTime deadline = DateTime.Now.AddSeconds(seconds);
            while (DateTime.Now < deadline)
            {
                Thread.Sleep(250);
                HashSet<long> now = ListWindows(processId, className);
                foreach (long handle in now)
                {
                    if (!before.Contains(handle))
                    {
                        // 메뉴가 다 그려질 때까지 잠깐 기다린다
                        Thread.Sleep(300);
                        return new IntPtr(handle);
                    }
                }
            }
            return IntPtr.Zero;
        }

        /// <summary>파일 이름 칸: 컨트롤 ID 1001 인 Edit 중 부모가 ComboBox 인 것 (주소 표시줄 Edit 과 구분).</summary>
        private static IntPtr FindFileNameEdit(IntPtr dialog)
        {
            List<IntPtr> children = Win.GetDescendants(dialog);
            foreach (IntPtr child in children)
            {
                string className = Win.GetClass(child);
                if (className != "Edit")
                {
                    continue;
                }
                int id = NativeMethods.GetDlgCtrlID(child);
                if (id != FileNameEditId)
                {
                    continue;
                }
                IntPtr parent = NativeMethods.GetParent(child);
                string parentClass = Win.GetClass(parent);
                if (parentClass == "ComboBox")
                {
                    return child;
                }
            }
            return IntPtr.Zero;
        }

        private static IntPtr FindChildById(IntPtr parent, string className, int id)
        {
            List<IntPtr> children = Win.GetDescendants(parent);
            foreach (IntPtr child in children)
            {
                string childClass = Win.GetClass(child);
                int childId = NativeMethods.GetDlgCtrlID(child);
                if (childClass == className && childId == id)
                {
                    return child;
                }
            }
            return IntPtr.Zero;
        }

        /// <summary>같은 이름 파일이 있으면 덮어쓰기 확인 창이 뜨므로 이름 뒤에 번호를 붙인다.</summary>
        private static string MakeUniquePath(string path)
        {
            if (!File.Exists(path))
            {
                return path;
            }
            string folder = Path.GetDirectoryName(path);
            string name = Path.GetFileNameWithoutExtension(path);
            string extension = Path.GetExtension(path);
            for (int n = 2; n < 100; n++)
            {
                string candidate = Path.Combine(folder, name + "_" + n + extension);
                if (!File.Exists(candidate))
                {
                    return candidate;
                }
            }
            return path;
        }

        /// <summary>파일이 생기고 크기가 더 이상 늘지 않을 때까지 기다린다.</summary>
        private bool WaitForFile(string path, int seconds)
        {
            DateTime deadline = DateTime.Now.AddSeconds(seconds);
            long lastSize = -1;
            int stableCount = 0;
            while (DateTime.Now < deadline)
            {
                Thread.Sleep(500);
                if (!File.Exists(path))
                {
                    continue;
                }
                long size = new FileInfo(path).Length;
                if (size > 0 && size == lastSize)
                {
                    stableCount++;
                }
                else
                {
                    stableCount = 0;
                }
                lastSize = size;
                if (stableCount >= 3)
                {
                    log.Info("저장 완료: " + (size / 1024) + " KB");
                    return true;
                }
            }
            return false;
        }
    }
}
