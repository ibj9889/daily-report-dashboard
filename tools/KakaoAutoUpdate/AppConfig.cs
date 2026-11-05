using System;
using System.IO;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;

namespace KakaoAutoUpdate
{
    /// <summary>
    /// private/auto-update.json 설정. 파일이 없으면 기본값으로 만들어 두고 멈춘다.
    /// </summary>
    internal sealed class AppConfig
    {
        public string Description { get; set; } = "카톡 대화 자동 내보내기와 대시보드 갱신 설정. 값을 바꾼 뒤 저장하면 다음 실행부터 반영된다.";

        /// <summary>카카오톡 채팅방 창 제목과 똑같이 적는다. 공개 저장소에 남지 않도록 기본값은 비워 둔다.</summary>
        public string RoomName { get; set; } = "";

        /// <summary>내보낸 txt 를 저장할 폴더. 비워 두면 프로젝트 폴더.</summary>
        public string SaveFolder { get; set; } = "";

        public string KakaoTalkPath { get; set; } = @"C:\Program Files\Kakao\KakaoTalk\KakaoTalk.exe";

        /// <summary>Claude Code CLI 경로. 비워 두면 PATH 의 claude 를 쓴다.</summary>
        public string ClaudePath { get; set; } = "";

        /// <summary>false 면 AI 요약 없이 데이터만 갱신해 올린다 (업데이트.bat 과 같음).</summary>
        public bool RunAiSummary { get; set; } = true;

        public int AiTimeoutMinutes { get; set; } = 60;

        /// <summary>프로그램이 직접 연 채팅방 창은 내보낸 뒤 닫는다.</summary>
        public bool CloseRoomAfterExport { get; set; } = true;

        /// <summary>카카오톡이 꺼져 있을 때 켜고 로그인 화면까지 기다리는 시간.</summary>
        public int StartupWaitSeconds { get; set; } = 40;

        private static JsonSerializerOptions JsonOptions()
        {
            JsonSerializerOptions options = new JsonSerializerOptions();
            options.WriteIndented = true;
            options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            // 한글을 \uXXXX 로 바꾸지 않고 그대로 저장
            options.Encoder = JavaScriptEncoder.Create(UnicodeRanges.All);
            return options;
        }

        /// <summary>설정을 읽는다. 파일이 없으면 기본값 파일을 만들고 created=true 를 돌려준다.</summary>
        public static AppConfig LoadOrCreate(string path, out bool created)
        {
            created = false;
            if (!File.Exists(path))
            {
                AppConfig defaults = new AppConfig();
                string json = JsonSerializer.Serialize(defaults, JsonOptions());
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.WriteAllText(path, json, new UTF8Encoding(false));
                created = true;
                return defaults;
            }

            string text = File.ReadAllText(path, Encoding.UTF8);
            AppConfig loaded = JsonSerializer.Deserialize<AppConfig>(text, JsonOptions());
            if (loaded == null)
            {
                throw new InvalidDataException("설정 파일을 읽지 못했습니다: " + path);
            }
            return loaded;
        }
    }
}
