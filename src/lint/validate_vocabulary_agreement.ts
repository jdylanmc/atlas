import { compareCodePoints } from "../atlas/compare_code_points.ts";
import {
  reservedPageDirectories,
  type CoreArchetypeBindings,
} from "../domain/core_archetype.ts";
import type { Finding, FindingLocation } from "../domain/finding.ts";
import { sdkFindings } from "./sdk_finding.ts";
import { positionIndex, type PositionIndex } from "./source_position.ts";

export interface VocabularyTextFile {
  readonly content: string;
  readonly path: string;
}

const finding = sdkFindings("sdk-core.vocabulary-agreement");

/** A glossary definition heading, for example `**Anchor**:`. */
const definitionPattern = /^\*\*(.+)\*\*:$/u;
/** A glossary avoidance line, for example `_Avoid_: Bonfire, Landmark, Hub`. */
const avoidancePattern = /^_Avoid_: (.+)$/u;
/** A term Atlas SDK can bind: one capitalized word. */
const termPattern = /^\p{Lu}[\p{Ll}\p{N}]*$/u;
/** A word an avoidance entry names, rather than a human qualifier. */
const avoidedTermPattern = /^\p{Lu}/u;
/** An Atlas SDK diagnostic code, a shape ordinary prose does not spell. */
const diagnosticPattern = /ATLAS_[A-Z0-9_]+/gu;
/** An `.atlas/` directory reference, in plain or regular-expression form. */
const directoryPattern = /\\?\.atlas\\?\/([A-Za-z0-9_.-]+)\\?\//dgu;
/** A module specifier, which names a file or a runtime scheme, not an Atlas page.
 * Each keyword opens a statement rather than continuing an expression, so a
 * method named `from` or `require` does not mask the literal it reads. */
const specifierPattern =
  /(?<![.\w$])(?:from|import(?:\.meta\.resolve)?|require)\s{0,64}(?:\(\s{0,64})?(["'])((?:[^"'\n\\]|\\.)*)\1/gu;
/** A single-line string or template literal. The opening quote follows no
 * backslash and the body cannot backtrack, so each literal is read once and a
 * line of escaped quotes costs one pass rather than one pass for each quote. */
const literalPattern = /(?<!\\)"(?=((?:[^"\\\n]|\\.)*))\1"|(?<!\\)`(?=([^`\n]*))\2`/dgu;
/** A template-literal substitution, whose value is not literal text. Blanking it
 * keeps its opening `$`, so a page-ID prefix spelled before it stays readable. */
const substitutionPattern = /\$\{[^}]*\}/gu;
/** A page-ID prefix, which requires an identifier or a substitution after its colon. */
const idPrefixPattern = /(?<![\p{L}\p{N}_-])([a-z][a-z0-9-]*):(?=[a-z0-9$])/gu;
/** A literal that is one lower-case identifier, the shape of a page type. */
const pageTypePattern = /^[a-z][a-z0-9-]*$/u;
/** A capitalized word in a Finding message, which may name a domain concept. */
const capitalizedPattern = /\p{Lu}[\p{L}\p{N}]*/gu;
/** Words a single space or underscore joins, the shape a run of tokens spells
 * when it names one multi-word term. */
const phrasePattern = /^[\p{L}\p{N}]+(?:[ _][\p{L}\p{N}]+)*$/u;
/** The longest contract Atlas SDK reads, far beyond the length of any source it
 * owns. A longer file is reported rather than scanned, so no one contract can
 * spend a whole continuous integration run. */
const CONTRACT_LIMIT = 1_048_576;

interface GlossaryEntry {
  readonly line: number;
  readonly name: string;
}

interface Glossary {
  readonly avoided: ReadonlyMap<string, GlossaryEntry>;
  readonly malformed: readonly number[];
  readonly terms: ReadonlyMap<string, number>;
}

/**
 * Folds case and punctuation away, so `Anchor`, `anchor`, and `ANCHOR` compare
 * equal. A plural is registered explicitly rather than stemmed, so no word is
 * silently truncated.
 */
