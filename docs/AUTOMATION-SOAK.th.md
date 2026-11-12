# สังเกต automation 24–72 ชั่วโมงแบบอ่านอย่างเดียว

เครื่องมือนี้อ่าน aggregate ใน transaction แบบ READ ONLY และเขียนรายงานลง `data/` ไม่เริ่ม reader, worker, Chrome หรือการส่งคอมเมนต์ และไม่เปลี่ยน quota/quiet/การอนุญาตเดิม ต้องมี `DATABASE_URL` ใน `.env` ที่เครื่องอยู่แล้ว ห้ามนำคีย์มาใส่ command line หรือรายงาน

เริ่มด้วย baseline สั้น แล้วสังเกตจริงตามระยะที่ต้องการ:

```bash
node scripts/observe-automation.mjs --once
node scripts/observe-automation.mjs --hours=24 --interval-seconds=60
node scripts/observe-automation.mjs --hours=72 --interval-seconds=60
```

แต่ละรอบสร้าง `data/automation-observation-<timestamp>.jsonl` และเมื่อจบ/รับ SIGINT หรือ SIGTERM จะสร้าง `.summary.json` ข้างกัน มี sample สุดท้ายเมื่อครบเวลา การปิดเครื่องหรือ kill แบบบังคับอาจไม่มี summary แต่สรุปจาก JSONL ได้โดยไม่เชื่อมฐานข้อมูล:

```bash
node scripts/observe-automation.mjs --summary=data/automation-observation-<timestamp>.jsonl
```

รูปแบบ command เดิมยังใช้ได้: `--hours` 0.001–168 ชั่วโมง, `--interval-seconds` 10–3600 วินาที ค่าเริ่มต้น 24 ชั่วโมง/60 วินาที เวลา query รวมได้ไม่เกิน 15 วินาทีต่อ transaction ช่วง sample จริงจึงรวมเวลาประมวลผลด้วย การหยุดกลางทางยังคงระบุ `duration_short`

ทั้งการเก็บและสรุปไฟล์ใช้ reducer ที่เก็บเพียง sample แรก/ล่าสุดกับ counters และ maxima ไม่เก็บ sample ทั้งหมดใน RAM ส่วน JSONL โตตามจำนวน sample และจำนวนแถว aggregate ที่บันทึก ขนาดดิสก์จึงควรเฝ้าดูเอง ระยะ 72 ชั่วโมงที่ cadence 60 วินาทีมีประมาณ 4,321 sample; ห้ามนำ browser profile, cookies หรือ `.env` มารวมรายงาน

## อ่านผลโดยไม่สรุปเกินหลักฐาน

- `coverageComplete` หมายถึงระยะเวลาและการเก็บ sample ครบเท่านั้น ไม่ใช่ verdict ว่าระบบเสถียรหรือเก็บโพสต์ครบทั้งหมด ดู `incompleteReasons`, `failedSamples`, `invalidSamples`, `longestGapSeconds` และ `telemetryUnknown` ร่วมด้วย JSONL เสีย/ตัดกลางบรรทัดถูกนับว่า invalid; เวลาย้อนกลับนับเป็น `out_of_order_samples`
- `collection` และ `newPostsPerMinute` เป็นยอดสะสมตั้งแต่เริ่มเฉพาะ `expectedExtensionVersion` ห้ามรวมยอดแต่ละนาทีเข้าด้วยกัน อัตรานี้ไม่ใช่ recall ของ Facebook ทั้งหมด
- `noCurrentExtensionSamples` และ `latestOnlineVersions` แสดงการขาด heartbeat เวอร์ชันปัจจุบัน ค่า capture/tabs หมดอายุ 10 นาทีหรือขาดข้อมูลจะเป็น `null` ไม่ใช่ศูนย์ heartbeat ปัจจุบันไม่ได้พิสูจน์ว่าเหตุการณ์ในอดีตมาจากเวอร์ชันเดียวกัน
- `extension_capture` เดิมไม่มีเวอร์ชัน จึงใช้ backlog นี้ได้ในขอบเขตที่ระบุว่าไม่ทราบเวอร์ชัน (`sameVersionCapture` unknown) ไม่ถือเป็นหลักฐาน same-version ส่วน tabs ต้องมีเวอร์ชันตรงกัน
- `comments` เป็นสถานะของ job ที่สร้างตั้งแต่เริ่มสังเกต; `commentBacklog` และค่าสูงสุด pending/uncertain นับ job extension ทุกอายุ เพื่อไม่ซ่อนคิวเก่า ไม่รวมซ้ำทุก sample ค่า `uncertain` ต้องตรวจเองและห้ามส่งซ้ำ
- schema ปัจจุบันไม่มีเวอร์ชันย้อนหลังผูกกับ job/log จึงระบุ `commentVersionScope=unknown_no_historical_version` เสมอ ไม่อ้างผลหรือ latency ว่าเป็นเวอร์ชันปัจจุบันจาก heartbeat
- `stages` คือเวลา **ingest → stage แบบสะสม** พร้อม count/invalid; ไม่ใช่เวลาที่ stage นั้นใช้ ค่า percentile ข้ามกลุ่มตัวอย่างห้ามนำมาลบกัน
- `stageIntervals` จับคู่เวลาภายใน job เดียว: `ingest_to_ready`, `ready_to_dispatch`, `dispatch_to_observed` เลือก log แรกของแต่ละเหตุการณ์ เฉพาะ job ที่สร้างตั้งแต่เริ่ม สรุป count/p50/p95 และ `missing`/`invalid` แยกกัน เวลา endpoint ขาด เรียงย้อนกลับ หรืออยู่ในอนาคตเมื่อเทียบกับนาฬิกาฐานข้อมูลถูกตัดออกจาก percentile ไม่แทนเป็นศูนย์ ตรวจ milestone กับเวลาที่ทราบก่อนหน้าแล้วทุกช่วงที่อ้าง milestone ผิดจะเป็น invalid เช่น ingest=10, ready=5, dispatch=20 จะไม่ถือว่า ready→dispatch ใช้เวลา 15 วินาที จึงอาจมีจำนวนตัวอย่างต่างจาก `stages` ที่กรองด้วยเวลาเหตุการณ์ งาน AI ใช้เวลาสะสมจาก ingest เท่านั้น
- เวลาเหล่านี้เริ่มจาก Post ที่เก็บในระบบ ไม่ใช่เวลาเผยแพร่ Facebook และไม่ใช่ publish-to-capture latency รายงานไม่มีการรับรอง recall หรือความเที่ยงตรงของนาฬิกาเบราว์เซอร์
- `resources.scope=observer_process` วัด RSS และ CPU seconds สะสมของ Node observer เท่านั้น รวมภาระเครื่องมือสังเกตเอง ไม่ใช่ Chrome, web, worker หรือ RAM/CPU ทั้งเครื่อง ถ้าไม่มีหลักฐานจะเป็น `null`/`unknown`

