"use client";

import { useState } from "react";
import { getLanguage } from "@/lib/languages";

export type PreviewState = {
  translation: string;
  backTranslation: string;
  warnings?: string[];
};

type ComposerActions = {
  preview: (text: string) => Promise<{ error?: string } & PreviewState>;
  recheck: (translation: string, original: string) => Promise<{ error?: string } & PreviewState>;
  send: (toSend: string, original: string, markResolved: boolean) => Promise<{ error?: string }>;
  saveToInfo?: (target: "info" | "publicInfo", text: string) => Promise<{ error?: string }>;
};

type Props = {
  windowOpen: boolean;
  hasPhone?: boolean;
  hostLanguage: string;
  guestLanguage: string;
  sameLanguage: boolean;
  hasUnresolved: boolean;
  suggestedQuestion: string;
  actions: ComposerActions;
  showSaveToInfo?: boolean;
};

export function MessageComposer({
  windowOpen,
  hasPhone = true,
  hostLanguage,
  guestLanguage,
  sameLanguage,
  hasUnresolved,
  suggestedQuestion,
  actions,
  showSaveToInfo = false,
}: Props) {
  const [text, setText] = useState("");
  const [markResolved, setMarkResolved] = useState(hasUnresolved);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [checked, setChecked] = useState(false);
  const [sent, setSent] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveText, setSaveText] = useState("");
  const [saveTarget, setSaveTarget] = useState<"info" | "publicInfo">("info");
  const [saveError, setSaveError] = useState<string | null>(null);

  const hostLangName = getLanguage(hostLanguage)?.name ?? hostLanguage;
  const guestLangName = getLanguage(guestLanguage)?.name ?? guestLanguage;

  const handlePreview = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    const result = await actions.preview(text);
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
    const result = await actions.recheck(preview.translation, text);
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
    const result = await actions.send(toSend, text, markResolved);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSent(true);
      setText("");
      setPreview(null);
      setChecked(false);
      if (hasUnresolved && suggestedQuestion && showSaveToInfo) {
        setShowSave(true);
        setSaveText(`Q: ${suggestedQuestion}\nA: ${text}`);
      }
    }
  };

  const handleSave = async () => {
    if (!actions.saveToInfo) return;
    setLoading(true);
    setSaveError(null);
    const result = await actions.saveToInfo(saveTarget, saveText);
    setLoading(false);
    if (result.error) {
      setSaveError(result.error);
    } else {
      setShowSave(false);
      setSaveText("");
    }
  };

  if (!windowOpen || !hasPhone) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        {!hasPhone ? "This booking has no phone number." : "The 24-hour reply window has closed. WhatsApp only allows a reply within 24 hours of the guest's last message."}
      </div>
    );
  }

  if (sent) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <p className="text-sm text-green-800 mb-3">Message sent successfully!</p>
        {showSave && showSaveToInfo && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">Save this answer for next time?</p>
            <textarea
              value={saveText}
              onChange={(e) => setSaveText(e.target.value)}
              rows={3}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="Q: question\nA: answer"
            />
            <div className="flex items-center gap-2">
              <select
                value={saveTarget}
                onChange={(e) => setSaveTarget(e.target.value as "info" | "publicInfo")}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option value="info">Private information</option>
                <option value="publicInfo">Public information</option>
              </select>
              <p className="text-xs text-gray-500">
                {saveTarget === "publicInfo"
                  ? "Public information can be seen by anyone who messages you. Do not add codes or passwords."
                  : ""}
              </p>
            </div>
            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={loading} className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50">
                Save
              </button>
              <button onClick={() => setShowSave(false)} className="rounded-md border px-4 py-2 text-sm">
                No thanks
              </button>
            </div>
          </div>
        )}
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
