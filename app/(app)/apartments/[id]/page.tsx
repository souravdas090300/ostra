import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { ApartmentForm } from "@/components/ApartmentForm";
import { FeedManager } from "@/components/FeedManager";
import { ExportPanel } from "@/components/ExportPanel";
import { RateManager } from "@/components/RateManager";
import { TryDates } from "@/components/TryDates";
import { DeleteButton } from "@/components/DeleteButton";
import { updateApartment, deleteApartment } from "../actions";
import { ensureExportFeeds } from "../export-actions";

export default async function ApartmentPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const session = await requireOwner();
  const a = await prisma.apartment.findFirst({
    where: { id, ownerId: session.id },
    include: { feeds: true, exportFeeds: true, rates: true },
  });
  if (!a) notFound();

  // Ensure export feeds exist for this apartment
  await ensureExportFeeds(a.id);

  const appUrl = process.env.APP_URL || "http://localhost:3000";

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">{a.name}</h1>
      <ApartmentForm
        action={updateApartment.bind(null, a.id)}
        submitLabel="Save changes"
        values={{
          name: a.name, address: a.address, checkInTime: a.checkInTime, checkOutTime: a.checkOutTime,
          maxGuests: a.maxGuests, bedrooms: a.bedrooms, minNights: a.minNights,
          baseNightlyEuros: a.baseNightlyCents / 100, cleaningFeeEuros: a.cleaningFeeCents / 100,
          info: a.info, publicInfo: a.publicInfo, reviewUrl: a.reviewUrl ?? "",
        }}
      />
      <RateManager
        apartmentId={a.id}
        rates={a.rates.map((r) => ({
          id: r.id,
          startDate: r.startDate.toISOString(),
          endDate: r.endDate.toISOString(),
          nightlyCents: r.nightlyCents,
          minNights: r.minNights,
        }))}
      />
      <TryDates apartmentId={a.id} />
      <FeedManager apartmentId={a.id} feeds={a.feeds.map((f) => ({
        id: f.id, source: f.source, icalUrl: f.icalUrl, lastSyncAt: f.lastSyncAt?.toISOString() ?? null, lastSuccessAt: f.lastSuccessAt?.toISOString() ?? null, lastError: f.lastError,
      }))} />
      <ExportPanel
        apartmentId={a.id}
        feeds={a.exportFeeds.map((f) => ({
          id: f.id,
          target: f.target,
          token: f.token,
          enabled: f.enabled,
          enabledAt: f.enabledAt,
          confirmedAt: f.confirmedAt,
          lastFetchedAt: f.lastFetchedAt,
          fetchCount: f.fetchCount,
        }))}
        appUrl={appUrl}
      />
      <form action={deleteApartment.bind(null, a.id)}>
        <DeleteButton label="Delete this apartment and all its bookings" />
      </form>
    </div>
  );
}
