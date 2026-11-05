"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input, Label, Select } from "@/components/ui";
import { ApiError, api } from "@/components/api";
import { ReplyQueuePanel } from "@/components/reply-queue-panel";
import type { AutomationRuleRow, CategoryRow, ReplyTemplateRow } from "@/lib/lead";

type Area = { provinces: string[]; notifyOnly: boolean; followUpDays: number; allProvinces: string[] };
type Preview = {
  scanned: number;
  matched: number;
  samples: { id: string; authorName: string; text: string; url: string }[];
  nowTotal: number;
  now: { id: string; authorName: string; text: string; url: string; source: string; score: number; template: string; reply: string }[];
};
type RuleStats = Record<string, { matchedToday: number; queued: number; opened: number; sent: number; skipped: number; eligibleNow: number }>;
type ProductOpt = { id: string; name: string; categorySlug: string };
type SourceOpt = { id: string; name: string };
type Draft = Omit<AutomationRuleRow, "id" | "hitCount" | "lastHitAt" | "sourceIds" | "templateIds"> & { sourceIds: string[]; templateIds: string[] };

const list = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

const EMPTY: Draft = {
  name: "",
  enabled: true,
  categoryId: null,
  keywords: "",
  provinces: "",
  intent: "buyer",
  minScore: 0,
  actionNotify: true,
  actionSave: false,
  actionDismiss: false,
  templateId: null,
  subcategoryId: null,
  productId: null,
  sourceIds: [],
  excludeKeywords: "",
  maxAgeHours: 0,
  priority: 0,
  actionQueue: false,
  templateIds: [],
};

