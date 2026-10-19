import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { ApartmentForm } from "@/components/ApartmentForm";
import { FeedManager } from "@/components/FeedManager";
import { DeleteButton } from "@/components/DeleteButton";
import { updateApartment, deleteApartment } from "../actions";

export default async function ApartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOwner();
  const a = await prisma.apartment.findFirst({
    where: { id, ownerId: session.user.id },
    include: { feeds: true },
  });
  if (!a) notFound();

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
      <FeedManager apartmentId={a.id} feeds={a.feeds.map((f) => ({
        id: f.id, source: f.source, icalUrl: f.icalUrl, lastSyncAt: f.lastSyncAt?.toISOString() ?? null, lastSuccessAt: f.lastSuccessAt?.toISOString() ?? null, lastError: f.lastError,
      }))} />
      <form action={deleteApartment.bind(null, a.id)}>
        <DeleteButton label="Delete this apartment and all its bookings" />
      </form>
    </div>
  );
}
