"use client";

import { useState } from "react";
import { testAssistant, type TestResult } from "./actions";

type Conversation = { role: "guest" | "assistant"; text: string; result?: TestResult };

export function AssistantTester({ apartments }: { apartments: { id: string; name: string }[] }) {
  const [selectedApartmentId, setSelectedApartmentId] = useState(apartments[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [pretendGuestArrivesInAFewDays, setPretendGuestArrivesInAFewDays] = useState(false);
  const [conversation, setConversation] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!message.trim() || !selectedApartmentId) return;

    setLoading(true);
    const result = await testAssistant(selectedApartmentId, message, pretendGuestArrivesInAFewDays);
    setConversation([...conversation, { role: "guest", text: message }, { role: "assistant", text: result.reply, result }]);
    setMessage("");
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Test assistant</h1>
        <p className="mt-2 text-sm text-gray-600">
          This is what guests will experience. If an answer is wrong, fix your apartment information.
        </p>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium">Apartment</label>
          <select
            value={selectedApartmentId}
            onChange={(e) => setSelectedApartmentId(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          >
            {apartments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="pretend"
            checked={pretendGuestArrivesInAFewDays}
            onChange={(e) => setPretendGuestArrivesInAFewDays(e.target.checked)}
            className="rounded"
          />
          <label htmlFor="pretend" className="text-sm">
            Pretend the guest arrives in a few days (private details locked)
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium">Your message (in any language)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={3}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            placeholder="Type a guest message..."
          />
        </div>

        <button
          onClick={handleSend}
          disabled={loading || !message.trim()}
          className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? "Sending..." : "Send"}
        </button>
      </div>

      {conversation.length > 0 && (
        <div className="rounded-lg border bg-white p-4 space-y-3">
          <h2 className="text-lg font-semibold">Conversation</h2>
          {conversation.map((turn, i) => (
            <div key={i} className={`rounded border p-3 ${turn.role === "guest" ? "bg-gray-50" : "bg-blue-50"}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{turn.role === "guest" ? "Guest" : "Assistant"}</span>
                {turn.result && (
                  <div className="flex items-center gap-2 text-xs">
                    {turn.result.escalate && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                        Escalated
                      </span>
                    )}
                    {turn.result.urgent && (
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">
                        Urgent
                      </span>
                    )}
                    {turn.result.optOut && (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-800">
                        Opt-out
                      </span>
                    )}
                    {turn.result.language && <span className="text-gray-500">({turn.result.language})</span>}
                  </div>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm" dir="auto">
                {turn.text}
              </p>
              {turn.result && turn.result.escalate && (
                <div className="mt-2 space-y-1 text-xs">
                  <p className="text-gray-600">Summary for host: {turn.result.hostSummary}</p>
                  {turn.result.reason && <p className="text-gray-500">Reason: {turn.result.reason}</p>}
                </div>
              )}
              {turn.result?.error && <p className="mt-2 text-xs text-red-600">Error: {turn.result.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
