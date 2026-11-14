# ส่งต่องานเมื่อเปลี่ยนเครื่อง — MY-BOT

อัปเดต 14 พฤศจิกายน 2026 งานโค้ดล่าสุดอยู่ที่ commit `3c85a85` บน `origin/master` และ push สำเร็จแล้ว เอกสารฉบับนี้จะอยู่ใน commit ถัดมา

## เป้าหมายที่ยังต้องทำให้เสร็จ

เปิดใช้งาน Passport username/password พร้อม MFA และ security hardening ให้ครบทั้ง local กับ `https://mb-agcf.onrender.com` รวม environment, สิทธิ์ฐานข้อมูล, backup ภายนอก, edge/WAF และหลักฐานทดสอบจริงตามขอบเขต โดยไม่เปลี่ยนรหัสผ่านเจ้าของหรือเปิดคอมเมนต์ Facebook เอง

เจ้าของสั่งให้ commit/push ทันทีโดยไม่ test/build เพิ่มในรอบส่งต่อนี้ จึงไม่มีผลตรวจใหม่จากการย้ายเครื่อง และ **ยังห้ามสรุปว่า production deploy สำเร็จหรือปลอดภัยระดับธนาคาร**

## อ่านก่อนเริ่ม

1. `AGENTS.md` ของ workspace และ repository บนเครื่องใหม่
2. [แผน rollout และคำสั่ง](SECURITY-ROLLOUT.th.md)
3. [ผลตรวจรายหน้าและช่องโหว่](SECURITY-REVIEW-2026-11-14.th.md)
4. [ระบบ Passport](SYSTEM-UPGRADE-AND-PASSPORT.th.md)

เอกสารเป็น snapshot ให้ตรวจสถานะปัจจุบันก่อนทำตาม อย่าเปิดงาน Facebook จากแผนเดิมอัตโนมัติ

## สถานะที่ส่งต่อ

| ส่วน | ทำแล้ว | ยังต้องทำ |
| --- | --- | --- |
| Git | `3c85a85` push ไป master แล้ว | pull บนเครื่องใหม่ และตรวจว่าไม่มีงานอื่นทับ |
| Login | Passport + bcrypt; บัญชีเดิม username `admin` รหัสผ่านเดิม | ทดสอบบัญชีจริงโดยเจ้าของ ไม่ reset เพื่อทดสอบ |
| MFA | TOTP/QR, recovery codes ใช้ครั้งเดียว, ป้องกัน replay/race, step-up | เปิด gate หลังทุก host อัปเดตตรงกัน และเจ้าของจับคู่ Authenticator จริง |
| Session | HMAC cookie + digest ใน DB, absolute 8 ชั่วโมง/idle30นาที/recent5นาที | coordinated cutover เพิกถอน sessions เก่าหลังตรวจ release ทั้งหมด |
| Local | migration security/index apply แล้ว; web/worker restart แล้ว; MFA gate ยังปิด | ตรวจว่าเครื่องเดิม/เครื่องใหม่ใช้ build และ environment ล่าสุดจริง |
| Supabase | schema มี RLS ครบ48models ณ รอบตรวจ | runtime ยัง privileged/table-owner ต้องแยก role จริง |
| Render | โค้ด push แล้ว; ตรวจ health ก่อน push พบ commit `2753e1a6cd4a` | ตรวจ deploy/build logs และ commit ปัจจุบัน ห้ามอนุมานจาก push |
| Audit | append-only/HMAC chain/verifier/encrypted export | dedicated audit key, off-host checkpoint/WORM และทดสอบปลายทางจริง |
| Backup | encryption + isolated restore drill ในโค้ด | ยังไม่มี off-host destination/config ที่ยืนยันแล้ว |
| WAF/KMS | template edge policy/secret-file adapter เตรียมแล้ว | ยังไม่ได้ติดตั้ง/เชื่อม provider จริง |
| Facebook | ไม่เปลี่ยน control/pairing/password; migration ตรวจ digest ตรง | รักษา pause และไม่เริ่ม worker ใหม่ซ้ำเครื่องเดิม |

