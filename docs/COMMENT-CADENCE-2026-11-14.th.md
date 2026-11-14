# การตรวจรอบส่งคอมเมนต์ 2026-11-14

รอบแรก: ตรวจโค้ดฐาน `a5372de` และทดสอบ offline ด้วย mock Chrome/เซิร์ฟเวอร์ ไม่เริ่มบอท ไม่เชื่อมฐานจริง ไม่ส่ง Facebook และไม่ deploy ต่อมาผู้ใช้อนุญาตให้ดำเนินงานที่เหลือทั้งหมด จึงตรวจและอัปเดตเครื่องจริงตามรายละเอียดท้ายเอกสาร

## สิ่งที่พบจากโค้ด

1. `areaCooldownSec=60` คือระยะพักขั้นต่ำต่อกลุ่มนับจาก dispatch ไม่ใช่คำสั่งให้ส่งซ้ำทุกนาทีโดยไม่มีโพสต์ใหม่ กฎยังต้องผ่านเวลา คำสำคัญ แหล่งข้อมูล อายุโพสต์ บัญชี อุปกรณ์ และ consent
2. `claimBrowserComment()` บันทึก `nextAttemptAt` เมื่อรอ cooldown/โควตา แต่ API เดิมคืนเพียง `job:null` ทำให้ Extension ไม่ทราบเวลาที่ควรกลับมารับงาน ต้องอาศัย alarm รายหนึ่งนาทีหรือ ingest/heartbeat nudges ซึ่งไม่ได้สัมพันธ์กับเวลาคิว
3. `drain()` จำกัดสามงานและงบ 90 วินาที เมื่อส่งสำเร็จแต่เวลารอบเหลือไม่พอ จะจบโดยไม่ตั้ง continuation
4. โควตาที่ตั้งได้สูงสุดคือ 50 dispatch ต่อชั่วโมงย้อนหลัง และ 200 ต่อวันไทย (`control.ts`, `schema.ts`) จึงส่งทุกนาทีตลอดวันไม่ได้ แม้ทุกองค์ประกอบพร้อม ความพยายามส่งนับโควตาด้วย
5. `blocked` พักกฎและระบบ; journal ที่ยังรายงานไม่ได้ขวางงานบนอุปกรณ์เพื่อป้องกันส่งซ้ำ; `uncertain` ไม่ส่งงานเดิมซ้ำ แต่โค้ดปัจจุบันไม่ได้พักกฎเพราะ uncertain เพียงอย่างเดียว

## การแก้

- เพิ่ม relative `retryAfterMs` เมื่อ claim ว่าง จากคิวของอุปกรณ์/บัญชี/generation ปัจจุบันและกฎที่เปิดพร้อม consent ค่าเป็นเพียงเวลาปลุก ต้อง claim และ authorize ใหม่เสมอ
- Extension ตั้ง one-shot `mybot-comment-due` ตามเวลาคงเหลือ โดยไม่เลื่อน alarm ที่รออยู่ให้ออกไปไกลกว่าเดิม และจำกัด hint อยู่ระหว่าง 1–60 วินาที รองรับเซิร์ฟเวอร์เก่าที่ไม่ส่ง hint
- เมื่อรอบส่งจบด้วยงานสำเร็จแต่ครบจำนวนหรือหมดงบ ให้ปลุกตรวจคิวใหม่ในหนึ่งวินาที ไม่รับงานล่วงหน้าหรือส่งพร้อมกัน
- เพิ่มเวอร์ชัน Extension/expected version เป็น `1.11.32` เพื่อแยกอุปกรณ์ที่ยังใช้ตัวรับงานเก่า
- ไม่เปลี่ยนโควตา สิทธิ์ Stop/Pause กฎ การตรวจบัญชี การกั้นส่งซ้ำ หรือประวัติงานเก่า

## หลักฐานและการตรวจ

