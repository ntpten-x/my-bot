// Shared by the settings page and the server. Every preset except Gemini and Ollama
// speaks the OpenAI chat-completions format.
export type ProviderKind = "openai" | "gemini" | "ollama";
export type ProviderTask = "classify" | "embed" | "reply-draft";

export const PROVIDER_TASKS: { value: ProviderTask; label: string }[] = [
  { value: "classify", label: "จัดหมวด/คัดลีด" },
  { value: "reply-draft", label: "ร่างคำตอบ" },
  { value: "embed", label: "เวกเตอร์ค้นหา" },
];

export type ProviderPreset = {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  needsKey: boolean;
  note: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", needsKey: true, note: "ฟรีมีโควตาต่อนาที/ต่อวัน" },
  { id: "gemini", label: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.0-flash", needsKey: true, note: "ฟรีมีโควตารายวัน รีเซ็ตเที่ยงคืนเวลาแปซิฟิก" },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free", needsKey: true, note: "โมเดลที่ลงท้าย :free ใช้ฟรี" },
  { id: "opencode-zen", label: "OpenCode Zen", kind: "openai", baseUrl: "https://opencode.ai/zen/v1", model: "", needsKey: true, note: "ใส่ชื่อโมเดลจากหน้า OpenCode Zen" },
  { id: "mistral", label: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", needsKey: true, note: "แผนฟรีมีขีดจำกัดต่อนาที" },
  { id: "cerebras", label: "Cerebras", kind: "openai", baseUrl: "https://api.cerebras.ai/v1", model: "llama-3.3-70b", needsKey: true, note: "เร็วมาก มีโควตาฟรีรายวัน" },
  { id: "ollama", label: "Ollama (ในเครื่อง)", kind: "ollama", baseUrl: "http://127.0.0.1:11434", model: "qwen2.5:7b", needsKey: false, note: "ไม่มีค่าใช้จ่าย ใช้เครื่องตัวเอง" },
  { id: "custom", label: "อื่นๆ (OpenAI-compatible)", kind: "openai", baseUrl: "", model: "", needsKey: false, note: "ใส่ base URL ที่ลงท้ายก่อน /chat/completions" },
];

export function presetById(id: string): ProviderPreset {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}