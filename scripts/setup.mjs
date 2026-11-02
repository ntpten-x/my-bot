import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const windows = process.platform === "win32";
const command = windows ? "powershell.exe" : "bash";
const args = windows
  ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "windows", "setup.ps1")]
  : [path.join(root, "scripts", "setup.sh")];

const child = spawn(command, args, { stdio: "inherit", cwd: root });
child.on("exit", (code) => process.exit(code ?? 1));
