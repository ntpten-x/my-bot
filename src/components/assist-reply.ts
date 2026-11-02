"use client";

// Opens a Facebook post and asks the MY-BOT extension to type the draft into its comment box.
// The owner always presses send; nothing here (or in the extension) submits anything.
export type AssistResult = { mode: "extension" | "clipboard"; message: string };

export function extensionPresent() {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-mybot-extension");
}

function waitAck(nonce: string, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(false);
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; nonce?: string; ok?: boolean } | null;
      if (!data || data.source !== "mybot-ext" || data.type !== "assist-ack" || data.nonce !== nonce) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(Boolean(data.ok));
    }
    window.addEventListener("message", onMessage);
  });
}

export async function assistReply(url: string, text: string): Promise<AssistResult> {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const copied = navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false);
  const hasExtension = extensionPresent();
  const ack = hasExtension ? waitAck(nonce, 1500) : Promise.resolve(false);
  if (hasExtension) window.postMessage({ source: "mybot-app", type: "assist-reply", nonce, url, text }, window.location.origin);
  const opened = window.open(url, "_blank");
  if (opened) opened.opener = null;
  const [extOk, clip] = await Promise.all([ack, copied]);
  if (extOk) return { mode: "extension", message: "เปิดโพสต์แล้ว ส่วนขยายจะใส่ข้อความในช่องคอมเมนต์ — ตรวจแล้วกดส่งเอง" };
  return { mode: "clipboard", message: clip ? "คัดลอกข้อความแล้ว — วางแล้วกดส่งเอง" : "เปิดโพสต์แล้ว — คัดลอกข้อความด้านล่างไปวางแล้วกดส่งเอง" };
}
