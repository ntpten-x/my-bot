# Roadmap ประสิทธิภาพและความพร้อมกัน (MY-BOT)

เจ้าของอนุมัติ: รวมเป้า D — (A) เก็บกลุ่มทัน (B) UI ลื่น (C) เสถียรยาว โดยจัดเฟส 0→5 ตามลำดับความเสี่ยงต่ำก่อน

## บริบท

MY-BOT เป็นเรดาร์ลีดเจ้าของคนเดียว: Extension อ่านกลุ่มใน Chrome → ingest/API → Worker (lease คนเดียว) → Supabase → UI/SSE

งานประสิทธิภาพสำคัญถูกทำไปแล้วช่วง พ.ย. 2026 (adaptive worker, SSE ชุดเดียวต่อแท็บ, settings cache, stall backoff, metrics บนภาพรวม, ลด field โพสต์ ฯลฯ) เอกสารอ้างอิง: `docs/PERFORMANCE-RUNTIME-2026-11-19.th.md`, `docs/HANDOFF-2026-11-19-PERFORMANCE-COMMENTS.th.md`, `docs/PERFORMANCE-FIXES.th.md`

จุดสำคัญในโค้ดปัจจุบัน: คิว AI ฝั่ง model ถูก stub ให้ไม่ enqueue/consume (`src/lib/ai/queue.ts` คืน 0) — โหมดหลักพึ่งกฎ/เส้นทางที่ยังเปิดอยู่ การขยาย “พร้อมกัน” จึงโฟกัส scrape, DB pool, worker และ UI เป็นหลัก

## นิยามความสำเร็จ

“รองรับการใช้งานพร้อมกันได้มากที่สุด” ในผลิตภัณฑ์นี้หมายถึง:

- หลายแหล่ง/กลุ่ม Facebook ที่เปิดใช้
- โพสต์เข้าหนาในช่วงพีค
- แท็บแอปเปิดค้างพร้อม worker ทำงาน

ไม่หมายถึงผู้ใช้หลายคนพร้อมกัน (นอกขอบเขตผลิตภัณฑ์)

เป้าคุณภาพสามด้าน:

| ด้าน | นิยามปฏิบัติ |
| --- | --- |
| ทันกลุ่ม (A) | แหล่งที่เปิดใช้ไม่ค้าง overdue นานผิดปกติ; capture/ingest ไม่พังเมื่อพีค |
| UI ลื่น (B) | สลับหน้า/ฟีดตอบสนอง; ไม่มี polling หนักตอนแท็บซ่อน; live update ชุดเดียวต่อแท็บ |
| เสถียร (C) | worker ไม่วนตายจาก lease/OOM; transient DB ลด; รันต่อเนื่อง 24–72 ชม. ได้โดยไม่ต้องรีสตาร์ทบ่อย |

เกณฑ์รวม: มีตัวเลขจากภาพรวมระบบ / `profile:reads` / observation ไม่เดาสุ่ม

## เพดานที่ต้องเคารพ

- Extension: reader พร้อมกันจำกัด, transport batch จำกัด, ไม่เรียก Facebook API ส่วนตัวเพื่อเร่ง
- Worker: lease คนเดียว — ป้องกันงานซ้ำ; ห้ามปิดเพื่อ “เร่ง”
- Supabase transaction pooler: `connection_limit` ต่ำ (ค่าเริ่มต้นในโค้ดประมาณ 8) แชร์ web + worker (+ Render ถ้าเปิด)
- คอมเมนต์อัตโนมัติ: sequential / claim / ไม่ retry uncertain — ห้ามเพิ่ม concurrency ส่งเพื่อความเร็ว
- Render free tier: cold start — ไม่เหมาะเป็นจุดรับ heartbeat/ingest หลักถ้าใช้เครื่อง local เป็นหลัก

## เฟสงาน

แต่ละเฟสจบด้วยหลักฐานวัดได้ และไม่ข้ามเฟส 0

### เฟส 0 — วัดฐาน (บังคับก่อนแก้)

- อ่าน **ภาพรวมระบบ → ประสิทธิภาพ runtime** (DB p50/p95, SSE, worker polls, RSS)
- รัน `npm run profile:reads -- --db` (read-only)
- นับแหล่ง enabled, โพสต์ต่อวันโดยประมาณ, แหล่ง overdue / คิวแจ้งเตือน
- ยืนยัน extension ≥ รุ่นขั้นต่ำของเซิร์ฟเวอร์ และไม่ให้หลายรุ่นออนไลน์แย่งงานโดยไม่ตั้งใจ
- ผลลัพธ์: บันทึกตัวเลขฐานในโน้ตสั้นหรืออัปเดตเอกสาร soak (ไม่ใส่ความลับ)

