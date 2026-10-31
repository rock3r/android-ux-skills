/**
 * Zero-dependency Kotlin token + trivia + structured call/declaration scanner.
 *
 * Handles:
 * - LF and CRLF 1-based line offsets
 * - Line comments (`// ...`), nested Kotlin block comments, and KDoc comments
 * - Normal strings (`"..."`), multi-dollar strings (`$$"..."`), and raw strings (`"""..."""`)
 *   with recursive lexing of `${...}` string-template expressions while keeping literal text inert
 * - Character literals (`'a'`, `'\''`)
 * - Backticked identifiers (`` `my name` ``)
 * - Generic type arguments on calls (`tween<T>(...)`, `composable<Route.Home> { ... }`)
 * - Named and positional arguments, trailing lambdas + lambda parameter lists (`{ index, _ -> ... }`)
 * - Enclosing declaration (`@Composable`, `fun`, `val`, `object`, `companion object`, `class`) and
 *   enclosing call/lambda stacks
 * - Scoped inline ignore comments (`android-ux-disable`, `-line`, `-next-line`)
 */

const KEYWORDS = new Set([
  'package', 'import', 'class', 'interface', 'object', 'companion', 'fun',
  'val', 'var', 'by', 'if', 'else', 'when', 'while', 'for', 'do', 'return',
  'break', 'continue', 'true', 'false', 'null', 'is', 'in', 'as', 'this',
  'super', 'try', 'catch', 'finally', 'throw', 'typealias', 'constructor', 'init',
]);

const MODIFIER_KEYWORDS = new Set([
  'public', 'private', 'protected', 'internal', 'open', 'final', 'abstract',
  'override', 'lateinit', 'inline', 'noinline', 'crossinline', 'reified',
  'suspend', 'tailrec', 'operator', 'infix', 'external', 'const', 'data',
  'sealed', 'enum', 'inner', 'value', 'JvmInline', 'expect', 'actual',
]);

export function buildLineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return {
    lineCount: starts.length,
    starts,
    lineOf(offset) {
      const clamped = Math.max(0, Math.min(offset, source.length));
      let lo = 0;
      let hi = starts.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= clamped) {
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return hi + 1; // 1-based
    },
  };
}

function isIdentStart(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c > 127;
}

function isIdentPart(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) ||
    c === 95 ||
    c > 127
  );
}

function isDigit(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}

/**
 * Lex Kotlin source into tokens + trivia.
 */
