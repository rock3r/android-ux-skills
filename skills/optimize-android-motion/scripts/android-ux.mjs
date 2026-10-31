#!/usr/bin/env node

// cli/src/index.mjs
import fs12 from "node:fs";
import path13 from "node:path";

// cli/src/version.mjs
var PACKAGE_NAME = "android-ux";
var PACKAGE_VERSION = "0.1.0";
var STANDARDS_VERSION = "0.2.0";
var SCHEMA_VERSION = 1;
var ENVELOPE_PREFIX = "[android-ux@1]";

// cli/src/diagnostics.mjs
function createDiagnostic({
  code,
  severity = "error",
  status = "fail",
  domain = "core",
  summary,
  searched = null,
  evidence = null,
  impact = null,
  remediation = null,
  docPath = "references/standards.md",
  file = null,
  lines = null,
  extra = {}
}) {
  const diag = {
    code,
    severity,
    status,
    domain,
    summary
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
function formatDiagnosticText(diag) {
  const level = (diag.severity || "error").toUpperCase();
  const out = [`[${level} ${diag.code}] ${diag.summary}`];
  if (diag.file) {
    const loc = Array.isArray(diag.lines) && diag.lines.length >= 2 ? `${diag.file}:${diag.lines[0]}-${diag.lines[1]}` : Array.isArray(diag.lines) && diag.lines.length === 1 ? `${diag.file}:${diag.lines[0]}` : diag.file;
    out.push(`  Location: ${loc}`);
  }
  if (diag.searched) {
    const text = Array.isArray(diag.searched) ? diag.searched.join(", ") : String(diag.searched);
    out.push(`  Searched: ${text}`);
  }
  if (diag.evidence) {
    out.push(`  Evidence: ${diag.evidence}`);
  }
  if (diag.impact) {
    out.push(`  Impact:   ${diag.impact}`);
  }
  if (diag.remediation) {
    const lines = Array.isArray(diag.remediation) ? diag.remediation : String(diag.remediation).split("\n");
    out.push(`  Fix:      ${lines[0]}`);
    for (let i = 1; i < lines.length; i += 1) {
      out.push(`            ${lines[i]}`);
    }
  }
  if (diag.docPath) {
    out.push(`  Docs:     ${diag.docPath}`);
  }
  return out.join("\n");
}
function createJsonEnvelope(command, payload = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    packageVersion: PACKAGE_VERSION,
    standardsVersion: STANDARDS_VERSION,
    command,
    ...payload
  };
}

// cli/src/scanner/kotlin-scanner.mjs
var KEYWORDS = /* @__PURE__ */ new Set([
  "package",
  "import",
  "class",
  "interface",
  "object",
  "companion",
  "fun",
  "val",
  "var",
  "by",
  "if",
  "else",
  "when",
  "while",
  "for",
  "do",
  "return",
  "break",
  "continue",
  "true",
  "false",
  "null",
  "is",
  "in",
  "as",
  "this",
  "super",
  "try",
  "catch",
  "finally",
  "throw",
  "typealias",
  "constructor",
  "init"
]);
var MODIFIER_KEYWORDS = /* @__PURE__ */ new Set([
  "public",
  "private",
  "protected",
  "internal",
  "open",
  "final",
  "abstract",
  "override",
  "lateinit",
  "inline",
  "noinline",
  "crossinline",
  "reified",
  "suspend",
  "tailrec",
  "operator",
  "infix",
  "external",
  "const",
  "data",
  "sealed",
  "enum",
  "inner",
  "value",
  "JvmInline",
  "expect",
  "actual"
]);
function buildLineIndex(source) {
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
        const mid = lo + hi >> 1;
        if (starts[mid] <= clamped) {
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return hi + 1;
    }
  };
}
function isIdentStart(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 95 || c > 127;
}
function isIdentPart(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 48 && c <= 57 || c === 95 || c > 127;
}
function isDigit(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}
function tokenizeKotlin(source) {
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
      const next = source[i + 1] || "";
      if (ch === " " || ch === "	" || ch === "\r" || ch === "\n") {
        i += 1;
        continue;
      }
      if (ch === "/" && next === "/") {
        const start2 = i;
        i += 2;
        while (i < endOffset && source[i] !== "\n") i += 1;
        const raw = source.slice(start2, i).replace(/\r$/, "");
        trivia.push({
          kind: "LineComment",
          value: raw,
          start: start2,
          end: i,
          startLine: lineIndex.lineOf(start2),
          endLine: lineIndex.lineOf(Math.max(start2, i - 1))
        });
        continue;
      }
      if (ch === "/" && next === "*") {
        const start2 = i;
        const isKDoc = source[i + 2] === "*" && source[i + 3] !== "/";
        let depth = 1;
        i += 2;
        while (i < endOffset && depth > 0) {
          if (source[i] === "/" && source[i + 1] === "*") {
            depth += 1;
            i += 2;
          } else if (source[i] === "*" && source[i + 1] === "/") {
            depth -= 1;
            i += 2;
          } else {
            i += 1;
          }
        }
        if (depth > 0) {
          lexError = `Unclosed block comment at line ${lineIndex.lineOf(start2)}`;
        }
        trivia.push({
          kind: isKDoc ? "KDoc" : "BlockComment",
          value: source.slice(start2, i),
          start: start2,
          end: i,
          startLine: lineIndex.lineOf(start2),
          endLine: lineIndex.lineOf(Math.max(start2, i - 1))
        });
        continue;
      }
      let dollarCount = 0;
      if (ch === "$") {
        let j = i;
        while (j < endOffset && source[j] === "$") j += 1;
        if (source[j] === '"') {
          dollarCount = j - i;
          i = j;
        }
      }
      if (source[i] === '"') {
        const strStart = i - dollarCount;
        const triggerDollars = dollarCount > 0 ? dollarCount : 1;
        if (source[i + 1] === '"' && source[i + 2] === '"') {
          i += 3;
          const rawStartLine = lineIndex.lineOf(strStart);
          const rawTokIdx = tokens.length;
          let rawBuf = "";
          let hasTemplate = false;
          tokens.push({
            type: "StringLiteral",
            raw: '"""',
            value: "",
            isRaw: true,
            start: strStart,
            end: i,
            line: rawStartLine,
            endLine: rawStartLine
          });
          while (i < endOffset) {
            if (source[i] === '"' && source[i + 1] === '"' && source[i + 2] === '"') {
              while (source[i + 3] === '"') {
                rawBuf += '"';
                i += 1;
              }
              i += 3;
              break;
            }
            let d = 0;
            while (i + d < endOffset && source[i + d] === "$") d += 1;
            if (d >= triggerDollars && source[i + d] === "{") {
              hasTemplate = true;
              rawBuf += "$".repeat(d - triggerDollars);
              i = i + d + 1;
              i = lexRange(i, endOffset, true);
              continue;
            }
            if (d >= triggerDollars && isIdentStart(source[i + d])) {
              hasTemplate = true;
              rawBuf += "$".repeat(d - triggerDollars);
              const idStart = i + d;
              let idEnd = idStart + 1;
              while (idEnd < endOffset && isIdentPart(source[idEnd])) idEnd += 1;
              const ident = source.slice(idStart, idEnd);
              tokens.push({
                type: KEYWORDS.has(ident) ? "Keyword" : "Identifier",
                value: ident,
                raw: ident,
                inStringTemplate: true,
                start: idStart,
                end: idEnd,
                line: lineIndex.lineOf(idStart),
                endLine: lineIndex.lineOf(idEnd - 1)
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
          tokens[rawTokIdx].value = hasTemplate ? "" : rawBuf;
          tokens[rawTokIdx].end = i;
          tokens[rawTokIdx].endLine = lineIndex.lineOf(Math.max(strStart, i - 1));
          continue;
        }
        const sStart = strStart;
        const sStartLine = lineIndex.lineOf(sStart);
        const sTokIdx = tokens.length;
        let hasNormalTemplate = false;
        tokens.push({
          type: "StringLiteral",
          raw: '"',
          value: "",
          isRaw: false,
          start: sStart,
          end: i + 1,
          line: sStartLine,
          endLine: sStartLine
        });
        i += 1;
        let literalBuf = "";
        while (i < endOffset && source[i] !== '"' && source[i] !== "\n") {
          if (source[i] === "\\") {
            literalBuf += source.slice(i, Math.min(endOffset, i + 2));
            i = Math.min(endOffset, i + 2);
            continue;
          }
          let d = 0;
          while (i + d < endOffset && source[i + d] === "$") d += 1;
          if (d >= triggerDollars && source[i + d] === "{") {
            hasNormalTemplate = true;
            literalBuf += "$".repeat(d - triggerDollars);
            i = i + d + 1;
            i = lexRange(i, endOffset, true);
            continue;
          }
          if (d >= triggerDollars && isIdentStart(source[i + d])) {
            hasNormalTemplate = true;
            literalBuf += "$".repeat(d - triggerDollars);
            const idStart = i + d;
            let idEnd = idStart + 1;
            while (idEnd < endOffset && isIdentPart(source[idEnd])) idEnd += 1;
            const ident = source.slice(idStart, idEnd);
            tokens.push({
              type: KEYWORDS.has(ident) ? "Keyword" : "Identifier",
              value: ident,
              raw: ident,
              inStringTemplate: true,
              start: idStart,
              end: idEnd,
              line: lineIndex.lineOf(idStart),
              endLine: lineIndex.lineOf(idEnd - 1)
            });
            i = idEnd;
            continue;
          }
          literalBuf += source[i];
          i += 1;
        }
        if (i < endOffset && source[i] === '"') i += 1;
        tokens[sTokIdx].raw = source.slice(sStart, i);
        tokens[sTokIdx].value = hasNormalTemplate ? "" : literalBuf;
        tokens[sTokIdx].end = i;
        tokens[sTokIdx].endLine = lineIndex.lineOf(Math.max(sStart, i - 1));
        continue;
      }
      if (ch === "'") {
        const start2 = i;
        i += 1;
        while (i < endOffset && source[i] !== "'" && source[i] !== "\n") {
          if (source[i] === "\\") {
            i = Math.min(endOffset, i + 2);
          } else {
            i += 1;
          }
        }
        if (i < endOffset && source[i] === "'") i += 1;
        tokens.push({
          type: "CharLiteral",
          raw: source.slice(start2, i),
          value: source.slice(start2, i),
          start: start2,
          end: i,
          line: lineIndex.lineOf(start2),
          endLine: lineIndex.lineOf(Math.max(start2, i - 1))
        });
        continue;
      }
      if (ch === "`") {
        const start2 = i;
        i += 1;
        while (i < endOffset && source[i] !== "`" && source[i] !== "\n") i += 1;
        const inner = source.slice(start2 + 1, i);
        if (i < endOffset && source[i] === "`") i += 1;
        tokens.push({
          type: "Identifier",
          value: inner,
          raw: source.slice(start2, i),
          backticked: true,
          start: start2,
          end: i,
          line: lineIndex.lineOf(start2),
          endLine: lineIndex.lineOf(Math.max(start2, i - 1))
        });
        continue;
      }
      if (ch === "@" && isIdentStart(next)) {
        const start2 = i;
        i += 1;
        while (i < endOffset && (isIdentPart(source[i]) || source[i] === ":" || source[i] === ".")) {
          i += 1;
        }
        const raw = source.slice(start2, i);
        tokens.push({
          type: "Annotation",
          value: raw.slice(1),
          raw,
          start: start2,
          end: i,
          line: lineIndex.lineOf(start2),
          endLine: lineIndex.lineOf(i - 1)
        });
        continue;
      }
      if (isDigit(ch)) {
        const start2 = i;
        if (ch === "0" && (next === "x" || next === "X" || next === "b" || next === "B")) {
          i += 2;
          while (i < endOffset && /[0-9a-fA-F_uUlL]/.test(source[i])) i += 1;
        } else {
          while (i < endOffset && /[0-9_]/.test(source[i])) i += 1;
          if (source[i] === "." && isDigit(source[i + 1] || "")) {
            i += 1;
            while (i < endOffset && /[0-9_]/.test(source[i])) i += 1;
          }
          if (source[i] === "e" || source[i] === "E") {
            i += 1;
            if (source[i] === "+" || source[i] === "-") i += 1;
            while (i < endOffset && /[0-9_]/.test(source[i])) i += 1;
          }
          while (i < endOffset && /[fFuUlL]/.test(source[i])) i += 1;
        }
        const raw = source.slice(start2, i);
        tokens.push({
          type: "NumberLiteral",
          value: raw,
          raw,
          start: start2,
          end: i,
          line: lineIndex.lineOf(start2),
          endLine: lineIndex.lineOf(i - 1)
        });
        continue;
      }
      if (isIdentStart(ch)) {
        const start2 = i;
        i += 1;
        while (i < endOffset && isIdentPart(source[i])) i += 1;
        const word = source.slice(start2, i);
        let label = null;
        if ((word === "return" || word === "break" || word === "continue" || word === "this" || word === "super") && source[i] === "@" && isIdentStart(source[i + 1] || "")) {
          const lStart = i + 1;
          i += 2;
          while (i < endOffset && isIdentPart(source[i])) i += 1;
          label = source.slice(lStart, i);
        }
        tokens.push({
          type: KEYWORDS.has(word) ? "Keyword" : "Identifier",
          value: word,
          label,
          raw: source.slice(start2, i),
          start: start2,
          end: i,
          line: lineIndex.lineOf(start2),
          endLine: lineIndex.lineOf(i - 1)
        });
        continue;
      }
      if (stopOnClosingBrace) {
        if (ch === "{") {
          braceDepth += 1;
        } else if (ch === "}") {
          if (braceDepth === 0) {
            return i + 1;
          }
          braceDepth -= 1;
        }
      }
      const two = source.slice(i, i + 2);
      const three = source.slice(i, i + 3);
      let sym = ch;
      if (three === "===" || three === "!==" || three === "...") {
        sym = three;
      } else if (two === "->" || two === "?." || two === "?:" || two === "::" || two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||" || two === "+=" || two === "-=" || two === "*=" || two === "/=" || two === "++" || two === "--" || two === ".." || two === "!!") {
        sym = two;
      }
      const start = i;
      i += sym.length;
      tokens.push({
        type: "Punct",
        value: sym,
        raw: sym,
        start,
        end: i,
        line: lineIndex.lineOf(start),
        endLine: lineIndex.lineOf(i - 1)
      });
    }
    return i;
  }
  lexRange(0, len, false);
  return { tokens, trivia, lineIndex, lexError };
}
function parseInlineIgnores(trivia, tokens) {
  const directives = [];
  const re = /^android-ux-disable(-next-line|-line)?\s+([A-Za-z0-9_, -]+?)\s*(?::|--)\s*(\S.*)$/i;
  const codeLines = /* @__PURE__ */ new Set();
  const annotationOnlyLines = /* @__PURE__ */ new Set();
  const lineTokenTypes = /* @__PURE__ */ new Map();
  for (const t of tokens) {
    if (!lineTokenTypes.has(t.line)) lineTokenTypes.set(t.line, []);
    lineTokenTypes.get(t.line).push(t);
  }
  for (const [ln, list] of lineTokenTypes.entries()) {
    const nonAnnot = list.some((t) => t.type !== "Annotation" && !(t.type === "Punct" && (t.value === "(" || t.value === ")")));
    if (nonAnnot) codeLines.add(ln);
    else annotationOnlyLines.add(ln);
  }
  for (const c of trivia) {
    if (c.kind === "BlockComment" && c.value.startsWith("/**") && !c.value.startsWith("/***/")) {
      continue;
    }
    const text = c.kind === "LineComment" ? c.value.replace(/^\/\/\s*/, "").trim() : c.value.replace(/^\/\*\s*|\s*\*\/$/g, "").trim();
    if (text.includes("\n")) continue;
    const m = text.match(re);
    if (!m) continue;
    const mode = m[1] === "-next-line" ? "next-line" : m[1] === "-line" ? "line" : "file";
    const rawRules = (m[2] || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]+-\d+$/.test(s));
    const reason = (m[3] || "").trim();
    if (rawRules.length === 0 || !reason) continue;
    let targetLine = c.endLine;
    if (mode === "next-line") {
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
      targetLine
    });
  }
  return directives;
}
function matchTypeArguments(tokens, idx) {
  if (!tokens[idx] || tokens[idx].type !== "Punct" || tokens[idx].value !== "<") return -1;
  let depth = 0;
  let i = idx;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === "Punct") {
      if (t.value === "<") {
        depth += 1;
      } else if (t.value === ">") {
        depth -= 1;
        if (depth === 0) {
          const after = tokens[i + 1];
          if (after && after.type === "Punct" && (after.value === "(" || after.value === "{")) {
            return i + 1;
          }
          return -1;
        }
      } else if (t.value === ">=" && depth >= 1) {
        return -1;
      } else if (t.value !== "," && t.value !== "." && t.value !== "?" && t.value !== "*") {
        return -1;
      }
    } else if (t.type === "Identifier" || t.type === "Keyword" && (t.value === "in" || t.value === "out" || t.value === "null")) {
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
    if (t.type === "Punct") {
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
    if (slice.length >= 2 && (slice[0].type === "Identifier" || slice[0].type === "Keyword") && slice[1].type === "Punct" && slice[1].value === "=") {
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
      endLine: slice[slice.length - 1].endLine
    });
    argIndex += 1;
  }
  for (let i = openParenIdx + 1; i < closeParenIdx; i += 1) {
    const t = tokens[i];
    if (t.type === "Punct") {
      if (t.value === "(") pDepth += 1;
      else if (t.value === ")") pDepth -= 1;
      else if (t.value === "{") bDepth += 1;
      else if (t.value === "}") bDepth -= 1;
      else if (t.value === "[") kDepth += 1;
      else if (t.value === "]") kDepth -= 1;
      else if (t.value === "," && pDepth === 0 && bDepth === 0 && kDepth === 0) {
        pushArg(curStart, i);
        curStart = i + 1;
      }
    }
  }
  pushArg(curStart, closeParenIdx);
  return args;
}
function parseLambda(source, tokens, openBraceIdx, closeBraceIdx) {
  let pDepth = 0;
  let bDepth = 0;
  let arrowIdx = -1;
  for (let i = openBraceIdx + 1; i < closeBraceIdx; i += 1) {
    const t = tokens[i];
    if (t.type === "Punct") {
      if (t.value === "(") pDepth += 1;
      else if (t.value === ")") pDepth -= 1;
      else if (t.value === "{") {
        bDepth += 1;
        if (pDepth === 0 && bDepth === 1) break;
      } else if (t.value === "}") {
        bDepth -= 1;
      } else if (t.value === "->" && pDepth === 0 && bDepth === 0) {
        arrowIdx = i;
        break;
      }
    } else if (t.type === "Keyword" && (t.value === "val" || t.value === "var" || t.value === "if" || t.value === "when" || t.value === "while" || t.value === "for" || t.value === "return") && pDepth === 0 && bDepth === 0) {
      break;
    }
  }
  const params = [];
  let bodyStart = openBraceIdx + 1;
  if (arrowIdx !== -1) {
    bodyStart = arrowIdx + 1;
    let cur = [];
    let pd = 0;
    let td = 0;
    for (let i = openBraceIdx + 1; i <= arrowIdx; i += 1) {
      const t = tokens[i];
      const isEnd = i === arrowIdx || t.type === "Punct" && t.value === "," && pd === 0 && td === 0;
      if (isEnd) {
        const colonPos = cur.findIndex((x) => x.type === "Punct" && x.value === ":");
        const head = colonPos === -1 ? cur : cur.slice(0, colonPos);
        const ident = head.find((x) => x.type === "Identifier");
        if (ident) params.push(ident.value);
        else if (head.length > 0) params.push(head.map((x) => x.raw).join(""));
        cur = [];
      } else {
        if (t.type === "Punct") {
          if (t.value === "(") pd += 1;
          else if (t.value === ")") pd -= 1;
          else if (t.value === "<") td += 1;
          else if (t.value === ">") td -= 1;
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
    endLine: tokens[closeBraceIdx].endLine
  };
}
function scanKotlinSource(source, filePath = "<memory>") {
  const { tokens, trivia, lineIndex, lexError } = tokenizeKotlin(source);
  const inlineIgnores = parseInlineIgnores(trivia, tokens);
  const declarations = [];
  const calls = [];
  const imports = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type === "Keyword" && tokens[i].value === "import") {
      let j = i + 1;
      const parts = [];
      while (j < tokens.length && tokens[j].line === tokens[i].line && !(tokens[j].type === "Punct" && tokens[j].value === ";")) {
        parts.push(tokens[j].raw);
        j += 1;
      }
      imports.push(parts.join(""));
      i = j - 1;
    }
  }
  let pendingAnnotations = [];
  let pendingModifiers = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type === "Annotation") {
      pendingAnnotations.push(t.value);
      if (tokens[i + 1]?.type === "Punct" && tokens[i + 1].value === "(") {
        const close = findMatchingDelimiter(tokens, i + 1, "(", ")");
        if (close !== -1) i = close;
      }
      continue;
    }
    if ((t.type === "Keyword" || t.type === "Identifier") && MODIFIER_KEYWORDS.has(t.value)) {
      pendingModifiers.push(t.value);
      continue;
    }
    if (t.type === "Keyword" && (t.value === "fun" || t.value === "val" || t.value === "var" || t.value === "object" || t.value === "class" || t.value === "interface")) {
      const kind = t.value === "object" && pendingModifiers.includes("companion") ? "companion" : t.value;
      const startTokIdx = i;
      const annotations = [...pendingAnnotations];
      const modifiers = [...pendingModifiers];
      pendingAnnotations = [];
      pendingModifiers = [];
      let cursor = i + 1;
      if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "<") {
        let td2 = 0;
        while (cursor < tokens.length) {
          if (tokens[cursor].type === "Punct" && tokens[cursor].value === "<") td2 += 1;
          else if (tokens[cursor].type === "Punct" && tokens[cursor].value === ">") {
            td2 -= 1;
            if (td2 === 0) {
              cursor += 1;
              break;
            }
          }
          cursor += 1;
        }
      }
      let declName = kind === "companion" ? "Companion" : "<anonymous>";
      let nameIdx = cursor;
      const identCandidates = [];
      let scan = cursor;
      let td = 0;
      while (scan < tokens.length) {
        const st = tokens[scan];
        if (st.type === "Punct") {
          if (st.value === "<") td += 1;
          else if (st.value === ">") td = Math.max(0, td - 1);
          else if (td === 0 && (st.value === "(" || st.value === ":" || st.value === "=" || st.value === "{" || st.value === "," || st.value === ";")) {
            break;
          }
        } else if (td === 0 && st.type === "Keyword" && (st.value === "by" || st.value === "where")) {
          break;
        } else if (td === 0 && st.type === "Identifier") {
          identCandidates.push({ name: st.value, idx: scan });
        }
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
      let afterSigIdx = scan;
      let paramRange = null;
      if (tokens[afterSigIdx]?.type === "Punct" && tokens[afterSigIdx].value === "(" && (kind === "fun" || kind === "class")) {
        const closeP = findMatchingDelimiter(tokens, afterSigIdx, "(", ")");
        if (closeP !== -1) {
          paramRange = [afterSigIdx, closeP];
          afterSigIdx = closeP + 1;
        }
      }
      if (tokens[afterSigIdx]?.type === "Punct" && tokens[afterSigIdx].value === ":") {
        afterSigIdx += 1;
        let rtd = 0;
        let rpd = 0;
        while (afterSigIdx < tokens.length) {
          const rt = tokens[afterSigIdx];
          if (rt.type === "Punct") {
            if (rt.value === "<") rtd += 1;
            else if (rt.value === ">") rtd = Math.max(0, rtd - 1);
            else if (rt.value === "(") rpd += 1;
            else if (rt.value === ")") rpd = Math.max(0, rpd - 1);
            else if (rtd === 0 && rpd === 0 && (rt.value === "=" || rt.value === "{")) break;
          } else if (rtd === 0 && rpd === 0 && rt.type === "Keyword" && (rt.value === "by" || rt.value === "where")) {
            break;
          }
          afterSigIdx += 1;
        }
      }
      if (tokens[afterSigIdx]?.type === "Keyword" && tokens[afterSigIdx].value === "where" && (kind === "fun" || kind === "class" || kind === "interface")) {
        afterSigIdx += 1;
        let wtd = 0;
        let wpd = 0;
        while (afterSigIdx < tokens.length) {
          const wt = tokens[afterSigIdx];
          if (wt.type === "Punct") {
            if (wt.value === "<") wtd += 1;
            else if (wt.value === ">") wtd = Math.max(0, wtd - 1);
            else if (wt.value === "(") wpd += 1;
            else if (wt.value === ")") wpd = Math.max(0, wpd - 1);
            else if (wtd === 0 && wpd === 0 && (wt.value === "=" || wt.value === "{")) break;
          }
          afterSigIdx += 1;
        }
      }
      let isExpressionBody = false;
      let delegateIdx = -1;
      let rhsStartIdx = -1;
      let bodyOpenIdx = -1;
      let endTokIdx = Math.max(startTokIdx, afterSigIdx - 1);
      if (tokens[afterSigIdx]?.type === "Punct" && tokens[afterSigIdx].value === "{" && (kind === "fun" || kind === "class" || kind === "object" || kind === "companion" || kind === "interface")) {
        const closeB = findMatchingDelimiter(tokens, afterSigIdx, "{", "}");
        if (closeB !== -1) {
          bodyOpenIdx = afterSigIdx;
          endTokIdx = closeB;
        }
      } else if (tokens[afterSigIdx]?.type === "Punct" && tokens[afterSigIdx].value === "=") {
        isExpressionBody = true;
        rhsStartIdx = afterSigIdx + 1;
        endTokIdx = findExpressionEnd(tokens, rhsStartIdx);
      } else if (tokens[afterSigIdx]?.type === "Keyword" && tokens[afterSigIdx].value === "by") {
        delegateIdx = afterSigIdx + 1;
        endTokIdx = findExpressionEnd(tokens, delegateIdx);
      }
      const isComposable = annotations.some((a) => a === "Composable" || a.endsWith(".Composable"));
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
        bodyOpenIdx,
        startTokIdx,
        endTokIdx,
        startLine: tokens[startTokIdx].line,
        endLine: tokens[Math.min(tokens.length - 1, endTokIdx)].endLine
      });
      continue;
    }
    if (!(t.type === "Punct" && (t.value === "(" || t.value === ")"))) {
      pendingAnnotations = [];
      pendingModifiers = [];
    }
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== "Identifier") continue;
    const prev = tokens[i - 1];
    if (prev && prev.type === "Keyword" && (prev.value === "fun" || prev.value === "class" || prev.value === "object" || prev.value === "interface" || prev.value === "package" || prev.value === "import")) {
      continue;
    }
    const isOwnDeclName = declarations.some((d) => d.nameIdx === i && (d.kind === "fun" || d.kind === "class" || d.kind === "object" || d.kind === "interface"));
    if (isOwnDeclName) continue;
    let cursor = i + 1;
    let typeArgsText = null;
    if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "<") {
      const afterTypeArgs = matchTypeArguments(tokens, cursor);
      if (afterTypeArgs !== -1) {
        typeArgsText = source.slice(tokens[cursor].start, tokens[afterTypeArgs - 1].end);
        cursor = afterTypeArgs;
      }
    }
    const nextTok = tokens[cursor];
    if (!nextTok || nextTok.type !== "Punct" || nextTok.value !== "(" && nextTok.value !== "{") {
      continue;
    }
    if (nextTok.value === "{") {
      const isDeclBody = declarations.some(
        (d) => d.bodyOpenIdx === cursor || (d.kind === "class" || d.kind === "object" || d.kind === "companion" || d.kind === "interface") && d.startTokIdx < i && d.endTokIdx >= cursor && findTypeBodyOpenIdx(tokens, d) === cursor
      );
      if (isDeclBody) continue;
    }
    let hasParens = false;
    let openParenIdx = -1;
    let closeParenIdx = -1;
    let args = [];
    let afterArgsIdx = cursor;
    if (nextTok.value === "(") {
      closeParenIdx = findMatchingDelimiter(tokens, cursor, "(", ")");
      if (closeParenIdx === -1) continue;
      hasParens = true;
      openParenIdx = cursor;
      args = parseArguments(source, tokens, openParenIdx, closeParenIdx);
      afterArgsIdx = closeParenIdx + 1;
    }
    let trailingLambda = null;
    let endTokIdx = hasParens ? closeParenIdx : cursor;
    if (tokens[afterArgsIdx]?.type === "Punct" && tokens[afterArgsIdx].value === "{" && !declarations.some((d) => d.bodyOpenIdx === afterArgsIdx)) {
      const prevLine = tokens[afterArgsIdx - 1].endLine;
      if (tokens[afterArgsIdx].line <= prevLine + 1) {
        const closeBraceIdx = findMatchingDelimiter(tokens, afterArgsIdx, "{", "}");
        if (closeBraceIdx !== -1) {
          trailingLambda = parseLambda(source, tokens, afterArgsIdx, closeBraceIdx);
          endTokIdx = closeBraceIdx;
        }
      }
    }
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
      snippet: source.slice(tokens[i].start, tokens[Math.min(endTokIdx, hasParens ? closeParenIdx : i)].end)
    });
  }
  for (const call of calls) {
    call.enclosingDeclarations = declarations.filter(
      (d) => d.startTokIdx <= call.nameTokIdx && d.endTokIdx >= call.endTokIdx
    );
    call.enclosingCalls = calls.filter(
      (other) => other !== call && other.nameTokIdx < call.nameTokIdx && other.endTokIdx >= call.endTokIdx
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
    calls
  };
}
function findTypeBodyOpenIdx(tokens, decl) {
  for (let k = decl.nameIdx + 1; k <= decl.endTokIdx; k += 1) {
    if (tokens[k]?.type === "Punct" && tokens[k].value === "{") return k;
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
    if (t.type === "Punct") {
      if (t.value === "(") pDepth += 1;
      else if (t.value === ")") {
        if (pDepth === 0) break;
        pDepth -= 1;
      } else if (t.value === "{") bDepth += 1;
      else if (t.value === "}") {
        if (bDepth === 0) break;
        bDepth -= 1;
      } else if (t.value === "[") kDepth += 1;
      else if (t.value === "]") {
        if (kDepth === 0) break;
        kDepth -= 1;
      } else if (t.value === ";" && pDepth === 0 && bDepth === 0 && kDepth === 0) {
        break;
      } else if (t.value === "," && pDepth === 0 && bDepth === 0 && kDepth === 0) {
        break;
      }
    }
    lastIdx = i;
    const next = tokens[i + 1];
    if (!next) break;
    if (pDepth === 0 && bDepth === 0 && kDepth === 0 && next.line > t.endLine) {
      const curContinues = t.type === "Punct" && [".", "?.", "?:", "=", "+", "-", "*", "/", "&&", "||", "==", "!=", "<", ">"].includes(t.value) || t.type === "Keyword" && (t.value === "else" || t.value === "by");
      const nextContinues = next.type === "Punct" && [".", "?.", "?:", "+", "&&", "||", "{"].includes(next.value) || next.type === "Keyword" && next.value === "else";
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
    if (!dot || dot.type !== "Punct" || dot.value !== "." && dot.value !== "?.") break;
    let prev = cur - 1;
    if (prev < 0) break;
    if (tokens[prev].type === "Punct" && tokens[prev].value === "}") {
      prev = findMatchingBackward(tokens, prev, "{", "}") - 1;
    }
    if (prev >= 0 && tokens[prev].type === "Punct" && tokens[prev].value === ")") {
      prev = findMatchingBackward(tokens, prev, "(", ")") - 1;
    }
    if (prev >= 0 && tokens[prev].type === "Punct" && tokens[prev].value === ">") {
      const openAngle = findMatchingBackward(tokens, prev, "<", ">");
      if (openAngle > 0) prev = openAngle - 1;
    }
    if (prev >= 0 && (tokens[prev].type === "Identifier" || tokens[prev].type === "Keyword" && tokens[prev].value === "this")) {
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
    chainSegments: segments.map((s) => s.name)
  };
}
function findMatchingBackward(tokens, closeIdx, openSym, closeSym) {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i -= 1) {
    const t = tokens[i];
    if (t.type === "Punct") {
      if (t.value === closeSym) depth += 1;
      else if (t.value === openSym) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
  }
  return 0;
}
function getCallArg(call, paramName, positionalIndex = null) {
  if (!call || !Array.isArray(call.args)) return null;
  const named = call.args.find((a) => a.name === paramName);
  if (named) return named;
  if (positionalIndex !== null && positionalIndex >= 0 && positionalIndex < call.args.length) {
    const pos = call.args[positionalIndex];
    const anyNamedUpToPos = call.args.slice(0, positionalIndex + 1).some((a) => a.name !== null);
    if (!anyNamedUpToPos && pos.name === null) {
      return pos;
    }
  }
  return null;
}
function matchInlineIgnore(inlineIgnores, ruleId, startLine, endLine, { allowFileMode = true } = {}) {
  if (!Array.isArray(inlineIgnores) || inlineIgnores.length === 0) return null;
  const normRule = String(ruleId || "").toUpperCase();
  for (const dir of inlineIgnores) {
    if (!dir.rules.includes(normRule)) continue;
    if (dir.mode === "file") {
      if (allowFileMode) return dir;
      continue;
    }
    if (dir.mode === "line" && dir.targetLine >= startLine && dir.targetLine <= endLine) return dir;
    if (dir.mode === "next-line" && (dir.targetLine === startLine || dir.targetLine >= startLine && dir.targetLine <= endLine)) {
      return dir;
    }
  }
  return null;
}

// cli/src/scanner/motion-md.mjs
import fs from "node:fs";
import path from "node:path";
var MOTION_MD_MAX_LINES = 80;
var VALID_STATUS_TAGS = /* @__PURE__ */ new Set(["DECIDED", "OBSERVED", "OPEN"]);
var KNOWN_SECTIONS = /* @__PURE__ */ new Set([
  "Design system",
  "Fallback",
  "Specs",
  "Exceptions",
  "Frequency map",
  "Gestures and haptics",
  "Reduced motion",
  "Not in this codebase",
  // Legacy / alternate headings accepted without warning:
  "Mode",
  "Relationships"
]);
var CONDITIONAL_EXCEPTION_RE = /\b(until|while|temporary|temporarily|before|when|pending|todo|workaround)\b/i;
function normalizeWs(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
function specContentSignature(s) {
  return `${normalizeWs(s.intent)}||${normalizeWs(s.binding)}`;
}
function stripHtmlCommentsPreservingLines(rawText) {
  return rawText.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => m.replace(/[^\n]/g, " "));
}
function parseMotionMd(content, filePath = "MOTION.md", { draft = false, baseContent = null } = {}) {
  const baseRatifiedSpecs = /* @__PURE__ */ new Map();
  let baseFreqSignature = null;
  const baseStandaloneDecided = /* @__PURE__ */ new Set();
  if (draft && typeof baseContent === "string" && baseContent.trim()) {
    const baseParsed = parseMotionMd(baseContent, filePath, { draft: false });
    for (const s of baseParsed.specs) {
      if (s.status === "DECIDED" && s.name) {
        baseRatifiedSpecs.set(normalizeWs(s.name), specContentSignature(s));
      }
    }
    if (baseParsed.frequencyMap?.tag === "DECIDED") {
      baseFreqSignature = baseParsed.frequencyMap.items.map((it) => normalizeWs(it.raw)).join("\n");
    }
    for (const st of baseParsed._standaloneDecided || []) {
      baseStandaloneDecided.add(st);
    }
  }
  const normalizedContent = String(content).replace(/\r\n/g, "\n");
  const rawLinesForCount = normalizedContent.split("\n");
  const lineCount = rawLinesForCount.length > 0 && rawLinesForCount[rawLinesForCount.length - 1] === "" ? rawLinesForCount.length - 1 : rawLinesForCount.length;
  const commentStrippedLines = stripHtmlCommentsPreservingLines(normalizedContent).split("\n");
  const lintFindings = [];
  if (lineCount > MOTION_MD_MAX_LINES) {
    lintFindings.push({
      rule: "AUX-MD-LENGTH",
      domain: "motion",
      class: "contract",
      severity: "major",
      file: filePath,
      lines: [MOTION_MD_MAX_LINES + 1, lineCount],
      summary: `MOTION.md is ${lineCount} lines long (cap is ${MOTION_MD_MAX_LINES} lines).`,
      remediation: `Trim MOTION.md to <= ${MOTION_MD_MAX_LINES} lines so every consumer can read the full motion contract in one pass.`,
      docPath: "references/motion-md.md"
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
  const bindings = /* @__PURE__ */ new Set();
  const counts = { DECIDED: 0, OBSERVED: 0, OPEN: 0 };
  const standaloneDecidedRecords = [];
  function validateStatusTag(rawTag, lineNum, label) {
    const clean = stripTicks(rawTag).replace(/^\[|\]$/g, "").trim().toUpperCase();
    if (!clean) return null;
    if (!VALID_STATUS_TAGS.has(clean)) {
      lintFindings.push({
        rule: "AUX-MD-TAG",
        domain: "motion",
        class: "contract",
        severity: "major",
        file: filePath,
        lines: [lineNum, lineNum],
        summary: `Invalid status tag "${rawTag}"${label ? ` on ${label}` : ""} in MOTION.md.`,
        remediation: "Use only DECIDED, OBSERVED, or OPEN.",
        docPath: "references/motion-md.md"
      });
      return null;
    }
    counts[clean] += 1;
    return clean;
  }
  for (let idx = 0; idx < lineCount; idx += 1) {
    const currentLine = idx + 1;
    const line = commentStrippedLines[idx] ?? "";
    const trimmed = line.trim();
    if (!trimmed) continue;
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
    if (/^#\s+/.test(trimmed) && !/^##/.test(trimmed)) continue;
    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2 && !trimmed.startsWith("###")) {
      currentSection = h2[1].trim();
      currentSpecEntry = null;
      sectionsSeen.push({ name: currentSection, line: currentLine });
      if (!KNOWN_SECTIONS.has(currentSection)) {
        lintFindings.push({
          rule: "AUX-MD-SECTION",
          domain: "motion",
          class: "contract",
          severity: "minor",
          file: filePath,
          lines: [currentLine, currentLine],
          summary: `Unrecognized MOTION.md section heading "## ${currentSection}".`,
          remediation: "Use standard sections from references/motion-md.md: Design system, Fallback, Specs, Exceptions, Frequency map, Gestures and haptics, Reduced motion, Not in this codebase.",
          docPath: "references/motion-md.md"
        });
      }
      continue;
    }
    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3 && currentSection === "Specs") {
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
        intent: "",
        binding: "",
        bindings: [],
        status: inlineStatus,
        statusLine
      };
      specs.push(currentSpecEntry);
      continue;
    }
    const boldTagMatch = trimmed.match(/^(?:-\s*)?\*\*Tag\*\*\s*(?:—|--|-|:)\s*(.+)$/i);
    if (boldTagMatch) {
      const parsedStatus = validateStatusTag(boldTagMatch[1], currentLine, currentSpecEntry ? `"${currentSpecEntry.name}"` : currentSection);
      if (currentSpecEntry) {
        currentSpecEntry.status = parsedStatus;
        currentSpecEntry.statusLine = currentLine;
      } else if (currentSection === "Frequency map") {
        frequencyMap.tag = parsedStatus;
        frequencyMap.tagLine = currentLine;
      } else if (parsedStatus === "DECIDED") {
        standaloneDecidedRecords.push({
          line: currentLine,
          label: currentSection,
          key: `${currentSection || ""}::${normalizeWs(trimmed)}`
        });
      }
      continue;
    }
    if (currentSection === "Specs" && !currentSpecEntry && trimmed.startsWith("|")) {
      const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.length >= 2) {
        const isHeaderOrSep = cells[0].toLowerCase() === "name" || cells.every((c) => /^:?-+:?$/.test(c));
        if (!isHeaderOrSep) {
          const name = stripTicks(cells[0] || "");
          const binding = stripTicks(cells[1] || "");
          let intent = "";
          let statusRaw = "";
          if (cells.length >= 4) {
            intent = stripTicks(cells[2] || "");
            statusRaw = cells[3] || "";
          } else {
            statusRaw = cells[2] || "";
          }
          const status = statusRaw ? validateStatusTag(statusRaw, currentLine, `"${name}"`) : null;
          const rowBindings = [];
          if (binding && binding !== "\u2014" && binding !== "-") {
            extractBacktickSymbols(cells[1] || "", rowBindings, bindings);
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
            statusLine: status ? currentLine : null
          });
        }
      }
      continue;
    }
    for (const m of trimmed.matchAll(/\[([A-Z_]+)\]/g)) {
      const after = trimmed.slice(m.index + m[0].length);
      if (after.startsWith("(")) continue;
      const parsed = validateStatusTag(m[1], currentLine, currentSpecEntry ? `"${currentSpecEntry.name}"` : currentSection);
      if (parsed) {
        if (currentSpecEntry && !currentSpecEntry.status) {
          currentSpecEntry.status = parsed;
          currentSpecEntry.statusLine = currentLine;
        } else if (currentSection === "Frequency map" && !frequencyMap.tag) {
          frequencyMap.tag = parsed;
          frequencyMap.tagLine = currentLine;
        } else if (parsed === "DECIDED") {
          standaloneDecidedRecords.push({
            line: currentLine,
            label: currentSection,
            key: `${currentSection || ""}::${normalizeWs(trimmed)}`
          });
        }
      }
    }
    if (currentSection === "Design system") {
      designSystemLines.push(trimmed);
    } else if (currentSection === "Fallback") {
      fallbackLines.push(trimmed);
    } else if (currentSection === "Specs" && currentSpecEntry) {
      const intentMatch = trimmed.match(/^-\s*\*\*Intent\*\*\s*(?:—|--|-|:)\s*(.+)$/i);
      const bindingMatch = trimmed.match(/^-\s*\*\*Binding\*\*\s*(?:—|--|-|:)\s*(.+)$/i);
      if (intentMatch) {
        currentSpecEntry.intent = intentMatch[1].trim();
      } else if (bindingMatch) {
        currentSpecEntry.binding = bindingMatch[1].trim();
        extractBacktickSymbols(currentSpecEntry.binding, currentSpecEntry.bindings, bindings);
      } else if (currentSpecEntry.binding && !trimmed.startsWith("-")) {
        currentSpecEntry.binding += ` ${trimmed}`;
        extractBacktickSymbols(trimmed, currentSpecEntry.bindings, bindings);
      } else if (currentSpecEntry.intent && !currentSpecEntry.binding && !trimmed.startsWith("-")) {
        currentSpecEntry.intent += ` ${trimmed}`;
      }
    } else if (currentSection === "Exceptions" && trimmed.startsWith("-")) {
      const symMatch = trimmed.match(/^-\s*`([^`]+)`\s*(?:—|--|-|:)\s*(.+)$/);
      const symbol = symMatch ? symMatch[1].trim() : null;
      const reason = symMatch ? symMatch[2].trim() : trimmed.replace(/^-\s*/, "");
      const isConditional = CONDITIONAL_EXCEPTION_RE.test(reason);
      if (symbol) bindings.add(symbol);
      exceptions.push({
        line: currentLine,
        symbol,
        reason,
        isConditional,
        raw: trimmed
      });
    } else if (currentSection === "Frequency map" && trimmed.startsWith("-")) {
      frequencyMap.items.push({ line: currentLine, raw: trimmed });
    } else if (currentSection === "Not in this codebase" && trimmed.startsWith("-")) {
      notInCodebase.push({ line: currentLine, raw: trimmed });
    }
  }
  if (draft) {
    for (const s of specs) {
      if (s.status === "DECIDED") {
        const key = normalizeWs(s.name);
        const expectedSig = baseRatifiedSpecs.get(key);
        const unchanged = expectedSig !== void 0 && expectedSig === specContentSignature(s);
        if (!unchanged) {
          const lineNum = s.statusLine || s.line;
          lintFindings.push({
            rule: "AUX-MD-DRAFT-DECIDED",
            domain: "motion",
            class: "contract",
            severity: "major",
            file: filePath,
            lines: [lineNum, lineNum],
            summary: `Draft MOTION.md marks "${s.name}" as DECIDED${expectedSig !== void 0 ? " with modified intent/binding" : ""}; only a human can ratify a new or changed DECIDED entry.`,
            remediation: "Use OBSERVED for consistent existing patterns (>=80% share and >=5 call sites) or OPEN where conventions conflict or a ratified decision is being revised.",
            docPath: "references/motion-md.md"
          });
        }
      }
    }
    if (frequencyMap.tag === "DECIDED") {
      const curSig = frequencyMap.items.map((it) => normalizeWs(it.raw)).join("\n");
      if (baseFreqSignature === null || baseFreqSignature !== curSig) {
        const lineNum = frequencyMap.tagLine || 1;
        lintFindings.push({
          rule: "AUX-MD-DRAFT-DECIDED",
          domain: "motion",
          class: "contract",
          severity: "major",
          file: filePath,
          lines: [lineNum, lineNum],
          summary: "Draft MOTION.md marks Frequency map as DECIDED; only a human can ratify a new or modified DECIDED entry.",
          remediation: "Use OBSERVED or OPEN until ratified by a human.",
          docPath: "references/motion-md.md"
        });
      }
    }
    for (const rec of standaloneDecidedRecords) {
      if (!baseStandaloneDecided.has(rec.key)) {
        lintFindings.push({
          rule: "AUX-MD-DRAFT-DECIDED",
          domain: "motion",
          class: "contract",
          severity: "major",
          file: filePath,
          lines: [rec.line, rec.line],
          summary: `Draft MOTION.md marks ${rec.label || "an entry"} as DECIDED; only a human can ratify a new DECIDED entry.`,
          remediation: "Use OBSERVED or OPEN until ratified by a human.",
          docPath: "references/motion-md.md"
        });
      }
    }
  }
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
    designSystem: designSystemLines.join(" ").trim() || null,
    fallback: fallbackLines.join(" ").trim() || null,
    counts,
    specs: cleanSpecs,
    exceptions,
    frequencyMap: cleanFreqMap,
    notInCodebase,
    referencedSymbols: Array.from(bindings),
    definesNavigationTransitions,
    lintFindings
  };
  Object.defineProperty(out, "_standaloneDecided", {
    value: standaloneDecidedRecords.map((r) => r.key),
    enumerable: false
  });
  return out;
}
function extractBacktickSymbols(text, localArr, globalSet) {
  for (const m of String(text).matchAll(/`([^`]+)`/g)) {
    const sym = m[1].trim().replace(/\(\)$/, "");
    if (!sym || sym.includes(" ")) continue;
    if (!localArr.includes(sym)) localArr.push(sym);
    globalSet.add(sym);
  }
}
function stripTicks(s) {
  return String(s || "").trim().replace(/^`+|`+$/g, "").trim();
}
function findMotionMdForTarget(targetPath, stopAtDir = null) {
  let cur = path.resolve(targetPath);
  try {
    if (fs.existsSync(cur) && fs.statSync(cur).isFile()) {
      if (path.basename(cur).toUpperCase() === "MOTION.MD") {
        return cur;
      }
      cur = path.dirname(cur);
    }
  } catch {
    cur = path.dirname(cur);
  }
  const boundaryStop = stopAtDir ? path.resolve(stopAtDir) : null;
  while (true) {
    for (const name of ["MOTION.md", "Motion.md", "motion.md"]) {
      const candidate = path.join(cur, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
    if (boundaryStop && cur === boundaryStop) break;
    const isBoundary = fs.existsSync(path.join(cur, ".git")) || fs.existsSync(path.join(cur, "settings.gradle.kts")) || fs.existsSync(path.join(cur, "settings.gradle")) || fs.existsSync(path.join(cur, ".android-ux"));
    if (isBoundary) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

// cli/src/scanner/lottie-scanner.mjs
var REDUCED_MOTION_MARKERS = /* @__PURE__ */ new Set([
  "reduced motion",
  "reduced_motion",
  "reduced-motion",
  "reducedmotion"
]);
function isLottieJsonObject(parsed) {
  return Boolean(
    parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.v === "string" && typeof parsed.fr === "number" && typeof parsed.ip === "number" && typeof parsed.op === "number" && Array.isArray(parsed.layers)
  );
}
function analyzeLottieJson(content, filePath = "<lottie.json>") {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { isLottie: false, parseError: true };
  }
  if (!isLottieJsonObject(parsed)) {
    return { isLottie: false };
  }
  const lineCount = Math.max(1, String(content).replace(/\r\n/g, "\n").split("\n").length - (String(content).endsWith("\n") ? 1 : 0));
  const ip = typeof parsed.ip === "number" ? parsed.ip : 0;
  const op = parsed.op;
  const markers = Array.isArray(parsed.markers) ? parsed.markers : [];
  const reducedMotionMarker = markers.find((m) => {
    const cm = String(m?.cm || "").trim().toLowerCase();
    return REDUCED_MOTION_MARKERS.has(cm);
  }) || null;
  const layers = parsed.layers.filter((l) => l && typeof l === "object" && l.hd !== true);
  const hasAssetsPrecomps = Array.isArray(parsed.assets) && parsed.assets.some((a) => Array.isArray(a?.layers) && a.layers.length > 0);
  const hasComplexFeatures = hasAssetsPrecomps || layers.some(
    (l) => l.ty === 0 || // precomp layer
    Boolean(l.refId) || l.tt !== void 0 || // track matte
    l.td !== void 0 || l.tm !== void 0 || // time remap
    l.parent !== void 0 || // parented transform hierarchy
    Array.isArray(l.masksProperties) && l.masksProperties.length > 0 || typeof l.st === "number" && l.st !== 0 || typeof l.sr === "number" && l.sr !== 1
  );
  const endLayerStates = layers.map((layer) => evaluateLayerVisibilityAtFrame(layer, op));
  const startLayerStates = layers.map((layer) => evaluateLayerVisibilityAtFrame(layer, ip));
  const allBlankAtEnd = layers.length > 0 && endLayerStates.every((st) => st.status === "invisible");
  const anyUnknownAtEnd = endLayerStates.some((st) => st.status === "unknown");
  const allBlankAtStart = layers.length > 0 && startLayerStates.every((st) => st.status === "invisible");
  return {
    isLottie: true,
    filePath,
    lineCount,
    assetBaseName: extractAssetBaseName(filePath),
    ip,
    op,
    hasReducedMotionMarker: Boolean(reducedMotionMarker),
    reducedMotionMarkerName: reducedMotionMarker ? String(reducedMotionMarker.cm).trim() : null,
    hasComplexFeatures,
    layerCount: layers.length,
    endLayerStates,
    allBlankAtEnd,
    allBlankAtStart,
    anyUnknownAtEnd
  };
}
function extractAssetBaseName(filePath) {
  const norm = String(filePath).replace(/\\/g, "/");
  const base = norm.split("/").pop() || "";
  return base.replace(/\.json$/i, "");
}
function evaluateLayerVisibilityAtFrame(layer, frame) {
  const layerLabel = layer.nm || (layer.ind !== void 0 ? `layer#${layer.ind}` : "unnamed-layer");
  const lIp = typeof layer.ip === "number" ? layer.ip : -Infinity;
  const lOp = typeof layer.op === "number" ? layer.op : Infinity;
  if (frame < lIp || lOp < frame) {
    return { layer: layerLabel, status: "invisible", reason: `outside layer range [${lIp}, ${lOp})` };
  }
  const oProp = layer?.ks?.o;
  if (!oProp || typeof oProp !== "object") {
    return { layer: layerLabel, status: "visible", opacity: 100 };
  }
  if (typeof oProp.x === "string" && oProp.x.trim().length > 0) {
    return { layer: layerLabel, status: "unknown", reason: "opacity expression" };
  }
  if (oProp.a !== 1) {
    const val = Array.isArray(oProp.k) ? Number(oProp.k[0]) : Number(oProp.k);
    if (!Number.isFinite(val)) return { layer: layerLabel, status: "unknown", reason: "non-numeric opacity" };
    return val <= 0 ? { layer: layerLabel, status: "invisible", opacity: val, reason: "static opacity 0" } : { layer: layerLabel, status: "visible", opacity: val };
  }
  if (!Array.isArray(oProp.k) || oProp.k.length === 0) {
    return { layer: layerLabel, status: "unknown", reason: "empty keyframe array" };
  }
  const kfs = oProp.k.filter((kf) => kf && typeof kf === "object" && typeof kf.t === "number").sort((a, b) => a.t - b.t);
  if (kfs.length === 0) {
    return { layer: layerLabel, status: "unknown", reason: "unparseable keyframes" };
  }
  const opacity = sampleKeyframesAt(kfs, frame);
  if (opacity === null || !Number.isFinite(opacity)) {
    return { layer: layerLabel, status: "unknown", reason: "ambiguous keyframe value" };
  }
  return opacity <= 0 ? { layer: layerLabel, status: "invisible", opacity, reason: `keyframe opacity ${opacity} at frame ${frame}` } : { layer: layerLabel, status: "visible", opacity };
}
function extractScalar(v) {
  if (typeof v === "number") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") return v[0];
  return null;
}
function sampleKeyframesAt(kfs, frame) {
  if (frame <= kfs[0].t) {
    return extractScalar(kfs[0].s);
  }
  const last = kfs[kfs.length - 1];
  if (frame >= last.t) {
    const sVal = extractScalar(last.s);
    if (sVal !== null) return sVal;
    if (kfs.length >= 2) {
      return extractScalar(kfs[kfs.length - 2].e);
    }
    return null;
  }
  for (let i = 0; i < kfs.length - 1; i += 1) {
    const cur = kfs[i];
    const next = kfs[i + 1];
    if (frame >= cur.t && frame <= next.t) {
      const startVal = extractScalar(cur.s);
      if (cur.h === 1) return startVal;
      const endVal = extractScalar(next.s) ?? extractScalar(cur.e);
      if (startVal === null || endVal === null) return null;
      if (next.t === cur.t) return endVal;
      const ratio = (frame - cur.t) / (next.t - cur.t);
      return startVal + (endVal - startVal) * ratio;
    }
  }
  return null;
}

// cli/src/domains/motion/catalog.mjs
var MOTION_RULE_CATALOG = Object.freeze([
  // Floor (10)
  {
    id: "F-001",
    domain: "motion",
    class: "floor",
    defaultSeverity: "major",
    overridable: false,
    hookTier: "immediate",
    detectionMode: "mechanical",
    title: "Frame-rate values are read in layout or draw, never composition",
    description: "Read values that change every animation frame inside a lambda modifier (`offset { ... }`, `graphicsLayer { ... }`, `drawBehind { ... }`) rather than passing them to value modifiers in composition."
  },
  {
    id: "F-002",
    domain: "motion",
    class: "floor",
    defaultSeverity: "major",
    overridable: false,
    hookTier: null,
    detectionMode: "review-only",
    title: "A value the finger controls is an `Animatable`",
    description: "Drive gesture-controlled positions with `Animatable` and hand off release velocity into `animateDecay` or `animateTo(..., initialVelocity = velocity)`."
  },
  {
    id: "F-003",
    domain: "motion",
    class: "floor",
    defaultSeverity: "major",
    overridable: false,
    hookTier: "immediate",
    detectionMode: "mechanical",
    title: "`animateItem()` requires a key",
    description: "Every lazy list or grid `items(...)` / `itemsIndexed(...)` block using `Modifier.animateItem()` must supply a `Bundle`-compatible `key`."
  },
  {
    id: "F-004",
    domain: "motion",
    class: "floor",
    defaultSeverity: "major",
    overridable: false,
    hookTier: null,
    detectionMode: "candidate",
    title: "No shared elements across a View-backed container",
    description: "`sharedElement` and `sharedBounds` cannot animate across `AndroidView`, `Dialog`, `ModalBottomSheet`, or `Popup` window boundaries."
  },
  {
    id: "F-005",
    domain: "motion",
    class: "floor",
    defaultSeverity: "major",
    overridable: false,
    hookTier: "immediate",
    detectionMode: "hybrid",
    title: "Self-timed motion reads the duration scale itself",
    description: "`withFrameNanos` loops and manual frame-clock animations must read `MotionDurationScale` (or `ANIMATOR_DURATION_SCALE`) and stop requesting frames when the scale is `0f`."
  },
  {
    id: "F-006",
    domain: "motion",
    class: "floor",
    defaultSeverity: "major",
    overridable: false,
    hookTier: "immediate",
    detectionMode: "mechanical",
    title: "`animateContentSize` clips its child",
    description: "`Modifier.animateContentSize()` applies `clipToBounds` unconditionally and cuts off shadows on `Modifier.shadow` or elevated `Card`/`Surface` containers."
  },
  {
    id: "F-007",
    domain: "motion",
    class: "floor",
    defaultSeverity: "major",
    overridable: false,
    hookTier: null,
    detectionMode: "review-only",
    title: "Motion state that survives rotation must be saveable",
    description: "User-placed touch positions must be stored with `rememberSaveable` rather than plain `remember` so rotation does not snap them back."
  },
  {
    id: "F-008",
    domain: "motion",
    class: "floor",
    defaultSeverity: "major",
    overridable: false,
    hookTier: null,
    detectionMode: "candidate",
    title: "Layout properties have no cheap animated form",
    description: "Animating `padding`, `size`, `width`, or `height` re-measures and re-lays out every frame; prefer lambda `offset { ... }` or `graphicsLayer { ... }` when sibling reflow is not required."
  },
  {
    id: "F-009",
    domain: "motion",
    class: "floor",
    defaultSeverity: "major",
    overridable: false,
    hookTier: null,
    detectionMode: "review-only",
    title: "Feel is not assessed in a debug build",
    description: "Assess frame timing and spring feel only on release/benchmark builds with R8 and baseline profiles enabled."
  },
  {
    id: "F-010",
    domain: "motion",
    class: "floor",
    defaultSeverity: "major",
    overridable: false,
    hookTier: null,
    detectionMode: "review-only",
    title: "`sharedElement` demands identical content; otherwise `sharedBounds`",
    description: "Use `sharedElement` only when both endpoints render identical content; use `sharedBounds` when text style, content, or shape changes."
  },
  // Obligation (3)
  {
    id: "O-001",
    domain: "motion",
    class: "obligation",
    defaultSeverity: "major",
    overridable: false,
    hookTier: null,
    detectionMode: "review-only",
    title: "Meaning must have a static carrier",
    description: "Every status or affordance communicated through animation must also be readable from static text, iconography, or semantics when animations are off."
  },
  {
    id: "O-002",
    domain: "motion",
    class: "obligation",
    defaultSeverity: "major",
    overridable: false,
    hookTier: "immediate",
    detectionMode: "hybrid",
    title: "Every Lottie has a readable disabled frame",
    description: "When system animations are disabled, Lottie jumps to the end frame unless a `reduced motion` marker or readable `LottieClipSpec` endpoint is provided."
  },
  {
    id: "O-003",
    domain: "motion",
    class: "obligation",
    defaultSeverity: "major",
    overridable: false,
    hookTier: null,
    detectionMode: "candidate",
    title: "Endless motion can be stopped",
    description: "Any decorative or informational animation that runs indefinitely (>5s) without ending must give the user a direct way to pause or stop it."
  },
  // Taste (22)
  {
    id: "T-001",
    domain: "motion",
    class: "taste",
    defaultSeverity: "minor",
    overridable: true,
    hookTier: "deferred",
    detectionMode: "mechanical",
    title: "The `NavHost` default transition is a finding",
    description: "Specify explicit navigation transitions (`enterTransition`/`exitTransition` on `NavHost`, or `transitionSpec` on Navigation 3 `NavDisplay`) instead of inheriting `NavHost`'s 700ms default crossfade."
  },
  {
    id: "T-002",
    domain: "motion",
    class: "taste",
    defaultSeverity: "minor",
    overridable: true,
    hookTier: "deferred",
    detectionMode: "mechanical",
    title: "No bare `tween()` or `spring()` at a call site",
    description: "Resolve animation specs through `MaterialTheme.motionScheme` or named project motion tokens rather than hardcoding `tween()`, `spring()`, or `keyframes()` inline at UI call sites."
  },
  {
    id: "T-004",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "Expressive spatial springs stay off elements read as data",
    description: "Do not use bouncy Expressive spatial springs on charts, numeric readouts, or data-bearing bars where overshoot distorts values."
  },
  {
    id: "T-008",
    domain: "motion",
    class: "taste",
    defaultSeverity: "minor",
    overridable: true,
    hookTier: null,
    detectionMode: "candidate",
    title: "Custom back is seekable or it is broken",
    description: "Custom back interception on transitions should drive seekable progress (`PredictiveBackHandler` / `NavigationBackHandler`) rather than snapping on release with `BackHandler`."
  },
  {
    id: "T-009",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "Frequency sets the ceiling",
    description: "High-frequency productivity actions require restrained or zero decorative motion."
  },
  {
    id: "T-010",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "Exits use fewer properties, not shorter durations",
    description: "Simpler exit transitions drop secondary transforms (such as scale overshoot) rather than rushing the same transform."
  },
  {
    id: "T-011",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "The pattern states the relationship",
    description: "Match the transition pattern (fade-through for peers, shared-axis for ordered steps, container transform for item-to-detail) to the spatial/navigational relationship."
  },
  {
    id: "T-012",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "candidate",
    title: "Never gate input on an animation finishing",
    description: "Keep controls interactive and interruptible in flight instead of disabling clicks while an animation runs."
  },
  {
    id: "T-013",
    domain: "motion",
    class: "taste",
    defaultSeverity: "minor",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "Stagger has a total budget, not a per-item delay",
    description: "Cap total list stagger duration so long lists do not delay trailing items unboundedly."
  },
  {
    id: "T-016",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "Unanchored surfaces expand; they do not scale from centre",
    description: "Full-width banners, cards, and unanchored surfaces expand bounds rather than scaling from `(0.5f, 0.5f)`."
  },
  {
    id: "T-017",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "A screen introduces itself once",
    description: "Do not replay first-visit entrance choreography on back navigation or configuration recreation."
  },
  {
    id: "T-018",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "candidate",
    title: "Platform overscroll stays unless deliberately replaced",
    description: "Keep platform stretch overscroll enabled app-wide; disable it only locally where a custom gesture or looping pager replaces it."
  },
  {
    id: "T-019",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "Skeletons match structure; indicators have a floor",
    description: "Delay short loading indicators and enforce a minimum display time so fast responses do not flash a spinner."
  },
  {
    id: "T-020",
    domain: "motion",
    class: "taste",
    defaultSeverity: "minor",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "One event, one scheme and one tier",
    description: "Elements participating in the same visual event share one speed tier so container and content settle together."
  },
  {
    id: "T-021",
    domain: "motion",
    class: "taste",
    defaultSeverity: "minor",
    overridable: true,
    hookTier: "deferred",
    detectionMode: "mechanical",
    title: "Keys identify content, not position",
    description: "Key animated lazy list items by stable domain identity (`item.id`), never by list index (`key = { index, _ -> index }`)."
  },
  {
    id: "T-022",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "Content tracks the keyboard, it does not jump",
    description: "Track `WindowInsets.ime` continuously rather than switching layout on a boolean keyboard visibility state."
  },
  {
    id: "T-023",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "Motion starts on the input frame",
    description: "Begin visual feedback on the tap/gesture frame rather than waiting for an async network or repository response."
  },
  {
    id: "T-024",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "Back plays the inverse of forward",
    description: "Pop/back transitions invert the forward spatial axis rather than switching to an unrelated transition."
  },
  {
    id: "T-025",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "A hand-rolled surface drags like the one it replaces",
    description: "Custom sheets, drawers, and panels that look like draggable surfaces must support direct touch drag and velocity settle."
  },
  {
    id: "T-026",
    domain: "motion",
    class: "taste",
    defaultSeverity: "minor",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "One hero motion per event",
    description: "Avoid competing simultaneous spatial animations across sibling elements in a single state change."
  },
  {
    id: "T-027",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "A correction is not a celebration",
    description: "Play celebratory pop/scale motion only when activating/saving a state, not when undoing or clearing it."
  },
  {
    id: "T-028",
    domain: "motion",
    class: "taste",
    defaultSeverity: "major",
    overridable: true,
    hookTier: null,
    detectionMode: "review-only",
    title: "Background work finishes quietly",
    description: "Do not interrupt the user with snackbars or animated banners when routine background sync completes without user initiation."
  }
]);
var MOTION_RULE_BY_ID = new Map(MOTION_RULE_CATALOG.map((r) => [r.id, r]));

// cli/src/domains/motion/rules.mjs
import path2 from "node:path";
var FRAME_STATE_FACTORIES = /* @__PURE__ */ new Set([
  "animateDpAsState",
  "animateFloatAsState",
  "animateIntOffsetAsState",
  "animateOffsetAsState",
  "animateSizeAsState",
  "animateIntAsState",
  "animateRectAsState",
  "animateValueAsState"
]);
var TRANSITION_FRAME_METHODS = /* @__PURE__ */ new Set([
  "animateDp",
  "animateFloat",
  "animateIntOffset",
  "animateOffset",
  "animateSize",
  "animateInt",
  "animateRect",
  "animateValue"
]);
var DRAW_OR_LAYOUT_SCOPES = /* @__PURE__ */ new Set([
  "drawBehind",
  "drawWithContent",
  "drawWithCache",
  "onDrawBehind",
  "onDrawWithContent",
  "Canvas",
  "layout"
]);
var VALUE_MODIFIER_NAMES = /* @__PURE__ */ new Set([
  "offset",
  "absoluteOffset",
  "alpha",
  "scale",
  "rotate",
  "graphicsLayer"
]);
var LAYOUT_SIZE_MODIFIER_NAMES = /* @__PURE__ */ new Set([
  "padding",
  "paddingFromBaseline",
  "size",
  "sizeIn",
  "width",
  "widthIn",
  "height",
  "heightIn",
  "requiredSize",
  "requiredWidth",
  "requiredHeight"
]);
var SPEC_LITERAL_NAMES = /* @__PURE__ */ new Set(["tween", "spring", "keyframes"]);
var ANIMATION_CONSUMER_CALLS = /* @__PURE__ */ new Set([
  "animateDpAsState",
  "animateFloatAsState",
  "animateColorAsState",
  "animateIntOffsetAsState",
  "animateOffsetAsState",
  "animateSizeAsState",
  "animateIntAsState",
  "animateRectAsState",
  "animateValueAsState",
  "animateDp",
  "animateFloat",
  "animateColor",
  "animateIntOffset",
  "animateOffset",
  "animateTo",
  "animateDecay",
  "fadeIn",
  "fadeOut",
  "slideIn",
  "slideOut",
  "slideInHorizontally",
  "slideOutHorizontally",
  "slideInVertically",
  "slideOutVertically",
  "slideIntoContainer",
  "slideOutOfContainer",
  "scaleIn",
  "scaleOut",
  "expandIn",
  "shrinkOut",
  "expandHorizontally",
  "shrinkHorizontally",
  "expandVertically",
  "shrinkVertically",
  "togetherWith",
  "AnimatedVisibility",
  "AnimatedContent",
  "Crossfade",
  "NavHost",
  "NavDisplay",
  "composable",
  "animateContentSize",
  "animateItem",
  "repeatable",
  "infiniteRepeatable"
]);
var VIEW_BACKED_CONTAINERS = /* @__PURE__ */ new Set([
  "Dialog",
  "AlertDialog",
  "BasicAlertDialog",
  "ModalBottomSheet",
  "Popup",
  "AndroidView"
]);
var DURATION_SCALE_IDENTIFIERS = /* @__PURE__ */ new Set([
  "MotionDurationScale",
  "ANIMATOR_DURATION_SCALE",
  "areAnimatorsEnabled",
  "getDurationScale"
]);
var ELEVATED_CONTAINERS = /* @__PURE__ */ new Set(["Card", "ElevatedCard", "OutlinedCard", "Surface"]);
function runMotionDomainChecks({
  kotlinFiles = [],
  lottieFiles = [],
  motionContracts = [],
  inlineIgnoresEnabled = true,
  collectStats = false
}) {
  const rawFindings = [];
  const rawCandidates = [];
  const inlineSuppressed = [];
  const conventionContext = computeProjectConventions(kotlinFiles, motionContracts);
  const contractDiagnostics = [];
  for (const contract of motionContracts) {
    for (const lf of contract.lintFindings || []) {
      contractDiagnostics.push({
        code: lf.rule,
        domain: "motion",
        class: lf.class || "contract",
        severity: lf.severity || "major",
        file: contract.filePath,
        lines: lf.lines,
        title: lf.summary,
        summary: lf.summary,
        evidence: `Line ${lf.lines[0]}`,
        remediation: lf.remediation,
        docPath: lf.docPath || "references/motion-md.md"
      });
    }
  }
  const scaleHelpers = /* @__PURE__ */ new Set();
  for (const kf of kotlinFiles) {
    if (!kf.lexError) {
      for (const h of findScaleReadingHelpers(kf)) scaleHelpers.add(h);
    }
  }
  const lottieConsumers = [];
  for (const kf of kotlinFiles) {
    if (kf.lexError) {
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
  checkO002(lottieFiles, lottieConsumers, rawFindings, rawCandidates);
  const afterExceptionsFindings = [];
  const contractSuppressed = [];
  for (const f of rawFindings) {
    const meta = MOTION_RULE_BY_ID.get(f.rule);
    if (meta && meta.class === "taste" && meta.overridable) {
      const fileMotionMd = selectNearestMotionContract(f.file, motionContracts);
      const matchingDecided = findMatchingDecidedOverride(fileMotionMd, f.rule, f.symbolContext);
      if (matchingDecided) {
        rawCandidates.push({
          ...f,
          kind: "candidate",
          reasonCode: "motion-md-override-unverifiable",
          verificationHint: `MOTION.md (${path2.basename(fileMotionMd.filePath)}:${matchingDecided.line}) has a DECIDED entry ("${matchingDecided.name}") referencing ${f.rule} or a bound symbol; confirm whether this call site implements or contradicts that DECIDED contract.`
        });
        continue;
      }
      if (f.symbolContext) {
        const matchingExc = findMatchingException(fileMotionMd, f.symbolContext, f.rule);
        if (matchingExc) {
          if (matchingExc.isConditional) {
            rawCandidates.push({
              ...f,
              kind: "candidate",
              reasonCode: "conditional-motion-md-exception",
              exception: {
                symbol: matchingExc.symbol,
                reason: matchingExc.reason,
                line: matchingExc.line,
                file: fileMotionMd.filePath
              },
              verificationHint: `MOTION.md (${path2.basename(fileMotionMd.filePath)}:${matchingExc.line}) records a conditional exception on \`${matchingExc.symbol || f.rule}\` ("${matchingExc.reason}"). Check surrounding code to determine whether the stated condition still holds.`
            });
            continue;
          }
          contractSuppressed.push({
            ...f,
            suppressedBy: "MOTION.md",
            suppressionReason: matchingExc.reason,
            suppressionFile: fileMotionMd.filePath,
            suppressionLine: matchingExc.line
          });
          continue;
        }
      }
    }
    afterExceptionsFindings.push(f);
  }
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
            suppressedBy: "inline-comment",
            suppressionReason: hit.reason,
            suppressionLine: hit.commentLine
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
            suppressedBy: "inline-comment",
            suppressionReason: hit.reason,
            suppressionLine: hit.commentLine
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
    stats
  };
}
function stripInternalFields(item) {
  const clone = { ...item };
  delete clone.symbolContext;
  return clone;
}
function selectNearestMotionContract(filePath, motionContracts) {
  if (!motionContracts || motionContracts.length === 0) return null;
  const absFile = path2.resolve(filePath);
  let best = null;
  let bestLen = -1;
  for (const mc of motionContracts) {
    const dir = path2.dirname(path2.resolve(mc.filePath));
    if (absFile === dir || absFile.startsWith(dir + path2.sep)) {
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
      const shortSym = exc.symbol.split(".").pop();
      if (!syms.includes(exc.symbol) && !syms.includes(shortSym)) {
        continue;
      }
      const mentionedRules = [...String(exc.raw || "").toUpperCase().matchAll(/\b([FTOM]-\d{3})\b/g)].map((m) => m[1]);
      if (mentionedRules.length > 0 && ruleId && !mentionedRules.includes(ruleId)) {
        continue;
      }
      return exc;
    }
    if (ruleId && exc.raw && new RegExp(`\\b${ruleId}\\b`, "i").test(exc.raw)) {
      return exc;
    }
  }
  return null;
}
function findMatchingDecidedOverride(motionMd, ruleId, symbolNames) {
  if (!motionMd || !Array.isArray(motionMd.specs)) return null;
  const syms = Array.isArray(symbolNames) ? symbolNames : [];
  for (const spec of motionMd.specs) {
    if (spec.status !== "DECIDED") continue;
    if (Array.isArray(spec.bindings) && spec.bindings.length > 0) {
      if (syms.length === 0) continue;
      const bindsSym = spec.bindings.some((b) => {
        const shortB = b.split(".").pop();
        return syms.includes(b) || syms.includes(shortB);
      });
      if (bindsSym) return spec;
      continue;
    }
    const text = `${spec.name || ""} ${spec.intent || ""} ${spec.binding || ""}`;
    if (ruleId && new RegExp(`\\b${ruleId}\\b`, "i").test(text)) {
      return spec;
    }
  }
  return null;
}
var MOTION_TOKEN_HOLDER_NAME_RE = /(?:Motion(?:Tokens|Specs|Scheme|Defaults)|[A-Z][A-Za-z0-9]*Motion)$/;
function computeProjectConventions(kotlinFiles, motionContracts) {
  let usesMotionScheme = false;
  let usesTokenObject = false;
  let usesIdentityListKeys = false;
  for (const kf of kotlinFiles) {
    if (kf.lexError) continue;
    for (const t of kf.tokens) {
      if (t.type === "Identifier" && t.value === "motionScheme") {
        usesMotionScheme = true;
      }
    }
    for (const d of kf.declarations) {
      if ((d.kind === "object" || d.kind === "class") && MOTION_TOKEN_HOLDER_NAME_RE.test(d.name)) {
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
      if ((c.name === "items" || c.name === "itemsIndexed") && c.trailingLambda) {
        const keyArg = getCallArg(c, "key", 1);
        if (keyArg && /\.\s*(id|key|uuid|code|isbn|slug)\b/i.test(keyArg.text)) {
          usesIdentityListKeys = true;
        }
      }
    }
  }
  const hasMotionMdSpecs = motionContracts.some(
    (m) => m.specs && m.specs.length > 0 || m.definesNavigationTransitions
  );
  return {
    usesMotionScheme,
    usesTokenObject,
    hasMotionTokens: usesMotionScheme || usesTokenObject || hasMotionMdSpecs,
    usesIdentityListKeys,
    hasMotionMdSpecs
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
  symbolContext = null
}) {
  const meta = MOTION_RULE_BY_ID.get(ruleId);
  const out = {
    rule: ruleId,
    domain: "motion",
    class: meta.class,
    severity: severity || meta.defaultSeverity,
    tier: meta.hookTier || "deferred",
    file,
    lines,
    title: meta.title,
    summary: meta.description,
    evidence,
    remediation,
    docPath: "references/standards.md"
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
  verificationHint
}) {
  const meta = MOTION_RULE_BY_ID.get(ruleId);
  return {
    kind: "candidate",
    rule: ruleId,
    domain: "motion",
    class: meta.class,
    severity: severity || meta.defaultSeverity,
    file,
    lines,
    title: meta.title,
    summary: meta.description,
    evidence,
    verificationHint,
    docPath: "references/standards.md"
  };
}
function isInsidePhaseLambda(call, tokens) {
  const callStart = tokens[call.nameTokIdx]?.start ?? -1;
  const callEnd = tokens[call.endTokIdx]?.end ?? -1;
  for (const enc of call.enclosingCalls) {
    const isPhaseCall = DRAW_OR_LAYOUT_SCOPES.has(enc.name) || enc.name === "offset" || enc.name === "absoluteOffset" || enc.name === "graphicsLayer";
    if (!isPhaseCall) continue;
    if (enc.trailingLambda && call.nameTokIdx > enc.trailingLambda.openBraceIdx && call.endTokIdx < enc.trailingLambda.closeBraceIdx) {
      return true;
    }
    if (Array.isArray(enc.args)) {
      for (const arg of enc.args) {
        if (arg.tokens.length >= 2 && arg.tokens[0].value === "{" && arg.tokens[arg.tokens.length - 1].value === "}") {
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
    if (t.type === "Punct") {
      if (t.value === "}") depth += 1;
      else if (t.value === "{") {
        if (depth === 0) {
          openIdx = i;
          break;
        }
        depth -= 1;
      }
    }
  }
  const closeIdx = tokens[openIdx]?.value === "{" ? findMatchingForward(tokens, openIdx, "{", "}") : fnEndIdx;
  return [openIdx, closeIdx !== -1 ? closeIdx : fnEndIdx];
}
function resolveScopedBinding(varName, atTokIdx, scopedBindings) {
  let best = null;
  for (const b of scopedBindings) {
    if (b.name !== varName) continue;
    if (atTokIdx <= b.declEndIdx || atTokIdx > b.scopeEndIdx || atTokIdx < b.scopeStartIdx) continue;
    if (!best || b.scopeStartIdx > best.scopeStartIdx || b.scopeStartIdx === best.scopeStartIdx && b.declEndIdx >= best.declEndIdx) {
      best = b;
    }
  }
  return best;
}
function resolveScopedLocalKind(varName, atTokIdx, scopedBindings) {
  const best = resolveScopedBinding(varName, atTokIdx, scopedBindings);
  return best ? best.kind : null;
}
function findMatchingBackward2(tokens, closeIdx, openSym, closeSym) {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i -= 1) {
    const t = tokens[i];
    if (t.type === "Punct") {
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
    while (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "@") {
      cursor += 1;
      while (cursor < closeParenIdx && (tokens[cursor]?.type === "Identifier" || tokens[cursor]?.value === ".")) {
        cursor += 1;
      }
      if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "(") {
        const closeAnn = findMatchingForward(tokens, cursor, "(", ")");
        if (closeAnn === -1 || closeAnn >= closeParenIdx) return null;
        cursor = closeAnn + 1;
      }
    }
    if (tokens[cursor]?.type !== "Identifier") return null;
    if (tokens[cursor].value !== "_") {
      names.push(tokens[cursor].value);
    }
    cursor += 1;
    if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === ":") {
      cursor = skipKotlinTypeInLambdaParam(tokens, cursor + 1, closeParenIdx);
      if (cursor === -1) return null;
    }
    if (cursor === closeParenIdx) break;
    if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === ",") {
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
    if (tokens[cursor]?.value === "suspend") {
      cursor += 1;
    }
    let wasParenGroup = false;
    if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "(") {
      const closeP = findMatchingForward(tokens, cursor, "(", ")");
      if (closeP === -1 || closeP >= limitIdx) return -1;
      cursor = closeP + 1;
      wasParenGroup = true;
    } else if (tokens[cursor]?.type === "Identifier") {
      cursor += 1;
      while (cursor < limitIdx) {
        if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "." && tokens[cursor + 1]?.type === "Identifier") {
          cursor += 2;
        } else if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "<") {
          const closeAngle = findMatchingForward(tokens, cursor, "<", ">");
          if (closeAngle === -1 || closeAngle >= limitIdx) return -1;
          cursor = closeAngle + 1;
        } else {
          break;
        }
      }
      if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "." && tokens[cursor + 1]?.value === "(") {
        const closeRecvP = findMatchingForward(tokens, cursor + 1, "(", ")");
        if (closeRecvP === -1 || closeRecvP >= limitIdx) return -1;
        cursor = closeRecvP + 1;
        wasParenGroup = true;
      }
    } else {
      return -1;
    }
    if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "?") {
      cursor += 1;
    }
    if (wasParenGroup && tokens[cursor]?.type === "Punct" && tokens[cursor].value === "->") {
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
  if (prev.type === "Keyword" && (prev.value === "when" || prev.value === "try" || prev.value === "else" || prev.value === "finally" || prev.value === "do")) {
    return true;
  }
  if (prev.type === "Punct" && prev.value === ")") {
    const openParen = findMatchingBackward2(tokens, openBraceIdx - 1, "(", ")");
    if (openParen !== -1) {
      const beforeParen = tokens[openParen - 1];
      if (beforeParen?.type === "Keyword" && (beforeParen.value === "when" || beforeParen.value === "if" || beforeParen.value === "for" || beforeParen.value === "while" || beforeParen.value === "catch")) {
        return true;
      }
    }
  }
  return false;
}
function parseLambdaHeaderParams(tokens, openBraceIdx, closeBraceIdx) {
  let cursor = openBraceIdx + 1;
  if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "->") {
    return { arrowIdx: cursor, names: [] };
  }
  const names = [];
  while (cursor < closeBraceIdx) {
    while (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "@") {
      cursor += 1;
      while (cursor < closeBraceIdx && (tokens[cursor]?.type === "Identifier" || tokens[cursor]?.value === ".")) {
        cursor += 1;
      }
      if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "(") {
        const closeAnn = findMatchingForward(tokens, cursor, "(", ")");
        if (closeAnn === -1 || closeAnn >= closeBraceIdx) return null;
        cursor = closeAnn + 1;
      }
    }
    if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "(") {
      const closeDestruct = findMatchingForward(tokens, cursor, "(", ")");
      if (closeDestruct === -1 || closeDestruct >= closeBraceIdx) return null;
      const inner = parseDestructuringParamNames(tokens, cursor + 1, closeDestruct);
      if (!inner) return null;
      names.push(...inner);
      cursor = closeDestruct + 1;
    } else if (tokens[cursor]?.type === "Identifier") {
      if (tokens[cursor].value !== "_") {
        names.push(tokens[cursor].value);
      }
      cursor += 1;
    } else {
      return null;
    }
    if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === ":") {
      cursor = skipKotlinTypeInLambdaParam(tokens, cursor + 1, closeBraceIdx);
      if (cursor === -1) return null;
    }
    if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === ",") {
      cursor += 1;
      if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "->") {
        return { arrowIdx: cursor, names };
      }
      continue;
    }
    if (tokens[cursor]?.type === "Punct" && tokens[cursor].value === "->") {
      return { arrowIdx: cursor, names };
    }
    return null;
  }
  return null;
}
function collectShadowingScopeBindings(tokens, declarations, fn, scopedBindings) {
  const declBodyBraces = /* @__PURE__ */ new Set();
  for (const d of declarations) {
    if (d.startTokIdx >= fn.startTokIdx && d.endTokIdx <= fn.endTokIdx) {
      if (tokens[d.endTokIdx]?.value === "}") {
        const openB = findMatchingBackward2(tokens, d.endTokIdx, "{", "}");
        if (openB !== -1) declBodyBraces.add(openB);
      }
      if (d.kind === "fun" && d !== fn && d.paramRange) {
        const paramSlice = tokens.slice(d.paramRange[0] + 1, d.paramRange[1]);
        let pDepth = 0;
        for (let i = 0; i < paramSlice.length; i += 1) {
          const pt = paramSlice[i];
          if (pt.type === "Punct" && (pt.value === "(" || pt.value === "<")) pDepth += 1;
          else if (pt.type === "Punct" && (pt.value === ")" || pt.value === ">")) pDepth = Math.max(0, pDepth - 1);
          else if (pDepth === 0 && pt.type === "Identifier" && paramSlice[i + 1]?.value === ":") {
            scopedBindings.push({
              name: pt.value,
              kind: "other",
              declStartIdx: d.paramRange[0],
              declEndIdx: d.paramRange[1],
              rhsStartIdx: -1,
              scopeStartIdx: d.startTokIdx,
              scopeEndIdx: d.endTokIdx
            });
          }
        }
      }
    }
  }
  for (let i = fn.startTokIdx + 1; i <= fn.endTokIdx; i += 1) {
    const t = tokens[i];
    if (t.type === "Punct" && t.value === "{" && !isNonLambdaBraceBlock(tokens, i, declBodyBraces)) {
      const closeBrace = findMatchingForward(tokens, i, "{", "}");
      if (closeBrace !== -1 && closeBrace <= fn.endTokIdx) {
        const header = parseLambdaHeaderParams(tokens, i, closeBrace);
        if (header && header.names.length > 0) {
          for (const name of header.names) {
            scopedBindings.push({
              name,
              kind: "other",
              declStartIdx: header.arrowIdx,
              declEndIdx: header.arrowIdx,
              rhsStartIdx: -1,
              scopeStartIdx: i,
              scopeEndIdx: closeBrace
            });
          }
        }
      }
      continue;
    }
    if (t.type === "Keyword" && (t.value === "val" || t.value === "var") && tokens[i + 1]?.value === "(") {
      const closeDestruct = findMatchingForward(tokens, i + 1, "(", ")");
      if (closeDestruct !== -1 && closeDestruct <= fn.endTokIdx) {
        const names = parseDestructuringParamNames(tokens, i + 2, closeDestruct);
        if (names && names.length > 0) {
          const [scopeStartIdx, scopeEndIdx] = findEnclosingBraceScope(tokens, i, fn.startTokIdx, fn.endTokIdx);
          const matchingDecl = declarations.find((d) => d.startTokIdx === i);
          const declEndIdx = matchingDecl ? matchingDecl.endTokIdx : closeDestruct;
          for (const name of names) {
            scopedBindings.push({
              name,
              kind: "other",
              declStartIdx: i,
              declEndIdx,
              rhsStartIdx: -1,
              scopeStartIdx,
              scopeEndIdx
            });
          }
        }
      }
      continue;
    }
    if (t.type === "Keyword" && t.value === "for" && tokens[i + 1]?.value === "(") {
      const closeForParen = findMatchingForward(tokens, i + 1, "(", ")");
      if (closeForParen !== -1 && closeForParen <= fn.endTokIdx) {
        let inIdx = -1;
        let pDepth = 0;
        for (let k = i + 2; k < closeForParen; k += 1) {
          if (tokens[k].type === "Punct" && (tokens[k].value === "(" || tokens[k].value === "<")) pDepth += 1;
          else if (tokens[k].type === "Punct" && (tokens[k].value === ")" || tokens[k].value === ">")) pDepth = Math.max(0, pDepth - 1);
          else if (pDepth === 0 && tokens[k].type === "Keyword" && tokens[k].value === "in") {
            inIdx = k;
            break;
          }
        }
        if (inIdx !== -1) {
          let loopNames = null;
          if (tokens[i + 2]?.value === "(") {
            const closeInner = findMatchingForward(tokens, i + 2, "(", ")");
            if (closeInner !== -1 && closeInner < inIdx) {
              loopNames = parseDestructuringParamNames(tokens, i + 3, closeInner);
            }
          } else {
            loopNames = parseDestructuringParamNames(tokens, i + 2, inIdx);
          }
          if (loopNames && loopNames.length > 0) {
            const bodyStart = closeForParen + 1;
            const bodyEnd = tokens[bodyStart]?.value === "{" ? findMatchingForward(tokens, bodyStart, "{", "}") : Math.min(fn.endTokIdx, bodyStart + 25);
            if (bodyEnd !== -1) {
              for (const name of loopNames) {
                scopedBindings.push({
                  name,
                  kind: "other",
                  declStartIdx: i + 1,
                  declEndIdx: closeForParen,
                  rhsStartIdx: -1,
                  scopeStartIdx: bodyStart,
                  scopeEndIdx: bodyEnd
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
  const composableFuns = declarations.filter((d) => d.kind === "fun" && d.isComposable);
  for (const fn of composableFuns) {
    const scopedBindings = [];
    let hasAnyAnimated = false;
    const localDecls = declarations.filter(
      (d) => (d.kind === "val" || d.kind === "var") && d.startTokIdx > fn.startTokIdx && d.endTokIdx <= fn.endTokIdx
    );
    for (const ld of localDecls) {
      const [scopeStartIdx, scopeEndIdx] = findEnclosingBraceScope(tokens, ld.startTokIdx, fn.startTokIdx, fn.endTokIdx);
      const isReassignedVar = isLocalVarReassignedInFn(tokens, ld, fn);
      let kind = "other";
      if (!isReassignedVar && ld.delegateIdx !== -1) {
        const delToks = tokens.slice(ld.delegateIdx, ld.endTokIdx + 1);
        const topCall = findDirectTopLevelCall(tokens, calls, delToks);
        if (topCall) {
          const isUnqualifiedFactory = isTopLevelOrAndroidxQualifiedCall(tokens, topCall) && topCall.hasParens;
          const isTransitionExt = Boolean(topCall.receiver) && !hasSafeCallInReceiverChain(tokens, topCall);
          if (isUnqualifiedFactory && FRAME_STATE_FACTORIES.has(topCall.name) || isTransitionExt && TRANSITION_FRAME_METHODS.has(topCall.name)) {
            kind = "frame";
            hasAnyAnimated = true;
          } else if (isUnqualifiedFactory && topCall.name === "animateColorAsState" || isTransitionExt && topCall.name === "animateColor") {
            kind = "color";
            hasAnyAnimated = true;
          }
        }
      } else if (!isReassignedVar && ld.rhsStartIdx !== -1) {
        const rhsToks = tokens.slice(ld.rhsStartIdx, ld.endTokIdx + 1);
        if (extractDirectAnimatableInitCall(tokens, calls, rhsToks)) {
          kind = "animatable";
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
        scopeEndIdx
      });
    }
    if (!hasAnyAnimated) continue;
    collectShadowingScopeBindings(tokens, declarations, fn, scopedBindings);
    for (const b of scopedBindings) {
      if (b.kind === "other" && !b.isReassignedVar && b.rhsStartIdx !== -1) {
        const rhsToks = tokens.slice(b.rhsStartIdx, b.declEndIdx + 1);
        const lerpCall = findDirectTopLevelCall(tokens, calls, rhsToks);
        if (lerpCall && isTopLevelOrAndroidxQualifiedCall(tokens, lerpCall) && lerpCall.name === "lerp" && lerpCall.hasParens && !lerpCall.trailingLambda) {
          const usesFrameVar = lerpCall.args.some(
            (a) => Boolean(findScopedSimpleVarRef(a.tokens, lerpCall.nameTokIdx, scopedBindings, "frame")) || Boolean(findScopedAnimatableRead(a.tokens, lerpCall.nameTokIdx, scopedBindings))
          );
          if (usesFrameVar) {
            b.kind = "derivedColor";
            hasAnyAnimated = true;
          }
        }
      }
    }
    const fnCalls = calls.filter((c) => c.nameTokIdx > fn.startTokIdx && c.endTokIdx <= fn.endTokIdx);
    for (const c of fnCalls) {
      if (!c.hasParens || c.args.length === 0) continue;
      if (!c.receiver) continue;
      if (isInsidePhaseLambda(c, tokens)) continue;
      const guaranteedInComposition = isGuaranteedCompositionExecution(tokens, declarations, calls, fn, c);
      if (VALUE_MODIFIER_NAMES.has(c.name)) {
        const hitVar = findScopedReferencedAnimatedVar(c.args, c.nameTokIdx, scopedBindings);
        if (hitVar) {
          const fixHint = c.name === "offset" || c.name === "absoluteOffset" ? `Use the layout-phase lambda overload \`Modifier.${c.name} { IntOffset(...) }\` so \`${hitVar}\` is read during placement instead of composition.` : `Use \`Modifier.graphicsLayer { ... }\` so \`${hitVar}\` is read in the draw phase instead of recomposing every frame.`;
          if (guaranteedInComposition) {
            rawFindings.push(
              makeRuleFinding("F-001", {
                file: kf.filePath,
                lines: [c.startLine, c.headerEndLine],
                evidence: `\`${c.snippet}\` reads animated state \`${hitVar}\` in composition.`,
                remediation: fixHint,
                symbolContext: [fn.name]
              })
            );
          } else if (rawCandidates) {
            rawCandidates.push(
              makeRuleCandidate("F-001", {
                file: kf.filePath,
                lines: [c.startLine, c.headerEndLine],
                evidence: `\`${c.snippet}\` references animated state \`${hitVar}\` inside a deferred lambda or cached block.`,
                verificationHint: `Check whether this callback or cached block executes during composition on every frame; if so, ${fixHint.charAt(0).toLowerCase()}${fixHint.slice(1)}`
              })
            );
          }
        }
      } else if (c.name === "background") {
        const firstArg = c.args[0];
        if (firstArg) {
          const hitColor = findScopedSimpleVarRef(firstArg.tokens, c.nameTokIdx, scopedBindings, "color") || findScopedSimpleVarRef(firstArg.tokens, c.nameTokIdx, scopedBindings, "derivedColor");
          if (hitColor) {
            if (guaranteedInComposition) {
              rawFindings.push(
                makeRuleFinding("F-001", {
                  file: kf.filePath,
                  lines: [c.startLine, c.headerEndLine],
                  evidence: `\`${c.snippet}\` reads per-frame animated color \`${hitColor}\` in composition.`,
                  remediation: `Draw the animated color in the draw phase via \`Modifier.drawBehind { drawRect(${hitColor}) }\` (clipping first if needed) instead of \`Modifier.background(${hitColor})\`.`,
                  symbolContext: [fn.name]
                })
              );
            } else if (rawCandidates) {
              rawCandidates.push(
                makeRuleCandidate("F-001", {
                  file: kf.filePath,
                  lines: [c.startLine, c.headerEndLine],
                  evidence: `\`${c.snippet}\` references animated color \`${hitColor}\` inside a deferred lambda or cached block.`,
                  verificationHint: "Check whether this callback or cached block executes during composition on every frame; if so, draw the animated color via `Modifier.drawBehind { drawRect(...) }`."
                })
              );
            }
          }
        }
      } else if (LAYOUT_SIZE_MODIFIER_NAMES.has(c.name)) {
        const hitVar = findScopedReferencedAnimatedVar(c.args, c.nameTokIdx, scopedBindings);
        if (hitVar) {
          rawCandidates.push(
            makeRuleCandidate("F-008", {
              file: kf.filePath,
              lines: [c.startLine, c.headerEndLine],
              evidence: `\`${c.snippet}\` animates layout property \`${c.name}\` via \`${hitVar}\` on every frame.`,
              verificationHint: "Check whether sibling reflow is genuinely required; if the element only shifts its own visual position or scale, replace animated padding/size with lambda `Modifier.offset { ... }` or `Modifier.graphicsLayer { ... }`."
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
  return calls.find(
    (c) => (tokens[c.chainRootIdx] === firstTok || tokens[c.nameTokIdx] === firstTok) && tokens[c.endTokIdx] === lastTok
  ) || null;
}
function isTopLevelOrAndroidxQualifiedCall(tokens, call) {
  if (!call) return false;
  if (!call.receiver && call.chainRootIdx === call.nameTokIdx) return true;
  const prefix = tokens.slice(call.chainRootIdx, call.nameTokIdx);
  if (prefix.length < 2 || prefix[0].type !== "Identifier" || prefix[0].value !== "androidx") {
    return false;
  }
  return prefix.every(
    (t, idx) => idx % 2 === 0 ? t.type === "Identifier" : t.type === "Punct" && t.value === "."
  );
}
function hasSafeCallInReceiverChain(tokens, call) {
  for (let i = call.chainRootIdx; i < call.nameTokIdx; i += 1) {
    if (tokens[i].type === "Punct" && tokens[i].value === "?.") return true;
  }
  return false;
}
function isLocalVarReassignedInFn(tokens, ld, fn) {
  if (ld.kind !== "var") return false;
  for (let i = ld.endTokIdx + 1; i <= fn.endTokIdx; i += 1) {
    const t = tokens[i];
    if (t.type !== "Identifier" || t.value !== ld.name) continue;
    const prev = tokens[i - 1];
    if (prev && prev.type === "Punct" && (prev.value === "." || prev.value === "?." || prev.value === "::")) {
      continue;
    }
    if (prev && prev.type === "Punct" && (prev.value === "++" || prev.value === "--")) {
      return true;
    }
    const next = tokens[i + 1];
    if (next && next.type === "Punct" && (next.value === "=" || next.value === "+=" || next.value === "-=" || next.value === "*=" || next.value === "/=" || next.value === "%=" || next.value === "++" || next.value === "--")) {
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
  if (stripped.length >= 2 && stripped[0].type === "Punct" && stripped[0].value === "{" && stripped[stripped.length - 1].type === "Punct" && stripped[stripped.length - 1].value === "}") {
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
    if (t.type === "Punct") {
      if (t.value === "(") pDepth += 1;
      else if (t.value === ")") pDepth = Math.max(0, pDepth - 1);
      else if (t.value === "{") bDepth += 1;
      else if (t.value === "}") bDepth = Math.max(0, bDepth - 1);
      else if (t.value === "[") kDepth += 1;
      else if (t.value === "]") kDepth = Math.max(0, kDepth - 1);
      else if (pDepth === 0 && bDepth === 0 && kDepth === 0 && t.value === "->") return true;
    }
  }
  return false;
}
function canTokenEndExpression(tok) {
  if (!tok) return false;
  if (tok.type === "Identifier" || tok.type === "NumberLiteral" || tok.type === "StringLiteral" || tok.type === "CharLiteral") {
    return true;
  }
  if (tok.type === "Keyword" && (tok.value === "true" || tok.value === "false" || tok.value === "null" || tok.value === "this" || tok.value === "super")) {
    return true;
  }
  if (tok.type === "Punct" && (tok.value === ")" || tok.value === "}" || tok.value === "]")) {
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
    if (t.type === "Punct") {
      if (t.value === "(") pDepth += 1;
      else if (t.value === ")") pDepth = Math.max(0, pDepth - 1);
      else if (t.value === "{") bDepth += 1;
      else if (t.value === "}") bDepth = Math.max(0, bDepth - 1);
      else if (t.value === "[") kDepth += 1;
      else if (t.value === "]") kDepth = Math.max(0, kDepth - 1);
      else if (t.value === ";" && pDepth === 0 && bDepth === 0 && kDepth === 0) {
        if (i > curStart) stmts.push(bodyToks.slice(curStart, i));
        curStart = i + 1;
        continue;
      }
    }
    const next = bodyToks[i + 1];
    if (!next) break;
    if (pDepth === 0 && bDepth === 0 && kDepth === 0 && next.line > t.endLine) {
      let closesControlHeader = false;
      if (t.type === "Punct" && t.value === ")") {
        const openP = findMatchingBackward2(bodyToks, i, "(", ")");
        const kw = openP > curStart ? bodyToks[openP - 1] : null;
        if (kw?.type === "Keyword" && (kw.value === "if" || kw.value === "while" || kw.value === "for" || kw.value === "catch" || kw.value === "when")) {
          closesControlHeader = true;
        }
      }
      const prevInStmt = i > curStart ? bodyToks[i - 1] : null;
      const isInfixIdent = t.type === "Identifier" && canTokenEndExpression(prevInStmt);
      const curContinues = closesControlHeader || isInfixIdent || t.type === "Punct" && [".", "?.", "?:", "=", "+", "-", "*", "/", "%", "&&", "||", "==", "!=", "===", "!==", "<", ">", "<=", ">=", "..", "..<", "->", ":"].includes(t.value) || t.type === "Keyword" && ["else", "by", "in", "is", "as", "if", "when", "try", "catch", "finally", "while", "for", "do", "return", "throw"].includes(t.value);
      const nextContinues = next.type === "Punct" && [".", "?.", "?:", "+", "*", "/", "%", "&&", "||", "==", "!=", "===", "!==", "<", ">", "<=", ">=", "..", "..<", "{", "->"].includes(next.value) || next.type === "Keyword" && ["else", "catch", "finally", "in", "is", "as"].includes(next.value);
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
  if (isTopLevelOrAndroidxQualifiedCall(tokens, topCall) && topCall.name === "Animatable" && topCall.hasParens && !topCall.trailingLambda) {
    return topCall;
  }
  if (isTopLevelOrAndroidxQualifiedCall(tokens, topCall) && (topCall.name === "remember" || topCall.name === "rememberSaveable")) {
    const calcLambda = topCall.trailingLambda || findNamedLambdaArgBraces(tokens, topCall, "calculation");
    if (!calcLambda) return null;
    const bodyToks = tokens.slice(calcLambda.openBraceIdx + 1, calcLambda.closeBraceIdx);
    if (bodyToks.length === 0 || hasTopLevelLambdaArrow(bodyToks)) return null;
    if (bodyToks.some((t) => t.type === "Keyword" && (t.value === "return" || t.value === "throw"))) {
      return null;
    }
    const stmts = splitTopLevelStatements(bodyToks);
    if (stmts.length === 0) return null;
    const lastStmt = stmts[stmts.length - 1];
    const innerTop = findDirectTopLevelCall(tokens, calls, lastStmt);
    if (innerTop && isTopLevelOrAndroidxQualifiedCall(tokens, innerTop) && innerTop.name === "Animatable" && innerTop.hasParens && !innerTop.trailingLambda) {
      return innerTop;
    }
  }
  return null;
}
var NON_COMPOSITION_CALL_NAMES = /* @__PURE__ */ new Set([
  "remember",
  "rememberSaveable",
  "rememberUpdatedState",
  "derivedStateOf",
  "produceState",
  "LaunchedEffect",
  "DisposableEffect",
  "SideEffect",
  "clickable",
  "combinedClickable",
  "selectable",
  "toggleable",
  "triStateToggleable",
  "pointerInput",
  "draggable",
  "scrollable",
  "AnchoredDraggable",
  "detectTapGestures",
  "detectDragGestures",
  "onGloballyPositioned",
  "onSizeChanged",
  "onPlaced",
  "onFocusChanged",
  "onKeyEvent",
  "onPreviewKeyEvent",
  "semantics",
  "clearAndSetSemantics",
  "drawBehind",
  "drawWithContent",
  "drawWithCache",
  "onDrawBehind",
  "onDrawWithContent",
  "Canvas",
  "layout",
  "graphicsLayer",
  "offset",
  "absoluteOffset",
  "launch",
  "async",
  "withContext"
]);
var INLINE_OR_COMPOSABLE_DSL_SCOPES = /* @__PURE__ */ new Set([
  "item",
  "items",
  "itemsIndexed",
  "stickyHeader",
  "composable",
  "navigation",
  "key",
  "composed",
  "CompositionLocalProvider",
  "SelectionContainer",
  "DisableSelection",
  "with",
  "run",
  "let",
  "also",
  "apply",
  "repeat",
  "forEach",
  "forEachIndexed"
]);
var COMPOSABLE_SLOT_ARG_NAMES = /* @__PURE__ */ new Set([
  "content",
  "title",
  "text",
  "icon",
  "leadingIcon",
  "trailingIcon",
  "label",
  "placeholder",
  "prefix",
  "suffix",
  "supportingText",
  "headlineContent",
  "supportingContent",
  "overlineContent",
  "leadingContent",
  "trailingContent",
  "topBar",
  "bottomBar",
  "floatingActionButton",
  "snackbarHost",
  "sheetContent",
  "drawerContent",
  "navigationIcon",
  "actions",
  "badge",
  "confirmButton",
  "dismissButton",
  "divider",
  "indicator",
  "tabs",
  "thumb",
  "track"
]);
function isWhenBlockOpenBrace(tokens, openBraceIdx) {
  const prev = tokens[openBraceIdx - 1];
  if (prev?.type === "Keyword" && prev.value === "when") return true;
  if (prev?.type === "Punct" && prev.value === ")") {
    const openP = findMatchingBackward2(tokens, openBraceIdx - 1, "(", ")");
    if (openP > 0 && tokens[openP - 1]?.type === "Keyword" && tokens[openP - 1].value === "when") {
      return true;
    }
  }
  return false;
}
function isControlFlowBraceBlock(tokens, openBraceIdx, fnStartIdx, fnEndIdx) {
  const prev = tokens[openBraceIdx - 1];
  if (!prev) return false;
  if (prev.type === "Keyword" && (prev.value === "else" || prev.value === "try" || prev.value === "finally" || prev.value === "do" || prev.value === "when")) {
    return true;
  }
  if (prev.type === "Punct" && prev.value === ")") {
    const openP = findMatchingBackward2(tokens, openBraceIdx - 1, "(", ")");
    const kw = openP > 0 ? tokens[openP - 1] : null;
    if (kw?.type === "Keyword" && (kw.value === "if" || kw.value === "when" || kw.value === "for" || kw.value === "while" || kw.value === "catch")) {
      return true;
    }
  }
  if (prev.type === "Punct" && prev.value === "->") {
    const [parentOpen] = findEnclosingBraceScope(tokens, openBraceIdx, fnStartIdx, fnEndIdx);
    if (parentOpen >= fnStartIdx && isWhenBlockOpenBrace(tokens, parentOpen)) {
      return true;
    }
  }
  return false;
}
function isGuaranteedCompositionExecution(tokens, declarations, calls, fn, targetCall) {
  if (targetCall.enclosingDeclarations.some((d) => d.kind === "fun" && d !== fn)) {
    return false;
  }
  let fnBodyOpenBraceIdx = -1;
  if (!fn.isExpressionBody && tokens[fn.endTokIdx]?.value === "}") {
    fnBodyOpenBraceIdx = findMatchingBackward2(tokens, fn.endTokIdx, "{", "}");
  }
  const scanFrom = fnBodyOpenBraceIdx !== -1 ? fnBodyOpenBraceIdx + 1 : fn.startTokIdx + 1;
  for (let i = scanFrom; i < targetCall.nameTokIdx; i += 1) {
    const t = tokens[i];
    if (t.type !== "Punct" || t.value !== "{") continue;
    const closeB = findMatchingForward(tokens, i, "{", "}");
    if (closeB === -1 || closeB <= targetCall.nameTokIdx) continue;
    if (isControlFlowBraceBlock(tokens, i, fn.startTokIdx, fn.endTokIdx)) {
      continue;
    }
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
    const slotOwner = calls.find(
      (c) => /^[A-Z]/.test(c.name) && !NON_COMPOSITION_CALL_NAMES.has(c.name) && Array.isArray(c.args) && c.args.some(
        (a) => a.name && COMPOSABLE_SLOT_ARG_NAMES.has(a.name) && a.tokens.length >= 2 && a.tokens[0] === tokens[i] && a.tokens[a.tokens.length - 1] === tokens[closeB]
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
    const direct = findScopedSimpleVarRef(arg.tokens, atTokIdx, scopedBindings, "frame");
    if (direct) return direct;
    const animVal = findScopedAnimatableRead(arg.tokens, atTokIdx, scopedBindings);
    if (animVal) return `${animVal}.value`;
  }
  return null;
}
function isUnqualifiedLocalIdent(toks, idx) {
  const prev = toks[idx - 1];
  if (prev && prev.type === "Punct" && (prev.value === "." || prev.value === "?." || prev.value === "::" || prev.value === "@" || prev.value === ":")) {
    return false;
  }
  if (prev && prev.type === "Keyword" && (prev.value === "as" || prev.value === "is")) {
    return false;
  }
  if (prev && prev.type === "Punct" && prev.value === "?" && toks[idx - 2]?.type === "Keyword" && toks[idx - 2].value === "as") {
    return false;
  }
  const next = toks[idx + 1];
  if (next && next.type === "Punct" && (next.value === "::" || next.value === "@")) {
    return false;
  }
  if (prev && prev.type === "Punct" && (prev.value === "(" || prev.value === ",") && next && next.type === "Punct" && next.value === "=") {
    return false;
  }
  return true;
}
function isCalleeIdentAt(toks, idx) {
  const next = toks[idx + 1];
  if (!next || next.type !== "Punct") return false;
  if (next.value === "(" || next.value === "{") return true;
  if (next.value === "<") {
    let depth = 0;
    for (let k = idx + 1; k < toks.length; k += 1) {
      const tk = toks[k];
      if (tk.type === "Punct" && tk.value === "<") {
        depth += 1;
      } else if (tk.type === "Punct" && tk.value === ">") {
        depth -= 1;
        if (depth === 0) {
          const after = toks[k + 1];
          return Boolean(after && after.type === "Punct" && (after.value === "(" || after.value === "{"));
        }
      } else if (tk.type === "Identifier" || tk.type === "Punct" && (tk.value === "," || tk.value === "." || tk.value === "?" || tk.value === "*") || tk.type === "Keyword" && (tk.value === "in" || tk.value === "out")) {
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
    if (t.type === "Punct") {
      if (t.value === "{") {
        bDepth += 1;
        continue;
      }
      if (t.value === "}") {
        bDepth = Math.max(0, bDepth - 1);
        continue;
      }
    }
    if (bDepth > 0) continue;
    if (t.type === "Identifier" && isUnqualifiedLocalIdent(toks, i) && !isCalleeIdentAt(toks, i)) {
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
    if (t.type === "Punct") {
      if (t.value === "{") {
        bDepth += 1;
        continue;
      }
      if (t.value === "}") {
        bDepth = Math.max(0, bDepth - 1);
        continue;
      }
    }
    if (bDepth > 0 || i + 2 >= toks.length) continue;
    if (toks[i].type === "Identifier" && isUnqualifiedLocalIdent(toks, i) && toks[i + 1].type === "Punct" && (toks[i + 1].value === "." || toks[i + 1].value === "?.") && toks[i + 2].type === "Identifier" && toks[i + 2].value === "value" && !isCalleeIdentAt(toks, i + 2) && resolveScopedLocalKind(toks[i].value, atTokIdx, scopedBindings) === "animatable") {
      return toks[i].value;
    }
  }
  return null;
}
function getItemsKeyArg(call) {
  const named = call.args.find((a) => a.name === "key");
  if (named) return named;
  if (call.args.length >= 2 && call.args[1].name === null && (call.args[0].name === null || call.args[0].name === "items" || call.args[0].name === "count")) {
    return call.args[1];
  }
  return null;
}
function checkF003AndT021(kf, conventionContext, rawFindings, rawCandidates) {
  const { calls } = kf;
  for (const c of calls) {
    if (c.name !== "items" && c.name !== "itemsIndexed" || !c.trailingLambda) continue;
    const animateItemCall = calls.find((inner) => {
      if (inner.name !== "animateItem" || !inner.receiver) return false;
      if (inner.nameTokIdx <= c.trailingLambda.openBraceIdx || inner.endTokIdx >= c.trailingLambda.closeBraceIdx) return false;
      const nearestItems = [...inner.enclosingCalls].reverse().find((ec) => ec.name === "items" || ec.name === "itemsIndexed");
      return nearestItems === c;
    });
    if (!animateItemCall) continue;
    const symNames = c.enclosingDeclarations.map((d) => d.name);
    const keyArg = getItemsKeyArg(c);
    if (!keyArg || keyArg.text === "null") {
      rawFindings.push(
        makeRuleFinding("F-003", {
          file: kf.filePath,
          lines: [c.startLine, c.endLine],
          evidence: `\`${c.name}(...)\` uses \`Modifier.animateItem()\` (line ${animateItemCall.startLine}) without providing a \`key\`.`,
          remediation: `Pass a stable, Bundle-compatible identity key on \`${c.name}(..., key = { item -> item.id })\`.`,
          symbolContext: symNames
        })
      );
      continue;
    }
    const hasIdentityTwinOrSpec = conventionContext.usesIdentityListKeys || conventionContext.hasMotionMdSpecs;
    const keySeverity = hasIdentityTwinOrSpec ? "major" : "minor";
    const keyBasis = conventionContext.usesIdentityListKeys ? "compliant-identity-key-in-scanned-set" : conventionContext.hasMotionMdSpecs ? "motion-md-convention" : "no-established-convention-in-scanned-set";
    if (c.name === "itemsIndexed") {
      const idxKeyClass = classifyItemsIndexedKey(kf, keyArg);
      if (idxKeyClass === "positional") {
        rawFindings.push(
          makeRuleFinding("T-021", {
            file: kf.filePath,
            lines: [c.startLine, c.endLine],
            severity: keySeverity,
            severityBasis: keyBasis,
            evidence: `\`itemsIndexed(..., key = ${keyArg.text})\` keys \`animateItem()\` rows by list index instead of item identity.`,
            remediation: "Key items by a stable content identifier from the item parameter (for example `key = { _, item -> item.id }`).",
            symbolContext: symNames
          })
        );
      } else if (idxKeyClass === "unresolved-index-lookup" && rawCandidates) {
        rawCandidates.push(
          makeRuleCandidate("T-021", {
            file: kf.filePath,
            lines: [c.startLine, c.endLine],
            severity: keySeverity,
            evidence: `\`itemsIndexed(..., key = ${keyArg.text})\` derives its key from the index parameter rather than reading the \`item\` lambda parameter directly.`,
            verificationHint: "Confirm the expression resolves a stable item identity (prefer `key = { _, item -> item.id }` for clarity) rather than a positional row index."
          })
        );
      }
    } else if (c.name === "items") {
      const firstArg = c.args[0];
      if (firstArg && firstArg.name !== "items" && isIdentityIndexLambda(kf, keyArg)) {
        if (isProvableIntCountArg(kf, c, firstArg)) {
          rawFindings.push(
            makeRuleFinding("T-021", {
              file: kf.filePath,
              lines: [c.startLine, c.endLine],
              severity: keySeverity,
              severityBasis: keyBasis,
              evidence: `\`items(${firstArg.text}, key = ${keyArg.text})\` passes a count overload with the index itself as \`key\` alongside \`animateItem()\`.`,
              remediation: "Pass the domain collection and key by stable item identity (`items(list, key = { it.id })`).",
              symbolContext: symNames
            })
          );
        } else if (rawCandidates) {
          rawCandidates.push(
            makeRuleCandidate("T-021", {
              file: kf.filePath,
              lines: [c.startLine, c.endLine],
              severity: keySeverity,
              evidence: `\`items(${firstArg.text}, key = ${keyArg.text})\` uses \`animateItem()\` with identity lambda \`${keyArg.text}\`; type of \`${firstArg.text}\` (Int count vs List) is not locally declared.`,
              verificationHint: `Check the declaration of \`${firstArg.text}\`: if \`Int\`, \`key = { it }\` keys by list index (T-021); if \`List<Scalar>\` with unique elements, \`{ it }\` is an identity key.`
            })
          );
        }
      }
    }
  }
}
var POSITIONAL_PRIMITIVE_METHODS = /* @__PURE__ */ new Set([
  "toString",
  "toLong",
  "toInt",
  "toShort",
  "toByte",
  "toUInt",
  "toULong",
  "toFloat",
  "toDouble",
  "hashCode"
]);
var POSITIONAL_ARITH_PUNCT = /* @__PURE__ */ new Set(["+", "-", "*", "/", "%", "(", ")"]);
var POSITIONAL_INFIX_OPS = /* @__PURE__ */ new Set(["shl", "shr", "ushr", "xor", "or", "and"]);
function isDemonstrablyPositionalIndexExpr(bodyToks, idxName) {
  if (!Array.isArray(bodyToks) || bodyToks.length === 0) return false;
  for (let i = 0; i < bodyToks.length; i += 1) {
    const t = bodyToks[i];
    if (t.type === "NumberLiteral" || t.type === "StringLiteral") {
      continue;
    }
    if (t.type === "Punct") {
      if (POSITIONAL_ARITH_PUNCT.has(t.value)) {
        if (t.value === "(" && bodyToks[i - 1]?.type === "Identifier" && !POSITIONAL_INFIX_OPS.has(bodyToks[i - 1].value)) {
          return false;
        }
        continue;
      }
      if (t.value === "." && bodyToks[i - 1]?.type === "Identifier" && bodyToks[i - 1].value === idxName && bodyToks[i + 1]?.type === "Identifier" && POSITIONAL_PRIMITIVE_METHODS.has(bodyToks[i + 1].value) && bodyToks[i + 2]?.type === "Punct" && bodyToks[i + 2].value === "(" && bodyToks[i + 3]?.type === "Punct" && bodyToks[i + 3].value === ")") {
        i += 3;
        continue;
      }
      return false;
    }
    if (t.type === "Identifier") {
      if (t.value === idxName && isUnqualifiedLocalIdent(bodyToks, i)) {
        if (bodyToks[i + 1]?.type === "Punct" && (bodyToks[i + 1].value === "(" || bodyToks[i + 1].value === "[")) {
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
  if (!toks.length || toks[0].value !== "{" || toks[toks.length - 1].value !== "}" || findMatchingForward(toks, 0, "{", "}") !== toks.length - 1) {
    return null;
  }
  let arrowPos = -1;
  let depth = 0;
  for (let i = 1; i < toks.length - 1; i += 1) {
    const t = toks[i];
    if (t.type === "Punct") {
      if (t.value === "{" || t.value === "(") depth += 1;
      else if (t.value === "}" || t.value === ")") depth -= 1;
      else if (t.value === "->" && depth === 0) {
        arrowPos = i;
        break;
      }
    }
  }
  if (arrowPos === -1) return null;
  const headerToks = toks.slice(1, arrowPos);
  const commaPos = headerToks.findIndex((t) => t.type === "Punct" && t.value === ",");
  if (commaPos === -1) return null;
  const idxParamTok = headerToks.slice(0, commaPos).find((t) => t.type === "Identifier");
  const itemParamTok = headerToks.slice(commaPos + 1).find((t) => t.type === "Identifier");
  if (!idxParamTok) return null;
  const idxName = idxParamTok.value;
  const itemName = itemParamTok ? itemParamTok.value : "_";
  if (idxName === "_") return null;
  const bodyToks = toks.slice(arrowPos + 1, -1);
  const usesIdx = bodyToks.some((t, idx) => t.type === "Identifier" && t.value === idxName && isUnqualifiedLocalIdent(bodyToks, idx));
  const usesItem = itemName !== "_" && bodyToks.some((t, idx) => t.type === "Identifier" && t.value === itemName && isUnqualifiedLocalIdent(bodyToks, idx));
  void kf;
  if (!usesIdx || usesItem) return null;
  if (isDemonstrablyPositionalIndexExpr(bodyToks, idxName)) {
    return "positional";
  }
  return "unresolved-index-lookup";
}
function isProvableIntCountArg(kf, call, firstArg) {
  if (firstArg.name === "count") return true;
  const toks = firstArg.tokens;
  if (toks.length === 1 && toks[0].type === "NumberLiteral" && /^\d+$/.test(toks[0].value)) {
    return true;
  }
  if (toks.length >= 3 && toks[toks.length - 2]?.value === "." && (toks[toks.length - 1]?.value === "size" || toks[toks.length - 1]?.value === "length")) {
    return true;
  }
  if (toks.length === 1 && toks[0].type === "Identifier") {
    const paramName = toks[0].value;
    for (const d of call.enclosingDeclarations) {
      if (d.paramRange) {
        const paramSlice = kf.tokens.slice(d.paramRange[0] + 1, d.paramRange[1]);
        for (let i = 0; i + 2 < paramSlice.length; i += 1) {
          if (paramSlice[i].type === "Identifier" && paramSlice[i].value === paramName && paramSlice[i + 1].value === ":" && paramSlice[i + 2].value === "Int") {
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
  const text = keyArg.text.replace(/\s+/g, " ").trim();
  if (/^\{\s*it\s*\}$/.test(text)) return true;
  const m = text.match(/^\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*->\s*\1\s*\}$/);
  return Boolean(m);
}
function findScaleReadingHelpers(kf) {
  const helpers = /* @__PURE__ */ new Set();
  for (const d of kf.declarations) {
    if (d.kind !== "fun" && d.kind !== "val") continue;
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
  const logSpans = allCalls.filter(
    (c) => (c.receiver === "Log" || c.name === "println" || c.name === "print") && c.hasParens && kfTokenOffsetOverlap(c, startOff, endOff)
  );
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    const isScaleIdent = t.type === "Identifier" && DURATION_SCALE_IDENTIFIERS.has(t.value) || t.type === "Identifier" && t.value === "ValueAnimator" && toks[i + 1]?.value === "." && toks[i + 2]?.value === "durationScale";
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
var BENIGN_STATE_WRAPPER_IDENTS = /* @__PURE__ */ new Set([
  "remember",
  "rememberSaveable",
  "mutableStateOf",
  "mutableFloatStateOf",
  "mutableIntStateOf",
  "mutableLongStateOf",
  "mutableDoubleStateOf",
  "derivedStateOf"
]);
function isProvablyNonScaleParamType(typeText) {
  const clean = String(typeText || "").replace(/\s+/g, "");
  if (!clean) return false;
  return /^(?:Int|Long|Short|Byte|Char|Dp|TextUnit|String|CharSequence|AnnotatedString|Color|Brush|Shape|TextStyle|Modifier|androidx\.compose\.ui\.Modifier|PaddingValues|Arrangement(?:\.[A-Za-z0-9_]+)?|Alignment(?:\.[A-Za-z0-9_]+)?|(?:kotlin\.collections\.)?(?:List|MutableList|Set|Map|Collection|Iterable|Sequence)<.*>|kotlinx\.collections\.immutable\.(?:Immutable|Persistent)(?:List|Set|Map)<.*>|\([^)]*\)->Unit)\??$/.test(
    clean
  );
}
function checkF005(kf, scaleHelpers, rawFindings, rawCandidates) {
  const { tokens, declarations, calls } = kf;
  const fileLevelNonScaleConsts = /* @__PURE__ */ new Set();
  for (const d of declarations) {
    if (d.kind === "val" && d.delegateIdx === -1 && d.rhsStartIdx >= 0 && d.rhsStartIdx <= d.endTokIdx) {
      const isTopLevel = !declarations.some(
        (other) => other !== d && other.kind === "fun" && other.startTokIdx < d.startTokIdx && other.endTokIdx >= d.endTokIdx
      );
      if (isTopLevel) {
        const rhsToks = tokens.slice(d.rhsStartIdx, d.endTokIdx + 1);
        const hasAnyIdent = rhsToks.some((t) => t.type === "Identifier");
        if (!hasAnyIdent) {
          fileLevelNonScaleConsts.add(d.name);
        }
      }
    }
  }
  for (const c of calls) {
    if (c.name === "animate" && c.receiver && /lottie|animatable/i.test(c.receiver) && c.hasParens) {
      rawCandidates.push(
        makeRuleCandidate("F-005", {
          file: kf.filePath,
          lines: [c.startLine, c.headerEndLine],
          evidence: `Direct \`${c.receiver}.animate(...)\` call detected.`,
          verificationHint: "`LottieAnimatable.animate()` declares `ignoreSystemAnimationsDisabled` without reading system animator duration scale internally; verify whether reduced-motion scale `0f` snaps to a readable rest frame or use `animateLottieCompositionAsState`."
        })
      );
    }
    if (c.name !== "LaunchedEffect" || !c.trailingLambda) continue;
    const bodyToks = c.trailingLambda.bodyTokens;
    if (bodyToks.length === 0) continue;
    const bodyStartIdx = c.trailingLambda.openBraceIdx + 1;
    const bodyEndIdx = c.trailingLambda.closeBraceIdx;
    const loopWithFrameNanos = findLoopCallingWithFrameNanos(tokens, calls, bodyStartIdx, bodyEndIdx, c);
    if (!loopWithFrameNanos) continue;
    if (tokensReadDurationScale(bodyToks, calls)) continue;
    const bodyCalls = calls.filter((ic) => ic.nameTokIdx >= bodyStartIdx && ic.endTokIdx < bodyEndIdx);
    if (bodyCalls.some((ic) => scaleHelpers.has(ic.name))) continue;
    const enclosingFns = c.enclosingDeclarations.filter((d) => d.kind === "fun");
    const outerFn = enclosingFns[0] || null;
    const scanStartIdx = outerFn ? outerFn.startTokIdx : bodyStartIdx;
    const scanEndIdx = outerFn ? outerFn.endTokIdx : bodyEndIdx;
    const localScaleDerivedVars = /* @__PURE__ */ new Set();
    const localKnownNonScaleVars = /* @__PURE__ */ new Set(["Unit", "true", "false", "null", "isActive", ...fileLevelNonScaleConsts]);
    for (const fnDecl of enclosingFns) {
      const fnParamTypes = extractFunctionParamTypeMap(tokens, fnDecl);
      for (const [pName, pType] of fnParamTypes.entries()) {
        if (isProvablyNonScaleParamType(pType)) {
          localKnownNonScaleVars.add(pName);
        }
      }
    }
    const localVals = declarations.filter(
      (d) => (d.kind === "val" || d.kind === "var") && d.startTokIdx > scanStartIdx && d.endTokIdx <= scanEndIdx
    );
    const localAssignments = collectSimpleAssignmentsInRange(tokens, scanStartIdx, scanEndIdx);
    for (let pass = 0; pass < 4; pass += 1) {
      let changed = false;
      for (const lv of localVals) {
        if (localScaleDerivedVars.has(lv.name)) continue;
        const lvToks = tokens.slice(lv.startTokIdx, lv.endTokIdx + 1);
        const lvCalls = calls.filter((ic) => ic.nameTokIdx >= lv.startTokIdx && ic.endTokIdx <= lv.endTokIdx);
        const refsScaleVar = lvToks.some(
          (t, idx) => idx !== lv.nameIdx - lv.startTokIdx && t.type === "Identifier" && isUnqualifiedLocalIdent(lvToks, idx) && localScaleDerivedVars.has(t.value)
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
          (t, idx) => t.type === "Identifier" && isUnqualifiedLocalIdent(asgn.rhsToks, idx) && localScaleDerivedVars.has(t.value)
        );
        if (tokensReadDurationScale(asgn.rhsToks, calls) || asgnCalls.some((ic) => scaleHelpers.has(ic.name)) || refsScaleVar) {
          localScaleDerivedVars.add(asgn.name);
          localKnownNonScaleVars.delete(asgn.name);
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (let pass = 0; pass < 4; pass += 1) {
      let changed = false;
      for (const lv of localVals) {
        if (localScaleDerivedVars.has(lv.name) || localKnownNonScaleVars.has(lv.name)) continue;
        const rhsStart = lv.rhsStartIdx >= 0 ? lv.rhsStartIdx : lv.delegateIdx;
        if (rhsStart < 0 || rhsStart > lv.endTokIdx) continue;
        const initToks = tokens.slice(rhsStart, lv.endTokIdx + 1);
        const allInitIdentsBenign = initToks.every((t, idx) => {
          if (t.type !== "Identifier") return true;
          if (!isUnqualifiedLocalIdent(initToks, idx)) return true;
          return BENIGN_STATE_WRAPPER_IDENTS.has(t.value) || localKnownNonScaleVars.has(t.value);
        });
        if (!allInitIdentsBenign) continue;
        if (lv.kind === "var") {
          const writes = localAssignments.filter((a) => a.name === lv.name);
          const allWritesBenign = writes.every(
            (w) => w.rhsToks.every((t, idx) => {
              if (t.type !== "Identifier") return true;
              if (!isUnqualifiedLocalIdent(w.rhsToks, idx)) return true;
              return t.value === lv.name || BENIGN_STATE_WRAPPER_IDENTS.has(t.value) || localKnownNonScaleVars.has(t.value);
            })
          );
          if (!allWritesBenign) continue;
        }
        localKnownNonScaleVars.add(lv.name);
        changed = true;
      }
      if (!changed) break;
    }
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
        (t, idx) => t.type === "Identifier" && isUnqualifiedLocalIdent(slice, idx) && (localScaleDerivedVars.has(t.value) || scaleHelpers.has(t.value))
      );
    });
    if (respectsScaleViaGuardOrKey) continue;
    const unresolvedGuardSet = /* @__PURE__ */ new Set();
    for (const slice of gatingSlices) {
      for (let idx = 0; idx < slice.length; idx += 1) {
        const t = slice[idx];
        if (t.type === "Identifier" && isUnqualifiedLocalIdent(slice, idx) && !localKnownNonScaleVars.has(t.value) && !BENIGN_STATE_WRAPPER_IDENTS.has(t.value)) {
          unresolvedGuardSet.add(t.value);
        }
      }
    }
    for (const a of c.args) {
      for (let idx = 0; idx < a.tokens.length; idx += 1) {
        const t = a.tokens[idx];
        if (t.type === "Identifier" && isUnqualifiedLocalIdent(a.tokens, idx) && !localKnownNonScaleVars.has(t.value) && !BENIGN_STATE_WRAPPER_IDENTS.has(t.value)) {
          unresolvedGuardSet.add(t.value);
        }
      }
    }
    const guardIdents = Array.from(unresolvedGuardSet);
    const symNames = c.enclosingDeclarations.map((d) => d.name);
    if (guardIdents.length > 0) {
      rawCandidates.push(
        makeRuleCandidate("F-005", {
          file: kf.filePath,
          lines: [c.startLine, c.endLine],
          evidence: `\`LaunchedEffect\` frame loop calls \`withFrameNanos\` without a local \`MotionDurationScale\` read, but is gated by external condition/key (${guardIdents.join(", ")}).`,
          verificationHint: "Verify whether the gating condition/key reads `MotionDurationScale` or `ANIMATOR_DURATION_SCALE` and stops the loop when duration scale is `0f`."
        })
      );
    } else {
      rawFindings.push(
        makeRuleFinding("F-005", {
          file: kf.filePath,
          lines: [c.startLine, c.endLine],
          evidence: `\`LaunchedEffect\` runs a \`${loopWithFrameNanos.kind}\` loop calling \`withFrameNanos\` (line ${loopWithFrameNanos.frameLine}) without reading \`MotionDurationScale\` or \`ANIMATOR_DURATION_SCALE\`.`,
          remediation: "Read `coroutineContext[MotionDurationScale]?.scaleFactor ?: 1f` inside the loop; when `scaleFactor == 0f`, settle/idle instead of requesting 60/120Hz frames.",
          symbolContext: symNames
        })
      );
    }
  }
}
function findLoopCallingWithFrameNanos(tokens, calls, startIdx, endIdx, launchedEffectCall) {
  for (let i = startIdx; i < endIdx; i += 1) {
    const t = tokens[i];
    if (t.type === "Keyword" && t.value === "while" && tokens[i + 1]?.value === "(") {
      const closeCond = findMatchingForward(tokens, i + 1, "(", ")");
      if (closeCond !== -1 && tokens[closeCond + 1]?.value === "{") {
        const closeBody = findMatchingForward(tokens, closeCond + 1, "{", "}");
        if (closeBody !== -1) {
          const wfn = calls.find(
            (fc) => fc.name === "withFrameNanos" && fc.nameTokIdx > closeCond + 1 && fc.endTokIdx < closeBody && nearestLaunchedEffect(fc) === launchedEffectCall
          );
          if (wfn) return { kind: "while", frameLine: wfn.startLine, frameTokIdx: wfn.nameTokIdx };
        }
      }
      if (tokens[i - 1]?.value === "}") {
        const openDo = findMatchingBackward2(tokens, i - 1, "{", "}");
        if (openDo !== -1 && tokens[openDo - 1]?.type === "Keyword" && tokens[openDo - 1].value === "do") {
          const wfn = calls.find(
            (fc) => fc.name === "withFrameNanos" && fc.nameTokIdx > openDo && fc.endTokIdx < i - 1 && nearestLaunchedEffect(fc) === launchedEffectCall
          );
          if (wfn) return { kind: "do-while", frameLine: wfn.startLine, frameTokIdx: wfn.nameTokIdx };
        }
      }
    }
  }
  for (const rc of calls) {
    if (rc.name === "repeat" && rc.trailingLambda && rc.nameTokIdx >= startIdx && rc.endTokIdx <= endIdx) {
      const wfn = calls.find(
        (fc) => fc.name === "withFrameNanos" && fc.nameTokIdx > rc.trailingLambda.openBraceIdx && fc.endTokIdx < rc.trailingLambda.closeBraceIdx && nearestLaunchedEffect(fc) === launchedEffectCall
      );
      if (wfn) return { kind: "repeat", frameLine: wfn.startLine, frameTokIdx: wfn.nameTokIdx };
    }
  }
  return null;
}
function nearestLaunchedEffect(call) {
  return [...call.enclosingCalls].reverse().find((ec) => ec.name === "LaunchedEffect") || null;
}
function findMatchingForward(tokens, openIdx, openSym, closeSym) {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i += 1) {
    if (tokens[i].type === "Punct") {
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
  const out = /* @__PURE__ */ new Map();
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
    if (t.type === "Punct") {
      if (t.value === "(") pDepth += 1;
      else if (t.value === ")") pDepth = Math.max(0, pDepth - 1);
      else if (t.value === "{") bDepth += 1;
      else if (t.value === "}") bDepth = Math.max(0, bDepth - 1);
      else if (t.value === "[") kDepth += 1;
      else if (t.value === "]") kDepth = Math.max(0, kDepth - 1);
      else if (pDepth === 0 && bDepth === 0 && kDepth === 0) {
        if (t.value === ":" && !inType) {
          inType = true;
          tDepth = 0;
        } else if (t.value === "=" && inType && tDepth === 0) {
          inType = false;
        } else if (inType && t.value === "<") {
          tDepth += 1;
        } else if (inType && t.value === ">") {
          tDepth = Math.max(0, tDepth - 1);
        } else if (t.value === "," && !(inType && tDepth > 0)) {
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
      if (t.type === "Punct") {
        if (t.value === "(") pd += 1;
        else if (t.value === ")") pd = Math.max(0, pd - 1);
        else if (t.value === "{") bd += 1;
        else if (t.value === "}") bd = Math.max(0, bd - 1);
        else if (t.value === "[") kd += 1;
        else if (t.value === "]") kd = Math.max(0, kd - 1);
        else if (pd === 0 && bd === 0 && kd === 0) {
          if (t.value === ":" && colonIdx === -1) colonIdx = i;
          else if (colonIdx !== -1 && eqIdx === -1 && t.value === "<") td += 1;
          else if (colonIdx !== -1 && eqIdx === -1 && t.value === ">") td = Math.max(0, td - 1);
          else if (colonIdx !== -1 && eqIdx === -1 && td === 0 && t.value === "=") {
            eqIdx = i;
            break;
          }
        }
      }
    }
    if (colonIdx > 0 && paramToks[colonIdx - 1]?.type === "Identifier") {
      const paramName = paramToks[colonIdx - 1].value;
      const typeToks = paramToks.slice(colonIdx + 1, eqIdx === -1 ? paramToks.length : eqIdx).filter((t) => t.type !== "Annotation");
      out.set(paramName, typeToks.map((t) => t.raw).join(""));
    }
  }
  return out;
}
function findSingleStatementOrBlockRange(tokens, startIdx, limitIdx) {
  if (startIdx > limitIdx) return null;
  if (tokens[startIdx]?.type === "Punct" && tokens[startIdx].value === "{") {
    const closeB = findMatchingForward(tokens, startIdx, "{", "}");
    return [startIdx, closeB !== -1 ? closeB : limitIdx];
  }
  let pDepth = 0;
  let bDepth = 0;
  let kDepth = 0;
  let lastIdx = startIdx;
  for (let i = startIdx; i <= limitIdx; i += 1) {
    const t = tokens[i];
    if (t.type === "Punct") {
      if (t.value === "(") pDepth += 1;
      else if (t.value === ")") {
        if (pDepth === 0) break;
        pDepth -= 1;
      } else if (t.value === "{") bDepth += 1;
      else if (t.value === "}") {
        if (bDepth === 0) break;
        bDepth -= 1;
      } else if (t.value === "[") kDepth += 1;
      else if (t.value === "]") {
        if (kDepth === 0) break;
        kDepth -= 1;
      } else if (t.value === ";" && pDepth === 0 && bDepth === 0 && kDepth === 0) {
        break;
      }
    }
    lastIdx = i;
    const next = tokens[i + 1];
    if (!next || i + 1 > limitIdx) break;
    if (pDepth === 0 && bDepth === 0 && kDepth === 0 && next.line > t.endLine) {
      const curContinues = t.type === "Punct" && [".", "?.", "?:", "=", "+", "-", "*", "/", "&&", "||", "==", "!=", "<", ">"].includes(t.value) || t.type === "Keyword" && (t.value === "else" || t.value === "by");
      const nextContinues = next.type === "Punct" && [".", "?.", "?:", "+", "&&", "||", "{"].includes(next.value) || next.type === "Keyword" && next.value === "else";
      if (!curContinues && !nextContinues) break;
    }
  }
  return [startIdx, lastIdx];
}
function collectSimpleAssignmentsInRange(tokens, startIdx, endIdx) {
  const out = [];
  for (let i = startIdx; i <= endIdx - 2; i += 1) {
    if (tokens[i].type === "Identifier" && isUnqualifiedLocalIdent(tokens, i) && tokens[i - 1]?.value !== "val" && tokens[i - 1]?.value !== "var" && tokens[i + 1]?.type === "Punct" && tokens[i + 1].value === "=") {
      let pDepth = 0;
      let isNamedArg = false;
      for (let j = i - 1; j >= startIdx; j -= 1) {
        const pt = tokens[j];
        if (pt.type === "Punct") {
          if (pt.value === ")" || pt.value === "]") pDepth += 1;
          else if (pt.value === "(" || pt.value === "[") {
            if (pDepth === 0) {
              isNamedArg = pt.value === "(";
              break;
            }
            pDepth -= 1;
          } else if (pt.value === "{" && pDepth === 0) {
            break;
          } else if (pt.value === "}" && pDepth === 0) {
            j = findMatchingBackward2(tokens, j, "{", "}");
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
          rhsToks: tokens.slice(rhsRange[0], rhsRange[1] + 1)
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
    if (t.type === "Keyword" && exitKeywords.includes(t.value)) {
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
    if (t.type === "Keyword" && t.value === "if" && tokens[i + 1]?.value === "(") {
      const closeCond = findMatchingForward(tokens, i + 1, "(", ")");
      if (closeCond === -1) continue;
      const condSlice = tokens.slice(i + 2, closeCond);
      const thenRange = findSingleStatementOrBlockRange(tokens, closeCond + 1, scanEndIdx);
      if (!thenRange) continue;
      let elseRange = null;
      if (tokens[thenRange[1] + 1]?.type === "Keyword" && tokens[thenRange[1] + 1].value === "else") {
        elseRange = findSingleStatementOrBlockRange(tokens, thenRange[1] + 2, scanEndIdx);
      }
      const enclosesTarget = idxInsideRange(effectTokIdx, thenRange) || idxInsideRange(frameTokIdx, thenRange) || idxInsideRange(effectTokIdx, elseRange) || idxInsideRange(frameTokIdx, elseRange);
      const earlyExitsBeforeEffect = thenRange[1] < effectTokIdx && sharesBraceScopeWithTarget(tokens, i, effectTokIdx, scanStartIdx, scanEndIdx) && (rangeHasControlExit(tokens, thenRange, ["return"]) || rangeHasControlExit(tokens, elseRange, ["return"]));
      const earlyExitsBeforeFrame = i >= bodyStartIdx && thenRange[1] < frameTokIdx && sharesBraceScopeWithTarget(tokens, i, frameTokIdx, bodyStartIdx - 1, bodyEndIdx) && (rangeHasControlExit(tokens, thenRange, ["return", "break", "continue"]) || rangeHasControlExit(tokens, elseRange, ["return", "break", "continue"]));
      if (enclosesTarget || earlyExitsBeforeEffect || earlyExitsBeforeFrame) {
        slices.push(condSlice);
      }
      continue;
    }
    if (t.type === "Keyword" && t.value === "while" && tokens[i + 1]?.value === "(") {
      const closeCond = findMatchingForward(tokens, i + 1, "(", ")");
      if (closeCond === -1) continue;
      const condSlice = tokens.slice(i + 2, closeCond);
      const bodyRange = findSingleStatementOrBlockRange(tokens, closeCond + 1, scanEndIdx);
      let encloses = idxInsideRange(frameTokIdx, bodyRange) || idxInsideRange(effectTokIdx, bodyRange);
      if (!encloses && tokens[i - 1]?.value === "}") {
        const openDo = findMatchingBackward2(tokens, i - 1, "{", "}");
        if (openDo !== -1 && tokens[openDo - 1]?.value === "do" && frameTokIdx > openDo && frameTokIdx < i - 1) {
          encloses = true;
        }
      }
      if (encloses) {
        slices.push(condSlice);
      }
      continue;
    }
    if (t.type === "Keyword" && t.value === "when") {
      let cursor = i + 1;
      let subjSlice = null;
      if (tokens[cursor]?.value === "(") {
        const closeSubj = findMatchingForward(tokens, cursor, "(", ")");
        if (closeSubj === -1) continue;
        subjSlice = tokens.slice(cursor + 1, closeSubj);
        cursor = closeSubj + 1;
      }
      if (tokens[cursor]?.value !== "{") continue;
      const closeWhen = findMatchingForward(tokens, cursor, "{", "}");
      if (closeWhen === -1) continue;
      const whenRange = [cursor, closeWhen];
      const enclosesTarget = idxInsideRange(effectTokIdx, whenRange) || idxInsideRange(frameTokIdx, whenRange);
      const earlyExitsBeforeEffect = closeWhen < effectTokIdx && sharesBraceScopeWithTarget(tokens, i, effectTokIdx, scanStartIdx, scanEndIdx) && rangeHasControlExit(tokens, whenRange, ["return"]);
      const earlyExitsBeforeFrame = i >= bodyStartIdx && closeWhen < frameTokIdx && sharesBraceScopeWithTarget(tokens, i, frameTokIdx, bodyStartIdx - 1, bodyEndIdx) && rangeHasControlExit(tokens, whenRange, ["return", "break", "continue"]);
      if (enclosesTarget || earlyExitsBeforeEffect || earlyExitsBeforeFrame) {
        if (subjSlice && subjSlice.length > 0) slices.push(subjSlice);
        let bDepth = 0;
        let pDepth = 0;
        let branchStart = cursor + 1;
        for (let k = cursor + 1; k < closeWhen; k += 1) {
          const bt = tokens[k];
          if (bt.type === "Punct") {
            if (bt.value === "{") bDepth += 1;
            else if (bt.value === "}") bDepth = Math.max(0, bDepth - 1);
            else if (bt.value === "(") pDepth += 1;
            else if (bt.value === ")") pDepth = Math.max(0, pDepth - 1);
            else if (bt.value === "->" && bDepth === 0 && pDepth === 0) {
              const lhs = tokens.slice(branchStart, k).filter((x) => !(x.type === "Keyword" && x.value === "else"));
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
  for (const rc of calls) {
    if (rc.name === "repeat" && rc.trailingLambda && rc.nameTokIdx >= bodyStartIdx && rc.endTokIdx <= bodyEndIdx && frameTokIdx > rc.trailingLambda.openBraceIdx && frameTokIdx < rc.trailingLambda.closeBraceIdx && rc.args[0]) {
      slices.push(rc.args[0].tokens);
    }
  }
  return slices;
}
function checkF006(kf, rawFindings, rawCandidates) {
  const { tokens, calls, declarations } = kf;
  const reportedAnimateCalls = /* @__PURE__ */ new Set();
  for (const container of calls) {
    if (!ELEVATED_CONTAINERS.has(container.name) || !container.hasParens) continue;
    if (!isTopLevelOrAndroidxQualifiedCall(tokens, container)) continue;
    if (declarations.some((d) => d.kind === "fun" && d.name === container.name)) continue;
    const modArg = findContainerModifierArg(container);
    if (!modArg) continue;
    const modCheck = findAnimateContentSizeInModifierExpr(tokens, calls, modArg.tokens);
    if (!modCheck.proven && !modCheck.candidate) continue;
    const elevClass = classifyContainerElevation(tokens, calls, container);
    if (elevClass === "zero") continue;
    if (elevClass === "nonzero" && modCheck.proven) {
      reportedAnimateCalls.add(modCheck.proven);
      rawFindings.push(
        makeRuleFinding("F-006", {
          file: kf.filePath,
          lines: [container.startLine, container.endLine],
          evidence: `\`${container.name}\` applies \`Modifier.animateContentSize()\` (line ${modCheck.proven.startLine}) alongside non-zero elevation, clipping its shadow.`,
          remediation: "Apply shadow/elevation on an outer wrapper outside `animateContentSize()`, or animate size inside the elevated surface body.",
          symbolContext: container.enclosingDeclarations.map((d) => d.name)
        })
      );
    } else {
      const animRef = modCheck.proven || modCheck.candidate;
      reportedAnimateCalls.add(animRef);
      if (rawCandidates) {
        rawCandidates.push(
          makeRuleCandidate("F-006", {
            file: kf.filePath,
            lines: [container.startLine, container.endLine],
            evidence: `\`${container.name}\` combines \`animateContentSize()\` (line ${animRef.startLine}) with conditional or unresolved elevation.`,
            verificationHint: "Check whether this container has non-zero shadow elevation while `animateContentSize()` runs; if so, move elevation outside `animateContentSize()`."
          })
        );
      }
    }
  }
  for (const animCall of calls) {
    if (animCall.name !== "animateContentSize" || !animCall.receiver || !animCall.hasParens) continue;
    if (reportedAnimateCalls.has(animCall)) continue;
    const chainCalls = findModifierChainCalls(tokens, calls, animCall);
    const animPos = chainCalls.indexOf(animCall);
    const shadowCalls = chainCalls.filter((cc) => cc.name === "shadow" && cc.receiver && cc.hasParens);
    if (shadowCalls.length === 0) continue;
    let emittedFinding = false;
    for (const shadowCall of shadowCalls) {
      const shadowPos = chainCalls.indexOf(shadowCall);
      if (animPos >= shadowPos) continue;
      const elevClass = classifyShadowCallElevation(tokens, calls, shadowCall);
      if (elevClass === "nonzero" && !hasSafeCallInReceiverChain(tokens, shadowCall)) {
        rawFindings.push(
          makeRuleFinding("F-006", {
            file: kf.filePath,
            lines: [chainCalls[0].chainStartLine, chainCalls[chainCalls.length - 1].endLine],
            evidence: `Modifier chain applies \`animateContentSize()\` outer to \`shadow(${shadowCall.args.map((a) => a.rawText).join(", ")})\`, clipping the drop shadow.`,
            remediation: "Move `Modifier.shadow(...)` outside `animateContentSize()` (for example onto an outer wrapper composable).",
            symbolContext: animCall.enclosingDeclarations.map((d) => d.name)
          })
        );
        emittedFinding = true;
        break;
      }
    }
    if (emittedFinding || !rawCandidates) continue;
    for (const shadowCall of shadowCalls) {
      const elevClass = classifyShadowCallElevation(tokens, calls, shadowCall);
      if (elevClass === "zero") continue;
      const shadowPos = chainCalls.indexOf(shadowCall);
      if (animPos < shadowPos) {
        rawCandidates.push(
          makeRuleCandidate("F-006", {
            file: kf.filePath,
            lines: [chainCalls[0].chainStartLine, chainCalls[chainCalls.length - 1].endLine],
            evidence: `Modifier chain applies \`animateContentSize()\` outer to \`shadow(${shadowCall.args.map((a) => a.rawText).join(", ")})\` with unresolved or conditional elevation.`,
            verificationHint: "Check whether the `shadow(...)` elevation can be greater than `0.dp`; if so, move `Modifier.shadow(...)` outside `animateContentSize()`."
          })
        );
        break;
      } else if (shadowPos < animPos) {
        const separatedByPadding = chainCalls.slice(shadowPos + 1, animPos).some((cc) => cc.name === "padding" && isProvenAllSidesNonZeroPadding(tokens, calls, cc));
        if (!separatedByPadding) {
          rawCandidates.push(
            makeRuleCandidate("F-006", {
              file: kf.filePath,
              lines: [chainCalls[0].chainStartLine, chainCalls[chainCalls.length - 1].endLine],
              evidence: `Modifier chain combines \`shadow(${shadowCall.args.map((a) => a.rawText).join(", ")})\` and \`animateContentSize()\`.`,
              verificationHint: "Confirm `animateContentSize()` does not clip an inner elevated surface, ripple, or exiting child; if clipping occurs, separate `Modifier.shadow(...)` onto an outer wrapper."
            })
          );
          break;
        }
      }
    }
  }
}
function findContainerModifierArg(container) {
  const named = container.args.find((a) => a.name === "modifier");
  if (named) return named;
  const arg0 = container.args[0];
  if (!arg0) return null;
  if (arg0.name === null) {
    const stripped0 = stripOuterParensTokens(arg0.tokens);
    const isLambda0 = stripped0[0]?.type === "Punct" && stripped0[0].value === "{";
    if (!isLambda0) {
      const looksLikeModifier = stripped0.some(
        (t) => t.type === "Identifier" && (t.value === "Modifier" || t.value === "modifier" || t.value === "animateContentSize")
      );
      if (looksLikeModifier) return arg0;
    }
    const arg1 = container.args[1];
    if (arg1 && arg1.name === null) {
      const stripped1 = stripOuterParensTokens(arg1.tokens);
      if (!(stripped1[0]?.type === "Punct" && stripped1[0].value === "{")) {
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
  const fallback = calls.find(
    (c) => c.name === "animateContentSize" && c.receiver && c.hasParens && tokens[c.nameTokIdx].start >= firstTok.start && tokens[c.endTokIdx].end <= lastTok.end
  ) || null;
  return { proven: null, candidate: fallback };
}
function findProvenAnimateContentSizeOnChain(tokens, calls, rawToks) {
  const topCall = findDirectTopLevelCall(tokens, calls, rawToks);
  if (!topCall || hasSafeCallInReceiverChain(tokens, topCall)) return null;
  const chainCalls = findModifierChainCalls(tokens, calls, topCall);
  for (const cc of chainCalls) {
    if (cc.name === "animateContentSize" && cc.receiver && cc.hasParens) {
      return cc;
    }
    if (cc.name === "then" && cc.receiver && cc.hasParens && cc.args.length === 1 && !cc.trailingLambda) {
      const nested = findProvenAnimateContentSizeOnChain(tokens, calls, cc.args[0].tokens);
      if (nested) return nested;
    }
  }
  return null;
}
var CARD_ELEVATION_FACTORY_NAMES = /* @__PURE__ */ new Set([
  "elevatedCardElevation",
  "cardElevation",
  "outlinedCardElevation"
]);
function isCardDefaultsOrUnqualifiedCall(tokens, call) {
  if (!call) return false;
  if (!call.receiver && call.chainRootIdx === call.nameTokIdx) return true;
  const prefix = tokens.slice(call.chainRootIdx, call.nameTokIdx);
  if (prefix.length < 2) return false;
  const isDotChain = prefix.every(
    (t, idx) => idx % 2 === 0 ? t.type === "Identifier" : t.type === "Punct" && t.value === "."
  );
  if (!isDotChain) return false;
  const lastReceiver = prefix[prefix.length - 2];
  return lastReceiver?.type === "Identifier" && lastReceiver.value === "CardDefaults";
}
function classifyContainerElevation(tokens, calls, container) {
  let elevArg = container.args.find((a) => a.name === "elevation" || a.name === "shadowElevation");
  if (!elevArg) {
    elevArg = container.args.find((a) => {
      if (a.name !== null) return false;
      const top = findDirectTopLevelCall(tokens, calls, a.tokens);
      return Boolean(top && CARD_ELEVATION_FACTORY_NAMES.has(top.name) && isCardDefaultsOrUnqualifiedCall(tokens, top));
    });
  }
  if (!elevArg) {
    return container.name === "ElevatedCard" ? "nonzero" : "zero";
  }
  let elevClass = classifyElevationExpr(tokens, calls, elevArg.tokens);
  if (elevClass === "nonzero") {
    const enabledArg = container.args.find((a) => a.name === "enabled");
    if (enabledArg) {
      const strippedEnabled = stripOuterParensTokens(enabledArg.tokens);
      const isLiteralTrue = strippedEnabled.length === 1 && strippedEnabled[0].type === "Keyword" && strippedEnabled[0].value === "true";
      if (!isLiteralTrue) {
        const topElevCall = findDirectTopLevelCall(tokens, calls, elevArg.tokens);
        const disabledArg = topElevCall ? getCallArg(topElevCall, "disabledElevation", 5) : null;
        if (disabledArg && classifyElevationExpr(tokens, calls, disabledArg.tokens) !== "nonzero") {
          elevClass = "unknown";
        }
      }
    }
  }
  return elevClass;
}
function classifyShadowCallElevation(tokens, calls, call) {
  if (!call.hasParens || call.args.length === 0) return "unknown";
  const elevArg = getCallArg(call, "elevation", 0);
  if (!elevArg) return "unknown";
  return classifyElevationExpr(tokens, calls, elevArg.tokens);
}
function isProvenAllSidesNonZeroPadding(tokens, calls, call) {
  if (!call.hasParens || call.args.length === 0) return false;
  const allArg = getCallArg(call, "all", 0);
  if (allArg && call.args.length === 1) {
    return classifyElevationExpr(tokens, calls, allArg.tokens) === "nonzero";
  }
  const hArg = call.args.find((a) => a.name === "horizontal");
  const vArg = call.args.find((a) => a.name === "vertical");
  if (hArg && vArg) {
    return classifyElevationExpr(tokens, calls, hArg.tokens) === "nonzero" && classifyElevationExpr(tokens, calls, vArg.tokens) === "nonzero";
  }
  const sideNames = ["start", "top", "end", "bottom"];
  if (sideNames.every((n) => call.args.some((a) => a.name === n))) {
    return sideNames.every((n) => {
      const arg = call.args.find((a) => a.name === n);
      return arg && classifyElevationExpr(tokens, calls, arg.tokens) === "nonzero";
    });
  }
  return false;
}
function parseKotlinNumericLiteral(numTok) {
  if (!numTok || numTok.type !== "NumberLiteral") return null;
  const raw = String(numTok.raw || "").replace(/_/g, "");
  if (!raw) return null;
  let cleaned = raw;
  if (/^0[xX][0-9a-fA-F]+[uUlL]*$/.test(raw) || /^0[bB][01]+[uUlL]*$/.test(raw)) {
    cleaned = raw.replace(/[uUlL]+$/, "");
  } else {
    cleaned = raw.replace(/[fFdDuUlL]+$/, "");
  }
  if (!cleaned) return null;
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : null;
}
function evalConstantDpExpr(tokens, calls, rawToks) {
  const stripped = stripOuterParensTokens(rawToks);
  if (stripped.length === 0) return null;
  let pDepth = 0;
  let bDepth = 0;
  let kDepth = 0;
  for (let i = stripped.length - 1; i >= 0; i -= 1) {
    const t = stripped[i];
    if (t.type === "Punct") {
      if (t.value === ")") pDepth += 1;
      else if (t.value === "(") pDepth = Math.max(0, pDepth - 1);
      else if (t.value === "}") bDepth += 1;
      else if (t.value === "{") bDepth = Math.max(0, bDepth - 1);
      else if (t.value === "]") kDepth += 1;
      else if (t.value === "[") kDepth = Math.max(0, kDepth - 1);
      else if (pDepth === 0 && bDepth === 0 && kDepth === 0 && i > 0 && (t.value === "+" || t.value === "-")) {
        const prev = stripped[i - 1];
        const isBinary = canTokenEndExpression(prev);
        if (isBinary) {
          const left = evalConstantDpExpr(tokens, calls, stripped.slice(0, i));
          const right = evalConstantDpExpr(tokens, calls, stripped.slice(i + 1));
          if (!left || !right || left.kind !== right.kind) return null;
          const value = t.value === "+" ? left.value + right.value : left.value - right.value;
          return Number.isFinite(value) ? { kind: left.kind, value } : null;
        }
      }
    }
  }
  pDepth = 0;
  bDepth = 0;
  kDepth = 0;
  for (let i = stripped.length - 1; i >= 0; i -= 1) {
    const t = stripped[i];
    if (t.type === "Punct") {
      if (t.value === ")") pDepth += 1;
      else if (t.value === "(") pDepth = Math.max(0, pDepth - 1);
      else if (t.value === "}") bDepth += 1;
      else if (t.value === "{") bDepth = Math.max(0, bDepth - 1);
      else if (t.value === "]") kDepth += 1;
      else if (t.value === "[") kDepth = Math.max(0, kDepth - 1);
      else if (pDepth === 0 && bDepth === 0 && kDepth === 0 && i > 0 && (t.value === "*" || t.value === "/")) {
        const left = evalConstantDpExpr(tokens, calls, stripped.slice(0, i));
        const right = evalConstantDpExpr(tokens, calls, stripped.slice(i + 1));
        if (!left || !right) return null;
        if (t.value === "*") {
          if (left.kind === "dp" && right.kind === "scalar") {
            const value = left.value * right.value;
            return Number.isFinite(value) ? { kind: "dp", value } : null;
          }
          if (left.kind === "scalar" && right.kind === "dp") {
            const value = left.value * right.value;
            return Number.isFinite(value) ? { kind: "dp", value } : null;
          }
          if (left.kind === "scalar" && right.kind === "scalar") {
            const value = left.value * right.value;
            return Number.isFinite(value) ? { kind: "scalar", value } : null;
          }
          return null;
        }
        if (t.value === "/" && right.kind === "scalar" && right.value !== 0) {
          const value = left.value / right.value;
          return Number.isFinite(value) ? { kind: left.kind, value } : null;
        }
        return null;
      }
    }
  }
  if (stripped.length >= 2 && stripped[0].type === "Punct" && (stripped[0].value === "+" || stripped[0].value === "-")) {
    const inner = evalConstantDpExpr(tokens, calls, stripped.slice(1));
    if (!inner) return null;
    const value = stripped[0].value === "-" ? -inner.value : inner.value;
    return Number.isFinite(value) ? { kind: inner.kind, value } : null;
  }
  if (stripped.length === 1 && stripped[0].type === "NumberLiteral") {
    const val = parseKotlinNumericLiteral(stripped[0]);
    return val !== null ? { kind: "scalar", value: val } : null;
  }
  if (stripped.length === 3 && stripped[0].type === "NumberLiteral" && stripped[1].type === "Punct" && stripped[1].value === "." && stripped[2].type === "Identifier" && stripped[2].value === "dp") {
    const val = parseKotlinNumericLiteral(stripped[0]);
    return val !== null ? { kind: "dp", value: val } : null;
  }
  if (stripped.length === 3 && stripped[0].type === "Identifier" && stripped[0].value === "Dp" && stripped[1].type === "Punct" && stripped[1].value === "." && stripped[2].type === "Identifier") {
    if (stripped[2].value === "Zero" || stripped[2].value === "Unspecified" || stripped[2].value === "Hairline") {
      return { kind: "dp", value: 0 };
    }
  }
  const topCall = findDirectTopLevelCall(tokens, calls, stripped);
  if (topCall && topCall.name === "Dp" && isTopLevelOrAndroidxQualifiedCall(tokens, topCall) && topCall.hasParens && !topCall.trailingLambda && topCall.args.length === 1 && topCall.args[0].name === null) {
    const inner = evalConstantDpExpr(tokens, calls, topCall.args[0].tokens);
    if (inner?.kind === "scalar") {
      return { kind: "dp", value: inner.value };
    }
  }
  return null;
}
function classifyElevationExpr(tokens, calls, rawToks) {
  const stripped = stripOuterParensTokens(rawToks);
  if (stripped.length === 0) return "unknown";
  const constEval = evalConstantDpExpr(tokens, calls, stripped);
  if (constEval?.kind === "dp") {
    return constEval.value > 0 ? "nonzero" : "zero";
  }
  const topCall = findDirectTopLevelCall(tokens, calls, stripped);
  if (topCall && topCall.hasParens && !topCall.trailingLambda && CARD_ELEVATION_FACTORY_NAMES.has(topCall.name) && isCardDefaultsOrUnqualifiedCall(tokens, topCall)) {
    const defArg = getCallArg(topCall, "defaultElevation", 0);
    const defaultFallback = topCall.name === "elevatedCardElevation" ? "nonzero" : "zero";
    const defClass = defArg ? classifyElevationExpr(tokens, calls, defArg.tokens) : defaultFallback;
    if (defClass === "zero") {
      const anyInteractiveNonZeroOrUnknown = topCall.args.some(
        (a) => a !== defArg && classifyElevationExpr(tokens, calls, a.tokens) !== "zero"
      );
      return anyInteractiveNonZeroOrUnknown ? "unknown" : "zero";
    }
    return defClass;
  }
  return "unknown";
}
function findModifierChainCalls(tokens, calls, memberCall) {
  const rootIdx = memberCall.chainRootIdx;
  return calls.filter((c) => c.chainRootIdx === rootIdx).sort((a, b) => a.nameTokIdx - b.nameTokIdx);
}
function isNonAndroidxNavSymbol(kf, symbolName) {
  if (kf.declarations.some((d) => d.kind === "fun" && d.name === symbolName)) {
    return true;
  }
  const imports = kf.imports || [];
  if (imports.length === 0) return false;
  return !imports.some(
    (imp) => imp.startsWith("androidx.navigation.") || imp.startsWith("androidx.navigation3.")
  );
}
function checkT001(kf, conventionContext, fileMotionMd, rawFindings, rawCandidates) {
  for (const c of kf.calls) {
    if (c.name === "NavHost" && c.hasParens && c.trailingLambda && c.args.length >= 2) {
      if (isNonAndroidxNavSymbol(kf, "NavHost")) continue;
      const enterArg = getCallArg(c, "enterTransition", 5);
      const exitArg = getCallArg(c, "exitTransition", 6);
      const hasEnter = Boolean(enterArg && enterArg.text !== "null");
      const hasExit = Boolean(exitArg && exitArg.text !== "null");
      if (!hasEnter || !hasExit) {
        const hasEstablishedConvention = conventionContext.hasMotionTokens || Boolean(fileMotionMd && (fileMotionMd.definesNavigationTransitions || fileMotionMd.specs.length > 0));
        const severity = hasEstablishedConvention ? "major" : "minor";
        const severityBasis = hasEstablishedConvention ? "motion-tokens-or-contract-present" : "no-established-convention-in-scanned-set";
        const missing = !hasEnter && !hasExit ? "`enterTransition` and `exitTransition`" : !hasEnter ? "`enterTransition`" : "`exitTransition`";
        const inlineComposables = kf.calls.filter(
          (inner) => inner.name === "composable" && (inner.hasParens || Boolean(inner.trailingLambda)) && inner.nameTokIdx > c.trailingLambda.openBraceIdx && inner.endTokIdx < c.trailingLambda.closeBraceIdx
        );
        const hasPerDestinationOverride = inlineComposables.some(
          (inner) => inner.hasParens && inner.args.some((a) => (a.name === "enterTransition" || a.name === "exitTransition") && a.text !== "null")
        );
        const directBuilderCalls = kf.calls.filter(
          (inner) => inner !== c && inner.nameTokIdx > c.trailingLambda.openBraceIdx && inner.endTokIdx < c.trailingLambda.closeBraceIdx && inner.enclosingCalls[inner.enclosingCalls.length - 1] === c
        );
        const delegatesOnlyToSubgraphBuilders = inlineComposables.length === 0 && directBuilderCalls.length > 0;
        if ((hasPerDestinationOverride || delegatesOnlyToSubgraphBuilders) && rawCandidates) {
          rawCandidates.push(
            makeRuleCandidate("T-001", {
              file: kf.filePath,
              lines: [c.startLine, c.endLine],
              severity,
              evidence: hasPerDestinationOverride ? `\`NavHost\` omits host-level ${missing}; one or more inner \`composable(...)\` destinations supply per-route transitions.` : `\`NavHost\` omits host-level ${missing} and delegates route registration to subgraph builder call(s) (${directBuilderCalls.map((dc) => dc.name).join(", ")}).`,
              verificationHint: "Check whether every destination in this `NavHost` supplies explicit transitions or whether unconfigured routes still inherit the 700ms default crossfade."
            })
          );
          continue;
        }
        rawFindings.push(
          makeRuleFinding("T-001", {
            file: kf.filePath,
            lines: [c.startLine, c.endLine],
            severity,
            severityBasis,
            evidence: `\`NavHost\` omits ${missing} and inherits the 700ms default crossfade.`,
            remediation: "Specify explicit `enterTransition`, `exitTransition`, `popEnterTransition`, and `popExitTransition` bound to `MaterialTheme.motionScheme` or your project's `MOTION.md` specs.",
            symbolContext: c.enclosingDeclarations.map((d) => d.name)
          })
        );
      }
    } else if (c.name === "NavDisplay" && c.hasParens) {
      if (isNonAndroidxNavSymbol(kf, "NavDisplay")) continue;
      const specArg = getCallArg(c, "transitionSpec", 7);
      const hasSpec = Boolean(specArg && specArg.text !== "null");
      if (!hasSpec) {
        const hasEstablishedConvention = conventionContext.hasMotionTokens || Boolean(fileMotionMd && (fileMotionMd.definesNavigationTransitions || fileMotionMd.specs.length > 0));
        const severity = hasEstablishedConvention ? "major" : "minor";
        const severityBasis = hasEstablishedConvention ? "motion-tokens-or-contract-present" : "no-established-convention-in-scanned-set";
        const hasPerEntryTransitionSpec = kf.calls.some(
          (inner) => inner !== c && (inner.name === "transitionSpec" || inner.name === "popTransitionSpec" || inner.name === "predictivePopTransitionSpec") && inner.nameTokIdx > c.nameTokIdx && inner.endTokIdx <= c.endTokIdx
        );
        const entryProviderArg = c.args.find((a) => a.name === "entryProvider");
        const hasExternalEntryProvider = !c.trailingLambda && Boolean(entryProviderArg && !entryProviderArg.tokens.some((t) => t.value === "{"));
        if ((hasPerEntryTransitionSpec || hasExternalEntryProvider) && rawCandidates) {
          rawCandidates.push(
            makeRuleCandidate("T-001", {
              file: kf.filePath,
              lines: [c.startLine, c.endLine],
              severity,
              evidence: hasPerEntryTransitionSpec ? "Navigation 3 `NavDisplay` omits top-level `transitionSpec`, while inner entry metadata defines per-entry `transitionSpec`." : "Navigation 3 `NavDisplay` omits top-level `transitionSpec` and delegates entries to an external `entryProvider`.",
              verificationHint: "Check whether every destination entry overrides `NavDisplay.transitionSpec` or whether unconfigured entries still inherit the library default transition."
            })
          );
          continue;
        }
        rawFindings.push(
          makeRuleFinding("T-001", {
            file: kf.filePath,
            lines: [c.startLine, c.endLine],
            severity,
            severityBasis,
            evidence: "Navigation 3 `NavDisplay` omits `transitionSpec` and falls back to the library default transition.",
            remediation: "Pass an explicit `transitionSpec` (and `popTransitionSpec` / `predictivePopTransitionSpec` where needed) resolved from `MaterialTheme.motionScheme` or your project's motion tokens.",
            symbolContext: c.enclosingDeclarations.map((d) => d.name)
          })
        );
      }
    }
  }
}
function checkT002(kf, conventionContext, fileMotionMd, rawFindings) {
  for (const c of kf.calls) {
    if (!SPEC_LITERAL_NAMES.has(c.name) || !c.hasParens) continue;
    if (c.receiver && c.receiver !== "core") continue;
    if (isExemptSpecDefinitionSite(kf, c)) continue;
    const hasEstablishedConvention = conventionContext.hasMotionTokens || Boolean(fileMotionMd && fileMotionMd.specs.length > 0);
    const severity = hasEstablishedConvention ? "major" : "minor";
    const severityBasis = hasEstablishedConvention ? "motion-tokens-or-contract-present" : "no-established-convention-in-scanned-set";
    const nearestAnimConsumer = [...c.enclosingCalls].reverse().find((ec) => ANIMATION_CONSUMER_CALLS.has(ec.name) && ec.headerEndLine - ec.startLine <= 12);
    const span = nearestAnimConsumer ? [nearestAnimConsumer.startLine, nearestAnimConsumer.headerEndLine] : [c.startLine, c.headerEndLine];
    rawFindings.push(
      makeRuleFinding("T-002", {
        file: kf.filePath,
        lines: span,
        severity,
        severityBasis,
        evidence: `Inline \`${c.snippet}\` spec literal at call site (line ${c.startLine}).`,
        remediation: "Replace the inline spec literal with a `MaterialTheme.motionScheme` spec (`defaultSpatialSpec()`, `defaultEffectsSpec()`, etc.) or a named project token defined in one shared motion object.",
        symbolContext: c.enclosingDeclarations.map((d) => d.name)
      })
    );
  }
}
var SPEC_BUILDER_WRAPPERS = /* @__PURE__ */ new Set([
  "repeatable",
  "infiniteRepeatable",
  "fadeIn",
  "fadeOut",
  "slideIn",
  "slideOut",
  "slideInHorizontally",
  "slideOutHorizontally",
  "slideInVertically",
  "slideOutVertically",
  "scaleIn",
  "scaleOut",
  "expandIn",
  "shrinkOut",
  "expandHorizontally",
  "shrinkHorizontally",
  "expandVertically",
  "shrinkVertically",
  "togetherWith",
  "SizeTransform"
]);
function isExemptSpecDefinitionSite(kf, specCall) {
  if (specCall.enclosingCalls.some((ec) => ANIMATION_CONSUMER_CALLS.has(ec.name) && !SPEC_BUILDER_WRAPPERS.has(ec.name))) {
    return false;
  }
  const innermostDecl = [...specCall.enclosingDeclarations].reverse().find((d) => d.kind === "val" || d.kind === "var" || d.kind === "fun");
  if (!innermostDecl) return false;
  if (innermostDecl.isComposable) return false;
  if (specCall.enclosingDeclarations.some((d) => d.kind === "fun" && d.isComposable)) {
    return false;
  }
  if ((innermostDecl.kind === "val" || innermostDecl.kind === "var") && innermostDecl.rhsStartIdx !== -1) {
    return specCall.nameTokIdx >= innermostDecl.rhsStartIdx && specCall.endTokIdx <= innermostDecl.endTokIdx;
  }
  if (innermostDecl.kind === "fun" && innermostDecl.isExpressionBody && innermostDecl.rhsStartIdx !== -1) {
    return specCall.nameTokIdx >= innermostDecl.rhsStartIdx && specCall.endTokIdx <= innermostDecl.endTokIdx;
  }
  if (innermostDecl.kind === "fun" && !innermostDecl.isExpressionBody) {
    if (innermostDecl.paramRange && specCall.nameTokIdx > innermostDecl.paramRange[0] && specCall.endTokIdx < innermostDecl.paramRange[1]) {
      return true;
    }
    const enclosingInFun = specCall.enclosingCalls.filter(
      (ec) => ec.nameTokIdx > innermostDecl.startTokIdx
    );
    if (enclosingInFun.every((ec) => SPEC_BUILDER_WRAPPERS.has(ec.name) || ec.name === "lazy")) {
      return true;
    }
  }
  return false;
}
function checkCandidatesMisc(kf, rawCandidates) {
  const { calls, tokens, declarations } = kf;
  const animGatingVars = /* @__PURE__ */ new Set();
  for (const fn of declarations.filter((d) => d.kind === "fun" && d.isComposable)) {
    const localVars = declarations.filter(
      (d) => d.kind === "var" && d.startTokIdx > fn.startTokIdx && d.endTokIdx <= fn.endTokIdx
    );
    const fnCalls = calls.filter((c) => c.nameTokIdx > fn.startTokIdx && c.endTokIdx <= fn.endTokIdx);
    const hasSuspendAnim = fnCalls.some((c) => c.name === "animateTo" || c.name === "animateDecay");
    if (hasSuspendAnim) {
      for (const lv of localVars) {
        for (const lc of fnCalls) {
          if (lc.trailingLambda && (lc.name === "launch" || lc.name === "LaunchedEffect")) {
            const bToks = lc.trailingLambda.bodyTokens;
            const hasAnimInBlock = fnCalls.some(
              (ac) => (ac.name === "animateTo" || ac.name === "animateDecay") && ac.nameTokIdx > lc.trailingLambda.openBraceIdx && ac.endTokIdx < lc.trailingLambda.closeBraceIdx
            );
            const assignsVar = bToks.some(
              (bt, idx) => bt.type === "Identifier" && bt.value === lv.name && isUnqualifiedLocalIdent(bToks, idx) && bToks[idx + 1]?.value === "="
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
    if (c.name === "sharedElement" || c.name === "sharedBounds") {
      const container = [...c.enclosingCalls].reverse().find((ec) => VIEW_BACKED_CONTAINERS.has(ec.name));
      if (container) {
        rawCandidates.push(
          makeRuleCandidate("F-004", {
            file: kf.filePath,
            lines: [container.startLine, container.endLine],
            evidence: `\`${c.name}\` (line ${c.startLine}) is used inside View/window-backed \`${container.name}\`.`,
            verificationHint: "Confirm whether the other shared-element endpoint lives in the parent window; `sharedElement`/`sharedBounds` cannot animate across separate platform windows (`Dialog`, `ModalBottomSheet`, `Popup`, `AndroidView`)."
          })
        );
      }
    }
    if (c.name === "infiniteRepeatable" || c.name === "basicMarquee") {
      const chainCalls = c.receiver ? findModifierChainCalls(tokens, calls, c) : [];
      const hasClickableOnChain = chainCalls.some((cc) => cc.name === "clickable" || cc.name === "combinedClickable" || cc.name === "toggleable");
      rawCandidates.push(
        makeRuleCandidate("O-003", {
          file: kf.filePath,
          lines: [c.startLine, c.endLine],
          evidence: `Endless animation API \`${c.name}\` detected${hasClickableOnChain ? " (with clickable modifier on chain)" : " (no clickable pause modifier on chain)"}.`,
          verificationHint: "Check whether this endless animation is decorative/informational and runs >5s without an essential real-time state role (e.g. active loading spinner), and if so whether the user has a direct pause/stop control."
        })
      );
    }
    if (c.name === "BackHandler" && c.trailingLambda) {
      rawCandidates.push(
        makeRuleCandidate("T-008", {
          file: kf.filePath,
          lines: [c.startLine, c.endLine],
          evidence: "Non-seekable `BackHandler` intercepts system back.",
          verificationHint: "Check whether `BackHandler` dismisses an animated surface/overlay that could support predictive back gesture progress via `PredictiveBackHandler` or `NavigationBackHandler`, or whether instant state dismissal is appropriate."
        })
      );
    }
    if (c.hasParens) {
      const enabledArg = c.args.find((a) => a.name === "enabled");
      if (enabledArg) {
        const matchesBuiltin = /(\bisRunning\b|\bisAnimating\b|\bisTransitioning\b)/.test(enabledArg.text);
        const matchesGatingVar = enabledArg.tokens.some(
          (t, idx) => t.type === "Identifier" && isUnqualifiedLocalIdent(enabledArg.tokens, idx) && animGatingVars.has(t.value)
        );
        if (matchesBuiltin || matchesGatingVar) {
          rawCandidates.push(
            makeRuleCandidate("T-012", {
              file: kf.filePath,
              lines: [c.startLine, c.endLine],
              evidence: `\`${c.name}(..., enabled = ${enabledArg.text})\` gates user input on animation completion.`,
              verificationHint: "Verify whether disabling input during motion prevents normal interruption/retargeting (violating T-012) or protects a non-idempotent destructive commit."
            })
          );
        }
      }
    }
  }
  for (let i = 0; i + 2 < tokens.length; i += 1) {
    if (tokens[i].value === "LottieConstants" && tokens[i + 1].value === "." && tokens[i + 2].value === "IterateForever") {
      rawCandidates.push(
        makeRuleCandidate("O-003", {
          file: kf.filePath,
          lines: [tokens[i].line, tokens[i + 2].endLine],
          evidence: "`LottieConstants.IterateForever` runs indefinitely.",
          verificationHint: "Verify whether the user has a pause/stop control if this animation is not an indeterminate loading indicator."
        })
      );
    }
  }
  for (let i = 0; i + 2 < tokens.length; i += 1) {
    if ((tokens[i].value === "LocalOverscrollFactory" || tokens[i].value === "LocalOverscrollConfiguration") && tokens[i + 1].value === "provides" && tokens[i + 2].value === "null") {
      rawCandidates.push(
        makeRuleCandidate("T-018", {
          file: kf.filePath,
          lines: [tokens[i].line, tokens[i + 2].endLine],
          evidence: `\`${tokens[i].value} provides null\` disables platform stretch overscroll.`,
          verificationHint: "Check scope: disabling overscroll app-wide violates T-018, whereas scoping it locally around a looping pager or custom gesture replacement is compliant."
        })
      );
    }
  }
  for (const c of calls) {
    const overArg = c.args?.find((a) => a.name === "overscrollEffect" && a.text === "null");
    if (overArg) {
      rawCandidates.push(
        makeRuleCandidate("T-018", {
          file: kf.filePath,
          lines: [c.startLine, c.headerEndLine],
          evidence: `\`${c.name}(..., overscrollEffect = null)\` disables platform overscroll.`,
          verificationHint: "Verify whether a custom gesture or looping pager deliberately replaces platform overscroll here."
        })
      );
    }
  }
}
var NON_MODIFIER_RETURN_MEMBERS = /* @__PURE__ */ new Set([
  "let",
  "run",
  "with",
  "toString",
  "hashCode",
  "equals"
]);
function isModifierTypeTokens(typeToks) {
  const clean = [];
  for (let i = 0; i < typeToks.length; i += 1) {
    const t = typeToks[i];
    if (t.type === "Annotation") {
      if (typeToks[i + 1]?.type === "Punct" && typeToks[i + 1].value === "(") {
        const closeP = findMatchingForward(typeToks, i + 1, "(", ")");
        if (closeP !== -1) i = closeP;
      }
      continue;
    }
    clean.push(t);
  }
  if (clean.length === 0 || clean.length % 2 === 0) return false;
  for (let i = 0; i < clean.length; i += 1) {
    if (i % 2 === 0) {
      if (clean[i].type !== "Identifier") return false;
    } else if (clean[i].type !== "Punct" || clean[i].value !== ".") {
      return false;
    }
  }
  const last = clean[clean.length - 1];
  const pkgPrefix = clean.slice(0, -1).map((t) => t.value).join("");
  return last.value === "Modifier" && (pkgPrefix === "" || pkgPrefix === "androidx.compose.ui.");
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
    if (t.type === "Punct") {
      if (t.value === "(") pDepth += 1;
      else if (t.value === ")") pDepth = Math.max(0, pDepth - 1);
      else if (t.value === "{") bDepth += 1;
      else if (t.value === "}") bDepth = Math.max(0, bDepth - 1);
      else if (t.value === "[") kDepth += 1;
      else if (t.value === "]") kDepth = Math.max(0, kDepth - 1);
      else if (pDepth === 0 && bDepth === 0 && kDepth === 0) {
        if (t.value === ":" && !inType) {
          inType = true;
          tDepth = 0;
        } else if (t.value === "=" && inType && tDepth === 0) {
          inType = false;
        } else if (inType && t.value === "<") {
          tDepth += 1;
        } else if (inType && t.value === ">") {
          tDepth = Math.max(0, tDepth - 1);
        } else if (t.value === "," && !(inType && tDepth > 0)) {
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
      if (t.type === "Punct") {
        if (t.value === "(") pd += 1;
        else if (t.value === ")") pd = Math.max(0, pd - 1);
        else if (t.value === "{") bd += 1;
        else if (t.value === "}") bd = Math.max(0, bd - 1);
        else if (t.value === "[") kd += 1;
        else if (t.value === "]") kd = Math.max(0, kd - 1);
        else if (pd === 0 && bd === 0 && kd === 0) {
          if (t.value === ":" && colonIdx === -1) {
            colonIdx = i;
          } else if (colonIdx !== -1 && eqIdx === -1 && t.value === "<") {
            td += 1;
          } else if (colonIdx !== -1 && eqIdx === -1 && t.value === ">") {
            td = Math.max(0, td - 1);
          } else if (colonIdx !== -1 && eqIdx === -1 && td === 0 && t.value === "=") {
            eqIdx = i;
            break;
          }
        }
      }
    }
    if (colonIdx > 0 && paramToks[colonIdx - 1]?.type === "Identifier") {
      const paramName = paramToks[colonIdx - 1].value;
      const typeToks = paramToks.slice(colonIdx + 1, eqIdx === -1 ? paramToks.length : eqIdx);
      scopedBindings.push({
        name: paramName,
        kind: isModifierTypeTokens(typeToks) ? "modifier" : "other",
        declStartIdx: openP,
        declEndIdx: closeP,
        scopeStartIdx: fn.startTokIdx,
        scopeEndIdx: fn.endTokIdx
      });
    }
  }
}
function isProvenModifierExprTokens(toks, atTokIdx, scopedBindings) {
  if (!Array.isArray(toks) || toks.length === 0) return false;
  let cursor = 0;
  if (toks.length >= 7 && toks[0]?.type === "Identifier" && toks[0].value === "androidx" && toks[1]?.value === "." && toks[2]?.type === "Identifier" && toks[2].value === "compose" && toks[3]?.value === "." && toks[4]?.type === "Identifier" && toks[4].value === "ui" && toks[5]?.value === "." && toks[6]?.type === "Identifier" && toks[6].value === "Modifier") {
    cursor = 7;
  } else if (toks[0]?.type === "Identifier" && isUnqualifiedLocalIdent(toks, 0)) {
    if (toks[0].value === "Modifier") {
      cursor = 1;
    } else {
      const binding = resolveScopedBinding(toks[0].value, atTokIdx, scopedBindings);
      if (binding && binding.kind === "modifier") {
        cursor = 1;
      } else {
        return false;
      }
    }
  } else {
    return false;
  }
  while (cursor < toks.length) {
    if (toks[cursor]?.type !== "Punct" || toks[cursor].value !== ".") {
      return false;
    }
    cursor += 1;
    const member = toks[cursor];
    if (!member || member.type !== "Identifier" || NON_MODIFIER_RETURN_MEMBERS.has(member.value)) {
      return false;
    }
    cursor += 1;
    if (toks[cursor]?.type === "Punct" && toks[cursor].value === "<") {
      const closeAngle = findMatchingForward(toks, cursor, "<", ">");
      if (closeAngle === -1) return false;
      cursor = closeAngle + 1;
    }
    if (toks[cursor]?.type === "Punct" && toks[cursor].value === "(") {
      const closeParen = findMatchingForward(toks, cursor, "(", ")");
      if (closeParen === -1) return false;
      cursor = closeParen + 1;
    }
    if (toks[cursor]?.type === "Punct" && toks[cursor].value === "{") {
      const closeBrace = findMatchingForward(toks, cursor, "{", "}");
      if (closeBrace === -1) return false;
      cursor = closeBrace + 1;
    }
  }
  return true;
}
function unwrapZeroArgLambdaTokens(toks) {
  if (toks.length >= 2 && toks[0].type === "Punct" && toks[0].value === "{" && toks[toks.length - 1].type === "Punct" && toks[toks.length - 1].value === "}" && findMatchingForward(toks, 0, "{", "}") === toks.length - 1) {
    const inner = toks.slice(1, -1);
    if (inner[0]?.type === "Punct" && inner[0].value === "->") {
      return inner.slice(1);
    }
    return inner;
  }
  return toks;
}
function getLottieOverloadArg(call, paramName, positionalSlot = null, allowPositional = false) {
  const named = call.args.find((a) => a.name === paramName);
  if (named) return named;
  if (allowPositional && positionalSlot !== null && call.args.length > positionalSlot && call.args[positionalSlot].name === null && (call.args[0]?.name === null || call.args[0]?.name === "composition") && call.args.slice(1, positionalSlot).every((a) => a.name === null)) {
    return call.args[positionalSlot];
  }
  return null;
}
function classifyLottieSpeedExpr(exprTokens, rawText, atTokIdx, scopedBindings, depth = 0, visited = null) {
  if (!Array.isArray(exprTokens) || exprTokens.length === 0 || depth > 4) {
    return "unknown";
  }
  let toks = exprTokens;
  while (toks.length >= 2 && toks[0].type === "Punct" && toks[0].value === "(" && toks[toks.length - 1].type === "Punct" && toks[toks.length - 1].value === ")" && findMatchingForward(toks, 0, "(", ")") === toks.length - 1) {
    toks = toks.slice(1, -1);
  }
  if (toks.length === 0) return "unknown";
  if (toks[0].type === "Punct" && (toks[0].value === "-" || toks[0].value === "+")) {
    const sign = toks[0].value;
    const innerClass = classifyLottieSpeedExpr(toks.slice(1), "", atTokIdx, scopedBindings, depth + 1, visited);
    if (sign === "+") return innerClass;
    if (innerClass === "positive") return "negative";
    if (innerClass === "negative") return "positive";
    return innerClass;
  }
  if (toks.length === 1 && toks[0].type === "NumberLiteral") {
    const m = toks[0].value.match(/^([0-9]+(?:\.[0-9]+)?)[fF]?$/);
    if (!m) return "unknown";
    const val = Number(m[1]);
    if (Number.isNaN(val)) return "unknown";
    return val === 0 ? "zero" : "positive";
  }
  if (toks.length === 1 && toks[0].type === "Identifier" && isUnqualifiedLocalIdent(toks, 0)) {
    const binding = resolveScopedBinding(toks[0].value, atTokIdx, scopedBindings);
    if (binding?.kind === "local-val" && Array.isArray(binding.rhsTokens)) {
      const seen = visited || /* @__PURE__ */ new Set();
      if (seen.has(binding)) return "unknown";
      const nextSeen = new Set(seen);
      nextSeen.add(binding);
      return classifyLottieSpeedExpr(
        binding.rhsTokens,
        binding.rhsText || "",
        binding.rhsEvalAtIdx ?? binding.declStartIdx,
        scopedBindings,
        depth + 1,
        nextSeen
      );
    }
  }
  void rawText;
  return "unknown";
}
function isUnqualifiedOrLottieQualifiedCall(tokens, call) {
  if (!call) return false;
  if (!call.receiver && call.chainRootIdx === call.nameTokIdx) return true;
  const prefix = tokens.slice(call.chainRootIdx, call.nameTokIdx);
  if (prefix.length < 2 || prefix[0].type !== "Identifier" || prefix[0].value !== "com") {
    return false;
  }
  return prefix.every(
    (t, idx) => idx % 2 === 0 ? t.type === "Identifier" : t.type === "Punct" && t.value === "."
  );
}
function extractDirectLottieAnimStateInit(tokens, calls, ld, fn) {
  if (isLocalVarReassignedInFn(tokens, ld, fn)) return null;
  if (ld.delegateIdx >= 0 && ld.delegateIdx <= ld.endTokIdx) {
    const delToks = stripOuterParensTokens(tokens.slice(ld.delegateIdx, ld.endTokIdx + 1));
    const topCall = findDirectTopLevelCall(tokens, calls, delToks);
    if (topCall && topCall.name === "animateLottieCompositionAsState" && topCall.hasParens && !topCall.trailingLambda && isUnqualifiedOrLottieQualifiedCall(tokens, topCall)) {
      return { call: topCall, valueKind: "float" };
    }
    return null;
  }
  if (ld.rhsStartIdx >= 0 && ld.rhsStartIdx <= ld.endTokIdx) {
    const rhsToks = stripOuterParensTokens(tokens.slice(ld.rhsStartIdx, ld.endTokIdx + 1));
    const topCall = findDirectTopLevelCall(tokens, calls, rhsToks);
    if (topCall && topCall.name === "animateLottieCompositionAsState" && topCall.hasParens && !topCall.trailingLambda && isUnqualifiedOrLottieQualifiedCall(tokens, topCall)) {
      return { call: topCall, valueKind: "state" };
    }
    if (rhsToks.length >= 4 && rhsToks[rhsToks.length - 2].type === "Punct" && rhsToks[rhsToks.length - 2].value === "." && rhsToks[rhsToks.length - 1].type === "Identifier" && (rhsToks[rhsToks.length - 1].value === "progress" || rhsToks[rhsToks.length - 1].value === "value")) {
      const prefixCall = findDirectTopLevelCall(tokens, calls, rhsToks.slice(0, -2));
      if (prefixCall && prefixCall.name === "animateLottieCompositionAsState" && prefixCall.hasParens && !prefixCall.trailingLambda && isUnqualifiedOrLottieQualifiedCall(tokens, prefixCall)) {
        return { call: prefixCall, valueKind: "float" };
      }
    }
  }
  return null;
}
function resolveLottieProgressExpr(progressTokens, progressText, atTokIdx, scopedBindings) {
  const strippedOuter = stripOuterParensTokens(progressTokens);
  const inner = stripOuterParensTokens(unwrapZeroArgLambdaTokens(strippedOuter));
  let varName = null;
  const isBareVar = inner.length === 1 && inner[0].type === "Identifier";
  const isStateMember = inner.length === 3 && inner[0].type === "Identifier" && inner[1].type === "Punct" && (inner[1].value === "." || inner[1].value === "::") && inner[2].type === "Identifier" && (inner[2].value === "progress" || inner[2].value === "value");
  if (isBareVar || isStateMember) {
    varName = inner[0].value;
  }
  if (varName) {
    const binding = resolveScopedBinding(varName, atTokIdx, scopedBindings);
    if (binding?.kind === "lottie-anim-state" && binding.animStateMeta) {
      const vk = binding.animStateMeta.valueKind;
      const matchesShape = vk === "float" && isBareVar || vk === "state" && isStateMember;
      if (matchesShape) {
        return {
          progressKind: binding.animStateMeta.hasUnknownPlayback ? "custom-progress" : "animated-state",
          hasClipSpec: binding.animStateMeta.hasClipSpec,
          isNegativeSpeed: binding.animStateMeta.isNegativeSpeed,
          hasUnknownPlayback: Boolean(binding.animStateMeta.hasUnknownPlayback)
        };
      }
      return {
        progressKind: "custom-progress",
        hasClipSpec: false,
        isNegativeSpeed: false,
        hasUnknownPlayback: false
      };
    }
    if (isBareVar && binding?.kind === "local-val" && typeof binding.rhsText === "string") {
      return {
        progressKind: classifyExplicitLottieProgress(binding.rhsText),
        hasClipSpec: false,
        isNegativeSpeed: false,
        hasUnknownPlayback: false
      };
    }
  }
  return {
    progressKind: classifyExplicitLottieProgress(progressText),
    hasClipSpec: false,
    isNegativeSpeed: false,
    hasUnknownPlayback: false
  };
}
function findImmediatelyEnclosingDelimiter(tokens, atIdx, openSym, closeSym) {
  let depth = 0;
  for (let i = atIdx - 1; i >= 0; i -= 1) {
    const t = tokens[i];
    if (t.type === "Punct") {
      if (t.value === closeSym) depth += 1;
      else if (t.value === openSym) {
        if (depth === 0) return i;
        depth -= 1;
      }
    }
  }
  return -1;
}
function computeOuterValScope(tokens, declarations, d) {
  const enclosingDecls = declarations.filter((other) => other !== d && other.startTokIdx <= d.startTokIdx && other.endTokIdx >= d.endTokIdx).sort((a, b) => a.startTokIdx - b.startTokIdx);
  if (enclosingDecls.some((ed) => ed.kind === "fun" || ed.kind === "val" || ed.kind === "var")) {
    return null;
  }
  const enclOpenBrace = findImmediatelyEnclosingDelimiter(tokens, d.startTokIdx, "{", "}");
  const enclOpenParen = findImmediatelyEnclosingDelimiter(tokens, d.startTokIdx, "(", ")");
  if (enclosingDecls.length === 0) {
    if (enclOpenBrace !== -1 || enclOpenParen !== -1) return null;
    return {
      scopeStartIdx: -1,
      scopeEndIdx: tokens.length - 1,
      declStartIdx: -2,
      declEndIdx: -2
    };
  }
  if (!enclosingDecls.every(
    (ed) => ed.kind === "class" || ed.kind === "object" || ed.kind === "companion" || ed.kind === "interface"
  )) {
    return null;
  }
  const innerType = enclosingDecls[enclosingDecls.length - 1];
  const isDirectBodyMember = innerType.bodyOpenIdx !== -1 && enclOpenBrace === innerType.bodyOpenIdx && enclOpenParen < innerType.bodyOpenIdx;
  const isPrimaryCtorProp = Boolean(innerType.paramRange) && d.startTokIdx > innerType.paramRange[0] && d.endTokIdx < innerType.paramRange[1] && enclOpenParen === innerType.paramRange[0] && enclOpenBrace < innerType.startTokIdx;
  if (!isDirectBodyMember && !isPrimaryCtorProp) {
    return null;
  }
  const ownerType = innerType.kind === "companion" && enclosingDecls.length >= 2 ? enclosingDecls[enclosingDecls.length - 2] : innerType;
  return {
    scopeStartIdx: ownerType.startTokIdx,
    scopeEndIdx: ownerType.endTokIdx,
    declStartIdx: ownerType.startTokIdx - 1,
    declEndIdx: ownerType.startTokIdx - 1
  };
}
function collectLottieConsumers(kf, scaleHelpers, outConsumers) {
  const { declarations, calls, tokens } = kf;
  const composableFuns = declarations.filter((d) => d.kind === "fun" && d.isComposable);
  const outerValBindings = [];
  const outerCandidates = [];
  const outerDecls = declarations.filter((d) => (d.kind === "val" || d.kind === "var") && (d.rhsStartIdx >= 0 || d.delegateIdx >= 0)).sort((a, b) => a.startTokIdx - b.startTokIdx);
  for (const d of outerDecls) {
    const scopeInfo = computeOuterValScope(tokens, declarations, d);
    if (!scopeInfo) continue;
    const exprStart = d.rhsStartIdx >= 0 ? d.rhsStartIdx : d.delegateIdx;
    if (exprStart < 0 || exprStart > d.endTokIdx) continue;
    outerCandidates.push({ decl: d, scopeInfo, exprToks: tokens.slice(exprStart, d.endTokIdx + 1) });
  }
  const createdEntries = [];
  for (const item of outerCandidates) {
    const { decl: d, scopeInfo, exprToks } = item;
    if (d.kind === "val" && d.delegateIdx === -1 && d.rhsStartIdx >= 0) {
      const entry = {
        name: d.name,
        kind: "local-val",
        assetSelection: null,
        animStateMeta: null,
        rhsTokens: exprToks,
        rhsText: kf.source.slice(tokens[d.rhsStartIdx].start, tokens[d.endTokIdx].end).trim(),
        rhsEvalAtIdx: d.startTokIdx,
        declStartIdx: scopeInfo.declStartIdx,
        declEndIdx: scopeInfo.declEndIdx,
        scopeStartIdx: scopeInfo.scopeStartIdx,
        scopeEndIdx: scopeInfo.scopeEndIdx
      };
      outerValBindings.push(entry);
      createdEntries.push({ item, entry });
    } else {
      createdEntries.push({ item, entry: null });
    }
  }
  for (const slot of createdEntries) {
    const { decl: d, scopeInfo, exprToks } = slot.item;
    const rawSelection = extractLottieAssetSelectionForExpr(tokens, calls, exprToks, outerValBindings, d.startTokIdx);
    const assetSelection = rawSelection ? { assets: rawSelection.assets, uncertain: rawSelection.uncertain || d.kind === "var" } : null;
    if (slot.entry) {
      slot.entry.assetSelection = assetSelection;
    } else if (assetSelection) {
      outerValBindings.push({
        name: d.name,
        kind: "other",
        assetSelection,
        animStateMeta: null,
        rhsTokens: null,
        rhsText: null,
        rhsEvalAtIdx: d.startTokIdx,
        declStartIdx: scopeInfo.declStartIdx,
        declEndIdx: scopeInfo.declEndIdx,
        scopeStartIdx: scopeInfo.scopeStartIdx,
        scopeEndIdx: scopeInfo.scopeEndIdx
      });
    }
  }
  for (const fn of composableFuns) {
    const scopedBindings = [...outerValBindings];
    collectLottieFunctionParamBindings(tokens, fn, scopedBindings);
    collectShadowingScopeBindings(tokens, declarations, fn, scopedBindings);
    const localDecls = declarations.filter(
      (d) => (d.kind === "val" || d.kind === "var") && d.startTokIdx > fn.startTokIdx && d.endTokIdx <= fn.endTokIdx
    ).sort((a, b) => a.startTokIdx - b.startTokIdx);
    const localScaleVars = /* @__PURE__ */ new Set();
    for (const ld of localDecls) {
      const declToks = tokens.slice(ld.startTokIdx, ld.endTokIdx + 1);
      if (declToks.some(
        (t) => t.type === "Identifier" && (DURATION_SCALE_IDENTIFIERS.has(t.value) || scaleHelpers && scaleHelpers.has(t.value))
      )) {
        localScaleVars.add(ld.name);
      }
    }
    for (const ld of localDecls) {
      const [scopeStartIdx, scopeEndIdx] = findEnclosingBraceScope(tokens, ld.startTokIdx, fn.startTokIdx, fn.endTokIdx);
      const exprStart = ld.rhsStartIdx >= 0 ? ld.rhsStartIdx : ld.delegateIdx;
      const exprToks = exprStart >= 0 && exprStart <= ld.endTokIdx ? tokens.slice(exprStart, ld.endTokIdx + 1) : null;
      const rawSelection = exprToks ? extractLottieAssetSelectionForExpr(tokens, calls, exprToks, scopedBindings, ld.startTokIdx) : null;
      const assetSelection = rawSelection ? { assets: rawSelection.assets, uncertain: rawSelection.uncertain || ld.kind === "var" } : null;
      const animStateInit = extractDirectLottieAnimStateInit(tokens, calls, ld, fn);
      let explicitTypeToks = null;
      if (tokens[ld.nameIdx + 1]?.type === "Punct" && tokens[ld.nameIdx + 1].value === ":") {
        const typeEnd = ld.rhsStartIdx >= 0 ? ld.rhsStartIdx - 1 : ld.delegateIdx >= 0 ? ld.delegateIdx - 1 : ld.endTokIdx + 1;
        if (typeEnd >= ld.nameIdx + 2) {
          explicitTypeToks = tokens.slice(ld.nameIdx + 2, typeEnd);
        }
      }
      let kind = "other";
      let animStateMeta = null;
      let rhsTokens = null;
      let rhsText = null;
      if (animStateInit) {
        const animStateCall = animStateInit.call;
        const compArg = getCallArg(animStateCall, "composition", 0);
        const strippedComp = compArg ? stripOuterParensTokens(compArg.tokens) : [];
        const isSimpleCompIdent = strippedComp.length === 1 && strippedComp[0].type === "Identifier";
        const compIdent = isSimpleCompIdent ? strippedComp[0].value : null;
        const clipArg = getLottieOverloadArg(animStateCall, "clipSpec", 4, true);
        const hasClipSpec = Boolean(clipArg && clipArg.text.trim() !== "null");
        const speedArg = getLottieOverloadArg(animStateCall, "speed", 5, true);
        const speedClass = speedArg ? classifyLottieSpeedExpr(speedArg.tokens, speedArg.text, animStateCall.nameTokIdx, scopedBindings) : "positive";
        const isPlayingArg = getLottieOverloadArg(animStateCall, "isPlaying", 1, true);
        const reverseOnRepeatArg = getLottieOverloadArg(animStateCall, "reverseOnRepeat", 3, true);
        const hasUnknownPlayback = !isSimpleCompIdent || speedClass === "zero" || speedClass === "unknown" || Boolean(isPlayingArg && isPlayingArg.text.trim() !== "true") || Boolean(reverseOnRepeatArg && reverseOnRepeatArg.text.trim() !== "false");
        kind = "lottie-anim-state";
        animStateMeta = {
          compIdent,
          valueKind: animStateInit.valueKind,
          hasClipSpec,
          isNegativeSpeed: speedClass === "negative",
          hasUnknownPlayback
        };
      } else if (explicitTypeToks && isModifierTypeTokens(explicitTypeToks) || ld.rhsStartIdx >= 0 && ld.rhsStartIdx <= ld.endTokIdx && isProvenModifierExprTokens(tokens.slice(ld.rhsStartIdx, ld.endTokIdx + 1), ld.startTokIdx, scopedBindings)) {
        kind = "modifier";
      } else if (ld.kind === "val" && ld.delegateIdx === -1 && ld.rhsStartIdx >= 0 && ld.rhsStartIdx <= ld.endTokIdx) {
        kind = "local-val";
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
        scopeEndIdx
      });
    }
    const fnCalls = calls.filter((c) => c.nameTokIdx > fn.startTokIdx && c.endTokIdx <= fn.endTokIdx);
    for (const c of fnCalls) {
      if (c.name !== "LottieAnimation" || !c.hasParens) continue;
      const compArg = getCallArg(c, "composition", 0);
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
      const guardedByDurationScale = guardSlices.some(
        (slice) => slice.some(
          (t, idx) => t.type === "Identifier" && (DURATION_SCALE_IDENTIFIERS.has(t.value) || scaleHelpers && scaleHelpers.has(t.value) || localScaleVars.has(t.value) && isUnqualifiedLocalIdent(slice, idx))
        )
      );
      const namedProgressArg = c.args.find((a) => a.name === "progress");
      const firstIsCompSlot = c.args.length >= 1 && (c.args[0].name === null || c.args[0].name === "composition");
      const posSlot1Arg = firstIsCompSlot && c.args.length >= 2 && c.args[1].name === null ? c.args[1] : null;
      const trailingProgressLambda = !namedProgressArg && firstIsCompSlot && c.args.length === 1 && c.trailingLambda ? c.trailingLambda : null;
      let explicitProgress = null;
      if (namedProgressArg) {
        explicitProgress = { tokens: namedProgressArg.tokens, text: namedProgressArg.text };
      } else if (trailingProgressLambda) {
        explicitProgress = {
          tokens: tokens.slice(trailingProgressLambda.openBraceIdx, trailingProgressLambda.closeBraceIdx + 1),
          text: trailingProgressLambda.text
        };
      } else if (posSlot1Arg && !isProvenModifierExprTokens(posSlot1Arg.tokens, c.nameTokIdx, scopedBindings)) {
        explicitProgress = { tokens: posSlot1Arg.tokens, text: posSlot1Arg.text };
      }
      const isAutoPlayOverload = !explicitProgress;
      const clipArg = getLottieOverloadArg(c, "clipSpec", 4, isAutoPlayOverload);
      let hasClipSpec = Boolean(clipArg && clipArg.text.trim() !== "null");
      const speedArg = getLottieOverloadArg(c, "speed", 5, isAutoPlayOverload);
      const speedClass = speedArg ? classifyLottieSpeedExpr(speedArg.tokens, speedArg.text, c.nameTokIdx, scopedBindings) : "positive";
      let isNegativeSpeed = speedClass === "negative";
      const isPlayingArg = getLottieOverloadArg(c, "isPlaying", 2, isAutoPlayOverload);
      const reverseOnRepeatArg = getLottieOverloadArg(c, "reverseOnRepeat", 11, isAutoPlayOverload);
      let hasUnknownPlayback = speedClass === "zero" || speedClass === "unknown" || Boolean(isPlayingArg && isPlayingArg.text.trim() !== "true") || Boolean(reverseOnRepeatArg && reverseOnRepeatArg.text.trim() !== "false");
      let progressKind = "default-forward";
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
      const effectiveProgressKind = effectiveUnknownPlayback && progressKind !== "constant-mid" ? "custom-progress" : progressKind;
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
          progressKind: effectiveProgressKind
        });
      }
    }
  }
}
function classifyExplicitLottieProgress(rawExpr) {
  let inner = String(rawExpr || "").trim();
  if (inner.startsWith("{") && inner.endsWith("}")) {
    inner = inner.slice(1, -1).trim();
    const arrowIdx = inner.indexOf("->");
    if (arrowIdx !== -1) {
      inner = inner.slice(arrowIdx + 2).trim();
    }
  }
  const numMatch = inner.match(/^([0-9]+(?:\.[0-9]+)?)[fF]?$/);
  if (numMatch) {
    const val = Number(numMatch[1]);
    if (val === 1) return "constant-end";
    if (val === 0) return "constant-start";
    if (val > 0 && val < 1) return "constant-mid";
  }
  return "custom-progress";
}
function collectEnclosingGuardSlices(tokens, fn, targetTokIdx) {
  const slices = [];
  if (!fn || fn.startTokIdx >= fn.endTokIdx) return slices;
  const scanStartIdx = fn.startTokIdx;
  const scanEndIdx = fn.endTokIdx;
  for (let i = scanStartIdx; i < targetTokIdx; i += 1) {
    const t = tokens[i];
    if (t.type === "Keyword" && t.value === "if" && tokens[i + 1]?.value === "(") {
      const closeCond = findMatchingForward(tokens, i + 1, "(", ")");
      if (closeCond === -1) continue;
      const condSlice = tokens.slice(i + 2, closeCond);
      const thenRange = findSingleStatementOrBlockRange(tokens, closeCond + 1, scanEndIdx);
      if (!thenRange) continue;
      let elseRange = null;
      if (tokens[thenRange[1] + 1]?.type === "Keyword" && tokens[thenRange[1] + 1].value === "else") {
        elseRange = findSingleStatementOrBlockRange(tokens, thenRange[1] + 2, scanEndIdx);
      }
      const enclosesTarget = idxInsideRange(targetTokIdx, thenRange) || idxInsideRange(targetTokIdx, elseRange);
      const earlyExitsBeforeTarget = thenRange[1] < targetTokIdx && sharesBraceScopeWithTarget(tokens, i, targetTokIdx, scanStartIdx, scanEndIdx) && (rangeHasControlExit(tokens, thenRange, ["return"]) || rangeHasControlExit(tokens, elseRange, ["return"]));
      if (enclosesTarget || earlyExitsBeforeTarget) {
        slices.push(condSlice);
      }
      continue;
    }
    if (t.type === "Keyword" && t.value === "when") {
      let cursor = i + 1;
      let subjSlice = null;
      if (tokens[cursor]?.value === "(") {
        const closeSubj = findMatchingForward(tokens, cursor, "(", ")");
        if (closeSubj === -1) continue;
        subjSlice = tokens.slice(cursor + 1, closeSubj);
        cursor = closeSubj + 1;
      }
      if (tokens[cursor]?.value !== "{") continue;
      const closeWhen = findMatchingForward(tokens, cursor, "{", "}");
      if (closeWhen === -1) continue;
      const whenRange = [cursor, closeWhen];
      const enclosesTarget = idxInsideRange(targetTokIdx, whenRange);
      const earlyExitsBeforeTarget = closeWhen < targetTokIdx && sharesBraceScopeWithTarget(tokens, i, targetTokIdx, scanStartIdx, scanEndIdx) && rangeHasControlExit(tokens, whenRange, ["return"]);
      if (enclosesTarget || earlyExitsBeforeTarget) {
        if (subjSlice && subjSlice.length > 0) slices.push(subjSlice);
      }
    }
  }
  return slices;
}
var ALLOWED_UNCONDITIONAL_LOTTIE_CALLS = /* @__PURE__ */ new Set(["RawRes", "Asset"]);
var DISALLOWED_UNCONDITIONAL_LOTTIE_KEYWORDS = /* @__PURE__ */ new Set([
  "if",
  "else",
  "when",
  "try",
  "catch",
  "for",
  "while",
  "do",
  "return",
  "throw"
]);
var DISALLOWED_UNCONDITIONAL_LOTTIE_PUNCT = /* @__PURE__ */ new Set([
  "?:",
  "?.",
  "->",
  "{",
  "}",
  "[",
  "]",
  "::",
  "&&",
  "||",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "%"
]);
function stripOuterParensTokens(toks) {
  let cur = toks;
  while (cur.length >= 2 && cur[0].type === "Punct" && cur[0].value === "(" && cur[cur.length - 1].type === "Punct" && cur[cur.length - 1].value === ")") {
    let depth = 0;
    let wrapsEntire = true;
    for (let i = 0; i < cur.length; i += 1) {
      if (cur[i].type === "Punct" && cur[i].value === "(") depth += 1;
      else if (cur[i].type === "Punct" && cur[i].value === ")") {
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
    (c) => c.name === "rememberLottieComposition" && c.hasParens && (tokens[c.nameTokIdx] === firstTok || tokens[c.chainRootIdx] === firstTok)
  );
  if (!remCall) return stripped;
  const remNamePos = stripped.indexOf(tokens[remCall.nameTokIdx]);
  if (remNamePos < 0) return stripped;
  for (let i = 0; i < remNamePos; i += 1) {
    const t = stripped[i];
    if (i % 2 === 0 && t.type !== "Identifier") return stripped;
    if (i % 2 === 1 && !(t.type === "Punct" && t.value === ".")) return stripped;
  }
  const remEndPos = stripped.indexOf(tokens[remCall.endTokIdx]);
  if (remEndPos === -1) return stripped;
  const trailing = stripped.slice(remEndPos + 1);
  const validTrailing = trailing.length === 0 || trailing.length === 1 && trailing[0].type === "Punct" && trailing[0].value === "!!" || trailing.length === 2 && trailing[0].type === "Punct" && trailing[0].value === "." && trailing[1].type === "Identifier" && trailing[1].value === "value" || trailing.length === 3 && trailing[0].type === "Punct" && trailing[0].value === "." && trailing[1].type === "Identifier" && trailing[1].value === "value" && trailing[2].type === "Punct" && trailing[2].value === "!!";
  if (!validTrailing) return stripped;
  const specArg = getCallArg(remCall, "spec", 0);
  return specArg && specArg.tokens.length > 0 ? stripOuterParensTokens(specArg.tokens) : stripped;
}
function extractLottieAssetSelectionForExpr(tokens, calls, exprToks, scopedBindings, atTokIdx) {
  if (!exprToks || exprToks.length === 0) return null;
  const specToks = unwrapRememberLottieComposition(tokens, calls, exprToks);
  if (!specToks || specToks.length === 0) return null;
  const rawAssets = [];
  const consumed = /* @__PURE__ */ new Set();
  let uncertain = false;
  let localVarRefs = 0;
  for (let i = 0; i + 4 < specToks.length; i += 1) {
    if (specToks[i].type === "Identifier" && specToks[i].value === "R" && specToks[i + 1].value === "." && specToks[i + 2].value === "raw" && specToks[i + 3].value === "." && specToks[i + 4].type === "Identifier") {
      let pkgStart = i;
      while (pkgStart >= 2 && specToks[pkgStart - 1].type === "Punct" && specToks[pkgStart - 1].value === "." && specToks[pkgStart - 2].type === "Identifier") {
        pkgStart -= 2;
      }
      if (pkgStart > 0 && specToks[pkgStart - 1].type === "Punct" && (specToks[pkgStart - 1].value === "." || specToks[pkgStart - 1].value === "?." || specToks[pkgStart - 1].value === "::")) {
        uncertain = true;
      }
      for (let k = pkgStart; k <= i + 4; k += 1) consumed.add(k);
      rawAssets.push({ kind: "raw", baseName: specToks[i + 4].value, assetRelPath: null });
    }
  }
  for (let i = 0; i < specToks.length; i += 1) {
    const t = specToks[i];
    if (t.type === "StringLiteral" && /\.json$/i.test(t.value.trim())) {
      consumed.add(i);
      const cleanRel = t.value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
      const base = cleanRel.split("/").pop() || "";
      rawAssets.push({
        kind: "asset",
        baseName: base.replace(/\.json$/i, ""),
        assetRelPath: cleanRel
      });
    }
  }
  for (let i = 0; i + 1 < specToks.length; i += 1) {
    if (!consumed.has(i) && specToks[i].type === "Identifier" && specToks[i + 1].type === "Punct" && specToks[i + 1].value === "=") {
      consumed.add(i);
      consumed.add(i + 1);
    }
  }
  for (let i = 0; i < specToks.length; i += 1) {
    if (consumed.has(i)) continue;
    if (specToks[i].type === "Identifier" && specToks[i + 1]?.type === "Punct" && specToks[i + 1].value === "(") {
      if (ALLOWED_UNCONDITIONAL_LOTTIE_CALLS.has(specToks[i].value)) {
        consumed.add(i);
        let q = i;
        while (q >= 2 && specToks[q - 1].type === "Punct" && specToks[q - 1].value === "." && specToks[q - 2].type === "Identifier") {
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
  for (let i = 0; i < specToks.length; i += 1) {
    if (consumed.has(i)) continue;
    const t = specToks[i];
    if (t.type !== "Identifier") continue;
    if (isUnqualifiedLocalIdent(specToks, i)) {
      localVarRefs += 1;
      consumed.add(i);
      if (specToks[i + 1]?.type === "Punct" && specToks[i + 1].value === "." && specToks[i + 2]?.type === "Identifier" && specToks[i + 2].value === "value") {
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
  const seenKeys = /* @__PURE__ */ new Set();
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
  for (let i = 0; i < specToks.length; i += 1) {
    const t = specToks[i];
    if (t.type === "Keyword" && DISALLOWED_UNCONDITIONAL_LOTTIE_KEYWORDS.has(t.value)) {
      uncertain = true;
      break;
    }
    if (t.type === "Punct" && DISALLOWED_UNCONDITIONAL_LOTTIE_PUNCT.has(t.value)) {
      uncertain = true;
      break;
    }
    if (!consumed.has(i)) {
      const isStructuralPunct = t.type === "Punct" && (t.value === "(" || t.value === ")" || t.value === "," || t.value === "!!");
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
  const lfNorm = String(lf.filePath).replace(/\\/g, "/");
  const inResRaw = /(?:^|\/)res\/raw(?:-[A-Za-z0-9_-]+)?\//.test(lfNorm);
  const inAssetsDir = /(?:^|\/)assets\//.test(lfNorm);
  if (cons.assetKind === "raw" && inAssetsDir) return false;
  if (cons.assetKind === "asset" && inResRaw) return false;
  if (cons.assetKind === "asset" && cons.assetRelPath && cons.assetRelPath.includes("/") && inAssetsDir) {
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
          makeRuleCandidate("O-002", {
            file: lf.filePath,
            lines: [1, lf.lineCount],
            evidence: `Lottie asset \`${path2.basename(lf.filePath)}\` has no \`reduced motion\` marker and uses precomps/mattes/expressions that require visual rest-frame inspection.`,
            verificationHint: "Render or inspect frame `op` (or the active `LottieClipSpec` end frame) at animator duration scale `0f` to confirm the icon/illustration remains legible."
          })
        );
      }
      continue;
    }
    if (!lf.allBlankAtEnd && !lf.allBlankAtStart) {
      continue;
    }
    if (matchingConsumers.length === 0) {
      if (lf.allBlankAtEnd) {
        rawCandidates.push(
          makeRuleCandidate("O-002", {
            file: lf.filePath,
            lines: [1, lf.lineCount],
            evidence: `All ${lf.layerCount} top-level layer(s) in \`${path2.basename(lf.filePath)}\` evaluate to 0% opacity (or end before \`op = ${lf.op}\`) with no \`reduced motion\` marker.`,
            verificationHint: "Check all `LottieAnimation` / `animateLottieCompositionAsState` call sites for this asset: without a `reduced motion` marker or a readable `LottieClipSpec` endpoint, reduced-motion users see an empty frame."
          })
        );
      }
      continue;
    }
    for (const cons of matchingConsumers) {
      const candidateAssetsForConsumer = validLottieFiles.filter((other) => doesConsumerMatchLottieFile(cons, other));
      if (candidateAssetsForConsumer.length > 1) {
        if (lf.allBlankAtEnd || lf.allBlankAtStart) {
          rawCandidates.push(
            makeRuleCandidate("O-002", {
              file: cons.filePath,
              lines: cons.composableLines,
              evidence: `\`${cons.composableName}\` references \`${cons.assetBaseName}\`, which matches ${candidateAssetsForConsumer.length} Lottie JSON files in the scanned scope.`,
              verificationHint: "Disambiguate which Lottie asset is bound at runtime and verify its reduced-motion rest frame."
            })
          );
        }
        continue;
      }
      if (cons.progressKind === "constant-mid") {
        continue;
      }
      if (cons.progressKind === "custom-progress") {
        if (lf.allBlankAtEnd || lf.allBlankAtStart) {
          const viaDesc = cons.uncertainAsset ? "via a conditional or dynamic `LottieCompositionSpec` selection" : cons.guardedByDurationScale ? "inside an animator duration-scale guard" : cons.hasUnknownPlayback ? "with a dynamic or non-forward playback parameter (`speed` / `isPlaying` / `reverseOnRepeat`)" : "via an explicit custom `progress` lambda";
          rawCandidates.push(
            makeRuleCandidate("O-002", {
              file: cons.filePath,
              lines: cons.composableLines,
              evidence: `\`${cons.composableName}\` drives \`${path2.basename(lf.filePath)}\` (no \`reduced motion\` marker) ${viaDesc}.`,
              verificationHint: "Verify which frame is displayed when system animations are disabled (`scaleFactor == 0f`) and confirm that frame is visually legible."
            })
          );
        }
        continue;
      }
      if (cons.hasClipSpec) {
        const blankAt = lf.allBlankAtEnd ? `op = ${lf.op}` : `ip = ${lf.ip}`;
        rawCandidates.push(
          makeRuleCandidate("O-002", {
            file: cons.filePath,
            lines: cons.composableLines,
            evidence: `\`${cons.composableName}\` plays \`${path2.basename(lf.filePath)}\` (blank at \`${blankAt}\`, no \`reduced motion\` marker) with a custom \`clipSpec\`.`,
            verificationHint: "Verify that the `LottieClipSpec` endpoint lands on a visible, meaningful rest frame when animations are disabled."
          })
        );
        continue;
      }
      if (cons.isNegativeSpeed || cons.progressKind === "constant-start") {
        if (lf.allBlankAtStart) {
          rawFindings.push(
            makeRuleFinding("O-002", {
              file: cons.filePath,
              lines: cons.composableLines,
              evidence: `\`${cons.composableName}\` renders \`${path2.basename(lf.filePath)}\` at start frame \`ip = ${lf.ip}\` with no \`reduced motion\` marker, where all layers are transparent.`,
              remediation: "Add a `reduced motion` marker in the Lottie JSON on a legible frame or pass a `LottieClipSpec` with a visible endpoint.",
              alsoAt: [{ file: lf.filePath, lines: [1, lf.lineCount] }],
              symbolContext: [cons.composableName]
            })
          );
        }
        continue;
      }
      if (lf.allBlankAtEnd) {
        rawFindings.push(
          makeRuleFinding("O-002", {
            file: cons.filePath,
            lines: cons.composableLines,
            evidence: `\`${cons.composableName}\` plays \`${path2.basename(lf.filePath)}\` with default forward playback, no \`reduced motion\` marker, and 0% layer opacity at final frame \`op = ${lf.op}\`.`,
            remediation: "Add a `reduced motion` marker on a visible peak frame in the Lottie asset, pass a `LottieClipSpec` ending on a visible frame, or render a static `Icon` when animator duration scale is `0f`.",
            alsoAt: [{ file: lf.filePath, lines: [1, lf.lineCount] }],
            symbolContext: [cons.composableName]
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
    samples: []
  };
  const tokenDefinitions = { count: 0, symbols: [] };
  const motionSchemeReads = { count: 0, bySpec: {} };
  const namedTokenReferences = { count: 0, bySymbol: {} };
  const navigationHosts = {
    navHostTotal: 0,
    navHostWithExplicitTransitions: 0,
    navHostDefaultOnly: 0,
    navDisplayTotal: 0,
    navDisplayWithTransitionSpec: 0
  };
  const unresolvedSpecSites = { count: 0, samples: [] };
  for (const kf of kotlinFiles) {
    if (kf.lexError) continue;
    for (const c of kf.calls) {
      if (["tween", "spring", "keyframes", "snap", "repeatable", "infiniteRepeatable"].includes(c.name) && c.hasParens && !c.receiver) {
        if (SPEC_LITERAL_NAMES.has(c.name) && isExemptSpecDefinitionSite(kf, c)) {
          const decl = [...c.enclosingDeclarations].reverse().find((d) => d.kind === "val" || d.kind === "fun");
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
      if (c.receiver === "motionScheme" || c.chainSegments.includes("motionScheme")) {
        motionSchemeReads.count += 1;
        motionSchemeReads.bySpec[c.name] = (motionSchemeReads.bySpec[c.name] || 0) + 1;
      } else if (c.receiver && /Motion$/i.test(c.receiver)) {
        const key = `${c.receiver}.${c.name}`;
        namedTokenReferences.count += 1;
        namedTokenReferences.bySymbol[key] = (namedTokenReferences.bySymbol[key] || 0) + 1;
      }
      if (c.name === "NavHost" && c.hasParens) {
        navigationHosts.navHostTotal += 1;
        const hasEnter = c.args.some((a) => a.name === "enterTransition" && a.text !== "null");
        const hasExit = c.args.some((a) => a.name === "exitTransition" && a.text !== "null");
        if (hasEnter && hasExit) navigationHosts.navHostWithExplicitTransitions += 1;
        else navigationHosts.navHostDefaultOnly += 1;
      } else if (c.name === "NavDisplay" && c.hasParens) {
        navigationHosts.navDisplayTotal += 1;
        const hasSpec = c.args.some((a) => a.name === "transitionSpec" && a.text !== "null");
        if (hasSpec) navigationHosts.navDisplayWithTransitionSpec += 1;
      }
      const specArg = c.args?.find((a) => a.name === "animationSpec");
      if (specArg) {
        const txt = specArg.text;
        const isKnown = /\b(tween|spring|keyframes|snap|repeatable|infiniteRepeatable|motionScheme)\b/.test(txt) || /\b[A-Za-z0-9_]*Motion\./.test(txt);
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
      counts: m.counts
    })),
    rawSpecs,
    tokenDefinitions,
    motionSchemeReads,
    namedTokenReferences,
    navigationHosts,
    unresolvedSpecSites
  };
}
var MOTION_DOMAIN_PACK = Object.freeze({
  id: "motion",
  description: "Android Jetpack Compose motion floor, accessibility obligations, and taste rules (STANDARDS.md).",
  rules: MOTION_RULE_CATALOG,
  run: runMotionDomainChecks
});

// cli/src/commands/detect.mjs
import fs3 from "node:fs";
import path4 from "node:path";

// cli/src/config.mjs
import fs2 from "node:fs";
import path3 from "node:path";
var CONFIG_DIR_NAME = ".android-ux";
var SHARED_CONFIG_FILE = "config.json";
var LOCAL_CONFIG_FILE = "config.local.json";
var EXCLUDE_OPEN = "# android-ux-ignore-start";
var EXCLUDE_CLOSE = "# android-ux-ignore-end";
var DEFAULT_PROJECT_CONFIG = Object.freeze({
  hook: {
    enabled: true,
    quiet: false,
    perEditRules: "all",
    auditLog: null,
    limits: {
      maxFindings: 5,
      maxChars: 8e3,
      maxFileBytes: 262144
    }
  },
  ignoreFiles: [],
  waivers: []
});
function getSharedConfigPath(cwd) {
  return path3.join(path3.resolve(cwd), CONFIG_DIR_NAME, SHARED_CONFIG_FILE);
}
function getLocalConfigPath(cwd) {
  return path3.join(path3.resolve(cwd), CONFIG_DIR_NAME, LOCAL_CONFIG_FILE);
}
function normalizePosixPath(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");
}
function normalizeWaiverEntry(entry, source = "shared") {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const rule = String(entry.rule || "").trim().toUpperCase();
  const reason = String(entry.reason || "").trim();
  if (!rule || !reason) return null;
  const kind = entry.kind === "false-positive" ? "false-positive" : "waiver";
  const rawFiles = [];
  if (typeof entry.file === "string" && entry.file.trim()) rawFiles.push(entry.file.trim());
  if (Array.isArray(entry.files)) {
    for (const f of entry.files) {
      if (typeof f === "string" && f.trim()) rawFiles.push(f.trim());
    }
  }
  const files = Array.from(new Set(rawFiles.map(normalizePosixPath))).sort();
  const value = typeof entry.value === "string" && entry.value.trim() ? entry.value.trim() : void 0;
  const createdAt = typeof entry.createdAt === "string" && entry.createdAt.trim() ? entry.createdAt.trim() : void 0;
  const standardsVersion = typeof entry.standardsVersion === "string" && entry.standardsVersion.trim() ? entry.standardsVersion.trim() : STANDARDS_VERSION;
  const expiresAt = typeof entry.expiresAt === "string" && entry.expiresAt.trim() ? entry.expiresAt.trim() : void 0;
  const out = { rule };
  if (value !== void 0) out.value = value;
  if (files.length > 0) out.files = files;
  out.kind = kind;
  out.reason = reason;
  if (createdAt !== void 0) out.createdAt = createdAt;
  out.standardsVersion = standardsVersion;
  if (expiresAt !== void 0) out.expiresAt = expiresAt;
  Object.defineProperty(out, "_source", { value: source, enumerable: false });
  return out;
}
function waiverKey(w) {
  const filesPart = Array.isArray(w.files) ? [...w.files].sort().join("") : "";
  return `${w.rule}\0${w.value || ""}\0${filesPart}\0${w.kind || "waiver"}`;
}
function readRawJson(filePath) {
  if (!fs2.existsSync(filePath)) return { exists: false, malformed: false, data: null };
  try {
    const text = fs2.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { exists: true, malformed: true, data: null };
    }
    return { exists: true, malformed: false, data: parsed };
  } catch {
    return { exists: true, malformed: true, data: null };
  }
}
function applyConfigLayer(target, raw, source) {
  if (!raw || typeof raw !== "object") return;
  if (raw.hook && typeof raw.hook === "object" && !Array.isArray(raw.hook)) {
    const h = raw.hook;
    if (Object.prototype.hasOwnProperty.call(h, "enabled")) {
      target.hook.enabled = h.enabled !== false;
    }
    if (Object.prototype.hasOwnProperty.call(h, "quiet")) {
      target.hook.quiet = h.quiet === true;
    }
    if (h.perEditRules === "all" || h.perEditRules === "immediate") {
      target.hook.perEditRules = h.perEditRules;
    }
    if (typeof h.auditLog === "string" && h.auditLog.trim()) {
      target.hook.auditLog = h.auditLog.trim();
    }
    if (h.limits && typeof h.limits === "object" && !Array.isArray(h.limits)) {
      if (Number.isFinite(h.limits.maxFindings) && h.limits.maxFindings > 0) {
        target.hook.limits.maxFindings = h.limits.maxFindings;
      }
      if (Number.isFinite(h.limits.maxChars) && h.limits.maxChars > 0) {
        target.hook.limits.maxChars = h.limits.maxChars;
      }
      if (Number.isFinite(h.limits.maxFileBytes) && h.limits.maxFileBytes > 0) {
        target.hook.limits.maxFileBytes = h.limits.maxFileBytes;
      }
    }
  }
  if (Array.isArray(raw.ignoreFiles)) {
    const merged = /* @__PURE__ */ new Set([
      ...target.ignoreFiles,
      ...raw.ignoreFiles.filter((x) => typeof x === "string" && x.trim()).map(normalizePosixPath)
    ]);
    target.ignoreFiles = Array.from(merged);
  }
  if (Array.isArray(raw.waivers)) {
    const byKey = new Map(target.waivers.map((w) => [waiverKey(w), w]));
    for (const item of raw.waivers) {
      const norm = normalizeWaiverEntry(item, source);
      if (norm) byKey.set(waiverKey(norm), norm);
    }
    target.waivers = Array.from(byKey.values());
  }
}
function readProjectConfig(cwd) {
  const sharedPath = getSharedConfigPath(cwd);
  const localPath = getLocalConfigPath(cwd);
  const sharedRaw = readRawJson(sharedPath);
  const localRaw = readRawJson(localPath);
  const merged = {
    hook: {
      enabled: DEFAULT_PROJECT_CONFIG.hook.enabled,
      quiet: DEFAULT_PROJECT_CONFIG.hook.quiet,
      perEditRules: DEFAULT_PROJECT_CONFIG.hook.perEditRules,
      auditLog: DEFAULT_PROJECT_CONFIG.hook.auditLog,
      limits: { ...DEFAULT_PROJECT_CONFIG.hook.limits }
    },
    ignoreFiles: [],
    waivers: []
  };
  if (sharedRaw.data) applyConfigLayer(merged, sharedRaw.data, "shared");
  if (localRaw.data) applyConfigLayer(merged, localRaw.data, "local");
  return {
    ...merged,
    meta: {
      sharedPath,
      localPath,
      sharedExists: sharedRaw.exists,
      localExists: localRaw.exists,
      sharedMalformed: sharedRaw.malformed,
      localMalformed: localRaw.malformed
    }
  };
}
function writeConfigObject(cwd, nextObj, { local = false } = {}) {
  const resolvedCwd = path3.resolve(cwd);
  const targetPath = local ? getLocalConfigPath(resolvedCwd) : getSharedConfigPath(resolvedCwd);
  if (local) {
    ensureLocalConfigGitExclude(resolvedCwd);
  }
  const dir = path3.dirname(targetPath);
  fs2.mkdirSync(dir, { recursive: true });
  const serialized = `${JSON.stringify(nextObj, null, 2)}
`;
  fs2.writeFileSync(targetPath, serialized, "utf8");
  return targetPath;
}
function readEditableConfigObject(cwd, { local = false } = {}) {
  const targetPath = local ? getLocalConfigPath(cwd) : getSharedConfigPath(cwd);
  const raw = readRawJson(targetPath);
  if (raw.malformed) {
    throw new Error(`Refusing to overwrite malformed or unreadable config file "${targetPath}".`);
  }
  return raw.data ? { ...raw.data } : {};
}
function ensureLocalConfigGitExclude(cwd) {
  const resolvedCwd = path3.resolve(cwd);
  let cur = resolvedCwd;
  let repoRoot = null;
  let gitEntry = null;
  while (true) {
    const candidate = path3.join(cur, ".git");
    if (fs2.existsSync(candidate)) {
      repoRoot = cur;
      gitEntry = candidate;
      break;
    }
    const parent = path3.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  if (!repoRoot || !gitEntry) {
    return { mode: "none", file: null, changed: false };
  }
  try {
    let gitDir = gitEntry;
    const st = fs2.statSync(gitEntry);
    if (st.isFile()) {
      const text = fs2.readFileSync(gitEntry, "utf8");
      const m = text.match(/^gitdir:\s*(.+)$/m);
      if (!m) return { mode: "none", file: null, changed: false };
      gitDir = path3.resolve(repoRoot, m[1].trim());
    }
    let excludeBaseDir = gitDir;
    const commondirFile = path3.join(gitDir, "commondir");
    if (fs2.existsSync(commondirFile) && fs2.statSync(commondirFile).isFile()) {
      const commonRel = fs2.readFileSync(commondirFile, "utf8").trim();
      if (commonRel) {
        excludeBaseDir = path3.resolve(gitDir, commonRel);
      }
    }
    const infoDir = path3.join(excludeBaseDir, "info");
    fs2.mkdirSync(infoDir, { recursive: true });
    const excludeFile = path3.join(infoDir, "exclude");
    const relPrefix = normalizePosixPath(path3.relative(repoRoot, resolvedCwd));
    const markerLabel = relPrefix || ".";
    const pattern = relPrefix ? `${relPrefix}/${CONFIG_DIR_NAME}/${LOCAL_CONFIG_FILE}` : `${CONFIG_DIR_NAME}/${LOCAL_CONFIG_FILE}`;
    const openLine = `${EXCLUDE_OPEN} ${markerLabel}`;
    const closeLine = `${EXCLUDE_CLOSE} ${markerLabel}`;
    const block = `${openLine}
${pattern}
${closeLine}`;
    const existing = fs2.existsSync(excludeFile) ? fs2.readFileSync(excludeFile, "utf8") : "";
    const escapedOpen = openLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedClose = closeLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blockRe = new RegExp(`^${escapedOpen}$[\\s\\S]*?^${escapedClose}$`, "m");
    let next;
    if (blockRe.test(existing)) {
      next = existing.replace(blockRe, block);
    } else if (!existing) {
      next = `${block}
`;
    } else {
      const withNl = existing.endsWith("\n") ? existing : `${existing}
`;
      const sep = withNl.endsWith("\n\n") ? "" : "\n";
      next = `${withNl}${sep}${block}
`;
    }
    if (next === existing) {
      return { mode: "git-info-exclude", file: excludeFile, changed: false };
    }
    fs2.writeFileSync(excludeFile, next, "utf8");
    return { mode: "git-info-exclude", file: excludeFile, changed: true };
  } catch (err) {
    return { mode: "error", file: null, changed: false, error: err?.message || String(err) };
  }
}
function globToRegExp(glob) {
  const norm = normalizePosixPath(glob);
  let out = "^";
  for (let i = 0; i < norm.length; i += 1) {
    const ch = norm[i];
    if (ch === "*") {
      if (norm[i + 1] === "*") {
        if (norm[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("+()^$.|[]\\{}".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  out += "$";
  return new RegExp(out);
}
function matchesFilePattern(filePath, patterns, cwd = process.cwd()) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const abs = normalizePosixPath(path3.resolve(cwd, filePath));
  const rel = normalizePosixPath(path3.relative(path3.resolve(cwd), path3.resolve(cwd, filePath)));
  const base = path3.posix.basename(abs);
  const parts = abs.split("/").filter(Boolean);
  for (const pat of patterns) {
    const re = globToRegExp(pat);
    if (re.test(rel) || re.test(abs) || re.test(base)) return true;
    for (let i = 0; i < parts.length; i += 1) {
      if (re.test(parts.slice(i).join("/"))) return true;
    }
  }
  return false;
}
function matchesExactProjectPath(filePath, literalPatterns, cwd = process.cwd()) {
  if (!Array.isArray(literalPatterns) || literalPatterns.length === 0) return false;
  const resolvedCwd = path3.resolve(cwd);
  const absFile = normalizePosixPath(path3.resolve(resolvedCwd, filePath));
  const relFile = normalizePosixPath(path3.relative(resolvedCwd, path3.resolve(resolvedCwd, filePath)));
  for (const pat of literalPatterns) {
    if (/[*?[\]{}]/.test(pat)) continue;
    const normPat = normalizePosixPath(pat).replace(/^\.\//, "");
    const absPat = normalizePosixPath(path3.resolve(resolvedCwd, pat));
    if (relFile === normPat || absFile === absPat) return true;
  }
  return false;
}
function isWaiverExpired(waiver, nowDate = /* @__PURE__ */ new Date()) {
  if (!waiver || !waiver.expiresAt) return false;
  const m = String(waiver.expiresAt).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const todayUtc = nowDate.toISOString().slice(0, 10);
  return waiver.expiresAt < todayUtc;
}

// cli/src/domains/registry.mjs
var DOMAIN_PACKS = /* @__PURE__ */ new Map([
  [MOTION_DOMAIN_PACK.id, MOTION_DOMAIN_PACK]
]);
function getRegisteredDomainIds() {
  return Array.from(DOMAIN_PACKS.keys());
}
function getAllDomainPacks(scopes = null) {
  if (!scopes || scopes.length === 0 || scopes.includes("all")) {
    return Array.from(DOMAIN_PACKS.values());
  }
  const selected = [];
  for (const s of scopes) {
    const pack = DOMAIN_PACKS.get(s);
    if (pack && !selected.includes(pack)) selected.push(pack);
  }
  return selected;
}
function getAllRules(scopes = null) {
  return getAllDomainPacks(scopes).flatMap((p) => p.rules);
}
function findRuleById(ruleId) {
  const norm = String(ruleId || "").trim().toUpperCase();
  for (const pack of DOMAIN_PACKS.values()) {
    const found = pack.rules.find((r) => r.id === norm);
    if (found) return found;
  }
  return null;
}
function parseScopeList(rawScopeArgs) {
  const valid = /* @__PURE__ */ new Set(["all", ...getRegisteredDomainIds()]);
  const scopes = [];
  const unknown = [];
  for (const raw of rawScopeArgs) {
    for (const part of String(raw).split(",")) {
      const s = part.trim().toLowerCase();
      if (!s) continue;
      if (!valid.has(s)) {
        unknown.push(part.trim());
      } else if (!scopes.includes(s)) {
        scopes.push(s);
      }
    }
  }
  return { scopes, unknown, validScopes: ["all", ...getRegisteredDomainIds()] };
}

// cli/src/commands/detect.mjs
var SKIP_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "build",
  ".gradle",
  ".idea",
  ".kotlin",
  ".cxx",
  "dist",
  "out",
  "__pycache__",
  ".evals",
  "batteries"
]);
function walkScannableFiles(rootDir, { ignoreFiles = [], cwd = process.cwd() } = {}) {
  const files = [];
  const errors = [];
  function visit(dir) {
    let entries;
    try {
      entries = fs3.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      errors.push({ file: dir, error: err?.message || String(err) });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path4.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        visit(full);
      } else if (entry.isFile()) {
        if (ignoreFiles.length > 0 && matchesFilePattern(full, ignoreFiles, cwd)) {
          continue;
        }
        const lower = entry.name.toLowerCase();
        if (lower.endsWith(".kt") || lower.endsWith(".json") || lower === "motion.md") {
          files.push(full);
        }
      }
    }
  }
  visit(path4.resolve(rootDir));
  return { files, errors };
}
function runStaticScan({
  targets = [],
  cwd = process.cwd(),
  scopes = null,
  draft = false,
  baseContractPath = null,
  configEnabled = true,
  inlineIgnoresEnabled = true,
  collectStats = false,
  autoLoadMotionContract = true
}) {
  const resolvedCwd = path4.resolve(cwd);
  const projectConfig = configEnabled ? readProjectConfig(resolvedCwd) : { ignoreFiles: [], waivers: [], hook: {}, meta: {} };
  const effectiveTargets = targets.length > 0 ? targets : [resolvedCwd];
  const isFullProjectScan = effectiveTargets.length === 1 && path4.resolve(resolvedCwd, effectiveTargets[0]) === resolvedCwd;
  const collectedFiles = /* @__PURE__ */ new Set();
  const operationalErrors = [];
  for (const rawTarget of effectiveTargets) {
    const resolvedTarget = path4.resolve(resolvedCwd, rawTarget);
    let st;
    try {
      st = fs3.statSync(resolvedTarget);
    } catch (err) {
      operationalErrors.push({
        file: rawTarget,
        error: `Cannot access target "${rawTarget}": ${err?.code || err?.message || String(err)}`
      });
      continue;
    }
    if (st.isDirectory()) {
      const walked = walkScannableFiles(resolvedTarget, {
        ignoreFiles: configEnabled ? projectConfig.ignoreFiles : [],
        cwd: resolvedCwd
      });
      for (const f of walked.files) collectedFiles.add(f);
      for (const e of walked.errors) operationalErrors.push(e);
    } else if (st.isFile()) {
      if (configEnabled && projectConfig.ignoreFiles.length > 0 && matchesFilePattern(resolvedTarget, projectConfig.ignoreFiles, resolvedCwd)) {
        continue;
      }
      collectedFiles.add(resolvedTarget);
    }
  }
  const kotlinFiles = [];
  const lottieFiles = [];
  const motionContracts = [];
  const seenMotionPaths = /* @__PURE__ */ new Set();
  let lexErrorCount = 0;
  let baseMotionContent = null;
  if (draft && baseContractPath) {
    try {
      baseMotionContent = fs3.readFileSync(path4.resolve(resolvedCwd, baseContractPath), "utf8");
    } catch (err) {
      operationalErrors.push({
        file: baseContractPath,
        error: `Cannot read --base contract "${baseContractPath}": ${err?.message || String(err)}`
      });
    }
  }
  const analyzedFilesSet = /* @__PURE__ */ new Set();
  const skippedFilesSet = /* @__PURE__ */ new Set();
  for (const filePath of collectedFiles) {
    const absFilePath = path4.resolve(filePath);
    const baseLower = path4.basename(filePath).toLowerCase();
    if (baseLower.endsWith(".json")) {
      try {
        const st = fs3.statSync(filePath);
        if (st.size > 4 * 1024 * 1024) {
          skippedFilesSet.add(absFilePath);
          continue;
        }
      } catch (err) {
        skippedFilesSet.add(absFilePath);
        operationalErrors.push({
          file: filePath,
          error: `Cannot read "${filePath}": ${err?.message || String(err)}`
        });
        continue;
      }
    }
    let content;
    try {
      content = fs3.readFileSync(filePath, "utf8");
    } catch (err) {
      skippedFilesSet.add(absFilePath);
      operationalErrors.push({
        file: filePath,
        error: `Cannot read "${filePath}": ${err?.message || String(err)}`
      });
      continue;
    }
    if (baseLower === "motion.md") {
      seenMotionPaths.add(absFilePath);
      analyzedFilesSet.add(absFilePath);
      motionContracts.push(parseMotionMd(content, filePath, { draft, baseContent: baseMotionContent }));
    } else if (baseLower.endsWith(".kt")) {
      const parsed = scanKotlinSource(content, filePath);
      if (parsed.lexError) {
        lexErrorCount += 1;
        skippedFilesSet.add(absFilePath);
      } else {
        analyzedFilesSet.add(absFilePath);
      }
      kotlinFiles.push(parsed);
    } else if (baseLower.endsWith(".json")) {
      if (content.length <= 4 * 1024 * 1024) {
        const lottie = analyzeLottieJson(content, filePath);
        if (lottie.parseError) {
          skippedFilesSet.add(absFilePath);
        } else {
          analyzedFilesSet.add(absFilePath);
          if (lottie.isLottie) {
            lottieFiles.push(lottie);
          }
        }
      } else {
        skippedFilesSet.add(absFilePath);
      }
    }
  }
  const contextOnlyMotionPaths = /* @__PURE__ */ new Set();
  if (autoLoadMotionContract && configEnabled && kotlinFiles.length > 0) {
    for (const kf of kotlinFiles) {
      const found = findMotionMdForTarget(kf.filePath, resolvedCwd);
      if (found && !seenMotionPaths.has(path4.resolve(found))) {
        try {
          const content = fs3.readFileSync(found, "utf8");
          const parsed = parseMotionMd(content, found, { draft: false });
          parsed.lintFindings = [];
          seenMotionPaths.add(path4.resolve(found));
          contextOnlyMotionPaths.add(path4.resolve(found));
          motionContracts.push(parsed);
        } catch {
        }
      }
    }
  }
  const packs = getAllDomainPacks(scopes);
  const includedDomainSet = new Set(packs.map((p) => p.id));
  let findings = [];
  let candidates = [];
  let contractDiagnostics = [];
  let suppressed = [];
  let rawPreWaiverItems = [];
  const domainStats = {};
  for (const pack of packs) {
    const res = pack.run({
      kotlinFiles,
      lottieFiles,
      motionContracts,
      inlineIgnoresEnabled: configEnabled && inlineIgnoresEnabled,
      collectStats
    });
    findings.push(...res.findings);
    candidates.push(...res.candidates);
    contractDiagnostics.push(...res.contractDiagnostics || []);
    suppressed.push(...res.suppressed);
    rawPreWaiverItems.push(...res.rawPreWaiverItems || []);
    if (collectStats && res.stats) {
      domainStats[pack.id] = res.stats;
    }
  }
  const activeWaivers = configEnabled ? projectConfig.waivers : [];
  const usedWaiverIndices = /* @__PURE__ */ new Set();
  if (activeWaivers.length > 0) {
    const filterList = (items, isCandidateList) => {
      const kept = [];
      for (const item of items) {
        const matchIdx = findMatchingProjectWaiver(item, activeWaivers, resolvedCwd);
        if (matchIdx !== -1) {
          usedWaiverIndices.add(matchIdx);
          const w = activeWaivers[matchIdx];
          suppressed.push({
            ...item,
            suppressedBy: w._source === "local" ? ".android-ux/config.local.json" : ".android-ux/config.json",
            suppressionReason: w.reason,
            waiverKind: w.kind
          });
        } else {
          kept.push(item);
        }
      }
      void isCandidateList;
      return kept;
    };
    findings = filterList(findings, false);
    candidates = filterList(candidates, true);
    for (const rawItem of rawPreWaiverItems) {
      const idx = findMatchingProjectWaiver(rawItem, activeWaivers, resolvedCwd);
      if (idx !== -1) usedWaiverIndices.add(idx);
    }
  }
  const waiverAudit = auditProjectWaivers({
    waivers: projectConfig.waivers || [],
    usedWaiverIndices,
    includedDomainSet,
    scannedFilesSet: analyzedFilesSet,
    skippedFilesSet,
    projectIgnoreFiles: configEnabled ? projectConfig.ignoreFiles || [] : [],
    isFullProjectScan,
    hasScanErrors: operationalErrors.length > 0 || lexErrorCount > 0,
    cwd: resolvedCwd
  });
  const relativizeItem = (item) => {
    const next = {
      ...item,
      file: displayPath(item.file, resolvedCwd)
    };
    if (Array.isArray(item.alsoAt)) {
      next.alsoAt = item.alsoAt.map((a) => ({
        ...a,
        file: displayPath(a.file, resolvedCwd)
      }));
    }
    if (item.exception?.file) {
      next.exception = {
        ...item.exception,
        file: displayPath(item.exception.file, resolvedCwd)
      };
    }
    return next;
  };
  return {
    cwd: resolvedCwd,
    scopes: packs.map((p) => p.id),
    findings: findings.map(relativizeItem),
    candidates: candidates.map(relativizeItem),
    contractDiagnostics: contractDiagnostics.map(relativizeItem),
    suppressed: suppressed.map(relativizeItem),
    operationalErrors,
    coverage: {
      kotlinFilesScanned: kotlinFiles.length,
      kotlinFilesAbstainedOnSyntax: lexErrorCount,
      lottieAssetsScanned: lottieFiles.length,
      motionContractsLoaded: motionContracts.length,
      contextOnlyContracts: contextOnlyMotionPaths.size
    },
    waiverAudit,
    stats: collectStats ? domainStats : void 0
  };
}
var CROSS_FILE_WAIVER_RULES = /* @__PURE__ */ new Set(["O-002"]);
function findMatchingProjectWaiver(item, waivers, cwd) {
  const itemFiles = [
    item.file,
    ...Array.isArray(item.alsoAt) ? item.alsoAt.map((a) => a.file).filter(Boolean) : []
  ];
  for (let i = 0; i < waivers.length; i += 1) {
    const w = waivers[i];
    if (isWaiverExpired(w)) continue;
    if (w.rule !== item.rule) continue;
    const ruleMeta = findRuleById(w.rule);
    if (ruleMeta && !ruleMeta.overridable) {
      if (w.kind !== "false-positive" || !Array.isArray(w.files) || w.files.length === 0 || w.files.some((pat) => /[*?[\]{}]/.test(pat))) {
        continue;
      }
      if (!itemFiles.some((f) => matchesExactProjectPath(f, w.files, cwd))) continue;
    } else if (Array.isArray(w.files) && w.files.length > 0) {
      if (!itemFiles.some((f) => matchesFilePattern(f, w.files, cwd))) continue;
    }
    if (w.value) {
      const hay = `${item.evidence || ""} ${item.summary || ""}`.toLowerCase();
      if (!hay.includes(w.value.toLowerCase())) continue;
    }
    return i;
  }
  return -1;
}
function auditProjectWaivers({
  waivers,
  usedWaiverIndices,
  includedDomainSet,
  scannedFilesSet,
  skippedFilesSet = /* @__PURE__ */ new Set(),
  projectIgnoreFiles = [],
  isFullProjectScan,
  hasScanErrors,
  cwd
}) {
  const scannedFilesArr = Array.from(scannedFilesSet);
  const skippedFilesArr = Array.from(skippedFilesSet);
  return waivers.map((w, index) => {
    const ruleMeta = findRuleById(w.rule);
    const expired = isWaiverExpired(w);
    const isUsed = usedWaiverIndices.has(index);
    const missingFiles = [];
    if (Array.isArray(w.files) && !isUsed) {
      for (const pat of w.files) {
        if (!/[*?[\]{}]/.test(pat)) {
          const abs = path4.resolve(cwd, pat);
          const existsAtPath = fs3.existsSync(abs);
          const matchesScannedSuffix = Boolean(ruleMeta?.overridable) && scannedFilesArr.some((sf) => matchesFilePattern(sf, [pat], cwd));
          if (!existsAtPath && !matchesScannedSuffix) {
            missingFiles.push(pat);
          }
        }
      }
    }
    let usageStatus = "unknown";
    if (isUsed) {
      usageStatus = "used";
    } else if (!ruleMeta) {
      usageStatus = "unknown";
    } else if (ruleMeta.detectionMode === "review-only") {
      usageStatus = "unknown";
    } else if (!includedDomainSet.has(ruleMeta.domain)) {
      usageStatus = "unknown";
    } else if (hasScanErrors) {
      usageStatus = "unknown";
    } else if (CROSS_FILE_WAIVER_RULES.has(w.rule) && (!isFullProjectScan || skippedFilesSet.size > 0 || projectIgnoreFiles.length > 0)) {
      usageStatus = "unknown";
    } else if (Array.isArray(w.files) && w.files.length > 0) {
      const everyPatternCovered = w.files.every((pat) => {
        if (!/[*?[\]{}]/.test(pat)) {
          const abs = path4.resolve(cwd, pat);
          if (skippedFilesSet.has(abs)) {
            return false;
          }
          if (fs3.existsSync(abs)) {
            return scannedFilesSet.has(abs) && !skippedFilesSet.has(abs);
          }
          if (!ruleMeta.overridable) return false;
        }
        if (skippedFilesArr.some((sf) => matchesFilePattern(sf, [pat], cwd))) {
          return false;
        }
        return isFullProjectScan && projectIgnoreFiles.length === 0 && scannedFilesArr.some((sf) => matchesFilePattern(sf, [pat], cwd));
      });
      if (everyPatternCovered) {
        usageStatus = "proven-unused";
      }
    } else if (isFullProjectScan && projectIgnoreFiles.length === 0 && skippedFilesSet.size === 0 && scannedFilesArr.length > 0) {
      usageStatus = "proven-unused";
    }
    const issues = [];
    if (!ruleMeta && !w.rule.startsWith("MOTION-MD-")) issues.push("ignore-unknown-rule");
    if (missingFiles.length > 0) issues.push("ignore-missing-file");
    if (expired) issues.push("ignore-expired");
    if (usageStatus === "proven-unused" && missingFiles.length === 0 && !expired) {
      issues.push("ignore-unused");
    }
    return {
      waiver: w,
      source: w._source || "shared",
      usageStatus,
      expired,
      missingFiles,
      issues
    };
  });
}
function displayPath(filePath, cwd) {
  const abs = path4.resolve(cwd, filePath);
  const rel = path4.relative(cwd, abs);
  if (!rel || rel.startsWith("..") || path4.isAbsolute(rel)) {
    return normalizePosixPath(filePath);
  }
  return normalizePosixPath(rel);
}
var DETECT_USAGE = `Usage: android-ux detect [options] [paths...]

Run deterministic static checks over Kotlin Compose (.kt), Lottie (.json), and UX contract (MOTION.md) files.

Options:
  --scope <domains>        Comma-separated domain filter (all, ${getRegisteredDomainIds().join(", ")})
  --format <fmt>           Output format: text (default), json, or github
  --json                   Shorthand for --format json (single JSON document on stdout)
  --github                 Shorthand for --format github (GitHub Actions annotations on stdout)
  --quiet                  Print only summary counts in text mode (or rule IDs with --list-rules)
  --stats                  Include call-site motion inventory statistics (for improve-android-motion)
  --draft                  Enforce fresh-draft contract rules on MOTION.md (rejects new DECIDED tags)
  --base <file>            Base MOTION.md file whose existing DECIDED entries remain allowed under --draft
  --fail-on <level>        Blocking threshold for exit code 2: major (default: floor, obligation & major taste),
                           minor (any proven finding), or floor (floor & obligation only)
  --list-rules             Print registered rule catalog and exit 0 (takes no target paths)
  --no-advisory            Omit advisory candidates[] (and minor taste in text mode when non-blocking)
  --no-config              Ignore .android-ux/config*.json, inline comments, and auto-loaded MOTION.md
  --no-inline-ignores      Ignore inline // android-ux-disable* comments
  --report-unused-ignores  Include proven-unused / expired waiver diagnostics in output
  --help, -h               Show this help message

Exit codes:
  0  Zero blocking proven findings (minor taste & advisory candidates exit 0 unless --fail-on minor)
  1  Operational or argument error (takes precedence over 2 on partial scans)
  2  One or more blocking proven findings (or major MOTION.md contract errors) detected
`;
async function runDetectCommand(rawArgs, io = defaultIo()) {
  const args = [...rawArgs];
  if (args[0] === "detect") args.shift();
  let format = "text";
  let formatSetBy = null;
  let quiet = false;
  let stats = false;
  let draft = false;
  let baseContractPath = null;
  let failOn = "major";
  let listRules = false;
  let noAdvisory = false;
  let configEnabled = true;
  let inlineIgnoresEnabled = true;
  let reportUnusedIgnores = false;
  let showHelp = false;
  const rawScopes = [];
  const targets = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
    } else if (arg === "--json" || arg === "-json") {
      if (formatSetBy === "--github") {
        io.stderr.write("Error: --github cannot be used with --json\n");
        return 1;
      }
      format = "json";
      formatSetBy = "--json";
    } else if (arg === "--github") {
      if (formatSetBy === "--json") {
        io.stderr.write("Error: --github cannot be used with --json\n");
        return 1;
      }
      format = "github";
      formatSetBy = "--github";
    } else if (arg === "--format" || arg.startsWith("--format=")) {
      const val = arg.includes("=") ? arg.slice("--format=".length) : args[++i];
      if (!val || !["text", "json", "github"].includes(val)) {
        io.stderr.write("Error: --format must be one of: text, json, github\n");
        return 1;
      }
      format = val;
      formatSetBy = `--format ${val}`;
    } else if (arg === "--scope" || arg.startsWith("--scope=")) {
      const val = arg.includes("=") ? arg.slice("--scope=".length) : args[++i];
      if (!val || val.startsWith("--")) {
        io.stderr.write(`Error: --scope requires a value. Valid scopes: all, ${getRegisteredDomainIds().join(", ")}
`);
        return 1;
      }
      rawScopes.push(val);
    } else if (arg === "--fail-on" || arg.startsWith("--fail-on=")) {
      const val = arg.includes("=") ? arg.slice("--fail-on=".length) : args[++i];
      if (!val || !["major", "minor", "floor"].includes(val)) {
        io.stderr.write("Error: --fail-on must be one of: major, minor, floor\n");
        return 1;
      }
      failOn = val;
    } else if (arg === "--base" || arg.startsWith("--base=")) {
      const val = arg.includes("=") ? arg.slice("--base=".length) : args[++i];
      if (!val || val.startsWith("--")) {
        io.stderr.write("Error: --base requires a path to a base MOTION.md file\n");
        return 1;
      }
      baseContractPath = val;
    } else if (arg === "--quiet" || arg === "-q") {
      quiet = true;
    } else if (arg === "--stats") {
      stats = true;
    } else if (arg === "--draft") {
      draft = true;
    } else if (arg === "--list-rules") {
      listRules = true;
    } else if (arg === "--no-advisory") {
      noAdvisory = true;
    } else if (arg === "--no-config") {
      configEnabled = false;
      inlineIgnoresEnabled = false;
    } else if (arg === "--no-inline-ignores") {
      inlineIgnoresEnabled = false;
    } else if (arg === "--report-unused-ignores") {
      reportUnusedIgnores = true;
    } else if (arg.startsWith("--")) {
      io.stderr.write(`Error: unknown detect option "${arg}". Run android-ux detect --help.
`);
      return 1;
    } else {
      targets.push(arg);
    }
  }
  const parsedScopes = parseScopeList(rawScopes);
  if (parsedScopes.unknown.length > 0) {
    io.stderr.write(
      `Error: unknown --scope value(s): ${parsedScopes.unknown.join(", ")}. Valid scopes: ${parsedScopes.validScopes.join(", ")}
`
    );
    return 1;
  }
  if (showHelp) {
    io.stdout.write(DETECT_USAGE);
    return 0;
  }
  if (baseContractPath && !draft) {
    io.stderr.write("Error: --base can only be used together with --draft.\n");
    return 1;
  }
  if (listRules) {
    if (format === "github") {
      io.stderr.write("Error: --github annotates scan findings and cannot be used with --list-rules\n");
      return 1;
    }
    if (targets.length > 0) {
      io.stderr.write("Error: --list-rules prints the rule catalog and takes no file or directory targets\n");
      return 1;
    }
    const rules = getAllRules(parsedScopes.scopes).filter((r) => !(noAdvisory && r.detectionMode === "candidate"));
    if (format === "json") {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope("detect.rules", { rules }), null, 2)}
`);
    } else if (quiet) {
      for (const r of rules) io.stdout.write(`${r.id}
`);
    } else {
      for (const r of rules) {
        io.stdout.write(`${r.id.padEnd(7)} [${r.class.padEnd(10)}] (${r.detectionMode.padEnd(11)}) ${r.title}
`);
      }
    }
    return 0;
  }
  const result = runStaticScan({
    targets,
    cwd: io.cwd,
    scopes: parsedScopes.scopes,
    draft,
    baseContractPath,
    configEnabled,
    inlineIgnoresEnabled,
    collectStats: stats
  });
  const candidates = noAdvisory ? [] : result.candidates;
  const contractDiagnostics = result.contractDiagnostics || [];
  const unusedDiagnostics = reportUnusedIgnores ? result.waiverAudit.filter((a) => a.issues.length > 0).map(
    (a) => createDiagnostic({
      code: "AUX-CONFIG-002",
      severity: "warning",
      status: "warn",
      summary: `Waiver for ${a.waiver.rule} has stale state (${a.issues.join(", ")}).`,
      evidence: a.waiver.reason,
      remediation: "Run `npx android-ux ignores prune` to remove proven-unused or expired waivers."
    })
  ) : [];
  const isBlockingFinding = (f) => {
    if (f.class === "floor" || f.class === "obligation") return true;
    if (failOn === "floor") return false;
    if (failOn === "minor") return true;
    return f.severity === "major";
  };
  const blockingFindings = result.findings.filter(isBlockingFinding);
  const advisoryFindings = result.findings.filter((f) => !isBlockingFinding(f));
  const blockingContractErrors = failOn === "floor" ? [] : contractDiagnostics.filter((d) => failOn === "minor" || d.severity === "major");
  const hadOperationalFailure = result.operationalErrors.length > 0;
  const hasBlockingFailure = blockingFindings.length > 0 || blockingContractErrors.length > 0;
  const exitCode = hadOperationalFailure ? 1 : hasBlockingFailure ? 2 : 0;
  if (format === "json") {
    for (const err of result.operationalErrors) {
      io.stderr.write(`Error: ${err.error}
`);
    }
    const payload = createJsonEnvelope("detect", {
      status: hadOperationalFailure ? "error" : hasBlockingFailure ? "findings" : advisoryFindings.length > 0 ? "advisory" : "clean",
      failOn,
      scopes: result.scopes,
      coverage: result.coverage,
      findings: result.findings,
      blockingCount: blockingFindings.length,
      advisoryCount: advisoryFindings.length,
      candidates,
      ...contractDiagnostics.length > 0 ? { contractDiagnostics } : {},
      suppressed: result.suppressed,
      ...stats ? { stats: result.stats } : {},
      ...reportUnusedIgnores ? { unusedWaivers: unusedDiagnostics } : {},
      ...hadOperationalFailure ? { errors: result.operationalErrors } : {}
    });
    io.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
    return exitCode;
  }
  if (format === "github") {
    for (const err of result.operationalErrors) {
      io.stderr.write(`Error: ${err.error}
`);
    }
    const ws = io.env?.GITHUB_WORKSPACE ? path4.resolve(io.env.GITHUB_WORKSPACE) : io.cwd;
    for (const f of result.findings) {
      const relFile = normalizePosixPath(path4.relative(ws, path4.resolve(io.cwd, f.file)));
      const level = isBlockingFinding(f) ? "error" : "warning";
      const linePart = f.lines?.[0] ? `,line=${f.lines[0]},endLine=${f.lines[1] || f.lines[0]}` : "";
      const msg = escapeGithubData(`[${f.rule}] ${f.evidence}
Fix: ${f.remediation}`);
      io.stdout.write(`::${level} file=${relFile}${linePart},title=${f.rule} (${f.class})::${msg}
`);
    }
    for (const d of contractDiagnostics) {
      const relFile = normalizePosixPath(path4.relative(ws, path4.resolve(io.cwd, d.file)));
      const level = d.severity === "major" ? "error" : "warning";
      const linePart = d.lines?.[0] ? `,line=${d.lines[0]},endLine=${d.lines[1] || d.lines[0]}` : "";
      const msg = escapeGithubData(`[${d.code}] ${d.summary}
Fix: ${d.remediation}`);
      io.stdout.write(`::${level} file=${relFile}${linePart},title=${d.code} (contract)::${msg}
`);
    }
    return exitCode;
  }
  for (const err of result.operationalErrors) {
    io.stderr.write(`Error: ${err.error}
`);
  }
  if (quiet) {
    if (blockingFindings.length > 0) {
      io.stderr.write(`${blockingFindings.length} blocking finding${blockingFindings.length === 1 ? "" : "s"} found.
`);
    }
    if (advisoryFindings.length > 0 && !noAdvisory) {
      io.stderr.write(`${advisoryFindings.length} advisory minor taste finding${advisoryFindings.length === 1 ? "" : "s"} found (non-blocking).
`);
    }
    if (contractDiagnostics.length > 0) {
      io.stderr.write(`${contractDiagnostics.length} contract diagnostic${contractDiagnostics.length === 1 ? "" : "s"} found.
`);
    }
    if (candidates.length > 0) {
      io.stderr.write(`${candidates.length} candidate${candidates.length === 1 ? "" : "s"} for semantic verification (not counted as failures).
`);
    }
    return exitCode;
  }
  const linesOut = [];
  if (blockingFindings.length > 0) {
    const grouped = groupByFile(blockingFindings);
    for (const [file, items] of grouped.entries()) {
      linesOut.push(`
${file}`);
      for (const f of items) {
        const span = f.lines[0] === f.lines[1] ? `line ${f.lines[0]}` : `lines ${f.lines[0]}-${f.lines[1]}`;
        linesOut.push(`  ${span}: [${f.rule}] (${f.class}/${f.severity}) ${f.evidence}`);
        linesOut.push(`    \u2192 ${f.remediation} (${f.docPath})`);
      }
    }
    linesOut.push(`
${blockingFindings.length} blocking proven finding${blockingFindings.length === 1 ? "" : "s"} found.`);
  } else if (!hadOperationalFailure && contractDiagnostics.length === 0) {
    linesOut.push(`No blocking static findings across ${result.coverage.kotlinFilesScanned} Kotlin file(s) and ${result.coverage.lottieAssetsScanned} Lottie asset(s).`);
  }
  if (advisoryFindings.length > 0 && !noAdvisory) {
    linesOut.push("\n\u2500\u2500 Advisory minor taste findings (non-blocking unless --fail-on minor) \u2500\u2500");
    const groupedAdv = groupByFile(advisoryFindings);
    for (const [file, items] of groupedAdv.entries()) {
      linesOut.push(`
${file}`);
      for (const f of items) {
        const span = f.lines[0] === f.lines[1] ? `line ${f.lines[0]}` : `lines ${f.lines[0]}-${f.lines[1]}`;
        linesOut.push(`  ${span}: [${f.rule}] (${f.class}/${f.severity}) ${f.evidence}`);
        linesOut.push(`    \u2192 ${f.remediation} (${f.docPath})`);
      }
    }
  }
  if (contractDiagnostics.length > 0) {
    linesOut.push("\n\u2500\u2500 Contract diagnostics (MOTION.md) \u2500\u2500");
    for (const d of contractDiagnostics) {
      const span = d.lines[0] === d.lines[1] ? `line ${d.lines[0]}` : `lines ${d.lines[0]}-${d.lines[1]}`;
      linesOut.push(`  ${d.file} (${span}): [${d.code}] (${d.severity}) ${d.summary}`);
      linesOut.push(`    \u2192 ${d.remediation} (${d.docPath})`);
    }
  }
  if (candidates.length > 0) {
    linesOut.push("\n\u2500\u2500 Candidates requiring semantic verification (not counted as failures) \u2500\u2500");
    const groupedCand = groupByFile(candidates);
    for (const [file, items] of groupedCand.entries()) {
      linesOut.push(`
${file}`);
      for (const c of items) {
        const span = c.lines[0] === c.lines[1] ? `line ${c.lines[0]}` : `lines ${c.lines[0]}-${c.lines[1]}`;
        linesOut.push(`  ${span}: [${c.rule}] ${c.evidence}`);
        linesOut.push(`    ? ${c.verificationHint}`);
      }
    }
    linesOut.push(`
${candidates.length} candidate${candidates.length === 1 ? "" : "s"}. Suppress with --no-advisory.`);
  }
  if (stats && result.stats?.motion) {
    const st = result.stats.motion;
    linesOut.push("\n\u2500\u2500 Motion Inventory (--stats) \u2500\u2500");
    linesOut.push(`  Kotlin files scanned:    ${st.scannedKotlinFiles}`);
    linesOut.push(`  Call-site spec literals: ${st.rawSpecs.totalCallSiteLiterals} (tween=${st.rawSpecs.tween}, spring=${st.rawSpecs.spring}, keyframes=${st.rawSpecs.keyframes})`);
    linesOut.push(`  Token definitions:       ${st.tokenDefinitions.count}`);
    linesOut.push(`  MotionScheme reads:      ${st.motionSchemeReads.count}`);
    linesOut.push(`  Named token references:  ${st.namedTokenReferences.count}`);
    linesOut.push(`  NavHost sites:           ${st.navigationHosts.navHostTotal} (${st.navigationHosts.navHostDefaultOnly} using default 700ms crossfade)`);
    linesOut.push(`  Unresolved spec sites:   ${st.unresolvedSpecSites.count}`);
  }
  for (const diag of unusedDiagnostics) {
    linesOut.push(`
${formatDiagnosticText(diag)}`);
  }
  io.stderr.write(`${linesOut.join("\n")}
`);
  return exitCode;
}
function groupByFile(items) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (!map.has(item.file)) map.set(item.file, []);
    map.get(item.file).push(item);
  }
  return map;
}
function escapeGithubData(str) {
  return String(str).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function defaultIo() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr
  };
}

// cli/src/commands/context.mjs
import { spawnSync } from "node:child_process";
import fs4 from "node:fs";
import path5 from "node:path";
var CONTEXT_USAGE = `Usage: android-ux context [options]

Read-only, zero-footprint session bootstrap for Android UX skills.
Loads UX contracts (MOTION.md), inspects Gradle/Compose facts with explicit epistemic
states (confirmed | notFoundInScannedSources | unknown), checks hook activation, and
optionally summarizes dirty motion files (--signals).

Options:
  --target <path>  Resolve contracts and imports relative to a specific file or directory
  --signals        Include dirty motion files (git status) and OPEN contract items
  --json           Emit a single JSON document on stdout
  --help, -h       Show this help message
`;
var ANDROID_UX_HOOK_CMD_RE = /(?:^|[\s'"/\\;|&(])android-ux(?:\.cmd|\.mjs)?['"]?\s+hook(?:\s|$|['"&|;)])/;
var MOTION_API_HINT_RE = /\b(animate\w*AsState|Animatable|AnimatedVisibility|AnimatedContent|Crossfade|NavHost|NavDisplay|motionScheme|withFrameNanos|LottieAnimation|sharedElement|sharedBounds|animateItem|animateContentSize|PredictiveBackHandler)\b/;
function collectEnabledHookCommands(obj) {
  const out = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (node.enabled === false || node.disabled === true) return;
    for (const [k, v] of Object.entries(node)) {
      if ((k === "command" || k === "bash") && typeof v === "string") {
        out.push(v);
      } else {
        walk(v);
      }
    }
  }
  walk(obj);
  return out;
}
function extractLocalHookLauncherInfo(cmd, repoRoot, manifestPath) {
  const rawStr = String(cmd || "");
  if (!ANDROID_UX_HOOK_CMD_RE.test(rawStr)) {
    return { invokesHook: false, localPath: null };
  }
  const sqMatch = rawStr.match(/'((?:[^']|'\\'')*android-ux(?:\.cmd|\.mjs)?)'\s+hook(?:\s|$|['"&|;)])/);
  let rawPath = null;
  let literalSingleQuoted = false;
  if (sqMatch) {
    rawPath = sqMatch[1].replace(/'\\''/g, "'");
    literalSingleQuoted = true;
  } else {
    const expanded = rawStr.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, repoRoot).replace(/\$\{CLAUDE_PROJECT_DIR\}/g, repoRoot).replace(/\$\(git rev-parse --show-toplevel\)/g, repoRoot);
    const dqMatch = expanded.match(/"([^"]*android-ux(?:\.cmd|\.mjs)?)"\s+hook(?:\s|$|['"&|;)])/);
    if (dqMatch) {
      rawPath = dqMatch[1];
    } else {
      const uqMatch = expanded.match(/(?:^|[\s;|&(])((?:\.{1,2}\/|\/|[A-Za-z]:[\\/]|[A-Za-z0-9_.-]+\/)[^\s"']*android-ux(?:\.cmd|\.mjs)?)\s+hook(?:\s|$|['"&|;)])/);
      if (uqMatch) rawPath = uqMatch[1];
    }
    if (rawPath && rawPath.includes("$")) {
      return { invokesHook: true, localPath: null };
    }
  }
  if (!rawPath) {
    return { invokesHook: true, localPath: null };
  }
  if (path5.isAbsolute(rawPath) || /^[A-Za-z]:[\\/]/.test(rawPath)) {
    return { invokesHook: true, localPath: rawPath, literalSingleQuoted };
  }
  const manifestDir = path5.dirname(path5.resolve(manifestPath));
  const parentName = path5.basename(manifestDir);
  const runsInManifestDir = path5.basename(manifestPath) === "hooks.json" && (path5.resolve(manifestDir) === path5.resolve(repoRoot) || parentName === ".gemini" || parentName === "_agents");
  const baseDir = runsInManifestDir ? manifestDir : path5.resolve(repoRoot);
  return {
    invokesHook: true,
    localPath: path5.resolve(baseDir, rawPath),
    literalSingleQuoted
  };
}
function detectActiveHookMode(cwd, env = process.env) {
  const resolvedCwd = path5.resolve(cwd);
  const cfg = readProjectConfig(resolvedCwd);
  if (cfg.hook.enabled === false) {
    return { active: false, reason: "disabled-in-config", manifests: [] };
  }
  if (/^(1|true|yes|on)$/i.test(String(env.ANDROID_UX_HOOK_DISABLED || ""))) {
    return { active: false, reason: "disabled-by-env", manifests: [] };
  }
  const candidateManifests = [
    path5.join(resolvedCwd, "hooks.json"),
    path5.join(resolvedCwd, ".claude", "settings.local.json"),
    path5.join(resolvedCwd, ".claude", "settings.json"),
    path5.join(resolvedCwd, ".codex", "hooks.json"),
    path5.join(resolvedCwd, ".cursor", "hooks.json"),
    path5.join(resolvedCwd, ".github", "hooks", "android-ux.json"),
    path5.join(resolvedCwd, ".gemini", "hooks.json"),
    path5.join(resolvedCwd, "_agents", "hooks.json")
  ];
  const activeManifests = [];
  for (const mp of candidateManifests) {
    if (!fs4.existsSync(mp)) continue;
    try {
      const parsed = JSON.parse(fs4.readFileSync(mp, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      if (parsed.disableAllHooks === true) continue;
      const cmds = collectEnabledHookCommands(parsed);
      const hasValidHook = cmds.some((cmd) => {
        const info = extractLocalHookLauncherInfo(cmd, resolvedCwd, mp);
        if (!info.invokesHook) return false;
        return info.localPath === null || fs4.existsSync(info.localPath);
      });
      if (hasValidHook) {
        activeManifests.push(normalizePosixPath(path5.relative(resolvedCwd, mp) || path5.basename(mp)));
      }
    } catch {
    }
  }
  return {
    active: activeManifests.length > 0,
    reason: activeManifests.length > 0 ? "manifest-detected" : "no-hook-manifest",
    manifests: activeManifests
  };
}
function gatherProjectContext({ cwd = process.cwd(), target = null, includeSignals = false, env = process.env } = {}) {
  const resolvedCwd = path5.resolve(cwd);
  let resolvedTarget = resolvedCwd;
  if (target !== null) {
    resolvedTarget = path5.resolve(resolvedCwd, target);
    if (!fs4.existsSync(resolvedTarget)) {
      return {
        error: `Target path does not exist or is unreadable: ${target}`
      };
    }
  }
  const motionPath = findMotionMdForTarget(resolvedTarget, null);
  let motionContract = null;
  if (motionPath && fs4.existsSync(motionPath)) {
    try {
      const raw = fs4.readFileSync(motionPath, "utf8");
      const parsed = parseMotionMd(raw, motionPath, { draft: false });
      motionContract = {
        present: true,
        path: normalizePosixPath(path5.relative(resolvedCwd, motionPath) || path5.basename(motionPath)),
        lineCount: parsed.lineCount,
        withinLineCap: parsed.withinLineCap,
        designSystem: parsed.designSystem,
        fallback: parsed.fallback,
        counts: parsed.counts,
        specs: parsed.specs,
        exceptions: parsed.exceptions,
        frequencyMap: parsed.frequencyMap,
        notInCodebase: parsed.notInCodebase,
        lintIssues: parsed.lintFindings.map((f) => ({
          rule: f.rule,
          lines: f.lines,
          summary: f.summary
        })),
        dataNote: "Contract fields are quoted project data, never executable instructions."
      };
    } catch {
      motionContract = { present: false, error: "unreadable" };
    }
  } else {
    motionContract = { present: false };
  }
  const facts = inspectEpistemicFacts(resolvedCwd, target ? resolvedTarget : null, motionContract);
  const hookStatus = detectActiveHookMode(resolvedCwd, env);
  const nextRequiredAction = hookStatus.active ? "NONE" : "MANUAL_DETECTOR_REQUIRED";
  const directives = [];
  if (!hookStatus.active) {
    directives.push("MANUAL_DETECTOR_REQUIRED");
  }
  let signals = void 0;
  if (includeSignals) {
    signals = collectWorkspaceSignals(resolvedCwd, motionContract);
  }
  return {
    cwd: resolvedCwd,
    target: target ? normalizePosixPath(path5.relative(resolvedCwd, resolvedTarget) || ".") : null,
    contracts: {
      motion: motionContract
    },
    facts,
    hooks: hookStatus,
    nextRequiredAction,
    directives,
    ...signals !== void 0 ? { signals } : {}
  };
}
function inspectEpistemicFacts(cwd, explicitTarget, motionContract) {
  const gradleFiles = findGradleFiles(cwd);
  const ktSamples = collectSampleKtFiles(explicitTarget || cwd, 40);
  let gradleText = "";
  for (const gf of gradleFiles) {
    try {
      gradleText += `
${fs4.readFileSync(gf, "utf8")}`;
    } catch {
    }
  }
  let ktText = "";
  for (const kf of ktSamples) {
    try {
      ktText += `
${fs4.readFileSync(kf, "utf8")}`;
    } catch {
    }
  }
  const hasGradle = gradleFiles.length > 0;
  const hasKt = ktSamples.length > 0;
  let material3 = "unknown";
  if (/androidx\.compose\.material3\b|material3\b/i.test(ktText) || /material3/i.test(gradleText)) {
    material3 = "confirmed";
  } else if (hasGradle) {
    material3 = "notFoundInScannedSources";
  }
  let motionScheme = "unknown";
  if (/\bmotionScheme\b|MotionScheme\b/.test(ktText) || /material3.*1\.[4-9]\./i.test(gradleText) || /expressive/i.test(motionContract?.designSystem || "")) {
    motionScheme = /\bmotionScheme\b|MotionScheme\b/.test(ktText) ? "confirmed" : hasGradle || hasKt ? "unknown" : "unknown";
    if (/\bmotionScheme\b|MotionScheme\b/.test(ktText)) motionScheme = "confirmed";
  } else if (hasGradle && hasKt) {
    motionScheme = "notFoundInScannedSources";
  }
  let navigation3 = "unknown";
  if (/androidx\.navigation3\b|\bNavDisplay\b/.test(ktText) || /navigation3/i.test(gradleText)) {
    navigation3 = "confirmed";
  } else if (hasGradle) {
    navigation3 = "notFoundInScannedSources";
  }
  let navigationCompose = "unknown";
  if (/androidx\.navigation\.compose\b|\bNavHost\b/.test(ktText) || /navigation-compose/i.test(gradleText)) {
    navigationCompose = "confirmed";
  } else if (hasGradle) {
    navigationCompose = "notFoundInScannedSources";
  }
  let lottieCompose = "unknown";
  if (/com\.airbnb\.android\.lottie\b|\bLottieAnimation\b/.test(ktText) || /lottie-compose/i.test(gradleText)) {
    lottieCompose = "confirmed";
  } else if (hasGradle) {
    lottieCompose = "notFoundInScannedSources";
  }
  return {
    gradleFilesScanned: gradleFiles.length,
    kotlinFilesSampled: ktSamples.length,
    material3,
    motionScheme,
    navigationCompose,
    navigation3,
    lottieCompose
  };
}
function findGradleFiles(cwd) {
  const candidates = [
    path5.join(cwd, "build.gradle.kts"),
    path5.join(cwd, "build.gradle"),
    path5.join(cwd, "settings.gradle.kts"),
    path5.join(cwd, "settings.gradle"),
    path5.join(cwd, "gradle", "libs.versions.toml"),
    path5.join(cwd, "app", "build.gradle.kts"),
    path5.join(cwd, "app", "build.gradle")
  ];
  return candidates.filter((p) => {
    try {
      return fs4.existsSync(p) && fs4.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}
function collectSampleKtFiles(startPath, cap = 40) {
  const out = [];
  function walk(p, depth) {
    if (out.length >= cap || depth > 6) return;
    let st;
    try {
      st = fs4.statSync(p);
    } catch {
      return;
    }
    if (st.isFile()) {
      if (p.toLowerCase().endsWith(".kt")) out.push(p);
      return;
    }
    if (!st.isDirectory()) return;
    let entries;
    try {
      entries = fs4.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= cap) break;
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || e.name === "build" || e.name === "node_modules") continue;
        walk(path5.join(p, e.name), depth + 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".kt")) {
        out.push(path5.join(p, e.name));
      }
    }
  }
  walk(startPath, 0);
  return out;
}
function collectWorkspaceSignals(cwd, motionContract) {
  const dirtyMotionFiles = [];
  let gitStatusAvailable = false;
  try {
    const proc = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      cwd,
      encoding: "utf8",
      timeout: 2e3
    });
    if (proc.status === 0 && typeof proc.stdout === "string") {
      gitStatusAvailable = true;
      for (const rawLine of proc.stdout.split(/\r?\n/)) {
        if (rawLine.length < 4) continue;
        const statusCode = rawLine.slice(0, 2).trim();
        let relPath = rawLine.slice(3).trim();
        if (relPath.includes(" -> ")) relPath = relPath.split(" -> ").pop().trim();
        relPath = relPath.replace(/^"|"$/g, "");
        const lower = relPath.toLowerCase();
        if (lower === "motion.md") {
          dirtyMotionFiles.push({ file: normalizePosixPath(relPath), status: statusCode, touchesMotionApis: true });
          continue;
        }
        if (lower.endsWith(".kt")) {
          const full = path5.resolve(cwd, relPath);
          let touchesMotionApis = false;
          try {
            if (fs4.existsSync(full) && fs4.statSync(full).size <= 512 * 1024) {
              touchesMotionApis = MOTION_API_HINT_RE.test(fs4.readFileSync(full, "utf8"));
            }
          } catch {
          }
          if (touchesMotionApis) {
            dirtyMotionFiles.push({ file: normalizePosixPath(relPath), status: statusCode, touchesMotionApis: true });
          }
        }
      }
    }
  } catch {
  }
  const openSpecs = (motionContract?.specs || []).filter((s) => s.status === "OPEN").map((s) => ({ name: s.name, line: s.line }));
  const suggestedActions = [];
  if (dirtyMotionFiles.length > 0) {
    suggestedActions.push(
      `Review or verify ${dirtyMotionFiles.length} modified motion file(s): ${dirtyMotionFiles.slice(0, 3).map((d) => d.file).join(", ")}`
    );
  }
  if (!motionContract?.present) {
    suggestedActions.push("Audit existing repository motion conventions into a MOTION.md draft (`improve-android-motion` / `npx android-ux detect --stats .`).");
  } else if (openSpecs.length > 0) {
    suggestedActions.push(`Resolve ${openSpecs.length} [OPEN] spec decision(s) in ${motionContract.path}: ${openSpecs.map((o) => o.name).join(", ")}.`);
  }
  return {
    gitStatusAvailable,
    dirtyMotionFiles,
    openContractSpecs: openSpecs,
    suggestedActions
  };
}
async function runContextCommand(rawArgs, io = defaultIo2()) {
  const args = [...rawArgs];
  if (args[0] === "context") args.shift();
  let target = null;
  let includeSignals = false;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      io.stdout.write(CONTEXT_USAGE);
      return 0;
    }
    if (a === "--json") {
      json = true;
    } else if (a === "--signals") {
      includeSignals = true;
    } else if (a === "--target" || a.startsWith("--target=")) {
      const val = a.includes("=") ? a.slice("--target=".length) : args[++i];
      if (!val || val.startsWith("--")) {
        io.stderr.write("Error: --target requires a file or directory path.\n");
        return 1;
      }
      target = val;
    } else {
      io.stderr.write(`Error: unknown context option "${a}". Run android-ux context --help.
`);
      return 1;
    }
  }
  const ctx = gatherProjectContext({
    cwd: io.cwd,
    target,
    includeSignals,
    env: io.env
  });
  if (ctx.error) {
    io.stderr.write(`Error: ${ctx.error}
`);
    return 1;
  }
  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope("context", ctx), null, 2)}
`);
    return 0;
  }
  const lines = [];
  const mc = ctx.contracts.motion;
  if (mc.present) {
    lines.push(`MOTION.md: ${mc.path} (${mc.lineCount} lines${mc.withinLineCap ? "" : ", OVER 80-LINE CAP"})`);
    lines.push(`  Tags: DECIDED=${mc.counts.DECIDED}, OBSERVED=${mc.counts.OBSERVED}, OPEN=${mc.counts.OPEN}`);
    if (mc.designSystem) lines.push(`  Design system (quoted): ${mc.designSystem}`);
    if (mc.exceptions?.length) {
      lines.push(`  Exceptions: ${mc.exceptions.map((e) => e.symbol || e.raw).join(", ")}`);
    }
  } else {
    lines.push("MOTION.md: not present");
  }
  lines.push(
    `Facts: material3=${ctx.facts.material3}, motionScheme=${ctx.facts.motionScheme}, navigationCompose=${ctx.facts.navigationCompose}, navigation3=${ctx.facts.navigation3}, lottieCompose=${ctx.facts.lottieCompose}`
  );
  lines.push(`Hooks: ${ctx.hooks.active ? `active (${ctx.hooks.manifests.join(", ")})` : "inactive"}`);
  if (ctx.directives.length > 0) {
    lines.push(`Directives: ${ctx.directives.join(", ")}`);
  }
  if (ctx.signals) {
    lines.push(`Dirty motion files: ${ctx.signals.dirtyMotionFiles.length > 0 ? ctx.signals.dirtyMotionFiles.map((d) => d.file).join(", ") : "(none)"}`);
    if (ctx.signals.suggestedActions.length > 0) {
      lines.push("Suggested next steps:");
      for (const s of ctx.signals.suggestedActions) {
        lines.push(`  - ${s}`);
      }
    }
  }
  io.stdout.write(`${lines.join("\n")}
`);
  return 0;
}
function defaultIo2() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr
  };
}

// cli/src/commands/ignores.mjs
import fs5 from "node:fs";
import path6 from "node:path";
var IGNORES_USAGE = `Usage: android-ux ignores <list|add|remove|prune> [options]

Manage narrow, auditable static-detector waivers in .android-ux/config.json (shared)
or .android-ux/config.local.json (personal, excluded via <gitdir>/info/exclude).

Subcommands:
  list [--json]
      List configured waivers and their live freshness status (used, proven-unused, unknown, expired).

  add <RULE_ID> --reason "<why>" [--file <path-or-glob>]... [--value "<substr>"]
      [--kind waiver|false-positive] [--expires YYYY-MM-DD] [--shared|--local] [--json]
      Add or update a waiver. Floor and obligation rules (F-*, O-*) cannot be waived as
      design preferences: they only accept --kind false-positive scoped to explicit --file path(s).

  remove <RULE_ID> [--file <path-or-glob>]... [--value "<substr>"] [--shared|--local] [--json]
      Remove matching waiver entries.

  prune [--shared|--local] [--yes] [--dry-run] [--json]
      Remove proven-unused and expired waivers (defaults to personal config.local.json;
      pass --yes or --shared to also prune committed team waivers in config.json).
`;
async function runIgnoresCommand(rawArgs, io = defaultIo3()) {
  const args = [...rawArgs];
  if (args[0] === "ignores" || args[0] === "ignore") args.shift();
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout.write(IGNORES_USAGE);
    return 0;
  }
  const sub = args[0] && !args[0].startsWith("--") ? args.shift().toLowerCase() : "list";
  if (!["list", "add", "remove", "prune"].includes(sub)) {
    io.stderr.write(`Error: unknown ignores subcommand "${sub}". Valid: list, add, remove, prune
`);
    return 1;
  }
  if (sub === "list") return handleList(args, io);
  if (sub === "add") return handleAdd(args, io);
  if (sub === "remove") return handleRemove(args, io);
  return handlePrune(args, io);
}
function handleList(args, io) {
  const json = args.includes("--json");
  const config = readProjectConfig(io.cwd);
  let auditEntries = [];
  if (config.waivers.length > 0) {
    const scan = runStaticScan({ targets: [io.cwd], cwd: io.cwd });
    auditEntries = scan.waiverAudit;
  }
  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope("ignores.list", {
      waivers: auditEntries.map((a) => ({
        ...a.waiver,
        source: a.source,
        usageStatus: a.usageStatus,
        expired: a.expired,
        missingFiles: a.missingFiles,
        issues: a.issues
      }))
    }), null, 2)}
`);
    return 0;
  }
  if (auditEntries.length === 0) {
    io.stdout.write("No waivers configured (.android-ux/config*.json).\n");
    return 0;
  }
  for (const a of auditEntries) {
    const w = a.waiver;
    const scopeStr = w.files?.length ? ` files=[${w.files.join(", ")}]` : " (project-wide)";
    const valStr = w.value ? ` value="${w.value}"` : "";
    const expStr = w.expiresAt ? ` expires=${w.expiresAt}` : "";
    const statusTag = a.issues.length > 0 ? `${a.usageStatus}; ${a.issues.join(", ")}` : a.usageStatus;
    io.stdout.write(`[${a.source}] ${w.rule} (${w.kind})${scopeStr}${valStr}${expStr} -> ${statusTag}
  Reason: ${w.reason}
`);
  }
  return 0;
}
function handleAdd(args, io) {
  let ruleId = null;
  let reason = "";
  let value = "";
  let kind = null;
  let expiresAt = "";
  let scopeFlag = null;
  let json = false;
  const files = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") {
      json = true;
    } else if (a === "--shared") {
      if (scopeFlag === "local") {
        io.stderr.write("Error: pass only one of --shared or --local\n");
        return 1;
      }
      scopeFlag = "shared";
    } else if (a === "--local") {
      if (scopeFlag === "shared") {
        io.stderr.write("Error: pass only one of --shared or --local\n");
        return 1;
      }
      scopeFlag = "local";
    } else if (a === "--reason" || a.startsWith("--reason=")) {
      reason = a.includes("=") ? a.slice("--reason=".length) : args[++i] || "";
    } else if (a === "--value" || a.startsWith("--value=")) {
      value = a.includes("=") ? a.slice("--value=".length) : args[++i] || "";
    } else if (a === "--kind" || a.startsWith("--kind=")) {
      kind = a.includes("=") ? a.slice("--kind=".length) : args[++i] || "";
    } else if (a === "--expires" || a.startsWith("--expires=")) {
      expiresAt = a.includes("=") ? a.slice("--expires=".length) : args[++i] || "";
    } else if (a === "--file" || a === "--files" || a.startsWith("--file=") || a.startsWith("--files=")) {
      const f = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i] || "";
      if (!f || f.startsWith("--")) {
        io.stderr.write("Error: --file requires a non-empty path or glob\n");
        return 1;
      }
      files.push(normalizePosixPath(f));
    } else if (a.startsWith("--")) {
      io.stderr.write(`Error: unknown option "${a}" for ignores add
`);
      return 1;
    } else if (!ruleId) {
      ruleId = a.trim().toUpperCase();
    } else {
      io.stderr.write(`Error: unexpected positional argument "${a}"
`);
      return 1;
    }
  }
  if (!ruleId) {
    io.stderr.write('Error: missing <RULE_ID>. Example: npx android-ux ignores add T-002 --file app/Legacy.kt --reason "Legacy screen frozen until Q3"\n');
    return 1;
  }
  const ruleMeta = findRuleById(ruleId);
  if (!ruleMeta) {
    io.stderr.write(`Error: unknown rule ID "${ruleId}". Run \`npx android-ux detect --list-rules\` to view valid rule IDs.
`);
    return 1;
  }
  if (!reason.trim()) {
    io.stderr.write('Error: --reason "<why>" is mandatory when adding a waiver.\n');
    return 1;
  }
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    io.stderr.write("Error: --expires must use YYYY-MM-DD format.\n");
    return 1;
  }
  const effectiveKind = kind ? kind.trim().toLowerCase() : ruleMeta.overridable ? "waiver" : null;
  if (!effectiveKind || !["waiver", "false-positive"].includes(effectiveKind)) {
    io.stderr.write(
      `Error: rule ${ruleId} (${ruleMeta.class}) is not overridable as a design waiver. Only --kind false-positive with explicit --file <path> is permitted on floor and obligation rules.
`
    );
    return 1;
  }
  const normalizedFiles = [];
  if (!ruleMeta.overridable) {
    if (effectiveKind !== "false-positive") {
      io.stderr.write(
        `Error: rule ${ruleId} (${ruleMeta.class}) cannot be waived with --kind waiver. If suppressing a scanner false positive, pass --kind false-positive and an explicit --file <path>.
`
      );
      return 1;
    }
    if (files.length === 0 || files.some((f) => /[*?[\]{}]/.test(f))) {
      io.stderr.write(
        `Error: false-positive suppression for ${ruleId} (${ruleMeta.class}) requires an explicit literal --file <path> (globs/wildcards are not allowed).
`
      );
      return 1;
    }
    const resolvedRoot = path6.resolve(io.cwd);
    for (const f of files) {
      const abs = path6.resolve(resolvedRoot, f);
      const rel = path6.relative(resolvedRoot, abs);
      let isFile = false;
      try {
        isFile = fs5.existsSync(abs) && fs5.statSync(abs).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile || !rel || rel.startsWith("..") || path6.isAbsolute(rel)) {
        io.stderr.write(
          `Error: false-positive --file "${f}" for ${ruleId} must resolve to an existing file inside ${resolvedRoot}.
`
        );
        return 1;
      }
      normalizedFiles.push(normalizePosixPath(rel));
    }
  } else {
    const resolvedRoot = path6.resolve(io.cwd);
    for (const f of files) {
      if (!/[*?[\]{}]/.test(f)) {
        const abs = path6.resolve(resolvedRoot, f);
        const rel = path6.relative(resolvedRoot, abs);
        if (rel && !rel.startsWith("..") && !path6.isAbsolute(rel) && fs5.existsSync(abs)) {
          normalizedFiles.push(normalizePosixPath(rel));
          continue;
        }
      }
      normalizedFiles.push(f);
    }
  }
  const isLocal = scopeFlag === "local";
  const entry = normalizeWaiverEntry({
    rule: ruleId,
    ...value.trim() ? { value: value.trim() } : {},
    ...normalizedFiles.length > 0 ? { files: normalizedFiles } : {},
    kind: effectiveKind,
    reason: reason.trim(),
    createdAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    standardsVersion: STANDARDS_VERSION,
    ...expiresAt ? { expiresAt } : {}
  }, isLocal ? "local" : "shared");
  const rawObj = readEditableConfigObject(io.cwd, { local: isLocal });
  const existingWaivers = Array.isArray(rawObj.waivers) ? rawObj.waivers.map((x) => normalizeWaiverEntry(x)).filter(Boolean) : [];
  const targetKey = waiverKey(entry);
  const idx = existingWaivers.findIndex((x) => waiverKey(x) === targetKey);
  if (idx !== -1) {
    existingWaivers[idx] = entry;
  } else {
    existingWaivers.push(entry);
  }
  rawObj.waivers = existingWaivers;
  const writtenPath = writeConfigObject(io.cwd, rawObj, { local: isLocal });
  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope("ignores.add", {
      file: writtenPath,
      waiver: entry
    }), null, 2)}
`);
  } else {
    io.stdout.write(`Saved ${effectiveKind} for ${ruleId} in ${isLocal ? ".android-ux/config.local.json" : ".android-ux/config.json"}.
`);
  }
  return 0;
}
function handleRemove(args, io) {
  let ruleId = null;
  let value = null;
  let scopeFlag = null;
  let json = false;
  const files = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--shared") scopeFlag = "shared";
    else if (a === "--local") scopeFlag = "local";
    else if (a === "--value" || a.startsWith("--value=")) {
      value = a.includes("=") ? a.slice("--value=".length) : args[++i] || "";
    } else if (a === "--file" || a === "--files" || a.startsWith("--file=") || a.startsWith("--files=")) {
      const f = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i] || "";
      if (f) files.push(normalizePosixPath(f));
    } else if (!a.startsWith("--") && !ruleId) {
      ruleId = a.trim().toUpperCase();
    } else {
      io.stderr.write(`Error: unknown or unexpected argument "${a}"
`);
      return 1;
    }
  }
  if (!ruleId) {
    io.stderr.write("Error: pass <RULE_ID> to ignores remove.\n");
    return 1;
  }
  const targetsToEdit = scopeFlag === "local" ? [true] : scopeFlag === "shared" ? [false] : [false, true];
  let removedCount = 0;
  for (const isLocal of targetsToEdit) {
    const cfgPath = isLocal ? getLocalConfigPath(io.cwd) : getSharedConfigPath(io.cwd);
    if (!fs5.existsSync(cfgPath)) continue;
    const rawObj = readEditableConfigObject(io.cwd, { local: isLocal });
    if (!Array.isArray(rawObj.waivers) || rawObj.waivers.length === 0) continue;
    const sortedFiles = [...files].sort().join("");
    const kept = [];
    for (const raw of rawObj.waivers) {
      const norm = normalizeWaiverEntry(raw);
      if (!norm) continue;
      const matchesRule = norm.rule === ruleId;
      const matchesVal = value === null || (norm.value || "") === value;
      const matchesFiles = files.length === 0 || (norm.files || []).join("") === sortedFiles;
      if (matchesRule && matchesVal && matchesFiles) {
        removedCount += 1;
      } else {
        kept.push(norm);
      }
    }
    if (kept.length !== rawObj.waivers.length) {
      rawObj.waivers = kept;
      cleanupOrWriteConfig(io.cwd, rawObj, isLocal, cfgPath);
    }
  }
  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope("ignores.remove", { removedCount }), null, 2)}
`);
  } else {
    io.stdout.write(`Removed ${removedCount} waiver(s) matching ${ruleId}.
`);
  }
  return 0;
}
function pruneStaleWaivers(cwd, { scopeFlag = null, includeShared = false, dryRun = false } = {}) {
  const config = readProjectConfig(cwd);
  if (config.waivers.length === 0) {
    return { pruned: [], skippedShared: [], keptCount: 0 };
  }
  const scan = runStaticScan({ targets: [cwd], cwd });
  const pruneKeysBySource = { shared: /* @__PURE__ */ new Set(), local: /* @__PURE__ */ new Set() };
  const pruned = [];
  const skippedShared = [];
  const allowShared = scopeFlag === "shared" || !scopeFlag && includeShared;
  for (const audit of scan.waiverAudit) {
    const allFilesMissing = audit.usageStatus !== "used" && Array.isArray(audit.waiver.files) && audit.waiver.files.length > 0 && audit.missingFiles.length === audit.waiver.files.length;
    const shouldPrune = audit.expired || audit.usageStatus !== "used" && (allFilesMissing || audit.usageStatus === "proven-unused");
    if (!shouldPrune) continue;
    if (scopeFlag && audit.source !== scopeFlag) continue;
    const item = {
      ...audit.waiver,
      source: audit.source,
      pruneReason: audit.expired ? "expired" : allFilesMissing ? "missing-file" : "proven-unused"
    };
    if (audit.source === "shared" && !allowShared) {
      skippedShared.push(item);
      continue;
    }
    pruneKeysBySource[audit.source].add(waiverKey(audit.waiver));
    pruned.push(item);
  }
  if (!dryRun) {
    for (const [sourceName, keySet] of Object.entries(pruneKeysBySource)) {
      if (keySet.size === 0) continue;
      const isLocal = sourceName === "local";
      const cfgPath = isLocal ? getLocalConfigPath(cwd) : getSharedConfigPath(cwd);
      if (!fs5.existsSync(cfgPath)) continue;
      const rawObj = readEditableConfigObject(cwd, { local: isLocal });
      if (!Array.isArray(rawObj.waivers)) continue;
      rawObj.waivers = rawObj.waivers.map((x) => normalizeWaiverEntry(x)).filter((w) => w && !keySet.has(waiverKey(w)));
      cleanupOrWriteConfig(cwd, rawObj, isLocal, cfgPath);
    }
  }
  return {
    pruned,
    skippedShared,
    keptCount: config.waivers.length - pruned.length
  };
}
function handlePrune(args, io) {
  let scopeFlag = null;
  let includeShared = false;
  let dryRun = false;
  let json = false;
  for (const a of args) {
    if (a === "--json") json = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--yes" || a === "-y") includeShared = true;
    else if (a === "--shared") scopeFlag = "shared";
    else if (a === "--local") scopeFlag = "local";
    else {
      io.stderr.write(`Error: unknown option "${a}" for ignores prune
`);
      return 1;
    }
  }
  const res = pruneStaleWaivers(io.cwd, { scopeFlag, includeShared, dryRun });
  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope("ignores.prune", {
      dryRun,
      prunedCount: res.pruned.length,
      skippedSharedCount: res.skippedShared.length,
      keptCount: res.keptCount,
      pruned: res.pruned,
      skippedShared: res.skippedShared
    }), null, 2)}
`);
  } else if (res.pruned.length === 0 && res.skippedShared.length === 0) {
    io.stdout.write("No proven-unused or expired waivers to prune.\n");
  } else {
    if (res.pruned.length > 0) {
      io.stdout.write(`${dryRun ? "Would prune" : "Pruned"} ${res.pruned.length} stale waiver(s) (${res.keptCount} active remaining).
`);
    }
    if (res.skippedShared.length > 0) {
      io.stdout.write(`Skipped ${res.skippedShared.length} stale shared waiver(s) in .android-ux/config.json; pass --yes (or --shared) to prune committed team waivers.
`);
    }
  }
  return 0;
}
function cleanupOrWriteConfig(cwd, rawObj, isLocal, cfgPath) {
  const hasWaivers = Array.isArray(rawObj.waivers) && rawObj.waivers.length > 0;
  const hasIgnoreFiles = Array.isArray(rawObj.ignoreFiles) && rawObj.ignoreFiles.length > 0;
  const hasHook = rawObj.hook && typeof rawObj.hook === "object" && Object.keys(rawObj.hook).length > 0;
  if (!hasWaivers) delete rawObj.waivers;
  if (!hasWaivers && !hasIgnoreFiles && !hasHook) {
    try {
      fs5.unlinkSync(cfgPath);
      const dir = fs5.readdirSync(fs5.realpathSync(cfgPath.replace(/[/\\][^/\\]+$/, "")));
      if (dir.length === 0) {
        fs5.rmdirSync(cfgPath.replace(/[/\\][^/\\]+$/, ""));
      }
    } catch {
    }
    return;
  }
  writeConfigObject(cwd, rawObj, { local: isLocal });
}
function defaultIo3() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr
  };
}

// cli/src/commands/trace.mjs
import { spawnSync as spawnSync2 } from "node:child_process";
import fs6 from "node:fs";
import os from "node:os";
import path7 from "node:path";
var TRACE_USAGE = `Usage:
  android-ux trace [options] <trace.perfetto-trace...>
  android-ux trace [options] --compare <before.perfetto-trace...> -- <after.perfetto-trace...>

Summarize UI-thread (Choreographer#doFrame + Compose recompose/measure/draw), RenderThread
(DrawFrame, saveLayer, shader cache misses, dequeueBuffer), and SurfaceFlinger FrameTimeline
jank from Perfetto traces using Perfetto's trace_processor_shell.

Options:
  --process <substr>           Process name substring filter (e.g. com.example.app)
  --window <NAME:START:END>    Explicit window in seconds relative to trace start (repeatable)
  --burst-gap-ms <ms>          Idle gap in ms used to split auto-detected bursts (default: 800)
  --budget-ms <ms>             Frame budget in ms (default: 8.33 for 120 Hz)
  --top <N>                    Max over-budget UI frames to expand per window (default: 3)
  --trace-processor <path>     Explicit path to trace_processor_shell / trace_processor
  --timeout-ms <ms>            Per-query timeout in milliseconds (default: 60000)
  --compare <before> -- <after> Compare before vs after traces across matched windows/bursts
  --json                       Emit a single JSON document on stdout
  --help, -h                   Show this help message
`;
function parseRfc4180Csv(csvText) {
  if (!csvText || !String(csvText).trim()) return [];
  const text = String(csvText);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (inQuotes || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r += 1) {
    const vals = rows[r];
    if (vals.length === 1 && vals[0] === "") continue;
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = vals[c] ?? "";
    }
    out.push(obj);
  }
  return out;
}
function parseWindowSpec(spec) {
  const parts = String(spec || "").split(":");
  if (parts.length !== 3 || !parts[0] || !parts[1].trim() || !parts[2].trim()) {
    throw new Error(`Invalid --window '${spec}'; expected NAME:START_SEC:END_SEC`);
  }
  const startSec = Number(parts[1]);
  const endSec = Number(parts[2]);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    throw new Error(`Invalid numeric window bounds in '${spec}'`);
  }
  if (endSec <= startSec) {
    throw new Error(`Window end must exceed start in '${spec}'`);
  }
  return { name: parts[0], startSec, endSec };
}
var _dv = new DataView(new ArrayBuffer(8));
function roundHalfEvenFixed(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(num);
  _dv.setFloat64(0, num, false);
  const bits = _dv.getBigUint64(0, false);
  const sign = bits >> 63n === 1n;
  const rawExp = Number(bits >> 52n & 0x7ffn);
  const frac = bits & (1n << 52n) - 1n;
  let q = 0n;
  if (rawExp !== 0 || frac !== 0n) {
    const sig = rawExp === 0 ? frac : 1n << 52n | frac;
    const exp2 = (rawExp === 0 ? -1022 : rawExp - 1023) - 52;
    const numPow5 = sig * 5n ** BigInt(digits);
    const shift = exp2 + digits;
    if (shift >= 0) {
      q = numPow5 << BigInt(shift);
    } else {
      const k = BigInt(-shift);
      q = numPow5 >> k;
      const half = 1n << k - 1n;
      const rem = numPow5 & (1n << k) - 1n;
      if (rem > half || rem === half && (q & 1n) === 1n) {
        q += 1n;
      }
    }
  }
  const rawDigits = q.toString();
  let formatted;
  if (digits === 0) {
    formatted = rawDigits;
  } else {
    const padded = rawDigits.padStart(digits + 1, "0");
    const splitAt = padded.length - digits;
    formatted = `${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`;
  }
  return sign ? `-${formatted}` : formatted;
}
function isPythonPerfettoWrapper(binPath) {
  if (!binPath) return false;
  let fd = null;
  try {
    fd = fs6.openSync(binPath, "r");
    const buf = Buffer.alloc(128);
    const bytesRead = fs6.readSync(fd, buf, 0, 128, 0);
    const head = buf.subarray(0, bytesRead).toString("utf8");
    const firstLine = head.split(/\r?\n/)[0] || "";
    return firstLine.startsWith("#!") && /python/i.test(firstLine);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs6.closeSync(fd);
      } catch {
      }
    }
  }
}
function resolveTraceProcessor({
  explicitPath = null,
  env = process.env,
  platform = process.platform,
  existsFile = null,
  isWrapper = isPythonPerfettoWrapper
} = {}) {
  let wrapperPath = null;
  const fileCheck = existsFile || ((p) => fs6.existsSync(p) && fs6.statSync(p).isFile());
  const checkCandidate = (candidatePath) => {
    try {
      if (!fileCheck(candidatePath)) return null;
      if (isWrapper(candidatePath)) {
        if (!wrapperPath) wrapperPath = candidatePath;
        return null;
      }
      return candidatePath;
    } catch {
      return null;
    }
  };
  if (explicitPath) {
    const resolved = path7.resolve(explicitPath);
    const nativeBin = checkCandidate(resolved);
    return { binaryPath: nativeBin, wrapperPath };
  }
  if (env.ANDROID_UX_TRACE_PROCESSOR) {
    const envPath = path7.resolve(env.ANDROID_UX_TRACE_PROCESSOR);
    const nativeBin = checkCandidate(envPath);
    if (nativeBin || wrapperPath) {
      return { binaryPath: nativeBin, wrapperPath };
    }
  }
  const home = platform === "win32" ? env.USERPROFILE || env.HOME || os.homedir() : env.HOME || env.USERPROFILE || os.homedir();
  if (home) {
    const prebuiltsDir = path7.join(home, ".local", "share", "perfetto", "prebuilts");
    try {
      if (fs6.existsSync(prebuiltsDir) && fs6.statSync(prebuiltsDir).isDirectory()) {
        const candidates = fs6.readdirSync(prebuiltsDir).filter((name) => name.startsWith("trace_processor_shell") && !name.endsWith(".sha256")).map((name) => {
          const full = path7.join(prebuiltsDir, name);
          try {
            const st = fs6.statSync(full);
            return st.isFile() ? { full, mtimeMs: st.mtimeMs } : null;
          } catch {
            return null;
          }
        }).filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
        for (const c of candidates) {
          const nativeBin = checkCandidate(c.full);
          if (nativeBin) return { binaryPath: nativeBin, wrapperPath: null };
        }
      }
    } catch {
    }
  }
  const rawPath = String(env.PATH ?? env.Path ?? "");
  const pathSep = platform === "win32" ? ";" : ":";
  const pathDirs = rawPath.split(pathSep).filter(Boolean);
  const binNames = platform === "win32" ? ["trace_processor_shell.exe", "trace_processor.exe", "trace_processor_shell", "trace_processor"] : ["trace_processor_shell", "trace_processor"];
  const joiner = platform === "win32" ? path7.win32.join : path7.posix.join;
  for (const dir of pathDirs) {
    for (const bin of binNames) {
      const full = joiner(dir, bin);
      const nativeBin = checkCandidate(full);
      if (nativeBin) return { binaryPath: nativeBin, wrapperPath };
    }
  }
  return { binaryPath: null, wrapperPath };
}
var _sqlSeq = 0;
function createShellSqlRunner(binaryPath, tracePath, { timeoutMs = 6e4 } = {}) {
  let queryCount = 0;
  return {
    get queryCount() {
      return queryCount;
    },
    query(sql) {
      queryCount += 1;
      const sqlStmt = sql.trim().endsWith(";") ? sql : `${sql.trim()};
`;
      let tmpSqlPath = null;
      let args;
      try {
        _sqlSeq += 1;
        tmpSqlPath = path7.join(os.tmpdir(), `android-ux-tp-${process.pid}-${Date.now()}-${_sqlSeq}.sql`);
        fs6.writeFileSync(tmpSqlPath, sqlStmt, "utf8");
        args = ["-q", tmpSqlPath, String(tracePath)];
      } catch {
        tmpSqlPath = null;
        args = ["-Q", sqlStmt, String(tracePath)];
      }
      try {
        const proc = spawnSync2(binaryPath, args, {
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: 64 * 1024 * 1024
        });
        if (proc.error) {
          throw new Error(`trace_processor_shell execution failed: ${proc.error.message}`);
        }
        if (proc.status !== 0) {
          const detail = (proc.stderr || proc.stdout || "").trim() || `exit code ${proc.status}`;
          throw new Error(`trace_processor_shell query failed: ${detail}`);
        }
        return parseRfc4180Csv(proc.stdout);
      } finally {
        if (tmpSqlPath) {
          try {
            fs6.unlinkSync(tmpSqlPath);
          } catch {
          }
        }
      }
    }
  };
}
function sqlEscapeLikeLiteral(substr) {
  return String(substr || "").replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/'/g, "''");
}
function detectBurstsFromFrameTimes(timesSec, gapSec, minFrames = 5) {
  const bursts = [];
  for (const t of timesSec) {
    if (bursts.length === 0 || t - bursts[bursts.length - 1][bursts[bursts.length - 1].length - 1] > gapSec) {
      bursts.push([t]);
    } else {
      bursts[bursts.length - 1].push(t);
    }
  }
  const windows = [];
  let idx = 1;
  for (const b of bursts) {
    if (b.length < minFrames) continue;
    windows.push({
      name: `burst_${idx}`,
      startSec: Math.max(0, b[0] - 0.02),
      endSec: b[b.length - 1] + 0.05
    });
    idx += 1;
  }
  return windows.length > 0 ? windows : [{ name: "full_trace", startSec: 0, endSec: 9999 }];
}
function analyzeTraceWithRunner(runner, traceName, {
  processSubstr = "",
  explicitWindows = [],
  burstGapMs = 800,
  budgetMs = 8.33,
  topN = 3
} = {}) {
  const procFilter = processSubstr ? `AND p.name LIKE '%${sqlEscapeLikeLiteral(processSubstr)}%' ESCAPE '\\'` : "";
  const pass1Sql = `
WITH bounds AS (SELECT start_ts, end_ts FROM trace_bounds)
SELECT
  'bounds' AS kind,
  CAST(start_ts AS TEXT) AS c1,
  CAST(end_ts AS TEXT) AS c2,
  '' AS c3,
  '' AS c4,
  '' AS c5,
  '' AS c6
FROM bounds
UNION ALL
SELECT
  'avail' AS kind,
  CAST((SELECT COUNT(*) FROM actual_frame_timeline_slice) AS TEXT) AS c1,
  CAST((SELECT COUNT(*) FROM slice WHERE name IN ('Recomposer:recompose', 'AndroidOwner:measureAndLayout', 'AndroidOwner:draw')) AS TEXT) AS c2,
  CAST((SELECT COUNT(*) FROM actual_frame_timeline_slice a JOIN process p USING (upid) WHERE 1 = 1 ${procFilter}) AS TEXT) AS c3,
  '' AS c4,
  '' AS c5,
  '' AS c6
UNION ALL
SELECT
  'doframe' AS kind,
  CAST(s.id AS TEXT) AS c1,
  CAST(s.ts AS TEXT) AS c2,
  CAST(s.dur AS TEXT) AS c3,
  CAST(s.track_id AS TEXT) AS c4,
  CAST((s.ts - (SELECT start_ts FROM bounds)) / 1e9 AS TEXT) AS c5,
  CAST(s.dur / 1e6 AS TEXT) AS c6
FROM slice s
JOIN thread_track tt ON s.track_id = tt.id
JOIN thread t USING (utid)
JOIN process p USING (upid)
WHERE t.is_main_thread = 1
  ${procFilter}
  AND s.name LIKE 'Choreographer#doFrame%'
  AND NOT EXISTS (
    SELECT 1 FROM slice parent_s
    WHERE parent_s.id = s.parent_id AND parent_s.name LIKE 'Choreographer#doFrame%'
  )
`;
  const pass1Rows = runner.query(pass1Sql);
  let startTsNs = 0n;
  let endTsNs = 0n;
  let frameTimelineTotalRows = 0;
  let frameTimelineProcessRows = 0;
  let composeSlicesTotalRows = 0;
  const doFrames = [];
  for (const r of pass1Rows) {
    if (r.kind === "bounds") {
      startTsNs = safeBigInt(r.c1);
      endTsNs = safeBigInt(r.c2);
    } else if (r.kind === "avail") {
      frameTimelineTotalRows = Number(r.c1 || 0);
      composeSlicesTotalRows = Number(r.c2 || 0);
      frameTimelineProcessRows = r.c3 !== void 0 && r.c3 !== "" ? Number(r.c3 || 0) : frameTimelineTotalRows;
    } else if (r.kind === "doframe") {
      const tsNs = safeBigInt(r.c2);
      const durNs = safeBigInt(r.c3);
      const sqlTSec = r.c5 !== void 0 && r.c5 !== "" ? Number(r.c5) : null;
      const sqlDurMs = r.c6 !== void 0 && r.c6 !== "" ? Number(r.c6) : null;
      doFrames.push({
        id: r.c1,
        tsNs,
        durNs,
        trackId: r.c4,
        sqlTSec: Number.isFinite(sqlTSec) ? sqlTSec : null,
        sqlDurMs: Number.isFinite(sqlDurMs) ? sqlDurMs : null
      });
    }
  }
  doFrames.sort((a, b) => a.tsNs < b.tsNs ? -1 : a.tsNs > b.tsNs ? 1 : 0);
  const decoratedFrames = doFrames.map((f) => ({
    ...f,
    tSec: f.sqlTSec !== null ? f.sqlTSec : Number(f.tsNs - startTsNs) / 1e9,
    durMs: f.sqlDurMs !== null ? f.sqlDurMs : Number(f.durNs) / 1e6
  }));
  const windows = explicitWindows.length > 0 ? explicitWindows : detectBurstsFromFrameTimes(
    decoratedFrames.map((f) => f.tSec),
    burstGapMs / 1e3
  );
  const windowPlans = windows.map((w, wIdx) => {
    const inWin = decoratedFrames.filter((f) => f.tSec >= w.startSec && f.tSec <= w.endSec).sort((a, b) => b.durNs > a.durNs ? 1 : b.durNs < a.durNs ? -1 : 0);
    const overBudgetFrames = inWin.filter((f) => f.durMs > budgetMs);
    const over16Frames = inWin.filter((f) => f.durMs > 16.67);
    const maxUiMs = inWin.length > 0 ? inWin[0].durMs : 0;
    const topSlow = overBudgetFrames.slice(0, Math.max(0, topN));
    return {
      wIdx,
      window: w,
      frameCount: inWin.length,
      overBudget: overBudgetFrames.length,
      over16: over16Frames.length,
      maxUiMs,
      topSlow
    };
  });
  const unionParts = [];
  for (const wp of windowPlans) {
    const { wIdx, window: w } = wp;
    unionParts.push(`
SELECT
  'rt' AS kind,
  '${wIdx}' AS tag,
  CAST(COUNT(CASE WHEN s.name LIKE 'DrawFrame%' THEN 1 END) AS TEXT) AS v1,
  CAST(COUNT(CASE WHEN s.name LIKE 'DrawFrame%' AND s.dur / 1e6 > ${budgetMs} THEN 1 END) AS TEXT) AS v2,
  CAST(COALESCE(MAX(CASE WHEN s.name LIKE 'DrawFrame%' THEN s.dur / 1e6 END), 0) AS TEXT) AS v3,
  CAST(COUNT(CASE WHEN s.name LIKE '%alpha caused saveLayer%' THEN 1 END) AS TEXT) AS v4,
  CAST(COUNT(CASE WHEN s.name LIKE 'CreateGraphicsPipeline-CompileAfterCacheMiss%' THEN 1 END) AS TEXT) AS v5,
  CAST(COALESCE(SUM(CASE WHEN s.name LIKE 'CreateGraphicsPipeline-CompileAfterCacheMiss%' THEN s.dur / 1e6 END), 0) AS TEXT) AS v6,
  CAST(COALESCE(MAX(CASE WHEN s.name LIKE 'dequeueBuffer%' THEN s.dur / 1e6 END), 0) AS TEXT) AS v7
FROM slice s
JOIN thread_track tt ON s.track_id = tt.id
JOIN thread t USING (utid)
JOIN process p USING (upid)
WHERE t.name = 'RenderThread'
  ${procFilter}
  AND (s.ts - (SELECT start_ts FROM bounds)) / 1e9 BETWEEN ${w.startSec} AND ${w.endSec}
`);
    if (frameTimelineProcessRows > 0) {
      unionParts.push(`
SELECT
  'sf' AS kind,
  '${wIdx}' AS tag,
  CAST(COUNT(*) AS TEXT) AS v1,
  CAST(COALESCE(SUM(CASE WHEN a.jank_type GLOB '*App Deadline Missed*' THEN 1 ELSE 0 END), 0) AS TEXT) AS v2,
  CAST(COALESCE(SUM(CASE WHEN a.jank_type != 'None' AND a.jank_type != 'Buffer Stuffing' THEN 1 ELSE 0 END), 0) AS TEXT) AS v3,
  CAST(COALESCE(SUM(CASE WHEN a.on_time_finish = 0 THEN 1 ELSE 0 END), 0) AS TEXT) AS v4,
  '' AS v5,
  '' AS v6,
  '' AS v7
FROM actual_frame_timeline_slice a
JOIN process p USING (upid)
WHERE 1 = 1
  ${procFilter}
  AND (a.ts - (SELECT start_ts FROM bounds)) / 1e9 BETWEEN ${w.startSec} AND ${w.endSec}
`);
    }
    wp.topSlow.forEach((sf, rank) => {
      const endNs = sf.tsNs + sf.durNs;
      unionParts.push(`
SELECT
  'sub' AS kind,
  '${wIdx}:${rank}' AS tag,
  name AS v1,
  CAST(SUM(dur) / 1e6 AS TEXT) AS v2,
  '' AS v3,
  '' AS v4,
  '' AS v5,
  '' AS v6,
  '' AS v7
FROM slice
WHERE track_id = ${sf.trackId}
  AND ts >= ${sf.tsNs.toString()}
  AND ts + dur <= ${endNs.toString()}
  AND name IN (
    'Recomposer:recompose',
    'AndroidOwner:measureAndLayout',
    'AndroidOwner:draw',
    'relayoutWindow#first=true'
  )
GROUP BY name
`);
    });
  }
  const rtByWin = /* @__PURE__ */ new Map();
  const sfByWin = /* @__PURE__ */ new Map();
  const subByKey = /* @__PURE__ */ new Map();
  if (unionParts.length > 0) {
    const pass2Sql = `WITH bounds AS (SELECT start_ts FROM trace_bounds)
${unionParts.join("\nUNION ALL\n")}`;
    const pass2Rows = runner.query(pass2Sql);
    for (const r of pass2Rows) {
      if (r.kind === "rt") {
        rtByWin.set(Number(r.tag), {
          drawCount: Number(r.v1 || 0),
          overBudget: Number(r.v2 || 0),
          maxMs: Number(r.v3 || 0),
          saveLayers: Number(r.v4 || 0),
          shaderMisses: Number(r.v5 || 0),
          shaderMs: Number(r.v6 || 0),
          maxDequeueMs: Number(r.v7 || 0)
        });
      } else if (r.kind === "sf") {
        sfByWin.set(Number(r.tag), {
          available: true,
          frames: Number(r.v1 || 0),
          appJank: Number(r.v2 || 0),
          anyJank: Number(r.v3 || 0),
          late: Number(r.v4 || 0)
        });
      } else if (r.kind === "sub") {
        if (!subByKey.has(r.tag)) subByKey.set(r.tag, {});
        subByKey.get(r.tag)[r.v1] = Number(r.v2 || 0);
      }
    }
  }
  const sfUnavailableStatus = frameTimelineTotalRows > 0 ? "no-frames-for-process" : "unavailable";
  const windowResults = windowPlans.map((wp) => {
    const rt = rtByWin.get(wp.wIdx) || {
      drawCount: 0,
      overBudget: 0,
      maxMs: 0,
      saveLayers: 0,
      shaderMisses: 0,
      shaderMs: 0,
      maxDequeueMs: 0
    };
    const sf = frameTimelineProcessRows > 0 ? sfByWin.get(wp.wIdx) || { available: true, frames: 0, appJank: 0, anyJank: 0, late: 0 } : { available: false, status: sfUnavailableStatus };
    const slowFrames = wp.topSlow.map((f, rank) => {
      const subs = subByKey.get(`${wp.wIdx}:${rank}`) || {};
      return {
        tSec: f.tSec,
        doFrameMs: f.durMs,
        recomposeMs: subs["Recomposer:recompose"] ?? 0,
        measureMs: subs["AndroidOwner:measureAndLayout"] ?? 0,
        drawMs: subs["AndroidOwner:draw"] ?? 0,
        relayoutWindowFirstMs: subs["relayoutWindow#first=true"] ?? 0
      };
    });
    return {
      name: wp.window.name,
      startSec: wp.window.startSec,
      endSec: wp.window.endSec,
      ui: {
        frames: wp.frameCount,
        overBudget: wp.overBudget,
        over16Ms: wp.over16,
        maxMs: wp.maxUiMs
      },
      renderThread: rt,
      frameTimeline: sf,
      slowFrames
    };
  });
  return {
    trace: traceName,
    boundsNs: {
      start: startTsNs.toString(),
      end: endTsNs.toString()
    },
    tracks: {
      frameTimeline: frameTimelineProcessRows > 0 ? "available" : sfUnavailableStatus,
      composeSlicesPresent: composeSlicesTotalRows > 0
    },
    budgetMs,
    queryPasses: runner.queryCount,
    windows: windowResults
  };
}
function safeBigInt(val) {
  const s = String(val ?? "").trim();
  if (!s) return 0n;
  try {
    return BigInt(s.split(".")[0]);
  } catch {
    return 0n;
  }
}
function formatTraceSummaryText(summary) {
  const lines = [`=== ${summary.trace} ===`];
  const budgetLabel = roundHalfEvenFixed(summary.budgetMs, 1);
  for (const w of summary.windows) {
    const sfText = w.frameTimeline.available ? `SF: frames=${w.frameTimeline.frames}, appJank=${w.frameTimeline.appJank}, anyJank=${w.frameTimeline.anyJank}, late=${w.frameTimeline.late}` : w.frameTimeline.status === "no-frames-for-process" ? "SF: unavailable (0 actual_frame_timeline_slice rows matched target --process)" : "SF: unavailable (actual_frame_timeline_slice not recorded in trace)";
    lines.push(
      `  [${w.name} ${roundHalfEvenFixed(w.startSec, 2)}..${roundHalfEvenFixed(w.endSec, 2)}s] UI: ${w.ui.frames} frames, >${budgetLabel}ms=${w.ui.overBudget}, >16.7ms=${w.ui.over16Ms}, max=${roundHalfEvenFixed(w.ui.maxMs, 2)}ms | RT: max=${roundHalfEvenFixed(w.renderThread.maxMs, 2)}ms, >${budgetLabel}ms=${w.renderThread.overBudget}, saveLayers=${w.renderThread.saveLayers}, shaderMisses=${w.renderThread.shaderMisses} (${roundHalfEvenFixed(w.renderThread.shaderMs, 2)}ms), maxDequeue=${roundHalfEvenFixed(w.renderThread.maxDequeueMs, 2)}ms | ` + sfText
    );
    for (const sf of w.slowFrames) {
      lines.push(
        `    t=${roundHalfEvenFixed(sf.tSec, 3)}s doFrame=${roundHalfEvenFixed(sf.doFrameMs, 2)}ms (recompose=${roundHalfEvenFixed(sf.recomposeMs, 2)}ms, measure=${roundHalfEvenFixed(sf.measureMs, 2)}ms, draw=${roundHalfEvenFixed(sf.drawMs, 2)}ms)`
      );
    }
  }
  return lines.join("\n");
}
function compareTraceSummaries(beforeSummaries, afterSummaries) {
  const beforeByWin = collectWindowMedianOrMean(beforeSummaries);
  const afterByWin = collectWindowMedianOrMean(afterSummaries);
  const matchedNames = [];
  for (const name of beforeByWin.keys()) {
    if (afterByWin.has(name)) matchedNames.push(name);
  }
  const pairs = [];
  if (matchedNames.length > 0) {
    for (const name of matchedNames) {
      pairs.push({ window: name, before: beforeByWin.get(name), after: afterByWin.get(name) });
    }
  } else if (beforeByWin.size === 1 && afterByWin.size === 1) {
    const [bName, bVal] = [...beforeByWin.entries()][0];
    const [aName, aVal] = [...afterByWin.entries()][0];
    pairs.push({ window: `${bName} -> ${aName}`, before: bVal, after: aVal });
  }
  return pairs.map(({ window, before, after }) => ({
    window,
    before,
    after,
    delta: {
      uiOverBudget: after.uiOverBudget - before.uiOverBudget,
      uiOver16Ms: after.uiOver16Ms - before.uiOver16Ms,
      uiMaxMs: round2(after.uiMaxMs - before.uiMaxMs),
      rtOverBudget: after.rtOverBudget - before.rtOverBudget,
      rtMaxMs: round2(after.rtMaxMs - before.rtMaxMs),
      saveLayers: after.saveLayers - before.saveLayers,
      shaderMisses: after.shaderMisses - before.shaderMisses,
      appJank: before.sfAvailable && after.sfAvailable ? after.appJank - before.appJank : "unavailable",
      anyJank: before.sfAvailable && after.sfAvailable ? after.anyJank - before.anyJank : "unavailable"
    }
  }));
}
function collectWindowMedianOrMean(summaries) {
  const buckets = /* @__PURE__ */ new Map();
  for (const s of summaries) {
    for (const w of s.windows) {
      if (!buckets.has(w.name)) buckets.set(w.name, []);
      buckets.get(w.name).push(w);
    }
  }
  const agg = /* @__PURE__ */ new Map();
  for (const [name, list] of buckets.entries()) {
    const avg = (fn) => round2(list.reduce((acc, x) => acc + fn(x), 0) / list.length);
    const sfAvail = list.every((x) => x.frameTimeline.available && x.frameTimeline.frames > 0);
    agg.set(name, {
      runs: list.length,
      uiFrames: avg((x) => x.ui.frames),
      uiOverBudget: avg((x) => x.ui.overBudget),
      uiOver16Ms: avg((x) => x.ui.over16Ms),
      uiMaxMs: avg((x) => x.ui.maxMs),
      rtOverBudget: avg((x) => x.renderThread.overBudget),
      rtMaxMs: avg((x) => x.renderThread.maxMs),
      saveLayers: avg((x) => x.renderThread.saveLayers),
      shaderMisses: avg((x) => x.renderThread.shaderMisses),
      sfAvailable: sfAvail,
      appJank: sfAvail ? avg((x) => x.frameTimeline.appJank) : null,
      anyJank: sfAvail ? avg((x) => x.frameTimeline.anyJank) : null
    });
  }
  return agg;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
async function runTraceCommand(rawArgs, io = defaultIo4()) {
  const args = [...rawArgs];
  if (args[0] === "trace") args.shift();
  let processSubstr = "";
  const explicitWindows = [];
  let burstGapMs = 800;
  let budgetMs = 8.33;
  let topN = 3;
  let explicitTp = null;
  let timeoutMs = 6e4;
  let json = false;
  let compareMode = false;
  let seenDoubleDash = false;
  const tracesBefore = [];
  const tracesAfter = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!seenDoubleDash && (a === "--help" || a === "-h")) {
      io.stdout.write(TRACE_USAGE);
      return 0;
    }
    if (a === "--") {
      seenDoubleDash = true;
      continue;
    }
    if (!seenDoubleDash && a === "--json") {
      json = true;
    } else if (!seenDoubleDash && a === "--compare") {
      compareMode = true;
    } else if (!seenDoubleDash && (a === "--process" || a.startsWith("--process="))) {
      processSubstr = a.includes("=") ? a.slice("--process=".length) : args[++i] ?? "";
    } else if (!seenDoubleDash && (a === "--window" || a.startsWith("--window="))) {
      const val = a.includes("=") ? a.slice("--window=".length) : args[++i];
      try {
        explicitWindows.push(parseWindowSpec(val));
      } catch (err) {
        io.stderr.write(`Error: ${err.message}
`);
        return 1;
      }
    } else if (!seenDoubleDash && (a === "--burst-gap-ms" || a.startsWith("--burst-gap-ms="))) {
      const val = Number(a.includes("=") ? a.slice("--burst-gap-ms=".length) : args[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        io.stderr.write("Error: --burst-gap-ms must be a positive number.\n");
        return 1;
      }
      burstGapMs = val;
    } else if (!seenDoubleDash && (a === "--budget-ms" || a.startsWith("--budget-ms="))) {
      const val = Number(a.includes("=") ? a.slice("--budget-ms=".length) : args[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        io.stderr.write("Error: --budget-ms must be a positive number.\n");
        return 1;
      }
      budgetMs = val;
    } else if (!seenDoubleDash && (a === "--top" || a.startsWith("--top="))) {
      const val = Number.parseInt(a.includes("=") ? a.slice("--top=".length) : args[++i], 10);
      if (!Number.isFinite(val) || val < 0) {
        io.stderr.write("Error: --top must be a non-negative integer.\n");
        return 1;
      }
      topN = val;
    } else if (!seenDoubleDash && (a === "--trace-processor" || a.startsWith("--trace-processor="))) {
      explicitTp = a.includes("=") ? a.slice("--trace-processor=".length) : args[++i];
    } else if (!seenDoubleDash && (a === "--timeout-ms" || a.startsWith("--timeout-ms="))) {
      const val = Number.parseInt(a.includes("=") ? a.slice("--timeout-ms=".length) : args[++i], 10);
      if (!Number.isFinite(val) || val <= 0) {
        io.stderr.write("Error: --timeout-ms must be a positive integer.\n");
        return 1;
      }
      timeoutMs = val;
    } else if (!seenDoubleDash && a.startsWith("--")) {
      io.stderr.write(`Error: unknown trace option "${a}". Run android-ux trace --help.
`);
      return 1;
    } else if (seenDoubleDash) {
      tracesAfter.push(a);
    } else {
      tracesBefore.push(a);
    }
  }
  if (compareMode && (tracesBefore.length === 0 || tracesAfter.length === 0)) {
    io.stderr.write("Error: --compare requires at least one before trace and one after trace separated by `--`.\n  Example: npx android-ux trace --process com.app --compare before_1.perfetto-trace -- after_1.perfetto-trace\n");
    return 1;
  }
  const allTraces = compareMode ? [...tracesBefore, ...tracesAfter] : tracesBefore;
  if (allTraces.length === 0) {
    io.stderr.write("Error: pass at least one .perfetto-trace file. Run android-ux trace --help.\n");
    return 1;
  }
  for (const t of allTraces) {
    const abs = path7.resolve(io.cwd, t);
    if (!fs6.existsSync(abs) || !fs6.statSync(abs).isFile()) {
      io.stderr.write(`Error: trace file not found: ${t}
`);
      return 1;
    }
  }
  const tpResolution = resolveTraceProcessor({
    explicitPath: explicitTp ? path7.resolve(io.cwd, explicitTp) : null,
    env: io.env,
    platform: io.platform || process.platform
  });
  const tpBinary = tpResolution.binaryPath;
  if ((io.platform || process.platform) === "win32" && tpBinary && /\.(cmd|bat)$/i.test(tpBinary)) {
    const diag = createDiagnostic({
      code: "AUX-TRACE-004",
      severity: "error",
      status: "fail",
      domain: "trace",
      summary: `Perfetto trace processor resolved to a Windows batch shim (${tpBinary}), which cannot be spawned directly without cmd.exe.`,
      impact: `\`npx android-ux trace\` refuses shell-spawning .cmd/.bat shims on Windows.`,
      remediation: [
        "Pass the native `trace_processor_shell.exe` binary directly via `--trace-processor C:\\path\\to\\trace_processor_shell.exe`,",
        "or set `ANDROID_UX_TRACE_PROCESSOR` to the `.exe` path."
      ],
      docPath: "references/perfetto-workflow.md"
    });
    if (json) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope("trace", { status: "error", diagnostic: diag }), null, 2)}
`);
    } else {
      io.stderr.write(`${formatDiagnosticText(diag)}
`);
    }
    return 1;
  }
  if (!tpBinary) {
    const wrapperHint = tpResolution.wrapperPath ? `Found Python network wrapper at ${tpResolution.wrapperPath}, which \`android-ux trace\` refuses to invoke directly to stay offline-safe.` : "Perfetto trace processor (`trace_processor_shell`) is not installed or not on PATH.";
    const diag = createDiagnostic({
      code: tpResolution.wrapperPath ? "AUX-TRACE-003" : "AUX-TRACE-001",
      severity: "error",
      status: "fail",
      domain: "trace",
      summary: wrapperHint,
      searched: ["--trace-processor", "~/.local/share/perfetto/prebuilts/", "$PATH (trace_processor_shell, trace_processor)"],
      impact: `\`npx android-ux trace\` cannot analyze ${path7.basename(allTraces[0])}. (\`detect\`, \`context\`, and \`doctor\` still work.)`,
      remediation: tpResolution.wrapperPath ? [
        `Run \`"${tpResolution.wrapperPath}" --version\` once while online to cache the native binary under ~/.local/share/perfetto/prebuilts/,`,
        "or download a standalone native `trace_processor_shell` binary from https://github.com/google/perfetto/releases/latest."
      ] : (io.platform || process.platform) === "win32" ? [
        "Download windows-amd64 trace_processor_shell.exe from https://github.com/google/perfetto/releases/latest",
        "Or pass an existing binary via `--trace-processor C:\\path\\to\\trace_processor_shell.exe`."
      ] : [
        "Download native `trace_processor_shell` from https://github.com/google/perfetto/releases/latest (or run Perfetto's `get.perfetto.dev/trace_processor --version` once online to populate ~/.local/share/perfetto/prebuilts/)",
        "Or pass an existing binary via `--trace-processor /path/to/trace_processor_shell`."
      ],
      docPath: "references/perfetto-workflow.md"
    });
    if (json) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope("trace", { status: "error", diagnostic: diag }), null, 2)}
`);
    } else {
      io.stderr.write(`${formatDiagnosticText(diag)}
`);
    }
    return 1;
  }
  try {
    const analyzeList = (paths) => paths.map((t) => {
      const abs = path7.resolve(io.cwd, t);
      const runner = createShellSqlRunner(tpBinary, abs, { timeoutMs });
      return analyzeTraceWithRunner(runner, path7.basename(abs), {
        processSubstr,
        explicitWindows,
        burstGapMs,
        budgetMs,
        topN
      });
    });
    if (!compareMode) {
      const summaries = analyzeList(tracesBefore);
      if (json) {
        io.stdout.write(`${JSON.stringify(createJsonEnvelope("trace", {
          status: "ok",
          traceProcessor: tpBinary,
          traces: summaries
        }), null, 2)}
`);
      } else {
        for (const s of summaries) {
          io.stdout.write(`${formatTraceSummaryText(s)}
`);
        }
      }
      return 0;
    }
    const beforeSummaries = analyzeList(tracesBefore);
    const afterSummaries = analyzeList(tracesAfter);
    const comparisons = compareTraceSummaries(beforeSummaries, afterSummaries);
    if (json) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope("trace.compare", {
        status: "ok",
        traceProcessor: tpBinary,
        before: beforeSummaries,
        after: afterSummaries,
        comparisons
      }), null, 2)}
`);
    } else {
      for (const s of [...beforeSummaries, ...afterSummaries]) {
        io.stdout.write(`${formatTraceSummaryText(s)}
`);
      }
      io.stdout.write("=== Comparison (after - before) ===\n");
      if (comparisons.length === 0) {
        io.stdout.write("  No matching window names between before and after traces; pass explicit --window NAME:START:END to align windows.\n");
      } else {
        for (const c of comparisons) {
          const fmtDelta = (v, suffix = "") => typeof v === "number" ? `${v > 0 ? "+" : ""}${v}${suffix}` : v;
          io.stdout.write(
            `  [${c.window}] UI >budget: ${fmtDelta(c.delta.uiOverBudget)}, UI max: ${fmtDelta(c.delta.uiMaxMs, "ms")} | RT >budget: ${fmtDelta(c.delta.rtOverBudget)}, RT max: ${fmtDelta(c.delta.rtMaxMs, "ms")}, saveLayers: ${fmtDelta(c.delta.saveLayers)}, shaderMisses: ${fmtDelta(c.delta.shaderMisses)} | SF appJank: ${fmtDelta(c.delta.appJank)}, anyJank: ${fmtDelta(c.delta.anyJank)}
`
          );
        }
      }
    }
    return 0;
  } catch (err) {
    io.stderr.write(`Error: ${err?.message || String(err)}
`);
    return 1;
  }
}
function defaultIo4() {
  return {
    cwd: process.cwd(),
    env: process.env,
    platform: process.platform,
    stdout: process.stdout,
    stderr: process.stderr
  };
}

// cli/src/commands/doctor.mjs
import { spawnSync as spawnSync3 } from "node:child_process";
import fs8 from "node:fs";
import path9 from "node:path";

// cli/src/cache.mjs
import crypto from "node:crypto";
import fs7 from "node:fs";
import os2 from "node:os";
import path8 from "node:path";
var CACHE_MAX_SESSIONS = 8;
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var CLAIM_BUCKET_SEC = 600;
function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}
function resolveHomeDir(env = process.env, platform = process.platform) {
  if (platform === "win32") {
    return env.USERPROFILE || env.HOME || safeOsHomedir();
  }
  return env.HOME || env.USERPROFILE || safeOsHomedir();
}
function safeOsHomedir() {
  try {
    return os2.homedir() || "";
  } catch {
    return "";
  }
}
function resolveUserCacheDir(env = process.env, platform = process.platform) {
  if (env.ANDROID_UX_CACHE_DIR && String(env.ANDROID_UX_CACHE_DIR).trim()) {
    return path8.resolve(String(env.ANDROID_UX_CACHE_DIR).trim());
  }
  if (env.XDG_CACHE_HOME && String(env.XDG_CACHE_HOME).trim()) {
    return path8.join(path8.resolve(String(env.XDG_CACHE_HOME).trim()), "android-ux");
  }
  const home = resolveHomeDir(env, platform);
  if (platform === "win32") {
    if (env.LOCALAPPDATA && String(env.LOCALAPPDATA).trim()) {
      return path8.join(path8.resolve(String(env.LOCALAPPDATA).trim()), "android-ux", "cache");
    }
    return home ? path8.join(home, ".cache", "android-ux") : "";
  }
  if (platform === "darwin") {
    return home ? path8.join(home, "Library", "Caches", "android-ux") : "";
  }
  return home ? path8.join(home, ".cache", "android-ux") : "";
}
function ensureSafeDir(dirPath, platform = process.platform) {
  if (!dirPath) return false;
  try {
    const resolved = path8.resolve(dirPath);
    fs7.mkdirSync(resolved, { recursive: true, mode: 448 });
    const stat = fs7.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    if (platform !== "win32" && typeof process.getuid === "function") {
      if (stat.uid !== process.getuid()) return false;
    }
    return true;
  } catch {
    return false;
  }
}
function getProjectCachePath(projectRoot, env = process.env, platform = process.platform) {
  const base = resolveUserCacheDir(env, platform);
  if (!base) return "";
  return path8.join(base, "projects", `${sha256Hex(path8.resolve(projectRoot))}.json`);
}
function readProjectSessionCache(projectRoot, env = process.env, platform = process.platform, nowMs = Date.now()) {
  const filePath = getProjectCachePath(projectRoot, env, platform);
  const empty = { version: 1, projectRoot: path8.resolve(projectRoot), sessions: {} };
  if (!filePath) return empty;
  try {
    const stat = fs7.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return empty;
    const raw = JSON.parse(fs7.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object" || raw.version !== 1 || !raw.sessions || typeof raw.sessions !== "object") {
      return empty;
    }
    const prunedSessions = {};
    const entries = Object.entries(raw.sessions).filter(([, s]) => s && typeof s === "object" && typeof s.updatedAt === "number" && nowMs - s.updatedAt <= SESSION_TTL_MS).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, CACHE_MAX_SESSIONS);
    for (const [sid, session] of entries) {
      prunedSessions[sid] = session;
    }
    return {
      version: 1,
      projectRoot: path8.resolve(projectRoot),
      sessions: prunedSessions
    };
  } catch {
    return empty;
  }
}
function writeProjectSessionCache(projectRoot, cache, env = process.env, platform = process.platform, nowMs = Date.now()) {
  const filePath = getProjectCachePath(projectRoot, env, platform);
  if (!filePath) return false;
  const dir = path8.dirname(filePath);
  if (!ensureSafeDir(dir, platform)) return false;
  try {
    const entries = Object.entries(cache?.sessions || {}).filter(([, s]) => s && typeof s === "object").map(([sid, s]) => [sid, { ...s, updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : nowMs }]).filter(([, s]) => nowMs - s.updatedAt <= SESSION_TTL_MS).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, CACHE_MAX_SESSIONS);
    const normalized = {
      version: 1,
      projectRoot: path8.resolve(projectRoot),
      sessions: Object.fromEntries(entries)
    };
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs7.writeFileSync(tmp, JSON.stringify(normalized), { mode: 384 });
    fs7.renameSync(tmp, filePath);
    sweepStaleProjectCaches(dir, nowMs);
    return true;
  } catch {
    return false;
  }
}
function sweepStaleProjectCaches(projectsDir, nowMs) {
  try {
    const names = fs7.readdirSync(projectsDir).slice(0, 128);
    let removed = 0;
    for (const name of names) {
      if (removed >= 16) break;
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const full = path8.join(projectsDir, name);
      try {
        const st = fs7.lstatSync(full);
        if (st.isFile() && !st.isSymbolicLink() && nowMs - st.mtimeMs > SESSION_TTL_MS) {
          fs7.unlinkSync(full);
          removed += 1;
        }
      } catch {
      }
    }
  } catch {
  }
}
function clearProjectSessionCache(projectRoot, env = process.env, platform = process.platform) {
  const filePath = getProjectCachePath(projectRoot, env, platform);
  if (!filePath) return false;
  try {
    if (fs7.existsSync(filePath)) {
      fs7.unlinkSync(filePath);
      return true;
    }
  } catch {
  }
  return false;
}
function recordSessionRoot(sessionId, projectRoot, env = process.env, platform = process.platform, nowMs = Date.now()) {
  if (!sessionId || sessionId === "unknown" || !projectRoot) return false;
  const base = resolveUserCacheDir(env, platform);
  if (!base) return false;
  const sessionsRoot = path8.join(base, "hook-sessions");
  const sessionDir = path8.join(sessionsRoot, sha256Hex(sessionId));
  if (!ensureSafeDir(sessionDir, platform)) return false;
  const resolvedRoot = path8.resolve(projectRoot);
  const recordFile = path8.join(sessionDir, sha256Hex(resolvedRoot));
  try {
    if (!fs7.existsSync(recordFile)) {
      fs7.writeFileSync(recordFile, resolvedRoot, { flag: "wx", mode: 384 });
    }
    sweepExpiredSessionDirs(sessionsRoot, nowMs);
    return true;
  } catch (err) {
    if (err && err.code === "EEXIST") return true;
    return false;
  }
}
function listSessionRoots(sessionId, env = process.env, platform = process.platform) {
  if (!sessionId || sessionId === "unknown") return [];
  const base = resolveUserCacheDir(env, platform);
  if (!base) return [];
  const sessionDir = path8.join(base, "hook-sessions", sha256Hex(sessionId));
  try {
    const st = fs7.lstatSync(sessionDir);
    if (!st.isDirectory() || st.isSymbolicLink()) return [];
    const entries = fs7.readdirSync(sessionDir).slice(0, 16);
    const out = [];
    for (const name of entries) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      const full = path8.join(sessionDir, name);
      try {
        const fst = fs7.lstatSync(full);
        if (!fst.isFile() || fst.isSymbolicLink()) continue;
        const content = fs7.readFileSync(full, "utf8").trim();
        if (!content || !path8.isAbsolute(content)) continue;
        if (sha256Hex(content) !== name) continue;
        if (fs7.existsSync(content) && fs7.statSync(content).isDirectory()) {
          out.push(content);
        }
      } catch {
      }
    }
    return out;
  } catch {
    return [];
  }
}
function sweepExpiredSessionDirs(sessionsRoot, nowMs) {
  try {
    const names = fs7.readdirSync(sessionsRoot).slice(0, 128);
    let removed = 0;
    for (const name of names) {
      if (removed >= 16) break;
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      const dir = path8.join(sessionsRoot, name);
      try {
        const st = fs7.lstatSync(dir);
        if (!st.isDirectory() || st.isSymbolicLink()) continue;
        if (nowMs - st.mtimeMs <= SESSION_TTL_MS) continue;
        for (const child of fs7.readdirSync(dir)) {
          if (/^[a-f0-9]{64}$/.test(child)) {
            const childPath = path8.join(dir, child);
            const cst = fs7.lstatSync(childPath);
            if (cst.isFile() && !cst.isSymbolicLink()) fs7.unlinkSync(childPath);
          }
        }
        fs7.rmdirSync(dir);
        removed += 1;
      } catch {
      }
    }
  } catch {
  }
}
function claimHookEvent(sessionId, toolUseId, projectRoot, targetFiles, env = process.env, platform = process.platform, nowMs = Date.now()) {
  if (!toolUseId) return true;
  const base = resolveUserCacheDir(env, platform);
  if (!base) return true;
  const claimsRoot = path8.join(base, "hook-claims");
  if (!ensureSafeDir(claimsRoot, platform)) return true;
  const bucket = Math.floor(nowMs / 1e3 / CLAIM_BUCKET_SEC);
  const prevBucket = bucket - 1;
  const key = sha256Hex([
    sessionId || "",
    toolUseId,
    path8.resolve(projectRoot),
    ...[...targetFiles || []].map((f) => path8.resolve(f)).sort()
  ].join("\0"));
  const prevPath = path8.join(claimsRoot, String(prevBucket), key);
  try {
    if (fs7.existsSync(prevPath)) return false;
  } catch {
  }
  const bucketDir = path8.join(claimsRoot, String(bucket));
  const createdBucket = !fs7.existsSync(bucketDir);
  if (!ensureSafeDir(bucketDir, platform)) return true;
  const claimPath = path8.join(bucketDir, key);
  try {
    fs7.writeFileSync(claimPath, "", { flag: "wx", mode: 384 });
    if (createdBucket) {
      sweepOldClaimBuckets(claimsRoot, prevBucket);
    }
    return true;
  } catch (err) {
    if (err && err.code === "EEXIST") return false;
    return true;
  }
}
function sweepOldClaimBuckets(claimsRoot, minKeepBucket) {
  try {
    for (const entry of fs7.readdirSync(claimsRoot)) {
      if (!/^\d+$/.test(entry)) continue;
      if (Number(entry) >= minKeepBucket) continue;
      const dir = path8.join(claimsRoot, entry);
      try {
        const st = fs7.lstatSync(dir);
        if (!st.isDirectory() || st.isSymbolicLink()) continue;
        for (const child of fs7.readdirSync(dir)) {
          if (/^[a-f0-9]{64}$/.test(child)) {
            const p = path8.join(dir, child);
            const cst = fs7.lstatSync(p);
            if (cst.isFile() && !cst.isSymbolicLink()) fs7.unlinkSync(p);
          }
        }
        fs7.rmdirSync(dir);
      } catch {
      }
    }
  } catch {
  }
}

// cli/src/commands/doctor.mjs
var VALID_FEATURES = /* @__PURE__ */ new Set(["all", "detect", "trace", "hooks", "capture"]);
var DOCTOR_USAGE = `Usage: android-ux doctor [options]

Inspect OS/arch, Node >=20 runtime & hook /bin/sh visibility, modern android CLI,
Android SDK & adb, Perfetto trace_processor_shell (v58+), ImageMagick, ffmpeg/ffprobe,
MOTION.md git/symbol drift, .android-ux/config*.json waiver freshness, and hook manifests.

Options:
  --for <feature>          Require checks needed for: all, detect, trace, hooks, capture
                           (comma-separated; default treats optional tools as info)
  --trace-processor <path> Explicit path to trace_processor_shell when probing trace readiness
  --fix                    Repair safe mechanical drift (prune proven-unused/expired waivers,
                           remove broken android-ux hook entries, clear stale node-unsupported marker)
  --json                   Emit a single JSON document on stdout
  --help, -h               Show this help message

Exit codes:
  0  Healthy (missing optional tools are reported with install commands without failing)
  1  A check required by --for <feature> (or malformed config) failed
`;
var FRAMEWORK_MOTION_IDENTIFIERS = /* @__PURE__ */ new Set([
  "MaterialTheme",
  "motionScheme",
  "defaultEffectsSpec",
  "fastEffectsSpec",
  "slowEffectsSpec",
  "defaultSpatialSpec",
  "fastSpatialSpec",
  "slowSpatialSpec",
  "tween",
  "spring",
  "keyframes",
  "snap",
  "EnterTransition",
  "ExitTransition",
  "None",
  "fadeIn",
  "fadeOut",
  "slideInHorizontally",
  "slideOutHorizontally",
  "slideInVertically",
  "slideOutVertically",
  "scaleIn",
  "scaleOut",
  "expandVertically",
  "shrinkVertically",
  "NavHost",
  "NavDisplay",
  "AnimatedVisibility",
  "AnimatedContent",
  "Crossfade",
  "Modifier",
  "animateContentSize",
  "animateItem",
  "DECIDED",
  "OBSERVED",
  "OPEN"
]);
function detectHostProfile({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  readFile = (p) => fs8.readFileSync(p, "utf8"),
  exists = null,
  which = null
} = {}) {
  const pathExists = exists || ((p) => fs8.existsSync(p));
  const fileExists = exists || isExistingFile;
  const resolveBin = which || ((bin) => findBinaryOnPath(bin, env, platform, fileExists));
  let linuxDistro = null;
  if (platform === "linux" && pathExists("/etc/os-release")) {
    try {
      const osRel = readFile("/etc/os-release");
      const idMatch = osRel.match(/^ID=["']?([a-zA-Z0-9._-]+)["']?/m);
      const likeMatch = osRel.match(/^ID_LIKE=["']?([^\r\n"']+)["']?/m);
      linuxDistro = {
        id: idMatch ? idMatch[1].toLowerCase() : "linux",
        idLike: likeMatch ? likeMatch[1].toLowerCase() : ""
      };
    } catch {
      linuxDistro = { id: "linux", idLike: "" };
    }
  }
  const packageManagers = [];
  for (const pm of ["brew", "winget", "scoop", "apt", "dnf", "pacman", "sdkmanager", "android"]) {
    if (resolveBin(pm)) packageManagers.push(pm);
  }
  const normalizedArch = arch === "arm64" ? "arm64" : "x86_64";
  return {
    platform,
    arch,
    normalizedArch,
    linuxDistro,
    packageManagers
  };
}
function isExistingFile(filePath) {
  try {
    return fs8.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function findBinaryOnPath(binName, env = process.env, platform = process.platform, exists = isExistingFile) {
  const rawPath = String(env.PATH ?? env.Path ?? "");
  const pathSep = platform === "win32" ? ";" : ":";
  const dirs = rawPath.split(pathSep).filter(Boolean);
  if (platform === "win32") {
    const home = env.USERPROFILE || env.HOME || "";
    const localAppData = env.LOCALAPPDATA || "";
    if (home) dirs.push(path9.win32.join(home, "scoop", "shims"));
    if (localAppData) dirs.push(path9.win32.join(localAppData, "Microsoft", "WinGet", "Links"));
  }
  const exts = platform === "win32" ? /\.(exe|cmd|bat)$/i.test(binName) ? [""] : [".exe", ".cmd", ".bat", ""] : [""];
  const joiner = platform === "win32" ? path9.win32.join : path9.posix.join;
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = joiner(dir, `${binName}${ext}`);
      try {
        if (exists(candidate)) return candidate;
      } catch {
      }
    }
  }
  return null;
}
function defaultExecProbe(cmd, args, { timeoutMs = 2e3, env = process.env, cwd = process.cwd() } = {}) {
  const proc = spawnSync3(cmd, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024
  });
  return {
    error: proc.error || null,
    status: proc.status,
    stdout: proc.stdout || "",
    stderr: proc.stderr || ""
  };
}
function pickPkgInstallCommand(host, recipes) {
  const pms = new Set(host.packageManagers);
  if (host.platform === "darwin") {
    if (pms.has("brew") && recipes.brew) return recipes.brew;
    return recipes.macosFallback || recipes.brew;
  }
  if (host.platform === "win32") {
    if (pms.has("winget") && recipes.winget) return recipes.winget;
    if (pms.has("scoop") && recipes.scoop) return recipes.scoop;
    return recipes.windowsFallback || recipes.winget;
  }
  const distroStr = `${host.linuxDistro?.id || ""} ${host.linuxDistro?.idLike || ""}`;
  if ((pms.has("apt") || /\b(debian|ubuntu)\b/.test(distroStr)) && recipes.apt) return recipes.apt;
  if ((pms.has("dnf") || /\b(fedora|rhel|centos)\b/.test(distroStr)) && recipes.dnf) return recipes.dnf;
  if ((pms.has("pacman") || /\barch\b/.test(distroStr)) && recipes.pacman) return recipes.pacman;
  if (pms.has("brew") && recipes.brew) return recipes.brew;
  return recipes.linuxFallback || recipes.apt;
}
function runDoctorChecks({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.versions.node,
  requiredFeatures = /* @__PURE__ */ new Set(),
  fix = false,
  traceProcessorPath = null,
  execProbe = defaultExecProbe,
  exists = null,
  readFile = (p) => fs8.readFileSync(p, "utf8")
} = {}) {
  const customExists = exists;
  const existsFile = customExists || isExistingFile;
  exists = customExists || ((p) => fs8.existsSync(p));
  const resolvedCwd = path9.resolve(cwd);
  const host = detectHostProfile({ platform, arch, env, readFile, exists: customExists });
  const requireAll = requiredFeatures.has("all");
  const needTrace = requireAll || requiredFeatures.has("trace");
  const needHooks = requireAll || requiredFeatures.has("hooks");
  const needCapture = requireAll || requiredFeatures.has("capture");
  const checks = [];
  const fixesApplied = [];
  {
    const major = Number(String(nodeVersion).split(".")[0] || 0);
    const cacheDir = resolveUserCacheDir(env, platform);
    const unsupportedStamp = cacheDir ? path9.join(cacheDir, "node-unsupported") : "";
    const hadUnsupportedStamp = Boolean(unsupportedStamp && exists(unsupportedStamp));
    let shNodeWarning = null;
    if (platform !== "win32" && exists("/bin/sh")) {
      const shRes = execProbe("/bin/sh", ["-c", 'command -v node >/dev/null 2>&1 && node -p "parseInt(process.versions.node, 10)"'], { env, cwd: resolvedCwd });
      const shMajor = Number((shRes.stdout || "").trim());
      if (shRes.status !== 0 || !Number.isFinite(shMajor) || shMajor < 20) {
        shNodeWarning = "Default `/bin/sh` PATH does not expose Node >= 20; GUI editor hooks rely on launcher fallback paths or `ANDROID_UX_NODE`.";
      }
    }
    if (fix && major >= 20 && hadUnsupportedStamp && !shNodeWarning) {
      try {
        fs8.unlinkSync(unsupportedStamp);
        fixesApplied.push("Removed stale `node-unsupported` hook cache notice.");
      } catch {
      }
    }
    if (major < 20) {
      checks.push(createDiagnostic({
        code: "AUX-ENV-002",
        severity: "error",
        status: "fail",
        summary: `Node.js v${nodeVersion} is unsupported (requires Node >= 20).`,
        impact: "All `android-ux` CLI subcommands and hooks require Node >= 20.",
        remediation: pickPkgInstallCommand(host, {
          brew: "brew install node",
          winget: "winget install OpenJS.NodeJS.LTS",
          scoop: "scoop install nodejs-lts",
          apt: "Install Node >= 20 via fnm/nvm or NodeSource, or set ANDROID_UX_NODE=/abs/path/to/node",
          dnf: "sudo dnf install nodejs",
          pacman: "sudo pacman -S nodejs"
        }),
        extra: { id: "node-runtime", required: true }
      }));
    } else if (shNodeWarning || hadUnsupportedStamp) {
      checks.push(createDiagnostic({
        code: "AUX-ENV-003",
        severity: "warning",
        status: "warn",
        summary: `Node.js v${nodeVersion} active, with GUI hook PATH advisory.`,
        evidence: shNodeWarning || `Found prior hook fallback stamp at ${unsupportedStamp}.`,
        impact: "CLI commands work; GUI IDE hooks without shell PATH inheritance should set `ANDROID_UX_NODE` if Node lives in a custom path.",
        remediation: `Set ANDROID_UX_NODE="${process.execPath}" in your IDE/hook environment (or run \`npx android-ux doctor --fix\` once resolved).`,
        extra: { id: "node-runtime", required: needHooks }
      }));
    } else {
      checks.push({
        id: "node-runtime",
        code: "AUX-ENV-000",
        severity: "info",
        status: "pass",
        domain: "core",
        required: true,
        summary: `Node.js v${nodeVersion} (${host.platform}/${host.arch}) satisfies >= 20.`
      });
    }
  }
  {
    const androidInstallCmd = host.platform === "darwin" ? `curl -fsSL https://dl.google.com/android/cli/latest/darwin_${host.normalizedArch}/install.sh | bash` : host.platform === "win32" ? 'curl -fsSL https://dl.google.com/android/cli/latest/windows_x86_64/install.cmd -o "%TEMP%\\android-cli-install.cmd" && "%TEMP%\\android-cli-install.cmd"' : `curl -fsSL https://dl.google.com/android/cli/latest/linux_${host.normalizedArch}/install.sh | bash`;
    const androidBin = findBinaryOnPath("android", env, platform, existsFile);
    if (!androidBin) {
      checks.push(createDiagnostic({
        code: "AUX-ANDROID-001",
        severity: needCapture ? "error" : "info",
        status: needCapture ? "fail" : "info",
        summary: "Modern `android` CLI is not installed on PATH.",
        searched: "$PATH (`android`)",
        impact: "`detect`, `context`, `ignores`, `hooks`, and `trace` still work offline. Live emulator/layout workflows require `android` CLI.",
        remediation: androidInstallCmd,
        extra: { id: "android-cli", required: needCapture }
      }));
    } else {
      const verRes = execProbe(androidBin, ["--version"], { env, cwd: resolvedCwd });
      const combined = `${verRes.stdout}
${verRes.stderr}`;
      if (/The android command is no longer available/i.test(combined) || /android\.bat/i.test(combined) && /deprecated/i.test(combined)) {
        checks.push(createDiagnostic({
          code: "AUX-ANDROID-002",
          severity: needCapture ? "error" : "warning",
          status: needCapture ? "fail" : "warn",
          summary: `\`android\` on PATH points to deprecated legacy SDK \`tools/android\` (${androidBin}).`,
          evidence: combined.trim().split("\n")[0] || androidBin,
          impact: "`detect`, `context`, and `trace` still work, but `android` CLI device/SDK commands will fail.",
          remediation: [
            "Remove legacy `<SDK>/tools` from PATH (keep `<SDK>/platform-tools` and `<SDK>/cmdline-tools/latest/bin`), then install the modern `android` CLI:",
            `  ${androidInstallCmd}`
          ],
          extra: { id: "android-cli", required: needCapture }
        }));
      } else if (verRes.error || verRes.status !== 0) {
        checks.push(createDiagnostic({
          code: "AUX-ANDROID-003",
          severity: needCapture ? "error" : "warning",
          status: needCapture ? "fail" : "warn",
          summary: `\`android --version\` failed (${androidBin}).`,
          evidence: (verRes.stderr || verRes.stdout || verRes.error?.message || `exit ${verRes.status}`).trim().slice(0, 200),
          impact: "`detect`, `context`, and `trace` still work offline.",
          remediation: androidInstallCmd,
          extra: { id: "android-cli", required: needCapture }
        }));
      } else {
        const verLine = (verRes.stdout || verRes.stderr).trim().split("\n")[0] || "installed";
        checks.push({
          id: "android-cli",
          code: "AUX-ANDROID-000",
          severity: "info",
          status: "pass",
          domain: "core",
          required: needCapture,
          summary: `Modern \`android\` CLI detected (${verLine}).`
        });
      }
    }
  }
  {
    const home = resolveHomeDir(env, platform);
    const defaultSdkCandidates = platform === "darwin" ? [home && path9.join(home, "Library", "Android", "sdk")].filter(Boolean) : platform === "win32" ? [env.LOCALAPPDATA && path9.win32.join(env.LOCALAPPDATA, "Android", "Sdk")].filter(Boolean) : [home && path9.join(home, "Android", "Sdk")].filter(Boolean);
    const androidHome = env.ANDROID_HOME ? String(env.ANDROID_HOME).trim() : "";
    const androidSdkRoot = env.ANDROID_SDK_ROOT ? String(env.ANDROID_SDK_ROOT).trim() : "";
    const conflictingEnv = Boolean(androidHome && androidSdkRoot && path9.resolve(androidHome) !== path9.resolve(androidSdkRoot));
    const discoveredSdk = [androidHome, androidSdkRoot, ...defaultSdkCandidates].filter(Boolean).find((dir) => exists(dir));
    const adbBin = findBinaryOnPath("adb", env, platform, existsFile) || (discoveredSdk ? [path9.join(discoveredSdk, "platform-tools", platform === "win32" ? "adb.exe" : "adb")].find((p) => existsFile(p)) : null);
    if (!adbBin) {
      const sdkRemediation = discoveredSdk ? `export ANDROID_HOME="${discoveredSdk}" && export PATH="$ANDROID_HOME/platform-tools:$PATH"` : pickPkgInstallCommand(host, {
        brew: "brew install --cask android-platform-tools",
        winget: "winget install Google.PlatformTools",
        scoop: "scoop install adb",
        apt: "sudo apt install adb",
        dnf: "sudo dnf install android-tools",
        pacman: "sudo pacman -S android-tools"
      });
      checks.push(createDiagnostic({
        code: "AUX-ADB-001",
        severity: needCapture ? "error" : "info",
        status: needCapture ? "fail" : "info",
        summary: "`adb` (Android SDK Platform-Tools) is not installed or not on PATH.",
        searched: ["$PATH (`adb`)", "$ANDROID_HOME/platform-tools", ...defaultSdkCandidates],
        impact: "`detect`, `context`, `ignores`, `hooks`, and offline `trace` still work.",
        remediation: host.packageManagers.includes("android") ? `android sdk install platform-tools  # or: ${sdkRemediation}` : sdkRemediation,
        extra: { id: "android-sdk-adb", required: needCapture }
      }));
    } else {
      const devRes = execProbe(adbBin, ["devices", "-l"], { env, cwd: resolvedCwd });
      const lines = (devRes.stdout || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("List of devices") && !l.startsWith("*"));
      const connected = lines.filter((l) => /\sdevice(\s|$)/.test(l));
      const unauthorized = lines.filter((l) => /\sunauthorized(\s|$)/.test(l));
      const offline = lines.filter((l) => /\soffline(\s|$)/.test(l));
      const noPerm = lines.filter((l) => /no permissions/i.test(l));
      if (conflictingEnv) {
        checks.push(createDiagnostic({
          code: "AUX-ADB-002",
          severity: "warning",
          status: "warn",
          summary: "`ANDROID_HOME` and deprecated `ANDROID_SDK_ROOT` point to different directories.",
          evidence: `ANDROID_HOME="${androidHome}" vs ANDROID_SDK_ROOT="${androidSdkRoot}"`,
          impact: "Gradle and CLI tools may resolve inconsistent SDK installations.",
          remediation: "Unset deprecated `ANDROID_SDK_ROOT` and keep `ANDROID_HOME` as the single source of truth.",
          extra: { id: "android-sdk-adb", required: false }
        }));
      } else if (unauthorized.length > 0 || offline.length > 0 || noPerm.length > 0) {
        const stateNote = noPerm.length > 0 ? "USB device lacks Linux udev permissions" : unauthorized.length > 0 ? "Device is `unauthorized` (accept USB debugging RSA prompt on device)" : "Device is `offline`";
        checks.push(createDiagnostic({
          code: "AUX-ADB-003",
          severity: needCapture && connected.length === 0 ? "error" : "warning",
          status: needCapture && connected.length === 0 ? "fail" : "warn",
          summary: `\`adb\` found (${adbBin}), but device state needs attention: ${stateNote}.`,
          evidence: lines.join("; "),
          impact: "Offline static checks and trace analysis work; live device capture requires an authorized online device.",
          remediation: noPerm.length > 0 ? "Configure `/etc/udev/rules.d/51-android.rules` and reconnect USB, or run `adb kill-server && adb start-server`." : "Unlock the device and accept the USB debugging prompt, or run `adb kill-server && adb start-server`.",
          extra: { id: "android-sdk-adb", required: needCapture && connected.length === 0 }
        }));
      } else {
        const multiDeviceNote = connected.length > 1 && !env.ANDROID_SERIAL ? ` (${connected.length} devices online; set ANDROID_SERIAL when targeting a specific device)` : ` (${connected.length} online device${connected.length === 1 ? "" : "s"})`;
        checks.push({
          id: "android-sdk-adb",
          code: "AUX-ADB-000",
          severity: "info",
          status: "pass",
          domain: "core",
          required: needCapture,
          summary: `Android SDK / \`adb\` available at ${adbBin}${multiDeviceNote}.`
        });
      }
    }
  }
  {
    const tpResolution = resolveTraceProcessor({ explicitPath: traceProcessorPath, env, platform });
    const tpBin = tpResolution.binaryPath;
    const tpWrapper = tpResolution.wrapperPath;
    const tpRemediation = host.platform === "win32" ? [
      "Download `trace_processor_shell-windows-amd64.exe` from https://github.com/google/perfetto/releases/latest",
      "and place it on PATH as `trace_processor_shell.exe` (or pass `--trace-processor C:\\path\\to\\trace_processor_shell.exe`)."
    ] : [
      "Download standalone native `trace_processor_shell` from https://github.com/google/perfetto/releases/latest (or run Perfetto's `get.perfetto.dev/trace_processor --version` once online to populate `~/.local/share/perfetto/prebuilts/`)."
    ];
    if (!tpBin || !exists(tpBin)) {
      if (tpWrapper) {
        checks.push(createDiagnostic({
          code: "AUX-TRACE-003",
          severity: needTrace ? "error" : "warning",
          status: needTrace ? "fail" : "warn",
          summary: `Perfetto Python wrapper detected at ${tpWrapper}, with no cached native binary in ~/.local/share/perfetto/prebuilts/.`,
          searched: ["--trace-processor", "~/.local/share/perfetto/prebuilts/", "$PATH (`trace_processor_shell`, `trace_processor`)"],
          impact: "`doctor` and `trace` do not execute the Python wrapper directly so they stay 100% offline.",
          remediation: [
            `Run \`"${tpWrapper}" --version\` once while online to cache the native binary under ~/.local/share/perfetto/prebuilts/,`,
            "or install a standalone native `trace_processor_shell` binary from https://github.com/google/perfetto/releases/latest."
          ],
          docPath: "references/perfetto-workflow.md",
          extra: { id: "perfetto-trace-processor", required: needTrace }
        }));
      } else {
        checks.push(createDiagnostic({
          code: "AUX-TRACE-001",
          severity: needTrace ? "error" : "info",
          status: needTrace ? "fail" : "info",
          summary: "Perfetto `trace_processor_shell` is not installed or not on PATH.",
          searched: ["--trace-processor", "~/.local/share/perfetto/prebuilts/", "$PATH (`trace_processor_shell`, `trace_processor`)"],
          impact: needTrace ? "`npx android-ux trace` cannot query Perfetto traces without `trace_processor_shell`." : "`detect`, `context`, `ignores`, and `hooks` still work. Install `trace_processor_shell` when analyzing `.perfetto-trace` files.",
          remediation: tpRemediation,
          docPath: "references/perfetto-workflow.md",
          extra: { id: "perfetto-trace-processor", required: needTrace }
        }));
      }
    } else {
      const verRes = execProbe(tpBin, ["--version"], { env, cwd: resolvedCwd });
      const verText = `${verRes.stdout}
${verRes.stderr}`.trim();
      const verMatch = verText.match(/\bv?(\d+)\.\d+/i);
      const majorVer = verMatch ? Number(verMatch[1]) : null;
      if (majorVer !== null && majorVer < 58) {
        checks.push(createDiagnostic({
          code: "AUX-TRACE-002",
          severity: "warning",
          status: "warn",
          summary: `Perfetto trace processor at ${tpBin} is v${majorVer} (< v58 recommended for Android 16/17).`,
          evidence: verText.split("\n")[0],
          impact: "Older Perfetto versions may fail to parse newer Android 16/17 FrameTimeline packets.",
          remediation: tpRemediation,
          docPath: "references/perfetto-workflow.md",
          extra: { id: "perfetto-trace-processor", required: false }
        }));
      } else {
        checks.push({
          id: "perfetto-trace-processor",
          code: "AUX-TRACE-000",
          severity: "info",
          status: "pass",
          domain: "core",
          required: needTrace,
          summary: `Perfetto trace processor ready at ${tpBin}${verMatch ? ` (v${verMatch[0].replace(/^v/i, "")})` : ""}.`
        });
      }
    }
  }
  {
    let imFound = null;
    const magickBin = findBinaryOnPath("magick", env, platform, existsFile);
    if (magickBin) {
      const res = execProbe(magickBin, ["-version"], { env, cwd: resolvedCwd });
      if (/ImageMagick/i.test(`${res.stdout}
${res.stderr}`)) {
        imFound = `${magickBin} (IM7)`;
      }
    }
    if (!imFound && platform !== "win32") {
      const compareBin = findBinaryOnPath("compare", env, platform, existsFile);
      const montageBin = findBinaryOnPath("montage", env, platform, existsFile);
      if (compareBin && montageBin) {
        const res = execProbe(compareBin, ["-version"], { env, cwd: resolvedCwd });
        if (/ImageMagick/i.test(`${res.stdout}
${res.stderr}`)) {
          imFound = `${compareBin} + ${montageBin} (IM6)`;
        }
      }
    }
    if (!imFound) {
      checks.push(createDiagnostic({
        code: "AUX-MEDIA-001",
        severity: needCapture ? "error" : "info",
        status: needCapture ? "fail" : "info",
        summary: "ImageMagick (`magick`) is not installed (optional; used for visual diff & filmstrips).",
        searched: platform === "win32" ? ["$PATH (`magick.exe`, WinGet Links, Scoop shims \u2014 skipping Windows `System32\\convert.exe`)"] : ["$PATH (`magick`, `compare` + `montage`)"],
        impact: "All static checks (`detect`), `context`, `hooks`, and Perfetto `trace` work without ImageMagick.",
        remediation: pickPkgInstallCommand(host, {
          brew: "brew install imagemagick",
          winget: "winget install ImageMagick.ImageMagick",
          scoop: "scoop install imagemagick",
          apt: "sudo apt install imagemagick",
          dnf: "sudo dnf install ImageMagick",
          pacman: "sudo pacman -S imagemagick"
        }),
        extra: { id: "imagemagick", required: needCapture }
      }));
    } else {
      checks.push({
        id: "imagemagick",
        code: "AUX-MEDIA-000",
        severity: "info",
        status: "pass",
        domain: "core",
        required: needCapture,
        summary: `ImageMagick available (${imFound}).`
      });
    }
  }
  {
    const ffmpegBin = findBinaryOnPath("ffmpeg", env, platform, existsFile);
    const ffprobeBin = findBinaryOnPath("ffprobe", env, platform, existsFile);
    const ffmpegOk = Boolean(ffmpegBin && execProbe(ffmpegBin, ["-nostdin", "-version"], { env, cwd: resolvedCwd }).status === 0);
    const ffprobeOk = Boolean(ffprobeBin && execProbe(ffprobeBin, ["-nostdin", "-version"], { env, cwd: resolvedCwd }).status === 0);
    if (!ffmpegOk || !ffprobeOk) {
      const missingParts = [!ffmpegOk && "ffmpeg", !ffprobeOk && "ffprobe"].filter(Boolean).join(", ");
      checks.push(createDiagnostic({
        code: "AUX-MEDIA-002",
        severity: needCapture ? "error" : "info",
        status: needCapture ? "fail" : "info",
        summary: `FFmpeg tools missing (${missingParts}) (optional; used for screenrecord frame extraction).`,
        searched: "$PATH (`ffmpeg`, `ffprobe`)",
        impact: "All static checks (`detect`), `context`, `hooks`, and Perfetto `trace` work without FFmpeg.",
        remediation: pickPkgInstallCommand(host, {
          brew: "brew install ffmpeg",
          winget: "winget install Gyan.FFmpeg",
          scoop: "scoop install ffmpeg",
          apt: "sudo apt install ffmpeg",
          dnf: "sudo dnf install ffmpeg-free  # (or full ffmpeg via RPM Fusion)",
          pacman: "sudo pacman -S ffmpeg"
        }),
        extra: { id: "ffmpeg", required: needCapture }
      }));
    } else {
      checks.push({
        id: "ffmpeg",
        code: "AUX-MEDIA-003",
        severity: "info",
        status: "pass",
        domain: "core",
        required: needCapture,
        summary: `\`ffmpeg\` and \`ffprobe\` available (${ffmpegBin}).`
      });
    }
  }
  {
    const cfgBefore = readProjectConfig(resolvedCwd);
    if (cfgBefore.meta.sharedMalformed || cfgBefore.meta.localMalformed) {
      const badPath = cfgBefore.meta.sharedMalformed ? cfgBefore.meta.sharedPath : cfgBefore.meta.localPath;
      checks.push(createDiagnostic({
        code: "AUX-CONFIG-001",
        severity: "error",
        status: "fail",
        file: normalizePosixPath(path9.relative(resolvedCwd, badPath)),
        summary: `Malformed JSON in ${normalizePosixPath(path9.relative(resolvedCwd, badPath))}.`,
        impact: "Project waivers and hook preferences in this file cannot be applied until valid JSON is restored.",
        remediation: `Fix JSON syntax in ${normalizePosixPath(path9.relative(resolvedCwd, badPath))}.`,
        extra: { id: "repo-config-waivers", required: true }
      }));
    } else {
      if (fix && cfgBefore.waivers.length > 0) {
        const pruneRes = pruneStaleWaivers(resolvedCwd, { includeShared: false });
        if (pruneRes.pruned.length > 0) {
          fixesApplied.push(`Pruned ${pruneRes.pruned.length} stale/expired local waiver(s) from .android-ux/config.local.json.`);
        }
      }
      const cfgAfter = readProjectConfig(resolvedCwd);
      if (cfgAfter.waivers.length > 0) {
        const scan = runStaticScan({ targets: [resolvedCwd], cwd: resolvedCwd });
        const staleItems = scan.waiverAudit.filter((a) => a.issues.length > 0);
        if (staleItems.length > 0) {
          const hasSharedStale = staleItems.some((a) => a.source === "shared");
          checks.push(createDiagnostic({
            code: "AUX-CONFIG-002",
            severity: "warning",
            status: "warn",
            summary: `${staleItems.length} stale waiver(s) detected in .android-ux/config*.json.`,
            evidence: staleItems.map((a) => `${a.waiver.rule} (${a.issues.join(", ")})`).join("; "),
            impact: "Stale waivers accumulate config noise after underlying code is refactored or rules change.",
            remediation: hasSharedStale ? "Run `npx android-ux ignores prune --yes` to prune proven-unused/expired waivers across both personal and shared config." : "Run `npx android-ux ignores prune` (or `npx android-ux doctor --fix`) to clean up proven-unused and expired local waivers.",
            extra: { id: "repo-config-waivers", required: false }
          }));
        } else {
          checks.push({
            id: "repo-config-waivers",
            code: "AUX-CONFIG-000",
            severity: "info",
            status: "pass",
            domain: "core",
            required: false,
            summary: `${cfgAfter.waivers.length} configured waiver(s) verified fresh.`
          });
        }
      } else {
        checks.push({
          id: "repo-config-waivers",
          code: "AUX-CONFIG-000",
          severity: "info",
          status: "pass",
          domain: "core",
          required: false,
          summary: "Zero-footprint config state (no stale waivers)."
        });
      }
    }
  }
  {
    const motionMdPath = path9.join(resolvedCwd, "MOTION.md");
    if (exists(motionMdPath)) {
      let content = "";
      try {
        content = readFile(motionMdPath);
      } catch {
        content = "";
      }
      const parsed = parseMotionMd(content, motionMdPath);
      const driftNotes = [];
      if (exists(path9.join(resolvedCwd, ".git"))) {
        const lastTouch = execProbe("git", ["log", "-1", "--format=%H", "--", "MOTION.md"], { env, cwd: resolvedCwd });
        const sha = (lastTouch.stdout || "").trim();
        if (lastTouch.status === 0 && /^[0-9a-f]{7,40}$/i.test(sha)) {
          const ktCommits = execProbe("git", ["rev-list", "--count", `${sha}..HEAD`, "--", "*.kt"], { env, cwd: resolvedCwd });
          const commitCount = Number((ktCommits.stdout || "").trim());
          if (ktCommits.status === 0 && Number.isFinite(commitCount) && commitCount >= 25) {
            driftNotes.push(`${commitCount} commits modified .kt files since MOTION.md was last updated`);
          }
        }
      }
      const referencedSymbols = /* @__PURE__ */ new Set();
      for (const spec of parsed.specs) {
        for (const id of extractCandidateProjectSymbols(spec.binding)) referencedSymbols.add(id);
      }
      for (const exc of parsed.exceptions) {
        for (const id of extractCandidateProjectSymbols(exc.symbol)) referencedSymbols.add(id);
      }
      if (referencedSymbols.size > 0) {
        const walked = walkScannableFiles(resolvedCwd, { cwd: resolvedCwd });
        const ktPaths = walked.files.filter((f) => f.toLowerCase().endsWith(".kt"));
        if (ktPaths.length > 0) {
          const allKtContent = ktPaths.map((p) => {
            try {
              return readFile(p);
            } catch {
              return "";
            }
          }).join("\n");
          const missingSymbols = [...referencedSymbols].filter((sym) => !allKtContent.includes(sym));
          if (missingSymbols.length > 0) {
            driftNotes.push(`referenced symbol(s) not found in .kt sources: ${missingSymbols.join(", ")}`);
          }
        }
      }
      if (parsed.lintFindings.length > 0 || driftNotes.length > 0) {
        const issues = [
          ...parsed.lintFindings.map((f) => `${f.rule}: ${f.evidence}`),
          ...driftNotes.map((d) => `motion-md-drift: ${d}`)
        ];
        checks.push(createDiagnostic({
          code: "AUX-CONTRACT-001",
          severity: "warning",
          status: "warn",
          file: "MOTION.md",
          summary: `MOTION.md has ${issues.length} structural or drift warning(s).`,
          evidence: issues.join(" | "),
          impact: "Outdated or malformed MOTION.md specs can mislead motion reviews and builds.",
          remediation: "Run `/improve-android-motion` (or `npx android-ux detect MOTION.md`) to refresh MOTION.md.",
          extra: { id: "motion-md-health", required: false }
        }));
      } else {
        checks.push({
          id: "motion-md-health",
          code: "AUX-CONTRACT-000",
          severity: "info",
          status: "pass",
          domain: "motion",
          required: false,
          summary: `MOTION.md valid (${parsed.lineCount} lines, ${parsed.specs.length} spec(s)).`
        });
      }
    }
  }
  {
    const hookIssues = inspectAndOptionallyFixHookManifests(resolvedCwd, { fix, exists, readFile, fixesApplied });
    if (hookIssues.length > 0) {
      checks.push(createDiagnostic({
        code: "AUX-HOOK-001",
        severity: needHooks ? "error" : "warning",
        status: needHooks ? "fail" : "warn",
        summary: `${hookIssues.length} broken or malformed hook manifest entry(ies) detected.`,
        evidence: hookIssues.join("; "),
        impact: "Broken hook paths either no-op silently or fail harness startup validation.",
        remediation: "Run `npx android-ux hooks on` or `npx android-ux doctor --fix` to repair or remove stale android-ux hook entries.",
        extra: { id: "hook-manifests", required: needHooks }
      }));
    } else {
      checks.push({
        id: "hook-manifests",
        code: "AUX-HOOK-000",
        severity: "info",
        status: "pass",
        domain: "core",
        required: needHooks,
        summary: "Hook manifests healthy."
      });
    }
  }
  const failedRequired = checks.filter((c) => c.status === "fail");
  return {
    host,
    checks,
    fixesApplied,
    healthy: failedRequired.length === 0,
    exitCode: failedRequired.length > 0 ? 1 : 0
  };
}
function extractCandidateProjectSymbols(text) {
  if (!text) return [];
  const results = [];
  const identMatches = String(text).matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g);
  for (const m of identMatches) {
    const id = m[1];
    if (id.length < 4) continue;
    if (FRAMEWORK_MOTION_IDENTIFIERS.has(id)) continue;
    if (/^[A-Z]/.test(id) || /(Motion|Spec|Host|Nav|Pager|Carousel|Banner|Sheet|Card)/.test(id)) {
      results.push(id);
    }
  }
  return results;
}
function inspectAndOptionallyFixHookManifests(cwd, { fix, exists, readFile, fixesApplied }) {
  const candidates = [
    { rel: "hooks.json", editable: false },
    { rel: "hooks/hooks.json", editable: false },
    { rel: ".claude/settings.local.json", editable: true },
    { rel: ".claude/settings.json", editable: true },
    { rel: ".cursor/hooks.json", editable: true },
    { rel: ".codex/hooks.json", editable: true },
    { rel: ".github/hooks/android-ux.json", editable: true },
    { rel: ".gemini/hooks.json", editable: true },
    { rel: "_agents/hooks.json", editable: true }
  ];
  const issues = [];
  for (const item of candidates) {
    const full = path9.join(cwd, item.rel);
    if (!exists(full)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFile(full));
    } catch {
      issues.push(`${item.rel}: invalid JSON`);
      continue;
    }
    const cmdStrings = collectEnabledHookCommands(parsed);
    const brokenCmds = [];
    for (const cmd of cmdStrings) {
      const info = extractLocalHookLauncherInfo(cmd, cwd, full);
      if (!info.invokesHook) continue;
      if (info.localPath && !exists(info.localPath)) {
        brokenCmds.push(info.localPath);
      }
    }
    if (brokenCmds.length > 0) {
      if (fix && item.editable) {
        const cleaned = removeBrokenAndroidUxHooks(parsed, cwd, full, exists);
        try {
          if (cleaned === null) {
            fs8.unlinkSync(full);
          } else {
            fs8.writeFileSync(full, `${JSON.stringify(cleaned, null, 2)}
`, "utf8");
          }
          fixesApplied.push(`Cleaned broken android-ux hook entry from ${item.rel}.`);
          continue;
        } catch {
        }
      }
      issues.push(`${item.rel}: hook-script-missing (${brokenCmds.map((p) => normalizePosixPath(path9.relative(cwd, p))).join(", ")})`);
    }
  }
  return issues;
}
function removeBrokenAndroidUxHooks(parsed, repoRoot, manifestPath, exists) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const isBrokenObj = (h) => {
    const cmd = h?.command || h?.bash;
    if (typeof cmd !== "string") return false;
    const info = extractLocalHookLauncherInfo(cmd, repoRoot, manifestPath);
    return Boolean(info.invokesHook && info.localPath && !exists(info.localPath));
  };
  const clone = JSON.parse(JSON.stringify(parsed));
  if (clone["android-ux"]) {
    delete clone["android-ux"];
  }
  if (clone.hooks && typeof clone.hooks === "object") {
    for (const [evt, list] of Object.entries(clone.hooks)) {
      if (!Array.isArray(list)) continue;
      clone.hooks[evt] = list.map((entry) => {
        if (Array.isArray(entry?.hooks)) {
          const kept = entry.hooks.filter((h) => !isBrokenObj(h));
          return kept.length > 0 ? { ...entry, hooks: kept } : null;
        }
        return isBrokenObj(entry) ? null : entry;
      }).filter(Boolean);
      if (clone.hooks[evt].length === 0) delete clone.hooks[evt];
    }
    if (Object.keys(clone.hooks).length === 0 && Object.keys(clone).every((k) => k === "hooks" || k === "version")) {
      return null;
    }
  }
  return clone;
}
async function runDoctorCommand(rawArgs, io = defaultIo5()) {
  const args = [...rawArgs];
  if (args[0] === "doctor") args.shift();
  let json = false;
  let fix = false;
  let showHelp = false;
  let traceProcessorPath = null;
  const requiredFeatures = /* @__PURE__ */ new Set();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      showHelp = true;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--fix") {
      fix = true;
    } else if (a === "--for" || a.startsWith("--for=")) {
      const val = a.includes("=") ? a.slice("--for=".length) : args[++i];
      if (!val || val.startsWith("--")) {
        io.stderr.write("Error: --for requires a feature name (all, detect, trace, hooks, capture)\n");
        return 1;
      }
      for (const part of val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        if (!VALID_FEATURES.has(part)) {
          io.stderr.write(`Error: unknown --for feature "${part}". Valid: all, detect, trace, hooks, capture
`);
          return 1;
        }
        requiredFeatures.add(part);
      }
    } else if (a === "--trace-processor" || a.startsWith("--trace-processor=")) {
      traceProcessorPath = a.includes("=") ? a.slice("--trace-processor=".length) : args[++i];
    } else {
      io.stderr.write(`Error: unknown doctor option "${a}". Run android-ux doctor --help.
`);
      return 1;
    }
  }
  if (showHelp) {
    io.stdout.write(DOCTOR_USAGE);
    return 0;
  }
  const report = runDoctorChecks({
    cwd: io.cwd,
    env: io.env,
    platform: io.platform || process.platform,
    arch: io.arch || process.arch,
    requiredFeatures,
    fix,
    traceProcessorPath,
    execProbe: io.execProbe || defaultExecProbe,
    exists: io.exists || ((p) => fs8.existsSync(p)),
    readFile: io.readFile || ((p) => fs8.readFileSync(p, "utf8"))
  });
  if (json) {
    const payload = createJsonEnvelope("doctor", {
      healthy: report.healthy,
      host: report.host,
      requiredFeatures: [...requiredFeatures],
      fixesApplied: report.fixesApplied,
      checks: report.checks
    });
    io.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
    return report.exitCode;
  }
  const out = [];
  out.push(`android-ux doctor (${report.host.platform}/${report.host.arch})`);
  if (report.fixesApplied.length > 0) {
    for (const msg of report.fixesApplied) {
      out.push(`  [FIXED] ${msg}`);
    }
  }
  out.push("");
  for (const check of report.checks) {
    if (check.status === "pass") {
      out.push(`[PASS] ${check.summary}`);
    } else if (check.status === "info") {
      out.push(`[INFO ${check.code}] ${check.summary}`);
      if (check.impact) out.push(`  Note: ${check.impact}`);
      if (check.remediation) {
        const remLines = Array.isArray(check.remediation) ? check.remediation : String(check.remediation).split("\n");
        out.push(`  Install: ${remLines[0]}`);
        for (let k = 1; k < remLines.length; k += 1) out.push(`           ${remLines[k]}`);
      }
    } else {
      out.push(formatDiagnosticText(check));
    }
  }
  io.stdout.write(`${out.join("\n")}
`);
  return report.exitCode;
}
function defaultIo5() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr
  };
}

// cli/src/commands/hook.mjs
import { spawnSync as spawnSync4 } from "node:child_process";
import fs9 from "node:fs";
import path10 from "node:path";
import { fileURLToPath } from "node:url";
var EDIT_CAP_PER_FILE = 6;
var CURSOR_MAX_CHARS = 9500;
var GENERATED_OR_SENSITIVE_RE = /(?:^|\/)(?:\.git|\.gradle|build|node_modules|dist|out|\.env(?:\..+)?|secrets?|credentials)(?:\/|$)/i;
function isTruthyEnv(val) {
  if (!val) return false;
  const s = String(val).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || /^\d+$/.test(s) && Number(s) > 0;
}
function resolveWorkspaceEntry(entry) {
  if (typeof entry !== "string") return "";
  const trimmed = entry.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("file://")) {
    try {
      return path10.resolve(fileURLToPath(trimmed));
    } catch {
      return "";
    }
  }
  return path10.resolve(trimmed);
}
function normalizeWorkspaceRoots(rawRoots, fallbackRoot) {
  const resolved = [];
  if (Array.isArray(rawRoots)) {
    for (const entry of rawRoots) {
      const r = resolveWorkspaceEntry(entry);
      if (r && !resolved.includes(r)) resolved.push(r);
    }
  }
  if (resolved.length === 0) {
    resolved.push(path10.resolve(fallbackRoot));
  }
  return resolved;
}
function resolveCandidatePathAgainstRoots(candidate, roots, defaultBase) {
  if (typeof candidate !== "string") return "";
  const trimmed = candidate.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("file://")) {
    try {
      return path10.resolve(fileURLToPath(trimmed));
    } catch {
      return "";
    }
  }
  if (path10.isAbsolute(trimmed)) {
    return path10.resolve(trimmed);
  }
  const primary = path10.resolve(defaultBase, trimmed);
  if (fs9.existsSync(primary)) return primary;
  for (const root of roots || []) {
    const alt = path10.resolve(root, trimmed);
    if (fs9.existsSync(alt)) return alt;
  }
  return primary;
}
function findOwningWorkspaceRoot(filePath, roots) {
  if (!filePath || !Array.isArray(roots) || roots.length === 0) return null;
  const resolvedFile = path10.resolve(filePath);
  let bestLexicalRoot = null;
  for (const r of roots) {
    const resolvedRoot = path10.resolve(r);
    const rel = path10.relative(resolvedRoot, resolvedFile);
    if (rel && !rel.startsWith("..") && !path10.isAbsolute(rel)) {
      if (!bestLexicalRoot || resolvedRoot.length > bestLexicalRoot.length) {
        bestLexicalRoot = resolvedRoot;
      }
    }
  }
  if (bestLexicalRoot) {
    return { root: bestLexicalRoot, absFile: resolvedFile };
  }
  try {
    const realFile = fs9.realpathSync(resolvedFile);
    let bestRealMatch = null;
    for (const r of roots) {
      const resolvedRoot = path10.resolve(r);
      try {
        const realRoot = fs9.realpathSync(resolvedRoot);
        const realRel = path10.relative(realRoot, realFile);
        if (realRel && !realRel.startsWith("..") && !path10.isAbsolute(realRel)) {
          if (!bestRealMatch || realRoot.length > bestRealMatch.realRoot.length) {
            bestRealMatch = { resolvedRoot, realRoot, realRel };
          }
        }
      } catch {
      }
    }
    if (bestRealMatch) {
      return {
        root: bestRealMatch.resolvedRoot,
        absFile: path10.join(bestRealMatch.resolvedRoot, bestRealMatch.realRel)
      };
    }
  } catch {
  }
  return null;
}
function normalizeHookPayload(raw, { cwd = process.cwd(), env = process.env } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "noop", harness: "unknown" };
  }
  const forcedHarness = String(env.ANDROID_UX_HOOK_HARNESS || "").trim().toLowerCase();
  const isJetski = forcedHarness === "jetski" || forcedHarness === "antigravity" || typeof raw.conversationId === "string" || Array.isArray(raw.workspacePaths) || Array.isArray(raw.workspaceUris) || typeof raw.invocationNum === "number" || typeof raw.terminationReason === "string" || raw.toolCall && typeof raw.toolCall === "object";
  if (isJetski) {
    const rawRoots = Array.isArray(raw.workspacePaths) && raw.workspacePaths.length > 0 ? raw.workspacePaths : raw.workspaceUris;
    const roots2 = normalizeWorkspaceRoots(rawRoots, cwd);
    const sessionId = String(raw.conversationId || "jetski-session");
    if (typeof raw.terminationReason === "string") {
      return {
        kind: "jetski-stop",
        harness: "jetski",
        sessionId,
        projectRoot: roots2[0],
        roots: roots2
      };
    }
    if (raw.toolCall && typeof raw.toolCall === "object") {
      const toolName2 = String(raw.toolCall.name || "");
      const rawCandidates = [];
      const jetPatchSources = [];
      collectToolArgSource(raw.toolCall.args, rawCandidates, jetPatchSources);
      for (const patchText of jetPatchSources) {
        for (const p of parseApplyPatchPaths(patchText)) {
          rawCandidates.push(p);
        }
      }
      const files = Array.from(
        new Set(rawCandidates.map((c) => resolveCandidatePathAgainstRoots(c, roots2, roots2[0])).filter(Boolean))
      );
      const primaryOwner = files.length > 0 ? findOwningWorkspaceRoot(files[0], roots2) : null;
      const toolUseId = raw.stepIdx != null ? `jetski-step-${raw.stepIdx}` : null;
      return {
        kind: "jetski-post-tool-use",
        harness: "jetski",
        sessionId,
        projectRoot: primaryOwner ? primaryOwner.root : roots2[0],
        roots: roots2,
        toolName: toolName2,
        toolUseId,
        files,
        preimage: resolvePreimageInfo(toolName2, raw),
        failedTool: Boolean(raw.error)
      };
    }
    return {
      kind: "jetski-pre-invocation",
      harness: "jetski",
      sessionId,
      projectRoot: roots2[0],
      roots: roots2
    };
  }
  const eventName = String(raw.hook_event_name || raw.hookEventName || "");
  if (eventName === "Stop") {
    const harness2 = forcedHarness || "claude";
    const projectRoot2 = path10.resolve(raw.cwd || cwd);
    return {
      kind: "stop",
      harness: harness2,
      sessionId: String(raw.session_id || raw.sessionId || "default-session"),
      projectRoot: projectRoot2,
      roots: [projectRoot2],
      stopHookActive: raw.stop_hook_active === true
    };
  }
  if (eventName === "SessionStart") {
    return { kind: "noop", harness: forcedHarness || "claude" };
  }
  const isCursor = forcedHarness === "cursor" || typeof raw.conversation_id === "string" || Array.isArray(raw.workspace_roots);
  if (isCursor) {
    const fallbackRoot = path10.resolve(env.CURSOR_PROJECT_DIR || raw.cwd || cwd);
    const roots2 = normalizeWorkspaceRoots(raw.workspace_roots, fallbackRoot);
    const defaultBase = path10.resolve(raw.cwd || env.CURSOR_PROJECT_DIR || roots2[0]);
    const toolName2 = String(raw.tool_name || "");
    const files = extractTargetFilesFromEvent(raw, defaultBase, roots2);
    const primaryOwner = files.length > 0 ? findOwningWorkspaceRoot(files[0], roots2) : null;
    return {
      kind: "post-tool-use",
      harness: "cursor",
      sessionId: String(raw.conversation_id || raw.session_id || "cursor-session"),
      projectRoot: primaryOwner ? primaryOwner.root : roots2[0],
      roots: roots2,
      toolName: toolName2,
      toolUseId: raw.tool_use_id || raw.generation_id || null,
      files,
      preimage: resolvePreimageInfo(toolName2, raw)
    };
  }
  const isCopilot = forcedHarness === "copilot" || forcedHarness === "github" || eventName === "postToolUse" || typeof raw.toolArgs !== "undefined";
  if (isCopilot) {
    const projectRoot2 = path10.resolve(raw.cwd || cwd);
    const roots2 = [projectRoot2];
    const toolName2 = String(raw.toolName || raw.tool_name || "");
    return {
      kind: "post-tool-use",
      harness: "copilot",
      sessionId: String(raw.sessionId || raw.session_id || "copilot-session"),
      projectRoot: projectRoot2,
      roots: roots2,
      toolName: toolName2,
      toolUseId: raw.toolUseId || raw.tool_use_id || (raw.timestamp ? `copilot-${raw.timestamp}` : null),
      files: extractTargetFilesFromEvent(raw, projectRoot2, roots2),
      preimage: resolvePreimageInfo(toolName2, raw)
    };
  }
  const harness = forcedHarness || "claude";
  const projectRoot = path10.resolve(raw.cwd || cwd);
  const roots = [projectRoot];
  const toolName = String(raw.tool_name || raw.toolName || "");
  return {
    kind: "post-tool-use",
    harness,
    sessionId: String(raw.session_id || raw.sessionId || "claude-session"),
    projectRoot,
    roots,
    toolName,
    toolUseId: raw.tool_use_id || raw.toolUseId || raw.tool_call_id || null,
    files: extractTargetFilesFromEvent(raw, projectRoot, roots),
    preimage: resolvePreimageInfo(toolName, raw)
  };
}
function collectStructuredToolArgs(argsObj, candidates, patchSources) {
  if (!argsObj || typeof argsObj !== "object" || Array.isArray(argsObj)) return;
  for (const v of [argsObj.Path, argsObj.NotebookPath, argsObj.file_path, argsObj.path, argsObj.file, argsObj.notebook_path]) {
    if (typeof v === "string" && v.trim()) candidates.push(v.trim());
  }
  if (Array.isArray(argsObj.edits)) {
    for (const ed of argsObj.edits) {
      for (const ep of [ed?.file_path, ed?.path, ed?.file]) {
        if (typeof ep === "string" && ep.trim()) candidates.push(ep.trim());
      }
    }
  }
  if (typeof argsObj.command === "string") patchSources.push(argsObj.command);
  if (typeof argsObj.patch === "string") patchSources.push(argsObj.patch);
}
function collectToolArgSource(source, candidates, patchSources) {
  if (typeof source === "string") {
    const trimmed = source.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          collectStructuredToolArgs(parsed, candidates, patchSources);
          return;
        }
      } catch {
      }
    }
    patchSources.push(trimmed);
    return;
  }
  if (source && typeof source === "object" && !Array.isArray(source)) {
    collectStructuredToolArgs(source, candidates, patchSources);
  }
}
function extractTargetFilesFromEvent(raw, projectRoot, roots = [projectRoot]) {
  const candidates = [];
  const patchSources = [];
  for (const val of [raw.file_path, raw.path, raw.file, raw.notebook_path]) {
    if (typeof val === "string" && val.trim()) candidates.push(val.trim());
  }
  collectToolArgSource(raw.tool_input, candidates, patchSources);
  collectToolArgSource(raw.toolArgs, candidates, patchSources);
  for (const patchText of patchSources) {
    for (const p of parseApplyPatchPaths(patchText)) {
      candidates.push(p);
    }
  }
  return Array.from(
    new Set(candidates.map((p) => resolveCandidatePathAgainstRoots(p, roots, projectRoot)).filter(Boolean))
  );
}
function parseApplyPatchPaths(patchText) {
  if (!patchText || typeof patchText !== "string") return [];
  const out = [];
  const re = /^\*\*\*\s+(?:(?:Update|Add|Move to)\s+File:|Move to:)\s+(.+)$/gm;
  let m;
  while ((m = re.exec(patchText)) !== null) {
    const p = m[1].trim();
    if (p) out.push(p);
  }
  return out;
}
function resolvePreimageInfo(toolName, raw) {
  const tr = raw.tool_response && typeof raw.tool_response === "object" ? raw.tool_response : {};
  if (typeof tr.originalFile === "string") {
    return { status: "captured", originalContent: tr.originalFile };
  }
  if (typeof tr.old_content === "string") {
    return { status: "captured", originalContent: tr.old_content };
  }
  const lowerTool = String(toolName || "").toLowerCase();
  if (tr.type === "create" || lowerTool === "create") {
    return { status: "created", originalContent: "" };
  }
  return { status: "unavailable", originalContent: null };
}
function isScannableInsideProject(absFile, projectRoot, config) {
  const resolvedRoot = path10.resolve(projectRoot);
  const resolvedFile = path10.resolve(absFile);
  const rel = path10.relative(resolvedRoot, resolvedFile);
  if (!rel || rel.startsWith("..") || path10.isAbsolute(rel)) return false;
  const posixRel = normalizePosixPath(rel);
  if (GENERATED_OR_SENSITIVE_RE.test(posixRel)) return false;
  const lower = path10.basename(resolvedFile).toLowerCase();
  if (!(lower.endsWith(".kt") || lower.endsWith(".json") || lower === "motion.md")) {
    return false;
  }
  try {
    const lst = fs9.lstatSync(resolvedFile);
    if (!lst.isFile() || lst.isSymbolicLink()) return false;
    const realRoot = fs9.realpathSync(resolvedRoot);
    const realFile = fs9.realpathSync(resolvedFile);
    const realRel = path10.relative(realRoot, realFile);
    if (!realRel || realRel.startsWith("..") || path10.isAbsolute(realRel)) return false;
    const maxBytes = config.hook?.limits?.maxFileBytes ?? 262144;
    if (maxBytes > 0 && lst.size > maxBytes) return false;
  } catch {
    return false;
  }
  if (config.ignoreFiles?.length > 0 && matchesFilePattern(resolvedFile, config.ignoreFiles, resolvedRoot)) {
    return false;
  }
  return true;
}
function computeFindingFingerprints(findings) {
  const counts = /* @__PURE__ */ new Map();
  return findings.map((f) => {
    const normalizedEvidence = String(f.evidence || "").replace(/\s*\(line \d+\)/g, "").trim();
    const baseKey = `${f.rule}|${normalizedEvidence}`;
    const ord = (counts.get(baseKey) || 0) + 1;
    counts.set(baseKey, ord);
    return `${f.rule}:${sha256Hex(`${baseKey}#${ord}`).slice(0, 16)}`;
  });
}
function computeBaselineKeysForContent(content, absFile, projectRoot) {
  if (!content) return [];
  const preimageFindings = scanContentInMemory(content, absFile, projectRoot).filter(isPrimaryHookFinding);
  return computeFindingFingerprints(preimageFindings);
}
function scanContentInMemory(content, absFile, projectRoot) {
  const lower = path10.basename(absFile).toLowerCase();
  const kotlinFiles = [];
  const lottieFiles = [];
  const motionContracts = [];
  if (lower.endsWith(".kt")) {
    kotlinFiles.push(scanKotlinSource(content, absFile));
    const motionPath = findMotionMdForTarget(absFile, projectRoot);
    if (motionPath && fs9.existsSync(motionPath)) {
      try {
        const parsed = parseMotionMd(fs9.readFileSync(motionPath, "utf8"), motionPath);
        parsed.lintFindings = [];
        motionContracts.push(parsed);
      } catch {
      }
    }
  } else if (lower === "motion.md") {
    motionContracts.push(parseMotionMd(content, absFile));
  } else if (lower.endsWith(".json")) {
    const lottie = analyzeLottieJson(content, absFile);
    if (lottie.isLottie) lottieFiles.push(lottie);
  }
  const findings = [];
  for (const pack of getAllDomainPacks()) {
    const res = pack.run({
      kotlinFiles,
      lottieFiles,
      motionContracts,
      inlineIgnoresEnabled: true,
      collectStats: false
    });
    findings.push(...res.findings);
  }
  return findings;
}
function isPrimaryHookFinding(f) {
  return f.class === "floor" || f.class === "obligation" || f.severity === "major";
}
function tryReadGitHeadPreimage(absFile, _projectRoot, env = process.env) {
  try {
    const realpathFn = fs9.realpathSync.native || fs9.realpathSync;
    const realFile = realpathFn(path10.resolve(absFile));
    const fileDir = path10.dirname(realFile);
    const fileName = path10.basename(realFile);
    if (!fileName || fileName.includes("/") || fileName.includes("\\")) return null;
    const gitEnv = { ...env, ANDROID_UX_HOOK_DEPTH: "1", GIT_OPTIONAL_LOCKS: "0" };
    const proc = spawnSync4("git", ["show", `HEAD:./${fileName}`], {
      cwd: fileDir,
      env: gitEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
      maxBuffer: 2 * 1024 * 1024
    });
    if (proc.status === 0 && typeof proc.stdout === "string") {
      return proc.stdout;
    }
  } catch {
  }
  return null;
}
function formatHookPayload(text, eventKind, harness) {
  if (!text) {
    if (eventKind === "jetski-stop") return { decision: "allow" };
    return {};
  }
  if (harness === "jetski") {
    if (eventKind === "jetski-pre-invocation") {
      return {
        injectSteps: [
          { ephemeralMessage: text }
        ]
      };
    }
    if (eventKind === "jetski-stop") {
      return { decision: "allow" };
    }
    return {};
  }
  if (harness === "cursor") {
    return { additional_context: text.slice(0, CURSOR_MAX_CHARS) };
  }
  if (harness === "copilot") {
    return { additionalContext: text };
  }
  if (eventKind === "stop") {
    return { systemMessage: text };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: text
    }
  };
}
function renderHookFindingsMessage(groups, { cwd, maxFindings = 5, maxChars = 8e3, isStopPass = false }) {
  const lines = [];
  const totalIssues = groups.reduce((acc, g) => acc + g.findings.length, 0);
  const headerVerb = isStopPass ? "End-of-turn UX check on touched file(s)" : "UX hook check on edited file(s)";
  lines.push(`${ENVELOPE_PREFIX} ${headerVerb} (${totalIssues} proven issue${totalIssues === 1 ? "" : "s"}):`);
  let shown = 0;
  for (const group of groups) {
    const relFile = normalizePosixPath(path10.relative(cwd, group.filePath)) || path10.basename(group.filePath);
    for (const f of group.findings) {
      if (shown >= maxFindings) break;
      const lineStr = f.lines?.[0] ? `:${f.lines[0]}` : "";
      const attrTag = f._attributionTag ? ` ${f._attributionTag}` : "";
      lines.push(`- ${relFile}${lineStr} [${f.rule}]${attrTag} ${f.evidence}`);
      lines.push(`  Fix: ${f.remediation} (${f.docPath})`);
      shown += 1;
    }
    if (shown >= maxFindings) break;
  }
  if (totalIssues > shown) {
    lines.push(`(${totalIssues - shown} more proven finding(s) omitted; run \`npx android-ux detect\` to view all.)`);
  }
  lines.push("Fix proven issues in code; if you suspect a detector false positive, flag it for the user rather than adding a waiver yourself.");
  const full = lines.join("\n");
  return full.length > maxChars ? `${full.slice(0, maxChars - 24)}
...[truncated]` : full;
}
function executeHookPayload(stdinText, { cwd = process.cwd(), env = process.env, platform = process.platform, nowMs = Date.now() } = {}) {
  try {
    if (isTruthyEnv(env.ANDROID_UX_HOOK_DEPTH) || isTruthyEnv(env.CLAUDE_HOOK_DEPTH)) {
      return { exitCode: 0, payload: {}, skipped: "reentrant" };
    }
    if (isTruthyEnv(env.ANDROID_UX_HOOK_DISABLED)) {
      return { exitCode: 0, payload: {}, skipped: "env-disabled" };
    }
    const trimmed = String(stdinText || "").trim();
    if (!trimmed) {
      return { exitCode: 0, payload: {}, skipped: "stdin-empty" };
    }
    let raw;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return { exitCode: 0, payload: {}, skipped: "stdin-malformed" };
    }
    const event = normalizeHookPayload(raw, { cwd, env });
    if (event.kind === "noop") {
      return { exitCode: 0, payload: {}, skipped: "noop" };
    }
    if (event.kind === "jetski-stop") {
      return { exitCode: 0, payload: { decision: "allow" }, skipped: "jetski-stop-allow" };
    }
    if (event.kind === "stop" && event.stopHookActive) {
      return { exitCode: 0, payload: {}, skipped: "stop-hook-active" };
    }
    if (event.kind === "jetski-pre-invocation") {
      const candidateRoots2 = Array.from(/* @__PURE__ */ new Set([
        ...event.roots || [],
        ...listSessionRoots(event.sessionId, env, platform)
      ]));
      const messages = [];
      for (const root of candidateRoots2) {
        const cfg = readProjectConfig(root);
        if (cfg.hook.enabled === false) continue;
        const cache = readProjectSessionCache(root, env, platform, nowMs);
        const sess = cache.sessions[event.sessionId];
        if (sess && Array.isArray(sess.pendingJetskiMessages) && sess.pendingJetskiMessages.length > 0) {
          messages.push(...sess.pendingJetskiMessages);
          sess.pendingJetskiMessages = [];
          sess.updatedAt = nowMs;
          writeProjectSessionCache(root, cache, env, platform, nowMs);
        }
      }
      if (messages.length === 0) {
        return { exitCode: 0, payload: {}, skipped: "no-queued-messages" };
      }
      const joined = messages.join("\n\n");
      return {
        exitCode: 0,
        payload: formatHookPayload(joined, "jetski-pre-invocation", "jetski"),
        emitted: true
      };
    }
    if (event.kind === "stop") {
      const candidateRoots2 = Array.from(/* @__PURE__ */ new Set([
        event.projectRoot,
        ...listSessionRoots(event.sessionId, env, platform)
      ]));
      const allGroups = [];
      let maxFindings = 5;
      let maxChars = 8e3;
      for (const root of candidateRoots2) {
        const config = readProjectConfig(root);
        if (config.hook.enabled === false) continue;
        maxFindings = config.hook.limits?.maxFindings ?? maxFindings;
        maxChars = config.hook.limits?.maxChars ?? maxChars;
        const cache = readProjectSessionCache(root, env, platform, nowMs);
        const sess = cache.sessions[event.sessionId];
        if (!sess || !sess.files || typeof sess.files !== "object") continue;
        const touchedFiles = Object.keys(sess.files).slice(0, 20);
        let cacheMutated = false;
        for (const absFile of touchedFiles) {
          if (!isScannableInsideProject(absFile, root, config)) continue;
          const fileState = sess.files[absFile];
          const scanRes = runStaticScan({
            targets: [absFile],
            cwd: root,
            noAdvisory: true
          });
          const liveFindings = (scanRes.findings || []).filter(isPrimaryHookFinding);
          const liveFingerprints = computeFindingFingerprints(liveFindings);
          const baselineSet = new Set(fileState.baselineKeys || []);
          const reportedSet = new Set(fileState.reportedKeys || []);
          const freshForStop = [];
          const allLiveKeys = [];
          for (let idx = 0; idx < liveFindings.length; idx += 1) {
            const f = liveFindings[idx];
            const fp = liveFingerprints[idx];
            allLiveKeys.push(fp);
            if (reportedSet.has(fp)) continue;
            if (fileState.baselineStatus === "captured" && baselineSet.has(fp)) continue;
            const tagged = {
              ...f,
              _attributionTag: fileState.baselineStatus === "captured" || fileState.baselineStatus === "created" ? "[new]" : "[attribution unknown]"
            };
            freshForStop.push(tagged);
          }
          fileState.reportedKeys = Array.from(/* @__PURE__ */ new Set([...reportedSet, ...allLiveKeys]));
          sess.updatedAt = nowMs;
          cacheMutated = true;
          if (freshForStop.length > 0) {
            allGroups.push({ filePath: absFile, findings: freshForStop, root });
          }
        }
        if (cacheMutated) {
          writeProjectSessionCache(root, cache, env, platform, nowMs);
        }
      }
      if (allGroups.length === 0) {
        return { exitCode: 0, payload: {}, skipped: "stop-clean" };
      }
      const text = renderHookFindingsMessage(allGroups, {
        cwd: event.projectRoot,
        maxFindings,
        maxChars,
        isStopPass: true
      });
      return {
        exitCode: 0,
        payload: formatHookPayload(text, "stop", event.harness),
        emitted: true
      };
    }
    if (event.failedTool) {
      return { exitCode: 0, payload: {}, skipped: "tool-failed" };
    }
    const candidateRoots = normalizeWorkspaceRoots(event.roots, event.projectRoot);
    const filesByRoot = /* @__PURE__ */ new Map();
    for (const rawFile of event.files || []) {
      const match = findOwningWorkspaceRoot(rawFile, candidateRoots);
      if (!match) continue;
      if (!filesByRoot.has(match.root)) {
        filesByRoot.set(match.root, []);
      }
      const list = filesByRoot.get(match.root);
      if (!list.includes(match.absFile)) {
        list.push(match.absFile);
      }
    }
    if (filesByRoot.size === 0) {
      const defaultCfg = readProjectConfig(event.projectRoot);
      if (defaultCfg.hook.enabled === false) {
        return { exitCode: 0, payload: {}, skipped: "config-disabled" };
      }
      return { exitCode: 0, payload: {}, skipped: "no-scannable-file" };
    }
    let sawConfigDisabled = false;
    let sawScannableFile = false;
    let sawDuplicateEvent = false;
    let processedAnyRoot = false;
    const emittedMessages = [];
    for (const [projectRoot, rootCandidateFiles] of filesByRoot.entries()) {
      const config = readProjectConfig(projectRoot);
      if (config.hook.enabled === false) {
        sawConfigDisabled = true;
        continue;
      }
      const scannableFiles = rootCandidateFiles.filter((f) => isScannableInsideProject(f, projectRoot, config));
      if (scannableFiles.length === 0) {
        continue;
      }
      sawScannableFile = true;
      if (event.toolUseId) {
        const claimed = claimHookEvent(event.sessionId, event.toolUseId, projectRoot, scannableFiles, env, platform, nowMs);
        if (!claimed) {
          sawDuplicateEvent = true;
          continue;
        }
      }
      processedAnyRoot = true;
      const cache = readProjectSessionCache(projectRoot, env, platform, nowMs);
      if (!cache.sessions[event.sessionId]) {
        cache.sessions[event.sessionId] = {
          updatedAt: nowMs,
          files: {},
          pendingJetskiMessages: []
        };
      }
      const sess = cache.sessions[event.sessionId];
      sess.updatedAt = nowMs;
      const useImmediateTierOnly = config.hook.perEditRules !== "all" && (event.harness === "claude" || event.harness === "codex");
      const freshGroups = [];
      let suppressionNoticeFile = null;
      let cacheShouldPersist = false;
      for (const absFile of scannableFiles) {
        if (!sess.files[absFile]) {
          let baselineStatus = event.preimage?.status || "unavailable";
          let baselineContent = event.preimage?.originalContent ?? null;
          if (baselineStatus === "unavailable") {
            const headContent = tryReadGitHeadPreimage(absFile, projectRoot, env);
            if (headContent !== null) {
              baselineStatus = "captured";
              baselineContent = headContent;
            }
          }
          const baselineKeys = baselineStatus === "captured" && baselineContent !== null ? computeBaselineKeysForContent(baselineContent, absFile, projectRoot) : [];
          sess.files[absFile] = {
            editCount: 0,
            baselineStatus,
            baselineKeys,
            reportedKeys: []
          };
        }
        const fileState = sess.files[absFile];
        fileState.editCount = (fileState.editCount || 0) + 1;
        cacheShouldPersist = true;
        if (fileState.editCount > EDIT_CAP_PER_FILE) {
          if (fileState.editCount === EDIT_CAP_PER_FILE + 1 && !suppressionNoticeFile) {
            suppressionNoticeFile = absFile;
          }
          continue;
        }
        const scanRes = runStaticScan({
          targets: [absFile],
          cwd: projectRoot
        });
        const liveFindings = (scanRes.findings || []).filter(isPrimaryHookFinding);
        const liveFingerprints = computeFindingFingerprints(liveFindings);
        const baselineSet = new Set(fileState.baselineKeys || []);
        const reportedSet = new Set(fileState.reportedKeys || []);
        const immediateFresh = [];
        const newlyReportedKeys = [];
        for (let idx = 0; idx < liveFindings.length; idx += 1) {
          const f = liveFindings[idx];
          const fp = liveFingerprints[idx];
          const ruleMeta = findRuleById(f.rule);
          const isImmediate = !useImmediateTierOnly || ruleMeta?.hookTier === "immediate";
          if (!isImmediate) continue;
          newlyReportedKeys.push(fp);
          if (reportedSet.has(fp)) continue;
          if (fileState.baselineStatus === "captured" && baselineSet.has(fp)) continue;
          immediateFresh.push(f);
        }
        fileState.reportedKeys = Array.from(/* @__PURE__ */ new Set([...reportedSet, ...newlyReportedKeys]));
        if (immediateFresh.length > 0) {
          freshGroups.push({ filePath: absFile, findings: immediateFresh });
        }
      }
      let rootMessageText = "";
      if (freshGroups.length > 0) {
        rootMessageText = renderHookFindingsMessage(freshGroups, {
          cwd: projectRoot,
          maxFindings: config.hook.limits?.maxFindings ?? 5,
          maxChars: event.harness === "cursor" ? Math.min(config.hook.limits?.maxChars ?? 8e3, CURSOR_MAX_CHARS) : config.hook.limits?.maxChars ?? 8e3,
          isStopPass: false
        });
      } else if (suppressionNoticeFile && !config.hook.quiet && !isTruthyEnv(env.ANDROID_UX_HOOK_QUIET)) {
        const rel = normalizePosixPath(path10.relative(projectRoot, suppressionNoticeFile)) || path10.basename(suppressionNoticeFile);
        rootMessageText = `${ENVELOPE_PREFIX} Per-edit UX reminders paused for ${rel} after ${EDIT_CAP_PER_FILE} edits in this session (run \`npx android-ux detect ${rel}\` when ready).`;
      }
      if (event.harness === "jetski" && rootMessageText) {
        sess.pendingJetskiMessages = sess.pendingJetskiMessages || [];
        sess.pendingJetskiMessages.push(rootMessageText);
        cacheShouldPersist = true;
      }
      if (cacheShouldPersist) {
        writeProjectSessionCache(projectRoot, cache, env, platform, nowMs);
        recordSessionRoot(event.sessionId, projectRoot, env, platform, nowMs);
      }
      if (rootMessageText) {
        emittedMessages.push(rootMessageText);
      }
    }
    if (!processedAnyRoot) {
      if (sawDuplicateEvent) {
        return { exitCode: 0, payload: {}, skipped: "duplicate-event" };
      }
      if (!sawScannableFile && sawConfigDisabled) {
        return { exitCode: 0, payload: {}, skipped: "config-disabled" };
      }
      return { exitCode: 0, payload: {}, skipped: "no-scannable-file" };
    }
    const messageText = emittedMessages.join("\n\n");
    if (!messageText || event.harness === "jetski") {
      return { exitCode: 0, payload: {}, emitted: false };
    }
    return {
      exitCode: 0,
      payload: formatHookPayload(messageText, "post-tool-use", event.harness),
      emitted: true
    };
  } catch (err) {
    if (isTruthyEnv(env.ANDROID_UX_HOOK_DEBUG)) {
      process.stderr.write(`[android-ux-hook] ${err?.stack || err?.message || String(err)}
`);
    }
    return { exitCode: 0, payload: {}, skipped: "exception" };
  }
}
async function runHookCommand(_rawArgs, io = defaultIo6()) {
  const prevDepth = io.env?.ANDROID_UX_HOOK_DEPTH;
  const evalEnv = prevDepth ? io.env : { ...io.env };
  const shouldMutateProcessEnv = io.env === process.env && !prevDepth;
  if (shouldMutateProcessEnv) {
    process.env.ANDROID_UX_HOOK_DEPTH = "1";
  }
  try {
    let stdinText = "";
    if (typeof io.stdinText === "string") {
      stdinText = io.stdinText;
    } else if (io.stdin && !io.stdin.isTTY) {
      try {
        stdinText = fs9.readFileSync(0, "utf8");
      } catch {
        stdinText = "";
      }
    }
    const res = executeHookPayload(stdinText, {
      cwd: io.cwd,
      env: evalEnv,
      platform: io.platform || process.platform
    });
    io.stdout.write(`${JSON.stringify(res.payload || {})}
`);
    return 0;
  } finally {
    if (shouldMutateProcessEnv) {
      delete process.env.ANDROID_UX_HOOK_DEPTH;
    }
  }
}
function defaultIo6() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr
  };
}

// cli/src/commands/hooks.mjs
import fs10 from "node:fs";
import path11 from "node:path";
function isOwnedAndroidUxHookCommand(cmd) {
  return typeof cmd === "string" && ANDROID_UX_HOOK_CMD_RE.test(cmd);
}
function isOwnedAndroidUxHookEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  return isOwnedAndroidUxHookCommand(entry.command) || isOwnedAndroidUxHookCommand(entry.commandWindows) || isOwnedAndroidUxHookCommand(entry.bash) || isOwnedAndroidUxHookCommand(entry.powershell);
}
var SUPPORTED_PROVIDERS = ["claude", "codex", "cursor", "copilot", "jetski"];
var OWNED_SKILL_PREFERENCE = [
  "animate-compose",
  "review-android-motion",
  "improve-android-motion",
  "optimize-android-motion"
];
var HOOKS_USAGE = `Usage: android-ux hooks <status|on|off|install|uninstall|reset> [options]

Inspect, wire, or toggle non-blocking Android UX context hooks.

Subcommands:
  status [--json]
      Show hook enablement (.android-ux/config*.json), active harness manifests, and OS session cache count.

  on | install [--local|--shared] [--providers <list>] [--scope project|global] [--json]
      Enable hooks in config and wire hook manifests for installed/selected providers.

  off [--local|--shared] [--json]
      Disable hooks for this repo (defaults to --local via .android-ux/config.local.json + <gitdir>/info/exclude).

  uninstall [--providers <list>] [--scope project|global] [--json]
      Remove Android UX hook entries from harness manifests while preserving unrelated user hooks and settings.

  reset [--json]
      Clear OS user-cache session dedupe state for this project.
`;
function selectProviderLauncherSkill(skillsDir, preferredSkills = null) {
  if (Array.isArray(preferredSkills) && preferredSkills.length > 0) {
    const preferredSet = new Set(preferredSkills);
    const orderedHit = OWNED_SKILL_PREFERENCE.find((s) => preferredSet.has(s));
    return orderedHit || preferredSkills[0];
  }
  for (const s of OWNED_SKILL_PREFERENCE) {
    if (fs10.existsSync(path11.join(skillsDir, s, "scripts", "android-ux")) || fs10.existsSync(path11.join(skillsDir, s, "scripts", "android-ux.mjs"))) {
      return s;
    }
  }
  for (const s of OWNED_SKILL_PREFERENCE) {
    if (fs10.existsSync(path11.join(skillsDir, s))) {
      return s;
    }
  }
  return OWNED_SKILL_PREFERENCE[0];
}
function resolveProviderPaths(provider, { cwd, scope = "project", env = process.env, platform = process.platform, preferredSkills = null }) {
  const baseRoot = scope === "global" ? resolveHomeDir(env, platform) : path11.resolve(cwd);
  if (!baseRoot) return null;
  switch (provider) {
    case "claude": {
      const skillsDir = path11.join(baseRoot, ".claude", "skills");
      const launcherSkill = selectProviderLauncherSkill(skillsDir, preferredSkills);
      const manifestPath = scope === "global" ? path11.join(baseRoot, ".claude", "settings.json") : path11.join(baseRoot, ".claude", "settings.local.json");
      const launcherPosix = scope === "global" ? normalizePosixPath(path11.join(skillsDir, launcherSkill, "scripts", "android-ux")) : `.claude/skills/${launcherSkill}/scripts/android-ux`;
      return { provider, skillsDir, manifestPath, launcherSkill, launcherPosix };
    }
    case "codex": {
      const skillsDir = path11.join(baseRoot, ".codex", "skills");
      const launcherSkill = selectProviderLauncherSkill(skillsDir, preferredSkills);
      const manifestPath = path11.join(baseRoot, ".codex", "hooks.json");
      const launcherPosix = scope === "global" ? normalizePosixPath(path11.join(skillsDir, launcherSkill, "scripts", "android-ux")) : `.codex/skills/${launcherSkill}/scripts/android-ux`;
      const launcherWin = scope === "global" ? path11.win32.join(skillsDir.replace(/\//g, "\\"), launcherSkill, "scripts", "android-ux.cmd") : `.codex\\skills\\${launcherSkill}\\scripts\\android-ux.cmd`;
      return { provider, skillsDir, manifestPath, launcherSkill, launcherPosix, launcherWin };
    }
    case "cursor": {
      const skillsDir = path11.join(baseRoot, ".cursor", "skills");
      const launcherSkill = selectProviderLauncherSkill(skillsDir, preferredSkills);
      const manifestPath = path11.join(baseRoot, ".cursor", "hooks.json");
      const launcherPosix = scope === "global" ? normalizePosixPath(path11.join(skillsDir, launcherSkill, "scripts", "android-ux")) : `.cursor/skills/${launcherSkill}/scripts/android-ux`;
      return { provider, skillsDir, manifestPath, launcherSkill, launcherPosix };
    }
    case "copilot": {
      if (scope === "global") return null;
      const skillsDir = path11.join(baseRoot, ".github", "skills");
      const launcherSkill = selectProviderLauncherSkill(skillsDir, preferredSkills);
      const manifestPath = path11.join(baseRoot, ".github", "hooks", "android-ux.json");
      const launcherPosix = `$(git rev-parse --show-toplevel)/.github/skills/${launcherSkill}/scripts/android-ux`;
      return { provider, skillsDir, manifestPath, launcherSkill, launcherPosix };
    }
    case "jetski": {
      const hasAgentsDir = scope === "project" && fs10.existsSync(path11.join(baseRoot, "_agents"));
      const containerDir = hasAgentsDir ? path11.join(baseRoot, "_agents") : path11.join(baseRoot, ".gemini");
      const skillsDir = path11.join(containerDir, "skills");
      const launcherSkill = selectProviderLauncherSkill(skillsDir, preferredSkills);
      const manifestPath = path11.join(containerDir, "hooks.json");
      const launcherPosix = `./skills/${launcherSkill}/scripts/android-ux`;
      return { provider, skillsDir, manifestPath, launcherSkill, launcherPosix };
    }
    default:
      return null;
  }
}
function posixSingleQuote(str) {
  return `'${String(str).replace(/'/g, "'\\''")}'`;
}
function formatCopilotBashLauncher(launcherPosix) {
  const prefix = "$(git rev-parse --show-toplevel)/";
  const raw = String(launcherPosix || "");
  if (raw.startsWith(prefix)) {
    const suffix = raw.slice(prefix.length).replace(/[\\"`$]/g, "\\$&");
    return `"${prefix}${suffix}"`;
  }
  return posixSingleQuote(raw);
}
function validateExistingProviderManifest(provider, existing, filePath, verb = "overwrite") {
  if (!provider || !existing || typeof existing !== "object") return;
  if (provider === "claude" || provider === "codex" || provider === "cursor" || provider === "copilot") {
    if (existing.hooks !== void 0 && (!existing.hooks || typeof existing.hooks !== "object" || Array.isArray(existing.hooks))) {
      throw new Error(`Refusing to ${verb} manifest "${filePath}": "hooks" field must be a JSON object.`);
    }
    if (existing.hooks && verb === "overwrite") {
      const requiredArrayKeys = provider === "claude" || provider === "codex" ? ["PostToolUse", "Stop"] : ["postToolUse"];
      for (const key of requiredArrayKeys) {
        if (existing.hooks[key] !== void 0 && !Array.isArray(existing.hooks[key])) {
          throw new Error(`Refusing to ${verb} manifest "${filePath}": "hooks.${key}" must be a JSON array.`);
        }
      }
    }
  }
}
function installProviderHookManifest(info) {
  if (!info || !info.manifestPath) return false;
  const existing = readExistingJsonObject(info.manifestPath, info.provider);
  let next;
  if (info.provider === "claude") {
    next = stripAndroidUxEntriesFromClaudeOrCodex(existing).next;
    next.hooks = next.hooks && typeof next.hooks === "object" ? next.hooks : {};
    const quoted = posixSingleQuote(info.launcherPosix);
    const cmd = `[ ! -f ${quoted} ] || ${quoted} hook`;
    next.hooks.PostToolUse = [
      ...Array.isArray(next.hooks.PostToolUse) ? next.hooks.PostToolUse : [],
      {
        matcher: "Edit|Write|MultiEdit",
        hooks: [
          {
            type: "command",
            command: cmd,
            timeout: 5,
            statusMessage: "Checking Android UX changes"
          }
        ]
      }
    ];
    next.hooks.Stop = [
      ...Array.isArray(next.hooks.Stop) ? next.hooks.Stop : [],
      {
        hooks: [
          {
            type: "command",
            command: cmd,
            timeout: 15,
            statusMessage: "Android UX turn check"
          }
        ]
      }
    ];
  } else if (info.provider === "codex") {
    next = stripAndroidUxEntriesFromClaudeOrCodex(existing).next;
    next.hooks = next.hooks && typeof next.hooks === "object" ? next.hooks : {};
    const quoted = posixSingleQuote(info.launcherPosix);
    const cmd = `[ ! -f ${quoted} ] || ANDROID_UX_HOOK_HARNESS=codex ${quoted} hook`;
    const winSafe = String(info.launcherWin || "").replace(/"/g, "");
    const cmdWin = `cmd /c if exist "${winSafe}" set ANDROID_UX_HOOK_HARNESS=codex&& "${winSafe}" hook`;
    next.hooks.PostToolUse = [
      ...Array.isArray(next.hooks.PostToolUse) ? next.hooks.PostToolUse : [],
      {
        matcher: "Edit|Write|apply_patch",
        hooks: [
          {
            type: "command",
            command: cmd,
            commandWindows: cmdWin,
            timeout: 5,
            statusMessage: "Checking Android UX changes"
          }
        ]
      }
    ];
    next.hooks.Stop = [
      ...Array.isArray(next.hooks.Stop) ? next.hooks.Stop : [],
      {
        hooks: [
          {
            type: "command",
            command: cmd,
            commandWindows: cmdWin,
            timeout: 15,
            statusMessage: "Android UX turn check"
          }
        ]
      }
    ];
  } else if (info.provider === "cursor") {
    next = { version: 1, ...existing };
    next.hooks = next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks) ? { ...next.hooks } : {};
    for (const [k, list] of Object.entries(next.hooks)) {
      if (Array.isArray(list)) {
        const hadAndroidUx = list.some((h) => isOwnedAndroidUxHookEntry(h));
        const kept = list.filter((h) => !isOwnedAndroidUxHookEntry(h));
        if (kept.length === 0 && hadAndroidUx) {
          delete next.hooks[k];
        } else {
          next.hooks[k] = kept;
        }
      }
    }
    const quoted = posixSingleQuote(info.launcherPosix);
    const cmd = `[ ! -f ${quoted} ] || ${quoted} hook`;
    next.hooks.postToolUse = [
      ...Array.isArray(next.hooks.postToolUse) ? next.hooks.postToolUse : [],
      {
        command: cmd,
        matcher: "^Write$",
        timeout: 5
      }
    ];
  } else if (info.provider === "copilot") {
    next = { version: 1, ...existing };
    next.hooks = next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks) ? { ...next.hooks } : {};
    for (const [k, list] of Object.entries(next.hooks)) {
      if (Array.isArray(list)) {
        const hadAndroidUx = list.some((h) => isOwnedAndroidUxHookEntry(h));
        const kept = list.filter((h) => !isOwnedAndroidUxHookEntry(h));
        if (kept.length === 0 && hadAndroidUx) {
          delete next.hooks[k];
        } else {
          next.hooks[k] = kept;
        }
      }
    }
    const quotedLauncher = formatCopilotBashLauncher(info.launcherPosix);
    const bashCmd = `[ ! -f ${quotedLauncher} ] || ${quotedLauncher} hook`;
    next.hooks.postToolUse = [
      ...Array.isArray(next.hooks.postToolUse) ? next.hooks.postToolUse : [],
      {
        type: "command",
        matcher: "edit|create|apply_patch",
        bash: bashCmd,
        timeoutSec: 5
      }
    ];
  } else if (info.provider === "jetski") {
    next = { ...existing };
    const winSkill = info.launcherSkill || OWNED_SKILL_PREFERENCE[0];
    const jetskiCmd = `"${info.launcherPosix}" hook || "skills\\${winSkill}\\scripts\\android-ux.cmd" hook || echo {}`;
    next["android-ux"] = {
      PostToolUse: [
        {
          matcher: "write_file|edit_file|notebook_edit",
          hooks: [
            {
              type: "command",
              command: jetskiCmd,
              timeout: 10
            }
          ]
        }
      ],
      PreInvocation: [
        {
          type: "command",
          command: jetskiCmd,
          timeout: 10
        }
      ]
    };
  } else {
    return false;
  }
  fs10.mkdirSync(path11.dirname(info.manifestPath), { recursive: true });
  fs10.writeFileSync(info.manifestPath, `${JSON.stringify(next, null, 2)}
`, "utf8");
  return true;
}
function readExistingJsonObject(filePath, provider = null) {
  let raw;
  try {
    raw = fs10.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return {};
    throw new Error(`Refusing to overwrite unreadable manifest "${filePath}": ${err?.message || String(err)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Refusing to overwrite malformed JSON manifest "${filePath}": ${err?.message || String(err)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Refusing to overwrite manifest "${filePath}": top-level JSON value must be an object.`);
  }
  validateExistingProviderManifest(provider, parsed, filePath, "overwrite");
  return parsed;
}
function uninstallProviderHooks(info) {
  if (!info || !info.manifestPath) return false;
  let raw;
  try {
    raw = fs10.readFileSync(info.manifestPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return false;
    throw new Error(`Refusing to modify unreadable manifest "${info.manifestPath}": ${err?.message || String(err)}`);
  }
  let existing;
  try {
    existing = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Refusing to modify malformed JSON manifest "${info.manifestPath}": ${err?.message || String(err)}`);
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    throw new Error(`Refusing to modify manifest "${info.manifestPath}": top-level JSON value must be an object.`);
  }
  validateExistingProviderManifest(info.provider, existing, info.manifestPath, "modify");
  let next;
  if (info.provider === "claude" || info.provider === "codex") {
    const stripped = stripAndroidUxEntriesFromClaudeOrCodex(existing);
    next = stripped.next;
    if (stripped.hadRemoved && next.hooks && typeof next.hooks === "object" && Object.keys(next.hooks).length === 0) {
      delete next.hooks;
    }
  } else if (info.provider === "cursor") {
    next = { ...existing };
    let hadRemoved = false;
    if (next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks)) {
      next.hooks = { ...next.hooks };
      for (const [k, list] of Object.entries(next.hooks)) {
        if (Array.isArray(list)) {
          const hadAndroidUx = list.some((h) => isOwnedAndroidUxHookEntry(h));
          const kept = list.filter((h) => !isOwnedAndroidUxHookEntry(h));
          if (hadAndroidUx) {
            hadRemoved = true;
            if (kept.length === 0) delete next.hooks[k];
            else next.hooks[k] = kept;
          }
        }
      }
      if (hadRemoved && Object.keys(next.hooks).length === 0) delete next.hooks;
    }
  } else if (info.provider === "copilot") {
    next = { ...existing };
    let hadRemoved = false;
    if (next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks)) {
      next.hooks = { ...next.hooks };
      for (const [k, list] of Object.entries(next.hooks)) {
        if (Array.isArray(list)) {
          const hadAndroidUx = list.some((h) => isOwnedAndroidUxHookEntry(h));
          const kept = list.filter((h) => !isOwnedAndroidUxHookEntry(h));
          if (hadAndroidUx) {
            hadRemoved = true;
            if (kept.length === 0) delete next.hooks[k];
            else next.hooks[k] = kept;
          }
        }
      }
      if (hadRemoved && Object.keys(next.hooks).length === 0) delete next.hooks;
    }
    const remainingKeys = Object.keys(next).filter((k) => k !== "version");
    if (hadRemoved && remainingKeys.length === 0) {
      fs10.unlinkSync(info.manifestPath);
      return true;
    }
  } else if (info.provider === "jetski") {
    if (!Object.prototype.hasOwnProperty.call(existing, "android-ux")) return false;
    next = { ...existing };
    delete next["android-ux"];
  } else {
    return false;
  }
  const serialized = `${JSON.stringify(next, null, 2)}
`;
  if (serialized === `${JSON.stringify(existing, null, 2)}
`) {
    return false;
  }
  fs10.writeFileSync(info.manifestPath, serialized, "utf8");
  return true;
}
function stripAndroidUxEntriesFromClaudeOrCodex(obj) {
  const clone = JSON.parse(JSON.stringify(obj || {}));
  let hadRemoved = false;
  if (!clone.hooks || typeof clone.hooks !== "object" || Array.isArray(clone.hooks)) {
    return { next: clone, hadRemoved };
  }
  for (const [evt, entries] of Object.entries(clone.hooks)) {
    if (!Array.isArray(entries)) continue;
    let evtRemoved = false;
    clone.hooks[evt] = entries.map((entry) => {
      if (Array.isArray(entry?.hooks)) {
        const kept = entry.hooks.filter((h) => !isOwnedAndroidUxHookEntry(h));
        if (kept.length !== entry.hooks.length) {
          evtRemoved = true;
          hadRemoved = true;
        }
        return kept.length > 0 ? { ...entry, hooks: kept } : null;
      }
      if (isOwnedAndroidUxHookEntry(entry)) {
        evtRemoved = true;
        hadRemoved = true;
        return null;
      }
      return entry;
    }).filter(Boolean);
    if (evtRemoved && clone.hooks[evt].length === 0) delete clone.hooks[evt];
  }
  return { next: clone, hadRemoved };
}
async function runHooksCommand(rawArgs, io = defaultIo7()) {
  const args = [...rawArgs];
  if (args[0] === "hooks") args.shift();
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout.write(HOOKS_USAGE);
    return 0;
  }
  const sub = args[0] && !args[0].startsWith("--") ? args.shift().toLowerCase() : "status";
  if (!["status", "on", "off", "install", "uninstall", "reset"].includes(sub)) {
    io.stderr.write(`Error: unknown hooks subcommand "${sub}". Valid: status, on, off, install, uninstall, reset
`);
    return 1;
  }
  if (sub === "status") return handleHooksStatus(args, io);
  if (sub === "on" || sub === "install") return handleHooksToggle(args, io, true);
  if (sub === "off") return handleHooksToggle(args, io, false);
  if (sub === "uninstall") return handleHooksUninstall(args, io);
  return handleHooksReset(args, io);
}
function handleHooksStatus(args, io) {
  const json = args.includes("--json");
  const cfg = readProjectConfig(io.cwd);
  const mode = detectActiveHookMode(io.cwd, io.env);
  const cache = readProjectSessionCache(io.cwd, io.env, io.platform || process.platform);
  const activeSessions = Object.keys(cache.sessions || {}).length;
  const cachePath = getProjectCachePath(io.cwd, io.env, io.platform || process.platform);
  const statusObj = {
    enabledInConfig: cfg.hook.enabled !== false,
    quiet: cfg.hook.quiet === true,
    perEditRules: cfg.hook.perEditRules,
    active: mode.active,
    reason: mode.reason,
    manifests: mode.manifests,
    sessionCache: {
      path: cachePath,
      activeSessions
    }
  };
  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope("hooks.status", statusObj), null, 2)}
`);
    return 0;
  }
  io.stdout.write(
    [
      `Hooks: ${statusObj.active ? "active" : "inactive"} (${statusObj.reason})`,
      `Config enabled: ${statusObj.enabledInConfig} (perEditRules=${statusObj.perEditRules}, quiet=${statusObj.quiet})`,
      `Manifests: ${statusObj.manifests.length > 0 ? statusObj.manifests.join(", ") : "(none)"}`,
      `Session cache: ${activeSessions} session(s) in ${cachePath || "(unavailable)"}`
    ].join("\n") + "\n"
  );
  return 0;
}
function handleHooksToggle(args, io, enable) {
  let json = false;
  let local = true;
  let scope = "project";
  const requestedProviders = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--shared") local = false;
    else if (a === "--local") local = true;
    else if (a === "--scope" || a.startsWith("--scope=")) {
      const v = a.includes("=") ? a.slice("--scope=".length) : args[++i];
      if (!["project", "global"].includes(v)) {
        io.stderr.write("Error: --scope must be project or global\n");
        return 1;
      }
      scope = v;
    } else if (a === "--providers" || a.startsWith("--providers=")) {
      const v = a.includes("=") ? a.slice("--providers=".length) : args[++i];
      for (const p of String(v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        if (p === "all") {
          for (const sp of SUPPORTED_PROVIDERS) {
            if (!requestedProviders.includes(sp)) requestedProviders.push(sp);
          }
          continue;
        }
        if (!SUPPORTED_PROVIDERS.includes(p)) {
          io.stderr.write(`Error: unknown provider "${p}". Valid: all, ${SUPPORTED_PROVIDERS.join(", ")}
`);
          return 1;
        }
        if (!requestedProviders.includes(p)) requestedProviders.push(p);
      }
    } else {
      io.stderr.write(`Error: unknown hooks option "${a}"
`);
      return 1;
    }
  }
  try {
    const targetCfgPath = local ? getLocalConfigPath(io.cwd) : getSharedConfigPath(io.cwd);
    if (!enable) {
      const rawObj = readEditableConfigObject(io.cwd, { local });
      rawObj.hook = { ...rawObj.hook || {}, enabled: false };
      writeConfigObject(io.cwd, rawObj, { local });
      if (json) {
        io.stdout.write(`${JSON.stringify(createJsonEnvelope("hooks.off", {
          enabled: false,
          configFile: normalizePosixPath(path11.relative(io.cwd, targetCfgPath))
        }), null, 2)}
`);
      } else {
        io.stdout.write(`Disabled Android UX hooks in ${normalizePosixPath(path11.relative(io.cwd, targetCfgPath))}.
`);
      }
      return 0;
    }
    const providersToWire = requestedProviders.length > 0 ? requestedProviders : SUPPORTED_PROVIDERS.filter((prov) => {
      const info = resolveProviderPaths(prov, { cwd: io.cwd, scope, env: io.env, platform: io.platform || process.platform });
      return info && OWNED_SKILL_PREFERENCE.some((s) => fs10.existsSync(path11.join(info.skillsDir, s)));
    });
    const resolvedTargets = [];
    for (const prov of providersToWire) {
      const info = resolveProviderPaths(prov, { cwd: io.cwd, scope, env: io.env, platform: io.platform || process.platform });
      if (info) {
        readExistingJsonObject(info.manifestPath, info.provider);
        resolvedTargets.push(info);
      }
    }
    for (const isLoc of [true, false]) {
      const p = isLoc ? getLocalConfigPath(io.cwd) : getSharedConfigPath(io.cwd);
      if (!fs10.existsSync(p)) continue;
      const editable = readEditableConfigObject(io.cwd, { local: isLoc });
      if (editable.hook && editable.hook.enabled === false) {
        editable.hook.enabled = true;
        writeConfigObject(io.cwd, editable, { local: isLoc });
      }
    }
    const wiredManifests = [];
    for (const info of resolvedTargets) {
      if (installProviderHookManifest(info)) {
        wiredManifests.push(normalizePosixPath(path11.relative(io.cwd, info.manifestPath) || info.manifestPath));
      }
    }
    if (json) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope("hooks.on", {
        enabled: true,
        wiredManifests
      }), null, 2)}
`);
    } else {
      io.stdout.write(
        wiredManifests.length > 0 ? `Enabled Android UX hooks and updated manifests: ${wiredManifests.join(", ")}
` : "Enabled Android UX hooks (run `npx android-ux install` to install skill bundles + harness manifests).\n"
      );
    }
    return 0;
  } catch (err) {
    io.stderr.write(`Error: ${err?.message || String(err)}
`);
    return 1;
  }
}
function handleHooksUninstall(args, io) {
  let json = false;
  let scope = "project";
  const requestedProviders = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--scope" || a.startsWith("--scope=")) {
      const v = a.includes("=") ? a.slice("--scope=".length) : args[++i];
      if (!["project", "global"].includes(v)) {
        io.stderr.write("Error: --scope must be project or global\n");
        return 1;
      }
      scope = v;
    } else if (a === "--providers" || a.startsWith("--providers=")) {
      const v = a.includes("=") ? a.slice("--providers=".length) : args[++i];
      for (const p of String(v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        if (p === "all") {
          for (const sp of SUPPORTED_PROVIDERS) {
            if (!requestedProviders.includes(sp)) requestedProviders.push(sp);
          }
          continue;
        }
        if (!SUPPORTED_PROVIDERS.includes(p)) {
          io.stderr.write(`Error: unknown provider "${p}". Valid: all, ${SUPPORTED_PROVIDERS.join(", ")}
`);
          return 1;
        }
        if (!requestedProviders.includes(p)) requestedProviders.push(p);
      }
    } else {
      io.stderr.write(`Error: unknown hooks uninstall option "${a}"
`);
      return 1;
    }
  }
  const providers = requestedProviders.length > 0 ? requestedProviders : SUPPORTED_PROVIDERS;
  try {
    const targets = [];
    for (const prov of providers) {
      const info = resolveProviderPaths(prov, { cwd: io.cwd, scope, env: io.env, platform: io.platform || process.platform });
      if (info && fs10.existsSync(info.manifestPath)) {
        readExistingJsonObject(info.manifestPath, info.provider);
        targets.push(info);
      }
    }
    const removedManifests = [];
    for (const info of targets) {
      if (uninstallProviderHooks(info)) {
        removedManifests.push(normalizePosixPath(path11.relative(io.cwd, info.manifestPath) || info.manifestPath));
      }
    }
    if (json) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope("hooks.uninstall", { removedManifests }), null, 2)}
`);
    } else {
      io.stdout.write(
        removedManifests.length > 0 ? `Removed Android UX hooks from: ${removedManifests.join(", ")}
` : "No Android UX hook entries found to remove.\n"
      );
    }
    return 0;
  } catch (err) {
    io.stderr.write(`Error: ${err?.message || String(err)}
`);
    return 1;
  }
}
function handleHooksReset(args, io) {
  const json = args.includes("--json");
  const cleared = clearProjectSessionCache(io.cwd, io.env, io.platform || process.platform);
  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope("hooks.reset", { cleared }), null, 2)}
`);
  } else {
    io.stdout.write(cleared ? "Cleared session hook cache for this project.\n" : "Session hook cache was already empty.\n");
  }
  return 0;
}
function defaultIo7() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr
  };
}

// cli/src/commands/install.mjs
import fs11 from "node:fs";
import path12 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var ANDROID_UX_SKILL_NAMES = /* @__PURE__ */ new Set([
  "animate-compose",
  "improve-android-motion",
  "optimize-android-motion",
  "review-android-motion"
]);
function isOwnedAndroidUxSkillDir(skillsRoot, skillName) {
  if (!ANDROID_UX_SKILL_NAMES.has(skillName)) return false;
  try {
    const skillMd = path12.join(skillsRoot, skillName, "SKILL.md");
    const bundledCli = path12.join(skillsRoot, skillName, "scripts", "android-ux.mjs");
    return fs11.existsSync(skillMd) && fs11.statSync(skillMd).isFile() && fs11.existsSync(bundledCli) && fs11.statSync(bundledCli).isFile();
  } catch {
    return false;
  }
}
function discoverOwnedAndroidUxSkills(skillsRoot) {
  if (!skillsRoot) return [];
  try {
    return fs11.readdirSync(skillsRoot).filter((name) => isOwnedAndroidUxSkillDir(skillsRoot, name)).sort();
  } catch {
    return [];
  }
}
var INSTALL_USAGE = `Usage:
  android-ux install [options]
  android-ux update [options]

Install or update Android UX skills and non-blocking context hooks into your project
or global harness directories (Claude Code, Codex, Cursor, GitHub Copilot, Antigravity/Jetski).

Options:
  --scope <project|global>  Target project directory (default) or user home directory
  --providers <list>        Comma-separated providers (${SUPPORTED_PROVIDERS.join(", ")})
  --no-hooks                Copy skills without registering harness hook manifests
  --json                    Emit a single JSON document on stdout
  --help, -h                Show this help message
`;
function locatePackagedSkillsRoot() {
  const here = path12.dirname(fileURLToPath2(import.meta.url));
  const candidates = [
    path12.resolve(here, "..", "..", "..", "skills"),
    // cli/src/commands/install.mjs -> repo/package root/skills
    path12.resolve(here, "..", "..")
    // skills/<name>/scripts/android-ux.mjs -> skills/
  ];
  for (const dir of candidates) {
    try {
      if (fs11.existsSync(dir) && fs11.statSync(dir).isDirectory()) {
        if (discoverOwnedAndroidUxSkills(dir).length > 0) {
          return dir;
        }
      }
    } catch {
    }
  }
  return null;
}
function detectDefaultProviders(cwd, scope) {
  if (scope === "global") {
    return ["claude"];
  }
  const found = [];
  if (fs11.existsSync(path12.join(cwd, ".claude"))) found.push("claude");
  if (fs11.existsSync(path12.join(cwd, ".codex"))) found.push("codex");
  if (fs11.existsSync(path12.join(cwd, ".cursor"))) found.push("cursor");
  if (fs11.existsSync(path12.join(cwd, ".github", "skills")) || fs11.existsSync(path12.join(cwd, ".github", "hooks"))) {
    found.push("copilot");
  }
  if (fs11.existsSync(path12.join(cwd, ".gemini")) || fs11.existsSync(path12.join(cwd, "_agents"))) {
    found.push("jetski");
  }
  return found.length > 0 ? found : ["claude"];
}
function copySkillBundleClean(srcSkillDir, destSkillDir) {
  const srcReal = fs11.realpathSync(srcSkillDir);
  if (fs11.existsSync(destSkillDir)) {
    const destReal = fs11.realpathSync(destSkillDir);
    if (srcReal === destReal) {
      return;
    }
    if (destReal.startsWith(`${srcReal}${path12.sep}`) || srcReal.startsWith(`${destReal}${path12.sep}`)) {
      throw new Error(`Refusing overlapping skill bundle copy between "${srcSkillDir}" and "${destSkillDir}".`);
    }
  }
  fs11.mkdirSync(path12.dirname(destSkillDir), { recursive: true });
  const stagingDir = `${destSkillDir}.staging-${process.pid}-${Date.now()}`;
  try {
    fs11.rmSync(stagingDir, { recursive: true, force: true });
    copyFilteredDir(srcReal, stagingDir);
    const posixLauncher = path12.join(stagingDir, "scripts", "android-ux");
    if (fs11.existsSync(posixLauncher)) {
      try {
        fs11.chmodSync(posixLauncher, 493);
      } catch {
      }
    }
    fs11.rmSync(destSkillDir, { recursive: true, force: true });
    fs11.renameSync(stagingDir, destSkillDir);
  } catch (err) {
    try {
      fs11.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
    }
    throw err;
  }
}
function copyFilteredDir(srcDir, destDir) {
  fs11.mkdirSync(destDir, { recursive: true });
  for (const entry of fs11.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === "evals" || entry.name === "skill-source.json" || entry.name.startsWith(".")) {
      continue;
    }
    const srcPath = path12.join(srcDir, entry.name);
    const dstPath = path12.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyFilteredDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs11.copyFileSync(srcPath, dstPath);
    }
  }
}
async function runInstallCommand(rawArgs, io = defaultIo8()) {
  const args = [...rawArgs];
  const verb = args[0] === "install" || args[0] === "update" ? args.shift() : "install";
  let scope = "project";
  let withHooks = true;
  let json = false;
  const requestedProviders = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      io.stdout.write(INSTALL_USAGE);
      return 0;
    }
    if (a === "--json") {
      json = true;
    } else if (a === "--no-hooks") {
      withHooks = false;
    } else if (a === "-y" || a === "--yes" || a === "--force") {
    } else if (a === "--scope" || a.startsWith("--scope=")) {
      const v = a.includes("=") ? a.slice("--scope=".length) : args[++i];
      if (!["project", "global"].includes(v)) {
        io.stderr.write("Error: --scope must be project or global\n");
        return 1;
      }
      scope = v;
    } else if (a === "--providers" || a.startsWith("--providers=") || a === "--harness" || a.startsWith("--harness=")) {
      const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
      for (const p of String(v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        if (p === "all") {
          for (const sp of SUPPORTED_PROVIDERS) {
            if (!requestedProviders.includes(sp)) requestedProviders.push(sp);
          }
          continue;
        }
        if (!SUPPORTED_PROVIDERS.includes(p)) {
          io.stderr.write(`Error: unknown provider "${p}". Valid: all, ${SUPPORTED_PROVIDERS.join(", ")}
`);
          return 1;
        }
        if (!requestedProviders.includes(p)) requestedProviders.push(p);
      }
    } else {
      io.stderr.write(`Error: unknown ${verb} option "${a}". Run android-ux ${verb} --help.
`);
      return 1;
    }
  }
  const skillsRoot = locatePackagedSkillsRoot();
  if (!skillsRoot) {
    io.stderr.write("Error: could not locate packaged skills/ directory to install.\n");
    return 1;
  }
  const skillNames = discoverOwnedAndroidUxSkills(skillsRoot);
  if (skillNames.length === 0) {
    io.stderr.write("Error: no owned Android UX skill bundles found to install.\n");
    return 1;
  }
  let providers = requestedProviders;
  if (providers.length === 0) {
    if (verb === "update") {
      providers = SUPPORTED_PROVIDERS.filter((prov) => {
        const info = resolveProviderPaths(prov, { cwd: io.cwd, scope, env: io.env, platform: io.platform || process.platform });
        return info && skillNames.some((s) => fs11.existsSync(path12.join(info.skillsDir, s)));
      });
      if (providers.length === 0) {
        providers = detectDefaultProviders(io.cwd, scope);
      }
    } else {
      providers = detectDefaultProviders(io.cwd, scope);
    }
  }
  const installed = [];
  try {
    const resolvedProviders = [];
    for (const prov of providers) {
      const info = resolveProviderPaths(prov, {
        cwd: io.cwd,
        scope,
        env: io.env,
        platform: io.platform || process.platform,
        preferredSkills: skillNames
      });
      if (!info) continue;
      if (withHooks) {
        readExistingJsonObject(info.manifestPath, info.provider);
      }
      resolvedProviders.push({ prov, info });
    }
    for (const { prov, info } of resolvedProviders) {
      for (const skillName of skillNames) {
        const srcDir = path12.join(skillsRoot, skillName);
        const dstDir = path12.join(info.skillsDir, skillName);
        copySkillBundleClean(srcDir, dstDir);
      }
      let hookWired = false;
      if (withHooks) {
        hookWired = installProviderHookManifest(info);
      }
      installed.push({
        provider: prov,
        skillsDir: scope === "project" ? normalizePosixPath(path12.relative(io.cwd, info.skillsDir)) : normalizePosixPath(info.skillsDir),
        skillsCount: skillNames.length,
        hookManifest: hookWired ? scope === "project" ? normalizePosixPath(path12.relative(io.cwd, info.manifestPath)) : normalizePosixPath(info.manifestPath) : null
      });
    }
  } catch (err) {
    io.stderr.write(`Error: ${err?.message || String(err)}
`);
    return 1;
  }
  if (json) {
    io.stdout.write(`${JSON.stringify(createJsonEnvelope(verb, {
      scope,
      skills: skillNames,
      installed
    }), null, 2)}
`);
    return 0;
  }
  for (const item of installed) {
    const hookNote = item.hookManifest ? ` + hooks (${item.hookManifest})` : " (hooks skipped)";
    io.stdout.write(`${verb === "update" ? "Updated" : "Installed"} ${item.skillsCount} skill(s) for ${item.provider} -> ${item.skillsDir}${hookNote}
`);
  }
  return 0;
}
function defaultIo8() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr
  };
}

// cli/src/index.mjs
var ROOT_USAGE = `android-ux v${PACKAGE_VERSION} (standards ${STANDARDS_VERSION})

Deterministic CLI spine and multi-domain UX rule runner for Android & Jetpack Compose.

Usage:
  android-ux <command> [options]
  android-ux [paths...]           (shorthand for \`android-ux detect [paths...]\`)

Commands:
  doctor    Diagnose OS/arch, Node/hook PATH, android CLI, adb, Perfetto, media tools & waiver health
  context   Read-only session bootstrap (MOTION.md contract, epistemic Gradle/Compose facts, --signals)
  detect    Run static UX checks on .kt, Lottie .json, and MOTION.md (separates findings vs candidates)
  ignores   Manage narrow, auditable waivers in .android-ux/config*.json (list, add, remove, prune)
  trace     Analyze Perfetto .perfetto-trace files (UI thread, RenderThread, FrameTimeline, --compare)
  install   Install/update skills and non-blocking hooks across Claude, Codex, Cursor, Copilot & Jetski
  hooks     Inspect or toggle non-blocking context hooks (status, on, off, reset)
  hook      Internal stdin->stdout JSON harness hook handler (always exits 0)

Global options:
  --version, -v   Print package and standards version
  --help, -h      Show help (pass after a command for command-specific options)
`;
var DETECT_SHORTHAND_FLAGS = /* @__PURE__ */ new Set([
  "--scope",
  "--stats",
  "--draft",
  "--base",
  "--fail-on",
  "--list-rules",
  "--format",
  "--github",
  "--quiet",
  "-q",
  "--no-advisory",
  "--no-config",
  "--no-inline-ignores",
  "--report-unused-ignores"
]);
async function runCli(argv2 = process.argv.slice(2), io = defaultIo9()) {
  const args = [...argv2];
  if (args.length === 0 || args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    io.stdout.write(ROOT_USAGE);
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    if (args.includes("--json")) {
      io.stdout.write(`${JSON.stringify(createJsonEnvelope("version"), null, 2)}
`);
    } else {
      io.stdout.write(`${PACKAGE_NAME} ${PACKAGE_VERSION} (standards ${STANDARDS_VERSION})
`);
    }
    return 0;
  }
  const first = args[0];
  switch (first) {
    case "doctor":
      return runDoctorCommand(args, io);
    case "context":
      return runContextCommand(args, io);
    case "detect":
      return runDetectCommand(args, io);
    case "ignores":
    case "ignore":
      return runIgnoresCommand(args, io);
    case "trace":
      return runTraceCommand(args, io);
    case "hook":
      return runHookCommand(args, io);
    case "hooks":
      return runHooksCommand(args, io);
    case "install":
    case "update":
      return runInstallCommand(args, io);
    default:
      break;
  }
  const flagPrefix = first.split("=")[0];
  if (DETECT_SHORTHAND_FLAGS.has(flagPrefix)) {
    return runDetectCommand(args, io);
  }
  if (!first.startsWith("-")) {
    const resolvedCandidate = path13.resolve(io.cwd, first);
    const looksLikePath = first === "." || first === ".." || first.includes("/") || first.includes("\\") || /\.(kt|kts|json|md)$/i.test(first) || fs12.existsSync(resolvedCandidate);
    if (looksLikePath) {
      return runDetectCommand(args, io);
    }
    io.stderr.write(`Error: unknown command or non-existent path "${first}". Run \`android-ux --help\`.
`);
    return 1;
  }
  io.stderr.write(`Error: unknown option "${first}". Run \`android-ux --help\`.
`);
  return 1;
}
function defaultIo9() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr
  };
}

// cli/bin/android-ux.mjs
var argv = process.argv.slice(2);
var isHook = argv[0] === "hook";
try {
  const code = await runCli(argv);
  process.exitCode = isHook ? 0 : code;
} catch (err) {
  if (isHook) {
    process.stdout.write("{}\n");
    process.exitCode = 0;
  } else {
    process.stderr.write(`Fatal error: ${err?.stack || err?.message || String(err)}
`);
    process.exitCode = 1;
  }
}
