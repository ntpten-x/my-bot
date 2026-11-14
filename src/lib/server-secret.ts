import { constants, closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
type SecretName = "AI_KEY_SECRET" | "BACKUP_ENCRYPTION_KEY" | "SECURITY_AUDIT_KEY" | "BOOTSTRAP_TOKEN" | "SESSION_SIGNING_KEY" | "AI_KEY_SECRET_PREVIOUS" | "SECURITY_AUDIT_PREVIOUS_KEYS";
/** Supports a Vault/KMS agent's mounted files without exposing keys to browser code. */
export function serverSecret(name: SecretName) {
  const directory = process.env.SECRET_STORE_DIRECTORY;
  if (!directory) return process.env[name] || "";
  const file = path.join(path.resolve(directory), name);
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return process.env[name] || ""; throw new Error("Secret store unavailable"); }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16_384 || (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())))) throw new Error("Secret store permissions invalid");
    return readFileSync(fd, "utf8").trim();
  } finally { closeSync(fd); }
}

export function previousSecrets(name: "AI_KEY_SECRET_PREVIOUS" | "SECURITY_AUDIT_PREVIOUS_KEYS") {
  const value = JSON.parse(serverSecret(name) || "[]") as unknown;
  if (!Array.isArray(value) || value.length > 4 || value.some(key => typeof key !== "string" || key.length < 16)) throw new Error("Secret keyring configuration invalid");
  return value as string[];
}
