import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { validateAuditReport } from '../scripts/check-npm-audit.mjs';

const APPROVED_ADVISORIES = ['GHSA-3g3m-2fjr-6pw4', 'GHSA-g3hv-75wg-m249'];
let tempDirectory: string | undefined;

function makeReport(
  findings: Array<{ id: string; severity: 'moderate' | 'high' | 'critical' }>
) {
  const counts = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: findings.length,
  };
  const vulnerabilities: Record<
    string,
    { severity: string; via: Array<{ url: string }> }
  > = {};

  for (const [index, finding] of findings.entries()) {
    counts[finding.severity] += 1;
    vulnerabilities[`package-${index}`] = {
      severity: finding.severity,
      via: [{ url: `https://github.com/advisories/${finding.id}` }],
    };
  }

  return { metadata: { vulnerabilities: counts }, vulnerabilities };
}

function runCheckerCli(content: string) {
  tempDirectory = mkdtempSync(join(tmpdir(), 'ostra-audit-test-'));
  const reportPath = join(tempDirectory, 'audit.json');
  writeFileSync(reportPath, content);
  return spawnSync(
    process.execPath,
    ['scripts/check-npm-audit.mjs', reportPath, '0'],
    { cwd: process.cwd(), encoding: 'utf8' }
  );
}

afterEach(() => {
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
  tempDirectory = undefined;
});

describe('npm audit exception policy', () => {
  it('allows only the approved advisories before the review date', () => {
    const report = makeReport(
      APPROVED_ADVISORIES.map((id) => ({ id, severity: 'moderate' }))
    );

    expect(() =>
      validateAuditReport(report, 1, new Date('2026-12-02T12:00:00.000Z'))
    ).not.toThrow();
  });

  it('rejects an unknown advisory', () => {
    const report = makeReport([
      { id: 'GHSA-abcd-efgh-ijkl', severity: 'moderate' },
    ]);

    expect(() =>
      validateAuditReport(report, 1, new Date('2026-11-30T12:00:00.000Z'))
    ).toThrow(/Unapproved moderate-or-higher/);
  });

  it('rejects approved advisories on and after the expiry date', () => {
    const report = makeReport([
      { id: APPROVED_ADVISORIES[0], severity: 'moderate' },
    ]);

    expect(() =>
      validateAuditReport(report, 1, new Date('2026-12-03T00:00:00.000Z'))
    ).toThrow(/expire on 2026-12-03/);
  });

  it.each(['high', 'critical'] as const)(
    'rejects an approved advisory at %s severity',
    (severity) => {
      const report = makeReport([{ id: APPROVED_ADVISORIES[0], severity }]);

      expect(() =>
        validateAuditReport(report, 1, new Date('2026-12-02T12:00:00.000Z'))
      ).toThrow(/Unapproved moderate-or-higher/);
    }
  );

  it('rejects an unparsable audit report', () => {
    const result = runCheckerCli('{ this is not JSON');

    expect(result.status).not.toBe(0);
  });

  it('rejects an empty audit report', () => {
    const result = runCheckerCli('{}');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('missing vulnerability metadata');
  });
});
