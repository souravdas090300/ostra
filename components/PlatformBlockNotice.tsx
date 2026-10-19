import { ICAL_EXPORT_ENABLED } from "@/lib/features";
import { formatYmd } from "@/lib/dates";

export function PlatformBlockNotice(p: { apartmentName: string; inYmd: string; outYmd: string }) {
  if (ICAL_EXPORT_ENABLED) return null;
  return (
    <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">Block these dates on Airbnb and Booking.com</p>
      <p className="mt-1">
        Ostra cannot block other platforms yet. In both apps, close {p.apartmentName} from {formatYmd(p.inYmd)} to{" "}
        {formatYmd(p.outYmd)} (guest leaves on {formatYmd(p.outYmd)}, so the last night to close is the night before),
        so nobody else books it.
      </p>
    </div>
  );
}
