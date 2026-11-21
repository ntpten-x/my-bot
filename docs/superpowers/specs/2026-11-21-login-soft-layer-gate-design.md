# รีดีไซน์หน้า Login — Soft Layer Gate

เจ้าของอนุมัติ: โทนเรียบหรูสมัยใหม่ (A) · motion เกือบนิ่ง (A) · โชว์รหัสผ่าน + MFA ยุบ (C) · แนวทาง Soft Layer Gate (1)

แทนที่สไตล์ “Radar Quiet Gate” บน `/login` ให้สวยและใช้งานง่ายขึ้น โดยไม่เปลี่ยน auth และไม่เพิ่มคอขวดด้านประสิทธิภาพ

## เป้าหมาย

- หน้า `/login` ดูทันสมัย เรียบหรู อ่านง่าย ใช้งานเร็ว
- MY-BOT เป็นฮีโร่ของ viewport แรก
- ลดขั้นตอนที่รก: MFA ยุบเป็นตัวเลือก · มีโชว์/ซ่อนรหัสผ่าน
- คงพฤติกรรม auth เดิมครบ
- ไม่ทำให้เว็บช้า: ไม่มี asset/ฟอนต์/ไลบรารี/animation หนักเพิ่ม

## สถานะเดิม

`src/app/login/page.tsx` เป็น Radar Quiet Gate แล้ว (แบรนด์กลาง + ThemeToggle + การ์ด) แต่ยังแบนเกินไป MFA โชว์ตลอด และไม่มีโชว์รหัสผ่าน

## เลย์เอาต์

Viewport เดียว กลางจอ:

1. **ThemeToggle** มุมบนขวา
2. **Soft layer พื้นหลัง** — 1–2 ชั้น CSS คงที่ (`radial-gradient` โปร่งใบบนโทเคนธีม) ไม่มีรูป ไม่มี blur หนัก ไม่มี animation
3. **แบรนด์** กลางบน: `MY-BOT` ขนาดใหญ่ + ประโยครองหนึ่งบรรทัด
4. **แผงฟอร์ม** กว้างสูงสุดประมาณ `28rem`: ช่องกรอก → error → ปุ่ม → ลิงก์ลืมรหัส

ไม่สปลิตสองคอลัมน์ · ไม่ภาพฮีโร่ · ไม่แถบข้างจอ

สถานะโหลด (`/api/auth/status`): ข้อความสั้นในพื้นที่แผง ไม่สปินเนอร์รกทั้งหน้า

## สไตล์ (โทเคนที่มีอยู่)

| องค์ประกอบ | แนว |
| --- | --- |
| พื้น | `bg` + soft layer จาก `accent`/`fg` ความทึบต่ำ |
| หัว MY-BOT | `fg` · semibold · tracking-tight · display |
| ประโยครอง | `muted` · หนึ่งบรรทัด |
| แผงฟอร์ม | `card` + `border-line` · มุมมนตาม UI เดิม · เงาเบาสุดหรือไม่มี |
| อินพุต | สูงขึ้นเล็กน้อย · โฟกัส ring `accent` |
| ป้าย | `fg` / medium |
| คำใบ้ | `muted` · เล็ก |
| ปุ่มหลัก | `bg-accent` + `text-on-accent` · เต็มความกว้าง |
| ลิงก์ | `accent` |
| error | `danger` + `role="alert"` |

ฟอนต์: Geist + IBM Plex Sans Thai ตามเลย์เอาต์แอป — **ไม่โหลดฟอนต์ใหม่**

ห้าม: ม่วง/glow การ์ดซ้อน · multi-layer shadow · `backdrop-filter` · ALL-CAPS eyebrow แบบเทมเพลต

## ฟอร์มและพฤติกรรม

ลำดับฟิลด์:

1. **ชื่อผู้ใช้** — validation / autocomplete / ค่าเริ่ม `admin` ตามเดิม + คำใบ้สั้น
2. **รหัสผ่าน** — ปุ่มโชว์/ซ่อนในช่อง สลับ `type` text/password · `aria-label` / `aria-pressed` ชัด
3. **MFA ยุบ** — ค่าเริ่มปิด; ปุ่มหรือลิงก์ “มีรหัส Authenticator” เปิดช่อง `#otp`; เว้นว่างได้; เมื่อปิดหรือไม่กรอก ส่ง `code` เป็นสตริงว่าง
4. **ปุ่มเข้าสู่ระบบ** — disabled ตอน busy
5. **ลิงก์** `/reset-password`

