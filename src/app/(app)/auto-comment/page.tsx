"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/components/api";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { evaluationReasons } from "@/lib/auto-comment/reasons";
import { CommentRulePreview } from "@/components/comment-rule-preview";
import { CommentMessages } from "@/components/comment-messages";

type BrowserFields = { businessFacts: string; draftInstruction: string; intentMode: string; priority: number; deliveryMode: string; browserDeviceId: string; browserFbUserId: string; browserConsent: boolean; requireAi: boolean; messageMode: string };
type Rule = BrowserFields & {
  id: string; name: string; enabled: boolean; sourceIds: string[]; keywords: string; excludeKeywords: string;
  keywordMode: string; selectionMode: string; templates: { body: string }[]; startMinute: number; endMinute: number;
  days: number[]; maxAgeHours: number; areaCooldownSec: number; pageId: string;
  hasPageToken: boolean; hasManagerToken: boolean; pausedReason: string;
};
type Form = BrowserFields & { name: string; enabled: boolean; sourceIds: string[]; keywords: string; excludeKeywords: string; keywordMode: string; selectionMode: string; templates: string[]; startMinute: number; endMinute: number; days: number[]; maxAgeHours: number; areaCooldownSec: number; pageId: string; pageToken: string; managerToken: string; clearCredentials: boolean };
type Dashboard = {
  control: { state: string; dryRun: boolean; emergency: boolean; hourlyLimit: number; dailyLimit: number; cooldownUntil: string | null };
  rules: Rule[]; sources: { id: string; name: string; type: string; enabled: boolean }[];
  jobs: { id: string; status: string; message: string; externalUrl: string; lastError: string; dryRun: boolean; createdAt: string; remoteCommentId: string | null }[];
  logs: { id: string; event: string; message: string; createdAt: string }[];
  evaluations?: { id: string; state: string; reasonsJson: string; evaluatedAt: string; post: { text: string; externalUrl: string } }[];
  counts: Record<string, number>; observed: number; matched: number;
};
const blank = (): Form => ({ name: "", enabled: false, businessFacts: "", draftInstruction: "", intentMode: "keyword", priority: 0, sourceIds: [], keywords: "", excludeKeywords: "", keywordMode: "any", selectionMode: "sequential", templates: [""], startMinute: 0, endMinute: 1440, days: [0, 1, 2, 3, 4, 5, 6], maxAgeHours: 24, areaCooldownSec: 300, pageId: "", pageToken: "", managerToken: "", clearCredentials: false, deliveryMode: "extension", browserDeviceId: "", browserFbUserId: "", browserConsent: false, requireAi: false, messageMode: "template" });
const statuses: Record<string, string> = { pending_ai: "รอเตรียมข้อความ / ตรวจเงื่อนไขกฎ", browser_ready: "รอ Extension", browser_observed: "พบคอมเมนต์ในหน้าจอ", pending: "รอส่ง", claimed: "ตรวจสิทธิ์", sending: "กำลังส่ง", sent: "ส่งสำเร็จ", dry_run: "จำลองแล้ว", unsupported: "Unsupported — ส่งเอง", permission_denied: "สิทธิ์ไม่ผ่าน", unavailable: "เข้าถึงโพสต์ไม่ได้", uncertain: "ไม่ทราบผล — ตรวจเอง ห้ามส่งซ้ำ", failed: "ล้มเหลว", cancelled: "ยกเลิกแล้ว" };
const time = (minute: number) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minutes = (value: string) => Number(value.split(":")[0]) * 60 + Number(value.split(":")[1]);
function facebookLink(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && ["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"].includes(url.hostname) ? url.href : null; } catch { return null; }
}
function editForm(rule: Rule): Form {
  return { ...blank(), businessFacts: rule.businessFacts || "", draftInstruction: rule.draftInstruction || "", name: rule.name, enabled: rule.enabled, priority: rule.priority ?? 0, sourceIds: rule.sourceIds, keywords: rule.keywords, excludeKeywords: rule.excludeKeywords, keywordMode: rule.keywordMode, selectionMode: rule.selectionMode, templates: rule.templates.length ? rule.templates.map(item => item.body) : [""], startMinute: rule.startMinute, endMinute: rule.endMinute, days: rule.days, maxAgeHours: rule.maxAgeHours, areaCooldownSec: rule.areaCooldownSec, pageId: "", browserDeviceId: rule.browserDeviceId || "", browserFbUserId: rule.browserFbUserId || "", browserConsent: rule.browserConsent || false };
}

