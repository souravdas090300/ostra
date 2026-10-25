import { prisma } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { toggleEnquiries } from "./actions";

export default async function EnquiriesSettingsPage() {
  const session = await requireOwner();
  const ownerData = await prisma.owner.findUnique({
    where: { id: session.id },
    select: { enquiriesEnabled: true },
  });
  if (!ownerData) {
    throw new Error("Owner not found");
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Enquiry Assistant Settings</h1>

      <div className="border rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">Enable Enquiry Assistant</h2>
            <p className="text-sm text-gray-600 mt-1">
              When enabled, guests who message you but don't have a confirmed booking will be handled by the AI assistant.
              The assistant can check availability, provide quotes, and answer basic questions.
            </p>
          </div>
          <form action={toggleEnquiries}>
            <button
              type="submit"
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                ownerData.enquiriesEnabled ? "bg-blue-600" : "bg-gray-200"
              }`}
            >
              <span
                className={`translate-x-0 inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  ownerData.enquiriesEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </form>
        </div>
      </div>

      <div className="border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-medium">Public Information Guidance</h2>
        <p className="text-sm text-gray-600">
          The enquiry assistant uses the <strong>Public Info</strong> field from your apartment settings to answer guest questions.
          Keep this information helpful and accurate.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <h3 className="font-medium text-blue-900 mb-2">What to include in Public Info:</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Apartment location and nearby attractions</li>
            <li>Amenities (WiFi, AC, kitchen appliances, etc.)</li>
            <li>Check-in/check-out process overview</li>
            <li>House rules (smoking, pets, quiet hours)</li>
            <li>Transportation options from airport/station</li>
          </ul>
        </div>
        <p className="text-sm text-gray-600">
          <strong>Important:</strong> Never include private information like door codes, keys, or addresses in Public Info.
          The assistant will only share this public information with guests.
        </p>
        <div className="pt-4">
          <a
            href="/apartments"
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            Edit apartment public info →
          </a>
        </div>
      </div>
    </div>
  );
}
