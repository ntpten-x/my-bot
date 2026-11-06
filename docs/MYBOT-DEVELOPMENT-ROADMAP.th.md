# แผนพัฒนา MY-BOT และผลดำเนินการ

## อัปเดต: ส่งคอมเมนต์ผ่าน Extension ตามคำสั่งเจ้าของ

เจ้าของเปลี่ยนข้อกำหนดให้ส่งผ่านหน้าจอ Chrome แทน Graph API รอบนี้เพิ่มเส้นทางดังกล่าวอย่างอิสระ ไม่คัดลอกโค้ด BOT-W ดู [คู่มือปัจจุบัน](BROWSER-COMMENTS.th.md) แผน OAuth/ข้อจำกัดส่งกลุ่มในข้อความเดิมด้านล่างเป็นประวัติก่อนเปลี่ยนข้อกำหนด

| ข้อเสนอเดิม | สิ่งที่ทำในรอบนี้ | ขอบเขตที่ยังต้องตรวจ |
| --- | --- | --- |
| 1. ขั้นตอนตั้งค่ารวม | `/getting-started` และ authenticated readiness API มีลิงก์แต่ละขั้น | เป็น configuration/heartbeat readiness ไม่ใช่การรับรองสิทธิ์/การส่งจริง |
| 2. รักษา Outbox | regression ยืนยัน 401/403 ทำข้อมูลหาย แล้วแก้ให้พักเก็บไว้; ข้อมูลใหม่ผูก server origin | ขีดจำกัดเดิม 200 ชุด/72 ชม.; ไม่ใช่ backup ไม่จำกัดเวลา |
| 3. เก็บ Secret ปลอดภัย | Settings ใหม่เข้ารหัส AES-256-GCM รวม AI/LINE/SMTP/Discord/legacy extension token, Webhook ไม่ echo กลับ UI, มีสคริปต์ย้ายค่าเก่าแบบ compare-and-set | ไม่ได้รันย้ายค่าในฐาน Production; ต้องใช้ master key เดิม |
| 4. บัญชีและสิทธิ์ | แสดงบัญชีจาก heartbeat, เลือก device/account ต่อกฎ, ยืนยันสิทธิ์กลุ่ม, local opt-in และ revoke device เดิม | ตามข้อกำหนดใหม่ไม่ทำ OAuth สำหรับส่ง ความเห็นจาก heartbeat ไม่ใช่หลักฐานสิทธิ์กลุ่ม |
| 5. สถานะพักอ่าน | ส่ง runtime quiet reason/รับงานคอมเมนต์/journal pending ผ่าน heartbeat และแสดงบนเว็บ | สถานะอาจช้าประมาณหนึ่งนาที |
| 6. คุณภาพ Collector | นำ coverage/runs/found/inserted มาแสดงในขั้นตอนตรวจความพร้อม เพิ่ม fixture tests และ Outbox regression | ยังไม่มีการวัดกับกลุ่มจริง ไม่อ้างเก็บครบหรือเทียบเท่า BOT-W |
| 7. AI ก่อนส่ง | เลือกรอ AI เสร็จได้ แยกโหมด template/AI Draft ใช้ queue เดิม ตรวจผล/ข้อความ/flags/revision ซ้ำก่อนอนุญาต | ต้องตรวจคุณภาพร่างจริง AI ใช้ไม่ได้จะรอ/ยกเลิก ไม่ส่ง fallback เงียบ ๆ |

ส่งผ่าน `extension/browser-comment.js` + `comment-worker.js`; Worker เตรียม durable jobs, device endpoint claim/authorize/report. จำกัด URL กลุ่มและโพสต์เฉพาะ allowlist ตรวจบัญชีใน Chrome ไม่เรียก private API หรือหลบ CAPTCHA/Checkpoint; ambiguous DOM ไม่กด

Migration `20261111100000_browser_comments` เป็น additive พร้อม RLS/index ใช้ตารางเดิมและระบบ Backup/Restore เดิม เพิ่มการยกเลิกสถานะใหม่ตอน Stop/แก้กฎ/Restore งาน sending ที่ขาดการติดต่อเป็น uncertain และพักกฎ/ระบบ ไม่ retry อัตโนมัติ

Emergency Stop หยุดการอนุญาตใหม่ แต่ grant ที่ออกไปก่อนหยุดอาจยังเกิด click ได้ภายใน 3 วินาที จึงไม่ใช้คำรับรอง immediate stop ของ transport API เดิมกับ transport เบราว์เซอร์