- ก่อนแก้: regression ของ claim ที่คืน `job:null,retryAfterMs:17000` ล้มเหลว เพราะไม่มี alarm ตามเวลาที่แจ้ง; อีก 41 ข้อในไฟล์เดียวกันผ่าน
- หลังแก้เบื้องต้น: mock tests 52 ข้อผ่าน; สองชุดโหลดไม่ได้เพราะ dependency `@supabase/supabase-js` ที่เพิ่มจาก pull ยังไม่ได้ติดตั้ง จึงติดตั้งด้วย `npm ci --no-audit --no-fund`
- เพิ่ม regression จำลองส่งห้าครั้ง โดยช่วง dispatch แต่ละครั้งห่าง 60,000 ms พร้อมตรวจกรณี pause/stop, แยก device/account/generation, hint ผิดรูปแบบ และ continuation หลังงานช้า
- **PASS:** `TEST_DATABASE_URL=offline: npm test -- --maxWorkers=4` — 140 ไฟล์ผ่าน, 973 ข้อผ่าน, 135 ข้อข้าม (รวม 9 ไฟล์ที่ต้องใช้ฐานทดสอบ)
- **PASS:** `node_modules/.bin/tsc --noEmit`, `git diff --check` และ `node --check` ของไฟล์ Extension JS ที่แก้
- **FAIL บน Node 26.13.0:** `npm run build` — source trace จาก `uncaughtExceptionMonitor` ชี้ `WasmHash._updateWithBuffer` ภายใน Webpack ที่ Next รวมมา ไม่ใช่ stack ของตัวส่งคอมเมนต์
- **PASS บน Node 24.19.0 ที่มีอยู่แล้ว:** `NEXT_TELEMETRY_DISABLED=1 /usr/bin/node node_modules/next/dist/bin/next build` — คอมไพล์ ตรวจ types และสร้างครบ 33 static pages; ใช้ Prisma Client ที่ generate แล้วจาก install/build ก่อนหน้า มี lint warnings เดิมเรื่อง `<img>` และ `_now` ไม่มี error ไม่เปลี่ยน Node/PATH ถาวรหรือแก้ Webpack เพื่อหลบอาการ
- **NOT_TESTED:** ฐานข้อมูลจริง, Chrome/Facebook จริง, soak ระยะยาว และการส่งในระบบที่ผู้ใช้พบอาการ

## ข้อจำกัดและการใช้งานจริง

ต้องอัปเดตเซิร์ฟเวอร์และ reload/อัปเดต Extension เป็น `1.11.32` จึงได้พฤติกรรมใหม่ทั้งเส้นทาง ยังไม่ได้ดำเนินการกับระบบจริง

เมื่อคิวพร้อมและเงื่อนไขผ่าน ระบบจะกลับมาตรวจตามเวลาคิวแทนการรอรอบนาที แต่ไม่รับประกัน click ตรงวินาที: Chrome อาจเลื่อน alarm, เครื่องอาจหลับ, เครือข่าย/หน้า Facebook อาจช้า และการเตรียมหน้าต้องเกิดก่อนขอ grant

การระบุสาเหตุเฉพาะระบบจริงยังต้องทราบว่าใช้ local/Render/Desktop และตรวจสถานะงาน `lastError`, `nextAttemptAt`, dispatch logs, เวอร์ชัน/heartbeat อุปกรณ์, worker lease, journal และค่ากฎ/โควตาจริง โดยไม่เปิดเผย tokens หรือข้อมูลโพสต์

## รอบตรวจและอัปเดตเครื่องจริง

ผู้ใช้สั่งให้ดำเนินการตามคำแนะนำที่เหลือทั้งหมด พบ workstation บนเครื่องนี้ใช้งาน local origin จึงอัปเดตเครื่องนี้ ไม่อาศัยเพียงสมมติฐานจากโค้ด

