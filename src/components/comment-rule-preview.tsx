"use client";

import { useState } from "react";
import { api } from "./api";
import { Button, Label, Select, Textarea } from "./ui";

type Result = { intent?: { value: string; evidence: string; by: string }; matched: boolean; checks: { code: string; label: string; passed: boolean }[]; evaluatedAt: string };
export function CommentRulePreview({ rules, sources }: {
  rules: { id: string; name: string }[];
  sources: { id: string; name: string }[];
}) {
  const [ruleId, setRuleId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function preview() {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api<Result>("/api/auto-comment/preview", { method: "POST", body: JSON.stringify({ ruleId, sourceId, text }) })); }
    catch (err) { setError(err instanceof Error ? err.message : "ทดลองไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-line bg-card p-5" aria-label="ทดลองการจับคู่กฎ">
    <h2 className="text-lg font-semibold">ทดลองการจับคู่กฎ</h2>
    <p className="text-sm text-muted">ใช้กฎที่บันทึกแล้วกับข้อความจำลองอายุ 0 ชั่วโมง โดยถือว่าไม่ใช่โฆษณา โพสต์ซ้ำ คำต้องห้าม หรือโพสต์ที่ข้าม ไม่สร้างงาน ไม่บันทึกข้อความ และไม่เรียก Facebook</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <div><Label htmlFor="preview-rule">กฎที่ต้องการทดลอง</Label><Select id="preview-rule" disabled={busy} value={ruleId} onChange={event => { setRuleId(event.target.value); setResult(null); }}><option value="">เลือกกฎ</option>{rules.map(rule => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</Select></div>
      <div><Label htmlFor="preview-source">แหล่งข้อมูลจำลอง</Label><Select id="preview-source" disabled={busy} value={sourceId} onChange={event => { setSourceId(event.target.value); setResult(null); }}><option value="">เลือกแหล่งข้อมูล</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</Select></div>
    </div>
    <div><Label htmlFor="preview-text">ข้อความโพสต์จำลอง</Label><Textarea id="preview-text" disabled={busy} value={text} maxLength={20000} onChange={event => { setText(event.target.value); setResult(null); }} /></div>
    <Button type="button" variant="outline" disabled={busy || !ruleId || !sourceId || !text.trim()} onClick={() => void preview()}>{busy ? "กำลังทดลอง..." : "ทดลองโดยไม่สร้างงาน"}</Button>
    {error ? <p role="alert" className="text-sm text-red-800">{error}</p> : null}
    {result ? <div role="status" className="space-y-2 text-sm"><p className="font-medium">{result.matched ? "ผ่านเงื่อนไขการจับคู่" : "ไม่ผ่านเงื่อนไขการจับคู่"} · ณ {new Date(result.evaluatedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>{result.intent ? <p>เจตนา: {({ buyer: "หาซื้อ/ขอคำแนะนำ", seller: "เสนอขาย", closed: "ปิดหรือปฏิเสธ", chat: "พูดคุย", unknown: "ยังไม่ชัดเจน", ad: "โฆษณา" } as Record<string, string>)[result.intent.value] ?? result.intent.value} {result.intent.evidence ? `· พบข้อความ “${result.intent.evidence}”` : ""}</p> : null}<ul className="space-y-1">{result.checks.map(check => <li key={check.code}>{check.passed ? "ผ่าน" : "ไม่ผ่าน"} · {check.label}</li>)}</ul></div> : null}
    <p className="text-xs text-muted">ผลทดลองไม่อนุญาตให้ส่งจริง Worker ยังต้องตรวจแหล่งข้อมูลเปิดอยู่ ข้อความตอบ โหมดระบบ สิทธิ์เพจ อายุ Token โควตา ประวัติส่งซ้ำ และสถานะโพสต์อีกครั้ง กฎที่ปิดหรือถูกพักจะไม่ผ่าน</p>
  </section>;
}
