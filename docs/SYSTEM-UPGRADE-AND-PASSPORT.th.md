# ระบบ Login ด้วย Passport และภาพรวมการปรับปรุง — 14 พ.ย. 2026

## ผลลัพธ์

มี security hardening เพิ่มใน [รายงานตรวจความปลอดภัย](SECURITY-REVIEW-2026-11-14.th.md) ซึ่งยังไม่ deploy; ผล local rollout ด้านล่างเป็นรุ่น Passport ก่อน hardening รอบนั้น

แทน Better Auth ด้วย `passport` 0.7.0 + `passport-local` 1.0.0 ใช้ username/password ของเจ้าของคนเดียว ไม่ต้องใช้ Dashboard, callback URL, external API key หรือ Express server เพิ่ม Passport ตรวจ credentials ผ่าน custom callback (`session: false`) แล้ว MY-BOT สร้างเซสชันฐานข้อมูลเดิมสำหรับ Next.js Route Handlers

- บัญชีเดิมได้ username `admin`; password hash เดิมไม่เปลี่ยน ผู้ใช้ใหม่เลือก username ตอน setup ได้ (3–64 ตัวอักษร A–Z/a–z/ตัวเลข/จุด/ขีด/underscore)
- รหัสผ่านเก็บด้วย bcrypt cost 12; ไม่ส่ง passwordHash กลับ client
- session token ใหม่สุ่ม 32 bytes เก็บ SHA-256 digest ในฐาน Cookie เป็น HttpOnly/SameSite=Lax/Secure เมื่อใช้ HTTPS อายุ 30 วัน รองรับเซสชันเดิมที่ยังไม่หมดอายุ
- ป้องกันการ replay ค่า digest จากฐานเป็น cookie; ล็อก Owner ก่อนสร้างเซสชันเพื่อกัน password-change race
- เปลี่ยนรหัสผ่านเพิกถอนเซสชันเครื่องอื่นใน transaction; reset ยังใช้ bootstrap token เดิมและเพิกถอนทุกเซสชันก่อนสร้างใหม่ Username ไม่เปลี่ยนหลัง reset
- หน้า Security แสดงและเพิกถอนเซสชันอื่น โดยไม่ส่ง token/hash/IP/UA ให้ UI และไม่เพิ่ม polling
- CSRF ตรวจ Origin/Sec-Fetch-Site และ Content-Type JSON ก่อน hash; DB lockout ใช้ advisory lock เพื่อไม่สูญเสียจำนวน failed login เมื่อหลาย process ส่งพร้อมกัน
- ไม่ redirect หน้า login จากการมี cookie เพียงอย่างเดียว เพื่อให้ cookie ที่ถูก revoke/หมดอายุไม่ขวางการเข้าสู่ระบบใหม่
- ถอด dependencies, runtime module, `/api/better-auth/*` endpoint และ environment ของ Better Auth ออก; ตาราง Auth* และ migration ที่เคย apply แล้วเก็บไว้เพื่อรักษาประวัติ/ข้อมูลเดิม ไม่ใช้รับรองสิทธิ์ ไม่เพิ่มลง backup; restore ล้าง obsolete credentials เหล่านี้
- เซสชัน Better Auth เดิมใช้ไม่ได้หลังเปลี่ยน ต้อง login ใหม่ด้วย admin/รหัสเดิม เซสชัน MY-BOT เดิมยังใช้ได้จนหมดอายุ/ถูกเพิกถอน
- ไม่เปิด/ส่งคอมเมนต์ Facebook และไม่เปลี่ยน worker, pairing, allowlist หรือสถานะพักคอมเมนต์

## Local และ Render

`AUTH_URL` เป็น canonical origin สำหรับ CSRF เท่านั้น ไม่มี OAuth callback สำหรับ password login นี้

Local `.env`:
```env
AUTH_URL=http://localhost:8001
```

Render Environment:
```env
AUTH_URL=https://mb-agcf.onrender.com
```

ถ้าไม่กำหนด AUTH_URL จะตรวจ same-origin จาก request ตามตัวตรวจ reverse proxy เดิม เมื่อตั้ง origin สาธารณะจะไม่อนุญาต localhost เป็น origin ของ host นั้น

ขั้นตอน release: `npm install`, `npm run db:migrate`, `npm run build` แล้ว restart web ให้ใช้ build ใหม่ Supabase ใช้ร่วมกันจึง apply migration ครั้งเดียว ลบค่า BETTER_AUTH_* ที่ไม่ใช้แล้วจาก Environment ของแต่ละ host และ revoke key เดิมที่เคยเผยในแชตผ่านผู้ให้บริการ ไม่ต้องใส่คีย์ใหม่

## หลักฐานการตรวจ

