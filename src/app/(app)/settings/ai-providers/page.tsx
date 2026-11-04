"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
import { ApiError, api } from "@/components/api";
import { Badge, Button, Card, Input, Label, Select } from "@/components/ui";
import { ProviderStatus, bangkokTime, type ProviderView } from "@/components/ai-provider-usage";
import { PROVIDER_PRESETS, PROVIDER_TASKS, presetById } from "@/lib/ai/provider-presets";

type Draft = {
  name: string;
  preset: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  clearKey: boolean;
  enabled: boolean;
  tasks: string[];
  limitPerMinute: string;
  limitPerDay: string;
  resetHourUtc: string;
};

type TestResult = { ok: boolean; latencyMs: number; message: string; sample?: string };

function emptyDraft(presetId = "groq"): Draft {
  const preset = presetById(presetId);
  return {
    name: preset.label,
    preset: preset.id,
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiKey: "",
    clearKey: false,
    enabled: true,
    tasks: ["classify", "reply-draft"],
    limitPerMinute: "",
    limitPerDay: "",
    resetHourUtc: preset.id === "gemini" ? "8" : "0",
  };
}

function fromProvider(provider: ProviderView): Draft {
  return {
    name: provider.name,
    preset: provider.preset,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: "",
    clearKey: false,
    enabled: provider.enabled,
    tasks: provider.tasks,
    limitPerMinute: provider.limitPerMinute ? String(provider.limitPerMinute) : "",
    limitPerDay: provider.limitPerDay ? String(provider.limitPerDay) : "",
    resetHourUtc: String(provider.resetHourUtc),
  };
}

