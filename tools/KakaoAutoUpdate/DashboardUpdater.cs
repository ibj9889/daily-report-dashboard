using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace KakaoAutoUpdate
{
    /// <summary>
    /// 내보낸 txt 로 대시보드를 갱신한다.
    ///   AI 요약 켜짐: Claude Code CLI 를 사람 없이 실행해 /update-dashboard 절차를 돌린다.
    ///   AI 요약 꺼짐: node 빌드, git 커밋, push 만 한다 (업데이트.bat 과 같음).
    /// </summary>
    internal sealed class DashboardUpdater
    {
        private const string SuccessMark = "자동업데이트 결과: 성공";

        private readonly AppConfig config;
        private readonly Logger log;
        private readonly string projectRoot;

        public DashboardUpdater(AppConfig config, Logger log, string projectRoot)
        {
            this.config = config;
            this.log = log;
            this.projectRoot = projectRoot;
        }

        // ------------------------------------------------------------ AI 요약 포함

        public bool RunAiUpdate()
        {
            string claude = ResolveClaudePath();
            string prompt = BuildPrompt();
            if (prompt == null)
            {
                return false;
            }

            List<string> arguments = new List<string>();
            arguments.Add("-p");
            arguments.Add(prompt);
            arguments.Add("--permission-mode");
            arguments.Add("acceptEdits");
            arguments.Add("--allowedTools");
            arguments.Add("Read,Write,Edit,Glob,Grep,Agent,Bash,TodoWrite");
            arguments.Add("--output-format");
            arguments.Add("text");

            log.Info("Claude Code 로 AI 요약과 대시보드 갱신을 실행합니다. 몇 분 걸립니다.");
            log.Info("실행 파일: " + claude);
            StringBuilder output = new StringBuilder();
            int timeoutMs = config.AiTimeoutMinutes * 60 * 1000;
            int exitCode = RunProcess(claude, arguments, timeoutMs, output);

            string text = output.ToString();
            bool reportedSuccess = text.Contains(SuccessMark);
            log.Info("Claude 종료 코드: " + exitCode);
            if (exitCode != 0)
            {
                log.Error("Claude Code 실행이 실패했습니다. 위 출력을 확인하세요.");
                return false;
            }
            if (!reportedSuccess)
            {
                log.Warn("Claude 결과에 성공 표시가 없습니다. 위 출력을 확인하세요.");
            }

            bool pushed = CheckPushed();
            bool succeeded = pushed && reportedSuccess;
            return succeeded;
        }

        private string ResolveClaudePath()
        {
            if (!string.IsNullOrWhiteSpace(config.ClaudePath))
            {
                return config.ClaudePath;
            }
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string usual = Path.Combine(home, ".local", "bin", "claude.exe");
            if (File.Exists(usual))
            {
                return usual;
            }
            return "claude";
        }

        /// <summary>.claude/commands/update-dashboard.md 본문 앞에 자동 실행 안내를 붙인다.</summary>
        private string BuildPrompt()
        {
            string commandFile = Path.Combine(projectRoot, ".claude", "commands", "update-dashboard.md");
            if (!File.Exists(commandFile))
            {
                log.Error("업데이트 절차 파일이 없습니다: " + commandFile);
                return null;
            }
            string body = File.ReadAllText(commandFile, Encoding.UTF8);
            body = StripFrontMatter(body);

            StringBuilder prompt = new StringBuilder();
            prompt.AppendLine("[자동 실행 안내]");
            prompt.AppendLine("이 작업은 예약 프로그램이 사람 없이 실행한 것이다. 사용자에게 질문하거나 확인을 기다리지 말고 끝까지 진행한다.");
            prompt.AppendLine("- 카톡 대화 txt 는 방금 프로그램이 프로젝트 폴더에 새로 저장했다.");
            prompt.AppendLine("- members.json 에 없는 대화명이 나와도 멈추지 말고 그대로 진행하고, 마지막 보고에 그 대화명을 적는다.");
            prompt.AppendLine("- 월간 요약은 비용이 크다. todo.json 의 months 중 이미 끝난 달은 쓰고, 이번 달은 오늘(한국 시간)이 월요일이거나 이번 달 요약이 아직 하나도 없을 때만 쓴다.");
            prompt.AppendLine("- 실패해도 private 폴더와 카톡 txt 는 커밋하지 않는다. 파일 삭제 명령은 쓰지 않는다.");
            prompt.AppendLine("- 맨 마지막 줄에 '" + SuccessMark + "' 또는 '자동업데이트 결과: 실패 (이유)' 를 한 줄로 쓴다.");
            prompt.AppendLine();
            prompt.AppendLine(body);
            string result = prompt.ToString();
            return result;
        }

        private static string StripFrontMatter(string text)
        {
            string trimmed = text.TrimStart('﻿');
            if (!trimmed.StartsWith("---", StringComparison.Ordinal))
            {
                return trimmed;
            }
            int end = trimmed.IndexOf("\n---", 3, StringComparison.Ordinal);
            if (end < 0)
            {
                return trimmed;
            }
            int bodyStart = trimmed.IndexOf('\n', end + 4);
            if (bodyStart < 0)
            {
                return "";
            }
            string body = trimmed.Substring(bodyStart + 1);
            return body;
        }

        // ------------------------------------------------------------ 데이터만

        public bool RunDataOnlyUpdate()
        {
            log.Info("AI 요약 없이 데이터만 갱신합니다.");
            StringBuilder output = new StringBuilder();
            int build = RunProcess("node", new List<string> { "scripts/build.mjs" }, 5 * 60 * 1000, output);
            if (build != 0)
            {
                log.Error("빌드 실패");
                return false;
            }
            int add = RunProcess("git", new List<string> { "add", "docs" }, 60 * 1000, output);
            if (add != 0)
            {
                return false;
            }
            string message = "데이터 업데이트 " + DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            int commit = RunProcess("git", new List<string> { "commit", "-q", "-m", message }, 60 * 1000, output);
            if (commit != 0)
            {
                log.Warn("커밋할 변경이 없거나 커밋에 실패했습니다.");
            }
            int push = RunProcess("git", new List<string> { "push", "-q" }, 3 * 60 * 1000, output);
            if (push != 0)
            {
                log.Error("git push 실패");
                return false;
            }
            bool pushed = CheckPushed();
            return pushed;
        }

        // ------------------------------------------------------------ 공통

        /// <summary>올리지 못한 커밋이 남아 있으면 실패로 본다.</summary>
        private bool CheckPushed()
        {
            StringBuilder output = new StringBuilder();
            RunProcess("git", new List<string> { "fetch", "-q" }, 60 * 1000, output);
            output.Clear();
            RunProcess("git", new List<string> { "status", "-sb" }, 30 * 1000, output);
            string status = output.ToString();
            string firstLine = status.Split('\n')[0];
            bool ahead = firstLine.Contains("ahead");
            if (ahead)
            {
                log.Error("GitHub 에 아직 올라가지 않은 커밋이 있습니다: " + firstLine.Trim());
                return false;
            }
            output.Clear();
            RunProcess("git", new List<string> { "log", "-1", "--format=%h %s (%cd)", "--date=format:%m/%d %H:%M" }, 30 * 1000, output);
            string lastCommit = output.ToString().Trim();
            log.Info("최신 커밋: " + lastCommit);
            return true;
        }

        /// <summary>외부 프로그램을 실행하고 출력을 로그와 output 에 남긴다. 종료 코드를 돌려준다.</summary>
        private int RunProcess(string fileName, List<string> arguments, int timeoutMs, StringBuilder output)
        {
            ProcessStartInfo info = new ProcessStartInfo(fileName);
            foreach (string argument in arguments)
            {
                info.ArgumentList.Add(argument);
            }
            info.WorkingDirectory = projectRoot;
            info.UseShellExecute = false;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;
            info.CreateNoWindow = true;

            OutputSink sink = new OutputSink(log, output);
            using (Process process = new Process())
            {
                process.StartInfo = info;
                process.OutputDataReceived += sink.OnLine;
                process.ErrorDataReceived += sink.OnLine;
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                bool finished = process.WaitForExit(timeoutMs);
                if (!finished)
                {
                    log.Error(fileName + " 이(가) " + (timeoutMs / 60000) + "분 안에 끝나지 않아 종료합니다.");
                    process.Kill(true);
                    return -1;
                }
                // 비동기 출력이 다 들어올 때까지 한 번 더 기다린다
                process.WaitForExit();
                int exitCode = process.ExitCode;
                return exitCode;
            }
        }

        /// <summary>출력 이벤트를 이름 있는 메서드로 받기 위한 작은 클래스.</summary>
        private sealed class OutputSink
        {
            private readonly Logger log;
            private readonly StringBuilder output;

            public OutputSink(Logger log, StringBuilder output)
            {
                this.log = log;
                this.output = output;
            }

            public void OnLine(object sender, DataReceivedEventArgs e)
            {
                string line = e.Data;
                if (line == null)
                {
                    return;
                }
                lock (output)
                {
                    output.AppendLine(line);
                }
                log.Raw(line);
            }
        }
    }
}
