# ส่วนขยายออนไลน์แต่ตัวอ่านกลุ่ม timeout — 1.11.7

## สรุป

ส่วนขยาย 1.11.6 จับคู่และเห็น Facebook แล้ว แต่โพสต์ยังไม่เข้าระบบ ตัวอ่านเปิดกลุ่มได้และ parse DOM ตอบใน 1–4 ms แต่การรอเติบโตของฟีดล้มด้วย `แท็บอ่านไม่ตอบภายในเวลาที่กำหนด` แก้โดยย้ายการจับเวลารอไป service worker และเพิ่มโหมดจอเฉพาะบอทแบบ opt-in ต่อโปรไฟล์ จากนั้นตรวจ actual runs ของทั้งสี่กลุ่มและพบโพสต์ใหม่เข้าสู่ฐานข้อมูล โดยไม่ส่งคอมเมนต์จริง

## สาเหตุและเส้นทางล้มเหลว

`readFeed()` เรียก `waitForGrowth()` ซึ่งเดิมส่ง Promise + MutationObserver/setTimeout เข้าแท็บ Facebook เมื่อแท็บอยู่ข้างหลังและ Chrome มองว่า hidden timer ภายในแท็บอาจไม่เดินตาม deadline ของ worker แม้ synchronous DOM read ยังตอบได้ ตัว `executeReaderScript()` ฝั่ง worker จึง timeout ก่อน Promise ในหน้า resolve หลังจับโพสต์แรกได้แล้วอาจยังไม่ถึงรอบ drain; pending ถูก checkpoint ไว้แต่ UI ยังเห็นไม่มีข้อมูลใหม่

Private-pipe debugger (ไม่เปิด TCP debug port และไม่อ่าน cookies/token) พิสูจน์ว่า API config ตอบ 200, scrapeAllowed=true, มีสี่กลุ่ม, บัญชีไม่พักและไม่มี outbox blockage คำสั่ง DOM ทั้ง inject ปกติและ injectImmediately ตอบ 1–4 ms ตัดกรณี pairing/สิทธิ์/DOM parser ค้างออก ตัวอ่านเก่าเลื่อนค้างที่ step 1 พร้อม timeout ในหลายกลุ่ม

## การแก้

- `waitForGrowth()` inject เฉพาะ synchronous snapshot แล้วใช้ timer ของ worker รอ/poll ทุกไม่เกิน 350 ms ภายใต้ deadline เดิม เก็บเงื่อนไข count, scroll height และ new post keys เพื่อรองรับ virtualized feed ไม่สร้าง observer/timer ค้างในหน้า
- เพิ่ม `dedicatedReaderDesktop` ค่าเริ่มต้น false และตัวเลือก popup **ใช้จอเฉพาะสำหรับบอท** หากเปิด ให้โฟกัสเฉพาะหน้าต่างที่ `isOwnedReaderWindow()` ตรวจแล้ว ไม่โฟกัสหน้าต่างเจ้าของ/หน้าต่างที่มีแท็บส่วนตัว ไม่เปิดสิทธิ์คอมเมนต์ การตั้งค่านี้เปิดเฉพาะโปรไฟล์ในจอเสมือนของเจ้าของ
- โหมดปกติคงไม่แย่งโฟกัสและไม่คืนหน้าต่างที่เจ้าของย่อเอง อายุโพสต์, allowlist, quiet settings, quotas และ checkpoint/outbox ใช้ข้อจำกัดเดิม
- พบ launcher ปฏิเสธ SingletonLock หลัง process Chrome สิ้นสุดไปแล้ว จึงแยก live/unknown/other-host locks ออกจาก dead same-host PID ให้ Chromium จัดการ stale lock ของตนเอง ไม่มีการลบ lock/cookies/profile เพื่อแก้ปัญหา

## ช่องว่างเดิม

การทดสอบ DOM สังเคราะห์เดิมใช้หน้าที่มี timer ทำงานตามปกติ และพิสูจน์ Chromium บน Xvfb แต่ไม่ได้จำลอง page-owned timer ที่หยุด จึงไม่พบความต่างระหว่าง DOM ที่ยังตอบ กับ Promise ที่รอ timer อยู่ใน hidden tab

## การตรวจสอบ

`reader-growth-host-timer.test.ts` รันฟังก์ชันจริงใน VM ที่ timer ของหน้าไม่ทำงาน: ก่อนแก้สองกรณี timeout หลังแก้รอ no-growth จบตามเวลาและพบ key ใหม่แม้จำนวน DOM ไม่เพิ่ม โดยไม่เรียก timer ของหน้า `reader-focus.test.ts` ตรวจ dedicated-mode เฉพาะ owned window และปฏิเสธ personal/moved readers; `browser-profile-lock.test.ts` ตรวจ live/stale/unknown locks โดยไม่ลบไฟล์จริง

ปรับ harness continuous-reader ให้ pure scrape helpers ใช้ VM clock เดียวกัน เดิม fixture มีวันที่ตายตัวแต่ helper ใช้ wall clock จึงเริ่มถูกมองว่าเก่าเกิน 24 ชั่วโมงหลังเวลาจริงผ่านไป ไม่ใช่ความผิดของ production age policy

ชุดทดสอบผ่าน **722 tests / 83 files** และ `npm run build` ผ่าน ตัวตรวจ Chromium แยกใช้ DOM สังเคราะห์ตรวจ virtualized growth ได้ใน 351 ms, เก็บครบหก key, nested scroll เคลื่อน 800 px โดยไม่เลื่อน document และไม่มี page error

บนเบราว์เซอร์จริงของเจ้าของ หลังแก้พบ owned reader `visible` และ `hasFocus=true`, scroll checkpoints คืบหน้าจาก 4 ไป 15/17 และตัวรอ no-growth จบใน 1000–1001 ms โดยไม่ timeout มีโพสต์ใหม่เข้าแล้วอย่างน้อยหนึ่งรายการ; รอบอ่านทั้งสี่กลุ่มคืบหน้า (เช่น Nexups 19, Roblox 18, กลุ่มแลกเปลี่ยน 5, PUBG 7 ในช่วงตรวจ) ตัวเลขนี้เป็นโพสต์ที่ตรวจพบรวม known/old ไม่ใช่ยอด insert ทั้งหมด

ถอด instrumentation/private debugger ออกจาก launcher และเริ่มเบราว์เซอร์แบบปกติหลังตรวจแล้ว ไม่มีการเรียกส่งคอมเมนต์จริงหรือเปิดกฎส่งเพิ่ม

หลังเริ่มแบบปกติโดยไม่มี debugger ตรวจ heartbeat 1.11.7 ใหม่ได้อีกครั้ง ยอดรับใหม่เพิ่มเป็นสามรายการและ lastError ว่าง สถานะส่งคอมเมนต์ยัง `stopped` และ Emergency Stop ยังเปิด จอ viewer และเว็บยังรันต่อหลังปิดฐานข้อมูลทดสอบแล้ว