export function tokenizeKotlin(source) {
  const lineIndex = buildLineIndex(source);
  const tokens = [];
  const trivia = [];
  let lexError = null;
  const len = source.length;

  function lexRange(startOffset, endOffset, stopOnClosingBrace = false) {
    let i = startOffset;
    let braceDepth = 0;

    while (i < endOffset) {
      const ch = source[i];
      const next = source[i + 1] || '';

      // Whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        i += 1;
        continue;
      }

      // Line comment
      if (ch === '/' && next === '/') {
        const start = i;
        i += 2;
        while (i < endOffset && source[i] !== '\n') i += 1;
        const raw = source.slice(start, i).replace(/\r$/, '');
        trivia.push({
          kind: 'LineComment',
          value: raw,
          start,
          end: i,
          startLine: lineIndex.lineOf(start),
          endLine: lineIndex.lineOf(Math.max(start, i - 1)),
        });
        continue;
      }

      // Nested block comment / KDoc
      if (ch === '/' && next === '*') {
        const start = i;
        const isKDoc = source[i + 2] === '*' && source[i + 3] !== '/';
        let depth = 1;
        i += 2;
        while (i < endOffset && depth > 0) {
          if (source[i] === '/' && source[i + 1] === '*') {
            depth += 1;
            i += 2;
          } else if (source[i] === '*' && source[i + 1] === '/') {
            depth -= 1;
            i += 2;
          } else {
            i += 1;
          }
        }
        if (depth > 0) {
          lexError = `Unclosed block comment at line ${lineIndex.lineOf(start)}`;
        }
        trivia.push({
          kind: isKDoc ? 'KDoc' : 'BlockComment',
          value: source.slice(start, i),
          start,
          end: i,
          startLine: lineIndex.lineOf(start),
          endLine: lineIndex.lineOf(Math.max(start, i - 1)),
        });
        continue;
      }

      // Multi-dollar prefix check (`$$"..."` or `$$"""..."""`)
      let dollarCount = 0;
      if (ch === '$') {
        let j = i;
        while (j < endOffset && source[j] === '$') j += 1;
        if (source[j] === '"') {
          dollarCount = j - i;
          i = j;
        }
      }

      // Raw string `""" ... """` or normal string `" ... "`
      if (source[i] === '"') {
        const strStart = i - dollarCount;
        const triggerDollars = dollarCount > 0 ? dollarCount : 1;
        if (source[i + 1] === '"' && source[i + 2] === '"') {
          i += 3;
          const rawStartLine = lineIndex.lineOf(strStart);
          const rawTokIdx = tokens.length;
          let rawBuf = '';
          let hasTemplate = false;
          tokens.push({
            type: 'StringLiteral',
            raw: '"""',
            value: '',
            isRaw: true,
            start: strStart,
            end: i,
            line: rawStartLine,
            endLine: rawStartLine,
          });
          while (i < endOffset) {
            if (source[i] === '"' && source[i + 1] === '"' && source[i + 2] === '"') {
              // Consume extra quotes into rawBuf so `""""` closes on the trailing 3 quotes
              while (source[i + 3] === '"') {
                rawBuf += '"';
                i += 1;
              }
              i += 3;
              break;
            }
            // Check template `${...}`
            let d = 0;
            while (i + d < endOffset && source[i + d] === '$') d += 1;
            if (d >= triggerDollars && source[i + d] === '{') {
              hasTemplate = true;
              rawBuf += '$'.repeat(d - triggerDollars);
              i = i + d + 1; // right after `{`
              i = lexRange(i, endOffset, true);
              continue;
            }
            if (d >= triggerDollars && isIdentStart(source[i + d])) {
              hasTemplate = true;
              rawBuf += '$'.repeat(d - triggerDollars);
              const idStart = i + d;
              let idEnd = idStart + 1;
              while (idEnd < endOffset && isIdentPart(source[idEnd])) idEnd += 1;
              const ident = source.slice(idStart, idEnd);
              tokens.push({
                type: KEYWORDS.has(ident) ? 'Keyword' : 'Identifier',
                value: ident,
                raw: ident,
                inStringTemplate: true,
                start: idStart,
                end: idEnd,
                line: lineIndex.lineOf(idStart),
                endLine: lineIndex.lineOf(idEnd - 1),
              });
              i = idEnd;
              continue;
            }
            if (d > 0) {
              rawBuf += source.slice(i, i + d);
              i += d;
            } else {
              rawBuf += source[i];
              i += 1;
            }
          }
          tokens[rawTokIdx].raw = source.slice(strStart, i);
          tokens[rawTokIdx].value = hasTemplate ? '' : rawBuf;
          tokens[rawTokIdx].end = i;
          tokens[rawTokIdx].endLine = lineIndex.lineOf(Math.max(strStart, i - 1));
          continue;
        }

        // Normal single-line string `"..."`
        const sStart = strStart;
        const sStartLine = lineIndex.lineOf(sStart);
        const sTokIdx = tokens.length;
        let hasNormalTemplate = false;
        tokens.push({
          type: 'StringLiteral',
          raw: '"',
          value: '',
          isRaw: false,
          start: sStart,
          end: i + 1,
          line: sStartLine,
          endLine: sStartLine,
        });
        i += 1;
        let literalBuf = '';
        while (i < endOffset && source[i] !== '"' && source[i] !== '\n') {
          if (source[i] === '\\') {
            literalBuf += source.slice(i, Math.min(endOffset, i + 2));
            i = Math.min(endOffset, i + 2);
            continue;
          }
          let d = 0;
          while (i + d < endOffset && source[i + d] === '$') d += 1;
          if (d >= triggerDollars && source[i + d] === '{') {
            hasNormalTemplate = true;
            literalBuf += '$'.repeat(d - triggerDollars);
            i = i + d + 1;
            i = lexRange(i, endOffset, true);
            continue;
          }
          if (d >= triggerDollars && isIdentStart(source[i + d])) {
            hasNormalTemplate = true;
            literalBuf += '$'.repeat(d - triggerDollars);
            const idStart = i + d;
            let idEnd = idStart + 1;
            while (idEnd < endOffset && isIdentPart(source[idEnd])) idEnd += 1;
            const ident = source.slice(idStart, idEnd);
            tokens.push({
              type: KEYWORDS.has(ident) ? 'Keyword' : 'Identifier',
              value: ident,
              raw: ident,
              inStringTemplate: true,
              start: idStart,
              end: idEnd,
              line: lineIndex.lineOf(idStart),
              endLine: lineIndex.lineOf(idEnd - 1),
            });
            i = idEnd;
            continue;
          }
          literalBuf += source[i];
          i += 1;
        }
        if (i < endOffset && source[i] === '"') i += 1;
        tokens[sTokIdx].raw = source.slice(sStart, i);
        tokens[sTokIdx].value = hasNormalTemplate ? '' : literalBuf;
        tokens[sTokIdx].end = i;
        tokens[sTokIdx].endLine = lineIndex.lineOf(Math.max(sStart, i - 1));
        continue;
      }

      // Character literal `'a'` or `'\''`
      if (ch === '\'') {
        const start = i;
        i += 1;
        while (i < endOffset && source[i] !== '\'' && source[i] !== '\n') {
          if (source[i] === '\\') {
            i = Math.min(endOffset, i + 2);
          } else {
            i += 1;
          }
        }
        if (i < endOffset && source[i] === '\'') i += 1;
        tokens.push({
          type: 'CharLiteral',
          raw: source.slice(start, i),
          value: source.slice(start, i),
          start,
          end: i,
          line: lineIndex.lineOf(start),
          endLine: lineIndex.lineOf(Math.max(start, i - 1)),
        });
        continue;
      }

      // Backticked identifier `` `foo bar` ``
      if (ch === '`') {
        const start = i;
        i += 1;
        while (i < endOffset && source[i] !== '`' && source[i] !== '\n') i += 1;
        const inner = source.slice(start + 1, i);
        if (i < endOffset && source[i] === '`') i += 1;
        tokens.push({
          type: 'Identifier',
          value: inner,
          raw: source.slice(start, i),
          backticked: true,
          start,
          end: i,
          line: lineIndex.lineOf(start),
          endLine: lineIndex.lineOf(Math.max(start, i - 1)),
        });
        continue;
      }

      // Annotation `@Composable` / `@file:Suppress`
      if (ch === '@' && isIdentStart(next)) {
        const start = i;
        i += 1;
        while (i < endOffset && (isIdentPart(source[i]) || source[i] === ':' || source[i] === '.')) {
          i += 1;
        }
        const raw = source.slice(start, i);
        tokens.push({
          type: 'Annotation',
          value: raw.slice(1),
          raw,
          start,
          end: i,
          line: lineIndex.lineOf(start),
          endLine: lineIndex.lineOf(i - 1),
        });
        continue;
      }

      // Numbers (`0`, `8.dp` -> `8` `.` `dp`, `0.5f`, `0xFF00`)
      if (isDigit(ch)) {
        const start = i;
        if (ch === '0' && (next === 'x' || next === 'X' || next === 'b' || next === 'B')) {
          i += 2;
          while (i < endOffset && /[0-9a-fA-F_uUlL]/.test(source[i])) i += 1;
        } else {
          while (i < endOffset && /[0-9_]/.test(source[i])) i += 1;
          if (source[i] === '.' && isDigit(source[i + 1] || '')) {
            i += 1;
            while (i < endOffset && /[0-9_]/.test(source[i])) i += 1;
          }
          if (source[i] === 'e' || source[i] === 'E') {
            i += 1;
            if (source[i] === '+' || source[i] === '-') i += 1;
            while (i < endOffset && /[0-9_]/.test(source[i])) i += 1;
          }
          while (i < endOffset && /[fFuUlL]/.test(source[i])) i += 1;
        }
        const raw = source.slice(start, i);
        tokens.push({
          type: 'NumberLiteral',
          value: raw,
          raw,
          start,
          end: i,
          line: lineIndex.lineOf(start),
          endLine: lineIndex.lineOf(i - 1),
        });
        continue;
      }

      // Identifier or keyword (including `return@LaunchedEffect` label attachment)
      if (isIdentStart(ch)) {
        const start = i;
        i += 1;
        while (i < endOffset && isIdentPart(source[i])) i += 1;
        const word = source.slice(start, i);
        let label = null;
        if ((word === 'return' || word === 'break' || word === 'continue' || word === 'this' || word === 'super') &&
            source[i] === '@' && isIdentStart(source[i + 1] || '')) {
          const lStart = i + 1;
          i += 2;
          while (i < endOffset && isIdentPart(source[i])) i += 1;
          label = source.slice(lStart, i);
        }
        tokens.push({
          type: KEYWORDS.has(word) ? 'Keyword' : 'Identifier',
          value: word,
          label,
          raw: source.slice(start, i),
          start,
          end: i,
          line: lineIndex.lineOf(start),
          endLine: lineIndex.lineOf(i - 1),
        });
        continue;
      }

      // Closing brace for `${...}` template expression
      if (stopOnClosingBrace) {
        if (ch === '{') {
          braceDepth += 1;
        } else if (ch === '}') {
          if (braceDepth === 0) {
            return i + 1;
          }
          braceDepth -= 1;
        }
      }

      // Multi-char operators & punctuation
      const two = source.slice(i, i + 2);
      const three = source.slice(i, i + 3);
      let sym = ch;
      if (three === '===' || three === '!==' || three === '...') {
        sym = three;
      } else if (
        two === '->' || two === '?.' || two === '?:' || two === '::' ||
        two === '==' || two === '!=' || two === '<=' || two === '>=' ||
        two === '&&' || two === '||' || two === '+=' || two === '-=' ||
        two === '*=' || two === '/=' || two === '++' || two === '--' ||
        two === '..' || two === '!!'
      ) {
        sym = two;
      }
      const start = i;
      i += sym.length;
      tokens.push({
        type: 'Punct',
        value: sym,
        raw: sym,
        start,
        end: i,
        line: lineIndex.lineOf(start),
        endLine: lineIndex.lineOf(i - 1),
      });
    }
    return i;
  }

  lexRange(0, len, false);
  return { tokens, trivia, lineIndex, lexError };
}