เอกสารและโค้ดนี้ยังเป็นการทดสอบ Mock/Synthetic ไม่มีการส่ง Facebook จริง ไม่มี Deploy/Commit/Push/Merge หรือ apply กับ Production และไม่มีผลทดสอบที่ยืนยัน DOM Facebook จริง ณ บัญชีเจ้าของ

ผลตรวจฉบับส่งมอบของรอบ Extension:

- `TEST_DATABASE_URL=<PostgreSQL ชั่วคราวบน localhost> npm run test:ci` — **55 files passed, 454 tests passed, 0 failed, 0 skipped** รวม migration/RLS/backup/restore และคิว Browser ใหม่
- `npm run lint` — **exit 0**
- `npm run build` — **exit 0** รวม `/getting-started`, `/auto-comment`, readiness API และ Extension comments API; มี warning Prisma config deprecation เดิม
- `npx tsc --noEmit` — **exit 0** ในรอบตรวจชนิดระหว่างพัฒนา; build สุดท้ายตรวจชนิดผ่านด้วย
- `git diff --check` — **exit 0**
- ความผิดพลาดที่แก้ระหว่างทดสอบ: Outbox 401/403 reproduced ด้วย regression test (ก่อนแก้ 2 failed; หลังแก้ผ่าน); mock UI ปรับให้แยก readiness response; mock logger ปรับให้เป็น async เหมือนฟังก์ชันจริง
- ขั้นเตรียมงานคิวแยก transaction ต่อ job และตรวจ lease ระหว่างงาน ไม่ถือ control lock ครอบ batch 50 งานบนฐานระยะไกล

สิ่งที่ต้องทำหลังเจ้าของอนุมัติ rollout: ตรวจฐานปลายทาง/backup → apply migration → build/restart Web+Worker → โหลด Extension ใหม่และจับคู่ → ตั้งกลุ่ม/device/account → Dry Run → ตรวจ DOM ของบัญชีจริงและอนุมัติส่งทดสอบแยก การผ่าน tests สังเคราะห์ไม่แทนขั้นตอนสุดท้ายนี้

## สถานะ

Phase A สำรวจสาธารณะแล้ว ส่วนหลังล็อกอินรอช่องทางที่เจ้าของล็อกอินเองได้; Phase B–C มีแบบและ matrix จากหลักฐานที่มี; Phase D รอบนี้เพิ่มการอธิบาย/ทดลองกฎ; Phase E บันทึกผลในเอกสารชุดนี้ ยังไม่อ้างว่าขอบเขตทั้งหมดเสร็จหรือพร้อมส่งจริง

อ่าน [วิเคราะห์ BOT-W](BOTW-FEATURE-ANALYSIS.th.md), [ตารางเปรียบเทียบ](BOTW-MYBOT-COMPARISON.th.md), [คู่มือ Auto Comment เดิม](AUTO-COMMENT.th.md)

## งานเดิมและงานรอบนี้

working tree ก่อนเริ่มมีงาน Security/Auto Comment/Worker/Backup และ tests ที่ยังไม่ commit จำนวนมาก งานนั้นเป็นฐานที่ตรวจ ไม่ใช่สิ่งที่สร้างใหม่รอบนี้

ตรวจพบ preview เดิม `/api/rules/[id]/preview` สำหรับ `AutomationRule` (แจ้งเตือน/ติดตาม/เตรียมข้อความส่งเอง) ซึ่งใช้คนละ schema กับ `AutoCommentRule` จึงไม่เปลี่ยนสัญญา API เดิม ตัวใหม่อธิบาย matcher ของ Auto Comment โดยตรง ไม่มีเครื่องยนต์ส่งหรือกฎชุดใหม่ซ้ำ

รอบนี้เพิ่ม `explainCommentRule` และให้ `matchesCommentRule` ใช้ผลเดียวกัน เพิ่ม API preview ที่ต้องมี session/ตรวจ origin/JSON และหน้าทดลองใน `/auto-comment` แสดงผลทุกเงื่อนไขด้วยภาษาไทย ใช้กฎที่บันทึกแล้ว ข้อความจำลอง และเวลาประเมินจากเซิร์ฟเวอร์ ไม่เปลี่ยน template cursor/control/queue ไม่บันทึก input ไม่เลือกข้อความส่ง ไม่เรียก AI หรือ Facebook ไม่รับ Credential ใน payload