function normalize(text: string): string {
  return text.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

/** Whether an avoidance entry names a term rather than opening a qualifier. */
function isAvoidedName(entry: string): boolean {
  return avoidedTermPattern.test(entry);
}

/** The plural Atlas SDK spells a lower-case term with. */
function pluralOf(word: string): string {
  return /[^aeiou]y$/u.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;
}

/**
 * Reads CONTEXT.md as the authoritative glossary: every defined term, and every
 * unconditionally avoided term in singular and plural form. An avoidance entry
 * that begins in lower case opens a human qualifier, which scopes the one entry
 * before it to a condition validation cannot judge, so that entry stays
 * advisory. A qualifier that scopes no entry, or that hides an entry behind it,
 * leaves an avoidance no reader can rely on, and its line is reported malformed.
 * An empty entry, which a stray comma leaves behind, is neither a term nor a
 * qualifier: the line binds what it would bind without the comma, and is
 * reported.
 */
export function parseGlossary(content: string): Glossary {
  const avoided = new Map<string, GlossaryEntry>();
  const malformed: number[] = [];
  const terms = new Map<string, number>();
  const register = (names: readonly string[], line: number): void => {
    for (const name of names) {
      const singular = normalize(name);
      for (const key of [singular, pluralOf(singular)]) {
        if (!avoided.has(key)) avoided.set(key, { line, name });
      }
    }
  };
  content.split(/\r?\n/u).forEach((text, index) => {
    const line = index + 1;
    const definition = definitionPattern.exec(text);
    if (definition !== null) {
      const name = definition[1] as string;
      if (!terms.has(name)) terms.set(name, line);
      return;
    }
    const avoidance = avoidancePattern.exec(text);
    if (avoidance === null) return;
    const entries = (avoidance[1] as string).split(",").map((entry) => entry.trim());
    const named = entries.filter((entry) => entry.length > 0);
    const qualifier = named.findIndex((entry) => !isAvoidedName(entry));
    const hidden = qualifier >= 0 && named.slice(qualifier + 1).some(isAvoidedName);
    if (named.length !== entries.length || qualifier === 0 || hidden) {
      malformed.push(line);
    }
    register(
      named.slice(0, qualifier < 0 ? named.length : Math.max(qualifier - 1, 0)),
      line,
    );
  });
  return { avoided, malformed, terms };
}

interface BindingDisagreement {
  readonly actual: string;
  readonly expected: string;
  readonly surface: string;
}

/**
 * The identifiers a glossary term requires. Atlas SDK spells a Core Archetype's
 * page type and page-ID prefix as the term in lower case, its `.atlas/`
 * directory as the plural of that word, and its diagnostic stem as the term in
 * upper case, so a binding records the spelling its term already fixes.
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
      expected: pluralOf(base),
      surface: "page directory",
    },
    { actual: identifiers.idPrefix, expected: base, surface: "page-ID prefix" },
    { actual: identifiers.pageType, expected: base, surface: "page type" },
  ];
  return expectations.filter(({ actual, expected }) => actual !== expected);
}

/**
 * Reports every avoidance line that a reader and validation would read
 * differently: a qualifier that leaves an entry unenforced without saying so,
 * or a stray comma that leaves an entry empty.
 */
function validateAvoidance(
  glossary: Glossary,
  file: VocabularyTextFile,
  findings: Finding[],
): void {
  const lines = file.content.split(/\r?\n/u);
  for (const line of glossary.malformed) {
    findings.push(
      finding(
        "ATLAS_VOCABULARY_AVOIDANCE_MALFORMED",
        `Atlas SDK requires every avoidance entry in ${file.path} to name a term, and a qualifier to follow the one term it scopes and to end its line.`,
        file.path,
        {
          end: { column: (lines[line - 1] as string).length + 1, line },
          start: { column: 1, line },
        },
      ),
    );
  }
}

function validateBindings(
  bindings: CoreArchetypeBindings,
  glossary: Glossary,
  glossaryPath: string,
  content: string,
  findings: Finding[],
): void {
  const lines = content.split(/\r?\n/u);
  const lineLocation = (line: number): FindingLocation => ({
    end: { column: (lines[line - 1] as string).length + 1, line },
    start: { column: 1, line },
  });
  for (const term of Object.keys(bindings)) {
    if (!termPattern.test(term)) {
      findings.push(
        finding(
          "ATLAS_VOCABULARY_TERM_UNSUPPORTED",
          `Atlas SDK contracts bind the term ${JSON.stringify(term)}, which is not one capitalized word.`,
          glossaryPath,
        ),
      );
      continue;
    }
    const avoided = glossary.avoided.get(normalize(term));
    if (avoided !== undefined) {
      findings.push(
        finding(
          "ATLAS_VOCABULARY_TERM_AVOIDED",
          `Atlas SDK contracts bind the term ${JSON.stringify(term)}, which ${glossaryPath} lists as an avoided term.`,
          glossaryPath,
          lineLocation(avoided.line),
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
          lineLocation(definitionLine),
        ),
      );
    }
  }
}

interface ContractVocabulary {
  readonly avoided: ReadonlyMap<string, GlossaryEntry>;
  readonly directories: ReadonlySet<string>;
  readonly glossaryPath: string;
  readonly phrase: number;
  readonly prefixes: ReadonlySet<string>;
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

/**
 * Blanks the module specifier of an import, a `require`, or an
 * `import.meta.resolve`, so a runtime scheme such as `node:` is not read as a
 * page-ID prefix. Blanking preserves every offset, so locations stay exact. A
 * specifier reached any other way stays visible to the scan.
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

interface TokenSpan {
  readonly index: number;
  readonly length: number;
}

/** Where a capture group matched, which a `d` pattern records exactly rather
 * than a search of the whole match recovering by guess. */
function captureAt(match: RegExpExecArray, group: number): readonly [number, number] {
  const indices = match.indices as RegExpIndicesArray;
  return indices[group] as [number, number];
}

/**
 * Reports every run of adjacent tokens that spells an avoided term. A term of
 * several words, such as one an `_Avoid_` line writes with a space, reaches a
 * token surface split across as many tokens, so a run is read as the text that
 * spans it. Runs are read longest first, and a run that names a term is not
 * read again in shorter parts.
 */
function scanRuns(
  vocabulary: ContractVocabulary,
  surface: string,
  text: string,
  tokens: readonly TokenSpan[],
  at: (index: number, length: number) => FindingLocation,
  file: VocabularyTextFile,
  findings: Finding[],
): void {
  for (let start = 0; start < tokens.length;) {
    let named = 0;
    for (
      let run = Math.min(vocabulary.phrase, tokens.length - start);
      run > 0 && named === 0;
      run -= 1
    ) {
      const first = tokens[start] as TokenSpan;
      const last = tokens[start + run - 1] as TokenSpan;
      const length = last.index + last.length - first.index;
      const token = text.slice(first.index, first.index + length);
      if (!phrasePattern.test(token)) continue;
      const result = avoidedFinding(
        vocabulary,
        surface,
        token,
        file,
        at(first.index, length),
      );
      if (result !== undefined) {
        findings.push(result);
        named = run;
      }
    }
    start += Math.max(named, 1);
  }
}

/**
 * Scans the diagnostic codes a contract declares. Ordinary prose does not spell
 * this shape, so each segment is vocabulary wherever the code appears, comments
 * included, and adjacent segments spell a term of as many words.
 */
function scanDiagnostics(
  vocabulary: ContractVocabulary,
  file: VocabularyTextFile,
  positions: PositionIndex,
  findings: Finding[],
): void {
  for (const match of file.content.matchAll(diagnosticPattern)) {
    const code = match[0];
    const tokens: TokenSpan[] = [];
    let offset = match.index;
    for (const segment of code.split("_")) {
      tokens.push({ index: offset, length: segment.length });
      offset += segment.length + 1;
    }
    scanRuns(
      vocabulary,
      `the diagnostic code ${code}`,
      file.content,
      tokens,
      (index, length) => positions.rangeAt(index, index + length),
      file,
      findings,
    );
  }
}

/**
 * Scans the `.atlas/` directory names a contract references. The `.atlas/`
 * prefix makes the name that follows it an Atlas page directory.
 */
function scanDirectories(
  vocabulary: ContractVocabulary,
  file: VocabularyTextFile,
  positions: PositionIndex,
  findings: Finding[],
): void {
  for (const match of file.content.matchAll(directoryPattern)) {
    const directory = match[1] as string;
    const [start] = captureAt(match, 1);
    const result = declaredFinding(
      vocabulary,
      "an Atlas page directory name",
      vocabulary.directories,
      directory,
      file,
      positions.rangeAt(start, start + directory.length),
    );
    if (result !== undefined) findings.push(result);
  }
}

/**
 * Scans the single-line literals a contract declares, where a page-ID prefix, a
 * page type, and a Finding message are spelled. A Finding message is a literal of
 * several words ending in a full stop, which is the shape every Atlas SDK message
 * carries and which a Markdown code span in a comment does not. Its capitalized
 * words are read singly and in adjacent runs, so a term of several words is read
 * as one name. Every surface reads the literal with each substitution blanked at
 * its own length, so locations stay exact and a substituted value is never read
 * as literal text.
 */
function scanLiterals(
  vocabulary: ContractVocabulary,
  file: VocabularyTextFile,
  positions: PositionIndex,
  findings: Finding[],
): void {
  for (const match of file.content.matchAll(literalPattern)) {
    const quoted = match[1] !== undefined;
    const raw = (quoted ? match[1] : match[2]) as string;
    const [start] = captureAt(match, quoted ? 1 : 2);
    const text = raw.replaceAll(
      substitutionPattern,
      (value) => `$${" ".repeat(value.length - 1)}`,
    );
    const at = (offset: number, length: number): FindingLocation =>
      positions.rangeAt(start + offset, start + offset + length);
    for (const prefix of text.matchAll(idPrefixPattern)) {
      const token = prefix[1] as string;
      const result = declaredFinding(
        vocabulary,
        "an Atlas page-ID prefix",
        vocabulary.prefixes,
        token,
        file,
        at(prefix.index, token.length),
      );
      if (result !== undefined) findings.push(result);
    }
    if (pageTypePattern.test(text)) {
      const result = avoidedFinding(
        vocabulary,
        "an Atlas page type",
        text,
        file,
        at(0, text.length),
      );
      if (result !== undefined) findings.push(result);
    }
    if (!text.includes(" ") || !text.endsWith(".")) continue;
    scanRuns(
      vocabulary,
      "a Finding message",
      text,
      [...text.matchAll(capitalizedPattern)].map((word) => ({
        index: word.index,
        length: word[0].length,
      })),
      at,
      file,
      findings,
    );
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
 * identifier that disagree.
 *
 * The check reads identifiers rather than prose. A diagnostic code and an
 * `.atlas/` directory reference are identifiers wherever a contract writes them;
 * a page-ID prefix, a page type, and a Finding message are read only inside a
 * single-line literal. Ordinary English writes none of those shapes, so a
 * sentence that uses a domain word raises nothing. Identical input produces
 * identical ordered Findings.
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

  validateAvoidance(parsed, glossary, findings);
  validateBindings(bindings, parsed, glossary.path, glossary.content, findings);

  const identifiers = Object.values(bindings);
  const vocabulary: ContractVocabulary = {
    avoided: parsed.avoided,
    directories: new Set([
      ...identifiers.map((archetype) => archetype.directory),
      ...reservedPageDirectories,
    ]),
    glossaryPath: glossary.path,
    phrase: Math.max(
      1,
      ...[...parsed.avoided.values()].map((entry) => entry.name.split(" ").length),
    ),
    prefixes: new Set(identifiers.map((archetype) => archetype.idPrefix)),
  };
  for (const file of [...contracts].sort((left, right) =>
    compareCodePoints(left.path, right.path),
  )) {
    if (file.content.length > CONTRACT_LIMIT) {
      findings.push(
        finding(
          "ATLAS_VOCABULARY_CONTRACT_OVERSIZE",
          `Atlas SDK reads a contract of at most ${String(CONTRACT_LIMIT)} characters, and ${file.path} is longer, so its vocabulary went unread.`,
          file.path,
        ),
      );
      continue;
    }
    const scanned: VocabularyTextFile = {
      content: maskSpecifiers(file.content),
      path: file.path,
    };
    const positions = positionIndex(scanned.content);
    scanDiagnostics(vocabulary, scanned, positions, findings);
    scanDirectories(vocabulary, scanned, positions, findings);
    scanLiterals(vocabulary, scanned, positions, findings);
  }

  return Object.freeze(findings.toSorted(compareFindings));
}
