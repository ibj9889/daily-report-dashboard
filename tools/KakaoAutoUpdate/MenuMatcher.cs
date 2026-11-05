using System;
using System.Collections.Generic;
using System.Text;

namespace KakaoAutoUpdate
{
    /// <summary>
    /// OCR 로 읽은 메뉴 줄 중에서 원하는 항목을 고른다.
    /// OCR 은 작은 글자를 한두 글자 틀리게 읽기도 해서(예: "대화 나용") 한글만 남겨 편집 거리로 비교한다.
    /// 안전 규칙
    ///   - "삭제", "나가기" 가 들어간 줄은 후보에서 뺀다 (대화 내용 모두 삭제, 채팅방 나가기)
    ///   - 목표와 1글자 이내로 다른 줄이 정확히 1개여야 한다
    ///   - 두 번째로 가까운 줄은 3글자 이상 달라야 한다 (헷갈릴 여지가 없을 때만 누른다)
    /// </summary>
    internal static class MenuMatcher
    {
        private const int MaxDistance = 1;
        private const int MinMarginToSecond = 3;

        public static OcrLineInfo FindLine(List<OcrLineInfo> lines, string wanted, out string reason)
        {
            string target = HangulOnly(wanted);
            OcrLineInfo best = null;
            int bestDistance = int.MaxValue;
            int secondDistance = int.MaxValue;

            foreach (OcrLineInfo line in lines)
            {
                string hangul = HangulOnly(line.Text);
                if (hangul.Length == 0)
                {
                    continue;
                }
                bool dangerous = hangul.Contains("삭제") || hangul.Contains("나가기");
                if (dangerous)
                {
                    continue;
                }
                int distance = EditDistance(hangul, target);
                if (distance < bestDistance)
                {
                    secondDistance = bestDistance;
                    bestDistance = distance;
                    best = line;
                }
                else if (distance < secondDistance)
                {
                    secondDistance = distance;
                }
            }

            if (best == null || bestDistance > MaxDistance)
            {
                reason = "'" + wanted + "' 와 비슷한 줄이 없음 (가장 가까운 거리 " + DistanceText(bestDistance) + ")";
                return null;
            }
            if (secondDistance - bestDistance < MinMarginToSecond)
            {
                reason = "'" + wanted + "' 후보가 둘 이상이라 고르지 않음 (거리 " + bestDistance + ", " + DistanceText(secondDistance) + ")";
                return null;
            }
            reason = "'" + best.Text + "' 선택 (거리 " + bestDistance + ")";
            return best;
        }

        private static string DistanceText(int distance)
        {
            if (distance == int.MaxValue)
            {
                return "없음";
            }
            return distance.ToString();
        }

        /// <summary>한글 음절만 남긴다. "대화 내보내기 Ctrl+S" 는 "대화내보내기" 가 된다.</summary>
        public static string HangulOnly(string text)
        {
            StringBuilder builder = new StringBuilder();
            foreach (char c in text)
            {
                bool isSyllable = c >= '가' && c <= '힣';
                if (isSyllable)
                {
                    builder.Append(c);
                }
            }
            string result = builder.ToString();
            return result;
        }

        /// <summary>두 문자열이 몇 글자 다른지 (삽입, 삭제, 바꾸기 횟수).</summary>
        public static int EditDistance(string a, string b)
        {
            int[,] table = new int[a.Length + 1, b.Length + 1];
            for (int i = 0; i <= a.Length; i++)
            {
                table[i, 0] = i;
            }
            for (int j = 0; j <= b.Length; j++)
            {
                table[0, j] = j;
            }
            for (int i = 1; i <= a.Length; i++)
            {
                for (int j = 1; j <= b.Length; j++)
                {
                    int cost = a[i - 1] == b[j - 1] ? 0 : 1;
                    int deletion = table[i - 1, j] + 1;
                    int insertion = table[i, j - 1] + 1;
                    int substitution = table[i - 1, j - 1] + cost;
                    int smallest = Math.Min(deletion, Math.Min(insertion, substitution));
                    table[i, j] = smallest;
                }
            }
            int distance = table[a.Length, b.Length];
            return distance;
        }
    }
}
