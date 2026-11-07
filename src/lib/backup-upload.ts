import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { request } from "node:https";
export async function uploadBackup(file: string, objectKey: string) {
  const configured = process.env.BACKUP_UPLOAD_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Backup destination must use HTTPS");
  url.pathname = url.pathname.replace(/\/$/, "") + "/" + encodeURIComponent(objectKey);
  const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk);
  const sha256 = hash.digest("hex"); const size = (await stat(file)).size;
  await new Promise<void>((resolve, reject) => {
    const req = request(url, { method: "PUT", signal: AbortSignal.timeout(120_000), headers: { "content-type": "application/octet-stream", "content-length": size, "x-content-sha256": sha256, ...(process.env.BACKUP_UPLOAD_TOKEN ? { authorization: `Bearer ${process.env.BACKUP_UPLOAD_TOKEN}` } : {}) } }, response => {
      response.resume();
      response.on("end", () => response.statusCode && response.statusCode >= 200 && response.statusCode < 300 ? resolve() : reject(new Error("Remote backup upload rejected")));
      response.on("error", reject);
    });
    req.on("error", reject); createReadStream(file).on("error", reject).pipe(req);
  });
  return { objectKey, sha256, size };
}
