import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // Remove request data, cookies, headers, user
    delete event.request?.data;
    delete event.request?.cookies;
    delete event.request?.headers;
    delete event.user;

    // Redact iCal export URLs (tokens are secrets)
    if (event.request?.url && event.request.url.startsWith("/api/ical/")) {
      event.request.url = "/api/ical/[redacted]";
    }

    // Scrub exception values
    if (event.exception?.values) {
      for (const exception of event.exception.values) {
        if (exception.value) {
          exception.value = scrubValue(exception.value);
        }
        if (exception.stacktrace?.frames) {
          for (const frame of exception.stacktrace.frames) {
            if (frame.vars) {
              for (const [key, value] of Object.entries(frame.vars)) {
                frame.vars[key] = typeof value === "string" ? scrubValue(value) : value;
              }
            }
          }
        }
      }
    }

    // Scrub breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.filter((bc) => {
        // Drop console, fetch, and XHR breadcrumbs
        if (bc.category === "console" || bc.category === "fetch" || bc.category === "xhr") {
          return false;
        }
        // Scrub breadcrumb messages
        if (bc.message) {
          bc.message = scrubValue(bc.message);
        }
        return true;
      });
    }

    return event;
  },
  beforeBreadcrumb(breadcrumb) {
    // Drop console, fetch, and XHR breadcrumbs
    if (breadcrumb.category === "console" || breadcrumb.category === "fetch" || breadcrumb.category === "xhr") {
      return null;
    }
    return breadcrumb;
  },
});

function scrubValue(value: string): string {
  // Remove phone numbers, emails, URLs, long digit runs, and iCal export tokens
  let scrubbed = value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]");
  // Scrub iCal export tokens (base64url, 20-64 chars) when they appear in URLs
  scrubbed = scrubbed.replace(/\/api\/ical\/[A-Za-z0-9_-]{20,64}(?:\.ics)?/g, "/api/ical/[redacted]");
  return scrubbed;
}
