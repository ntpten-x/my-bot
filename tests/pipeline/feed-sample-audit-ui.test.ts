import { expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedSampleAudit } from "@/components/feed-sample-audit";
it("offers only Facebook sources and explains the sample denominator without starting a request",()=>{
 const html=renderToStaticMarkup(React.createElement(FeedSampleAudit,{sources:[{id:"g",name:"กลุ่มทดสอบ",type:"facebook_group"},{id:"r",name:"RSS_PRIVATE",type:"rss"}]}));
 expect(html).toContain("กลุ่มทดสอบ");expect(html).not.toContain("RSS_PRIVATE");expect(html).toContain("50");expect(html).toContain("ไม่ใช่ recall ของฟีดทั้งหมด");
});
