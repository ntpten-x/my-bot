# Desktop 0.1.2 — ดาวน์โหลด HTML แทนอิมเมจระบบ

## สรุป

ผู้ใช้ติดตั้ง Desktop 0.1.1 แล้วพบ `Operating system image checksum mismatch.` ตรวจบน Windows พบ cache `debian.wsl` เป็น HTML ขนาด 3,319 bytes ชื่อหน้า `I Challenge Thee` ก่อนขั้น import WSL หรือเข้าสู่ Facebook ตัวตรวจ SHA-256 ทำงานถูกต้องที่ปฏิเสธไฟล์นี้ แต่ตัวติดตั้งเดิมไม่ได้แยกกรณีเว็บส่ง HTML แทน binary ทำให้ลองซ้ำกับ endpoint เดิมและแสดงข้อความกว้างเกินไป

## สาเหตุและกลไก

อิมเมจ Debian WSL จาก Salsa มี expected SHA-256 ตรงกับ Microsoft WSL distribution metadata แต่ HTTP GET จาก Windows ได้หน้า verification HTML พร้อมสถานะสำเร็จ `Invoke-WebRequest -OutFile` จึงบันทึก HTML เป็น `.wsl` ได้ HEAD ของทั้ง URL เดิมและ public artifacts API ตอบ `application/octet-stream` กับขนาด 89,228,801 bytes ซึ่งไม่ได้ยืนยันว่า GET จะได้ binary จริง การตรวจเฉพาะ header จึงหักล้างปัญหานี้ไม่ได้

## การแก้

- ใช้ Debian 13 rootfs จากแหล่ง Docker Official Image ที่ผู้พัฒนา Debian ดูแล ไม่ต้องติดตั้ง Docker และยังใช้ dedicated WSL distro เดิมในการติดตั้ง
- Pin commit `373f61a386722a989c79f0c11f23fcf379b56e94`, ขนาด 49,412,508 bytes และ SHA-256 `a6dd1c05fbba4f9028078a11f143cbb625d2408921eb8207bfa1dd1ad301276f` ตาม single rootfs layer ใน OCI manifest ไม่ใช้ hash ของไฟล์ที่ผิดมาตั้งเป็นค่าที่คาดไว้
- เก็บ `rootfs-provenance.json` จาก immutable commit และ regression ตรวจ digest ของ descriptor, layer digest, media type และขนาดให้ตรง rootfs.json
- `desktop/image.ps1` ตรวจ prefix HTML/gzip, ขนาด และ SHA-256 ดาวน์โหลดลง `.download` แล้วแทน cache ด้วย File.Replace/Move หลังผ่านทุกข้อเท่านั้น HTML จะได้ error ตรงและไม่ retry หน้า challenge วน ไฟล์ขาดหรือ checksum ผิดจะไม่ถูก import หรือทับ cache เดิม
- เพิ่ม `systemd-sysv`, `libpam-systemd` และฟอนต์ไทยให้ generic Debian rootfs พร้อมใช้เป็นจอ WSL แบบมีหน้าจอ ไม่ปิด sandbox ไม่เปลี่ยน power/audio settings หรือสิทธิ์คอมเมนต์

## การสืบหาและสิ่งที่หักล้าง

1. อ่านเฉพาะขนาด/hash/prefix/title ของไฟล์ cache จริง ยืนยันว่าไม่ใช่ gzip และเป็น HTML 3 KB
2. เทียบ expected digest กับ metadata ทางการ ค่าเดิมไม่ได้พิมพ์ผิด
3. HEAD ของ public API ดูถูกต้อง แต่ทดลอง GET เต็มบน Windows ยังได้ HTML hash เดิม จึงไม่แก้ด้วยการเปลี่ยนไป endpoint API ที่ยังไม่ผ่านการโหลดจริง
4. ตรวจแหล่งที่ Docker Official Debian อ้างอิง และดาวน์โหลด blob จริงตาม immutable commit (ไม่ใช้ URL symlink ใน OCI ซึ่ง raw GitHub ส่งข้อความลิงก์) ไฟล์เต็มบน Windows ผ่าน published digest และตรวจ tar แล้วเป็น Debian 13
5. Regression บน Windows PowerShell 5.1 จำลอง HTML, ไฟล์ขาด, checksum ผิด, cache ที่ผ่านแล้ว และการแทนไฟล์แบบ atomic

## ช่องว่างการตรวจรุ่นเดิม

มีการทดสอบ package checksum, syntax และ HEAD แต่การดาวน์โหลด Salsa เต็มไฟล์ในสภาพแวดล้อมพัฒนาไม่สำเร็จและถูกระบุเป็นข้อจำกัด preview ไม่เคยมีหลักฐานว่า GET บน Windows ได้ binary ที่ตรวจผ่าน การรับรอง source ใหม่จึงใช้ GET เต็มจริงและตรวจ digest ก่อนเปลี่ยน pin ไม่ใช้ HEAD อย่างเดียว

## ผลตรวจและขอบเขต

ไฟล์ rootfs ใหม่โหลดครบและตรวจ digest บน Windows จริง ชุดทดสอบ downloader ใช้เฉพาะ fixture ชั่วคราว ไม่ใช้ cookies หรือ Facebook session ผลนี้ยืนยันการแก้ขั้น download/verify ไม่ใช่การรับรอง pristine-Windows installation หรือการอ่าน Facebook ต่อเนื่อง ต้องตรวจขั้นติดตั้งหลังจากนี้ตาม [คู่มือ Desktop](MYBOT-DESKTOP.th.md)

แหล่งอ้างอิง: [Docker Official Debian](https://hub.docker.com/_/debian), [immutable OCI manifest](https://github.com/debuerreotype/docker-debian-artifacts/blob/373f61a386722a989c79f0c11f23fcf379b56e94/trixie/oci/index.json)
