type UnresolvedMessage = {
  id: string;
  urgent?: boolean;
  hostSummary?: string;
  escalationReason?: string;
};

type Props = {
  unresolved: UnresolvedMessage[];
  onResolve: () => Promise<void>;
};

export function AttentionBanner({ unresolved, onResolve }: Props) {
  if (unresolved.length === 0) return null;

  return (
    <div className="rounded-lg border bg-amber-50 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Needs your attention</h2>
        <button
          onClick={async () => {
            await onResolve();
          }}
          className="rounded-md border px-3 py-1 text-sm"
        >
          Mark resolved
        </button>
      </div>
      {unresolved.slice(0, 1).map((m) => (
        <div key={m.id} className="space-y-1">
          {m.urgent && <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Urgent</span>}
          <p className="text-sm">{m.hostSummary}</p>
          {m.escalationReason && <p className="text-xs text-gray-600">{m.escalationReason}</p>}
        </div>
      ))}
    </div>
  );
}
