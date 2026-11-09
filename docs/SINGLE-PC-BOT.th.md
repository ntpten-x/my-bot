# เครื่องเดียว: จอเสมือนสำหรับเบราว์เซอร์บอทใน WSL2

## แนวทางของเครื่องนี้

เครื่องเจ้าของใช้ Windows 11 Pro, RAM 32 GB และมี WSL2 อยู่แล้ว การตรวจ/ลองเปิด Hyper-V เพิ่มคืนข้อผิดพลาด `Feature name Microsoft-Hyper-V is unknown` จึงหยุดแนวทางสร้าง VM ใหม่ ไม่รีสตาร์ตหรือฝืนแก้ส่วนประกอบ Windows

ใช้ **จอเสมือน Xvfb + Openbox ใน WSL2** ให้ Chromium แบบมีหน้าจอปกติและส่วนขยายทำงานในจอนั้น เจ้าของดู/ควบคุมผ่าน noVNC บน Windows เมื่อต้องล็อกอินหรือตรวจสอบ แล้วปิดหรือย่อหน้าต่าง viewer ได้ โดยจอเสมือนยังอยู่ เบราว์เซอร์ไม่ได้รันแบบ headless และไม่ได้ปลอม DOM visibility; ไม่ปิด browser sandbox ไม่เปลี่ยน audio devices/OS sound settings

เว็บใช้การติดตั้งใน WSL เดิม ส่วน worker ใช้โฮสต์หลักที่มีอยู่ (เช่น Render) ไม่สร้าง worker อีกตัว `http://localhost:8001` จาก Chromium ใน WSL จึงชี้แอปเดิมได้ ไม่ต้องเปิด HTTP ผ่าน IP หรือนำ device token ออกนอก localhost หากใช้เว็บบนโฮสต์อื่นต้องใช้ HTTPS ตามเดิม

## การติดตั้งครั้งแรก

รันใน terminal **WSL** ที่โฟลเดอร์โครงการ:

```sh
sudo apt-get install --no-install-recommends chromium chromium-sandbox xvfb xauth x11-utils x11-xserver-utils openbox x11vnc novnc websockify util-linux
npm run browser:desktop -- --check
npm run browser:desktop -- --password-window
```

คำสั่งสุดท้ายเปิดหน้าต่าง Windows ให้เจ้าของตั้งรหัส viewer แบบซ่อนอักขระด้วยตนเอง (8 ตัวอักษร ASCII) หากใช้ Linux ที่ไม่มี Windows ให้ใช้ `--password` ใน terminal ไม่ส่งรหัสนั้นในแชต ไม่ใช้รหัส Facebook ซ้ำ x11vnc ใช้ VNC authentication แบบเดิมซึ่งจำกัดอักขระที่มีผล จึงใช้เฉพาะ loopback ของเครื่องเดียว ไม่เปิดพอร์ตสู่ LAN/อินเทอร์เน็ต ไม่ใช้ `portproxy` หรือ tunnel สาธารณะ

เริ่มจอเสมือน:

```sh
npm run browser:desktop
```

เปิด **http://localhost:6085/vnc.html?host=localhost&port=6085&resize=scale** บน Windows แล้วกด Connect ใส่รหัส viewer จะเห็นเบราว์เซอร์บอท จอควบคุมนี้ไม่ใช่แท็บ Facebook ที่บอทอ่านโดยตรง จึงย่อ/ปิด viewer ได้เมื่อเตรียมเสร็จ แต่ต้องเปิดโปรเซสจอเสมือนและ WSL ไว้

หากเว็บอยู่ HTTPS โฮสต์อื่น:

```sh
npm run browser:desktop -- --url https://your-mybot.example
```

ไม่ต้องเปิด `npm run browser:bot` ซ้อน โปรไฟล์จอเสมือนแยกไว้ที่ `data/desktop-browser-profile/` การปิด viewer ไม่ปิดเบราว์เซอร์หรือคำสั่ง WSL

## ตั้งบัญชีและส่วนขยาย

1. ใน viewer ล็อกอิน Facebook ด้วยตนเองและจัดการ checkpoint หากมี
2. เปิด `chrome://extensions` ใน Chromium ของบอท → Developer mode → Load unpacked → เลือกโฟลเดอร์ `extension/` ของโครงการใน WSL
3. เข้า MY-BOT บน viewer แล้วใช้ pairing code จับคู่เป็นอุปกรณ์ใหม่ ต้องใช้เว็บและส่วนขยายที่อัปเดตรองรับเวอร์ชันตรงกัน ไม่คัดลอก cookies หรือ token จาก Chrome บน Windows
4. ตรวจภาพรวมระบบว่าอุปกรณ์และบัญชี Facebook นี้ออนไลน์ ทดสอบอ่านอย่างเดียวก่อน พักส่วนขยายเดิมหากไม่ต้องการอ่านซ้อน
5. เมื่อตรวจรับแล้ว ให้เจ้าของเลือกอุปกรณ์ใหม่นี้ในบัญชี/กฎที่ต้องการด้วยตนเอง ระบบไม่ย้ายสิทธิ์หรือเปิดส่งคอมเมนต์แทนเจ้าของ

## การทำงานและการหยุด

