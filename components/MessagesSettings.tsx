"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TEMPLATE_VARS, fillTemplate, DEFAULT_TEMPLATES, validateTemplate } from "@/lib/templates";
import type { Language } from "@/lib/languages";

type MessageTemplate = {
  id: string;
  type: string;
  body: string;
  enabled: boolean;
  translations: {
    id: string;
    language: string;
    body: string;
    sourceHash: string;
    editedByHost: boolean;
    approval: string;
    metaTemplateName: string | null;
    rejectionReason: string | null;
  }[];
};

type Owner = {
  fallbackLanguage: string;
  hostLanguage: string;
  templates: MessageTemplate[];
};

type Props = {
  owner: Owner;
  languages: Language[];
  templateCategory: Record<string, "UTILITY" | "MARKETING">;
};

const MESSAGE_TYPES = ["PRE_ARRIVAL", "CHECK_IN", "CHECK_OUT", "REVIEW_REQUEST"] as const;

export default function MessagesSettings({
  owner,
  languages,
  templateCategory,
}: Props) {
  const router = useRouter();
  const [fallbackLanguage, setFallbackLanguage] = useState(owner.fallbackLanguage);

  const handleSaveFallback = async () => {
    const fd = new FormData();
    fd.set("fallbackLanguage", fallbackLanguage);
    fd.set("action", "updateFallback");
    await fetch("/settings/messages", {
      method: "POST",
      body: fd,
    });
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium mb-4">Fallback Language</h2>
        <p className="text-sm text-gray-600 mb-4">
          Used when a guest&apos;s language has no approved template.
        </p>
        <select
          value={fallbackLanguage}
          onChange={(e) => setFallbackLanguage(e.target.value)}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
        >
          {languages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.native} ({lang.name})
            </option>
          ))}
        </select>
        <button
          onClick={handleSaveFallback}
          className="mt-3 rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800"
        >
          Save
        </button>
      </div>

      {MESSAGE_TYPES.map((type) => {
        const template = owner.templates.find((t) => t.type === type);
        if (!template) return null;

        return (
          <TemplateCard
            key={type}
            type={type}
            template={template}
            category={templateCategory[type]}
            hostLanguage={owner.hostLanguage}
            languages={languages}
          />
        );
      })}
    </div>
  );
}