หน้าทดลองถือว่าโพสต์อายุ 0 ชั่วโมง ไม่มี flags โฆษณา/ซ้ำ/ต้องห้าม/ข้าม API รองรับ `postedAt` แบบ ISO มี timezone, `isAd`, `forbiddenHit`, `duplicate`, `dismissed` เพิ่มได้เพื่อทดสอบ ผลผ่านเป็นเพียงการจับคู่ ไม่รวม source enabled, templates, global control, start generation, dedupe history, quota, permissions หรือการตรวจโพสต์ทาง Meta

ไม่มี schema change ในรอบนี้ จึงไม่เพิ่ม migration ที่ไม่จำเป็น ใช้ 4 ตารางและ RLS ของ Auto Comment เดิม ไม่ apply migration หรือแก้ข้อมูล Production

## ลำดับถัดไปและเกณฑ์รับงาน

| งาน | ลำดับ/ยาก | สิ่งที่ต้องมี | เกณฑ์รับ |
| --- | --- | --- | --- |
| สำรวจ BOT-W ภายใน | P1/กลาง | เจ้าของล็อกอินเองผ่านช่องทางอนุญาต | บันทึกเมนู/สิทธิ์/พฤติกรรมพร้อมหลักฐาน ไม่เปลี่ยนข้อมูล |
| Connected Accounts + OAuth | P1/สูง | Meta App, callback HTTPS, Secret ผ่าน env/settings | state ใช้ครั้งเดียว/อายุสั้น, ผูก session, validate redirect, token exchange ฝั่ง server, เข้ารหัส, scopes/expiry/revoke UI, mock tests |
| ตรวจ Meta readiness | P0/สูง | เอกสารปัจจุบันและสิทธิ์จริงของเจ้าของ | แสดงแยก connected/expired/denied/unverified, ไม่ส่งจริงขณะทดสอบ |
| Collector coverage | P1/กลาง | fixtures สังเคราะห์และ browser ที่อนุญาต | ทดสอบ parser, duplicate, reconnect, ยืนยันขอบเขตอ่าน/ข้อจำกัดเก็บไม่ครบ |
| Extension permission minimization | P1/กลาง | แผนย้าย host grants + pairing compatibility | ขอเฉพาะ origin ที่ใช้ ตรวจ upgrade/revoke โดยไม่เสียการเชื่อมต่อเดิม |
| AI Draft สำหรับกฎ | P2/สูง | job type และ revision policy ชัดเจน | Worker เท่านั้น, failover, จำกัดเวลา/ความยาว, ป้องกัน prompt injection, ให้เจ้าของ review ก่อนส่ง |
| Dashboard รวม accounts/coverage | P1/กลาง | metadata จาก OAuth และ worker | ตัวเลขมีช่วงเวลาและนิยาม แยกส่งสำเร็จ/จำลอง/ไม่ทราบผล |

OAuth อาจต้องเพิ่มตารางการเชื่อมบัญชีและเพจพร้อม RLS, owner scope, encrypted token และ unique provider identity ผ่าน additive migration ในงานถัดไป แล้วให้กฎอ้าง connection เดิมโดยคง compatibility ห้ามนำ heartbeat/c_user มาแสดงว่าเป็น OAuth connection และไม่เก็บรหัสผ่าน Facebook

## วิธีติดตั้งและทดลอง

1. ใช้ Node ตาม `.nvmrc`/ข้อกำหนดโครงการและ `npm ci` บนเครื่องพัฒนา
2. ใช้ฐานพัฒนาแยกต่างหาก ตั้ง env ผ่านไฟล์หรือ settings โดยไม่ส่ง Secret ในแชต ห้ามใช้ฐาน Supabase ที่แชร์ Production เพื่อทดลอง
3. บนฐานพัฒนาเท่านั้น ใช้ `npm run db:migrate` และ seed เมื่อจำเป็น จากนั้น `npm run dev` เปิดพอร์ต 8001
4. ล็อกอิน MY-BOT เปิด `/auto-comment` สร้างกฎทดสอบและแหล่งข้อมูลจำลอง บันทึกกฎแล้วใช้ส่วน “ทดลองการจับคู่กฎ” ด้านล่างได้แม้ engine หยุด ไม่ต้องมี Meta Token
5. เปลี่ยนข้อความ/คำยกเว้น/แหล่ง/วันเวลา แล้วทดลองอีกครั้ง กฎที่ปิดหรือพักต้องแสดงว่าไม่ผ่าน การแก้ในฟอร์มที่ยังไม่บันทึกไม่ใช่กฎที่ preview ใช้
6. หากต้องทดสอบคิว ใช้ข้อมูลสังเคราะห์ในฐานทดสอบและ Mock transport คง Dry Run/Stopped บนสภาพแวดล้อมเจ้าของตามเดิม

