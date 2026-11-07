# เปิดใช้การแก้คิว AI และฟีดค้าง รุ่น 1.11.1

อัปเดตเว็บและส่วนขยายเป็นชุดเดียวกัน รุ่นนี้ไม่มี migration หรือ dependency ใหม่ ยังไม่ถือเป็นผลยืนยันประสิทธิภาพจาก Facebook จริงหลังแก้ จนกว่า deploy เว็บและ Reload ส่วนขยายแล้วเก็บสถิติรอบใหม่

## สิ่งที่แก้

| จุดที่พบจาก production | การแก้ | หลักฐานทดสอบ |
| --- | --- | --- |
| งานถูกนับล้มเหลวซ้ำขณะ provider รอโควตา | แยก deferred ออกจาก actual failure; cooldown, โควตา และ HTTP 429 ไม่เพิ่ม attempts ของงาน นัดตาม provider ที่กลับมาพร้อมเร็วสุด | ทดสอบ processAiQueue จริงกับ DB/transport จำลอง งาน attempts=9 ตรวจซ้ำสองครั้งยังเป็น pending และ attempts=9 |
| ขีดจำกัดหลายอย่างใน provider เดียว | รอให้ทั้ง cooldown, daily และ minute window ผ่านก่อน แล้วเลือกเวลาที่เร็วสุดระหว่าง provider | ทดสอบการคำนวณวันรีเซ็ตและ minute release; ยึด Retry-After เมื่อผู้ให้บริการระบุมา |
| ผลทดสอบคีย์เป็นไฟเขียวแต่ worker ถูกโควตาบล็อก | ใช้ classification plan เดียวกันใน worker, health, watchdog และ overview แยกผลทดสอบการเชื่อมต่อออกจากความพร้อมจัดหมวด | classifier ที่ไม่มี provider พร้อมคืน attemptedIds ว่าง; readiness ระบุ ready=0 และเวลานัดตรงกัน ไม่มีการ seed registry จากการอ่านสถานะ |
| Spinner นอกฟีดทำให้รายงาน loading | ตรวจ loader ใน feed/main ที่เกี่ยวข้องและมองเห็น ตัด sidebar, dialog, hidden และ media ภายในโพสต์ออก | DOM จำลองและ Chrome จริงแยก loader ภายใน/ภายนอก/ซ่อนได้ |
| เลื่อน document แต่ฟีดอยู่ในกล่องซ้อน | เลือก ancestor ที่เลื่อนได้จริง ใช้กับ scroll, nudge และ growth observer | Chrome จริงเลื่อนกล่องภายใน 800 px โดยตำแหน่ง document คงเดิม |
| การกู้หนึ่งกลุ่มใช้เวลาจนกลุ่มอื่นรอนาน | ใช้ deadline ร่วม งบแต่ละกลุ่มไม่เกิน 45 วินาที รวม recovery และส่งข้อมูล; รอบจัดคิวมีงบ 3 นาที | ทดสอบสี่กลุ่มได้รับ deadline ของตัวเองครบภายในงบรอบ; งานที่ยังไม่เริ่มหมุนไปรอบถัดไป |
| ฟีดเงียบถูกเริ่มตรวจใหม่ทุก slice | เก็บ no-progress verification ข้าม slice และตรวจจบตั้งแต่ snapshot แรกเมื่อ resume | ทดสอบ slice สั้น 16 วินาทีหลายช่วงแล้วจบ exhausted ในแท็บเดิมและไม่ทำโพสต์หาย |
| แท็บไม่ตอบทำให้รอ executeScript ไม่จบ | จำกัดเวลารอ reader script และเก็บ checkpoint/outbox ไว้เพื่อกู้ต่อ | ทดสอบ promise ที่ไม่ resolve ได้ timeout โดยไม่กดส่งหรือเปลี่ยนข้อมูล Facebook |

จุดโค้ดหลัก: `src/lib/ai/router.ts`, `src/lib/pipeline/classify.ts`, `src/lib/ai/run.ts`, `src/lib/ai/queue.ts`, `extension/scrape.js`, `extension/background.js`

## พฤติกรรมที่เจ้าของจะเห็น

