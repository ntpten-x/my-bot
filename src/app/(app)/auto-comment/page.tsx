"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/components/api";
import { Button, Input, Label, Select } from "@/components/ui";
import { evaluationReasons } from "@/lib/auto-comment/reasons";
import { TypeCommentForm } from "@/components/type-comment-form";
import { CommentReadinessPanel, type CommentReadiness } from "@/components/comment-readiness";

type BrowserFields = { businessFacts: string; draftInstruction: string; intentMode: string; priority: number; deliveryMode: string; browserDeviceId: string; browserFbUserId: string; browserConsent: boolean; requireAi: boolean; messageMode: string };
type Rule = BrowserFields & {
  id: string; revision: number; typeInfo?: { id: string; name: string; categoryName: string } | null; name: string; enabled: boolean; sourceIds: string[]; keywords: string; excludeKeywords: string;
  keywordMode: string; selectionMode: string; templates: { body: string }[]; startMinute: number; endMinute: number;
  days: number[]; maxAgeHours: number; areaCooldownSec: number; pageId: string;
  hasPageToken: boolean; hasManagerToken: boolean; pausedReason: string;
};
type Dashboard = {
  control: { state: string; dryRun: boolean; emergency: boolean; hourlyLimit: number; dailyLimit: number; cooldownUntil: string | null };
  rules: Rule[]; sources: { id: string; name: string; type: string; enabled: boolean }[];
  jobs: { id: string; status: string; message: string; externalUrl: string; lastError: string; dryRun: boolean; createdAt: string; remoteCommentId: string | null }[];
  logs: { id: string; event: string; message: string; createdAt: string }[];
  evaluations?: { id: string; state: string; reasonsJson: string; evaluatedAt: string; post: { text: string; externalUrl: string } }[];
  counts: Record<string, number>; observed: number; matched: number;
};
const statuses: Record<string, string> = { not_sent: "ไม่ได้เรียกปุ่มส่ง", rule_deleted: "ลบชุดตั้งค่า", rule_enabled: "เปิดชุดตั้งค่า", rule_disabled: "ปิดชุดตั้งค่า", pending_ai: "รอเตรียมข้อความ / ตรวจเงื่อนไขกฎ", browser_ready: "รอ Extension", browser_observed: "พบคอมเมนต์ในหน้าจอ", pending: "รอส่ง", claimed: "ตรวจสิทธิ์", sending: "กำลังส่ง", sent: "ส่งสำเร็จ", dry_run: "จำลองแล้ว", unsupported: "Unsupported — ส่งเอง", permission_denied: "สิทธิ์ไม่ผ่าน", unavailable: "เข้าถึงโพสต์ไม่ได้", uncertain: "ไม่ทราบผล — ตรวจเอง ห้ามส่งซ้ำ", failed: "ล้มเหลว", cancelled: "ยกเลิกแล้ว" };
function facebookLink(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && ["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"].includes(url.hostname) ? url.href : null; } catch { return null; }
}
export default function AutoCommentPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [browser, setBrowser] = useState<CommentReadiness | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [ruleSearch, setRuleSearch] = useState("");
  const [toggling, setToggling] = useState("");
  const [formEpoch, setFormEpoch] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [jobFilter, setJobFilter] = useState("all");
  const [hourly, setHourly] = useState(50);
  const [daily, setDaily] = useState(200);
  const reloadSequence = useRef(0);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++reloadSequence.current;
    try {
      const [dashboard, readiness] = await Promise.allSettled([
        api<Dashboard>("/api/auto-comment", { signal }), api<CommentReadiness>("/api/automation-readiness", { signal }),
      ]);
      if (signal?.aborted) return false;
      if (sequence !== reloadSequence.current) return true;
      setBrowser(readiness.status === "fulfilled" ? readiness.value : null);
      if (dashboard.status === "rejected") throw dashboard.reason;
      setData(dashboard.value); return readiness.status === "fulfilled";
    }
    catch (err) { if (!signal?.aborted && sequence === reloadSequence.current) setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ"); return false; }
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
  const savedHourly = data?.control.hourlyLimit, savedDaily = data?.control.dailyLimit;
  useEffect(() => { if (savedHourly !== undefined && savedDaily !== undefined) { setHourly(savedHourly); setDaily(savedDaily); } }, [savedHourly, savedDaily]);
  async function control(body: Record<string, unknown>) {
    reloadSequence.current++;
    setBusy(true); setError(""); setNotice("");
    try { await api("/api/auto-comment", { method: "PUT", body: JSON.stringify(body) }); await reload(); setNotice("บันทึกคำสั่งแล้ว งานที่ส่งถึง Meta ไปแล้วไม่สามารถเรียกคืนได้"); }
    catch (err) { setError(err instanceof Error ? err.message : "เปลี่ยนสถานะไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  async function toggleRule(rule: Rule) {
    reloadSequence.current++;
    setToggling(rule.id); setError(""); setNotice("");
    try {
      await api(`/api/auto-comment/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled, revision: rule.revision }) });
      await reload(); setNotice(`${rule.enabled ? "ปิด" : "เปิด"}สถานะ ${rule.typeInfo?.name ?? rule.name} แล้ว${rule.enabled ? "" : " ระบบจะรอให้บัญชี อุปกรณ์ และสิทธิ์พร้อมก่อนส่ง"}`);
    } catch (err) { setError(err instanceof Error ? err.message : "เปลี่ยนสถานะชุดตั้งค่าไม่สำเร็จ"); await reload(); }
    finally { setToggling(""); }
  }
  async function removeRule(rule: Rule) {
    if (!confirm(`ลบชุด “${rule.typeInfo?.name ?? rule.name}” ออกจากรายการ? งานที่ยังไม่ส่งจะถูกยกเลิกและเก็บประวัติไว้ งานที่เริ่มส่งแล้วอาจยังทำงานต่อได้`)) return;
    reloadSequence.current++;
    setToggling(rule.id); setError(""); setNotice("");
    try {
      await api(`/api/auto-comment/rules/${rule.id}`, { method: "DELETE", body: JSON.stringify({ revision: rule.revision }) });
      if (editing === rule.id) { setEditorOpen(false); setEditing(null); }
      await reload(); setNotice("ลบชุดคอมเมนต์ออกจากรายการแล้ว ประวัติงานยังอยู่");
    } catch (err) { setError(err instanceof Error ? err.message : "ลบชุดตั้งค่าไม่สำเร็จ"); await reload(); }
    finally { setToggling(""); }
  }
  useEffect(() => { if (editorOpen) document.getElementById("comment-editor")?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }, [editorOpen, editing, formEpoch]);
  const shownRules = data?.rules.filter(rule => `${rule.name} ${rule.typeInfo?.name ?? ""} ${rule.typeInfo?.categoryName ?? ""}`.toLocaleLowerCase().includes(ruleSearch.trim().toLocaleLowerCase())) ?? [];
  const count = (key: string) => data?.counts[key] ?? 0;
  const visibleJobs = data?.jobs.filter(job => !job.dryRun && (jobFilter === "all" || (jobFilter === "waiting" ? ["pending_ai", "browser_ready", "pending", "claimed", "sending"].includes(job.status) : jobFilter === "review" ? ["uncertain", "failed", "permission_denied", "unavailable", "not_sent"].includes(job.status) : job.status === jobFilter)));
  const state = data?.control.emergency ? "หยุดฉุกเฉิน" : data?.control.state === "running" ? "กำลังทำงาน" : data?.control.state === "paused" ? "พักงาน" : "หยุดอยู่";
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 text-xs font-semibold tracking-wide text-pine">บอททำงานตามกฎ · ส่งผ่าน Chrome Extension</p><h1 className="text-2xl font-semibold">คอมเมนต์อัตโนมัติ</h1><p className="mt-2 max-w-2xl text-sm text-muted">เลือกประเภท เลือกชุดข้อความและโปรไฟล์ Facebook แล้วกำหนดวันเวลา ระบบเลือกข้อความตามที่ตั้งไว้โดยไม่รอ AI จับคู่ Extension ครั้งเดียว แล้วเปิด–หยุดและจัดการการส่งจากหน้านี้ได้เลย ไม่ต้องเปิดสวิตช์คอมเมนต์ในส่วนขยายอีก</p></div>
      <Button variant="danger" onClick={() => void control({ action: "emergency" })}>Emergency Stop · หยุดฉุกเฉิน</Button>
    </div>
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-pine">{notice}</p> : null}
    <section aria-label="เส้นทางการทำงานของบอท" className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
      {[["1 · รับโพสต์", "Extension อ่านโพสต์จากกลุ่มที่เปิดไว้"], ["2 · ตรวจชุดตั้งค่า", "ตรวจประเภท ข้อความ บัญชี วันเวลา และอายุโพสต์"], ["3 · คอมเมนต์", "Extension ส่งข้อความตามกฎ ทีละโพสต์ ไม่ส่งซ้ำ"]].map(([title, detail]) => <div key={title} className="bg-card p-4"><h2 className="font-semibold text-pine">{title}</h2><p className="mt-1 text-sm text-muted">{detail}</p></div>)}
    </section>
    {data?.rules.some(rule => rule.enabled && (rule.requireAi || rule.messageMode === "ai_draft" || rule.intentMode !== "keyword" || rule.deliveryMode !== "extension")) ? <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">มีกฎเดิมที่ใช้เจตนา รอ AI หรือใช้ช่องทางเดิมอยู่ เลือกแก้ไขและบันทึกกฎนั้นเพื่อเปลี่ยนเป็นบอทคำสำคัญที่ไม่รอ AI ระบบยังไม่เปลี่ยนกฎเดิมให้เอง</p> : null}
    <section className="border-y border-line py-4" aria-label="สถานะระบบและคำสั่ง">
      <div className="flex flex-wrap items-center gap-3"><strong className="text-lg">{state}</strong><span className="rounded-full bg-red-100 px-3 py-1 text-sm text-red-800">คอมเมนต์จริงผ่าน Extension</span>
        <div className="flex flex-wrap gap-2 md:ml-auto"><Button disabled={busy || !data || data.control.emergency} onClick={() => void control({ action: "start" })}>Start · เริ่มส่งจริง</Button><Button variant="outline" disabled={busy || !data} onClick={() => void control({ action: "pause" })}>Pause · พัก</Button><Button variant="outline" disabled={busy || !data} onClick={() => void control({ action: "stop" })}>Stop · หยุด</Button></div>
      </div>
      <p className="mt-3 text-xs text-muted">Pause รักษาคิวไว้ · Stop ยกเลิกงานที่ยังไม่ส่ง · หยุดการอนุญาตงานใหม่ งานที่อนุญาตแล้วอาจยังกดส่งได้ภายใน 3 วินาที</p>
      {data?.control.cooldownUntil ? <p className="mt-2 text-sm">พักตามข้อจำกัด Meta ถึง {new Date(data.control.cooldownUntil).toLocaleString("th-TH")}</p> : null}
      {data?.control.emergency ? <Button className="mt-3" variant="outline" disabled={busy} onClick={() => void control({ action: "reset" })}>ปลดหยุดฉุกเฉิน (ยังไม่ Start)</Button> : null}
    </section>
    <section id="comment-rule-list" aria-label="รายการชุดคอมเมนต์" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">ชุดคอมเมนต์ตามประเภท ({data?.rules.length ?? 0})</h2><p className="mt-1 text-sm text-muted">สร้างเป็นรายการ เช่น Roblox, ROV หรือคอม เปิดปิดแยกชุด และแก้ไขรายละเอียดได้ภายหลัง</p></div><Button disabled={!data || Boolean(toggling)} onClick={() => { setEditing(null); setFormEpoch(value => value + 1); setEditorOpen(true); }}>สร้างชุดคอมเมนต์</Button></div>
      {data?.rules.length ? <Input aria-label="ค้นหาชุดคอมเมนต์" className="sm:max-w-sm" value={ruleSearch} onChange={event => setRuleSearch(event.target.value)} placeholder="ค้นหาประเภทหรือชื่อชุดตั้งค่า" /> : null}
      {!data ? <p className="text-sm text-muted">กำลังโหลดรายการ...</p> : !data.rules.length ? <div className="rounded-xl border border-dashed border-line p-6 text-sm text-muted">ยังไม่มีชุดคอมเมนต์ กดสร้างชุดคอมเมนต์แล้วเลือกประเภท ข้อความและเวลาไว้ก่อนได้ แม้ยังไม่ติดตั้งส่วนขยาย</div> : !shownRules.length ? <p className="text-sm text-muted">ไม่พบชุดคอมเมนต์ตามคำค้น</p> : <div className="grid gap-3 md:grid-cols-2">{shownRules.map(rule => {
        const unbound = !rule.browserDeviceId || !rule.browserFbUserId || !rule.browserConsent;
        const title = rule.typeInfo?.name ?? rule.name;
        const account = browser?.accounts.find(account => account.id === rule.browserFbUserId);
        const device = browser?.extensions.find(device => device.id === rule.browserDeviceId);
        const waiting = unbound || !device?.online || device.fbUserId !== rule.browserFbUserId || account?.enabled === false || !device.commentsEnabled;
        const clock = (minute: number) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        return <article key={rule.id} className="space-y-3 rounded-xl border border-line bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted">{rule.typeInfo?.categoryName ?? "ชุดตั้งค่าเดิม"}</p><h3 className="mt-1 text-lg font-semibold">{title}</h3>{rule.name !== title ? <p className="mt-1 text-xs text-muted">{rule.name}</p> : null}</div><span className={`rounded-full px-2 py-1 text-xs ${rule.enabled ? "bg-pine/10 text-pine" : "bg-black/5 text-muted"}`}>{rule.enabled ? waiting ? "เปิดไว้ · รอความพร้อม" : "เปิดใช้งาน" : unbound ? "ฉบับร่าง · รอเชื่อมต่อ" : "ปิดใช้งาน"}</span></div>
          <p className="text-sm">{rule.templates.length} ข้อความ · {rule.selectionMode === "random" ? "สุ่มข้อความ" : rule.templates.length === 1 ? "ข้อความเดียว" : "วนตามลำดับ"} · {rule.sourceIds.length} กลุ่ม</p>
          <p className="text-sm text-muted">{rule.days.length === 7 ? "ทุกวัน" : rule.days.map(day => ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."][day]).join(" ")} · {rule.startMinute === 0 && rule.endMinute === 1440 ? "ตลอด 24 ชั่วโมง" : `${clock(rule.startMinute)}–${clock(rule.endMinute)}`}<br />โพสต์ไม่เกิน {rule.maxAgeHours} ชม. · พักกลุ่มละ {rule.areaCooldownSec} วินาที</p>
          <p className="text-xs text-muted">Facebook: {account?.name || rule.browserFbUserId || "ยังไม่เลือกบัญชี"}</p>
          {rule.pausedReason ? <p className="text-sm text-red-800">พักไว้: {rule.pausedReason}</p> : null}
          <div className="flex flex-wrap items-center gap-2"><Button type="button" role="switch" aria-checked={rule.enabled} aria-label={`เปิดปิดชุด ${title}`} variant={rule.enabled ? "pine" : "outline"} disabled={Boolean(toggling)} onClick={() => void toggleRule(rule)}>{toggling === rule.id ? "กำลังบันทึก..." : rule.enabled ? "เปิดอยู่ · กดเพื่อปิด" : "ปิดอยู่ · กดเพื่อเปิด"}</Button><Button type="button" size="sm" variant="outline" aria-label={`แก้ไขชุด ${title}`} disabled={Boolean(toggling)} onClick={() => { setEditing(rule.id); setEditorOpen(true); }}>แก้ไข</Button><Button type="button" size="sm" variant="danger" aria-label={`ลบชุด ${title}`} disabled={Boolean(toggling)} onClick={() => void removeRule(rule)}>ลบ</Button></div>
          {unbound ? <p className="text-xs text-muted">เปิดปิดสถานะไว้ล่วงหน้าได้ ระบบยังไม่ส่งจนกว่าจะผูกบัญชี อุปกรณ์ และยืนยันสิทธิ์ครบ</p> : rule.enabled && waiting ? <p className="text-xs text-muted">{account?.enabled === false ? "บัญชีถูกหยุดงานในหน้าจัดการบัญชี" : "รอบัญชีและส่วนขยายที่ผูกไว้เชื่อมต่อด้วยเวอร์ชันล่าสุด"}</p> : null}
        </article>;
      })}</div>}
      {editorOpen ? <section id="comment-editor" aria-label="รายละเอียดชุดคอมเมนต์" className="scroll-mt-6 space-y-3"><div className="flex justify-end"><Button type="button" variant="outline" onClick={() => { setEditorOpen(false); setEditing(null); }}>ยกเลิก / กลับรายการ</Button></div><TypeCommentForm key={`${editing ?? "new"}-${formEpoch}`} rule={data?.rules.find(rule => rule.id === editing)} browser={browser} onRefresh={async () => { await reload(); }} onSaved={async () => { setEditorOpen(false); setEditing(null); setFormEpoch(value => value + 1); await reload(); document.getElementById("comment-rule-list")?.scrollIntoView?.({ behavior: "smooth", block: "start" }); setNotice("บันทึกเป็นรายการชุดคอมเมนต์แล้ว เปิดปิดหรือแก้ไขต่อจากรายการได้"); }} /></section> : null}
      <p className="text-xs text-muted">เปิดชุดที่ตั้งค่าครบแล้วจะรับงานได้ตามเวลาเมื่อระบบส่วนกลางกำลังทำงาน หากระบบหยุดอยู่ให้กดเริ่มส่งจริงด้วย</p>
    </section>
    {data ? <CommentReadinessPanel control={data.control} rules={data.rules} readiness={browser} /> : null}
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4 xl:grid-cols-7">
      {[["พบคอมเมนต์ในหน้าจอ", count("browser_observed")], ["ตรวจพบรอบนี้", data?.observed ?? 0], ["ตรงเงื่อนไขรอบนี้", data?.matched ?? 0], ["ส่งสำเร็จทั้งหมด", count("sent")], ["ล้มเหลว/ต้องตรวจ", count("failed") + count("permission_denied") + count("uncertain") + count("unavailable")], ["ค้างในคิว", count("pending_ai") + count("browser_ready") + count("pending") + count("claimed") + count("sending")]].map(([label, value]) => <div key={label} className="border-l-2 border-line pl-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd></div>)}
    </dl>
    <section className="rounded-xl border border-line bg-card p-4" aria-label="ข้อจำกัดการส่ง">
      <div className="flex flex-wrap items-end gap-4">
        <div><Label htmlFor="hour-limit">สูงสุดต่อชั่วโมง</Label><Input id="hour-limit" className="w-28" type="number" min={1} max={50} value={hourly} onChange={event => setHourly(Number(event.target.value))} /></div>
        <div><Label htmlFor="day-limit">สูงสุดต่อวัน (เวลาไทย)</Label><Input id="day-limit" className="w-28" type="number" min={1} max={200} value={daily} onChange={event => setDaily(Number(event.target.value))} /></div>
        <Button variant="outline" disabled={busy} onClick={() => void control({ hourlyLimit: hourly, dailyLimit: daily })}>บันทึกข้อจำกัด</Button>
      </div>
      <p className="mt-3 text-xs text-muted">โควตานับความพยายามส่งรวมกรณีไม่ทราบผล · ต่อโพสต์ส่งได้เพียงครั้งเดียวตลอดประวัติ</p>
    </section>
    <section><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">ประวัติงานและข้อความที่เตรียมไว้</h2><div><Label htmlFor="job-filter">แสดงงาน</Label><Select id="job-filter" value={jobFilter} onChange={event => setJobFilter(event.target.value)}><option value="all">ทั้งหมด</option><option value="waiting">กำลังรอ / กำลังส่ง</option><option value="browser_observed">พบคอมเมนต์ในหน้าจอ</option><option value="review">ต้องตรวจสอบ</option></Select></div></div><p className="mt-1 text-xs text-muted">แสดง 100 งานล่าสุด งาน “ไม่ทราบผล” จะไม่ลองส่งซ้ำอัตโนมัติ ต้องตรวจบน Facebook เอง</p><div className="mt-3 space-y-3">{visibleJobs?.map(job => <article key={job.id} className="rounded-lg border border-line bg-card p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{statuses[job.status] ?? job.status}</strong><span className="text-xs text-muted">{new Date(job.createdAt).toLocaleString("th-TH")}</span></div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{job.message}</p>{job.lastError ? <p className="mt-2 text-sm text-muted">{job.lastError}</p> : null}{job.remoteCommentId ? <p className="mt-1 text-xs text-muted">Comment ID: {job.remoteCommentId}</p> : null}<div className="mt-3 flex gap-3"><Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(job.message).then(() => setNotice("คัดลอกข้อความแล้ว")).catch(() => setError("เบราว์เซอร์ไม่อนุญาต Clipboard ให้เลือกข้อความแล้วคัดลอกเอง"))}>คัดลอกข้อความ</Button>{facebookLink(job.externalUrl) ? <a className="self-center text-sm underline" href={facebookLink(job.externalUrl)!} target="_blank" rel="noreferrer">เปิดโพสต์</a> : null}</div></article>)}{!data?.jobs.length ? <p className="rounded-lg border border-dashed border-line p-5 text-sm text-muted">ยังไม่มีงาน เปิดกฎและกดเริ่มส่งจริง แล้วรอโพสต์ใหม่ ระบบจะไม่ส่งคอมเมนต์ย้อนหลังอัตโนมัติ</p> : !visibleJobs?.length ? <p className="p-4 text-sm text-muted">ไม่พบงานในตัวกรองนี้</p> : null}</div></section>
    <section aria-label="ผลประเมินโพสต์"><h2 className="text-lg font-semibold">ผลประเมินโพสต์รอบปัจจุบัน</h2><p className="mt-1 text-xs text-muted">50 รายการล่าสุด แยกโพสต์ที่ข้ามออกจากงานส่ง เปลี่ยนข้อความ ผล AI หรือกฎแล้วระบบจะตรวจใหม่ โดยไม่ส่งซ้ำโพสต์ที่เคยเริ่มส่ง</p><div className="mt-3 space-y-2">{data?.evaluations?.map(item => <article key={item.id} className="rounded-lg border border-line p-3"><strong className="text-sm">{({ skipped: "ไม่ผ่านเงื่อนไข", waiting_full_text: "รออ่านข้อความฉบับเต็ม", waiting_ai: "รอ AI", waiting_window: "รอเวลาทำงาน", matched: "สร้างงานแล้ว", deduplicated: "มีประวัติงานอยู่แล้ว" } as Record<string, string>)[item.state] ?? item.state}</strong><p className="mt-1 line-clamp-2 text-sm">{item.post.text}</p><details className="mt-2 text-xs text-muted"><summary>เหตุผลและเวลาประเมิน</summary><p>{new Date(item.evaluatedAt).toLocaleString("th-TH")}</p><div className="space-y-1">{evaluationReasons(item.reasonsJson, data.rules).map((reason, index) => <p key={index}>{reason}</p>)}</div></details></article>)}{!data?.evaluations?.length ? <p className="text-sm text-muted">ยังไม่มีผลประเมินในรอบนี้</p> : null}</div></section>
    <details><summary className="cursor-pointer font-medium">Audit Log ล่าสุด</summary><ul className="mt-3 space-y-2 text-sm">{data?.logs.map(log => <li key={log.id} className="border-b border-line pb-2"><span className="text-xs text-muted">{new Date(log.createdAt).toLocaleString("th-TH")}</span> · {statuses[log.event] ?? log.event} {log.message}</li>)}</ul></details>
  </div>;
}
