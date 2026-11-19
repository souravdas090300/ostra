/**
 * Safety guard for the test database. The suite seeds, updates, and deletes
 * tenant data, so before any test connects we require:
 *
 *  1. DATABASE_URL parses as postgres/postgresql.
 *  2. The database name ends with "_test".
 *  3. The host is not on the forbidden list — the known production Neon
 *     endpoint plus anything in OSTRA_FORBIDDEN_DB_HOSTS (comma-separated).
 *
 * Mirrors the guard used in the SecureShop test suite.
 */

/** Hosts that must never receive test writes. */
const BUILT_IN_FORBIDDEN_HOSTS = [
  // Production Neon endpoint (.env.prod).
  "ep-restless-sea-b5xxkow0-pooler.c-7.us-east-2.aws.neon.tech",
];

/** Env var for extra comma-separated forbidden hosts. */
export const FORBIDDEN_HOSTS_VARIABLE = "OSTRA_FORBIDDEN_DB_HOSTS";

export interface DatabaseUrlParts {
  protocol: string;
  hostname: string;
  pathname: string;
}

function forbiddenHosts(extra: string | undefined): Set<string> {
  const hosts = [...BUILT_IN_FORBIDDEN_HOSTS];
  if (extra) {
    hosts.push(
      ...extra
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean),
    );
  }
  return new Set(hosts.map((h) => h.toLowerCase()));
}

/**
 * Throws Error unless `databaseUrl` targets a database whose name ends with
 * "_test" on a host that is not forbidden. `extraForbiddenHosts` is primarily
 * for tests; production callers should rely on the env var.
 */
export function assertSafeTestDatabaseUrl(
  databaseUrl: string | undefined | null,
  extraForbiddenHosts?: string,
): DatabaseUrlParts {
  if (!databaseUrl || !databaseUrl.trim()) {
    throw new Error(
      "Refusing to run tests: DATABASE_URL is not set. Tests require a disposable *_test database.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(
      "Refusing to run tests: DATABASE_URL is not a valid URL.",
    );
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error(
      `Refusing to run tests: DATABASE_URL protocol '${parsed.protocol}' is not postgres/postgresql.`,
    );
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (!database || !database.toLowerCase().endsWith("_test")) {
    throw new Error(
      `Refusing to run tests: database '${database}' does not end with '_test'. ` +
        "Point DATABASE_URL at a disposable test database.",
    );
  }

  const host = parsed.hostname.toLowerCase();
  const forbidden = forbiddenHosts(
    extraForbiddenHosts ?? process.env[FORBIDDEN_HOSTS_VARIABLE],
  );
  if (forbidden.has(host)) {
    throw new Error(
      `Refusing to run tests: host '${host}' is a known production/Railway ` +
        "database host. DATABASE_URL must point at a disposable test database.",
    );
  }

  return { protocol: parsed.protocol, hostname: parsed.hostname, pathname: parsed.pathname };
}
