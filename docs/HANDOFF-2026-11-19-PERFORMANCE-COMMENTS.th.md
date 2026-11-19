# HANDOFF 2026-11-19 — Runtime performance, staged comments, live-test readiness

เอกสารนี้เป็นสถานะส่งต่อสำหรับ AI หรือวิศวกรคนถัดไปที่ทำงาน MY-BOT ต่อ

## 1. สรุปสถานะ

- Repo อยู่บน branch `master`
- Commit งานหลักก่อนเอกสารนี้: `860b898 perf: stage runtime metrics and comment rollout`
- Runtime ใหม่รันที่ `http://127.0.0.1:8001`
- ใช้ Node `24.19.0` ตาม `.nvmrc`
- Health และ Doctor ผ่าน
- งาน performance ถูก merge/push แล้ว
- Auto Comment ยังไม่ผ่าน live acceptance เพราะยังไม่มีเป้าหมายที่ไม่ใช่โพสต์ของเจ้าของ
- Comment control ต้องคง `stopped`
- ห้าม retry งาน `uncertain` อัตโนมัติ

## 2. สิ่งที่ทำเสร็จแล้ว

### Performance/runtime

- Worker polling แบบ adaptive:
  - notification/post: active `2s`, idle `10s`
  - comment: active `3s`, idle `15s`
- Settings cache 5 วินาที พร้อม invalidation หลัง owner write
- Stale notification recovery ไม่เกินทุก 60 วินาที
- ลดงานอ่าน Post ทั้งตารางทุกนาที
- New/revised posts ตรวจ truncated-capture duplicate เฉพาะ source/window ที่เกี่ยวข้อง
- เพิ่ม `npm run db:collapse-captures` สำหรับ full repair ด้วยมือ
- Prisma query metrics แบบ bounded 200 samples
- Worker/SSE counters และ runtime snapshot
- Overview แสดง DB p95, SSE active, worker active/idle polls และ RSS

ไฟล์หลัก:

- `src/worker/index.ts`
- `src/lib/settings.ts`
- `src/lib/metrics.ts`
- `src/lib/prisma.ts`
- `src/lib/smart/enrich.ts`
- `src/lib/system-overview.ts`

### Live updates/UI

- มี `LiveUpdatesProvider` ชุดเดียวต่อแท็บ ใช้ร่วมทุกหน้าหลัง login
- ปิด SSE ขณะแท็บซ่อน และ reconnect/reload เมื่อกลับมา visible
- Shell ใช้ live revision อัปเดต unread badge
- Feed ไม่เปิด EventSource ของตัวเองแล้ว
- Session recheck ของ SSE ลดจากทุก 2.5 วินาทีเป็นทุก 10 วินาที

ไฟล์หลัก:

- `src/components/live-updates.tsx`
- `src/components/shell.tsx`
- `src/app/(app)/layout.tsx`
- `src/app/(app)/feed/page.tsx`
- `src/app/api/v1/stream/route.ts`

### Extension/scrape quality

- Server บังคับ extension ขั้นต่ำ `1.11.35`
- Extension รุ่นก่อนหน้าจะได้ `groups: []`, `scrapeAllowed: false`
- Overview เตือนเมื่อมีหลาย version ออนไลน์พร้อมกัน
- Source ที่ stall ตั้งแต่ 3 ครั้งและไม่มีโพสต์ใหม่จะ backoff แทน retry ทุก 30 วินาที
- Automation Quality แสดง:
  - fresh/run
  - hit-limit rate
  - stall rate
  - average duration
  - unknown posts
  - source efficiency advice

ไฟล์หลัก:

- `src/lib/extension-heartbeat.ts`
- `src/lib/scrape-runs.ts`
- `src/lib/source-efficiency.ts`
- `src/lib/source-value.ts`
- `src/app/api/automation-quality/sources/route.ts`
- `src/app/(app)/automation-quality/page.tsx`

### Doctor

