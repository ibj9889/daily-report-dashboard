using System;
using System.IO;
using System.Text;

namespace KakaoAutoUpdate
{
    /// <summary>
    /// 화면과 logs 폴더 파일에 같은 내용을 남긴다. 예약 실행 때는 이 파일로 결과를 확인한다.
    /// </summary>
    internal sealed class Logger
    {
        private readonly string filePath;
        private readonly object sync = new object();

        public Logger(string logFolder)
        {
            Directory.CreateDirectory(logFolder);
            string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            filePath = Path.Combine(logFolder, "자동업데이트-" + stamp + ".log");
        }

        public string FilePath
        {
            get { return filePath; }
        }

        public void Info(string message)
        {
            Write("    ", message);
        }

        public void Step(string message)
        {
            Write("[단계]", message);
        }

        public void Warn(string message)
        {
            Write("[주의]", message);
        }

        public void Error(string message)
        {
            Write("[실패]", message);
        }

        /// <summary>Claude CLI 같은 외부 프로그램 출력을 그대로 남긴다.</summary>
        public void Raw(string line)
        {
            if (line == null)
            {
                return;
            }
            Write("  | ", line);
        }

        private void Write(string tag, string message)
        {
            string time = DateTime.Now.ToString("HH:mm:ss");
            string line = time + " " + tag + " " + message;
            lock (sync)
            {
                Console.WriteLine(line);
                File.AppendAllText(filePath, line + Environment.NewLine, new UTF8Encoding(false));
            }
        }
    }
}
