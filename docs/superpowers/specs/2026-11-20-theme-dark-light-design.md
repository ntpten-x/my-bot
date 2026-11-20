# ธีม Dark / Light กลางทั้งโปรเจกต์

เจ้าของอนุมัติ: ขอบเขตเต็มระบบ (A) · จำโหมดด้วย `localStorage` + ปุ่มใน shell (A) · แนวทาง semantic tokens ใน `globals.css` + `class` บน `<html>` (1) · ใช้ Tailwind เป็นทางเรียกสี · default = dark

## เป้าหมาย

ให้ MY-BOT มีโหมด dark และ light ที่สลับได้ทันที อ่านง่าย ทันสมัย เรียบง่าย สบายตา โดยสีและโทเคนอยู่ที่ `src/app/globals.css` ที่เดียว ทั้งโปรเจกต์เรียกผ่าน Tailwind utilities

## พาเลต

แนว radar console: พื้นเรียบ ตัดด้วยน้ำเงินอ่อน ไม่ใช้โทนครีม/clay/pine เดิม

| โทเคน | Dark | Light | บทบาท |
| --- | --- | --- | --- |
| `bg` | `#0B0F14` | `#F7F9FC` | พื้นหน้า |
| `fg` | `#F4F7FB` | `#0B1220` | ข้อความหลัก |
| `muted` | `#9AA6B2` | `#5B6B7C` | ข้อความรอง |
| `card` | `#121821` | `#FFFFFF` | การ์ด / อินพุต |
| `line` | `#243041` | `#D7E0EA` | เส้นขอบ |
| `sidebar` | `#070A0F` | `#0E1622` | แถบเมนู (เข้มทั้งสองโหมด) |
| `accent` | `#6EB6FF` | `#2F7FEA` | ปุ่มหลัก / โฟกัส / ลิงก์สำคัญ |
| `accent-soft` | `#6EB6FF22` | `#2F7FEA18` | พื้นไฮไลต์อ่อน |
| `warn` | `#E6C35C` | `#B8860B` | เตือน / ป้ายเดิมที่ใช้ amber |
| `ok` | `#3DDC97` | `#0F8A5F` | สถานะปกติ |
| `danger` | `#FF7B72` | `#C62828` | ข้อผิดพลาด |

สถานะ ok / warn / danger ไม่ผูกกับ clay/pine และต้องอ่านได้บนทั้งสองพื้น

## Tailwind เป็นทางหลัก

- ประกาศโทเคนใน `globals.css` ผ่าน `@theme` ของ Tailwind v4 เช่น `--color-bg`, `--color-fg`, …
- ในคอมโพเนนต์ใช้คลาส `bg-bg`, `text-fg`, `border-line`, `bg-accent`, `text-muted`, `bg-card`, `bg-sidebar`
- ค่าโทเคนเปลี่ยนตาม `html.dark` / `html.light` (CSS custom properties บน `:root` / `.dark` / `.light`)
- ไม่สร้างระบบคลาสธีมแยกนอก Tailwind ยกเว้นกฎ `body` และการกันแฟลชที่จำเป็น

### Compatibility aliases

ชื่อเก่าที่โปรเจกต์ใช้อยู่แล้ว map ไปโทเคนใหม่ เพื่อลดการแก้ทั้ง repo ในรอบเดียว:

| ชื่อเก่า | ชี้ไป |
| --- | --- |
| `paper` | `bg` |
| `ink` | `fg` |
| `clay` / `clay-dark` | `accent` |
| `pine` | `accent` |
| `amber` | โทเคน `warn` ใหม่ (เหลืองอ่อนอ่านง่ายทั้งสองโหมด) ไม่ใช่ accent |

จุดที่ hardcode สี Tailwind ดิบและอ่านยากบนพื้นมืด (เช่น `text-red-700`, `bg-emerald-50`) ปรับเป็นโทเคนสถานะหรือความทึบที่เข้าโทน

## ฟอนต์

- UI หลัก: Geist (ผ่าน `next/font`)
- ไทย: IBM Plex Sans Thai เป็นส่วนของ stack / fallback
- `--font-sans` ใน `@theme` ชี้ไปที่ตัวแปรฟอนต์นี้ ทั้งแอปใช้ `font-sans`

## สลับโหมด

1. Default = `dark` เมื่อยังไม่มีค่าใน storage
2. เก็บที่ `localStorage.theme` เป็น `"dark"` หรือ `"light"` เท่านั้น (ไม่มีโหมด system ในรอบนี้)
3. สคริปต์สั้นใน `src/app/layout.tsx` อ่านค่าก่อน paint แล้วใส่คลาสบน `<html>` เพื่อกันแฟลชพื้นสว่าง
4. คอมโพเนนต์ `ThemeToggle` ใหม่ — ปุ่มสลับ + เขียน storage + อัปเดตคลาสบน `<html>`
5. วางปุ่มใน `shell.tsx`: เดสก์ท็อปใกล้โลโก้หรือเหนือออกจากระบบ · มือถือใน header
6. เคารพ `prefers-reduced-motion`

## ไฟล์ที่แตะ

| ไฟล์ | งาน |
| --- | --- |
| `src/app/globals.css` | โทเคน `@theme` + ค่า dark/light |
| `src/app/layout.tsx` | ฟอนต์, anti-flash script, คลาสบน `html` |
| `src/components/theme-toggle.tsx` | ใหม่ — สลับโหมด |
| `src/components/shell.tsx` | วางปุ่ม + สีเมนู/header |
| `src/components/ui.tsx` | Button / Input / Card / Badge ใช้โทเคน |
| หน้า/คอมโพเนนต์ที่ใช้สีเก่าหรือ hardcode อ่านยาก | ไล่ให้เข้าโทน |
| `src/app/manifest.ts` | `theme_color` ให้เข้าโทนใหม่ |

## นอกขอบเขต

- ไม่เก็บธีมลง DB หรือหน้าตั้งค่าเซิร์ฟเวอร์
- ไม่มีโหมด `system` / auto ตาม OS
- ไม่รีดีไซน์เลย์เอาต์หน้าหรือโครงสร้างเมนู
- ไม่แตะ Chrome extension หรือ Desktop package
- ไม่เพิ่มไลบรารีธีมภายนอก (เช่น next-themes)

## ตรวจรับ

- สลับโหมดแล้วทั้งแอปเปลี่ยนตามทันที
- รีเฟรชแล้วยังจำค่าจาก `localStorage`
- ครั้งแรก / ไม่มีค่าใน storage = dark
- ไม่มีแฟลชพื้นขาวตอนโหลดเมื่อเลือก dark
- คอมโพเนนต์หลัก (shell, ui, login, feed, overview) อ่านง่ายทั้งสองโหมด
- `npm test` และ `npm run build` ผ่านก่อน commit โค้ด
