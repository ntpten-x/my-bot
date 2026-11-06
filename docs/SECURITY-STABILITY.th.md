# การแก้ไขความปลอดภัยและเสถียรภาพ

Branch: `dev/security-stability` — ตรวจและพัฒนาบน Kali Linux 2026.3 / WSL2, Node 26.13.0

อัปเดต Phase 2: [Dependency Security, Audit 0, ผลทดสอบ และ Production Checklist](PRODUCTION-READINESS.th.md) ตัวเลขช่องโหว่ 14 รายการด้านล่างเป็นสถานะเมื่อจบ Phase 1 ไม่ใช่สถานะล่าสุด

## ขอบเขตและสถานะข้อมูล

แก้ P0/P1 จากรายงานตรวจ: RLS, Backup/Restore, Linux Setup, Text Revision/AI Queue/Cache, Auto Provider และ Worker Lease ไม่มีการเชื่อมต่อหรือเปลี่ยนฐาน Production ไม่มีการสร้าง `.env` ของเจ้าของ ไม่มี Commit, Push หรือ Merge

การทดสอบฐานข้อมูลใช้ PostgreSQL 18 Cluster ใหม่ใน `/tmp/mybot-security-test-pg` ที่ `127.0.0.1:55432` แต่ละ Suite ใช้ Schema `test_*` ของตัวเอง ทดสอบ Restore เฉพาะฐานนี้และลบเฉพาะ Schema ทดสอบเมื่อจบ

## กลไกของปัญหาและสิ่งที่แก้

| ปัญหา | สาเหตุ | การแก้ |
| --- | --- | --- |
| RLS ไม่ครบ | Migration หลัง Baseline สร้าง 10 ตารางโดยไม่เปิด RLS | เพิ่ม Migration `20261109100000_security_stability` ไม่แก้ Migration เดิม ทดสอบทั้ง Catalog และ Role ที่มี GRANT แต่ไม่มี Policy |
| Backup ขาดข้อมูล | `BACKUP_TABLES` ไม่ทัน Schema | ส่งออกครบ 34 Models พร้อมจำนวนแถวและ SHA-256 ต่อตารางใน Format v2 |
| Snapshot ไม่สอดคล้อง | อ่านแต่ละตารางต่าง Transaction | อ่านทั้งหมดใน Repeatable Read Transaction |
| Restore ค้างครึ่งทาง | ลบ/Insert แยกคำสั่งนอก Transaction | ตรวจ Format/Manifest/แถว/Category Tree ก่อนเริ่ม และแทนข้อมูลพร้อมตรวจจำนวนใน Serializable Transaction เดียว ผิดข้อใด Rollback ทั้งหมด |
| Worker เริ่มระหว่าง Restore | ตรวจ Lease อย่างเดียวมีช่วงให้ Standby แทรก | Lock ตาราง Lease ระหว่าง Restore และปฏิเสธหากมี Lease ที่ยังไม่หมดอายุ |
| ข้อมูลชั่วคราวหลัง Restore | งาน running/Lease เดิมใช้ต่อไม่ได้ | ไม่ Replay Lease, ล้าง AI Claim Token, คืนงาน running เป็น pending และคืน Notification ที่กำลังส่งเข้าคิว |
| Linux Secret ผิดค่า | Command Substitution รับ Prompt จาก stdout | Prompt ไป stderr, อ่าน Secret แบบซ่อน, stdout มีเฉพาะค่า |
| Env ถูกตีความหรือ URL สูญเสีย TLS | ใช้ awk/sed กับ Secret และตัด Query Parameters | ส่งค่าผ่าน stdin ให้ตัวเขียนแบบ Atomic, สิทธิ์ 0600, ปฏิเสธค่าแทรกบรรทัด และรักษา URL Parameters |
| ข้อความใหม่ไม่เข้า AI | เปลี่ยน text แต่ไม่เปลี่ยน Hash หรือรีเซ็ต Job ที่ done | Text Revision, Hash และ Job Reset อยู่ Transaction เดียว พร้อม Invalidating Embedding/OCR |
| AI เก่าเขียนทับข้อความใหม่ | Job เดิมยังถือผลจากข้อความก่อนแก้ | ใช้ `Post.textRevision` และ `AiJob.claimToken` ตรวจตอนบันทึก Post/Job ใน Transaction เดียว การ Retry/Heartbeat ของ Claim เก่าแตะ Claim ใหม่ไม่ได้ |
| Cache คืนผลเก่า | เชื่อถือ contentHash โดยไม่รวมข้อความ | Cache Key รวมข้อความจริงด้วย จึงแยกผลของ Text/OCR ที่เปลี่ยน |
| Auto ไม่ใช้ Cloud Key | Registry ถูก Seed เหลือ Ollama เมื่อไม่มี Master Secret | ไม่ Seed Registry ที่เข้ารหัสไม่ได้ ใช้ Env Chain เดิมเมื่อไม่มี Registry และต่อท้ายเฉพาะ Preset ที่ยังไม่มีใน Registry |
| ปิด Provider แล้วถูกลองซ้ำ | Fallback แยกจากสถานะ Registry | Preset ที่มีใน Registry แล้วไม่ถูกลองซ้ำผ่าน Env แม้ปิดหรือ Cooldown; ตรวจ Ollama ตาม URL ของแต่ละ Provider |
| Retry-After หาย | Router สร้าง Error ใหม่โดยไม่ส่งต่อเวลา | คง HTTP Status และ Retry-After ให้ Queue |
| Lease หมดระหว่างงานยาว | ต่อ Lease เฉพาะต้นรอบงาน | Timer ต่ออายุแยกจาก Consumer/Maintenance และ Serialize การ Renew; หากเสีย Lease/ต่อฐานไม่ได้หลังเป็น Leader ให้หยุด Process ทันที |

