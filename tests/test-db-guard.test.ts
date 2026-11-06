import { describe, expect, it } from "vitest";
import {
  assertSafeTestDatabaseUrl,
  FORBIDDEN_HOSTS_VARIABLE,
} from "@/lib/test-database-guard";

const SAFE_URL =
  "postgresql://ostra:pw@127.0.0.1:5434/ostra_test";
const PROD_HOST =
  "ep-restless-sea-b5xxkow0-pooler.c-7.us-east-2.aws.neon.tech";

describe("assertSafeTestDatabaseUrl", () => {
  it("accepts a local disposable _test database", () => {
    const parts = assertSafeTestDatabaseUrl(SAFE_URL);
    expect(parts.hostname).toBe("127.0.0.1");
    expect(parts.pathname).toBe("/ostra_test");
  });

  it("accepts postgres:// scheme and _test suffix case-insensitively", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgres://u:p@localhost:5432/OSTRA_TEST"),
    ).not.toThrow();
  });

  it.each([undefined, null, "", "   "])(
    "rejects missing DATABASE_URL (%j)",
    (url) => {
      expect(() => assertSafeTestDatabaseUrl(url)).toThrow(
        /DATABASE_URL is not set/,
      );
    },
  );

  it("rejects an unparseable URL", () => {
    expect(() => assertSafeTestDatabaseUrl("not a url")).toThrow(
      /not a valid URL/,
    );
  });

  it("rejects non-postgres protocols", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("mysql://u:p@localhost:3306/ostra_test"),
    ).toThrow(/not postgres\/postgresql/);
    expect(() =>
      assertSafeTestDatabaseUrl("file:./dev.db"),
    ).toThrow(/not postgres\/postgresql/);
  });

  it.each(["ostra", "neondb", "ostra_dev", "production"])(
    "rejects database '%s' without _test suffix",
    (db) => {
      expect(() =>
        assertSafeTestDatabaseUrl(
          `postgresql://u:p@localhost:5432/${db}`,
        ),
      ).toThrow(/does not end with '_test'/);
    },
  );

  it("rejects the production Neon host even with a _test database name", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        `postgresql://u:p@${PROD_HOST}/ostra_test`,
      ),
    ).toThrow(/production\/Railway database host/);
  });

  it("rejects extra forbidden hosts from the env var", () => {
    const prev = process.env[FORBIDDEN_HOSTS_VARIABLE];
    process.env[FORBIDDEN_HOSTS_VARIABLE] = "db.example.com, other.example.com";
    try {
      expect(() =>
        assertSafeTestDatabaseUrl(
          "postgresql://u:p@other.example.com:5432/ostra_test",
        ),
      ).toThrow(/production\/Railway database host/);
    } finally {
      if (prev === undefined) delete process.env[FORBIDDEN_HOSTS_VARIABLE];
      else process.env[FORBIDDEN_HOSTS_VARIABLE] = prev;
    }
  });

  it("honours caller-supplied extra forbidden hosts", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://u:p@tenant.example.com:5432/ostra_test",
        "tenant.example.com",
      ),
    ).toThrow(/production\/Railway database host/);
  });
});
