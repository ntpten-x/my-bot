# Runtime performance and live update consolidation

วันที่ 19 พฤศจิกายน 2026

## ขอบเขต

ลดงานที่ทำซ้ำของ worker, ลด DB round-trip จาก SSE, รวม live update เป็นช่องทางเดียวของทั้งแอป และเพิ่ม metrics ที่ไม่เก็บ SQL, token หรือข้อความโพสต์

ไม่เปลี่ยนกติกาการส่งคอมเมนต์ ไม่ reset quota และไม่ retry งาน `uncertain` อัตโนมัติ

## สถาปัตยกรรมใหม่

- `LiveUpdatesProvider` เปิด EventSource เดียวต่อแท็บสำหรับทุกหน้าหลัง login
- ปิด SSE เมื่อแท็บซ่อน และ reconnect/reload เมื่อกลับมา visible
- Shell และ Feed ใช้ revision เดียวกันเพื่ออัปเดต unread badge และ reload ฟีด
- Worker ใช้ adaptive loop:
  - notification/post มีงานทุก 2 วินาที, ว่างทุก 10 วินาที
  - comment มีงานทุก 3 วินาที, ว่างทุก 15 วินาที
- Settings cache 5 วินาทีและ invalidate หลัง owner write
- Notification stale recovery ทำงานไม่เกินทุก 60 วินาที
- New/revised posts ตรวจ truncated-capture duplicate เฉพาะ source และ capture window เดียวกัน
- Worker standby บันทึก metrics ใน Setting เดิมโดยไม่เพิ่ม write รอบใหม่
- Prisma query extension เก็บเฉพาะจำนวนและเปอร์เซ็นไทล์ของเวลา query
- Server รับงานอ่านเฉพาะ extension v1.11.35 หรือ patch ใหม่กว่าใน minor เดียวกัน
- Overview เตือนเมื่อมี extension หลายรุ่นออนไลน์พร้อมกัน
- แหล่งที่ stall ตั้งแต่ 3 ครั้งและไม่มีโพสต์ใหม่จะถอยไปรอบปกติแทนการ retry ทุก 30 วินาที
- Automation Quality แสดง fresh/run, hit-limit rate, stall rate, unknown posts และข้อเสนอซ่อมคุณภาพข้อมูล

## Metrics

หน้า **ภาพรวมระบบ** มี check `ประสิทธิภาพ runtime` แสดง:

- DB query p50/p95 ของ web และ worker
- จำนวน SSE ที่เปิดอยู่
- จำนวน worker active/idle polls
- RSS และอายุ snapshot ของ worker

Metrics เก็บตัวอย่างสูงสุด 200 ค่าต่อชื่อในแต่ละ process จึงไม่โตตามจำนวน request

## คำสั่ง

```bash
npm run profile:reads -- --db
npm run db:collapse-captures
node scripts/observe-automation.mjs --hours=24 --interval-seconds=60
```

- `profile:reads` เป็น read-only query-plan inspection
- `db:collapse-captures` เป็น manual full repair สำหรับข้อมูลเก่า
- automation observation เป็น soak แบบอ่านอย่างเดียว

## Validation

- Node 24.19.0 ตาม `.nvmrc`
- Full test: 1,133 passed / 154 skipped / 0 failed
- Production build: ผ่าน
- `npm run doctor`: fail=0, warn=0
- Public health ที่พอร์ต 8001: `{ ok: true, version }`
- Feed bundle: 5.71 kB; shared bundle: 103 kB

ผล soak และ query plan จากข้อมูลจริงยังต้องเก็บหลัง extension ส่งข้อมูลได้ ฐานทดสอบปัจจุบันมี 0 Post

## Safety state

- Comment control ถูกหยุดในรอบย้ายระบบ
- งานที่ยังไม่เริ่มส่งถูกยกเลิก
- งาน `uncertain` คงไว้เพื่อให้เจ้าของตรวจด้วยตนเอง ห้ามส่งซ้ำอัตโนมัติ
- Systemd service เก่าที่ชี้ `/home/supersix/my-bot/projects/my-bot` ถูก disable
- Runtime ที่ใช้งานคือ workspace นี้บนพอร์ต 8001

## Version floor

`MINIMUM_EXTENSION_VERSION` เท่ากับ `EXPECTED_EXTENSION_VERSION` แล้ว เพื่อหยุด reader รุ่นเก่าที่ทำให้เกิด retry storm และแย่งแท็บ Chrome การอัปเกรด extension ทุกอุปกรณ์ต้องทำก่อนกลับมาเก็บข้อมูล
