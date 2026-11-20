# จัดโครงสร้างแอป MY-BOT (layout + layers)

เจ้าของอนุมัติ: ขอบเขตทั้ง `src/` (A) · โครงผสม layer + features (C) · มี re-export shim path เก่า (A) · ลงมือแบบ AppShell ก่อนแล้วค่อยย้ายทีละกลุ่ม (แนวทาง 1)

## เป้าหมาย

ให้โค้ดฝั่งเว็บมีโครงสร้างที่อ่านและขยายได้ชัด: แยก UI ดิบ, เลย์เอาต์แอป, ฟีเจอร์ตามโดเมน, บริการฝั่ง client, และ utility — โดยไม่เปลี่ยน URL, API contract, หรือพฤติกรรมธุรกิจ

## ข้อจำกัดของแพลตฟอร์ม

- Next.js App Router: `page.tsx` / `layout.tsx` / `route.ts` อยู่ใต้ `src/app/` เท่านั้น
- URL หน้าและเส้นทาง `/api/*` ไม่เปลี่ยนในรอบนี้
- `src/worker/` คงที่
- ไม่แตะ `extension/`, Desktop package, Prisma schema
- ธีม dark/light ที่มีอยู่แล้วใช้ต่อ ไม่รีดีไซน์สีในงานนี้

## โครงโฟลเดอร์เป้าหมาย

```
src/
  app/                         # routes เท่านั้น (หน้าบางลง)
  components/
    ui/                        # Button, Input, Card, Badge, Dialog, …
    layout/                    # AppShell, Header, Sidebar, Main, Footer, ThemeToggle
  features/
    feed/                      # lead-card, feed-sample-audit, …
    comments/                  # reply-queue, comment-* UI, type-comment-form, …
    settings/                  # security-controls, auth-sessions, ai-provider-usage, …
    overview/                  # system-overview, …
    sources/                   # source-binding, group-taxonomy, …
  services/                    # client API helpers (เช่น api fetch wrapper)
  utils/                       # cn, format, helpers ไร้โดเมนหนัก
  lib/                         # โดเมนเซิร์ฟเวอร์ที่นิ่ง (ai/, pipeline/, auto-comment/, smart/)
                               # ไม่ย้ายทั้งก้อนในรอบนี้
  shared/                      # types/constants ข้ามชั้นเมื่อจำเป็น
  worker/                      # ไม่เปลี่ยนโครงสร้างในรอบนี้
```

การแมปจากของเดิม (ตัวอย่าง):

| ของเดิม | เป้าหมาย |
| --- | --- |
| `components/shell.tsx` | `components/layout/app-shell.tsx` (+ header/sidebar/main/footer) |
| `components/ui.tsx`, `dialog.tsx` | `components/ui/*` |
| `components/theme-toggle.tsx` | `components/layout/theme-toggle.tsx` |
| `components/lead-card.tsx`, `feed-sample-audit.tsx` | `features/feed/*` |
| `components/reply-queue-panel.tsx`, `comment-*.tsx`, `type-comment-form.tsx` | `features/comments/*` |
| `components/security-controls.tsx`, `auth-sessions.tsx`, `ai-provider-usage.tsx` | `features/settings/*` |
| `components/system-overview.tsx` | `features/overview/*` |
| `components/source-binding.tsx`, `group-taxonomy.tsx` | `features/sources/*` |
| `components/api.ts` | `services/api.ts` (หรือ `services/http.ts`) |
| `lib/utils.ts`, `lib/format.ts`, … ที่เบา | `utils/*` เมื่อย้ายในเฟส utils |
| `lib/ai`, `lib/pipeline`, `lib/auto-comment`, `lib/smart` | คงใน `lib/` รอบนี้ |

## AppShell

แทนที่ `Shell` ก้อนเดียวด้วยชิ้นเลย์เอาต์แยกไฟล์:

| ชิ้น | หน้าที่ |
| --- | --- |
| `AppShell` | โครงกริด / รวมชิ้น; API สาธารณะเทียบเท่า `Shell` เดิม (`children`) |
| `Sidebar` | โลโก้, นำทางเดสก์ท็อป, ปุ่มธีม, ออกจากระบบ |
| `Header` | แถบมือถือ: ชื่อแอป, ธีม, ออก, เมนูเลื่อนแนวนอน |
| `Main` | พื้นที่ `children` + max-width ตามของเดิม |
| `Footer` | แถบบาง: เวอร์ชันแอปและ/หรือลิงก์วิธีใช้ — ไม่โชว์ความลับ |

`src/app/(app)/layout.tsx` ยังห่อ `LiveUpdatesProvider` และใส่ `ExtensionAutoConnect` ภายใน shell เหมือนเดิม เปลี่ยนเฉพาะการประกอบชิ้นเลย์เอาต์

พฤติกรรมเดิมที่ต้องคงไว้: รายการเมนู, unread notifications, logout, ThemeToggle (ซิงก์สองจุด), StepUpPrompt, live revision refresh

## กลยุทธ์ Shim

- ย้ายไฟล์ไปที่ใหม่ แล้วให้ path เก่ายังเป็นไฟล์บางๆ ที่ re-export ของใหม่
- ตัวอย่าง: `src/components/shell.tsx` → `export { AppShell as Shell, AppShell } from "@/components/layout/app-shell"`
- อย่าทำ logic ใน shim
- เฟสสุดท้าย: หา import ที่ยังชี้ path เก่า แล้วลบ shim ที่ไม่มีผู้ใช้

## เฟสงาน

แต่ละเฟสจบด้วย `npm test` และ `npm run build` ผ่าน

1. **Layout** — แยก AppShell / Header / Sidebar / Main / Footer; shim `shell.tsx`
2. **UI kit** — ย้าย primitives ไป `components/ui/*`; shim `ui.tsx` / `dialog.tsx`
3. **Features** — ย้ายคอมโพเนนต์โดเมนไป `features/*` ตามตาราง; ใส่ shim path เก่า
4. **Services / utils** — ย้าย client API helper และ util เบา; shim ตามจำเป็น
5. **Thin pages** — ปรับหน้า `app/(app)` ให้ import จาก layout/features เป็นหลัก (ไม่ย้าย route)
6. **Cleanup** — ลบ shim ที่ว่างคนใช้; อัปเดต `AGENTS.md` โครงสั้นๆ

## นอกขอบเขต

- เปลี่ยน URL หรือสัญญา API ภายนอก (รวม extension)
- รีแฟกเตอร์โดเมนใน `lib/ai`, `lib/pipeline`, `lib/auto-comment`, `lib/smart` ทั้งก้อน
- เปลี่ยนพฤติกรรมคะแนนลีด / คอมเมนต์ / ingest
- เพิ่มไลบรารีโครงสร้าง (เช่น Nx, Turborepo packages)

## ตรวจรับ

- มีโฟลเดอร์ `components/ui`, `components/layout`, `features/*`, `services` (อย่างน้อยหลังเฟส 4)
- Header / Sidebar / Main / Footer แยกไฟล์และถูกใช้โดย AppShell
- หน้าเดิมเปิดได้; เมนู, ธีม, logout ทำงานเหมือนก่อนย้าย
- Path เก่ายัง import ได้ผ่าน shim จนกว่าเฟส 6
- `npm test` และ `npm run build` ผ่านทุกเฟสที่ merge
