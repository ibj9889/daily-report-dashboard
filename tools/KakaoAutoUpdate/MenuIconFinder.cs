using System;
using System.Collections.Generic;

namespace KakaoAutoUpdate
{
    /// <summary>
    /// 채팅방 창 오른쪽 위의 메뉴(≡) 아이콘을 픽셀로 찾는다.
    /// 단체방은 ≡ 바로 왼쪽에 영상통화, 음성통화 버튼이 있어서 고정 좌표로 누르면 위험하다.
    /// 그래서 가로줄 3개가 같은 폭, 같은 간격이고 줄 사이가 비어 있을 때만 ≡ 로 인정한다.
    /// 기준값은 100% 배율(96 DPI)에서 잰 것이고 창 배율에 맞춰 늘린다.
    /// </summary>
    internal static class MenuIconFinder
    {
        private sealed class Band
        {
            public int Top;
            public int Bottom;
            public int Start;
            public int End;
        }

        /// <summary>찾으면 화면 좌표를 돌려준다. 못 찾으면 found=false.</summary>
        public static bool TryFind(PixelImage image, double scale, out int screenX, out int screenY, out string detail)
        {
            screenX = 0;
            screenY = 0;

            int searchLeft = image.Width - (int)Math.Round(44 * scale);
            int searchRight = image.Width - (int)Math.Round(4 * scale);
            int searchTop = (int)Math.Round(30 * scale);
            int searchBottom = Math.Min(image.Height, (int)Math.Round(90 * scale));
            int minLineLength = (int)Math.Round(10 * scale);

            // 아이콘 오른쪽 바깥 여백 색을 배경으로 본다
            double background = image.Luminance(image.Width - 3, (int)Math.Round(60 * scale));

            List<Band> bands = new List<Band>();
            for (int y = searchTop; y < searchBottom; y++)
            {
                int runEnd;
                int runStart;
                FindRightmostDarkRun(image, y, searchLeft, searchRight, background, out runStart, out runEnd);
                int runLength = runEnd - runStart + 1;
                if (runEnd < 0 || runLength < minLineLength)
                {
                    continue;
                }
                Band last = bands.Count > 0 ? bands[bands.Count - 1] : null;
                if (last != null && last.Bottom == y - 1)
                {
                    last.Bottom = y;
                    continue;
                }
                Band band = new Band();
                band.Top = y;
                band.Bottom = y;
                band.Start = runStart;
                band.End = runEnd;
                bands.Add(band);
            }

            detail = "가로줄 " + bands.Count + "개";
            if (bands.Count != 3)
            {
                return false;
            }

            int tolerance = Math.Max(2, (int)Math.Round(2 * scale));
            bool sameStart = Math.Abs(bands[0].Start - bands[1].Start) <= tolerance && Math.Abs(bands[1].Start - bands[2].Start) <= tolerance;
            bool sameEnd = Math.Abs(bands[0].End - bands[1].End) <= tolerance && Math.Abs(bands[1].End - bands[2].End) <= tolerance;
            int gap1 = bands[1].Top - bands[0].Top;
            int gap2 = bands[2].Top - bands[1].Top;
            bool evenGap = Math.Abs(gap1 - gap2) <= Math.Max(1, (int)Math.Round(scale)) && gap1 >= 3 * scale && gap1 <= 10 * scale;
            int iconWidth = bands[0].End - bands[0].Start + 1;
            bool widthOk = iconWidth <= 24 * scale;
            bool emptyBetween = IsEmptyBetween(image, bands, background);
            detail = "가로줄 3개, 폭 " + iconWidth + ", 간격 " + gap1 + "/" + gap2
                + ", 같은 폭 " + (sameStart && sameEnd) + ", 일정 간격 " + evenGap + ", 줄 사이 빔 " + emptyBetween;
            if (!sameStart || !sameEnd || !evenGap || !widthOk || !emptyBetween)
            {
                return false;
            }

            int centerX = (bands[1].Start + bands[1].End) / 2;
            int centerY = (bands[1].Top + bands[1].Bottom) / 2;
            screenX = image.ScreenLeft + centerX;
            screenY = image.ScreenTop + centerY;
            return true;
        }

        private static bool IsDark(PixelImage image, int x, int y, double background)
        {
            double value = image.Luminance(x, y);
            bool dark = background - value > 60;
            return dark;
        }

        /// <summary>한 줄을 오른쪽에서 왼쪽으로 훑어 가장 오른쪽 짙은 구간을 찾는다.</summary>
        private static void FindRightmostDarkRun(PixelImage image, int y, int left, int right, double background, out int start, out int end)
        {
            start = -1;
            end = -1;
            for (int x = right - 1; x >= left; x--)
            {
                bool dark = IsDark(image, x, y, background);
                if (dark)
                {
                    if (end < 0)
                    {
                        end = x;
                    }
                    start = x;
                }
                else if (end >= 0)
                {
                    return;
                }
            }
        }

        private static bool IsEmptyBetween(PixelImage image, List<Band> bands, double background)
        {
            for (int y = bands[0].Bottom + 1; y < bands[2].Top; y++)
            {
                bool insideMiddle = y >= bands[1].Top && y <= bands[1].Bottom;
                if (insideMiddle)
                {
                    continue;
                }
                for (int x = bands[0].Start; x <= bands[0].End; x++)
                {
                    bool dark = IsDark(image, x, y, background);
                    if (dark)
                    {
                        return false;
                    }
                }
            }
            return true;
        }
    }
}
