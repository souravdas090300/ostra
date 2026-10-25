"use client";

export function LeadDataProtection({ leadId }: { leadId: string }) {
  const handleExport = async () => {
    const response = await fetch(`/api/export/lead?leadId=${leadId}&scope=lead`);
    if (response.ok) {
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lead-data-${leadId}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
    } else {
      alert("Failed to export data");
    }
  };

  const handleErase = async () => {
    if (confirm("Are you sure you want to erase this lead's data? This cannot be undone.")) {
      const response = await fetch("/api/erase/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, scope: "lead" }),
      });
      if (response.ok) {
        window.location.href = "/leads";
      } else {
        alert("Failed to erase data");
      }
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <h2 className="font-medium">Data Protection</h2>
      <p className="text-sm text-gray-600">
        You can export or erase this lead's data at any time.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleExport}
          className="rounded-md border px-4 py-2 text-sm"
        >
          Export Data
        </button>
        <button
          onClick={handleErase}
          className="rounded-md border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          Erase Data
        </button>
      </div>
    </div>
  );
}
