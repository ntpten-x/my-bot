# ผลประเมินการทำงานต่อเนื่อง MY-BOT วันที่ 10 พฤศจิกายน 2026

**ยังไม่ผ่านเป้าหมาย 9++ ทุกส่วน และยังไม่ควรรับรอง 10/10** โค้ดที่แก้ในรอบนี้อยู่ใน workspace ยังไม่ได้ deploy หรืออัปเดต Desktop ที่กำลังใช้งาน ฐานข้อมูลจริงยังขาด migration ของคิวโพสต์รุ่นใหม่ จึงยังไม่ได้เริ่ม worker รุ่นใหม่ การตรวจนี้ไม่ได้ส่งคอมเมนต์ Facebook ไม่รีเซ็ตงาน uncertain และไม่เปลี่ยนกฎ/โควตา/บัญชี

## หลักฐานจากระบบจริง

ตรวจแบบอ่านอย่างเดียวประมาณ 02:24 น. เวลาไทย โดยใช้ transaction แบบ READ ONLY สำหรับสถิติฐานข้อมูล ไม่อ่านข้อความโพสต์หรือข้อมูลลับ

| ส่วน | หลักฐาน | ผลประเมิน |
|---|---|---|
| ฐานข้อมูล | doctor เชื่อมต่อผ่าน แต่ขาด Post.processingState, Post.processingToken, Notification.dedupeKey | ยังนำโค้ดรุ่นใหม่ขึ้นทำงานไม่ได้ ต้อง migrate ก่อน |
| เว็บ | local 8001 ว่าง; Desktop ใช้ remote Render ซึ่ง health ตอบผ่าน | local ที่ไม่รันไม่ใช่ความเสียหายของ Desktop โหมด remote |
| Desktop/VNC | MYBOT-Desktop-V1 รันอยู่; VNC 5915 และ viewer 6095 ตอบผ่าน; webRestarts/desktopRestarts เป็น 0 | ยืนยันการตอบสนอง ณ จุดตรวจได้ ยังไม่ใช่ผล soak หลายวัน |
| สถานะส่วนประกอบ | components.json ระบุ running แต่เวลาเก่ากว่า 5 ชั่วโมง | ไม่มี heartbeat ยืนยันความสดของ component supervisor จึงแก้ในรอบนี้ |
| Extension | ออนไลน์ 1 เครื่อง รุ่น 1.11.25; workspace 1.11.26 | ต้องอัปเดตให้ตรงกันก่อนรับรองพฤติกรรมจากโค้ดชุดนี้ |
| ฟีดรุ่น 1.11.25 ใน 24 ชั่วโมง | 102 รอบ, inserted 76, errors 0; limit 92, yield 9, exhausted 1 | มีการเก็บโพสต์จริง แต่ยังวัด recall ไม่ได้; limit/yield เป็นการแบ่งงานต่อ ไม่เท่ากับข้อมูลหาย |
| คอมเมนต์ที่สร้างใน 24 ชั่วโมง | uncertain 9, cancelled 38; log dispatch 9, uncertain 9 | ยังไม่มีหลักฐานยืนยันผลส่งสำเร็จของชุดนี้ ต้องตรวจประวัติงานคลุมเครือ ห้ามลองส่งซ้ำเอง |

จำนวน log `observed` ทั่วไปไม่ใช่ `browser_observed` จึงห้ามใช้แทนจำนวนคอมเมนต์ที่ยืนยันบนหน้า Facebook ส่วน `fullTried/fullOk=0` ใน ScrapeRun ไม่พิสูจน์ว่า full-text ไม่ทำงาน เพราะ runtime แยกงานดังกล่าวและเก็บ fullTextMetrics/fullTextTotals ต่างหาก

## การแก้ไขและหลักฐานทดสอบ

