import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { loadCalendarData } from "@/lib/calendar-data";
import { addDays, eachDay, parseFromParam, todayMalta, formatYmd } from "@/lib/dates";
import { findDoubleBookings, findTurnovers, findMissingContacts } from "@/lib/conflicts";
import { feedIssues } from "@/lib/feed-health";
import { buildRows } from "@/lib/calendar-view";
import { Timeline } from "@/components/Timeline";
import { TodayPanel } from "@/components/TodayPanel";
import { AttentionPanel } from "@/components/AttentionPanel";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; days?: string }>;
}) {
  const session = await requireOwner();
  const sp = await searchParams;
  const now = new Date();
  const today = todayMalta(now);
  const days = sp.days === "28" ? 28 : 14;
  const from = parseFromParam(sp.from, today) ?? today;

  const data = await loadCalendarData(session.user.id, from, days, today);

  if (data.apartments.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <p className="text-gray-600">
          Add your first apartment to start.{" "}
          <Link className="underline" href="/apartments/new">
            Add apartment
          </Link>
        </p>
      </div>
    );
  }

  const doubleIds = new Set(
    findDoubleBookings(data.viewStays).flatMap((d) => [d.a.id, d.b.id])
  );
  const rows = buildRows({
    apartments: data.apartments,
    stays: data.viewStays,
    from,
    days,
    doubleIds,
    turnovers: findTurnovers(data.viewStays),
  });

  const nameOf = new Map(data.apartments.map((a) => [a.id, a.name]));
  const href = (f: string) => `/calendar?from=${f}&days=${days}`;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Calendar</h1>

      <TodayPanel
        today={today}
        tomorrow={addDays(today, 1)}
        stays={data.upcomingStays}
        apartmentNames={Object.fromEntries(nameOf)}
      />

      <AttentionPanel
        apartmentNames={Object.fromEntries(nameOf)}
        doubles={findDoubleBookings(data.upcomingStays)}
        missing={findMissingContacts(data.upcomingStays, today)}
        feedIssues={feedIssues(data.feeds, now)}
        now={now.toISOString()}
      />

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-600">
            {formatYmd(from)} to {formatYmd(addDays(from, days - 1))}
          </p>
          <nav className="flex items-center gap-2 text-sm">
            <Link className="rounded border px-3 py-1.5" href={href(addDays(from, -days))}>
              Previous
            </Link>
            <Link className="rounded border px-3 py-1.5" href={href(today)}>
              Today
            </Link>
            <Link className="rounded border px-3 py-1.5" href={href(addDays(from, days))}>
              Next
            </Link>
            <Link
              className="rounded border px-3 py-1.5"
              href={`/calendar?from=${from}&days=${days === 14 ? 28 : 14}`}
            >
              {days === 14 ? "4 weeks" : "2 weeks"}
            </Link>
          </nav>
        </div>
        <Timeline days={eachDay(from, days)} today={today} rows={rows} />
        <Legend />
      </section>
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-3 text-xs text-gray-600">
      <li>A = Airbnb</li>
      <li>B = Booking.com</li>
      <li>D = Direct</li>
      <li>Grey striped = blocked dates</li>
      <li>Red outline = double booking</li>
      <li>Amber marker = same-day turnover</li>
    </ul>
  );
}
