using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace KakaoAutoUpdate
{
    /// <summary>
    /// user32.dll 호출 모음. 카카오톡 창 찾기, 글자 넣기, 키 누르기에 쓴다.
    /// </summary>
    internal static class NativeMethods
    {
        public const uint WM_SETTEXT = 0x000C;
        public const uint WM_GETTEXT = 0x000D;
        public const uint WM_CLOSE = 0x0010;
        public const uint WM_KEYDOWN = 0x0100;
        public const uint WM_KEYUP = 0x0101;
        public const uint BM_CLICK = 0x00F5;

        public const int VK_RETURN = 0x0D;
        public const byte VK_MENU = 0x12;
        public const uint KEYEVENTF_KEYUP = 0x0002;

        public const int SW_RESTORE = 9;

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr FindWindow(string className, string windowName);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, StringBuilder lParam);

        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int cmdShow);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern int GetDlgCtrlID(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern IntPtr GetParent(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

        public const byte VK_ESCAPE = 0x1B;
        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint PW_RENDERFULLCONTENT = 2;

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT point);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extraInfo);

        [DllImport("user32.dll")]
        public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);

        [DllImport("user32.dll")]
        public static extern uint GetDpiForWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll")]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int width, int height);

        [DllImport("gdi32.dll")]
        public static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteObject(IntPtr obj);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        public static extern int GetDIBits(IntPtr hdc, IntPtr bitmap, uint start, uint lines, byte[] bits, ref BITMAPINFOHEADER info, uint usage);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct BITMAPINFOHEADER
        {
            public uint Size;
            public int Width;
            public int Height;
            public ushort Planes;
            public ushort BitCount;
            public uint Compression;
            public uint SizeImage;
            public int XPelsPerMeter;
            public int YPelsPerMeter;
            public uint ClrUsed;
            public uint ClrImportant;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }
    }

    /// <summary>
    /// 창 정보를 읽는 도우미. 중단점에서 값을 보기 쉽게 단계별로 나눠 둔다.
    /// </summary>
    internal static class Win
    {
        public static string GetClass(IntPtr hWnd)
        {
            StringBuilder buffer = new StringBuilder(256);
            NativeMethods.GetClassName(hWnd, buffer, buffer.Capacity);
            string className = buffer.ToString();
            return className;
        }

        public static string GetTitle(IntPtr hWnd)
        {
            StringBuilder buffer = new StringBuilder(512);
            NativeMethods.GetWindowText(hWnd, buffer, buffer.Capacity);
            string title = buffer.ToString();
            return title;
        }

        /// <summary>다른 프로그램의 입력칸 글자는 WM_GETTEXT 로 읽어야 한다.</summary>
        public static string GetControlText(IntPtr hWnd)
        {
            StringBuilder buffer = new StringBuilder(2048);
            NativeMethods.SendMessage(hWnd, NativeMethods.WM_GETTEXT, (IntPtr)buffer.Capacity, buffer);
            string text = buffer.ToString();
            return text;
        }

        public static int GetWidth(IntPtr hWnd)
        {
            NativeMethods.RECT rect;
            NativeMethods.GetWindowRect(hWnd, out rect);
            int width = rect.Right - rect.Left;
            return width;
        }

        public static uint GetProcessId(IntPtr hWnd)
        {
            uint processId;
            NativeMethods.GetWindowThreadProcessId(hWnd, out processId);
            return processId;
        }

        /// <summary>parent 바로 아래에서 className 이 같고 제목이 prefix 로 시작하는 창을 찾는다.</summary>
        public static IntPtr FindChildByTitlePrefix(IntPtr parent, string className, string prefix)
        {
            IntPtr current = NativeMethods.FindWindowEx(parent, IntPtr.Zero, className, null);
            while (current != IntPtr.Zero)
            {
                string title = GetTitle(current);
                if (title.StartsWith(prefix, StringComparison.Ordinal))
                {
                    return current;
                }
                current = NativeMethods.FindWindowEx(parent, current, className, null);
            }
            return IntPtr.Zero;
        }

        public static List<IntPtr> GetTopWindowsOfProcess(uint processId)
        {
            WindowCollector collector = new WindowCollector(processId);
            NativeMethods.EnumWindowsProc callback = collector.AddIfSameProcess;
            NativeMethods.EnumWindows(callback, IntPtr.Zero);
            GC.KeepAlive(callback);
            return collector.Found;
        }

        public static List<IntPtr> GetDescendants(IntPtr parent)
        {
            WindowCollector collector = new WindowCollector(0);
            NativeMethods.EnumWindowsProc callback = collector.Add;
            NativeMethods.EnumChildWindows(parent, callback, IntPtr.Zero);
            GC.KeepAlive(callback);
            return collector.Found;
        }

        /// <summary>EnumWindows 콜백을 이름 있는 메서드로 두기 위한 작은 클래스.</summary>
        private sealed class WindowCollector
        {
            private readonly uint processId;

            public WindowCollector(uint processId)
            {
                this.processId = processId;
                Found = new List<IntPtr>();
            }

            public List<IntPtr> Found { get; }

            public bool Add(IntPtr hWnd, IntPtr lParam)
            {
                Found.Add(hWnd);
                return true;
            }

            public bool AddIfSameProcess(IntPtr hWnd, IntPtr lParam)
            {
                uint windowProcessId = GetProcessId(hWnd);
                if (windowProcessId == processId)
                {
                    Found.Add(hWnd);
                }
                return true;
            }
        }
    }
}
