import { prisma } from "./db";
import type { UsageKind } from "@prisma/client";
import { notifyHost } from "./notify";

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const today = () => new Date(new Date().toISOString().slice(0, 10));
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export class BudgetExceededError extends Error {}

export async function recordUsage(ownerId: string, kind: UsageKind, tokens?: { input?: number; output?: number }) {
  await prisma.usageDaily.upsert({
    where: { ownerId_day_kind: { ownerId, day: today(), kind } },
    create: { ownerId, day: today(), kind, count: 1, inputTokens: tokens?.input ?? 0, outputTokens: tokens?.output ?? 0 },
    update: { count: { increment: 1 }, inputTokens: { increment: tokens?.input ?? 0 }, outputTokens: { increment: tokens?.output ?? 0 } },
  });
}

/** Estimated AI cost this month in euro cents, from tokens and the prices in the environment. */
export async function monthlyAiCostCents(ownerId: string, now = new Date()): Promise<number> {
  const rows = await prisma.usageDaily.findMany({
    where: { ownerId, day: { gte: monthStart(now) }, kind: { in: ["AI_REPLY", "AI_TRANSLATE", "AI_TEMPLATE"] } },
    select: { inputTokens: true, outputTokens: true },
  });
  const inTok = rows.reduce((n, r) => n + r.inputTokens, 0), outTok = rows.reduce((n, r) => n + r.outputTokens, 0);
  const pin = Number(process.env.AI_INPUT_EUR_PER_MTOK ?? 0), pout = Number(process.env.AI_OUTPUT_EUR_PER_MTOK ?? 0);
  return Math.ceil(((inTok * pin + outTok * pout) / 1_000_000) * 100);
}

export async function assertAiBudget(ownerId: string, now = new Date()): Promise<void> {
  const owner = await prisma.owner.findUniqueOrThrow({ where: { id: ownerId }, select: { monthlyAiBudgetCents: true } });
  if ((await monthlyAiCostCents(ownerId, now)) >= owner.monthlyAiBudgetCents) {
    throw new BudgetExceededError("Monthly AI budget reached.");
  }
}

export async function monthlyCount(ownerId: string, kind: UsageKind, now = new Date()): Promise<number> {
  const r = await prisma.usageDaily.aggregate({ where: { ownerId, kind, day: { gte: monthStart(now) } }, _sum: { count: true } });
  return r._sum.count ?? 0;
}

/** Check if 80% of AI budget is reached and send warning email if not already sent this month. */
export async function checkAndSendBudgetWarning(ownerId: string, now = new Date()): Promise<void> {
  const owner = await prisma.owner.findUniqueOrThrow({
    where: { id: ownerId },
    select: { monthlyAiBudgetCents: true, budgetWarnedMonth: true, email: true },
  });

  const currentMonth = monthKey(now);
  if (owner.budgetWarnedMonth === currentMonth) return; // Already warned this month

  const currentCostCents = await monthlyAiCostCents(ownerId, now);
  const warningThreshold = Math.floor(owner.monthlyAiBudgetCents * 0.8);

  if (currentCostCents >= warningThreshold) {
    await notifyHost({
      to: owner.email,
      subject: "AI budget warning: 80% reached",
      text: `You have used 80% of your monthly AI budget.\n\nCurrent cost: €${(currentCostCents / 100).toFixed(2)}\nBudget: €${(owner.monthlyAiBudgetCents / 100).toFixed(2)}\n\nAutomatic AI replies will stop when the budget is reached. You can increase the budget by contacting the operator.`,
    });
    await prisma.owner.update({
      where: { id: ownerId },
      data: { budgetWarnedMonth: currentMonth },
    });
  }
}

export { monthKey };
