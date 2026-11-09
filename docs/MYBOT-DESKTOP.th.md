# MY-BOT Desktop — ส่วนเสริมจอแยกสำหรับ production

รุ่นปัจจุบัน **0.1.4-preview / extension 1.11.23** รองรับ Windows 11 x64 เป็นทางเลือก ไม่บังคับผู้ใช้ทั่วไปติดตั้ง แพ็กเกจยังเป็น ZIP พร้อมตัวติดตั้ง PowerShell ไม่ใช่ EXE ที่ลงลายเซ็นแล้ว ต้องตรวจรับบน Windows เครื่องใหม่ก่อนแจกเป็นรุ่นทั่วไป

## ทำไมจึงคุ้มสำหรับรุ่นแรก

ใช้เว็บ production และตัวอ่านที่มีอยู่ต่อ โดยเครื่องลูกค้ารับภาระ Chromium จึงไม่เพิ่มโฮสต์เบราว์เซอร์รายบัญชีของเรา ไม่ต้องมีฐานข้อมูล คีย์ AI หรือ worker ในเครื่องลูกค้า ส่วนที่ต้องลงทุนคือทดสอบ/สนับสนุนการติดตั้ง WSL การดาวน์โหลดระบบ และการอัปเดต Windows เหมาะกับผู้ใช้ Windows ที่เปิดเครื่องค้าง ไม่ตอบโจทย์ปิดเครื่องแล้วอ่านต่อ ลูกค้ากลุ่มหลังยังต้องใช้ collector บนคลาวด์

## ดาวน์โหลดและเริ่มใช้

1. เปิดเว็บ production HTTPS → ตั้งค่า → **MY-BOT Desktop** → ดาวน์โหลดชุดทดลอง ไฟล์ผูกเฉพาะ public origin ของเว็บนั้น ไม่ใส่ session, cookies, token, pairing code หรือข้อมูลฐานข้อมูลใน ZIP
2. แตกไฟล์และเปิด `Install.cmd` ยืนยันคำขอติดตั้ง ตัวติดตั้งตรวจ Windows x64 และพื้นที่ว่างขั้นต่ำ 4 GB หาก WSL ยังไม่พร้อม จะขอเปิดตัวติดตั้ง WSL ของ Windows ซึ่งอาจต้องสิทธิ์ผู้ดูแลและรีสตาร์ต ไม่รีสตาร์ตเอง หลังรีสตาร์ตให้เปิดชุดเดิมอีกครั้ง

   หน้ายืนยันระบุสิทธิ์อ่าน Facebook/ส่งโพสต์และ origin เซิร์ฟเวอร์จริง ให้ตรวจที่อยู่ก่อนยอมรับ ส่วนขยายโหลดเฉพาะในเบราว์เซอร์ของบอท ไม่ติดตั้งหรือให้ optional host permission ใน Chrome ส่วนตัวเงียบ ๆ
3. ตัวติดตั้งดาวน์โหลด Debian 13 rootfs จากแหล่ง Docker Official Image ที่ผู้พัฒนา Debian ดูแล โดย pin commit, ขนาด และ SHA-256 ตาม OCI manifest ไม่ต้องติดตั้ง Docker สร้าง distro เฉพาะชื่อ `MYBOT-Desktop-V1` ไม่แก้ distro เดิม ไม่เปลี่ยน default distro และไม่ใช้ `wsl --shutdown` ติดตั้งเฉพาะ Chromium พร้อม sandbox, จอเสมือน, viewer, Node runtime และ user service
4. ตั้งรหัสเปิดดูจอบอท 8 ตัวอักษร ASCII ไม่ใช้รหัส Facebook ซ้ำ รหัสนี้เก็บเฉพาะเครื่อง มีเพียงช่องส่งต่อชั่วคราวที่ลบทันที ไม่อยู่ใน URL/argv/logs
5. ในจอบอท เข้าสู่ MY-BOT และ Facebook ด้วยตนเอง ส่วนขยายที่มาพร้อมชุดติดตั้งเชื่อมอุปกรณ์อัตโนมัติตาม flow เดิม และเปิดโหมดจอเฉพาะเฉพาะ fresh Desktop profile ไม่ย้าย cookies หรือสิทธิ์จาก Chrome ส่วนตัว
6. ตรวจโพสต์ที่รับจริงและความคืบหน้าในภาพรวมระบบ จากนั้นปิดหน้าดูจอได้ ใช้ทางลัดในเมนูเริ่มเพื่อเปิดดู เริ่ม หยุด ตรวจสถานะ เปิดเบราว์เซอร์ใหม่หลังตรวจงาน หรือถอนการเริ่มอัตโนมัติ

