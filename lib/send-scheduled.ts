import { prisma } from "./db";
import { buildValues, pickTranslation, renderText } from "./message-render";
import { inAllowedWindow, latestUseful } from "./send-time";
import { toTwilioBody } from "./templates";
import { WhatsAppError, sendWhatsApp, whatsappMode } from "./whatsapp";
import { automaticMessagesEnabled } from "./flags";
import { monthlyCount, recordUsage } from "./usage";

const BATCH = 20;
const MAX_ATTEMPTS = 3;
const STUCK_MS = 15 * 60_000;

export type SendSummary = {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
};

export async function sendDueMessages(now = new Date()): Promise<SendSummary> {
  const summary: SendSummary = { claimed: 0, sent: 0, skipped: 0, failed: 0, retried: 0 };

  // Kill switch: if automatic messages are disabled, leave everything PENDING.
  if (!automaticMessagesEnabled()) return summary;

  // A row stuck in SENDING may or may not have reached WhatsApp. Never retry it automatically.
  await prisma.scheduledMessage.updateMany({
    where: { status: "SENDING", claimedAt: { lt: new Date(now.getTime() - STUCK_MS) } },
    data: { status: "FAILED", lastError: "Unclear whether this was sent. Check before resending." },
  });

  if (!inAllowedWindow(now)) return summary; // quiet hours: leave everything PENDING

  // Atomic claim: two runs at once can never take the same row.
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "ScheduledMessage"
    SET "status" = 'SENDING', "claimedAt" = ${now}, "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "ScheduledMessage"
      WHERE "status" = 'PENDING' AND "sendAt" <= ${now}
      ORDER BY "sendAt" ASC LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"
  `;
  summary.claimed = claimed.length;
  for (const { id } of claimed) await sendOne(id, now, summary);
  return summary;
}

async function sendOne(id: string, now: Date, s: SendSummary) {
  const row = await prisma.scheduledMessage.findUniqueOrThrow({
    where: { id },
    include: {
      booking: {
        include: {
          apartment: {
            include: { owner: { include: { templates: { include: { translations: true } } } } },
          },
        },
      },
    },
  });
  const b = row.booking,
    apt = b.apartment,
    owner = apt.owner;
  const mark = async (data: Record<string, unknown>) =>
    prisma.scheduledMessage.update({ where: { id }, data });

  // Re-check everything: the booking may have changed since it was scheduled.
  const eligible =
    !b.isBlock &&
    b.status === "CONFIRMED" &&
    !!b.guestPhone &&
    !!b.optedInAt &&
    !b.optedOutAt &&
    !b.messagesPaused;
  if (!eligible) {
    await mark({ status: "CANCELLED", skipReason: "Booking not eligible for messages" });
    s.skipped++;
    return;
  }
  if (now > latestUseful(row.type as "PRE_ARRIVAL" | "CHECK_IN" | "CHECK_OUT" | "REVIEW_REQUEST", b)) {
    await mark({ status: "SKIPPED", skipReason: "Too late to send this message." });
    s.skipped++;
    return;
  }

  const template = owner.templates.find((t) => t.type === row.type);
  if (!template || !template.enabled) {
    await mark({ status: "CANCELLED", skipReason: "Template disabled" });
    s.skipped++;
    return;
  }

  const mode = whatsappMode();
  const language = b.guestLanguage ?? owner.defaultGuestLanguage;
  const picked = pickTranslation(template.translations, language, owner.fallbackLanguage, mode);
  if (!picked) {
    await mark({
      status: "SKIPPED",
      skipReason: `No approved template for ${language} or ${owner.fallbackLanguage}.`,
    });
    s.skipped++;
    return;
  }

  // Monthly template cap check.
  const monthCount = await monthlyCount(owner.id, "WA_TEMPLATE", now);
  if (monthCount >= owner.monthlyTemplateCap) {
    await mark({ status: "PENDING", attempts: { decrement: 1 }, claimedAt: null }); // try again next run
    return;
  }

  // Daily cap per owner as a safety net against loops and mistakes.
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const sentToday = await prisma.scheduledMessage.count({
    where: {
      status: "SENT",
      sentAt: { gte: since },
      booking: { apartment: { ownerId: owner.id } },
    },
  });
  if (sentToday >= Number(process.env.MAX_TEMPLATE_SENDS_PER_DAY ?? 100)) {
    await mark({ status: "PENDING", attempts: { decrement: 1 }, claimedAt: null }); // try again next run
    return;
  }

  const values = buildValues(b, apt, picked.translation.language);
  const text = renderText(picked.translation.body, values);
  const { order } = toTwilioBody(picked.translation.body);
  const variables = Object.fromEntries(order.map((name, i) => [String(i + 1), values[name] ?? ""]));

  try {
    const { sid } = await sendWhatsApp({
      to: b.guestPhone!,
      text,
      template: picked.translation.contentSid
        ? { contentSid: picked.translation.contentSid, variables }
        : undefined,
      ownerId: owner.id,
      kind: "WA_TEMPLATE",
    });
    await prisma.$transaction([
      prisma.scheduledMessage.update({
        where: { id },
        data: {
          status: "SENT",
          sentAt: now,
          twilioSid: sid,
          language: picked.translation.language,
          lastError: null,
        },
      }),
      prisma.message.create({
        data: {
          bookingId: b.id,
          direction: "OUTBOUND",
          author: "SYSTEM",
          body: text,
          scheduledMessageId: id,
          twilioSid: sid,
          deliveryStatus: sid ? "queued" : "dry-run",
        },
      }),
    ]);
    s.sent++;
  } catch (e) {
    const err = e instanceof WhatsAppError ? e : new WhatsAppError("Unknown error", false);
    const final = err.permanent || row.attempts >= MAX_ATTEMPTS;
    const lastError = err.permanent
      ? `WhatsApp rejected the message${err.code ? ` (code ${err.code})` : ""}. Check the guest's number.`
      : `Temporary problem sending${err.code ? ` (code ${err.code})` : ""}.`;
    if (final) {
      await mark({ status: "FAILED", lastError, claimedAt: null });
      s.failed++;
    } else {
      await mark({
        status: "PENDING",
        lastError,
        claimedAt: null,
        sendAt: new Date(now.getTime() + 15 * 60_000 * row.attempts),
      });
      s.retried++;
    }
  }
}
