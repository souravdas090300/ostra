import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { withJobRun } from "@/lib/job-run";
import { notifyHost } from "@/lib/notify";
import { revalidatePath } from "next/cache";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await withJobRun("escalation-reminders", async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000);

    // Find unresolved escalated messages that haven't had a reminder in the last hour
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

    revalidatePath("/inbox");

    return { reminded };
  });

  return Response.json(result);
}
