import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { publicAddress } from "./image-download";

/** Read-only public feeds: validate every hop and pin all DNS answers to the socket. */
export async function fetchPublicText(value: string, options: { maxBytes?: number; timeoutMs?: number } = {}): Promise<string> {
  const maxBytes = options.maxBytes ?? 2_000_000;
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  async function visit(value: string, hops: number): Promise<string> {
    const url = new URL(value);
    if (hops > 3 || value.length > 4096 || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) throw new Error("Feed destination not allowed");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Feed destination not allowed");
    const remaining = () => { const ms = deadline - Date.now(); if (ms <= 0) throw new Error("Feed request timed out"); return ms; };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Feed DNS timed out")), remaining()); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (!addresses.length || addresses.some(row => !publicAddress(row.address))) throw new Error("Feed destination not allowed");
    const result = await new Promise<{ text?: string; redirect?: string }>((resolve, reject) => {
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: "GET", signal: AbortSignal.timeout(remaining()), headers: { "user-agent": "MY-BOT/1.0 (+local lead radar)", "accept-encoding": "identity" },
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        },
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
          const location = res.headers.location; res.destroy();
          if (!location) { reject(new Error("Invalid feed redirect")); return; }
          try { resolve({ redirect: new URL(location, url).href }); } catch { reject(new Error("Invalid feed redirect")); }
          return;
        }
        if (res.statusCode !== 200 || Number(res.headers["content-length"]) > maxBytes || (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) {
          res.destroy(); reject(new Error("Feed response rejected")); return;
        }
        const chunks: Buffer[] = []; let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) { res.destroy(); reject(new Error("Feed response too large")); } else chunks.push(chunk);
        });
        res.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => reject(new Error("Feed response interrupted")));
        res.on("aborted", () => reject(new Error("Feed response interrupted")));
      });
      req.on("error", () => reject(new Error("Feed connection failed"))); req.end();
    });
    return result.redirect ? visit(result.redirect, hops + 1) : result.text ?? "";
  }
  return visit(value, 0);
}
