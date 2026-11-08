# ผลตรวจระบบดึงโพสต์และคอมเมนต์ 2026-11-09

> อัปเดตหลังเจ้าของอนุมัติให้แก้: แก้โค้ดและชุดทดสอบแล้ว ดูหัวข้อ “ผลหลังแก้” ท้ายเอกสาร ผลตรวจด้านล่างเป็น baseline ก่อนแก้ ส่วนการเชื่อม Supabase จริงและเก็บผล 24 ชั่วโมงยังรอการตั้งค่าใน `.env`

ตรวจโค้ด commit b133343 และทดสอบบน Windows เครื่องนี้ ไม่ส่งคอมเมนต์จริง ไม่เปลี่ยนกฎ โควตา หรือ secrets ไม่ได้ตรวจสถานะ Render หรือ Chrome ของเครื่องที่ใช้งานจริง

## ข้อสรุป

ยังรับรองความเสถียรและประสิทธิภาพในการใช้งานจริงไม่ได้ โครงสร้างป้องกันการส่งซ้ำมีอยู่ แต่พบคิวดึงโพสต์ติดขัดเมื่อเปลี่ยนเซิร์ฟเวอร์ และสภาพแวดล้อมในเครื่องยังใช้ฐานข้อมูลรุ่นเดิม

## สิ่งที่ต้องแก้ เรียงตามความสำคัญ

1. **เครื่องนี้ยังไม่พร้อมรันรุ่นปัจจุบัน**: doctor รายงาน DATABASE_URL เป็น SQLite แทน PostgreSQL, ฐานข้อมูลใช้งานไม่ได้, พอร์ต 8001 ว่าง และอ่าน token ไม่ได้เพราะฐานข้อมูลไม่พร้อม ต้องตั้ง DATABASE_URL/DIRECT_URL ของ Supabase ผ่าน .env จากเจ้าของก่อน migrate และเริ่มระบบ ไม่ควรตีความผลนี้ว่า Render ล่ม
2. **คิวเซิร์ฟเวอร์เดิมขวางคิวปัจจุบัน**: extension/background.js:248 เลือกรายการแรกที่ไม่มี problem แล้วบรรทัด 249 break หาก apiBase ต่างจากเซิร์ฟเวอร์ปัจจุบัน ทำให้รายการปัจจุบันที่อยู่ถัดไปไม่ถูกส่ง ตัวจำลองใช้ฟังก์ชัน flushOutbox จากโค้ดจริง: คิวปัจจุบันอย่างเดียวเรียก HTTP 1 ครั้ง; มีรายการเซิร์ฟเวอร์เดิมนำหน้าเรียก 0 ครั้ง แนวแก้ขั้นต่ำคือเลือกรายการที่ตรง apiBase ปัจจุบันตั้งแต่ต้น เก็บคิวเซิร์ฟเวอร์อื่นไว้ และเพิ่ม regression สลับเซิร์ฟเวอร์ ต้องตรวจ backpressure ที่ใช้จำนวนคิวรวมด้วย ไม่ย้ายข้อมูลข้ามเซิร์ฟเวอร์
3. **ชุดทดสอบไม่ผ่านทั้งหมด**: live-contract-regressions.test.ts ไม่ mock facebookWorkAllowed ซึ่งเพิ่มเข้ามาใน ingest ทำให้ไปอ่านฐานข้อมูลจริงก่อนถึง ingest mock; ข้อผิดพลาด 500/503 จึงทดสอบไม่ถึงเส้นทางที่ต้องการ อีกสองข้อใน bot-browser-launcher.test.ts และ bot-desktop.test.ts คาด path แบบ POSIX ขณะใช้ node:path บน Windows ควรแยกทดสอบตาม OS และจำลอง boundary ของ account control อย่างชัดเจน ไม่ใช่เปลี่ยน production ให้ข้าม account control
4. **ยังขาดหลักฐานฐานข้อมูลและการทำงานต่อเนื่อง**: 112 tests ถูกข้าม รวม DB suites ที่ตรวจ concurrency/lease/dispatch และ recovery ต้องตั้ง TEST_DATABASE_URL เป็น PostgreSQL ทดสอบแยก ห้ามใช้ production เป็น fallback แล้วตรวจทุก suite ก่อนรับรอง

## ความสามารถที่ตรวจพบในโค้ดและ tests

- ดึงโพสต์: แบ่ง transport ไม่เกิน 40, outbox รอ receipt ก่อนลบ, checkpoint/continuation, deadline และการกู้ MV3 restart มีชุดทดสอบผ่านใน continuous-reader, outbox, reader-focus และ feed-status
- คอมเมนต์: claim/authorize/report อยู่ภายใต้ control lock, generation/revision และอุปกรณ์/บัญชี, ตรวจ quota ก่อน claim และ authorize, durable sending marker ก่อนออก grant 3 วินาที และ uncertain ไม่ส่งซ้ำอัตโนมัติ อยู่ใน src/lib/auto-comment/browser.ts และ extension/comment-worker.js ชุดทดสอบ DOM สังเคราะห์และ comment-worker ผ่าน
- ความสำเร็จที่รายงานจาก DOM ไม่ใช่การยืนยันจาก Facebook API และ Stop ไม่ยกเลิก grant ที่ออกไปแล้วทันที

