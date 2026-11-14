# ผลทำงานต่อจากเอกสารส่งต่อ — 14 พฤศจิกายน 2026

เริ่มจาก `148adb7` ตาม [เอกสารส่งต่อ](HANDOFF-NEXT-MACHINE.th.md) และ [แผน rollout](SECURITY-ROLLOUT.th.md) ผลด้านล่างมาจากรอบตรวจบนเครื่องนี้ ไม่ใช้ผลเครื่องก่อนแทน งานทั้งหมด **ยังไม่ครบเกณฑ์ rollout** เพราะยังขาดการเชื่อมต่อผู้ให้บริการและการตั้ง MFA โดยเจ้าของจริง

## สิ่งที่ดำเนินการแล้ว

- ตรวจ GET `https://mb-agcf.onrender.com/api/v1/health` ตาม scope เดิม: HTTP 200, `ok=true`, commit marker `148adb75b85f` ก่อนส่งแพตช์รอบนี้ ไม่ได้ตรวจ Render deployment logs หรือ environment จาก health
- ติดตั้ง dependencies ด้วย `npm ci` บน Node 24.19.0 และสร้าง Prisma client ปัจจุบันครบ 48 models; client เดิมในเครื่องมีเพียง 40 models จึงตรวจฐานซ้ำด้วย client ใหม่
- ตั้ง local `.env` เป็น `AUTH_URL=http://localhost:8001`, `SECURITY_RELEASE_READY=0`, `SECURITY_REQUIRE_MFA=1` เก็บไฟล์เดิมใน `.env.bak-security-rollout-*` ที่ Git ignore โดยไม่เปลี่ยน master key หรือรหัสผ่าน
- พบฐานที่ local `.env` ระบุยังอยู่ก่อน security migrations และขาด 8 models ต่างจาก snapshot ในเอกสารส่งต่อ ตรวจว่าการเชื่อมต่อ runtime และ migration ให้ข้อมูล Owner ตรงกันก่อนดำเนินการ แต่ **ยังไม่ยืนยันว่าฐานนี้เป็นฐานเดียวกับ Render** เพราะยังไม่มี connection สำหรับตรวจ config ของ Render
- สำรองข้อมูลครบ 40 ตารางที่มีอยู่ก่อน migration เป็นไฟล์เข้ารหัส `data/backups/pre-security-rollout-2026-11-14.json.gz.enc` ตรวจ decrypt/manifest และกู้คืนใน schema ชั่วคราวของ PostgreSQL lab ผ่าน การกู้คืนทดสอบเพิกถอน sessions ตามนโยบาย ไม่ได้ restore ทับฐานต้นทาง
- Apply migrations ต่อไปนี้บนฐานที่ `.env` ระบุสำเร็จ ไม่มี migration ค้าง:
  - `20261202090000_better_auth`
  - `20261202100000_passport_username`
  - `20261202110000_security_controls`
  - `20261202120000_feed_read_index`
- ตรวจ digest ก่อน/หลัง migration ของ Owner รวม password hash, Session เดิม, ExtensionDevice, FbAccount, AutoCommentRule และค่า `auto_comment_control` ตรงกันทั้งหมด เซสชันเดิม 7 รายการไม่ได้ถูก cutover
- ตรวจ RLS ครบ 48 models ผ่าน ส่วน runtime role ยังมีสิทธิ์ privileged/owner จึงยัง FAIL ตามเกณฑ์ least privilege
- `security:audit` หลัง migration ผ่าน โดย `checked=0`: chain ว่าง ไม่ใช่หลักฐานว่ามีประวัติ audit จริงลงนามแล้ว
- สร้าง SQL ด้วย `scripts/security-readiness.ts --role-sql` และทดสอบใน PostgreSQL lab เท่านั้น: `mybot_runtime` ไม่เป็น owner/superuser/BYPASSRLS, อ่าน 48 models ได้, Owner/Session CRUD และ audit append ผ่าน, ไม่มี grant UPDATE/DELETE สำหรับ SecurityAudit ยังไม่ได้สร้าง/เปลี่ยน runtime login บนฐานจริง
- อ่านแผน `security:cutover` แบบ read-only พบ sessions 7 รายการและ retired identities 0 รายการ ไม่ได้ใช้ `--apply`
- `profile:reads --db` ตรวจ EXPLAIN แบบไม่ ANALYZE: default feed estimated cost 11.95, unread badge 15.8 ตัวเลขนี้ไม่ใช่ latency หรือผล load test