| หลักฐานก่อนแก้ | สิ่งที่ดำเนินการ |
| --- | --- |
| Control เป็น `stopped`, quota 50/200 | เพิ่มเพดาน schema/parser/UI เป็น 60/1,440 และบันทึกค่าจริงเป็น 60/1,440 โดยยังไม่ Start ขณะรอกลุ่มเป้าหมาย |
| Worker lease หมดอายุตั้งแต่ 11 พ.ย. | ติดตั้ง `mybot-worker.service` แบบ opt-in ภายใต้ user เดิม ใช้ Node 24, restart เมื่อ process ล้ม, lease เดิมกัน leader ซ้ำ; ตรวจ lease ใหม่ทำงานจริง |
| เว็บคาดหวัง Extension 1.11.19; heartbeat 1.11.17 | Build และอัปเดตเว็บจริงเป็น 1.11.32; คัดลอก Extension ลง path เดิม เก็บ install-config localhost และ profile เดิม; restart workstation และตรวจ heartbeat 1.11.32 พร้อม Facebook login บัญชีเดิม |
| อุปกรณ์ในกฎเก่าออฟไลน์ | เรียกตัว migration เดิมที่เลือกเฉพาะอุปกรณ์ออนไลน์เพียงหนึ่งเครื่องของบัญชีเดิม ตรวจย้ายหนึ่งกฎสำเร็จ |
| Restart แล้ว desktop ไม่เริ่ม: `Missing: tint2` | ทำแถบเมนูเป็น optional ตามกลไก fallback เดิม ไม่เพิ่ม root/packages; ตรวจ desktop และ Chrome เริ่มจริง |
| กลุ่มสอง ID ในกฎที่เปิดอยู่ไม่มีในตาราง Source แล้ว | ไม่เลือกกลุ่มใหม่แทนเจ้าของ เพิ่มข้อความในหน้า `/auto-comment` ว่ากลุ่มถูกลบ/ปิด และแสดงรอความพร้อม; รอเจ้าของระบุกลุ่มที่ต้องการ |
| Render health ตอบ 503 | ไม่ถือว่า cloud พร้อม; ไม่มี Render credentials ใน environment และยังไม่เชื่อมบัญชี Render; เสนอช่องทางเชื่อม Render เพื่อดำเนินการต่อ |

เปลี่ยน `.nvmrc` เป็น 24.19.0 ให้ตรงกับ runtime ที่ build ผ่าน ติดตั้ง service workstation ด้วย `/usr/bin/node` โดยไม่เปลี่ยน default Node ของระบบ

เพิ่ม `npm run bot:install-worker` / `npm run bot:uninstall-worker` สำหรับติดตั้งหรือถอด worker ที่เจ้าของเลือกใช้งานบน Linux/WSL แยกจาก `bot:start` ซึ่งยังไม่แอบเปิด local worker ตามเดิม ถอด service ด้วย `npm run bot:uninstall-worker` จะไม่ปิดเว็บหรือ Chrome

Integration tests รอบนี้ใช้ PostgreSQL 18 ชั่วคราวผ่าน Unix socket ใน `/tmp/mybot-cadence-pg-*` โดยไม่เปิด TCP หรือใช้ฐานจริง แต่ละชุดมี schema `test_*` แยก ตรวจพบ fixture เดิมสร้าง receipt ล่วงหน้า 1.5 วินาทีแล้วหวังให้เวลาฐานระยะไกลผ่านไปก่อนเก็บสถิติ แก้ให้ timestamp จำลองทั้ง ingest/ready/observed อยู่ในอดีตอย่างเรียงลำดับ โดยคงการตัดข้อมูลอนาคตของตัวสรุปไว้

ผลรอบสุดท้าย รวม regression ของหน้าที่แจ้งกลุ่มหาย: **150 ไฟล์ผ่าน, 1,113 ข้อผ่าน, ข้าม 2 ข้อ**; `PATH=/usr/bin:$PATH NEXT_TELEMETRY_DISABLED=1 npm run build` ผ่านด้วย Node 24.19.0 รวมหน้า UI ล่าสุด ไม่มีการใช้ฐานจริงใน integration tests

สถานะการส่งจริง: ยังไม่ Start เพราะกลุ่มเดิมในกฎถูกลบ ไม่มี allowlist ที่ใช้งานได้ รอคำตอบเจ้าของเรื่องกลุ่ม ไม่มีการสร้างคอมเมนต์ทดสอบหรือ replay งาน uncertain เก่า จึงยังไม่อ้างว่าผ่าน Facebook acceptance หรือ soak
