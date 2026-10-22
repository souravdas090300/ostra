import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { monthlyAiCostCents, monthlyCount } from "@/lib/usage";
import Link from "next/link";

export default async function UsagePage() {
  const owner = await requireOwner();
  const now = new Date();

  // Get current month usage
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const twoMonthsAgoStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));

  const [ownerData, currentUsage, previousUsage, twoMonthsAgoUsage] = await Promise.all([
    prisma.owner.findUnique({
      where: { id: owner.id },
      select: {
        monthlyAiBudgetCents: true,
        monthlyTemplateCap: true,
        waTemplateCost: true,
      },
    }),
    prisma.usageDaily.findMany({
      where: { ownerId: owner.id, day: { gte: currentMonthStart } },
      select: { kind: true, count: true, inputTokens: true, outputTokens: true },
    }),
    prisma.usageDaily.findMany({
      where: { ownerId: owner.id, day: { gte: previousMonthStart, lt: currentMonthStart } },
      select: { kind: true, count: true, inputTokens: true, outputTokens: true },
    }),
    prisma.usageDaily.findMany({
      where: { ownerId: owner.id, day: { gte: twoMonthsAgoStart, lt: previousMonthStart } },
      select: { kind: true, count: true, inputTokens: true, outputTokens: true },
    }),
  ]);

  if (!ownerData) {
    throw new Error("Owner not found");
  }

  const aiBudgetEur = ownerData.monthlyAiBudgetCents / 100;
  const templateCap = ownerData.monthlyTemplateCap;
  const templateCostEur = Number(ownerData.waTemplateCost);

  const summarize = (rows: typeof currentUsage) => {
    const aiReplies = rows.filter((r) => r.kind === "AI_REPLY");
    const aiTranslates = rows.filter((r) => r.kind === "AI_TRANSLATE");
    const aiTemplates = rows.filter((r) => r.kind === "AI_TEMPLATE");
    const waTemplates = rows.filter((r) => r.kind === "WA_TEMPLATE");
    const waFreeform = rows.filter((r) => r.kind === "WA_FREEFORM");

    const inputTokens = aiReplies.reduce((s, r) => s + r.inputTokens, 0) + aiTranslates.reduce((s, r) => s + r.inputTokens, 0) + aiTemplates.reduce((s, r) => s + r.inputTokens, 0);
    const outputTokens = aiReplies.reduce((s, r) => s + r.outputTokens, 0) + aiTranslates.reduce((s, r) => s + r.outputTokens, 0) + aiTemplates.reduce((s, r) => s + r.outputTokens, 0);

    const aiRepliesCount = aiReplies.reduce((s, r) => s + r.count, 0);
    const aiTranslatesCount = aiTranslates.reduce((s, r) => s + r.count, 0);
    const aiTemplatesCount = aiTemplates.reduce((s, r) => s + r.count, 0);
    const waTemplatesCount = waTemplates.reduce((s, r) => s + r.count, 0);
    const waFreeformCount = waFreeform.reduce((s, r) => s + r.count, 0);

    const aiCostCents = inputTokens * Number(process.env.AI_INPUT_EUR_PER_MTOK ?? 0) / 1_000_000 * 100 + outputTokens * Number(process.env.AI_OUTPUT_EUR_PER_MTOK ?? 0) / 1_000_000 * 100;
    const waCostEur = waTemplatesCount * templateCostEur;

    return {
      aiReplies: aiRepliesCount,
      aiTranslates: aiTranslatesCount,
      aiTemplates: aiTemplatesCount,
      waTemplates: waTemplatesCount,
      waFreeform: waFreeformCount,
      inputTokens,
      outputTokens,
      aiCostEur: Math.ceil(aiCostCents) / 100,
      waCostEur,
    };
  };

  const current = summarize(currentUsage);
  const previous = summarize(previousUsage);
  const twoMonthsAgo = summarize(twoMonthsAgoUsage);

  const currentAiCostCents = await monthlyAiCostCents(owner.id, now);
  const currentTemplateCount = await monthlyCount(owner.id, "WA_TEMPLATE", now);

  const aiPercent = (currentAiCostCents / ownerData.monthlyAiBudgetCents) * 100;
  const templatePercent = (currentTemplateCount / ownerData.monthlyTemplateCap) * 100;

  const monthName = (d: Date) => d.toLocaleString("default", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Usage and costs</h1>
        <p className="mt-2 text-sm text-gray-600">
          AI and WhatsApp usage this month and the previous two months.
        </p>
      </div>

      <div className="space-y-2">
        <Link href="/settings" className="block text-blue-600 hover:text-blue-800">
          ← Back to settings
        </Link>
      </div>

      {/* Current month */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">{monthName(currentMonthStart)} (current)</h2>
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex justify-between text-sm">
              <span>AI cost</span>
              <span>€{current.aiCostEur.toFixed(2)} / €{aiBudgetEur.toFixed(2)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-gray-200">
              <div
                className={`h-2 rounded-full ${aiPercent > 80 ? "bg-red-500" : aiPercent > 50 ? "bg-yellow-500" : "bg-green-500"}`}
                style={{ width: `${Math.min(aiPercent, 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-600">
              {aiPercent.toFixed(0)}% of budget · {current.aiReplies} replies · {current.aiTranslates} translations · {current.aiTemplates} templates
            </p>
          </div>

          <div>
            <div className="flex justify-between text-sm">
              <span>WhatsApp template messages</span>
              <span>{currentTemplateCount} / {templateCap}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-gray-200">
              <div
                className={`h-2 rounded-full ${templatePercent > 80 ? "bg-red-500" : templatePercent > 50 ? "bg-yellow-500" : "bg-green-500"}`}
                style={{ width: `${Math.min(templatePercent, 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-600">
              {templatePercent.toFixed(0)}% of cap · Estimated cost: €{current.waCostEur.toFixed(2)}
            </p>
          </div>

          <div className="text-sm">
            <p>Free-form WhatsApp messages: {current.waFreeform}</p>
            <p>Total AI tokens: {current.inputTokens.toLocaleString()} input · {current.outputTokens.toLocaleString()} output</p>
          </div>
        </div>
      </div>

      {/* Previous month */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">{monthName(previousMonthStart)}</h2>
        <div className="mt-4 space-y-2 text-sm">
          <p>AI cost: €{previous.aiCostEur.toFixed(2)}</p>
          <p>AI replies: {previous.aiReplies} · Translations: {previous.aiTranslates} · Templates: {previous.aiTemplates}</p>
          <p>WhatsApp templates: {previous.waTemplates} (€{previous.waCostEur.toFixed(2)})</p>
          <p>Free-form messages: {previous.waFreeform}</p>
        </div>
      </div>

      {/* Two months ago */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">{monthName(twoMonthsAgoStart)}</h2>
        <div className="mt-4 space-y-2 text-sm">
          <p>AI cost: €{twoMonthsAgo.aiCostEur.toFixed(2)}</p>
          <p>AI replies: {twoMonthsAgo.aiReplies} · Translations: {twoMonthsAgo.aiTranslates} · Templates: {twoMonthsAgo.aiTemplates}</p>
          <p>WhatsApp templates: {twoMonthsAgo.waTemplates} (€{twoMonthsAgo.waCostEur.toFixed(2)})</p>
          <p>Free-form messages: {twoMonthsAgo.waFreeform}</p>
        </div>
      </div>

      {/* Settings */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">Budget and cap settings</h2>
        <p className="mt-2 text-sm text-gray-600">
          Contact the operator to change these settings.
        </p>
        <div className="mt-4 space-y-2 text-sm">
          <p>Monthly AI budget: €{aiBudgetEur.toFixed(2)}</p>
          <p>Monthly template cap: {templateCap}</p>
          <p>Cost per template message: €{templateCostEur.toFixed(4)}</p>
        </div>
      </div>
    </div>
  );
}
