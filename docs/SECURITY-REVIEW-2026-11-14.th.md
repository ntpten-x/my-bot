# ตรวจความปลอดภัยและคอขวด MY-BOT — 14 พฤศจิกายน 2026

## ข้อสรุป

มีการดำเนินการตามข้อเสนอเพิ่มเติมแล้ว ดู [สถานะ rollout ล่าสุด](SECURITY-ROLLOUT.th.md) รายงานนี้เก็บหลักฐานของรอบ audit ก่อนหน้า ไม่ใช่สถานะ deployment ล่าสุด

ตรวจ source ครบ 28 หน้า, API 91 route files และเส้นทางที่ต้องยืนยันตัวตน 83 ไฟล์ / 109 HTTP methods พร้อม regression tests และแก้จุดเสี่ยงที่ยืนยันในโค้ด/คำขอจำลองแล้ว ผลนี้เป็น **การตรวจโค้ดและทดสอบ offline** ไม่ใช่การรับรองความปลอดภัยระดับธนาคาร ไม่ใช่ penetration test บน Render และยังไม่ใช่การรับรอง ASVS ทุกข้อ

หลักการแก้: ใช้ guard/parser/network boundary ร่วมกันแทนเพิ่มบริการหรือ guard ซ้ำทุกหน้า แต่ยังตรวจ session/token ที่ API แต่ละเส้นทางก่อนแตะข้อมูล ไม่เปลี่ยนบัญชี/รหัสผ่านเจ้าของ ไม่เปิดคอมเมนต์ ไม่ส่ง Facebook/LINE/Discord จริง ไม่แก้โควตาหรือ pause

การเปลี่ยนรอบนี้ยังไม่ commit/push/deploy และไม่ได้ restart เว็บจริงเพื่อเปิดใช้งานชุด security hardening นี้ อย่าใช้ผลทดสอบ source เป็นหลักฐานว่า production ได้รับแพตช์แล้ว

## ขอบเขตและสิทธิ์

ผู้ขอ: เจ้าของ workspace ตามข้อความขอตรวจระบบในแชตครั้งนี้ ขอบเขตที่ทำแล้ว: source ใน repository, Request/Response จำลอง, mocked DNS/HTTP, และ PostgreSQL18 ฐานทดสอบผ่าน Unix socket แยก schema `test_*` เท่านั้น

ยังรอการยืนยันเป้าหมาย URL/พอร์ต ช่วงเวลา อัตราคำขอ และวิธีทดสอบสำหรับ local/Render จริง จึงไม่ได้เริ่ม Nmap, ZAP, Burp, exploitation, brute force, load/DoS หรือส่งคำขอเจาะระบบจริง ไม่ follow redirect/DNS เพื่อค้นเป้าหมายภายนอกในการทดสอบ ชุด network-security tests ใช้ mock และชุด access audit ปฏิเสธ fetch ทุกครั้ง

หลักฐาน live infrastructure เช่น WAF, TLS configuration, Supabase grants/RLS บนฐานจริง, reverse-proxy header handling และพฤติกรรมบัญชีจริง: **NOT_TESTED ในรอบนี้**

## จุดที่พบและแก้แล้ว

ความรุนแรงด้านล่างประเมินจากเงื่อนไขในโค้ด ไม่ได้อ้างว่าโจมตี Render สำเร็จ

