# ตรวจภาพรวม MY-BOT: ความเสถียร ประสิทธิภาพ และความแม่นยำ

ตรวจวันที่ 7 พฤศจิกายน 2026 จาก working tree ปัจจุบัน ซึ่งรวมงาน smart comment ที่ยังไม่ commit/deploy การประเมินนี้ไม่ใช่การรับรองสภาพ Production และไม่ได้เปิดการส่งจริง

## ข้อสรุป

ควรแก้ก่อนเปิด Auto Comment หลายกลุ่ม โดยเฉพาะการจัดการเวลาใน Lease/AI queue และการปลุกงานหลังโพสต์เปลี่ยน ระบบมีฐานที่ใช้ต่อได้: PostgreSQL durable jobs, revision/generation fencing, control lock, RLS, worker leadership, device pairing, Dry Run และ local journal ไม่จำเป็นต้องรื้อเป็น microservices หรือเพิ่ม Redis เพื่อแก้ปัญหาที่พบ

ผลทดสอบเดิมผ่านไม่ได้แปลว่าทุกสถานการณ์ถูกต้อง รอบนี้พบข้อผิดพลาดเพิ่มด้วยการจำลอง timezone และลำดับเหตุการณ์ที่ tests เดิมยังไม่ครอบคลุม ไม่มีการแก้ runtime ในรอบ audit นี้

## วิธีตรวจและขอบเขต

- ตามโค้ด Extension → ingest → Post/AiJob → classification → smart matcher → AutoCommentJob → claim/authorize/report รวม Worker/Lease, auth, backup/restore, retention, health, dashboard และ launcher
- ใช้ `scripts/audit-system-local.ts` สร้างข้อมูลสังเคราะห์ใน schema `test_system_audit_*` บน PostgreSQL localhost เท่านั้น รัน migration เฉพาะ schema นั้น และลบทิ้งเมื่อจบ ไม่มี browser หรือ authorize/send Facebook
- เปรียบเทียบ SQL กับ Prisma ภายใน transaction เดียวที่ตั้ง UTC และ Asia/Bangkok ไม่สมมติว่า Production ใช้ timezone ใด
- ตรวจ dependency ด้วย npm registry แบบอ่านอย่างเดียว ไม่ติดตั้งหรืออัปเดตแพ็กเกจ
- ไม่เข้าสู่ BOT-W/Facebook ไม่อ่าน secrets ออกมารายงาน ไม่วัดโหลดจริงบน Render/Supabase และไม่เปลี่ยน Production

## สิ่งที่ต้องแก้ตามลำดับ

### F01 — P0: SQL เวลาใน Lease และ AI queue ขึ้นกับ timezone ของ session

**ยืนยันด้วยการจำลอง:** เมื่อ UTC งาน AI ที่ตั้งรออีกหนึ่งชั่วโมงไม่ถูกเลือก แต่เมื่อ Asia/Bangkok SQL เดิมเลือกงานนั้น ขณะที่ Prisma ไม่เลือก ค่า Lease ที่เขียนด้วย `now()` แล้วอ่านผ่าน Prisma คลาดเคลื่อน +25,200 วินาที (7 ชั่วโมง) และการเขียน Lease ด้วย UTC แล้วตรวจ takeover ด้วย Asia/Bangkok ทำให้ holder ที่สองรับ Lease ทั้งที่ยังไม่หมด 150 วินาทีได้

หลักฐาน: `src/lib/lease.ts:14`, `src/lib/ai/queue.ts:102`, `src/lib/auto-comment/browser.ts:207` คอลัมน์ Prisma เป็น timestamp ไม่มี timezone แต่ SQL ใช้ timestamptz/now() ปะปน แล้ว browser gate นำ expiresAt ไปเทียบ Date.now()

ผลกระทบ: Backoff อาจไม่ถูกเคารพ ระยะรอ failover/ตรวจ leadership คลาดเคลื่อน และ mixed-session อาจทำให้สอง worker เชื่อว่าเป็นผู้นำ แม้ control lock และ dedupe ยังลดโอกาสส่งซ้ำได้ จึงไม่สรุปว่าเกิดการส่งซ้ำแล้วจริง

