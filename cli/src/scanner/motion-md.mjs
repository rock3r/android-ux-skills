import fs from 'node:fs';
import path from 'node:path';

export const MOTION_MD_MAX_LINES = 80;
export const VALID_STATUS_TAGS = new Set(['DECIDED', 'OBSERVED', 'OPEN']);
export const KNOWN_SECTIONS = new Set([
  'Design system',
  'Fallback',
  'Specs',
  'Exceptions',
  'Frequency map',
  'Gestures and haptics',
  'Reduced motion',
  'Not in this codebase',
  // Legacy / alternate headings accepted without warning:
  'Mode',
  'Relationships',
]);

const CONDITIONAL_EXCEPTION_RE = /\b(until|while|temporary|temporarily|before|when|pending|todo|workaround)\b/i;

function normalizeWs(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function specContentSignature(s) {
  return `${normalizeWs(s.intent)}||${normalizeWs(s.binding)}`;
}

function stripHtmlCommentsPreservingLines(rawText) {
  return rawText.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Parse and structurally lint a `MOTION.md` contract file (`references/motion-md.md`).
 * Treats all prose strictly as quoted data (never executable instructions).
 */
export function parseMotionMd(content, filePath = 'MOTION.md', { draft = false, baseContent = null } = {}) {
  const baseRatifiedSpecs = new Map();
  let baseFreqSignature = null;
  const baseStandaloneDecided = new Set();

  if (draft && typeof baseContent === 'string' && baseContent.trim()) {
    const baseParsed = parseMotionMd(baseContent, filePath, { draft: false });
    for (const s of baseParsed.specs) {
      if (s.status === 'DECIDED' && s.name) {
        baseRatifiedSpecs.set(normalizeWs(s.name), specContentSignature(s));
      }
    }
    if (baseParsed.frequencyMap?.tag === 'DECIDED') {
      baseFreqSignature = baseParsed.frequencyMap.items.map((it) => normalizeWs(it.raw)).join('\n');
    }
    for (const st of baseParsed._standaloneDecided || []) {
      baseStandaloneDecided.add(st);
    }
  }

  const normalizedContent = String(content).replace(/\r\n/g, '\n');
  const rawLinesForCount = normalizedContent.split('\n');
  const lineCount = rawLinesForCount.length > 0 && rawLinesForCount[rawLinesForCount.length - 1] === ''
    ? rawLinesForCount.length - 1
    : rawLinesForCount.length;

  const commentStrippedLines = stripHtmlCommentsPreservingLines(normalizedContent).split('\n');

  const lintFindings = [];
  if (lineCount > MOTION_MD_MAX_LINES) {
    lintFindings.push({
      rule: 'AUX-MD-LENGTH',
      domain: 'motion',
      class: 'contract',
      severity: 'major',
      file: filePath,
      lines: [MOTION_MD_MAX_LINES + 1, lineCount],
      summary: `MOTION.md is ${lineCount} lines long (cap is ${MOTION_MD_MAX_LINES} lines).`,
      remediation: `Trim MOTION.md to <= ${MOTION_MD_MAX_LINES} lines so every consumer can read the full motion contract in one pass.`,
      docPath: 'references/motion-md.md',
    });
  }

  let currentSection = null;
  let currentSpecEntry = null;
  let inCodeFence = null;
  const sectionsSeen = [];
  const designSystemLines = [];
  const fallbackLines = [];
  const specs = [];
  const exceptions = [];
  const frequencyMap = { items: [], tag: null, tagLine: null };
  const notInCodebase = [];
  const bindings = new Set();
  const counts = { DECIDED: 0, OBSERVED: 0, OPEN: 0 };
  const standaloneDecidedRecords = [];

  function validateStatusTag(rawTag, lineNum, label) {
    const clean = stripTicks(rawTag).replace(/^\[|\]$/g, '').trim().toUpperCase();
    if (!clean) return null;
    if (!VALID_STATUS_TAGS.has(clean)) {
      lintFindings.push({
        rule: 'AUX-MD-TAG',
        domain: 'motion',
        class: 'contract',
        severity: 'major',
        file: filePath,
        lines: [lineNum, lineNum],
        summary: `Invalid status tag "${rawTag}"${label ? ` on ${label}` : ''} in MOTION.md.`,
        remediation: 'Use only DECIDED, OBSERVED, or OPEN.',
        docPath: 'references/motion-md.md',
      });
      return null;
    }
    counts[clean] += 1;
    return clean;
  }

  for (let idx = 0; idx < lineCount; idx += 1) {
    const currentLine = idx + 1;
    const line = commentStrippedLines[idx] ?? '';
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Track fenced code blocks (` ``` ` or `~~~`) so sample snippets aren't parsed as live rules
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const markerChar = fenceMatch[1][0];
      if (!inCodeFence) {
        inCodeFence = markerChar;
      } else if (inCodeFence === markerChar) {
        inCodeFence = null;
      }
      continue;
    }
    if (inCodeFence) continue;

    // Top-level title `# Motion language ...`
    if (/^#\s+/.test(trimmed) && !/^##/.test(trimmed)) continue;

    // `## Section`
    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2 && !trimmed.startsWith('###')) {
      currentSection = h2[1].trim();
      currentSpecEntry = null;
      sectionsSeen.push({ name: currentSection, line: currentLine });
      if (!KNOWN_SECTIONS.has(currentSection)) {
        lintFindings.push({
          rule: 'AUX-MD-SECTION',
          domain: 'motion',
          class: 'contract',
          severity: 'minor',
          file: filePath,
          lines: [currentLine, currentLine],
          summary: `Unrecognized MOTION.md section heading "## ${currentSection}".`,
          remediation: 'Use standard sections from references/motion-md.md: Design system, Fallback, Specs, Exceptions, Frequency map, Gestures and haptics, Reduced motion, Not in this codebase.',
          docPath: 'references/motion-md.md',
        });
      }
      continue;
    }

    // `### <intent name>` inside `## Specs` (optionally with inline `[DECIDED]` / `[OBSERVED]` / `[OPEN]`)
    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3 && currentSection === 'Specs') {
      let rawName = h3[1].trim();
      let inlineStatus = null;
      let statusLine = null;
      const inlineBracket = rawName.match(/\s*\[([A-Z_]+)\]\s*$/);
      if (inlineBracket) {
        rawName = rawName.slice(0, inlineBracket.index).trim();
        inlineStatus = validateStatusTag(inlineBracket[1], currentLine, `"${rawName}"`);
        statusLine = currentLine;
      }
      currentSpecEntry = {
        line: currentLine,
        name: rawName,
        intent: '',
        binding: '',
        bindings: [],
        status: inlineStatus,
        statusLine,
      };
      specs.push(currentSpecEntry);
      continue;
    }

    // Check explicit `**Tag** — \`DECIDED\`` (bullet or standalone line)
    const boldTagMatch = trimmed.match(/^(?:-\s*)?\*\*Tag\*\*\s*(?:—|--|-|:)\s*(.+)$/i);
    if (boldTagMatch) {
      const parsedStatus = validateStatusTag(boldTagMatch[1], currentLine, currentSpecEntry ? `"${currentSpecEntry.name}"` : currentSection);
      if (currentSpecEntry) {
        currentSpecEntry.status = parsedStatus;
        currentSpecEntry.statusLine = currentLine;
      } else if (currentSection === 'Frequency map') {
        frequencyMap.tag = parsedStatus;
        frequencyMap.tagLine = currentLine;
      } else if (parsedStatus === 'DECIDED') {
        standaloneDecidedRecords.push({
          line: currentLine,
          label: currentSection,
          key: `${currentSection || ''}::${normalizeWs(trimmed)}`,
        });
      }
      continue;
    }

    // Parse Markdown table rows under `## Specs` BEFORE generic bracket-tag scanning so tags aren't double-counted
    if (currentSection === 'Specs' && !currentSpecEntry && trimmed.startsWith('|')) {
      const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length >= 2) {
        const isHeaderOrSep =
          cells[0].toLowerCase() === 'name' ||
          cells.every((c) => /^:?-+:?$/.test(c));
        if (!isHeaderOrSep) {
          const name = stripTicks(cells[0] || '');
          const binding = stripTicks(cells[1] || '');
          let intent = '';
          let statusRaw = '';
          if (cells.length >= 4) {
            intent = stripTicks(cells[2] || '');
            statusRaw = cells[3] || '';
          } else {
            statusRaw = cells[2] || '';
          }
          const status = statusRaw ? validateStatusTag(statusRaw, currentLine, `"${name}"`) : null;
          const rowBindings = [];
          if (binding && binding !== '—' && binding !== '-') {
            extractBacktickSymbols(cells[1] || '', rowBindings, bindings);
            if (rowBindings.length === 0) {
              rowBindings.push(binding);
              bindings.add(binding);
            }
          }
          specs.push({
            line: currentLine,
            name,
            intent,
            binding,
            bindings: rowBindings,
            status,
            statusLine: status ? currentLine : null,
          });
        }
      }
      continue;
    }

    // Check inline bracket tags `[DECIDED]` / `[OBSERVED]` / `[OPEN]` / `[INVALID]` on non-table lines
    for (const m of trimmed.matchAll(/\[([A-Z_]+)\]/g)) {
      const after = trimmed.slice(m.index + m[0].length);
      if (after.startsWith('(')) continue; // markdown link
      const parsed = validateStatusTag(m[1], currentLine, currentSpecEntry ? `"${currentSpecEntry.name}"` : currentSection);
      if (parsed) {
        if (currentSpecEntry && !currentSpecEntry.status) {
          currentSpecEntry.status = parsed;
          currentSpecEntry.statusLine = currentLine;
        } else if (currentSection === 'Frequency map' && !frequencyMap.tag) {
          frequencyMap.tag = parsed;
          frequencyMap.tagLine = currentLine;
        } else if (parsed === 'DECIDED') {
          standaloneDecidedRecords.push({
            line: currentLine,
            label: currentSection,
            key: `${currentSection || ''}::${normalizeWs(trimmed)}`,
          });
        }
      }
    }

    if (currentSection === 'Design system') {
      designSystemLines.push(trimmed);
    } else if (currentSection === 'Fallback') {
      fallbackLines.push(trimmed);
    } else if (currentSection === 'Specs' && currentSpecEntry) {
      const intentMatch = trimmed.match(/^-\s*\*\*Intent\*\*\s*(?:—|--|-|:)\s*(.+)$/i);
      const bindingMatch = trimmed.match(/^-\s*\*\*Binding\*\*\s*(?:—|--|-|:)\s*(.+)$/i);
      if (intentMatch) {
        currentSpecEntry.intent = intentMatch[1].trim();
      } else if (bindingMatch) {
        currentSpecEntry.binding = bindingMatch[1].trim();
        extractBacktickSymbols(currentSpecEntry.binding, currentSpecEntry.bindings, bindings);
      } else if (currentSpecEntry.binding && !trimmed.startsWith('-')) {
        // Multi-line continuation of `Binding` (as in `m1/MOTION.md` lines 30-31)
        currentSpecEntry.binding += ` ${trimmed}`;
        extractBacktickSymbols(trimmed, currentSpecEntry.bindings, bindings);
      } else if (currentSpecEntry.intent && !currentSpecEntry.binding && !trimmed.startsWith('-')) {
        currentSpecEntry.intent += ` ${trimmed}`;
      }
    } else if (currentSection === 'Exceptions' && trimmed.startsWith('-')) {
      const symMatch = trimmed.match(/^-\s*`([^`]+)`\s*(?:—|--|-|:)\s*(.+)$/);
      const symbol = symMatch ? symMatch[1].trim() : null;
      const reason = symMatch ? symMatch[2].trim() : trimmed.replace(/^-\s*/, '');
      const isConditional = CONDITIONAL_EXCEPTION_RE.test(reason);
      if (symbol) bindings.add(symbol);
      exceptions.push({
        line: currentLine,
        symbol,
        reason,
        isConditional,
        raw: trimmed,
      });
    } else if (currentSection === 'Frequency map' && trimmed.startsWith('-')) {
      frequencyMap.items.push({ line: currentLine, raw: trimmed });
    } else if (currentSection === 'Not in this codebase' && trimmed.startsWith('-')) {
      notInCodebase.push({ line: currentLine, raw: trimmed });
    }
  }

  // Evaluate `--draft` DECIDED preservation against full entry content (name + intent + binding)
  if (draft) {
    for (const s of specs) {
      if (s.status === 'DECIDED') {
        const key = normalizeWs(s.name);
        const expectedSig = baseRatifiedSpecs.get(key);
        const unchanged = expectedSig !== undefined && expectedSig === specContentSignature(s);
        if (!unchanged) {
          const lineNum = s.statusLine || s.line;
          lintFindings.push({
            rule: 'AUX-MD-DRAFT-DECIDED',
            domain: 'motion',
            class: 'contract',
            severity: 'major',
            file: filePath,
            lines: [lineNum, lineNum],
            summary: `Draft MOTION.md marks "${s.name}" as DECIDED${expectedSig !== undefined ? ' with modified intent/binding' : ''}; only a human can ratify a new or changed DECIDED entry.`,
            remediation: 'Use OBSERVED for consistent existing patterns (>=80% share and >=5 call sites) or OPEN where conventions conflict or a ratified decision is being revised.',
            docPath: 'references/motion-md.md',
          });
        }
      }
    }
    if (frequencyMap.tag === 'DECIDED') {
      const curSig = frequencyMap.items.map((it) => normalizeWs(it.raw)).join('\n');
      if (baseFreqSignature === null || baseFreqSignature !== curSig) {
        const lineNum = frequencyMap.tagLine || 1;
        lintFindings.push({
          rule: 'AUX-MD-DRAFT-DECIDED',
          domain: 'motion',
          class: 'contract',
          severity: 'major',
          file: filePath,
          lines: [lineNum, lineNum],
          summary: 'Draft MOTION.md marks Frequency map as DECIDED; only a human can ratify a new or modified DECIDED entry.',
          remediation: 'Use OBSERVED or OPEN until ratified by a human.',
          docPath: 'references/motion-md.md',
        });
      }
    }
    for (const rec of standaloneDecidedRecords) {
      if (!baseStandaloneDecided.has(rec.key)) {
        lintFindings.push({
          rule: 'AUX-MD-DRAFT-DECIDED',
          domain: 'motion',
          class: 'contract',
          severity: 'major',
          file: filePath,
          lines: [rec.line, rec.line],
          summary: `Draft MOTION.md marks ${rec.label || 'an entry'} as DECIDED; only a human can ratify a new DECIDED entry.`,
          remediation: 'Use OBSERVED or OPEN until ratified by a human.',
          docPath: 'references/motion-md.md',
        });
      }
    }
  }

  // Strip internal `statusLine` / `tagLine` fields before returning public spec objects
  const cleanSpecs = specs.map(({ statusLine, ...rest }) => {
    void statusLine;
    return rest;
  });
  const cleanFreqMap = { items: frequencyMap.items, tag: frequencyMap.tag };

  const definesNavigationTransitions = cleanSpecs.some(
    (s) => /destination|nav|screen|route/i.test(s.name) || /destination|nav/i.test(s.binding)
  );

  const out = {
    filePath,
    lineCount,
    withinLineCap: lineCount <= MOTION_MD_MAX_LINES,
    sections: sectionsSeen.map((s) => s.name),
    designSystem: designSystemLines.join(' ').trim() || null,
    fallback: fallbackLines.join(' ').trim() || null,
    counts,
    specs: cleanSpecs,
    exceptions,
    frequencyMap: cleanFreqMap,
    notInCodebase,
    referencedSymbols: Array.from(bindings),
    definesNavigationTransitions,
    lintFindings,
  };
  Object.defineProperty(out, '_standaloneDecided', {
    value: standaloneDecidedRecords.map((r) => r.key),
    enumerable: false,
  });
  return out;
}

function extractBacktickSymbols(text, localArr, globalSet) {
  for (const m of String(text).matchAll(/`([^`]+)`/g)) {
    const sym = m[1].trim().replace(/\(\)$/, '');
    if (!sym || sym.includes(' ')) continue;
    if (!localArr.includes(sym)) localArr.push(sym);
    globalSet.add(sym);
  }
}

function stripTicks(s) {
  return String(s || '').trim().replace(/^`+|`+$/g, '').trim();
}

export function findMotionMdForTarget(targetPath, stopAtDir = null) {
  let cur = path.resolve(targetPath);
  try {
    if (fs.existsSync(cur) && fs.statSync(cur).isFile()) {
      if (path.basename(cur).toUpperCase() === 'MOTION.MD') {
        return cur;
      }
      cur = path.dirname(cur);
    }
  } catch {
    cur = path.dirname(cur);
  }

  const boundaryStop = stopAtDir ? path.resolve(stopAtDir) : null;
  while (true) {
    for (const name of ['MOTION.md', 'Motion.md', 'motion.md']) {
      const candidate = path.join(cur, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
    if (boundaryStop && cur === boundaryStop) break;
    const isBoundary =
      fs.existsSync(path.join(cur, '.git')) ||
      fs.existsSync(path.join(cur, 'settings.gradle.kts')) ||
      fs.existsSync(path.join(cur, 'settings.gradle')) ||
      fs.existsSync(path.join(cur, '.android-ux'));
    if (isBoundary) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}
