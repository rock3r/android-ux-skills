import path from 'node:path';
import { getCallArg, matchInlineIgnore } from '../../scanner/kotlin-scanner.mjs';
import { MOTION_RULE_BY_ID, MOTION_RULE_CATALOG } from './catalog.mjs';

const FRAME_STATE_FACTORIES = new Set([
  'animateDpAsState',
  'animateFloatAsState',
  'animateIntOffsetAsState',
  'animateOffsetAsState',
  'animateSizeAsState',
  'animateIntAsState',
  'animateRectAsState',
  'animateValueAsState',
]);

const TRANSITION_FRAME_METHODS = new Set([
  'animateDp',
  'animateFloat',
  'animateIntOffset',
  'animateOffset',
  'animateSize',
  'animateInt',
  'animateRect',
  'animateValue',
]);

const DRAW_OR_LAYOUT_SCOPES = new Set([
  'drawBehind',
  'drawWithContent',
  'drawWithCache',
  'onDrawBehind',
  'onDrawWithContent',
  'Canvas',
  'layout',
]);

const VALUE_MODIFIER_NAMES = new Set([
  'offset',
  'absoluteOffset',
  'alpha',
  'scale',
  'rotate',
  'graphicsLayer',
]);

const LAYOUT_SIZE_MODIFIER_NAMES = new Set([
  'padding',
  'paddingFromBaseline',
  'size',
  'sizeIn',
  'width',
  'widthIn',
  'height',
  'heightIn',
  'requiredSize',
  'requiredWidth',
  'requiredHeight',
]);

const SPEC_LITERAL_NAMES = new Set(['tween', 'spring', 'keyframes']);

const ANIMATION_CONSUMER_CALLS = new Set([
  'animateDpAsState',
  'animateFloatAsState',
  'animateColorAsState',
  'animateIntOffsetAsState',
  'animateOffsetAsState',
  'animateSizeAsState',
  'animateIntAsState',
  'animateRectAsState',
  'animateValueAsState',
  'animateDp',
  'animateFloat',
  'animateColor',
  'animateIntOffset',
  'animateOffset',
  'animateTo',
  'animateDecay',
  'fadeIn',
  'fadeOut',
  'slideIn',
  'slideOut',
  'slideInHorizontally',
  'slideOutHorizontally',
  'slideInVertically',
  'slideOutVertically',
  'slideIntoContainer',
  'slideOutOfContainer',
  'scaleIn',
  'scaleOut',
  'expandIn',
  'shrinkOut',
  'expandHorizontally',
  'shrinkHorizontally',
  'expandVertically',
  'shrinkVertically',
  'togetherWith',
  'AnimatedVisibility',
  'AnimatedContent',
  'Crossfade',
  'NavHost',
  'NavDisplay',
  'composable',
  'animateContentSize',
  'animateItem',
  'repeatable',
  'infiniteRepeatable',
]);

const VIEW_BACKED_CONTAINERS = new Set([
  'Dialog',
  'AlertDialog',
  'BasicAlertDialog',
  'ModalBottomSheet',
  'Popup',
  'AndroidView',
]);

const DURATION_SCALE_IDENTIFIERS = new Set([
  'MotionDurationScale',
  'ANIMATOR_DURATION_SCALE',
  'areAnimatorsEnabled',
  'getDurationScale',
]);

const ELEVATED_CONTAINERS = new Set(['Card', 'ElevatedCard', 'OutlinedCard', 'Surface']);

/**
 * Run all `motion` domain static checks across parsed Kotlin files, Lottie JSON assets,
 * and `MOTION.md` contracts.
 */
export function runMotionDomainChecks({
  kotlinFiles = [],
  lottieFiles = [],
  motionContracts = [],
  inlineIgnoresEnabled = true,
  collectStats = false,
}) {
  const rawFindings = [];
  const rawCandidates = [];
  const inlineSuppressed = [];

  // Determine convention signals from the scanned file set + MOTION.md for taste severity auto-grading
  const conventionContext = computeProjectConventions(kotlinFiles, motionContracts);

  // 1. Contract structural lint (`MOTION.md` -> emitted in `contractDiagnostics[]`, never mixed into `findings[]`)
  const contractDiagnostics = [];
  for (const contract of motionContracts) {
    for (const lf of contract.lintFindings || []) {
      contractDiagnostics.push({
        code: lf.rule,
        domain: 'motion',
        class: lf.class || 'contract',
        severity: lf.severity || 'major',
        file: contract.filePath,
        lines: lf.lines,
        title: lf.summary,
        summary: lf.summary,
        evidence: `Line ${lf.lines[0]}`,
        remediation: lf.remediation,
        docPath: lf.docPath || 'references/motion-md.md',
      });
    }
  }

  // 2. Kotlin static checks (collect scale-reading helpers across all scanned Kotlin files)
  const scaleHelpers = new Set();
  for (const kf of kotlinFiles) {
    if (!kf.lexError) {
      for (const h of findScaleReadingHelpers(kf)) scaleHelpers.add(h);
    }
  }

  const lottieConsumers = [];
  for (const kf of kotlinFiles) {
    if (kf.lexError) {
      // Syntax/unclosed comment: abstain per scanner contract
      continue;
    }

    const fileMotionMd = selectNearestMotionContract(kf.filePath, motionContracts);

    checkF001AndF008(kf, rawFindings, rawCandidates);
    checkF003AndT021(kf, conventionContext, rawFindings, rawCandidates);
    checkF005(kf, scaleHelpers, rawFindings, rawCandidates);
    checkF006(kf, rawFindings, rawCandidates);
    checkT001(kf, conventionContext, fileMotionMd, rawFindings, rawCandidates);
    checkT002(kf, conventionContext, fileMotionMd, rawFindings);
    checkCandidatesMisc(kf, rawCandidates);
    collectLottieConsumers(kf, scaleHelpers, lottieConsumers);
  }

  // 3. Lottie `.json` + consumer cross-reference (`O-002`)
  checkO002(lottieFiles, lottieConsumers, rawFindings, rawCandidates);

  // 4. Apply `MOTION.md` project exception & `DECIDED` override stage on overridable `taste` findings
  const afterExceptionsFindings = [];
  const contractSuppressed = [];

  for (const f of rawFindings) {
    const meta = MOTION_RULE_BY_ID.get(f.rule);
    if (meta && meta.class === 'taste' && meta.overridable) {
      const fileMotionMd = selectNearestMotionContract(f.file, motionContracts);
      const matchingDecided = findMatchingDecidedOverride(fileMotionMd, f.rule, f.symbolContext);
      if (matchingDecided) {
        rawCandidates.push({
          ...f,
          kind: 'candidate',
          reasonCode: 'motion-md-override-unverifiable',
          verificationHint: `MOTION.md (${path.basename(fileMotionMd.filePath)}:${matchingDecided.line}) has a DECIDED entry ("${matchingDecided.name}") referencing ${f.rule} or a bound symbol; confirm whether this call site implements or contradicts that DECIDED contract.`,
        });
        continue;
      }
      if (f.symbolContext) {
        const matchingExc = findMatchingException(fileMotionMd, f.symbolContext, f.rule);
        if (matchingExc) {
          if (matchingExc.isConditional) {
            rawCandidates.push({
              ...f,
              kind: 'candidate',
              reasonCode: 'conditional-motion-md-exception',
              exception: {
                symbol: matchingExc.symbol,
                reason: matchingExc.reason,
                line: matchingExc.line,
                file: fileMotionMd.filePath,
              },
              verificationHint: `MOTION.md (${path.basename(fileMotionMd.filePath)}:${matchingExc.line}) records a conditional exception on \`${matchingExc.symbol || f.rule}\` ("${matchingExc.reason}"). Check surrounding code to determine whether the stated condition still holds.`,
            });
            continue;
          }
          contractSuppressed.push({
            ...f,
            suppressedBy: 'MOTION.md',
            suppressionReason: matchingExc.reason,
            suppressionFile: fileMotionMd.filePath,
            suppressionLine: matchingExc.line,
          });
          continue;
        }
      }
    }
    afterExceptionsFindings.push(f);
  }

  // 5. Apply inline `android-ux-disable*` comments (when enabled)
  const kfByPath = new Map(kotlinFiles.map((k) => [k.filePath, k]));
  const finalFindings = [];
  for (const f of afterExceptionsFindings) {
    if (inlineIgnoresEnabled) {
      const kf = kfByPath.get(f.file);
      if (kf) {
        const allowFileMode = Boolean(MOTION_RULE_BY_ID.get(f.rule)?.overridable);
        const hit = matchInlineIgnore(kf.inlineIgnores, f.rule, f.lines[0], f.lines[1], { allowFileMode });
        if (hit) {
          inlineSuppressed.push({
            ...f,
            suppressedBy: 'inline-comment',
            suppressionReason: hit.reason,
            suppressionLine: hit.commentLine,
          });
          continue;
        }
      }
    }
    finalFindings.push(stripInternalFields(f));
  }

  const finalCandidates = [];
  for (const c of rawCandidates) {
    if (inlineIgnoresEnabled) {
      const kf = kfByPath.get(c.file);
      if (kf) {
        const allowFileMode = Boolean(MOTION_RULE_BY_ID.get(c.rule)?.overridable);
        const hit = matchInlineIgnore(kf.inlineIgnores, c.rule, c.lines[0], c.lines[1], { allowFileMode });
        if (hit) {
          inlineSuppressed.push({
            ...c,
            suppressedBy: 'inline-comment',
            suppressionReason: hit.reason,
            suppressionLine: hit.commentLine,
          });
          continue;
        }
      }
    }
    finalCandidates.push(stripInternalFields(c));
  }

  const stats = collectStats ? buildMotionStats(kotlinFiles, motionContracts) : null;

  return {
    findings: finalFindings,
    candidates: finalCandidates,
    contractDiagnostics,
    suppressed: [...contractSuppressed.map(stripInternalFields), ...inlineSuppressed.map(stripInternalFields)],
    rawPreWaiverItems: [...afterExceptionsFindings.map(stripInternalFields), ...rawCandidates.map(stripInternalFields)],
    stats,
  };
}

function stripInternalFields(item) {
  const clone = { ...item };
  delete clone.symbolContext;
  return clone;
}

function selectNearestMotionContract(filePath, motionContracts) {
  if (!motionContracts || motionContracts.length === 0) return null;
  const absFile = path.resolve(filePath);
  let best = null;
  let bestLen = -1;
  for (const mc of motionContracts) {
    const dir = path.dirname(path.resolve(mc.filePath));
    if (absFile === dir || absFile.startsWith(dir + path.sep)) {
      if (dir.length > bestLen) {
        best = mc;
        bestLen = dir.length;
      }
    }
  }
  return best;
}

function findMatchingException(motionMd, symbolNames, ruleId = null) {
  if (!motionMd || !Array.isArray(motionMd.exceptions)) return null;
  const syms = Array.isArray(symbolNames) ? symbolNames : [];
  for (const exc of motionMd.exceptions) {
    if (exc.symbol) {
      const shortSym = exc.symbol.split('.').pop();
      if (!syms.includes(exc.symbol) && !syms.includes(shortSym)) {
        continue;
      }
      // If the exception explicitly names rule IDs, ensure either none are named or `ruleId` is named
      const mentionedRules = [...String(exc.raw || '').toUpperCase().matchAll(/\b([FTOM]-\d{3})\b/g)].map((m) => m[1]);
      if (mentionedRules.length > 0 && ruleId && !mentionedRules.includes(ruleId)) {
        continue;
      }
      return exc;
    }
    if (ruleId && exc.raw && new RegExp(`\\b${ruleId}\\b`, 'i').test(exc.raw)) {
      return exc;
    }
  }
  return null;
}

function findMatchingDecidedOverride(motionMd, ruleId, symbolNames) {
  if (!motionMd || !Array.isArray(motionMd.specs)) return null;
  const syms = Array.isArray(symbolNames) ? symbolNames : [];
  for (const spec of motionMd.specs) {
    if (spec.status !== 'DECIDED') continue;
    if (Array.isArray(spec.bindings) && spec.bindings.length > 0) {
      if (syms.length === 0) continue;
      const bindsSym = spec.bindings.some((b) => {
        const shortB = b.split('.').pop();
        return syms.includes(b) || syms.includes(shortB);
      });
      if (bindsSym) return spec;
      continue;
    }
    const text = `${spec.name || ''} ${spec.intent || ''} ${spec.binding || ''}`;
    if (ruleId && new RegExp(`\\b${ruleId}\\b`, 'i').test(text)) {
      return spec;
    }
  }
  return null;
}

const MOTION_TOKEN_HOLDER_NAME_RE = /(?:Motion(?:Tokens|Specs|Scheme|Defaults)|[A-Z][A-Za-z0-9]*Motion)$/;

function computeProjectConventions(kotlinFiles, motionContracts) {
  let usesMotionScheme = false;
  let usesTokenObject = false;
  let usesIdentityListKeys = false;

  for (const kf of kotlinFiles) {
    if (kf.lexError) continue;
    for (const t of kf.tokens) {
      if (t.type === 'Identifier' && t.value === 'motionScheme') {
        usesMotionScheme = true;
      }
    }
    for (const d of kf.declarations) {
      if ((d.kind === 'object' || d.kind === 'class') && MOTION_TOKEN_HOLDER_NAME_RE.test(d.name)) {
        usesTokenObject = true;
      }
    }
    for (const c of kf.calls) {
      if (SPEC_LITERAL_NAMES.has(c.name) && c.hasParens && isExemptSpecDefinitionSite(kf, c)) {
        usesTokenObject = true;
      }
      if (c.receiver && MOTION_TOKEN_HOLDER_NAME_RE.test(c.receiver)) {
        usesTokenObject = true;
      }
      if ((c.name === 'items' || c.name === 'itemsIndexed') && c.trailingLambda) {
        const keyArg = getCallArg(c, 'key', 1);
        if (keyArg && /\.\s*(id|key|uuid|code|isbn|slug)\b/i.test(keyArg.text)) {
          usesIdentityListKeys = true;
        }
      }
    }
  }

  const hasMotionMdSpecs = motionContracts.some(
    (m) => (m.specs && m.specs.length > 0) || m.definesNavigationTransitions
  );

  return {
    usesMotionScheme,
    usesTokenObject,
    hasMotionTokens: usesMotionScheme || usesTokenObject || hasMotionMdSpecs,
    usesIdentityListKeys,
    hasMotionMdSpecs,
  };
}

function makeRuleFinding(ruleId, {
  file,
  lines,
  severity = null,
  severityBasis = null,
  evidence,
  remediation,
  alsoAt = null,
  symbolContext = null,
}) {
  const meta = MOTION_RULE_BY_ID.get(ruleId);
  const out = {
    rule: ruleId,
    domain: 'motion',
    class: meta.class,
    severity: severity || meta.defaultSeverity,
    tier: meta.hookTier || 'deferred',
    file,
    lines,
    title: meta.title,
    summary: meta.description,
    evidence,
    remediation,
    docPath: 'references/standards.md',
  };
  if (severityBasis) out.severityBasis = severityBasis;
  if (alsoAt && alsoAt.length > 0) out.alsoAt = alsoAt;
  if (symbolContext) out.symbolContext = symbolContext;
  return out;
}

function makeRuleCandidate(ruleId, {
  file,
  lines,
  severity = null,
  evidence,
  verificationHint,
}) {
  const meta = MOTION_RULE_BY_ID.get(ruleId);
  return {
    kind: 'candidate',
    rule: ruleId,
    domain: 'motion',
    class: meta.class,
    severity: severity || meta.defaultSeverity,
    file,
    lines,
    title: meta.title,
    summary: meta.description,
    evidence,
    verificationHint,
    docPath: 'references/standards.md',
  };
}

function isInsidePhaseLambda(call, tokens) {
  const callStart = tokens[call.nameTokIdx]?.start ?? -1;
  const callEnd = tokens[call.endTokIdx]?.end ?? -1;

  for (const enc of call.enclosingCalls) {
    const isPhaseCall =
      DRAW_OR_LAYOUT_SCOPES.has(enc.name) ||
      enc.name === 'offset' ||
      enc.name === 'absoluteOffset' ||
      enc.name === 'graphicsLayer';
    if (!isPhaseCall) continue;

    if (enc.trailingLambda && call.nameTokIdx > enc.trailingLambda.openBraceIdx && call.endTokIdx < enc.trailingLambda.closeBraceIdx) {
      return true;
    }
    // Also check named/positional lambda args like `Modifier.graphicsLayer(block = { ... })` or `Modifier.offset(offset = { ... })`
    if (Array.isArray(enc.args)) {
      for (const arg of enc.args) {
        if (arg.tokens.length >= 2 && arg.tokens[0].value === '{' && arg.tokens[arg.tokens.length - 1].value === '}') {
          if (callStart > arg.tokens[0].start && callEnd < arg.tokens[arg.tokens.length - 1].end) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function findEnclosingBraceScope(tokens, declTokIdx, fnStartIdx, fnEndIdx) {
  let depth = 0;
  let openIdx = fnStartIdx;
  for (let i = declTokIdx - 1; i >= fnStartIdx; i -= 1) {
    const t = tokens[i];
    if (t.type === 'Punct') {
      if (t.value === '}') depth += 1;
      else if (t.value === '{') {
        if (depth === 0) {
          openIdx = i;
          break;
        }
        depth -= 1;
      }
    }
  }
  const closeIdx = tokens[openIdx]?.value === '{'
    ? findMatchingForward(tokens, openIdx, '{', '}')
    : fnEndIdx;
  return [openIdx, closeIdx !== -1 ? closeIdx : fnEndIdx];
}

function resolveScopedBinding(varName, atTokIdx, scopedBindings) {
  let best = null;
  for (const b of scopedBindings) {
    if (b.name !== varName) continue;
    if (atTokIdx <= b.declEndIdx || atTokIdx > b.scopeEndIdx || atTokIdx < b.scopeStartIdx) continue;
    if (
      !best ||
      b.scopeStartIdx > best.scopeStartIdx ||
      (b.scopeStartIdx === best.scopeStartIdx && b.declEndIdx >= best.declEndIdx)
    ) {
      best = b;
    }
  }
  return best;
}

function resolveScopedLocalKind(varName, atTokIdx, scopedBindings) {
  const best = resolveScopedBinding(varName, atTokIdx, scopedBindings);
  return best ? best.kind : null;
}

function findMatchingBackward(tokens, closeIdx, openSym, closeSym) {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i -= 1) {
    const t = tokens[i];
    if (t.type === 'Punct') {
      if (t.value === closeSym) depth += 1;
      else if (t.value === openSym) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

function parseDestructuringParamNames(tokens, startIdx, closeParenIdx) {
  const names = [];
  let cursor = startIdx;
  while (cursor < closeParenIdx) {
    while (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '@') {
      cursor += 1;
      while (cursor < closeParenIdx && (tokens[cursor]?.type === 'Identifier' || tokens[cursor]?.value === '.')) {
        cursor += 1;
      }
      if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '(') {
        const closeAnn = findMatchingForward(tokens, cursor, '(', ')');
        if (closeAnn === -1 || closeAnn >= closeParenIdx) return null;
        cursor = closeAnn + 1;
      }
    }
    if (tokens[cursor]?.type !== 'Identifier') return null;
    if (tokens[cursor].value !== '_') {
      names.push(tokens[cursor].value);
    }
    cursor += 1;

    if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === ':') {
      cursor = skipKotlinTypeInLambdaParam(tokens, cursor + 1, closeParenIdx);
      if (cursor === -1) return null;
    }
    if (cursor === closeParenIdx) break;
    if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === ',') {
      cursor += 1;
      if (cursor === closeParenIdx) break;
      continue;
    }
    return null;
  }
  return names;
}

function skipKotlinTypeInLambdaParam(tokens, startIdx, limitIdx) {
  let cursor = startIdx;
  while (cursor < limitIdx) {
    if (tokens[cursor]?.value === 'suspend') {
      cursor += 1;
    }
    let wasParenGroup = false;
    if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '(') {
      const closeP = findMatchingForward(tokens, cursor, '(', ')');
      if (closeP === -1 || closeP >= limitIdx) return -1;
      cursor = closeP + 1;
      wasParenGroup = true;
    } else if (tokens[cursor]?.type === 'Identifier') {
      cursor += 1;
      while (cursor < limitIdx) {
        if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '.' && tokens[cursor + 1]?.type === 'Identifier') {
          cursor += 2;
        } else if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '<') {
          const closeAngle = findMatchingForward(tokens, cursor, '<', '>');
          if (closeAngle === -1 || closeAngle >= limitIdx) return -1;
          cursor = closeAngle + 1;
        } else {
          break;
        }
      }
      // Receiver function type `Scope.(Int) -> Unit`
      if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '.' && tokens[cursor + 1]?.value === '(') {
        const closeRecvP = findMatchingForward(tokens, cursor + 1, '(', ')');
        if (closeRecvP === -1 || closeRecvP >= limitIdx) return -1;
        cursor = closeRecvP + 1;
        wasParenGroup = true;
      }
    } else {
      return -1;
    }

    if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '?') {
      cursor += 1;
    }

    // Only consume `->` as part of a function type `(A) -> B` if the preceding atom was a `( ... )` parameter type list!
    if (wasParenGroup && tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '->') {
      cursor += 1;
      continue;
    }
    return cursor;
  }
  return -1;
}

function isNonLambdaBraceBlock(tokens, openBraceIdx, declBodyBraces) {
  if (declBodyBraces.has(openBraceIdx)) return true;
  const prev = tokens[openBraceIdx - 1];
  if (!prev) return true;
  if (
    prev.type === 'Keyword' &&
    (prev.value === 'when' || prev.value === 'try' || prev.value === 'else' || prev.value === 'finally' || prev.value === 'do')
  ) {
    return true;
  }
  if (prev.type === 'Punct' && prev.value === ')') {
    const openParen = findMatchingBackward(tokens, openBraceIdx - 1, '(', ')');
    if (openParen !== -1) {
      const beforeParen = tokens[openParen - 1];
      if (
        beforeParen?.type === 'Keyword' &&
        (beforeParen.value === 'when' ||
          beforeParen.value === 'if' ||
          beforeParen.value === 'for' ||
          beforeParen.value === 'while' ||
          beforeParen.value === 'catch')
      ) {
        return true;
      }
    }
  }
  return false;
}

function parseLambdaHeaderParams(tokens, openBraceIdx, closeBraceIdx) {
  let cursor = openBraceIdx + 1;
  if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '->') {
    return { arrowIdx: cursor, names: [] };
  }
  const names = [];
  while (cursor < closeBraceIdx) {
    while (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '@') {
      cursor += 1;
      while (cursor < closeBraceIdx && (tokens[cursor]?.type === 'Identifier' || tokens[cursor]?.value === '.')) {
        cursor += 1;
      }
      if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '(') {
        const closeAnn = findMatchingForward(tokens, cursor, '(', ')');
        if (closeAnn === -1 || closeAnn >= closeBraceIdx) return null;
        cursor = closeAnn + 1;
      }
    }

    if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '(') {
      const closeDestruct = findMatchingForward(tokens, cursor, '(', ')');
      if (closeDestruct === -1 || closeDestruct >= closeBraceIdx) return null;
      const inner = parseDestructuringParamNames(tokens, cursor + 1, closeDestruct);
      if (!inner) return null;
      names.push(...inner);
      cursor = closeDestruct + 1;
    } else if (tokens[cursor]?.type === 'Identifier') {
      if (tokens[cursor].value !== '_') {
        names.push(tokens[cursor].value);
      }
      cursor += 1;
    } else {
      return null;
    }

    if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === ':') {
      cursor = skipKotlinTypeInLambdaParam(tokens, cursor + 1, closeBraceIdx);
      if (cursor === -1) return null;
    }

    if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === ',') {
      cursor += 1;
      if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '->') {
        return { arrowIdx: cursor, names };
      }
      continue;
    }
    if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '->') {
      return { arrowIdx: cursor, names };
    }
    return null;
  }
  return null;
}

