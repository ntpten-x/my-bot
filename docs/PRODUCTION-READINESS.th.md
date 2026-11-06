# Phase 2 — Dependency Security และ Production Readiness

วันที่ตรวจ: 6 พฤศจิกายน 2026 · Branch `dev/security-stability`

## ผลสรุป

แก้ Audit จาก Critical 2 / High 4 / Moderate 8 เป็น **0 ทุกระดับ** หลัง Clean Install จริง Tests แบบ Strict ผ่าน 329/329 ข้อใน 41 ไฟล์ ไม่มี Skip, Lint/Build ผ่าน และ Smoke Test Web/Worker โหมด Production ผ่านกับ PostgreSQL ชั่วคราว

สถานะ Release: **BLOCKED** สำหรับ Deploy จริง เพราะยังไม่ได้รับค่าตั้งต้น/Secret ของ Host เป้าหมาย ไม่ได้ทดสอบ Provider จริง และมี Gemini Defaults เดิมที่ต้องเปลี่ยนหรือปิดก่อนใช้คลาวด์ ไม่ได้เชื่อม Production, ไม่แก้ `.env` จริง, ไม่ Commit/Push/Merge และไม่ Deploy

## Audit ทั้ง 14 รายการ

หลักฐาน JSON: [ก่อนแก้](security/npm-audit-before.json) และ [หลังแก้](security/npm-audit-after.json) เป็นผล npm Registry ณ วันที่ตรวจ ไม่ใช่การรับรองว่าไม่มีช่องโหว่ที่ยังไม่ถูกค้นพบ

จำนวน 14 หมายถึง Package Nodes ที่ npm Audit แจ้ง บางรายการส่งผลต่อ Package แม่จากช่องโหว่เดียวกัน จึงไม่ใช่ 14 CVE ที่แยกจากกัน

| Package Node | ระดับก่อนแก้ | เส้นทาง/ผลกระทบ | วิธีแก้และผลสุดท้าย |
| --- | --- | --- | --- |
| `tinypool` | Critical | Worker Pool ของ Vitest; Prototype Pollution สามารถเปลี่ยนตัวเลือก Worker | Vitest 4 ไม่ใช้ Tinypool; ไม่มี Package นี้ใน Lockfile แล้ว |
| `vitest` | Critical | รับผลกระทบจาก Tinypool และ Mocker | 3.2.7 → 4.1.12; Audit ไม่พบ |
| `deepmerge-ts` | High | Recursive Object Graph ทำให้ Stack Exhaustion ใน Prisma Config | Scoped Override 7.1.5 → 8.0.2; Audit ไม่พบ |
| `@prisma/config` | High | รับผลกระทบจาก Deepmerge | คง 6.19.3 และใช้ Deepmerge ที่แก้แล้ว |
| `prisma` | High | รับผลกระทบผ่าน Config | คง Prisma CLI/Client 6.19.3; ทดสอบ Generate/Migrate/Restore แล้ว |
| `postcss` | High | สำเนา 8.4.31 ใต้ Next มี Source Map File Disclosure และ Advisory อื่น | Scoped Override → 8.5.32 และทดสอบเส้นทางที่ Next Resolve จริง |
| `next` | Moderate | รับผลกระทบจาก PostCSS | คง 15.5.28; Audit ไม่พบหลังแก้แพ็กเกจย่อย |
| `@vitest/mocker` | Moderate | Path Traversal/Mock Source Injection ของ Development Server | 4.1.12 ซึ่งมีแพตช์ Backport |
| `minimatch` | Moderate | Glob Amplification ในรุ่นที่ TypeScript ESLint ใช้ | Scoped Override 10.2.2 → 11.0.1; ทดสอบ named `minimatch`/`dot` และ Lint จริง |
| `@typescript-eslint/typescript-estree` | Moderate | รับผลกระทบจาก Minimatch | คงรุ่นเดิมและแก้เฉพาะ Dependency ย่อย |
| `@typescript-eslint/parser` | Moderate | รับผลกระทบผ่าน Estree | Audit ไม่พบหลังแก้ Minimatch |
| `@typescript-eslint/utils` | Moderate | รับผลกระทบผ่าน Estree | Audit ไม่พบหลังแก้ Minimatch |
| `@typescript-eslint/type-utils` | Moderate | รับผลกระทบผ่าน Estree/Utils | Audit ไม่พบหลังแก้ Minimatch |
| `@typescript-eslint/eslint-plugin` | Moderate | รับผลกระทบผ่าน Parser/Utils | Audit ไม่พบหลังแก้ Minimatch |