## ข้อเสนอด้านประสิทธิภาพที่ต้องวัดก่อนแก้

- scanBrowserComments จำกัด 100 candidates ต่อรอบ แต่โหลด rules พร้อม templates ใหม่ใน transaction ของแต่ละโพสต์ (browser.ts:83-88) จึงมี query ซ้ำตามจำนวนโพสต์และกฎ ควรวัดเวลา query และระยะถือ control lock ก่อนปรับ batch หรือ cache; ห้ามลดการตรวจ revision ก่อนส่ง
- Extension เรียกงานคอมเมนต์จาก alarm ทุก 30 วินาที (background.js:1652,1677) และรอ observe ได้หลายครั้ง การเพิ่มความถี่อย่างเดียวไม่พิสูจน์ว่าเร็วขึ้น ควรวัดเวลาตั้งแต่นำเข้า→AI→browser_ready→dispatch→observed และสัดส่วน not_sent/uncertain
- ควรสังเกตการอ่านจริง 24 ชั่วโมง: โพสต์ใหม่ต่อนาที, อายุ pending เก่าสุด, กลุ่มเกินกำหนด, incomplete/loading/stalled, และ outbox หลังเครือข่ายหลุด/Chrome restart โดยเริ่มจากอ่านอย่างเดียว การส่งคอมเมนต์จริงต้องได้รับอนุมัติแยก

## ผลคำสั่งรอบนี้

- npm test: 614 ผ่าน, 4 ล้มเหลว, 112 ข้าม; 70 files ผ่าน, 3 ล้มเหลว, 10 ข้าม
- npm run build: ผ่าน รวม compile และ type checking
- npm run doctor: 3 FAIL, 6 WARN
- node data/audit-outbox-review.cjs: reproduced=true; baselineRequests=1, requestsWithOldServerAtHead=0
- ไม่แก้ runtime code หรือ deploy ในรอบตรวจนี้

## ผลหลังแก้

### คิวดึงโพสต์และการทดสอบ

แก้ `flushOutbox` ให้เลือกรายการที่ตรงกับเซิร์ฟเวอร์ปัจจุบันตั้งแต่ต้น เก็บรายการเซิร์ฟเวอร์อื่นไว้ ไม่ส่งข้ามเซิร์ฟเวอร์ เพิ่มการเทียบเซิร์ฟเวอร์เวลาลบหรือทำเครื่องหมายคิว legacy เพื่อไม่ลบรายการผิดหาก source และ timestamp ซ้ำกัน คิวรวมยังจำกัด 200 batches เพื่อไม่ให้ใช้พื้นที่ไม่จำกัด เมื่อคิวเต็มด้วยข้อมูลเซิร์ฟเวอร์เก่าทั้งหมด จะยังหยุดอ่านเพิ่มตามเดิม ต้องกลับไปส่งคิวเดิมให้หมดก่อน ไม่ลบทิ้งอัตโนมัติ

ทดสอบทั้งกรณีคิวต่างเซิร์ฟเวอร์ขวางหัว, คิวเต็มแบบผสม, คิวเต็มของเซิร์ฟเวอร์เก่า, legacy collision และการลบตาม item receipts ส่วนขยายและ expected version เพิ่มเป็น **1.11.10** ต้อง Reload ส่วนขยายก่อนใช้กับเซิร์ฟเวอร์รุ่นนี้

แก้ mock ตัวตรวจบัญชีของ ingest โดยยังรักษาการตรวจบัญชีจริง แก้ตัววางแผน Chrome ให้เลือก `path.win32` หรือ `path.posix` ตามระบบเป้าหมาย ส่วน virtual desktop ใช้ POSIX เสมอ เพิ่มการตรวจ Windows path ที่มีช่องว่างกับ Linux path ในชุดเดียวกัน

เมื่อเปิด PostgreSQL ทดสอบแยก พบเพิ่มว่าการ `mockRestore()` บน Prisma extended proxy ทำให้ `$queryRaw` หายและข้อถัดไปล้มเหลว จึงคืนค่าฟังก์ชันเดิมอย่างชัดเจน ไม่แก้ production เพื่อรองรับ mock ที่ผิด

### วัดประสิทธิภาพก่อนปรับความถี่

Worker เก็บตัวอย่างล่าสุดไม่เกิน 200 ค่าต่อ metric และเขียนสรุปลง `data/mybot.log` ไม่เกินนาทีละครั้ง:

- `comment_scan`: เวลาสแกนหนึ่งรอบ
- `comment_prepare`: เวลาเตรียมงานหนึ่งรอบ
- `comment_scan_transaction`: เวลา transaction ต่อโพสต์ รวมการรอและ commit
- `comment_scan_lock`: เวลาทำงานภายใน callback หลังได้ control lock ไม่รวม commit

