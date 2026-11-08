# หน้า viewer เปิดไม่ได้ที่ localhost:6085

## สรุป

เจ้าของเปิด viewer แล้วเชื่อมต่อไม่ได้ เพราะการเตรียมครั้งก่อนยังไม่ผ่านการตั้งรหัสและไม่ได้เริ่มชุดจอจริง แก้เส้นทางตั้งรหัส Windows → WSL และ environment ของตัวแชร์จอ จน viewer ตอบ HTTP 200 จากทั้ง WSL และ Windows โดยคง password authentication และ bind เฉพาะ loopback

## สาเหตุ

`browser:desktop --check` เดิมตรวจเฉพาะโปรแกรมกับไฟล์รหัส ไม่ตรวจว่าบริการรันแล้ว ขั้นตอนตั้งรหัสผ่าน terminal ที่เปิดแยกไม่สำเร็จ ทำให้ไม่มี `vnc-password` และ supervisor ปฏิเสธเริ่มตามเงื่อนไขความปลอดภัย ต่อมา Windows GUI เรียก wsl.exe ซ้อนเพื่อเก็บรหัส แต่บริบทนั้นคืน `WSL_E_DISTRO_NOT_FOUND` จึงไม่ได้บันทึก แม้หน้าต่างรับรหัสจะทำงานแล้ว

เมื่อบันทึกรหัสได้ ตัวแชร์หน้าจอ x11vnc ยังหยุดด้วย `Wayland display server detected` เพราะรับค่าจาก WSLg แม้ `DISPLAY=:93` เป็น Xvfb จริง ค่าว่าง `WAYLAND_DISPLAY=''` ไม่เท่ากับลบตัวแปร จึงต้องลบตัวบ่งชี้ Wayland และกำหนด `XDG_SESSION_TYPE=x11` เฉพาะ environment ของชุดจอ ไม่แก้ desktop ของ Windows/WSLg

## การแก้

- Windows GUI รับรหัสในช่องซ่อนอักขระ เขียนผ่านไฟล์ชั่วคราวที่ Node สร้างไว้ใน directory 0700 และ file 0600 จากนั้น helper Python ส่งเข้า native libvncserver เพื่อบันทึก credential แบบมาตรฐาน ไม่ผ่าน argv หรือ logs และลบไฟล์ส่งต่อใน finally
- Helper ล็อก `run.lock` เพื่อไม่เปลี่ยนรหัสขณะจอรัน ปฏิเสธ symlink และรหัสที่ไม่ตรงข้อจำกัด VNC
- `desktopEnvironment()` ลบ WAYLAND_DISPLAY/WAYLAND_SOCKET และตั้ง XDG_SESSION_TYPE=x11 สำหรับ Xvfb/Openbox/x11vnc/browser เท่านั้น
- Supervisor แสดง exit code/diagnostics ของส่วนประกอบจอเมื่อเริ่มไม่สำเร็จ แต่ไม่ส่งต่อ Chrome stderr หรือ Xauthority nonce
- `--check` ตรวจ VNC listener และ HTTP viewer เพิ่ม เพื่อแยก installed กับ running

## ช่องว่างที่ทำให้หลุด

การทดสอบก่อนหน้าพิสูจน์ว่า Chromium ทำงานบน Xvfb ได้โดยไม่มี viewer แต่ยังไม่ได้รัน x11vnc/noVNC ผ่านเส้นทาง startup ของเจ้าของครบ จึงไม่พบ inherited Wayland และไม่มีข้อยืนยัน HTTP จาก Windows ก่อนส่งลิงก์ให้เจ้าของ

## การตรวจสอบ

ก่อนแก้ curl เข้า 127.0.0.1:6085 ถูก refused และไม่มี listener หลังแก้ได้ HTTP 200 จาก curl ใน WSL และ Invoke-WebRequest บน Windows ตรวจ WebSocket ถึง VNC ได้ RFB security type 2 และไม่มี type 1 จึงยังต้องใช้รหัสผ่าน โดยไม่อ่านรหัสหรือภาพหน้าจอ listener อยู่ที่ 127.0.0.1:6085, 127.0.0.1:5905 และ [::1]:5905 เท่านั้น

เพิ่ม regression สำหรับการลบ Wayland ที่สืบทอดจาก WSLg และ native helper ที่รับรหัสทาง stdin, บันทึกไฟล์ 0600/directory 0700, ปฏิเสธรหัสผิดรูปแบบโดยไม่สร้าง credential การทดสอบ native ใช้ fixture ชั่วคราวและข้ามเมื่อไม่ได้ติดตั้ง libvncserver ไม่อ่าน credential เจ้าของ ไม่มีการส่งคอมเมนต์จริงหรือยืนยันว่าจับคู่ Facebook สำเร็จจากการตรวจ viewer นี้

ผลตรวจสุดท้าย: `npm test` ผ่าน 716 tests / 81 files, `npm run build` ผ่าน, `browser:desktop --check` แสดง dependencies/password PASS และ service RUNNING มีการเปิด supervisor ค้างไว้ให้ใช้งานแล้ว ไม่หยุดจอหลังทดสอบ
