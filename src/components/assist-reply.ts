"use client";

// Opens a Facebook post and asks the MY-BOT extension to show its helper overlay there.
// The overlay can put the draft into the comment box; the owner always presses Facebook's send button.
// Nothing here (or in the extension) submits, posts or comments on the owner's behalf.
export type AssistResult = { mode: "extension" | "clipboard"; message: string; opened: boolean };
export type AssistTemplate = { id: string; name: string; text: string };
export type AssistPrefs = { autoMarkSent?: boolean; autoInsert?: boolean };
export type AssistExtra = { itemId?: string; postId?: string; templates?: AssistTemplate[]; prefs?: AssistPrefs };
type ExtMessage = { source?: string; type?: string; nonce?: string; ok?: boolean; at?: number; reason?: string; error?: string };

export function extensionPresent() {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-mybot-extension");
}

// 1.2.0+ shows the overlay and can open the next queued lead by itself.
export function extensionSupportsAdvance() {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-mybot-extension") === "assist-2";
}

function waitFor(type: string, nonce: string, timeoutMs: number) {
  return new Promise<ExtMessage | null>((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as ExtMessage | null;
      if (!data || data.source !== "mybot-ext" || data.type !== type || data.nonce !== nonce) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data);
    }
    window.addEventListener("message", onMessage);
  });
}

function nonceOf() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function assistReply(url: string, text: string, extra: AssistExtra = {}): Promise<AssistResult> {
  const nonce = nonceOf();
  const copied = navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false);
  const hasExtension = extensionPresent();
  const ack = hasExtension ? waitFor("assist-ack", nonce, 1500) : Promise.resolve(null);
  if (hasExtension) {
    window.postMessage(
      { source: "mybot-app", type: "assist-reply", nonce, url, text, itemId: extra.itemId, postId: extra.postId, templates: extra.templates ?? [], prefs: extra.prefs ?? {} },
      window.location.origin,
    );
  }
  const tab = window.open(url, "_blank");
  if (tab) tab.opener = null;
  const [extAck, clip] = await Promise.all([ack, copied]);
  const opened = Boolean(tab);
  if (extAck?.ok) {
    return {
      mode: "extension",
      opened,
      message: extensionSupportsAdvance()
        ? "เปิดโพสต์แล้ว ใช้กล่อง MY-BOT มุมขวาล่างเพื่อแก้/ใส่ข้อความ แล้วกดส่งใน Facebook เอง"
        : "เปิดโพสต์แล้ว ส่วนขยายจะใส่ข้อความในช่องคอมเมนต์ — ตรวจแล้วกดส่งเอง",
    };
  }
  return { mode: "clipboard", opened, message: clip ? "คัดลอกข้อความแล้ว — วางแล้วกดส่งเอง" : "เปิดโพสต์แล้ว — คัดลอกข้อความด้านล่างไปวางแล้วกดส่งเอง" };
}

// Ask the extension to open the next queued lead once the gap/cap allow (it shows a countdown).
export async function requestAdvance(): Promise<{ ok: boolean; at: number; reason: string }> {
  if (!extensionSupportsAdvance()) return { ok: false, at: 0, reason: "" };
  const nonce = nonceOf();
  const reply = waitFor("queue-advance-ack", nonce, 4000);
  window.postMessage({ source: "mybot-app", type: "queue-advance", nonce }, window.location.origin);
  const data = await reply;
  return { ok: Boolean(data?.ok), at: Number(data?.at) || 0, reason: data?.reason || data?.error || "" };
}

export async function cancelAdvance() {
  if (!extensionSupportsAdvance()) return;
  const nonce = nonceOf();
  const reply = waitFor("queue-advance-cancel-ack", nonce, 2000);
  window.postMessage({ source: "mybot-app", type: "queue-advance-cancel", nonce }, window.location.origin);
  await reply;
}
