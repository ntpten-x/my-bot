# AUTO COMMENT ENGINE

> อัปเดตตามคำสั่งเจ้าของ: Runtime ปัจจุบันใช้คอมเมนต์ผ่าน Extension v1.9.0 ไม่ใช้ Graph API สำหรับงานส่งปกติ ดู [คู่มือปัจจุบัน](BROWSER-COMMENTS.th.md) เนื้อหา API ด้านล่างบันทึกขอบเขตเดิมและการทดสอบย้อนหลัง

## ขอบเขตที่พัฒนา

เพิ่มหน้า **คอมเมนต์อัตโนมัติ** (`/auto-comment`) สำหรับเจ้าของที่เข้าสู่ระบบแล้ว เชื่อม Worker เดิม โดยค่าเริ่มต้น **Stopped + Dry Run** และทุกกฎเริ่มปิด การเปิดส่งจริงต้องยืนยันครั้งหนึ่ง แล้วกฎที่เปิดจะทำงานโดยไม่อนุมัติทีละโพสต์ Extension เดิมยังอ่านอย่างเดียว ไม่มีการคลิก พิมพ์ หรือส่งคอมเมนต์ผ่านเบราว์เซอร์

รองรับข้อความหลายรูปแบบ (คั่นด้วยบรรทัด `---`), เรียงวน/สุ่ม, คำสำคัญ any/all, คำยกเว้น, Allowlist แหล่งข้อมูล, วัน/ช่วงเวลาไทย (รวมข้ามคืน), อายุโพสต์ และ Cooldown ต่อเพจ พร้อมยอดตรวจพบ/ตรงเงื่อนไข/สำเร็จ/ล้มเหลว/ค้างคิว ประวัติ 100 งานล่าสุด และ Audit Log 60 รายการล่าสุด ไม่มีการลบประวัติผ่าน API นี้

| พื้นที่ | พฤติกรรม |
| --- | --- |
| โพสต์ที่เพจตัวเองเป็นผู้เผยแพร่และยังเผยแพร่อยู่ | ส่งได้เมื่อ App/Token/ผู้จัดการ/สิทธิ์ผ่านการตรวจทุกครั้ง |
| Groups, Marketplace, โปรไฟล์ส่วนบุคคล, visitor posts, URL ที่ระบุ Page/Post ID ไม่ได้ | `unsupported` เตรียมข้อความให้คัดลอกและเปิดโพสต์เพื่อส่งด้วยมือ |
| โพสต์ถูกลบ/หมดสิทธิ์/ไม่เผยแพร่ | `unavailable` ไม่ส่ง |

ไม่ใช้ private GraphQL, cookie, Selenium/Playwright หรือการหลบ CAPTCHA/ข้อจำกัดของแพลตฟอร์ม การเป็นแอดมินกลุ่มไม่ได้ทำให้ระบบนี้รองรับการส่งในกลุ่ม

## API และข้อจำกัดการยืนยัน

ใช้ HTTPS ไปยัง `graph.facebook.com` เท่านั้น รุ่นเริ่มต้น `v25.0` ปรับด้วย `FACEBOOK_GRAPH_VERSION` ได้ ต้องตรวจรุ่นที่ App รองรับกับ Meta ก่อนเปิดส่งจริง API ที่ใช้คือ `debug_token`, `me`, `me/accounts`, `/{page-id}/posts`, `/{post-id}` และ `POST /{post-id}/comments`

ตรวจ App ID, Token type/expiry/scopes, Page identity, รายชื่อเพจของผู้จัดการ และ `MODERATE` (หรือสิทธิ์ Full Control ของ New Pages) ก่อนส่งทุกครั้ง ตรวจอีกว่าโพสต์เป็นของเพจใน Allowlist และ `is_published=true` หากตรวจไม่ได้จะไม่ส่ง สิทธิ์หลักคือ Page Token ที่มี `pages_read_engagement`, `pages_manage_engagement` และ User Token ที่มี `pages_show_list` ใช้ App เดียวกัน App Review/Advanced Access และสถานะ App อาจจำเป็นตามเงื่อนไข Meta

