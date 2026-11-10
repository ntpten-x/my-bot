# ผลตรวจและปรับปรุงความเสถียร MY-BOT — 11 พฤศจิกายน 2026

## ขอบเขตและเกณฑ์

ตรวจตามโค้ดปัจจุบันที่เป็นบอทตามกฎและข้อความสำเร็จรูป ครอบคลุม Extension, คิวโพสต์, Worker, คอมเมนต์ และ Desktop/VNC รักษางานเดิมที่ยังไม่ commit ไม่เปลี่ยนฐานจริง โควตา ความยินยอม หรือสถานะ Start/Stop และไม่ส่งคอมเมนต์ Facebook จริง

คะแนน 9++/10 ของการใช้งานจริงยังรับรองไม่ได้จาก unit tests หรือ doctor เพียงอย่างเดียว ต้องมีหลักฐานการเก็บโพสต์เทียบตัวอย่างจริง การรับส่งเมื่อเครือข่ายสะดุด และการสังเกตเครื่องใช้งานอย่างน้อย 24–72 ชั่วโมง แยกผลโค้ดที่ทดสอบผ่านออกจากผลที่ยังไม่ทราบ

## แผนการแก้

ใช้โครงสร้างและ dependency เดิม แก้เฉพาะกลไกที่ทำซ้ำปัญหาได้ พร้อม regression ก่อนและหลังแก้:

1. เก็บ rejected/expired outbox ผ่าน MV3 restart โดยไม่ลบทิ้งเงียบ ๆ หรือส่งซ้ำงานที่ต้องตรวจ
2. แยกโพสต์ยาวเกินขอบเขต API ให้ตรวจต่างหาก ไม่ให้ขวางโพสต์ปกติทั้งชุด และเก็บต้นฉบับเต็ม
3. ครอบ timeout ถึงการอ่าน response body, ยกเลิก stream และจำกัดขนาดข้อมูลที่รับ
4. ครอบการดาวน์โหลดรูป/JSON ของคอมเมนต์และคืนล็อกเมื่อหมดเวลา คง journal และไม่ retry การส่งที่ไม่ชัดเจน
5. เลือกเฉพาะกฎที่เปิดและไม่ถูกพักก่อนแบ่งหน้าคิวคอมเมนต์ คงการตรวจสุดท้ายใต้ control lock
6. รักษาข้อความที่ API รับได้ครบ เพื่อไม่ซ่อนคำยกเว้นท้ายโพสต์ และ fail closed ถ้าจำเป็นต้องตัดข้อความ
7. ให้คำสั่ง Resume ของเจ้าของปลุกเฉพาะ VNC/viewer/Openbox ที่หยุดหลังครบ retry โดยผูก session/nonce และไม่เปิด Chromium ใหม่
8. ให้ Desktop Open/Status ใช้เกณฑ์ความพร้อมเดียวกัน และจัดคำสั่ง Stop/Resume ไม่ให้เขียนทับกัน

ไม่เพิ่มระบบแก้โค้ดตัวเอง เปลี่ยนกฎส่งข้อความเอง หรือเปิด AI กลับ การเรียนรู้จาก feedback เดิมช่วยปรับน้ำหนักลีดและเสนอคีย์เวิร์ด แต่การเปลี่ยนเงื่อนไขส่งจริงยังอยู่ในการควบคุมของเจ้าของ

## หลักฐานเริ่มต้น

- ชุดทดสอบบน Windows ก่อนแก้: 823 ผ่าน, 3 ล้มเหลว, 139 ข้าม (123 files) สามข้อที่ล้มเหลวคือ harness ของ `full-text-identity` ไม่ได้ประกาศ dependency ที่ runtime เพิ่มแล้ว
- WSL Node เริ่ม Vitest ไม่ได้ เพราะ `node_modules` มี native bindings ของ Windows ใช้ Node บน Windows ที่ติดตั้งอยู่แล้วแทน ไม่ติดตั้งเพิ่ม
- `doctor` ผ่าน 9 รายการ ไม่มี FAIL/WARN: Node, dependencies, DATABASE_URL, PORT, Discord configuration, database, local web, extension token และ database schema
- ฐาน regression ใช้ PostgreSQL 15 ที่ติดตั้งอยู่แล้ว เปิด cluster ชั่วคราวบน loopback พอร์ตแยกภายใต้ `data/audit-test-postgres/` ใช้ `TEST_DATABASE_URL` สังเคราะห์ ไม่ใช้ฐานจริง

## เกณฑ์ตรวจรับการทำงานจริง