- ให้ Windows และ WSL ตื่นอยู่ ไม่สั่ง `wsl --shutdown` ไม่ปิด terminal ของตัว supervisor และไม่ให้เครื่อง sleep การย่อ Chrome ฝั่ง Windowsหรือ viewer ไม่ปิด Xvfb
- ภายในจอเสมือน **อย่าย่อ Chromium หรือหน้าต่างบอท** เพราะยังมีข้อจำกัดเมื่อย่อหน้าต่างของเบราว์เซอร์เอง เพิ่ม Facebook/MY-BOT ใน Always keep these sites active ตามคู่มือ Chrome เพื่อลดการ discard
- ตัว supervisor จอง display `:93`, VNC loopback `5905`, noVNC loopback `6085` หากถูกใช้อยู่จะหยุดโดยไม่ปิดโปรเซสอื่น `flock` ป้องกันเปิด supervisor ซ้อน
- แต่ละโปรเซสทำงานในกลุ่มที่ supervisor สร้างไว้ หาก viewer หรือ window manager หยุด จะลองกู้เฉพาะส่วนนั้นสูงสุด 5 ครั้งโดยไม่ปิด Chromium หาก Chromium หรือ Xvfb หยุด จะหยุดชุดจอเสมือนและให้ตรวจสอบก่อนเปิดใหม่ ไม่ restart browser กลางงานส่งคลุมเครืออัตโนมัติ
- ก่อนหยุด ให้พักงานตามปกติและตรวจงานที่กำลังส่ง จากนั้น `Ctrl+C` ใน terminal ของ supervisor จะปิดเฉพาะชุดจอเสมือนนี้ ไม่ปิดเว็บ/worker หรือ Chrome ส่วนตัว ไม่รับประกันยกเลิก click ที่ได้รับ grant ไปแล้วทันที
- `data/bot-desktop/` มี Xauthority และรหัส VNC ส่วน `data/desktop-browser-profile/` มี login/device token ทั้งคู่ถูก gitignore ห้ามพิมพ์รหัสลง logs/แชต หรือรวมในแบ็กอัปทั่วไป

## ตรวจรับและข้อจำกัด

ทดสอบการอ่านอย่างเดียวอย่างน้อย 30 นาที มีทั้งโพสต์ใหม่และย้อนหลัง ระหว่างนั้นย่อ/ปิด viewer และย่อ Chrome บน Windows ตรวจ **จำนวนโพสต์ที่ได้รับจริงและความคืบหน้าการอ่าน** ควบคู่ heartbeat/outbox ไม่ใช้ heartbeat อย่างเดียวเป็นหลักฐานว่า Facebook ยังโหลดได้

การย้ายจอไม่ได้ทำให้เครือข่ายเร็วขึ้นหรือยกเลิกการจำกัดบัญชีของ Facebook เครื่องที่เปิดเกม/AI หนักยังต้องเผื่อ RAM/CPU ให้บอท กลไกคิว/quotas/checkpoint/ห้ามส่งซ้ำเมื่อผลคลุมเครือยังคงเดิม การตั้งค่าสภาพแวดล้อมไม่ถือเป็นอนุมัติส่งคอมเมนต์จริง

อ้างอิง: [Xvfb virtual framebuffer](https://www.x.org/docs/man/man.pdf), [x11vnc options](https://github.com/LibVNC/x11vnc/blob/master/doc/OPTIONS.md), [Chrome memory/energy saving](https://developer.chrome.com/blog/memory-and-energy-saver-mode)

## ผลตรวจรอบติดตั้ง

ติดตั้ง Chromium 150 พร้อม sandbox, Openbox, x11vnc, noVNC/websockify และ xset ใน WSL แล้ว ไม่อัปเกรดหรือลบแพ็กเกจเดิม ไม่รีสตาร์ต Windows ตัวตรวจ dependency ผ่าน ยังต้องตั้งรหัส viewer ด้วยตนเองก่อนเปิด supervisor

`npm test` ผ่าน 713 tests / 80 files ด้วย Postgres ทดสอบแยก และ `npm run build` ผ่าน การทดสอบเบราว์เซอร์จริงใช้ Xvfb display แยกและหน้า DOM สังเคราะห์เท่านั้น หลังใช้คำสั่งเปิดแท็บตามปกติ (ไม่ spoof focus/visibility) ผ่าน 30 วินาทีโดยไม่มี viewer: `visible`, `hasFocus=true`, timer 30 ครั้ง, เลื่อน 750 px แล้วปิดโปรเซสและลบโปรไฟล์ทดสอบ ไม่มีการใช้บัญชี Facebook หรือส่งคอมเมนต์จริง ยังไม่ถือเป็นผลทดสอบโหลด Facebook หรือการส่งจริงบนโปรไฟล์เจ้าของ


หากเปิดลิงก์แล้วไม่ขึ้น ให้รัน `npm run browser:desktop -- --check` ซึ่งตรวจทั้ง dependency, รหัส viewer และบริการที่พอร์ตจริง ถ้าแสดง NOT RUNNING ให้เริ่ม `npm run browser:desktop` และเปิดคำสั่งนั้นค้างไว้ ขั้นตอนติดตั้งแพ็กเกจอย่างเดียวไม่เริ่มบริการ การตั้งรหัสผ่าน Windows ใช้ไฟล์ส่งต่อชั่วคราวใน runtime สิทธิ์ส่วนตัวและลบทันที ไม่ส่งรหัสผ่าน argv/logs และไม่เรียก WSL ซ้อนจาก Windows เพื่อบันทึกรหัส


ตั้งแต่ส่วนขยาย **1.11.7** ให้เปิดตัวเลือก **ใช้จอเฉพาะสำหรับบอท** ใน popup เฉพาะ Chromium บนจอเสมือนนี้ ระบบจะโฟกัสเฉพาะหน้าต่างอ่านที่บอทเป็นเจ้าของ เพื่อให้ Facebook โหลดต่อ ไม่ใช้ตัวเลือกนี้ใน Chrome ส่วนตัวบน Windows การทำงานในจอนี้ไม่ควรพึ่ง timer ของแท็บที่ Chrome ซ่อน: ตัวรออ่านใช้ timer ของ worker และ snapshot DOM แบบ synchronous แทน โหมดนี้ไม่เปิดสิทธิ์ส่งคอมเมนต์