- ใช้ public `/api/v1/health` ตรวจว่า port เป็น MY-BOT
- ใช้ `PORT` จริง ไม่ hardcode 8001
- เพิ่ม timeout ที่เหมาะสม

## 3. สถานะ Auto Comment ในฐานข้อมูล

### Rule ที่ถูก staged

Rule เดิม:

- ชื่อ `11.11`
- ปิดใช้งานแล้ว (`enabled=false`)
- revision ล่าสุด `24`
- allowlist เดิม 14 กลุ่ม
- รายละเอียดเดิมถูกเก็บใน Setting `auto_comment_staged_backup`

Rule ทดสอบ:

- ชื่อ `ทดสอบ one-shot`
- เปิดใช้งาน
- allowlist 1 กลุ่มเท่านั้น
- ข้อความ `สนใจ`
- delivery mode `extension`
- browser consent เปิด
- pinned กับ Chrome รุ่น `1.11.35`
- Facebook account ตรงกับ runtime

ห้ามเปิด rule เดิม 14 กลุ่มระหว่าง acceptance โดยไม่ตรวจย้อนหลัง

### Control และ queue

- Comment control: `stopped`
- Dry Run: ปิด
- Emergency: ปิด
- Quota ปัจจุบัน: 50/ชั่วโมง, 200/วัน
- `cancelled`: 96
- `not_sent`: 1
- `uncertain`: 74
- ไม่มี active `browser_ready` ค้าง

งาน `uncertain` ทั้ง 74 รายการมี `dispatchedAt` และ `attempts=1`

ความหมาย:

- ระบบอาจเคยกดส่งจริง แม้ observer ยืนยันไม่ได้
- ห้ามตีความว่า failed
- ห้าม retry หรือ replay
- ต้องให้เจ้าของตรวจ Facebook ด้วยตนเอง

## 4. Device state

### Device ที่เก็บไว้

- เหลือ active device เดียว: Chrome Win32 ที่ส่ง build `1.11.35`
- ใช้ device นี้ใน rule ทดสอบ
- ต้อง query ID เต็มจาก Setting `extension_runtime_<deviceId>` หรือ `ExtensionDevice`
- **ห้ามสร้างหรือเดา CUID จาก prefix**

### Device ที่ revoke แล้ว

- Device เก่าที่เงียบเกิน 24 ชั่วโมง 2 ตัว
- Device รุ่น `1.11.30` ที่ยังออนไลน์ 2 ตัว

แม้ revoke แล้ว heartbeat เก่าอาจค้างในตารางชั่วครู่ แต่จะไม่ได้รับงานและควรหมดไปเอง

## 5. ผลทดสอบ One-shot ที่ผ่านมา

Owner อนุมัติเป้าหมาย:

- โพสต์ในกลุ่ม `557175383285610`
- ข้อความ `สนใจ`

ผล:

- ระบบ claim งานได้
- Extension ตรวจว่าเป็น `owner_draft`
- Job ถูกยกเลิกก่อน authorize/send
- `attempts=0`
- `dispatchedAt=null`
- `remoteCommentId=null`
- ไม่มีคอมเมนต์จริงถูกส่ง

ข้อสรุป:

- Claim/preflight และ owner-draft gate ทำงาน
- ยังไม่มีหลักฐาน dispatch/send/observed ของรุ่น `1.11.35`
- ต้องใช้โพสต์ของบัญชีอื่นสำหรับ acceptance

## 6. Test results

### Standard suite

- `1,137 passed`
- `154 skipped`
- `0 failed`

### DB-backed suite ด้วย PostgreSQL container

- `1,288 passed`
- failure เดียวคือ restore-drill lab guard ซึ่งปฏิเสธ port/database ที่ไม่ตรง CI contract

รันซ้ำด้วย CI lab contract:

- `CI=true`
- `MYBOT_TEST_LAB=1`
- `TEST_DATABASE_URL=...127.0.0.1:5432/postgres`
- Result: `18/18 passed`

Container ถูกลบหลังทดสอบแล้ว

### Build/runtime

