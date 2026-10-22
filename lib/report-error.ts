import * as Sentry from "@sentry/nextjs";
import { scrub } from "./scrub";

export function reportError(err: unknown, tags: Record<string, string> = {}) {
  Sentry.captureException(err, {
    tags,
  });
}