Better Auth ถูกถอดจาก runtime/dependencies แล้ว ตาราง Auth* และ migration เก่ายังคงเพื่อประวัติ/compatibility ไม่ใช่ระบบ login ปัจจุบัน ห้ามลบ migration ที่ apply แล้ว

## เริ่มบนเครื่องใหม่

ถ้ามี checkout เดิม ให้ตรวจ `git status` ก่อน และรักษางานที่ยังไม่ commit จากนั้น:

```bash
git pull --ff-only origin master
```

ถ้าเป็นเครื่องใหม่จริง:

```bash
git clone https://github.com/ntpten-x/my-bot.git
cd my-bot
```

ใช้ Node ตาม `.nvmrc` (24.19.0 ณ รอบนี้) ติดตั้ง dependencies เมื่อจะเริ่มพัฒนาหรือรันจริง ไม่คัดลอก `node_modules` หรือ `.next` จากอีกเครื่อง

รับ `.env`/secret store ผ่านช่องทางส่วนตัวที่เจ้าของอนุญาต Git ไม่มี secrets ห้ามวางค่าในแชตหรือเอกสารนี้ ต้องคง `AI_KEY_SECRET` เดิมเพื่ออ่านข้อมูลเข้ารหัสเดิมได้ อย่าสร้าง master key ใหม่ทับโดยไม่ทำ key rotation ตามแผน

**ห้ามเริ่ม web/worker/browser อัตโนมัติบนเครื่องใหม่:** เครื่องเก่ายังอาจทำงานอยู่ โดยเฉพาะ worker และ Chrome ที่เชื่อม Facebook ตรวจและย้ายหน้าที่ให้ชัดก่อน ไม่ copy browser credentials/profile ผ่าน repository

## งานค้างตามลำดับ

### 1. ยืนยัน release และ secrets ก่อนเปิด MFA

- ตรวจ Render deploy ล่าสุดจาก commit `3c85a85` หรือ commit ส่งต่อที่ใหม่กว่า ตรวจ logs และ `/api/v1/health` commit marker
- อัปเดต local/worker ที่เกี่ยวข้องให้เป็นรุ่นเดียวกัน ฐาน Supabase ใช้ร่วมกัน migrations ด้านล่าง apply บนฐานเดิมแล้ว ให้ตรวจ pending ก่อน ไม่ reset DB หรือใช้ `db push --force-reset`
  - `20261202090000_better_auth`
  - `20261202100000_passport_username`
  - `20261202110000_security_controls`
  - `20261202120000_feed_read_index`
- Render environment ต้องใช้ `AUTH_URL=https://mb-agcf.onrender.com`; local ใช้ origin/port จริง เช่น `http://localhost:8001`
- ตั้ง `BOOTSTRAP_TOKEN` อย่างน้อย24bytes และ `SECURITY_AUDIT_KEY` อย่างน้อย32characters ผ่าน server environment/secret store ยังไม่มีค่าที่ตั้งสำเร็จ ณ ส่งต่อ ห้ามส่งค่ากลับแชต
- ตรวจว่ามี audit records ลงนามด้วย master-key fallback แล้วหรือไม่ ก่อนตั้ง audit key แยก หากมี ให้เก็บ signing key เดิมใน `SECURITY_AUDIT_PREVIOUS_KEYS` ระหว่าง transition แล้ว verify ประวัติ ไม่ลบ audit เพื่อให้ผ่าน
- คง `SECURITY_RELEASE_READY=0` จนยืนยันทุก host และเจ้าของพร้อมตั้ง MFA; ค่าที่ตั้งบนเครื่องหนึ่งไม่ใช่ค่าของ Render อัตโนมัติ

### 2. แยกสิทธิ์ฐานข้อมูล

