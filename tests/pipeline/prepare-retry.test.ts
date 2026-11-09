import { expect, it } from "vitest";
import { mayRetryPrepareFailure, TRANSIENT_PREPARE_REASONS } from "@/lib/auto-comment/browser";

it("retries only transient prepare reasons and keeps legacy empty-reason retries", () => {
  expect(mayRetryPrepareFailure(undefined)).toBe(true);
  expect(mayRetryPrepareFailure("")).toBe(true);
  expect(mayRetryPrepareFailure("loading_retryable")).toBe(true);
  expect(mayRetryPrepareFailure("submit_not_ready")).toBe(true);
  expect(mayRetryPrepareFailure("owner_draft")).toBe(false);
  expect(mayRetryPrepareFailure("ambiguous_composer")).toBe(false);
  expect(mayRetryPrepareFailure("unsupported_dom")).toBe(false);
  expect(mayRetryPrepareFailure("target_mismatch")).toBe(false);
  expect(TRANSIENT_PREPARE_REASONS.has("editor_requires_focused_tab")).toBe(true);
});
