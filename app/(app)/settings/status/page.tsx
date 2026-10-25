import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assistantEnabled, automaticMessagesEnabled } from "@/lib/flags";
import { loadWrongAnswers } from "@/lib/inbox-data";
import { linkState } from "@/lib/export-feeds";

export default async function StatusPage() {
  const session = await requireOwner();

  // Get last job runs
  const jobRuns = await prisma.jobRun.findMany({
    where: { job: { in: ["sync-calendars", "send-scheduled", "escalation-reminders", "sync-templates", "retention", "inbound-recovery", "self-check"] } },
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  // Group by job
  const jobsByJob = jobRuns.reduce((acc, run) => {
    if (!acc[run.job]) acc[run.job] = [];
    acc[run.job].push(run);
    return acc;
  }, {} as Record<string, typeof jobRuns>);

  // Get feeds with last success
  const feeds = await prisma.calendarFeed.findMany({
    where: { apartment: { ownerId: session.id } },
    select: {
      id: true,
      apartment: { select: { name: true } },
      lastSyncAt: true,
      lastSuccessAt: true,
      lastError: true,
    },
  });

  // Get export feeds
  const exportFeeds = await prisma.exportFeed.findMany({
    where: { apartment: { ownerId: session.id } },
    include: { apartment: { select: { name: true } } },
  });
  const now = new Date();
  const staleHours = Number(process.env.EXPORT_STALE_AFTER_HOURS ?? 48);

  // Get failed/skipped messages in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const failedScheduled = await prisma.scheduledMessage.count({
    where: {
      booking: { apartment: { ownerId: session.id } },
      status: "FAILED",
      createdAt: { gte: sevenDaysAgo },
    },
  });
  const failedOutbound = await prisma.message.count({
    where: {
      booking: { apartment: { ownerId: session.id } },
      direction: "OUTBOUND",
      deliveryStatus: { in: ["failed", "undelivered"] },
      createdAt: { gte: sevenDaysAgo },
    },
  });

  // Get AI feedback from last 7 days
  const feedbackGood = await prisma.message.count({
    where: {
      booking: { apartment: { ownerId: session.id } },
      author: "AI",
      direction: "OUTBOUND",
      feedback: "GOOD",
      feedbackAt: { gte: sevenDaysAgo },
    },
  });
  const feedbackWrong = await prisma.message.count({
    where: {
      booking: { apartment: { ownerId: session.id } },
      author: "AI",
      direction: "OUTBOUND",
      feedback: "WRONG",
      feedbackAt: { gte: sevenDaysAgo },
    },
  });

  // Get wrong answers with context
  const wrongAnswers = await loadWrongAnswers(session.id, sevenDaysAgo);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">System status</h1>
        <p className="mt-2 text-sm text-gray-600">
          Job runs, feed health, and system configuration
        </p>
      </div>

      {/* Kill switches */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">Kill switches</h2>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span>Assistant enabled</span>
            <span className={assistantEnabled() ? "text-green-600" : "text-red-600"}>
              {assistantEnabled() ? "Yes" : "No"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Automatic messages enabled</span>
            <span className={automaticMessagesEnabled() ? "text-green-600" : "text-red-600"}>
              {automaticMessagesEnabled() ? "Yes" : "No"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>WhatsApp mode</span>
            <span>{process.env.WHATSAPP_MODE || "dry-run"}</span>
          </div>
        </div>
      </div>

      {/* Job runs */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">Recent job runs</h2>
        <div className="mt-3 space-y-4">
          {Object.entries(jobsByJob).map(([job, runs]) => {
            const lastRun = runs[0];
            const age = lastRun ? Math.floor((Date.now() - lastRun.startedAt.getTime()) / 60_000) : null;
            return (
              <div key={job} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{job}</span>
                  <span className={`text-xs ${lastRun?.ok ? "text-green-600" : "text-red-600"}`}>
                    {lastRun?.ok ? "OK" : "Failed"}
                  </span>
                </div>
                <div className="text-sm text-gray-600">
                  {lastRun ? (
                    <>
                      {age !== null && <span>{age} minutes ago</span>}
                      <span className="ml-2">
                        {lastRun.finishedAt
                          ? `${Math.floor((lastRun.finishedAt.getTime() - lastRun.startedAt.getTime()) / 1000)}s`
                          : "Running..."}
                      </span>
                    </>
                  ) : (
                    "Never run"
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Feed health */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">Calendar feeds</h2>
        <div className="mt-3 space-y-2">
          {feeds.map((feed) => {
            const hasError = !!feed.lastError;
            const lastSuccessAge = feed.lastSuccessAt
              ? Math.floor((Date.now() - feed.lastSuccessAt.getTime()) / 60 / 60_000)
              : null;
            return (
              <div key={feed.id} className="flex items-center justify-between text-sm">
                <span>{feed.apartment.name}</span>
                <div className="flex items-center gap-2">
                  {hasError && <span className="text-red-600">Error</span>}
                  {lastSuccessAge !== null && <span className="text-gray-600">{lastSuccessAge}h ago</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Export feeds */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">Export feeds</h2>
        <div className="mt-3 space-y-2">
          {exportFeeds.map((feed) => {
            const state = linkState(feed, now, staleHours);
            const platformName = feed.target === "AIRBNB" ? "Airbnb" : "Booking.com";
            const lastReadAge = feed.lastFetchedAt
              ? Math.floor((Date.now() - feed.lastFetchedAt.getTime()) / 60 / 60_000)
              : null;
            return (
              <div key={feed.id} className="flex items-center justify-between text-sm">
                <span>{feed.apartment.name} ({platformName})</span>
                <div className="flex items-center gap-2">
                  <span className={state === "CONNECTED" ? "text-green-600" : state === "DISABLED" ? "text-gray-600" : "text-amber-600"}>
                    {state}
                  </span>
                  {lastReadAge !== null && <span className="text-gray-600">{lastReadAge}h ago</span>}
                  <span className="text-gray-500">{feed.fetchCount} reads</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Failed messages */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">Failed messages (last 7 days)</h2>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span>Failed scheduled messages</span>
            <span className={failedScheduled > 0 ? "text-red-600" : "text-gray-600"}>
              {failedScheduled}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Failed outbound messages</span>
            <span className={failedOutbound > 0 ? "text-red-600" : "text-gray-600"}>
              {failedOutbound}
            </span>
          </div>
        </div>
      </div>

      {/* AI feedback */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">AI feedback (last 7 days)</h2>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span>Good answers</span>
            <span className="text-green-600">{feedbackGood}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Wrong answers</span>
            <span className={feedbackWrong > 0 ? "text-red-600" : "text-gray-600"}>
              {feedbackWrong}
            </span>
          </div>
        </div>
      </div>

      {/* Wrong answers list */}
      {wrongAnswers.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <h2 className="font-medium">Wrong answers (last 7 days)</h2>
          <div className="mt-3 space-y-3">
            {wrongAnswers.map((msg) => (
              <div key={msg.id} className="rounded border p-3 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{msg.apartmentName}</span>
                  <span className="text-xs text-gray-500">
                    {msg.feedbackAt?.toLocaleString()}
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-gray-600">{msg.question}</p>
                  <p className="font-medium">{msg.body}</p>
                  {msg.feedbackNote && (
                    <p className="text-red-600">Note: {msg.feedbackNote}</p>
                  )}
                </div>
                <div className="mt-2">
                  <a
                    href={`/inbox/${msg.bookingId}`}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    View conversation
                  </a>
                  <button
                    onClick={() => {
                      const testCase = JSON.stringify(
                        {
                          question: msg.question,
                          answer: msg.body,
                          note: msg.feedbackNote,
                        },
                        null,
                        2
                      );
                      navigator.clipboard.writeText(testCase);
                      alert("Copied as test case");
                    }}
                    className="ml-3 text-xs text-blue-600 hover:text-blue-800"
                  >
                    Copy as test case
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* App version */}
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-medium">App version</h2>
        <p className="mt-3 text-sm text-gray-600">
          {process.env.RAILWAY_GIT_COMMIT_SHA || "dev"}
        </p>
      </div>
    </div>
  );
}
