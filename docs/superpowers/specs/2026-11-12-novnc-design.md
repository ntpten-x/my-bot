# ปรับปรุง noVNC

เจ้าของอนุมัติให้ทำคำแนะนำทั้งสี่: ตรวจ transport จริง, reconnect, ตัวเลือกภาพและการวัด, สถานะการเชื่อมต่อ

ใช้ UI และ RFB ของ noVNC เดิม พร้อมโมดูลเสริมขนาดเล็กและ static root เฉพาะไฟล์สาธารณะ แทนการสร้าง viewer ใหม่ซึ่งเสี่ยงทำ keyboard/clipboard/การป้อนรหัสผ่านเดิมเสีย การแก้แพ็กเกจระบบโดยตรงจะสูญหายเมื่ออัปเดต จึงไม่เลือก

ตรวจ HTTP + WebSocket upgrade + RFB banner ภายใน deadline โดยไม่ส่งรหัสผ่านหรือ input กู้เฉพาะ viewer ที่ supervisor เป็นเจ้าของด้วย retry เดิม ไม่เปิด Chrome ใหม่ ไม่แตะ adopted services

Reconnect มีขอบเขตและเคารพ Disconnect/Cancel/auth failure ภาพเริ่มต้น 6/2 พร้อม 6/0 และ 9/0 คง desktop 1600x900 และ client scaling สถานะแสดงเวลา/จำนวน/เหตุผลแบบจำกัดรหัสและ benchmark rAF ที่ระบุว่าไม่ใช่ FPS ของ Facebook ไม่มี password/token/ภาพหน้าจอใน diagnostics

ลำดับงาน: regression tests → protocol probe → viewer เสริมและ public assets → supervisor/packaging → synthetic browser verification → test/build ไม่รีสตาร์ต desktop ที่ใช้งานอยู่
