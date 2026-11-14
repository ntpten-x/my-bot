type Device = { id: string; name: string; online: boolean; fbUserId: string; commentsEnabled?: boolean; commentPending?: boolean; runtimeCurrent?: boolean; fullText?: { active: number | null; review: number | null; blocked: boolean | null } };
type Rule = { id: string; name: string; enabled: boolean; browserDeviceId: string; browserFbUserId: string; browserConsent: boolean; pausedReason: string; deliveryMode: string; requireAi: boolean; messageMode: string };

export type CommentReadiness = { extensions: Device[]; accounts: { id: string; name: string; enabled?: boolean }[]; steps?: { key: string; ready: boolean }[] };

export function CommentReadinessPanel({ control, rules, readiness }: {
  control: { state: string; dryRun: boolean; emergency: boolean };
  rules: Rule[];
  readiness: CommentReadiness | null;
}) {
  const enabled = rules.filter(rule => rule.enabled);
  const worker = readiness?.steps?.find(step => step.key === "worker");
  return <section aria-label="ความพร้อมส่งคอมเมนต์" className="rounded-xl border border-line bg-card p-4">
    <h2 className="font-semibold">ตรวจเส้นทางส่งคอมเมนต์</h2>
    <p className="mt-1 text-sm text-muted">จับคู่ Extension รุ่นล่าสุด แล้วเริ่มส่งคอมเมนต์จริงตามกฎที่เปิดไว้จากหน้านี้</p>
    <ul className="mt-3 space-y-2 text-sm">
      <li>{control.emergency ? "หยุดฉุกเฉินอยู่ — ต้องปลดขณะหยุดก่อนเริ่ม" : control.state === "running" ? "บอทกำลังทำงาน" : "บอทยังไม่ทำงาน — กดเริ่มเมื่อพร้อม"}</li>
      <li className="font-medium text-pine">ส่งคอมเมนต์จริงตามกฎที่เปิดไว้</li>
      {worker ? <li>{worker.ready ? "Worker พร้อมประเมินโพสต์และเตรียมคิว" : "Worker ไม่พร้อม — ตรวจภาพรวมระบบ"}</li> : null}
      {!enabled.length ? <li>ยังไม่มีกฎเปิดใช้งาน — สร้างหรือเปิดกฎก่อน</li> : null}
      {!readiness ? <li>ยังตรวจอุปกรณ์ไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง</li> : enabled.map(rule => {
        const device = readiness.extensions.find(item => item.id === rule.browserDeviceId);
        const liveSameAccount = readiness.extensions.filter(item => item.online && item.fbUserId === rule.browserFbUserId && item.commentsEnabled !== false);
        const issue = rule.pausedReason ? `กฎถูกพัก: ${rule.pausedReason}`
          : rule.deliveryMode !== "extension" ? "ยังไม่ใช้ช่องทาง Extension"
          : !rule.browserConsent ? "ยังไม่ยืนยันการใช้บัญชีในกลุ่มที่เลือก"
          : readiness.accounts.find(account => account.id === rule.browserFbUserId)?.enabled === false ? "บัญชีนี้ถูกหยุดงานในหน้าจัดการบัญชี"
          : !device?.online && liveSameAccount.length === 1 ? `อุปกรณ์เดิมออฟไลน์ — ระบบจะย้ายไปยัง ${liveSameAccount[0]!.name || "เครื่องที่ออนไลน์"} อัตโนมัติเมื่อ Worker สแกน`
          : !device?.online && liveSameAccount.length > 1 ? "อุปกรณ์เดิมออฟไลน์ และมีหลายเครื่องออนไลน์ของบัญชีนี้ — เปิดแก้ไขกฎแล้วเลือกเครื่องที่ต้องการ"
          : !device?.online ? "อุปกรณ์ที่ผูกไว้ไม่ออนไลน์ เปิด Chrome และตรวจการจับคู่"
          : device.runtimeCurrent === false ? "ตัวขยายยังรันโค้ดรุ่นเก่าหรือยังตรวจรุ่นไม่ได้ กดโหลดซ้ำในหน้าส่วนขยาย Chrome"
          : !rule.browserFbUserId || device.fbUserId !== rule.browserFbUserId ? "บัญชี Facebook ไม่ตรงกฎ ตรวจบัญชีที่ล็อกอิน"
          : device.commentPending ? "มีงานค้างบนเครื่อง ต้องตรวจผลเดิมก่อน ไม่ส่งซ้ำ"
          : !device.commentsEnabled ? "Extension ยังไม่พร้อมรับงาน ตรวจการจับคู่และสถานะบัญชี"
          : "อุปกรณ์และบัญชีพร้อมรับงาน";
        return <li key={rule.id} className="rounded-lg border border-line p-3"><strong>{rule.name}</strong><p className="mt-1">{issue}</p>
          {device?.online && device.fullText ? <p className="mt-1 text-xs text-muted">คิวอ่านข้อความเต็ม: รอทำ {device.fullText.active ?? "ไม่ทราบ"} · รอตรวจ {device.fullText.review ?? "ไม่ทราบ"} · {device.fullText.blocked == null ? "ยังไม่ทราบว่าคิวเต็มหรือไม่" : device.fullText.blocked ? "คิวเต็ม รอระบาย" : "คิวยังรับงานได้"}</p> : null}
          <p className="mt-1 text-xs text-muted">{rule.requireAi || rule.messageMode === "ai_draft" ? "กฎเดิมนี้ยังรอ AI ต้องแก้ไขและบันทึกหากต้องการใช้บอทไม่รอ AI" : "กฎนี้ไม่รอ AI แม้ผู้ให้บริการ AI ไม่พร้อม"}</p></li>;
      })}
    </ul>
    <p className="mt-3 text-xs text-muted">รับงานจากโพสต์ที่เก็บเข้าระบบหลังเริ่มรอบนี้ โดยตรวจอายุโพสต์ตามกฎ แม้โพสต์เผยแพร่ก่อนกดเริ่ม ข้อความต้องครบ อยู่ในกลุ่มที่อนุญาต และผ่านโควตา งานเก่าที่ไม่ทราบผลจะไม่ถูกส่งซ้ำ</p>
  </section>;
}
