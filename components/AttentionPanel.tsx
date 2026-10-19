import Link from "next/link";
import { addDays, formatYmd, timeAgo } from "@/lib/dates";
import { SOURCE_LABEL } from "@/lib/calendar-view";
import type { DoubleBooking } from "@/lib/conflicts";
import type { Stay, SourceName } from "@/lib/conflicts";
import type { FeedIssue } from "@/lib/feed-health";

export function AttentionPanel({
  apartmentNames,
  doubles,
  missing,
  feedIssues,
  now,
}: {
  apartmentNames: Record<string, string>;
  doubles: DoubleBooking[];
  missing: Stay[];
  feedIssues: FeedIssue[];
  now: string;
}) {
  const nowDate = new Date(now);

  if (doubles.length === 0 && missing.length === 0 && feedIssues.length === 0) {
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

        {/* Missing phone numbers */}
        {missing.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-amber-800">Missing phone numbers</h3>
            <ul className="mt-2 space-y-1">
              {missing.slice(0, 5).map((s) => (
                <li key={s.id} className="text-sm">
                  <Link
                    href={`/bookings/${s.id}#guest`}
                    className="text-amber-700 underline"
                  >
                    {apartmentNames[s.apartmentId]}: arrival {formatYmd(s.inYmd)} (
                    {SOURCE_LABEL[s.source]}) has no phone number, so automatic messages will not
                    send
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
      </div>
    </div>
  );
}
