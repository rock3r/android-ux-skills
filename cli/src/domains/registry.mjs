import { MOTION_DOMAIN_PACK } from './motion/rules.mjs';

/**
 * Multi-domain rule pack registry.
 * Track A populates `motion`; Post-A domains (`theme`, `layout`, `adaptive`, `data`, `states`)
 * register here without changing the CLI spine, waiver schema, or hook dispatcher.
 */
const DOMAIN_PACKS = new Map([
  [MOTION_DOMAIN_PACK.id, MOTION_DOMAIN_PACK],
]);

export function getRegisteredDomainIds() {
  return Array.from(DOMAIN_PACKS.keys());
}

export function getDomainPack(domainId) {
  return DOMAIN_PACKS.get(domainId) || null;
}

export function getAllDomainPacks(scopes = null) {
  if (!scopes || scopes.length === 0 || scopes.includes('all')) {
    return Array.from(DOMAIN_PACKS.values());
  }
  const selected = [];
  for (const s of scopes) {
    const pack = DOMAIN_PACKS.get(s);
    if (pack && !selected.includes(pack)) selected.push(pack);
  }
  return selected;
}

export function getAllRules(scopes = null) {
  return getAllDomainPacks(scopes).flatMap((p) => p.rules);
}

export function findRuleById(ruleId) {
  const norm = String(ruleId || '').trim().toUpperCase();
  for (const pack of DOMAIN_PACKS.values()) {
    const found = pack.rules.find((r) => r.id === norm);
    if (found) return found;
  }
  return null;
}

export function parseScopeList(rawScopeArgs) {
  const valid = new Set(['all', ...getRegisteredDomainIds()]);
  const scopes = [];
  const unknown = [];
  for (const raw of rawScopeArgs) {
    for (const part of String(raw).split(',')) {
      const s = part.trim().toLowerCase();
      if (!s) continue;
      if (!valid.has(s)) {
        unknown.push(part.trim());
      } else if (!scopes.includes(s)) {
        scopes.push(s);
      }
    }
  }
  return { scopes, unknown, validScopes: ['all', ...getRegisteredDomainIds()] };
}