- เชื่อม Supabase management/Render ด้วยบัญชีเจ้าของก่อนเปลี่ยน config; ตอนส่งต่อยังไม่ได้ยืนยัน connection ทั้งสอง
- ใช้ `npm run security:check -- --db` เพื่อตรวจ catalog แบบ read-only
- สร้าง SQL สำหรับ review ด้วย `node node_modules/tsx/dist/cli.mjs scripts/security-readiness.ts --role-sql`
- สร้าง runtime LOGIN แบบ non-owner/NOBYPASSRLS ผ่าน secret workflow ของ provider และทดสอบสิทธิ์ที่ต้องใช้จริง แยก migration/admin credentials ออกจาก web runtime
- ทำบนฐานทดสอบก่อนเปลี่ยน production URL ระวัง Prisma direct URL และ worker ที่ใช้ร่วมกัน อย่า REVOKE กลางงานโดยไม่มีแผนคืนค่า

### 3. Backup และ audit ภายนอก

- ขอชื่อ provider/ปลายทาง HTTPS ที่เจ้าของมีสิทธิ์ พร้อม retention/WORM และช่องทางตั้ง credential
- ตั้ง `BACKUP_UPLOAD_URL`, `BACKUP_UPLOAD_TOKEN` และ encryption key ผ่าน secret store
- พิสูจน์ upload/download/decrypt/restore ด้วยไฟล์จริงใน lab แยก ไม่ restore ทับฐานจริง
- `npm run security:restore-drill -- <file>` ตรวจไฟล์โดยไม่ต่อฐาน; `--lab` ใช้เฉพาะฐานทดสอบที่อนุญาต
- ตรวจ audit chain ด้วย `npm run security:audit` และเก็บ checkpoint นอกฐานหลัก

### 4. Edge/WAF และ proxy

- ยืนยัน provider/custom domain/topology จริงก่อนเลือกค่า `TRUST_PROXY_HOPS` อย่าเชื่อ forwarding headers จาก client ตรง ๆ
- `deploy/nginx/mybot-security.conf` เป็น template เท่านั้น ไม่ใช่ WAF ที่เปิดแล้ว และไม่ควรนำไปเปิด public listener โดยไม่ปรับ TLS/topology
- จำกัด auth requests ก่อนเข้าแอป และปิดทางเข้าตรง backend ที่ข้าม edge ได้
- Secret-file adapter รองรับ Vault/KMS agent แต่ยังไม่ใช่การเชื่อม KMS จริง

### 5. เปิด MFA และ cutover

หลัง local/Render/worker รุ่นตรงกัน keys/policies พร้อมแล้ว:

1. ตั้ง `SECURITY_RELEASE_READY=1` ทุก web host และคง `SECURITY_REQUIRE_MFA=1`
2. อ่านแผน `npm run security:cutover` ก่อน; เมื่อตรวจครบแล้วใช้ `npm run security:cutover -- --apply` ซึ่ง logout ทุก browser ไม่เปลี่ยน password/paired extension/comment control
3. เจ้าของ login `admin` ด้วยรหัสเดิม ไปหน้าความปลอดภัย สแกน QR และยืนยัน OTP บนอุปกรณ์ของตน
4. เจ้าของเก็บ recovery codes แยกจากมือถือ แสดงครั้งเดียว ห้ามใส่ Git/แชต
5. ตรวจ login ทั้งสอง host, OTP replay, recovery code ใช้ซ้ำ, logout/revoke, step-up และ Emergency Stop โดยไม่เปิดส่งคอมเมนต์จริง

อย่าเปิด MFA เฉพาะ host ใหม่ขณะอีก host ยังมี password-only code เพราะอาจเป็นทางข้าม MFA บนฐานร่วม อย่าปิด MFA/ลด policy เพียงเพื่อให้ smoke ผ่าน

### 6. ตรวจประสิทธิภาพและทดสอบส่งมอบ