function collectShadowingScopeBindings(tokens, declarations, fn, scopedBindings) {
  const declBodyBraces = new Set();
  for (const d of declarations) {
    if (d.startTokIdx >= fn.startTokIdx && d.endTokIdx <= fn.endTokIdx) {
      if (tokens[d.endTokIdx]?.value === '}') {
        const openB = findMatchingBackward(tokens, d.endTokIdx, '{', '}');
        if (openB !== -1) declBodyBraces.add(openB);
      }
      // Nested local `fun` parameters shadow outer animated bindings inside that nested `fun`
      if (d.kind === 'fun' && d !== fn && d.paramRange) {
        const paramSlice = tokens.slice(d.paramRange[0] + 1, d.paramRange[1]);
        let pDepth = 0;
        for (let i = 0; i < paramSlice.length; i += 1) {
          const pt = paramSlice[i];
          if (pt.type === 'Punct' && (pt.value === '(' || pt.value === '<')) pDepth += 1;
          else if (pt.type === 'Punct' && (pt.value === ')' || pt.value === '>')) pDepth = Math.max(0, pDepth - 1);
          else if (pDepth === 0 && pt.type === 'Identifier' && paramSlice[i + 1]?.value === ':') {
            scopedBindings.push({
              name: pt.value,
              kind: 'other',
              declStartIdx: d.paramRange[0],
              declEndIdx: d.paramRange[1],
              rhsStartIdx: -1,
              scopeStartIdx: d.startTokIdx,
              scopeEndIdx: d.endTokIdx,
            });
          }
        }
      }
    }
  }

  for (let i = fn.startTokIdx + 1; i <= fn.endTokIdx; i += 1) {
    const t = tokens[i];

    // 1. Lambda parameters `{ x -> ... }`, `{ (x, y) -> ... }`, `{ x: Float -> ... }`
    if (t.type === 'Punct' && t.value === '{' && !isNonLambdaBraceBlock(tokens, i, declBodyBraces)) {
      const closeBrace = findMatchingForward(tokens, i, '{', '}');
      if (closeBrace !== -1 && closeBrace <= fn.endTokIdx) {
        const header = parseLambdaHeaderParams(tokens, i, closeBrace);
        if (header && header.names.length > 0) {
          for (const name of header.names) {
            scopedBindings.push({
              name,
              kind: 'other',
              declStartIdx: header.arrowIdx,
              declEndIdx: header.arrowIdx,
              rhsStartIdx: -1,
              scopeStartIdx: i,
              scopeEndIdx: closeBrace,
            });
          }
        }
      }
      continue;
    }

    // 2. Destructured `val (a, b) = ...` / `var (a, b) = ...`
    if (t.type === 'Keyword' && (t.value === 'val' || t.value === 'var') && tokens[i + 1]?.value === '(') {
      const closeDestruct = findMatchingForward(tokens, i + 1, '(', ')');
      if (closeDestruct !== -1 && closeDestruct <= fn.endTokIdx) {
        const names = parseDestructuringParamNames(tokens, i + 2, closeDestruct);
        if (names && names.length > 0) {
          const [scopeStartIdx, scopeEndIdx] = findEnclosingBraceScope(tokens, i, fn.startTokIdx, fn.endTokIdx);
          const matchingDecl = declarations.find((d) => d.startTokIdx === i);
          const declEndIdx = matchingDecl ? matchingDecl.endTokIdx : closeDestruct;
          for (const name of names) {
            scopedBindings.push({
              name,
              kind: 'other',
              declStartIdx: i,
              declEndIdx,
              rhsStartIdx: -1,
              scopeStartIdx,
              scopeEndIdx,
            });
          }
        }
      }
      continue;
    }

    // 3. `for (x in ...)` / `for ((x, y) in ...)` loop variables
    if (t.type === 'Keyword' && t.value === 'for' && tokens[i + 1]?.value === '(') {
      const closeForParen = findMatchingForward(tokens, i + 1, '(', ')');
      if (closeForParen !== -1 && closeForParen <= fn.endTokIdx) {
        let inIdx = -1;
        let pDepth = 0;
        for (let k = i + 2; k < closeForParen; k += 1) {
          if (tokens[k].type === 'Punct' && (tokens[k].value === '(' || tokens[k].value === '<')) pDepth += 1;
          else if (tokens[k].type === 'Punct' && (tokens[k].value === ')' || tokens[k].value === '>')) pDepth = Math.max(0, pDepth - 1);
          else if (pDepth === 0 && tokens[k].type === 'Keyword' && tokens[k].value === 'in') {
            inIdx = k;
            break;
          }
        }
        if (inIdx !== -1) {
          let loopNames = null;
          if (tokens[i + 2]?.value === '(') {
            const closeInner = findMatchingForward(tokens, i + 2, '(', ')');
            if (closeInner !== -1 && closeInner < inIdx) {
              loopNames = parseDestructuringParamNames(tokens, i + 3, closeInner);
            }
          } else {
            loopNames = parseDestructuringParamNames(tokens, i + 2, inIdx);
          }
          if (loopNames && loopNames.length > 0) {
            const bodyStart = closeForParen + 1;
            const bodyEnd = tokens[bodyStart]?.value === '{'
              ? findMatchingForward(tokens, bodyStart, '{', '}')
              : Math.min(fn.endTokIdx, bodyStart + 25);
            if (bodyEnd !== -1) {
              for (const name of loopNames) {
                scopedBindings.push({
                  name,
                  kind: 'other',
                  declStartIdx: i + 1,
                  declEndIdx: closeForParen,
                  rhsStartIdx: -1,
                  scopeStartIdx: bodyStart,
                  scopeEndIdx: bodyEnd,
                });
              }
            }
          }
        }
      }
    }
  }
}

function checkF001AndF008(kf, rawFindings, rawCandidates) {
  const { tokens, declarations, calls } = kf;
  const composableFuns = declarations.filter((d) => d.kind === 'fun' && d.isComposable);

  for (const fn of composableFuns) {
    const scopedBindings = [];
    let hasAnyAnimated = false;

    const localDecls = declarations.filter(
      (d) => (d.kind === 'val' || d.kind === 'var') && d.startTokIdx > fn.startTokIdx && d.endTokIdx <= fn.endTokIdx
    );

    for (const ld of localDecls) {
      const [scopeStartIdx, scopeEndIdx] = findEnclosingBraceScope(tokens, ld.startTokIdx, fn.startTokIdx, fn.endTokIdx);
      const isReassignedVar = isLocalVarReassignedInFn(tokens, ld, fn);
      let kind = 'other';

      if (!isReassignedVar && ld.delegateIdx !== -1) {
        const delToks = tokens.slice(ld.delegateIdx, ld.endTokIdx + 1);
        const topCall = findDirectTopLevelCall(tokens, calls, delToks);
        if (topCall) {
          const isUnqualifiedFactory = isTopLevelOrAndroidxQualifiedCall(tokens, topCall) && topCall.hasParens;
          const isTransitionExt = Boolean(topCall.receiver) && !hasSafeCallInReceiverChain(tokens, topCall);
          if (
            (isUnqualifiedFactory && FRAME_STATE_FACTORIES.has(topCall.name)) ||
            (isTransitionExt && TRANSITION_FRAME_METHODS.has(topCall.name))
          ) {
            kind = 'frame';
            hasAnyAnimated = true;
          } else if (
            (isUnqualifiedFactory && topCall.name === 'animateColorAsState') ||
            (isTransitionExt && topCall.name === 'animateColor')
          ) {
            kind = 'color';
            hasAnyAnimated = true;
          }
        }
      } else if (!isReassignedVar && ld.rhsStartIdx !== -1) {
        const rhsToks = tokens.slice(ld.rhsStartIdx, ld.endTokIdx + 1);
        if (extractDirectAnimatableInitCall(tokens, calls, rhsToks)) {
          kind = 'animatable';
          hasAnyAnimated = true;
        }
      }

      scopedBindings.push({
        name: ld.name,
        kind,
        isReassignedVar,
        declStartIdx: ld.startTokIdx,
        declEndIdx: ld.endTokIdx,
        rhsStartIdx: ld.rhsStartIdx,
        scopeStartIdx,
        scopeEndIdx,
      });
    }

    if (!hasAnyAnimated) continue;

    collectShadowingScopeBindings(tokens, declarations, fn, scopedBindings);

    // Second pass over local vals for direct top-level `lerp(..., <frameVar>)`
    for (const b of scopedBindings) {
      if (b.kind === 'other' && !b.isReassignedVar && b.rhsStartIdx !== -1) {
        const rhsToks = tokens.slice(b.rhsStartIdx, b.declEndIdx + 1);
        const lerpCall = findDirectTopLevelCall(tokens, calls, rhsToks);
        if (
          lerpCall &&
          isTopLevelOrAndroidxQualifiedCall(tokens, lerpCall) &&
          lerpCall.name === 'lerp' &&
          lerpCall.hasParens &&
          !lerpCall.trailingLambda
        ) {
          const usesFrameVar = lerpCall.args.some(
            (a) =>
              Boolean(findScopedSimpleVarRef(a.tokens, lerpCall.nameTokIdx, scopedBindings, 'frame')) ||
              Boolean(findScopedAnimatableRead(a.tokens, lerpCall.nameTokIdx, scopedBindings))
          );
          if (usesFrameVar) {
            b.kind = 'derivedColor';
            hasAnyAnimated = true;
          }
        }
      }
    }

    const fnCalls = calls.filter((c) => c.nameTokIdx > fn.startTokIdx && c.endTokIdx <= fn.endTokIdx);
    for (const c of fnCalls) {
      if (!c.hasParens || c.args.length === 0) continue;
      if (!c.receiver) continue; // Must be a modifier chain method `.offset(...)`, `.alpha(...)`, etc.
      if (isInsidePhaseLambda(c, tokens)) continue;

      const guaranteedInComposition = isGuaranteedCompositionExecution(tokens, declarations, calls, fn, c);

      if (VALUE_MODIFIER_NAMES.has(c.name)) {
        const hitVar = findScopedReferencedAnimatedVar(c.args, c.nameTokIdx, scopedBindings);
        if (hitVar) {
          const fixHint = c.name === 'offset' || c.name === 'absoluteOffset'
            ? `Use the layout-phase lambda overload \`Modifier.${c.name} { IntOffset(...) }\` so \`${hitVar}\` is read during placement instead of composition.`
            : `Use \`Modifier.graphicsLayer { ... }\` so \`${hitVar}\` is read in the draw phase instead of recomposing every frame.`;
          if (guaranteedInComposition) {
            rawFindings.push(
              makeRuleFinding('F-001', {
                file: kf.filePath,
                lines: [c.startLine, c.headerEndLine],
                evidence: `\`${c.snippet}\` reads animated state \`${hitVar}\` in composition.`,
                remediation: fixHint,
                symbolContext: [fn.name],
              })
            );
          } else if (rawCandidates) {
            rawCandidates.push(
              makeRuleCandidate('F-001', {
                file: kf.filePath,
                lines: [c.startLine, c.headerEndLine],
                evidence: `\`${c.snippet}\` references animated state \`${hitVar}\` inside a deferred lambda or cached block.`,
                verificationHint: `Check whether this callback or cached block executes during composition on every frame; if so, ${fixHint.charAt(0).toLowerCase()}${fixHint.slice(1)}`,
              })
            );
          }
        }
      } else if (c.name === 'background') {
        const firstArg = c.args[0];
        if (firstArg) {
          const hitColor =
            findScopedSimpleVarRef(firstArg.tokens, c.nameTokIdx, scopedBindings, 'color') ||
            findScopedSimpleVarRef(firstArg.tokens, c.nameTokIdx, scopedBindings, 'derivedColor');
          if (hitColor) {
            if (guaranteedInComposition) {
              rawFindings.push(
                makeRuleFinding('F-001', {
                  file: kf.filePath,
                  lines: [c.startLine, c.headerEndLine],
                  evidence: `\`${c.snippet}\` reads per-frame animated color \`${hitColor}\` in composition.`,
                  remediation: `Draw the animated color in the draw phase via \`Modifier.drawBehind { drawRect(${hitColor}) }\` (clipping first if needed) instead of \`Modifier.background(${hitColor})\`.`,
                  symbolContext: [fn.name],
                })
              );
            } else if (rawCandidates) {
              rawCandidates.push(
                makeRuleCandidate('F-001', {
                  file: kf.filePath,
                  lines: [c.startLine, c.headerEndLine],
                  evidence: `\`${c.snippet}\` references animated color \`${hitColor}\` inside a deferred lambda or cached block.`,
                  verificationHint: 'Check whether this callback or cached block executes during composition on every frame; if so, draw the animated color via `Modifier.drawBehind { drawRect(...) }`.',
                })
              );
            }
          }
        }
      } else if (LAYOUT_SIZE_MODIFIER_NAMES.has(c.name)) {
        const hitVar = findScopedReferencedAnimatedVar(c.args, c.nameTokIdx, scopedBindings);
        if (hitVar) {
          rawCandidates.push(
            makeRuleCandidate('F-008', {
              file: kf.filePath,
              lines: [c.startLine, c.headerEndLine],
              evidence: `\`${c.snippet}\` animates layout property \`${c.name}\` via \`${hitVar}\` on every frame.`,
              verificationHint: 'Check whether sibling reflow is genuinely required; if the element only shifts its own visual position or scale, replace animated padding/size with lambda `Modifier.offset { ... }` or `Modifier.graphicsLayer { ... }`.',
            })
          );
        }
      }
    }
  }
}

function findDirectTopLevelCall(tokens, calls, rawToks) {
  const stripped = stripOuterParensTokens(rawToks);
  if (stripped.length === 0) return null;
  const firstTok = stripped[0];
  const lastTok = stripped[stripped.length - 1];
  return (
    calls.find(
      (c) =>
        (tokens[c.chainRootIdx] === firstTok || tokens[c.nameTokIdx] === firstTok) &&
        tokens[c.endTokIdx] === lastTok
    ) || null
  );
}

function isTopLevelOrAndroidxQualifiedCall(tokens, call) {
  if (!call) return false;
  if (!call.receiver && call.chainRootIdx === call.nameTokIdx) return true;
  const prefix = tokens.slice(call.chainRootIdx, call.nameTokIdx);
  if (prefix.length < 2 || prefix[0].type !== 'Identifier' || prefix[0].value !== 'androidx') {
    return false;
  }
  return prefix.every((t, idx) =>
    idx % 2 === 0 ? t.type === 'Identifier' : t.type === 'Punct' && t.value === '.'
  );
}

function hasSafeCallInReceiverChain(tokens, call) {
  for (let i = call.chainRootIdx; i < call.nameTokIdx; i += 1) {
    if (tokens[i].type === 'Punct' && tokens[i].value === '?.') return true;
  }
  return false;
}

function isLocalVarReassignedInFn(tokens, ld, fn) {
  if (ld.kind !== 'var') return false;
  for (let i = ld.endTokIdx + 1; i <= fn.endTokIdx; i += 1) {
    const t = tokens[i];
    if (t.type !== 'Identifier' || t.value !== ld.name) continue;
    const prev = tokens[i - 1];
    if (prev && prev.type === 'Punct' && (prev.value === '.' || prev.value === '?.' || prev.value === '::')) {
      continue;
    }
    if (prev && prev.type === 'Punct' && (prev.value === '++' || prev.value === '--')) {
      return true;
    }
    const next = tokens[i + 1];
    if (
      next &&
      next.type === 'Punct' &&
      (next.value === '=' ||
        next.value === '+=' ||
        next.value === '-=' ||
        next.value === '*=' ||
        next.value === '/=' ||
        next.value === '%=' ||
        next.value === '++' ||
        next.value === '--')
    ) {
      return true;
    }
  }
  return false;
}

function findNamedLambdaArgBraces(tokens, call, paramName) {
  if (!call?.hasParens || !Array.isArray(call.args)) return null;
  const arg = call.args.find((a) => a.name === paramName);
  if (!arg) return null;
  const stripped = stripOuterParensTokens(arg.tokens);
  if (
    stripped.length >= 2 &&
    stripped[0].type === 'Punct' &&
    stripped[0].value === '{' &&
    stripped[stripped.length - 1].type === 'Punct' &&
    stripped[stripped.length - 1].value === '}'
  ) {
    const openBraceIdx = tokens.indexOf(stripped[0]);
    const closeBraceIdx = tokens.indexOf(stripped[stripped.length - 1]);
    if (openBraceIdx !== -1 && closeBraceIdx > openBraceIdx) {
      return { openBraceIdx, closeBraceIdx };
    }
  }
  return null;
}

function hasTopLevelLambdaArrow(bodyToks) {
  let pDepth = 0;
  let bDepth = 0;
  let kDepth = 0;
  for (const t of bodyToks) {
    if (t.type === 'Punct') {
      if (t.value === '(') pDepth += 1;
      else if (t.value === ')') pDepth = Math.max(0, pDepth - 1);
      else if (t.value === '{') bDepth += 1;
      else if (t.value === '}') bDepth = Math.max(0, bDepth - 1);
      else if (t.value === '[') kDepth += 1;
      else if (t.value === ']') kDepth = Math.max(0, kDepth - 1);
      else if (pDepth === 0 && bDepth === 0 && kDepth === 0 && t.value === '->') return true;
    }
  }
  return false;
}

function canTokenEndExpression(tok) {
  if (!tok) return false;
  if (
    tok.type === 'Identifier' ||
    tok.type === 'NumberLiteral' ||
    tok.type === 'StringLiteral' ||
    tok.type === 'CharLiteral'
  ) {
    return true;
  }
  if (
    tok.type === 'Keyword' &&
    (tok.value === 'true' || tok.value === 'false' || tok.value === 'null' || tok.value === 'this' || tok.value === 'super')
  ) {
    return true;
  }
  if (tok.type === 'Punct' && (tok.value === ')' || tok.value === '}' || tok.value === ']')) {
    return true;
  }
  return false;
}

function splitTopLevelStatements(bodyToks) {
  const stmts = [];
  let curStart = 0;
  let pDepth = 0;
  let bDepth = 0;
  let kDepth = 0;

  for (let i = 0; i < bodyToks.length; i += 1) {
    const t = bodyToks[i];
    if (t.type === 'Punct') {
      if (t.value === '(') pDepth += 1;
      else if (t.value === ')') pDepth = Math.max(0, pDepth - 1);
      else if (t.value === '{') bDepth += 1;
      else if (t.value === '}') bDepth = Math.max(0, bDepth - 1);
      else if (t.value === '[') kDepth += 1;
      else if (t.value === ']') kDepth = Math.max(0, kDepth - 1);
      else if (t.value === ';' && pDepth === 0 && bDepth === 0 && kDepth === 0) {
        if (i > curStart) stmts.push(bodyToks.slice(curStart, i));
        curStart = i + 1;
        continue;
      }
    }

    const next = bodyToks[i + 1];
    if (!next) break;
    if (pDepth === 0 && bDepth === 0 && kDepth === 0 && next.line > t.endLine) {
      let closesControlHeader = false;
      if (t.type === 'Punct' && t.value === ')') {
        const openP = findMatchingBackward(bodyToks, i, '(', ')');
        const kw = openP > curStart ? bodyToks[openP - 1] : null;
        if (
          kw?.type === 'Keyword' &&
          (kw.value === 'if' || kw.value === 'while' || kw.value === 'for' || kw.value === 'catch' || kw.value === 'when')
        ) {
          closesControlHeader = true;
        }
      }
      const prevInStmt = i > curStart ? bodyToks[i - 1] : null;
      const isInfixIdent = t.type === 'Identifier' && canTokenEndExpression(prevInStmt);

      const curContinues =
        closesControlHeader ||
        isInfixIdent ||
        (t.type === 'Punct' &&
          ['.', '?.', '?:', '=', '+', '-', '*', '/', '%', '&&', '||', '==', '!=', '===', '!==', '<', '>', '<=', '>=', '..', '..<', '->', ':'].includes(t.value)) ||
        (t.type === 'Keyword' &&
          ['else', 'by', 'in', 'is', 'as', 'if', 'when', 'try', 'catch', 'finally', 'while', 'for', 'do', 'return', 'throw'].includes(t.value));
      const nextContinues =
        (next.type === 'Punct' &&
          ['.', '?.', '?:', '+', '*', '/', '%', '&&', '||', '==', '!=', '===', '!==', '<', '>', '<=', '>=', '..', '..<', '{', '->'].includes(next.value)) ||
        (next.type === 'Keyword' && ['else', 'catch', 'finally', 'in', 'is', 'as'].includes(next.value));

      if (!curContinues && !nextContinues) {
        if (i + 1 > curStart) stmts.push(bodyToks.slice(curStart, i + 1));
        curStart = i + 1;
      }
    }
  }

  if (curStart < bodyToks.length) {
    stmts.push(bodyToks.slice(curStart));
  }
  return stmts;
}

function extractDirectAnimatableInitCall(tokens, calls, rhsToks) {
  const topCall = findDirectTopLevelCall(tokens, calls, rhsToks);
  if (!topCall) return null;

  if (
    isTopLevelOrAndroidxQualifiedCall(tokens, topCall) &&
    topCall.name === 'Animatable' &&
    topCall.hasParens &&
    !topCall.trailingLambda
  ) {
    return topCall;
  }

  if (
    isTopLevelOrAndroidxQualifiedCall(tokens, topCall) &&
    (topCall.name === 'remember' || topCall.name === 'rememberSaveable')
  ) {
    const calcLambda = topCall.trailingLambda || findNamedLambdaArgBraces(tokens, topCall, 'calculation');
    if (!calcLambda) return null;
    const bodyToks = tokens.slice(calcLambda.openBraceIdx + 1, calcLambda.closeBraceIdx);
    if (bodyToks.length === 0 || hasTopLevelLambdaArrow(bodyToks)) return null;
    if (bodyToks.some((t) => t.type === 'Keyword' && (t.value === 'return' || t.value === 'throw'))) {
      return null;
    }
    const stmts = splitTopLevelStatements(bodyToks);
    if (stmts.length === 0) return null;
    const lastStmt = stmts[stmts.length - 1];
    const innerTop = findDirectTopLevelCall(tokens, calls, lastStmt);
    if (
      innerTop &&
      isTopLevelOrAndroidxQualifiedCall(tokens, innerTop) &&
      innerTop.name === 'Animatable' &&
      innerTop.hasParens &&
      !innerTop.trailingLambda
    ) {
      return innerTop;
    }
  }

  return null;
}

