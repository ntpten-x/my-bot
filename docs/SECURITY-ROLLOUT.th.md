# อัปเกรดความปลอดภัยและแผนเปิดใช้จริง — 14 พ.ย. 2026

## สิ่งที่ลงมือทำ

ต่อจาก [ผลตรวจรายหน้า](SECURITY-REVIEW-2026-11-14.th.md) และคำสั่งให้ทำตามคำแนะนำทั้งหมด เพิ่มความสามารถต่อไปนี้ในโค้ดโดยยังใช้ Passport username/password และ bcrypt เดิม:

- MFA ด้วยแอป Authenticator (TOTP) + QR ที่สร้างบนเซิร์ฟเวอร์เอง ไม่มีการส่ง secret ให้เว็บสร้าง QR ภายนอก ต้องยืนยัน OTP ก่อนเปิดจริง Secret เก็บด้วย AES-GCM
- OTP ใช้ซ้ำไม่ได้; recovery codes 8 รหัส สุ่ม 128 bits ต่อรหัส แสดงครั้งเดียว เก็บเฉพาะ hash และใช้ได้ครั้งเดียวแม้เรียกพร้อมกัน
- หลังทุก host ใช้ release เดียวกัน เปิด `SECURITY_RELEASE_READY=1` แล้วบังคับ MFA โดยปริยาย บัญชีที่ยังไม่ตั้งค่าจะเข้าได้เฉพาะหน้าความปลอดภัย/ขั้นตอนตั้งค่า ส่วน business APIs ปฏิเสธจนยืนยัน MFA สำเร็จ `SECURITY_REQUIRE_MFA=0` เป็น break-glass override ของผู้ดูแล ไม่ใช่ค่าปกติ
- กันการข้าม MFA ผ่าน password reset: ต้องมี recovery token ฝั่งเซิร์ฟเวอร์ และ factor ของเจ้าของด้วยเมื่อเปิด MFA แล้ว
- เซสชันสูงสุด 8 ชั่วโมง, idle 30 นาที, recent full authentication 5 นาที เซสชันใหม่มี HMAC signature ตรวจปลอมก่อน query DB และเก็บ digest ใน DB
- Background polling/SSE ไม่ต่ออายุ idle session; เฉพาะกิจกรรมผู้ใช้ในหน้าเว็บส่ง activity แบบ coalesce นาทีละครั้ง
- เปลี่ยน password/MFA/rotate codes ใช้ authVersion fencing และเพิกถอนเครื่องอื่น การตั้งค่า/จับคู่/เพิกถอน credential ต้องมี recent authentication พร้อม dialog ยืนยันซ้ำโดยไม่ทิ้งข้อมูลฟอร์ม
- Stop/Pause/Emergency และการปิดกฎยังทำได้ด้วย valid session โดยไม่ติด recent-auth/MFA enrollment barrier ถ้าเป็นคำสั่งลดความเสี่ยงล้วน ๆ; Start/เพิ่มโควตา/เปิดกฎต้องผ่าน MFA/re-auth ตามนโยบาย ไม่เปลี่ยน control หรือส่งคอมเมนต์เพื่อทดสอบ
- Audit log สำหรับ login, MFA, password, session revocation, sensitive settings, comment control และ restore: append-only triggers + HMAC chain ภายใต้ transaction มี verifier และ encrypted export แยกจาก data restore
- รองรับ secret files ที่ Vault/KMS agent mount ให้ process (owned by app user, regular file, mode 0600, ไม่รับ symlink) และ previous-key rings สำหรับ coordinated rotation ไม่ได้อ้างว่าต่อ KMS ภายนอกแล้ว
- จำกัด auth requests ก่อน DB/hash, ไม่เชื่อ client IP จาก forwarding headers จนตั้ง trusted proxy hops และมี Nginx edge policy ที่เตรียมไว้ การเปิด edge/WAF จริงต้องตั้งบน provider ด้วย
- CSP ใช้ nonce ใหม่ทุก request และ strict-dynamic; script-src ไม่มี unsafe-inline ใน production ทุก document เป็น dynamic เพื่อให้ Next ใส่ nonce ตรงกับ header ส่วน style-src ยังมี unsafe-inline สำหรับ component styles
- Backup ต้องเข้ารหัสทั้ง local/cloud; audit trail ส่งออกแยกพร้อม checkpoint; restore ไม่คืน sessions, pairing codes หรือ recovery codes และ revoke device tokens ที่มาจาก snapshot เก่า ไม่คืน pending MFA enrollment หรือเปิด comments
- เพิ่ม partial composite index ตรง default feed ordering และคำสั่งดู query plan แบบไม่ ANALYZE ไม่อ้างค่า latency จาก estimated costs

