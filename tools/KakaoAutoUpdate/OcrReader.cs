using System;
using System.Collections.Generic;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace KakaoAutoUpdate
{
    /// <summary>OCR 로 읽은 한 줄과 그 위치(찍은 이미지 기준 픽셀).</summary>
    internal sealed class OcrLineInfo
    {
        public string Text;
        /// <summary>띄어쓰기를 뺀 글자. 비교할 때 쓴다.</summary>
        public string Compact;
        public double Left;
        public double Top;
        public double Right;
        public double Bottom;
        public double FirstWordCenterX;
        public double CenterY;
    }

    /// <summary>
    /// Windows 내장 OCR(한국어)로 카카오톡 메뉴 글자를 읽는다.
    /// 메뉴 글자가 작아서 2배로 키운 뒤 읽는다.
    /// </summary>
    internal static class OcrReader
    {
        // 메뉴 글자가 12px 정도로 작아서 3배로 키우고 흑백으로 바꿔 읽는다
        private const int Scale = 3;

        public static bool IsKoreanAvailable()
        {
            Language korean = new Language("ko");
            bool supported = OcrEngine.IsLanguageSupported(korean);
            return supported;
        }

        public static List<OcrLineInfo> ReadLines(PixelImage image)
        {
            int width = image.Width * Scale;
            int height = image.Height * Scale;
            byte[] scaled = ScaleUp(image, Scale);

            IBuffer buffer = scaled.AsBuffer();
            SoftwareBitmap bitmap = SoftwareBitmap.CreateCopyFromBuffer(buffer, BitmapPixelFormat.Bgra8, width, height, BitmapAlphaMode.Premultiplied);
            OcrEngine engine = OcrEngine.TryCreateFromLanguage(new Language("ko"));
            if (engine == null)
            {
                throw new InvalidOperationException("한국어 OCR 엔진을 만들 수 없습니다. Windows 설정에서 한국어 언어 팩을 확인하세요.");
            }
            OcrResult result = engine.RecognizeAsync(bitmap).AsTask().GetAwaiter().GetResult();

            List<OcrLineInfo> lines = new List<OcrLineInfo>();
            foreach (OcrLine line in result.Lines)
            {
                OcrLineInfo info = ToLineInfo(line);
                if (info != null)
                {
                    lines.Add(info);
                }
            }
            return lines;
        }

        private static OcrLineInfo ToLineInfo(OcrLine line)
        {
            if (line.Words.Count == 0)
            {
                return null;
            }
            double left = double.MaxValue;
            double top = double.MaxValue;
            double right = 0;
            double bottom = 0;
            foreach (OcrWord word in line.Words)
            {
                Windows.Foundation.Rect box = word.BoundingRect;
                left = Math.Min(left, box.X);
                top = Math.Min(top, box.Y);
                right = Math.Max(right, box.X + box.Width);
                bottom = Math.Max(bottom, box.Y + box.Height);
            }
            Windows.Foundation.Rect first = line.Words[0].BoundingRect;

            OcrLineInfo info = new OcrLineInfo();
            info.Text = line.Text;
            info.Compact = line.Text.Replace(" ", "");
            // 2배로 키워 읽었으므로 원래 크기로 되돌린다
            info.Left = left / Scale;
            info.Top = top / Scale;
            info.Right = right / Scale;
            info.Bottom = bottom / Scale;
            info.FirstWordCenterX = (first.X + first.Width / 2) / Scale;
            info.CenterY = (top + bottom) / 2 / Scale;
            return info;
        }

        /// <summary>흑백으로 바꾸고 이중선형 보간으로 factor 배 키운다. 글자 경계가 부드러워 OCR 이 잘 읽는다.</summary>
        private static byte[] ScaleUp(PixelImage image, int factor)
        {
            int width = image.Width * factor;
            int height = image.Height * factor;
            byte[] output = new byte[width * height * 4];
            for (int y = 0; y < height; y++)
            {
                double sourceY = (y + 0.5) / factor - 0.5;
                int y0 = Clamp((int)Math.Floor(sourceY), 0, image.Height - 1);
                int y1 = Clamp(y0 + 1, 0, image.Height - 1);
                double fy = sourceY - Math.Floor(sourceY);
                for (int x = 0; x < width; x++)
                {
                    double sourceX = (x + 0.5) / factor - 0.5;
                    int x0 = Clamp((int)Math.Floor(sourceX), 0, image.Width - 1);
                    int x1 = Clamp(x0 + 1, 0, image.Width - 1);
                    double fx = sourceX - Math.Floor(sourceX);

                    double top = image.Luminance(x0, y0) * (1 - fx) + image.Luminance(x1, y0) * fx;
                    double bottom = image.Luminance(x0, y1) * (1 - fx) + image.Luminance(x1, y1) * fx;
                    double value = top * (1 - fy) + bottom * fy;
                    byte gray = (byte)Clamp((int)Math.Round(value), 0, 255);

                    int targetIndex = (y * width + x) * 4;
                    output[targetIndex] = gray;
                    output[targetIndex + 1] = gray;
                    output[targetIndex + 2] = gray;
                    output[targetIndex + 3] = 255;
                }
            }
            return output;
        }

        private static int Clamp(int value, int min, int max)
        {
            if (value < min)
            {
                return min;
            }
            if (value > max)
            {
                return max;
            }
            return value;
        }

        /// <summary>PNG 파일을 읽어 PixelImage 로 만든다. --ocr-test 진단용.</summary>
        public static PixelImage LoadPng(string path)
        {
            Windows.Storage.StorageFile file = Windows.Storage.StorageFile.GetFileFromPathAsync(path).AsTask().GetAwaiter().GetResult();
            IRandomAccessStream stream = file.OpenAsync(Windows.Storage.FileAccessMode.Read).AsTask().GetAwaiter().GetResult();
            BitmapDecoder decoder = BitmapDecoder.CreateAsync(stream).AsTask().GetAwaiter().GetResult();
            SoftwareBitmap decoded = decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied).AsTask().GetAwaiter().GetResult();
            int width = decoded.PixelWidth;
            int height = decoded.PixelHeight;
            byte[] pixels = new byte[width * height * 4];
            IBuffer buffer = pixels.AsBuffer();
            decoded.CopyToBuffer(buffer);
            stream.Dispose();
            PixelImage image = new PixelImage(width, height, pixels, 0, 0);
            return image;
        }
    }
}
