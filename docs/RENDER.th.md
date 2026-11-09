# MY-BOT บน Render (โหมดคลาวด์)

เว็บ: https://my-bot-e6bt.onrender.com · Render ดีพลอยใหม่เองทุกครั้งที่ push `master`

ก่อนนำ Branch ความปลอดภัยขึ้นจริง ให้อ่าน [Production Readiness และแผน Apply/Rollback](PRODUCTION-READINESS.th.md) ต้องปิด FAIL/BLOCKED ที่เกี่ยวข้องและได้รับอนุญาตก่อน Push/Deploy

## ตัวแปรที่ต้องตั้งใน Render → Environment

| ตัวแปร | จำเป็น | หมายเหตุ |
|---|---|---|
| `DATABASE_URL` | ✅ | Supabase pooled connection (เหมือนใน `.env` บนเครื่อง) |
| `DIRECT_URL` | ✅ | Supabase direct connection (ใช้ตอน migrate) |
| `AI_KEY_SECRET` | ✅ | **ต้องเป็นค่าเดียวกับใน `.env` บนเครื่อง** ไม่งั้นอ่าน API key ที่บันทึกไว้ไม่ได้ ถ้าไม่ตั้ง เซิร์ฟเวอร์จะไม่ยอมเริ่ม (ตั้งใจ) |
| `NODE_ENV` | ✅ | `production` |
| `GROQ_API_KEY`, `GEMINI_API_KEY` | ไม่บังคับ | หรือใส่ในหน้า “ผู้ให้บริการ AI” ก็ได้ — Gemini ใช้ทำ embedding แทน Ollama บนคลาวด์ |
| `OLLAMA_DISABLED` | ไม่บังคับ | `1` = ข้าม Ollama ทันที (ไม่ตั้งก็ได้ ระบบตรวจเองและข้ามเมื่อเชื่อมไม่ได้) |
| `PORT` | ไม่ต้อง | Render ใส่ให้เอง |

ห้ามใส่ secret ในตัวแปรที่ขึ้นต้น `NEXT_PUBLIC_` (จะไปอยู่ในโค้ดฝั่งเบราว์เซอร์)

## ตั้งค่าบริการ

- Build command: `npm ci --include=dev && npm run build` · Start command: `npm start` เพื่อเปิดทั้ง Web และ Worker (Build ต้องใช้ Prisma CLI/TypeScript ใน devDependencies; ตัวรัน Worker `tsx` เป็น runtime dependency)
- Health check path: **`/health`** (ตอบ 200 เมื่อ ok/degraded, 503 เมื่อ down)
- Migration: ฐานข้อมูล Supabase ใช้ร่วมกับเครื่อง ตอนนี้ migrate จากเครื่องแล้ว ถ้าอยากให้ Render ทำเอง ตั้ง Pre-deploy command เป็น `npx prisma migrate deploy`
- **Free tier หลับ** หลังไม่มีคนเรียก ~15 นาที เรียกครั้งแรกจะช้า 30–60 วินาที ส่วนขยายจะลองใหม่เองรอบถัดไป ถ้าต้องการให้ตื่นตลอดให้ใช้แผนแบบเสียเงิน
- Ollama ไม่มีบนคลาวด์: หน้า AI แสดง “ข้าม (เซิร์ฟเวอร์นี้ไม่มี Ollama)” การจัดหมวดใช้ผู้ให้บริการคลาวด์ตัวถัดไป และ embedding ใช้ Gemini หรือปิดการค้นหาเชิงความหมายเงียบ ๆ

## ส่วนขยาย Chrome (v1.11.17)

1. เข้าเว็บ → ตั้งค่า → ส่วนขยาย Chrome → ดาวน์โหลด .zip แล้วแตกไฟล์
2. `chrome://extensions` → เปิด Developer mode → Load unpacked → เลือกโฟลเดอร์ `mybot-extension` (ถ้าติดตั้งเดิมไว้ ให้แตกทับแล้วกดโหลดซ้ำ)
3. ส่วนขยายเปิดหน้า MY-BOT ให้เอง หากยังไม่ได้ล็อกอินให้ล็อกอินตามปกติ
4. ระบบเชื่อมต่ออุปกรณ์อัตโนมัติ ไม่ต้องใส่ URL หรือรหัสจับคู่ ดู [แบบการเชื่อมต่อและการกู้คืน](EXTENSION-AUTO-CONNECT.th.md)
5. ยกเลิกอุปกรณ์ได้จากรายการในหน้าเดียวกัน

## ความปลอดภัย

- ทุก endpoint ของส่วนขยายต้องใช้โทเคนอุปกรณ์ (`mbd_…`, เก็บแบบ hash) ผ่าน HTTPS; โทเคนแบบเดิมใช้ได้เฉพาะ localhost
- ล็อกอินผิด 5 ครั้ง/15 นาที ต่อ IP ล็อก 15 นาที (รวมทั้งระบบ 20 ครั้ง)
- คุกกี้ `Secure; HttpOnly; SameSite=Lax` เมื่อเข้าผ่าน HTTPS
- CORS อนุญาตเฉพาะ `chrome-extension://` และโดเมนของเว็บเอง
- ถ้ารหัสผ่านอ่อน หลังล็อกอินจะพาไปหน้า ตั้งค่า → ความปลอดภัย เพื่อเปลี่ยน (≥12 ตัว ตัวอักษร+ตัวเลข+ตัวพิมพ์ใหญ่หรือสัญลักษณ์)

## โหมดคอมเมนต์ผ่าน Extension v1.9.0

เริ่มที่ `/getting-started` และอ่าน [คู่มือปัจจุบัน](BROWSER-COMMENTS.th.md) Chrome บนเครื่องเจ้าของต้องเปิดและล็อกอิน Facebook อยู่ ทั้งการอ่านกลุ่มและการส่งขึ้นกับเครื่องนี้ Worker ปกติไม่เรียก Graph API เพื่อคอมเมนต์ โหมดส่งมีสวิตช์รับงานบนอุปกรณ์ + กฎที่ยืนยันสิทธิ์ + Dry Run แยกกัน Migration ใหม่ต้องทดสอบฐานแยกก่อน ไม่ apply Production โดยอัตโนมัติ