const NON_COMPOSITION_CALL_NAMES = new Set([
  'remember',
  'rememberSaveable',
  'rememberUpdatedState',
  'derivedStateOf',
  'produceState',
  'LaunchedEffect',
  'DisposableEffect',
  'SideEffect',
  'clickable',
  'combinedClickable',
  'selectable',
  'toggleable',
  'triStateToggleable',
  'pointerInput',
  'draggable',
  'scrollable',
  'AnchoredDraggable',
  'detectTapGestures',
  'detectDragGestures',
  'onGloballyPositioned',
  'onSizeChanged',
  'onPlaced',
  'onFocusChanged',
  'onKeyEvent',
  'onPreviewKeyEvent',
  'semantics',
  'clearAndSetSemantics',
  'drawBehind',
  'drawWithContent',
  'drawWithCache',
  'onDrawBehind',
  'onDrawWithContent',
  'Canvas',
  'layout',
  'graphicsLayer',
  'offset',
  'absoluteOffset',
  'launch',
  'async',
  'withContext',
]);

const INLINE_OR_COMPOSABLE_DSL_SCOPES = new Set([
  'item',
  'items',
  'itemsIndexed',
  'stickyHeader',
  'composable',
  'navigation',
  'key',
  'composed',
  'CompositionLocalProvider',
  'SelectionContainer',
  'DisableSelection',
  'with',
  'run',
  'let',
  'also',
  'apply',
  'repeat',
  'forEach',
  'forEachIndexed',
]);

const COMPOSABLE_SLOT_ARG_NAMES = new Set([
  'content',
  'title',
  'text',
  'icon',
  'leadingIcon',
  'trailingIcon',
  'label',
  'placeholder',
  'prefix',
  'suffix',
  'supportingText',
  'headlineContent',
  'supportingContent',
  'overlineContent',
  'leadingContent',
  'trailingContent',
  'topBar',
  'bottomBar',
  'floatingActionButton',
  'snackbarHost',
  'sheetContent',
  'drawerContent',
  'navigationIcon',
  'actions',
  'badge',
  'confirmButton',
  'dismissButton',
  'divider',
  'indicator',
  'tabs',
  'thumb',
  'track',
]);

function isWhenBlockOpenBrace(tokens, openBraceIdx) {
  const prev = tokens[openBraceIdx - 1];
  if (prev?.type === 'Keyword' && prev.value === 'when') return true;
  if (prev?.type === 'Punct' && prev.value === ')') {
    const openP = findMatchingBackward(tokens, openBraceIdx - 1, '(', ')');
    if (openP > 0 && tokens[openP - 1]?.type === 'Keyword' && tokens[openP - 1].value === 'when') {
      return true;
    }
  }
  return false;
}

function isControlFlowBraceBlock(tokens, openBraceIdx, fnStartIdx, fnEndIdx) {
  const prev = tokens[openBraceIdx - 1];
  if (!prev) return false;
  if (
    prev.type === 'Keyword' &&
    (prev.value === 'else' || prev.value === 'try' || prev.value === 'finally' || prev.value === 'do' || prev.value === 'when')
  ) {
    return true;
  }
  if (prev.type === 'Punct' && prev.value === ')') {
    const openP = findMatchingBackward(tokens, openBraceIdx - 1, '(', ')');
    const kw = openP > 0 ? tokens[openP - 1] : null;
    if (
      kw?.type === 'Keyword' &&
      (kw.value === 'if' || kw.value === 'when' || kw.value === 'for' || kw.value === 'while' || kw.value === 'catch')
    ) {
      return true;
    }
  }
  if (prev.type === 'Punct' && prev.value === '->') {
    const [parentOpen] = findEnclosingBraceScope(tokens, openBraceIdx, fnStartIdx, fnEndIdx);
    if (parentOpen >= fnStartIdx && isWhenBlockOpenBrace(tokens, parentOpen)) {
      return true;
    }
  }
  return false;
}

function isGuaranteedCompositionExecution(tokens, declarations, calls, fn, targetCall) {
  // Reject reads inside nested local `fun` declarations inside `fn`
  if (targetCall.enclosingDeclarations.some((d) => d.kind === 'fun' && d !== fn)) {
    return false;
  }

  let fnBodyOpenBraceIdx = -1;
  if (!fn.isExpressionBody && tokens[fn.endTokIdx]?.value === '}') {
    fnBodyOpenBraceIdx = findMatchingBackward(tokens, fn.endTokIdx, '{', '}');
  }
  const scanFrom = fnBodyOpenBraceIdx !== -1 ? fnBodyOpenBraceIdx + 1 : fn.startTokIdx + 1;

  for (let i = scanFrom; i < targetCall.nameTokIdx; i += 1) {
    const t = tokens[i];
    if (t.type !== 'Punct' || t.value !== '{') continue;
    const closeB = findMatchingForward(tokens, i, '{', '}');
    if (closeB === -1 || closeB <= targetCall.nameTokIdx) continue;

    if (isControlFlowBraceBlock(tokens, i, fn.startTokIdx, fn.endTokIdx)) {
      continue;
    }

    // Check trailing lambda of a synchronous `@Composable` container or inline scope
    const trailingOwner = calls.find((c) => c.trailingLambda && c.trailingLambda.openBraceIdx === i);
    if (trailingOwner) {
      if (NON_COMPOSITION_CALL_NAMES.has(trailingOwner.name)) {
        return false;
      }
      if (/^[A-Z]/.test(trailingOwner.name) || INLINE_OR_COMPOSABLE_DSL_SCOPES.has(trailingOwner.name)) {
        continue;
      }
      return false;
    }

    // Check named `@Composable` slot lambda (`Scaffold(topBar = { ... })`, `ListItem(headlineContent = { ... })`)
    const slotOwner = calls.find(
      (c) =>
        /^[A-Z]/.test(c.name) &&
        !NON_COMPOSITION_CALL_NAMES.has(c.name) &&
        Array.isArray(c.args) &&
        c.args.some(
          (a) =>
            a.name &&
            COMPOSABLE_SLOT_ARG_NAMES.has(a.name) &&
            a.tokens.length >= 2 &&
            a.tokens[0] === tokens[i] &&
            a.tokens[a.tokens.length - 1] === tokens[closeB]
        )
    );
    if (slotOwner) {
      continue;
    }

    return false;
  }

  return true;
}

function findScopedReferencedAnimatedVar(args, atTokIdx, scopedBindings) {
  for (const arg of args) {
    const direct = findScopedSimpleVarRef(arg.tokens, atTokIdx, scopedBindings, 'frame');
    if (direct) return direct;
    const animVal = findScopedAnimatableRead(arg.tokens, atTokIdx, scopedBindings);
    if (animVal) return `${animVal}.value`;
  }
  return null;
}

function isUnqualifiedLocalIdent(toks, idx) {
  const prev = toks[idx - 1];
  if (
    prev &&
    prev.type === 'Punct' &&
    (prev.value === '.' || prev.value === '?.' || prev.value === '::' || prev.value === '@' || prev.value === ':')
  ) {
    return false;
  }
  if (prev && prev.type === 'Keyword' && (prev.value === 'as' || prev.value === 'is')) {
    return false;
  }
  if (
    prev &&
    prev.type === 'Punct' &&
    prev.value === '?' &&
    toks[idx - 2]?.type === 'Keyword' &&
    toks[idx - 2].value === 'as'
  ) {
    return false;
  }
  const next = toks[idx + 1];
  if (next && next.type === 'Punct' && (next.value === '::' || next.value === '@')) {
    return false;
  }
  // Named-argument label inside a call: `foo(alpha = ...)` or `foo(a, alpha = ...)`
  if (
    prev &&
    prev.type === 'Punct' &&
    (prev.value === '(' || prev.value === ',') &&
    next &&
    next.type === 'Punct' &&
    next.value === '='
  ) {
    return false;
  }
  return true;
}

function isCalleeIdentAt(toks, idx) {
  const next = toks[idx + 1];
  if (!next || next.type !== 'Punct') return false;
  if (next.value === '(' || next.value === '{') return true;
  if (next.value === '<') {
    let depth = 0;
    for (let k = idx + 1; k < toks.length; k += 1) {
      const tk = toks[k];
      if (tk.type === 'Punct' && tk.value === '<') {
        depth += 1;
      } else if (tk.type === 'Punct' && tk.value === '>') {
        depth -= 1;
        if (depth === 0) {
          const after = toks[k + 1];
          return Boolean(after && after.type === 'Punct' && (after.value === '(' || after.value === '{'));
        }
      } else if (
        tk.type === 'Identifier' ||
        (tk.type === 'Punct' && (tk.value === ',' || tk.value === '.' || tk.value === '?' || tk.value === '*')) ||
        (tk.type === 'Keyword' && (tk.value === 'in' || tk.value === 'out'))
      ) {
        continue;
      } else {
        return false;
      }
    }
  }
  return false;
}

function findScopedSimpleVarRef(toks, atTokIdx, scopedBindings, expectedKind) {
  let bDepth = 0;
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (t.type === 'Punct') {
      if (t.value === '{') {
        bDepth += 1;
        continue;
      }
      if (t.value === '}') {
        bDepth = Math.max(0, bDepth - 1);
        continue;
      }
    }
    if (bDepth > 0) continue; // Deferred lambda body, not evaluated eagerly at call site
    if (t.type === 'Identifier' && isUnqualifiedLocalIdent(toks, i) && !isCalleeIdentAt(toks, i)) {
      if (resolveScopedLocalKind(t.value, atTokIdx, scopedBindings) === expectedKind) {
        return t.value;
      }
    }
  }
  return null;
}

function findScopedAnimatableRead(toks, atTokIdx, scopedBindings) {
  let bDepth = 0;
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (t.type === 'Punct') {
      if (t.value === '{') {
        bDepth += 1;
        continue;
      }
      if (t.value === '}') {
        bDepth = Math.max(0, bDepth - 1);
        continue;
      }
    }
    if (bDepth > 0 || i + 2 >= toks.length) continue;
    if (
      toks[i].type === 'Identifier' &&
      isUnqualifiedLocalIdent(toks, i) &&
      toks[i + 1].type === 'Punct' &&
      (toks[i + 1].value === '.' || toks[i + 1].value === '?.') &&
      toks[i + 2].type === 'Identifier' &&
      toks[i + 2].value === 'value' &&
      !isCalleeIdentAt(toks, i + 2) &&
      resolveScopedLocalKind(toks[i].value, atTokIdx, scopedBindings) === 'animatable'
    ) {
      return toks[i].value;
    }
  }
  return null;
}

function getItemsKeyArg(call) {
  const named = call.args.find((a) => a.name === 'key');
  if (named) return named;
  if (
    call.args.length >= 2 &&
    call.args[1].name === null &&
    (call.args[0].name === null || call.args[0].name === 'items' || call.args[0].name === 'count')
  ) {
    return call.args[1];
  }
  return null;
}

function checkF003AndT021(kf, conventionContext, rawFindings, rawCandidates) {
  const { calls } = kf;
  for (const c of calls) {
    if ((c.name !== 'items' && c.name !== 'itemsIndexed') || !c.trailingLambda) continue;

    // Look for `.animateItem(...)` whose nearest enclosing `items`/`itemsIndexed` is `c`
    const animateItemCall = calls.find((inner) => {
      if (inner.name !== 'animateItem' || !inner.receiver) return false;
      if (inner.nameTokIdx <= c.trailingLambda.openBraceIdx || inner.endTokIdx >= c.trailingLambda.closeBraceIdx) return false;
      const nearestItems = [...inner.enclosingCalls].reverse().find((ec) => ec.name === 'items' || ec.name === 'itemsIndexed');
      return nearestItems === c;
    });
    if (!animateItemCall) continue;

    const symNames = c.enclosingDeclarations.map((d) => d.name);
    const keyArg = getItemsKeyArg(c);

    if (!keyArg || keyArg.text === 'null') {
      rawFindings.push(
        makeRuleFinding('F-003', {
          file: kf.filePath,
          lines: [c.startLine, c.endLine],
          evidence: `\`${c.name}(...)\` uses \`Modifier.animateItem()\` (line ${animateItemCall.startLine}) without providing a \`key\`.`,
          remediation: `Pass a stable, Bundle-compatible identity key on \`${c.name}(..., key = { item -> item.id })\`.`,
          symbolContext: symNames,
        })
      );
      continue;
    }

    // `key` is present: check T-021 (positional index used as key)
    const hasIdentityTwinOrSpec = conventionContext.usesIdentityListKeys || conventionContext.hasMotionMdSpecs;
    const keySeverity = hasIdentityTwinOrSpec ? 'major' : 'minor';
    const keyBasis = conventionContext.usesIdentityListKeys
      ? 'compliant-identity-key-in-scanned-set'
      : conventionContext.hasMotionMdSpecs
        ? 'motion-md-convention'
        : 'no-established-convention-in-scanned-set';

    if (c.name === 'itemsIndexed') {
      const idxKeyClass = classifyItemsIndexedKey(kf, keyArg);
      if (idxKeyClass === 'positional') {
        rawFindings.push(
          makeRuleFinding('T-021', {
            file: kf.filePath,
            lines: [c.startLine, c.endLine],
            severity: keySeverity,
            severityBasis: keyBasis,
            evidence: `\`itemsIndexed(..., key = ${keyArg.text})\` keys \`animateItem()\` rows by list index instead of item identity.`,
            remediation: 'Key items by a stable content identifier from the item parameter (for example `key = { _, item -> item.id }`).',
            symbolContext: symNames,
          })
        );
      } else if (idxKeyClass === 'unresolved-index-lookup' && rawCandidates) {
        rawCandidates.push(
          makeRuleCandidate('T-021', {
            file: kf.filePath,
            lines: [c.startLine, c.endLine],
            severity: keySeverity,
            evidence: `\`itemsIndexed(..., key = ${keyArg.text})\` derives its key from the index parameter rather than reading the \`item\` lambda parameter directly.`,
            verificationHint: 'Confirm the expression resolves a stable item identity (prefer `key = { _, item -> item.id }` for clarity) rather than a positional row index.',
          })
        );
      }
    } else if (c.name === 'items') {
      const firstArg = c.args[0];
      if (firstArg && firstArg.name !== 'items' && isIdentityIndexLambda(kf, keyArg)) {
        if (isProvableIntCountArg(kf, c, firstArg)) {
          rawFindings.push(
            makeRuleFinding('T-021', {
              file: kf.filePath,
              lines: [c.startLine, c.endLine],
              severity: keySeverity,
              severityBasis: keyBasis,
              evidence: `\`items(${firstArg.text}, key = ${keyArg.text})\` passes a count overload with the index itself as \`key\` alongside \`animateItem()\`.`,
              remediation: 'Pass the domain collection and key by stable item identity (`items(list, key = { it.id })`).',
              symbolContext: symNames,
            })
          );
        } else if (rawCandidates) {
          rawCandidates.push(
            makeRuleCandidate('T-021', {
              file: kf.filePath,
              lines: [c.startLine, c.endLine],
              severity: keySeverity,
              evidence: `\`items(${firstArg.text}, key = ${keyArg.text})\` uses \`animateItem()\` with identity lambda \`${keyArg.text}\`; type of \`${firstArg.text}\` (Int count vs List) is not locally declared.`,
              verificationHint: `Check the declaration of \`${firstArg.text}\`: if \`Int\`, \`key = { it }\` keys by list index (T-021); if \`List<Scalar>\` with unique elements, \`{ it }\` is an identity key.`,
            })
          );
        }
      }
    }
  }
}

const POSITIONAL_PRIMITIVE_METHODS = new Set([
  'toString',
  'toLong',
  'toInt',
  'toShort',
  'toByte',
  'toUInt',
  'toULong',
  'toFloat',
  'toDouble',
  'hashCode',
]);

const POSITIONAL_ARITH_PUNCT = new Set(['+', '-', '*', '/', '%', '(', ')']);
const POSITIONAL_INFIX_OPS = new Set(['shl', 'shr', 'ushr', 'xor', 'or', 'and']);

function isDemonstrablyPositionalIndexExpr(bodyToks, idxName) {
  if (!Array.isArray(bodyToks) || bodyToks.length === 0) return false;

  for (let i = 0; i < bodyToks.length; i += 1) {
    const t = bodyToks[i];
    if (t.type === 'NumberLiteral' || t.type === 'StringLiteral') {
      // Note: `tokenizeKotlin` emits any `$ident` or `${...}` template expressions inside a `StringLiteral`
      // as subsequent tokens in `bodyToks`, so they are inspected directly by this loop!
      continue;
    }
    if (t.type === 'Punct') {
      if (POSITIONAL_ARITH_PUNCT.has(t.value)) {
        if (t.value === '(' && bodyToks[i - 1]?.type === 'Identifier' && !POSITIONAL_INFIX_OPS.has(bodyToks[i - 1].value)) {
          return false;
        }
        continue;
      }
      if (
        t.value === '.' &&
        bodyToks[i - 1]?.type === 'Identifier' &&
        bodyToks[i - 1].value === idxName &&
        bodyToks[i + 1]?.type === 'Identifier' &&
        POSITIONAL_PRIMITIVE_METHODS.has(bodyToks[i + 1].value) &&
        bodyToks[i + 2]?.type === 'Punct' &&
        bodyToks[i + 2].value === '(' &&
        bodyToks[i + 3]?.type === 'Punct' &&
        bodyToks[i + 3].value === ')'
      ) {
        i += 3;
        continue;
      }
      return false;
    }
    if (t.type === 'Identifier') {
      if (t.value === idxName && isUnqualifiedLocalIdent(bodyToks, i)) {
        if (bodyToks[i + 1]?.type === 'Punct' && (bodyToks[i + 1].value === '(' || bodyToks[i + 1].value === '[')) {
          return false;
        }
        continue;
      }
      if (POSITIONAL_INFIX_OPS.has(t.value)) continue;
      return false;
    }
    return false;
  }
  return true;
}

function classifyItemsIndexedKey(kf, keyArg) {
  const toks = keyArg.tokens;
  if (
    !toks.length ||
    toks[0].value !== '{' ||
    toks[toks.length - 1].value !== '}' ||
    findMatchingForward(toks, 0, '{', '}') !== toks.length - 1
  ) {
    return null;
  }
  // Find arrow `->` at top level of this lambda
  let arrowPos = -1;
  let depth = 0;
  for (let i = 1; i < toks.length - 1; i += 1) {
    const t = toks[i];
    if (t.type === 'Punct') {
      if (t.value === '{' || t.value === '(') depth += 1;
      else if (t.value === '}' || t.value === ')') depth -= 1;
      else if (t.value === '->' && depth === 0) {
        arrowPos = i;
        break;
      }
    }
  }
  if (arrowPos === -1) return null;
  const headerToks = toks.slice(1, arrowPos);
  const commaPos = headerToks.findIndex((t) => t.type === 'Punct' && t.value === ',');
  if (commaPos === -1) return null;

  const idxParamTok = headerToks.slice(0, commaPos).find((t) => t.type === 'Identifier');
  const itemParamTok = headerToks.slice(commaPos + 1).find((t) => t.type === 'Identifier');
  if (!idxParamTok) return null;
  const idxName = idxParamTok.value;
  const itemName = itemParamTok ? itemParamTok.value : '_';
  if (idxName === '_') return null;

  const bodyToks = toks.slice(arrowPos + 1, -1);
  const usesIdx = bodyToks.some((t, idx) => t.type === 'Identifier' && t.value === idxName && isUnqualifiedLocalIdent(bodyToks, idx));
  const usesItem = itemName !== '_' && bodyToks.some((t, idx) => t.type === 'Identifier' && t.value === itemName && isUnqualifiedLocalIdent(bodyToks, idx));
  void kf;
  if (!usesIdx || usesItem) return null;

  if (isDemonstrablyPositionalIndexExpr(bodyToks, idxName)) {
    return 'positional';
  }
  return 'unresolved-index-lookup';
}

