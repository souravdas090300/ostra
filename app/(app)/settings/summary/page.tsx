import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import WeeklySummaryToggle from "./WeeklySummaryToggle";

export default async function WeeklySummaryPage() {
  const session = await requireOwner();
  const owner = await prisma.owner.findUnique({
    where: { id: session.id },
    select: { weeklySummaryEnabled: true },
  });

  if (!owner) {
    throw new Error("Owner not found");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Weekly Summary Email</h1>
        <p className="mt-2 text-sm text-gray-600">
          Receive a weekly email summary every Monday morning with upcoming arrivals, departures, occupancy, and items needing attention.
        </p>
      </div>

      <WeeklySummaryToggle enabled={owner.weeklySummaryEnabled} />
    </div>
  );
}
