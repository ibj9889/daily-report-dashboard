using System;

namespace KakaoAutoUpdate
{
    /// <summary>창 하나를 찍은 픽셀 (BGRA, 위에서 아래 순서).</summary>
    internal sealed class PixelImage
    {
        public PixelImage(int width, int height, byte[] bgra, int screenLeft, int screenTop)
        {
            Width = width;
            Height = height;
            Bgra = bgra;
            ScreenLeft = screenLeft;
            ScreenTop = screenTop;
        }

        public int Width { get; }
        public int Height { get; }
        public byte[] Bgra { get; }

        /// <summary>찍은 창의 화면 좌표 (클릭 위치 계산용).</summary>
        public int ScreenLeft { get; }
        public int ScreenTop { get; }

        public double Luminance(int x, int y)
        {
            int index = (y * Width + x) * 4;
            byte blue = Bgra[index];
            byte green = Bgra[index + 1];
            byte red = Bgra[index + 2];
            double value = 0.299 * red + 0.587 * green + 0.114 * blue;
            return value;
        }
    }

    /// <summary>
    /// PrintWindow 로 창을 찍는다. 다른 창에 가려져 있어도 그 창 내용만 찍힌다.
    /// System.Drawing 없이 GDI 로 직접 픽셀을 받는다.
    /// </summary>
    internal static class ScreenCapture
    {
        public static PixelImage CaptureWindow(IntPtr hWnd)
        {
            NativeMethods.RECT rect;
            NativeMethods.GetWindowRect(hWnd, out rect);
            int width = rect.Right - rect.Left;
            int height = rect.Bottom - rect.Top;
            if (width <= 0 || height <= 0)
            {
                return null;
            }

            IntPtr screenDc = NativeMethods.GetDC(IntPtr.Zero);
            IntPtr memoryDc = NativeMethods.CreateCompatibleDC(screenDc);
            IntPtr bitmap = NativeMethods.CreateCompatibleBitmap(screenDc, width, height);
            IntPtr oldObject = NativeMethods.SelectObject(memoryDc, bitmap);
            byte[] pixels = new byte[width * height * 4];
            try
            {
                NativeMethods.PrintWindow(hWnd, memoryDc, NativeMethods.PW_RENDERFULLCONTENT);

                NativeMethods.BITMAPINFOHEADER header = new NativeMethods.BITMAPINFOHEADER();
                header.Size = 40;
                header.Width = width;
                header.Height = -height;   // 음수면 위에서 아래 순서
                header.Planes = 1;
                header.BitCount = 32;
                header.Compression = 0;
                NativeMethods.SelectObject(memoryDc, oldObject);
                NativeMethods.GetDIBits(memoryDc, bitmap, 0, (uint)height, pixels, ref header, 0);
            }
            finally
            {
                NativeMethods.DeleteObject(bitmap);
                NativeMethods.DeleteDC(memoryDc);
                NativeMethods.ReleaseDC(IntPtr.Zero, screenDc);
            }

            // PrintWindow 결과는 알파값이 0 인 경우가 있어 OCR 용으로 불투명하게 맞춘다
            for (int i = 3; i < pixels.Length; i += 4)
            {
                pixels[i] = 255;
            }
            PixelImage image = new PixelImage(width, height, pixels, rect.Left, rect.Top);
            return image;
        }
    }
}