/**
 * Parse inline ignore directives from comments:
 * - `// android-ux-disable RULE1, RULE2: reason`
 * - `// android-ux-disable-line RULE1: reason`
 * - `// android-ux-disable-next-line RULE1: reason`
 */
export function parseInlineIgnores(trivia, tokens) {
  const directives = [];
  const re = /^android-ux-disable(-next-line|-line)?\s+([A-Za-z0-9_, -]+?)\s*(?::|--)\s*(\S.*)$/i;

  // Build sorted lines that hold non-annotation tokens for `-next-line` skipping over `@Composable` etc.
  const codeLines = new Set();
  const annotationOnlyLines = new Set();
  const lineTokenTypes = new Map();
  for (const t of tokens) {
    if (!lineTokenTypes.has(t.line)) lineTokenTypes.set(t.line, []);
    lineTokenTypes.get(t.line).push(t);
  }
  for (const [ln, list] of lineTokenTypes.entries()) {
    const nonAnnot = list.some((t) => t.type !== 'Annotation' && !(t.type === 'Punct' && (t.value === '(' || t.value === ')')));
    if (nonAnnot) codeLines.add(ln);
    else annotationOnlyLines.add(ln);
  }

  for (const c of trivia) {
    // Skip KDoc comments (`/** ... */`) so documentation examples never suppress rules
    if (c.kind === 'BlockComment' && c.value.startsWith('/**') && !c.value.startsWith('/***/')) {
      continue;
    }
    const text = c.kind === 'LineComment'
      ? c.value.replace(/^\/\/\s*/, '').trim()
      : c.value.replace(/^\/\*\s*|\s*\*\/$/g, '').trim();
    if (text.includes('\n')) continue;
    const m = text.match(re);
    if (!m) continue;
    const mode = m[1] === '-next-line' ? 'next-line' : m[1] === '-line' ? 'line' : 'file';
    const rawRules = (m[2] || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]+-\d+$/.test(s));
    const reason = (m[3] || '').trim();
    // Require both explicit rule ID(s) and a non-empty reason (`// android-ux-disable-next-line F-001: <reason>`)
    if (rawRules.length === 0 || !reason) continue;

    let targetLine = c.endLine;
    if (mode === 'next-line') {
      targetLine = c.endLine + 1;
      while (annotationOnlyLines.has(targetLine)) {
        targetLine += 1;
      }
    }

    directives.push({
      mode,
      rules: rawRules,
      reason,
      commentLine: c.startLine,
      targetLine,
    });
  }
  return directives;
}