- Production build ผ่าน
- Doctor: `fail=0 warn=0`
- Health: `{ ok: true, version: "1.3.7" }`

หมายเหตุ: build หนึ่งครั้งเกิด webpack cache corruption หลัง build ก่อนหน้าถูก interrupt แต่ build รอบสมบูรณ์ผ่านและสร้าง BUILD_ID ใหม่แล้ว

## 7. Soak

- เริ่ม soak 24 ชั่วโมงหลัง staged rollout
- Interval 60 วินาที
- ไฟล์รอบล่าสุด:

```text
data/automation-observation-2026-11-19T12-22-21-248Z.jsonl
```

- Observer อ่านฐานข้อมูลเท่านั้น
- ไม่เริ่มกลุ่ม ไม่ claim/authorize/send comment

หากรอบนี้เริ่มก่อน Chrome กลับมาออนไลน์ ให้ถือช่วงแรกเป็น `unknown/gap` และเริ่ม soak ใหม่เมื่ออุปกรณ์ stable

## 8. Problems ที่ยังเปิดอยู่

### P0 — ต้องมี Chrome 1.11.35 ออนไลน์

Heartbeat รุ่น `1.11.35` ล่าสุดเงียบประมาณ 14 นาทีขณะเขียนเอกสาร

ต้อง:

1. เปิด Chrome profile ที่ลง extension `1.11.35`
2. เปิด Facebook และกลุ่มทดสอบอย่างน้อยหนึ่งแท็บ
3. รอ heartbeat ภายใน 2 นาที
4. ตรวจ `version=1.11.35`, `tabs > 0`

หากยังไม่กลับมา:

- อย่าเปลี่ยน pin ไป device เก่า
- อย่า revoke pinned device
- อย่าเริ่ม comment control

### P0 — ยังไม่มี live acceptance

ยังไม่มี:

- dispatch จริงในรุ่น `1.11.35`
- observed result
- remote comment ID
- dispatch-to-observed latency

### P1 — Render endpoint

ครั้งสุดท้ายที่ตรวจ `https://my-bot-e6bt.onrender.com/api/v1/health` ตอบ `503 Service Suspended`

แต่ worker lease บางช่วงยังถูก renew จาก `render:*`

ต้องตัดสินใจ:

- เปิด Render กลับ และ deploy commit ล่าสุด
- หรือถือ local 8001 เป็น runtime หลัก และไม่ใช้ extension ที่ชี้ Render

### P1 — Runtime/autostart

- systemd unit เก่าที่ชี้ checkout เดิมถูก disable
- Runtime ปัจจุบันเปิดจาก workspace `/mnt/c/my-b` ผ่าน `start-all`
- ยังไม่ได้ติดตั้ง systemd unit ใหม่ที่ชี้ workspace นี้
- หลัง reboot เครื่องอาจไม่เริ่ม MY-BOT อัตโนมัติ

### P1 — GitLab/GitHub state

- Commit `860b898` push ไป origin/master แล้ว
- Handoff commit นี้จะตามมาอีกหนึ่ง commit
- ต้องตรวจ `git status` บนเครื่องใหม่ก่อนทำงาน

### P2 — Data quality

- unknown posts สูง
- duplicate rate สูง
- ใช้หน้า Automation Quality และ source efficiency เพื่อเลือกกลุ่ม/ปรับ keyword

## 9. ขั้นตอน Live Acceptance ที่ต้องทำต่อ

ห้ามทำจนเจ้าของให้ URL โพสต์ของบัญชีอื่นและอนุมัติข้อความ

Preflight:

1. `Comment control = stopped`
2. `rule = ทดสอบ one-shot`
3. source allowlist มีเฉพาะกลุ่มทดสอบ
4. browser consent เปิด
5. pinned device คือ Chrome `1.11.35` ที่ heartbeat สด
6. Facebook account ใน heartbeat ตรงกับ rule
7. Heartbeat tabs มี URL โพสต์เป้าหมาย
8. Job เป้าหมายไม่มี `dispatchedAt`, `attempts=0`

