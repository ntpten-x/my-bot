import { readFile, writeFile, rename, chmod, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// The setup script sends the value on stdin. Do not log it or put it in argv.
const key = process.argv[2];
if (!/^[A-Z][A-Z0-9_]*$/.test(key || "")) throw new Error("Invalid environment variable name");
let value = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) value += chunk;
if (/[\r\n\0]/.test(value)) throw new Error("Environment values must be single-line");
// Our env readers remove the outer quotes without unescaping; choose a compatible quote.
if (value.includes('"') && value.includes("'")) throw new Error("Value contains both quote styles; configure it in Settings instead");
const quote = value.includes('"') ? "'" : '"';
const line = `${key}=${quote}${value}${quote}`;
const file = ".env";
const content = await readFile(file, "utf8");
const pattern = new RegExp(`^[\\t ]*${key}[\\t ]*=`);
let replaced = false;
const lines = content.split(/\r?\n/).flatMap(existing => {
  if (!pattern.test(existing)) return [existing];
  if (replaced) return []; // Avoid different first/last-key behavior across dotenv readers.
  replaced = true;
  return [line];
});
if (!replaced) {
  if (lines[lines.length - 1] === "") lines.pop();
  lines.push(line);
}
const updated = `${lines.join("\n").replace(/\n?$/, "\n")}`;
const temporary = `${file}.${randomUUID()}.tmp`;
try {
  await writeFile(temporary, updated, { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
  await chmod(file, 0o600);
} finally {
  await unlink(temporary).catch(() => undefined);
}