- ดึงฟีด: เทียบโพสต์ที่เห็นจริงกับรายการที่รับเข้าในแต่ละแหล่ง วัดการเก็บครบและช่วงเวลาที่ค้าง ไม่ใช้เวลา capture-to-ingest แทนเวลา publish-to-capture
- คิว: network outage และ MV3 restart ต้องไม่ลบ pending ที่ยังไม่ยืนยันรับ; problem rows ต้องแสดงให้ตรวจ; ข้อมูลที่เก็บไม่ได้ต้องไม่รับรองว่าเก็บแล้ว
- คอมเมนต์: ตรวจ consent, กลุ่ม, device/account, revision, โควตา และ generation ซ้ำก่อนส่ง; uncertain ต้องไม่ส่งซ้ำเอง; การทดสอบส่งจริงต้องได้รับอนุมัติแยก
- Desktop: viewer ขัดข้องต้องกู้ตามขอบเขต; Resume ไม่เพิ่ม Chromium/Xvfb; เบราว์เซอร์หรือ display หายต้องให้เจ้าของตรวจ
- ความต่อเนื่อง: เก็บ sample รุ่นเดียวกับ runtime อย่างน้อย 24–72 ชั่วโมง พร้อมรายงานช่องว่าง ข้อผิดพลาด pending age และ overdue sources; ไม่มี sample ถือว่ายังไม่ทราบ

## ผลหลังแก้

โค้ดรอบนี้เป็น Extension **1.11.30** และ Desktop **0.1.6-preview** ผลตรวจในรายงานบันทึกก่อนเผยแพร่และก่อนติดตั้งแทน runtime ของเจ้าของ การ commit/push ไป master เป็นขั้นตอนเผยแพร่ภายหลังตามคำสั่งเจ้าของ ไม่มี migration และไม่ได้เปิดคอมเมนต์

| การตรวจ | ผล | หลักฐาน |
| --- | --- | --- |
| Vitest ทุกชุด รวม PostgreSQL แยก | PASS — 986 ผ่าน / 0 ล้มเหลว / 8 ข้าม, 127 files | `data/audit-test-postgres/reliability-20261111/full-suite-final.json` |
| Production build | PASS — Prisma generate, compile, type check และ static pages 31/31 | `data/audit-test-postgres/reliability-20261111/build-final.log` |
| Web + Worker + API ใน production build จริง | PASS — 11 checks | `data/audit-test-postgres/reliability-20261111/production-smoke.json` |
| Chrome จริง หน้า DOM สังเคราะห์ | PASS — 6 โพสต์, virtualized growth, nested scroll และ scoped loaders; ไม่มี page error | `data/audit-test-postgres/reliability-20261111/browser-smoke.json` |
| Linux standalone equivalents ของ 8 ข้อที่ Windows ข้าม | PASS 7 / FAIL ด้าน environment 1 | `/tmp/mybot-linux-acceptance-20261111.json` |
| ZIP Extension และ Desktop | PASS — ตรวจ ZIP integrity และไม่มีพาธ credential/profile | `data/audit-test-postgres/reliability-20261111/packages.json` |
| กฎจัดประเภทกับตัวอย่างสังเคราะห์ | 19/20 — ไม่ใช่ความแม่นยำข้อมูลจริง | `npm run evaluate:classifier` |

Production smoke ใช้ schema `test_*` แยกและลบทิ้งหลังตรวจ เปิดเว็บ/worker บนพอร์ตชั่วคราว ตรวจ health, authentication, receipt ของ ingest, ประมวลผลด้วย rules, dedupe เมื่อส่งซ้ำ และยืนยันว่าไม่มี AiJob หรือคอมเมนต์ที่ไม่ได้อนุมัติ จากนั้นปิดเฉพาะ process ที่สร้างเองและปิด PostgreSQL ทดสอบแล้ว

แปดข้อที่ข้ามใน Windows เป็นข้อเฉพาะ Linux ไม่ใช่การข้าม DB tests รอบสุดท้ายได้รัน DB tests แล้ว Linux ตรวจจริงเพิ่มได้ 7 ข้อ: profile ownership/locks, atomic release switch, installer lock, missing remote config, supervisor remote mode และการปฏิเสธรหัส VNC จำลองผิดขนาด อีกหนึ่งข้อยังตรวจการเข้ารหัสรหัส VNC ไม่ได้เพราะ WSL ของ agent ไม่มี `libvncserver` ไม่ได้ติดตั้งเพิ่ม และไม่ได้สรุปว่า Desktop ปลายทางมีปัญหาเดียวกัน

Build ยังมีคำเตือนเดิมเรื่อง `package.json#prisma`, `<img>` สองแห่ง และตัวแปร `_now` ที่ไม่ได้ใช้ อีกหนึ่งคำเตือนเรื่องหลาย lockfiles เกิดจาก build ในสำเนาแยกใต้ workspace ไม่มี compile/type error ไม่แก้ UI หรือ dependency นอกขอบเขตเพื่อซ่อนคำเตือน

มีการแก้ test fixture เดิมสองส่วน: dependency ของ cycle harness และข้อมูลคอมเมนต์รอคิวที่ใช้ postId ไม่ตรงเป้าหมาย/คาดหวัง claim ก่อนพ้น cooldown ทดสอบใหม่ยืนยัน cooldown และ target checks จริง ไม่ลดข้อกำหนด runtime เพื่อให้เทสต์ผ่าน

## สิ่งที่ตรวจพบในระบบที่ใช้งานอยู่