- `npm test` (TEST_DATABASE_URL ฐาน PostgreSQL18 ชั่วคราวผ่าน Unix socket แยก schema `test_*`): PASS 154 ไฟล์, 1,143 ข้อผ่าน, 2 ข้อข้าม ไม่ใช้ฐานจริงใน tests
- `npm run build`: PASS production build พร้อม TypeScript และ lint; มี warnings เดิมเรื่อง img และ _now
- `npm run test:auth-production`: PASS HTTP จริงด้วยบัญชีจำลอง/ฐานแยก ครอบคลุม username/password, cookie, protected API, CSRF, signup ปิด, list sessions, logout revocation และเปิด login ด้วย revoked cookie
- `npm ls passport passport-local better-auth @better-auth/infra --depth=0`: เหลือเฉพาะ Passport 2 แพ็กเกจ
- `git diff --check`: PASS ตรวจ whitespace
- `npm audit --omit=dev`: PASS 0 advisory ณ เวลาตรวจ ไม่ใช่การรับรองว่าไม่มีช่องโหว่
- Local migration `20261202100000_passport_username` ผ่าน ตรวจ digest Owner (ไม่รวม username ใหม่), password hashes, Session เดิม และ comment control ก่อน/หลังตรงกัน
- Local restart เฉพาะ web ที่ supervisor เป็นเจ้าของ: health/status/login 200, sessions 401 เมื่อไม่ login, Better Auth endpoint เก่า 404; workstation/worker active
- ยังไม่ commit/push/deploy Render และยังไม่ได้ทดสอบ login ด้วยรหัสผ่านเจ้าของจริง (ไม่ทราบและไม่เปลี่ยนรหัสเพื่อทดสอบ)

## ควรเพิ่มอะไรต่อ เรียงตามผลกระทบ

| ลำดับ | ระบบ | ทำไม/ตำแหน่งปัจจุบัน | เกณฑ์สำเร็จที่เสนอ |
| --- | --- | --- | --- |
| P0 | เปลี่ยน Infra key และทบทวน recovery token | คีย์เคยอยู่ในแชต; bootstrap token ใช้กู้บัญชีได้ ระบบใหม่ไม่เรียก dashboard/admin API ภายนอก | revoke คีย์เก่า; ระบบใหม่ไม่ใช้ Infra key แล้ว ตรวจ BOOTSTRAP_TOKEN และ log ไม่มี secret |
| P1 | Passkey หรือ TOTP + recovery codes | Owner คนเดียวมีสิทธิ์แก้กฎและส่งข้อความทั้งหมด ปัจจุบัน password-only; เพิ่มหลังล็อกอิน migration พิสูจน์แล้ว | challenge ก่อนออก owner session, codes ใช้ครั้งเดียว, rate-limit และทดสอบกู้คืนกับการเพิกถอน |
| P1 | SLO/queue observability และแจ้งเตือน | มี `metrics.ts`, evidence, heartbeat, observe script แล้ว แต่ต้องเก็บเส้นเวลาข้าม process; วัด ingest→ready→dispatch→observed และ active/review แยก | ดู p50/p95, sampling gaps, oldest pending; แจ้ง worker ขาด lease และ queue ไม่คืบหน้า โดยไม่แจ้งว่า paused เป็น crash |
| P1 | Backup นอกเครื่องและซ้อม restore | มี encrypted backup/upload และ atomic restore แล้ว ความพร้อมต้องพิสูจน์จากไฟล์ที่คืนได้ ไม่ใช่มีไฟล์เฉย ๆ | restore ในฐานแยกตามรอบ ตรวจ RPO/RTO ที่เจ้าของกำหนด ไม่ revive comments/sessions |
| P1 | ประเมินความแม่นยำของกฎ | กฎปัจจุบันเคยใช้คำว่า “ขาย” กว้างมาก การส่งถี่ขึ้นอาจส่งผิดบริบท; มี feed sample audit/label corrections แล้ว | ชุดตัวอย่าง owner-reviewed วัด precision/recall แยกหมวด ข้อเสนอเปลี่ยนกฎต้องดูผลย้อนหลังและให้เจ้าของเลือก |
| P2 | จัดลำดับงานอ่านจากประโยชน์/ความเก่า | มี bounded slices/fairness/backlog อยู่แล้ว; 199 review เป็นรายการเก่า ไม่ควร retry อัตโนมัติหรือเพิ่มเพดานอย่างเดียว | ลด oldest active โดยไม่อดอ่านกลุ่มอื่น มีเหตุผล terminal/review และทดสอบงบเวลาภายใต้ 10 กลุ่ม |
| P2 | Performance budget และ SQL profiles | ลดงานจริงก่อนเพิ่ม Redis; `system-overview.ts`, read model/pagination มี query parallel และ memo แล้ว | เก็บ baseline ก่อน/หลัง; เป้าหมาย API p95 เช่น <500 ms เมื่อ warm เป็น SLO เสนอ ไม่ใช่ผลวัดรอบนี้ |
| P2 | Release canary และ rollback | เคยเจอ manifest ใหม่แต่ worker bytecode เก่า; ตอนนี้มี runtime build marker แล้ว | ต้องตรง code+manifest+heartbeat, synthetic login canary และ rollback โดยคง pairing/pause/durable journal |
| P3 | ผู้ช่วยเสนอข้อความ/กฎแบบ offline | เพิ่มความฉลาดได้โดยไม่เอาโมเดลมาขวางคิวส่ง; runtime ปัจจุบัน rules-only | ข้อเสนออธิบายเหตุผลและอ้างข้อมูลได้ ไม่ขยาย allowlist หรือเปิดส่งเอง ไม่ใช้ private Facebook API |

ข้อเสนอเหล่านี้เป็นงานถัดไป ยังไม่ได้ติดตั้งระบบทุกแถว ไม่อ้างว่าเร็วที่สุดหรือเสถียรที่สุดโดยไม่มี baseline และ soak

## เอกสารต้นทาง

- https://www.passportjs.org/concepts/authentication/password/
- https://www.passportjs.org/concepts/authentication/middleware/
- https://www.passportjs.org/packages/passport-local/
