import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../lib/db";
import { recordUsage, monthlyAiCostCents, assertAiBudget, monthlyCount, checkAndSendBudgetWarning, BudgetExceededError } from "../lib/usage";

// Mock notify module
vi.mock("../lib/notify", () => ({
  notifyHost: vi.fn(),
}));

describe("usage", () => {
  beforeEach(async () => {
    await prisma.usageDaily.deleteMany({});
    await prisma.owner.deleteMany({});
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await prisma.usageDaily.deleteMany({});
    await prisma.owner.deleteMany({});
  });

  it("records usage incrementally", async () => {
    const owner = await prisma.owner.create({
      data: { email: "usage-test@example.com", passwordHash: "hash" },
    });

    await recordUsage(owner.id, "AI_REPLY", { input: 1000, output: 500 });
    await recordUsage(owner.id, "AI_REPLY", { input: 2000, output: 1000 });

    const rows = await prisma.usageDaily.findMany({ where: { ownerId: owner.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].inputTokens).toBe(3000);
    expect(rows[0].outputTokens).toBe(1500);
  });

  it("tracks different usage kinds separately", async () => {
    const owner = await prisma.owner.create({
      data: { email: "usage-test2@example.com", passwordHash: "hash" },
    });

    await recordUsage(owner.id, "AI_REPLY", { input: 1000, output: 500 });
    await recordUsage(owner.id, "WA_TEMPLATE");

    const rows = await prisma.usageDaily.findMany({ where: { ownerId: owner.id } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.kind === "AI_REPLY")?.count).toBe(1);
    expect(rows.find((r) => r.kind === "WA_TEMPLATE")?.count).toBe(1);
  });

  it("calculates monthly AI cost from tokens", async () => {
    const owner = await prisma.owner.create({
      data: { email: "usage-test3@example.com", passwordHash: "hash" },
    });

    process.env.AI_INPUT_EUR_PER_MTOK = "3";
    process.env.AI_OUTPUT_EUR_PER_MTOK = "15";

    const today = new Date();
    const dayStr = today.toISOString().slice(0, 10);
    await prisma.usageDaily.create({
      data: {
        ownerId: owner.id,
        day: new Date(dayStr),
        kind: "AI_REPLY",
        count: 1,
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      },
    });

    const costCents = await monthlyAiCostCents(owner.id, today);
    // (1M * 3 + 0.5M * 15) / 1M * 100 = (3 + 7.5) * 100 = 1050 cents
    expect(costCents).toBe(1050);
  });

  it("returns zero cost with no prices", async () => {
    const owner = await prisma.owner.create({
      data: { email: "usage-test4@example.com", passwordHash: "hash" },
    });

    delete process.env.AI_INPUT_EUR_PER_MTOK;
    delete process.env.AI_OUTPUT_EUR_PER_MTOK;

    const costCents = await monthlyAiCostCents(owner.id);
    expect(costCents).toBe(0);
  });

  it("throws when budget exceeded", async () => {
    const owner = await prisma.owner.create({
      data: {
        email: "test@example.com",
        passwordHash: "hash",
        monthlyAiBudgetCents: 100, // 1 euro
      },
    });

    process.env.AI_INPUT_EUR_PER_MTOK = "10";

    const today = new Date();
    const dayStr = today.toISOString().slice(0, 10);
    await prisma.usageDaily.create({
      data: {
        ownerId: owner.id,
        day: new Date(dayStr),
        kind: "AI_REPLY",
        count: 1,
        inputTokens: 1_000_000, // 10 euros
        outputTokens: 0,
      },
    });

    await expect(assertAiBudget(owner.id, today)).rejects.toThrow(BudgetExceededError);
  });

  it("does not throw when under budget", async () => {
    const owner = await prisma.owner.create({
      data: {
        email: "test@example.com",
        passwordHash: "hash",
        monthlyAiBudgetCents: 1000, // 10 euros
      },
    });

    process.env.AI_INPUT_EUR_PER_MTOK = "10";

    const today = new Date();
    const dayStr = today.toISOString().slice(0, 10);
    await prisma.usageDaily.create({
      data: {
        ownerId: owner.id,
        day: new Date(dayStr),
        kind: "AI_REPLY",
        count: 1,
        inputTokens: 500_000, // 5 euros
        outputTokens: 0,
      },
    });

    await expect(assertAiBudget(owner.id, today)).resolves.not.toThrow();
  });

  it("counts monthly usage by kind", async () => {
    const owner = await prisma.owner.create({
      data: { email: "usage-test5@example.com", passwordHash: "hash" },
    });

    const today = new Date();
    const dayStr = today.toISOString().slice(0, 10);

    await prisma.usageDaily.create({
      data: {
        ownerId: owner.id,
        day: new Date(dayStr),
        kind: "WA_TEMPLATE",
        count: 5,
        inputTokens: 0,
        outputTokens: 0,
      },
    });

    const count = await monthlyCount(owner.id, "WA_TEMPLATE", today);
    expect(count).toBe(5);
  });

  it("returns zero for no usage", async () => {
    const owner = await prisma.owner.create({
      data: { email: "usage-test6@example.com", passwordHash: "hash" },
    });

    const count = await monthlyCount(owner.id, "WA_TEMPLATE");
    expect(count).toBe(0);
  });

  describe("checkAndSendBudgetWarning", () => {
    it("sends warning at 80% threshold", async () => {
      const { notifyHost } = await import("../lib/notify");

      const owner = await prisma.owner.create({
        data: {
          email: "test@example.com",
          passwordHash: "hash",
          monthlyAiBudgetCents: 1000, // 10 euros
        },
      });

      process.env.AI_INPUT_EUR_PER_MTOK = "8";

      const today = new Date();
      const dayStr = today.toISOString().slice(0, 10);
      await prisma.usageDaily.create({
        data: {
          ownerId: owner.id,
          day: new Date(dayStr),
          kind: "AI_REPLY",
          count: 1,
          inputTokens: 1_000_000, // 8 euros (80% of 10)
          outputTokens: 0,
        },
      });

      await checkAndSendBudgetWarning(owner.id, today);

      expect(notifyHost).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "AI budget warning: 80% reached",
        })
      );

      // Check that budgetWarnedMonth is set
      const updatedOwner = await prisma.owner.findUnique({ where: { id: owner.id } });
      expect(updatedOwner?.budgetWarnedMonth).toBe(today.toISOString().slice(0, 7));
    });

    it("does not send warning below 80%", async () => {
      const { notifyHost } = await import("../lib/notify");

      const owner = await prisma.owner.create({
        data: {
          email: "test@example.com",
          passwordHash: "hash",
          monthlyAiBudgetCents: 1000,
        },
      });

      process.env.AI_INPUT_EUR_PER_MTOK = "7";

      const today = new Date();
      const dayStr = today.toISOString().slice(0, 10);
      await prisma.usageDaily.create({
        data: {
          ownerId: owner.id,
          day: new Date(dayStr),
          kind: "AI_REPLY",
          count: 1,
          inputTokens: 1_000_000, // 7 euros (70% of 10)
          outputTokens: 0,
        },
      });

      await checkAndSendBudgetWarning(owner.id, today);

      expect(notifyHost).not.toHaveBeenCalled();
    });

    it("does not send warning twice in same month", async () => {
      const { notifyHost } = await import("../lib/notify");

      const owner = await prisma.owner.create({
        data: {
          email: "test@example.com",
          passwordHash: "hash",
          monthlyAiBudgetCents: 1000,
          budgetWarnedMonth: new Date().toISOString().slice(0, 7),
        },
      });

      await checkAndSendBudgetWarning(owner.id);

      expect(notifyHost).not.toHaveBeenCalled();
    });

    it("sends warning again in new month", async () => {
      const { notifyHost } = await import("../lib/notify");

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      const owner = await prisma.owner.create({
        data: {
          email: "test@example.com",
          passwordHash: "hash",
          monthlyAiBudgetCents: 1000,
          budgetWarnedMonth: lastMonth.toISOString().slice(0, 7),
        },
      });

      process.env.AI_INPUT_EUR_PER_MTOK = "8";

      const today = new Date();
      const dayStr = today.toISOString().slice(0, 10);
      await prisma.usageDaily.create({
        data: {
          ownerId: owner.id,
          day: new Date(dayStr),
          kind: "AI_REPLY",
          count: 1,
          inputTokens: 1_000_000,
          outputTokens: 0,
        },
      });

      await checkAndSendBudgetWarning(owner.id, today);

      expect(notifyHost).toHaveBeenCalled();
    });
  });
});