การอ่านสถิติรวมย้อนหลัง 24 ชั่วโมง ณ 11 พฤศจิกายน เวลาประมาณ 00:33 น. (Asia/Bangkok) ได้ผลดังนี้ โดยไม่เปลี่ยนข้อมูล:

- เปิดแหล่ง Facebook/Marketplace 4 แหล่ง และมีโพสต์ที่สร้างในฐานรวม 407 รายการจากทุกแหล่งในช่วงนั้น
- รอบ Extension 1.11.29 มี 16 รอบ, บันทึกใหม่ 52 รายการ, recorded error 0 แต่ไม่ได้พิสูจน์ว่าเก็บครบทุกโพสต์
- มี heartbeat รุ่น 1.11.29 สดสองอุปกรณ์; outbox ตาม heartbeat เป็น 0 กับ 2 ชุด
- Worker มี tick ล่าสุด ขณะอ่านข้อมูล comment control เป็น `stopped`
- งานคอมเมนต์ที่สร้างในช่วงนั้นมี `uncertain` 2 และ `cancelled` 5; ไม่ล้าง journal ไม่ reset งาน และไม่สั่งส่งซ้ำ
- ข้อมูลย้อนหลังมีหลายรุ่นปนกันและแถว error ที่ไม่ระบุรุ่น จึงไม่นำไปอ้างเป็น uptime หรืออัตราสำเร็จของรุ่น 1.11.30

หลักฐานรวมอยู่ที่ `data/audit-test-postgres/reliability-20261111/runtime-observation.json` ส่วน observation รุ่นใหม่หนึ่ง sample ยาวเพียงประมาณ 1.4 วินาที จึงรายงาน `coverageComplete=false` ถูกต้อง ไม่มี heartbeat 1.11.30 เพราะยังไม่ได้อัปเดตอุปกรณ์จริง

## ประเมินเป้าหมาย 9++/10

| ส่วน | สิ่งที่ยืนยันได้หลังแก้ | สิ่งที่ยังขาดก่อนรับรอง 9++ ในงานจริง |
| --- | --- | --- |
| ดึงฟีดและรับโพสต์ | regression, Chrome สังเคราะห์ และ API/Worker integration ผ่าน | ground truth ของกลุ่มจริง, capture recall, pending age และ soak ของรุ่นใหม่ |
| คอมเมนต์ | DB fencing, cooldown, consent, fairness, journal และ timeout ผ่าน | ตรวจสองงาน uncertain, owner-approved acceptance และผลสังเกตหลายวัน |
| Extension ต่อเนื่อง | รักษาคิวผ่าน restart, กั้น poison batch, จำกัดเวลา/ขนาด stream | MV3/Chrome restart และ network outage บนเครื่องเจ้าของหลังอัปเดต |
| Desktop/VNC | manual component recovery, Stop priority, readiness และ ownership ผ่าน | native VNC crypto, pristine Windows และ viewer/desktop soak จริง |
| ความฉลาดของกฎ | ใช้ feedback/preference เดิมและจัดประเภทตัวอย่างได้ 19/20 | ชุดโพสต์จริงที่เจ้าของตรวจป้ายคำตอบ เพื่อวัด precision/recall แยก intent และกลุ่ม |

จึงยังไม่รับรองว่า “ทุกส่วน 9++ หรือ 10/10” การให้คะแนนดังกล่าวตอนนี้จะเกินหลักฐาน การแก้รอบนี้เพิ่มความสามารถกู้คืนเองและลดการค้าง/สูญหาย โดยไม่ทำให้บอทเปลี่ยนข้อความ โควตา ความยินยอม หรือเงื่อนไขส่งจริงเอง

## การนำไปใช้และตรวจต่อ

1. ตรวจ diff ร่วมกับงานเดิมที่ยังไม่ commit; อัปเดตเว็บ/worker เป็น build เดียวกันหลังผ่านกระบวนการ release ของเจ้าของ ไม่มี migration ใหม่
2. อัปเดต Extension 1.11.30 และ Desktop 0.1.6-preview โดยรักษาโปรไฟล์ pairing และ pause เดิม ห้ามถอน distro หรือเปิดส่งแทนเจ้าของ
3. ตรวจ doctor และ heartbeat รุ่นใหม่ทุกอุปกรณ์; ตรวจ pending/problem rows และงาน uncertain จากหน้าควบคุม ไม่ลบเพื่อให้ไฟเขียว
4. รัน `npm run observe:automation -- --hours=24 --interval-seconds=60` สำหรับ read-only soak แล้วขยายเป็น 72 ชั่วโมง พร้อมเทียบโพสต์ตัวอย่างของแต่ละแหล่ง
5. การตรวจส่ง Facebook จริงต้องอนุมัติแยกก่อน เริ่มด้วย acceptance ที่เจ้าของตรวจเป้าหมายและข้อความแล้ว คงโควตาเดิม และหยุดตรวจทันทีเมื่อผลไม่ชัดเจน

แพ็กเกจที่สร้างไว้ให้ตรวจมี public origin `https://my-bot-e6bt.onrender.com` เท่านั้น ไม่รวม `.env`, browser profile, token หรือ pairing code และยังคงป้าย preview ของ Desktop
