import { requireOwner } from "@/lib/auth";
import { collectLeadData } from "@/lib/guest-data";
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const session = await requireOwner();
  const { searchParams } = new URL(req.url);
  const leadId = searchParams.get("leadId");
  const scope = (searchParams.get("scope") || "lead") as "lead" | "phone";

  if (!leadId) {
    return NextResponse.json({ error: "leadId required" }, { status: 400 });
  }

  // Verify ownership
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
  });

  if (!lead || lead.ownerId !== session.user.id) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      ownerId: session.user.id,
      action: "EXPORT_LEAD",
      targetType: "lead",
      targetId: leadId,
    },
  });

  const leadIds = scope === "phone"
    ? (await prisma.lead.findMany({
        where: {
          ownerId: session.user.id,
          phone: lead.phone,
        },
        select: { id: true },
      })).map((l) => l.id)
    : [leadId];

  const data = await collectLeadData(session.user.id, leadIds);

  return NextResponse.json(data, {
    headers: {
      "Content-Disposition": `attachment; filename="lead-data-${leadId}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
