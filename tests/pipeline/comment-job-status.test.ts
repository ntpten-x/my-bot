import { expect, it } from "vitest";
import { commentJobHeadline, commentSuccessCount } from "../../src/lib/auto-comment/job-status";

it("shows durable wait reasons instead of the coarse browser_ready label", () => {
  expect(commentJobHeadline("browser_ready", "รอระยะพักของกลุ่ม")).toBe("รอระยะพักของกลุ่ม");
  expect(commentJobHeadline("browser_ready", "รอโควตารายชั่วโมง")).toBe("รอโควตารายชั่วโมง");
  expect(commentJobHeadline("browser_ready", "")).toBe("รอ Extension");
  expect(commentJobHeadline("uncertain", "anything")).toBe("ไม่ทราบผล — ตรวจเอง ห้ามส่งซ้ำ");
});

it("counts extension observations as successes alongside Graph sent", () => {
  expect(commentSuccessCount({ browser_observed: 4, sent: 1 })).toBe(5);
  expect(commentSuccessCount({ sent: 2 })).toBe(2);
  expect(commentSuccessCount({})).toBe(0);
});
