# คุมคอมเมนต์จากหน้าเดียว — Extension 1.11.9

ตามคำสั่งเจ้าของ หลังจับคู่ device token แล้วส่วนขยายพร้อมรับงานตามกฎใน MY-BOT โดยอัตโนมัติ ยกเลิก checkbox อนุญาตคอมเมนต์ซ้ำใน popup และเลิกใช้ค่า browserCommentsEnabled เก่า ไม่มีการขอ Facebook Graph API permission การส่งยังเป็นการพิมพ์/กดปุ่มในหน้าที่บัญชีล็อกอินใช้งานได้จริง

เลือกบัญชี อุปกรณ์ กลุ่ม ข้อความ คำสำคัญ เวลา โควตา และเปิด–หยุดในหน้าคอมเมนต์อัตโนมัติ Server ยังคงตรวจ paired device, rule consent, pinned account/device, allowlist, revision/generation, quota และ grant อายุสั้นก่อนคลิก ห้ามตัด gate เหล่านี้เพื่อให้ extension ส่งอิสระจากกฎบนเว็บ

สวิตช์พักอ่านใน popup ตั้งแต่รุ่นนี้พักเฉพาะ collector การหยุดส่งใช้ Stop/Emergency Stop ในหน้าคอมเมนต์อัตโนมัติ หรือพักบัญชีบนเว็บ การรับงานจาก server เป็นการตัดสินใจอัตโนมัติของระบบ ไม่ใช่หน้าต่างขออนุญาตเจ้าของหรือ Facebook ทุกคอมเมนต์ สิทธิ์ host ของ Chrome เมื่อโหลดส่วนขยายและการล็อกอิน Facebook ยังต้องทำตามข้อกำหนดเบราว์เซอร์ ไม่ให้โปรแกรมอนุมัติแทน

รุ่นเก่าที่ checkbox local เคยปิดไว้ไม่ต้องเปิดใหม่ heartbeat ของ 1.11.9 รายงานความพร้อมจาก paired token และสถานะบัญชี ส่วนงาน journal ค้างยังบล็อกการส่งเพื่อรักษาผลที่คลุมเครือ ไม่ล้าง journal หรือ resend งานเก่าอัตโนมัติ

## การตรวจสอบ

`comment-worker.test.ts` ตรวจว่ารับงานจาก server ได้เมื่อค่า toggle เก่าเป็น false, ไม่รับด้วย legacy/unpaired token, account pause ยังบล็อก, collector pause ไม่เปลี่ยน server-controlled delivery และรักษาการ authorize ก่อน send/one-click/uncertain/no resend เช่นเดิม ชุดทดสอบทั้งหมดผ่าน 730 tests / 83 files กับ TEST_DATABASE_URL แยก Build cache เดิมทำให้ Next ล้ม; ย้าย generated .next ไป /tmp เพื่อสำรอง แล้ว clean build พบข้อจำกัดโหลดฟอนต์ใน sandbox จึง build พร้อม network จนผ่าน ไม่เปลี่ยน dependency หรือ secret เพื่อแก้

การทดสอบนี้ไม่ใช่หลักฐานว่าส่งคอมเมนต์ Facebook จริงสำเร็จ ผลส่งจริงต้องตรวจ browser_observed และ comment permalink งานทดสอบคำขายที่พบก่อนหน้านี้ถูก cancelled ก่อน authorize/dispatchedAt และไม่มีลิงก์ยืนยัน จึงยังไม่ถือว่าส่งสำเร็จ และไม่ส่งงานนั้นซ้ำเอง
