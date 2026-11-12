# แผนแก้ความเสถียรและประสิทธิภาพ Extension 1.11.31

เจ้าของอนุญาตให้แก้ทุกข้อจากผลประเมิน โดยรักษา flow และข้อมูลเดิม ดำเนินการใน workspace เดิมเพื่อไม่แยกงานแก้ไขที่ค้างอยู่ ไม่ commit หรือ deploy อัตโนมัติ

- [x] `content.js`, `parser.js`: pending แยกกลุ่มและ binding ของเซิร์ฟเวอร์/บัญชี; ACK เฉพาะข้อมูลชุดที่ส่งจริง; อ่าน article ที่เปลี่ยนไม่เกิน 12 ตัวต่อช่วง พร้อมสแกนซ่อมทุก 15 วินาที รองรับ Marketplace, virtualized DOM, เปลี่ยนกลุ่มระหว่างส่ง และ backpressure
- [x] `background.js`: ตรวจ binding อีกครั้งภายใน manual queue lock; จำกัดข้อมูลรับใหม่ด้วยงบพื้นที่รวม 8 MiB จากเพดาน 10 MiB อนุญาต promotion ของข้อมูลที่รับไว้แล้วถึง 9 MiB เพื่อเผื่อ ID และเหลือพื้นที่จริงอย่างน้อย 1 MiB สำหรับสถานะสำคัญ อนุญาตลดคิวเก่าที่เกินงบ ไม่ลบข้อมูลเพื่อเอาพื้นที่; ไม่เขียน outbox ทั้งก้อนเมื่อ promotion ไม่เปลี่ยนข้อมูล
- [x] `background.js`: แชร์ promise ของ heartbeat ก่อน await แรก คืน lock แม้ไม่มี token หรือ config ล้มเหลว
- [x] `tab-lifecycle.js`, `background.js`: เก็บแท็บพักที่กำลังจะใช้งานภายใน 90 วินาทีไม่เกิน 4 ตัว เลือกตามกำหนดใช้งานจริง คืนเฉพาะแท็บที่ยืนยัน durable recovery ครบแล้ว ภายใต้ lock เดิม; active/personal/comment tabs และ close retry ไม่เปลี่ยน นี่เป็นนโยบายจำกัดแท็บ ไม่ใช่ผลวัด RAM บน Windows จริง
- [x] รุ่น manifest/expected version เป็น 1.11.31 โดยคง minimum compatibility เดิม, เพิ่ม regression tests และตรวจ extension suites, `npm test -- --maxWorkers=2`, `npm run build`, independent diff review

ข้อกำหนดคงเดิม: transport ไม่เกิน 40 โพสต์, pending/seen มีขอบเขต, observedAt ไม่เปลี่ยนเมื่อ retry, ไม่เพิ่มสิทธิ์ Chrome, ไม่ส่งคอมเมนต์จริง, ไม่เปลี่ยน quota/consent/claim/authorize หรือค่า quiet

การพิสูจน์: ทดสอบให้ล้มเหลวก่อนแก้ในกรณีเปลี่ยนกลุ่มก่อน ACK, ส่ง binding ผิดเซิร์ฟเวอร์/บัญชี, quota ไบต์เต็มก่อนจำนวนชุดเต็ม, ไม่มี promotion แต่มี journal, heartbeat พร้อมกัน, mutation หนึ่ง article ไม่ parse ฟีดทั้งหมด และการคืนแท็บเมื่อ recovery ไม่ครบต้องถูกปฏิเสธ เพิ่มการทดสอบ binding เปลี่ยนขณะรอ lock และ backpressure หลายบริบทพร้อมการกลับมาระบายโดยไม่ลบของเก่า

## ขอบเขตข้อมูลและการใช้งานจริง

pending ก่อน ACK แยกเพดาน 300 ต่อบริบทเซิร์ฟเวอร์/บัญชี และรวมไม่เกิน 1,200 เพื่อให้บริบทเก่าที่ offline ไม่ขวางบัญชีใหม่ทันที เมื่อเต็มรวมจะพักรับเพิ่มโดยไม่ลบของเก่า ข้อมูลก่อน ACK ยังอยู่ในหน่วยความจำ content script; การรักษาข้ามกลุ่มแบบ SPA และการซ่อนแท็บไม่ใช่การรับรองว่าปิด Chrome/โหลด extension ใหม่ก่อน ACK แล้วข้อมูลส่วนนี้จะอยู่ หลัง ACK ใช้ journal/outbox ที่ durable ตามเดิม

ไม่มี migration คิวหรือ permission ใหม่ คิวเก่าและ batch/item IDs ที่มีอยู่ยังอ่านและส่งต่อได้ ไม่ได้เปิดงานคอมเมนต์จริง การนำไปใช้ต้องติดตั้ง extension รุ่น 1.11.31 คู่กับ server รุ่นนี้ และโหลดหน้า Facebook ครั้งถัดไปเพื่อใช้ content script ใหม่

## บันทึกตรวจทาน

ผู้ตรวจอิสระพบและยืนยันเพิ่ม 2 กรณีระหว่างพัฒนา: promotion ใกล้ 8 MiB ค้างเพราะเพิ่ม IDs และ pending เต็มจากบริบทเก่าขวางบัญชีใหม่ แก้ด้วย headroom เฉพาะ promotion และเพดานแยกบริบทพร้อมเพดานรวมตามข้างต้น ตรวจซ้ำและทดสอบ regression ผ่าน ไม่พบข้อระดับสูงหรือกลางที่ค้างอยู่ในเส้นทางที่ตรวจ

## ผลตรวจ

- ชุดทดสอบรวมผ่าน 905 รายการ ข้ามตามเงื่อนไข 136 รายการ (137 ไฟล์) ชุดท้ายเพิ่มเติมสำหรับ capture/parser/popup ผ่าน 26 รายการ และ queue lock ผ่าน 7 รายการ
- `npm run build` จบครบ มี warning เดิม `<img>` สองตำแหน่งและ `_now` ที่ไม่ได้ใช้หนึ่งตำแหน่ง ส่วน eslint ไฟล์ extension ที่แก้ไม่มี error มี unused warning เดิมสามตำแหน่ง
- Chromium แบบโปรไฟล์แยก sandbox เปิดและปิดเครือข่าย: หน้าแบบจำลอง 100 โพสต์ เปลี่ยนหนึ่งโพสต์ วัดสองรอบอ่านแบบเต็มใช้มัธยฐานประมาณ 1.1–1.3 ms ต่อครั้ง เทียบอ่านเฉพาะ article ที่เปลี่ยน 0.009–0.01 ms ต่อครั้ง (แต่ละตัวอย่างเฉลี่ย 100 calls, ใช้ 21 ตัวอย่าง) ผลนี้วัดเฉพาะ parser บน DOM สังเคราะห์ ไม่ใช่ความเร็วรวมของ Facebook หรือผลวัด RAM ของเครื่องเจ้าของ
- ตรวจ syntax ของ content/background และ diff whitespace ผ่าน ไม่มีการเปลี่ยน package dependencies, migration, secrets หรือการส่งคอมเมนต์จริง

วัด parser ซ้ำด้วย Chromium ที่ติดตั้งไว้สำหรับ Playwright โดยคง sandbox และบล็อกเครือข่าย:

```bash
node scripts/benchmark-extension-parser.mjs
```

ไม่ได้ทดสอบการเก็บข้อมูลหรือคอมเมนต์บนบัญชี Facebook จริง และไม่ได้ deploy งานนี้
