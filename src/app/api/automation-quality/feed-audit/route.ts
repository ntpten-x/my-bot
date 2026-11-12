import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { FEED_AUDIT_BODY_LIMIT, FEED_AUDIT_ROW_LIMIT, FEED_SAMPLE_LIMIT, prepareFeedSample, summarizeFeedSample } from "@/lib/feed-sample-audit";

export const dynamic = "force-dynamic";
const inputSchema = z.object({
  sourceId: z.string().min(1).max(120),
  expectedFullText: z.boolean().optional(),
  items: z.array(z.object({url: z.string().min(1).max(2048), expectedIntent: z.enum(["buyer", "seller", "ad", "unknown"]).optional(), expectedFullText: z.boolean().optional()}).strict()).min(1).max(FEED_SAMPLE_LIMIT),
}).strict();

async function readInput(request: Request) {
  if (Number(request.headers.get("content-length")) > FEED_AUDIT_BODY_LIMIT) return {error: json({error:"ข้อมูลเกิน 32 KiB"},413)};
  if (!request.body) return {error:json({error:"ไม่พบข้อมูลตัวอย่าง"},400)};
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>FEED_AUDIT_BODY_LIMIT) { await reader.cancel(); return {error:json({error:"ข้อมูลเกิน 32 KiB"},413)}; }
      chunks.push(value);
    }
    const bytes=new Uint8Array(size);
    let offset=0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
    const parsed=inputSchema.safeParse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
    if (!parsed.success) return {error:json({error:"เลือกแหล่งข้อมูลและระบุตัวอย่าง 1–50 รายการ พร้อมป้ายกำกับที่ถูกต้อง"},400)};
    return {data:parsed.data};
  } catch { return {error:json({error:"รูปแบบข้อมูลไม่ถูกต้อง"},400)}; }
  finally {reader.releaseLock();}
}

export async function POST(request: Request) {
  const {error}=await authed();
  if (error) return error;
  const parsed=await readInput(request);
  if (parsed.error) return parsed.error;
  if (!parsed.data) return json({error:"รูปแบบข้อมูลไม่ถูกต้อง"},400);
  try {
    const source=await prisma.source.findUnique({where:{id:parsed.data.sourceId},select:{id:true,type:true,url:true,fbGroupId:true}});
    if (!source) return json({error:"ไม่พบแหล่งข้อมูล"},404);
    if (!["facebook_group","facebook_marketplace"].includes(source.type)) return json({error:"รองรับเฉพาะกลุ่ม Facebook และ Marketplace"},400);
    const sample=prepareFeedSample(source,parsed.data.items,parsed.data.expectedFullText);
    const rows=sample.candidates.length ? await prisma.post.findMany({
      where:{sourceId:source.id,OR:sample.candidates.map(value=>({externalUrl:{contains:value}}))},
      select:{id:true,sourceId:true,externalUrl:true,intent:true,isAd:true,truncated:true,createdAt:true,postedAt:true,processingState:true,aiProvider:true,aiJobs:{select:{status:true},take:1}},
      orderBy:[{createdAt:"desc"},{id:"asc"}],take:FEED_AUDIT_ROW_LIMIT+1,
    }):[];
    const report=summarizeFeedSample(sample,rows.slice(0,FEED_AUDIT_ROW_LIMIT),rows.length>FEED_AUDIT_ROW_LIMIT);
    const response=json(report);
    response.headers.set("Cache-Control","no-store");
    return response;
  } catch {return json({error:"ตรวจตัวอย่างไม่สำเร็จ กรุณาลองใหม่"},500);}
}