function isProvableIntCountArg(kf, call, firstArg) {
  if (firstArg.name === 'count') return true;
  const toks = firstArg.tokens;
  if (toks.length === 1 && toks[0].type === 'NumberLiteral' && /^\d+$/.test(toks[0].value)) {
    return true;
  }
  // `list.size` or `list.count()`
  if (
    toks.length >= 3 &&
    toks[toks.length - 2]?.value === '.' &&
    (toks[toks.length - 1]?.value === 'size' || toks[toks.length - 1]?.value === 'length')
  ) {
    return true;
  }
  // Parameter explicitly typed `: Int` on enclosing function
  if (toks.length === 1 && toks[0].type === 'Identifier') {
    const paramName = toks[0].value;
    for (const d of call.enclosingDeclarations) {
      if (d.paramRange) {
        const paramSlice = kf.tokens.slice(d.paramRange[0] + 1, d.paramRange[1]);
        for (let i = 0; i + 2 < paramSlice.length; i += 1) {
          if (
            paramSlice[i].type === 'Identifier' &&
            paramSlice[i].value === paramName &&
            paramSlice[i + 1].value === ':' &&
            paramSlice[i + 2].value === 'Int'
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function isIdentityIndexLambda(kf, keyArg) {
  void kf;
  const text = keyArg.text.replace(/\s+/g, ' ').trim();
  if (/^\{\s*it\s*\}$/.test(text)) return true;
  const m = text.match(/^\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*->\s*\1\s*\}$/);
  return Boolean(m);
}

function findScaleReadingHelpers(kf) {
  const helpers = new Set();
  for (const d of kf.declarations) {
    if (d.kind !== 'fun' && d.kind !== 'val') continue;
    const bodyToks = kf.tokens.slice(d.startTokIdx, d.endTokIdx + 1);
    if (tokensReadDurationScale(bodyToks, kf.calls)) {
      helpers.add(d.name);
    }
  }
  return helpers;
}

function tokensReadDurationScale(toks, allCalls) {
  if (toks.length === 0) return false;
  const startOff = toks[0].start;
  const endOff = toks[toks.length - 1].end;
  const logSpans = allCalls
    .filter((c) =>
      (c.receiver === 'Log' || c.name === 'println' || c.name === 'print') &&
      c.hasParens &&
      kfTokenOffsetOverlap(c, startOff, endOff)
    );

  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    const isScaleIdent =
      (t.type === 'Identifier' && DURATION_SCALE_IDENTIFIERS.has(t.value)) ||
      (t.type === 'Identifier' &&
        t.value === 'ValueAnimator' &&
        toks[i + 1]?.value === '.' &&
        toks[i + 2]?.value === 'durationScale');
    if (isScaleIdent) {
      const insideLogOnly = logSpans.some(
        (lc) => t.start >= kfCallStartOffset(lc) && t.end <= kfCallEndOffset(lc)
      );
      if (!insideLogOnly) return true;
    }
  }
  return false;
}

function kfTokenOffsetOverlap(call, startOff, endOff) {
  const cStart = call.args[0]?.allTokens[0]?.start ?? -1;
  const cEnd = call.args[call.args.length - 1]?.allTokens?.slice(-1)[0]?.end ?? -1;
  return cStart >= startOff && cEnd <= endOff;
}

function kfCallStartOffset(call) {
  return call.args[0]?.allTokens[0]?.start ?? Infinity;
}

function kfCallEndOffset(call) {
  const lastArg = call.args[call.args.length - 1];
  const lastTok = lastArg?.allTokens?.[lastArg.allTokens.length - 1];
  return lastTok ? lastTok.end : -1;
}

const BENIGN_STATE_WRAPPER_IDENTS = new Set([
  'remember',
  'rememberSaveable',
  'mutableStateOf',
  'mutableFloatStateOf',
  'mutableIntStateOf',
  'mutableLongStateOf',
  'mutableDoubleStateOf',
  'derivedStateOf',
]);

function isProvablyNonScaleParamType(typeText) {
  const clean = String(typeText || '').replace(/\s+/g, '');
  if (!clean) return false;
  return /^(?:Int|Long|Short|Byte|Char|Dp|TextUnit|String|CharSequence|AnnotatedString|Color|Brush|Shape|TextStyle|Modifier|androidx\.compose\.ui\.Modifier|PaddingValues|Arrangement(?:\.[A-Za-z0-9_]+)?|Alignment(?:\.[A-Za-z0-9_]+)?|(?:kotlin\.collections\.)?(?:List|MutableList|Set|Map|Collection|Iterable|Sequence)<.*>|kotlinx\.collections\.immutable\.(?:Immutable|Persistent)(?:List|Set|Map)<.*>|\([^)]*\)->Unit)\??$/.test(
    clean
  );
}

function checkF005(kf, scaleHelpers, rawFindings, rawCandidates) {
  const { tokens, declarations, calls } = kf;

  // Seed literal file-level constants (`private const val PIXELS_PER_SECOND = 40f`)
  const fileLevelNonScaleConsts = new Set();
  for (const d of declarations) {
    if (d.kind === 'val' && d.delegateIdx === -1 && d.rhsStartIdx >= 0 && d.rhsStartIdx <= d.endTokIdx) {
      const isTopLevel = !declarations.some(
        (other) => other !== d && other.kind === 'fun' && other.startTokIdx < d.startTokIdx && other.endTokIdx >= d.endTokIdx
      );
      if (isTopLevel) {
        const rhsToks = tokens.slice(d.rhsStartIdx, d.endTokIdx + 1);
        const hasAnyIdent = rhsToks.some((t) => t.type === 'Identifier');
        if (!hasAnyIdent) {
          fileLevelNonScaleConsts.add(d.name);
        }
      }
    }
  }

  for (const c of calls) {
    // LottieAnimatable.animate(...) direct suspend call candidate
    if (c.name === 'animate' && c.receiver && /lottie|animatable/i.test(c.receiver) && c.hasParens) {
      rawCandidates.push(
        makeRuleCandidate('F-005', {
          file: kf.filePath,
          lines: [c.startLine, c.headerEndLine],
          evidence: `Direct \`${c.receiver}.animate(...)\` call detected.`,
          verificationHint: '`LottieAnimatable.animate()` declares `ignoreSystemAnimationsDisabled` without reading system animator duration scale internally; verify whether reduced-motion scale `0f` snaps to a readable rest frame or use `animateLottieCompositionAsState`.',
        })
      );
    }

    if (c.name !== 'LaunchedEffect' || !c.trailingLambda) continue;
    const bodyToks = c.trailingLambda.bodyTokens;
    if (bodyToks.length === 0) continue;

    const bodyStartIdx = c.trailingLambda.openBraceIdx + 1;
    const bodyEndIdx = c.trailingLambda.closeBraceIdx;

    // Look for a `while`, `do-while`, or `repeat(...)` inside this `LaunchedEffect` that calls `withFrameNanos`
    const loopWithFrameNanos = findLoopCallingWithFrameNanos(tokens, calls, bodyStartIdx, bodyEndIdx, c);
    if (!loopWithFrameNanos) continue;

    // 1. Direct scale read inside `LaunchedEffect` body?
    if (tokensReadDurationScale(bodyToks, calls)) continue;

    const bodyCalls = calls.filter((ic) => ic.nameTokIdx >= bodyStartIdx && ic.endTokIdx < bodyEndIdx);
    if (bodyCalls.some((ic) => scaleHelpers.has(ic.name))) continue;

    // 2. Collect enclosing function scope, local scale-derived bindings, and provably non-scale bindings
    const enclosingFns = c.enclosingDeclarations.filter((d) => d.kind === 'fun');
    const outerFn = enclosingFns[0] || null;
    const scanStartIdx = outerFn ? outerFn.startTokIdx : bodyStartIdx;
    const scanEndIdx = outerFn ? outerFn.endTokIdx : bodyEndIdx;

    const localScaleDerivedVars = new Set();
    const localKnownNonScaleVars = new Set(['Unit', 'true', 'false', 'null', 'isActive', ...fileLevelNonScaleConsts]);

    for (const fnDecl of enclosingFns) {
      const fnParamTypes = extractFunctionParamTypeMap(tokens, fnDecl);
      for (const [pName, pType] of fnParamTypes.entries()) {
        if (isProvablyNonScaleParamType(pType)) {
          localKnownNonScaleVars.add(pName);
        }
      }
    }

    const localVals = declarations.filter(
      (d) => (d.kind === 'val' || d.kind === 'var') && d.startTokIdx > scanStartIdx && d.endTokIdx <= scanEndIdx
    );

    // Collect simple `<ident> = <rhs>` assignments in `[scanStartIdx, scanEndIdx]`
    const localAssignments = collectSimpleAssignmentsInRange(tokens, scanStartIdx, scanEndIdx);

    // Fixed-point pass 1: propagate `localScaleDerivedVars` across `val`/`var` initializers and assignments
    for (let pass = 0; pass < 4; pass += 1) {
      let changed = false;
      for (const lv of localVals) {
        if (localScaleDerivedVars.has(lv.name)) continue;
        const lvToks = tokens.slice(lv.startTokIdx, lv.endTokIdx + 1);
        const lvCalls = calls.filter((ic) => ic.nameTokIdx >= lv.startTokIdx && ic.endTokIdx <= lv.endTokIdx);
        const refsScaleVar = lvToks.some(
          (t, idx) =>
            idx !== lv.nameIdx - lv.startTokIdx &&
            t.type === 'Identifier' &&
            isUnqualifiedLocalIdent(lvToks, idx) &&
            localScaleDerivedVars.has(t.value)
        );
        if (tokensReadDurationScale(lvToks, calls) || lvCalls.some((ic) => scaleHelpers.has(ic.name)) || refsScaleVar) {
          localScaleDerivedVars.add(lv.name);
          localKnownNonScaleVars.delete(lv.name);
          changed = true;
        }
      }
      for (const asgn of localAssignments) {
        if (localScaleDerivedVars.has(asgn.name)) continue;
        const asgnCalls = calls.filter((ic) => ic.nameTokIdx >= asgn.rhsStartIdx && ic.endTokIdx <= asgn.rhsEndIdx);
        const refsScaleVar = asgn.rhsToks.some(
          (t, idx) => t.type === 'Identifier' && isUnqualifiedLocalIdent(asgn.rhsToks, idx) && localScaleDerivedVars.has(t.value)
        );
        if (tokensReadDurationScale(asgn.rhsToks, calls) || asgnCalls.some((ic) => scaleHelpers.has(ic.name)) || refsScaleVar) {
          localScaleDerivedVars.add(asgn.name);
          localKnownNonScaleVars.delete(asgn.name);
          changed = true;
        }
      }
      if (!changed) break;
    }

    // Fixed-point pass 2: propagate `localKnownNonScaleVars` across purely literal / benign local `val`/`var` declarations
    for (let pass = 0; pass < 4; pass += 1) {
      let changed = false;
      for (const lv of localVals) {
        if (localScaleDerivedVars.has(lv.name) || localKnownNonScaleVars.has(lv.name)) continue;
        const rhsStart = lv.rhsStartIdx >= 0 ? lv.rhsStartIdx : lv.delegateIdx;
        if (rhsStart < 0 || rhsStart > lv.endTokIdx) continue;
        const initToks = tokens.slice(rhsStart, lv.endTokIdx + 1);
        const allInitIdentsBenign = initToks.every((t, idx) => {
          if (t.type !== 'Identifier') return true;
          if (!isUnqualifiedLocalIdent(initToks, idx)) return true;
          return BENIGN_STATE_WRAPPER_IDENTS.has(t.value) || localKnownNonScaleVars.has(t.value);
        });
        if (!allInitIdentsBenign) continue;

        if (lv.kind === 'var') {
          const writes = localAssignments.filter((a) => a.name === lv.name);
          const allWritesBenign = writes.every((w) =>
            w.rhsToks.every((t, idx) => {
              if (t.type !== 'Identifier') return true;
              if (!isUnqualifiedLocalIdent(w.rhsToks, idx)) return true;
              return (
                t.value === lv.name ||
                BENIGN_STATE_WRAPPER_IDENTS.has(t.value) ||
                localKnownNonScaleVars.has(t.value)
              );
            })
          );
          if (!allWritesBenign) continue;
        }

        localKnownNonScaleVars.add(lv.name);
        changed = true;
      }
      if (!changed) break;
    }

    // 3. Collect all gating conditions (`if`, `when`, `while`, `repeat`, early-return guards) across `enclosingFn` and `LaunchedEffect`
    const gatingSlices = collectF005GatingConditions(
      tokens,
      calls,
      scanStartIdx,
      scanEndIdx,
      c,
      loopWithFrameNanos.frameTokIdx
    );

    const allConditionAndKeySlices = [...gatingSlices, ...c.args.map((a) => a.tokens)];
    const respectsScaleViaGuardOrKey = allConditionAndKeySlices.some((slice) => {
      if (slice.length === 0) return false;
      if (tokensReadDurationScale(slice, calls)) return true;
      const sStart = slice[0].start;
      const sEnd = slice[slice.length - 1].end;
      if (calls.some((ic) => scaleHelpers.has(ic.name) && kf.tokens[ic.nameTokIdx].start >= sStart && kf.tokens[ic.nameTokIdx].end <= sEnd)) {
        return true;
      }
      return slice.some(
        (t, idx) =>
          t.type === 'Identifier' &&
          isUnqualifiedLocalIdent(slice, idx) &&
          (localScaleDerivedVars.has(t.value) || scaleHelpers.has(t.value))
      );
    });
    if (respectsScaleViaGuardOrKey) continue;

    // 4. Demote to candidate if any gating condition or `LaunchedEffect` key references an unresolved external symbol
    const unresolvedGuardSet = new Set();
    for (const slice of gatingSlices) {
      for (let idx = 0; idx < slice.length; idx += 1) {
        const t = slice[idx];
        if (
          t.type === 'Identifier' &&
          isUnqualifiedLocalIdent(slice, idx) &&
          !localKnownNonScaleVars.has(t.value) &&
          !BENIGN_STATE_WRAPPER_IDENTS.has(t.value)
        ) {
          unresolvedGuardSet.add(t.value);
        }
      }
    }
    for (const a of c.args) {
      for (let idx = 0; idx < a.tokens.length; idx += 1) {
        const t = a.tokens[idx];
        if (
          t.type === 'Identifier' &&
          isUnqualifiedLocalIdent(a.tokens, idx) &&
          !localKnownNonScaleVars.has(t.value) &&
          !BENIGN_STATE_WRAPPER_IDENTS.has(t.value)
        ) {
          unresolvedGuardSet.add(t.value);
        }
      }
    }

    const guardIdents = Array.from(unresolvedGuardSet);
    const symNames = c.enclosingDeclarations.map((d) => d.name);
    if (guardIdents.length > 0) {
      rawCandidates.push(
        makeRuleCandidate('F-005', {
          file: kf.filePath,
          lines: [c.startLine, c.endLine],
          evidence: `\`LaunchedEffect\` frame loop calls \`withFrameNanos\` without a local \`MotionDurationScale\` read, but is gated by external condition/key (${guardIdents.join(', ')}).`,
          verificationHint: 'Verify whether the gating condition/key reads `MotionDurationScale` or `ANIMATOR_DURATION_SCALE` and stops the loop when duration scale is `0f`.',
        })
      );
    } else {
      rawFindings.push(
        makeRuleFinding('F-005', {
          file: kf.filePath,
          lines: [c.startLine, c.endLine],
          evidence: `\`LaunchedEffect\` runs a \`${loopWithFrameNanos.kind}\` loop calling \`withFrameNanos\` (line ${loopWithFrameNanos.frameLine}) without reading \`MotionDurationScale\` or \`ANIMATOR_DURATION_SCALE\`.`,
          remediation: 'Read `coroutineContext[MotionDurationScale]?.scaleFactor ?: 1f` inside the loop; when `scaleFactor == 0f`, settle/idle instead of requesting 60/120Hz frames.',
          symbolContext: symNames,
        })
      );
    }
  }
}

function findLoopCallingWithFrameNanos(tokens, calls, startIdx, endIdx, launchedEffectCall) {
  // Check `while (...) { ... withFrameNanos ... }` and `do { ... withFrameNanos ... } while (...)`
  for (let i = startIdx; i < endIdx; i += 1) {
    const t = tokens[i];
    if (t.type === 'Keyword' && t.value === 'while' && tokens[i + 1]?.value === '(') {
      const closeCond = findMatchingForward(tokens, i + 1, '(', ')');
      if (closeCond !== -1 && tokens[closeCond + 1]?.value === '{') {
        const closeBody = findMatchingForward(tokens, closeCond + 1, '{', '}');
        if (closeBody !== -1) {
          const wfn = calls.find(
            (fc) =>
              fc.name === 'withFrameNanos' &&
              fc.nameTokIdx > closeCond + 1 &&
              fc.endTokIdx < closeBody &&
              nearestLaunchedEffect(fc) === launchedEffectCall
          );
          if (wfn) return { kind: 'while', frameLine: wfn.startLine, frameTokIdx: wfn.nameTokIdx };
        }
      }
      if (tokens[i - 1]?.value === '}') {
        const openDo = findMatchingBackward(tokens, i - 1, '{', '}');
        if (openDo !== -1 && tokens[openDo - 1]?.type === 'Keyword' && tokens[openDo - 1].value === 'do') {
          const wfn = calls.find(
            (fc) =>
              fc.name === 'withFrameNanos' &&
              fc.nameTokIdx > openDo &&
              fc.endTokIdx < i - 1 &&
              nearestLaunchedEffect(fc) === launchedEffectCall
          );
          if (wfn) return { kind: 'do-while', frameLine: wfn.startLine, frameTokIdx: wfn.nameTokIdx };
        }
      }
    }
  }
  // Check `repeat(...) { ... withFrameNanos ... }`
  for (const rc of calls) {
    if (rc.name === 'repeat' && rc.trailingLambda && rc.nameTokIdx >= startIdx && rc.endTokIdx <= endIdx) {
      const wfn = calls.find(
        (fc) =>
          fc.name === 'withFrameNanos' &&
          fc.nameTokIdx > rc.trailingLambda.openBraceIdx &&
          fc.endTokIdx < rc.trailingLambda.closeBraceIdx &&
          nearestLaunchedEffect(fc) === launchedEffectCall
      );
      if (wfn) return { kind: 'repeat', frameLine: wfn.startLine, frameTokIdx: wfn.nameTokIdx };
    }
  }
  return null;
}

function nearestLaunchedEffect(call) {
  return [...call.enclosingCalls].reverse().find((ec) => ec.name === 'LaunchedEffect') || null;
}

function findMatchingForward(tokens, openIdx, openSym, closeSym) {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i += 1) {
    if (tokens[i].type === 'Punct') {
      if (tokens[i].value === openSym) depth += 1;
      else if (tokens[i].value === closeSym) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

function extractFunctionParamTypeMap(tokens, fnDecl) {
  const out = new Map();
  if (!fnDecl.paramRange) return out;
  const [openP, closeP] = fnDecl.paramRange;
  const slice = tokens.slice(openP + 1, closeP);
  const paramSlices = [];
  let curStart = 0;
  let pDepth = 0;
  let bDepth = 0;
  let kDepth = 0;
  let tDepth = 0;
  let inType = false;

  for (let i = 0; i < slice.length; i += 1) {
    const t = slice[i];
    if (t.type === 'Punct') {
      if (t.value === '(') pDepth += 1;
      else if (t.value === ')') pDepth = Math.max(0, pDepth - 1);
      else if (t.value === '{') bDepth += 1;
      else if (t.value === '}') bDepth = Math.max(0, bDepth - 1);
      else if (t.value === '[') kDepth += 1;
      else if (t.value === ']') kDepth = Math.max(0, kDepth - 1);
      else if (pDepth === 0 && bDepth === 0 && kDepth === 0) {
        if (t.value === ':' && !inType) {
          inType = true;
          tDepth = 0;
        } else if (t.value === '=' && inType && tDepth === 0) {
          inType = false;
        } else if (inType && t.value === '<') {
          tDepth += 1;
        } else if (inType && t.value === '>') {
          tDepth = Math.max(0, tDepth - 1);
        } else if (t.value === ',' && !(inType && tDepth > 0)) {
          paramSlices.push(slice.slice(curStart, i));
          curStart = i + 1;
          inType = false;
          tDepth = 0;
        }
      }
    }
  }
  if (curStart < slice.length) {
    paramSlices.push(slice.slice(curStart));
  }

  for (const paramToks of paramSlices) {
    let pd = 0;
    let bd = 0;
    let kd = 0;
    let td = 0;
    let colonIdx = -1;
    let eqIdx = -1;
    for (let i = 0; i < paramToks.length; i += 1) {
      const t = paramToks[i];
      if (t.type === 'Punct') {
        if (t.value === '(') pd += 1;
        else if (t.value === ')') pd = Math.max(0, pd - 1);
        else if (t.value === '{') bd += 1;
        else if (t.value === '}') bd = Math.max(0, bd - 1);
        else if (t.value === '[') kd += 1;
        else if (t.value === ']') kd = Math.max(0, kd - 1);
        else if (pd === 0 && bd === 0 && kd === 0) {
          if (t.value === ':' && colonIdx === -1) colonIdx = i;
          else if (colonIdx !== -1 && eqIdx === -1 && t.value === '<') td += 1;
          else if (colonIdx !== -1 && eqIdx === -1 && t.value === '>') td = Math.max(0, td - 1);
          else if (colonIdx !== -1 && eqIdx === -1 && td === 0 && t.value === '=') {
            eqIdx = i;
            break;
          }
        }
      }
    }
    if (colonIdx > 0 && paramToks[colonIdx - 1]?.type === 'Identifier') {
      const paramName = paramToks[colonIdx - 1].value;
      const typeToks = paramToks
        .slice(colonIdx + 1, eqIdx === -1 ? paramToks.length : eqIdx)
        .filter((t) => t.type !== 'Annotation');
      out.set(paramName, typeToks.map((t) => t.raw).join(''));
    }
  }
  return out;
}

function findSingleStatementOrBlockRange(tokens, startIdx, limitIdx) {
  if (startIdx > limitIdx) return null;
  if (tokens[startIdx]?.type === 'Punct' && tokens[startIdx].value === '{') {
    const closeB = findMatchingForward(tokens, startIdx, '{', '}');
    return [startIdx, closeB !== -1 ? closeB : limitIdx];
  }
  let pDepth = 0;
  let bDepth = 0;
  let kDepth = 0;
  let lastIdx = startIdx;
  for (let i = startIdx; i <= limitIdx; i += 1) {
    const t = tokens[i];
    if (t.type === 'Punct') {
      if (t.value === '(') pDepth += 1;
      else if (t.value === ')') {
        if (pDepth === 0) break;
        pDepth -= 1;
      } else if (t.value === '{') bDepth += 1;
      else if (t.value === '}') {
        if (bDepth === 0) break;
        bDepth -= 1;
      } else if (t.value === '[') kDepth += 1;
      else if (t.value === ']') {
        if (kDepth === 0) break;
        kDepth -= 1;
      } else if (t.value === ';' && pDepth === 0 && bDepth === 0 && kDepth === 0) {
        break;
      }
    }
    lastIdx = i;
    const next = tokens[i + 1];
    if (!next || i + 1 > limitIdx) break;
    if (pDepth === 0 && bDepth === 0 && kDepth === 0 && next.line > t.endLine) {
      const curContinues =
        (t.type === 'Punct' && ['.', '?.', '?:', '=', '+', '-', '*', '/', '&&', '||', '==', '!=', '<', '>'].includes(t.value)) ||
        (t.type === 'Keyword' && (t.value === 'else' || t.value === 'by'));
      const nextContinues =
        (next.type === 'Punct' && ['.', '?.', '?:', '+', '&&', '||', '{'].includes(next.value)) ||
        (next.type === 'Keyword' && next.value === 'else');
      if (!curContinues && !nextContinues) break;
    }
  }
  return [startIdx, lastIdx];
}

function collectSimpleAssignmentsInRange(tokens, startIdx, endIdx) {
  const out = [];
  for (let i = startIdx; i <= endIdx - 2; i += 1) {
    if (
      tokens[i].type === 'Identifier' &&
      isUnqualifiedLocalIdent(tokens, i) &&
      tokens[i - 1]?.value !== 'val' &&
      tokens[i - 1]?.value !== 'var' &&
      tokens[i + 1]?.type === 'Punct' &&
      tokens[i + 1].value === '='
    ) {
      // Exclude named arguments (`foo(bar = baz)`) by checking enclosing delimiter is `{`, not `(`
      let pDepth = 0;
      let isNamedArg = false;
      for (let j = i - 1; j >= startIdx; j -= 1) {
        const pt = tokens[j];
        if (pt.type === 'Punct') {
          if (pt.value === ')' || pt.value === ']') pDepth += 1;
          else if (pt.value === '(' || pt.value === '[') {
            if (pDepth === 0) {
              isNamedArg = pt.value === '(';
              break;
            }
            pDepth -= 1;
          } else if (pt.value === '{' && pDepth === 0) {
            break;
          } else if (pt.value === '}' && pDepth === 0) {
            j = findMatchingBackward(tokens, j, '{', '}');
            if (j === -1) break;
          }
        }
      }
      if (isNamedArg) continue;
      const rhsRange = findSingleStatementOrBlockRange(tokens, i + 2, endIdx);
      if (rhsRange) {
        out.push({
          name: tokens[i].value,
          rhsStartIdx: rhsRange[0],
          rhsEndIdx: rhsRange[1],
          rhsToks: tokens.slice(rhsRange[0], rhsRange[1] + 1),
        });
      }
    }
  }
  return out;
}

function rangeHasControlExit(tokens, range, exitKeywords) {
  if (!range) return false;
  const [startIdx, endIdx] = range;
  for (let i = startIdx; i <= endIdx; i += 1) {
    const t = tokens[i];
    if (t.type === 'Keyword' && exitKeywords.includes(t.value)) {
      return true;
    }
  }
  return false;
}

function idxInsideRange(idx, range) {
  return Boolean(range && idx >= range[0] && idx <= range[1]);
}

function sharesBraceScopeWithTarget(tokens, guardIdx, targetIdx, scopeStartIdx, scopeEndIdx) {
  const [encOpen, encClose] = findEnclosingBraceScope(tokens, guardIdx, scopeStartIdx, scopeEndIdx);
  void encOpen;
  return targetIdx > guardIdx && targetIdx <= encClose;
}

function collectF005GatingConditions(tokens, calls, scanStartIdx, scanEndIdx, effectCall, frameTokIdx) {
  const slices = [];
  const effectTokIdx = effectCall.nameTokIdx;
  const bodyStartIdx = effectCall.trailingLambda.openBraceIdx + 1;
  const bodyEndIdx = effectCall.trailingLambda.closeBraceIdx;

  for (let i = scanStartIdx; i < bodyEndIdx; i += 1) {
    const t = tokens[i];

    // 1. `if (<cond>) <then> [else <else>]`
    if (t.type === 'Keyword' && t.value === 'if' && tokens[i + 1]?.value === '(') {
      const closeCond = findMatchingForward(tokens, i + 1, '(', ')');
      if (closeCond === -1) continue;
      const condSlice = tokens.slice(i + 2, closeCond);
      const thenRange = findSingleStatementOrBlockRange(tokens, closeCond + 1, scanEndIdx);
      if (!thenRange) continue;
      let elseRange = null;
      if (tokens[thenRange[1] + 1]?.type === 'Keyword' && tokens[thenRange[1] + 1].value === 'else') {
        elseRange = findSingleStatementOrBlockRange(tokens, thenRange[1] + 2, scanEndIdx);
      }

      const enclosesTarget =
        idxInsideRange(effectTokIdx, thenRange) ||
        idxInsideRange(frameTokIdx, thenRange) ||
        idxInsideRange(effectTokIdx, elseRange) ||
        idxInsideRange(frameTokIdx, elseRange);

      const earlyExitsBeforeEffect =
        thenRange[1] < effectTokIdx &&
        sharesBraceScopeWithTarget(tokens, i, effectTokIdx, scanStartIdx, scanEndIdx) &&
        (rangeHasControlExit(tokens, thenRange, ['return']) || rangeHasControlExit(tokens, elseRange, ['return']));

      const earlyExitsBeforeFrame =
        i >= bodyStartIdx &&
        thenRange[1] < frameTokIdx &&
        sharesBraceScopeWithTarget(tokens, i, frameTokIdx, bodyStartIdx - 1, bodyEndIdx) &&
        (rangeHasControlExit(tokens, thenRange, ['return', 'break', 'continue']) ||
          rangeHasControlExit(tokens, elseRange, ['return', 'break', 'continue']));

      if (enclosesTarget || earlyExitsBeforeEffect || earlyExitsBeforeFrame) {
        slices.push(condSlice);
      }
      continue;
    }

    // 2. `while (<cond>)` (both standard `while` and `do { ... } while (<cond>)`)
    if (t.type === 'Keyword' && t.value === 'while' && tokens[i + 1]?.value === '(') {
      const closeCond = findMatchingForward(tokens, i + 1, '(', ')');
      if (closeCond === -1) continue;
      const condSlice = tokens.slice(i + 2, closeCond);
      const bodyRange = findSingleStatementOrBlockRange(tokens, closeCond + 1, scanEndIdx);
      let encloses = idxInsideRange(frameTokIdx, bodyRange) || idxInsideRange(effectTokIdx, bodyRange);
      if (!encloses && tokens[i - 1]?.value === '}') {
        const openDo = findMatchingBackward(tokens, i - 1, '{', '}');
        if (openDo !== -1 && tokens[openDo - 1]?.value === 'do' && frameTokIdx > openDo && frameTokIdx < i - 1) {
          encloses = true;
        }
      }
      if (encloses) {
        slices.push(condSlice);
      }
      continue;
    }

    // 3. `when [(<subj>)] { <branch> -> ... }`
    if (t.type === 'Keyword' && t.value === 'when') {
      let cursor = i + 1;
      let subjSlice = null;
      if (tokens[cursor]?.value === '(') {
        const closeSubj = findMatchingForward(tokens, cursor, '(', ')');
        if (closeSubj === -1) continue;
        subjSlice = tokens.slice(cursor + 1, closeSubj);
        cursor = closeSubj + 1;
      }
      if (tokens[cursor]?.value !== '{') continue;
      const closeWhen = findMatchingForward(tokens, cursor, '{', '}');
      if (closeWhen === -1) continue;
      const whenRange = [cursor, closeWhen];

      const enclosesTarget = idxInsideRange(effectTokIdx, whenRange) || idxInsideRange(frameTokIdx, whenRange);
      const earlyExitsBeforeEffect =
        closeWhen < effectTokIdx &&
        sharesBraceScopeWithTarget(tokens, i, effectTokIdx, scanStartIdx, scanEndIdx) &&
        rangeHasControlExit(tokens, whenRange, ['return']);
      const earlyExitsBeforeFrame =
        i >= bodyStartIdx &&
        closeWhen < frameTokIdx &&
        sharesBraceScopeWithTarget(tokens, i, frameTokIdx, bodyStartIdx - 1, bodyEndIdx) &&
        rangeHasControlExit(tokens, whenRange, ['return', 'break', 'continue']);

      if (enclosesTarget || earlyExitsBeforeEffect || earlyExitsBeforeFrame) {
        if (subjSlice && subjSlice.length > 0) slices.push(subjSlice);
        // Extract top-level branch LHS conditions before `->` inside `when { ... }`
        let bDepth = 0;
        let pDepth = 0;
        let branchStart = cursor + 1;
        for (let k = cursor + 1; k < closeWhen; k += 1) {
          const bt = tokens[k];
          if (bt.type === 'Punct') {
            if (bt.value === '{') bDepth += 1;
            else if (bt.value === '}') bDepth = Math.max(0, bDepth - 1);
            else if (bt.value === '(') pDepth += 1;
            else if (bt.value === ')') pDepth = Math.max(0, pDepth - 1);
            else if (bt.value === '->' && bDepth === 0 && pDepth === 0) {
              const lhs = tokens.slice(branchStart, k).filter((x) => !(x.type === 'Keyword' && x.value === 'else'));
              if (lhs.length > 0) slices.push(lhs);
              const rhsRange = findSingleStatementOrBlockRange(tokens, k + 1, closeWhen - 1);
              if (rhsRange) {
                k = rhsRange[1];
                branchStart = k + 1;
              } else {
                branchStart = k + 1;
              }
            }
          }
        }
      }
    }
  }

  // 4. `repeat(<count>) { ... withFrameNanos ... }` count expression
  for (const rc of calls) {
    if (
      rc.name === 'repeat' &&
      rc.trailingLambda &&
      rc.nameTokIdx >= bodyStartIdx &&
      rc.endTokIdx <= bodyEndIdx &&
      frameTokIdx > rc.trailingLambda.openBraceIdx &&
      frameTokIdx < rc.trailingLambda.closeBraceIdx &&
      rc.args[0]
    ) {
      slices.push(rc.args[0].tokens);
    }
  }

  return slices;
}

function checkF006(kf, rawFindings, rawCandidates) {
  const { tokens, calls, declarations } = kf;
  const reportedAnimateCalls = new Set();

  // Pattern B: Elevated `Card` / `ElevatedCard` / `OutlinedCard` / `Surface` whose modifier has `.animateContentSize()`
  for (const container of calls) {
    if (!ELEVATED_CONTAINERS.has(container.name) || !container.hasParens) continue;
    if (!isTopLevelOrAndroidxQualifiedCall(tokens, container)) continue;
    if (declarations.some((d) => d.kind === 'fun' && d.name === container.name)) continue;

    const modArg = findContainerModifierArg(container);
    if (!modArg) continue;

    const modCheck = findAnimateContentSizeInModifierExpr(tokens, calls, modArg.tokens);
    if (!modCheck.proven && !modCheck.candidate) continue;

    const elevClass = classifyContainerElevation(tokens, calls, container);
    if (elevClass === 'zero') continue;

    if (elevClass === 'nonzero' && modCheck.proven) {
      reportedAnimateCalls.add(modCheck.proven);
      rawFindings.push(
        makeRuleFinding('F-006', {
          file: kf.filePath,
          lines: [container.startLine, container.endLine],
          evidence: `\`${container.name}\` applies \`Modifier.animateContentSize()\` (line ${modCheck.proven.startLine}) alongside non-zero elevation, clipping its shadow.`,
          remediation: 'Apply shadow/elevation on an outer wrapper outside `animateContentSize()`, or animate size inside the elevated surface body.',
          symbolContext: container.enclosingDeclarations.map((d) => d.name),
        })
      );
    } else {
      const animRef = modCheck.proven || modCheck.candidate;
      reportedAnimateCalls.add(animRef);
      if (rawCandidates) {
        rawCandidates.push(
          makeRuleCandidate('F-006', {
            file: kf.filePath,
            lines: [container.startLine, container.endLine],
            evidence: `\`${container.name}\` combines \`animateContentSize()\` (line ${animRef.startLine}) with conditional or unresolved elevation.`,
            verificationHint: 'Check whether this container has non-zero shadow elevation while `animateContentSize()` runs; if so, move elevation outside `animateContentSize()`.',
          })
        );
      }
    }
  }

  // Pattern A: Modifier chain combining non-zero `.shadow(...)` and `.animateContentSize(...)`
  for (const animCall of calls) {
    if (animCall.name !== 'animateContentSize' || !animCall.receiver || !animCall.hasParens) continue;
    if (reportedAnimateCalls.has(animCall)) continue;

    const chainCalls = findModifierChainCalls(tokens, calls, animCall);
    const animPos = chainCalls.indexOf(animCall);
    const shadowCalls = chainCalls.filter((cc) => cc.name === 'shadow' && cc.receiver && cc.hasParens);
    if (shadowCalls.length === 0) continue;

    let emittedFinding = false;
    for (const shadowCall of shadowCalls) {
      const shadowPos = chainCalls.indexOf(shadowCall);
      if (animPos >= shadowPos) continue;
      const elevClass = classifyShadowCallElevation(tokens, calls, shadowCall);
      if (elevClass === 'nonzero' && !hasSafeCallInReceiverChain(tokens, shadowCall)) {
        // `.animateContentSize().shadow(8.dp)` -> outer `clipToBounds` provably clips inner `shadow`!
        rawFindings.push(
          makeRuleFinding('F-006', {
            file: kf.filePath,
            lines: [chainCalls[0].chainStartLine, chainCalls[chainCalls.length - 1].endLine],
            evidence: `Modifier chain applies \`animateContentSize()\` outer to \`shadow(${shadowCall.args.map((a) => a.rawText).join(', ')})\`, clipping the drop shadow.`,
            remediation: 'Move `Modifier.shadow(...)` outside `animateContentSize()` (for example onto an outer wrapper composable).',
            symbolContext: animCall.enclosingDeclarations.map((d) => d.name),
          })
        );
        emittedFinding = true;
        break;
      }
    }
    if (emittedFinding || !rawCandidates) continue;

    for (const shadowCall of shadowCalls) {
      const elevClass = classifyShadowCallElevation(tokens, calls, shadowCall);
      if (elevClass === 'zero') continue;

      const shadowPos = chainCalls.indexOf(shadowCall);
      if (animPos < shadowPos) {
        rawCandidates.push(
          makeRuleCandidate('F-006', {
            file: kf.filePath,
            lines: [chainCalls[0].chainStartLine, chainCalls[chainCalls.length - 1].endLine],
            evidence: `Modifier chain applies \`animateContentSize()\` outer to \`shadow(${shadowCall.args.map((a) => a.rawText).join(', ')})\` with unresolved or conditional elevation.`,
            verificationHint: 'Check whether the `shadow(...)` elevation can be greater than `0.dp`; if so, move `Modifier.shadow(...)` outside `animateContentSize()`.',
          })
        );
        break;
      } else if (shadowPos < animPos) {
        // `.shadow(8.dp).animateContentSize()` -> `shadow` layer sits outside `animateContentSize`'s `clipToBounds`,
        // so do not emit a blocking finding; emit a candidate only when no proven all-sides padding separates them.
        const separatedByPadding = chainCalls
          .slice(shadowPos + 1, animPos)
          .some((cc) => cc.name === 'padding' && isProvenAllSidesNonZeroPadding(tokens, calls, cc));
        if (!separatedByPadding) {
          rawCandidates.push(
            makeRuleCandidate('F-006', {
              file: kf.filePath,
              lines: [chainCalls[0].chainStartLine, chainCalls[chainCalls.length - 1].endLine],
              evidence: `Modifier chain combines \`shadow(${shadowCall.args.map((a) => a.rawText).join(', ')})\` and \`animateContentSize()\`.`,
              verificationHint: 'Confirm `animateContentSize()` does not clip an inner elevated surface, ripple, or exiting child; if clipping occurs, separate `Modifier.shadow(...)` onto an outer wrapper.',
            })
          );
          break;
        }
      }
    }
  }
}

function findContainerModifierArg(container) {
  const named = container.args.find((a) => a.name === 'modifier');
  if (named) return named;
  // In M3 `Card(modifier = ...)` / `Surface(modifier = ...)`, non-clickable overload has `modifier` at index 0;
  // clickable overload `Card(onClick = ..., modifier = ...)` has `onClick` at index 0 and `modifier` at index 1.
  const arg0 = container.args[0];
  if (!arg0) return null;
  if (arg0.name === null) {
    const stripped0 = stripOuterParensTokens(arg0.tokens);
    const isLambda0 = stripped0[0]?.type === 'Punct' && stripped0[0].value === '{';
    if (!isLambda0) {
      const looksLikeModifier = stripped0.some(
        (t) => t.type === 'Identifier' && (t.value === 'Modifier' || t.value === 'modifier' || t.value === 'animateContentSize')
      );
      if (looksLikeModifier) return arg0;
    }
    const arg1 = container.args[1];
    if (arg1 && arg1.name === null) {
      const stripped1 = stripOuterParensTokens(arg1.tokens);
      if (!(stripped1[0]?.type === 'Punct' && stripped1[0].value === '{')) {
        return arg1;
      }
    }
  }
  return null;
}

function findAnimateContentSizeInModifierExpr(tokens, calls, modToks) {
  const stripped = stripOuterParensTokens(modToks);
  if (stripped.length === 0) return { proven: null, candidate: null };

  const provenCall = findProvenAnimateContentSizeOnChain(tokens, calls, stripped);
  if (provenCall) return { proven: provenCall, candidate: null };

  const firstTok = stripped[0];
  const lastTok = stripped[stripped.length - 1];
  const fallback =
    calls.find(
      (c) =>
        c.name === 'animateContentSize' &&
        c.receiver &&
        c.hasParens &&
        tokens[c.nameTokIdx].start >= firstTok.start &&
        tokens[c.endTokIdx].end <= lastTok.end
    ) || null;
  return { proven: null, candidate: fallback };
}

function findProvenAnimateContentSizeOnChain(tokens, calls, rawToks) {
  const topCall = findDirectTopLevelCall(tokens, calls, rawToks);
  if (!topCall || hasSafeCallInReceiverChain(tokens, topCall)) return null;

  const chainCalls = findModifierChainCalls(tokens, calls, topCall);
  for (const cc of chainCalls) {
    if (cc.name === 'animateContentSize' && cc.receiver && cc.hasParens) {
      return cc;
    }
    if (cc.name === 'then' && cc.receiver && cc.hasParens && cc.args.length === 1 && !cc.trailingLambda) {
      const nested = findProvenAnimateContentSizeOnChain(tokens, calls, cc.args[0].tokens);
      if (nested) return nested;
    }
  }
  return null;
}

const CARD_ELEVATION_FACTORY_NAMES = new Set([
  'elevatedCardElevation',
  'cardElevation',
  'outlinedCardElevation',
]);

function isCardDefaultsOrUnqualifiedCall(tokens, call) {
  if (!call) return false;
  if (!call.receiver && call.chainRootIdx === call.nameTokIdx) return true;
  const prefix = tokens.slice(call.chainRootIdx, call.nameTokIdx);
  if (prefix.length < 2) return false;
  const isDotChain = prefix.every((t, idx) =>
    idx % 2 === 0 ? t.type === 'Identifier' : t.type === 'Punct' && t.value === '.'
  );
  if (!isDotChain) return false;
  const lastReceiver = prefix[prefix.length - 2];
  return lastReceiver?.type === 'Identifier' && lastReceiver.value === 'CardDefaults';
}

function classifyContainerElevation(tokens, calls, container) {
  // Never confuse `tonalElevation` (color overlay, no shadow clip) with `elevation` / `shadowElevation`
  let elevArg = container.args.find((a) => a.name === 'elevation' || a.name === 'shadowElevation');
  if (!elevArg) {
    elevArg = container.args.find((a) => {
      if (a.name !== null) return false;
      const top = findDirectTopLevelCall(tokens, calls, a.tokens);
      return Boolean(top && CARD_ELEVATION_FACTORY_NAMES.has(top.name) && isCardDefaultsOrUnqualifiedCall(tokens, top));
    });
  }
  if (!elevArg) {
    // `ElevatedCard` has default non-zero elevation (1.dp); `Card`, `OutlinedCard`, `Surface` default to `0.dp`
    return container.name === 'ElevatedCard' ? 'nonzero' : 'zero';
  }

  let elevClass = classifyElevationExpr(tokens, calls, elevArg.tokens);
  if (elevClass === 'nonzero') {
    const enabledArg = container.args.find((a) => a.name === 'enabled');
    if (enabledArg) {
      const strippedEnabled = stripOuterParensTokens(enabledArg.tokens);
      const isLiteralTrue =
        strippedEnabled.length === 1 &&
        strippedEnabled[0].type === 'Keyword' &&
        strippedEnabled[0].value === 'true';
      if (!isLiteralTrue) {
        const topElevCall = findDirectTopLevelCall(tokens, calls, elevArg.tokens);
        const disabledArg = topElevCall ? getCallArg(topElevCall, 'disabledElevation', 5) : null;
        if (disabledArg && classifyElevationExpr(tokens, calls, disabledArg.tokens) !== 'nonzero') {
          elevClass = 'unknown';
        }
      }
    }
  }
  return elevClass;
}

function classifyShadowCallElevation(tokens, calls, call) {
  if (!call.hasParens || call.args.length === 0) return 'unknown';
  const elevArg = getCallArg(call, 'elevation', 0);
  if (!elevArg) return 'unknown';
  return classifyElevationExpr(tokens, calls, elevArg.tokens);
}

function isProvenAllSidesNonZeroPadding(tokens, calls, call) {
  if (!call.hasParens || call.args.length === 0) return false;
  const allArg = getCallArg(call, 'all', 0);
  if (allArg && call.args.length === 1) {
    return classifyElevationExpr(tokens, calls, allArg.tokens) === 'nonzero';
  }
  const hArg = call.args.find((a) => a.name === 'horizontal');
  const vArg = call.args.find((a) => a.name === 'vertical');
  if (hArg && vArg) {
    return (
      classifyElevationExpr(tokens, calls, hArg.tokens) === 'nonzero' &&
      classifyElevationExpr(tokens, calls, vArg.tokens) === 'nonzero'
    );
  }
  const sideNames = ['start', 'top', 'end', 'bottom'];
  if (sideNames.every((n) => call.args.some((a) => a.name === n))) {
    return sideNames.every((n) => {
      const arg = call.args.find((a) => a.name === n);
      return arg && classifyElevationExpr(tokens, calls, arg.tokens) === 'nonzero';
    });
  }
  return false;
}

function parseKotlinNumericLiteral(numTok) {
  if (!numTok || numTok.type !== 'NumberLiteral') return null;
  const raw = String(numTok.raw || '').replace(/_/g, '');
  if (!raw) return null;
  let cleaned = raw;
  if (/^0[xX][0-9a-fA-F]+[uUlL]*$/.test(raw) || /^0[bB][01]+[uUlL]*$/.test(raw)) {
    cleaned = raw.replace(/[uUlL]+$/, '');
  } else {
    cleaned = raw.replace(/[fFdDuUlL]+$/, '');
  }
  if (!cleaned) return null;
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : null;
}

function evalConstantDpExpr(tokens, calls, rawToks) {
  const stripped = stripOuterParensTokens(rawToks);
  if (stripped.length === 0) return null;

  // 1. Lowest-precedence binary `+` / `-` (right-to-left scan for left-associative evaluation)
  let pDepth = 0;
  let bDepth = 0;
  let kDepth = 0;
  for (let i = stripped.length - 1; i >= 0; i -= 1) {
    const t = stripped[i];
    if (t.type === 'Punct') {
      if (t.value === ')') pDepth += 1;
      else if (t.value === '(') pDepth = Math.max(0, pDepth - 1);
      else if (t.value === '}') bDepth += 1;
      else if (t.value === '{') bDepth = Math.max(0, bDepth - 1);
      else if (t.value === ']') kDepth += 1;
      else if (t.value === '[') kDepth = Math.max(0, kDepth - 1);
      else if (pDepth === 0 && bDepth === 0 && kDepth === 0 && i > 0 && (t.value === '+' || t.value === '-')) {
        const prev = stripped[i - 1];
        const isBinary = canTokenEndExpression(prev);
        if (isBinary) {
          const left = evalConstantDpExpr(tokens, calls, stripped.slice(0, i));
          const right = evalConstantDpExpr(tokens, calls, stripped.slice(i + 1));
          if (!left || !right || left.kind !== right.kind) return null;
          const value = t.value === '+' ? left.value + right.value : left.value - right.value;
          return Number.isFinite(value) ? { kind: left.kind, value } : null;
        }
      }
    }
  }

  // 2. Multiplicative `*` / `/` (right-to-left scan for left-associative evaluation)
  pDepth = 0;
  bDepth = 0;
  kDepth = 0;
  for (let i = stripped.length - 1; i >= 0; i -= 1) {
    const t = stripped[i];
    if (t.type === 'Punct') {
      if (t.value === ')') pDepth += 1;
      else if (t.value === '(') pDepth = Math.max(0, pDepth - 1);
      else if (t.value === '}') bDepth += 1;
      else if (t.value === '{') bDepth = Math.max(0, bDepth - 1);
      else if (t.value === ']') kDepth += 1;
      else if (t.value === '[') kDepth = Math.max(0, kDepth - 1);
      else if (pDepth === 0 && bDepth === 0 && kDepth === 0 && i > 0 && (t.value === '*' || t.value === '/')) {
        const left = evalConstantDpExpr(tokens, calls, stripped.slice(0, i));
        const right = evalConstantDpExpr(tokens, calls, stripped.slice(i + 1));
        if (!left || !right) return null;
        if (t.value === '*') {
          if (left.kind === 'dp' && right.kind === 'scalar') {
            const value = left.value * right.value;
            return Number.isFinite(value) ? { kind: 'dp', value } : null;
          }
          if (left.kind === 'scalar' && right.kind === 'dp') {
            const value = left.value * right.value;
            return Number.isFinite(value) ? { kind: 'dp', value } : null;
          }
          if (left.kind === 'scalar' && right.kind === 'scalar') {
            const value = left.value * right.value;
            return Number.isFinite(value) ? { kind: 'scalar', value } : null;
          }
          return null;
        }
        if (t.value === '/' && right.kind === 'scalar' && right.value !== 0) {
          const value = left.value / right.value;
          return Number.isFinite(value) ? { kind: left.kind, value } : null;
        }
        return null;
      }
    }
  }

  // 3. Unary `+` / `-`
  if (stripped.length >= 2 && stripped[0].type === 'Punct' && (stripped[0].value === '+' || stripped[0].value === '-')) {
    const inner = evalConstantDpExpr(tokens, calls, stripped.slice(1));
    if (!inner) return null;
    const value = stripped[0].value === '-' ? -inner.value : inner.value;
    return Number.isFinite(value) ? { kind: inner.kind, value } : null;
  }

  // 4. Pure scalar literal `0`, `2`, `0.5f`
  if (stripped.length === 1 && stripped[0].type === 'NumberLiteral') {
    const val = parseKotlinNumericLiteral(stripped[0]);
    return val !== null ? { kind: 'scalar', value: val } : null;
  }

  // 5. Pure `.dp` literal `8.dp`, `4.5f.dp`, `0.dp`
  if (
    stripped.length === 3 &&
    stripped[0].type === 'NumberLiteral' &&
    stripped[1].type === 'Punct' &&
    stripped[1].value === '.' &&
    stripped[2].type === 'Identifier' &&
    stripped[2].value === 'dp'
  ) {
    const val = parseKotlinNumericLiteral(stripped[0]);
    return val !== null ? { kind: 'dp', value: val } : null;
  }

  // 6. `Dp.Zero`, `Dp.Unspecified`, `Dp.Hairline`
  if (
    stripped.length === 3 &&
    stripped[0].type === 'Identifier' &&
    stripped[0].value === 'Dp' &&
    stripped[1].type === 'Punct' &&
    stripped[1].value === '.' &&
    stripped[2].type === 'Identifier'
  ) {
    if (stripped[2].value === 'Zero' || stripped[2].value === 'Unspecified' || stripped[2].value === 'Hairline') {
      return { kind: 'dp', value: 0 };
    }
  }

  // 7. `Dp(<const scalar>)`
  const topCall = findDirectTopLevelCall(tokens, calls, stripped);
  if (
    topCall &&
    topCall.name === 'Dp' &&
    isTopLevelOrAndroidxQualifiedCall(tokens, topCall) &&
    topCall.hasParens &&
    !topCall.trailingLambda &&
    topCall.args.length === 1 &&
    topCall.args[0].name === null
  ) {
    const inner = evalConstantDpExpr(tokens, calls, topCall.args[0].tokens);
    if (inner?.kind === 'scalar') {
      return { kind: 'dp', value: inner.value };
    }
  }

  return null;
}

function classifyElevationExpr(tokens, calls, rawToks) {
  const stripped = stripOuterParensTokens(rawToks);
  if (stripped.length === 0) return 'unknown';

  const constEval = evalConstantDpExpr(tokens, calls, stripped);
  if (constEval?.kind === 'dp') {
    return constEval.value > 0 ? 'nonzero' : 'zero';
  }

  const topCall = findDirectTopLevelCall(tokens, calls, stripped);
  if (
    topCall &&
    topCall.hasParens &&
    !topCall.trailingLambda &&
    CARD_ELEVATION_FACTORY_NAMES.has(topCall.name) &&
    isCardDefaultsOrUnqualifiedCall(tokens, topCall)
  ) {
    const defArg = getCallArg(topCall, 'defaultElevation', 0);
    const defaultFallback = topCall.name === 'elevatedCardElevation' ? 'nonzero' : 'zero';
    const defClass = defArg ? classifyElevationExpr(tokens, calls, defArg.tokens) : defaultFallback;
    if (defClass === 'zero') {
      const anyInteractiveNonZeroOrUnknown = topCall.args.some(
        (a) => a !== defArg && classifyElevationExpr(tokens, calls, a.tokens) !== 'zero'
      );
      return anyInteractiveNonZeroOrUnknown ? 'unknown' : 'zero';
    }
    return defClass;
  }

  return 'unknown';
}

function findModifierChainCalls(tokens, calls, memberCall) {
  const rootIdx = memberCall.chainRootIdx;
  // All calls sharing the exact same chainRootIdx, sorted by token position
  return calls
    .filter((c) => c.chainRootIdx === rootIdx)
    .sort((a, b) => a.nameTokIdx - b.nameTokIdx);
}

function isNonAndroidxNavSymbol(kf, symbolName) {
  if (kf.declarations.some((d) => d.kind === 'fun' && d.name === symbolName)) {
    return true;
  }
  const imports = kf.imports || [];
  if (imports.length === 0) return false;
  return !imports.some(
    (imp) => imp.startsWith('androidx.navigation.') || imp.startsWith('androidx.navigation3.')
  );
}

function checkT001(kf, conventionContext, fileMotionMd, rawFindings, rawCandidates) {
  for (const c of kf.calls) {
    if (c.name === 'NavHost' && c.hasParens && c.trailingLambda && c.args.length >= 2) {
      if (isNonAndroidxNavSymbol(kf, 'NavHost')) continue;
      const enterArg = getCallArg(c, 'enterTransition', 5);
      const exitArg = getCallArg(c, 'exitTransition', 6);
      const hasEnter = Boolean(enterArg && enterArg.text !== 'null');
      const hasExit = Boolean(exitArg && exitArg.text !== 'null');
      if (!hasEnter || !hasExit) {
        const hasEstablishedConvention =
          conventionContext.hasMotionTokens ||
          Boolean(fileMotionMd && (fileMotionMd.definesNavigationTransitions || fileMotionMd.specs.length > 0));
        const severity = hasEstablishedConvention ? 'major' : 'minor';
        const severityBasis = hasEstablishedConvention
          ? 'motion-tokens-or-contract-present'
          : 'no-established-convention-in-scanned-set';
        const missing = !hasEnter && !hasExit
          ? '`enterTransition` and `exitTransition`'
          : !hasEnter
            ? '`enterTransition`'
            : '`exitTransition`';

        const inlineComposables = kf.calls.filter(
          (inner) =>
            inner.name === 'composable' &&
            (inner.hasParens || Boolean(inner.trailingLambda)) &&
            inner.nameTokIdx > c.trailingLambda.openBraceIdx &&
            inner.endTokIdx < c.trailingLambda.closeBraceIdx
        );
        const hasPerDestinationOverride = inlineComposables.some(
          (inner) =>
            inner.hasParens &&
            inner.args.some((a) => (a.name === 'enterTransition' || a.name === 'exitTransition') && a.text !== 'null')
        );
        const directBuilderCalls = kf.calls.filter(
          (inner) =>
            inner !== c &&
            inner.nameTokIdx > c.trailingLambda.openBraceIdx &&
            inner.endTokIdx < c.trailingLambda.closeBraceIdx &&
            inner.enclosingCalls[inner.enclosingCalls.length - 1] === c
        );
        const delegatesOnlyToSubgraphBuilders = inlineComposables.length === 0 && directBuilderCalls.length > 0;

        if ((hasPerDestinationOverride || delegatesOnlyToSubgraphBuilders) && rawCandidates) {
          rawCandidates.push(
            makeRuleCandidate('T-001', {
              file: kf.filePath,
              lines: [c.startLine, c.endLine],
              severity,
              evidence: hasPerDestinationOverride
                ? `\`NavHost\` omits host-level ${missing}; one or more inner \`composable(...)\` destinations supply per-route transitions.`
                : `\`NavHost\` omits host-level ${missing} and delegates route registration to subgraph builder call(s) (${directBuilderCalls.map((dc) => dc.name).join(', ')}).`,
              verificationHint: 'Check whether every destination in this `NavHost` supplies explicit transitions or whether unconfigured routes still inherit the 700ms default crossfade.',
            })
          );
          continue;
        }

        rawFindings.push(
          makeRuleFinding('T-001', {
            file: kf.filePath,
            lines: [c.startLine, c.endLine],
            severity,
            severityBasis,
            evidence: `\`NavHost\` omits ${missing} and inherits the 700ms default crossfade.`,
            remediation: 'Specify explicit `enterTransition`, `exitTransition`, `popEnterTransition`, and `popExitTransition` bound to `MaterialTheme.motionScheme` or your project\'s `MOTION.md` specs.',
            symbolContext: c.enclosingDeclarations.map((d) => d.name),
          })
        );
      }
    } else if (c.name === 'NavDisplay' && c.hasParens) {
      if (isNonAndroidxNavSymbol(kf, 'NavDisplay')) continue;
      const specArg = getCallArg(c, 'transitionSpec', 7);
      const hasSpec = Boolean(specArg && specArg.text !== 'null');
      if (!hasSpec) {
        const hasEstablishedConvention =
          conventionContext.hasMotionTokens ||
          Boolean(fileMotionMd && (fileMotionMd.definesNavigationTransitions || fileMotionMd.specs.length > 0));
        const severity = hasEstablishedConvention ? 'major' : 'minor';
        const severityBasis = hasEstablishedConvention
          ? 'motion-tokens-or-contract-present'
          : 'no-established-convention-in-scanned-set';

        // Check for per-entry `NavDisplay.transitionSpec` metadata inside `NavDisplay` args or trailing lambda
        const hasPerEntryTransitionSpec = kf.calls.some(
          (inner) =>
            inner !== c &&
            (inner.name === 'transitionSpec' || inner.name === 'popTransitionSpec' || inner.name === 'predictivePopTransitionSpec') &&
            inner.nameTokIdx > c.nameTokIdx &&
            inner.endTokIdx <= c.endTokIdx
        );
        const entryProviderArg = c.args.find((a) => a.name === 'entryProvider');
        const hasExternalEntryProvider =
          !c.trailingLambda &&
          Boolean(entryProviderArg && !entryProviderArg.tokens.some((t) => t.value === '{'));

        if ((hasPerEntryTransitionSpec || hasExternalEntryProvider) && rawCandidates) {
          rawCandidates.push(
            makeRuleCandidate('T-001', {
              file: kf.filePath,
              lines: [c.startLine, c.endLine],
              severity,
              evidence: hasPerEntryTransitionSpec
                ? 'Navigation 3 `NavDisplay` omits top-level `transitionSpec`, while inner entry metadata defines per-entry `transitionSpec`.'
                : 'Navigation 3 `NavDisplay` omits top-level `transitionSpec` and delegates entries to an external `entryProvider`.',
              verificationHint: 'Check whether every destination entry overrides `NavDisplay.transitionSpec` or whether unconfigured entries still inherit the library default transition.',
            })
          );
          continue;
        }

        rawFindings.push(
          makeRuleFinding('T-001', {
            file: kf.filePath,
            lines: [c.startLine, c.endLine],
            severity,
            severityBasis,
            evidence: 'Navigation 3 `NavDisplay` omits `transitionSpec` and falls back to the library default transition.',
            remediation: 'Pass an explicit `transitionSpec` (and `popTransitionSpec` / `predictivePopTransitionSpec` where needed) resolved from `MaterialTheme.motionScheme` or your project\'s motion tokens.',
            symbolContext: c.enclosingDeclarations.map((d) => d.name),
          })
        );
      }
    }
  }
}

function checkT002(kf, conventionContext, fileMotionMd, rawFindings) {
  for (const c of kf.calls) {
    if (!SPEC_LITERAL_NAMES.has(c.name) || !c.hasParens) continue;
    if (c.receiver && c.receiver !== 'core') continue;

    if (isExemptSpecDefinitionSite(kf, c)) continue;

    const hasEstablishedConvention =
      conventionContext.hasMotionTokens ||
      Boolean(fileMotionMd && fileMotionMd.specs.length > 0);
    const severity = hasEstablishedConvention ? 'major' : 'minor';
    const severityBasis = hasEstablishedConvention
      ? 'motion-tokens-or-contract-present'
      : 'no-established-convention-in-scanned-set';

    // Anchor on enclosing animation consumer call if compact (e.g. `animateDpAsState(...)`), else on `c`
    const nearestAnimConsumer = [...c.enclosingCalls]
      .reverse()
      .find((ec) => ANIMATION_CONSUMER_CALLS.has(ec.name) && (ec.headerEndLine - ec.startLine) <= 12);
    const span = nearestAnimConsumer
      ? [nearestAnimConsumer.startLine, nearestAnimConsumer.headerEndLine]
      : [c.startLine, c.headerEndLine];

    rawFindings.push(
      makeRuleFinding('T-002', {
        file: kf.filePath,
        lines: span,
        severity,
        severityBasis,
        evidence: `Inline \`${c.snippet}\` spec literal at call site (line ${c.startLine}).`,
        remediation: 'Replace the inline spec literal with a `MaterialTheme.motionScheme` spec (`defaultSpatialSpec()`, `defaultEffectsSpec()`, etc.) or a named project token defined in one shared motion object.',
        symbolContext: c.enclosingDeclarations.map((d) => d.name),
      })
    );
  }
}

const SPEC_BUILDER_WRAPPERS = new Set([
  'repeatable',
  'infiniteRepeatable',
  'fadeIn',
  'fadeOut',
  'slideIn',
  'slideOut',
  'slideInHorizontally',
  'slideOutHorizontally',
  'slideInVertically',
  'slideOutVertically',
  'scaleIn',
  'scaleOut',
  'expandIn',
  'shrinkOut',
  'expandHorizontally',
  'shrinkHorizontally',
  'expandVertically',
  'shrinkVertically',
  'togetherWith',
  'SizeTransform',
]);

/**
 * Exempt `tween(...)` / `spring(...)` / `keyframes(...)` ONLY when it is the direct
 * spec-producing expression of a non-`@Composable` token `val` or `fun` (including
 * `MotionScheme` class overrides, `object` tokens, or default parameters of non-`@Composable`
 * helpers), and NOT nested inside any UI/animation consumer call.
 */
function isExemptSpecDefinitionSite(kf, specCall) {
  // Never exempt if nested inside an animation/UI consumer (`fadeIn(tween(300))`, `animateDpAsState(..., tween(300))`, etc.),
  // while permitting pure spec wrappers like `val pulse = infiniteRepeatable(tween(800))` on a token declaration!
  if (specCall.enclosingCalls.some((ec) => ANIMATION_CONSUMER_CALLS.has(ec.name) && !SPEC_BUILDER_WRAPPERS.has(ec.name))) {
    return false;
  }

  const innermostDecl = [...specCall.enclosingDeclarations]
    .reverse()
    .find((d) => d.kind === 'val' || d.kind === 'var' || d.kind === 'fun');
  if (!innermostDecl) return false;

  // Never exempt inside a `@Composable` function (neither expression body nor `@Composable` default param)
  if (innermostDecl.isComposable) return false;
  if (specCall.enclosingDeclarations.some((d) => d.kind === 'fun' && d.isComposable)) {
    return false;
  }

  // Case 1: Non-`@Composable` `val` initializer (`val cardSpring = spring<Float>(...)`)
  if ((innermostDecl.kind === 'val' || innermostDecl.kind === 'var') && innermostDecl.rhsStartIdx !== -1) {
    return specCall.nameTokIdx >= innermostDecl.rhsStartIdx && specCall.endTokIdx <= innermostDecl.endTokIdx;
  }

  // Case 2: Non-`@Composable` expression-body `fun` (`fun <T> spineSlide() = tween<T>(...)`)
  if (innermostDecl.kind === 'fun' && innermostDecl.isExpressionBody && innermostDecl.rhsStartIdx !== -1) {
    return specCall.nameTokIdx >= innermostDecl.rhsStartIdx && specCall.endTokIdx <= innermostDecl.endTokIdx;
  }

  // Case 3: Non-`@Composable` block-body `fun` returning a spec (`return tween(...)`,
  // `return if (fast) tween(150) else tween(300)`, etc.) or declaring a default spec parameter
  if (innermostDecl.kind === 'fun' && !innermostDecl.isExpressionBody) {
    if (
      innermostDecl.paramRange &&
      specCall.nameTokIdx > innermostDecl.paramRange[0] &&
      specCall.endTokIdx < innermostDecl.paramRange[1]
    ) {
      return true;
    }
    const enclosingInFun = specCall.enclosingCalls.filter(
      (ec) => ec.nameTokIdx > innermostDecl.startTokIdx
    );
    if (enclosingInFun.every((ec) => SPEC_BUILDER_WRAPPERS.has(ec.name) || ec.name === 'lazy')) {
      return true;
    }
  }

  return false;
}

function checkCandidatesMisc(kf, rawCandidates) {
  const { calls, tokens, declarations } = kf;

  // Identify local boolean vars mutated alongside `animateTo` / `animateDecay` (for T-012 input gating)
  const animGatingVars = new Set();
  for (const fn of declarations.filter((d) => d.kind === 'fun' && d.isComposable)) {
    const localVars = declarations.filter(
      (d) => d.kind === 'var' && d.startTokIdx > fn.startTokIdx && d.endTokIdx <= fn.endTokIdx
    );
    const fnCalls = calls.filter((c) => c.nameTokIdx > fn.startTokIdx && c.endTokIdx <= fn.endTokIdx);
    const hasSuspendAnim = fnCalls.some((c) => c.name === 'animateTo' || c.name === 'animateDecay');
    if (hasSuspendAnim) {
      for (const lv of localVars) {
        // Check if `lv.name = false` appears inside a coroutine launch block that also runs `animateTo`/`animateDecay`
        for (const lc of fnCalls) {
          if (lc.trailingLambda && (lc.name === 'launch' || lc.name === 'LaunchedEffect')) {
            const bToks = lc.trailingLambda.bodyTokens;
            const hasAnimInBlock = fnCalls.some(
              (ac) =>
                (ac.name === 'animateTo' || ac.name === 'animateDecay') &&
                ac.nameTokIdx > lc.trailingLambda.openBraceIdx &&
                ac.endTokIdx < lc.trailingLambda.closeBraceIdx
            );
            const assignsVar = bToks.some(
              (bt, idx) => bt.type === 'Identifier' && bt.value === lv.name && isUnqualifiedLocalIdent(bToks, idx) && bToks[idx + 1]?.value === '='
            );
            if (hasAnimInBlock && assignsVar) {
              animGatingVars.add(lv.name);
            }
          }
        }
      }
    }
  }

  for (const c of calls) {
    // F-004: `sharedElement` / `sharedBounds` inside `Dialog` / `ModalBottomSheet` / `Popup` / `AndroidView`
    if (c.name === 'sharedElement' || c.name === 'sharedBounds') {
      const container = [...c.enclosingCalls].reverse().find((ec) => VIEW_BACKED_CONTAINERS.has(ec.name));
      if (container) {
        rawCandidates.push(
          makeRuleCandidate('F-004', {
            file: kf.filePath,
            lines: [container.startLine, container.endLine],
            evidence: `\`${c.name}\` (line ${c.startLine}) is used inside View/window-backed \`${container.name}\`.`,
            verificationHint: 'Confirm whether the other shared-element endpoint lives in the parent window; `sharedElement`/`sharedBounds` cannot animate across separate platform windows (`Dialog`, `ModalBottomSheet`, `Popup`, `AndroidView`).',
          })
        );
      }
    }

    // O-003: `infiniteRepeatable(...)` or `basicMarquee(...)`
    if (c.name === 'infiniteRepeatable' || c.name === 'basicMarquee') {
      const chainCalls = c.receiver ? findModifierChainCalls(tokens, calls, c) : [];
      const hasClickableOnChain = chainCalls.some((cc) => cc.name === 'clickable' || cc.name === 'combinedClickable' || cc.name === 'toggleable');
      rawCandidates.push(
        makeRuleCandidate('O-003', {
          file: kf.filePath,
          lines: [c.startLine, c.endLine],
          evidence: `Endless animation API \`${c.name}\` detected${hasClickableOnChain ? ' (with clickable modifier on chain)' : ' (no clickable pause modifier on chain)'}.`,
          verificationHint: 'Check whether this endless animation is decorative/informational and runs >5s without an essential real-time state role (e.g. active loading spinner), and if so whether the user has a direct pause/stop control.',
        })
      );
    }

    // T-008: `BackHandler { ... }` (non-predictive)
    if (c.name === 'BackHandler' && c.trailingLambda) {
      rawCandidates.push(
        makeRuleCandidate('T-008', {
          file: kf.filePath,
          lines: [c.startLine, c.endLine],
          evidence: 'Non-seekable `BackHandler` intercepts system back.',
          verificationHint: 'Check whether `BackHandler` dismisses an animated surface/overlay that could support predictive back gesture progress via `PredictiveBackHandler` or `NavigationBackHandler`, or whether instant state dismissal is appropriate.',
        })
      );
    }

    // T-012: `enabled = !anim.isRunning`, `enabled = !isAnimating`, or `enabled = !turning` (mutated around animateTo)
    if (c.hasParens) {
      const enabledArg = c.args.find((a) => a.name === 'enabled');
      if (enabledArg) {
        const matchesBuiltin = /(\bisRunning\b|\bisAnimating\b|\bisTransitioning\b)/.test(enabledArg.text);
        const matchesGatingVar = enabledArg.tokens.some(
          (t, idx) => t.type === 'Identifier' && isUnqualifiedLocalIdent(enabledArg.tokens, idx) && animGatingVars.has(t.value)
        );
        if (matchesBuiltin || matchesGatingVar) {
          rawCandidates.push(
            makeRuleCandidate('T-012', {
              file: kf.filePath,
              lines: [c.startLine, c.endLine],
              evidence: `\`${c.name}(..., enabled = ${enabledArg.text})\` gates user input on animation completion.`,
              verificationHint: 'Verify whether disabling input during motion prevents normal interruption/retargeting (violating T-012) or protects a non-idempotent destructive commit.',
            })
          );
        }
      }
    }
  }

  // O-003: `LottieConstants.IterateForever`
  for (let i = 0; i + 2 < tokens.length; i += 1) {
    if (
      tokens[i].value === 'LottieConstants' &&
      tokens[i + 1].value === '.' &&
      tokens[i + 2].value === 'IterateForever'
    ) {
      rawCandidates.push(
        makeRuleCandidate('O-003', {
          file: kf.filePath,
          lines: [tokens[i].line, tokens[i + 2].endLine],
          evidence: '`LottieConstants.IterateForever` runs indefinitely.',
          verificationHint: 'Verify whether the user has a pause/stop control if this animation is not an indeterminate loading indicator.',
        })
      );
    }
  }

  // T-018: `LocalOverscrollFactory provides null` / `LocalOverscrollConfiguration provides null` / `overscrollEffect = null`
  for (let i = 0; i + 2 < tokens.length; i += 1) {
    if (
      (tokens[i].value === 'LocalOverscrollFactory' || tokens[i].value === 'LocalOverscrollConfiguration') &&
      tokens[i + 1].value === 'provides' &&
      tokens[i + 2].value === 'null'
    ) {
      rawCandidates.push(
        makeRuleCandidate('T-018', {
          file: kf.filePath,
          lines: [tokens[i].line, tokens[i + 2].endLine],
          evidence: `\`${tokens[i].value} provides null\` disables platform stretch overscroll.`,
          verificationHint: 'Check scope: disabling overscroll app-wide violates T-018, whereas scoping it locally around a looping pager or custom gesture replacement is compliant.',
        })
      );
    }
  }
  for (const c of calls) {
    const overArg = c.args?.find((a) => a.name === 'overscrollEffect' && a.text === 'null');
    if (overArg) {
      rawCandidates.push(
        makeRuleCandidate('T-018', {
          file: kf.filePath,
          lines: [c.startLine, c.headerEndLine],
          evidence: `\`${c.name}(..., overscrollEffect = null)\` disables platform overscroll.`,
          verificationHint: 'Verify whether a custom gesture or looping pager deliberately replaces platform overscroll here.',
        })
      );
    }
  }
}

const NON_MODIFIER_RETURN_MEMBERS = new Set([
  'let',
  'run',
  'with',
  'toString',
  'hashCode',
  'equals',
]);

function isModifierTypeTokens(typeToks) {
  const clean = [];
  for (let i = 0; i < typeToks.length; i += 1) {
    const t = typeToks[i];
    if (t.type === 'Annotation') {
      if (typeToks[i + 1]?.type === 'Punct' && typeToks[i + 1].value === '(') {
        const closeP = findMatchingForward(typeToks, i + 1, '(', ')');
        if (closeP !== -1) i = closeP;
      }
      continue;
    }
    clean.push(t);
  }
  if (clean.length === 0 || clean.length % 2 === 0) return false;
  for (let i = 0; i < clean.length; i += 1) {
    if (i % 2 === 0) {
      if (clean[i].type !== 'Identifier') return false;
    } else if (clean[i].type !== 'Punct' || clean[i].value !== '.') {
      return false;
    }
  }
  const last = clean[clean.length - 1];
  const pkgPrefix = clean.slice(0, -1).map((t) => t.value).join('');
  return last.value === 'Modifier' && (pkgPrefix === '' || pkgPrefix === 'androidx.compose.ui.');
}

function collectLottieFunctionParamBindings(tokens, fn, scopedBindings) {
  if (!fn.paramRange) return;
  const [openP, closeP] = fn.paramRange;
  const slice = tokens.slice(openP + 1, closeP);
  const paramSlices = [];
  let curStart = 0;
  let pDepth = 0;
  let bDepth = 0;
  let kDepth = 0;
  let tDepth = 0;
  let inType = false;

  for (let i = 0; i < slice.length; i += 1) {
    const t = slice[i];
    if (t.type === 'Punct') {
      if (t.value === '(') pDepth += 1;
      else if (t.value === ')') pDepth = Math.max(0, pDepth - 1);
      else if (t.value === '{') bDepth += 1;
      else if (t.value === '}') bDepth = Math.max(0, bDepth - 1);
      else if (t.value === '[') kDepth += 1;
      else if (t.value === ']') kDepth = Math.max(0, kDepth - 1);
      else if (pDepth === 0 && bDepth === 0 && kDepth === 0) {
        if (t.value === ':' && !inType) {
          inType = true;
          tDepth = 0;
        } else if (t.value === '=' && inType && tDepth === 0) {
          inType = false;
        } else if (inType && t.value === '<') {
          tDepth += 1;
        } else if (inType && t.value === '>') {
          tDepth = Math.max(0, tDepth - 1);
        } else if (t.value === ',' && !(inType && tDepth > 0)) {
          paramSlices.push(slice.slice(curStart, i));
          curStart = i + 1;
          inType = false;
          tDepth = 0;
        }
      }
    }
  }
  if (curStart < slice.length) {
    paramSlices.push(slice.slice(curStart));
  }

  for (const paramToks of paramSlices) {
    if (paramToks.length === 0) continue;
    let pd = 0;
    let bd = 0;
    let kd = 0;
    let td = 0;
    let colonIdx = -1;
    let eqIdx = -1;
    for (let i = 0; i < paramToks.length; i += 1) {
      const t = paramToks[i];
      if (t.type === 'Punct') {
        if (t.value === '(') pd += 1;
        else if (t.value === ')') pd = Math.max(0, pd - 1);
        else if (t.value === '{') bd += 1;
        else if (t.value === '}') bd = Math.max(0, bd - 1);
        else if (t.value === '[') kd += 1;
        else if (t.value === ']') kd = Math.max(0, kd - 1);
        else if (pd === 0 && bd === 0 && kd === 0) {
          if (t.value === ':' && colonIdx === -1) {
            colonIdx = i;
          } else if (colonIdx !== -1 && eqIdx === -1 && t.value === '<') {
            td += 1;
          } else if (colonIdx !== -1 && eqIdx === -1 && t.value === '>') {
            td = Math.max(0, td - 1);
          } else if (colonIdx !== -1 && eqIdx === -1 && td === 0 && t.value === '=') {
            eqIdx = i;
            break;
          }
        }
      }
    }
    if (colonIdx > 0 && paramToks[colonIdx - 1]?.type === 'Identifier') {
      const paramName = paramToks[colonIdx - 1].value;
      const typeToks = paramToks.slice(colonIdx + 1, eqIdx === -1 ? paramToks.length : eqIdx);
      scopedBindings.push({
        name: paramName,
        kind: isModifierTypeTokens(typeToks) ? 'modifier' : 'other',
        declStartIdx: openP,
        declEndIdx: closeP,
        scopeStartIdx: fn.startTokIdx,
        scopeEndIdx: fn.endTokIdx,
      });
    }
  }
}

function isProvenModifierExprTokens(toks, atTokIdx, scopedBindings) {
  if (!Array.isArray(toks) || toks.length === 0) return false;

  let cursor = 0;
  if (
    toks.length >= 7 &&
    toks[0]?.type === 'Identifier' && toks[0].value === 'androidx' &&
    toks[1]?.value === '.' &&
    toks[2]?.type === 'Identifier' && toks[2].value === 'compose' &&
    toks[3]?.value === '.' &&
    toks[4]?.type === 'Identifier' && toks[4].value === 'ui' &&
    toks[5]?.value === '.' &&
    toks[6]?.type === 'Identifier' && toks[6].value === 'Modifier'
  ) {
    cursor = 7;
  } else if (toks[0]?.type === 'Identifier' && isUnqualifiedLocalIdent(toks, 0)) {
    if (toks[0].value === 'Modifier') {
      cursor = 1;
    } else {
      const binding = resolveScopedBinding(toks[0].value, atTokIdx, scopedBindings);
      if (binding && binding.kind === 'modifier') {
        cursor = 1;
      } else {
        return false;
      }
    }
  } else {
    return false;
  }

  while (cursor < toks.length) {
    if (toks[cursor]?.type !== 'Punct' || toks[cursor].value !== '.') {
      return false;
    }
    cursor += 1;
    const member = toks[cursor];
    if (!member || member.type !== 'Identifier' || NON_MODIFIER_RETURN_MEMBERS.has(member.value)) {
      return false;
    }
    cursor += 1;
    if (toks[cursor]?.type === 'Punct' && toks[cursor].value === '<') {
      const closeAngle = findMatchingForward(toks, cursor, '<', '>');
      if (closeAngle === -1) return false;
      cursor = closeAngle + 1;
    }
    if (toks[cursor]?.type === 'Punct' && toks[cursor].value === '(') {
      const closeParen = findMatchingForward(toks, cursor, '(', ')');
      if (closeParen === -1) return false;
      cursor = closeParen + 1;
    }
    if (toks[cursor]?.type === 'Punct' && toks[cursor].value === '{') {
      const closeBrace = findMatchingForward(toks, cursor, '{', '}');
      if (closeBrace === -1) return false;
      cursor = closeBrace + 1;
    }
  }

  return true;
}

function unwrapZeroArgLambdaTokens(toks) {
  if (
    toks.length >= 2 &&
    toks[0].type === 'Punct' &&
    toks[0].value === '{' &&
    toks[toks.length - 1].type === 'Punct' &&
    toks[toks.length - 1].value === '}' &&
    findMatchingForward(toks, 0, '{', '}') === toks.length - 1
  ) {
    const inner = toks.slice(1, -1);
    if (inner[0]?.type === 'Punct' && inner[0].value === '->') {
      return inner.slice(1);
    }
    return inner;
  }
  return toks;
}

function getLottieOverloadArg(call, paramName, positionalSlot = null, allowPositional = false) {
  const named = call.args.find((a) => a.name === paramName);
  if (named) return named;
  if (
    allowPositional &&
    positionalSlot !== null &&
    call.args.length > positionalSlot &&
    call.args[positionalSlot].name === null &&
    (call.args[0]?.name === null || call.args[0]?.name === 'composition') &&
    call.args.slice(1, positionalSlot).every((a) => a.name === null)
  ) {
    return call.args[positionalSlot];
  }
  return null;
}

function classifyLottieSpeedExpr(exprTokens, rawText, atTokIdx, scopedBindings, depth = 0) {
  if (!Array.isArray(exprTokens) || exprTokens.length === 0 || depth > 4) {
    return 'unknown';
  }
  let toks = exprTokens;
  while (
    toks.length >= 2 &&
    toks[0].type === 'Punct' &&
    toks[0].value === '(' &&
    toks[toks.length - 1].type === 'Punct' &&
    toks[toks.length - 1].value === ')' &&
    findMatchingForward(toks, 0, '(', ')') === toks.length - 1
  ) {
    toks = toks.slice(1, -1);
  }
  if (toks.length === 0) return 'unknown';

  if (toks[0].type === 'Punct' && (toks[0].value === '-' || toks[0].value === '+')) {
    const sign = toks[0].value;
    const innerClass = classifyLottieSpeedExpr(toks.slice(1), '', atTokIdx, scopedBindings, depth + 1);
    if (sign === '+') return innerClass;
    if (innerClass === 'positive') return 'negative';
    if (innerClass === 'negative') return 'positive';
    return innerClass;
  }

  if (toks.length === 1 && toks[0].type === 'NumberLiteral') {
    const m = toks[0].value.match(/^([0-9]+(?:\.[0-9]+)?)[fF]?$/);
    if (!m) return 'unknown';
    const val = Number(m[1]);
    if (Number.isNaN(val)) return 'unknown';
    return val === 0 ? 'zero' : 'positive';
  }

  if (toks.length === 1 && toks[0].type === 'Identifier' && isUnqualifiedLocalIdent(toks, 0)) {
    const binding = resolveScopedBinding(toks[0].value, atTokIdx, scopedBindings);
    if (binding?.kind === 'local-val' && Array.isArray(binding.rhsTokens)) {
      return classifyLottieSpeedExpr(
        binding.rhsTokens,
        binding.rhsText || '',
        binding.declStartIdx,
        scopedBindings,
        depth + 1
      );
    }
  }

  void rawText;
  return 'unknown';
}

function resolveLottieProgressExpr(progressTokens, progressText, atTokIdx, scopedBindings) {
  const inner = unwrapZeroArgLambdaTokens(progressTokens);

  let varName = null;
  const isBareVar = inner.length === 1 && inner[0].type === 'Identifier';
  const isStateMember =
    inner.length === 3 &&
    inner[0].type === 'Identifier' &&
    inner[1].type === 'Punct' &&
    (inner[1].value === '.' || inner[1].value === '::') &&
    inner[2].type === 'Identifier' &&
    (inner[2].value === 'progress' || inner[2].value === 'value');

  if (isBareVar || isStateMember) {
    varName = inner[0].value;
  }

  if (varName) {
    const binding = resolveScopedBinding(varName, atTokIdx, scopedBindings);
    if (binding?.kind === 'lottie-anim-state' && binding.animStateMeta) {
      return {
        progressKind: binding.animStateMeta.hasUnknownPlayback ? 'custom-progress' : 'animated-state',
        hasClipSpec: binding.animStateMeta.hasClipSpec,
        isNegativeSpeed: binding.animStateMeta.isNegativeSpeed,
        hasUnknownPlayback: Boolean(binding.animStateMeta.hasUnknownPlayback),
      };
    }
    if (isBareVar && binding?.kind === 'local-val' && typeof binding.rhsText === 'string') {
      return {
        progressKind: classifyExplicitLottieProgress(binding.rhsText),
        hasClipSpec: false,
        isNegativeSpeed: false,
        hasUnknownPlayback: false,
      };
    }
  }

  return {
    progressKind: classifyExplicitLottieProgress(progressText),
    hasClipSpec: false,
    isNegativeSpeed: false,
    hasUnknownPlayback: false,
  };
}

function collectLottieConsumers(kf, scaleHelpers, outConsumers) {
  const { declarations, calls, tokens } = kf;
  const composableFuns = declarations.filter((d) => d.kind === 'fun' && d.isComposable);

  // Seed file-level / object-level immutable `val` declarations so constants like `private const val BACKWARDS = -1f` resolve
  const outerValBindings = [];
  const outerDecls = declarations
    .filter((d) => (d.kind === 'val' || d.kind === 'var') && (d.rhsStartIdx >= 0 || d.delegateIdx >= 0))
    .sort((a, b) => a.startTokIdx - b.startTokIdx);
  for (const d of outerDecls) {
    const insideComposable = composableFuns.some((fn) => d.startTokIdx > fn.startTokIdx && d.endTokIdx <= fn.endTokIdx);
    if (insideComposable) continue;
    const exprStart = d.rhsStartIdx >= 0 ? d.rhsStartIdx : d.delegateIdx;
    if (exprStart < 0 || exprStart > d.endTokIdx) continue;
    const exprToks = tokens.slice(exprStart, d.endTokIdx + 1);
    const rawSelection = extractLottieAssetSelectionForExpr(tokens, calls, exprToks, outerValBindings, d.startTokIdx);
    const assetSelection = rawSelection
      ? { assets: rawSelection.assets, uncertain: rawSelection.uncertain || d.kind === 'var' }
      : null;
    if (d.kind === 'val' && d.delegateIdx === -1 && d.rhsStartIdx >= 0) {
      outerValBindings.push({
        name: d.name,
        kind: 'local-val',
        assetSelection,
        animStateMeta: null,
        rhsTokens: exprToks,
        rhsText: kf.source.slice(tokens[d.rhsStartIdx].start, tokens[d.endTokIdx].end).trim(),
        declStartIdx: d.startTokIdx,
        declEndIdx: d.endTokIdx,
        scopeStartIdx: 0,
        scopeEndIdx: tokens.length - 1,
      });
    } else if (assetSelection) {
      outerValBindings.push({
        name: d.name,
        kind: 'other',
        assetSelection,
        animStateMeta: null,
        rhsTokens: null,
        rhsText: null,
        declStartIdx: d.startTokIdx,
        declEndIdx: d.endTokIdx,
        scopeStartIdx: 0,
        scopeEndIdx: tokens.length - 1,
      });
    }
  }

  for (const fn of composableFuns) {
    const scopedBindings = [...outerValBindings];
    collectLottieFunctionParamBindings(tokens, fn, scopedBindings);
    collectShadowingScopeBindings(tokens, declarations, fn, scopedBindings);

    const localDecls = declarations
      .filter(
        (d) => (d.kind === 'val' || d.kind === 'var') && d.startTokIdx > fn.startTokIdx && d.endTokIdx <= fn.endTokIdx
      )
      .sort((a, b) => a.startTokIdx - b.startTokIdx);

    const localScaleVars = new Set();
    for (const ld of localDecls) {
      const declToks = tokens.slice(ld.startTokIdx, ld.endTokIdx + 1);
      if (
        declToks.some(
          (t) =>
            t.type === 'Identifier' &&
            (DURATION_SCALE_IDENTIFIERS.has(t.value) || (scaleHelpers && scaleHelpers.has(t.value)))
        )
      ) {
        localScaleVars.add(ld.name);
      }
    }

    for (const ld of localDecls) {
      const [scopeStartIdx, scopeEndIdx] = findEnclosingBraceScope(tokens, ld.startTokIdx, fn.startTokIdx, fn.endTokIdx);
      const exprStart = ld.rhsStartIdx >= 0 ? ld.rhsStartIdx : ld.delegateIdx;
      const exprToks = exprStart >= 0 && exprStart <= ld.endTokIdx ? tokens.slice(exprStart, ld.endTokIdx + 1) : null;
      const rawSelection = exprToks
        ? extractLottieAssetSelectionForExpr(tokens, calls, exprToks, scopedBindings, ld.startTokIdx)
        : null;
      const assetSelection = rawSelection
        ? { assets: rawSelection.assets, uncertain: rawSelection.uncertain || ld.kind === 'var' }
        : null;

      const animStateCall = calls.find(
        (c) => c.name === 'animateLottieCompositionAsState' && c.nameTokIdx >= ld.startTokIdx && c.endTokIdx <= ld.endTokIdx
      );

      let explicitTypeToks = null;
      if (tokens[ld.nameIdx + 1]?.type === 'Punct' && tokens[ld.nameIdx + 1].value === ':') {
        const typeEnd = ld.rhsStartIdx >= 0
          ? ld.rhsStartIdx - 1
          : ld.delegateIdx >= 0
            ? ld.delegateIdx - 1
            : ld.endTokIdx + 1;
        if (typeEnd >= ld.nameIdx + 2) {
          explicitTypeToks = tokens.slice(ld.nameIdx + 2, typeEnd);
        }
      }

      let kind = 'other';
      let animStateMeta = null;
      let rhsTokens = null;
      let rhsText = null;

      if (animStateCall) {
        const compArg = getCallArg(animStateCall, 'composition', 0);
        const isSimpleCompIdent =
          Boolean(compArg) && compArg.tokens.length === 1 && compArg.tokens[0].type === 'Identifier';
        const compIdent = isSimpleCompIdent ? compArg.tokens[0].value : null;
        const clipArg = getLottieOverloadArg(animStateCall, 'clipSpec', 4, true);
        const hasClipSpec = Boolean(clipArg && clipArg.text.trim() !== 'null');
        const speedArg = getLottieOverloadArg(animStateCall, 'speed', 5, true);
        const speedClass = speedArg
          ? classifyLottieSpeedExpr(speedArg.tokens, speedArg.text, animStateCall.nameTokIdx, scopedBindings)
          : 'positive';
        const isPlayingArg = getLottieOverloadArg(animStateCall, 'isPlaying', 1, true);
        const reverseOnRepeatArg = getLottieOverloadArg(animStateCall, 'reverseOnRepeat', 3, true);
        const hasUnknownPlayback =
          !isSimpleCompIdent ||
          speedClass === 'zero' ||
          speedClass === 'unknown' ||
          Boolean(isPlayingArg && isPlayingArg.text.trim() !== 'true') ||
          Boolean(reverseOnRepeatArg && reverseOnRepeatArg.text.trim() !== 'false');
        kind = 'lottie-anim-state';
        animStateMeta = {
          compIdent,
          hasClipSpec,
          isNegativeSpeed: speedClass === 'negative',
          hasUnknownPlayback,
        };
      } else if (
        (explicitTypeToks && isModifierTypeTokens(explicitTypeToks)) ||
        (ld.rhsStartIdx >= 0 &&
          ld.rhsStartIdx <= ld.endTokIdx &&
          isProvenModifierExprTokens(tokens.slice(ld.rhsStartIdx, ld.endTokIdx + 1), ld.startTokIdx, scopedBindings))
      ) {
        kind = 'modifier';
      } else if (ld.kind === 'val' && ld.delegateIdx === -1 && ld.rhsStartIdx >= 0 && ld.rhsStartIdx <= ld.endTokIdx) {
        kind = 'local-val';
        rhsTokens = tokens.slice(ld.rhsStartIdx, ld.endTokIdx + 1);
        rhsText = kf.source.slice(tokens[ld.rhsStartIdx].start, tokens[ld.endTokIdx].end).trim();
      }

      scopedBindings.push({
        name: ld.name,
        kind,
        assetSelection,
        animStateMeta,
        rhsTokens,
        rhsText,
        declStartIdx: ld.startTokIdx,
        declEndIdx: ld.endTokIdx,
        scopeStartIdx,
        scopeEndIdx,
      });
    }

    const fnCalls = calls.filter((c) => c.nameTokIdx > fn.startTokIdx && c.endTokIdx <= fn.endTokIdx);
    for (const c of fnCalls) {
      if (c.name !== 'LottieAnimation' || !c.hasParens) continue;
      const compArg = getCallArg(c, 'composition', 0);
      if (!compArg) continue;

      const assetSelection = extractLottieAssetSelectionForExpr(
        tokens,
        calls,
        compArg.tokens,
        scopedBindings,
        c.nameTokIdx
      );
      if (!assetSelection || assetSelection.assets.length === 0) continue;

      const guardSlices = collectEnclosingGuardSlices(tokens, fn, c.nameTokIdx);
      const guardedByDurationScale = guardSlices.some((slice) =>
        slice.some(
          (t, idx) =>
            t.type === 'Identifier' &&
            (DURATION_SCALE_IDENTIFIERS.has(t.value) ||
              (scaleHelpers && scaleHelpers.has(t.value)) ||
              (localScaleVars.has(t.value) && isUnqualifiedLocalIdent(slice, idx)))
        )
      );

      // Determine `progress` provenance (`default-forward` vs `animated-state` vs `constant-*` vs `custom-progress`)
      const namedProgressArg = c.args.find((a) => a.name === 'progress');
      const firstIsCompSlot = c.args.length >= 1 && (c.args[0].name === null || c.args[0].name === 'composition');
      const posSlot1Arg = firstIsCompSlot && c.args.length >= 2 && c.args[1].name === null ? c.args[1] : null;
      const trailingProgressLambda =
        !namedProgressArg && firstIsCompSlot && c.args.length === 1 && c.trailingLambda
          ? c.trailingLambda
          : null;

      let explicitProgress = null;
      if (namedProgressArg) {
        explicitProgress = { tokens: namedProgressArg.tokens, text: namedProgressArg.text };
      } else if (trailingProgressLambda) {
        explicitProgress = {
          tokens: tokens.slice(trailingProgressLambda.openBraceIdx, trailingProgressLambda.closeBraceIdx + 1),
          text: trailingProgressLambda.text,
        };
      } else if (posSlot1Arg && !isProvenModifierExprTokens(posSlot1Arg.tokens, c.nameTokIdx, scopedBindings)) {
        explicitProgress = { tokens: posSlot1Arg.tokens, text: posSlot1Arg.text };
      }

      const isAutoPlayOverload = !explicitProgress;
      const clipArg = getLottieOverloadArg(c, 'clipSpec', 4, isAutoPlayOverload);
      let hasClipSpec = Boolean(clipArg && clipArg.text.trim() !== 'null');

      const speedArg = getLottieOverloadArg(c, 'speed', 5, isAutoPlayOverload);
      const speedClass = speedArg
        ? classifyLottieSpeedExpr(speedArg.tokens, speedArg.text, c.nameTokIdx, scopedBindings)
        : 'positive';
      let isNegativeSpeed = speedClass === 'negative';

      const isPlayingArg = getLottieOverloadArg(c, 'isPlaying', 2, isAutoPlayOverload);
      const reverseOnRepeatArg = getLottieOverloadArg(c, 'reverseOnRepeat', 11, isAutoPlayOverload);
      let hasUnknownPlayback =
        speedClass === 'zero' ||
        speedClass === 'unknown' ||
        Boolean(isPlayingArg && isPlayingArg.text.trim() !== 'true') ||
        Boolean(reverseOnRepeatArg && reverseOnRepeatArg.text.trim() !== 'false');

      let progressKind = 'default-forward';
      if (explicitProgress) {
        const resolved = resolveLottieProgressExpr(
          explicitProgress.tokens,
          explicitProgress.text,
          c.nameTokIdx,
          scopedBindings
        );
        progressKind = resolved.progressKind;
        if (resolved.hasClipSpec) hasClipSpec = true;
        if (resolved.isNegativeSpeed) isNegativeSpeed = true;
        if (resolved.hasUnknownPlayback) hasUnknownPlayback = true;
      }

      const uncertainAsset = assetSelection.uncertain;
      const effectiveUnknownPlayback = hasUnknownPlayback || uncertainAsset || guardedByDurationScale;
      const effectiveProgressKind =
        effectiveUnknownPlayback && progressKind !== 'constant-mid' ? 'custom-progress' : progressKind;

      for (const assetRef of assetSelection.assets) {
        outConsumers.push({
          filePath: kf.filePath,
          composableName: fn.name,
          composableLines: [fn.startLine, fn.endLine],
          callLines: [c.startLine, c.endLine],
          assetBaseName: assetRef.baseName,
          assetKind: assetRef.kind,
          assetRelPath: assetRef.assetRelPath,
          uncertainAsset,
          guardedByDurationScale,
          hasClipSpec,
          isNegativeSpeed,
          hasUnknownPlayback: effectiveUnknownPlayback,
          progressKind: effectiveProgressKind,
        });
      }
    }
  }
}

function classifyExplicitLottieProgress(rawExpr) {
  let inner = String(rawExpr || '').trim();
  if (inner.startsWith('{') && inner.endsWith('}')) {
    inner = inner.slice(1, -1).trim();
    const arrowIdx = inner.indexOf('->');
    if (arrowIdx !== -1) {
      inner = inner.slice(arrowIdx + 2).trim();
    }
  }
  const numMatch = inner.match(/^([0-9]+(?:\.[0-9]+)?)[fF]?$/);
  if (numMatch) {
    const val = Number(numMatch[1]);
    if (val === 1) return 'constant-end';
    if (val === 0) return 'constant-start';
    if (val > 0 && val < 1) return 'constant-mid';
  }
  return 'custom-progress';
}

function collectEnclosingGuardSlices(tokens, fn, targetTokIdx) {
  const slices = [];
  if (!fn || fn.startTokIdx >= fn.endTokIdx) return slices;
  const scanStartIdx = fn.startTokIdx;
  const scanEndIdx = fn.endTokIdx;

  for (let i = scanStartIdx; i < targetTokIdx; i += 1) {
    const t = tokens[i];
    if (t.type === 'Keyword' && t.value === 'if' && tokens[i + 1]?.value === '(') {
      const closeCond = findMatchingForward(tokens, i + 1, '(', ')');
      if (closeCond === -1) continue;
      const condSlice = tokens.slice(i + 2, closeCond);
      const thenRange = findSingleStatementOrBlockRange(tokens, closeCond + 1, scanEndIdx);
      if (!thenRange) continue;
      let elseRange = null;
      if (tokens[thenRange[1] + 1]?.type === 'Keyword' && tokens[thenRange[1] + 1].value === 'else') {
        elseRange = findSingleStatementOrBlockRange(tokens, thenRange[1] + 2, scanEndIdx);
      }
      const enclosesTarget = idxInsideRange(targetTokIdx, thenRange) || idxInsideRange(targetTokIdx, elseRange);
      const earlyExitsBeforeTarget =
        thenRange[1] < targetTokIdx &&
        sharesBraceScopeWithTarget(tokens, i, targetTokIdx, scanStartIdx, scanEndIdx) &&
        (rangeHasControlExit(tokens, thenRange, ['return']) || rangeHasControlExit(tokens, elseRange, ['return']));
      if (enclosesTarget || earlyExitsBeforeTarget) {
        slices.push(condSlice);
      }
      continue;
    }
    if (t.type === 'Keyword' && t.value === 'when') {
      let cursor = i + 1;
      let subjSlice = null;
      if (tokens[cursor]?.value === '(') {
        const closeSubj = findMatchingForward(tokens, cursor, '(', ')');
        if (closeSubj === -1) continue;
        subjSlice = tokens.slice(cursor + 1, closeSubj);
        cursor = closeSubj + 1;
      }
      if (tokens[cursor]?.value !== '{') continue;
      const closeWhen = findMatchingForward(tokens, cursor, '{', '}');
      if (closeWhen === -1) continue;
      const whenRange = [cursor, closeWhen];
      const enclosesTarget = idxInsideRange(targetTokIdx, whenRange);
      const earlyExitsBeforeTarget =
        closeWhen < targetTokIdx &&
        sharesBraceScopeWithTarget(tokens, i, targetTokIdx, scanStartIdx, scanEndIdx) &&
        rangeHasControlExit(tokens, whenRange, ['return']);
      if (enclosesTarget || earlyExitsBeforeTarget) {
        if (subjSlice && subjSlice.length > 0) slices.push(subjSlice);
      }
    }
  }
  return slices;
}

const ALLOWED_UNCONDITIONAL_LOTTIE_CALLS = new Set(['RawRes', 'Asset']);

const DISALLOWED_UNCONDITIONAL_LOTTIE_KEYWORDS = new Set([
  'if', 'else', 'when', 'try', 'catch', 'for', 'while', 'do', 'return', 'throw',
]);

const DISALLOWED_UNCONDITIONAL_LOTTIE_PUNCT = new Set([
  '?:', '?.', '->', '{', '}', '[', ']', '::', '&&', '||',
  '==', '!=', '<', '>', '<=', '>=', '+', '-', '*', '/', '%',
]);

function stripOuterParensTokens(toks) {
  let cur = toks;
  while (
    cur.length >= 2 &&
    cur[0].type === 'Punct' &&
    cur[0].value === '(' &&
    cur[cur.length - 1].type === 'Punct' &&
    cur[cur.length - 1].value === ')'
  ) {
    let depth = 0;
    let wrapsEntire = true;
    for (let i = 0; i < cur.length; i += 1) {
      if (cur[i].type === 'Punct' && cur[i].value === '(') depth += 1;
      else if (cur[i].type === 'Punct' && cur[i].value === ')') {
        depth -= 1;
        if (depth === 0 && i < cur.length - 1) {
          wrapsEntire = false;
          break;
        }
      }
    }
    if (!wrapsEntire) break;
    cur = cur.slice(1, -1);
  }
  return cur;
}

function unwrapRememberLottieComposition(tokens, calls, exprToks) {
  const stripped = stripOuterParensTokens(exprToks);
  if (stripped.length === 0) return stripped;

  const firstTok = stripped[0];
  const remCall = calls.find(
    (c) =>
      c.name === 'rememberLottieComposition' &&
      c.hasParens &&
      (tokens[c.nameTokIdx] === firstTok || tokens[c.chainRootIdx] === firstTok)
  );
  if (!remCall) return stripped;

  // Verify any qualifier chain before `rememberLottieComposition` is purely package identifiers (`a.b.rememberLottieComposition`)
  const remNamePos = stripped.indexOf(tokens[remCall.nameTokIdx]);
  if (remNamePos < 0) return stripped;
  for (let i = 0; i < remNamePos; i += 1) {
    const t = stripped[i];
    if (i % 2 === 0 && t.type !== 'Identifier') return stripped;
    if (i % 2 === 1 && !(t.type === 'Punct' && t.value === '.')) return stripped;
  }

  const remEndPos = stripped.indexOf(tokens[remCall.endTokIdx]);
  if (remEndPos === -1) return stripped;

  const trailing = stripped.slice(remEndPos + 1);
  const validTrailing =
    trailing.length === 0 ||
    (trailing.length === 1 && trailing[0].type === 'Punct' && trailing[0].value === '!!') ||
    (trailing.length === 2 &&
      trailing[0].type === 'Punct' &&
      trailing[0].value === '.' &&
      trailing[1].type === 'Identifier' &&
      trailing[1].value === 'value') ||
    (trailing.length === 3 &&
      trailing[0].type === 'Punct' &&
      trailing[0].value === '.' &&
      trailing[1].type === 'Identifier' &&
      trailing[1].value === 'value' &&
      trailing[2].type === 'Punct' &&
      trailing[2].value === '!!');

  if (!validTrailing) return stripped;
  const specArg = getCallArg(remCall, 'spec', 0);
  return specArg && specArg.tokens.length > 0 ? stripOuterParensTokens(specArg.tokens) : stripped;
}

function extractLottieAssetSelectionForExpr(tokens, calls, exprToks, scopedBindings, atTokIdx) {
  if (!exprToks || exprToks.length === 0) return null;
  const specToks = unwrapRememberLottieComposition(tokens, calls, exprToks);
  if (!specToks || specToks.length === 0) return null;

  const rawAssets = [];
  const consumed = new Set();
  let uncertain = false;
  let localVarRefs = 0;

  // 1. Collect all `[pkg.]*R.raw.<name>` spans
  for (let i = 0; i + 4 < specToks.length; i += 1) {
    if (
      specToks[i].type === 'Identifier' &&
      specToks[i].value === 'R' &&
      specToks[i + 1].value === '.' &&
      specToks[i + 2].value === 'raw' &&
      specToks[i + 3].value === '.' &&
      specToks[i + 4].type === 'Identifier'
    ) {
      let pkgStart = i;
      while (
        pkgStart >= 2 &&
        specToks[pkgStart - 1].type === 'Punct' &&
        specToks[pkgStart - 1].value === '.' &&
        specToks[pkgStart - 2].type === 'Identifier'
      ) {
        pkgStart -= 2;
      }
      if (pkgStart > 0 && specToks[pkgStart - 1].type === 'Punct' && (specToks[pkgStart - 1].value === '.' || specToks[pkgStart - 1].value === '?.' || specToks[pkgStart - 1].value === '::')) {
        uncertain = true;
      }
      for (let k = pkgStart; k <= i + 4; k += 1) consumed.add(k);
      rawAssets.push({ kind: 'raw', baseName: specToks[i + 4].value, assetRelPath: null });
    }
  }

  // 2. Collect all `"foo/bar/anim.json"` string literals
  for (let i = 0; i < specToks.length; i += 1) {
    const t = specToks[i];
    if (t.type === 'StringLiteral' && /\.json$/i.test(t.value.trim())) {
      consumed.add(i);
      const cleanRel = t.value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
      const base = cleanRel.split('/').pop() || '';
      rawAssets.push({
        kind: 'asset',
        baseName: base.replace(/\.json$/i, ''),
        assetRelPath: cleanRel,
      });
    }
  }

  // 3. Named argument labels (`resId =`, `assetName =`, `spec =`, `composition =`)
  for (let i = 0; i + 1 < specToks.length; i += 1) {
    if (
      !consumed.has(i) &&
      specToks[i].type === 'Identifier' &&
      specToks[i + 1].type === 'Punct' &&
      specToks[i + 1].value === '='
    ) {
      consumed.add(i);
      consumed.add(i + 1);
    }
  }

  // 4. Function/constructor calls (`LottieCompositionSpec.RawRes(...)`, `LottieCompositionSpec.Asset(...)`, vs arbitrary calls)
  for (let i = 0; i < specToks.length; i += 1) {
    if (consumed.has(i)) continue;
    if (
      specToks[i].type === 'Identifier' &&
      specToks[i + 1]?.type === 'Punct' &&
      specToks[i + 1].value === '('
    ) {
      if (ALLOWED_UNCONDITIONAL_LOTTIE_CALLS.has(specToks[i].value)) {
        consumed.add(i);
        let q = i;
        while (
          q >= 2 &&
          specToks[q - 1].type === 'Punct' &&
          specToks[q - 1].value === '.' &&
          specToks[q - 2].type === 'Identifier'
        ) {
          consumed.add(q - 1);
          consumed.add(q - 2);
          q -= 2;
        }
      } else {
        consumed.add(i);
        uncertain = true;
      }
    }
  }

  // 5. Remaining identifiers: resolve unqualified local `val` / composition bindings
  for (let i = 0; i < specToks.length; i += 1) {
    if (consumed.has(i)) continue;
    const t = specToks[i];
    if (t.type !== 'Identifier') continue;
    if (isUnqualifiedLocalIdent(specToks, i)) {
      localVarRefs += 1;
      consumed.add(i);
      if (
        specToks[i + 1]?.type === 'Punct' &&
        specToks[i + 1].value === '.' &&
        specToks[i + 2]?.type === 'Identifier' &&
        specToks[i + 2].value === 'value'
      ) {
        consumed.add(i + 1);
        consumed.add(i + 2);
      }
      const binding = resolveScopedBinding(t.value, atTokIdx, scopedBindings);
      if (binding?.assetSelection && binding.assetSelection.assets.length > 0) {
        rawAssets.push(...binding.assetSelection.assets);
        if (binding.assetSelection.uncertain) uncertain = true;
      } else {
        uncertain = true;
      }
    } else {
      uncertain = true;
    }
  }

  // Deduplicate assets
  const seenKeys = new Set();
  const assets = [];
  for (const a of rawAssets) {
    const key = `${a.kind}:${a.assetRelPath || a.baseName}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      assets.push(a);
    }
  }
  if (assets.length === 0) return null;

  if (assets.length > 1 || localVarRefs > 1) {
    uncertain = true;
  }

  // 6. Any branching/conditional keyword, operator, or unconsumed token makes the selection uncertain
  for (let i = 0; i < specToks.length; i += 1) {
    const t = specToks[i];
    if (t.type === 'Keyword' && DISALLOWED_UNCONDITIONAL_LOTTIE_KEYWORDS.has(t.value)) {
      uncertain = true;
      break;
    }
    if (t.type === 'Punct' && DISALLOWED_UNCONDITIONAL_LOTTIE_PUNCT.has(t.value)) {
      uncertain = true;
      break;
    }
    if (!consumed.has(i)) {
      const isStructuralPunct =
        t.type === 'Punct' && (t.value === '(' || t.value === ')' || t.value === ',' || t.value === '!!');
      if (!isStructuralPunct) {
        uncertain = true;
        break;
      }
    }
  }

  return { assets, uncertain };
}

function doesConsumerMatchLottieFile(cons, lf) {
  if (cons.assetBaseName !== lf.assetBaseName) return false;
  const lfNorm = String(lf.filePath).replace(/\\/g, '/');
  const inResRaw = /(?:^|\/)res\/raw(?:-[A-Za-z0-9_-]+)?\//.test(lfNorm);
  const inAssetsDir = /(?:^|\/)assets\//.test(lfNorm);

  if (cons.assetKind === 'raw' && inAssetsDir) return false;
  if (cons.assetKind === 'asset' && inResRaw) return false;

  if (cons.assetKind === 'asset' && cons.assetRelPath && cons.assetRelPath.includes('/') && inAssetsDir) {
    return lfNorm.endsWith(`/assets/${cons.assetRelPath}`) || lfNorm.endsWith(`/${cons.assetRelPath}`);
  }
  return true;
}

function checkO002(lottieFiles, lottieConsumers, rawFindings, rawCandidates) {
  const validLottieFiles = lottieFiles.filter((lf) => lf.isLottie);

  for (const lf of validLottieFiles) {
    if (lf.hasReducedMotionMarker) continue;

    const matchingConsumers = lottieConsumers.filter((c) => doesConsumerMatchLottieFile(c, lf));

    if (lf.hasComplexFeatures || lf.anyUnknownAtEnd) {
      if (lf.allBlankAtEnd || lf.anyUnknownAtEnd) {
        rawCandidates.push(
          makeRuleCandidate('O-002', {
            file: lf.filePath,
            lines: [1, lf.lineCount],
            evidence: `Lottie asset \`${path.basename(lf.filePath)}\` has no \`reduced motion\` marker and uses precomps/mattes/expressions that require visual rest-frame inspection.`,
            verificationHint: 'Render or inspect frame `op` (or the active `LottieClipSpec` end frame) at animator duration scale `0f` to confirm the icon/illustration remains legible.',
          })
        );
      }
      continue;
    }

    if (!lf.allBlankAtEnd && !lf.allBlankAtStart) {
      continue; // End and start frames have visible top-level layer(s) -> clean!
    }

    if (matchingConsumers.length === 0) {
      // Asset-only scan: cannot prove whether caller passes a compliant `LottieClipSpec` or reverse `speed`
      if (lf.allBlankAtEnd) {
        rawCandidates.push(
          makeRuleCandidate('O-002', {
            file: lf.filePath,
            lines: [1, lf.lineCount],
            evidence: `All ${lf.layerCount} top-level layer(s) in \`${path.basename(lf.filePath)}\` evaluate to 0% opacity (or end before \`op = ${lf.op}\`) with no \`reduced motion\` marker.`,
            verificationHint: 'Check all `LottieAnimation` / `animateLottieCompositionAsState` call sites for this asset: without a `reduced motion` marker or a readable `LottieClipSpec` endpoint, reduced-motion users see an empty frame.',
          })
        );
      }
      continue;
    }

    for (const cons of matchingConsumers) {
      // If multiple scanned Lottie files ambiguously match this consumer, abstain to `candidates[]`
      const candidateAssetsForConsumer = validLottieFiles.filter((other) => doesConsumerMatchLottieFile(cons, other));
      if (candidateAssetsForConsumer.length > 1) {
        if (lf.allBlankAtEnd || lf.allBlankAtStart) {
          rawCandidates.push(
            makeRuleCandidate('O-002', {
              file: cons.filePath,
              lines: cons.composableLines,
              evidence: `\`${cons.composableName}\` references \`${cons.assetBaseName}\`, which matches ${candidateAssetsForConsumer.length} Lottie JSON files in the scanned scope.`,
              verificationHint: 'Disambiguate which Lottie asset is bound at runtime and verify its reduced-motion rest frame.',
            })
          );
        }
        continue;
      }

      if (cons.progressKind === 'constant-mid') {
        // Explicit static interior frame (`progress = { 0.5f }`): never settles on `op` or `ip`
        continue;
      }

      if (cons.progressKind === 'custom-progress') {
        if (lf.allBlankAtEnd || lf.allBlankAtStart) {
          const viaDesc = cons.uncertainAsset
            ? 'via a conditional or dynamic `LottieCompositionSpec` selection'
            : cons.guardedByDurationScale
              ? 'inside an animator duration-scale guard'
              : cons.hasUnknownPlayback
                ? 'with a dynamic or non-forward playback parameter (`speed` / `isPlaying` / `reverseOnRepeat`)'
                : 'via an explicit custom `progress` lambda';
          rawCandidates.push(
            makeRuleCandidate('O-002', {
              file: cons.filePath,
              lines: cons.composableLines,
              evidence: `\`${cons.composableName}\` drives \`${path.basename(lf.filePath)}\` (no \`reduced motion\` marker) ${viaDesc}.`,
              verificationHint: 'Verify which frame is displayed when system animations are disabled (`scaleFactor == 0f`) and confirm that frame is visually legible.',
            })
          );
        }
        continue;
      }

      if (cons.hasClipSpec) {
        const blankAt = lf.allBlankAtEnd ? `op = ${lf.op}` : `ip = ${lf.ip}`;
        rawCandidates.push(
          makeRuleCandidate('O-002', {
            file: cons.filePath,
            lines: cons.composableLines,
            evidence: `\`${cons.composableName}\` plays \`${path.basename(lf.filePath)}\` (blank at \`${blankAt}\`, no \`reduced motion\` marker) with a custom \`clipSpec\`.`,
            verificationHint: 'Verify that the `LottieClipSpec` endpoint lands on a visible, meaningful rest frame when animations are disabled.',
          })
        );
        continue;
      }

      if (cons.isNegativeSpeed || cons.progressKind === 'constant-start') {
        if (lf.allBlankAtStart) {
          rawFindings.push(
            makeRuleFinding('O-002', {
              file: cons.filePath,
              lines: cons.composableLines,
              evidence: `\`${cons.composableName}\` renders \`${path.basename(lf.filePath)}\` at start frame \`ip = ${lf.ip}\` with no \`reduced motion\` marker, where all layers are transparent.`,
              remediation: 'Add a `reduced motion` marker in the Lottie JSON on a legible frame or pass a `LottieClipSpec` with a visible endpoint.',
              alsoAt: [{ file: lf.filePath, lines: [1, lf.lineCount] }],
              symbolContext: [cons.composableName],
            })
          );
        }
        continue;
      }

      if (lf.allBlankAtEnd) {
        rawFindings.push(
          makeRuleFinding('O-002', {
            file: cons.filePath,
            lines: cons.composableLines,
            evidence: `\`${cons.composableName}\` plays \`${path.basename(lf.filePath)}\` with default forward playback, no \`reduced motion\` marker, and 0% layer opacity at final frame \`op = ${lf.op}\`.`,
            remediation: 'Add a `reduced motion` marker on a visible peak frame in the Lottie asset, pass a `LottieClipSpec` ending on a visible frame, or render a static `Icon` when animator duration scale is `0f`.',
            alsoAt: [{ file: lf.filePath, lines: [1, lf.lineCount] }],
            symbolContext: [cons.composableName],
          })
        );
      }
    }
  }
}

