import { formatYmd, diffDays, timeAgo } from "@/lib/dates";
import { type LinkState } from "@/lib/export-feeds";

type Props = {
  apartmentName: string;
  inYmd: string;
  outYmd: string;
  source: "DIRECT" | "AIRBNB" | "BOOKING_COM";
  states: Record<"AIRBNB" | "BOOKING_COM", LinkState>;
  lastFetched: Record<"AIRBNB" | "BOOKING_COM", Date | null>;
  now: Date;
};

export function PlatformBlockNotice(p: Props) {
  const { apartmentName, inYmd, outYmd, source, states, lastFetched, now } = p;
  const todayYmd = new Date(now.getTime()).toISOString().slice(0, 10);
  const daysUntil = diffDays(todayYmd, inYmd);
  const isNearStay = daysUntil >= 0 && daysUntil < 3;

  // Determine which platforms need blocking
  const platforms: Array<"AIRBNB" | "BOOKING_COM"> = [];
  if (source === "DIRECT") {
    platforms.push("AIRBNB", "BOOKING_COM");
  } else if (source === "AIRBNB") {
    platforms.push("BOOKING_COM");
  } else if (source === "BOOKING_COM") {
    platforms.push("AIRBNB");
  }

  if (platforms.length === 0) return null;

  const notices = platforms.map((platform) => {
    const state = states[platform];
    const platformName = platform === "AIRBNB" ? "Airbnb" : "Booking.com";

    if (state === "CONNECTED") {
      const lastRead = lastFetched[platform];
      const timeAgoStr = lastRead ? timeAgo(lastRead, now) : "never";
      return (
        <p key={platform} className="text-sm text-gray-600">
          Ostra&apos;s calendar link will block these dates on {platformName} within a few hours (it last read the link {timeAgoStr}).
          {isNearStay && " If the stay starts within 3 days, also block it by hand."}
        </p>
      );
    }

    // DISABLED, WAITING, or STALE
    let reason = "";
    if (state === "STALE") {
      const lastRead = lastFetched[platform];
      reason = lastRead ? `the calendar link has not been read for ${timeAgo(lastRead, now)}` : "the calendar link has not been read";
    } else if (state === "WAITING") {
      reason = "the platform has not read the calendar link yet";
    } else {
      reason = "the calendar link is turned off";
    }

    return (
      <div key={platform} role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">Block these dates on {platformName}</p>
        <p className="mt-1">
          In {platformName}, close {apartmentName} from {formatYmd(inYmd)} to {formatYmd(outYmd)} (guest leaves on {formatYmd(outYmd)}, so the last night to close is the night before), because {reason}.
        </p>
      </div>
    );
  });

  if (notices.length === 0) return null;

  // If all are connected soft notes, group them without the amber box
  const allConnected = platforms.every((pl) => states[pl] === "CONNECTED");
  if (allConnected) {
    return <div className="space-y-1">{notices}</div>;
  }

  return <div className="space-y-2">{notices}</div>;
}