function bangkok(iso: string | null) {
  if (!iso) return "ยังไม่เคย";
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export default function AutomationPage() {
  const [rules, setRules] = useState<AutomationRuleRow[]>([]);
  const [max, setMax] = useState(30);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [templates, setTemplates] = useState<ReplyTemplateRow[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [sources, setSources] = useState<SourceOpt[]>([]);
  const [stats, setStats] = useState<RuleStats>({});
  const [sourceQuery, setSourceQuery] = useState("");
  const [area, setArea] = useState<Area | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, Preview>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [ruleData, cats, tpl, areaData, prods, srcs] = await Promise.all([
        api<{ rules: AutomationRuleRow[]; max: number; stats?: RuleStats }>("/api/rules"),
        api<{ categories: CategoryRow[] }>("/api/categories"),
        api<{ templates: ReplyTemplateRow[] }>("/api/templates"),
        api<Area>("/api/service-area"),
        api<{ products: ProductOpt[] }>("/api/products").catch(() => ({ products: [] as ProductOpt[] })),
        api<{ sources: SourceOpt[] }>("/api/sources").catch(() => ({ sources: [] as SourceOpt[] })),
      ]);
      setProducts(prods.products);
      setSources(srcs.sources.map((item) => ({ id: item.id, name: item.name })));
      setStats(ruleData.stats ?? {});
      setRules(ruleData.rules);
      setMax(ruleData.max);
      setCategories(cats.categories);
      setTemplates(tpl.templates);
      setArea(areaData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "โหลดไม่สำเร็จ");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveRule() {
    setError("");
    try {
      if (editing) await api(`/api/rules/${editing}`, { method: "PATCH", body: JSON.stringify(draft) });
      else await api("/api/rules", { method: "POST", body: JSON.stringify(draft) });
      setDraft(EMPTY);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "บันทึกกฎไม่สำเร็จ");
    }
  }

  async function saveArea(next: Partial<Area>) {
    if (!area) return;
    const merged = { ...area, ...next };
    setArea(merged);
    try {
      await api("/api/service-area", { method: "PUT", body: JSON.stringify({ provinces: merged.provinces, notifyOnly: merged.notifyOnly, followUpDays: merged.followUpDays }) });
      setMessage("บันทึกพื้นที่แล้ว");
      setTimeout(() => setMessage(""), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "บันทึกพื้นที่ไม่สำเร็จ");
    }
  }

  const topCats = categories.filter((item) => !item.parentId);
  const subCats = categories.filter((item) => item.parentId && item.parentId === draft.categoryId);
  const topSlug = categories.find((item) => item.id === draft.categoryId)?.slug ?? "";
  const productChoices = products.filter((item) => !topSlug || item.categorySlug === topSlug || item.id === draft.productId);
  const toggle = (key: "sourceIds" | "templateIds", id: string, on: boolean) =>
    setDraft((current) => ({ ...current, [key]: on ? [...current[key], id] : current[key].filter((item) => item !== id) }));

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div>
      <h1 className="text-2xl font-semibold">กฎอัตโนมัติและพื้นที่ให้บริการ</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
        กฎทำงานทันทีที่โพสต์ใหม่เข้ามาและหลัง AI จัดหมวดเสร็จ ทำได้แค่ แจ้งเตือนคุณ เก็บเข้าไปป์ไลน์ เตรียมข้อความตอบ หรือซ่อนโพสต์
        ระบบไม่คอมเมนต์หรือส่งข้อความแทนคุณ — คิวตอบลีดด้านล่างช่วยเปิดโพสต์และใส่ข้อความให้ แต่คุณเป็นคนกดส่งเอง
        <br />กฎการเม้น: ติ๊ก “เข้าคิวตอบ” ในกฎ แล้วโพสต์ที่ตรงเงื่อนไขจะเข้าคิวตอบลีดพร้อมข้อความที่วนสลับ (ตามโควตา/ระยะห่าง/ไม่ซ้ำคนและกลุ่มเดิม)
        เมื่อมีกฎการเม้นอย่างน้อย 1 กฎ คิวจะรับเฉพาะโพสต์ที่ตรงกฎเท่านั้น
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="mt-4 text-sm text-pine">{message}</p> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-semibold">พื้นที่ให้บริการ</h2>
          <p className="text-xs text-muted">เลือกจังหวัดที่คุณรับงาน ไม่เลือกเลย = ทั้งประเทศ โพสต์ที่ไม่ระบุจังหวัดถือว่าอยู่ในพื้นที่เสมอ</p>
          {area ? (
            <>
              <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-xl bg-paper p-2">
                {area.allProvinces.map((province) => {
                  const on = area.provinces.includes(province);
                  return (
                    <button
                      key={province}
                      type="button"
                      onClick={() => void saveArea({ provinces: on ? area.provinces.filter((item) => item !== province) : [...area.provinces, province] })}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-pine bg-pine text-white" : "border-line bg-card"}`}
                    >
                      {province}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted">เลือกแล้ว: {area.provinces.length ? area.provinces.join(", ") : "ทั้งประเทศ"}</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={area.notifyOnly} onChange={(event) => void saveArea({ notifyOnly: event.target.checked })} />
                แจ้งเตือนเฉพาะลีดในพื้นที่ (ฟีดยังเห็นทั้งหมด กรองได้ด้วย “เฉพาะพื้นที่ให้บริการ”)
              </label>
              <div className="flex items-center gap-2 text-sm">
                <Label>เตือนตามลีดที่ติดตามหลัง</Label>
                <Select value={String(area.followUpDays)} onChange={(event) => void saveArea({ followUpDays: Number(event.target.value) })}>
                  {[0, 1, 2, 3, 5, 7, 14].map((days) => (
                    <option key={days} value={days}>{days === 0 ? "ไม่เตือน" : `${days} วัน`}</option>
                  ))}
                </Select>
              </div>
            </>
          ) : null}
        </Card>

        <Card className="space-y-3">
          <h2 className="font-semibold">{editing ? "แก้กฎ" : `สร้างกฎ (${rules.length}/${max})`}</h2>
          <Input value={draft.name} onChange={(event) => set("name", event.target.value)} placeholder="ชื่อกฎ เช่น ล้างแอร์ นนทบุรี" maxLength={60} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={draft.categoryId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, categoryId: event.target.value || null, subcategoryId: null }))} aria-label="หมวด">
              <option value="">ทุกหมวด</option>
              {topCats.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              {draft.categoryId && categories.find((item) => item.id === draft.categoryId)?.parentId ? (
                <option value={draft.categoryId}>{categories.find((item) => item.id === draft.categoryId)?.name}</option>
              ) : null}
            </Select>
            <Select value={draft.subcategoryId ?? ""} onChange={(event) => set("subcategoryId", event.target.value || null)} aria-label="หมวดย่อย" disabled={!subCats.length && !draft.subcategoryId}>
              <option value="">ทุกหมวดย่อย</option>
              {subCats.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Select value={draft.productId ?? ""} onChange={(event) => set("productId", event.target.value || null)} aria-label="เกม/สินค้า">
              <option value="">ทุกเกม/สินค้า</option>
              {productChoices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
            <Select value={draft.intent} onChange={(event) => set("intent", event.target.value)}>
              <option value="">ทุกเจตนา</option>
              <option value="buyer">กำลังหา (ลูกค้า)</option>
              <option value="seller">กำลังขาย</option>
              <option value="chat">พูดคุย/ถามทั่วไป</option>
              <option value="unknown">ไม่ชัด</option>
            </Select>
          </div>
          <Input value={draft.keywords} onChange={(event) => set("keywords", event.target.value)} placeholder="คำที่ต้องมีอย่างน้อยหนึ่งคำ คั่นด้วย , (เว้นว่าง = ไม่บังคับ)" />
          <Input value={draft.excludeKeywords} onChange={(event) => set("excludeKeywords", event.target.value)} placeholder="คำที่ห้ามมี คั่นด้วย , เช่น ขาย, แลก (เว้นว่าง = ไม่กรอง)" />
          <details className="rounded-lg border border-line px-2 py-1 text-sm">
            <summary className="cursor-pointer">กลุ่ม: {draft.sourceIds.length ? `${draft.sourceIds.length} กลุ่มที่เลือก` : "ทุกกลุ่ม"}</summary>
            <Input className="mt-2" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="ค้นหากลุ่ม" />
            <div className="mt-2 max-h-48 space-y-1 overflow-auto">
              {sources.filter((item) => !sourceQuery || item.name.toLowerCase().includes(sourceQuery.toLowerCase())).map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={draft.sourceIds.includes(item.id)} onChange={(event) => toggle("sourceIds", item.id, event.target.checked)} />
                  {item.name}
                </label>
              ))}
            </div>
          </details>
          <Input value={draft.provinces} onChange={(event) => set("provinces", event.target.value)} placeholder="จังหวัด คั่นด้วย , (เว้นว่าง = ทุกจังหวัด)" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Label>คะแนนขั้นต่ำ</Label>
            <Input type="number" min={0} max={100} className="w-20" value={draft.minScore} onChange={(event) => set("minScore", Math.max(0, Math.min(100, Number(event.target.value) || 0)))} />
            <Label>อายุโพสต์ไม่เกิน</Label>
            <Select value={String(draft.maxAgeHours)} onChange={(event) => set("maxAgeHours", Number(event.target.value))}>
              {[0, 1, 3, 6, 12, 24, 48, 72, 168].map((hours) => (
                <option key={hours} value={hours}>{hours === 0 ? "ไม่จำกัด (คิวดู 24 ชม.)" : hours < 24 ? `${hours} ชม.` : `${hours / 24} วัน`}</option>
              ))}
            </Select>
            <Label>ลำดับ</Label>
            <Input type="number" min={0} max={999} className="w-20" value={draft.priority} title="เลขน้อยทำก่อน เมื่อโพสต์ตรงหลายกฎ" onChange={(event) => set("priority", Math.max(0, Math.min(999, Number(event.target.value) || 0)))} />
          </div>
          <div className="grid gap-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.actionNotify} onChange={(event) => set("actionNotify", event.target.checked)} /> แจ้งเตือน (ในแอป + LINE/Discord/อีเมลที่ตั้งไว้)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.actionSave} onChange={(event) => set("actionSave", event.target.checked)} /> เก็บเข้าไปป์ไลน์ “กำลังติดตาม”</label>
            <label className="flex items-center gap-2 font-medium text-pine"><input type="checkbox" checked={draft.actionQueue} onChange={(event) => set("actionQueue", event.target.checked)} /> เข้าคิวตอบ (กฎการเม้น) — ระบบเปิดโพสต์และใส่ข้อความให้ คุณกดส่งเอง</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.actionDismiss} onChange={(event) => set("actionDismiss", event.target.checked)} /> ซ่อนโพสต์ (ใช้กรองขยะ)</label>
          </div>
          <Select value={draft.templateId ?? ""} onChange={(event) => set("templateId", event.target.value || null)}>
            <option value="">ไม่เตรียมข้อความตอบ</option>
            {templates.map((item) => (
              <option key={item.id} value={item.id}>เตรียมข้อความ: {item.name}</option>
            ))}
          </Select>
          {draft.actionQueue ? (
            <details className="rounded-lg border border-line px-2 py-1 text-sm" open={draft.templateIds.length > 0}>
              <summary className="cursor-pointer">ชุดข้อความที่ใช้เม้น: {draft.templateIds.length ? `เลือกเอง ${draft.templateIds.length} ข้อความ (วนสลับ)` : "อัตโนมัติ ตามเกม/กลุ่มของโพสต์"}</summary>
              <p className="mt-1 text-xs text-muted">ไม่เลือก = ใช้ชุดที่ตรงที่สุดจากหน้า ข้อความสำเร็จรูป (กลุ่ม+เกม › เกม › หมวด › ทั่วไป) แล้ววนข้อความที่ใช้น้อยสุด</p>
              <div className="mt-2 max-h-48 space-y-1 overflow-auto">
                {templates.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={draft.templateIds.includes(item.id)} onChange={(event) => toggle("templateIds", item.id, event.target.checked)} />
                    {item.name}{item.productId ? ` · ${products.find((p) => p.id === item.productId)?.name ?? ""}` : ""}
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          <div className="flex gap-2">
            <Button onClick={() => void saveRule()} disabled={!draft.name.trim() || (!editing && rules.length >= max)}>{editing ? "บันทึกการแก้ไข" : "สร้างกฎ"}</Button>
            {editing ? <Button variant="outline" onClick={() => { setEditing(null); setDraft(EMPTY); }}>ยกเลิก</Button> : null}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="font-semibold">กฎที่มี</h2>
        {!rules.length ? <p className="mt-3 text-sm text-muted">ยังไม่มีกฎ</p> : null}
        <div className="mt-3 space-y-3">
          {rules.map((rule) => {
            const cat = categories.find((item) => item.id === rule.categoryId);
            const tpl = templates.find((item) => item.id === rule.templateId);
            const st = stats[rule.id];
            const sub = categories.find((item) => item.id === rule.subcategoryId);
            const prod = products.find((item) => item.id === rule.productId);
            const ruleSources = list(rule.sourceIds);
            const actions = [rule.actionQueue && (list(rule.templateIds).length ? `เข้าคิวตอบ (ข้อความที่เลือก ${list(rule.templateIds).length})` : "เข้าคิวตอบ (ชุดอัตโนมัติ)"), rule.actionNotify && "แจ้งเตือน", rule.actionSave && "เก็บเข้าไปป์ไลน์", rule.actionDismiss && "ซ่อน", tpl && `ข้อความ “${tpl.name}”`].filter(Boolean);
            const result = preview[rule.id];
            return (
              <div key={rule.id} className={`rounded-xl bg-paper p-3 ${rule.enabled ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-card px-1.5 text-xs text-muted">#{rule.priority}</span>
                  <span className="font-medium">{rule.name}</span>
                  <span className="text-xs text-muted">ตรง {rule.hitCount} ครั้ง · ล่าสุด {bangkok(rule.lastHitAt)} (เวลาไทย)</span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={async () => {
                      await api(`/api/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) });
                      await load();
                    }}>{rule.enabled ? "ปิด" : "เปิด"}</Button>
                    <Button size="sm" variant="outline" onClick={async () => {
                      const data = await api<Preview>(`/api/rules/${rule.id}/preview`);
                      setPreview((current) => ({ ...current, [rule.id]: data }));
                    }}>{rule.actionQueue ? "โพสต์ที่เข้าเงื่อนไขตอนนี้" : "ทดสอบย้อนหลัง 7 วัน"}</Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      setEditing(rule.id);
                      setDraft({
                        name: rule.name, enabled: rule.enabled, categoryId: rule.categoryId, keywords: rule.keywords, provinces: rule.provinces, intent: rule.intent,
                        minScore: rule.minScore, actionNotify: rule.actionNotify, actionSave: rule.actionSave, actionDismiss: rule.actionDismiss, templateId: rule.templateId,
                        subcategoryId: rule.subcategoryId, productId: rule.productId, sourceIds: list(rule.sourceIds), excludeKeywords: rule.excludeKeywords,
                        maxAgeHours: rule.maxAgeHours, priority: rule.priority, actionQueue: rule.actionQueue, templateIds: list(rule.templateIds),
                      });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}>แก้</Button>
                    <Button size="sm" variant="outline" onClick={async () => {
                      if (!window.confirm(`ลบกฎ "${rule.name}"?`)) return;
                      await api(`/api/rules/${rule.id}`, { method: "DELETE" });
                      await load();
                    }}>ลบ</Button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted">
                  เมื่อ: {cat ? `หมวด ${cat.name}` : "ทุกหมวด"} · {rule.intent ? `เจตนา ${rule.intent === "buyer" ? "กำลังหา" : rule.intent === "seller" ? "กำลังขาย" : "ไม่ชัด"}` : "ทุกเจตนา"}
                  {sub ? ` · หมวดย่อย ${sub.name}` : ""}{prod ? ` · เกม ${prod.name}` : ""}{ruleSources.length ? ` · ${ruleSources.length} กลุ่ม` : ""}
                  {rule.keywords ? ` · มีคำ ${rule.keywords}` : ""}{rule.excludeKeywords ? ` · ห้ามมี ${rule.excludeKeywords}` : ""}{rule.maxAgeHours ? ` · อายุ ≤ ${rule.maxAgeHours} ชม.` : ""}{rule.provinces ? ` · จังหวัด ${rule.provinces}` : ""}{rule.minScore ? ` · คะแนน ≥ ${rule.minScore}` : ""}
                </p>
                {rule.actionQueue ? (
                  <p className="mt-1 text-xs">
                    วันนี้: ตรง {st?.matchedToday ?? 0} · รอเปิด {st?.queued ?? 0} · เปิดแล้ว {st?.opened ?? 0} · ตอบแล้ว {st?.sent ?? 0} · ข้าม {st?.skipped ?? 0} · พร้อมเข้าคิวตอนนี้ {st?.eligibleNow ?? 0}
                  </p>
                ) : null}
                <p className="text-xs text-muted">ทำ: {actions.length ? actions.join(", ") : "ไม่มี (บันทึกว่าตรงอย่างเดียว)"}</p>
                {result && rule.actionQueue ? (
                  <div className="mt-2 rounded-lg border border-line bg-card p-2 text-xs">
                    <div className="font-medium">โพสต์ที่เข้าเงื่อนไขตอนนี้: {result.nowTotal} (ยังไม่ตอบ ยังไม่อยู่ในคิว · ทดสอบเฉยๆ ไม่ได้เปลี่ยนอะไร)</div>
                    {result.now.map((row) => (
                      <div key={row.id} className="mt-2 border-t border-line pt-1">
                        <a href={row.url} target="_blank" rel="noreferrer" className="block truncate text-clay underline">{row.authorName || "ไม่ทราบชื่อ"} · {row.source} · คะแนน {row.score}: {row.text}</a>
                        <div className="text-muted">ข้อความ{row.template ? ` “${row.template}”` : " (ร่างเดิม)"}: {row.reply || "— ยังไม่มีข้อความที่ใช้ได้"}</div>
                      </div>
                    ))}
                    <div className="mt-2 text-muted">ย้อนหลัง 7 วันตรง {result.matched} จาก {result.scanned} โพสต์</div>
                  </div>
                ) : result ? (
                  <div className="mt-2 rounded-lg border border-line bg-card p-2 text-xs">
                    ตรง {result.matched} จาก {result.scanned} โพสต์ใน 7 วัน (ทดสอบเฉยๆ ไม่ได้เปลี่ยนอะไร)
                    {result.samples.map((sample) => (
                      <a key={sample.id} href={sample.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-clay underline">
                        {sample.authorName || "ไม่ทราบชื่อ"}: {sample.text}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>
      <ReplyQueuePanel />
    </div>
  );
}
