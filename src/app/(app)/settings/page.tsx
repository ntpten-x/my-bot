"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Button, Card, Input, Label, Select } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { ApiError, api } from "@/components/api";

type Settings = {
  aiProvider: "auto" | "ollama" | "gemini" | "groq" | "rules";
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiModel: string;
  groqModel: string;
  geminiKeySet: boolean;
  groqKeySet: boolean;
  fetchIntervalMinutes: number;
  jitterMinutes: number;
  maxGroupsPerCycle: number;
  scrollScreens: number;
  maxPostAgeHours: number;
  maxPostsPerRun: number;
  extensionToken: string;
  lineUserId: string;
  lineTokenSet: boolean;
  discordWebhook: string;
  notifyEmailTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassSet: boolean;
  notifySound: boolean;
  notifyMinScore: number;
  watchEnabled: boolean;
  watchNoPostsHours: number;
  watchExtOfflineMinutes: number;
  watchAlertEveryHours: number;
  watchParseSpikePct: number;
  quietPauseOnFacebook?: boolean;
  quietWindow?: string;
  quietPauseWhenLocked?: boolean;
  summaryTime: string;
  embedModel: string;
  geminiEmbedModel: string;
  ocrEnabled: boolean;
  visionOcr: boolean;
  lastBackupAt: string;
  lastBackupFile: string;
  embedLastOk: boolean;
  embedLastMessage: string;
  embedLastAt: string;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [groqApiKey, setGroqApiKey] = useState("");
  const [lineToken, setLineToken] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmToken, setConfirmToken] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<{ settings: Settings }>("/api/settings")
      .then((data) => setSettings(data.settings))
      .catch((err) => setError(err instanceof ApiError ? err.message : "โหลดการตั้งค่าไม่สำเร็จ"));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setError("");
    setMessage("");
    try {
      const data = await api<{ settings: Settings }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...settings,
          updateGeminiKey: geminiApiKey.length > 0,
          geminiApiKey,
          updateGroqKey: groqApiKey.length > 0,
          groqApiKey,
          updateLineToken: lineToken.length > 0,
          lineToken,
          updateSmtpPass: smtpPass.length > 0,
          smtpPass,
        }),
      });
      setSettings(data.settings);
      setGeminiApiKey("");
      setGroqApiKey("");
      setLineToken("");
      setSmtpPass("");
      setMessage("บันทึกแล้ว");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "บันทึกไม่สำเร็จ");
    }
  }

  async function test(provider: "ollama" | "gemini" | "groq" | "rules") {
    setMessage("");
    setError("");
    try {
      const data = await api<{ ok: boolean; message: string }>("/api/settings/test-ai", {
        method: "POST",
        body: JSON.stringify({ provider }),
      });
      if (data.ok) setMessage(data.message);
      else setError(data.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ทดสอบไม่สำเร็จ");
    }
  }

  if (!settings) return <p className="text-sm text-muted">{error || "กำลังโหลดการตั้งค่า..."}</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold">ตั้งค่า</h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
        เลือกตัวช่วยจัดหมวดได้หลายชั้น ถ้าตัวแรกใช้ไม่ได้ ระบบจะขยับไปตัวถัดไป และถ้าไม่มี AI เลยจะใช้คำจับคู่ในหมวดแทน
      </p>
      <Link href="/settings/ai-providers" className="mt-4 block rounded-2xl border border-line bg-card p-4 text-sm shadow-sm hover:bg-paper">
        <span className="font-semibold">ผู้ให้บริการ AI และ API key →</span>
        <span className="mt-1 block text-muted">เพิ่ม Groq, Gemini, OpenRouter, OpenCode Zen ฯลฯ เรียงลำดับ และสลับอัตโนมัติเมื่อโควตาหมด</span>
      </Link>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Link href="/settings/extension" className="block rounded-2xl border border-line bg-card p-4 text-sm shadow-sm hover:bg-paper">
          <span className="font-semibold">ส่วนขยาย Chrome: ดาวน์โหลดและจับคู่ →</span>
          <span className="mt-1 block text-muted">ติดตั้ง/อัปเดตส่วนขยาย สร้างรหัสจับคู่ และจัดการอุปกรณ์</span>
        </Link>
        <Link href="/settings/security" className="block rounded-2xl border border-line bg-card p-4 text-sm shadow-sm hover:bg-paper">
          <span className="font-semibold">ความปลอดภัย: เปลี่ยนรหัสผ่าน →</span>
          <span className="mt-1 block text-muted">ตรวจความแข็งแรงของรหัสผ่านสำหรับการใช้งานบนคลาวด์</span>
        </Link>
      </div>
      <form onSubmit={save} className="mt-5 space-y-4">
        <Card className="space-y-3">
          <h2 className="font-semibold">ผู้ช่วยจัดหมวด</h2>
          <div>
            <Label>โหมด</Label>
            <Select value={settings.aiProvider} onChange={(event) => setSettings({ ...settings, aiProvider: event.target.value as Settings["aiProvider"] })}>
              <option value="auto">อัตโนมัติ: Ollama แล้ว Gemini แล้ว Groq แล้วคำจับคู่</option>
              <option value="ollama">Ollama อย่างเดียว แล้วถอยไปคำจับคู่</option>
              <option value="gemini">Gemini อย่างเดียว แล้วถอยไปคำจับคู่</option>
              <option value="groq">Groq อย่างเดียว แล้วถอยไปคำจับคู่</option>
              <option value="rules">ใช้คำจับคู่เท่านั้น</option>
            </Select>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>ที่อยู่ Ollama</Label>
              <Input value={settings.ollamaBaseUrl} onChange={(event) => setSettings({ ...settings, ollamaBaseUrl: event.target.value })} />
            </div>
            <div>
              <Label>โมเดล Ollama</Label>
              <Input value={settings.ollamaModel} onChange={(event) => setSettings({ ...settings, ollamaModel: event.target.value })} />
            </div>
            <div>
              <Label>โมเดล Gemini</Label>
              <Input value={settings.geminiModel} onChange={(event) => setSettings({ ...settings, geminiModel: event.target.value })} />
            </div>
            <div>
              <Label>คีย์ Gemini {settings.geminiKeySet ? "(มีค่าแล้ว ว่างไว้ถ้าไม่เปลี่ยน)" : ""}</Label>
              <Input type="password" value={geminiApiKey} onChange={(event) => setGeminiApiKey(event.target.value)} placeholder="GEMINI_API_KEY" />
            </div>
            <div>
              <Label>โมเดล Groq</Label>
              <Input value={settings.groqModel} onChange={(event) => setSettings({ ...settings, groqModel: event.target.value })} />
            </div>
            <div>
              <Label>คีย์ Groq {settings.groqKeySet ? "(มีค่าแล้ว ว่างไว้ถ้าไม่เปลี่ยน)" : ""}</Label>
              <Input type="password" value={groqApiKey} onChange={(event) => setGroqApiKey(event.target.value)} placeholder="GROQ_API_KEY" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => test("ollama")}>ทดสอบ Ollama</Button>
            <Button type="button" variant="outline" onClick={() => test("gemini")}>ทดสอบ Gemini</Button>
            <Button type="button" variant="outline" onClick={() => test("groq")}>ทดสอบ Groq</Button>
            <Button type="button" variant="outline" onClick={() => test("rules")}>ทดสอบคำจับคู่</Button>
            <Button type="button" variant="ghost" onClick={async () => {
              const data = await api<{ deleted: number }>("/api/settings/clear-cache", { method: "POST" });
              setMessage(`ล้างแคช AI แล้ว ${data.deleted} รายการ`);
            }}>ล้างแคช AI</Button>
          </div>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">จังหวะดึงกลุ่ม</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label>ทุกกี่นาที</Label>
              <Input type="number" min={5} max={180} value={settings.fetchIntervalMinutes} onChange={(event) => setSettings({ ...settings, fetchIntervalMinutes: Number(event.target.value) })} />
            </div>
            <div>
              <Label>สุ่มเพิ่มอีกไม่เกิน (นาที)</Label>
              <Input type="number" min={0} max={30} value={settings.jitterMinutes} onChange={(event) => setSettings({ ...settings, jitterMinutes: Number(event.target.value) })} />
            </div>
            <div>
              <Label>กลุ่มสูงสุดต่อรอบ</Label>
              <Input type="number" min={1} max={10} value={settings.maxGroupsPerCycle} onChange={(event) => setSettings({ ...settings, maxGroupsPerCycle: Number(event.target.value) })} />
            </div>
            <div>
              <Label>เลื่อนลงกี่หน้าจอต่อกลุ่ม (0–10)</Label>
              <Input type="number" min={0} max={10} value={settings.scrollScreens} onChange={(event) => setSettings({ ...settings, scrollScreens: Number(event.target.value) })} />
            </div>
            <div>
              <Label>เก็บโพสต์อายุไม่เกิน (ชั่วโมง)</Label>
              <Input type="number" min={1} max={168} value={settings.maxPostAgeHours} onChange={(event) => setSettings({ ...settings, maxPostAgeHours: Number(event.target.value) })} />
            </div>
            <div>
              <Label>โพสต์สูงสุดต่อรอบ</Label>
              <Input type="number" min={5} max={40} value={settings.maxPostsPerRun} onChange={(event) => setSettings({ ...settings, maxPostsPerRun: Number(event.target.value) })} />
            </div>
          </div>
          <p className="text-sm text-muted">“ทุกกี่นาที” คือค่าเริ่มต้นของกลุ่มใหม่ที่ความสำคัญปกติ (สูง 3 · ปกติ 10 · ต่ำ 30 นาที ปรับรายกลุ่มได้ที่หน้าแหล่งข้อมูล) ระบบปรับรอบเองตามจำนวนโพสต์ใหม่: เจอเยอะ → ถี่ขึ้น (ต่ำสุด 2 นาที) · ไม่เจอ → ห่างขึ้น (สูงสุด 3 เท่า) ส่วนขยายเปิดทีละแท็บเท่านั้น เลื่อนอ่านอย่างเดียว ไม่กดอะไรบนหน้า Facebook และหยุดเมื่อเจอโพสต์ที่เคยเก็บแล้วหรือเก่าเกินกำหนด</p>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">โทเคนส่วนขยาย (แบบเดิม · ใช้ได้เฉพาะ localhost)</h2>
          <p className="break-all rounded-xl bg-paper px-3 py-2 font-mono text-sm">{settings.extensionToken || "ยังไม่มีโทเคน รัน seed หรือสร้างใหม่"}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={async () => {
              await navigator.clipboard.writeText(settings.extensionToken);
              setCopied(true);
            }}>{copied ? "คัดลอกแล้ว" : "คัดลอกโทเคน"}</Button>
            <Button type="button" variant="danger" onClick={() => setConfirmToken(true)}>สร้างโทเคนใหม่</Button>
          </div>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">ดึงข้อมูลเบื้องหลัง (โหมดเงียบ)</h2>
          <p className="text-sm text-muted">เมื่อจับคู่ส่วนขยายและเข้าสู่ระบบ Facebook แล้ว ระบบจะอ่านโพสต์เองอยู่เบื้องหลัง ในหน้าต่าง Chrome แยกหนึ่งหน้าต่างที่ถูกย่อไว้ (minimized) ตลอด ไม่เปิดแท็บในหน้าต่างที่คุณใช้อยู่ ไม่แย่งโฟกัส และไม่เด้งขึ้นมาบนจอ ถ้าปิดหน้าต่างนั้นไป ระบบจะสร้างใหม่แบบย่อไว้ในรอบถัดไป และจะปิดเองเมื่อว่างนานเกิน 20 นาที พักได้จากปุ่มในส่วนขยาย หรือตั้งเงื่อนไขพักด้านล่าง</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.quietPauseOnFacebook ?? true} onChange={(event) => setSettings({ ...settings, quietPauseOnFacebook: event.target.checked })} />
            พักขณะที่คุณกำลังเปิด Facebook อยู่ในหน้าต่างของคุณเอง
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.quietPauseWhenLocked ?? false} onChange={(event) => setSettings({ ...settings, quietPauseWhenLocked: event.target.checked })} />
            พักเมื่อหน้าจอคอมพิวเตอร์ล็อกอยู่
          </label>
          <div>
            <Label>ช่วงเวลาพัก (เช่น เวลาเล่นเกม) รูปแบบ 19:00-23:00 คั่นหลายช่วงด้วย , เว้นว่าง = ไม่พัก</Label>
            <Input placeholder="19:00-23:00" value={settings.quietWindow ?? ""} onChange={(event) => setSettings({ ...settings, quietWindow: event.target.value })} />
          </div>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">เฝ้าระวังระบบ (แจ้งเตือนเมื่อระบบผิดปกติ)</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.watchEnabled ?? true} onChange={(event) => setSettings({ ...settings, watchEnabled: event.target.checked })} />
            ส่งแจ้งเตือนภายนอกเมื่อพบปัญหา (หน้าภาพรวมแสดงสีแดงเสมอ)
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>ไม่มีโพสต์ใหม่เกิน (ชั่วโมง) ทั้งที่ส่วนขยายออนไลน์</Label>
              <Input type="number" min={1} max={48} value={settings.watchNoPostsHours ?? 6} onChange={(event) => setSettings({ ...settings, watchNoPostsHours: Number(event.target.value) })} />
            </div>
            <div>
              <Label>ส่วนขยายออฟไลน์เกิน (นาที)</Label>
              <Input type="number" min={5} max={720} value={settings.watchExtOfflineMinutes ?? 30} onChange={(event) => setSettings({ ...settings, watchExtOfflineMinutes: Number(event.target.value) })} />
            </div>
            <div>
              <Label>คุณภาพการอ่านโพสต์ตกลง (% ที่ขาดข้อความ/ชื่อเพิ่มขึ้น)</Label>
              <Input type="number" min={10} max={100} value={settings.watchParseSpikePct ?? 30} onChange={(event) => setSettings({ ...settings, watchParseSpikePct: Number(event.target.value) })} />
            </div>
            <div>
              <Label>แจ้งเตือนเรื่องเดิมซ้ำได้ทุก (ชั่วโมง)</Label>
              <Input type="number" min={1} max={48} value={settings.watchAlertEveryHours ?? 6} onChange={(event) => setSettings({ ...settings, watchAlertEveryHours: Number(event.target.value) })} />
            </div>
          </div>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-semibold">แจ้งเตือนภายนอก</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>แจ้งเตือนเมื่อคะแนนอย่างน้อย</Label>
              <Input type="number" min={0} max={100} value={settings.notifyMinScore} onChange={(event) => setSettings({ ...settings, notifyMinScore: Number(event.target.value) })} />
            </div>
            <div>
              <Label>เวลาสรุปรายวัน (เอเชีย/กรุงเทพ)</Label>
              <Input value={settings.summaryTime} onChange={(event) => setSettings({ ...settings, summaryTime: event.target.value })} placeholder="08:00" />
            </div>
            <div>
              <Label>โมเดลฝังข้อความ Ollama</Label>
              <Input value={settings.embedModel} onChange={(event) => setSettings({ ...settings, embedModel: event.target.value })} />
            </div>
            <div>
              <Label>โมเดลฝังข้อความ Gemini</Label>
              <Input value={settings.geminiEmbedModel} onChange={(event) => setSettings({ ...settings, geminiEmbedModel: event.target.value })} />
            </div>
          </div>
          <p className="text-sm text-muted">
            สถานะ embedding: {settings.embedLastMessage || "ยังไม่ได้ทดสอบ"} {settings.embedLastAt ? `(${settings.embedLastAt})` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={async () => {
              setMessage("");
              setError("");
              try {
                const data = await api<{ ok: boolean; message: string; dimensions: number; missing: number }>("/api/settings/test-embed", { method: "POST" });
                const text = `${data.message} ขาดอีก ${data.missing} โพสต์`;
                if (data.ok) setMessage(text);
                else setError(text);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "ทดสอบ embedding ไม่สำเร็จ");
              }
            }}>ทดสอบ embedding</Button>
            <Button type="button" variant="outline" onClick={async () => {
              setMessage("");
              setError("");
              try {
                const data = await api<{ queued: number }>("/api/settings/backfill-embeddings", { method: "POST" });
                setMessage(`ส่งให้ worker สร้างเวกเตอร์ใหม่ ${data.queued} โพสต์แล้ว`);
              } catch (err) {
                setError(err instanceof ApiError ? err.message : "เติม embedding ไม่สำเร็จ");
              }
            }}>สร้างเวกเตอร์ใหม่ในเบื้องหลัง</Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.ocrEnabled} onChange={(event) => setSettings({ ...settings, ocrEnabled: event.target.checked })} />
            อ่านข้อความในรูป (OCR ไทย+อังกฤษ)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.visionOcr} onChange={(event) => setSettings({ ...settings, visionOcr: event.target.checked })} />
            ถ้ามี Ollama ที่อ่านรูปได้ (qwen2.5vl หรือ llava) ให้ใช้ก่อน OCR
          </label>
          <p className="text-sm text-muted">
            สำรองฐานล่าสุด: {settings.lastBackupAt ? `${settings.lastBackupFile} (${settings.lastBackupAt})` : "ยังไม่มี — ระบบสำรองทุกวัน 03:00"}
            . ข้อมูลหลักอยู่บน Supabase ถ้าต้องกู้คืน ให้หยุดแอปแล้วรัน npm run db:restore -- (ไฟล์สำรอง) --replace
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.notifySound} onChange={(event) => setSettings({ ...settings, notifySound: event.target.checked })} />
            เล่นเสียงเมื่อฟีดมีลีดใหม่
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>LINE user id {settings.lineTokenSet ? "(มีโทเคนแล้ว)" : ""}</Label>
              <Input value={settings.lineUserId} onChange={(event) => setSettings({ ...settings, lineUserId: event.target.value })} />
            </div>
            <div>
              <Label>LINE channel access token</Label>
              <Input type="password" value={lineToken} onChange={(event) => setLineToken(event.target.value)} placeholder="ว่างไว้ถ้าไม่เปลี่ยน" />
            </div>
            <div className="md:col-span-2">
              <Label>Discord webhook</Label>
              <Input value={settings.discordWebhook} onChange={(event) => setSettings({ ...settings, discordWebhook: event.target.value })} />
            </div>
            <div>
              <Label>อีเมลผู้รับ</Label>
              <Input value={settings.notifyEmailTo} onChange={(event) => setSettings({ ...settings, notifyEmailTo: event.target.value })} />
            </div>
            <div>
              <Label>SMTP host</Label>
              <Input value={settings.smtpHost} onChange={(event) => setSettings({ ...settings, smtpHost: event.target.value })} />
            </div>
            <div>
              <Label>SMTP port</Label>
              <Input type="number" value={settings.smtpPort} onChange={(event) => setSettings({ ...settings, smtpPort: Number(event.target.value) })} />
            </div>
            <div>
              <Label>SMTP user</Label>
              <Input value={settings.smtpUser} onChange={(event) => setSettings({ ...settings, smtpUser: event.target.value })} />
            </div>
            <div>
              <Label>SMTP password {settings.smtpPassSet ? "(มีค่าแล้ว)" : ""}</Label>
              <Input type="password" value={smtpPass} onChange={(event) => setSmtpPass(event.target.value)} />
            </div>
          </div>
        </Card>
        {message ? <p className="text-sm text-pine">{message}</p> : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <Button type="submit">บันทึกการตั้งค่า</Button>
      </form>
      <Dialog open={confirmToken} onOpenChange={setConfirmToken} title="สร้างโทเคนใหม่">
        <p>ส่วนขยายที่ใช้อันเก่าจะส่งข้อมูลไม่ได้อีก ต้องวางโทเคนใหม่ในป๊อปอัปของส่วนขยาย</p>
        <div className="mt-4 flex gap-2">
          <Button
            onClick={async () => {
              const data = await api<{ settings: Settings }>("/api/settings/regenerate-token", { method: "POST" });
              setSettings(data.settings);
              setConfirmToken(false);
              setMessage("สร้างโทเคนใหม่แล้ว อย่าลืมอัปเดตในส่วนขยาย");
            }}
          >
            สร้างใหม่
          </Button>
          <Button variant="outline" onClick={() => setConfirmToken(false)}>ยกเลิก</Button>
        </div>
      </Dialog>
    </div>
  );
}