| ระดับ | สาเหตุ/ผลกระทบก่อนแก้ | การแก้ | หลักฐานตรวจ |
| --- | --- | --- | --- |
| High | `bootstrapTokenOk` คืน true เมื่อ Host เป็น localhost ก่อนตรวจ token ทำให้ผู้เข้าถึง local reset รหัสผ่านได้โดยไม่รู้ recovery secret; Host ปลอมบน public URL ก็ผ่าน helper เดิม แต่ยังไม่ยืนยันว่า Render proxy ยอมรับ Host แบบนี้ | reset ทุก host ต้องมี BOOTSTRAP_TOKEN ≥24 bytes; production setup ต้องใช้ด้วย ยกเว้นเฉพาะ development setup ที่ยังไม่มี token และ URL/Host เป็น loopback จริง | `security-audit.test.ts`, `bootstrap-token.test.ts`, `passport-auth-db.test.ts` |
| High แบบมีเงื่อนไข | RSS `parseURL` และ web-board `fetch` รับ URL จาก source โดยไม่กัน private DNS/redirect ส่วน Discord webhook รับ arbitrary URL; ต้องมีสิทธิ์แก้ source/settings หรืออาศัยช่อง CSRF มาก่อน | `fetchPublicText`: HTTP(S) public addresses เท่านั้น, ไม่รับ credentials/non-default port, ตรวจ DNS ทุกคำตอบและทุก redirect, pin DNS ใน socket, สูงสุด 3 redirects/2 MB/15 วินาที; Discord รับเฉพาะ HTTPS webhook ของ Discord และไม่ follow redirect | `public-http-security.test.ts`, `discord-security.test.ts` ใช้ mock ไม่มี request ไป private IP จริง |
| Medium | หลาย mutation มี session guard แต่ไม่มี CSRF guard เช่น multipart upload, regenerate token, ส่ง notification; SameSite=Lax ลด cross-site บางกรณี แต่ไม่แทน Origin checks โดยเฉพาะ sibling origin | middleware ตรวจ Origin/Fetch Metadata สำหรับ POST/PUT/PATCH/DELETE ของ browser API ทุกตัว; v1 extension ใช้ bearer token; comment guard ใช้ตัวตรวจเดียวกัน | `security-audit.test.ts` จำลอง cross-site/same-site |
| Medium | SSE ตรวจ session เฉพาะเริ่มเชื่อมต่อ ต่อให้ logout/revoke แล้ว stream เดิมยังอ่านโพสต์ต่อได้ | ตรวจ session id/owner/expiry ใน DB ก่อนทุก poll และปิด connection อายุ 5 นาทีเพื่อบังคับ reconnect/auth | `post-stream.test.ts` ทดสอบ revoke, อายุ stream, abort, slow polling |
| Medium | ทั่วไปไม่มี baseline CSP/anti-framing และ private JSON ไม่มี no-store; service worker เก็บ HTML ของหน้าที่เปิดไว้ อาจเก็บข้อมูล SSR ในอนาคต | private/no-store, X-Frame-Options DENY, nosniff, no-referrer, Permissions-Policy, baseline CSP/HSTS บน HTTPS; service worker เก็บเฉพาะ `/_next/static/` และล้าง cache MY-BOT รุ่นเก่า | `security-audit.test.ts`, `service-worker-security.test.ts` ไม่พบหลักฐาน exfiltration จริง |
| Medium | middleware เดิมเช็กแค่ cookie presence จึงเปิด shell ของหน้าภายในด้วย cookie ปลอมได้ แม้ API ยังปฏิเสธข้อมูล | server layout ตรวจ session จริงก่อน render หน้าภายในทั้งหมด | `private-layout-security.test.ts` + API access audit |
| Medium | JSON/form-data อ่านทั้ง body ก่อนตรวจขนาดจริง; Content-Length ไม่กัน chunked body; bcrypt พร้อมกันไม่จำกัด | bounded streaming reader ครบ 45 JSON reads: auth 16 KiB, API ทั่วไป 1.5 MB, upload 4 MB; deadline 10 วินาทีและ cancellation; จำกัด login พร้อมกัน 4 ต่อ web process | `request-body-security.test.ts`, `auth-capacity.test.ts` ไม่ได้ทำ DoS จริง |
| Medium | settings ทั่วไปส่ง legacy extension bearer token กลับทุกครั้ง แม้ผู้รับมีสิทธิ์ owner ก็เป็นการกระจาย credential เกินความจำเป็น | ไม่ส่ง legacy token ใน publicSettings; ใช้ per-device pairing แทน เก็บปุ่ม rotate สำหรับยกเลิกโทเคนร่วมเดิม | canary test ใน `rules-only-mode.test.ts`; ไม่ได้ revoke token จริง |
| Medium / data integrity | notifications และ mark-read ใช้ `{}` เมื่อ parse JSON ไม่ผ่าน แล้วตีความ IDs หาย/ว่างว่าให้อัปเดตทุกแถว | malformed/empty IDs ถูกปฏิเสธ; notifications ทั้งหมดต้องส่ง `all:true` ชัดเจน; mark-read ต้องระบุ IDs 1–1000 | `bulk-mutation-security.test.ts` ตรวจว่าไม่เรียก updateMany |
| Low / defense in depth | URL จาก imported content อาจมี scheme/credentials ที่ไม่ควรส่งให้ browser; upload ตรวจเพียง MIME/ขนาด; error บางจุดส่ง raw upstream exception | safe HTTP(S) URL projection, ตรวจ PNG/JPEG/WebP signatures, generic upload/download/feedback error; ปฏิเสธรหัสผ่านใหม่เกิน bcrypt 72 UTF-8 bytes | `safe-url-security.test.ts`, `message-image-storage.test.ts`, `cloud-security.test.ts`; ไม่อ้างว่าเคยรัน stored XSS สำเร็จ |
| Availability | pagination รับ page มหาศาล/NaN score/invalid date และคำค้นไม่จำกัด; bulk source import วนได้มากตาม body | จำกัด offset 100,000, query 200 ตัวอักษร, score 0–100, valid date range และ import ครั้งละไม่เกิน 100 URL | `read-performance.test.ts` ตรวจปฏิเสธก่อน query posts |

