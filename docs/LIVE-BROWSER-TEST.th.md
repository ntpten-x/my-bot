# ผลตรวจ Chrome กับ MY-BOT บน Render

วันที่: 6 พฤศจิกายน 2026

ตรวจผ่าน Chrome โปรไฟล์ทดสอบที่เจ้าของล็อกอินเองและติดตั้ง Extension เอง ใช้ CDP ที่จำกัด loopback อ่านหน้า/สถานะตามสิทธิ์ของบัญชี ไม่อ่านรหัสผ่านหรือ Cookie ทั้งชุด ไม่กดส่งคอมเมนต์ ไม่เรียก Facebook private API ไม่เก็บข้อมูลบัญชีส่วนตัวไว้ในรายงานนี้

## Verified จากระบบจริง

| รายการ | ผล |
| --- | --- |
| ควบคุม Chrome และอ่านหน้า MY-BOT | สำเร็จ |
| MY-BOT session | อ่าน API ที่ต้องล็อกอินได้ |
| Extension ที่ติดตั้ง | v1.9.0 จับคู่กับ HTTPS ของ Render สำเร็จ |
| Facebook | Extension รายงานล็อกอินแล้ว |
| `/api/v1/extension-config` | HTTP 200 เห็นรายการแหล่งที่เจ้าของเปิดไว้ |
| `/api/sources` | HTTP 200 เห็นแหล่งเปิด 6 แหล่ง แหล่งตัวอย่างปิดอยู่ |
| `/health` ของรุ่นที่ Deploy อยู่ | HTTP 200, DB ping ผ่าน, มี AI ที่ตั้งค่าไว้ |
| `/api/automation-readiness` | HTTP 503 |
| `/api/auto-comment` | HTTP 500 |
| รับโพสต์จาก Extension | พบ error HTTP 500 ระบุ `The column t0.textRevision does not exist in the current database.` |
| ส่งคอมเมนต์จริง | ไม่ได้ทดสอบ ไม่ได้กดส่ง |

สวิตช์รับงานคอมเมนต์บน Extension เปิดอยู่ตอนเริ่มตรวจ จึงปิดเฉพาะบนเครื่องนี้เพื่อกันการส่งจริงระหว่างทดสอบ ไม่มี journal งานส่งค้างในขณะตรวจ ไม่ได้เปลี่ยนกฎหรือ control บนเซิร์ฟเวอร์ ไม่ได้รัน migration ของ Production

## ข้อสรุปและขอบเขตหลักฐาน

Production ไม่มี `Post.textRevision` ที่โค้ดใหม่ต้องใช้ คอลัมน์นี้เพิ่มใน `20261109100000_security_stability` จึงยืนยันได้ว่า schema ไม่ตรงกับโค้ด ส่วนสาเหตุว่า migration ยัง pending, ชี้ฐานผิด หรือเกิด schema drift ต้องดู migration status/ฐานปลายทางจากสภาพแวดล้อม Production อีกครั้ง ยังไม่ยืนยันว่าตาราง Auto Comment ขาดรายการใด เพราะไม่มี direct database credential ในเครื่องทดสอบ

Health รุ่นปัจจุบันตรวจเพียงเชื่อมต่อ DB ได้ จึงยังเขียวแม้ ingest ใช้ไม่ได้ การอ่านกลุ่ม/ส่งข้อมูลถึงเซิร์ฟเวอร์เกิดขึ้นได้ แต่ยังทดสอบการบันทึกโพสต์ → AI → Dry Run ต่อให้ครบไม่ได้จนแก้ schema

ข้อมูลรอบอ่านเดิมบางกลุ่มมี `No current window` และสถิติเก่าประมาณหนึ่งวัน ไม่ใช้เป็นหลักฐานว่าเวอร์ชันปัจจุบันมีปัญหาเดียวกัน ยังต้องทดสอบรอบใหม่หลัง schema พร้อม

## การแก้ใน branch `fix/cloud-readiness`

ยังไม่ Commit/Push/Deploy และยังไม่ได้แทน Extension ที่ติดตั้งอยู่ใน Chrome