ยังรักษา Owner Labels/Product ที่เจ้าของแก้เอง ไม่ใช้ Capture ที่ถูกตัดมาแทนข้อความฉบับเต็ม และไม่เปลี่ยนการส่ง Facebook ให้เป็นอัตโนมัติ

## วิธีอัปเดตเมื่อพร้อมนำไปใช้จริง

1. ตรวจ Branch/Diff และเลือกช่วงหยุดระบบ หยุดทั้ง Local และ Render Worker ที่ใช้ฐานร่วมกัน ไม่รัน Worker รุ่นเก่าควบคู่กับรุ่นใหม่
2. เก็บ Backup ของฐานปัจจุบันไว้ก่อน และทดสอบกู้คืนบนฐานแยก ไม่ใช้ Production เป็นสนามทดสอบ
3. ติดตั้งตาม Lockfile แล้วรัน `npm run db:migrate` เพียงครั้งเดียวกับฐานเป้าหมาย Migration นี้เป็น Additive ไม่มีคำสั่งลบข้อมูล
4. รัน Test, Lint และ Build ก่อนเปิด Web/Worker ใหม่ ตรวจ Doctor, Health และการรับโพสต์
5. การเปลี่ยน Schema นี้ไม่ควรถอย Code กลับระหว่างที่ Worker ยังทำงาน หากต้อง Rollback ให้หยุดทุก Worker ก่อน เก็บคอลัมน์ใหม่ไว้ได้ ไม่ต้อง Drop ข้อมูล

Linux Setup ใช้ `npm ci` และตรวจ Node ตามเครื่องมือทดสอบใน Lockfile: 22.22.2+, 24.15.0+ หรือ 26+ ส่วน Production ยังต้องใช้ `AI_KEY_SECRET` เดิมของระบบ อย่างน้อย 16 ตัวอักษร ห้ามเปลี่ยนค่าโดยไม่วางแผนย้ายคีย์

## Backup และ Restore

```bash
npm run db:backup
npm run db:restore -- path/to/backup.json.gz --check
```

`--check` อ่านและตรวจไฟล์โดยไม่ต่อฐานหรือแก้ข้อมูล SHA-256 ช่วยตรวจความเสียหายของไฟล์ ไม่ใช่ลายเซ็นยืนยันผู้สร้างไฟล์ เก็บ Backup ในที่ปลอดภัยเพราะมี Session และการตั้งค่าที่อาจมี Secret

