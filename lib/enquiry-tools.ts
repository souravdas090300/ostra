import { z } from "zod";
import { isValidYmd } from "./dates";
import { maltaYmd } from "./time";
import { ensureFreshCalendars, getAvailability, findAlternatives, getAvailabilityFresh } from "./availability";
import { prisma } from "./db";

export type TurnContext = {
  ownerId: string;
  leadId: string;
  now: Date;
  results: Map<
    string,
    AvailabilityResult & { inYmd: string; outYmd: string; guests: number }
  >;
  saved: {
    name?: string;
    checkInYmd?: string;
    checkOutYmd?: string;
    guests?: number;
    apartmentId?: string;
  };
  allowedAmounts: Set<number>; // euros as numbers, from tool results only
  allowedText: string; // public information, apartment names, tool text, for the link and number guard
};

type AvailabilityResult = {
  apartmentId: string;
  name: string;
  available: boolean;
  reason?: string;
  nights: number;
  minNights: number;
  maxGuests: number;
  bedrooms: number;
  totalCents?: number;
  cleaningFeeCents?: number;
  nightly?: { date: string; cents: number }[];
  verified: boolean;
};

const CHECK_AVAILABILITY = {
  name: "check_availability",
  description:
    "Check availability and pricing for apartments. Always call this before quoting prices.",
  input_schema: {
    type: "object" as const,
    properties: {
      check_in: {
        type: "string",
        description: "Check-in date in YYYY-MM-DD format",
      },
      check_out: {
        type: "string",
        description: "Check-out date in YYYY-MM-DD format",
      },
      guests: {
        type: "number",
        description: "Number of guests (1-30)",
      },
      apartment_name: {
        type: "string",
        description: "Optional: specific apartment name to check",
      },
    },
    required: ["check_in", "check_out", "guests"],
  },
};

const GET_APARTMENT_INFO = {
  name: "get_apartment_info",
  description: "Get public information about an apartment (never private details like codes or address).",
  input_schema: {
    type: "object" as const,
    properties: {
      apartment_name: {
        type: "string",
        description: "Name of the apartment",
      },
    },
    required: ["apartment_name"],
  },
};

const SAVE_LEAD_DETAILS = {
  name: "save_lead_details",
  description: "Save or update the lead's enquiry details (dates, guests, apartment preference).",
  input_schema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Guest's first name (max 60 characters)",
      },
      check_in: {
        type: "string",
        description: "Check-in date in YYYY-MM-DD format",
      },
      check_out: {
        type: "string",
        description: "Check-out date in YYYY-MM-DD format",
      },
      guests: {
        type: "number",
        description: "Number of guests",
      },
      apartment_name: {
        type: "string",
        description: "Preferred apartment name",
      },
    },
    required: [],
  },
};

const HANDOFF_TO_HOST = {
  name: "handoff_to_host",
  description: "Escalate the conversation to the host. Use this for questions the AI cannot answer, payment discussions, special requests, or when unsure.",
  input_schema: {
    type: "object" as const,
    properties: {
      reason: {
        type: "string",
        description: "Short English reason for the handoff (max 300 characters)",
      },
      urgent: {
        type: "boolean",
        description: "True only for emergencies or urgent issues",
      },
    },
    required: ["reason"],
  },
};