## บั๊กที่พบและแก้

เมื่อเปิด gate ใน lab และใช้บัญชีจำลองที่ยังไม่ตั้ง MFA จะเข้าหน้า `/settings/security` เพื่อเริ่ม enrollment แต่ Shell ขอ unread notification count แล้วได้รับ HTTP 403 `MFA_SETUP_REQUIRED` ตัวช่วย `api()` สั่งเปิด `/settings/security` ซ้ำแม้อยู่หน้านั้นแล้ว จึง reload วนจนกดตั้งค่าไม่ได้

ยืนยันด้วย production build ใน Chromium จริง: การจำลองให้เฉพาะ notification response สำเร็จทำให้ enrollment ปรากฏตามปกติ จึงแยกสาเหตุออกจาก server redirect และ CSP ได้ แก้ที่ `src/components/api.ts` โดย redirect เฉพาะเมื่อ pathname ปัจจุบันไม่ใช่หน้าความปลอดภัย คำขอเดิมยังถูกปฏิเสธและ throw ApiError การ redirect จากหน้าอื่นและ recent-auth prompt ยังคงเดิม

เพิ่ม `tests/pipeline/api-mfa-navigation.test.ts` ครอบคลุม 3 กรณี เห็นกรณีป้องกัน reload วน fail ก่อนแก้ แล้วทั้ง 3 กรณีผ่านหลังแก้ มีผู้ตรวจโค้ดแยกอีกชุดตรวจ diff และไม่พบประเด็นที่ต้องแก้

## ผลตรวจหลังแก้

ใช้ snapshot ของไฟล์ที่ Git ติดตามจาก `148adb7` พร้อมแพตช์และ regression tests รอบนี้ แยกจากไฟล์ untracked เดิมซึ่งถูกนำกลับจาก stash ไม่ได้รวมงาน onboarding/cleanup เก่าที่ค้างเข้ากับ release นี้ งานเดิมยังอยู่ใน `stash@{0}` ชื่อ `codex-before-pull-2026-11-14` และไฟล์ untracked เดิมไม่ได้ถูกลบ

| รายการ | ผลและขอบเขต |
| --- | --- |
| `npm run test:ci` | PASS exit 0; 170 files ผ่าน, 1 file ข้าม; 1,274 tests ผ่าน, 4 ข้าม; ใช้ TEST_DATABASE_URL ของ PostgreSQL 18.6 lab ผ่าน Unix socket เท่านั้น ไม่มี TCP listener |
| `npm run build` | PASS exit 0 หลังแก้; มี warnings เดิม ไม่ใช่ build ที่รวมงาน untracked ค้าง |
| `npm run lint` | PASS ก่อนแพตช์; 0 errors, 14 warnings; lint ระหว่าง build หลังแพตช์ไม่มี error |
| `npm audit --omit=dev` | 0 advisories ณ รอบตรวจ ไม่ใช่การรับรองว่าไม่มีช่องโหว่ |
| HTTP smoke ก่อนแพตช์ | PASS production build กับบัญชีจำลอง: login, signed session, CSRF, protected API, CSP nonce, ปิด signup และ logout/revocation |
| Browser หลังแพตช์ | PASS production build ที่เปิด MFA gate ใน lab เท่านั้น; Chromium เปิด sandbox, ไม่มี external browser requests และไม่มี uncaught page errors |
| MFA ใน browser lab | PASS enrollment barrier, เปิด MFA, ซ่อน recovery codes, ปฏิเสธ password-only, ปฏิเสธ OTP replay, เข้าใช้ด้วย recovery code และปฏิเสธ recovery-code replay |
| หน้าภายใน 24 เส้นทาง | HTTP 200 และ render ผ่านทุกเส้นทาง; `/settings/ai-providers` redirect ไป `/settings` ตามเดิม เป็นการตรวจการเปิดหน้า ไม่ใช่ทุกฟอร์ม/ทุก integration |