## ตรวจ outage/restart ด้วยข้อมูลจำลอง

```bash
node scripts/verify-automation-recovery.mjs
npx vitest run tests/pipeline/automation-observation.test.ts tests/pipeline/automation-recovery.test.ts
```

verifier รัน queue/recovery ของ extension เดิมใน VM พร้อม storage และ HTTP จำลองทั้งหมด ไม่มี fetch/Chrome จริงและไม่ใช้ฐานข้อมูล ทดสอบโพสต์สองรายการที่เจอ HTTP 503 แล้วสร้าง MV3 context ใหม่ คง observedAt และ pending ไว้จนได้รับ receipt ยืนยัน รวมถึง HTTP 200 ที่ไม่มี receipt ต้องไม่ล้างคิว

อีกสถานการณ์เริ่มจาก sending journal แล้วรายงานไม่สำเร็จ สร้าง context ใหม่และรายงาน `uncertain` ซ้ำจน server จำลอง acknowledge โดยไม่ claim, authorize, เปิด tab หรือเรียก page action/send ผลเป็น `synthetic_offline_only` ไม่ใช่ผลทดสอบกับ Facebook จริง และไม่รับรองทุกกรณีของ Chrome restart/ฐานข้อมูล

**สถานะการรับรองระยะยาว:** unit tests, verifier และ `--once` ไม่สามารถรับรองการทำงาน 24–72 ชั่วโมง ต้องปล่อย observer จนครบเวลาจริงและตรวจช่องว่าง เวอร์ชัน ข้อมูล unknown และจำนวนตัวอย่างคอมเมนต์ หากไม่มีคอมเมนต์จริงในหน้าต่างนั้น ห้ามอ้าง latency หรือความเสถียรของการส่งคอมเมนต์

## ตรวจ SQL regression โดยไม่ใช้ฐานข้อมูลจริง

ชุดทดสอบ SQL เป็น opt-in ใช้ PGlite (PostgreSQL WASM) ในหน่วยความจำ สร้างเฉพาะตารางจำลอง ไม่อ่าน `DATABASE_URL` และไม่เพิ่ม dependency ในโปรเจกต์ ตัวอย่างบน Linux/WSL:

```bash
mkdir -p /tmp/mybot-observer-sql-check
npm install --prefix /tmp/mybot-observer-sql-check @electric-sql/pglite@0.5.16 --ignore-scripts --no-audit --no-fund
MYBOT_TEST_PGLITE=/tmp/mybot-observer-sql-check/node_modules/@electric-sql/pglite npx vitest run tests/pipeline/automation-observation.test.ts
```

เมื่อไม่ตั้ง `MYBOT_TEST_PGLITE` จะ skip เฉพาะ SQL regression นี้ ตัว reducer/offline/recovery tests ยังทำงานปกติ SQL regression รัน query จริงจาก observer กับกรณี ingest=10, ready=5, dispatch=20, observed=30 และ timestamp ในอนาคตทั้ง milestone/log/AI โดยตรวจว่าค่าที่เสียไม่เข้าจำนวน valid หรือ percentile ตัวนาฬิกาอ้าง `statement_timestamp()` ของฐานข้อมูล ไม่ใช้เวลาจาก Chrome/Node มาตัดสินความถูกต้อง SQL แบบนี้ยังไม่ใช่การวัดโหลดบน Supabase จริง
