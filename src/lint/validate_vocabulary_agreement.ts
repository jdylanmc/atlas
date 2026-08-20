import { compareCodePoints } from "../atlas/compare_code_points.ts";
import { positionAt } from "../atlas/source_position.ts";
import {
  reservedPageDirectories,
  type CoreArchetypeBindings,
} from "../domain/core_archetype.ts";
import type { Finding } from "../domain/finding.ts";

export interface VocabularyTextFile {
  readonly content: string;
  readonly path: string;
}

type FindingLocation = NonNullable<Finding["location"]>;

const attribution = Object.freeze({
  checkId: "sdk-core.vocabulary-agreement",
  kind: "sdk-core" as const,
  trusted: true as const,
});

/**
 * Words Atlas SDK identifiers and Finding messages may use without naming a
 * domain concept. Every other capitalized word must be a CONTEXT.md term, so a
 * renamed archetype cannot survive anywhere in an SDK-owned contract.
 */
const structuralWords: readonly string[] = Object.freeze([
  "avoided",
  "before",
  "budget",
  "byte",
  "created",
  "custom",
  "definition",
  "duplicate",
  "empty",
  "envelope",
  "failed",
  "file",
  "frontmatter",
  "glossary",
  "h1",
  "id",
  "identifier",
  "invalid",
  "json",
  "large",
  "load",
  "malformed",
  "markdown",
  "mismatch",
  "missing",
  "name",
  "not",
  "page",
  "parse",
  "path",
  "required",
  "reserved",
  "shared",
  "target",
  "term",
  "title",
  "too",
  "total",
  "undeclared",
  "undefined",
  "unknown",
  "updated",
  "utf",
  "utf8",
  "word",
]);

