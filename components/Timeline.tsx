"use client";

import { useEffect, useRef, useState } from "react";
import type { BarVM, RowVM } from "@/lib/calendar-view";
import { SOURCE_LABEL, SOURCE_LETTER } from "@/lib/calendar-view";
import { formatYmd, weekday } from "@/lib/dates";

const CELL = 44; // px per day
const NAME_W = 112; // px, sticky apartment column
const LANE_H = 30;

const COLORS: Record<string, string> = {
  AIRBNB: "bg-rose-100 border-rose-400 text-rose-900",
  BOOKING_COM: "bg-blue-100 border-blue-400 text-blue-900",
  DIRECT: "bg-emerald-100 border-emerald-400 text-emerald-900",
};

export function Timeline({
  days,
  today,
  rows,
}: {
  days: string[];
  today: string;
  rows: RowVM[];
}) {
  const [selected, setSelected] = useState<BarVM | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const n = days.length;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (selected && !d.open) d.showModal();
    if (!selected && d.open) d.close();
  }, [selected]);

  const pct = (units: number) => `${(units / n) * 100}%`;

  return (
    <>
      <div className="overflow-x-auto rounded-md border bg-white">
        <div style={{ minWidth: NAME_W + n * CELL }}>
          {/* Header */}
          <div className="flex border-b text-center text-xs">
            <div
              className="sticky left-0 z-20 shrink-0 border-r bg-white"
              style={{ width: NAME_W }}
            />
            {days.map((d) => {
              const wd = weekday(d);
              return (
                <div
                  key={d}
                  className={`shrink-0 py-1 ${
                    wd === 0 || wd === 6 ? "bg-gray-50" : ""
                  } ${d === today ? "bg-amber-50 font-semibold" : ""}`}
                  style={{ width: CELL }}
                >
                  <div className="text-gray-500">{formatYmd(d).split(" ")[0]}</div>
                  <div>{Number(d.slice(8))}</div>
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {rows.map((row) => (
            <div key={row.apartmentId} className="flex border-b last:border-b-0">
              <div
                className="sticky left-0 z-20 shrink-0 border-r bg-white p-2 text-sm font-medium"
                style={{ width: NAME_W }}
              >
                <span className="line-clamp-2">{row.name}</span>
              </div>
              <div
                className="relative shrink-0"
                style={{
                  width: n * CELL,
                  height: row.laneCount * LANE_H + 8,
                  backgroundImage: "linear-gradient(to right, #e5e7eb 1px, transparent 1px)",
                  backgroundSize: `${CELL}px 100%`,
                }}
              >
                {days.map((d, i) => {
                  const wd = weekday(d);
                  if (d !== today && wd !== 0 && wd !== 6) return null;
                  return (
                    <div
                      key={d}
                      className={`absolute inset-y-0 ${
                        d === today ? "bg-amber-50" : "bg-gray-50"
                      }`}
                      style={{ left: pct(i), width: pct(1) }}
                    />
                  );
                })}

                {/* Blocks sit behind bookings */}
                {row.blocks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelected(b)}
                    aria-label={`Blocked ${formatYmd(b.inYmd)} to ${formatYmd(b.outYmd)}`}
                    className="absolute inset-y-0 border-x border-gray-300 opacity-80"
                    style={{
                      left: pct(b.left),
                      width: pct(b.width),
                      backgroundImage:
                        "repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb 6px,#f3f4f6 6px,#f3f4f6 12px)",
                    }}
                  />
                ))}

                {row.bars.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelected(b)}
                    aria-label={`${SOURCE_LABEL[b.source]} booking, ${
                      b.label
                    }, ${formatYmd(b.inYmd)} to ${formatYmd(b.outYmd)}, ${
                      b.nights
                    } nights${b.doubleBooked ? ", double booked" : ""}`}
                    className={`absolute flex items-center gap-1 overflow-hidden border px-1 text-left text-xs ${
                      COLORS[b.source]
                    } ${b.doubleBooked ? "ring-2 ring-red-600" : ""} ${
                      b.continuesLeft ? "rounded-l-none" : "rounded-l-md"
                    } ${b.continuesRight ? "rounded-r-none" : "rounded-r-md"}`}
                    style={{
                      left: pct(b.left),
                      width: pct(b.width),
                      top: 4 + b.lane * LANE_H,
                      height: LANE_H - 4,
                    }}
                  >
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/70 text-[10px] font-bold">
                      {SOURCE_LETTER[b.source]}
                    </span>
                    {b.doubleBooked && <span aria-hidden>⚠</span>}
                    <span className="truncate">{b.label}</span>
                  </button>
                ))}

                {row.turnovers.map((t) => (
                  <div
                    key={t.dayIndex}
                    title={`Same-day turnover (${t.gapHours.toFixed(1)} h between check-out and check-in)`}
                    className={`pointer-events-none absolute inset-y-0 w-0.5 ${
                      t.tight ? "bg-red-500" : "bg-amber-500"
                    }`}
                    style={{ left: pct(t.dayIndex + 0.5) }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <dialog
        ref={dialog}
        onClose={() => setSelected(null)}
        className="w-[min(92vw,26rem)] rounded-lg p-0 backdrop:bg-black/40"
      >
        {selected && (
          <div className="space-y-3 p-4">
            <h2 className="text-lg font-semibold">
              {selected.isBlock ? "Blocked dates" : selected.label}
            </h2>
            <dl className="space-y-1 text-sm">
              <div>
                <dt className="inline text-gray-500">Source: </dt>
                <dd className="inline">{SOURCE_LABEL[selected.source]}</dd>
              </div>
              <div>
                <dt className="inline text-gray-500">Dates: </dt>
                <dd className="inline">
                  {formatYmd(selected.inYmd)} to {formatYmd(selected.outYmd)} (
                  {selected.nights} nights)
                </dd>
              </div>
              {!selected.isBlock && (
                <div>
                  <dt className="inline text-gray-500">Guest phone: </dt>
                  <dd className="inline">
                    {selected.guestPhone ??
                      "none yet. Automatic messages will not send."}
                  </dd>
                </div>
              )}
            </dl>
            {selected.doubleBooked && (
              <p className="rounded bg-red-50 p-2 text-sm text-red-800">
                This stay overlaps another booking in the same apartment. Contact
                one guest or the platform now.
              </p>
            )}
            {selected.isBlock && (
              <p className="text-sm text-gray-600">
                Dates closed on the platform. They are not available to sell.
              </p>
            )}
            <button
              className="rounded-md bg-black px-3 py-2 text-sm text-white"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>
        )}
      </dialog>
    </>
  );
}