/**
 * Check if `tokens[idx]` starts a balanced `<TypeArgs>` list immediately followed by `(` or `{`.
 * Returns index after closing `>` or -1 if not a type argument list.
 */
function matchTypeArguments(tokens, idx) {
  if (!tokens[idx] || tokens[idx].type !== 'Punct' || tokens[idx].value !== '<') return -1;
  let depth = 0;
  let i = idx;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === 'Punct') {
      if (t.value === '<') {
        depth += 1;
      } else if (t.value === '>') {
        depth -= 1;
        if (depth === 0) {
          const after = tokens[i + 1];
          if (after && after.type === 'Punct' && (after.value === '(' || after.value === '{')) {
            return i + 1;
          }
          return -1;
        }
      } else if (t.value === '>=' && depth >= 1) {
        return -1;
      } else if (t.value !== ',' && t.value !== '.' && t.value !== '?' && t.value !== '*') {
        return -1;
      }
    } else if (t.type === 'Identifier' || (t.type === 'Keyword' && (t.value === 'in' || t.value === 'out' || t.value === 'null'))) {
      // valid inside `<...>`
    } else {
      return -1;
    }
    i += 1;
  }
  return -1;
}

function findMatchingDelimiter(tokens, openIdx, openSym, closeSym) {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type === 'Punct') {
      if (t.value === openSym) depth += 1;
      else if (t.value === closeSym) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

function parseArguments(source, tokens, openParenIdx, closeParenIdx) {
  const args = [];
  let curStart = openParenIdx + 1;
  let pDepth = 0;
  let bDepth = 0;
  let kDepth = 0;
  let argIndex = 0;

  function pushArg(startIdx, endIdx) {
    if (startIdx >= endIdx) return;
    const slice = tokens.slice(startIdx, endIdx);
    if (slice.length === 0) return;

    let name = null;
    let valueSlice = slice;
    if (
      slice.length >= 2 &&
      (slice[0].type === 'Identifier' || slice[0].type === 'Keyword') &&
      slice[1].type === 'Punct' &&
      slice[1].value === '='
    ) {
      name = slice[0].value;
      valueSlice = slice.slice(2);
    }

    const firstTok = valueSlice[0] || slice[0];
    const lastTok = valueSlice[valueSlice.length - 1] || slice[slice.length - 1];
    args.push({
      index: argIndex,
      name,
      tokens: valueSlice,
      allTokens: slice,
      text: source.slice(firstTok.start, lastTok.end).trim(),
      rawText: source.slice(slice[0].start, slice[slice.length - 1].end).trim(),
      startLine: slice[0].line,
      endLine: slice[slice.length - 1].endLine,
    });
    argIndex += 1;
  }

  for (let i = openParenIdx + 1; i < closeParenIdx; i += 1) {
    const t = tokens[i];
    if (t.type === 'Punct') {
      if (t.value === '(') pDepth += 1;
      else if (t.value === ')') pDepth -= 1;
      else if (t.value === '{') bDepth += 1;
      else if (t.value === '}') bDepth -= 1;
      else if (t.value === '[') kDepth += 1;
      else if (t.value === ']') kDepth -= 1;
      else if (t.value === ',' && pDepth === 0 && bDepth === 0 && kDepth === 0) {
        pushArg(curStart, i);
        curStart = i + 1;
      }
    }
  }
  pushArg(curStart, closeParenIdx);
  return args;
}

function parseLambda(source, tokens, openBraceIdx, closeBraceIdx) {
  // Look for top-level `->` before any nested `{` or `;` / statement
  let pDepth = 0;
  let bDepth = 0;
  let arrowIdx = -1;
  for (let i = openBraceIdx + 1; i < closeBraceIdx; i += 1) {
    const t = tokens[i];
    if (t.type === 'Punct') {
      if (t.value === '(') pDepth += 1;
      else if (t.value === ')') pDepth -= 1;
      else if (t.value === '{') {
        bDepth += 1;
        // A `{` before `->` at top level means there is no outer parameter list
        if (pDepth === 0 && bDepth === 1) break;
      } else if (t.value === '}') {
        bDepth -= 1;
      } else if (t.value === '->' && pDepth === 0 && bDepth === 0) {
        arrowIdx = i;
        break;
      }
    } else if (t.type === 'Keyword' && (t.value === 'val' || t.value === 'var' || t.value === 'if' || t.value === 'when' || t.value === 'while' || t.value === 'for' || t.value === 'return') && pDepth === 0 && bDepth === 0) {
      break;
    }
  }

  const params = [];
  let bodyStart = openBraceIdx + 1;
  if (arrowIdx !== -1) {
    bodyStart = arrowIdx + 1;
    // Split parameter declarations on top-level `,`
    let cur = [];
    let pd = 0;
    let td = 0;
    for (let i = openBraceIdx + 1; i <= arrowIdx; i += 1) {
      const t = tokens[i];
      const isEnd = i === arrowIdx || (t.type === 'Punct' && t.value === ',' && pd === 0 && td === 0);
      if (isEnd) {
        // Param name is the first identifier before `:` (or destructuring)
        const colonPos = cur.findIndex((x) => x.type === 'Punct' && x.value === ':');
        const head = colonPos === -1 ? cur : cur.slice(0, colonPos);
        const ident = head.find((x) => x.type === 'Identifier');
        if (ident) params.push(ident.value);
        else if (head.length > 0) params.push(head.map((x) => x.raw).join(''));
        cur = [];
      } else {
        if (t.type === 'Punct') {
          if (t.value === '(') pd += 1;
          else if (t.value === ')') pd -= 1;
          else if (t.value === '<') td += 1;
          else if (t.value === '>') td -= 1;
        }
        cur.push(t);
      }
    }
  }

  const bodyTokens = tokens.slice(bodyStart, closeBraceIdx);
  return {
    openBraceIdx,
    closeBraceIdx,
    arrowIdx,
    params,
    bodyTokens,
    text: source.slice(tokens[openBraceIdx].start, tokens[closeBraceIdx].end),
    startLine: tokens[openBraceIdx].line,
    endLine: tokens[closeBraceIdx].endLine,
  };
}

/**
 * Scan a Kotlin source file into tokens, declarations, calls, modifier chains, and inline ignores.
 */
export function scanKotlinSource(source, filePath = '<memory>') {
  const { tokens, trivia, lineIndex, lexError } = tokenizeKotlin(source);
  const inlineIgnores = parseInlineIgnores(trivia, tokens);

  const declarations = [];
  const calls = [];
  const imports = [];

  // Extract imports
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type === 'Keyword' && tokens[i].value === 'import') {
      let j = i + 1;
      const parts = [];
      while (j < tokens.length && tokens[j].line === tokens[i].line && !(tokens[j].type === 'Punct' && tokens[j].value === ';')) {
        parts.push(tokens[j].raw);
        j += 1;
      }
      imports.push(parts.join(''));
      i = j - 1;
    }
  }

  // Pass 1: Extract declarations (`class`, `object`, `companion object`, `fun`, `val`, `var`)
  let pendingAnnotations = [];
  let pendingModifiers = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type === 'Annotation') {
      pendingAnnotations.push(t.value);
      // Skip annotation arguments if present `@Suppress("...")`
      if (tokens[i + 1]?.type === 'Punct' && tokens[i + 1].value === '(') {
        const close = findMatchingDelimiter(tokens, i + 1, '(', ')');
        if (close !== -1) i = close;
      }
      continue;
    }
    if ((t.type === 'Keyword' || t.type === 'Identifier') && MODIFIER_KEYWORDS.has(t.value)) {
      pendingModifiers.push(t.value);
      continue;
    }

    if (t.type === 'Keyword' && (t.value === 'fun' || t.value === 'val' || t.value === 'var' || t.value === 'object' || t.value === 'class' || t.value === 'interface')) {
      const kind = t.value === 'object' && pendingModifiers.includes('companion') ? 'companion' : t.value;
      const startTokIdx = i;
      const annotations = [...pendingAnnotations];
      const modifiers = [...pendingModifiers];
      pendingAnnotations = [];
      pendingModifiers = [];

      let cursor = i + 1;
      // Optional generic type parameters on `fun <T> foo(...)`
      if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '<') {
        let td = 0;
        while (cursor < tokens.length) {
          if (tokens[cursor].type === 'Punct' && tokens[cursor].value === '<') td += 1;
          else if (tokens[cursor].type === 'Punct' && tokens[cursor].value === '>') {
            td -= 1;
            if (td === 0) {
              cursor += 1;
              break;
            }
          }
          cursor += 1;
        }
      }

      // For extension `fun Receiver.name(...)` or `val Receiver.name`, find the declaration name
      let declName = kind === 'companion' ? 'Companion' : '<anonymous>';
      let nameIdx = cursor;
      // Scan dotted / generic receiver up to `(` or `:` or `=` or `{` or `by`
      const identCandidates = [];
      let scan = cursor;
      let td = 0;
      while (scan < tokens.length) {
        const st = tokens[scan];
        if (st.type === 'Punct') {
          if (st.value === '<') td += 1;
          else if (st.value === '>') td = Math.max(0, td - 1);
          else if (td === 0 && (st.value === '(' || st.value === ':' || st.value === '=' || st.value === '{' || st.value === ',' || st.value === ';')) {
            break;
          }
        } else if (td === 0 && st.type === 'Keyword' && (st.value === 'by' || st.value === 'where')) {
          break;
        } else if (td === 0 && st.type === 'Identifier') {
          identCandidates.push({ name: st.value, idx: scan });
        }
        // Stop if newline before `=`/`{` on local val without initializer on next line? Keep scanning across receiver.
        if (identCandidates.length > 0 && st.line > tokens[identCandidates[identCandidates.length - 1].idx].line + 1 && td === 0) {
          break;
        }
        scan += 1;
      }
      if (identCandidates.length > 0) {
        const last = identCandidates[identCandidates.length - 1];
        declName = last.name;
        nameIdx = last.idx;
      }

      // Skip parameter list `(...)` if `fun` or `class`
      let afterSigIdx = scan;
      let paramRange = null;
      if (tokens[afterSigIdx]?.type === 'Punct' && tokens[afterSigIdx].value === '(' && (kind === 'fun' || kind === 'class')) {
        const closeP = findMatchingDelimiter(tokens, afterSigIdx, '(', ')');
        if (closeP !== -1) {
          paramRange = [afterSigIdx, closeP];
          afterSigIdx = closeP + 1;
        }
      }

      // Optional return type `: ReturnType`
      if (tokens[afterSigIdx]?.type === 'Punct' && tokens[afterSigIdx].value === ':') {
        afterSigIdx += 1;
        let rtd = 0;
        let rpd = 0;
        while (afterSigIdx < tokens.length) {
          const rt = tokens[afterSigIdx];
          if (rt.type === 'Punct') {
            if (rt.value === '<') rtd += 1;
            else if (rt.value === '>') rtd = Math.max(0, rtd - 1);
            else if (rt.value === '(') rpd += 1;
            else if (rt.value === ')') rpd = Math.max(0, rpd - 1);
            else if (rtd === 0 && rpd === 0 && (rt.value === '=' || rt.value === '{')) break;
          } else if (rtd === 0 && rpd === 0 && rt.type === 'Keyword' && (rt.value === 'by' || rt.value === 'where')) {
            break;
          }
          afterSigIdx += 1;
        }
      }

      let isExpressionBody = false;
      let delegateIdx = -1;
      let rhsStartIdx = -1;
      let endTokIdx = Math.max(startTokIdx, afterSigIdx - 1);

      if (tokens[afterSigIdx]?.type === 'Punct' && tokens[afterSigIdx].value === '{' && (kind === 'fun' || kind === 'class' || kind === 'object' || kind === 'companion' || kind === 'interface')) {
        const closeB = findMatchingDelimiter(tokens, afterSigIdx, '{', '}');
        if (closeB !== -1) {
          endTokIdx = closeB;
        }
      } else if (tokens[afterSigIdx]?.type === 'Punct' && tokens[afterSigIdx].value === '=') {
        isExpressionBody = true;
        rhsStartIdx = afterSigIdx + 1;
        endTokIdx = findExpressionEnd(tokens, rhsStartIdx);
      } else if (tokens[afterSigIdx]?.type === 'Keyword' && tokens[afterSigIdx].value === 'by') {
        delegateIdx = afterSigIdx + 1;
        endTokIdx = findExpressionEnd(tokens, delegateIdx);
      }

      const isComposable = annotations.some((a) => a === 'Composable' || a.endsWith('.Composable'));
      declarations.push({
        kind,
        name: declName,
        nameIdx,
        isComposable,
        annotations,
        modifiers,
        isExpressionBody,
        paramRange,
        rhsStartIdx,
        delegateIdx,
        startTokIdx,
        endTokIdx,
        startLine: tokens[startTokIdx].line,
        endLine: tokens[Math.min(tokens.length - 1, endTokIdx)].endLine,
      });
      continue;
    }

    // Any other token resets pending declaration annotations/modifiers unless inside punctuation of modifier
    if (!(t.type === 'Punct' && (t.value === '(' || t.value === ')'))) {
      pendingAnnotations = [];
      pendingModifiers = [];
    }
  }

  // Pass 2: Extract all function/method/constructor/DSL calls
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== 'Identifier') continue;

    // Skip declaration's own identifier (`fun Foo(` or `class Foo(`)
    const prev = tokens[i - 1];
    if (prev && prev.type === 'Keyword' && (prev.value === 'fun' || prev.value === 'class' || prev.value === 'object' || prev.value === 'interface' || prev.value === 'package' || prev.value === 'import')) {
      continue;
    }
    const isOwnDeclName = declarations.some((d) => d.nameIdx === i && (d.kind === 'fun' || d.kind === 'class' || d.kind === 'object' || d.kind === 'interface'));
    if (isOwnDeclName) continue;

    let cursor = i + 1;
    let typeArgsText = null;
    if (tokens[cursor]?.type === 'Punct' && tokens[cursor].value === '<') {
      const afterTypeArgs = matchTypeArguments(tokens, cursor);
      if (afterTypeArgs !== -1) {
        typeArgsText = source.slice(tokens[cursor].start, tokens[afterTypeArgs - 1].end);
        cursor = afterTypeArgs;
      }
    }

    const nextTok = tokens[cursor];
    if (!nextTok || nextTok.type !== 'Punct' || (nextTok.value !== '(' && nextTok.value !== '{')) {
      continue;
    }

    // Avoid treating `if (...) {` / `when (...) {` / `val x = foo` before `{` on unrelated block as call:
    // Here `t` is an `Identifier` (not a keyword like `if`/`when`/`while`/`for`/`try`/`catch`).
    // One edge case: `class Foo : Bar {` — if `{` is the body of an enclosing `class`/`object`/`interface` declaration, skip!
    if (nextTok.value === '{') {
      const isTypeBody = declarations.some(
        (d) => (d.kind === 'class' || d.kind === 'object' || d.kind === 'companion' || d.kind === 'interface') &&
               d.startTokIdx < i && d.endTokIdx >= cursor &&
               findTypeBodyOpenIdx(tokens, d) === cursor
      );
      if (isTypeBody) continue;
    }

    let hasParens = false;
    let openParenIdx = -1;
    let closeParenIdx = -1;
    let args = [];
    let afterArgsIdx = cursor;

    if (nextTok.value === '(') {
      closeParenIdx = findMatchingDelimiter(tokens, cursor, '(', ')');
      if (closeParenIdx === -1) continue;
      hasParens = true;
      openParenIdx = cursor;
      args = parseArguments(source, tokens, openParenIdx, closeParenIdx);
      afterArgsIdx = closeParenIdx + 1;
    }

    let trailingLambda = null;
    let endTokIdx = hasParens ? closeParenIdx : cursor;
    if (tokens[afterArgsIdx]?.type === 'Punct' && tokens[afterArgsIdx].value === '{') {
      // Only attach `{` as trailing lambda when on the same line or immediately next line (standard Kotlin trailing lambda)
      const prevLine = tokens[afterArgsIdx - 1].endLine;
      if (tokens[afterArgsIdx].line <= prevLine + 1) {
        const closeBraceIdx = findMatchingDelimiter(tokens, afterArgsIdx, '{', '}');
        if (closeBraceIdx !== -1) {
          trailingLambda = parseLambda(source, tokens, afterArgsIdx, closeBraceIdx);
          endTokIdx = closeBraceIdx;
        }
      }
    }

    // Walk backward across `.` / `?.` chain to find receiver and root chain
    const { receiver, chainRootIdx, chainSegments } = traceReceiverChain(tokens, i);

    calls.push({
      name: t.value,
      nameTokIdx: i,
      receiver,
      chainRootIdx,
      chainSegments,
      typeArgs: typeArgsText,
      hasParens,
      openParenIdx,
      closeParenIdx,
      args,
      trailingLambda,
      startTokIdx: i,
      endTokIdx,
      chainStartLine: tokens[chainRootIdx].line,
      startLine: t.line,
      headerEndLine: hasParens ? tokens[closeParenIdx].endLine : t.endLine,
      endLine: tokens[endTokIdx].endLine,
      snippet: source.slice(tokens[i].start, tokens[Math.min(endTokIdx, hasParens ? closeParenIdx : i)].end),
    });
  }

  // Attach enclosing declaration and enclosing call stacks to each call
  for (const call of calls) {
    call.enclosingDeclarations = declarations.filter(
      (d) => d.startTokIdx <= call.nameTokIdx && d.endTokIdx >= call.endTokIdx
    );
    call.enclosingCalls = calls.filter(
      (other) =>
        other !== call &&
        other.nameTokIdx < call.nameTokIdx &&
        other.endTokIdx >= call.endTokIdx
    );
  }

  return {
    filePath,
    source,
    lineIndex,
    tokens,
    trivia,
    lexError,
    imports,
    inlineIgnores,
    declarations,
    calls,
  };
}