Low ก่อนและหลังแก้ = 0 ไม่มีการใช้ `npm audit fix --force`, ไม่ซ่อน Advisory และไม่ปิด Security Check

## เหตุผลและผลกระทบของ Major Changes

- **Vitest 3 → 4.1.12:** จำเป็นเพื่อตัด Tinypool และรับแพตช์ Mocker เลือก 4.1.12 แทนการข้ามไป 5 ที่ npm เสนอเพื่อจำกัด Breaking Changes ตรวจ [Migration Guide v4](https://v4.vitest.dev/guide/migration.html) และ [แพตช์ 4.1.12](https://github.com/vitest-dev/vitest/releases/tag/v4.1.12) แล้ว โปรเจกต์ไม่ใช้ Custom Pool/Coverage/Browser APIs ที่ถูกเปลี่ยน คง Mock Hoisting และ Test Isolation เดิม และเปลี่ยน Config เป็น `.mts` พร้อม `import.meta.url` ให้เป็น ESM ชัดเจน
- **Deepmerge 7 → 8:** [Release Notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0) เปลี่ยนพฤติกรรม Map/Mutation และเพิ่มการจัดการ Circular Graph Prisma เรียก named `deepmerge` กับ Plain Config จึงทดสอบทั้ง Merge, Circular Graph และ `loadConfigFromFile` จริง โดยไม่ใช้ Unsafe API
- **Minimatch 10 → 11.0.1:** จำเป็นเพื่อพ้นช่วงที่ Advisory ระบุ ตรวจ Consumer พบว่า Estree ใช้ named `minimatch(file, pattern, {dot:true})`; รูปแบบนี้ยังทำงานและ Lint ผ่าน เก็บ Minimatch 3.1.5 ของ Consumer อื่นไว้ เพราะไม่อยู่ใน Advisory นี้
- **PostCSS:** อัปเดตภายใน Major 8; ทดสอบ Plugin Transform และ Source Map รวมทั้งกรณีโจมตีจาก Comment ที่ไม่มี Trusted Source Path

`npm install` และ `npm update postcss` รอบแรกยังเหลือสำเนาเก่าใน Lockfile และ `npm ls` รายงาน `invalid` จึง Resolve Lockfile ใหม่ใน `/tmp` จาก Manifest/Overrides แล้ว Clean Install ด้วย `npm ci --include=dev` ตรวจว่า Next ใช้ 8.5.32 จริงก่อนรับผล Audit 0 การ Resolve ใหม่มี Patch/Minor ภายใต้ Semver เดิม เช่น Tailwind/Lucide/CSS Toolchain; ไม่มีการเปลี่ยน Major ของ Next/React/Prisma

## การตรวจ P0/P1 และการตั้งค่าระบบ

- ทบทวน [Phase 1](SECURITY-STABILITY.th.md) และทดสอบซ้ำทั้ง RLS, Snapshot/Atomic Restore, Linux Secret Handling, Text Revision/Claim Fencing, AI Failover และ Lease Renewal ไม่มีการแก้ Migration เดิม
- เพิ่ม `production-config.ts` ให้ Web และ Worker ปฏิเสธ Production Config ที่ไม่มี/มี Secret สั้นกว่า 16 ตัว หรือใช้ DB URL/Pooler ไม่ถูกประเภท Error ไม่พิมพ์ค่า Env
- Launcher ส่ง `NODE_ENV=production` ให้ Worker ด้วย ไม่ปล่อยให้ `--prod` เปิด Worker ที่ข้าม Production Guard
- ย้าย `tsx` ไป Runtime Dependencies เพราะ Launcher ใช้เปิด Worker; `npm ls --omit=dev tsx` ยืนยันว่ามีใน Runtime ส่วน Build ยังต้องติดตั้ง devDependencies สำหรับ Prisma CLI/TypeScript
- ขั้นตอน Release ที่ทดสอบคือ `npm ci --include=dev` แล้ว Build/Start จากชุดนั้น ไม่รับรองการเริ่มติดตั้งใหม่ด้วย `npm ci --omit=dev` เพราะ Root Postinstall ยังเรียก Prisma CLI ใน devDependencies ห้ามเปลี่ยนเป็นการ Prune/แยก Runtime Artifact โดยไม่ทดสอบ Pipeline นั้นเพิ่ม
- `.env.example` เพิ่ม TLS Options และแยก `TEST_DATABASE_URL` ชัดเจน ไม่มีการสร้าง `.env` จริง มี `.nvmrc` ระบุ Node 26.13.0 ซึ่งเป็น Runtime ที่ทดสอบจริง
- `npm run readiness` ตรวจเฉพาะค่า Env แบบอ่านอย่างเดียว ไม่เชื่อม DB/Provider ค่า missing เป็น BLOCKED; รูปแบบผิดเป็น FAIL; PASS ของรูปแบบ URL ไม่ใช่ผลทดสอบการเชื่อมต่อจริง
- API Key ใน `AiProvider` เข้ารหัส AES-256-GCM และ Tests ตรวจการ Mask; **Settings แบบเก่าบางช่องยังเก็บ Secret เป็นข้อความ** ต้องตรวจข้อมูลจริงภายหลังได้รับอนุญาต และเลือกใช้ Env/Provider Store ที่เข้ารหัสสำหรับคีย์ AI ห้ามนำ Backup ที่มี Secret ไปเผยแพร่

## Production Readiness Checklist

PASS = ตรวจได้ในขอบเขตนี้, FAIL = พบเงื่อนไขที่ต้องแก้ก่อนใช้งานส่วนนั้น, BLOCKED = ไม่มีข้อมูล/สิทธิ์ทดสอบเป้าหมายจริง

| รายการ | สถานะ | หลักฐาน/สิ่งที่ยังต้องทำ |
| --- | --- | --- |
| Critical/High/Moderate/Low Dependencies | PASS | Audit สุดท้าย 0/0/0/0; JSON แนบ |
| Reproducible Install | PASS | `npm ci --include=dev` สำเร็จ และ `npm ls` ไม่มี invalid Dependency |
| Regression/Integration Tests | PASS | `test:ci` 329/329 ข้อ, 41 ไฟล์, 0 Skip |
| Gate ป้องกัน DB Tests ถูก Skip | PASS | ไม่มี TEST_DATABASE_URL แล้ว `test:ci` ต้อง Exit 1; Helper บังคับฐานใน Strict Mode |
| Lint / Production Build | PASS | `npm run lint` และ `npm run build` Exit 0 |
| Migration บนฐานใหม่ | PASS | DB Suites Apply ทุก Migration ใน Schema `test_*` |
| Migration อัปเกรดฐานเดิม | PASS | `migration-upgrade.test.ts` เริ่มจาก Migration ก่อน Security, เก็บโพสต์เดิมได้ครบ, RLS ครบ, Deploy ซ้ำไม่เปลี่ยนข้อมูล |
| RLS ของ Role ไม่มีสิทธิ์พิเศษ | PASS | GRANT แล้วแต่ไม่มี Policy ยังอ่าน/แก้ Product ไม่ได้ |
| Atomic Restore / Category Tree / Generated Columns | PASS | Round-trip และ Fault Injection ทำให้ Rollback ทั้งชุดได้ |
| SQL ตรวจหลัง Migrate | PASS | `verify-security-stability.sql` รันแบบ READ ONLY บนฐานชั่วคราวผ่าน |
| Production Web/Worker ในเครื่อง | PASS | `test:production` เริ่ม Process ได้, Worker Tick, DB Health, Unauthorized 401, Public Health เฉพาะ ok/version |
| Production Startup Guard / Runtime Worker Runner | PASS | Unit Tests, Smoke Test และ Runtime Dependency Check |
| Env/AI_KEY_SECRET ของ Host จริง | BLOCKED | ไม่มี `.env` จริง/ไม่ได้อ่านค่าจาก Render ต้องยืนยัน Secret เป็นค่าเดิมและครบตาม Readiness |
| Supabase จริง: Connectivity/TLS/RLS/Privileges/Capacity | BLOCKED | ทดสอบเฉพาะ Postgres ชั่วคราว ห้ามตีความว่า Supabase จริงผ่านแล้ว |
| Cloud AI Credentials และโควตาจริง | BLOCKED | ไม่มี API Key จริง; Failover Tests ใช้ Provider/HTTP จำลอง |
| Gemini Defaults เดิม | FAIL | ยังอ้าง `gemini-2.0-flash` และ `text-embedding-004`; ต้องเปลี่ยนเป็น Model ที่บัญชีรองรับแล้วทดสอบ หรือปิด Gemini และยืนยัน Groq/Ollama ก่อน Deploy |
| Groq Default / Ollama | BLOCKED | Groq ยังมี `openai/gpt-oss-120b` ในเอกสาร แต่ต้องยืนยันบัญชี/โควตา; ไม่มีการทดสอบ Ollama/GPU จริง |
| Legacy Settings Secrets และ Backup Storage จริง | BLOCKED | ต้องตรวจว่ามี Plaintext Secret เดิมหรือไม่ พร้อม Access Control/Off-host Backup/Key Recovery |
| Target HTTPS/Proxy/Cookies/Extension Pairing | BLOCKED | ไม่มีการเปิดเว็บจริงภายนอก; Tests ตรวจ Logic แต่ไม่แทนการตรวจ Host จริง |
| Release/Rollback Artifact ที่อนุมัติ | BLOCKED | Branch ยังเป็น Working Tree ไม่ได้ Commit; HEAD เดิมไม่ใช่ Candidate นี้ ต้องเก็บ Artifact หลังอนุมัติ |
| Deploy และ Apply Production | BLOCKED | ไม่ได้รับอนุญาตและไม่ได้ดำเนินการ |

Google ระบุการปิด [Gemini 2.0](https://firebase.google.com/docs/ai-logic/models) และ [Embedding Model เดิม](https://ai.google.dev/gemini-api/docs/deprecations?hl=en); [Groq Supported Models](https://console.groq.com/docs/models) ยังแสดง GPT-OSS 120B การเปลี่ยน Embedding Model ต้องปล่อย Worker สร้างเวกเตอร์ใหม่ ห้ามนำเวกเตอร์ต่าง Model มาเทียบกัน ไม่มีการเปลี่ยน Model/ข้อมูลใน DB โดยอัตโนมัติใน Phase นี้

## แผน Apply ที่ต้องทำหลังได้รับอนุญาต

1. ปิด FAIL และ BLOCKED ที่จำเป็นตาม Host ที่เลือก โดยเฉพาะ Model ที่เลิกให้บริการ, Secret เดิม, TLS และ Backup Restore Drill ห้ามถือ Audit 0 เป็นสิทธิ์ Deploy
2. Review Diff ของทั้ง Phase 1/2 แล้วเก็บ Candidate Artifact ที่รวม Working Tree, Lockfile, Build, Migration SQL และผล Test พร้อม SHA-256 ห้ามใช้ `git archive HEAD` ตอนนี้ เพราะ HEAD ยังไม่มีงานที่ยังไม่ Commit นี้ เก็บ Artifact เดิมที่ผ่าน Audit/Test สำหรับ Rollback แยกไว้
3. ยืนยันฐาน/Schema/Project เป้าหมายด้วย Metadata เท่านั้น ห้ามพิมพ์ Connection String หรือใช้ Secret เป็น Argument ของ Shell เก็บค่าจริงใน Environment/Secret Store ของ Host
4. หยุด Web/Worker **ทุก Host ที่ใช้ฐานเดียวกัน** รวม Local และ Render รอ Lease หมดอายุ ไม่เปิด Worker คนละรุ่นพร้อมกัน
5. สำรองด้วย Managed Snapshot หรือ `pg_dump` ที่ครบทุกตารางก่อน Migrate และตรวจการกู้คืนในฐาน Staging แยก **อย่าใช้ Prisma Client รุ่นใหม่ทำ JSON Backup กับ Schema เก่าที่ยังไม่มีคอลัมน์ใหม่** เพราะ Query อาจล้มเหลว เก็บ Restore Point/เวลาสำรองและขอบเขตการสูญเสียข้อมูลที่ยอมรับได้
6. ใช้ Node ตาม `.nvmrc`, ติดตั้ง `npm ci --include=dev`, รัน Strict Tests กับฐานทดสอบและ Build Artifact ที่ตรวจแล้วให้ผ่านก่อนเปลี่ยนฐานจริง
7. เมื่อได้รับอนุญาตเฉพาะการ Apply แล้ว จึงรัน `npm run db:migrate` เพียงครั้งเดียวโดยผู้รับผิดชอบ ใช้ DIRECT_URL แบบ Session/Direct Connection ไม่ใช้ Transaction Pooler 6543 ตั้ง Maintenance Window และ Lock/Statement Timeout ตามขนาดฐานจริง หาก Lock ไม่ว่างให้หยุดตรวจ ไม่เปิด Worker ฝืนต่อ
8. ใช้ SQL Read-only ตรวจ Migration, RLS, Columns และจำนวนข้อมูล เทียบกับ Baseline ตรวจ `prisma migrate status` ว่าไม่มี Failed/Pending Migration ห้ามแก้ `_prisma_migrations` ด้วยมือเพื่อทำให้สถานะผ่าน
9. เปิด Web และ Worker จาก Artifact เดียวกัน (`npm start`) ตรวจ `/health`, ล็อกอิน, Health แบบ Public, Queue/Lease, Provider จริง, Extension Pairing และรับโพสต์ตัวอย่างที่อนุญาตแล้ว ตรวจว่าไม่มี Secret ใน Log
10. เฝ้าดู Error Rate, Queue Age/Retry, Worker Heartbeat, DB Connections และ Notifications ตามเกณฑ์ที่เจ้าของรับรองก่อนปิด Maintenance

## แผน Rollback และเกณฑ์หยุด

- ถ้าติดตั้ง/Test/Build/Readiness ไม่ผ่านก่อน Apply: หยุด Candidate ไม่มีเหตุให้แก้ DB
- ถ้า Migration ล้มเหลว: คง Maintenance และหยุด Worker ทุกตัว ตรวจสถานะ/สาเหตุเทียบกับ Staging ไม่ย้อน Migration ด้วยการ Drop Columns และไม่ปิด RLS ถ้า Migration ค้างบางส่วนต้องทำ Recovery Plan ที่ซ้อมบนฐานแยกก่อน
- ถ้า App ล้มหลัง Apply: หยุด Web/Worker ใหม่ เก็บ Logs ที่ Mask แล้ว และคงคอลัมน์ Additive กับ RLS ไว้ ใช้ Artifact ก่อนหน้าที่ **ตรวจว่า Schema-compatible และไม่มี Critical/High ที่ยังไม่ยอมรับ** เท่านั้น ไม่ถอย Lockfile กลับไปชุด 14 ช่องโหว่โดยอัตโนมัติ หากไม่มี Artifact ดังกล่าวให้คง Maintenance และแก้ไปข้างหน้า
- Test ยืนยัน Legacy SQL ยังอ่าน/เขียนกับ Schema ใหม่ได้ แต่ไม่อ้างว่าทดสอบ Binary/Artifact เก่าทั้งชุดแล้ว การเลือก Rollback Artifact จริงจึงยังเป็น BLOCKED
- หากพิสูจน์ว่าข้อมูลเสียหาย: ใช้ Managed Restore/PITR หรือ Backup เต็มที่ทดสอบแล้วไปยังฐานแยกก่อน ตรวจจำนวน/ความสัมพันธ์ แล้วให้เจ้าของอนุมัติการแทนข้อมูล ต้องระบุ Data Loss Window และไม่ใช้ Restore เป็นเครื่องมือทดลองบน Production
- ห้ามใช้ `migrate reset`, Drop Schema/Table, `DISABLE ROW LEVEL SECURITY` หรือคืนสิทธิ์ Public เพื่อทำให้ระบบเปิดได้

## ทำซ้ำการตรวจในเครื่องทดสอบ

```bash
npm ci --include=dev
# Export TEST_DATABASE_URL เฉพาะฐานทดสอบนอก Transcript
npm run test:ci
npm run lint
npm run build
npm audit --json
npm run readiness
# Linux/WSL เท่านั้น: Runner นี้บังคับ TEST_DATABASE_URL เป็น 127.0.0.1:55432
npm run test:production
```

Smoke Runner ใช้ Schema `test_smoke_*`, Runtime Directory ใน `/tmp`, คีย์สังเคราะห์สำหรับการทดสอบ และ Env Allowlist ไม่รับคีย์จริงจาก Parent ไม่ส่ง Notification จริง แล้วปิด Process/ลบเฉพาะ Schema และ Runtime ของตัวเองเมื่อจบ ไม่ใช่การ Deploy ภายนอก

สิ่งที่ยังไม่ได้ยืนยัน: Windows Runtime, Chrome/Facebook จริง, Cloud AI จริง, Supabase จริง, Target HTTPS และ Artifact Rollback จริง ต้องตรวจตาม Checklist ก่อนอนุมัติ Release

ฟีเจอร์ Auto Comment ที่เพิ่มภายหลัง Phase 2 มี Migration, Checklist และข้อจำกัดการเปิดส่งจริงแยกใน [AUTO-COMMENT.th.md](AUTO-COMMENT.th.md) ผลตรวจ Phase 2 ด้านบนเป็นหลักฐานของรอบนั้น ไม่ใช่การอนุมัติเปิด Auto Comment บน Production
