import { PROCESSORS } from "@/lib/processors";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-gray-600">Last updated: October 2026</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Who we are</h2>
        <p className="text-sm text-gray-700">
          Ostra is a guest communication and booking management tool for short-term rental hosts.
          The service is operated by the system operator (the processor) on behalf of hosts (the data controllers).
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Data we process</h2>
        <p className="text-sm text-gray-700">
          We process the following personal data on behalf of hosts:
        </p>
        <ul className="ml-4 list-disc space-y-1 text-sm text-gray-700">
          <li>Guest names and phone numbers</li>
          <li>Booking dates and apartment details</li>
          <li>WhatsApp messages between guests and hosts</li>
          <li>Guest language preferences</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Purpose of processing</h2>
        <p className="text-sm text-gray-700">
          Data is processed to:
        </p>
        <ul className="ml-4 list-disc space-y-1 text-sm text-gray-700">
          <li>Send automated check-in, check-out, and review request messages</li>
          <li>Provide an AI assistant to answer guest questions</li>
          <li>Allow hosts to manage bookings and communicate with guests</li>
          <li>Detect and resolve guest issues through escalation to hosts</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Data processors</h2>
        <p className="text-sm text-gray-700">
          We use the following third-party services to process data:
        </p>
        <div className="rounded-lg border bg-gray-50 p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Service</th>
                <th className="py-2 text-left font-medium">Purpose</th>
                <th className="py-2 text-left font-medium">Region</th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name} className="border-b last:border-0">
                  <td className="py-2">{p.name}</td>
                  <td className="py-2">{p.purpose}</td>
                  <td className="py-2">{p.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Data retention</h2>
        <p className="text-sm text-gray-700">
          Guest data is retained according to the following schedule:
        </p>
        <ul className="ml-4 list-disc space-y-1 text-sm text-gray-700">
          <li>Guest names, phone numbers, and messages: 90 days after check-out (configurable by host, 30-730 days)</li>
          <li>Booking dates and apartment details: kept indefinitely for occupancy history</li>
          <li>Messages from numbers with no booking: 30 days</li>
          <li>Opt-out requests (keyed hashes only): kept indefinitely</li>
          <li>Login attempts (hashed): 7 days</li>
          <li>System logs and job runs: 90 days</li>
          <li>Audit logs (no personal data): 1 year</li>
        </ul>
        <p className="text-sm text-gray-700">
          Database backups keep deleted data for up to 30 days. After any restore, the retention job is run to delete data past its retention period.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Your rights</h2>
        <p className="text-sm text-gray-700">
          As a guest, you have the following rights under GDPR:
        </p>
        <ul className="ml-4 list-disc space-y-1 text-sm text-gray-700">
          <li><strong>Right to access:</strong> Request a copy of your personal data</li>
          <li><strong>Right to rectification:</strong> Request correction of inaccurate data</li>
          <li><strong>Right to erasure:</strong> Request deletion of your personal data</li>
          <li><strong>Right to restrict processing:</strong> Request limitation of processing</li>
          <li><strong>Right to object:</strong> Object to processing</li>
          <li><strong>Right to data portability:</strong> Request transfer of your data</li>
        </ul>
        <p className="text-sm text-gray-700">
          To exercise these rights, contact your host directly. The host can export or erase your data through the Ostra interface.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Opt-out</h2>
        <p className="text-sm text-gray-700">
          You can opt out of receiving WhatsApp messages at any time by replying "STOP" to any message.
          This will stop all future messages for your phone number with that host.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Cookies</h2>
        <p className="text-sm text-gray-700">
          This site uses only an essential session cookie for authentication. No tracking or analytics cookies are used.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Contact</h2>
        <p className="text-sm text-gray-700">
          For questions about data processing, contact your host. For questions about the Ostra service itself,
          contact the operator at the email address provided by your host.
        </p>
      </section>
    </div>
  );
}
