"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/components/api";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import type { CommentReadiness } from "@/components/comment-readiness";

export type TypeCommentRule = { id: string; name: string; enabled: boolean; sourceIds: string[]; templates: { body: string }[]; selectionMode: string; startMinute: number; endMinute: number; days: number[]; maxAgeHours: number; areaCooldownSec: number; browserDeviceId: string; browserFbUserId: string; browserConsent: boolean; keywords: string; excludeKeywords: string; keywordMode: string; priority: number };
type Options = {
  categories: { id: string; slug: string; name: string }[];
  products: { id: string; name: string; categorySlug: string; enabled: boolean }[];
  templates: { id: string; name: string; body: string; categoryId: string | null; productId: string | null; sourceIds: string }[];
  sources: { id: string; name: string; enabled: boolean; boundCategorySlug: string; defaultProductId: string | null }[];
  setups: Record<string, { productId: string; templateIds: string[] } | null>;
};
const empty: Options = { categories: [], products: [], templates: [], sources: [], setups: {} };
const clock = (minute: number) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minuteOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

export function TypeCommentForm({ rule, browser, onSaved, onRefresh }: { rule?: TypeCommentRule; browser: CommentReadiness | null; onSaved: () => Promise<void>; onRefresh?: () => Promise<void> }) {
  const [initialRule] = useState(rule);
  const [options, setOptions] = useState<Options>(empty);
  const [accounts, setAccounts] = useState<{ id: string; name: string; enabled: boolean; connected: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [productId, setProductId] = useState("");
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>(rule?.sourceIds ?? []);
  const [name, setName] = useState(rule?.name ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? false);
  const [mode, setMode] = useState(rule?.templates.length === 1 ? "fixed" : rule?.selectionMode ?? "random");
  const [accountId, setAccountId] = useState(rule?.browserFbUserId ?? "");
  const [deviceId, setDeviceId] = useState(rule?.browserDeviceId ?? "");
  const [consent, setConsent] = useState(rule?.browserConsent ?? false);
  const [start, setStart] = useState(rule?.startMinute ?? 0);
  const [end, setEnd] = useState(rule?.endMinute ?? 1440);
  const [days, setDays] = useState(rule?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [age, setAge] = useState(rule?.maxAgeHours ?? 6);
  const [gap, setGap] = useState((rule?.areaCooldownSec ?? 60) / 60);
  const [keywords, setKeywords] = useState(rule?.keywords ?? "");
  const [excluded, setExcluded] = useState(rule?.excludeKeywords ?? "ขายแล้ว,ได้แล้ว,ปิดการขาย,ไม่หาแล้ว");
  const [keywordMode, setKeywordMode] = useState(rule?.keywordMode ?? "any");
  const [priority, setPriority] = useState(rule?.priority ?? 0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api<Options>("/api/auto-comment/type-options", { signal: controller.signal }),
      api<{ accounts: typeof accounts }>("/api/facebook-accounts", { signal: controller.signal }),
    ]).then(([catalog, accountData]) => {
      if (controller.signal.aborted) return;
      setOptions(catalog); setAccounts(accountData.accounts);
      if (initialRule) {
        const setup = catalog.setups[initialRule.id];
        const products = [...new Set(catalog.sources.filter(source => initialRule.sourceIds.includes(source.id)).map(source => source.defaultProductId).filter(Boolean))];
        const id = setup?.productId ?? (products.length === 1 ? products[0]! : "");
        setProductId(id);
        const product = catalog.products.find(row => row.id === id);
        const category = catalog.categories.find(row => row.slug === product?.categorySlug);
        const eligible = catalog.templates.filter(row => row.categoryId === category?.id && (!row.productId || row.productId === id) && !row.sourceIds);
        const selectedIds = setup?.templateIds ?? catalog.templates.filter(item => initialRule.templates.some(template => template.body === item.body)).map(item => item.id);
        const keptIds = selectedIds.filter(templateId => eligible.some(row => row.id === templateId));
        const keptSources = initialRule.sourceIds.filter(sourceId => catalog.sources.some(row => row.id === sourceId && row.defaultProductId === id && row.boundCategorySlug === product?.categorySlug));
        setTemplateIds(keptIds); setSourceIds(keptSources);
        if (keptIds.length !== selectedIds.length || keptSources.length !== initialRule.sourceIds.length) {
          setConsent(false);
          setError("มีข้อความหรือกลุ่มที่ใช้กับประเภทนี้ไม่ได้แล้ว กรุณาตรวจรายการและยืนยันสิทธิ์ใหม่ก่อนบันทึก");
        }
      }
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "โหลดประเภทและข้อความไม่สำเร็จ"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialRule]);
  const product = options.products.find(row => row.id === productId);
  const category = options.categories.find(row => row.slug === product?.categorySlug);
  const messages = options.templates.filter(row => row.categoryId === category?.id && (!row.productId || row.productId === productId) && !row.sourceIds);
  const sources = options.sources.filter(row => row.defaultProductId === productId && row.boundCategorySlug === product?.categorySlug);
  const devices = browser?.extensions.filter(row => row.fbUserId === accountId || row.id === deviceId) ?? [];
  function chooseType(id: string) {
    setProductId(id); setConsent(false);
    const selected = options.products.find(row => row.id === id);
    const cat = options.categories.find(row => row.slug === selected?.categorySlug);
    const eligible = options.templates.filter(row => row.categoryId === cat?.id && (!row.productId || row.productId === id) && !row.sourceIds);
    setTemplateIds(eligible.slice(0, mode === "fixed" ? 1 : 30).map(row => row.id));
    setSourceIds(options.sources.filter(row => row.enabled && row.defaultProductId === id && row.boundCategorySlug === selected?.categorySlug).slice(0, 100).map(row => row.id));
  }
  async function refreshConnections() {
    setBusy(true); setError("");
    try {
      const [data] = await Promise.all([api<{ accounts: typeof accounts }>("/api/facebook-accounts"), onRefresh?.()]);
      setAccounts(data.accounts);
    } catch (err) { setError(err instanceof Error ? err.message : "ตรวจการเชื่อมต่อไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!product?.enabled) throw new Error("เลือกประเภทที่เปิดใช้งานก่อน");
      if (!templateIds.length || templateIds.some(id => !messages.some(message => message.id === id))) throw new Error("เลือกข้อความที่ใช้กับประเภทนี้อย่างน้อยหนึ่งข้อความ");
      if (!sourceIds.length || sourceIds.some(id => !sources.some(source => source.id === id))) throw new Error("เลือกกลุ่มภายใต้ประเภทนี้อย่างน้อยหนึ่งกลุ่ม");
      if (enabled && consent && (!accountId || !deviceId)) throw new Error("ก่อนเปิดใช้งาน ต้องเชื่อมต่อส่วนขยายแล้วเลือกบัญชี Facebook และอุปกรณ์ที่ใช้ส่ง");
      if (!days.length) throw new Error("เลือกวันที่อนุญาตอย่างน้อยหนึ่งวัน");
      if (mode === "fixed" && templateIds.length !== 1) throw new Error("โหมดใช้ข้อความเดียว ต้องเลือกหนึ่งข้อความ");
      await api(rule ? `/api/auto-comment/rules/${rule.id}` : "/api/auto-comment/rules", { method: rule ? "PUT" : "POST", body: JSON.stringify({
        name: name.trim() || `${category?.name} / ${product.name}`.slice(0, 80), enabled, typeProductId: productId, replyTemplateIds: templateIds,
        sourceIds, templates: [], selectionMode: mode === "fixed" ? "sequential" : mode, keywords, excludeKeywords: excluded, keywordMode, priority,
        startMinute: start, endMinute: end, days, maxAgeHours: age, areaCooldownSec: Math.round(gap * 60),
        deliveryMode: "extension", browserDeviceId: deviceId, browserFbUserId: accountId, browserConsent: consent,
        intentMode: "keyword", requireAi: false, messageMode: "template",
      }) });
      await onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ"); } finally { setBusy(false); }
  }
  return <form aria-label="ตั้งกฎบอทคอมเมนต์" onSubmit={event => void save(event)} className="space-y-5 rounded-xl border border-line bg-card p-5">
    <div><h2 className="text-lg font-semibold">{rule ? "แก้ไขชุดคอมเมนต์ตามประเภท" : "สร้างชุดคอมเมนต์ตามประเภท"}</h2><p className="mt-1 text-xs leading-5 text-muted">ค่าเริ่มต้น: สุ่มข้อความ ทุกวันตลอด 24 ชั่วโมง โพสต์ไม่เกิน 6 ชั่วโมง พักกลุ่มละ 60 วินาที ปรับตามกติกากลุ่มได้</p></div>
    {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    <fieldset disabled={busy || loading} className="space-y-5">
      <div><Label htmlFor="comment-type">ประเภทที่ต้องการคอมเมนต์</Label><Select id="comment-type" required value={productId} onChange={event => chooseType(event.target.value)}><option value="">เลือกประเภท เช่น Roblox</option>{options.categories.map(cat => <optgroup key={cat.id} label={cat.name}>{options.products.filter(row => row.categorySlug === cat.slug && (row.enabled || row.id === productId)).map(row => <option key={row.id} value={row.id}>{row.name}{!row.enabled ? " (ปิดใช้งาน)" : ""}</option>)}</optgroup>)}</Select><Link href="/groups" className="mt-1 inline-block text-xs text-pine underline">จัดการหมวดหมู่ ประเภท และกลุ่ม</Link></div>
      <div><Label htmlFor="rule-name">ชื่อชุดตั้งค่า</Label><Input id="rule-name" maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder={product ? `${category?.name} / ${product.name}` : "ตั้งอัตโนมัติจากประเภทได้"} /></div>
      <fieldset className="space-y-3 border-t border-line pt-4"><legend className="text-sm font-semibold">ข้อความสำหรับ {product?.name ?? "ประเภทที่เลือก"} ({messages.length} ชุด)</legend>
        <div><Label htmlFor="template-order">วิธีเลือกข้อความ</Label><Select id="template-order" value={mode} onChange={event => { setMode(event.target.value); if (event.target.value === "fixed") setTemplateIds(ids => ids.slice(0, 1)); }}><option value="random">สุ่มจากข้อความที่เลือก</option><option value="sequential">วนตามลำดับ</option><option value="fixed">เลือกใช้ข้อความเดียว</option></Select></div>
        <p className="text-xs text-muted">เลือกแล้ว {templateIds.length} ชุด · ใช้หนึ่งข้อความต่อโพสต์ · สูงสุด 30 ชุด</p>
        {mode !== "fixed" && messages.length ? <Button type="button" size="sm" variant="outline" onClick={() => setTemplateIds(messages.slice(0, 30).map(row => row.id))}>เลือกทั้งหมด{messages.length > 30 ? " 30 ชุดแรก" : ""}</Button> : null}
        <div className="max-h-80 space-y-2 overflow-y-auto">{messages.map(row => <label key={row.id} className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm"><input className="mt-1" type={mode === "fixed" ? "radio" : "checkbox"} name="selected-message" checked={templateIds.includes(row.id)} onChange={event => setTemplateIds(ids => mode === "fixed" ? [row.id] : event.target.checked ? [...ids, row.id].slice(0, 30) : ids.filter(id => id !== row.id))} /><span className="min-w-0"><strong>{row.name}</strong><span className="mt-1 block whitespace-pre-wrap break-words text-muted">{row.body}</span></span></label>)}</div>
        {productId && !messages.length ? <p className="text-sm text-muted">ยังไม่มีข้อความสำหรับประเภทนี้</p> : null}<Link href="/messages" className="inline-block text-xs text-pine underline">สร้างหรือแก้ไขข้อความ</Link><p className="text-xs leading-5 text-muted">บันทึกสำเนาข้อความไว้กับกฎ เมื่อแก้ข้อความต้นฉบับให้เปิดกฎนี้แล้วบันทึกใหม่ ข้อความที่ใช้ทั้งหมวดหมู่เลือกใช้ได้ด้วย</p>
      </fieldset>
      <fieldset className="space-y-2 border-t border-line pt-4"><legend className="text-sm font-semibold">กลุ่มที่อนุญาต ({sourceIds.length}/{sources.length})</legend><p className="text-xs text-muted">แสดงเฉพาะกลุ่มในประเภทนี้ กลุ่มที่เพิ่มภายหลังต้องกลับมาเลือกและบันทึกก่อน</p><div className="max-h-48 space-y-2 overflow-y-auto">{sources.map(row => <label key={row.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sourceIds.includes(row.id)} onChange={event => { setConsent(false); setSourceIds(ids => event.target.checked ? [...ids, row.id].slice(0, 100) : ids.filter(id => id !== row.id)); }} />{row.name}{!row.enabled ? " (พักอ่าน)" : ""}</label>)}</div>{productId && !sources.length ? <p className="text-sm text-muted">ยังไม่มีกลุ่มในประเภทนี้ เพิ่มกลุ่มก่อนตั้งกฎ</p> : null}</fieldset>
      <fieldset className="space-y-3 border-t border-line pt-4"><legend className="text-sm font-semibold">โปรไฟล์ Facebook ที่ใช้คอมเมนต์</legend><p className="rounded-lg bg-pine/10 p-3 text-sm text-pine">ตั้งค่าประเภท ข้อความ กลุ่มและเวลาไว้ก่อนได้ แม้ยังไม่ติดตั้งส่วนขยาย เว้นบัญชีและอุปกรณ์ไว้แล้วบันทึกฉบับร่าง เมื่อติดตั้งแล้วค่อยกลับมาเชื่อมและเปิดใช้งาน</p><Button type="button" size="sm" variant="outline" onClick={() => void refreshConnections()}>ตรวจบัญชีและอุปกรณ์อีกครั้ง</Button><div><Label htmlFor="browser-account">บัญชี Facebook</Label><Select id="browser-account" required={enabled && consent} value={accountId} onChange={event => { setAccountId(event.target.value); setDeviceId(""); setConsent(false); }}><option value="">เลือกบัญชีภายหลัง (บันทึกฉบับร่างได้)</option>{accounts.map(row => <option key={row.id} value={row.id}>{row.name || row.id} · {row.connected ? "ออนไลน์" : "ออฟไลน์"}{!row.enabled ? " · หยุดงาน" : ""}</option>)}</Select></div><div><Label htmlFor="browser-device">อุปกรณ์ / โปรไฟล์ Chrome</Label><Select id="browser-device" required={enabled && consent} value={deviceId} onChange={event => { setDeviceId(event.target.value); setConsent(false); }}><option value="">เลือกอุปกรณ์ภายหลัง (บันทึกฉบับร่างได้)</option>{devices.map(row => <option key={row.id} value={row.id}>{row.name} · {row.online ? "ออนไลน์" : "ออฟไลน์"}{row.fbUserId !== accountId ? " · บัญชีไม่ตรง" : ""}</option>)}</Select></div><Link href="/accounts" className="text-xs text-pine underline">ตรวจการเชื่อมต่อบัญชี</Link><p className="text-xs text-muted">ต้องเปิดรับงานคอมเมนต์ใน popup ของ Extension ด้วย การเลือกบัญชีไม่เปิดส่งเอง</p></fieldset>
      <fieldset className="space-y-3 border-t border-line pt-4"><legend className="text-sm font-semibold">เวลาและระยะพัก</legend><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="comment-start">เวลาเริ่ม (ไทย)</Label><Input id="comment-start" type="time" required value={clock(start)} onChange={event => setStart(minuteOf(event.target.value))} /></div><div><Label htmlFor="comment-end">เวลาสิ้นสุด (ไทย)</Label><Input id="comment-end" type="time" required value={clock(end)} onChange={event => setEnd(minuteOf(event.target.value) || 1440)} /></div></div><p className="text-xs text-muted">ใช้เวลา Asia/Bangkok เริ่ม 00:00 และสิ้นสุด 00:00 หมายถึงทั้งวัน ถ้าเวลาสิ้นสุดน้อยกว่าเวลาเริ่ม จะทำงานข้ามคืน</p><fieldset><legend className="mb-2 text-sm font-medium">วันที่อนุญาต</legend><div className="flex flex-wrap gap-3">{["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."].map((day, index) => <label key={day} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={days.includes(index)} onChange={event => setDays(value => event.target.checked ? [...value, index] : value.filter(item => item !== index))} />{day}</label>)}</div></fieldset><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="post-age">อายุโพสต์สูงสุด (ชั่วโมง)</Label><Input id="post-age" type="number" required min={1} max={168} value={age} onChange={event => setAge(Number(event.target.value))} /></div><div><Label htmlFor="area-cooldown">พักระหว่างคอมเมนต์ในกลุ่ม (นาที)</Label><Input id="area-cooldown" type="number" required min={0.5} max={1440} step="any" value={gap} onChange={event => setGap(Number(event.target.value))} /></div></div></fieldset>
      <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-sm font-medium">ตัวกรองโพสต์เพิ่มเติม</summary><div className="mt-3 space-y-3"><div><Label htmlFor="required-words">คำที่ต้องพบ (เว้นว่าง = ทุกโพสต์ที่ผ่านเงื่อนไขอื่น)</Label><Textarea id="required-words" maxLength={1000} value={keywords} onChange={event => setKeywords(event.target.value)} /></div><div><Label htmlFor="excluded-words">คำยกเว้น</Label><Input id="excluded-words" maxLength={1000} value={excluded} onChange={event => setExcluded(event.target.value)} /></div><div><Label htmlFor="keyword-mode">การจับคำ</Label><Select id="keyword-mode" value={keywordMode} onChange={event => setKeywordMode(event.target.value)}><option value="any">พบอย่างน้อยหนึ่งคำ</option><option value="all">พบครบทุกคำ</option></Select></div><div><Label htmlFor="rule-priority">ลำดับความสำคัญ (สูงก่อน)</Label><Input id="rule-priority" type="number" min={0} max={100} value={priority} onChange={event => setPriority(Number(event.target.value))} /></div></div></details>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />ฉันมีสิทธิ์คอมเมนต์ในกลุ่มที่เลือก กฎกลุ่มอนุญาต และยินยอมให้ Extension ใช้บัญชีนี้ตามชุดตั้งค่านี้</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />เปิดใช้งานชุดตั้งค่านี้เมื่อพร้อม</label>
      <p className="text-xs leading-5 text-muted">เปิดสถานะไว้ล่วงหน้าได้ หากยังไม่ผูกบัญชี อุปกรณ์ หรือยังไม่ยืนยันสิทธิ์ จะรอความพร้อมและยังไม่ส่ง เมื่อพร้อมและระบบส่วนกลางทำงานจะส่งคอมเมนต์จริง ไม่ส่งซ้ำเมื่อไม่ทราบผล การหยุดอาจยังมีสิทธิ์กดส่งที่ออกไปแล้วทำงานต่อได้ถึง 3 วินาที</p>
      <Button type="submit" disabled={busy || loading}>{loading ? "กำลังโหลดประเภทและข้อความ..." : busy ? "กำลังบันทึก..." : !enabled && (!accountId || !deviceId) ? "บันทึกฉบับร่าง" : "บันทึกชุดตั้งค่า"}</Button>
    </fieldset>
  </form>;
}
