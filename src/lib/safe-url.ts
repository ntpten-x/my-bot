/** URLs from imported content are data, never executable browser navigation. */
export function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return value.length <= 4096 && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
