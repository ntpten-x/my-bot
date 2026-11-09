# แก้คิว AI การรับโพสต์ และแท็บพักค้าง — 1.11.17

## อาการและหลักฐานก่อนแก้

ตรวจ Render วันที่ 9 พฤศจิกายน 2026 ช่วงประมาณ 12:52–13:03 น. Asia/Bangkok แบบอ่านอย่างเดียว พบส่วนขยาย 1.11.16 รับโพสต์เข้าฐานข้อมูลได้ 140 รายการในหน้าต่างตรวจ และคิวส่งกลับเป็น 0 แต่ AI เสร็จ 21 งาน ใช้เวลาเฉลี่ยประมาณ 101 วินาที มี pending 75 / running 10 และงานเก่าสุดรอประมาณ 7.5 นาที ตัวเลขนี้ไม่ใช่เวลาจากการเผยแพร่บน Facebook ถึงฐานข้อมูล

API รับโพสต์มีค่ากลางประมาณ 2.9 วินาทีและ p95 ประมาณ 14 วินาทีจาก 23 ตัวอย่าง การอ่านทุกกลุ่มยังเป็น incomplete จึงไม่ยืนยันว่าเก็บครบ ส่วน Groq ถึงโควตา Gemini อยู่ช่วงพัก OpenRouter timeout และ Cloudflare ตอบ JSON ไม่สมบูรณ์ ไม่ได้แก้โดยเพิ่มโควตา รีเซ็ตงาน failed เก่า หรือส่งคอมเมนต์จริง

## สาเหตุและการแก้

### แท็บพักและการกู้ฟีด

`closeOrphanReaders` เดิมรับแท็บ continuation กลับไว้ก่อนตรวจ orphan เมื่อข้อมูล server/account ตรงกันและพักไม่ถึง 2 ชั่วโมง ปุ่มเก็บกวาดใช้เส้นทางเดียวกันจึงข้ามแท็บพักด้วย การคง cursor ขณะอ่านต่อเป็นพฤติกรรมที่ตั้งใจ แต่ช่วงพักนานทำให้ดูเหมือนลืมปิด

รุ่นนี้คืนแท็บที่พักเกิน 5 นาที (ตรวจตอน heartbeat รอบถัดไป โดยปกติไม่เกินประมาณ 1 นาทีเพิ่ม) ปุ่มเก็บกวาดส่ง `parked: true` เพื่อคืนแท็บพักทันที ข้ามแท็บที่กำลังอ่านหรือส่งคอมเมนต์เสมอ การ resume cursor และ cleanup ใช้ lock เดียวกัน และลงทะเบียน active ภายใน lock เพื่อกันการปิดแท็บระหว่างรับกลับมาอ่าน ข้อมูล `coverageRecovery` และ pending posts ไม่ถูกลบ รอบถัดไปกู้ข้อมูลและอ่านลึกใหม่ได้ งานที่จบแล้วใช้เส้นทางปิดทันทีเดิม พร้อม retry หาก Chrome ยังปิดไม่ได้ หน้าต่างเปล่าที่เป็นของบอทปิดเมื่อไม่มี reader เหลือ ไม่สแกนปิดแท็บจาก URL และไม่ปิดแท็บที่เจ้าของย้ายหรือนำทางไปใช้งานเอง

`nudgeScroll` เดิมเลื่อนขึ้นแล้วใช้ `setTimeout` ในหน้า Facebook เพื่อเลื่อนกลับลง หาก page timer ถูกหน่วงจะหยุดครึ่งทาง รุ่นนี้ใช้ host timer ของส่วนขยายและ executeScript สองช่วงภายใต้ deadline เดียวกัน ยังคงใช้ scrollTop แบบ relative ไม่มี clicks หรือ Facebook API และไม่เปลี่ยนนโยบายแย่ง focus/minimized window

### AI

- `extractAiItems` เก็บเฉพาะ object ที่สมบูรณ์และ parse ได้จาก array หลัก `items/results/posts` หรือ root array เมื่อคำตอบขาดท้าย ไม่ซ่อมหรือคาดเดา field ของรายการที่ขาด ไม่กู้จาก nested array ที่ไม่เกี่ยวข้อง
- chain ส่งเฉพาะ ID ที่ยังไม่ได้คำตอบให้ provider ถัดไป ผลสำเร็จยังผ่าน sanitizer/ID matching และ cache เดิม
- คำขอ registry classification ระบุ output budget ตามจำนวนโพสต์ และใช้ cloud timeout 12 วินาที; Ollama ยังได้ 60 วินาที การลองใหม่เมื่อ provider ไม่รองรับ JSON mode ใช้ deadline เดียว ไม่เริ่มงบรอใหม่อีกก้อน
- คำตอบที่ไม่มี JSON/ID ใช้ได้พัก provider 60 วินาที แล้ว fallback ไม่ยิงซ้ำทุกชุดทันที ความผิดพลาดจริงยังนับ attempts ตามเดิม ส่วนโควตา/429 ยัง deferred ไม่เปลี่ยนเป็นความล้มเหลวของงาน
- การกดทดสอบ provider สำเร็จไม่ล้าง routing cooldown หรือเปลี่ยนโควตาของเจ้าของ