function buildMotionStats(kotlinFiles, motionContracts) {
  const rawSpecs = {
    tween: 0,
    spring: 0,
    keyframes: 0,
    snap: 0,
    repeatable: 0,
    infiniteRepeatable: 0,
    totalCallSiteLiterals: 0,
    samples: [],
  };
  const tokenDefinitions = { count: 0, symbols: [] };
  const motionSchemeReads = { count: 0, bySpec: {} };
  const namedTokenReferences = { count: 0, bySymbol: {} };
  const navigationHosts = {
    navHostTotal: 0,
    navHostWithExplicitTransitions: 0,
    navHostDefaultOnly: 0,
    navDisplayTotal: 0,
    navDisplayWithTransitionSpec: 0,
  };
  const unresolvedSpecSites = { count: 0, samples: [] };

  for (const kf of kotlinFiles) {
    if (kf.lexError) continue;
    for (const c of kf.calls) {
      if (['tween', 'spring', 'keyframes', 'snap', 'repeatable', 'infiniteRepeatable'].includes(c.name) && c.hasParens && !c.receiver) {
        if (SPEC_LITERAL_NAMES.has(c.name) && isExemptSpecDefinitionSite(kf, c)) {
          const decl = [...c.enclosingDeclarations].reverse().find((d) => d.kind === 'val' || d.kind === 'fun');
          tokenDefinitions.count += 1;
          if (decl && tokenDefinitions.symbols.length < 50) {
            tokenDefinitions.symbols.push({ file: kf.filePath, line: c.startLine, name: decl.name, spec: c.name });
          }
        } else {
          rawSpecs[c.name] = (rawSpecs[c.name] || 0) + 1;
          if (SPEC_LITERAL_NAMES.has(c.name)) {
            rawSpecs.totalCallSiteLiterals += 1;
            if (rawSpecs.samples.length < 25) {
              rawSpecs.samples.push({ file: kf.filePath, line: c.startLine, snippet: c.snippet });
            }
          }
        }
      }

      if (c.receiver === 'motionScheme' || c.chainSegments.includes('motionScheme')) {
        motionSchemeReads.count += 1;
        motionSchemeReads.bySpec[c.name] = (motionSchemeReads.bySpec[c.name] || 0) + 1;
      } else if (c.receiver && /Motion$/i.test(c.receiver)) {
        const key = `${c.receiver}.${c.name}`;
        namedTokenReferences.count += 1;
        namedTokenReferences.bySymbol[key] = (namedTokenReferences.bySymbol[key] || 0) + 1;
      }

      if (c.name === 'NavHost' && c.hasParens) {
        navigationHosts.navHostTotal += 1;
        const hasEnter = c.args.some((a) => a.name === 'enterTransition' && a.text !== 'null');
        const hasExit = c.args.some((a) => a.name === 'exitTransition' && a.text !== 'null');
        if (hasEnter && hasExit) navigationHosts.navHostWithExplicitTransitions += 1;
        else navigationHosts.navHostDefaultOnly += 1;
      } else if (c.name === 'NavDisplay' && c.hasParens) {
        navigationHosts.navDisplayTotal += 1;
        const hasSpec = c.args.some((a) => a.name === 'transitionSpec' && a.text !== 'null');
        if (hasSpec) navigationHosts.navDisplayWithTransitionSpec += 1;
      }

      // Track animation consumers whose `animationSpec` argument is an opaque variable/call
      const specArg = c.args?.find((a) => a.name === 'animationSpec');
      if (specArg) {
        const txt = specArg.text;
        const isKnown =
          /\b(tween|spring|keyframes|snap|repeatable|infiniteRepeatable|motionScheme)\b/.test(txt) ||
          /\b[A-Za-z0-9_]*Motion\./.test(txt);
        if (!isKnown) {
          unresolvedSpecSites.count += 1;
          if (unresolvedSpecSites.samples.length < 20) {
            unresolvedSpecSites.samples.push({ file: kf.filePath, line: specArg.startLine, expr: txt });
          }
        }
      }
    }
  }

  return {
    scannedKotlinFiles: kotlinFiles.length,
    motionContractsFound: motionContracts.map((m) => ({
      file: m.filePath,
      lineCount: m.lineCount,
      counts: m.counts,
    })),
    rawSpecs,
    tokenDefinitions,
    motionSchemeReads,
    namedTokenReferences,
    navigationHosts,
    unresolvedSpecSites,
  };
}

export const MOTION_DOMAIN_PACK = Object.freeze({
  id: 'motion',
  description: 'Android Jetpack Compose motion floor, accessibility obligations, and taste rules (STANDARDS.md).',
  rules: MOTION_RULE_CATALOG,
  run: runMotionDomainChecks,
});
