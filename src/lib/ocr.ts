import { fetchImage } from "./image-download";
import { createHash } from "node:crypto";
import type { AppSettings } from "./settings";
export function ocrRunsInThisProcess() { return false; }
export function imageHash(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
export async function downloadImage(url: string) { return fetchImage(url).catch(() => null); }
export async function ocrImage(_url: string, _settings: AppSettings): Promise<string> { void _url; void _settings;  return ""; }
export async function ocrPostImages(_urls: string[], _settings: AppSettings): Promise<string> { void _urls; void _settings;  return ""; }