### การรับโพสต์

โหลด settings/keywords/catalog พร้อมกัน การ insert แบ่งชุดไม่เกิน 40 รายการ ใช้ createMany(skipDuplicates) และสร้าง AiJob ใน transaction เดียวกับ Post เลือกเฉพาะ ID ที่ transaction นี้สร้างจริง เมื่อ enqueue ล้มเหลว Post ทั้งชุดต้อง rollback ไม่เรียก upsert งาน AI ซ้ำทีละโพสต์อีก

การ sync labels ใน request จำกัดเฉพาะโพสต์ชุดนี้และ duplicate ที่เกี่ยวข้อง การบำรุงรักษา/worker ยังเรียกแบบเต็มได้ เพิ่ม metrics `ingest_prepare`, `ingest_store`, `ingest_enrich`, `ingest_notify` เพื่อแยกคอขวดหลัง deploy ไม่ย้ายงานสำคัญไป fire-and-forget และไม่เปลี่ยน schema

## บันทึกการทดลอง

1. เพิ่ม regression จากโค้ดจริง: แท็บพัก 5 นาทีและปุ่ม cleanup ยังไม่ปิด; truncated JSON ทิ้งรายการที่สมบูรณ์/ส่ง ID ซ้ำให้ fallback — ก่อนแก้ล้มเหลว 4 ข้อ หลังแก้ผ่าน
2. ตรวจข้อหักล้าง: cursor ที่ยังอ่านต่อถูก adopt ได้, active reader ไม่หมดอายุ, deep cursor ที่คืบหน้าผ่าน known posts ไม่ถูก recycle, owner navigation/window move ไม่ถูกปิด และ offline/outbox recovery ยังอยู่
3. เพิ่ม repro page timer ที่ไม่ทำงาน: เลื่อนขึ้นถึง 800 แต่ไม่กลับ 2100 ก่อนแก้ หลังใช้ host timer ผ่าน และ deadline หมดแล้วไม่ execute เลื่อนช่วงที่สอง
4. PostgreSQL ทดสอบแยก: รับ 40 รายการ/ส่งซ้ำไม่สร้างงานเพิ่ม; competing batches ได้โพสต์และงานอย่างละหนึ่ง; trigger จำลอง enqueue ล้มเหลวทำให้ทั้ง Post/AiJob rollback ครบ ใช้ TEST_DATABASE_URL เท่านั้น
5. ทดสอบกดเก็บกวาดพร้อมกับ resume โดยหน่วง Chrome lookup: ก่อนล็อกพบแท็บถูกปิดระหว่าง resume หลังแก้แท็บยังอยู่และเป็น active
6. ทดสอบ JSON-mode 400 → plain retry ใช้งบร่วม 1000/200ms และไม่เริ่ม request ใหม่หลังหมดเวลา; probe สำเร็จไม่เขียน cooldown/requestsToday

## ใช้งานรุ่นนี้

Deploy เว็บ/worker แล้วดาวน์โหลดส่วนขยาย 1.11.17 จากหน้าตั้งค่า แตกไฟล์แทนชุดเดิมและ Reload ที่ chrome://extensions ตรวจภาพรวมว่า version ตรงกัน ไม่ต้อง migrate ฐานข้อมูล ไม่เปิดกฎคอมเมนต์หรือเปลี่ยน provider/โควตาแทนเจ้าของ

หาก Chrome ยังทำงานบนฟีดหรืออ่านต่ออย่างต่อเนื่อง แท็บนั้นยังมีงานจึงอาจเปิดอยู่ การหมดอายุ 5 นาทีวัดจากการพัก ไม่ใช่ตัดงานที่อ่านเกิน 5 นาที แท็บเก่าที่ไม่มีหลักฐาน ownership ใน session อาจต้องปิดด้วยมือหนึ่งครั้ง

ผล regression ไม่ใช่การรับรองความเร็ว production หลัง deploy ต้องวัด queue age, provider timeout/invalid-response, ingest p50/p95, incomplete coverage และ parked/closing ต่อ การหมดโควตาจริงยังต้องรอรีเซ็ตหรือเจ้าของเลือก provider ที่มี capacity ไม่รับรองการเห็นทุกโพสต์ภายในหนึ่งวินาที

## ผลยืนยันก่อนส่งมอบ

`npm test` ผ่าน 857/857 ข้อ (96 ไฟล์) โดยเปิด PostgreSQL ทดสอบแยกที่พอร์ต 55432; `npm run build`, `node --check` สำหรับ background/popup และ `git diff --check` ผ่าน ZIP 1.11.17 ผ่าน CRC และตรวจ manifest/install-config แล้ว ยังไม่ได้ push/deploy หรือทดสอบส่งคอมเมนต์จริง ผลเวลาของ production ข้างต้นเป็น baseline ก่อนแก้
