import { describe, it, expect, vi, beforeEach } from "vitest";
import { claimLease, releaseLease } from "@/lib/scheduler";

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    jobLease: {
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";

describe("lease claiming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims lease when no existing lease", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ job: "test-job" }]);

    const claimed = await claimLease("test-job", 10);
    expect(claimed).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("fails to claim when lease is held by another runner", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    const claimed = await claimLease("test-job", 10);
    expect(claimed).toBe(false);
  });

  it("takes over expired lease", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ job: "test-job" }]);

    const claimed = await claimLease("test-job", 10);
    expect(claimed).toBe(true);
  });

  it("releases lease", async () => {
    vi.mocked(prisma.jobLease.update).mockResolvedValue({
      job: "test-job",
      leasedUntil: new Date(),
    });

    await releaseLease("test-job");
    expect(prisma.jobLease.update).toHaveBeenCalledWith({
      where: { job: "test-job" },
      data: { leasedUntil: expect.any(Date) },
    });
  });
});

describe("concurrent lease handling", () => {
  it("two concurrent ticks claim each job once", async () => {
    // @ts-ignore - PrismaPromise type mismatch in mock
    vi.mocked(prisma.$queryRaw).mockImplementation(async (_query, ..._values) => {
      // First claim succeeds, second fails (simulating concurrent access)
      const callCount = vi.mocked(prisma.$queryRaw).mock.calls.length;
      if (callCount === 1) {
        return Promise.resolve([{ job: "test-job" }] as any) as any;
      }
      return Promise.resolve([] as any) as any;
    });

    const results = await Promise.all([claimLease("test-job", 10), claimLease("test-job", 10)]);

    // One should succeed, one should fail
    const succeeded = results.filter((r) => r).length;
    const failed = results.filter((r) => !r).length;
    expect(succeeded).toBe(1);
    expect(failed).toBe(1);
  });
});
