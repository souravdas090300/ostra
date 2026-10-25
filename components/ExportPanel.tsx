"use client";

import React from "react";
import { useTransition } from "react";
import {
  enableExport,
  disableExport,
  confirmExport,
  regenerateExportToken,
} from "@/app/(app)/apartments/export-actions";
import { linkState, type LinkState } from "@/lib/export-feeds";
import { timeAgo } from "@/lib/dates";

type ExportFeed = {
  id: string;
  target: string;
  token: string;
  enabled: boolean;
  enabledAt: Date | null;
  confirmedAt: Date | null;
  lastFetchedAt: Date | null;
  fetchCount: number;
};

export function ExportPanel({ apartmentId, feeds, appUrl }: { apartmentId: string; feeds: ExportFeed[]; appUrl: string }) {
  const [isPending, startTransition] = useTransition();
  const [showLinks, setShowLinks] = React.useState<Record<string, boolean>>({});
  const [showDialog, setShowDialog] = React.useState<string | null>(null);
  const [ackChecked, setAckChecked] = React.useState(false);
  const [messages, setMessages] = React.useState<Record<string, string>>({});

  const toggleLink = (target: string) => {
    setShowLinks((prev) => ({ ...prev, [target]: !prev[target] }));
  };

  const copyLink = (token: string, target: string) => {
    const url = `${appUrl}/api/ical/${token}.ics`;
    navigator.clipboard.writeText(url);
    setMessages((prev) => ({ ...prev, [target]: "Copied!" }));
    setTimeout(() => setMessages((prev) => ({ ...prev, [target]: "" })), 2000);
  };

  const handleEnable = (target: string) => {
    setShowDialog(target);
    setAckChecked(false);
  };

  const confirmEnable = (target: string) => {
    if (!ackChecked) return;
    startTransition(async () => {
      const result = await enableExport(apartmentId, target as "AIRBNB" | "BOOKING_COM");
      setMessages((prev) => ({ ...prev, [target]: result.error ?? "Enabled" }));
      setShowDialog(null);
    });
  };

  const handleDisable = (target: string) => {
    if (!confirm("Turn this off? The platform will get a 404 error on its next read. Remove the link from the platform too.")) return;
    startTransition(async () => {
      const result = await disableExport(apartmentId, target as "AIRBNB" | "BOOKING_COM");
      setMessages((prev) => ({ ...prev, [target]: result.error ?? "Disabled" }));
    });
  };

  const handleConfirm = (target: string, confirmed: boolean) => {
    startTransition(async () => {
      const result = await confirmExport(apartmentId, target as "AIRBNB" | "BOOKING_COM", confirmed);
      setMessages((prev) => ({ ...prev, [target]: result.error ?? "Saved" }));
    });
  };

  const handleRegenerate = (target: string) => {
    if (!confirm("The old link stops working immediately. You must paste the new one into the platform. Continue?")) return;
    startTransition(async () => {
      const result = await regenerateExportToken(apartmentId, target as "AIRBNB" | "BOOKING_COM");
      setMessages((prev) => ({ ...prev, [target]: result.error ?? "Regenerated" }));
      setShowLinks((prev) => ({ ...prev, [target]: true }));
    });
  };

  const statusBadge = (state: LinkState, lastFetched: Date | null) => {
    switch (state) {
      case "DISABLED":
        return <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">Off</span>;
      case "WAITING":
        return <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-600">Waiting for platform to read it</span>;
      case "CONNECTED":
        return (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-600">
            Connected, last read {lastFetched ? timeAgo(lastFetched) : "never"}
          </span>
        );
      case "STALE":
        return (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-600">
            Not read for {lastFetched ? timeAgo(lastFetched) : "a while"}, check it
          </span>
        );
    }
  };

  const platformName = (target: string) => (target === "AIRBNB" ? "Airbnb" : "Booking.com");

  return (
    <section className="max-w-2xl space-y-4">
      <h2 className="font-semibold">Calendar export (stop double bookings)</h2>
      <p className="text-sm text-gray-600">
        Airbnb and Booking.com read these links every few hours, not instantly. They only learn which nights are taken, never who the guest is.
      </p>

      {feeds.map((feed) => {
        const state = linkState(
        { enabled: feed.enabled, lastFetchedAt: feed.lastFetchedAt ? new Date(feed.lastFetchedAt) : null },
        new Date()
      );
        const url = `${appUrl}/api/ical/${feed.token}.ics`;

        return (
          <div key={feed.id} className="rounded-md border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{platformName(feed.target)}</h3>
              {statusBadge(state, feed.lastFetchedAt)}
            </div>

            <div className="space-y-2">
              {showLinks[feed.target] ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-gray-100 px-2 py-1 text-xs">{url}</code>
                  <button
                    onClick={() => copyLink(feed.token, feed.target)}
                    className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                  >
                    {messages[feed.target] === "Copied!" ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => toggleLink(feed.target)}
                    className="text-xs text-gray-600 underline"
                  >
                    Hide
                  </button>
                </div>
              ) : (
                <button onClick={() => toggleLink(feed.target)} className="text-sm text-blue-600 underline">
                  Show link
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {feed.enabled ? (
                <>
                  <button
                    onClick={() => handleDisable(feed.target)}
                    disabled={isPending}
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    Turn off
                  </button>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!feed.confirmedAt}
                      onChange={(e) => handleConfirm(feed.target, e.target.checked)}
                      disabled={isPending}
                      className="rounded"
                    />
                    I added it in {platformName(feed.target)}
                  </label>
                  <button
                    onClick={() => handleRegenerate(feed.target)}
                    disabled={isPending}
                    className="rounded-md border px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Make a new link
                  </button>
                </>
              ) : (
                <button
                  onClick={() => handleEnable(feed.target)}
                  disabled={isPending}
                  className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  Turn on
                </button>
              )}
            </div>

            {feed.target === "AIRBNB" && (
              <p className="text-xs text-gray-600">
                Open your Airbnb calendar settings, find the option to import a calendar, paste the link, and name it Ostra.
              </p>
            )}
            {feed.target === "BOOKING_COM" && (
              <p className="text-xs text-gray-600">
                In your Booking.com extranet open the calendar sync settings and import a calendar from the link. Not every Booking.com account offers calendar import. If yours does not, keep blocking dates by hand.
              </p>
            )}
            <p className="text-xs text-gray-500">
              Menu names change. If you cannot find it, look in the platform&apos;s help for importing an iCal calendar.
            </p>

            {messages[feed.target] && !messages[feed.target].includes("Copied") && (
              <p className={`text-sm ${messages[feed.target].includes("error") ? "text-red-600" : "text-green-600"}`}>
                {messages[feed.target]}
              </p>
            )}
          </div>
        );
      })}

      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">Platform refresh is slow</p>
        <p className="mt-1">
          For a stay that starts within 3 days, also block the dates by hand on the platform.
        </p>
      </div>

      {showDialog && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50">
          <div className="rounded-md bg-white p-6 max-w-md space-y-4">
            <h3 className="font-semibold">Enable {platformName(showDialog)} export?</h3>
            <p className="text-sm text-gray-600">
              Only turn this on after the loop test in docs/EXPORT_TEST.md passed for this platform.
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={ackChecked}
                onChange={(e) => setAckChecked(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <span>
                I have run the loop test for {platformName(showDialog)} and it passed. I understand that platforms behave differently and that a platform that re-exports imports could create a feedback loop.
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDialog(null)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmEnable(showDialog)}
                disabled={!ackChecked || isPending}
                className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                Enable
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