function findTypeBodyOpenIdx(tokens, decl) {
  for (let k = decl.nameIdx + 1; k <= decl.endTokIdx; k += 1) {
    if (tokens[k]?.type === 'Punct' && tokens[k].value === '{') return k;
  }
  return -1;
}

function findExpressionEnd(tokens, startIdx) {
  let pDepth = 0;
  let bDepth = 0;
  let kDepth = 0;
  let lastIdx = startIdx;

  for (let i = startIdx; i < tokens.length; i += 1) {
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
      } else if (t.value === ',' && pDepth === 0 && bDepth === 0 && kDepth === 0) {
        break;
      }
    }

    lastIdx = i;

    // Check if the expression ended at the end of a line at depth 0
    const next = tokens[i + 1];
    if (!next) break;
    if (pDepth === 0 && bDepth === 0 && kDepth === 0 && next.line > t.endLine) {
      // Continues onto next line only if current token is a binary/chain continuation operator
      // or next token starts with `.`, `?.`, `?:`, `+`, `&&`, `||`, `{` (same/next line trailing lambda)
      const curContinues =
        (t.type === 'Punct' && ['.', '?.', '?:', '=', '+', '-', '*', '/', '&&', '||', '==', '!=', '<', '>'].includes(t.value)) ||
        (t.type === 'Keyword' && (t.value === 'else' || t.value === 'by'));
      const nextContinues =
        (next.type === 'Punct' && ['.', '?.', '?:', '+', '&&', '||', '{'].includes(next.value)) ||
        (next.type === 'Keyword' && next.value === 'else');
      if (!curContinues && !nextContinues) {
        break;
      }
    }
  }
  return lastIdx;
}