หมายเหตุ: local production ที่ไม่ได้ตั้ง BOOTSTRAP_TOKEN จะ reset ผ่านเว็บไม่ได้จนกว่าเจ้าของตั้ง token ฝั่งเซิร์ฟเวอร์ นี่เป็นการปิด bypass โดยเจตนา ไม่เปลี่ยนรหัสผ่านปัจจุบัน และไม่สร้าง secret แทนเจ้าของ

## รายหน้าที่ตรวจ

ทุกหน้าภายในใช้ server session guard ร่วมกัน ทุก API ที่ต้องยืนยันตัวตนมี offline access regression gate รายการด้านล่างเป็น source/path review ไม่ใช่หลักฐานว่า click ทุกปุ่มใน browser จริงแล้ว

| หน้า | ข้อมูล/เส้นทางที่ไล่ตรวจ | ผล/สิ่งที่ควรติดตาม |
| --- | --- | --- |
| `/` | redirect เข้า app | ไม่มี owner data ในหน้า root |
| `/login` | username, Passport, bcrypt, lockout, session | จำกัด body/งาน hash; ยังไม่มี MFA |
| `/setup` | bootstrap, single-owner transaction | production ต้องใช้ recovery token; username validation |
| `/reset-password` | bootstrap, hash, revoke sessions | ปิด local bypass; ยังควรเพิ่ม one-time recovery codes |
| `/dashboard` | stats, count/read projections, visible refresh | API มี auth; aggregate queries ยังต้อง profile กับข้อมูลจริง |
| `/feed` | posts, meta, settings, EventSource, LeadCard | ปิด stream หลัง revoke, query bounds, safe URLs; OFFSET/count/substring search ยังมีต้นทุนเมื่อข้อมูลโต |
| `/pipeline` | post filters/notes/feedback | auth/CSRF/body bounds; ข้อมูลติดต่อเป็นข้อมูลที่ owner ได้รับอนุญาต ไม่ใช่ public |
| `/overview` | system overview/component/channel status | auth และ redaction เดิมมี tests; ไม่ถือ snapshot ว่า provider พร้อมจริง |
| `/getting-started` | readiness projection | auth; ไม่มีการเริ่มบอทอัตโนมัติเพื่อให้ readiness ผ่าน |
| `/automation` | rules, service area, categories/templates | mutation guard, bounded JSON; ไม่เปลี่ยน allowlist/consent |
| `/auto-comment` | control/rules/jobs/evidence | auth/CSRF; claimToken ถูกตัดจาก dashboard เดิม; ไม่ส่ง comment เพื่อทดสอบ |
| `/automation-quality` | source advice, feed-sample audit | auth/bounded inputs; ผลเป็นข้อเสนอ ไม่เปิดกฎเอง |
| `/accounts` | Facebook account presence/device state | owner-only; ไม่ส่ง Facebook cookies/session credentials |
| `/groups` | source/category/product edits | mutation bounds; ไม่เปลี่ยน scope กลุ่ม |
| `/sources` | source URL/import/fetch-now/logs | แก้ public feed network boundary/import cap; logs ยังต้องควบคุม retention |
| `/messages` | templates/private image upload | stream byte limits/signature check/generic error; ยังไม่ได้ decode/re-encode ภาพและจำกัด pixel dimensions |
| `/templates` | template CRUD/usage/image URLs | auth/CSRF; signed image URLs เป็น bearer URL อายุจำกัด ห้ามแชร์นอกผู้เกี่ยวข้อง |
| `/categories` | taxonomy/keywords CRUD | auth/CSRF/bounded body; ควร paginate catalogue เมื่อโต |
| `/learn` | feedback 300 แถว/keyword suggestions | auth; relation projection และ catalogue ขนาดใหญ่ควร profile เพิ่ม |
| `/summaries` | summaries 30 รายการ/send | auth/CSRF; ไม่ทดสอบส่งข้อมูลภายนอกจริง |
| `/notifications` | unread count/list80/test send | malformed request ไม่ mark-all; Discord URL boundary; ต้องจำกัด retention ข้อความ/PII |
| `/parser` | sample payload5รายการ | owner-only; ถือข้อความเป็น untrusted data ไม่ใช้ innerHTML |
| `/guide` | static instructions/authenticated doctor | ไม่มี secret; public health จำกัดข้อมูลตาม implementation |
| `/settings` | publicSettings/notification/retention | ไม่คืน legacy bearer/SMTP password/LINE token/Discord URL; SMTP hostname ยังเป็น owner-managed configuration ควรมี egress allowlist |
| `/settings/security` | password change/session list/revoke | sanitized session list; เปลี่ยนรหัส revoke เครื่องอื่น; MFA/idle timeout/step-up ยังขาด |
| `/settings/extension` | pairing code/device token hints/revoke/download | owner-only; code one-time; ไม่ bundle raw credentials |
| `/settings/desktop` | public origin/install ZIP | server session guard; source package allowlist เดิม; ไม่ทดสอบติดตั้ง Windows จริง |
| `/settings/ai-providers` | retired page/API | API ยังต้อง auth ก่อนตอบ 410; ไม่เปิด AI/model calls กลับมา |

