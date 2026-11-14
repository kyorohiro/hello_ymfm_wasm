# SPDX-License-Identifier: BSD-3-Clause
"""Local-only regressions; subprocesses are mocked or replaced by fixtures."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).with_name("set_tauri_apple_password.py")
SPEC = importlib.util.spec_from_file_location("tauri_password_helper", SCRIPT)
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)
PASSWORD = "fixture-only-app-password"
REPOSITORIES = ["owner/tetorica-dmg-synth-tauri", "owner/tetorica-sid-synth-tauri"]


class TauriApplePasswordTests(unittest.TestCase):
    def test_github_origin_formats_and_rejection_without_credentials(self):
        expected = REPOSITORIES[0]
        for value in ["git@github.com:" + expected + ".git",
                      "https://github.com/" + expected,
                      "ssh://git@github.com/" + expected + ".git"]:
            self.assertEqual(helper.github_repository(value), expected)
        for value in ["https://" + PASSWORD + "@example.com/owner/tetorica-dmg-synth-tauri",
                      "https://github.com/owner/unrelated", "file:///tmp/repository"]:
            with self.assertRaises(ValueError) as error:
                helper.github_repository(value)
            self.assertNotIn(PASSWORD, str(error.exception))

    def test_discovery_handles_worktrees_deduplicates_and_sorts(self):
        with tempfile.TemporaryDirectory(prefix="tauri password fixture ") as temp:
            workspace = Path(temp)
            for name in ["tetorica-z-tauri", "tetorica-a-tauri", "tetorica-copy-tauri"]:
                folder = workspace / name
                folder.mkdir()
                if name == "tetorica-copy-tauri":
                    (folder / ".git").write_text("gitdir: fixture worktree\n")
                else:
                    (folder / ".git").mkdir()
            (workspace / "tetorica-uncloned-tauri").mkdir()

            def origin(command, **options):
                self.assertEqual(command[:2], ["git", "-C"])
                self.assertTrue(options["capture_output"])
                name = Path(command[2]).name
                repository = REPOSITORIES[0 if name != "tetorica-z-tauri" else 1]
                return subprocess.CompletedProcess(command, 0, "git@github.com:" + repository + ".git\n", "")

            with mock.patch.object(helper.subprocess, "run", side_effect=origin) as run:
                self.assertEqual(helper.find_repositories(workspace), REPOSITORIES)
            self.assertEqual(run.call_count, 3)

    def test_bad_remote_does_not_include_raw_origin_in_errors(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / "tetorica-dmg-tauri"
            folder.mkdir()
            (folder / ".git").mkdir()
            result = subprocess.CompletedProcess([], 0, "https://" + PASSWORD + "@example.com/repo", "")
            with mock.patch.object(helper.subprocess, "run", return_value=result):
                with self.assertRaises(ValueError) as error:
                    helper.find_repositories(Path(temp))
            self.assertNotIn(PASSWORD, str(error.exception))

    def test_dry_run_never_requests_a_password_or_contacts_github(self):
        output = io.StringIO()
        with mock.patch.object(helper, "find_repositories", return_value=REPOSITORIES), \
             mock.patch.object(helper.shutil, "which") as which, \
             mock.patch.object(helper.subprocess, "run") as run, \
             mock.patch.object(helper.getpass, "getpass") as prompt, \
             contextlib.redirect_stdout(output):
            self.assertEqual(helper.main(["--dry-run"]), 0)
        which.assert_not_called()
        run.assert_not_called()
        prompt.assert_not_called()
        self.assertIn("2 repositories; no secrets changed", output.getvalue())

    def test_hidden_prompt_is_read_once_for_all_targets(self):
        calls = []

        def run(command, **options):
            calls.append((command, options))
            return subprocess.CompletedProcess(command, 0)

        with mock.patch.dict(os.environ, {"PATH": os.environ.get("PATH", "")}, clear=True), \
             mock.patch.object(helper, "find_repositories", return_value=REPOSITORIES), \
             mock.patch.object(helper.shutil, "which", return_value="/fixture/gh"), \
             mock.patch.object(helper.sys.stdin, "isatty", return_value=True), \
             mock.patch.object(helper.getpass, "getpass", return_value=PASSWORD) as prompt, \
             mock.patch.object(helper.subprocess, "run", side_effect=run), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(helper.main([]), 0)
        prompt.assert_called_once()
        self.assertEqual(len(calls), 3)
        for command, options in calls[1:]:
            self.assertNotIn(PASSWORD, " ".join(command))
            self.assertEqual(options["input"], PASSWORD.encode())
            self.assertEqual(options["stdout"], subprocess.DEVNULL)
            self.assertEqual(options["stderr"], subprocess.DEVNULL)
            self.assertNotIn("APPLE_PASSWORD", options["env"])
        self.assertNotIn(PASSWORD, output.getvalue())

    def test_environment_input_is_removed_from_children_and_failures_continue(self):
        calls = []

        def run(command, **options):
            calls.append((command, options))
            failed = (command[1:3] == ["secret", "set"]
                      and command[command.index("--repo") + 1] == "github.com/" + REPOSITORIES[0])
            return subprocess.CompletedProcess(command, int(failed), PASSWORD, PASSWORD)

        with mock.patch.dict(os.environ, {"APPLE_PASSWORD": PASSWORD,
                                        "APPLE_APP_SPECIFIC_PASSWORD": "other-fixture-password",
                                        "GH_TOKEN": "fixture-github-auth"}, clear=True), \
             mock.patch.object(helper, "find_repositories", return_value=REPOSITORIES), \
             mock.patch.object(helper.shutil, "which", return_value="/fixture/gh"), \
             mock.patch.object(helper.getpass, "getpass") as prompt, \
             mock.patch.object(helper.subprocess, "run", side_effect=run), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(helper.main([]), 1)
        prompt.assert_not_called()
        self.assertEqual(len(calls), 3)
        self.assertEqual(
            [command[command.index("--repo") + 1] for command, _ in calls[1:]],
            ["github.com/" + repository for repository in REPOSITORIES],
        )
        for command, options in calls:
            self.assertNotIn(PASSWORD, " ".join(command))
            self.assertNotIn("APPLE_PASSWORD", options["env"])
            self.assertNotIn("APPLE_APP_SPECIFIC_PASSWORD", options["env"])
            self.assertEqual(options["env"]["GH_TOKEN"], "fixture-github-auth")
        self.assertIn("Failed: " + REPOSITORIES[0], output.getvalue())
        self.assertIn("Updated: " + REPOSITORIES[1], output.getvalue())
        self.assertNotIn(PASSWORD, output.getvalue())

    def test_noninteractive_input_and_invalid_password_never_upload(self):
        with mock.patch.dict(os.environ, {}, clear=True), \
             mock.patch.object(helper, "find_repositories", return_value=REPOSITORIES), \
             mock.patch.object(helper.shutil, "which", return_value="/fixture/gh"), \
             mock.patch.object(helper.sys.stdin, "isatty", return_value=False), \
             mock.patch.object(helper.getpass, "getpass") as prompt, \
             mock.patch.object(helper, "register_password") as upload, \
             mock.patch.object(helper.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)), \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, "interactively"):
                helper.main([])
        prompt.assert_not_called()
        upload.assert_not_called()
        with mock.patch.object(helper.subprocess, "run") as run:
            for password in ["", "contains\nnewline", "contains\rcarriage", "contains\0nul"]:
                with self.assertRaises(ValueError):
                    helper.register_password(REPOSITORIES, password)
            run.assert_not_called()

    def test_actual_cli_suppresses_a_child_that_echoes_stdin(self):
        with tempfile.TemporaryDirectory(prefix="tauri password cli ") as temp:
            root = Path(temp)
            workspace, binaries = root / "w", root / "bin"
            workspace.mkdir()
            binaries.mkdir()
            folder = workspace / "tetorica-fixture-tauri"
            folder.mkdir()
            (folder / ".git").mkdir()
            git = binaries / "git"
            git.write_text("#!" + sys.executable + "\nprint('git@github.com:owner/tetorica-fixture-tauri.git')\n")
            gh = binaries / "gh"
            gh.write_text("#!" + sys.executable + "\nimport sys\n"
                          "if sys.argv[1:3]==['auth','status']: sys.exit(0)\n"
                          "value=sys.stdin.read(); print(value); print(value,file=sys.stderr); sys.exit(1)\n")
            git.chmod(0o755)
            gh.chmod(0o755)
            environment = dict(os.environ, PATH=str(binaries) + os.pathsep + os.environ.get("PATH", ""),
                               APPLE_PASSWORD=PASSWORD)
            result = subprocess.run([sys.executable, str(SCRIPT), "--workspace", str(workspace)],
                                    env=environment, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertIn("Failed: owner/tetorica-fixture-tauri", result.stdout)
            self.assertNotIn(PASSWORD, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