| ปัญหา | กลไกและการแก้ | หลักฐานทดสอบ |
| --- | --- | --- |
| Doctor รายงานไม่มี DATABASE_URL บน Render ทั้งที่ DB ใช้ได้ | `envFlags` เดิมอ่านเฉพาะ `.env`; แก้ให้ใช้ process environment โดยมี precedence เหนือไฟล์ | `doctor-cloud-env.test.ts` ก่อนแก้ FAIL หลังแก้ PASS |
| แบ่งส่งโพสต์ 50 แต่ API รับสูงสุด 40 | `scrapeGroup` ส่ง 50/50/20 สำหรับ 120 โพสต์ ทำให้ 2 คำขอถูกปฏิเสธ; แก้เป็น 40/40/40 โดยคง validator 40 | ทดสอบ function ของ Extension กับ route validator จริง ผ่านครบ 120 โพสต์ |
| กดพักแต่แท็บธรรมดายังส่งโพสต์ | `forwardManual` ไม่ตรวจ `cfg.paused`; เพิ่มการตรวจใน manual, task polling และ outbox flush | regression ยืนยันก่อนแก้ยังเรียก sendPosts หลังแก้ไม่เรียก |
| รายละเอียด DB exception หลุดกลับ client | ingest ส่ง `error.message` ตรง ๆ; เปลี่ยนเป็นข้อความคงที่และ safe code, schema error เป็น 503 ที่ retry ได้ | regression ตรวจไม่คืน synthetic sensitive message |
| Health แสดงพร้อมเมื่อ schema ไม่ครบ | เพิ่ม `schemaReadiness` ตรวจ critical columns/tables แบบอ่าน catalog เท่านั้น ใช้ใน Health, Doctor และ dashboard/readiness API | ฐานทดสอบจำลอง rename คอลัมน์/ตารางแล้วตรวจพบ แม้ SELECT 1 ผ่าน |

Extension ใน branch แก้ไขเป็น v1.9.1 การตรวจ schema นี้เป็นชุด field สำคัญที่กำหนดไว้ ไม่ใช่การตรวจทุก constraint/type หรือแทน `prisma migrate status`

## บันทึกการวินิจฉัย

1. ตัดสมมติฐาน Token ใช้ไม่ได้ด้วยการอ่าน config ผ่าน device token ได้ HTTP 200 โดยไม่เปิดเผย Token
2. ตัดสมมติฐาน DB ล่มทั้งระบบด้วย sources/health ที่ตอบและอ่านข้อมูลได้
3. ระบุ fail path จาก error ของ ingest ว่าขาด `Post.textRevision` แล้วเทียบ migration ใน repo ไม่อนุมานว่า CAPTCHA หรือ Facebook block
4. เพิ่ม regressions: ก่อนแก้ Doctor/batch/pause/redaction ล้มเหลว หลังแก้ผ่าน
5. ชุดเต็มครั้งแรกเชื่อมฐานทดสอบไม่ได้ เพราะ sandbox ปฏิเสธ socket 127.0.0.1; เปิด PostgreSQL ชั่วคราวนอก sandbox แล้วตรวจใหม่ ไม่มีการใช้ฐาน Production แทน

## ผลตรวจฉบับแก้ไข

- `TEST_DATABASE_URL=<localhost disposable DB> npm run test:ci`: **58 files, 463 tests passed, 0 failed, 0 skipped**
- `npm run lint`: **exit 0**
- `npm run build`: **exit 0** มี warning Prisma config deprecation เดิม
- `git diff --check`: **exit 0**

## ขั้นตอนที่ยังต้องทำ

1. เจ้าของเลือกว่าจะรัน migration เอง หรืออนุญาตให้ทำผ่าน Render หลังเจ้าของล็อกอินเอง ไม่มีการส่ง Credential ผ่านแชต
2. ตรวจฐานปลายทางและ backup ก่อน ดู migration status และ apply เฉพาะ migration ที่ขาด ถ้าระบุว่า applied แล้วแต่คอลัมน์ยังขาด ต้องตรวจ drift ก่อน ไม่ใช้ `db push`/reset/drop เพื่อแก้ลัด
3. เมื่อได้รับอนุญาตจึงเผยแพร่ patch นี้และโหลด Extension 1.9.1 ใหม่
4. ทดสอบหนึ่งแหล่งที่อนุญาต ตรวจ inserted/dedupe/AI แล้ว Start ใน Dry Run ตรวจข้อความ/อุปกรณ์/บัญชี
5. การกดส่งจริงต้องมีคำอนุมัติแยกและระบุกลุ่ม/โพสต์ทดสอบ สิทธิ์ในกลุ่มและข้อความให้ชัดเจน ขณะนี้ยังไม่รับรองว่า Auto Comment ใช้งานจริงสำเร็จ