### เฟส 1 — เสถียร (C)

- ตรวจ/ปรับ `DB_CONNECTION_LIMIT` และพฤติกรรม pool ให้เหมาะกับโควตา Supabase โดยไม่เปิด connection จนโดน throttle
- แยกบทบาท host: ถ้า local เป็นจุด ingest หลัก อย่าให้ Render free แย่ง heartbeat/extension แบบ active โดยไม่ตั้งใจ
- ยืนยัน worker lease, progress heartbeat, และว่า maintenance (backup/retention/dedupe) ไม่ชนพีคโดยไม่จำเป็น
- ลดสาเหตุ transient DB จาก watchdog/overview

### เฟส 2 — ทันกลุ่ม (A)

- จัด priority / ช่วงเวลาแหล่ง (สูง·ปกติ·ต่ำ) ตามมูลค่าจริง ไม่ดันทุกกลุ่มเป็นสูง
- ปรับ `max_posts_per_run` และพฤติกรรม continuation ตามของจริง (อยู่ในกรอบกติกา scrape ที่มีอยู่)
- ใช้ stall backoff / version floor ที่มีอยู่แล้วให้ครบเครื่อง
- ไม่เพิ่มจำนวน reader พร้อมกันเกินที่ extension/server กำหนดเพื่อ “เร่ง”

### เฟส 3 — UI ลื่น (B)

- ตรวจหน้าฟีด / ภาพรวม / คอมเมนต์ ว่าไม่เปิด SSE ซ้ำ และเคารพ visible refresh
- ลด refetch ซ้ำและงานตอนแท็บซ่อน (ต่อยอด `startVisibleRefresh` / LiveUpdates)
- คง lazy image และขอบเขต pageSize ที่มี; แก้เฉพาะจุดที่วัดแล้วช้า

### เฟส 4 — โตข้อมูล

- หลังมีผล `profile:reads` จากข้อมูลจริง: เพิ่ม/ปรับ index หรือขอบเขตค้นหาตามจุดที่ช้าจริง
- จำกัดงาน maintenance หนักให้อยู่ช่วงเงียบ
- ไม่เปลี่ยนสัญญา API ภายนอกโดยไม่จำเป็น

### เฟส 5 — AI (เฉพาะเมื่อเจ้าของสั่งเปิด model อีกครั้ง)

- ออกแบบคิวแยกจาก scrape/UI, เคารพโควตา/cooldown/Retry-After
- จำกัดโมเดล Ollama ที่โหลดพร้อมกันตาม `OLLAMA_MAX_LOADED_MODELS`
- ห้ามให้การเปิด AI ทำให้ scrape หรือส่งคอมเมนต์พัง

## นอกขอบเขต

- Multi-tenant / ผู้ใช้พร้อมกันหลายบัญชีเจ้าของ
- เพิ่ม concurrency การส่งคอมเมนต์ หรือ auto-retry งาน uncertain
- ปิด worker lease หรือข้าม claim/authorize
- ฝืนเพดาน Chrome/Facebook ด้วยคลิก/API ส่วนตัว
- สัญญาว่าจะได้ X โพสต์/นาที โดยไม่มีตัวเลขจากเฟส 0

## ลำดับ implement ที่แนะนำ

1. เขียนแผนย่อยทีละเฟสหลังมีตัวเลขเฟส 0 (เริ่มจากเฟส 1 ถ้าฐานชี้ DB/worker; หรือเฟส 2 ถ้าฐานชี้ overdue scrape)
2. แต่ละเฟส: วัด → แก้แคบ → `npm test` + `npm run build` → ตรวจภาพรวม/soak สั้น
3. อย่ารวมเฟส 4–5 ใน PR เดียวกับเฟส 1–2 โดยไม่มีหลักฐาน

## ตรวจรับระดับ roadmap

- มีบันทึกตัวเลขฐานจากเฟส 0
- เฟส 1–3 ที่ทำแล้วมี before/after หรือเหตุผลว่าไม่ต้องแก้
- ระบบยังผ่าน doctor/health และไม่ลดกติกา safety ของคอมเมนต์
- เจ้าของยืนยันความรู้สึกใช้งาน (ลื่น/ทันกลุ่ม) หลัง deploy/รีสตาร์ทบนเครื่องจริง