แก้: กำหนดสัญญาเวลา UTC แบบเดียวทุก raw query (`now() AT TIME ZONE 'UTC'` กับ timestamp เดิม หรือวาง migration เป็น timestamptz อย่างรอบคอบ) ใช้ clock จากฐานในการตัดสิน Lease ตรวจข้อมูลเวลาเก่าก่อนเปลี่ยน ห้ามลบ Lease ขณะที่ worker อื่นทำงาน

ตรวจรับ: future jobs ไม่ถูก claim ก่อนเวลา, heartbeat ไม่ล้ำไป 7 ชั่วโมง, takeover หลังหมด TTL เท่านั้นในทุกคู่ UTC/Bangkok และผลทดสอบ concurrency สอง worker ผ่าน

### F02 — P1: งาน browser_ready ที่โพสต์เปลี่ยนมีช่องว่างหลังถูกยกเลิก

**ยืนยันด้วยการจำลอง:** สร้างงานพร้อมส่ง → แก้ textRevision → scan บันทึก checkpoint ใหม่เป็น deduplicated → claim ตรวจ revision แล้ว cancel → scan อีกครั้ง งานยัง cancelled, textRevision เก่า และ `nextEvaluateAt=null` แม้ข้อความใหม่ยังตรงกฎ

หลักฐาน: `src/lib/auto-comment/browser.ts:117`, `src/lib/auto-comment/browser.ts:193` เส้นทาง pending_ai invalid ปลุก evaluation แล้ว แต่เส้นทาง claim invalid ยังไม่มีขั้นตอนเดียวกัน

ผลกระทบ: งานอาจค้างข้ามจนมี Post/Source/Rule เปลี่ยนอีกครั้ง จึงยังรับรองว่าไม่มีงานตกหล่นไม่ได้

แก้: รวมการยกเลิกงานก่อนส่งและการปลุก evaluation ใน transaction เดียว ตรวจ snapshot เก่าก่อน claim และเก็บ reason; rearm ได้เฉพาะงานที่พิสูจน์ว่ายังไม่ออก grant ห้ามนำ sending/uncertain กลับไปส่ง

ตรวจรับ: ทดสอบลำดับ scan-before-claim, claim-before-scan และ AI เปลี่ยน intent หลัง browser_ready; มีงานที่ใช้ revision ปัจจุบันหรือเหตุผลข้ามที่ชัดเจน ไม่สร้าง live key ใหม่

### F03 — P1: การบันทึกโพสต์ใหม่กับการเข้าคิว AI ยังไม่ atomic

**ยืนยันเส้นทางจากโค้ด ยังไม่ inject crash:** `src/lib/ingest.ts:169` บันทึก Post ก่อน แล้ว `src/lib/ingest.ts:217` จึง enqueue AiJob ถ้า process/DB connection ล้มระหว่างนั้น การส่ง batch เดิมซ้ำพบ Post เดิมและไม่มี createdIds ให้ enqueue ส่วน repair `src/worker/index.ts:68` ทำตอน startup ไม่ใช่ทุก tick

ผลกระทบ: โพสต์อาจอยู่บน rules โดยไม่มี AiJob ขณะ worker ยังรันต่อ กฎ requireAi รอจนเกินอายุ

แก้: Post + AiJob/outbox event ใน transaction เดียว และ repair sweep เป็นระยะ ใช้ receipt ต่อรายการให้ retry หลัง response หายได้

ตรวจรับ: inject failure หลัง insert ก่อน enqueue/ก่อน response; retry batch แล้วทุกโพสต์มีงาน AI หรือสถานะ skipped ที่อธิบายได้ ไม่มี notification/job ซ้ำ

### F04 — P1: ตัวกรองปฏิเสธยังไม่เข้าใจขอบเขตประโยค

**ยืนยันด้วยข้อความสังเคราะห์:** ทั้ง `หารองเท้า ไม่ขายครับ`, `อยากได้รองเท้า แต่ไม่ซื้อของปลอม`, `หารองเท้าครับ ไม่ต้องการสีแดง` กลายเป็น closed

