"use client";

import { useActionState, useRef, useState } from "react";
import {
  addTranslationAction,
  editTranslationAction,
  refreshApprovalsAction,
  regenerateTranslationAction,
  removeTranslationAction,
  saveTemplateAction,
  submitForApprovalAction,
  setEnquiriesEnabledAction,
  updateFallbackLanguageAction,
  type MessagesActionState,
} from "@/app/(app)/settings/messages/actions";
import { TEMPLATE_VARS, fillTemplate, validateTemplate, hashSource, type MessageType } from "@/lib/templates";
import type { Language } from "@/lib/languages";

type Translation = {
  id: string;
  language: string;
  body: string;
  sourceHash: string;
  editedByHost: boolean;
  approval: string;
  metaTemplateName: string | null;
  metaCategory: string | null;
  rejectionReason: string | null;
  revision: number;
};

type MessageTemplate = {
  id: string;
  type: MessageType;
  body: string;
  enabled: boolean;
  translations: Translation[];
};

type Owner = {
  fallbackLanguage: string;
  hostLanguage: string;
  enquiriesEnabled: boolean;
  templates: Array<Omit<MessageTemplate, "type"> & { type: string }>;
};

type Props = {
  owner: Owner;
  languages: Language[];
  templateCategory: Record<string, "UTILITY" | "MARKETING">;
};

const MESSAGE_TYPES: MessageType[] = ["PRE_ARRIVAL", "CHECK_IN", "CHECK_OUT", "REVIEW_REQUEST"];

function ActionFeedback({ state }: { state: MessagesActionState }) {
  if (state?.error) {
    return <p className="mt-2 text-sm text-red-700" role="alert">{state.error}</p>;
  }
  if (state?.ok) {
    return <p className="mt-2 text-sm text-green-700" role="status">Saved.</p>;
  }
  return null;
}

