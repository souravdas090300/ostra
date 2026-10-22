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

  const result = await withJobRun("inbound-recovery", async () => {
    const now = new Date();
    const threeMinutesAgo = new Date(now.getTime() - 3 * 60_000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60_000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000);

    // Find guest messages that were not answered (system restarted during processing)
    const unansweredMessages = await prisma.message.findMany({
      where: {
        direction: "INBOUND",
        author: "GUEST",
        escalated: false,
        createdAt: { gte: threeMinutesAgo, lte: twentyFourHoursAgo },
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

    let escalated = 0;

    for (const message of unansweredMessages) {
      // Check if there's a later OUTBOUND message (already answered)
      const hasReply = await prisma.message.count({
        where: {
          bookingId: message.bookingId,
          direction: "OUTBOUND",
          createdAt: { gt: message.createdAt },
        },
      });

      if (hasReply > 0) continue;

      // Check for message floods (20+ inbound in last hour)
      const floodCount = await prisma.message.count({
        where: {
          bookingId: message.bookingId,
          direction: "INBOUND",
          createdAt: { gte: oneHourAgo },
        },
      });

      if (floodCount >= 20) continue;

      // Escalate the message
      await prisma.message.update({
        where: { id: message.id },
        data: {
          escalated: true,
          escalationReason: "No reply was sent (the system restarted). Please answer.",
          hostSummary: "A guest message was not answered automatically. Please reply.",
        },
      });

      // Notify the host
      await notifyHost({
        to: message.booking.apartment.owner.email,
        subject: `Guest needs you at ${message.booking.apartment.name}`,
        text: `${message.hostSummary}\n\nOpen: ${process.env.APP_URL}/inbox/${message.bookingId}`,
      });

      escalated++;
    }

    revalidatePath("/inbox");

    return { escalated };
  });

  return Response.json(result);
}
