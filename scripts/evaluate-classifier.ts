import { readFile } from "node:fs/promises";
import { z } from "zod";
import { flattenSeeds } from "../src/lib/pipeline/catalog";
import { ruleItem } from "../src/lib/pipeline/classify-rules";
import { classificationMetrics } from "../src/lib/pipeline/evaluate";

const schema = z.object({ ownerReviewed: z.boolean().default(false), items: z.array(z.object({ id: z.string(), text: z.string(), intent: z.enum(["buyer", "seller", "ad", "unknown"]) })).min(1) });
async function main() {
  const file = process.argv.find(arg => arg.startsWith("--file="))?.slice(7) || "tests/fixtures/classifier.th.json";
  const fixture = schema.parse(JSON.parse(await readFile(file, "utf8")));
  const catalog = flattenSeeds();
  const results = fixture.items.map(item => ruleItem(item, catalog));
  const providers: Record<string, string> = Object.fromEntries(results.map(item => [item.id, "rules"]));
  console.log(fixture.ownerReviewed ? "ชุดคำตอบระบุว่าเจ้าของตรวจแล้ว" : "คำเตือน: ชุดตัวอย่างแต่งขึ้น ยังไม่ผ่านการตรวจป้ายคำตอบจากเจ้าของ ห้ามใช้เป็นความแม่นยำบนข้อมูลจริง");
  const rows = fixture.items.map(item => ({ expected: item.intent, predicted: results.find(row => row.id === item.id)?.intent ?? "unknown" }));
  console.log(JSON.stringify({ mode: "rules", providers: Object.fromEntries([...new Set(Object.values(providers))].map(name => [name, Object.values(providers).filter(value => value === name).length])), ...classificationMetrics(rows), mismatches: fixture.items.filter((_, index) => rows[index].expected !== rows[index].predicted).map(item => item.id) }, null, 2));
}
main().catch(() => { console.error("ประเมินไม่สำเร็จ ตรวจรูปแบบไฟล์ตัวอย่าง"); process.exitCode = 1; });