export default function AutoCommentPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [browser, setBrowser] = useState<{ extensions: { id: string; name: string; online: boolean; fbUserId: string }[]; accounts: { id: string; name: string }[] } | null>(null);
  useEffect(() => { const c = new AbortController(); void api<typeof browser>("/api/automation-readiness", { signal: c.signal }).then(setBrowser).catch(() => undefined); return () => c.abort(); }, []);
  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [jobFilter, setJobFilter] = useState("all");
  const [dryRun, setDryRun] = useState(true);
  const [hourly, setHourly] = useState(5);
  const [daily, setDaily] = useState(20);
  const [acknowledged, setAcknowledged] = useState(false);
  const reloading = useRef(false);
  const reload = useCallback(async (signal?: AbortSignal) => {
    if (reloading.current) return true;
    reloading.current = true;
    try { const result = await api<Dashboard>("/api/auto-comment", { signal }); if (!signal?.aborted) setData(result); return true; }
    catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ"); return false; }
    finally { reloading.current = false; }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>; let delay = 5000; let stopped = false;
    const poll = async () => {
      if (stopped) return;
      if (!document.hidden) delay = await reload(controller.signal) ? 5000 : Math.min(60000, delay * 2);
      if (!stopped) timer = setTimeout(() => void poll(), document.hidden ? 15000 : delay);
    };
    const visible = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", visible); void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [reload]);
  const savedDryRun = data?.control.dryRun, savedHourly = data?.control.hourlyLimit, savedDaily = data?.control.dailyLimit;
  useEffect(() => { if (savedDryRun !== undefined && savedHourly !== undefined && savedDaily !== undefined) { setDryRun(savedDryRun); setHourly(savedHourly); setDaily(savedDaily); setAcknowledged(false); } }, [savedDryRun, savedHourly, savedDaily]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }));
  async function control(body: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try { await api("/api/auto-comment", { method: "PUT", body: JSON.stringify(body) }); await reload(); setNotice("บันทึกคำสั่งแล้ว งานที่ส่งถึง Meta ไปแล้วไม่สามารถเรียกคืนได้"); }
    catch (err) { setError(err instanceof Error ? err.message : "เปลี่ยนสถานะไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!form.keywords.split(/[,\n]/).some(word => word.trim())) throw new Error("ระบุคำสำคัญอย่างน้อยหนึ่งคำ เพื่อให้บอทเลือกโพสต์ที่ต้องการตอบ");
      await api(editing ? `/api/auto-comment/rules/${editing}` : "/api/auto-comment/rules", { method: editing ? "PUT" : "POST", body: JSON.stringify({ ...form, intentMode: "keyword", requireAi: false, messageMode: "template", deliveryMode: "extension", templates: form.templates.map(value => value.trim()).filter(Boolean) }) });
      setForm(blank()); setEditing(null); await reload(); setNotice("บันทึกกฎแล้ว ตรวจ Dry Run ก่อนเปิดส่งจริง");
    } catch (err) { setError(err instanceof Error ? err.message : "บันทึกกฎไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  const count = (key: string) => data?.counts[key] ?? 0;
  const visibleJobs = data?.jobs.filter(job => jobFilter === "all" || (jobFilter === "waiting" ? ["pending_ai", "browser_ready", "pending", "claimed", "sending"].includes(job.status) : jobFilter === "review" ? ["uncertain", "failed", "permission_denied", "unavailable"].includes(job.status) : job.status === jobFilter));
  const state = data?.control.emergency ? "หยุดฉุกเฉิน" : data?.control.state === "running" ? "กำลังทำงาน" : data?.control.state === "paused" ? "พักงาน" : "หยุดอยู่";
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 text-xs font-semibold tracking-wide text-pine">บอททำงานตามกฎ · ส่งผ่าน Chrome Extension</p><h1 className="text-2xl font-semibold">คอมเมนต์อัตโนมัติ</h1><p className="mt-2 max-w-2xl text-sm text-muted">พบคำสำคัญ → เลือกข้อความ → เข้าคิวคอมเมนต์ บอททำงานเองโดยไม่รอ AI ส่วน AI ช่วยจัดหมวดหมู่โพสต์ที่ดึงเข้ามา</p></div>
      <Button variant="danger" onClick={() => void control({ action: "emergency" })}>Emergency Stop · หยุดฉุกเฉิน</Button>
    </div>
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-pine">{notice}</p> : null}
    <section aria-label="เส้นทางการทำงานของบอท" className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
      {[["1 · รับโพสต์", "Extension อ่านโพสต์จากกลุ่มที่เปิดไว้"], ["2 · จับคำสำคัญ", "บอทตรวจคำที่ต้องพบและคำยกเว้น ไม่รอ AI"], ["3 · คอมเมนต์", "Extension ส่งข้อความตามกฎ ทีละโพสต์ ไม่ส่งซ้ำ"]].map(([title, detail]) => <div key={title} className="bg-card p-4"><h2 className="font-semibold text-pine">{title}</h2><p className="mt-1 text-sm text-muted">{detail}</p></div>)}
    </section>
    {data?.rules.some(rule => rule.enabled && (rule.requireAi || rule.messageMode === "ai_draft" || rule.intentMode !== "keyword" || rule.deliveryMode !== "extension")) ? <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">มีกฎเดิมที่ใช้เจตนา รอ AI หรือใช้ช่องทางเดิมอยู่ เลือกแก้ไขและบันทึกกฎนั้นเพื่อเปลี่ยนเป็นบอทคำสำคัญที่ไม่รอ AI ระบบยังไม่เปลี่ยนกฎเดิมให้เอง</p> : null}
    <section className="border-y border-line py-4" aria-label="สถานะระบบและคำสั่ง">
      <div className="flex flex-wrap items-center gap-3"><strong className="text-lg">{state}</strong><span className={`rounded-full px-3 py-1 text-sm ${data?.control.dryRun !== false ? "bg-amber/40" : "bg-red-100 text-red-800"}`}>{data?.control.dryRun !== false ? "Dry Run — ไม่ส่งจริง" : "ส่งจริงผ่าน Extension"}</span>
        <div className="flex flex-wrap gap-2 md:ml-auto"><Button disabled={busy || !data || data.control.emergency} onClick={() => void control({ action: "start" })}>Start · เริ่ม</Button><Button variant="outline" disabled={busy || !data} onClick={() => void control({ action: "pause" })}>Pause · พัก</Button><Button variant="outline" disabled={busy || !data} onClick={() => void control({ action: "stop" })}>Stop · หยุด</Button></div>
      </div>
      <p className="mt-3 text-xs text-muted">Pause รักษาคิวไว้ · Stop ยกเลิกงานที่ยังไม่ส่ง · หยุดการอนุญาตงานใหม่ งานที่อนุญาตแล้วอาจยังกดส่งได้ภายใน 3 วินาที</p>
      {data?.control.cooldownUntil ? <p className="mt-2 text-sm">พักตามข้อจำกัด Meta ถึง {new Date(data.control.cooldownUntil).toLocaleString("th-TH")}</p> : null}
      {data?.control.emergency ? <Button className="mt-3" variant="outline" disabled={busy} onClick={() => void control({ action: "reset" })}>ปลดหยุดฉุกเฉิน (ยังไม่ Start)</Button> : null}
    </section>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4 xl:grid-cols-7">
      {[["พบคอมเมนต์ในหน้าจอ", count("browser_observed")], ["ตรวจพบรอบนี้", data?.observed ?? 0], ["ตรงเงื่อนไขรอบนี้", data?.matched ?? 0], ["ส่งสำเร็จทั้งหมด", count("sent")], ["ล้มเหลว/ต้องตรวจ", count("failed") + count("permission_denied") + count("uncertain") + count("unavailable")], ["ค้างในคิว", count("pending_ai") + count("browser_ready") + count("pending") + count("claimed") + count("sending")], ["จำลอง / ส่งเอง", count("dry_run") + count("unsupported")]].map(([label, value]) => <div key={label} className="border-l-2 border-line pl-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd></div>)}
    </dl>
    <section className="rounded-xl border border-line bg-card p-4" aria-label="ข้อจำกัดและโหมด">
      <div className="flex flex-wrap items-end gap-4"><label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={dryRun} onChange={event => setDryRun(event.target.checked)} /> Dry Run (ไม่กดส่งคอมเมนต์)</label>
        <div><Label htmlFor="hour-limit">สูงสุดต่อชั่วโมง</Label><Input id="hour-limit" className="w-28" type="number" min={1} max={50} value={hourly} onChange={event => setHourly(Number(event.target.value))} /></div>
        <div><Label htmlFor="day-limit">สูงสุดต่อวัน (เวลาไทย)</Label><Input id="day-limit" className="w-28" type="number" min={1} max={200} value={daily} onChange={event => setDaily(Number(event.target.value))} /></div>
        <Button variant="outline" disabled={busy} onClick={() => void control({ dryRun, hourlyLimit: hourly, dailyLimit: daily, liveAcknowledged: acknowledged })}>บันทึกข้อจำกัดและโหมด</Button>
      </div>
      {!dryRun && data?.control.dryRun ? <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> ฉันอนุญาตให้ Extension ส่งตามกฎที่เปิดไว้เฉพาะกลุ่มที่ฉันมีสิทธิ์และกฎกลุ่มอนุญาต โดยไม่อนุมัติทีละโพสต์</label> : null}
      <p className="mt-3 text-xs text-muted">โควตานับความพยายามส่งรวมกรณีไม่ทราบผล · ต่อโพสต์ส่งได้เพียงครั้งเดียวตลอดประวัติ · เปลี่ยนโหมดจะหยุดและยกเลิกคิวเดิม</p>
    </section>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(240px,1fr)]">
      <form aria-label="ตั้งกฎบอทคอมเมนต์" onSubmit={event => void save(event)} className="space-y-4 rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { setEditing(null); setForm(blank()); setNotice("เตรียมกฎใหม่แล้ว บอทใช้คำสำคัญและข้อความสำเร็จรูป ไม่รอ AI"); }}>สร้างกฎใหม่</Button><Button type="button" variant="outline" onClick={() => { setEditing(null); setForm({ ...blank(), name: "ตอบโพสต์เกี่ยวกับรองเท้า", keywords: "รองเท้า,ร้องเท้า", excludeKeywords: "ขายแล้ว,ได้แล้ว,ไม่หาแล้ว" }); setNotice("เตรียมกฎตัวอย่างแล้ว ใส่ข้อความของคุณ เลือกกลุ่มและอุปกรณ์ก่อน กฎยังปิดอยู่"); }}>ใช้ตัวอย่าง: คำสำคัญรองเท้า</Button></div>
        <h2 className="text-lg font-semibold">{editing ? "แก้ไขกฎ" : "สร้างกฎใหม่"}</h2>
        <div><Label htmlFor="rule-name">ชื่อกฎ</Label><Input id="rule-name" value={form.name} maxLength={80} required onChange={event => set("name", event.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={event => set("enabled", event.target.checked)} /> เปิดใช้งานกฎนี้</label>
        <p className="rounded-lg bg-pine/10 p-3 text-sm text-pine">กฎนี้ใช้บอทจับคำสำคัญและส่งข้อความที่คุณกำหนด ไม่เรียก AI เพื่ออนุมัติหรือร่างคอมเมนต์</p>
        {editing ? <p className="text-sm text-muted">เมื่อบันทึก กฎนี้จะใช้คำสำคัญและข้อความสำเร็จรูปแทนการรอ AI งานที่ยังไม่ส่งของกฎเดิมจะถูกยกเลิกและประเมินใหม่ตามเงื่อนไข</p> : null}
        <CommentMessages messages={form.templates} onChange={messages => set("templates", messages)} />
        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="template-order">เลือกข้อความ</Label><Select id="template-order" value={form.selectionMode} onChange={event => set("selectionMode", event.target.value)}><option value="sequential">เรียงวนตามลำดับ</option><option value="random">สุ่ม</option></Select></div><div><Label htmlFor="keyword-mode">การจับคำสำคัญ</Label><Select id="keyword-mode" value={form.keywordMode} onChange={event => set("keywordMode", event.target.value)}><option value="any">พบอย่างน้อยหนึ่งคำ</option><option value="all">พบครบทุกคำ</option></Select></div></div>
        <div><Label htmlFor="required-words">คำสำคัญที่ต้องพบ (คั่นด้วย , หรือบรรทัดใหม่)</Label><Textarea id="required-words" required maxLength={1000} value={form.keywords} onChange={event => set("keywords", event.target.value)} /><p className="mt-1 text-xs text-muted">ตรวจคำที่อยู่ในข้อความ ไม่ตีความเจตนาด้วย AI เช่น “รองเท้า” อาจตรงทั้งโพสต์ซื้อและขาย ใช้คำยกเว้นเพื่อกรองเพิ่ม</p></div>
        <div><Label htmlFor="rule-priority">ลำดับความสำคัญ (0–100 สูงก่อน)</Label><Input id="rule-priority" type="number" min={0} max={100} value={form.priority} onChange={event => set("priority", Number(event.target.value))} /><p className="mt-1 text-xs text-muted">ถ้าโพสต์ตรงหลายกฎ จะเลือกกฎที่สำคัญกว่าหนึ่งกฎ</p></div>
        <div><Label htmlFor="excluded-words">คำที่ต้องยกเว้น</Label><Input id="excluded-words" value={form.excludeKeywords} onChange={event => set("excludeKeywords", event.target.value)} /></div>
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Allowlist แหล่งข้อมูล</legend><div className="max-h-44 space-y-2 overflow-auto rounded-lg border border-line p-3">
          {data?.sources.filter(source => source.type === "facebook_group").map(source => <label key={source.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.sourceIds.includes(source.id)} onChange={event => set("sourceIds", event.target.checked ? [...form.sourceIds, source.id] : form.sourceIds.filter(id => id !== source.id))} /><span>{source.name}{!source.enabled ? " (ปิดแหล่งอยู่)" : ""}<span className="block text-xs text-muted">ส่งผ่าน Extension ตามบัญชีที่ผูกไว้</span></span></label>)}
          {!data?.sources.some(source => source.type === "facebook_group") ? <p className="text-sm text-muted">ยังไม่มีกลุ่ม Facebook <a className="underline" href="/sources">เพิ่มกลุ่มในแหล่งข้อมูล</a> ก่อนตั้งกฎ เพจและ Marketplace ไม่รองรับการส่งผ่านหน้านี้</p> : null}
        </div></fieldset>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="comment-start">เวลาเริ่ม (Asia/Bangkok)</Label><Input id="comment-start" type="time" value={time(form.startMinute)} onChange={event => set("startMinute", minutes(event.target.value))} /></div><div><Label htmlFor="comment-end">เวลาสิ้นสุด (00:00 = สิ้นวัน)</Label><Input id="comment-end" type="time" value={time(form.endMinute)} onChange={event => set("endMinute", minutes(event.target.value) || 1440)} /></div></div>
        <fieldset><legend className="mb-2 text-sm font-medium">วันที่อนุญาต</legend><div className="flex flex-wrap gap-3">{["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."].map((name, index) => <label key={name} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.days.includes(index)} onChange={event => set("days", event.target.checked ? [...form.days, index] : form.days.filter(day => day !== index))} />{name}</label>)}</div></fieldset>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="post-age">อายุโพสต์สูงสุด (ชั่วโมง)</Label><Input id="post-age" type="number" min={1} max={168} value={form.maxAgeHours} onChange={event => set("maxAgeHours", Number(event.target.value))} /></div><div><Label htmlFor="area-cooldown">พักระหว่างคอมเมนต์ในกลุ่ม (วินาที)</Label><Input id="area-cooldown" type="number" min={30} max={86400} value={form.areaCooldownSec} onChange={event => set("areaCooldownSec", Number(event.target.value))} /></div></div>
        <fieldset className="space-y-3 rounded-lg border border-line p-3"><legend className="text-sm font-medium">เครื่องและบัญชีสำหรับส่งผ่าน Extension</legend>
          <Button type="button" size="sm" variant="outline" onClick={() => void api<typeof browser>("/api/automation-readiness").then(setBrowser).catch(() => setError("ตรวจอุปกรณ์ไม่สำเร็จ"))}>ตรวจอุปกรณ์และบัญชีอีกครั้ง</Button>
          <p className="text-xs text-muted">เปิดรับงานคอมเมนต์ใน popup ของ Extension ด้วย ไม่ใช้ Facebook API หรือรหัสผ่าน บัญชีที่เห็นจาก heartbeat ไม่ใช่การรับรองสิทธิ์ของกลุ่ม</p>
          <div><Label htmlFor="browser-device">อุปกรณ์ที่จับคู่</Label><Select id="browser-device" value={form.browserDeviceId} onChange={event => { set("browserDeviceId", event.target.value); const device = browser?.extensions.find(item => item.id === event.target.value); if (device?.fbUserId) set("browserFbUserId", device.fbUserId); }}><option value="">เลือกอุปกรณ์</option>{browser?.extensions.map(device => <option key={device.id} value={device.id}>{device.name} · {device.online ? "ออนไลน์" : "ออฟไลน์"}</option>)}</Select></div>
          <div><Label htmlFor="browser-account">บัญชี Facebook ที่อนุญาตให้ใช้ส่ง</Label><Select id="browser-account" value={form.browserFbUserId} onChange={event => set("browserFbUserId", event.target.value)}><option value="">เลือกบัญชีที่ Extension เคยพบ</option>{browser?.accounts.map(account => <option key={account.id} value={account.id}>{account.name || account.id} ({account.id})</option>)}</Select></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.browserConsent} onChange={event => set("browserConsent", event.target.checked)} /> ฉันมีสิทธิ์โพสต์ความคิดเห็นในกลุ่มที่เลือก กฎกลุ่มอนุญาตการใช้งานนี้ และอนุญาตให้ Extension ส่งตามกฎนี้</label>
          <p className="text-xs text-muted">DOM ของ Facebook อาจเปลี่ยน หากหาช่องหรือปุ่มส่งไม่ชัดเจนจะไม่กด พบ Checkpoint จะหยุด ไม่หลบระบบ งานที่ไม่ทราบผลจะไม่ส่งซ้ำ Emergency Stop อาจยังมีงานที่อนุญาตแล้วกดส่งได้ภายใน 3 วินาที</p>
        </fieldset>
        <div className="flex gap-2"><Button disabled={busy} type="submit">{busy ? "กำลังบันทึก..." : "บันทึกกฎ"}</Button>{editing ? <Button type="button" variant="outline" onClick={() => { setEditing(null); setForm(blank()); }}>ยกเลิกการแก้ไข</Button> : null}</div>
      </form>
      <aside className="self-start space-y-3 rounded-xl border border-line bg-card p-5"><h2 className="text-lg font-semibold">กฎที่ตั้งไว้</h2>{data?.rules.map(rule => <article key={rule.id} className="border-b border-line pb-4"><div className="flex items-center justify-between gap-2"><h3 className="font-medium">{rule.name}</h3><span className="text-xs">{rule.enabled ? "เปิด" : "ปิด"}</span></div><p className="mt-1 text-sm text-muted">{rule.templates.length} ข้อความ · ลำดับ {rule.priority} · {rule.deliveryMode === "extension" ? "ส่งผ่าน Extension" : "กฎ API เดิม — ต้องเปลี่ยนเป็น Extension"}</p><p className="mt-2 rounded-lg bg-pine/10 p-2 text-sm">{rule.intentMode === "keyword" && !rule.requireAi && rule.messageMode === "template" ? "บอทคำสำคัญ · ไม่รอ AI" : "กฎเดิม · ใช้เจตนาหรือ AI"}</p><p className="mt-2 break-words text-sm">คำสำคัญ: {rule.keywords || "ไม่ได้ระบุ"}</p>{rule.deliveryMode === "extension" && !browser?.extensions.some(device => device.id === rule.browserDeviceId && device.online && device.fbUserId === rule.browserFbUserId) ? <p className="mt-2 text-sm text-red-800">อุปกรณ์หรือบัญชีที่ผูกไว้ไม่พร้อม ตรวจการจับคู่ก่อนเปิดกฎ</p> : null}<p className="mt-1 text-xs text-muted">อุปกรณ์: {rule.browserDeviceId || "ยังไม่ผูก"} · Facebook: {rule.browserFbUserId || "ยังไม่ผูก"}</p>{rule.pausedReason ? <p className="mt-2 text-sm text-red-800">พักกฎ: {rule.pausedReason}</p> : null}<Button type="button" className="mt-2" size="sm" variant="outline" onClick={() => { setEditing(rule.id); setForm({ ...editForm(rule), sourceIds: rule.sourceIds.filter(id => data.sources.some(source => source.id === id && source.type === "facebook_group")) }); }}>แก้ไข / เปิดปิดกฎ</Button></article>)}{!data?.rules.length ? <p className="text-sm text-muted">เริ่มด้วยกฎที่ปิดไว้และ Dry Run แล้วตรวจข้อความในประวัติก่อนเปิดส่งจริง</p> : null}</aside>
    </div>
    <section><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">ประวัติงานและข้อความที่เตรียมไว้</h2><div><Label htmlFor="job-filter">แสดงงาน</Label><Select id="job-filter" value={jobFilter} onChange={event => setJobFilter(event.target.value)}><option value="all">ทั้งหมด</option><option value="waiting">กำลังรอ / กำลังส่ง</option><option value="browser_observed">พบคอมเมนต์ในหน้าจอ</option><option value="dry_run">จำลองแล้ว</option><option value="review">ต้องตรวจสอบ</option></Select></div></div><p className="mt-1 text-xs text-muted">แสดง 100 งานล่าสุด งาน “ไม่ทราบผล” จะไม่ลองส่งซ้ำอัตโนมัติ ต้องตรวจบน Facebook เอง</p><div className="mt-3 space-y-3">{visibleJobs?.map(job => <article key={job.id} className="rounded-lg border border-line bg-card p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{statuses[job.status] ?? job.status}</strong><span className="text-xs text-muted">{new Date(job.createdAt).toLocaleString("th-TH")}</span></div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{job.message}</p>{job.lastError ? <p className="mt-2 text-sm text-muted">{job.lastError}</p> : null}{job.remoteCommentId ? <p className="mt-1 text-xs text-muted">Comment ID: {job.remoteCommentId}</p> : null}<div className="mt-3 flex gap-3"><Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(job.message).then(() => setNotice("คัดลอกข้อความแล้ว")).catch(() => setError("เบราว์เซอร์ไม่อนุญาต Clipboard ให้เลือกข้อความแล้วคัดลอกเอง"))}>คัดลอกข้อความ</Button>{facebookLink(job.externalUrl) ? <a className="self-center text-sm underline" href={facebookLink(job.externalUrl)!} target="_blank" rel="noreferrer">เปิดโพสต์</a> : null}</div></article>)}{!data?.jobs.length ? <p className="rounded-lg border border-dashed border-line p-5 text-sm text-muted">ยังไม่มีงาน เปิดกฎและ Start ใน Dry Run แล้วรอโพสต์ใหม่ ระบบจะไม่ส่งคอมเมนต์ย้อนหลังอัตโนมัติ</p> : !visibleJobs?.length ? <p className="p-4 text-sm text-muted">ไม่พบงานในตัวกรองนี้</p> : null}</div></section>
    <section aria-label="ผลประเมินโพสต์"><h2 className="text-lg font-semibold">ผลประเมินโพสต์รอบปัจจุบัน</h2><p className="mt-1 text-xs text-muted">50 รายการล่าสุด แยกโพสต์ที่ข้ามออกจากงานส่ง เปลี่ยนข้อความ ผล AI หรือกฎแล้วระบบจะตรวจใหม่ โดยไม่ส่งซ้ำโพสต์ที่เคยเริ่มส่ง</p><div className="mt-3 space-y-2">{data?.evaluations?.map(item => <article key={item.id} className="rounded-lg border border-line p-3"><strong className="text-sm">{({ skipped: "ไม่ผ่านเงื่อนไข", waiting_full_text: "รออ่านข้อความฉบับเต็ม", waiting_ai: "รอ AI", waiting_window: "รอเวลาทำงาน", matched: "สร้างงานแล้ว", deduplicated: "มีประวัติงานอยู่แล้ว" } as Record<string, string>)[item.state] ?? item.state}</strong><p className="mt-1 line-clamp-2 text-sm">{item.post.text}</p><details className="mt-2 text-xs text-muted"><summary>เหตุผลและเวลาประเมิน</summary><p>{new Date(item.evaluatedAt).toLocaleString("th-TH")}</p><div className="space-y-1">{evaluationReasons(item.reasonsJson, data.rules).map((reason, index) => <p key={index}>{reason}</p>)}</div></details></article>)}{!data?.evaluations?.length ? <p className="text-sm text-muted">ยังไม่มีผลประเมินในรอบนี้</p> : null}</div></section>
    <CommentRulePreview rules={data?.rules ?? []} sources={data?.sources ?? []} />
    <details><summary className="cursor-pointer font-medium">Audit Log ล่าสุด</summary><ul className="mt-3 space-y-2 text-sm">{data?.logs.map(log => <li key={log.id} className="border-b border-line pb-2"><span className="text-xs text-muted">{new Date(log.createdAt).toLocaleString("th-TH")}</span> · {statuses[log.event] ?? log.event} {log.message}</li>)}</ul></details>
  </div>;
}