หน้าที่ตรวจ: overview, dashboard, feed, pipeline, sources, parser, categories, learn, summaries, notifications, guide, settings, settings/ai-providers, settings/security, settings/extension, settings/desktop, accounts, groups, automation, auto-comment, messages, templates, automation-quality และ getting-started

Playwright MCP เริ่มไม่ได้เพราะไม่มี Chrome ตาม path ที่กำหนด จึงใช้ Chromium ที่ติดตั้งไว้ผ่าน Playwright โดยเปิด sandbox ไม่ติดตั้ง Chrome เพิ่มและไม่ปิด sandbox หลักฐานชั่วคราวอยู่ใต้ `/tmp/mybot-security-verification-*`; path เหล่านี้ไม่ใช่ artifact ที่ส่งผ่าน Git

## งานที่ยังต้องใช้ข้อมูล/การดำเนินการของเจ้าของ

1. เชื่อม Render และ Supabase ด้วยบัญชีเจ้าของ ยังไม่ยืนยัน connection ในรอบนี้ ต้องตรวจ environment, deploy logs, project/database และทุก web/worker host ให้ตรงกัน การเห็น health commit อย่างเดียวไม่แทนขั้นตอนนี้
2. จัดเตรียม dedicated `SECURITY_AUDIT_KEY` ผ่าน environment/secret store โดยไม่ส่งในแชต เครื่องนี้มี master/recovery token ผ่านขั้นต่ำแล้ว ไม่สร้างค่าใหม่ทับค่าเดิม ก่อนตั้ง audit key ต้องตรวจประวัติอีกครั้งและรักษา previous keys หากมี fallback-signed records เกิดขึ้นแล้ว
3. สร้าง runtime LOGIN ผ่าน secret workflow ของผู้ให้บริการ ใช้ role SQL ที่ทดสอบแล้ว เปลี่ยนเฉพาะ runtime credentials โดยแยก migration/admin credentials ทดสอบสิทธิ์จริงและเตรียม URL เดิมสำหรับ rollback ก่อนสลับทุก host ไม่ REVOKE กลางงาน
4. ระบุ provider/HTTPS destination สำหรับ off-host backup และ audit checkpoint พร้อม retention/WORM และช่องทางตั้ง credential ตอนนี้ไม่มี BACKUP_UPLOAD_URL/TOKEN หรือปลายทางที่ยืนยันแล้ว ต้องพิสูจน์ upload/download/decrypt/restore จริงก่อนถือว่าผ่าน
5. ระบุ WAF/custom domain/proxy topology ก่อนเลือก TRUST_PROXY_HOPS และติดตั้ง edge policy ตัว Nginx template ยังไม่ใช่ service ที่เปิดใช้งานจริง ไม่ได้เชื่อม KMS ภายนอก
6. เมื่อทุก host และ policies พร้อมจึงเปิด gate และทำ session cutover ตามแผน จากนั้นเจ้าของ login ด้วยรหัสเดิม จับคู่ Authenticator และเก็บ recovery codes บนอุปกรณ์ของตน ยังไม่ได้เปิด MFA ของบัญชีจริงหรือเพิกถอน sessions จริง

ยังไม่ได้เริ่ม local web/worker/browser ที่เชื่อมบัญชีจริง ไม่ได้เปิดส่ง Facebook หรือเปลี่ยน pause, quotas, pairing หรือรหัสผ่านของเจ้าของ ไม่ได้ทำ active pentest/load test บน production และยังไม่รับรองความปลอดภัยระดับธนาคาร