function TemplateCard({
  type,
  template,
  category,
  hostLanguage,
  languages,
}: {
  type: string;
  template: MessageTemplate;
  category: "UTILITY" | "MARKETING";
  hostLanguage: string;
  languages: Language[];
}) {
  const router = useRouter();
  const [body, setBody] = useState(template.body);
  const [enabled, setEnabled] = useState(template.enabled);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const handleBodyChange = (value: string) => {
    setBody(value);
    setErrors(validateTemplate(type as "PRE_ARRIVAL" | "CHECK_IN" | "CHECK_OUT" | "REVIEW_REQUEST", value));
  };

  const handleSave = async () => {
    setSaving(true);
    const fd = new FormData();
    fd.set("templateId", template.id);
    fd.set("body", body);
    fd.set("enabled", enabled.toString());
    fd.set("action", "updateTemplate");
    await fetch("/settings/messages", {
      method: "POST",
      body: fd,
    });
    setSaving(false);
    router.refresh();
  };

  const insertVariable = (variable: string) => {
    const textarea = document.activeElement as HTMLTextAreaElement;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = body.slice(0, start) + `{{${variable}}}` + body.slice(end);
      setBody(text);
      setErrors(validateTemplate(type as "PRE_ARRIVAL" | "CHECK_IN" | "CHECK_OUT" | "REVIEW_REQUEST", text));
      textarea.focus();
      textarea.setSelectionRange(start + variable.length + 4, start + variable.length + 4);
    }
  };

  const typeLabel = type.replace(/_/g, " ");
  const allowedVars = TEMPLATE_VARS[type as keyof typeof TEMPLATE_VARS] || [];

  // Sample values for preview
  const sampleValues: Record<string, string> = {
    guestName: "Anna",
    apartmentName: "Seaview Apartment",
    checkInDate: "10 January 2026",
    checkInTime: "14:00",
    checkOutTime: "11:00",
    reviewUrl: "https://example.com/review",
  };
  const preview = fillTemplate(body, sampleValues);

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex justify-between items-start mb-4">
        <h2 className="text-lg font-medium">{typeLabel}</h2>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-500">{category}</span>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
            />
            <span className="ml-2 text-sm text-gray-700">Enabled</span>
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Message (in {hostLanguage})
          </label>
          <textarea
            value={body}
            onChange={(e) => handleBodyChange(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
          />
          {errors.length > 0 && (
            <div className="mt-2 text-sm text-red-600">
              {errors.map((error, i) => (
                <div key={i}>{error}</div>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {allowedVars.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded"
              >
                +{v}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Preview</label>
          <div className="bg-gray-50 p-3 rounded text-sm border">
            {preview}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || errors.length > 0}
          className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>

        <TranslationsTable
          translations={template.translations}
          hostLanguage={hostLanguage}
          languages={languages}
          templateId={template.id}
        />
      </div>
    </div>
  );
}

function TranslationsTable({
  translations,
  hostLanguage,
  languages,
  templateId,
}: {
  translations: MessageTemplate["translations"];
  hostLanguage: string;
  languages: Language[];
  templateId: string;
}) {
  const router = useRouter();
  const [addingLanguage, setAddingLanguage] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const getStatusBadge = (approval: string, rejectionReason: string | null) => {
    switch (approval) {
      case "APPROVED":
        return <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800">Approved</span>;
      case "PENDING":
        return <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Pending</span>;
      case "REJECTED":
        return (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800" title={rejectionReason || ""}>
            Rejected
          </span>
        );
      default:
        return <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800">Not submitted</span>;
    }
  };

  const handleAddTranslation = async () => {
    if (!selectedLanguage) return;
    const fd = new FormData();
    fd.set("templateId", templateId);
    fd.set("language", selectedLanguage);
    fd.set("action", "add");
    await fetch("/settings/messages", {
      method: "POST",
      body: fd,
    });
    setAddingLanguage(false);
    setSelectedLanguage("");
    router.refresh();
  };

  const handleEdit = (tr: MessageTemplate["translations"][number]) => {
    setEditingId(tr.id);
    setEditBody(tr.body);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const fd = new FormData();
    fd.set("translationId", editingId);
    fd.set("body", editBody);
    fd.set("action", "edit");
    await fetch("/settings/messages", {
      method: "POST",
      body: fd,
    });
    setEditingId(null);
    router.refresh();
  };

  const handleRegenerate = async (tr: MessageTemplate["translations"][number]) => {
    if (tr.editedByHost) return; // Blocked when edited by host
    const fd = new FormData();
    fd.set("templateId", templateId);
    fd.set("language", tr.language);
    fd.set("action", "regenerate");
    await fetch("/settings/messages", {
      method: "POST",
      body: fd,
    });
    router.refresh();
  };

  const handleSubmitApproval = async (tr: MessageTemplate["translations"][number]) => {
    const fd = new FormData();
    fd.set("translationId", tr.id);
    fd.set("action", "submit");
    await fetch("/settings/messages", {
      method: "POST",
      body: fd,
    });
    router.refresh();
  };

  const handleRefreshStatus = async () => {
    const fd = new FormData();
    fd.set("action", "sync");
    await fetch("/settings/messages", {
      method: "POST",
      body: fd,
    });
    router.refresh();
  };

  const handleRemove = async (tr: MessageTemplate["translations"][number]) => {
    const fd = new FormData();
    fd.set("translationId", tr.id);
    fd.set("action", "remove");
    await fetch("/settings/messages", {
      method: "POST",
      body: fd,
    });
    router.refresh();
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-2">Translations</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Language</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {translations.map((tr) => {
              const lang = languages.find((l) => l.code === tr.language);
              const isHostLanguage = tr.language === hostLanguage;
              const isStale = !isHostLanguage && tr.sourceHash === ""; // Empty sourceHash means stale after host edit
              return (
                <tr key={tr.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {lang ? `${lang.native} (${lang.name})` : tr.language}
                    {isHostLanguage && <span className="ml-2 text-xs text-gray-500">(host)</span>}
                    {isStale && <span className="ml-2 text-xs text-amber-600">(Source changed)</span>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {getStatusBadge(tr.approval, tr.rejectionReason)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {editingId === tr.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveEdit}
                          className="text-green-600 hover:text-green-900"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-gray-600 hover:text-gray-900"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(tr)}
                          className="text-indigo-600 hover:text-indigo-900"
                        >
                          Edit
                        </button>
                        {!tr.editedByHost && tr.approval === "NONE" && (
                          <button
                            onClick={() => handleRegenerate(tr)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            Regenerate
                          </button>
                        )}
                        {tr.approval === "NONE" && (
                          <button
                            onClick={() => handleSubmitApproval(tr)}
                            className="text-green-600 hover:text-green-900"
                          >
                            Request approval
                          </button>
                        )}
                        {tr.approval === "PENDING" && (
                          <button
                            onClick={handleRefreshStatus}
                            className="text-amber-600 hover:text-amber-900"
                          >
                            Refresh
                          </button>
                        )}
                        {!isHostLanguage && (
                          <button
                            onClick={() => handleRemove(tr)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingId && (
        <div className="mt-4">
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
          />
        </div>
      )}

      {addingLanguage && (
        <div className="mt-4 flex space-x-2">
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
          >
            <option value="">Choose language...</option>
            {languages
              .filter((l) => !translations.some((t) => t.language === l.code))
              .map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.native} ({lang.name})
                </option>
              ))}
          </select>
          <button
            onClick={handleAddTranslation}
            disabled={!selectedLanguage}
            className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={() => setAddingLanguage(false)}
            className="bg-gray-200 text-gray-800 px-4 py-2 rounded-md text-sm hover:bg-gray-300"
          >
            Cancel
          </button>
        </div>
      )}

      {!addingLanguage && (
        <button
          onClick={() => setAddingLanguage(true)}
          className="mt-4 text-indigo-600 hover:text-indigo-900 text-sm"
        >
          + Add translation
        </button>
      )}
    </div>
  );
}