## คอขวดและงานที่ยังควรทำ

1. **MFA/Passkey + step-up + recovery codes** ก่อนแก้ secret, เปลี่ยน credentials, export หรืออนุมัติงานสำคัญ ปัจจุบัน password-only จึงยังไม่ควรอ้างระดับธนาคาร
2. **วางแผน session cutover ทั้ง local และ Render** เซสชันใหม่เก็บ digest แล้ว แต่เซสชัน legacy ที่เก็บ token ตรง ๆ และ Auth* tables เก่ายังถูกเก็บเพื่อความเข้ากันได้/ย้อนกลับ ต้อง revoke/migrate หลังทุก host deploy รุ่นเดียวกัน ห้ามลบ Auth* หรือเปลี่ยน token ในฐานร่วมขณะ Render เก่ายังทำงานโดยไม่วางแผน
3. **Edge rate limiting/WAF และ proxy trust ที่ตรวจจริง** จำกัดก่อน bcrypt/DB, ตัด client-supplied forwarding headers, ตั้ง AUTH_URL แยกแต่ละ host; global lockout 20 failures ยังอาจถูกใช้ล็อก owner ชั่วคราว ต้องออกแบบ challenge/MFA และ availability ควบคู่ ไม่แก้ด้วยการปิด lockout อย่างเดียว
4. **Session idle timeout และ absolute timeout ที่สั้นลง** ค่าเดิม 30 วันยังคงอยู่ ต้องกำหนดตามความเสี่ยงและการใช้งานจริง พร้อม recent-auth สำหรับงานสำคัญ
5. **Strict CSP ด้วย nonce** baseline ยังมี `unsafe-inline` เพื่อรองรับ Next hydration จึงไม่ใช่ strict CSP และไม่ใช่ตัวแทนการแก้ XSS; จำกัด image hosts/proxy เพื่อกัน tracking ด้วย
6. **ฐานข้อมูล least privilege** ใช้ runtime role ที่ไม่เป็น owner/BYPASSRLS, แยก migration role, ตรวจ grants/RLS จริงจากทุกช่องทาง Supabase; การมี ENABLE RLS ใน migration ไม่พิสูจน์ว่า privileged app role ถูกจำกัดแล้ว
7. **KMS/secret store/rotation + immutable audit log** master secret ใน environment และ AES-GCM เดิมช่วยกรณี DB dump แต่ยังไม่แยก trust boundary เทียบ KMS; audit log ต้องไม่เก็บ raw tokens/PII เกินจำเป็นและต้องตรวจการแก้ไขย้อนหลังได้
8. **Performance baseline** posts ใช้ OFFSET/count/contains ที่โตตามข้อมูล; dashboard/overview aggregation และ SSE queries โตตามจำนวนแท็บ ต้องวัด p50/p95/DB query plan ใน scope ที่อนุญาต ก่อนเลือก keyset, trigram/FTS, read models หรือ connection limits ไม่เพิ่ม Redis โดยไม่มีหลักฐาน
9. **Backup/restore, incident drill, release gate** off-host encrypted backup, isolated restore, MFA/key/session revocation drill, CI security tests/audit และ independent penetration test หลัง deploy โดยไม่ทำให้ comment delivery เริ่มเอง