หลังหยุดทุก Host และ Lease หมดอายุแล้วจึงใช้ `--replace` กับฐานเป้าหมาย การคืนข้อมูลทั้งหมดเกิดเมื่อ Commit สำเร็จเท่านั้น Format v1 เดิมยังอ่านได้ แต่ต้องระบุ `--allow-legacy` อย่างชัดเจน เพราะไฟล์เดิมขาดตารางใหม่ ตารางที่ไฟล์ไม่มีจะว่าง จึงควรตรวจและทดสอบในฐานแยกก่อนทุกครั้ง

## หลักฐานการทดสอบ

Regression ก่อนแก้ยืนยัน RLS ขาด 10 ตาราง, Backup ขาด 7 Models และ Prompt ปน Secret หลังแยกสิทธิ์ Sandbox แล้ว Test จึงยืนยันสาเหตุจากพฤติกรรมจริง ไม่ใช่ EPERM จาก Sandbox

Integration Test ก่อนแก้ Text Revision ยืนยันว่าได้รับข้อความฉบับเต็มแล้ว Content Hash ยังเท่าเดิม หลังแก้ตรวจ Hash/Revision/Job/Embedding/OCR และจำลองข้อความใหม่เข้ามาระหว่าง AI กำลังตอบ รวมถึงจำลอง Worker อีกตัวรับ Lease ก่อนบันทึกผล

ผลรอบสุดท้าย:

| คำสั่ง/การตรวจ | ผล |
| --- | --- |
| `TEST_DATABASE_URL=postgresql://supersix@127.0.0.1:55432/postgres npx vitest run` | ผ่าน 317/317 ข้อ, 38/38 ไฟล์ ไม่มี DB Suite ถูก Skip |
| `npm run lint` | ผ่าน ไม่มี Warning/Error |
| `npm run build` | ผ่าน Prisma Generate, Compile, Type Check และ Static Generation |
| `bash -n scripts/setup.sh` และ `node --check` สำหรับ Env/URL Helpers | ผ่าน |
| `git diff --check` | ผ่าน |
| `npm audit` | ยังมี 14 รายการตามรายละเอียดด้านล่าง |

`npx vitest run` เป็น Runner เดียวกับ `npm test` ใน `package.json` ใช้ฐานทดสอบข้างต้นเท่านั้น ไม่ใช้ผลจากเอกสาร Performance รุ่น SQLite มาอ้างแทนผลรอบนี้

Test เพิ่มอยู่ใน `security-stability.test.ts`, `security-stability-db.test.ts`, `backup-format.test.ts`, `provider-auto.test.ts`, `provider-registry-stability.test.ts`, `worker-lease.test.ts` และเพิ่มกรณี Retry-After ใน `ai-router.test.ts` ส่วน `stability.test.ts` เดิมย้ายไปใช้ Schema ทดสอบแยก

ข้อความ Foreign Key Error, HTTP 503 และ EBUSY ที่ปรากฏใน Test Output เป็น Fault Injection ที่ตั้งใจใช้ยืนยัน Rollback/Retry/Log Failure Test ผ่านเมื่อระบบจัดการความล้มเหลวเหล่านี้ได้

## ข้อจำกัดและงานแยก

- ยังไม่ได้ทดสอบกับ Chrome/Facebook จริง, Ollama/GPU หรือ API Key จริง การทดสอบ Provider ใช้ HTTP/Provider จำลอง
- Worker Lease ป้องกันการเริ่มงาน/บันทึกผลหลังเสียสิทธิ์ แต่ไม่รับประกัน exactly-once ของ HTTP ภายนอกที่ส่งถึงปลายทางแล้วแต่ Process หยุดก่อนบันทึกผล ต้องอาศัย Idempotency ของช่องทางนั้นเพิ่มเติม
- `npm audit` หลังติดตั้งตาม Lockfile พบ 14 รายการ: Critical 2, High 4, Moderate 8 รวม Tinypool/Vitest, Deepmerge/Prisma Config และ PostCSS ใน Next ยังไม่ได้อัปเกรดข้าม Major ใน Branch นี้ ต้องจัดงาน Dependency Remediation แยกและตรวจความเข้ากันได้ก่อนรับรองความปลอดภัยทั้งหมด
- P2 จากรายงานเดิม เช่น Feed/SSE และการจำกัด URL/Stream ของ OCR อยู่นอกขอบเขต P0/P1 รอบนี้
