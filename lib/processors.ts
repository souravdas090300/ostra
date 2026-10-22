export interface Processor {
  name: string;
  purpose: string;
  dataInvolved: string;
  region: string;
}

export const PROCESSORS: Processor[] = [
  {
    name: "Railway",
    purpose: "Application hosting and database",
    dataInvolved: "All application data (bookings, messages, owner settings)",
    region: "EU (Frankfurt)",
  },
  {
    name: "Twilio",
    purpose: "WhatsApp message delivery",
    dataInvolved: "Guest phone numbers, message content",
    region: "Global (servers in US and EU)",
  },
  {
    name: "Meta (WhatsApp)",
    purpose: "WhatsApp messaging platform",
    dataInvolved: "Guest phone numbers, message content (via Twilio)",
    region: "Global",
  },
  {
    name: "Anthropic",
    purpose: "AI assistant for guest responses",
    dataInvolved: "Guest messages, apartment information (no guest personal data)",
    region: "US",
  },
  {
    name: "Sentry",
    purpose: "Error reporting and monitoring",
    dataInvolved: "Scrubbed error messages (no personal data)",
    region: "EU",
  },
  {
    name: "Resend",
    purpose: "Email notifications to host",
    dataInvolved: "Host email, escalation summaries (no guest personal data)",
    region: "US",
  },
];