ค่า `count`, `p50`, `p95` เป็นมิลลิวินาที ไม่มีข้อความโพสต์หรือ secrets ถ้าเขียน log ไม่สำเร็จจะไม่ทำให้งานล้มเหลว ไม่ cache กฎหรือขยาย batch โดยไม่มีหลักฐาน และยังตรวจ revision/generation ก่อนอนุญาตส่งเหมือนเดิม

เพิ่ม log `browser_ready` ของ AI Draft ใน transaction ที่ยืนยัน revision แล้ว เพื่อให้วัดระยะรอได้เช่นเดียวกับข้อความสำเร็จรูป

### เก็บหลักฐานจริง 24 ชั่วโมง

ต้องตั้ง `DATABASE_URL` ให้เป็น PostgreSQL ของระบบที่ต้องการสังเกตก่อน ห้ามส่งค่ารหัสผ่านหรือ URL ฐานข้อมูลในแชต เครื่องมือนี้อ่านข้อมูลเท่านั้น ไม่มีคำสั่งเริ่ม collector หรือคอมเมนต์

```powershell
npm.cmd run observe:automation -- --once
npm.cmd run observe:automation -- --hours=24 --interval-seconds=60
```

ไฟล์ออกที่ `data/automation-observation-<timestamp>.jsonl` ซึ่ง gitignore แล้ว หยุดด้วย Ctrl+C ได้ เก็บเฉพาะผลรวม ได้แก่ posts/minute, incomplete/loading/stalled ของส่วนขยายรุ่นปัจจุบัน, กลุ่มเกินกำหนด, AI pending และอายุเก่าสุด, outbox ของอุปกรณ์ออนไลน์, pending/parked/อายุคิวจาก capture heartbeat, สถานะงานคอมเมนต์ และ p50/p95 จากนำเข้าถึง AI done / browser_ready / dispatch / observed

ตัวเลข collection และ job outcomes นับตั้งแต่เริ่มเก็บ ส่วน latency ใช้เหตุการณ์ที่เกิดในช่วงเก็บและคิดจากเวลา ingest อาจรวมโพสต์นำเข้าก่อนเริ่มเก็บได้ ข้อมูล heartbeat ที่เก่าเกิน 10 นาทีจะแสดงเป็นไม่ทราบ ไม่สรุปว่าคิวเป็นศูนย์ AI Draft รุ่นเก่าที่ไม่มี ready log จะไม่มีตัวอย่าง ready ย้อนหลัง และ DOM observed ยังไม่ใช่ผลยืนยันจาก Facebook API

หากฐานข้อมูลไม่พร้อมหรือ query เกิน 15 วินาที จะบันทึก `SAMPLE_FAILED` โดยไม่แสดง exception ที่อาจมีข้อมูลลับ `--once` ออกด้วยรหัสล้มเหลว; โหมดต่อเนื่องลองใหม่ในรอบถัดไป ต้องมีข้อมูลจริงครบช่วงเวลาและตรวจอัตรา error ก่อนสรุปความเสถียร ไม่มีการอ้างว่าเก็บครบ 24 ชั่วโมงในรอบพัฒนานี้

### หลักฐานการตรวจหลังแก้

- PostgreSQL ทดสอบแยกบน loopback พอร์ต 55439 ใช้ disposable `test_*` schemas ไม่ใช้ `.env` ของ production เป็น fallback
- ชุดทดสอบทั้งหมดผ่าน 734 ข้อ ข้าม 4 ข้อเฉพาะ Linux/VNC บน Windows; DB suites ไม่ถูกข้ามแล้ว
- ติดตั้ง dependencies ด้วย `npm ci` ตาม lockfile และยืนยันชุดทดสอบทั้งหมดอีกครั้งด้วย Vitest 4.1.12 ไม่ใช้ผลจากแพ็กเกจเดิมเพียงอย่างเดียว หลังปรับ mutex รอบอ่านสถานะ backpressure ตรวจ outbox/reader/ingest เพิ่ม 37 ข้อผ่าน
- ทดสอบ collector กับฐานจริงแยก ยืนยันผลรวมและ latency, สถานะงาน/consent ไม่เปลี่ยน, ไม่เปิดเผยข้อความ/อุปกรณ์/ค่าลับ และแยก heartbeat เก่าออกจากข้อมูลสด
- Build ผ่าน; ครั้งแรกชน DLL จากการรัน Prisma generate พร้อม DB tests บน Windows จึงรันใหม่หลัง tests จบ
- ESLint เฉพาะไฟล์ที่เปลี่ยนไม่มี error มี warning เดิมหนึ่งรายการใน background.js; lint ทั้ง repo ยังมีข้อผิดพลาดเดิมจากไฟล์ทดสอบและ local browser artifacts นอกขอบเขตนี้
- ยังไม่ deploy, ไม่เริ่มระบบจริงด้วยฐานทดสอบ, ไม่เปลี่ยนโควตา และไม่ส่ง Facebook comments จริง
- ปิด PostgreSQL ทดสอบชั่วคราวแล้ว ข้อมูล cluster อยู่ในโฟลเดอร์ที่ gitignore ไว้ ไม่แก้ connection strings จริง `doctor` ของเครื่องยังรายงาน 3 FAIL / 6 WARN ตามฐาน SQLite เดิม
