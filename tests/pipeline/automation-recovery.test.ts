import { expect, it } from "vitest";

it("verifies durable feed admission across HTTP outage and a fresh MV3 context", async () => {
  const recoveryVerifier = await import("../../scripts/verify-automation-recovery.mjs");
  expect(recoveryVerifier.verifyAutomationRecovery).toBeTypeOf("function");
  const report = await recoveryVerifier.verifyAutomationRecovery();
  expect(report.feed).toEqual({ queuedPosts: 2, afterOutage: 2, afterRestart: 2, afterUnacknowledged: 2, afterAcknowledged: 0, originalObservedAtPreserved: true });
});

it("recovers an uncertain journal after lost reporting and restart without claim, authorize, send or tab creation", async () => {
  const recoveryVerifier = await import("../../scripts/verify-automation-recovery.mjs");
  expect(recoveryVerifier.verifyAutomationRecovery).toBeTypeOf("function");
  const report = await recoveryVerifier.verifyAutomationRecovery();
  expect(report.comments).toEqual({ pendingAfterOutage: true, pendingAfterRestart: true, reportOutcomes: ["uncertain", "uncertain"], claims: 0, authorizations: 0, pageActions: 0, tabsCreated: 0, clearedAfterAcknowledged: true });
  expect(report.scope).toBe("synthetic_offline_only");
});