เครื่องต้องตื่นและมีอินเทอร์เน็ต เมื่อ Sleep/hibernate/ปิดเครื่องจะไม่เก็บโพสต์ต่อ การพับฝาโน้ตบุ๊กขึ้นกับค่าพลังงานของลูกค้า โปรแกรมไม่แก้ค่าพลังงาน อุปกรณ์เสียง หรือ OS security settings เงียบ ๆ อย่าย่อ Chromium ภายในจอเสมือน VNC เปิดเฉพาะ loopback ไม่เปิดพอร์ตให้ LAN/อินเทอร์เน็ต

## โครงสร้างและการรักษาข้อมูล

- `src/lib/desktop-package.ts` สร้าง ZIP จาก allowlist ไฟล์ runtime และ extension เท่านั้น มี checksum รายไฟล์และ release ID ที่ผูกกับ origin ไม่รวม `.env`, `data/`, backups, Prisma, Node dependencies หรือ worker
- `desktop/Install.ps1` ตรวจ checksum ก่อนรันไฟล์ ตั้ง ownership record ของ distro เพื่อ resume การติดตั้งที่สะดุด และปฏิเสธ distro ชื่อชนกันที่ยืนยันเจ้าของไม่ได้ ตรวจพอร์ต viewer ไม่ให้แย่งจอเดิมและใช้ mutex กัน installer ซ้อน
- ตั้งแต่ 0.1.1 เลือกพอร์ตว่างอัตโนมัติ เริ่มจากคู่ 5915/6095 สูงสุด 20 คู่ และจำไว้ใน install-state.json กับ workstation-config.json ใช้ค่านี้ทั้ง VNC, noVNC, health, ทางลัด และ X display จึงอยู่ร่วมกับจอเดิม 5905/6085 ได้ ไม่ฆ่าโปรเซสที่ใช้พอร์ตอื่น `Install.ps1 -CheckPorts` ตรวจชุดไฟล์และเลือกพอร์ตโดยไม่ติดตั้ง
- ตั้งแต่ 0.1.2 ตรวจ magic gzip, ขนาด และ SHA-256 ก่อนแทน cache ใช้ไฟล์ `.download` แยกแล้ว replace หลังยืนยันครบ หากได้ HTML verification page จะหยุดและบอกสาเหตุตรง ไม่ retry challenge วนหรือ import HTML มี provenance ของ OCI manifest ในแพ็กเกจ
- `desktop/provision.sh` ทำงาน root เฉพาะ distro ที่กำหนด ติดตั้งโปรแกรมใน immutable release ที่ root เป็นเจ้าของ ใช้ผู้ใช้ `mybot` สำหรับ Chromium ไม่ปิด sandbox เขียนค่าที่ผู้ใช้แก้ได้ด้วยสิทธิ์ผู้ใช้นั้นแทน root
- `/opt/mybot-desktop/current` ชี้ runtime รุ่นปัจจุบัน แยกข้อมูลคงอยู่ที่ `/var/lib/mybot-desktop` และโปรไฟล์ `/var/lib/mybot-desktop/desktop-browser-profile` ไม่เก็บโปรไฟล์ในโฟลเดอร์ดาวน์โหลดหรือ release
- `desktop/extension-key.txt` เป็น **public key** สำหรับ Chrome extension identity เพื่อคง ID ข้าม release path ไม่ใช่ API credential และไม่ใช่ private signing key ไม่มี private key ในชุดติดตั้ง ไม่ใช่การลงลายเซ็น EXE/CRX
- `workstation-config.json` ใช้ `mode: remote` และ HTTPS origin เท่านั้น เมื่อ server ออฟไลน์หรือ config หาย จะไม่เริ่ม Next.js/worker ในเครื่องแทนแบบเงียบ ๆ
- การกู้ viewer ไม่เปิด Chromium ซ้ำ เมื่อ Chromium/Xvfb ล้มต้องตรวจประวัติก่อนใช้คำสั่งเปิดใหม่ ไม่ retry งานส่งที่ dispatched/uncertain การติดตั้งและจับคู่ไม่เปิดกฎคอมเมนต์หรือย้าย pinned device/account
- ทางลัดเริ่มอัตโนมัติ Windows ใช้ชื่อ `MY-BOT-Desktop.vbs` แยกจาก launcher ของเครื่องพัฒนา รัน user service ใน distro นี้เท่านั้น ไม่เปิดบริการ Render หรือคิว AI ซ้ำ
- ตัวควบคุม Windows ถือ foreground `wsl.exe` แบบซ่อนหน้าต่างตลอดที่ service ทำงาน ไม่พึ่ง systemd เพียงอย่างเดียวในการคง WSL ให้ตื่น เมื่อตรวจพบ service หยุดจะจบตัวควบคุม ไม่เปิดเบราว์เซอร์ใหม่วนเอง การเรียกดูสถานะไม่ enable/start service ให้เงียบ ๆ