export default function MessagesSettings({ owner, languages, templateCategory }: Props) {
  const [fallbackState, fallbackAction, fallbackPending] = useActionState(
    updateFallbackLanguageAction,
    undefined,
  );
  const [enquiriesState, enquiriesAction, enquiriesPending] = useActionState(
    setEnquiriesEnabledAction,
    undefined,
  );

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-2 text-lg font-medium">Fallback language</h2>
        <p className="mb-4 text-sm text-gray-600">
          Used when a guest&apos;s language has no approved template.
        </p>
        <form action={fallbackAction} className="space-y-3">
          <label className="block">
            <span className="sr-only">Fallback language</span>
            <select
              name="fallbackLanguage"
              defaultValue={owner.fallbackLanguage}
              className="block w-full rounded-md border p-2 text-sm"
            >
              {languages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.native} ({language.name})
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={fallbackPending}
            className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {fallbackPending ? "Saving..." : "Save fallback language"}
          </button>
          <ActionFeedback state={fallbackState} />
        </form>
      </section>

      <section className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-1 text-lg font-medium">Enquiry replies</h2>
        <p className="mb-4 text-sm text-gray-600">
          Allow Ostra to answer new guest enquiries using your public apartment information.
        </p>
        <form action={enquiriesAction}>
          <input type="hidden" name="enabled" value={owner.enquiriesEnabled ? "false" : "true"} />
          <button
            type="submit"
            role="switch"
            aria-checked={owner.enquiriesEnabled}
            disabled={enquiriesPending}
            className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Enquiry replies: {owner.enquiriesEnabled ? "On" : "Off"}
          </button>
          <ActionFeedback state={enquiriesState} />
        </form>
      </section>

      {MESSAGE_TYPES.map((type) => {
        const template = owner.templates.find((item) => item.type === type);
        if (!template) return null;
        return (
          <TemplateCard
            key={type}
            template={{ ...template, type }}
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
  template,
  category,
  hostLanguage,
  languages,
}: {
  template: MessageTemplate;
  category: "UTILITY" | "MARKETING";
  hostLanguage: string;
  languages: Language[];
}) {
  const [body, setBody] = useState(template.body);
  const [enabled, setEnabled] = useState(template.enabled);
  const [errors, setErrors] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [saveState, saveAction, saving] = useActionState(saveTemplateAction, undefined);
  const allowedVariables = TEMPLATE_VARS[template.type];
  const currentSourceHash = hashSource(template.body);
  const sampleValues: Record<string, string> = {
    guestName: "Anna",
    apartmentName: "Seaview Apartment",
    checkInDate: "10 January 2026",
    checkInTime: "14:00",
    checkOutTime: "11:00",
    reviewUrl: "https://example.com/review",
  };
  const followUp = template.type === "REVIEW_REQUEST";

  const changeBody = (value: string) => {
    setBody(value);
    setErrors(validateTemplate(template.type, value));
  };

  const insertVariable = (variable: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const token = `{{${variable}}}`;
    const nextBody = body.slice(0, start) + token + body.slice(end);
    changeBody(nextBody);
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + token.length;
      textarea.setSelectionRange(caret, caret);
    });
  };

  return (
    <section className="rounded-lg bg-white p-6 shadow">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-medium">
          {followUp ? "Follow-up: review request" : template.type.replace(/_/g, " ")}
        </h2>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{category}</span>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enabled
          </label>
        </div>
      </div>

      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="templateId" value={template.id} />
        <input type="hidden" name="enabled" value={enabled ? "true" : "false"} />
        <label className="block">
          <span className="mb-2 block text-sm font-medium">Message (in {hostLanguage})</span>
          <textarea
            ref={textareaRef}
            name="body"
            value={body}
            onChange={(event) => changeBody(event.target.value)}
            rows={4}
            dir="auto"
            className="block w-full rounded-md border p-2 text-sm"
          />
        </label>
        {errors.length > 0 && (
          <ul className="list-inside list-disc text-sm text-red-700" role="alert">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {allowedVariables.map((variable) => (
            <button
              key={variable}
              type="button"
              onClick={() => insertVariable(variable)}
              className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200"
            >
              +{variable}
            </button>
          ))}
        </div>
        <div>
          <span className="mb-2 block text-sm font-medium">Preview</span>
          <div className="rounded border bg-gray-50 p-3 text-sm" role="status" aria-live="polite" dir="auto">
            {fillTemplate(body, sampleValues)}
          </div>
        </div>
        <button
          disabled={saving || errors.length > 0}
          className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <ActionFeedback state={saveState} />
      </form>

      {!followUp && (
        <TranslationsTable
          template={template}
          hostLanguage={hostLanguage}
          languages={languages}
          currentSourceHash={currentSourceHash}
          requestedCategory={category}
        />
      )}
    </section>
  );
}

function latestByLanguage(translations: Translation[]): Translation[] {
  const latest = new Map<string, Translation>();
  for (const translation of [...translations].sort(
    (left, right) => right.revision - left.revision,
  )) {
    if (!latest.has(translation.language)) latest.set(translation.language, translation);
  }
  return [...latest.values()];
}

function TranslationsTable({
  template,
  hostLanguage,
  languages,
  currentSourceHash,
  requestedCategory,
}: {
  template: MessageTemplate;
  hostLanguage: string;
  languages: Language[];
  currentSourceHash: string;
  requestedCategory: string;
}) {
  const [addState, addAction, adding] = useActionState(addTranslationAction, undefined);
  const [refreshState, refreshAction, refreshing] = useActionState(refreshApprovalsAction, undefined);
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const translations = latestByLanguage(template.translations);
  const availableLanguages = languages.filter(
    (language) => !translations.some((translation) => translation.language === language.code),
  );

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-700">Translations</h3>
        <form action={refreshAction}>
          <button
            disabled={refreshing}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh approval statuses"}
          </button>
          <ActionFeedback state={refreshState} />
        </form>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Language</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Translation and actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {translations.map((translation) => (
              <TranslationRow
                key={translation.id}
                translation={translation}
                template={template}
                hostLanguage={hostLanguage}
                language={languages.find((item) => item.code === translation.language)}
                currentSourceHash={currentSourceHash}
                requestedCategory={requestedCategory}
              />
            ))}
          </tbody>
        </table>
      </div>

      <form action={addAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="templateId" value={template.id} />
        <label className="block">
          <span className="mb-1 block text-sm">Add language</span>
          <select
            name="language"
            required
            value={selectedLanguage}
            onChange={(event) => setSelectedLanguage(event.target.value)}
            className="rounded-md border p-2 text-sm"
          >
            <option value="">Choose language</option>
            {availableLanguages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.native} ({language.name})
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!selectedLanguage || adding}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          {adding ? "Translating..." : "Add translation"}
        </button>
        <ActionFeedback state={addState} />
      </form>
    </div>
  );
}

function TranslationRow({
  translation,
  template,
  hostLanguage,
  language,
  currentSourceHash,
  requestedCategory,
}: {
  translation: Translation;
  template: MessageTemplate;
  hostLanguage: string;
  language: Language | undefined;
  currentSourceHash: string;
  requestedCategory: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(translation.body);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [editState, editAction, saving] = useActionState(editTranslationAction, undefined);
  const [regenerateState, regenerateAction, regenerating] = useActionState(
    regenerateTranslationAction,
    undefined,
  );
  const [submitState, submitAction, submitting] = useActionState(
    submitForApprovalAction,
    undefined,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeTranslationAction,
    undefined,
  );
  const isHostLanguage = translation.language === hostLanguage;
  const isStale = !isHostLanguage && translation.sourceHash !== currentSourceHash;

  return (
    <tr>
      <td className="px-3 py-3 align-top text-sm">
        {language ? `${language.native} (${language.name})` : translation.language}
        {isHostLanguage && <span className="ml-1 text-xs text-gray-500">(host)</span>}
        {isStale && <span className="mt-1 block text-xs text-amber-700">Source changed</span>}
      </td>
      <td className="px-3 py-3 align-top text-sm">
        <ApprovalStatus approval={translation.approval} rejectionReason={translation.rejectionReason} />
        {translation.metaCategory && translation.metaCategory !== requestedCategory && (
          <span className="mt-1 block text-xs text-amber-700">
            Meta assigned {translation.metaCategory}; requested {requestedCategory}.
          </span>
        )}
      </td>
      <td className="px-3 py-3 text-sm">
        {editing ? (
          <form action={editAction} className="space-y-2">
            <input type="hidden" name="translationId" value={translation.id} />
            <textarea
              name="body"
              value={editBody}
              onChange={(event) => {
                setEditBody(event.target.value);
                setValidationErrors(validateTemplate(template.type, event.target.value));
              }}
              rows={3}
              dir="auto"
              className="block w-full rounded-md border p-2"
            />
            {validationErrors.length > 0 && (
              <ul className="list-inside list-disc text-xs text-red-700" role="alert">
                {validationErrors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                disabled={saving || validationErrors.length > 0}
                className="text-green-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save edit"}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="text-gray-600">
                Cancel
              </button>
            </div>
            <ActionFeedback state={editState} />
          </form>
        ) : (
          <p className="mb-2 whitespace-pre-wrap" dir="auto">{translation.body}</p>
        )}

        <div className="flex flex-wrap gap-x-3 gap-y-2 text-xs">
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} className="text-blue-700">
              Edit
            </button>
          )}
          {!isHostLanguage && !translation.editedByHost && (
            <form action={regenerateAction}>
              <input type="hidden" name="templateId" value={template.id} />
              <input type="hidden" name="language" value={translation.language} />
              <button disabled={regenerating} className="text-blue-700 disabled:opacity-50">
                {regenerating ? "Regenerating..." : "Regenerate"}
              </button>
              <ActionFeedback state={regenerateState} />
            </form>
          )}
          <form action={submitAction}>
            <input type="hidden" name="translationId" value={translation.id} />
            <button
              disabled={submitting || translation.approval === "PENDING" || isStale}
              className="text-blue-700 disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Request approval"}
            </button>
            <ActionFeedback state={submitState} />
          </form>
          {!isHostLanguage && (
            <form action={removeAction}>
              <input type="hidden" name="translationId" value={translation.id} />
              <button disabled={removing} className="text-red-700 disabled:opacity-50">
                {removing ? "Removing..." : "Remove"}
              </button>
              <ActionFeedback state={removeState} />
            </form>
          )}
        </div>
      </td>
    </tr>
  );
}

function ApprovalStatus({
  approval,
  rejectionReason,
}: {
  approval: string;
  rejectionReason: string | null;
}) {
  const label =
    approval === "APPROVED"
      ? "Approved"
      : approval === "PENDING"
        ? "Pending"
        : approval === "REJECTED"
          ? "Rejected"
          : "Not submitted";
  const color =
    approval === "APPROVED"
      ? "bg-green-100 text-green-800"
      : approval === "PENDING"
        ? "bg-yellow-100 text-yellow-800"
        : approval === "REJECTED"
          ? "bg-red-100 text-red-800"
          : "bg-gray-100 text-gray-800";
  return (
    <span>
      <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${color}`}>{label}</span>
      {rejectionReason && <span className="mt-1 block max-w-xs text-xs text-gray-700">{rejectionReason}</span>}
    </span>
  );
}
