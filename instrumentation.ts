import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  tunnelRoute: "/monitoring",
  beforeSend(event) {
    // Remove request data, cookies, headers, user
    delete event.request?.data;
    delete event.request?.cookies;
    delete event.request?.headers;
    delete event.user;

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
  // Remove phone numbers, emails, URLs, long digit runs
  return value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]");
}