/** A glossary definition heading, for example `**Anchor**:`. */
const definitionPattern = /^\*\*(.+)\*\*:$/u;
/** A glossary avoidance line, for example `_Avoid_: Bonfire, Landmark, Hub`. */
const avoidancePattern = /^_Avoid_: (.+)$/u;
/** An Atlas SDK diagnostic code, which prose can never produce. */
const diagnosticPattern = /ATLAS_[A-Z0-9_]+/gu;
/** An `.atlas/` directory reference, in plain or regular-expression form. */
const directoryPattern = /\\?\.atlas\\?\/([A-Za-z0-9_.-]+)\\?\//gu;
/** A page-ID prefix, which requires an identifier immediately after its colon. */
const idPrefixPattern = /(?<![\p{L}\p{N}_-])([a-z][a-z0-9-]*):(?=[a-z0-9])/gu;
/** A module specifier, which names a file or a runtime scheme, not an Atlas page. */
const specifierPattern = /(?:\bfrom|\bimport)\s*\(?\s*(["'])((?:[^"'\n\\]|\\.)*)\1/gu;
/** A single-line string or template literal. */
const literalPattern = /"((?:[^"\\\n]|\\.)*)"|`([^`\n]*)`/gu;
/** A template-literal substitution, whose value is not literal text. */
const substitutionPattern = /\$\{[^}]*\}/gu;
const wordPattern = /[A-Za-z][A-Za-z0-9]*/gu;
const sentenceEndPattern = /[.!?]["')\]]?\s+$/u;

interface GlossaryEntry {
  readonly line: number;
  readonly name: string;
}

interface Glossary {
  readonly avoided: ReadonlyMap<string, GlossaryEntry>;
  readonly terms: ReadonlyMap<string, number>;
  readonly words: ReadonlySet<string>;
}

/**
 * Reduces one term, identifier, or word to the form both sides of a Vocabulary
 * Binding share, so `Anchor`, `anchors`, and `ANCHOR` compare equal while
 * ordinary prose keeps its own spelling.
 */
function normalize(text: string): string {
  const compact = text.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
  return compact.length > 3 && compact.endsWith("s") ? compact.slice(0, -1) : compact;
}

function freezeLocation(location: FindingLocation): FindingLocation {
  return Object.freeze({
    end: Object.freeze({ ...location.end }),
    start: Object.freeze({ ...location.start }),
  });
}

function finding(
  code: string,
  message: string,
  path: string,
  location?: FindingLocation,
): Finding {
  return Object.freeze({
    attribution,
    code,
    "finding-schema": "1.0.0",
    ...(location === undefined ? {} : { location: freezeLocation(location) }),
    message,
    path,
    severity: "error",
  });
}

function lineLocation(line: number, text: string): FindingLocation {
  return { end: { column: text.length + 1, line }, start: { column: 1, line } };
}

function tokenLocation(
  content: string,
  start: number,
  length: number,
): FindingLocation {
  return {
    end: positionAt(content, start + length),
    start: positionAt(content, start),
  };
}

/**
 * Reads CONTEXT.md as the authoritative glossary: every defined term, every
 * avoided term, and every word those terms are spelled with. An avoidance entry
 * that begins in lower case is a human qualifier rather than an avoided term.
 */
export function parseGlossary(content: string): Glossary {
  const avoided = new Map<string, GlossaryEntry>();
  const terms = new Map<string, number>();
  const words = new Set<string>();
  const lines = content.split(/\r?\n/u);
  lines.forEach((text, index) => {
    const line = index + 1;
    const definition = definitionPattern.exec(text);
    if (definition !== null) {
      const name = definition[1] as string;
      if (!terms.has(name)) terms.set(name, line);
      for (const word of name.matchAll(wordPattern)) words.add(normalize(word[0]));
      return;
    }
    const avoidance = avoidancePattern.exec(text);
    if (avoidance === null) return;
    for (const entry of (avoidance[1] as string).split(",")) {
      const name = entry.trim();
      if (!/^\p{Lu}/u.test(name)) continue;
      const key = normalize(name);
      if (!avoided.has(key)) avoided.set(key, { line, name });
    }
  });
  return { avoided, terms, words };
}

interface BindingDisagreement {
  readonly actual: string;
  readonly expected: string;
  readonly surface: string;
}

/**
 * Derives the identifiers a glossary term requires. A Core Archetype term is one
 * capitalized word, its page type and page-ID prefix are that word in lower
 * case, its `.atlas/` directory is the plural of that word, and its diagnostic
 * stem is that word in upper case.
 */
function disagreements(
  term: string,
  bindings: CoreArchetypeBindings,
): readonly BindingDisagreement[] {
  const identifiers = bindings[term] as CoreArchetypeBindings[string];
  const base = term.toLowerCase();
  const expectations: readonly BindingDisagreement[] = [
    {
      actual: identifiers.diagnosticStem,
      expected: term.toUpperCase(),
      surface: "diagnostic code stem",
    },
    {
      actual: identifiers.directory,
      expected: `${base}s`,
      surface: "page directory",
    },
    { actual: identifiers.idPrefix, expected: base, surface: "page-ID prefix" },
    { actual: identifiers.pageType, expected: base, surface: "page type" },
  ];
  return expectations.filter(({ actual, expected }) => actual !== expected);
}

function validateBindings(
  bindings: CoreArchetypeBindings,
  glossary: Glossary,
  glossaryPath: string,
  content: string,
  findings: Finding[],
): void {
  const lines = content.split(/\r?\n/u);
  for (const term of Object.keys(bindings)) {
    const avoided = glossary.avoided.get(normalize(term));
    if (avoided !== undefined) {
      findings.push(
        finding(
          "ATLAS_VOCABULARY_TERM_AVOIDED",
          `Atlas SDK contracts bind the term ${JSON.stringify(term)}, which ${glossaryPath} lists as an avoided term.`,
          glossaryPath,
          lineLocation(avoided.line, lines[avoided.line - 1] as string),
        ),
      );
      continue;
    }
    const definitionLine = glossary.terms.get(term);
    if (definitionLine === undefined) {
      findings.push(
        finding(
          "ATLAS_VOCABULARY_TERM_UNDEFINED",
          `Atlas SDK contracts bind the term ${JSON.stringify(term)}, which ${glossaryPath} does not define.`,
          glossaryPath,
        ),
      );
      continue;
    }
    for (const { actual, expected, surface } of disagreements(term, bindings)) {
      findings.push(
        finding(
          "ATLAS_VOCABULARY_IDENTIFIER_MISMATCH",
          `Atlas SDK binds ${surface} ${JSON.stringify(actual)} to the term ${JSON.stringify(term)}, which requires ${JSON.stringify(expected)}.`,
          glossaryPath,
          lineLocation(definitionLine, lines[definitionLine - 1] as string),
        ),
      );
    }
  }
}

interface ContractVocabulary {
  readonly avoided: ReadonlyMap<string, GlossaryEntry>;
  readonly directories: ReadonlySet<string>;
  readonly glossaryPath: string;
  readonly prefixes: ReadonlySet<string>;
  readonly words: ReadonlySet<string>;
}

function avoidedFinding(
  vocabulary: ContractVocabulary,
  surface: string,
  token: string,
  file: VocabularyTextFile,
  location: FindingLocation,
): Finding | undefined {
  const avoided = vocabulary.avoided.get(normalize(token));
  if (avoided === undefined) return undefined;
  return finding(
    "ATLAS_VOCABULARY_IDENTIFIER_AVOIDED",
    `Atlas SDK uses ${JSON.stringify(token)} in ${surface}, which ${vocabulary.glossaryPath} lists as the avoided term ${JSON.stringify(avoided.name)}.`,
    file.path,
    location,
  );
}

function declaredFinding(
  vocabulary: ContractVocabulary,
  surface: string,
  declared: ReadonlySet<string>,
  token: string,
  file: VocabularyTextFile,
  location: FindingLocation,
): Finding | undefined {
  const avoided = avoidedFinding(vocabulary, surface, token, file, location);
  if (avoided !== undefined) return avoided;
  if (declared.has(token)) return undefined;
  return finding(
    "ATLAS_VOCABULARY_IDENTIFIER_UNDECLARED",
    `Atlas SDK uses the identifier ${JSON.stringify(token)} in ${surface}, which no ${vocabulary.glossaryPath} term defines.`,
    file.path,
    location,
  );
}

function wordFinding(
  vocabulary: ContractVocabulary,
  surface: string,
  word: string,
  file: VocabularyTextFile,
  location: FindingLocation,
): Finding | undefined {
  const avoided = avoidedFinding(vocabulary, surface, word, file, location);
  if (avoided !== undefined) return avoided;
  if (vocabulary.words.has(normalize(word))) return undefined;
  return finding(
    "ATLAS_VOCABULARY_WORD_UNKNOWN",
    `Atlas SDK uses the word ${JSON.stringify(word)} in ${surface}, which no ${vocabulary.glossaryPath} term defines.`,
    file.path,
    location,
  );
}

/**
 * Blanks the module specifiers a contract imports, so a runtime scheme such as
 * `node:` is never read as a page-ID prefix. Blanking preserves every offset, so
 * reported locations stay exact.
 */
function maskSpecifiers(content: string): string {
  return content.replaceAll(
    specifierPattern,
    (match: string, quote: string, specifier: string) =>
      match.slice(0, match.length - specifier.length - quote.length) +
      " ".repeat(specifier.length) +
      quote,
  );
}

function scanDiagnostics(
  vocabulary: ContractVocabulary,
  file: VocabularyTextFile,
  findings: Finding[],
): void {
  for (const match of file.content.matchAll(diagnosticPattern)) {
    const code = match[0];
    let offset = match.index;
    for (const segment of code.split("_")) {
      const result = wordFinding(
        vocabulary,
        `the diagnostic code ${code}`,
        segment,
        file,
        tokenLocation(file.content, offset, segment.length),
      );
      if (result !== undefined) findings.push(result);
      offset += segment.length + 1;
    }
  }
}

function scanIdentifiers(
  vocabulary: ContractVocabulary,
  file: VocabularyTextFile,
  findings: Finding[],
): void {
  for (const match of file.content.matchAll(directoryPattern)) {
    const directory = match[1] as string;
    const result = declaredFinding(
      vocabulary,
      "an Atlas page directory name",
      vocabulary.directories,
      directory,
      file,
      tokenLocation(
        file.content,
        match.index + match[0].indexOf(directory),
        directory.length,
      ),
    );
    if (result !== undefined) findings.push(result);
  }
  for (const match of file.content.matchAll(idPrefixPattern)) {
    const prefix = match[1] as string;
    const result = declaredFinding(
      vocabulary,
      "an Atlas page-ID prefix",
      vocabulary.prefixes,
      prefix,
      file,
      tokenLocation(file.content, match.index, prefix.length),
    );
    if (result !== undefined) findings.push(result);
  }
}

/**
 * Scans the Finding messages an SDK-owned contract declares. A message is a
 * single-line literal that contains a space and ends a sentence, so identifiers,
 * paths, and formats are never read as prose. Only a capitalized word that does
 * not open a sentence names a domain concept.
 */
function scanMessages(
  vocabulary: ContractVocabulary,
  file: VocabularyTextFile,
  findings: Finding[],
): void {
  for (const match of file.content.matchAll(literalPattern)) {
    const text = (match[1] ?? match[2]) as string;
    if (!text.includes(" ") || !text.endsWith(".")) continue;
    const message = text.replaceAll(substitutionPattern, " ");
    const start = match.index + match[0].indexOf(text);
    for (const word of message.matchAll(wordPattern)) {
      if (!/^\p{Lu}/u.test(word[0])) continue;
      if (sentenceEndPattern.test(message.slice(0, word.index))) continue;
      if (word.index === 0) continue;
      const result = wordFinding(
        vocabulary,
        "a Finding message",
        word[0],
        file,
        tokenLocation(file.content, start + word.index, word[0].length),
      );
      if (result !== undefined) findings.push(result);
    }
  }
}

function compareFindings(left: Finding, right: Finding): number {
  const path = compareCodePoints(left.path, right.path);
  if (path !== 0) return path;
  const line = (left.location?.start.line ?? 0) - (right.location?.start.line ?? 0);
  if (line !== 0) return line;
  const column =
    (left.location?.start.column ?? 0) - (right.location?.start.column ?? 0);
  if (column !== 0) return column;
  const code = compareCodePoints(left.code, right.code);
  return code === 0 ? compareCodePoints(left.message, right.message) : code;
}

/**
 * Validates that the CONTEXT.md glossary and the vocabulary bound into Atlas
 * SDK-owned contracts agree in both directions. Disagreement is reported as a
 * deeply immutable, trusted Finding naming the glossary term and the contract
 * identifier that disagree. The check reads identifiers, diagnostic codes, and
 * Finding messages rather than prose, so ordinary English that happens to match
 * a domain term produces no Finding. Identical input produces identical ordered
 * Findings.
 */
export function validateVocabularyAgreement(
  bindings: CoreArchetypeBindings,
  glossary: VocabularyTextFile,
  contracts: readonly VocabularyTextFile[],
): readonly Finding[] {
  const findings: Finding[] = [];
  const parsed = parseGlossary(glossary.content);
  if (parsed.terms.size === 0) {
    findings.push(
      finding(
        "ATLAS_VOCABULARY_GLOSSARY_EMPTY",
        `Atlas SDK requires ${glossary.path} to define the domain vocabulary its contracts bind.`,
        glossary.path,
      ),
    );
    return Object.freeze(findings);
  }

  validateBindings(bindings, parsed, glossary.path, glossary.content, findings);

  const identifiers = Object.values(bindings);
  const vocabulary: ContractVocabulary = {
    avoided: parsed.avoided,
    directories: new Set([
      ...identifiers.map((archetype) => archetype.directory),
      ...reservedPageDirectories,
    ]),
    glossaryPath: glossary.path,
    prefixes: new Set(identifiers.map((archetype) => archetype.idPrefix)),
    words: new Set([...parsed.words, ...structuralWords.map(normalize)]),
  };
  for (const file of [...contracts].sort((left, right) =>
    compareCodePoints(left.path, right.path),
  )) {
    const scanned: VocabularyTextFile = {
      content: maskSpecifiers(file.content),
      path: file.path,
    };
    scanDiagnostics(vocabulary, scanned, findings);
    scanIdentifiers(vocabulary, scanned, findings);
    scanMessages(vocabulary, scanned, findings);
  }

  return Object.freeze(findings.toSorted(compareFindings));
}