หลักฐาน: `src/lib/auto-comment/intent.ts:7` ตรวจ negation ทั้งข้อความและ return ก่อนผล AI

ผลกระทบ: คนต้องการซื้อจริงถูกข้าม โดยเฉพาะข้อความระบุเงื่อนไขสินค้า

แก้: แยก negation ของเป้าหมายหลักออกจากคุณสมบัติ/บทบาทผู้ขาย ใช้หลักฐานข้อความและ intent ต่อ clause; ข้อความกำกวมเข้ารอตรวจ ไม่แก้ด้วยการปล่อย regex ผ่านทั้งหมด เก็บ alias คำสะกดผิดแบบ explicit ตามเดิม

ตรวจรับ: ชุดภาษาไทยที่เจ้าของติดป้าย แยก buyer/seller/closed/chat/unknown และข้อความหลายเจตนา วัด precision/recall ต่อหมวด ไม่ใช้ผลจากตัวอย่างไม่กี่คำเป็น accuracy ของระบบ

### F05 — P1: Outbox มีขีดจำกัดที่ทำข้อมูลหายได้ และยังไม่มี receipt รายรายการ

หลักฐาน: `extension/background.js:165` เก็บสูงสุด 200 ชุด/72 ชั่วโมง, `:173` read-modify-write ไม่มี storage transaction, `:196` ลบด้วย at+sourceUrl; `src/app/api/v1/ingest/route.ts:36` ตอบผลรวมทั้ง batch

ผลกระทบจากโค้ด: สอง producer อาจเขียนทับกัน, batch เวลาเดียวกัน/แหล่งเดียวกันอาจถูกลบพร้อมกัน, ข้อมูลเก่าถูกตัดโดยไม่มีตัวนับสูญหาย และ accepted/skipped/duplicates ไม่ถูกแยกรายรายการ ตัวเลข postsSent ฝั่ง Extension จึงไม่ใช่จำนวน Post ใหม่ใน DB

แก้: batchId/itemId ถาวร, serialized local queue หรือ IndexedDB transaction, server idempotency receipt, ลบเฉพาะ acknowledged item, แจ้งจำนวนเต็ม/หมดอายุ/ปฏิเสธ และนโยบายพักรับเพิ่ม ไม่เพิ่ม cap อย่างเดียว

ตรวจรับ: concurrent enqueue/flush, same-millisecond batch, 401/403/429/5xx, crash ก่อน/หลัง response, origin เปลี่ยน, ข้อมูลเต็ม/หมดอายุ ต้องนับได้ทุก item

### F06 — P1: Observer ยังยืนยันผลได้ในรูปแบบ DOM จำกัด

หลักฐาน: `extension/browser-comment.js:90` ต้องพบลิงก์ใหม่ใน article และ author เป็น numeric path หรือ profile.php?id; `extension/comment-worker.js:48` อ่านผลราว 10 วินาที จากนั้น `src/lib/auto-comment/browser.ts:237` พักทั้งระบบเมื่อ uncertain

ผลกระทบจากเส้นทาง: author URL แบบ username, DOM ต่างรูปแบบ หรือผลเผยแพร่ช้าสามารถกลายเป็น uncertain แม้ส่งแล้ว ทั้งนี้ยังไม่พิสูจน์อัตราความผิดพลาดในบัญชีจริงรอบนี้

แก้: evidence ของ post/account/message/comment permalink พร้อม compatibility fixtures และ read-only reconciliation ที่จำกัดเวลา ขยายการอ่านได้แต่ห้าม retry คลิกส่งจากสถานะคลุมเครือ แยก checkpoint/account restriction ที่ต้องหยุดทั้งหมดออกจากปัญหา observer ที่ต้องตรวจ โดยคงค่าเริ่มต้น fail-closed จนทดสอบนโยบายใหม่

ตรวจรับ: ไทย/อังกฤษ, nested dialogs, username author, delayed appearance, pending moderation และ report หายหลังคลิก: ไม่มีการกดซ้ำและไม่มี false success จากข้อความใน composer

