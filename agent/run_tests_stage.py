#!/usr/bin/env python3
"""
Jarvis test stage - RUNS AI-WRITTEN CODE. THIS PROCESS MUST NEVER RECEIVE SECRETS.

It is executed by the "test" job, which has no API keys, no GH_TOKEN and
read-only permissions, so anything the tests do (read /proc, env, disk)
finds nothing worth stealing. It deliberately does NOT import jarvis_agent.py,
so it stays small enough to audit on its own.

Usage:  python3 agent/run_tests_stage.py <tree_dir>

It does exactly three things:
  1. detect the test command for <tree_dir>: pytest, unittest discovery, or npm test
  2. run it inside <tree_dir> with a 600 second timeout
  3. write result.json NEXT TO <tree_dir> (i.e. in its parent directory):
       {"status": "passed" | "failed" | "no_tests" | "timeout",
        "output": "<last 8000 chars of stdout+stderr>",
        "command": "<the command that ran, or empty>"}

Exit code: 0 for passed / no_tests, 1 for failed / timeout, so the job shows red
when tests fail. result.json is always written first.

Dependencies (pytest, npm packages) are installed by the workflow before this
script runs, still inside the secret-free job. Standard library only.
"""

import json
import os
import re
import subprocess
import sys

TIMEOUT_SECONDS = 600
OUTPUT_LIMIT = 8000
IGNORED_DIRS = (".git", "node_modules", ".venv", "venv", "__pycache__")
PYTHON_TEST_FILE = re.compile(r"(test_.*\.py|.*_test\.py)$")


def has_python_tests(root):
    """True if there is a tests/ folder or any test_*.py / *_test.py file."""
    if os.path.isdir(os.path.join(root, "tests")):
        return True
    for current, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
        if any(PYTHON_TEST_FILE.match(name) for name in files):
            return True
    return False


def has_npm_test_script(root):
    """True if the top-level package.json declares a "test" script."""
    try:
        with open(os.path.join(root, "package.json"), encoding="utf-8") as handle:
            return "test" in (json.load(handle).get("scripts") or {})
    except (OSError, ValueError):
        return False


def pytest_available():
    """True if `python -m pytest` works in this environment."""
    probe = subprocess.run([sys.executable, "-m", "pytest", "--version"], capture_output=True, text=True)
    return probe.returncode == 0


def detect_test_command(root):
    """Return the command list to run, or None when the project has no tests.
    Python tests win over npm when both exist."""
    if has_python_tests(root):
        if pytest_available():
            return [sys.executable, "-m", "pytest", "-q"]
        start_dir = "tests" if os.path.isdir(os.path.join(root, "tests")) else "."
        return [sys.executable, "-m", "unittest", "discover", "-s", start_dir, "-v"]
    if has_npm_test_script(root):
        return ["npm", "test", "--silent"]
    return None


def run_command(command, root):
    """Run the tests inside root. Returns (status, output)."""
    try:
        proc = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as error:
        partial = (error.stdout or b"")
        partial = partial.decode("utf-8", "replace") if isinstance(partial, bytes) else partial
        return "timeout", f"Tests timed out after {TIMEOUT_SECONDS}s\n{partial}"
    output = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
    # pytest exits 5 when it collected nothing; unittest prints "Ran 0 tests".
    pytest_no_tests = proc.returncode == 5 and any("pytest" in part for part in command)
    nothing_ran = proc.returncode == 0 and ("Ran 0 tests" in output or "no tests ran" in output)
    if pytest_no_tests or nothing_ran:
        return "no_tests", output
    return ("passed" if proc.returncode == 0 else "failed"), output


def write_result(tree_dir, status, output, command):
    """Write result.json next to tree_dir and return its path."""
    path = os.path.join(os.path.dirname(os.path.abspath(tree_dir)), "result.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"status": status, "output": output[-OUTPUT_LIMIT:], "command": " ".join(command)}, handle, indent=2)
    return path


def main(argv):
    if len(argv) != 2 or not os.path.isdir(argv[1]):
        print("usage: run_tests_stage.py <tree_dir>", file=sys.stderr)
        return 2
    root = os.path.abspath(argv[1])
    command = detect_test_command(root)
    if command is None:
        status, output = "no_tests", "No test command detected (no Python tests, no npm test script)."
        command = []
    else:
        print(f"[test-stage] running: {' '.join(command)}  (cwd={root})", flush=True)
        status, output = run_command(command, root)
    path = write_result(root, status, output, command)
    print(f"[test-stage] status={status} -> {path}", flush=True)
    print(output[-3000:], flush=True)
    return 0 if status in ("passed", "no_tests") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