function traceReceiverChain(tokens, identIdx) {
  const segments = [{ name: tokens[identIdx].value, tokIdx: identIdx }];
  let cur = identIdx - 1;
  let chainRootIdx = identIdx;

  while (cur >= 0) {
    const dot = tokens[cur];
    if (!dot || dot.type !== 'Punct' || (dot.value !== '.' && dot.value !== '?.')) break;
    let prev = cur - 1;
    if (prev < 0) break;

    // Step backward across trailing `}` or `)` or `>` of a preceding call in the chain
    if (tokens[prev].type === 'Punct' && tokens[prev].value === '}') {
      prev = findMatchingBackward(tokens, prev, '{', '}') - 1;
    }
    if (prev >= 0 && tokens[prev].type === 'Punct' && tokens[prev].value === ')') {
      prev = findMatchingBackward(tokens, prev, '(', ')') - 1;
    }
    if (prev >= 0 && tokens[prev].type === 'Punct' && tokens[prev].value === '>') {
      const openAngle = findMatchingBackward(tokens, prev, '<', '>');
      if (openAngle > 0) prev = openAngle - 1;
    }
    if (prev >= 0 && (tokens[prev].type === 'Identifier' || (tokens[prev].type === 'Keyword' && tokens[prev].value === 'this'))) {
      segments.unshift({ name: tokens[prev].value, tokIdx: prev });
      chainRootIdx = prev;
      cur = prev - 1;
    } else {
      break;
    }
  }

  const receiver = segments.length >= 2 ? segments[segments.length - 2].name : null;
  return {
    receiver,
    chainRootIdx,
    chainSegments: segments.map((s) => s.name),
  };
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
  return 0;
}

