# ตรวจ Collector / Full text / Auto Comment บน Production

7 พฤศจิกายน 2026 รุ่น Extension 1.10.0 / master f25e366

## ผลยืนยัน

Production health มี worker.ok=true ฐานและ AI พร้อม Extension ออนไลน์ จับคู่ถูกต้อง หลัง reload Facebook แล้วรับ identity ได้ พบโพสต์ใหม่ 4 รายการจาก 2 กลุ่มในรอบที่สังเกต ทั้งหมดมี AiJob done ใช้ Groq; 3 รายการ textRevision=1 และ truncated=false แสดงว่ามีการปรับข้อความหลังรับครั้งแรก ไม่ยืนยันว่าข้อความครบตรง Facebook ทุกตัวอักษรหรือครบทุกโพสต์ในกลุ่ม

คอมเมนต์ยัง stopped + Dry Run, ทุกกฎปิด, local commentsEnabled=false และกฎเดิมชี้อุปกรณ์เก่า ไม่ได้เปลี่ยนค่าหรือส่งจริงในรอบนี้ จึงยังไม่มีผล end-to-end live comment ของรุ่นใหม่ ไม่ใช้ uncertain เก่าทดลองส่งซ้ำ

## ข้อพบและลำดับแก้

1. **P0 อ่านผิดโพสต์ได้จาก fallback** — extension/background.js readFullTexts เลือก post key ตรง URL ก่อน แต่ถ้าไม่พบกลับเลือกข้อความยาวสุดแล้วกำหนด URL เป้าหมายทับ อาจบันทึกข้อความจากโพสต์แนะนำเป็นโพสต์เป้าหมาย ต้องเอา fallback ออก เก็บเฉพาะ exact identity ไม่พบให้ failed/retry และเพิ่ม fixture หลาย article ในหน้าเดียว ยังไม่พิสูจน์ว่า 4 รายการจริงได้รับผลกระทบนี้
2. **P0 รอข้อความเต็มก่อนคอมเมนต์** — matching.ts ไม่มี truncated gate ข้อความส่วนท้ายอาจมีเงื่อนไขปฏิเสธหรือปิดการขาย เพิ่ม waiting_full_text และตรวจซ้ำทั้ง prepare/authorize ก่อนออก grant; ไม่พบฉบับเต็มภายใน deadline ให้ review/expired ไม่ส่งโดยเดา
3. **P1 งบเวลาอ่านกลุ่ม** — readFeed รอ growth หลายครั้งและ reload ทั้งรอบได้ ตามด้วย full text budget สูงสุด 90 วินาทีต่อกลุ่ม ทำให้กลุ่มอื่นรอ แยก feed discovery กับ full text queue กำหนด overall deadline ต่อกลุ่มและ fair scheduling; ทดสอบ timeout โดยไม่ปล่อย async task ทำต่อทับแท็บ
4. **P1 คุณภาพการเลื่อน** — รอบจริงเห็น 1–3 รายการและจบ end พร้อม coverage warning ยังไม่รับรองครบ ตรวจ scroll container/virtualized feed โดยเทียบ key ไม่ใช่ DOM count อย่างเดียว ไม่แก้ด้วยการเพิ่มจำนวน scroll โดยไม่มีหลักฐาน
5. **P1 ปลุก identity หลังติดตั้งใหม่** — หน้า Facebook ที่เปิดค้างต้อง reload จึงรู้จักบัญชี เพิ่มสถานะบอกเจ้าของและคำสั่ง refresh identity บนแท็บที่อนุญาต ไม่ย้าย cookie/session
6. **P1 เตรียมกฎและโหมดทดสอบ** — แสดง device mismatch และ local opt-in ที่ปิดก่อน Start ปัจจุบันกฎปิดและผูก device เก่า ต้องตั้งกฎ Dry Run กับอุปกรณ์ปัจจุบันและตัวอย่างจริงที่เจ้าของต้องการ ไม่เปิดทุกกฎหรือเปิดส่งย้อนหลังอัตโนมัติ
7. **P1 ทดสอบครบวงจร** — หลังแก้สอง P0 ให้ Dry Run ตั้งแต่ collector ถึงข้อความตามกฎ แล้วเจ้าของอนุมัติ post URL/ข้อความ/จำนวนสำหรับส่งจริงหนึ่งครั้ง ตรวจ comment permalink และ no duplicate หลัง reconnect จากนั้น soak test หลายรอบก่อนขยายกลุ่ม

