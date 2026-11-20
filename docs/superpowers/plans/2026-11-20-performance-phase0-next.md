# Performance Phase 0 baseline + next steps

> **For agentic workers:** Use this after the roadmap spec. Phase 0 is measurement; implementation tasks below are ops-first then code only where numbers justify it.

**Goal:** บันทึกฐานประสิทธิภาพ และปลดบล็อกการเก็บกลุ่มก่อนไป optimize ลึก

**Spec:** `docs/superpowers/specs/2026-11-20-performance-scale-roadmap-design.md`

## Phase 0 results (2026-11-20 local)

| Metric | Value | Note |
| --- | --- | --- |
| Doctor | fail=0 warn=0 | OK |
| Health | `{ ok: true, version: 1.3.7 }` | Port 8001 |
| Posts | 360 total · 11 / 24h · 360 / 7d | Volume ยังเล็ก; ค้นหาไม่ใช่คอขวดหลักตอนนี้ |
| Sources enabled | 14 / 14 facebook_group | ทั้งหมด interval 10 นาที priority normal |
| Overdue sources | **14 / 14** (~24 ชม.) | scrape หยุดจริง |
| Extension heartbeat | สดสุด ~19 Nov · **v1.11.30** (ถูกระงับ) และ v1.11.35 เก่า | ไม่มี heartbeat วันนี้ |
| Tab status | version 1.11.30, readers=0 | ไม่มีการอ่าน |
| Worker | leader ทำงาน · last tick สด | OK |
| DB query (worker_perf) | p50 **185ms** · p95 **511ms** (n=200) | สูงกว่า “เบา” แต่ยังไม่พังที่ 360 โพสต์ |
| Worker polls | idle 419 · active 0 ใน snapshot | คิวว่างเพราะไม่มี scrape |
| SSE active | 0 | ไม่มีเซสชัน UI ที่เปิด stream ตอนวัด |
| AI jobs | ว่าง · post processingState ทั้งหมด `done` | สอดคล้องคิว AI ที่ stub |
| `profile:reads --db` | feed/search/unread estimatedCost ต่ำ | แผนสอบถามไม่แพงที่ขนาดข้อมูลปัจจุบัน |
| Unread notifications | 66 | ไม่ใช่คอขวดความเร็ว แต่รก UI |

**ข้อสรุปเฟส 0:** คอขวดหลักตอนนี้ไม่ใช่ Next/UI หรือ query plan — คือ **ส่วนขยายไม่ส่งงานอ่าน (รุ่นเก่า/ไม่สด)** ทำให้ทุกกลุ่ม overdue งาน optimize ลึกจะไร้ผลจนกว่า scrape จะกลับมา

## Global Constraints

- Single-owner; ห้ามเพิ่ม concurrency ส่งคอมเมนต์หรือปิด lease
- Extension floor ต้องเป็นรุ่นที่เซิร์ฟเวอร์รับ (ปัจจุบันคาด **1.11.35**)
- วัดซ้ำหลังปลดบล็อก scrape ก่อนตัดสินใจ index/AI

---

### Task 1: Restore collection (ops — เจ้าของ)

**ไม่ใช่โค้ด** — ต้องทำบนเครื่อง Chrome ของเจ้าของ

- [ ] อัปเดต/โหลด unpacked extension จาก `extension/` ให้เป็น **1.11.35** (หรือใหม่กว่าที่ repo มี)
- [ ] ปิด installation รุ่น 1.11.30 ที่ยังโชว์ใน overview (ถ้ามีหลายตัว)
- [ ] ล็อกอิน Facebook ในโปรไฟล์ที่จับคู่; ตรวจ pairing กับแอป
- [ ] ยืนยัน heartbeat สดรุ่นถูกต้องบน **ภาพรวมระบบ**
- [ ] รอ 1–2 รอบ scrape แล้วตรวจว่า overdue ลด และมีโพสต์ใหม

**ตรวจรับ:** heartbeat อายุ < 5 นาที · version ตรง · อย่างน้อยบางแหล่ง `lastExtensionAt` ขยับ

---

### Task 2: Re-measure after scrape lives (Phase 0 bis)

- [ ] รัน doctor อีกครั้ง
- [ ] อ่านภาพรวม → ประสิทธิภาพ runtime (DB p95, SSE, worker active/idle)
- [ ] นับ posts/24h และ overdue อีกครั้งด้วยสคริปต์หรือ UI
- [ ] ถ้า DB p95 ยัง > ~500ms หลังมีโหลดจริง → เข้าเฟส 1 (pool/settings)
- [ ] ถ้า overdue ยังสูงทั้งที่ heartbeat ดี → เข้าเฟส 2 (priority / max_posts_per_run / stall)
- [ ] ถ้า UI สะดุดตอนมี SSE → เข้าเฟส 3

---

### Task 3: Phase 1 only if numbers say so

โฟกัสเมื่อ scrape กลับมาแล้ว:

- [ ] ตรวจ `DB_CONNECTION_LIMIT` / การแชร์ pool กับ Render
- [ ] ยืนยัน host ไหนเป็นจุด ingest หลัก
- [ ] ลด maintenance ชนพีคถ้า tick p95 สูง

อย่าเริ่ม Task 3 ก่อน Task 1–2 ผ่าน

---

### Task 4: Commit roadmap docs (เมื่อเจ้าของสั่ง)

ไฟล์ที่ยังอาจ untracked บน master:

- `docs/superpowers/specs/2026-11-20-performance-scale-roadmap-design.md`
- `docs/superpowers/plans/2026-11-20-performance-phase0-next.md`

---

## Recommended next human action

**ทำ Task 1 ก่อนทุกอย่าง** — อัปเดต extension เป็น 1.11.35 และให้ heartbeat สด จากนั้นบอกเมื่อพร้อมจะวัดซ้ำ (Task 2)
