# MY-BOT บน Render (โหมดคลาวด์)

เว็บ: https://my-bot-e6bt.onrender.com · Render ดีพลอยใหม่เองทุกครั้งที่ push `master`

การ push สำเร็จยืนยันเฉพาะ GitHub ไม่ได้ยืนยันว่า production ใช้ commit ใหม่แล้ว ตรวจ Events/Deploys ใน Render ว่า commit เป้าหมายเป็น Live หากตั้ง Auto-Deploy เป็น After CI Checks Pass ต้องรอ GitHub checks ผ่านทุกขั้น หากเป็น Off ต้องใช้ Manual Deploy → Deploy latest commit ไม่เปลี่ยน secrets หรือรัน migration ซ้ำเพื่อแก้ปัญหาเวอร์ชันเก่า

หลัง deploy ตรวจด้วย `node scripts/verify-production-release.mjs https://my-bot-e6bt.onrender.com <commit-sha>` หรือเรียก `GET /api/v1/health` และ `GET /health`: body สาธารณะยังมีเพียง `ok` กับ `version` ส่วน header `X-MYBOT-Desktop-Version`, `X-MYBOT-Extension-Version`, `X-MYBOT-Commit` (เมื่อ Render มี `RENDER_GIT_COMMIT`) ใช้ยืนยันรุ่นที่รันจริง response เป็น no-store ไม่เผย credentials หาก header ยังไม่มี ให้ตรวจ deploy แทนการสรุปว่า push ไม่สำเร็จ

GitHub Actions workflow `Verify production release` จะรอ `Verify MY-BOT` ผ่านบน `master` แล้วโพล header บน production ให้เอง หาก Render ตั้ง Auto-Deploy เป็น After CI Checks Pass แต่ Events ยังไม่ขึ้น Live ให้ Manual Deploy → Deploy latest commit

ก่อนนำ Branch ความปลอดภัยขึ้นจริง ให้อ่าน [Production Readiness และแผน Apply/Rollback](PRODUCTION-READINESS.th.md) ต้องปิด FAIL/BLOCKED ที่เกี่ยวข้องและได้รับอนุญาตก่อน Push/Deploy

## ตัวแปรที่ต้องตั้งใน Render → Environment

| ตัวแปร | จำเป็น | หมายเหตุ |
|---|---|---|
| `DATABASE_URL` | ✅ | Supabase pooled connection (เหมือนใน `.env` บนเครื่อง) |
| `DIRECT_URL` | ✅ | Supabase direct connection (ใช้ตอน migrate) |
| `AI_KEY_SECRET` | ✅ | **ต้องเป็นค่าเดียวกับใน `.env` บนเครื่อง** ไม่งั้นอ่าน API key ที่บันทึกไว้ไม่ได้ ถ้าไม่ตั้ง เซิร์ฟเวอร์จะไม่ยอมเริ่ม (ตั้งใจ) |
| `NODE_ENV` | ✅ | `production` |
| `PUBLIC_APP_URL` | แนะนำ | URL สาธารณะของเว็บ เช่น `https://my-bot-e6bt.onrender.com` ใช้ในลิงก์แจ้งเตือน watchdog |
| `BACKUP_UPLOAD_URL` | แนะนำบนคลาวด์ | URL รับอัปโหลด backup นอกโฮสต์ (เช่น object storage) ถ้าไม่ตั้ง worker บน Render จะบันทึกความล้มเหลวและข้ามการสำรองไฟล์ในดิสก์ ephemeral |
| `BACKUP_UPLOAD_TOKEN` | ตามปลายทาง | Token/Bearer สำหรับอัปโหลดถ้าปลายทางต้องการ |
| `GROQ_API_KEY`, `GEMINI_API_KEY` | ไม่บังคับ | หรือใส่ในหน้า “ผู้ให้บริการ AI” ก็ได้ — Gemini ใช้ทำ embedding แทน Ollama บนคลาวด์ |
| `OLLAMA_DISABLED` | ไม่บังคับ | `1` = ข้าม Ollama ทันที (ไม่ตั้งก็ได้ ระบบตรวจเองและข้ามเมื่อเชื่อมไม่ได้) |
| `PORT` | ไม่ต้อง | Render ใส่ให้เอง |

ห้ามใส่ secret ในตัวแปรที่ขึ้นต้น `NEXT_PUBLIC_` (จะไปอยู่ในโค้ดฝั่งเบราว์เซอร์)

## ตั้งค่าบริการ

- Build command: `npm ci --include=dev && npm run build` · Start command: `npm start` เพื่อเปิดทั้ง Web และ Worker (Build ต้องใช้ Prisma CLI/TypeScript ใน devDependencies; ตัวรัน Worker `tsx` เป็น runtime dependency)
- Health check path: **`/health`** (ตอบ 200 เมื่อ ok/degraded, 503 เมื่อ down หรือเมื่อ worker หายหลังเริ่มเกิน 3 นาที) พร้อม header รุ่นเดียวกับ `/api/v1/health`
- Migration: ตั้ง **Pre-deploy command** เป็น `npx prisma migrate deploy` และให้ fail ทั้ง deploy เมื่อ migrate ไม่ผ่าน ฐาน Supabase ใช้ร่วมกับเครื่อง — อย่ารัน migrate ซ้ำจากหลายโฮสต์พร้อมกัน
- **Free tier หลับ** หลังไม่มีคนเรียก ~15 นาที เรียกครั้งแรกจะช้า 30–60 วินาที และงานตามตารางใน worker (สรุปรายวัน, backup, watchdog, คิว AI) จะหยุดช่วงหลับ ส่วนขยายจะลองใหม่เองรอบถัดไป ถ้าต้องการอ่าน/ส่งต่อเนื่อง 24 ชม. ต้องใช้แผน always-on หรือตัวปลุกภายนอก
- Ollama ไม่มีบนคลาวด์: หน้า AI แสดง “ข้าม (เซิร์ฟเวอร์นี้ไม่มี Ollama)” การจัดหมวดใช้ผู้ให้บริการคลาวด์ตัวถัดไป และ embedding ใช้ Gemini หรือปิดการค้นหาเชิงความหมายเงียบ ๆ

## ส่วนขยาย Chrome (v1.11.21)

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

## โหมดคอมเมนต์ผ่าน Extension (ปัจจุบัน)

เริ่มที่ `/getting-started` และอ่าน [คู่มือปัจจุบัน](BROWSER-COMMENTS.th.md) Chrome บนเครื่องเจ้าของต้องเปิดและล็อกอิน Facebook อยู่ ทั้งการอ่านกลุ่มและการส่งขึ้นกับเครื่องนี้ Worker ปกติไม่เรียก Graph API เพื่อคอมเมนต์ หน้าใช้งานเป็นโหมดส่งจริงตามกฎที่เปิด (ไม่มีปุ่ม Dry Run ใน UI) Migration ใหม่ต้องทดสอบฐานแยกก่อน ไม่ apply Production โดยอัตโนมัติ