## เกณฑ์รับงาน

ทุกข้อความผูก post key ถูกต้อง; truncated ไม่ได้รับ send grant; batch ที่ยืนยันรับมีสถานะติดตาม; กลุ่มหนึ่งช้าไม่หยุดกลุ่มอื่น; วัดเวลา discovery/full text/AI/queue แยกกัน; ไม่ส่งซ้ำเมื่อไม่ทราบผล ไม่ตั้งเป้าความครบ 100% ของ Facebook ที่เบราว์เซอร์ไม่แสดง

เอกสารนี้เป็นผลทดสอบและข้อเสนอ ยังไม่ได้แก้ runtime/deploy เพิ่มในรอบตรวจ

## ผลแก้ในรอบถัดมา

แก้ exact identity โดยเอา longest-post fallback ออก เพิ่ม full_text gate ที่ matcher ร่วมทั้ง scan/prepare/authorize และ waiting_full_text พร้อมนัดตรวจใหม่/fingerprint รวม truncated เพิ่มงบเวลา feed 60 วินาที (ตรวจระหว่างขั้นตอนที่ await จบ ไม่ใช่ hard cancellation), ลด full-text budget เหลือ 30 วินาที และลดการ reload ทั้งรอบเมื่อยังอ่านได้บางรายการ เพิ่มคำแนะนำ reload Facebook หลังติดตั้งใหม่ใน popup

Regression ผ่าน 61 files / 518 tests ไม่มี skip บนฐานทดสอบ ไม่ได้เปลี่ยนข้อมูล Production หรือส่งคอมเมนต์จริง การแยก discovery/full-text เป็น durable queue เต็มรูปแบบ, virtualized feed key-growth detection, readiness device mismatch และ soak/live-send test ยังไม่เสร็จ จึงไม่อ้างว่าปิดทุกข้อเสนอแล้ว ต้องพัฒนาต่อและทดสอบ Production หลังอัปเดตรุ่น

## ปิดงานปรับคิวในโค้ด

แยก discovery กับ durable fullTextBacklog แล้ว: discovery บันทึกรายการอ่านต่อใน Chrome storage และคืนแท็บก่อน; หลัง discovery จึงประมวลผลรายการถึงกำหนดแบบ oldest-first จำกัดสองรายการต่อกลุ่ม รักษา pause/token/origin check และ backoff งานล้มเหลว เพิ่มการตรวจ key ใหม่แม้ DOM count ไม่เพิ่ม และแสดงคำเตือน device/account mismatch ในหน้ากฎ

Tests ทั้งชุด 518 ผ่าน ก่อนเพิ่ม regression fairness อีกหนึ่งข้อ; regression full-text identity/fairness 2 ข้อผ่าน Lint ผ่าน การตรวจ key เป็นการปรับตัวอ่านเดิม ไม่ใช่หลักฐานว่าครอบคลุมทุก DOM Facebook ยังต้องวัด completeness และ soak test จริงหลัง deploy รอบนี้ไม่เปิดส่งจริง ไม่สร้างโพสต์ทดสอบบน Production และไม่อ้างว่าทดสอบ live comment ของรุ่นนี้แล้ว

ผลตรวจสุดท้ายก่อนนำขึ้น master: `test:ci` ผ่าน 61 files / 519 tests ไม่มี skip; Lint และ Build ผ่าน ใช้ฐานทดสอบแยก ไม่มี migration ใหม่ในรอบนี้ หลัง auto-deploy ต้องดาวน์โหลด Extension ชุดใหม่และ Reload แม้ manifest ยังใช้เวอร์ชัน 1.10.0 เดิม จึงควรยึด commit ของแพ็กเกจร่วมตรวจด้วย

