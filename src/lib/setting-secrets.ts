import { decryptSecret, encryptSecret } from "./ai/secret-box";

export const SECRET_SETTING_KEYS = new Set(["gemini_api_key", "groq_api_key", "line_token", "smtp_pass", "discord_webhook", "extension_token"]);
const PREFIX = "encrypted:";
export function encodeSetting(key: string, value: string) {
  return SECRET_SETTING_KEYS.has(key) && value ? PREFIX + encryptSecret(value) : value;
}
export function decodeSetting(key: string, value: string) {
  return SECRET_SETTING_KEYS.has(key) && value.startsWith(PREFIX) ? decryptSecret(value.slice(PREFIX.length)) : value;
}
export function legacySecret(key: string, value: string) {
  return SECRET_SETTING_KEYS.has(key) && Boolean(value) && !value.startsWith(PREFIX);
}
