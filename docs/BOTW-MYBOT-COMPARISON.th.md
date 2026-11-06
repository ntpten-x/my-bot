# เปรียบเทียบ BOT-W กับ MY-BOT

> อัปเดตตามคำสั่งเจ้าของ: Runtime ปัจจุบันใช้คอมเมนต์ผ่าน Extension v1.9.0 ไม่ใช้ Graph API สำหรับงานส่งปกติ ดู [คู่มือปัจจุบัน](BROWSER-COMMENTS.th.md) เนื้อหา API ด้านล่างบันทึกขอบเขตเดิมและการทดสอบย้อนหลัง

อ้างอิง [หลักฐาน Phase A](BOTW-FEATURE-ANALYSIS.th.md) และโค้ดใน working tree ณ รอบนี้ รวมงานเดิมที่ยังไม่ commit การมีโค้ดไม่ได้ยืนยันการติดตั้งบนเครื่องเจ้าของหรือ Production

P0 = ก่อนส่งจริง, P1 = ใช้งานหลัก, P2 = ปรับปรุง; ความยากเป็นการประเมิน ยังไม่มี SLA

| ฟีเจอร์ | BOT-W | MY-BOT ที่พบ/หลักฐาน | ช่องว่าง/งานเพิ่ม | ยาก | Dependencies / สิทธิ์ | ลำดับ |
| --- | --- | --- | --- | --- | --- | --- |
| Collector กลุ่ม/Marketplace | ประกาศ A1/A3; ยังไม่ทดลอง | `extension/parser.js`, `scrape.js`, `src/lib/ingest.ts` | ทดสอบ DOM ในบัญชีเจ้าของภายหลัง; ไม่รับรองเก็บครบ | สูง | Chrome/สิทธิ์ดูข้อมูล/นโยบายแพลตฟอร์ม | P1 |
| เพจเป้าหมาย | Unknown รายละเอียด | `src/lib/auto-comment/poll.ts`, `admin.ts` | UI แสดง coverage การอ่านและข้อจำกัด pagination | กลาง | Page Token และ Graph API ที่ใช้ได้จริง | P1 |
| คำ/หมวด/พื้นที่/ตัดโฆษณา | ประกาศ A1 | `src/lib/pipeline/`, `src/lib/service-area.ts` | วัด precision/recall จากข้อมูลที่ได้รับอนุญาต | กลาง | ชุดประเมินภาษาไทย | P1 |
| Dedupe/PostgreSQL | ประกาศ dedupe A1; DB Unknown | `pipeline/dedupe.ts`, `prisma/schema.prisma`, `smart/` | เฝ้าดู false positive | กลาง | Postgres, vector/embedding providers | P1 |
| โพสต์ใหม่ | ประกาศ realtime A1/A2 | `src/app/api/v1/stream/route.ts`, หน้า feed ใช้ EventSource | วัด reconnect/latency ด้วย browser test | กลาง | session และ SSE | P1 |
| แจ้งเตือน/ติดตามงาน | ประกาศ A1 | `notify.ts`, `notification-queue.ts`, หน้า pipeline | ทดสอบช่องทางจริงเมื่อเจ้าของตั้ง Secret | กลาง | LINE/Discord/SMTP ตามที่เลือก | P1 |
| กฎและหลายข้อความ | ประกาศ A2/A3 | `auto-comment/schema.ts`, `matching.ts`, `admin.ts` | เพิ่มตัวอธิบายกฎแล้วในรอบนี้ | กลาง | กฎที่บันทึกและ session | P1 |
| Schedule/limits/dedupe/history | Unknown รายละเอียด BOT-W | `auto-comment/control.ts`, `engine.ts`, 4 ตาราง AutoComment | ยังต้องยืนยัน runtime และสิทธิ์จริง | สูง | Worker lease, RLS, unique keys | P0 |
| Auto Comment เพจ | ประกาศ A2/A3; ส่งจริง Unknown | `auto-comment/facebook.ts`, `engine.ts` | ยังไม่ผ่านการตรวจ Meta App ของเจ้าของ | สูง | Page-owned published post, scopes/tasks/App Review ที่เกี่ยวข้อง | P0 |
| กลุ่ม/Marketplace ส่งเอง | วิธีส่ง Unknown | unsupported jobs + copy/open ใน `/auto-comment` | คงเจ้าของเป็นผู้ส่ง | ต่ำ | ไม่ใช้ private API/DOM submit อัตโนมัติ | P0 |
| จัดการบัญชี/OAuth | Unknown | heartbeat บันทึก id ที่ Extension เห็น; Token เก็บต่อกฎ | ยังขาด OAuth และ Connected Accounts แยกจาก heartbeat | สูง | Meta App, callback HTTPS, state, consent | P1 |
| สิทธิ์และ Token expiry | Unknown | gateway ตรวจ validity/scopes/expiry ก่อนส่ง | ยังขาดหน้าสรุป metadata/reconnect/revoke | สูง | debug token, account tasks; ไม่ส่ง token กลับ UI | P0 |
| MV3/จับคู่/สถานะ | ประกาศ Extension A2/A3; permission Unknown | `extension/manifest.json` v1.8.1, `extension-devices.ts`, heartbeat API | ลด host grants กว้างในรอบแยกและ regression test | กลาง | storage/alarms/tabs/scripting/idle; HTTPS/localhost | P1 |
| AI วิเคราะห์/failover | Unknown BOT-W | `src/lib/ai/`, `pipeline/classify.ts`, `smart/` | วัดคุณภาพและ latency ต่อ provider | กลาง | Ollama → Gemini → Groq → rules; worker เท่านั้น | P1 |
| AI Draft | Unknown BOT-W | `pipeline/reply.ts`, `src/lib/reply-queue-core.ts` | การเลือกข้อความ Auto Comment ปัจจุบันเป็นเทมเพลต ยังไม่ใช่ AI สร้างก่อนส่ง | สูง | เพิ่ม review/revision fencing ก่อนเชื่อม AI | P2 |
| Dashboard/control/logs | Unknown หลังล็อกอิน | `/overview`, `/dashboard`, `/auto-comment` | ทำ Connected Accounts และสถิติ coverage ให้ครบ | กลาง | authenticated API; emergency control เดิม | P1 |

