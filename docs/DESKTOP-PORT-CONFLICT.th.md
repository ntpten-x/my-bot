# Desktop 0.1.1 — แก้ตัวติดตั้งชนพอร์ตจอเดิม

## สรุป

Desktop 0.1.0 จาก commit `0e3d846` ติดตั้งต่อไม่ได้บนเครื่องที่มีจอ VNC ของ MY-BOT เดิมรันอยู่ โดยแสดง `A viewer port is already in use. Stop that desktop before installing.` รุ่น 0.1.1 เลือกพอร์ตว่างให้แต่ละการติดตั้ง และใช้ค่าที่บันทึกตรงกันตั้งแต่ runtime ถึงทางลัด จึงไม่ต้องปิดจอบอทเดิมเพื่อผ่านขั้นตอนนี้

## อาการและสาเหตุ

เครื่องที่ตรวจมี x11vnc บน 5905 และ websockify บน 6085 อยู่ก่อนแล้ว `desktop/Install.ps1` รุ่นเดิมตรวจสองพอร์ตตายตัวและ throw ทันที ก่อน download/import/provision ส่วน `desktopPlan`, readiness probes และ `Control.ps1` ต่างก็ใช้ 5905/6085 ตายตัว การเอา guard ออกอย่างเดียวจึงทำให้โปรเซสใหม่ bind ไม่ได้ หรือเปิดหน้า viewer ของโปรเซสอื่นแทน

## การแก้

- `desktop/ports.ps1` ตรวจทั้งการเชื่อมต่อและการ bind บน Windows เลือกคู่ 5915/6095 ถึง 5934/6114 ใช้พอร์ตเดิมของการติดตั้งหากยังว่าง ไม่ฆ่าโปรเซสที่ครองพอร์ต
- Installer บันทึก `vncPort` / `viewerPort` ใน install-state.json และส่งค่าตัวเลขไป provision เพื่อเก็บใน workstation-config.json ด้วย ใช้ค่าเดิมแบบ legacy ได้เมื่อไม่มี fields นี้
- `desktopPorts()` ตรวจช่วง ชนิดตัวเลข และการใช้พอร์ตเดียวกัน `workstationConfig()` รักษาค่าที่กำหนด `desktopPlan()` ใช้กับ VNC/noVNC/URL และแยก X display ตามพอร์ตจอใหม่ ขณะที่ค่า legacy ยังเป็น :93
- Supervisor และ desktop readiness ใช้พอร์ตจาก config ทุกจุด ชุด Desktop ไม่ adopt listener ที่ไม่เคยเปิดเอง `Control.ps1` ตรวจสถานะ managed desktop และพอร์ตให้ตรงกันก่อนเปิด URL เพื่อไม่ส่งผู้ใช้ไปยัง viewer อื่น
- เพิ่ม `Install.ps1 -CheckPorts` เพื่อทดสอบ preflight โดยไม่ติดตั้ง เปลี่ยนเวอร์ชันแพ็กเกจเป็น 0.1.1-preview ส่วน protocol/extension ยังคง 1.11.19 ไม่เปลี่ยนสิทธิ์คอมเมนต์

## การสืบหาและช่องว่างเดิม

เริ่มจากข้อความผู้ใช้ แล้วตรวจพอร์ตบนเครื่องจริง ยืนยันว่าบริการจอเดิมยังพร้อมใช้งาน สร้าง regression `uses the Desktop installation ports everywhere rather than the running legacy viewer ports` ซึ่งล้มเหลวก่อนแก้เพราะแม้กำหนด 5915/6095 plan ยังส่งกลับ 5905/6085 หลังแก้ผ่าน และ Windows helper เลือกพอร์ตใหม่ได้ขณะพอร์ตเดิมยัง busy

การตรวจรุ่นแรกมี CheckOnly, checksum และ runtime mock แต่ไม่ได้ทดสอบ Windows preflight ขณะที่มี VNC อีกชุดอยู่แล้ว ชุดทดสอบ default ports จึงไม่ตรวจพบสมมติฐานที่ทุก layer ใช้พอร์ตเดียวกัน ปิดช่องว่างด้วย regression พอร์ตที่กำหนดและ preflight จริงในโฟลเดอร์ที่ผู้ใช้ดาวน์โหลด

## ผลตรวจ

- 883/883 tests ใน 103 ไฟล์ รวมฐานข้อมูล PostgreSQL ทดสอบแยก และ production build ผ่าน
- Windows PowerShell 5.1 ยืนยันว่า 5905/6085 ไม่ว่าง ขณะที่การติดตั้งใหม่และการกู้จากค่า legacy เลือก 5915/6095 ได้
- อัปเดตเฉพาะไฟล์แพ็กเกจใน `C:\Users\MyPC\Downloads\mybot-desktop-0.1.0-preview` เป็น 0.1.1 หลังตรวจว่าไม่มี local edits และยังใช้ production origin เดิม จากนั้น parse PowerShell, CheckOnly และ CheckPorts ในโฟลเดอร์จริงผ่านทั้งหมด
- ไม่หยุด VNC/Chromium เดิม ไม่อ่านหรือย้าย cookies/token และไม่ได้ส่งคอมเมนต์จริง การผ่าน preflight นี้ยังไม่ใช่ผลติดตั้ง WSL ใหม่ครบวงจรหรือผลอ่าน Facebook จริง

## งานตรวจรับต่อ

เจ้าของทดลอง Install.cmd ต่อจากชุดที่อัปเดตในโฟลเดอร์เดิม ส่วนการเผยแพร่ทั่วไปยังคงเกณฑ์ pristine-Windows และ read-only Facebook ใน [คู่มือ Desktop](MYBOT-DESKTOP.th.md)
