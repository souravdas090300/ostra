import { MessageFeedback } from "./MessageFeedback";

type Message = {
  id: string;
  direction: string;
  author?: string;
  body: string;
  createdAt: Date;
  hasMedia: boolean;
  deliveryStatus?: string;
  originalBody?: string;
  escalated: boolean;
  resolved: boolean;
  urgent?: boolean;
  feedback?: "GOOD" | "WRONG" | null;
  feedbackNote?: string;
};

type Props = {
  readonly messages: Message[];
  readonly onReopen?: (messageId: string) => Promise<void>;
  readonly showFeedback?: boolean;
};

export function MessageList({ messages, onReopen, showFeedback = false }: Props) {
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        <div key={m.id} className={`flex ${m.direction === "INBOUND" ? "justify-start" : "justify-end"}`}>
          <div className={`max-w-[80%] rounded-lg p-3 ${m.direction === "INBOUND" ? "bg-gray-100" : "bg-blue-100"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{m.author === "GUEST" ? "Guest" : m.author === "AI" ? "Assistant" : m.author === "HOST" ? "You" : "Automatic"}</span>
              <span className="text-xs text-gray-500">{new Date(m.createdAt).toLocaleString()}</span>
            </div>
            {m.hasMedia && <p className="text-xs text-gray-600 mt-1">(photo or voice message)</p>}
            <p className="mt-1 text-sm" dir="auto">
              {m.body}
            </p>
            {m.direction === "OUTBOUND" && (
              <p className="mt-1 text-xs text-gray-600">
                {m.deliveryStatus === "failed" ? (
                  <span className="text-red-600">Failed</span>
                ) : (
                  m.deliveryStatus
                )}
              </p>
            )}
            {m.originalBody && (
              <details className="mt-2">
                <summary className="text-xs text-gray-600 cursor-pointer">What you wrote</summary>
                <p className="mt-1 text-sm" dir="auto">
                  {m.originalBody}
                </p>
              </details>
            )}
            {m.escalated && (
              <div className="mt-2 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Escalated</span>
                {m.resolved ? (
                  <span className="text-xs text-green-600">Resolved</span>
                ) : onReopen ? (
                  <button
                    onClick={async () => {
                      await onReopen(m.id);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Reopen
                  </button>
                ) : null}
              </div>
            )}
            {showFeedback && m.author === "AI" && m.direction === "OUTBOUND" && (
              <MessageFeedback
                messageId={m.id}
                initialFeedback={m.feedback ?? null}
                initialNote={m.feedbackNote ?? null}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
