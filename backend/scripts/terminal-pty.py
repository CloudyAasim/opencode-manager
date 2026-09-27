#!/usr/bin/env python3
"""Minimal PTY bridge for the OpenCode Manager web terminal.

The manager spawns this script with an extra pipe on file descriptor 3.
Protocol:
  - raw bytes on stdin  -> written to the PTY
  - PTY output          -> written to stdout
  - newline-delimited JSON on fd 3 for control messages:
      {"type": "resize", "cols": <int>, "rows": <int>}
      {"type": "close"}

Configuration is read from the environment:
  OCM_PTY_SHELL, OCM_PTY_CWD, OCM_PTY_COLS, OCM_PTY_ROWS, OCM_PTY_TERM
"""
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios

CTRL_FD = 3
READ_SIZE = 65536


def build_shell_argv(shell: str) -> list:
    bind = os.environ.get("OCM_PTY_BIND")
    if not bind:
        return [shell, "-i"]

    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "terminal-sandbox.sh")
    if not os.path.exists(script):
        sys.stderr.write("terminal-pty: sandbox script not found; running without workspace isolation\n")
        return [shell, "-i"]

    sandbox_cwd = os.environ.get("OCM_PTY_SANDBOX_CWD") or "/workspace"
    return [
        "unshare",
        "--user",
        "--map-root-user",
        "--mount",
        "--propagation",
        "unchanged",
        "--",
        "/bin/sh",
        script,
        shell,
        bind,
        sandbox_cwd,
        "-i",
    ]


def set_winsize(fd: int, cols: int, rows: int) -> None:
    packed = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, packed)


def write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        view = view[written:]


def main() -> int:
    shell = os.environ.get("OCM_PTY_SHELL", "/bin/bash")
    cwd = os.environ.get("OCM_PTY_CWD", "/")
    term = os.environ.get("OCM_PTY_TERM", "xterm-256color")
    try:
        cols = int(os.environ.get("OCM_PTY_COLS", "120"))
        rows = int(os.environ.get("OCM_PTY_ROWS", "30"))
    except ValueError:
        cols, rows = 120, 30

    pid, master = pty.fork()
    if pid == 0:
        try:
            os.chdir(cwd)
        except OSError:
            pass
        env = dict(os.environ)
        env["TERM"] = term
        env["COLORTERM"] = "truecolor"
        env["PWD"] = cwd
        argv = build_shell_argv(shell)
        try:
            os.execvpe(argv[0], argv, env)
        except OSError:
            os._exit(127)

    set_winsize(master, cols, rows)
    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()

    try:
        while True:
            try:
                readable, _, _ = select.select([stdin_fd, master, CTRL_FD], [], [])
            except InterruptedError:
                continue

            if master in readable:
                try:
                    data = os.read(master, READ_SIZE)
                except OSError as error:
                    if error.errno in (errno.EIO, errno.EBADF):
                        break
                    raise
                if not data:
                    break
                write_all(stdout_fd, data)

            if stdin_fd in readable:
                data = os.read(stdin_fd, READ_SIZE)
                if not data:
                    try:
                        os.write(master, b"\x04")
                    except OSError:
                        pass
                    break
                write_all(master, data)

            if CTRL_FD in readable:
                raw = os.read(CTRL_FD, READ_SIZE)
                if not raw:
                    break
                for line in raw.decode("utf-8", "ignore").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        message = json.loads(line)
                    except ValueError:
                        continue
                    kind = message.get("type")
                    if kind == "resize":
                        try:
                            cols = max(1, int(message.get("cols", cols)))
                            rows = max(1, int(message.get("rows", rows)))
                        except (TypeError, ValueError):
                            continue
                        set_winsize(master, cols, rows)
                        try:
                            os.kill(pid, signal.SIGWINCH)
                        except ProcessLookupError:
                            pass
                    elif kind == "close":
                        raise SystemExit(0)

            try:
                reaped, _ = os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                break
            if reaped == pid:
                break
    finally:
        try:
            os.close(master)
        except OSError:
            pass

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as error:  # pragma: no cover - defensive
        sys.stderr.write(f"terminal-pty error: {error}\n")
        sys.exit(1)