MFA แบบ TOTP ไม่ใช่ Passkey/WebAuthn และไม่ต้าน phishing เทียบเท่า hardware-bound authentication การเปิด MFA ต้องให้เจ้าของจับคู่แอปบนอุปกรณ์ของตนจริง ห้าม agent ยืนยันแทนหรือเก็บ recovery codes ให้ในแชต

## ผลจริงบน local/ฐานร่วม

ใช้ migration เพิ่มเท่านั้น: `20261202110000_security_controls`, `20261202120000_feed_read_index` ตรวจ digest ของ Owner/password hash/Session เดิม และค่า comment control ก่อน/หลังตรงกัน ไม่แก้รหัสผ่านหรือ pairing และไม่ลบเซสชันจริงในขั้น migration

RLS ครบ 48 models แล้วจาก catalog check แต่ **runtime connection ยังเป็น privileged/table-owner role** จึงยังต้องแยก runtime login/role จริง นี่ไม่ใช่หลักฐานว่า DB ผ่าน least privilege แล้ว

เปิดโค้ด local โดยคง MFA activation gate ปิดเพื่อไม่ให้ Render รุ่นเก่ากลายเป็นทางข้าม MFA ระหว่าง rollout คำสั่ง cutover ตรวจพบ legacy sessions 2 รายการและ retired identity 0 รายการ เก็บแผนไว้ ยังไม่ apply จนยืนยัน release ทั้งสองฝั่ง

## การตั้งค่าที่ขาดจริง

จากการตรวจค่าโดยไม่พิมพ์ secrets:

| รายการ | สถานะ |
| --- | --- |
| Master encryption secret / canonical local origin | มี |
| BOOTSTRAP_TOKEN ≥24 bytes | ยังไม่มี |
| Dedicated SECURITY_AUDIT_KEY ≥32 characters | ยังไม่มี; runtime ใช้ domain-separated fallback จาก master key |
| Off-host BACKUP_UPLOAD_URL / encryption destination | ยังไม่มี |
| Render API credential / connected Render tools | ยังไม่มี ณ เวลาตรวจ |
| Supabase management connection / restricted runtime login | ยังไม่ได้เชื่อม/กำหนด |
| WAF/provider/custom-domain configuration | ยังไม่มีข้อมูลผู้ให้บริการ/โดเมน |
| Vault/KMS agent / WORM storage | มี integration seam/config แต่ยังไม่ได้เชื่อมจริง |

ไม่ใส่ค่าปลอมเพื่อให้ readiness ผ่าน ไม่เปลี่ยน master key เดิม ไม่พิมพ์ API keys/recovery secrets ลง Git/console/chat

## ลำดับ release

1. ตรวจ `npm test`, `npm run build`, encrypted restore drill และ HTTP smoke ของบัญชีจำลองก่อน push ใช้ migration เพิ่มที่ผ่านแล้วกับฐานร่วม
2. Deploy code รุ่นเดียวกันบน local + Render ผ่าน Git/บริการ ตรวจ commit marker ของทั้งสอง host ก่อนเปิด gate; Render/worker/runtime ต้องมี master key เดียวกันตามระบบเดิม
3. เชื่อม Render/Supabase เพื่อจัด environment และ runtime role จริง สร้าง LOGIN แบบ non-owner/NOBYPASSRLS ด้วย secret workflow ของผู้ให้บริการ แล้ว grant กลุ่ม `mybot_runtime`; แยก admin migration credential ไป CI/ops ที่ web process อ่านไม่ได้ Runtime DIRECT_URL ถ้าจำเป็นต้องมี ให้ใช้ limited runtime connection เช่นเดียวกัน ไม่ใส่ admin credential ให้ web
4. ตั้ง BOOTSTRAP_TOKEN, audit key และ optional SESSION_SIGNING_KEY ผ่าน environment/secret store ไม่ส่งผ่านแชต ถ้ามี audit history ที่ลงนามด้วย fallback master keyแล้ว เมื่อเปลี่ยน audit keyให้เก็บคีย์เดิมใน SECURITY_AUDIT_PREVIOUS_KEYS ระหว่าง transition เพื่อ verify ประวัติเดิมได้
5. ตั้ง backup ปลายทาง HTTPS ที่เจ้าของอนุญาต พร้อม token/encryption key, retention/WORM ตาม provider และซ้อม restore ใน lab จริงหลัง upload การมี export function ไม่พิสูจน์ว่า off-host backup พร้อม
6. ตั้ง WAF/edge rate limit และ trusted proxy hops ตาม topology จริง ห้ามเชื่อ X-Forwarded-For ทั้งสายหรือเปิด backend origin ให้ข้าม WAF ได้
7. เมื่อยืนยัน code/version/key/policies ทุก host ตรงกัน ตั้ง SECURITY_RELEASE_READY=1 ทุก web host แล้ว `npm run security:cutover -- --apply` ผ่าน admin/ops context เพื่อเพิกถอน sessions เก่า เจ้าของ login admin ด้วยรหัสเดิม → ความปลอดภัย → สแกน QR → ใส่ OTP → เก็บ recovery codes แยกจากอุปกรณ์หลัก
8. ตรวจ independent penetration test / ASVS ตาม scope ที่เจ้าของยืนยัน และทดสอบทุกหน้าผ่าน browser จริง ไม่อ้างว่า bank-grade จาก unit tests หรือ 0 advisories

