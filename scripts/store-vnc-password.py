"""Store owner-entered VNC credentials from stdin, never argv/logs. Linux only."""
import ctypes
import ctypes.util
import fcntl
import os
from pathlib import Path
import sys


def main():
    password = sys.stdin.buffer.read(1024).rstrip(b"\r\n")
    if len(password) != 8 or any(b < 33 or b > 126 for b in password):
        raise ValueError("Use exactly 8 printable ASCII characters without spaces.")
    target = Path(sys.argv[1])
    os.umask(0o077)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(target.parent, 0o700)
    with (target.parent / "run.lock").open("a") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Stop the bot desktop before changing its viewer password.")
        if target.is_symlink():
            raise ValueError("Refusing to overwrite a password symlink.")
        library = ctypes.util.find_library("vncserver")
        if not library:
            raise ValueError("Install x11vnc and libvncserver first.")
        store = ctypes.CDLL(library).rfbEncryptAndStorePasswd
        store.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
        store.restype = ctypes.c_int
        if store(password, os.fsencode(target)) != 0:
            raise ValueError("Could not store the local viewer password.")
        os.chmod(target, 0o600)
    print("PASS: local viewer password saved.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
