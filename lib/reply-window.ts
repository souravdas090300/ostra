const HOUR = 3_600_000;
export const WINDOW_MS = 24 * HOUR;
const SAFETY_MS = 5 * 60_000; // stop a few minutes early so a slow send cannot fall outside the window

/** When the last guest message opens the window until. null if the guest has never written. */
export function windowEnd(lastGuestMessageAt: Date | null): Date | null {
  return lastGuestMessageAt ? new Date(lastGuestMessageAt.getTime() + WINDOW_MS) : null;
}

export function windowOpen(lastGuestMessageAt: Date | null, now: Date): boolean {
  const end = windowEnd(lastGuestMessageAt);
  return !!end && now.getTime() < end.getTime() - SAFETY_MS;
}

export function resolveGuestLanguage(
  bookingLanguage: string | null,
  lastDetected: string | null,
  ownerDefault: string,
): string {
  return bookingLanguage ?? lastDetected ?? ownerDefault;
}