- `npm run profile:reads` เป็น dry-run; `-- --db` แสดง EXPLAIN แบบไม่ ANALYZE เป็น estimated cost ไม่ใช่ latency จริง
- วัด p50/p95/DB pool/จำนวน SSE ภายใต้ scope ที่อนุญาต ก่อนเลือก FTS/trigram/cache เพิ่ม
- ทดสอบ browser ทุกหน้าตามรายงาน รวม CSP nonce, forms, upload และการ re-auth
- เมื่อเจ้าของเริ่มรอบตรวจใหม่ ให้รัน tests/build ที่เหมาะกับ changes ตอนนั้น ผลเดิมไม่แทนผลเครื่องใหม่ คำสั่งรอบส่งต่อนี้คือไม่ test/build เพิ่ม
- Active pentest/scan/load ยังต้องยืนยัน URL/พอร์ต/วิธี/ช่วงเวลา/อัตราคำขอ/เงื่อนไขหยุดตาม AGENTS.md ไม่มี permission ให้ยิง Facebook หรือปลายทางที่ค้นพบเอง

## หลักฐานเดิมและข้อจำกัด

ก่อนคำสั่ง commit/push ล่าสุด เคยตรวจ full suite ผ่าน170ไฟล์/1,273tests และข้าม2tests; build ผ่าน, lint ไม่มี errorsแต่มี14warnings; HTTP smoke บัญชีจำลองและ encrypted restore drill ผ่าน รายละเอียดอยู่ใน SECURITY-ROLLOUT.th.md ไม่มีการตรวจใหม่ในรอบเอกสารส่งต่อนี้

เครื่องใหม่ไม่มี PostgreSQL lab จากเครื่องเดิมโดยอัตโนมัติ เส้นทาง `/tmp/mybot-cadence-pg-*` และ TEST_DATABASE_URL เดิมเป็นข้อมูลเฉพาะเครื่อง ห้ามเปลี่ยน TEST_DATABASE_URL เป็นฐาน production เพื่อให้ tests รัน ต้องสร้าง lab ที่อนุญาตและปรับ verifier ที่ผูกกับ lab เดิมอย่างจำกัดก่อนใช้

ไฟล์ `.env`, mounted secrets, Chrome profiles, cookies, MFA secrets, recovery codes, .next, node_modules, GitHub credentials และผลตรวจที่อยู่ `/tmp` ไม่ได้ถูกส่งผ่าน Git เอกสารนี้จึงบันทึกผลสำคัญไว้แทน ไม่อ้างว่ามี artifact ชั่วคราวบนเครื่องใหม่

## เกณฑ์ว่างานเสร็จ

- [ ] local และ production ใช้ release เดียวกัน ตรวจ commit/build ได้
- [ ] runtime DB role ไม่ privileged/table-owner และ RLS/grants ผ่านการตรวจจริง
- [ ] recovery/audit/session secrets ตั้งครบและตรวจ key rotation โดยไม่เสียข้อมูลเดิม
- [ ] MFA เปิดจริงโดยเจ้าของทั้งสอง host และตัด sessions เก่าแล้ว
- [ ] backup/audit off-host ทำงานจริง พร้อมผล restore drill และ checkpoint
- [ ] edge/WAF/proxy policy เปิดจริงและไม่ทำให้ extension ใช้งานไม่ได้
- [ ] browser/functional/security tests ผ่านในขอบเขตที่อนุญาต และบันทึก PASS/FAIL/NOT_TESTED
- [ ] รายงานผลและข้อจำกัดที่เหลือ ไม่รับรอง bank-grade โดยไม่มีหลักฐานตามมาตรฐาน/การตรวจอิสระ

## ข้อความเริ่มงานสำหรับเครื่องใหม่

> อ่าน AGENTS.md และ docs/HANDOFF-NEXT-MACHINE.th.md ก่อน งาน security/MFA ของ MY-BOT commit หลัก 3c85a85 push แล้ว ให้ตรวจสถานะปัจจุบันแล้วทำ checklist ที่ค้างให้เสร็จ รักษารหัสผ่านเดิมและสถานะพักคอมเมนต์ ห้ามเปิดบอท/ส่ง Facebook เอง ไม่พิมพ์ secrets และไม่ใช้ฐาน production เป็น TEST_DATABASE_URL รายงานสิ่งที่ทำจริงแยกจากสิ่งที่ยังรอ connection/เจ้าของตั้งค่า
