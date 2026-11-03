import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const reviewBy = "2026-12-03";
const exceptions = new Set([
  "GHSA-3g3m-2fjr-6pw4",
  "GHSA-g3hv-75wg-m249",
]);
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

export function validateAuditReport(report, auditExitCode, now = new Date()) {
  if (!Number.isInteger(auditExitCode) || auditExitCode < 0 || auditExitCode > 1) {
    throw new Error("npm audit did not produce a usable report.");
  }

  if (now.toISOString().slice(0, 10) >= reviewBy) {
    throw new Error(`Temporary npm audit exceptions expire on ${reviewBy}.`);
  }

  const counts = report.metadata?.vulnerabilities;

  if (!counts || report.error) {
    throw new Error("npm audit report is missing vulnerability metadata or contains an audit error.");
  }

  const thresholdFindings = (counts.moderate ?? 0)
    + (counts.high ?? 0)
    + (counts.critical ?? 0);
  if (auditExitCode === 1 && thresholdFindings === 0) {
    throw new Error("npm audit failed without reportable moderate-or-higher findings.");
  }
  const advisories = new Map();
  const unresolvedPackages = [];

  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    if ((severityRank[vulnerability.severity] ?? 0) < severityRank.moderate) continue;

    const via = vulnerability.via ?? [];
    if (via.length === 0 || via.some((item) =>
      typeof item === "string" && !report.vulnerabilities[item],
    )) {
      unresolvedPackages.push(packageName);
    }

    for (const item of via) {
      if (typeof item === "string") continue;

      const id = item.url?.match(/GHSA-[a-z0-9-]+/i)?.[0];
      if (!id) {
        advisories.set(`unidentified:${packageName}`, {
          severity: vulnerability.severity,
          packageName,
        });
        continue;
      }

      const existing = advisories.get(id);
      if (!existing || severityRank[vulnerability.severity] > severityRank[existing.severity]) {
        advisories.set(id, { severity: vulnerability.severity, packageName });
      }
    }
  }

  const unapproved = [...advisories].filter(([id, finding]) =>
    !exceptions.has(id) || finding.severity !== "moderate",
  );

  if (
    unapproved.length > 0
    || (thresholdFindings > 0 && advisories.size === 0)
    || (counts.high ?? 0) > 0
    || (counts.critical ?? 0) > 0
    || unresolvedPackages.length > 0
  ) {
    const details = unapproved.map(([id, finding]) =>
      `${id} (${finding.severity}, ${finding.packageName})`,
    );
    details.push(...unresolvedPackages.map((packageName) =>
      `unresolved dependency path (${packageName})`,
    ));
    throw new Error(
      `Unapproved moderate-or-higher npm audit findings: ${details.join(", ") || "unidentified advisory"}`,
    );
  }

  return thresholdFindings === 0
    ? "npm audit passed with no moderate-or-higher findings."
    : `npm audit passed with temporary exceptions ${[...advisories.keys()].join(", ")} until ${reviewBy}.`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [reportPath, exitCodeText] = process.argv.slice(2);
  const auditExitCode = Number(exitCodeText);
  if (!reportPath) throw new Error("npm audit did not produce a usable report.");
  const report = JSON.parse(readFileSync(reportPath, "utf8").replace(/^\uFEFF/, ""));
  console.log(validateAuditReport(report, auditExitCode));
}
