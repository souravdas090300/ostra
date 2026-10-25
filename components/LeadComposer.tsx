"use client";

import { MessageComposer, type PreviewState } from "./MessageComposer";
import { previewLeadReply, recheckLeadTranslation, sendLeadReply } from "@/app/(app)/leads/actions";

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
  const actions = {
    preview: async (text: string) => {
      const result = await previewLeadReply(leadId, text);
      return result as { error?: string } & PreviewState;
    },
    recheck: async (translation: string, original: string) => {
      const result = await recheckLeadTranslation(leadId, translation, original);
      return result as { error?: string } & PreviewState;
    },
    send: async (toSend: string, original: string, markResolved: boolean) => {
      const result = await sendLeadReply(leadId, toSend, original, markResolved);
      return result;
    },
  };

  return (
    <MessageComposer
      windowOpen={windowOpen}
      hasPhone={true}
      hostLanguage={hostLanguage}
      guestLanguage={guestLanguage}
      sameLanguage={sameLanguage}
      hasUnresolved={hasUnresolved}
      suggestedQuestion={suggestedQuestion}
      actions={actions}
      showSaveToInfo={false}
    />
  );
}