เอกสาร Meta โดยตรงตอบ HTTP 429 ในสภาพแวดล้อมพัฒนารอบนี้ จึงยังยืนยันรายละเอียดล่าสุดจากเนื้อหาเอกสารไม่ได้ และยังไม่ได้ทดสอบกับ Meta App/เพจจริง สถานะเปิดส่งจริงจึง **BLOCKED จนกว่าเจ้าของตรวจสิทธิ์และความสามารถของ App** การตรวจ Runtime ใช้วิธี fail closed และไม่รับรองว่า Token ทุกชนิดหรือทุกเพจจะส่งได้

แหล่งทางการสำหรับตรวจทานก่อนเปิดจริง:

- [Object comments reference](https://developers.facebook.com/docs/graph-api/reference/object/comments/)
- [Meta permissions](https://developers.facebook.com/docs/permissions#pages_manage_engagement)
- [Graph API v19 announcement / Groups API changes](https://developers.facebook.com/blog/post/2024/01/23/introducing-facebook-graph-and-marketing-api-v19/)
- [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)

## วิธีตั้งค่าและใช้งาน

1. Apply Migration และสร้าง Prisma Client ตามแผนด้านล่างก่อนเปิดแอปที่มีฟีเจอร์นี้
2. ตั้ง `AI_KEY_SECRET` ตามระบบเดิม และตั้ง `FACEBOOK_APP_ID`, `FACEBOOK_APP_ACCESS_TOKEN`, `FACEBOOK_GRAPH_VERSION` บนเซิร์ฟเวอร์เท่านั้น ห้ามใช้ `NEXT_PUBLIC_*` ไม่ต้องตั้ง Meta Credentials หากใช้เฉพาะข้อความส่งเอง/Dry Run จากข้อมูลเดิม
3. เข้า `/auto-comment` สร้างกฎ กรอก Page ID ตัวเลขเพื่อสร้างแหล่ง `facebook_page` และเพิ่มเข้า Allowlist โดยอัตโนมัติ หรือเลือกกลุ่มเดิมเพื่อเตรียมข้อความส่งเอง แต่ละกฎใช้ Page ID เดียว หลายเพจให้แยกกฎ
4. กรอก Page Access Token และ User Access Token ของผู้จัดการเพจในช่องชนิด password ระบบเข้ารหัส AES-256-GCM ด้วย `AI_KEY_SECRET` ไม่ส่งค่าเดิมกลับ Dashboard ช่องว่างตอนแก้ไขหมายถึงเก็บ Token เดิม ช่องล้าง Token ลบเฉพาะ Credential ของกฎ
5. ตั้งข้อความ/คำสำคัญ/คำยกเว้น/เวลา/วัน/อายุ/Cooldown เปิดกฎ แล้ว **Start ใน Dry Run** ตรวจประวัติกับโพสต์ใหม่ ไม่มีการส่งจริงในโหมดนี้ แม้มี Credential ครบ Worker อาจอ่านเพจด้วย GET เพื่อทดสอบการเก็บข้อมูล
6. เมื่อพร้อมและมีสิทธิ์ครบ จึงเอาเครื่องหมาย Dry Run ออก ยืนยันอนุญาตส่งจริง แล้วบันทึกโหมด ระบบจะ Stop และยกเลิกคิวเดิม จากนั้นกด Start เพื่อเริ่มรับโพสต์ใหม่ การตั้งค่าเพียงอย่างเดียวไม่ทำให้ส่งจริง
7. Pause รักษาคิวไว้และตรวจอายุ/เวลา/กฎใหม่ตอน Resume; Stop ยกเลิกงานที่ยังไม่ส่ง; Emergency Stop ล็อกไม่ให้ Start จนกดปลดขณะ Stopped ปลดล็อกแล้วระบบยังไม่ Start เอง

รับเฉพาะ Post ที่สร้างในฐานหลัง Start และถ้ามี `postedAt` ต้องไม่เก่ากว่า Start ไม่เลื่อน Dry Run เดิมเป็นงานส่งจริง ไม่ส่งย้อนหลังเมื่อเปลี่ยนโหมด มี poll เพจที่ตั้งไว้ทุกอย่างน้อย 5 นาที ครั้งละไม่เกิน 40 โพสต์ (สูงสุด 5 กฎต่อ tick) ปุ่มดึงทันทีในหน้าแหล่งข้อมูลเพจจัดคิวอ่านผ่าน Worker เท่านั้น ไม่ใช้ HTML scraper และไม่เปิดเครื่องยนต์ที่หยุดอยู่ ไม่มี pagination backlog จึงไม่รับประกันเก็บครบสำหรับเพจที่มีโพสต์จำนวนมากระหว่างรอบ ต้องเฝ้าดู ingest/worker ในระบบเดิม

เวลาใช้ Asia/Bangkok; วันของช่วงข้ามคืนถือเป็นวันที่เริ่ม เช่น จันทร์ 22:00–02:00 รวมอังคาร 01:00 ด้วย โควตาต่อชั่วโมงเป็นย้อนหลัง 60 นาที และต่อวันตัดเที่ยงคืนเวลาไทย ค่าเริ่มต้น 5/ชั่วโมง 20/วัน เพดาน 50/ชั่วโมง 200/วันเป็นมาตรการภายใน ไม่ใช่การรับรองโควตา Meta

## การป้องกันการส่งซ้ำและการหยุด

- Unique `dedupeKey=live:pageId_postId` ข้ามกฎ/รอบ/Worker Restart ทุกงานจริงมีได้ครั้งเดียวต่อโพสต์ รวมงาน failed/cancelled/uncertain ด้วย Dry Run แยก generation เพื่อไม่บล็อกการส่งจริงในอนาคต ไม่มีปุ่มล้างประวัติเพื่อส่งซ้ำ
- Cooldown ต่อโพสต์เข้มกว่าระยะเวลาชั่วคราว: ไม่ส่งซ้ำตลอดอายุประวัติ ส่วน Cooldown ต่อเพจปรับได้และใช้ค่าที่เข้มกว่าของกฎปัจจุบัน/ครั้งก่อน
- Cursor การสแกน/การเลือกข้อความ/การสร้าง Job บันทึกใน transaction มี Unique constraints กันการ replay หลังล้มเหลว
- Worker เท่านั้นที่ประมวลผล (`MYBOT_PROCESS=worker`) ใช้ worker lease เดิม และ claim token/expiry ต่อ Job ตรวจ generation/ruleRevision/textRevision/source/เวลา/สถานะอีกครั้งก่อนส่ง งานเนื้อหาเก่าถูกยกเลิก ไม่ส่งข้อความจาก snapshot เก่า
- บันทึก `sending` และ Audit `dispatch` ให้ durable ก่อนเริ่ม HTTP POST หาก Worker หยุด/การบันทึกผลล้มเหลวหลังส่ง ให้ `uncertain` และไม่ resend โดยอัตโนมัติ ระบบภายนอกไม่มี transaction ร่วมกับ DB จึงไม่อ้างว่า exactly-once หากไม่ทราบผล
- ข้อผิดพลาดชั่วคราวที่ยืนยันว่าถูกปฏิเสธ/อ่านไม่สำเร็จ retry สูงสุด 3 attempts พร้อม backoff; timeout/network/HTTP 5xx ระหว่าง POST ถือเป็น `uncertain` แม้บางครั้ง Meta อาจยังไม่รับคำขอ
- Permission error พักกฎและระบบ เจ้าของต้องแก้ Credential/สิทธิ์ บันทึกกฎ แล้ว Start เอง Rate limit ใช้ Retry-After และ usage headers เพื่อพักรวม การ Stop/Start ไม่ล้าง cooldown ของ Meta
- โควตานับความพยายามส่ง รวมส่งไม่สำเร็จหรือไม่ทราบผล เพื่อไม่ให้ retry ข้ามเพดาน แต่ Dry Run ไม่กินโควตาส่ง
- Control row lock ครอบช่วง POST ทำให้ Stop/การปิดกฎจะรอคำขอที่เริ่มแล้วเสร็จก่อนตอบรับ (HTTP timeout 10 วินาที; DB transaction timeout 20 วินาที) หลังตอบรับ Stop ไม่มีงานใหม่เริ่มส่ง คำขอที่ออกไปแล้วอาจสำเร็จและเรียกคืนไม่ได้ Emergency Stop ไม่สามารถถอนคอมเมนต์ที่ Meta รับแล้ว

## ฐานข้อมูลและ Backup

Migration ใหม่ `20261110100000_auto_comment` เพิ่ม 4 ตาราง: `AutoCommentRule`, `AutoCommentTemplate`, `AutoCommentJob`, `AutoCommentLog` เปิด RLS ทุกตาราง ไม่มี public policy; server ต้องใช้ role เดิมที่เป็นเจ้าของตาราง/มีสิทธิ์ตามการติดตั้ง ไม่มีการเปิดสิทธิ์ให้ anon

Unique Job dedupeKey, Unique template(ruleId,sortOrder), Unique audit eventKey; index รองรับคิว(status,nextAttemptAt), generation/status, post, page/source/เวลา สัมพันธ์ Post ลบแล้ว Job เก็บประวัติด้วย SetNull; Rule ที่มี Job ไม่ถูกลบแบบ cascade การไม่มีประวัติเดิมจากการลบฐาน/restore backup เก่าไม่สามารถรับประกัน dedupe กับการส่งภายนอกที่หายจาก backup ได้

Backup รวมทั้ง 4 ตาราง โดย Token ยังเข้ารหัส Restore จะบังคับ Stopped + Dry Run + Emergency Stop; pending/claimed ถูก cancelled, sending กลายเป็น uncertain ไม่เริ่มส่งหลัง Restore เอง ไฟล์ v2 ก่อนมีฟีเจอร์นี้ต้องระบุ `--allow-legacy` จึงยอมให้ขาดเฉพาะ 4 ตารางใหม่นี้ การยอมรับ v2 เก่าต้องขาดทั้ง 4 ตารางและ manifest ของทั้งชุด; ขาดเพียงบางตารางจะถูกปฏิเสธ ตารางเก่ายังต้องครบและ checksum ผ่านเช่นเดิม ต้อง Stop แอปและ Worker ก่อน Restore ห้ามทดสอบบนฐาน Production

## Apply และ Rollback

1. ตรวจ branch/diff และยืนยัน DB ปลายทางด้วยวิธีที่ไม่พิมพ์ Connection URL/รหัสผ่าน ตรวจ Snapshot ที่มี checksum และเก็บในที่จำกัดสิทธิ์
2. ทดสอบ `prisma migrate deploy` บน `TEST_DATABASE_URL` แยกต่างหากก่อน (`npm run test:ci` สร้าง `test_*` schemas และลบทิ้ง) ห้ามชี้ TEST_DATABASE_URL ไปยังฐานจริง
3. สำหรับ rollout ที่เจ้าของอนุญาตภายหลัง: หยุด web/worker, ทำ backup ที่ตรวจ manifest ผ่าน แล้ว `npm ci`, `npm run db:migrate`, `npm run build` ตรวจ RLS ผ่าน `pg_class.relrowsecurity` และตรวจ migration status ก่อน restart โดย engine ยัง Stopped/Dry Run
4. Smoke test การ Login/ingest/AI เดิม และ Dry Run ด้วยข้อมูล/พื้นที่ทดสอบที่อนุญาตเท่านั้น ตรวจสิทธิ์ Meta จริงแยกจากชุดทดสอบนี้ แล้วจึงตัดสินใจเปิดส่งจริง ไม่มีขั้นตอนใดในรอบพัฒนานี้ทำกับ Production
5. Rollback แบบรักษาข้อมูล: Emergency Stop, หยุด Worker/Web และรอ/ตรวจงาน sending/uncertain จากนั้นกลับ application artifact ก่อนฟีเจอร์นี้ได้โดย **คงตารางใหม่ไว้** Migration เป็น additive ไม่มีการแก้ตารางเดิมนอกจาก FK ของตารางใหม่ ควรเก็บ backup ที่รวมตารางใหม่ก่อนใช้ binary เก่าซึ่งไม่รู้จัก backup ของฟีเจอร์นี้
6. ไม่ DROP ตาราง/ลบ Job/restore backup เก่าทับฐานจริงเพื่อ rollback แอป หากจำเป็นต้องเปลี่ยน schema ให้ทำ forward migration ที่ทบทวนแล้ว ประวัติ dedupe ต้องคงอยู่

## หลักฐานและ Readiness

ชุดทดสอบใช้ PostgreSQL 18 ชั่วคราวบน localhost และ schema `test_*` เท่านั้น Mock transport ของ Meta ทุกครั้ง ไม่มีการส่งคอมเมนต์จริง ไม่มีการติดตั้ง dependency เพิ่มสำหรับฟีเจอร์นี้

| รายการ | สถานะ | หลักฐาน |
| --- | --- | --- |
| Rule matching, Thai keywords, allowlist, overnight window, template modes | PASS | `tests/pipeline/auto-comment.test.ts` |
| Official API permission/identity/ownership/errors/ambiguous POST | PASS | Mock fetch tests ในไฟล์เดียวกัน |
| Migration + RLS, queue, duplicate prevention, restart, quota, stop, revision, restore, AI coexistence | PASS | `tests/pipeline/auto-comment-db.test.ts` + security/migration suites เดิม |
| Session, cross-origin, validation, response ไม่ echo credential | PASS | `tests/pipeline/auto-comment-api.test.ts` |
| Dashboard safe defaults / password fields / Start / Emergency Stop | PASS | `tests/pipeline/auto-comment-ui.test.ts` (JSDOM) |
| Full suite / Lint / Production build | PASS | 389 Tests / 46 ไฟล์ ไม่มี Skip; Lint exit 0; Build exit 0 |
| Production smoke บน localhost | PASS | Web/Worker/heartbeat/DB พร้อม, API ไม่ให้ผู้ไม่เข้าสู่ระบบ Start และไม่มีงานคอมเมนต์เริ่มเอง |
| Dependency audit | PASS | Critical/High/Moderate/Low = 0 จาก npm audit รอบสุดท้าย |
| ส่งจริงบน Meta / App Review / ตรวจสิทธิ์บัญชีเจ้าของ | BLOCKED | ไม่มี Credential และไม่ได้รับอนุญาตให้ส่งจริงเพื่อทดสอบ |
| Deploy / Apply Migration บน Production | ยังไม่ดำเนินการ | รอคำสั่งเจ้าของ |

ข้อจำกัด: การตรวจบน JSDOM ไม่ใช่ visual browser test, การตรวจ permission แบบจำลองไม่ได้แทน App Review, ไม่จัดการ refresh User Token อัตโนมัติ, อายุ Token หมดจะพักระบบ, ไม่จัด retention ลบประวัติเพราะกระทบ idempotency, ไม่ reconcile uncertain อัตโนมัติ ต้องตรวจบน Facebook เอง

### ผลรอบสุดท้าย

- `TEST_DATABASE_URL=<ฐานชั่วคราว> npm run test:ci` — **46 files passed; 389 tests passed; 0 failed; 0 skipped**
- `npm run lint` — exit **0**
- `npm run build` — exit **0**, หน้า `/auto-comment` และ API ใหม่สร้างสำเร็จ (มีคำเตือน deprecation ของ config Prisma เดิม ซึ่งไม่ทำให้ Build ล้มเหลว)
- `npm audit --json --cache /tmp/mybot-npm-cache --fetch-retries=0` — vulnerabilities ทุกระดับ **0**
- `TEST_DATABASE_URL=<ฐานชั่วคราว> npm run test:production` — **PASS** ทั้งการเริ่ม Web/Worker, DB/heartbeat, health, RLS verification และการปฏิเสธคำสั่ง Auto Comment ที่ไม่มี session
- `git diff --check` — exit **0**

หลักฐานแบบเครื่องอ่านได้: [auto-comment-verification.json](security/auto-comment-verification.json) ผลทดสอบใช้ข้อมูลสังเคราะห์และ Mock Meta API ไม่มีการส่งจริง ไม่แก้ `.env` จริง ไม่ Apply กับ Production และไม่มี Commit/Push/Merge/Deploy
