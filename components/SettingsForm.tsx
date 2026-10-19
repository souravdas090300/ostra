"use client";

import { useActionState } from "react";
import { LANGUAGES } from "@/lib/languages";
import type { FormState } from "@/app/(app)/apartments/actions";

export function SettingsForm({
  action,
  initialValues,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  initialValues: { hostLanguage: string; defaultGuestLanguage: string };
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const e = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4 max-w-2xl">
      <label className="block">
        <span className="text-sm font-medium">My language</span>
        <span className="block text-xs text-gray-500">
          The language you read and write. Escalation summaries and the inbox are translated into this.
        </span>
        <select
          name="hostLanguage"
          defaultValue={initialValues.hostLanguage}
          className="mt-1 w-full rounded-md border px-3 py-2"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name} ({l.native})
            </option>
          ))}
        </select>
        {e.hostLanguage?.map((m) => <p key={m} className="text-sm text-red-600">{m}</p>)}
      </label>

      <label className="block">
        <span className="text-sm font-medium">Default guest language</span>
        <span className="block text-xs text-gray-500">
          Used for automatic messages until a guest&apos;s language is known.
        </span>
        <select
          name="defaultGuestLanguage"
          defaultValue={initialValues.defaultGuestLanguage}
          className="mt-1 w-full rounded-md border px-3 py-2"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name} ({l.native})
            </option>
          ))}
        </select>
        {e.defaultGuestLanguage?.map((m) => <p key={m} className="text-sm text-red-600">{m}</p>)}
      </label>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">Saved.</p>}
      <button disabled={pending} className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}