## อัปเดตและถอน

รุ่นทดลองยังอัปเดตแบบเจ้าของสั่งเอง: พักงาน ตรวจประวัติการส่ง และหยุดบอทจากทางลัดก่อน ดาวน์โหลด ZIP ใหม่จากเว็บเดิมแล้วเปิดตัวติดตั้ง จะคงโปรไฟล์ การจับคู่ และข้อมูลค้างไว้ ปฏิเสธการเปลี่ยน server origin ทับการติดตั้งเดิม ไม่สลับ release ขณะ service ทำงาน

service ถือ shared update lock ตลอดอายุโปรเซส ส่วนตัวติดตั้งต้องได้ exclusive lock ก่อนแก้ runtime การกดเริ่มระหว่างติดตั้งจึงไม่ถูกค้างไว้เพื่อเปิด Chromium เองหลังอัปเดต

การถอนจากทางลัด **หยุดและถอนการเริ่มอัตโนมัติ** จะหยุด/disable service และลบเฉพาะทางลัดเริ่มอัตโนมัติ เก็บ distro และโปรไฟล์ไว้ ทางลัด **ลบสภาพแวดล้อมทั้งหมด** ยืนยันแล้วจึง unregister เฉพาะ `MYBOT-Desktop-V1` และลบไฟล์ติดตั้งใน LocalAppData

ยังไม่เปิดอัปเดต executable/background แบบเงียบ ๆ และยังไม่ลงลายเซ็น EXE ต้องเตรียม signing, release provenance และตรวจความเข้ากันของ server/extension ก่อนเพิ่ม automatic updater ตอนนี้เก็บ release ปัจจุบันกับรุ่นก่อนหนึ่งชุดหลังอัปเดตมือ

## ตรวจรับก่อนใช้งานทั่วไป

ทดสอบติดตั้งตั้งแต่ Windows 11 x64 ที่ไม่มี WSL และกรณีมี WSL เดิมที่มีข้อมูลสำคัญ ตรวจขั้นตอน reboot/resume, antivirus/SmartScreen, account permissions, WSL user bus, Chromium sandbox, การโหลด extension และการเชื่อม production จริง ต้องไม่ให้ลูกค้ารันคำสั่งหรือคัดลอก token เอง

