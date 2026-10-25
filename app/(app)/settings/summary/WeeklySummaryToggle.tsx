"use client";

import { useState } from "react";
import { toggleWeeklySummary } from "./actions";

export default function WeeklySummaryToggle({ enabled }: { enabled: boolean }) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    setIsUpdating(true);
    setError(null);

    const result = await toggleWeeklySummary(!isEnabled);

    if (result.success) {
      setIsEnabled(!isEnabled);
    } else {
      setError(result.error || "Failed to update setting");
    }

    setIsUpdating(false);
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium">Weekly summary email</h3>
        <p className="text-xs text-gray-500">
          {isEnabled ? "Enabled - you'll receive weekly summaries" : "Disabled - no weekly summaries"}
        </p>
      </div>
      <button
        onClick={handleToggle}
        disabled={isUpdating}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          isEnabled ? "bg-blue-600" : "bg-gray-200"
        } ${isUpdating ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            isEnabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
