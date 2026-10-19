import { formatYmd } from "@/lib/dates";
import { daySummary, findTurnovers } from "@/lib/conflicts";
import { SOURCE_LABEL } from "@/lib/calendar-view";
import type { Stay } from "@/lib/conflicts";

export function TodayPanel({
  today,
  tomorrow,
  stays,
  apartmentNames,
}: {
  today: string;
  tomorrow: string;
  stays: Stay[];
  apartmentNames: Record<string, string>;
}) {
  const todaySum = daySummary(stays, today);
  const tomorrowSum = daySummary(stays, tomorrow);
  const turnovers = findTurnovers(stays);

  const turnoverByApartmentDate = new Map<string, { gapHours: number; tight: boolean }>();
  for (const t of turnovers) {
    turnoverByApartmentDate.set(`${t.apartmentId}-${t.date}`, {
      gapHours: t.gapHours,
      tight: t.tight,
    });
  }

  const renderDay = (ymd: string, summary: ReturnType<typeof daySummary>) => {
    if (summary.arrivals.length === 0 && summary.departures.length === 0 && summary.inHouse.length === 0) {
      return <p className="text-sm text-gray-500">Nothing today</p>;
    }

    const parts: string[] = [];
    if (summary.arrivals.length > 0) parts.push(`${summary.arrivals.length} arriving`);
    if (summary.departures.length > 0) parts.push(`${summary.departures.length} leaving`);
    if (summary.inHouse.length > 0) parts.push(`${summary.inHouse.length} staying`);

    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-600">{parts.join(", ")}</p>
        {summary.arrivals.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500">Arrivals</p>
            {summary.arrivals.map((s) => (
              <div key={s.id} className="text-sm">
                {apartmentNames[s.apartmentId]}: {s.guestName ?? SOURCE_LABEL[s.source]} ({SOURCE_LABEL[s.source]})
              </div>
            ))}
          </div>
        )}
        {summary.departures.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500">Departures</p>
            {summary.departures.map((s) => (
              <div key={s.id} className="text-sm">
                {apartmentNames[s.apartmentId]}: {s.guestName ?? SOURCE_LABEL[s.source]} ({SOURCE_LABEL[s.source]})
              </div>
            ))}
          </div>
        )}
        {summary.turnoverApartments.size > 0 && (
          <div className="flex flex-wrap gap-2">
            {Array.from(summary.turnoverApartments).map((aptId) => {
              const turnover = turnoverByApartmentDate.get(`${aptId}-${ymd}`);
              if (!turnover) return null;
              return (
                <span
                  key={aptId}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    turnover.tight
                      ? "bg-red-100 text-red-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {apartmentNames[aptId]}: {turnover.gapHours.toFixed(1)}h turnover
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border bg-white p-4">
        <h2 className="text-lg font-semibold">{formatYmd(today)}</h2>
        {renderDay(today, todaySum)}
      </div>
      <div className="rounded-lg border bg-white p-4">
        <h2 className="text-lg font-semibold">{formatYmd(tomorrow)}</h2>
        {renderDay(tomorrow, tomorrowSum)}
      </div>
    </div>
  );
}