## ปรับหลังวัดรอบ 80.7 วินาที

ลดงบ feed เป็น 45 วินาทีและคำนวณเวลารอแต่ละช่วงจาก remaining budget ลด growth wait และ nudge retry เหลือหนึ่งครั้ง คิวรายละเอียดมีงบรอบแยก 60 วินาทีและ backoff เมื่อรายการหนึ่งล้มเหลว โดยไม่หยุดรายการทั้งหมด เพิ่ม fullTextMetrics (tried/succeeded/failed/remaining/durationMs) ใน popup ขีดจำกัดเป็น cooperative ระหว่าง Chrome API ไม่ใช่ hard cancellation จึงไม่รับรอง wall clock ไม่เกินตัวเลขดังกล่าวเมื่อ API ค้าง

ทดสอบ 61 files / 519 tests ผ่าน ไม่มี skip; Lint ผ่าน ยังไม่ deploy หรือวัดเวลา Production ใหม่ในรอบนี้

## ปรับระบายคิวหลังพบ backlog 40

เพิ่มช่วงระบายคิวก่อน discovery เมื่อ backlog >=10 (สูงสุด 2 รายการ/งบ cooperative 20 วินาที), คงระบายหลัง discovery และหมุนแหล่งแบบ round-robin ตาม lastTriedAt แทนกินสองรายการจากกลุ่มแรกก่อนกลุ่มอื่น บันทึกเวลาเริ่มลองอ่านลง durable backlog ก่อนทำงาน ลดการ navigate URL เป้าหมายซ้ำโดยเริ่ม reader ที่ about:blank แล้วให้ readFullTexts นำทางครั้งเดียว

Strict regression 61 files / 519 tests ผ่าน ไม่มี skip และ Lint ผ่าน ยังไม่ deploy หรือรับรองว่าคิวจริงระบายทันอัตราเข้าจนกว่าจะวัดหลังอัปเดต คง exact post identity/full_text authorization gates ไม่ลดความปลอดภัยเพื่อเร่งส่ง

## การนับงานคิวให้ตรวจสอบได้

เพิ่ม problem=expired/retry_exhausted แทนกรองงานออกเงียบ ๆ รายการมีปัญหาไม่ถูก retry อัตโนมัติ เพิ่มตัวนับ overflow เมื่อเกิน 200 รายการ แจ้งเตือนให้ลดแหล่ง/ตรวจคิว เพิ่ม metrics review/oldestAgeMs และยอดสะสม tried/succeeded/failed ระดับติดตั้ง งานหมดอายุยังบล็อกการคอมเมนต์ด้วย full_text gate ตามเดิม ต้องตรวจเอง ไม่อ้างว่าระบายคิวได้ครบเพราะจำนวน pending ลดลง

Strict tests 61 files / 519 tests ผ่าน และ Lint ผ่าน ยังต้อง deploy และวัดคิวจริงก่อนรับรอง throughput

## แก้การรอท้ายรอบเมื่อคิวเริ่มว่าง

เพิ่ม detail slice หลัง discovery ทุกกลุ่ม สูงสุดหนึ่งรายการ/งบ cooperative 15 วินาที ตรวจ quiet ก่อนเริ่ม ใช้ fullTextBudget ร่วมทั้งรอบและ reader ทีละงาน ไม่ใช้ Promise.race ปล่อยงานเดิมนำทางต่อขณะเปิดกลุ่มใหม่ ยังคงข้อจำกัดว่า Chrome API ที่รออยู่ไม่ถูกยกเลิกกลางทาง จึงต้องวัด wall clock จริงหลัง deploy

เพิ่ม runnable VM regression ตรวจลำดับ feed:a → detail slice → feed:b → detail slice → tail queue Strict tests 61 files / 520 tests ผ่าน ไม่มี skip; Lint ผ่าน ไม่มีการแก้ Production หรือส่งคอมเมนต์จริงในรอบนี้
