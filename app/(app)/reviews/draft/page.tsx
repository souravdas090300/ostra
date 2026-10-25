"use client";

import { useState } from "react";
import { draftReply, type DraftState } from "../actions";

export default function ReviewDraftPage() {
  const [formData, setFormData] = useState({
    review: "",
    platform: "Airbnb",
    stars: "",
    tone: "warm" as "warm" | "professional" | "brief",
    language: "",
    maxChars: "700",
  });
  const [result, setResult] = useState<DraftState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    const data = new FormData();
    data.append("review", formData.review);
    data.append("platform", formData.platform);
    if (formData.stars) data.append("stars", formData.stars);
    data.append("tone", formData.tone);
    if (formData.language) data.append("language", formData.language);
    data.append("maxChars", formData.maxChars);

    const response = await draftReply(data);
    setResult(response);
    setIsSubmitting(false);
  };

  const handleDraftAgain = () => {
    setResult(null);
  };

  const handleCopy = async () => {
    if (result?.reply) {
      await navigator.clipboard.writeText(result.reply);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Review Reply Draft</h1>
        <p className="mt-2 text-sm text-gray-600">
          Paste a guest review to get a draft public reply. The draft is never stored or posted.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="platform" className="block text-sm font-medium">
            Platform
          </label>
          <select
            id="platform"
            value={formData.platform}
            onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
            className="mt-1 block w-full rounded-md border px-3 py-2"
            required
          >
            <option value="Airbnb">Airbnb</option>
            <option value="Booking.com">Booking.com</option>
            <option value="Google">Google</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label htmlFor="stars" className="block text-sm font-medium">
            Stars (optional)
          </label>
          <input
            id="stars"
            type="number"
            min="1"
            max="5"
            value={formData.stars}
            onChange={(e) => setFormData({ ...formData, stars: e.target.value })}
            className="mt-1 block w-full rounded-md border px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="review" className="block text-sm font-medium">
            Review text
          </label>
          <textarea
            id="review"
            value={formData.review}
            onChange={(e) => setFormData({ ...formData, review: e.target.value })}
            rows={6}
            className="mt-1 block w-full rounded-md border px-3 py-2"
            required
            maxLength={3000}
          />
          <p className="mt-1 text-xs text-gray-500">
            {formData.review.length} / 3000 characters
          </p>
        </div>

        <div>
          <label htmlFor="tone" className="block text-sm font-medium">
            Tone
          </label>
          <select
            id="tone"
            value={formData.tone}
            onChange={(e) => setFormData({ ...formData, tone: e.target.value as any })}
            className="mt-1 block w-full rounded-md border px-3 py-2"
          >
            <option value="warm">Warm</option>
            <option value="professional">Professional</option>
            <option value="brief">Brief</option>
          </select>
        </div>

        <div>
          <label htmlFor="language" className="block text-sm font-medium">
            Reply language (optional, defaults to review language)
          </label>
          <input
            id="language"
            type="text"
            value={formData.language}
            onChange={(e) => setFormData({ ...formData, language: e.target.value })}
            placeholder="e.g., en, de, it, fr, es"
            className="mt-1 block w-full rounded-md border px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="maxChars" className="block text-sm font-medium">
            Maximum characters
          </label>
          <input
            id="maxChars"
            type="number"
            min="300"
            max="1500"
            value={formData.maxChars}
            onChange={(e) => setFormData({ ...formData, maxChars: e.target.value })}
            className="mt-1 block w-full rounded-md border px-3 py-2"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-400"
        >
          {isSubmitting ? "Generating..." : "Generate Draft"}
        </button>
      </form>

      {result && (
        <div className="space-y-4 border rounded-lg p-6">
          {result.error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-800">{result.error}</p>
            </div>
          )}

          {result.success && (
            <>
              {result.risk && result.risk !== "none" && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-4">
                  <h3 className="font-medium text-amber-900">⚠️ Risk Warning</h3>
                  <p className="mt-1 text-sm text-amber-800">
                    {result.riskNote || "Consider answering personally or taking advice before replying."}
                  </p>
                  <p className="mt-2 text-xs text-amber-700">
                    This draft is only a starting point.
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="draft" className="block text-sm font-medium">
                  Draft reply ({result.language})
                </label>
                <textarea
                  id="draft"
                  value={result.reply}
                  onChange={(e) => setResult({ ...result, reply: e.target.value })}
                  rows={6}
                  className="mt-1 block w-full rounded-md border px-3 py-2"
                  dir="auto"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {result.reply?.length || 0} / {formData.maxChars} characters
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium">Your language translation</label>
                <div className="mt-1 rounded-md bg-gray-50 p-3 text-sm">
                  {result.hostTranslation}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={handleDraftAgain}
                  className="rounded-md border px-4 py-2 hover:bg-gray-50"
                >
                  Draft Again
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