### F07 — P1: AI Draft ปัจจุบันยังเป็นร่างทั่วไปของโพสต์ ไม่ใช่คำตอบธุรกิจต่อกฎ

หลักฐาน: `src/lib/auto-comment/browser.ts:175` ใช้ suggestedReply; `src/lib/ai/prompt.ts:21` กำหนดไม่ให้ใส่ลิงก์, `:49` ตัดข้อความส่งโมเดล 800 ตัว; `src/lib/pipeline/classify.ts:21` cache ไม่มี prompt/group-profile/business-facts version

ผลกระทบ: ตัวอย่าง “ลิงก์ Shopee ที่ตั้งไว้” ควรใช้ Template ในตอนนี้ การเปลี่ยน AI model/prompt/ข้อมูลธุรกิจอาจยังได้ cache เก่า และข้อมูลท้ายโพสต์อาจไม่เข้า AI ยังไม่มี calibrated confidence/evidence ต่อการเลือกกฎ

แก้: rule-specific draft แยก classification, snapshot ของข้อความ+กฎ+facts+prompt version; ห้ามสร้างราคา/ลิงก์เอง; validate output, evidence และความเกี่ยวข้อง ก่อนส่ง ใช้ facts ที่เจ้าของรับรองเท่านั้น ข้อมูลโพสต์ต้องเป็น untrusted input

ตรวจรับ: prompt injection, ราคา/ลิงก์ไม่มีใน facts, negation หลังตัวที่ 800, output ผิด schema, provider failover และเปลี่ยน prompt แล้ว cache ต้องไม่ให้ผลเก่าผิดบริบท

### F08 — P1: รับ URL ภาพจากข้อมูลภายนอกโดยยังไม่จำกัดปลายทางและขนาดระหว่างดาวน์โหลด

หลักฐาน: `src/lib/ingest.ts:44` รับ http(s) ไม่จำกัด host; `src/lib/ocr.ts:18` fetch ตาม URL/redirect, ใช้ arrayBuffer ทั้งก้อนก่อนเช็กขนาดจริง 2 MB ในกรณีไม่มี Content-Length ที่เชื่อถือได้

ผลกระทบจากโค้ด: ข้อมูลจากอุปกรณ์ที่เชื่อมต่ออาจทำให้ worker เรียกปลายทางภายใน/วน redirect หรือใช้ RAM สูงกว่าขีดจำกัดที่ตั้งไว้ ไม่ได้ทดสอบเข้าถึง metadata/private network จริง

แก้: public image URL policy/host allowlist ที่เหมาะกับแหล่ง, ตรวจ DNS/IP และทุก redirect, ปฏิเสธ private/link-local, streaming byte cap, content type และเพดานความละเอียดภาพ แยก policy ของ local Ollama ที่ตั้งโดยเจ้าของออกจากภาพที่โพสต์ส่งมา

ตรวจรับ: mock localhost/private IP/redirect/DNS เปลี่ยน, chunked body เกิน cap และภาพ decompression ขนาดใหญ่ ต้องหยุดก่อนจัดสรรเต็ม

### F09 — P1: Backup ไฟล์ภายในเครื่องยังไม่ใช่การกู้คืนที่ทนต่อ host สูญหาย

หลักฐาน: `src/lib/backup.ts:26` เขียน data/backups และบันทึก path ลงฐานร่วมกัน; `src/lib/backup-format.ts:82` อ่านทุกแถวเข้า RAM แล้ว `src/lib/backup.ts:21` JSON.stringify + gzipSync

ผลกระทบ: backup อาจอยู่บน host ที่ไม่ได้เป็นผู้นำภายหลัง หรือหายเมื่อ host ถูกแทนที่ ข้อมูลโตทำให้ snapshot ใช้ RAM หลายเท่า และงาน sync อาจขวาง event loop/renew Lease ยังไม่ได้วัดจุด OOM จริง

