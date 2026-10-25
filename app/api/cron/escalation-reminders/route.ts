import { prisma } from "@/lib/db";
import { withJobRun } from "@/lib/job-run";
import { notifyHost } from "@/lib/notify";
import { revalidatePath } from "next/cache";
import { requireCronAuth } from "@/lib/cron-auth";

export async function POST(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const result = await withJobRun("escalation-reminders", async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000);

    // Find unresolved escalated booking messages that haven't had a reminder
    const needsReminder = await prisma.message.findMany({
      where: {
        escalated: true,
        resolved: false,
        reminderSentAt: null,
        createdAt: { lt: oneHourAgo },
      },
      include: {
        booking: {
          include: {
            apartment: {
              include: {
                owner: true,
              },
            },
          },
        },
      },
    });

    // Find unresolved escalated lead messages that haven't had a reminder
    const needsLeadReminder = await prisma.leadMessage.findMany({
      where: {
        escalated: true,
        resolved: false,
        reminderSentAt: null,
        createdAt: { lt: oneHourAgo },
      },
      include: {
        lead: {
          include: {
            owner: true,
          },
        },
      },
    });

    let reminded = 0;

    for (const message of needsReminder) {
      await notifyHost({
        to: message.booking.apartment.owner.email,
        subject: `Reminder: Guest needs you at ${message.booking.apartment.name}`,
        text: `${message.hostSummary}\n\nOpen: ${process.env.APP_URL}/inbox/${message.bookingId}`,
      });

      await prisma.message.update({
        where: { id: message.id },
        data: { reminderSentAt: now },
      });

      reminded++;
    }

    for (const message of needsLeadReminder) {
      await notifyHost({
        to: message.lead.owner.email,
        subject: `Reminder: Enquiry needs your attention`,
        text: `${message.hostSummary}\n\nOpen: ${process.env.APP_URL}/leads/${message.leadId}`,
      });

      await prisma.leadMessage.update({
        where: { id: message.id },
        data: { reminderSentAt: now },
      });

      reminded++;
    }

    revalidatePath("/inbox");
    revalidatePath("/leads");

    return { reminded, bookingReminders: needsReminder.length, leadReminders: needsLeadReminder.length };
  });

  return Response.json(result);
}
