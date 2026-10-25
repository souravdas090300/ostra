#!/usr/bin/env node

/**
 * Cron job runner for Ostra
 * Usage: node scripts/run-cron.mjs <job-name>
 *
 * Available jobs:
 * - send-scheduled: Send due scheduled WhatsApp messages
 * - sync-templates: Sync template approval status from Twilio
 * - sync-calendars: Sync calendar feeds (existing Phase 3 job)
 * - weekly-summary: Send weekly summary emails to owners
 * - lead-follow-ups: Send follow-up messages to quiet leads (Phase 12)
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load environment variables
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const job = process.argv[2];

if (!job) {
  console.error("Usage: node scripts/run-cron.mjs <job-name>");
  console.error("Available jobs: send-scheduled, sync-templates, sync-calendars, weekly-summary, lead-follow-ups");
  process.exit(1);
}

async function runJob() {
  const baseUrl = process.env.APP_URL || "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("CRON_SECRET environment variable is required");
    process.exit(1);
  }

  const endpoint = job === "sync-calendars" ? "sync-calendars" : job;
  const url = `${baseUrl}/api/cron/${endpoint}`;

  console.log(`Running cron job: ${job}`);
  console.log(`URL: ${url}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Cron job failed with status ${response.status}: ${text}`);
      process.exit(1);
    }

    const data = await response.json();
    console.log("Cron job completed successfully:", JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error running cron job:", error);
    process.exit(1);
  }
}

await runJob();
