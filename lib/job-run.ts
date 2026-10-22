import { prisma } from "./db";
import { reportError } from "./report-error";

export async function withJobRun<T extends Record<string, number>>(job: string, fn: () => Promise<T>): Promise<T> {
  const run = await prisma.jobRun.create({ data: { job } });
  try {
    const result = await fn();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { ok: true, finishedAt: new Date(), summary: JSON.stringify(result).slice(0, 500) },
    });
    return result;
  } catch (e) {
    await prisma.jobRun.update({ where: { id: run.id }, data: { ok: false, finishedAt: new Date() } });
    reportError(e, { job });
    throw e;
  }
}
