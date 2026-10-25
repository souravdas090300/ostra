"use client";

import { MessageComposer, type PreviewState } from "./MessageComposer";
import { previewReply, recheckTranslation, sendReply, appendToInfo } from "@/app/(app)/inbox/actions";

type Props = {
  bookingId: string;
  windowOpen: boolean;
  hasPhone: boolean;
  hostLanguage: string;
  guestLanguage: string;
  sameLanguage: boolean;
  hasUnresolved: boolean;
  apartmentId: string;
  suggestedQuestion: string;
};

export function Composer({
  bookingId,
  windowOpen,
  hasPhone,
  hostLanguage,
  guestLanguage,
  sameLanguage,
  hasUnresolved,
  apartmentId,
  suggestedQuestion,
}: Props) {
  const actions = {
    preview: async (text: string) => {
      const result = await previewReply(bookingId, text);
      return result as { error?: string } & PreviewState;
    },
    recheck: async (translation: string, original: string) => {
      const result = await recheckTranslation(bookingId, translation, original);
      return result as { error?: string } & PreviewState;
    },
    send: async (toSend: string, original: string, markResolved: boolean) => {
      const result = await sendReply(bookingId, toSend, original, markResolved);
      return result;
    },
    saveToInfo: async (target: "info" | "publicInfo", text: string) => {
      const result = await appendToInfo(apartmentId, target, text);
      return result;
    },
  };

  return (
    <MessageComposer
      windowOpen={windowOpen}
      hasPhone={hasPhone}
      hostLanguage={hostLanguage}
      guestLanguage={guestLanguage}
      sameLanguage={sameLanguage}
      hasUnresolved={hasUnresolved}
      suggestedQuestion={suggestedQuestion}
      actions={actions}
      showSaveToInfo={true}
    />
  );
}
