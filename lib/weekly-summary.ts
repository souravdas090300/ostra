import { prisma } from "./db";
import { maltaYmd, TIMEZONE } from "./time";
import { addDays, diffDays } from "./dates";
import { monthlyAiCostCents, monthlyCount } from "./usage";
import { formatInTimeZone } from "date-fns-tz";

export type WeeklySummary = {
  subject: string;
  text: string;
};

/** Get Monday of the current ISO week in Malta time (as a Date object). */
function getMondayOfIsoWeek(now: Date): Date {
  const d = new Date(now);
  const maltaStr = formatInTimeZone(d, TIMEZONE, "yyyy-MM-dd");
  const maltaDate = new Date(`${maltaStr}T00:00:00Z`); // Treat as UTC for consistent arithmetic
  const dayOfWeek = maltaDate.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  maltaDate.setUTCDate(maltaDate.getUTCDate() - daysToMonday);
  return maltaDate;
}

/** Get Sunday of the current ISO week in Malta time (as a Date object). */
function getSundayOfIsoWeek(monday: Date): Date {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + 6);
  return d;
}

/** Get ISO week string like "2026-W45" for a date. */
export function getIsoWeekString(date: Date): string {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const oneJan = new Date(Date.UTC(year, 0, 1));
  const numberOfDays = Math.floor((d.getTime() - oneJan.getTime()) / (24 * 60 * 60 * 1000));
  const week = Math.ceil((d.getUTCDay() + 1 + numberOfDays) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export async function buildWeeklySummary(ownerId: string, now: Date = new Date()): Promise<WeeklySummary> {
  const owner = await prisma.owner.findUnique({
    where: { id: ownerId },
    select: {
      email: true,
      hostLanguage: true,
      monthlyAiBudgetCents: true,
      monthlyTemplateCap: true,
      enquiriesEnabled: true,
    },
  });

  if (!owner) {
    throw new Error("Owner not found");
  }

  const today = maltaYmd(now);
  const mondayDate = getMondayOfIsoWeek(now);
  const sundayDate = getSundayOfIsoWeek(mondayDate);
  const monday = mondayDate.toISOString().slice(0, 10);
  const sunday = sundayDate.toISOString().slice(0, 10);
  const in7Days = addDays(today, 7);
  const in30Days = addDays(today, 30);

  // Get apartments
  const apartments = await prisma.apartment.findMany({
    where: { ownerId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const lines: string[] = [];

  // Subject
  const aptCount = apartments.length;
  const subject = `Ostra weekly summary, ${formatDateRange(monday, sunday)} (${aptCount} apartment${aptCount !== 1 ? "s" : ""})`;

  // Section: Next 7 days (arrivals, departures, turnovers, stays in progress)
  const next7DaysSection = await buildNext7DaysSection(ownerId, today, in7Days, apartments);
  if (next7DaysSection) lines.push(next7DaysSection);

  // Section: Next 30 days occupancy
  const occupancySection = await buildOccupancySection(ownerId, today, in30Days, apartments);
  if (occupancySection) lines.push(occupancySection);

  // Section: Needs attention
  const attentionSection = await buildAttentionSection(ownerId, today, in7Days, apartments);
  if (attentionSection) lines.push(attentionSection);

  // Section: Conversations
  const conversationsSection = await buildConversationsSection(ownerId, today, owner.enquiriesEnabled);
  if (conversationsSection) lines.push(conversationsSection);

  // Section: Usage
  const usageSection = await buildUsageSection(ownerId, now, owner.monthlyAiBudgetCents, owner.monthlyTemplateCap);
  if (usageSection) lines.push(usageSection);

  // Footer
  const appUrl = process.env.APP_URL || "https://ostra.example.com";
  lines.push("");
  lines.push("---");
  lines.push(`View in app: ${appUrl}`);
  lines.push(`${appUrl}/settings (turn off weekly summary)`);

  const text = lines.join("\n");

  return { subject, text };
}

async function buildNext7DaysSection(
  ownerId: string,
  today: string,
  in7Days: string,
  apartments: { id: string; name: string }[]
): Promise<string | null> {
  const lines: string[] = [];
  lines.push("NEXT 7 DAYS");

  for (const apt of apartments) {
    const bookings = await prisma.booking.findMany({
      where: {
        apartmentId: apt.id,
        status: "CONFIRMED",
        isBlock: false,
        checkIn: { lte: in7Days },
        checkOut: { gte: today },
      },
      select: { checkIn: true, checkOut: true },
      orderBy: [{ checkIn: "asc" }],
    });

    const arrivals = bookings.filter((b) => b.checkIn.toISOString().slice(0, 10) >= today && b.checkIn.toISOString().slice(0, 10) <= in7Days);
    const departures = bookings.filter((b) => b.checkOut.toISOString().slice(0, 10) >= today && b.checkOut.toISOString().slice(0, 10) <= in7Days);
    const inProgress = bookings.filter((b) => b.checkIn.toISOString().slice(0, 10) < today && b.checkOut.toISOString().slice(0, 10) > today);

    // Find same-day turnovers
    const turnovers: { date: string; gapHours: number }[] = [];
    for (let i = 0; i < bookings.length - 1; i++) {
      const a = bookings[i];
      const b = bookings[i + 1];
      const aCheckout = a.checkOut.toISOString().slice(0, 10);
      const bCheckin = b.checkIn.toISOString().slice(0, 10);
      if (aCheckout === bCheckin) {
        const gapHours = 24; // Simplified - actual gap depends on check-in/out times
        turnovers.push({ date: aCheckout, gapHours });
      }
    }

    if (arrivals.length === 0 && departures.length === 0 && inProgress.length === 0 && turnovers.length === 0) {
      continue;
    }

    lines.push(`  ${apt.name}`);
    if (arrivals.length > 0) {
      lines.push(`    Arrivals: ${arrivals.length} (${arrivals.map((b) => formatDate(b.checkIn)).join(", ")})`);
    }
    if (departures.length > 0) {
      lines.push(`    Departures: ${departures.length} (${departures.map((b) => formatDate(b.checkOut)).join(", ")})`);
    }
    if (inProgress.length > 0) {
      lines.push(`    Stays in progress: ${inProgress.length}`);
    }
    if (turnovers.length > 0) {
      lines.push(`    Same-day turnovers: ${turnovers.map((t) => `${t.date} (${t.gapHours}h gap)`).join(", ")}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

async function buildOccupancySection(
  ownerId: string,
  today: string,
  in30Days: string,
  apartments: { id: string; name: string }[]
): Promise<string | null> {
  const lines: string[] = [];
  lines.push("NEXT 30 DAYS - OCCUPANCY");

  for (const apt of apartments) {
    const bookings = await prisma.booking.findMany({
      where: {
        apartmentId: apt.id,
        status: "CONFIRMED",
        checkIn: { lte: in30Days },
        checkOut: { gte: today },
      },
      select: { checkIn: true, checkOut: true, isBlock: true },
    });

    // Calculate booked nights
    let bookedNights = 0;
    for (const b of bookings) {
      if (b.isBlock) continue;
      const start = b.checkIn.toISOString().slice(0, 10);
      const end = b.checkOut.toISOString().slice(0, 10);
      const nights = Math.max(0, diffDays(start, end));
      bookedNights += nights;
    }

    // Calculate blocked nights
    let blockedNights = 0;
    for (const b of bookings) {
      if (!b.isBlock) continue;
      const start = b.checkIn.toISOString().slice(0, 10);
      const end = b.checkOut.toISOString().slice(0, 10);
      const nights = Math.max(0, diffDays(start, end));
      blockedNights += nights;
    }

    const totalNights = 30;
    const occupancy = Math.round((bookedNights / totalNights) * 100);

    lines.push(`  ${apt.name}: ${occupancy}% booked (${bookedNights} nights)`);
    if (blockedNights > 0) {
      lines.push(`    Blocked: ${blockedNights} nights`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

async function buildAttentionSection(
  ownerId: string,
  today: string,
  in7Days: string,
  apartments: { id: string; name: string }[]
): Promise<string | null> {
  const lines: string[] = [];
  const issues: string[] = [];

  // Double bookings
  for (const apt of apartments) {
    const bookings = await prisma.booking.findMany({
      where: {
        apartmentId: apt.id,
        status: "CONFIRMED",
        isBlock: false,
        checkIn: { lte: in7Days },
        checkOut: { gte: today },
      },
      select: { checkIn: true, checkOut: true },
    });

    for (let i = 0; i < bookings.length; i++) {
      for (let j = i + 1; j < bookings.length; j++) {
        const a = bookings[i];
        const b = bookings[j];
        if (a.checkIn < b.checkOut && b.checkIn < a.checkOut) {
          issues.push(`Double booking: ${apt.name} ${formatDate(a.checkIn)} - ${formatDate(a.checkOut)}`);
        }
      }
    }
  }

  // Arrivals without phone or consent
  const arrivalsWithoutContact = await prisma.booking.count({
    where: {
      apartment: { ownerId },
      status: "CONFIRMED",
      isBlock: false,
      checkIn: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${in7Days}T00:00:00Z`) },
      OR: [{ guestPhone: null }, { optedInAt: null }],
    },
  });
  if (arrivalsWithoutContact > 0) {
    issues.push(`${arrivalsWithoutContact} arrivals without phone or consent`);
  }

  // Stale calendar feeds
  const staleFeeds = await prisma.calendarFeed.count({
    where: {
      apartment: { ownerId },
      lastSuccessAt: { lt: new Date(Date.now() - 48 * 60 * 60_000) }, // 48 hours
    },
  });
  if (staleFeeds > 0) {
    issues.push(`${staleFeeds} calendar feeds not synced in 48h`);
  }

  // Stale export feeds
  const staleExports = await prisma.exportFeed.count({
    where: {
      apartment: { ownerId },
      enabled: true,
      lastFetchedAt: { lt: new Date(Date.now() - 48 * 60 * 60_000) },
    },
  });
  if (staleExports > 0) {
    issues.push(`${staleExports} export feeds stale`);
  }

  // Failed messages in last 7 days
  const failedMessages = await prisma.message.count({
    where: {
      booking: { apartment: { ownerId } },
      direction: "OUTBOUND",
      deliveryStatus: { in: ["failed", "undelivered"] },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) },
    },
  });
  if (failedMessages > 0) {
    issues.push(`${failedMessages} messages failed in last 7 days`);
  }

  if (issues.length > 0) {
    lines.push("NEEDS ATTENTION");
    issues.forEach((issue) => lines.push(`  • ${issue}`));
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

async function buildConversationsSection(ownerId: string, today: string, enquiriesEnabled: boolean): Promise<string | null> {
  const lines: string[] = [];
  const issues: string[] = [];

  // Unresolved guest conversations
  const unresolvedGuest = await prisma.message.count({
    where: {
      booking: { apartment: { ownerId } },
      escalated: true,
      resolved: false,
    },
  });
  if (unresolvedGuest > 0) {
    issues.push(`${unresolvedGuest} unresolved guest conversations`);
  }

  // Leads needing host
  const leadsNeedingHost = await prisma.lead.count({
    where: {
      ownerId,
      status: "NEEDS_HOST",
    },
  });
  if (leadsNeedingHost > 0) {
    issues.push(`${leadsNeedingHost} leads needing you`);
  }

  if (issues.length > 0) {
    lines.push("CONVERSATIONS");
    issues.forEach((issue) => lines.push(`  • ${issue}`));
  }

  // Enquiry funnel (if enabled)
  if (enquiriesEnabled) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const newLeads = await prisma.lead.count({
      where: { ownerId, createdAt: { gte: weekAgo } },
    });
    const quoted = await prisma.lead.count({
      where: { ownerId, status: "QUOTED", createdAt: { gte: weekAgo } },
    });
    const booked = await prisma.lead.count({
      where: { ownerId, status: "BOOKED", createdAt: { gte: weekAgo } },
    });
    const lost = await prisma.lead.count({
      where: { ownerId, status: "LOST", createdAt: { gte: weekAgo } },
    });

    if (newLeads > 0 || quoted > 0 || booked > 0 || lost > 0) {
      lines.push("ENQUIRIES (last week)");
      lines.push(`  New: ${newLeads}, Quoted: ${quoted}, Booked: ${booked}, Lost: ${lost}`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

async function buildUsageSection(
  ownerId: string,
  now: Date,
  monthlyAiBudgetCents: number,
  monthlyTemplateCap: number
): Promise<string | null> {
  const lines: string[] = [];

  const aiCostCents = await monthlyAiCostCents(ownerId, now);
  const templateCount = await monthlyCount(ownerId, "WA_TEMPLATE", now);

  lines.push("USAGE (this month)");
  lines.push(`  AI cost: €${(aiCostCents / 100).toFixed(2)} / €${(monthlyAiBudgetCents / 100).toFixed(2)}`);
  lines.push(`  Template messages: ${templateCount} / ${monthlyTemplateCap}`);

  const aiPercent = (aiCostCents / monthlyAiBudgetCents) * 100;
  const templatePercent = (templateCount / monthlyTemplateCap) * 100;

  if (aiPercent >= 80) {
    lines.push(`  ⚠️ AI budget at ${Math.round(aiPercent)}%`);
  }
  if (templatePercent >= 80) {
    lines.push(`  ⚠️ Template cap at ${Math.round(templatePercent)}%`);
  }

  return lines.join("\n");
}

function formatDate(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "d MMM");
}

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}