One-shot:

1. ตั้ง `hourlyLimit=1` ชั่วคราว
2. Start control
3. สร้าง/re-arm durable job เพียงรายการเดียว
4. ใช้ข้อความที่เจ้าของอนุมัติเท่านั้น
5. poll จนได้ terminal status
6. Stop control ทันที
7. คืน quota 50
8. ตรวจ `attempts`, `dispatchedAt`, `remoteCommentId`
9. หาก `uncertain` ห้าม retry

Acceptance ผ่านเมื่อ:

- `status=browser_observed`
- มี `remoteCommentId`
- ไม่มี dispatch ซ้ำ
- comment control กลับเป็น `stopped`

## 10. คำสั่งตรวจพื้นฐาน

```bash
export PATH=/home/supersix/.nvm/versions/node/v24.19.0/bin:$PATH
PORT=8001 npm run doctor
curl -fsS http://127.0.0.1:8001/api/v1/health
```

ตรวจ extension:

```bash
node --input-type=module -e '
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
console.log(await db.extensionHeartbeat.findMany({
  orderBy: { lastSeenAt: "desc" },
  select: { version: true, lastSeenAt: true, errorCount24h: true, tabsJson: true }
}));
await db.$disconnect();
'
```

ตรวจ comment state:

```bash
npm run verify:comment-acceptance -- --base http://127.0.0.1:8001
```

รัน comment tests:

```bash
npx vitest run tests/extension/*comment* tests/pipeline/*comment* --maxWorkers=2
```

Full tests:

```bash
npm test -- --maxWorkers=2
npm run build
```

## 11. DB-backed test contract

ห้ามใช้ production `DATABASE_URL` เป็น test database

CI lab ต้องใช้:

- PostgreSQL ที่ `127.0.0.1:5432`
- database `/postgres`
- `CI=true`
- `MYBOT_TEST_LAB=1`
- `TEST_DATABASE_URL` ชี้ฐานทดสอบ

ตัวอย่าง:

```bash
TEST_DATABASE_URL=postgresql://postgres:<test-password>@127.0.0.1:5432/postgres \
CI=true MYBOT_TEST_LAB=1 \
npm test -- --maxWorkers=2
```

## 12. Safety invariants

- ห้ามส่ง Facebook comment โดยไม่มี explicit owner approval เฉพาะโพสต์/ข้อความ
- ห้าม replay `uncertain`
- ห้ามเปลี่ยน `dispatchedAt` ด้วยมือเพื่อให้ retry
- ห้ามเดา device ID จาก prefix
- ห้ามเปิด broad rule 14 กลุ่มก่อน acceptance
- ห้ามใช้ production credentials เป็น TEST_DATABASE_URL
- ห้าม commit `.env`, browser profile, cookie, token หรือ VNC authority
- ห้ามเปิด comment control เพียงเพื่อให้ test ผ่าน

## 13. ข้อความเริ่มงานสำหรับ AI คนถัดไป

> อ่าน `AGENTS.md` และ `docs/HANDOFF-2026-11-19-PERFORMANCE-COMMENTS.th.md` ก่อน งาน performance รอบล่าสุดอยู่ที่ commit `860b898` และ handoff commit ถัดจากนั้น ระบบหลักรันที่พอร์ต 8001 ด้วย Node 24.19.0 Comment control ต้องคง stopped จนเจ้าของให้ URL โพสต์ของบัญชีอื่นและอนุมัติข้อความ `สนใจ` สำหรับ one-shot test ห้าม retry งาน uncertain 74 รายการ และห้ามเปิด rule broad 14 กลุ่มที่ถูก backup ไว้ ก่อนเริ่ม test ให้ตรวจ heartbeat 1.11.35 สด, tabs > 0, pinned device/account, source allowlist 1 กลุ่ม, job ที่ยังไม่ dispatched และใช้ quota 1 ชั่วคราวแล้ว Stop ใน finally