function ProviderForm({ initial, editing, hint, onSave, onCancel }: { initial: Draft; editing: boolean; hint?: string | null; onSave: (draft: Draft) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const preset = presetById(draft.preset);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((old) => ({ ...old, [key]: value }));

  const choosePreset = (id: string) => {
    const next = presetById(id);
    setDraft((old) => ({
      ...old,
      preset: id,
      name: editing ? old.name : next.label,
      baseUrl: next.baseUrl || old.baseUrl,
      model: next.model || (editing ? old.model : ""),
      resetHourUtc: id === "gemini" ? "8" : old.resetHourUtc,
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 grid gap-3 rounded-xl bg-paper p-3 sm:grid-cols-2">
      <div>
        <Label>ชนิด</Label>
        <Select value={draft.preset} onChange={(event) => choosePreset(event.target.value)}>
          {PROVIDER_PRESETS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-muted">{preset.note}</p>
      </div>
      <div>
        <Label>ชื่อที่แสดง</Label>
        <Input value={draft.name} onChange={(event) => set("name", event.target.value)} maxLength={60} required />
      </div>
      <div className="sm:col-span-2">
        <Label>Base URL</Label>
        <Input value={draft.baseUrl} onChange={(event) => set("baseUrl", event.target.value)} placeholder="https://.../v1" required />
      </div>
      <div>
        <Label>โมเดล</Label>
        <Input value={draft.model} onChange={(event) => set("model", event.target.value)} placeholder="เช่น llama-3.3-70b" />
      </div>
      <div>
        <Label>API key {preset.needsKey ? "" : "(ไม่บังคับ)"}</Label>
        <Input
          type="password"
          autoComplete="off"
          value={draft.apiKey}
          onChange={(event) => set("apiKey", event.target.value)}
          placeholder={hint ? `เก็บไว้แล้ว ${hint} — เว้นว่างเพื่อใช้ตัวเดิม` : "วางคีย์ที่นี่"}
        />
        {editing && hint ? (
          <label className="mt-1 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={draft.clearKey} onChange={(event) => set("clearKey", event.target.checked)} /> ลบคีย์ที่เก็บไว้
          </label>
        ) : null}
      </div>
      <div>
        <Label>จำกัดครั้ง/นาที (ไม่บังคับ)</Label>
        <Input inputMode="numeric" value={draft.limitPerMinute} onChange={(event) => set("limitPerMinute", event.target.value.replace(/\D/g, ""))} placeholder="ไม่จำกัด" />
      </div>
      <div>
        <Label>จำกัดครั้ง/วัน (ไม่บังคับ)</Label>
        <Input inputMode="numeric" value={draft.limitPerDay} onChange={(event) => set("limitPerDay", event.target.value.replace(/\D/g, ""))} placeholder="ไม่จำกัด" />
      </div>
      <div>
        <Label>โควตารายวันรีเซ็ตเวลา (UTC)</Label>
        <Select value={draft.resetHourUtc} onChange={(event) => set("resetHourUtc", event.target.value)}>
          {Array.from({ length: 24 }, (_, hour) => (
            <option key={hour} value={hour}>
              {String(hour).padStart(2, "0")}:00 UTC = {String((hour + 7) % 24).padStart(2, "0")}:00 น. ไทย
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>ใช้ทำงาน</Label>
        <div className="flex flex-wrap gap-3 pt-1 text-sm">
          {PROVIDER_TASKS.map((task) => (
            <label key={task.value} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={draft.tasks.includes(task.value)}
                onChange={(event) => set("tasks", event.target.checked ? [...draft.tasks, task.value] : draft.tasks.filter((item) => item !== task.value))}
              />
              {task.label}
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => set("enabled", event.target.checked)} /> เปิดใช้งาน
      </label>
      {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>ยกเลิก</Button>
      </div>
    </form>
  );
}

function payload(draft: Draft) {
  return JSON.stringify({
    ...draft,
    apiKey: draft.apiKey.trim() || undefined,
    limitPerMinute: draft.limitPerMinute || null,
    limitPerDay: draft.limitPerDay || null,
    resetHourUtc: Number(draft.resetHourUtc),
  });
}

export default function AiProvidersPage() {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [keySecretReady, setKeySecretReady] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult | "running">>({});

  const load = useCallback(async () => {
    try {
      const data = await api<{ providers: ProviderView[]; keySecretReady: boolean }>("/api/ai-providers");
      setProviders(data.providers);
      setKeySecretReady(data.keySecretReady);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "โหลดไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const move = async (index: number, delta: number) => {
    const next = [...providers];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setProviders(next);
    await api("/api/ai-providers/reorder", { method: "POST", body: JSON.stringify({ ids: next.map((row) => row.id) }) }).catch(() => undefined);
    await load();
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await api(`/api/ai-providers/${id}`, { method: "PATCH", body: JSON.stringify(body) }).catch((err) => setError(err instanceof ApiError ? err.message : "บันทึกไม่สำเร็จ"));
    await load();
  };

  const remove = async (provider: ProviderView) => {
    if (!window.confirm(`ลบ ${provider.name}? คีย์ที่เก็บไว้จะถูกลบด้วย`)) return;
    await api(`/api/ai-providers/${provider.id}`, { method: "DELETE" }).catch(() => undefined);
    await load();
  };

  const test = async (id: string) => {
    setTests((old) => ({ ...old, [id]: "running" }));
    try {
      const result = await api<TestResult>(`/api/ai-providers/${id}/test`, { method: "POST" });
      setTests((old) => ({ ...old, [id]: result }));
    } catch (err) {
      setTests((old) => ({ ...old, [id]: { ok: false, latencyMs: 0, message: err instanceof ApiError ? err.message : "ทดสอบไม่สำเร็จ" } }));
    }
    await load();
  };

  return (
    <div className="min-w-0">
      <Link href="/settings" className="text-sm text-muted underline">← ตั้งค่า</Link>
      <h1 className="mt-2 text-2xl font-semibold">ผู้ให้บริการ AI</h1>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
        เพิ่มโมเดลและ API key ของ AI ฟรีได้หลายเจ้า ระบบจะใช้ตามลำดับจากบนลงล่าง ถ้าตัวไหนโดนจำกัดความถี่ โควตา/เครดิตหมด คีย์ผิด หรือเซิร์ฟเวอร์ล่ม
        จะพักตัวนั้นไว้แล้วสลับไปตัวถัดไปทันที และกลับมาใช้เองเมื่อหมดเวลาพัก (โควตารายวันพักจนถึงเวลารีเซ็ต) ถ้าใช้ไม่ได้ทุกตัว จะจัดหมวดด้วยคีย์เวิร์ดแทน
      </p>
      <p className="mt-1 text-xs text-muted">คีย์ถูกเข้ารหัสก่อนเก็บในฐานข้อมูล หน้านี้แสดงแค่บางส่วนของคีย์ การสลับอัตโนมัติทำงานเมื่อ &quot;ตัวจัดหมวด&quot; ในหน้าตั้งค่าเป็น &quot;อัตโนมัติ&quot;</p>
      {!keySecretReady ? (
        <p className="mt-3 rounded-lg bg-amber/30 p-3 text-sm">ยังไม่ได้ตั้ง AI_KEY_SECRET ใน .env จึงยังบันทึก API key ไม่ได้ (ผู้ให้บริการที่ไม่ใช้คีย์ เช่น Ollama ยังเพิ่มได้)</p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      <div className="mt-4">
        {adding ? (
          <Card>
            <h2 className="font-semibold">เพิ่มผู้ให้บริการ</h2>
            <ProviderForm
              initial={emptyDraft()}
              editing={false}
              onCancel={() => setAdding(false)}
              onSave={async (draft) => {
                await api("/api/ai-providers", { method: "POST", body: payload(draft) });
                setAdding(false);
                await load();
              }}
            />
          </Card>
        ) : (
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> เพิ่มผู้ให้บริการ</Button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {providers.map((provider, index) => {
          const result = tests[provider.id];
          return (
            <Card key={provider.id} className={provider.enabled ? "" : "opacity-70"}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">#{index + 1}</span>
                    <span className="font-semibold">{provider.name}</span>
                    <ProviderStatus provider={provider} />
                    {provider.origin === "env" ? <Badge>จาก .env</Badge> : null}
                  </div>
                  <div className="mt-1 break-all text-xs text-muted">
                    {presetById(provider.preset).label} · {provider.model || "(ยังไม่ใส่โมเดล)"} · {provider.baseUrl}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    คีย์: {provider.hasKey ? provider.apiKeyHint : "ไม่มี"} · งาน: {provider.tasks.map((task) => PROVIDER_TASKS.find((item) => item.value === task)?.label ?? task).join(", ") || "-"}
                    {provider.limitPerMinute ? ` · ${provider.limitPerMinute}/นาที` : ""}
                    {provider.limitPerDay ? ` · ${provider.limitPerDay}/วัน` : ""}
                  </div>
                  <div className="mt-1 text-xs">
                    วันนี้ {provider.requestsToday} ครั้ง · {provider.tokensToday.toLocaleString()} โทเคน · รวม {provider.requestsTotal} ครั้ง · ผิดพลาด {provider.errorsTotal}
                    {provider.lastLatencyMs ? ` · ล่าสุด ${provider.lastLatencyMs} ms` : ""}
                  </div>
                  {provider.lastError ? (
                    <div className="mt-1 text-xs text-red-700">ผิดพลาดล่าสุด ({bangkokTime(provider.lastErrorAt)}): {provider.lastError}</div>
                  ) : null}
                  {result && result !== "running" ? (
                    <div className={`mt-1 text-xs ${result.ok ? "text-pine" : "text-red-700"}`}>
                      ทดสอบ: {result.ok ? "ใช้ได้" : "ไม่ผ่าน"} · {result.message}
                      {result.sample ? ` · "${result.sample}"` : ""}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="sm" variant="outline" disabled={index === 0} onClick={() => void move(index, -1)} aria-label="เลื่อนขึ้น"><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="sm" variant="outline" disabled={index === providers.length - 1} onClick={() => void move(index, 1)} aria-label="เลื่อนลง"><ArrowDown className="h-4 w-4" /></Button>
                  <Button size="sm" variant="outline" disabled={result === "running"} onClick={() => void test(provider.id)}>
                    <FlaskConical className="h-4 w-4" /> {result === "running" ? "กำลังทดสอบ..." : "ทดสอบ"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void patch(provider.id, { enabled: !provider.enabled })}>{provider.enabled ? "ปิด" : "เปิด"}</Button>
                  {provider.coolingDown ? <Button size="sm" variant="outline" onClick={() => void patch(provider.id, { clearCooldown: true })}>เลิกพัก</Button> : null}
                  <Button size="sm" variant="outline" onClick={() => setEditingId(editingId === provider.id ? null : provider.id)}><Pencil className="h-4 w-4" /> แก้ไข</Button>
                  <Button size="sm" variant="danger" onClick={() => void remove(provider)} aria-label="ลบ"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              {editingId === provider.id ? (
                <ProviderForm
                  initial={fromProvider(provider)}
                  editing
                  hint={provider.hasKey ? provider.apiKeyHint : null}
                  onCancel={() => setEditingId(null)}
                  onSave={async (draft) => {
                    await api(`/api/ai-providers/${provider.id}`, { method: "PATCH", body: payload(draft) });
                    setEditingId(null);
                    await load();
                  }}
                />
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}