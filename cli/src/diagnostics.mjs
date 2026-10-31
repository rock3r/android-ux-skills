import { SCHEMA_VERSION, STANDARDS_VERSION, PACKAGE_VERSION } from './version.mjs';

/**
 * Build a self-documenting diagnostic object suitable for JSON output and human formatting.
 */
export function createDiagnostic({
  code,
  severity = 'error',
  status = 'fail',
  domain = 'core',
  summary,
  searched = null,
  evidence = null,
  impact = null,
  remediation = null,
  docPath = 'references/standards.md',
  file = null,
  lines = null,
  extra = {},
}) {
  const diag = {
    code,
    severity,
    status,
    domain,
    summary,
  };
  if (file !== null) diag.file = file;
  if (lines !== null) diag.lines = lines;
  if (searched !== null) diag.searched = searched;
  if (evidence !== null) diag.evidence = evidence;
  if (impact !== null) diag.impact = impact;
  if (remediation !== null) diag.remediation = remediation;
  if (docPath !== null) diag.docPath = docPath;
  return { ...diag, ...extra };
}

/**
 * Format a single diagnostic block in human-readable self-explanatory form.
 */
export function formatDiagnosticText(diag) {
  const level = (diag.severity || 'error').toUpperCase();
  const out = [`[${level} ${diag.code}] ${diag.summary}`];
  if (diag.file) {
    const loc = Array.isArray(diag.lines) && diag.lines.length >= 2
      ? `${diag.file}:${diag.lines[0]}-${diag.lines[1]}`
      : Array.isArray(diag.lines) && diag.lines.length === 1
        ? `${diag.file}:${diag.lines[0]}`
        : diag.file;
    out.push(`  Location: ${loc}`);
  }
  if (diag.searched) {
    const text = Array.isArray(diag.searched) ? diag.searched.join(', ') : String(diag.searched);
    out.push(`  Searched: ${text}`);
  }
  if (diag.evidence) {
    out.push(`  Evidence: ${diag.evidence}`);
  }
  if (diag.impact) {
    out.push(`  Impact:   ${diag.impact}`);
  }
  if (diag.remediation) {
    const lines = Array.isArray(diag.remediation)
      ? diag.remediation
      : String(diag.remediation).split('\n');
    out.push(`  Fix:      ${lines[0]}`);
    for (let i = 1; i < lines.length; i += 1) {
      out.push(`            ${lines[i]}`);
    }
  }
  if (diag.docPath) {
    out.push(`  Docs:     ${diag.docPath}`);
  }
  return out.join('\n');
}

export function createJsonEnvelope(command, payload = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    packageVersion: PACKAGE_VERSION,
    standardsVersion: STANDARDS_VERSION,
    command,
    ...payload,
  };
}