## ขอบเขตสถาปัตยกรรม

Chrome MV3 → API จับคู่/ingest → normalize/dedupe/Postgres → AI queue → Worker ภายใต้ lease → scoring/classification → SSE/feed/notifications/drafts

Auto Comment ใช้กฎเดิม → scan สร้าง durable jobs → ตรวจ generation/revision/control/สิทธิ์ → official Graph transport → history สถานะ uncertain ไม่ resend อัตโนมัติ กลุ่มและ Marketplace เตรียมข้อความส่งเอง Backup รวมตารางอัตโนมัติ; Restore ต้องปิดการทำงาน

ตัวทดลองใหม่: `/auto-comment` → `POST /api/auto-comment/preview` → อ่านเฉพาะ field กฎ → `explainCommentRule` ซึ่ง Worker ใช้ผ่าน `matchesCommentRule` → คืนเงื่อนไขและ `dispatchAuthorized:false` ไม่มีการเขียนตาราง/เรียก Meta

## ข้อจำกัดการตรวจ API

พยายามอ่านเอกสารทางการ [Pages comments](https://developers.facebook.com/docs/pages-api/posts/comments/), [Facebook Login](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/), [Graph changelog](https://developers.facebook.com/docs/graph-api/changelog/version19.0/) แต่เครื่องมือเข้าถึงไม่ได้/ตอบ 429 จึงไม่อ้างว่าตรวจข้อกำหนดล่าสุดครบ และหยุดเรียกเพื่อไม่ข้าม rate limit รายการ scopes ใน `facebook.ts` เป็น implementation ปัจจุบัน ต้องเทียบเอกสารที่เข้าถึงได้และ Meta App จริงก่อน rollout ไม่รับรอง Group/Marketplace Auto Mode และไม่ใช้วิธีหลบข้อจำกัด
