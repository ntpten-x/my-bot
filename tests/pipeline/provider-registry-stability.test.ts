import { expect, it, vi } from "vitest";
const writes = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/prisma", () => ({ prisma: { aiProvider: { findMany: writes, createMany: writes, count: writes } } }));
import { ensureSeeded, listProviders, routedClassifyAttempts } from "../../src/lib/ai/provider-registry";
it("never seeds or reads a model registry after removal", async () => {
    await ensureSeeded({} as never);
    expect(await listProviders()).toEqual([]);
    expect(await routedClassifyAttempts({} as never)).toBeNull();
    expect(writes).not.toHaveBeenCalled();
});
