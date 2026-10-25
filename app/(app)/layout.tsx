import { requireOwner } from "@/lib/auth";
import Link from "next/link";
import SignOutButton from "./SignOutButton";
import { inboxCounts } from "@/lib/inbox-data";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireOwner();
  const counts = await inboxCounts(session.user.id);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <span className="text-xl font-bold text-gray-900">Ostra</span>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <Link
                  href="/calendar"
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  Calendar
                </Link>
                <Link
                  href="/apartments"
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  Apartments
                </Link>
                <Link
                  href="/inbox"
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  Inbox
                  {counts.needs > 0 && (
                    <span className={`ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${counts.urgent > 0 ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800"}`}>
                      {counts.needs}
                    </span>
                  )}
                  {counts.unknown > 0 && (
                    <span className="ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-600">
                      {counts.unknown}
                    </span>
                  )}
                </Link>
                <Link
                  href="/leads"
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  Leads
                  {counts.leadsNeeds > 0 && (
                    <span className="ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-800">
                      {counts.leadsNeeds}
                    </span>
                  )}
                </Link>
                <Link
                  href="/assistant/test"
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  Test assistant
                </Link>
                <Link
                  href="/reviews/draft"
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  Reviews
                </Link>
                <Link
                  href="/settings/messages"
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  Messages
                </Link>
                <Link
                  href="/settings"
                  className="border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  Settings
                </Link>
              </div>
            </div>
            <div className="flex items-center">
              <span className="text-sm text-gray-700 mr-4">
                {session.user?.email}
              </span>
              <SignOutButton />
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