const MARK_DO_NOT_CONTACT = {
  name: "mark_do_not_contact",
  description: "Mark the lead as opting out when the guest asks to stop receiving messages.",
  input_schema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

const RESPOND = {
  name: "respond",
  description: "Send the reply to the guest and report what happened. This is the last tool call.",
  input_schema: {
    type: "object" as const,
    properties: {
      language: {
        type: "string",
        description:
          "ISO 639-1 code of the language of the guest's latest message (nb for Norwegian).",
      },
      reply: {
        type: "string",
        description: "The WhatsApp message to send to the guest, in the guest's language.",
      },
      escalate: {
        type: "boolean",
        description: "True if the host must handle this.",
      },
      urgent: {
        type: "boolean",
        description: "True only for emergencies.",
      },
      reason: {
        type: "string",
        description: "Short English reason when escalate is true, otherwise empty.",
      },
      host_summary: {
        type: "string",
        description: "One or two sentences for the host, in the host's language.",
      },
      opt_out: {
        type: "boolean",
        description: "True if the guest asked to stop receiving messages.",
      },
    },
    required: ["language", "reply", "escalate", "urgent", "reason", "host_summary", "opt_out"],
  },
};

export const dataTools = [CHECK_AVAILABILITY, GET_APARTMENT_INFO, SAVE_LEAD_DETAILS, HANDOFF_TO_HOST, MARK_DO_NOT_CONTACT];
export const RESPOND_TOOL = RESPOND;

export async function runTool(
  name: string,
  input: any,
  ctx: TurnContext,
): Promise<string> {
  if (name === "check_availability") {
    return await runCheckAvailability(input, ctx);
  }
  if (name === "get_apartment_info") {
    return await runGetApartmentInfo(input, ctx);
  }
  if (name === "save_lead_details") {
    return await runSaveLeadDetails(input, ctx);
  }
  if (name === "handoff_to_host") {
    return await runHandoffToHost(input, ctx);
  }
  if (name === "mark_do_not_contact") {
    return await runMarkDoNotContact(input, ctx);
  }
  return JSON.stringify({ error: "Unknown tool" });
}

async function runCheckAvailability(
  input: any,
  ctx: TurnContext,
): Promise<string> {
  const { check_in, check_out, guests, apartment_name } = input;

  // Validate dates
  if (!isValidYmd(check_in) || !isValidYmd(check_out)) {
    return JSON.stringify({ error: "Invalid date format. Use YYYY-MM-DD." });
  }
  if (check_out <= check_in) {
    return JSON.stringify({ error: "Check-out must be after check-in." });
  }
  const nights = Math.round(
    (Date.parse(`${check_out}T00:00:00Z`) - Date.parse(`${check_in}T00:00:00Z`)) / 86_400_000,
  );
  if (nights > 60) {
    return JSON.stringify({ error: "Maximum stay is 60 nights." });
  }
  if (guests < 1 || guests > 30) {
    return JSON.stringify({ error: "Guests must be between 1 and 30." });
  }

  // Find apartment
  let apartmentId: string | undefined;
  if (apartment_name) {
    const apt = await findApartment(ctx.ownerId, apartment_name);
    if (!apt) {
      const apartments = await prisma.apartment.findMany({
        where: { ownerId: ctx.ownerId },
        select: { name: true },
      });
      return JSON.stringify({
        error: "Unknown apartment",
        apartments: apartments.map((a) => a.name),
      });
    }
    apartmentId = apt.id;
  }

  // Sync calendars if stale and get availability with stale flag
  const { results, calendarsStale } = await getAvailabilityFresh(ctx.ownerId, {
    checkIn: new Date(check_in),
    checkOut: new Date(check_out),
    guests,
    apartmentId,
    now: ctx.now,
  });

  // Record results in context
  for (const r of results) {
    ctx.results.set(r.apartmentId, {
      ...r,
      inYmd: check_in,
      outYmd: check_out,
      guests,
    });
    if (r.totalCents) {
      ctx.allowedAmounts.add(r.totalCents / 100);
    }
    if (r.cleaningFeeCents) {
      ctx.allowedAmounts.add(r.cleaningFeeCents / 100);
    }
    if (r.nightly) {
      for (const n of r.nightly) {
        ctx.allowedAmounts.add(n.cents / 100);
      }
    }
  }

  // If nothing available, get alternatives
  const first = results[0];
  if (!first || !first.available) {
    const alternatives = await findAlternatives(ctx.ownerId, {
      checkIn: new Date(check_in),
      checkOut: new Date(check_out),
      guests,
      apartmentId,
      now: ctx.now,
    });
    return JSON.stringify({
      available: false,
      calendars_stale: calendarsStale,
      apartments: results.map((r) => ({
        apartment_name: r.name,
        available: r.available,
        reason: r.reason,
        nights: r.nights,
        min_nights: r.minNights,
        max_guests: r.maxGuests,
        bedrooms: r.bedrooms,
        verified: r.verified,
      })),
      alternatives: {
        other_apartments: alternatives.otherApartments.map((a) => ({
          apartment_name: a.name,
          available: a.available,
          total_eur: a.totalCents ? a.totalCents / 100 : undefined,
        })),
        shifted_dates: alternatives.shiftedDates.map((s) => ({
          apartment_name: s.name,
          check_in: s.inYmd,
          check_out: s.outYmd,
          total_eur: s.totalCents / 100,
        })),
      },
      note: "as of now, the host confirms",
    });
  }

  return JSON.stringify({
    available: true,
    calendars_stale: calendarsStale,
    apartments: results.map((r) => ({
      apartment_name: r.name,
      available: r.available,
      nights: r.nights,
      min_nights: r.minNights,
      max_guests: r.maxGuests,
      bedrooms: r.bedrooms,
      total_eur: r.totalCents ? r.totalCents / 100 : undefined,
      cleaning_fee_eur: r.cleaningFeeCents ? r.cleaningFeeCents / 100 : undefined,
      price_per_night_eur: r.nightly?.length === 1 ? r.nightly[0].cents / 100 : undefined,
      price_range_per_night_eur:
        r.nightly && r.nightly.length > 1
          ? `${Math.min(...r.nightly.map((n) => n.cents)) / 100} - ${Math.max(...r.nightly.map((n) => n.cents)) / 100}`
          : undefined,
      verified: r.verified,
    })),
    note: "as of now, the host confirms",
  });
}

async function runGetApartmentInfo(
  input: any,
  ctx: TurnContext,
): Promise<string> {
  const { apartment_name } = input;
  const apt = await findApartment(ctx.ownerId, apartment_name);
  if (!apt) {
    const apartments = await prisma.apartment.findMany({
      where: { ownerId: ctx.ownerId },
      select: { name: true },
    });
    return JSON.stringify({
      error: "Unknown apartment",
      apartments: apartments.map((a) => a.name),
    });
  }

  ctx.allowedText += ` ${apt.publicInfo} ${apt.name}`;

  return JSON.stringify({
    public_info: apt.publicInfo.slice(0, 6000),
    bedrooms: apt.bedrooms,
    max_guests: apt.maxGuests,
    minimum_nights: apt.minNights,
  });
}

async function runSaveLeadDetails(
  input: any,
  ctx: TurnContext,
): Promise<string> {
  const { name, check_in, check_out, guests, apartment_name } = input;

  if (name && name.length > 60) {
    return JSON.stringify({ error: "Name must be at most 60 characters." });
  }

  // Update saved details
  if (name) ctx.saved.name = name.slice(0, 60);
  if (check_in && isValidYmd(check_in)) ctx.saved.checkInYmd = check_in;
  if (check_out && isValidYmd(check_out)) ctx.saved.checkOutYmd = check_out;
  if (guests && guests >= 1 && guests <= 30) ctx.saved.guests = guests;
  if (apartment_name) {
    const apt = await findApartment(ctx.ownerId, apartment_name);
    if (apt) ctx.saved.apartmentId = apt.id;
  }

  return JSON.stringify({ saved: ctx.saved });
}

async function findApartment(ownerId: string, name: string) {
  // Case-insensitive exact match
  const exact = await prisma.apartment.findFirst({
    where: { ownerId, name: { equals: name, mode: "insensitive" } },
  });
  if (exact) return exact;

  // Unique substring match
  const all = await prisma.apartment.findMany({
    where: { ownerId },
    select: { id: true, name: true },
  });
  const matches = all.filter((a) => a.name.toLowerCase().includes(name.toLowerCase()));
  if (matches.length === 1) return matches[0];

  return null;
}

async function runHandoffToHost(
  input: any,
  ctx: TurnContext,
): Promise<string> {
  const { reason, urgent } = input;

  // Save the handoff reason to the lead for later use
  await prisma.lead.update({
    where: { id: ctx.leadId },
    data: {
      status: "NEEDS_HOST",
      needsHostReason: reason?.slice(0, 300) || null,
      urgent: urgent || false,
      hostSummary: reason?.slice(0, 600) || null,
    },
  });

  return JSON.stringify({ success: true, message: "Handed off to host" });
}

async function runMarkDoNotContact(
  input: any,
  ctx: TurnContext,
): Promise<string> {
  // Mark the lead as blocked
  await prisma.lead.update({
    where: { id: ctx.leadId },
    data: {
      blockedAt: new Date(),
    },
  });

  return JSON.stringify({ success: true, message: "Marked as do not contact" });
}
