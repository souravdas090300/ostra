import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../lib/db";
import { isLockedOut, recordAttempt, clientIp } from "../lib/login-guard";

describe("login guard", () => {
  beforeEach(async () => {
    await prisma.loginAttempt.deleteMany({});
  });

  afterEach(async () => {
    await prisma.loginAttempt.deleteMany({});
  });

  it("locks out after 5 failed email attempts", async () => {
    const email = "test@example.com";
    const ip = "127.0.0.1";

    for (let i = 0; i < 5; i++) {
      await recordAttempt(email, ip, false);
    }

    expect(await isLockedOut(email, ip)).toBe(true);
  });

  it("locks out after 20 failed IP attempts", async () => {
    const email = "test@example.com";
    const ip = "127.0.0.1";

    for (let i = 0; i < 20; i++) {
      await recordAttempt(email, ip, false);
    }

    expect(await isLockedOut(email, ip)).toBe(true);
  });

  it("does not lock out successful attempts", async () => {
    const email = "test@example.com";
    const ip = "127.0.0.1";

    for (let i = 0; i < 5; i++) {
      await recordAttempt(email, ip, true);
    }

    expect(await isLockedOut(email, ip)).toBe(false);
  });

  it("respects time window for email lockout", async () => {
    const email = "test@example.com";
    const ip = "127.0.0.1";
    const now = new Date();
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60_000 - 1000);

    for (let i = 0; i < 5; i++) {
      await prisma.loginAttempt.create({
        data: {
          emailHash: email,
          ipHash: ip,
          success: false,
          createdAt: fifteenMinutesAgo,
        },
      });
    }

    expect(await isLockedOut(email, ip, now)).toBe(false);
  });

  it("respects time window for IP lockout", async () => {
    const email = "test@example.com";
    const ip = "127.0.0.1";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000 - 1000);

    for (let i = 0; i < 20; i++) {
      await prisma.loginAttempt.create({
        data: {
          emailHash: email,
          ipHash: ip,
          success: false,
          createdAt: oneHourAgo,
        },
      });
    }

    expect(await isLockedOut(email, ip, now)).toBe(false);
  });

  it("clientIp extracts from x-forwarded-for when TRUST_PROXY=1", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
    });
    process.env.TRUST_PROXY = "1";
    expect(clientIp(headers)).toBe("1.2.3.4");
    delete process.env.TRUST_PROXY;
  });

  it("clientIp returns unknown when TRUST_PROXY not set", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4",
    });
    expect(clientIp(headers)).toBe("unknown");
  });
});