## ผลกระทบที่ต้องดูตอน release

- private pages จาก static เป็น dynamic จึงมี session lookup ก่อน render ทำให้มีต้นทุน TTFB เพิ่มเพื่อไม่ส่งหน้าภายในจาก cookie ปลอม ยังไม่ได้ benchmark กับ Render จริง
- ไม่อนุญาต feeds ภายใน/metadata/custom ports และ Discord proxy/custom webhook hosts อีกต่อไป ต้องใช้ปลายทางที่ผ่าน policy หากมี integration ภายในที่จำเป็นต้องแยก allowlist ที่อนุมัติ ไม่ปิด public-address guard
- test fixture queue เดิมใช้ arbitrary webhook URL จึงถูก guard ใหม่ปฏิเสธ แก้ fixture เป็น Discord URL รูปแบบถูกต้องและยัง mock network ทั้งหมด แล้ว full suite ผ่าน

## กลไกและช่องว่างการทดสอบเดิม

ส่วนเดิมใช้ cookie/session guard เป็นหลัก แต่ guard หลายหน้าไม่ครอบคลุม CSRF, malformed input fallback และอายุ connection ที่ยาวกว่า request ตัว helper local bootstrap ออกแบบเพื่อความสะดวก setup แล้วถูกใช้ซ้ำกับ password recovery ส่วน RSS/เว็บบอร์ดเชื่อว่า URL มาจาก owner จึงไม่มี network boundary ซ้ำก่อนส่งจริง

ชุดทดสอบเดิมครอบคลุม login/logout และ authorization หลายส่วน แต่ไม่มี regression gate รวมทุก route, recovery-local-negative case, revoked SSE, private service-worker cache และ malformed bulk update กรณีใหม่จึงเพิ่มตรงขอบเขตเหล่านี้ การทดสอบ body cancellation ครั้งแรกพบ race ที่ cancel ทำให้ read คืน done ก่อน rejection แก้โดย reject ก่อน cancel และตรวจ signal ซ้ำหลัง read; targeted test ผ่านแล้ว

## ผลตรวจและข้อจำกัด

- **PASS** `MYBOT_REQUIRE_TEST_DB=1 npm test -- --maxWorkers=4` พร้อม TEST_DATABASE_URL ชั่วคราว: 164 ไฟล์, 1,254 tests ผ่าน, 2 tests ข้าม (รวม 1,256); ชุด DB ที่จำเป็นรันจริงในฐานแยก
- **PASS** `npm run build` บน Node24.19.0 รวม TypeScript/lint; มี warnings เดิมเรื่อง img/_now ไม่มี build error หน้าภายในเป็น dynamic เพื่อให้ server layout ตรวจ session จริง
- **PASS** `git diff --check`, `node --check public/sw.js`
- **PASS** `npm audit --omit=dev`: advisory counts 0 ณ เวลาตรวจ ไม่ใช่การรับรองว่าไม่มีช่องโหว่
- access audit: 83 route files / 109 methods ปฏิเสธ anonymous ก่อน database access; ถ้ามี query/fetch จะ fail; ไม่ได้พิสูจน์ทุกสาขาของ authenticated business logic
- working-tree credential-pattern check: ตรวจไฟล์ข้อความ 708 ไฟล์ ไม่พบรูปแบบ private key/AWS/GitHub/Better Infra credential ที่ตั้งไว้; `.env` และ browser profile credentials ไม่ถูก Git track; ไม่ใช่ full secret scanner หรือ Git history scan
- ตรวจ dependency advisories แยกจากการพิสูจน์ exploit ไม่ถือว่า 0 advisory = ไม่มีช่องโหว่
- NOT_TESTED: production/local live pentest, actual owner login, real image storage/notifications, TLS/WAF, DB grants จริง, performance/DoS, browser interaction ทุกหน้า, backup กู้จากไฟล์จริง และ ASVS verification ครบข้อ

## เอกสารอ้างอิง

- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- OWASP Developer Guide / ASVS levels: https://devguide.owasp.org/en/03-requirements/05-asvs/
- CSRF: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- SSRF: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

ข้อเสนอส่งมอบ: **แก้และทดสอบ offline ผ่านก่อน release แล้วตรวจ production ตาม scope ที่อนุญาต**; ยังไม่รับรองระดับธนาคาร เพราะ MFA และหลักฐานจากสภาพแวดล้อมจริงยังขาด