| Finding | Evidence | Path / การแก้ไข |
|---|---|---|
| extension ออฟไลน์แล้วสถานะโพสต์กลับเป็น ok อาจแจ้ง recovered ผิด | regression จำลองไม่มีโพสต์ 7 ชั่วโมงแล้ว heartbeat หาย; ตรวจว่าไม่สร้าง recovered และไม่เปลี่ยน lastOkAt | `src/lib/watchdog.ts`: ใช้ warn เมื่อยืนยันไม่ได้, off เมื่อเจ้าของพัก; ปฏิเสธ heartbeat จากอนาคต |
| รายงานว่าข้อมูลครบทั้งที่ขาดชื่อ/ข้อความบางส่วน หรือมีตัวอย่างไม่พอ | ตรวจ assessWatch ด้วยตัวอย่างน้อยกว่า 10 และข้อมูลขาดจริง | แสดงจำนวนขาดตามจริง และ warn เมื่อตัวอย่างไม่พอ |
| supervisor เชื่อสถานะเก่าและพอร์ตที่เปิดโดยไม่มีหลักฐานว่าส่วนประกอบยังรายงาน | ทดสอบข้อมูล null, session ผิด, อายุ 60 วินาที, เวลาอนาคต, Browser review และ phase degraded | `scripts/lib/workstation.mjs`, `scripts/start-workstation.mjs`: ต้องมีรายงานสดจาก session ปัจจุบันและส่วนประกอบหลักครบ จึงถือว่าปกติ |
| component report ถูกเขียนเฉพาะตอนเริ่ม/หยุด และอ่านกลางการเขียนได้ | ตรวจเส้นทาง recordComponent → writeFile และข้อมูลจริงอายุเกิน 5 ชั่วโมง | `scripts/start-bot-desktop.mjs`: heartbeat ทุก 15 วินาที, เขียนไฟล์ชั่วคราวแล้ว rename, บันทึก stopped ตอน shutdown |
| สถิติ soak วัดคิว AI เดิม แต่ไม่วัดงาน rules-only ที่ใช้จริง | ตรวจ producer `src/lib/post-processing.ts` ซึ่งใช้ pending_new/pending_edit และ claim token | `scripts/observe-automation.mjs`: เพิ่ม processing.pending/running/oldestPendingSeconds และค่าสูงสุด; running นับเฉพาะ claim ยังไม่หมดอายุ; เก็บ ai เดิมเพื่ออ่านรายงานย้อนหลัง |

ไม่เพิ่มระบบ restart Chrome อัตโนมัติเมื่อเกิดความคลุมเครือ การกู้คืน viewer/window manager เดิมยังคง backoff และจำกัดจำนวนครั้ง การตรวจ heartbeat ยืนยันความสดของ supervisor และสถานะโปรเซสที่รายงาน ไม่ใช่การยืนยันว่า Chrome DOM หรือ Facebook network ไม่ค้าง

## สิ่งที่ต้องทำก่อนรับรอง 9++

1. ประสานหยุดโฮสต์ที่ใช้ฐานร่วมกันตามขั้นตอนอัปเดต ตรวจ backup และ migration ที่ค้าง แล้ว migrate เพียงครั้งเดียว ก่อน deploy/restart โค้ดใหม่ ห้ามเปิด worker รุ่นใหม่บน schema เก่า
2. อัปเดต extension/Desktop จาก artifact เดียวกัน ตรวจ pairing/pause เดิมยังอยู่, version ตรง และ heartbeat สด ไม่ล้างโปรไฟล์หรือคิว pending
3. ตรวจ uncertain 9 งานกับประวัติจริง ไม่ reset/retry อัตโนมัติ การส่งทดสอบจริงต้องได้รับอนุมัติแยกตาม AGENTS.md
4. หลังอัปเดต รัน `npm run doctor` ให้ไม่มี FAIL แล้วเก็บ `npm run observe:automation -- --hours=24 --interval-seconds=60` ต่อเนื่อง 24–72 ชั่วโมง ตรวจ sampling gaps, backlog, pending age, tab growth และเหตุการณ์กู้คืน การครบเวลาสังเกตไม่ใช่การผ่านเกณฑ์อัตโนมัติ
5. วัดความครบของฟีดจากชุดโพสต์ที่เจ้าของตรวจเอง และ precision/recall ของกฎจากตัวอย่างจริง แยก observed-to-ingest ออกจาก publish-to-capture ไม่มีข้อมูลชุดนี้จึงยังให้คะแนนความแม่นยำไม่ได้

บอทปัจจุบันตัดสินใจด้วยกฎ คำสำคัญ คะแนน และแม่แบบ สามารถทำงานตามกฎและกู้คืนบางความขัดข้องเอง แต่ไม่ได้เรียนรู้กฎใหม่เอง การเพิ่มการเรียนรู้อัตโนมัติควรเริ่มจากชุดข้อมูลที่เจ้าของตรวจและการวัดผลย้อนหลัง ก่อนให้เปลี่ยนกฎที่ส่งข้อความจริง

## การตรวจสอบโค้ด

- ชุดทดสอบทั่วไปหลังแก้: 809 ผ่าน, 139 ข้ามเพราะไม่มี TEST_DATABASE_URL/ข้อจำกัดแพลตฟอร์ม
- production build ผ่าน; syntax check ของ runtime ที่แก้และ git diff --check ผ่าน
- integration tests โดยกำหนด TEST_DATABASE_URL เฉพาะ PostgreSQL ทดสอบบน loopback: ผ่าน 940 กรณี ข้าม 8 ตามแพลตฟอร์ม/เครื่องมือ, 118 test files ผ่านและ 2 ข้าม ไม่มี failure (152.61 วินาที) รวมกรณีวัด backlog จริงใน transaction แบบ read-only
- `npx.cmd tsc --noEmit` ผ่าน; ปิดฐาน PostgreSQL ทดสอบหลังตรวจเสร็จ

ไม่ได้ commit, push, deploy, migration ฐานจริง หรือ restart Desktop ที่กำลังใช้งาน การแก้ในเอกสารนี้จึงยังไม่ใช่พฤติกรรมของระบบ production