ทดสอบกับ Facebook แบบอ่านอย่างเดียวอย่างน้อย 30 นาทีขณะปิด viewer แล้วเพิ่มการทดสอบ 24 ชั่วโมง วัดการอ่านครบแหล่ง/โพสต์รับจริง/pending age ไม่ใช้แค่ heartbeat เป็นหลักฐาน ตรวจเน็ตหลุด Chrome worker restart อัปเดตทับ ถอนการเริ่มอัตโนมัติ และข้อมูลค้างไม่หาย ไม่มีการส่งคอมเมนต์จริงเป็นส่วนหนึ่งของการติดตั้ง

สิ่งที่ทำได้ในสภาพแวดล้อมพัฒนารอบนี้คือ unit/integration tests, production build, ZIP integrity, PowerShell 5.1 แบบ CheckOnly และ script syntax ไม่เท่ากับผลติดตั้งครบวงจรบน Windows ใหม่หรือรับรอง Facebook จริง

อ้างอิง: [WSL install](https://learn.microsoft.com/windows/wsl/install), [WSL systemd lifecycle](https://learn.microsoft.com/windows/wsl/systemd), [WSL image metadata](https://github.com/microsoft/WSL/blob/master/distributions/DistributionInfo.json), [Debian Node.js package](https://sources.debian.org/src/nodejs/)

## ผลตรวจรอบพัฒนา 9 พฤศจิกายน 2026

- ชุดทดสอบ 881/881 ข้อ รวม 102 ไฟล์ ผ่านทั้งหมดโดยกำหนด TEST_DATABASE_URL ไป PostgreSQL ชั่วคราวบน loopback พอร์ต 55439 ไม่ใช้ Supabase จริง
- Production build ผ่าน มีหน้า `/settings/desktop` และ API ดาวน์โหลดที่ต้องล็อกอิน จำกัด HTTPS production
- ZIP ผ่าน CRC และตรวจ SHA-256 รายไฟล์ทั้งหมด PowerShell 5.1 parse และ `Install.ps1 -CheckOnly` ผ่าน เมื่อจงใจแก้ payload ถูกปฏิเสธก่อนติดตั้ง Shell/Node syntax และ `git diff --check` ผ่าน
- จำลองตัวควบคุมจริงใน remote mode ที่เว็บออฟไลน์ ยืนยันว่าไม่เปิด Next.js/worker ในเครื่อง และไม่วนเปิด browser หลังล้ม ทดสอบ update lock และ foreground keep-alive เมื่อ service activation/stop/failure
- ลิงก์ Debian ทางการตอบ HTTP 200 แต่การดาวน์โหลดไฟล์เต็มในสภาพแวดล้อมตรวจขาดกลางทาง จึงยังไม่ถือว่าตรวจ image เต็มไฟล์สำเร็จ ตัวติดตั้งตรวจ checksum และห้าม import ไฟล์ไม่ครบ
- ยังไม่ติดตั้ง distro ใหม่บนเครื่องเจ้าของ ไม่ย้าย session Facebook ไม่ส่งคอมเมนต์จริง ยังไม่ push/deploy และยังไม่ผ่าน pristine-Windows/real-Facebook acceptance จึงคงสถานะ preview

ผลตรวจรอบ 0.1.2: พบไฟล์ cache จาก endpoint เดิมเป็น HTML `I Challenge Thee` 3,319 bytes ช่อง API ของผู้ให้บริการเดิมคืน HTML เช่นกัน จึงใช้ rootfs เดียวกับ Docker Official Debian จาก immutable commit แทน ตรวจไฟล์เต็มบน Windows ได้ 49,412,508 bytes และ SHA-256 `a6dd1c05fbba4f9028078a11f143cbb625d2408921eb8207bfa1dd1ad301276f` ตรงกับ layer digest ใน manifest ตรวจ tar แล้วเป็น Debian 13 ไม่ใช้ hash ของหน้า HTML มาตั้งเป็นค่าที่คาดไว้
