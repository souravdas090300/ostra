"use client";

import { useState } from "react";
import { setAnswerFeedback } from "@/app/(app)/inbox/actions";

export function MessageFeedback({
  messageId,
  initialFeedback,
  initialNote,
}: {
  messageId: string;
  initialFeedback: "GOOD" | "WRONG" | null;
  initialNote: string | null;
}) {
  const [feedback, setFeedback] = useState<"GOOD" | "WRONG" | null>(initialFeedback);
  const [note, setNote] = useState(initialNote || "");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleFeedback = async (value: "GOOD" | "WRONG") => {
    setLoading(true);
    try {
      await setAnswerFeedback(messageId, value, note || undefined);
      setFeedback(value);
      if (value === "WRONG") {
        setShowNoteInput(true);
      } else {
        setShowNoteInput(false);
        setNote("");
      }
    } catch (e) {
      alert("Failed to save feedback");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setLoading(true);
    try {
      await setAnswerFeedback(messageId, null);
      setFeedback(null);
      setShowNoteInput(false);
      setNote("");
    } catch (e) {
      alert("Failed to clear feedback");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNote = async () => {
    setLoading(true);
    try {
      await setAnswerFeedback(messageId, "WRONG", note);
      setShowNoteInput(false);
    } catch (e) {
      alert("Failed to save note");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {!feedback ? (
        <div className="flex gap-2">
          <button
            onClick={() => handleFeedback("GOOD")}
            disabled={loading}
            className="rounded border border-green-300 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
          >
            Good
          </button>
          <button
            onClick={() => handleFeedback("WRONG")}
            disabled={loading}
            className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Wrong
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${feedback === "GOOD" ? "text-green-700" : "text-red-700"}`}>
              {feedback === "GOOD" ? "✓ Good" : "✗ Wrong"}
            </span>
            <button
              onClick={handleClear}
              disabled={loading}
              className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
          {feedback === "WRONG" && (
            <>
              {!showNoteInput ? (
                <button
                  onClick={() => setShowNoteInput(true)}
                  disabled={loading}
                  className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                >
                  Add note (optional)
                </button>
              ) : (
                <div className="space-y-1">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What should it have said?"
                    className="w-full rounded border p-1 text-xs"
                    rows={2}
                    maxLength={300}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveNote}
                      disabled={loading}
                      className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setShowNoteInput(false)}
                      disabled={loading}
                      className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {initialNote && !showNoteInput && (
                <p className="text-xs text-gray-600">Note: {initialNote}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
