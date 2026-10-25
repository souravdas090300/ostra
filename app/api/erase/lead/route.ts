import { requireOwner } from "@/lib/auth";
import { eraseLeadData } from "@/lib/guest-data";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await requireOwner();
  const body = await req.json();
  const { leadId, scope } = body as { leadId: string; scope: "lead" | "phone" };

  if (!leadId || !scope) {
    return NextResponse.json({ error: "leadId and scope required" }, { status: 400 });
  }

  if (scope !== "lead" && scope !== "phone") {
    return NextResponse.json({ error: "scope must be 'lead' or 'phone'" }, { status: 400 });
  }

  const result = await eraseLeadData(session.id, leadId, scope);

  return NextResponse.json(result);
}
