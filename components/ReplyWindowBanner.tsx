import { windowOpen, windowEnd } from "@/lib/reply-window";

type Props = {
  lastGuestAt: Date | null;
  now: Date;
};

export function ReplyWindowBanner({ lastGuestAt, now }: Props) {
  const open = windowOpen(lastGuestAt, now);

  return (
    <div className={`rounded-lg border p-4 ${open ? "bg-green-50" : "bg-amber-50"}`}>
      <p className="text-sm">
        {open ? (
          <>You can reply until {windowEnd(lastGuestAt)?.toLocaleString()}</>
        ) : (
          "The 24-hour reply window has closed. WhatsApp only allows a reply within 24 hours of the guest's last message."
        )}
      </p>
    </div>
  );
}
