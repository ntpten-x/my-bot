// Keyboard shortcuts for the reply queue panel. Pure so it can be unit-tested.
export type ShortcutAction = "next" | "sent" | "skip" | "edit";

export type ShortcutEvent = {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  targetTag?: string | null;
  targetEditable?: boolean;
};

const KEYS: Record<string, ShortcutAction> = { n: "next", s: "sent", k: "skip", e: "edit" };
const CODES: Record<string, ShortcutAction> = { KeyN: "next", KeyS: "sent", KeyK: "skip", KeyE: "edit" };

// N = open next, S = mark sent, K = skip, E = edit draft. The physical key counts, so it also works
// with the Thai keyboard layout. Ignored while typing in a field or with Ctrl/Alt/Cmd held.
export function shortcutFor(event: ShortcutEvent): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null;
  const tag = (event.targetTag || "").toUpperCase();
  if (event.targetEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return null;
  return (event.code ? CODES[event.code] : undefined) ?? KEYS[event.key.length === 1 ? event.key.toLowerCase() : ""] ?? null;
}

export const SHORTCUT_HELP = "คีย์ลัด: N เปิดรายการถัดไป · S ส่งแล้ว · K ข้าม · E แก้ข้อความ";
