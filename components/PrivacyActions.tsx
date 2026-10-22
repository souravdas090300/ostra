"use client";

export function PrivacyActions({ bookingId, hasPhone }: { bookingId: string; hasPhone: boolean }) {
  const handleErase = async (scope: "booking" | "phone") => {
    const message = scope === "booking"
      ? "Are you sure you want to delete guest data? This cannot be undone."
      : "Are you sure you want to delete guest data for all bookings with this phone? This cannot be undone.";
    if (!confirm(message)) return;

    try {
      await fetch("/api/erase/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, scope }),
      });
      window.location.reload();
    } catch (e) {
      alert("Failed to erase guest data");
    }
  };

  return (
    <div className="space-y-2">
      <a
        href={`/api/export/guest?bookingId=${bookingId}&scope=booking`}
        className="inline-block rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
      >
        Export guest data (this booking)
      </a>
      {hasPhone && (
        <>
          <br />
          <a
            href={`/api/export/guest?bookingId=${bookingId}&scope=phone`}
            className="inline-block rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Export guest data (all bookings with this phone)
          </a>
          <br />
          <button
            type="button"
            onClick={() => handleErase("booking")}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            Erase guest data (this booking)
          </button>
          <br />
          <button
            type="button"
            onClick={() => handleErase("phone")}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            Erase guest data (all bookings with this phone)
          </button>
        </>
      )}
    </div>
  );
}
