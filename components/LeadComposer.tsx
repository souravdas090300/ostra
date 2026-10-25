"use client";

import { useState } from "react";
import { previewLeadReply, recheckLeadTranslation, sendLeadReply, type PreviewState } from "@/app/(app)/leads/actions";
import { getLanguage } from "@/lib/languages";

type Props = {
  leadId: string;
  windowOpen: boolean;
  hostLanguage: string;
  guestLanguage: string;
  sameLanguage: boolean;
  hasUnresolved: boolean;
  suggestedQuestion: string;
};

export function LeadComposer({
  leadId,
  windowOpen,
  hostLanguage,
  guestLanguage,
  sameLanguage,
  hasUnresolved,
  suggestedQuestion,
}: Props) {
  const [text, setText] = useState("");
  const [markResolved, setMarkResolved] = useState(hasUnresolved);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [checked, setChecked] = useState(false);
  const [sent, setSent] = useState(false);

  const hostLangName = getLanguage(hostLanguage)?.name ?? hostLanguage;
  const guestLangName = getLanguage(guestLanguage)?.name ?? guestLanguage;

  const handlePreview = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    const result = await previewLeadReply(leadId, text);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setPreview(result);
      setChecked(true);
    }
  };

  const handleRecheck = async () => {
    if (!preview?.translation) return;
    setLoading(true);
    setError(null);
    const result = await recheckLeadTranslation(leadId, preview.translation, text);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setPreview(result);
      setChecked(true);
    }
  };

  const handleSend = async () => {
    setLoading(true);
    setError(null);
    const toSend = sameLanguage ? text : preview?.translation ?? text;
    const result = await sendLeadReply(leadId, toSend, text, markResolved);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSent(true);
      setText("");
      setPreview(null);
      setChecked(false);
    }
  };

  if (!windowOpen) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        The 24-hour reply window has closed. WhatsApp only allows a reply within 24 hours of the guest's last message.
      </div>
    );
  }

  if (sent) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <p className="text-sm text-green-800">Message sent successfully!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
          setChecked(false);
        }}
        placeholder={sameLanguage ? "Message" : `Write in ${hostLangName}`}
        rows={3}
        className="w-full rounded-md border px-3 py-2 text-sm"
        dir="auto"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}

      {sameLanguage ? (
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={markResolved} onChange={(e) => setMarkResolved(e.target.checked)} className="rounded" />
            Mark as resolved
          </label>
          <button onClick={handleSend} disabled={loading || !text.trim()} className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50">
            {loading ? "Sending..." : "Send"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {!preview ? (
            <button onClick={handlePreview} disabled={loading || !text.trim()} className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50">
              {loading ? "Translating..." : "Translate and check"}
            </button>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium">Will be sent in {guestLangName}</label>
                <textarea
                  value={preview.translation ?? ""}
                  onChange={(e) => {
                    setPreview({ ...preview, translation: e.target.value });
                    setChecked(false);
                  }}
                  rows={3}
                  className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
                  dir="auto"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">What the guest will read, translated back to {hostLangName}</label>
                <div className="mt-1 rounded-md border bg-gray-50 p-3 text-sm" dir="auto">
                  {preview.backTranslation}
                </div>
              </div>
              {preview.warnings && preview.warnings.length > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="text-sm text-amber-800">
                      {w}
                    </p>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={handleRecheck} disabled={loading} className="rounded-md border px-4 py-2 text-sm disabled:opacity-50">
                  Check again
                </button>
                <button onClick={handleSend} disabled={loading || !checked} className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50">
                  {loading ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={markResolved} onChange={(e) => setMarkResolved(e.target.checked)} className="rounded" />
            Mark as resolved
          </label>
        </div>
      )}
    </div>
  );
}