- คิว AI ยังเป็น pending เมื่อรอโควตา มีเวลาลองใหม่ ไม่เปลี่ยนเป็น failed เพียงเพราะวนมาตรวจตอนยังไม่พร้อม ความล้มเหลวจริง เช่น HTTP 503 หรือผลโมเดลที่ใช้ไม่ได้ ยังนับและพักเมื่อครบเกณฑ์เดิม
- ไม่เปลี่ยนเพดานโควตา คีย์ โมเดล หรือค่าพักของเจ้าของ ไม่ทำให้บัญชีมีเครดิตหรือโควตาเพิ่ม งาน failed เดิมไม่ได้ถูกรีเซ็ตอัตโนมัติ
- งบอ่าน/กู้ต่อกลุ่มลดลงและกันเวลาสำหรับระบาย outbox กับรายงานผล ถ้ายังมีโพสต์หรือยังตรวจไม่ครบ จะเก็บแท็บและนัดต่อประมาณ 30 วินาที ถ้าฟีดยัง loading/stalled นัดกู้ประมาณ 60 วินาที แล้วให้กลุ่มอื่นอ่านก่อน
- เวลานัดเป็นเวลาเข้าคิว ไม่ใช่คำรับรองว่าจะเริ่มในวินาทีนั้น Chrome/เครื่อง sleep และการรอ API ที่กำลังทำงานอยู่ทำให้คลาดเคลื่อนได้ timeout ตัดการรอของ worker ไม่ได้ยกเลิกงานที่ Chrome รับไปแล้วทั้งหมด
- Overview แยก “จบตรวจ”, “นัดอ่านต่อ”, “กู้ฟีด” และ “ผิดพลาด” เพื่อไม่ให้การพักตามงบถูกอ่านเหมือนการล้มเหลวทุกครั้ง
- “AI พร้อมจัดหมวดตอนนี้” ใช้การเลือก provider/โควตาแบบเดียวกับ worker การ์ดทดสอบคีย์ระบุว่าเป็นผลทดสอบการเชื่อมต่อและแจ้งเมื่อยังไม่พร้อมตามการตั้งค่า/โควตา

## เปิดใช้หลังตรวจโค้ด

1. Deploy เว็บรุ่นที่มีโค้ดนี้ บน Render ใช้ Environment เดิมของ Supabase ไม่ต้องคัดลอก `.env` ของเครื่องขึ้นไป
2. Reload ส่วนขยายจากโฟลเดอร์ที่อัปเดต หรือดาวน์โหลด ZIP ใหม่จากเว็บหลัง deploy ตรวจใน popup/ภาพรวมว่าเป็น **1.11.1**
3. เปิด Chrome และเข้าสู่ Facebook ตามเดิม ไม่ต้องล้าง storage หรือจับคู่ใหม่หากโทเคนเดิมยังใช้ได้
4. ตรวจ AI ready-now และเวลาโควตากลับมาพร้อมก่อนกด retry งาน failed เดิม ถ้ายังไม่มี provider พร้อม ควรรอหรือให้เจ้าของแก้การตั้งค่า provider ตามสิทธิ์บัญชีจริง

## ตรวจซ้ำ

ผลสุดท้าย: **501 tests ผ่าน, 88 ข้ามตามเงื่อนไข**, production build, Node syntax และ `git diff --check` ผ่าน ทั้ง 88 ข้อรวม DB integration ที่ยังไม่มี TEST_DATABASE_URL ไม่ได้นำ Supabase จริงมาใช้แทนชุดทดสอบ

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Regression หลักอยู่ใน `tests/pipeline/ai-deferred.test.ts`, `tests/pipeline/provider-auto.test.ts`, `tests/extension/continuous-reader.test.ts`, `tests/extension/feed-status.test.ts` และ `tests/extension/full-text-identity.test.ts`

ทดสอบ Chrome โปรไฟล์แยกด้วย `scripts/verify-continuous-reader-browser.js`: เปลี่ยน post keys โดย count/height คงเดิม ตรวจพบ growth ใน 357 ms เก็บครบ 6/6 เลื่อน document 800 px ในกรณีปกติ และเลื่อน nested container 800 px โดย document ไม่ขยับในกรณีซ้อน แยก false/visible/hidden loader ได้ ไม่มี page error ปิด Chrome ทดสอบแล้ว ไม่เข้าบัญชีจริงหรือส่งคอมเมนต์

ชุด integration ที่ต้องใช้ Postgres แยกยังข้ามเมื่อไม่มี TEST_DATABASE_URL ไม่ใช้ฐานข้อมูลจริงแทน ต้องตรวจสถิติหลัง deploy 1.11.1 ต่ออีกครั้ง โดยเฉพาะ due-to-start ต่อกลุ่ม, completed/recovery slices, งาน deferred เทียบกับ actual failure และ outbox อายุเก่าสุด ก่อนสรุปผลการทำงานต่อเนื่อง 24 ชั่วโมง
