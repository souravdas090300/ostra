import { requireOwner } from "@/lib/auth";
import { loadLeads } from "@/lib/lead-data";
import { inboxCounts } from "@/lib/inbox-data";
import { formatPhone } from "@/lib/phone";
import Link from "next/link";

export default async function LeadsPage({ searchParams }: { readonly searchParams: Promise<{ tab?: string }> }) {
  const session = await requireOwner();
  const params = await searchParams;
  const tab = params.tab ?? "needs";
  const counts = await inboxCounts(session.id);

  const rows = await loadLeads(session.id);
  const filtered = tab === "needs" ? rows.filter((r) => r.unresolved > 0) : rows;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Leads</h1>
        <p className="mt-2 text-sm text-gray-600">
          {tab === "needs" ? "Enquiries that need your attention" : "All enquiries"}
        </p>
      </div>

      <div className="flex gap-2 border-b">
        <Link href="/leads?tab=needs" className={`px-4 py-2 text-sm ${tab === "needs" ? "font-medium border-b-2 border-black" : ""}`}>
          Needs reply ({counts.leadsNeeds})
        </Link>
        <Link href="/leads?tab=all" className={`px-4 py-2 text-sm ${tab === "all" ? "font-medium border-b-2 border-black" : ""}`}>
          All enquiries
        </Link>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-500">{tab === "needs" ? "Nothing needs you right now." : "No enquiries yet."}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Link key={r.id} href={`/leads/${r.id}`} className="block rounded-lg border bg-white p-4 hover:bg-gray-50">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {r.urgent && <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Urgent</span>}
                    <span className="font-medium">{r.name || "Guest"}</span>
                    <span className="text-sm text-gray-500">{formatPhone(r.phone)}</span>
                  </div>
                  {r.apartmentName && (
                    <p className="text-sm text-gray-500">
                      {r.apartmentName}
                    </p>
                  )}
                  {r.checkIn && r.checkOut && (
                    <p className="text-sm text-gray-500">
                      {r.checkIn} - {r.checkOut}
                      {r.guests && ` (${r.guests} guest${r.guests > 1 ? 's' : ''})`}
                    </p>
                  )}
                  {r.quotedCents && (
                    <p className="text-sm text-gray-500">
                      Quoted: €{(r.quotedCents / 100).toFixed(2)}
                    </p>
                  )}
                  <p className="text-sm truncate" dir="auto">
                    {r.lastDirection === "OUTBOUND" && (r.lastBody.startsWith("You: ") ? "" : "You: ")}
                    {r.lastBody}
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.status === "NEW" ? "bg-blue-100 text-blue-800" :
                    r.status === "QUOTED" ? "bg-green-100 text-green-800" :
                    r.status === "NEEDS_HOST" ? "bg-amber-100 text-amber-800" :
                    r.status === "BOOKED" ? "bg-purple-100 text-purple-800" :
                    "bg-gray-100 text-gray-800"
                  }`}>
                    {r.status}
                  </span>
                  {r.unresolved > 0 && (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 ml-1">
                      {r.unresolved} need you
                    </span>
                  )}
                  <p className="text-xs text-gray-500">{new Date(r.lastAt).toLocaleString()}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