การติดตั้งจริง/rollback/backup ดู `AUTO-COMMENT.th.md`; ไม่มีการอนุญาต Deploy หรือ apply Production จากรายงานนี้

## Tests / Lint / Build

ชุดทดสอบใหม่ครอบคลุมเงื่อนไขภาษาไทย/วันข้ามคืน/flags/อายุ, route กับ storage จำลอง, authentication/origin/validation, ไม่เรียก provider และไม่คืน Credential มี JSDOM ทดสอบกรอกข้อมูล/กดทดลอง/ล้างผลเก่า ไม่มี browser visual test จริง

| การตรวจรอบนี้ | ผล |
| --- | --- |
| `TEST_DATABASE_URL=<localhost test DB> npm run test:ci` | PASS: 48 files, 404 tests, 0 failed, 0 skipped; ใช้ schema `test_*` และ mock Meta |
| `npm run lint` | รอบแรก exit 0; รอบหลัง exit 139/SIGSEGV |
| `/usr/bin/node node_modules/eslint/bin/eslint.js` | PASS exit 0 ด้วย Node 24.19.0 |
| `npm run build` | รอบสุดท้าย PASS exit 0 ด้วย Node 26.13.0 รวมหน้า/API preview; มี Prisma config deprecation warning เดิม |
| `git diff --check` | PASS exit 0 |

บันทึกวินิจฉัยสภาพแวดล้อม: test ใน sandbox พบ subprocess EPERM/ติดต่อ localhost ไม่ได้ เมื่อรันนอก sandbox กับฐานทดสอบที่ระบุชัด ชุดเต็มผ่านทั้งหมด Build รอบแรก SIGSEGV ช่วง page data รอบนอก sandbox ครั้งแรก SIGSEGV ช่วง compile แต่รันคำสั่งเดิมซ้ำผ่าน ไม่ได้แก้ source/config/dependency เพื่อให้ผ่าน และไม่ได้พิสูจน์ root cause ของ native crash Node 26 ตาม `.nvmrc` ยังมีอาการไม่สม่ำเสมอ; การรัน lint บน Node 24 ผ่านเพียงครั้งเดียวไม่พิสูจน์ว่าเวอร์ชัน Node เป็นสาเหตุ ควรตรวจ runtime เสถียรภาพแยกก่อน rollout ผลนี้ไม่รับรอง production readiness

## ก่อนอนุมัติ Auto Comment จริง

- ตรวจ Meta App/version/scopes/tasks/App Review และอายุ Token กับข้อกำหนดล่าสุดให้ครบ ใช้เฉพาะ Page-owned published posts ใน allowlist
- ทำ OAuth/credential readiness ตามขอบเขตที่เลือก ไม่ถือ heartbeat เป็นหลักฐานสิทธิ์
- ทดสอบ migration/RLS/backup/restore/worker lease และ queue บนฐานแยก พร้อม mock transport; ทดสอบ Dry Run กับพื้นที่ที่อนุญาต
- ตรวจ Start/Pause/Stop/Emergency, quota, generation/revision fencing และ durable sending/uncertain ทุกครั้ง ห้าม retry ผลคลุมเครืออัตโนมัติ
- ให้เจ้าของตรวจข้อความ/พื้นที่/โควตาและอนุมัติส่งจริงแยกต่างหาก ไม่ใช้การอนุมัติพัฒนาแทนการอนุมัติส่งหรือ Deploy
- กลุ่มและ Marketplace คงส่งเอง Extension ไม่กดส่ง ไม่ใช้ private GraphQL และไม่หลบ CAPTCHA/checkpoint/rate limit

รอบนี้ไม่ Deploy/Commit/Push/Merge ไม่ส่งคอมเมนต์จริง และไม่เปลี่ยนข้อมูล BOT-W หรือ Production