/**
 * Helper to look up an argument by parameter name or positional index.
 */
export function getCallArg(call, paramName, positionalIndex = null) {
  if (!call || !Array.isArray(call.args)) return null;
  const named = call.args.find((a) => a.name === paramName);
  if (named) return named;
  if (positionalIndex !== null && positionalIndex >= 0 && positionalIndex < call.args.length) {
    const pos = call.args[positionalIndex];
    // Only match positional if no earlier argument used a named parameter and this arg itself isn't named for something else
    const anyNamedUpToPos = call.args.slice(0, positionalIndex + 1).some((a) => a.name !== null);
    if (!anyNamedUpToPos && pos.name === null) {
      return pos;
    }
  }
  return null;
}

/**
 * Check whether an inline ignore directive suppresses a finding for `ruleId` at `[startLine, endLine]`.
 * File-wide directives (`// android-ux-disable RULE: reason`) are restricted to overridable taste rules;
 * non-overridable floor/obligation rules require site-scoped `-next-line` or `-line`.
 */
export function matchInlineIgnore(inlineIgnores, ruleId, startLine, endLine, { allowFileMode = true } = {}) {
  if (!Array.isArray(inlineIgnores) || inlineIgnores.length === 0) return null;
  const normRule = String(ruleId || '').toUpperCase();
  for (const dir of inlineIgnores) {
    if (!dir.rules.includes(normRule)) continue;
    if (dir.mode === 'file') {
      if (allowFileMode) return dir;
      continue;
    }
    if (dir.mode === 'line' && dir.targetLine >= startLine && dir.targetLine <= endLine) return dir;
    if (dir.mode === 'next-line' && (dir.targetLine === startLine || (dir.targetLine >= startLine && dir.targetLine <= endLine))) {
      return dir;
    }
  }
  return null;
}