คง logic เดิม:

- `GET /api/auth/status` → authenticated → `/dashboard`; needsSetup → `/setup`
- `POST /api/auth/login` ด้วย `{ username, password, code }`
- weak password หรือ mfaSetupRequired → `/settings/security` มิฉะนั้น `/dashboard`
- แสดง error จาก `ApiError`

Motion: **เกือบนิ่ง** — ไม่มี fade-in ตอนโหลด · ไม่มี transition วน; อนุญาตเฉพาะ feedback พื้นฐานของเบราว์เซอร์/คอมโพเนนต์ UI เดิม

## Copy (ไทย)

| จุด | ข้อความ |
| --- | --- |
| แบรนด์ | MY-BOT |
| รอง | เรดาร์ลีดส่วนตัวของเครื่องนี้ |
| ชื่อผู้ใช้ | ชื่อผู้ใช้ |
| คำใบ้ชื่อผู้ใช้ | บัญชีเดิมใช้ชื่อ admin |
| รหัสผ่าน | รหัสผ่าน |
| โชว์รหัส | แสดงรหัสผ่าน / ซ่อนรหัสผ่าน |
| เปิด MFA | มีรหัส Authenticator |
| ปิด MFA (ถ้ามี) | ซ่อนรหัส Authenticator |
| MFA label | รหัส Authenticator |
| คำใบ้ MFA | เว้นว่างได้ถ้ายังไม่เปิด MFA |
| ปุ่ม | เข้าสู่ระบบ |
| Busy | กำลังเข้าสู่ระบบ… |
| โหลด | กำลังเตรียมหน้าเข้าสู่ระบบ… |
| ลิงก์ | ลืมรหัสผ่าน |

## ประสิทธิภาพ (บังคับ)

- ไม่เพิ่มรูป / video / Lottie / canvas / WebGL
- ไม่เพิ่ม dependency หรือฟอนต์ใหม่
- soft layer = CSS คงที่เท่านั้น ไม่มี JS วัด layout/พาร์ติเคิล
- ไม่ใช้ `backdrop-filter` หรือ animation ต่อเนื่อง
- state ใหม่เฉพาะ: `showPassword`, `showMfa` (หรือชื่อเทียบเท่า)
- ไม่เปลี่ยน API เรียกเพิ่มจากของเดิม (ยังมี status + login ตามเดิม)

## ไฟล์ที่คาดว่าจะแตะ

- `src/app/login/page.tsx` — โครง สไตล์ UX ฟอร์ม
- `tests/pipeline/login-ui.test.ts` — อัปเดต assertion (MFA ยุบ, ปุ่มโชว์รหัส, soft layer/โครงสร้าง)
- อาจแตะคอมโพเนนต์ UI เล็กน้อยเฉพาะถ้า Input ยังไม่รองรับปุ่มในช่อง — ถ้าแตะ ต้องไม่กระทบหน้าอื่นแบบช้าลง

ไม่บังคับย้ายไป `features/` ในรอบนี้

## นอกขอบเขต

- เปลี่ยน API, session, MFA server rules, CSP, กฎรหัสผ่าน
- รีดีไซน์ `/setup` และ `/reset-password`
- OAuth / ล็อกอินโซเชียล
- เปลี่ยนโทเคนธีมกลางทั้งแอป
- Animation โหลดหน้า / micro-interactions เกินที่ระบุ

## ตรวจรับ

- Viewport แรก: MY-BOT + ประโยครอง + ฟอร์มเดียว + soft layer เบา
- ThemeToggle ทำงาน
- โชว์/ซ่อนรหัสผ่านใช้ได้
- MFA เริ่มซ่อน; เปิดแล้วกรอก/เว้นว่างได้; ส่ง login ได้
- ล็อกอินสำเร็จ / ผิดพลาด / ลืมรหัส / redirect setup&auth เหมือนก่อน
- Dark และ light อ่านง่าย
- มือถือไม่ล้นแนวนอน
- ไม่มี asset/animation หนักในหน้า
- เมื่อลงมือ: `npm test` และ `npm run build` ผ่าน