## เครื่องมือที่เตรียมไว้

- `npm run security:check` — config checks เท่านั้น ไม่ติดต่อ DB; `-- --db` เพิ่ม read-only catalog check ไม่อ่าน secret values
- `node node_modules/tsx/dist/cli.mjs scripts/security-readiness.ts --role-sql` — พิมพ์ SQL ให้ตรวจ ไม่ apply เอง
- `npm run security:cutover` — read-only plan; `-- --apply` ต้องเปิด all-host gateก่อนและจะ logout ทุก browser ไม่เปลี่ยน password/paired extensions/comment control
- `npm run security:audit` — verify HMAC chain/checkpoint ไม่แก้ข้อมูล
- `npm run security:restore-drill -- <file>` — decrypt/validate โดยไม่ต่อ DB; `--lab` ยอมรับเฉพาะ Unix-socket lab ที่สร้างไว้หรือ CI Postgres service ที่ประกาศ MYBOT_TEST_LAB=1 และสร้าง schema `test_restore_drill_*` ใหม่เสมอ
- `npm run profile:reads` — dry-run; `-- --db` ดู EXPLAIN ของ fixed read queries เท่านั้น ไม่ใช้ ANALYZE ไม่แสดงข้อมูลโพสต์
- `deploy/nginx/mybot-security.conf` — template loopback edge policy ยังไม่ติดตั้ง/เริ่ม service

## ขอบเขตตรวจ release

คำสั่งล่าสุดของเจ้าของอนุญาตให้ดำเนินการตามแผนรวม deploy และตรวจ release การตรวจ deploy จำกัด GET `/api/v1/health` ของ `https://mb-agcf.onrender.com:443` เท่านั้น ไม่มี auth/cookie/payload ทดสอบ สูงสุด 1 request/5 วินาที ต่อรอบไม่เกิน 10 นาที ตรวจ DNS ทุกคำตอบเป็น public และ pin ไป socket; ไม่ follow redirect และหยุดเมื่อ HTTP401/403/429, off-scope หรือ responseเกิน64KiB ไม่ใช่ scope สำหรับ active pentest/scan

Functional HTTP smoke ใช้ process ที่สร้างเองบน random loopback port กับบัญชีจำลองและ schema `test_auth_smoke_*` บน Unix-socket Postgres แยก ไม่มี .env/key จริงใน process ทดสอบ จำกัด 40 requests/2 requestsต่อวินาที ไม่ follow redirect ไม่มี Facebook/notification จริง

## หลักฐานรอบส่งมอบ

- Full test ล่าสุดก่อน release: 170 ไฟล์ / 1,273 tests ผ่าน, 2 skipped; DB suites ใช้ Unix-socket lab และบังคับไม่ skip ฐานที่จำเป็น
- Production build ผ่าน TypeScript/lint; `npm run lint` ผ่านโดยมี warnings 14 รายการ ไม่มี errors
- HTTP production-build smoke ผ่านบัญชีจำลอง รวม nonce ตรงกับ script tags, signed cookie/login/logout/revocation/CSRF
- Encrypted audit export + encrypted backup restore drill ผ่านใน schema ใหม่และไม่เปลี่ยนฐานต้นทาง
- Config/DB inspection จริง: RLS 48 models ผ่าน, runtime least privilege ยัง FAIL, recovery/audit dedicated keys/off-host backup/all-host gate ยังขาดตามตาราง
- Commit/deployment และผลตรวจหลังส่งจะบันทึกเพิ่มเติม ไม่ใช้ข้อความเตรียมงานนี้แทนหลักฐานว่า MFA/WAF/KMS/backup ภายนอกเปิดแล้ว

อ้างอิง: [OTPAuth](https://github.com/hectorm/otpauth), [Next.js nonce CSP](https://nextjs.org/docs/14/app/building-your-application/configuring/content-security-policy), [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
