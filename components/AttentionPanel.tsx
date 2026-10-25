import Link from "next/link";
import { addDays, formatYmd, timeAgo } from "@/lib/dates";
import { SOURCE_LABEL } from "@/lib/calendar-view";
import type { DoubleBooking } from "@/lib/conflicts";
import type { Stay, SourceName } from "@/lib/conflicts";
import type { FeedIssue } from "@/lib/feed-health";

type MessageIssue = {
  bookingId: string;
  apartmentId: string;
  type: string;
  reason: string;
  createdAt: Date;
};

type DeliveryIssue = {
  bookingId: string;
  apartmentId: string;
  deliveryStatus: string | null;
  createdAt: Date;
};

type SkippedForNoTemplate = {
  language: string;
  count: number;
  apartmentIds: string[];
};

type EscalatedMessage = {
  bookingId: string;
  apartmentId: string;
  urgent: boolean;
  hostSummary: string;
  createdAt: Date;
};

type ExportFeedIssue = {
  apartmentId: string;
  apartmentName: string;
  target: string;
  state: string;
  lastFetchedAt: Date | null;
};

export function AttentionPanel({
  apartmentNames,
  doubles,
  missing,
  feedIssues,
  exportFeedIssues,
  messageIssues,
  deliveryIssues,
  skippedForNoTemplate,
  escalatedMessages,
  unmatchedCount,
  now,
}: {
  apartmentNames: Record<string, string>;
  doubles: DoubleBooking[];
  missing: Stay[];
  feedIssues: FeedIssue[];
  exportFeedIssues: ExportFeedIssue[];
  messageIssues: MessageIssue[];
  deliveryIssues: DeliveryIssue[];
  skippedForNoTemplate: SkippedForNoTemplate[];
  escalatedMessages: EscalatedMessage[];
  unmatchedCount: number;
  now: string;
}) {
  const nowDate = new Date(now);

  if (
    doubles.length === 0 &&
    missing.length === 0 &&
    feedIssues.length === 0 &&
    exportFeedIssues.length === 0 &&
    messageIssues.length === 0 &&
    deliveryIssues.length === 0 &&
    skippedForNoTemplate.length === 0 &&
    escalatedMessages.length === 0 &&
    unmatchedCount === 0
  ) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="text-lg font-semibold">Needs attention</h2>
      <div className="mt-4 space-y-4">
        {/* Double bookings */}
        {doubles.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-red-800">Double bookings</h3>
            <ul className="mt-2 space-y-1">
              {doubles.slice(0, 5).map((d) => (
                <li key={`${d.a.id}-${d.b.id}`} className="text-sm">
                  <Link
                    href={`/calendar?from=${addDays(d.overlapFrom, -1)}`}
                    className="text-red-700 underline"
                  >
                    {apartmentNames[d.apartmentId]}: {SOURCE_LABEL[d.a.source]} booking and{" "}
                    {SOURCE_LABEL[d.b.source]} booking overlap {formatYmd(d.overlapFrom)} to{" "}
                    {formatYmd(d.overlapTo)}
                  </Link>
                  <div className="ml-4 flex gap-2">
                    <Link href={`/bookings/${d.a.id}`} className="text-xs text-blue-600 underline">
                      Open {SOURCE_LABEL[d.a.source]}
                    </Link>
                    <Link href={`/bookings/${d.b.id}`} className="text-xs text-blue-600 underline">
                      Open {SOURCE_LABEL[d.b.source]}
                    </Link>
                  </div>
                </li>
              ))}
              {doubles.length > 5 && (
                <li className="text-sm text-gray-500">
                  and {doubles.length - 5} more
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Feed issues */}
        {feedIssues.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-amber-800">Feed problems</h3>
            <ul className="mt-2 space-y-1">
              {feedIssues.slice(0, 5).map((f) => (
                <li key={f.feedId} className="text-sm">
                  {f.kind === "error" && (
                    <Link
                      href={`/apartments/${f.apartmentId}`}
                      className="text-amber-700 underline"
                    >
                      {apartmentNames[f.apartmentId]} ({SOURCE_LABEL[f.source as SourceName]}): calendar
                      sync problem: {f.detail}
                    </Link>
                  )}
                  {f.kind === "never" && (
                    <Link
                      href={`/apartments/${f.apartmentId}`}
                      className="text-amber-700 underline"
                    >
                      {apartmentNames[f.apartmentId]} ({SOURCE_LABEL[f.source as SourceName]}): has not
                      synced yet
                    </Link>
                  )}
                  {f.kind === "stale" && (
                    <Link
                      href={`/apartments/${f.apartmentId}`}
                      className="text-amber-700 underline"
                    >
                      {apartmentNames[f.apartmentId]} ({SOURCE_LABEL[f.source as SourceName]}): last synced{" "}
                      {f.since ? timeAgo(f.since, nowDate) : "unknown"}
                    </Link>
                  )}
                </li>
              ))}
              {feedIssues.length > 5 && (
                <li className="text-sm text-gray-500">
                  and {feedIssues.length - 5} more
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Export feed issues */}
        {exportFeedIssues.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-amber-800">Export feed problems</h3>
            <ul className="mt-2 space-y-1">
              {exportFeedIssues.slice(0, 5).map((f) => (
                <li key={`${f.apartmentId}-${f.target}`} className="text-sm">
                  <Link
                    href={`/apartments/${f.apartmentId}`}
                    className="text-amber-700 underline"
                  >
                    {f.target === "AIRBNB" ? "Airbnb" : "Booking.com"} export for {f.apartmentName}:{" "}
                    {f.state === "STALE"
                      ? `has not read the calendar link for ${f.lastFetchedAt ? timeAgo(f.lastFetchedAt, nowDate) : "a while"}`
                      : "has been waiting for platform to read it for over 24 hours"}
                  </Link>
                </li>
              ))}
              {exportFeedIssues.length > 5 && (
                <li className="text-sm text-gray-500">
                  and {exportFeedIssues.length - 5} more
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Missing phone numbers or opt-in */}
        {missing.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-amber-800">Missing phone numbers or opt-in</h3>
            <ul className="mt-2 space-y-1">
              {missing.slice(0, 5).map((s) => (
                <li key={s.id} className="text-sm">
                  <Link
                    href={`/bookings/${s.id}#guest`}
                    className="text-amber-700 underline"
                  >
                    {apartmentNames[s.apartmentId]}: arrival {formatYmd(s.inYmd)} (
                    {SOURCE_LABEL[s.source]}) {s.guestPhone ? "guest has not agreed to WhatsApp messages" : "has no phone number"}
                  </Link>
                </li>
              ))}
              {missing.length > 5 && (
                <li className="text-sm text-gray-500">
                  and {missing.length - 5} more
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Failed scheduled messages */}
        {messageIssues.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-red-800">Failed scheduled messages</h3>
            <ul className="mt-2 space-y-1">
              {messageIssues.slice(0, 5).map((m) => (
                <li key={`${m.bookingId}-${m.type}`} className="text-sm">
                  <Link
                    href={`/bookings/${m.bookingId}`}
                    className="text-red-700 underline"
                  >
                    {apartmentNames[m.apartmentId]}: {m.type.replace(/_/g, " ")} - {m.reason}
                  </Link>
                </li>
              ))}
              {messageIssues.length > 5 && (
                <li className="text-sm text-gray-500">
                  and {messageIssues.length - 5} more
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Messages with delivery failures */}
        {deliveryIssues.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-red-800">Delivery failures</h3>
            <ul className="mt-2 space-y-1">
              {deliveryIssues.slice(0, 5).map((d) => (
                <li key={`${d.bookingId}-${d.deliveryStatus}`} className="text-sm">
                  <Link
                    href={`/bookings/${d.bookingId}`}
                    className="text-red-700 underline"
                  >
                    {apartmentNames[d.apartmentId]}: {d.deliveryStatus}
                  </Link>
                </li>
              ))}
              {deliveryIssues.length > 5 && (
                <li className="text-sm text-gray-500">
                  and {deliveryIssues.length - 5} more
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Messages skipped for no approved template */}
        {skippedForNoTemplate.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-amber-800">Messages skipped (no approved template)</h3>
            <ul className="mt-2 space-y-1">
              {skippedForNoTemplate.slice(0, 5).map((s) => (
                <li key={s.language} className="text-sm">
                  <Link href="/settings/messages" className="text-amber-700 underline">
                    {s.language}: {s.count} message{s.count !== 1 ? "s" : ""} skipped
                  </Link>
                </li>
              ))}
              {skippedForNoTemplate.length > 5 && (
                <li className="text-sm text-gray-500">and {skippedForNoTemplate.length - 5} more languages</li>
              )}
            </ul>
          </div>
        )}

        {/* Escalated guest messages */}
        {escalatedMessages.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-red-800">Guest messages needing your attention</h3>
            <ul className="mt-2 space-y-1">
              {escalatedMessages.slice(0, 5).map((m) => (
                <li key={m.bookingId} className="text-sm">
                  <Link href={`/inbox/${m.bookingId}`} className="text-red-700 underline">
                    {apartmentNames[m.apartmentId]}
                    {m.urgent && <span className="ml-2 font-bold">URGENT</span>}: {m.hostSummary}
                  </Link>
                </li>
              ))}
              {escalatedMessages.length > 5 && (
                <li className="text-sm text-gray-500">and {escalatedMessages.length - 5} more</li>
              )}
            </ul>
          </div>
        )}

        {/* Messages from unknown numbers */}
        {unmatchedCount > 0 && (
          <div>
            <h3 className="text-sm font-medium text-amber-800">Messages from numbers with no booking</h3>
            <p className="mt-2 text-sm text-amber-700">
              <Link href="/inbox?tab=unknown" className="underline">
                {unmatchedCount} message{unmatchedCount !== 1 ? "s" : ""}
              </Link>{" "}
              in the last 30 days
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