หากใช้ Render โดยไม่มี persistent disk ไฟล์ local หายเมื่อ restart/redeploy; Free มี idle spin-down และไม่มี persistent disk ตาม [เอกสาร Render](https://render.com/docs/free) ส่วน disk ต้องกำหนด mount path ให้ตรงตาม [คู่มือ Persistent Disks](https://render.com/docs/disks) ยังไม่ได้ยืนยันแพ็กเกจจริงของเจ้าของ

แก้: encrypted off-host backup พร้อม checksum/storage key, retention และ restore drill; ข้อมูลโตใช้ streaming/export นอก event loop และกำหนด RPO/RTO บนข้อมูลจริง อย่านับ backup_last_at อย่างเดียวว่ากู้คืนได้

### F10 — P2: Evaluation ถูกปลุกจาก metadata ที่ไม่เกี่ยวกับการตัดสินใจ และประวัติส่งโตไม่จำกัด

หลักฐาน: `src/lib/auto-comment/browser.ts:59` เทียบ Post.updatedAt/Source.updatedAt; ingest `src/lib/ingest.ts:219` และ scrape scheduler อัปเดต Source ทุกครั้ง; `src/lib/retention.ts:84` ยังไม่จัดการ AutoCommentLog/Job ตามนโยบายแยก

ผลกระทบ: อ่านกลุ่มรอบใหม่หรือเปลี่ยน metadata สามารถทำให้โพสต์เก่าใน generation ถูกประเมินและเขียน checkpoint ใหม่ แม้เนื้อหา/กฎไม่เปลี่ยน; observed log เพิ่มทุก generation และ dashboard groupBy ประวัติทั้งหมด

แก้: semantic revision/fingerprint ของ input ที่ใช้ตัดสินใจจริง, atomic dirty queue, จำกัดช่วงอายุ sweep; เก็บหลักฐาน/เนื้อความตาม retention แต่รักษา live dispatch key แบบถาวรหรือ archive ที่ยังตรวจ dedupe ได้ ใช้ EXPLAIN/benchmark ก่อนเพิ่ม index

ตรวจรับ: heartbeat/read marker/fetch timestamp ไม่ก่อ evaluation ใหม่ ส่วน text/AI/rule/source enabled เปลี่ยนต้องปลุกได้; benchmark 1k/10k โพสต์และวัด query count/lock wait/RAM

### F11 — P2: การตรวจสุขภาพและการทำงานต่อหลัง fatal exception ยังไม่พอ

หลักฐาน: `src/worker/index.ts:31` uncaughtException/unhandledRejection เขียน log แล้วอยู่ต่อ; `src/lib/public-health-server.ts:26` public health ตรวจ schema/AI/Extension แต่ไม่ได้รับรองว่า consumer ยังเดินงาน; launcher `scripts/start-all.mjs:70` restart ได้เมื่อ child จบ

แก้: fatal path บันทึกแบบ bounded แล้วจบ nonzero ให้ supervisor restart, แยก liveness/readiness/queue progress; แจ้ง oldest job age และ last successful progress ไม่ใช้ heartbeat อย่างเดียว กรณี managed rejection ที่ recover ได้ให้จัดการที่ขอบงาน

ตรวจรับ: kill worker/DB timeout/consumer ค้าง/uncaught exception ต้องเห็น alarm และกู้ claim ตาม lease โดยไม่ส่งซ้ำ

### F12 — P2: Dashboard polling, labels และ daily jobs ควรปรับให้สะท้อนความจริง

หลักฐาน: หน้า `/auto-comment` `src/app/(app)/auto-comment/page.tsx:56` poll ทุก 5 วินาทีและอาจมี request ซ้อน; `src/lib/auto-comment/engine.ts:197` โหลดหลาย query รวม groupBy ทุกครั้ง; `src/lib/coverage.ts:28` ใช้คำว่า “ครบ” จาก heuristic; `src/lib/retention.ts:101` เขียน daily marker ก่อน purge สำเร็จ

ผลกระทบ: เปิดหลายแท็บเพิ่มโหลดและ response เก่าอาจทับใหม่, coverage label ให้ความมั่นใจเกินหลักฐาน, retention fail กลางทางไม่ retry จนวันถัดไป

แก้: single-flight polling/backoff/หยุดเมื่อ hidden + pagination แล้วค่อยพิจารณา SSE เมื่อมีตัวชี้วัดรองรับ; label “ไม่พบสัญญาณตกหล่น” พร้อมช่วงเวลาวัด; daily job ใช้ claim/running/succeeded/failed + retry ไม่ใช้วันอย่างเดียว

## ความปลอดภัยและการปฏิบัติการที่ควรรักษา/เพิ่ม

- รักษา RLS, hashed device tokens, encrypted settings, per-rule consent, pinned account/device, global stop, local journal และสิทธิ์ grant อายุสั้น ห้ามแก้ปัญหาคิวด้วยการปิดตัวตรวจเหล่านี้
- ตรวจ bootstrap `/setup` ก่อน deployment ใหม่: `src/app/api/auth/setup/route.ts:16` เปิดตั้งเจ้าของเมื่อฐานยังว่าง และ `src/lib/auth.ts:45` check-then-create ไม่มี singleton lock ควรทำ one-time bootstrap ที่เจ้าของควบคุมและ unique singleton ไม่ใช่ปัญหา takeover ที่พิสูจน์ในบัญชีปัจจุบัน
- `src/lib/auth.ts:68` cache session ได้ 60 วินาที; การลบ session หลังเปลี่ยนรหัสผ่านอาจยังมีช่วง cache ต้องกำหนดนโยบาย revocation และทดสอบหลาย process
- Secret ที่เคยส่งผ่านแชตควรวางแผนหมุนเวียนโดยเจ้าของ แต่ AI_KEY_SECRET ต้อง re-encrypt และทำให้ทุก host ใช้ค่าเดียวกันก่อนสลับ ห้ามเปลี่ยนทันทีจนถอดข้อมูลเดิมไม่ได้ รอบนี้ไม่เปลี่ยน key ใด
- ลด host permissions ของ Extension ตาม origin ที่จับคู่ ปัจจุบัน manifest ครอบคลุม `*.onrender.com` แม้ `extension/background.js:932` มี origin check อีกชั้น จึงไม่กล่าวว่าทุกเว็บ Render สั่งบอทได้
- เพิ่ม CI ที่บังคับ disposable Postgres, migrations, tests, lint/build และ dependency audit ขณะตรวจไม่พบ GitHub Actions workflow ใน repo ไม่ได้ตรวจว่ามี CI ภายนอกหรือไม่

## แผนปรับให้ฉลาดและเสถียรโดยไม่เพิ่มระบบเกินจำเป็น

| รอบ | งาน | เกณฑ์จบ |
| --- | --- | --- |
| 1: ความถูกต้อง | F01/F02/F03 พร้อม regression | ไม่มี early claim/ผิด Lease; รับโพสต์แล้วไม่ขาดงาน; revision ใหม่ไม่หาย; uncertain ไม่ส่งซ้ำ |
| 2: ความแม่นยำ | F04/F07 + ชุดข้อมูลเจ้าของ | ตอบตามเจตนาและ facts; แยกกรณีข้ามกับรอตรวจ; วัด precision/recall แยกประเภท |
| 3: รับส่งทนขัดข้อง | F05/F06/F08 | item accounting ครบ, offline recovery, observer evidence, bounded/untrusted network input |
| 4: ทำงานยาวนาน | F09/F10/F11/F12 | off-host restore ผ่าน, queue progress alerts, RAM/query/lock time อยู่ในงบ, rollback ไม่เปิด automation เอง |

เริ่มจาก Template ที่มีข้อความ/ลิงก์เจ้าของกำหนดและ AI เป็นตัวช่วยตรวจเจตนา จากนั้นจึงเปิด rule-specific AI Draft แก้ข้อความเองเมื่อมี facts/evaluation รองรับ ไม่ให้ AI เพิ่มโควตา เปลี่ยนกลุ่ม หรือขยายสิทธิ์เอง

ตัวชี้วัดควรแยก collector coverage, ingest receipts, evaluation latency, AI accuracy, delivery observation และ uncertain rate คนละค่า เป้าหมายภายในที่เสนอคือ 100% ของ item ที่ server ยืนยันรับมีสถานะติดตาม, ศูนย์ unauthorized clicks และศูนย์ automatic resend หลัง ambiguous grant ส่วน latency/throughput ต้องตั้งหลัง benchmark บนเครื่องและแพ็กเกจจริง ไม่กำหนดตัวเลขความเร็วจาก unit tests

## ผลตรวจและสิ่งที่ยังไม่ทราบ

`npm run test:ci`: **59 files / 501 tests ผ่าน ไม่มี skip** บน TEST_DATABASE_URL localhost; `npm run lint`, `npm run build`, `npx tsc --noEmit` และ `git diff --check`: **ผ่าน**; `npm audit`: **0 vulnerabilities ที่ registry รายงาน ณ เวลาตรวจ** ไม่รับรองว่าไม่มีช่องโหว่ทุกชนิด Build ยังมีคำเตือน Prisma config deprecation เดิม

ตัวจำลอง audit แสดง F01/F02/F04 ตามรายละเอียดข้างต้น สถานะ exit 0 ของสคริปต์หมายถึงจำลองและทำความสะอาดสำเร็จ ไม่ได้หมายความว่าพบข้อผิดพลาดเป็นศูนย์ สคริปต์นี้ไม่ใช้ DATABASE_URL จริงเป็น fallback และไม่พิมพ์ credential

คำสั่งทำซ้ำบนฐานทดสอบ: `TEST_DATABASE_URL=<PostgreSQL localhost สำหรับทดสอบ> npx tsx scripts/audit-system-local.ts`

ยังไม่ทราบ: current timezone/pool settings ของ Production, Render tier/disk, ความพร้อม AI key จริง, ความแม่นยำกับโพสต์จริงในแต่ละกลุ่ม, DOM compatibility ปัจจุบัน, p95 latency/โหลดสูงสุด, off-host backup และ restore เวลาใช้งานจริง ต้องตรวจเพิ่มใน rollout ที่ได้รับอนุญาต ไม่อนุมานจาก source code

**คำตัดสิน: แก้ก่อนเปิดใช้งานกว้างขึ้น — เหตุผลหลักคือสัญญาเวลาใน Lease/AI queue และช่องว่างการประเมินหลังงานพร้อมส่งถูกยกเลิกยังมีข้อผิดพลาดที่จำลองได้**

## งานแก้หลัง audit

เพิ่ม UTC raw SQL สำหรับ Lease/AI, atomic Post+AiJob และ periodic repair, ปลุก evaluation เมื่อ stale claim, แยกคำปฏิเสธคุณสมบัติ, durable Outbox พร้อม item receipts, bounded read-only reconciliation, rule-specific facts/draft validation, public CDN image download พร้อม DNS pinning/byte cap, streaming encrypted backup และ HTTPS PUT off-host destination, semantic input fingerprint, retention retry, fatal worker restart, progress health, single-flight Dashboard polling, bootstrap token/owner lock, session revocation และ CI แล้ว

ตรวจล่าสุด: 60 files / 516 tests ผ่านบนฐานทดสอบ ไม่มี skip; TypeScript และ lint ผ่าน ไม่ได้รัน migration กับ Production หรือส่ง Facebook จริง ต้องติดตั้ง Extension 1.10.0 และ migration ทั้งสองรุ่นใหม่ก่อนใช้งาน ข้อมูลธุรกิจของ AI ต้องกรอกเอง; confidence จากโมเดลยังไม่ใช่ calibrated accuracy และไม่รับประกันความจริงของคำตอบทุกประโยค

ก่อน rollout: หยุด worker ทุก host, backup, ตรวจเวลา Lease เก่าที่อาจคลาดเคลื่อน, migrate, build และเปิด Dry Run ก่อน Cloud backup ต้องตั้ง BACKUP_UPLOAD_URL และตรวจ restore ด้วย key เดิม เก็บ key offline; ไม่ได้ตั้ง storage ปลายทางหรือทดสอบ upload จริงให้ในรอบนี้ Load benchmark, restore drill บนข้อมูลจริง และการตรวจ DOM จริงยังต้องทำแยก ห้ามอ้างว่า tests สังเคราะห์รับรอง Production แล้ว
