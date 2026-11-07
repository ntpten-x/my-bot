type Device = { id: string; name: string; online: boolean; fbUserId: string; commentsEnabled?: boolean; commentPending?: boolean };
type Rule = { id: string; name: string; enabled: boolean; browserDeviceId: string; browserFbUserId: string; browserConsent: boolean; pausedReason: string; deliveryMode: string; requireAi: boolean; messageMode: string };

export type CommentReadiness = { extensions: Device[]; accounts: { id: string; name: string }[]; steps?: { key: string; ready: boolean }[] };

export function CommentReadinessPanel({ control, rules, readiness }: {
  control: { state: string; dryRun: boolean; emergency: boolean };
  rules: Rule[];
  readiness: CommentReadiness | null;
}) {
  const enabled = rules.filter(rule => rule.enabled);
  const worker = readiness?.steps?.find(step => step.key === "worker");
  return <section aria-label="ความพร้อมส่งคอมเมนต์" className="rounded-xl border border-line bg-card p-4">
    <h2 className="font-semibold">ตรวจเส้นทางส่งคอมเมนต์</h2>
    <p className="mt-1 text-sm text-muted">เริ่มทำงานในโหมดจำลองจะตรวจจับคู่เท่านั้น การส่งจริงต้องเปิดรับงานที่ Extension และบันทึกโหมดส่งจริงแยกกัน</p>
    <ul className="mt-3 space-y-2 text-sm">
      <li>{control.emergency ? "หยุดฉุกเฉินอยู่ — ต้องปลดขณะหยุดก่อนเริ่ม" : control.state === "running" ? "บอทกำลังทำงาน" : "บอทยังไม่ทำงาน — กดเริ่มเมื่อพร้อม"}</li>
      <li className={control.dryRun ? "font-medium text-amber-900" : "font-medium text-pine"}>{control.dryRun ? "ยังไม่ส่งจริง: Dry Run เปิดอยู่" : "เลือกโหมดส่งจริงแล้ว"}</li>
      {worker ? <li>{worker.ready ? "Worker พร้อมประเมินโพสต์และเตรียมคิว" : "Worker ไม่พร้อม — ตรวจภาพรวมระบบ"}</li> : null}
      {!enabled.length ? <li>ยังไม่มีกฎเปิดใช้งาน — สร้างหรือเปิดกฎก่อน</li> : null}
      {!readiness ? <li>ยังตรวจอุปกรณ์ไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง</li> : enabled.map(rule => {
        const device = readiness.extensions.find(item => item.id === rule.browserDeviceId);
        const issue = rule.pausedReason ? `กฎถูกพัก: ${rule.pausedReason}`
          : rule.deliveryMode !== "extension" ? "ยังไม่ใช้ช่องทาง Extension"
          : !rule.browserConsent ? "ยังไม่ยืนยันการใช้บัญชีในกลุ่มที่เลือก"
          : !device?.online ? "อุปกรณ์ที่ผูกไว้ไม่ออนไลน์ เปิด Chrome และตรวจการจับคู่"
          : !rule.browserFbUserId || device.fbUserId !== rule.browserFbUserId ? "บัญชี Facebook ไม่ตรงกฎ ตรวจบัญชีที่ล็อกอิน"
          : device.commentPending ? "มีงานค้างบนเครื่อง ต้องตรวจผลเดิมก่อน ไม่ส่งซ้ำ"
          : !device.commentsEnabled ? "Extension ปิดรับงานคอมเมนต์ — เปิดสวิตช์รับงานใน popup"
          : "อุปกรณ์และบัญชีพร้อมรับงาน";
        return <li key={rule.id} className="rounded-lg border border-line p-3"><strong>{rule.name}</strong><p className="mt-1">{issue}</p>
          <p className="mt-1 text-xs text-muted">{rule.requireAi || rule.messageMode === "ai_draft" ? "กฎเดิมนี้ยังรอ AI ต้องแก้ไขและบันทึกหากต้องการใช้บอทไม่รอ AI" : "กฎนี้ไม่รอ AI แม้ผู้ให้บริการ AI ไม่พร้อม"}</p></li>;
      })}
    </ul>
    <p className="mt-3 text-xs text-muted">ครบเงื่อนไขแล้วจะส่งเฉพาะโพสต์ใหม่ที่ตรงกฎ ข้อความครบ อยู่ในกลุ่มที่อนุญาต และผ่านโควตา งานเก่าที่ไม่ทราบผลจะไม่ถูกส่งซ้ำ</p>
  </section>;
}
