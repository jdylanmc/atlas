import ts from "typescript";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
import {
  reservedPageDirectories,
  type CoreArchetypeBindings,
} from "../domain/core_archetype.ts";
import type {
  ContractVocabularyBinding,
  UnboundGlossaryTerm,
} from "../domain/contract_vocabulary.ts";
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
/** A term Atlas SDK can bind: one capitalized word or one PascalCase compound. */
const termPattern = /^\p{Lu}[\p{Ll}\p{N}]*(?:\p{Lu}[\p{Ll}\p{N}]*)*$/u;
/** A contract vocabulary term Atlas SDK can require in the glossary. */
const contractTermPattern = /^\p{Lu}[\p{L}\p{N}]*(?: \p{Lu}[\p{L}\p{N}]*)*$/u;
/** A word an avoidance entry names, rather than a human qualifier. */
const avoidedTermPattern = /^\p{Lu}/u;
/** An Atlas SDK diagnostic code, a shape ordinary prose does not spell. */
const diagnosticPattern = /ATLAS_[A-Z0-9_]+/gu;
/** An exported contract declaration identifier. */
const exportedIdentifierPattern =
  /(?:^|\n)\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|type|class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gu;
/** A directory segment followed by a separator, or an extensionless terminal
 * segment. Root filenames are not page directories. */
const directoryPattern =
  /\\?\.atlas\\?\/([A-Za-z0-9_.-]+(?=\\?\/)|[A-Za-z0-9_-]+(?=["'`\s]|$))/dgu;
const pathModulePattern = /^(?:node:)?path$/u;
/** A page-ID prefix, which requires an identifier or a substitution after its colon. */
const idPrefixPattern = /(?<![\p{L}\p{N}_-])([a-z][a-z0-9-]*):(?=[a-z0-9$])/gu;
/** A literal that is one lower-case identifier, the shape of a page type. */
const pageTypePattern = /^[a-z][a-z0-9-]*$/u;
/** A capitalized word in SDK-authored text, which may name a domain concept. */
const capitalizedPattern = /(?<![\p{L}\p{N}_])\p{Lu}[\p{L}\p{N}]*(?![\p{L}\p{N}_])/gu;
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
  if (/[sxz]$/u.test(word) || /(?:ch|sh)$/u.test(word)) return `${word}es`;
  return /[^aeiou]y$/u.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;
}

function kebabCaseTerm(term: string): string {
  return term.replace(/(?!^)([A-Z])/g, "-$1").toLowerCase();
}

function pluralizedIdentifier(base: string): string {
  if (!base.includes("-")) return pluralOf(base);
  const segments = base.split("-");
  const last = segments.pop() as string;
  return [...segments, pluralOf(last)].join("-");
}

/**
 * Reads CONTEXT.md as the authoritative glossary: every defined term, and every
 * unconditionally avoided term in singular and plural form. An avoidance entry
 * that begins in lower case opens a human qualifier, which scopes the one entry
 * before it to a condition validation does not judge. That entry is not
 * registered for validation, and no advice is emitted.
 * A qualifier that scopes no entry, or that hides an entry behind it,
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
  const base = kebabCaseTerm(term);
  const expectations: readonly BindingDisagreement[] = [
    {
      actual: identifiers.diagnosticStem,
      expected: base.replaceAll("-", "_").toUpperCase(),
      surface: "diagnostic code stem",
    },
    {
      actual: identifiers.directory,
      expected: pluralizedIdentifier(base),
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
  contractTerms: readonly ContractVocabularyBinding[],
  exportedIdentifiers: ReadonlySet<string>,
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
  for (const { exportedIdentifiers: exports, term } of contractTerms) {
    if (!contractTermPattern.test(term)) {
      findings.push(
        finding(
          "ATLAS_VOCABULARY_CONTRACT_TERM_UNSUPPORTED",
          `Atlas SDK contracts require the term ${JSON.stringify(term)}, which is not a capitalized term or phrase.`,
          glossaryPath,
        ),
      );
      continue;
    }
    const avoided = glossary.avoided.get(normalize(term));
    if (avoided !== undefined) {
      findings.push(
        finding(
          "ATLAS_VOCABULARY_CONTRACT_TERM_AVOIDED",
          `Atlas SDK contracts require the term ${JSON.stringify(term)}, which ${glossaryPath} lists as an avoided term.`,
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
          "ATLAS_VOCABULARY_CONTRACT_TERM_UNDEFINED",
          `Atlas SDK contracts require the term ${JSON.stringify(term)}, which ${glossaryPath} does not define.`,
          glossaryPath,
        ),
      );
      continue;
    }
    for (const exportedIdentifier of exports) {
      if (exportedIdentifiers.has(exportedIdentifier)) continue;
      findings.push(
        finding(
          "ATLAS_VOCABULARY_CONTRACT_EXPORT_MISSING",
          `Atlas SDK contracts require the term ${JSON.stringify(term)} to be exported as ${JSON.stringify(exportedIdentifier)}, but no scanned contract exports that identifier.`,
          glossaryPath,
        ),
      );
    }
  }
}

/**
 * Requires every glossary term to be classified exactly once: bound as a Core
 * Archetype, bound as a contract vocabulary term, or explicitly recorded as
 * not bound to a contract today. A term that is none of these went unnoticed
 * by whoever last touched the glossary or its contracts; a term that is more
 * than one is a stale `unboundGlossaryTerms` entry left behind after binding
 * it. Both are reported rather than silently resolved, so the omission this
 * check exists to catch is not itself guessed away.
 */
function validateTermClassification(
  bindings: CoreArchetypeBindings,
  contractTerms: readonly ContractVocabularyBinding[],
  unboundTerms: readonly UnboundGlossaryTerm[],
  glossary: Glossary,
  glossaryPath: string,
  findings: Finding[],
): void {
  const classified = new Set<string>([
    ...Object.keys(bindings),
    ...contractTerms.map((binding) => binding.term),
  ]);
  const unbound = new Set<string>();
  for (const { term } of unboundTerms) {
    if (!glossary.terms.has(term)) {
      findings.push(
        finding(
          "ATLAS_VOCABULARY_UNBOUND_TERM_UNDEFINED",
          `Atlas SDK records the term ${JSON.stringify(term)} as not bound to a contract, which ${glossaryPath} does not define.`,
          glossaryPath,
        ),
      );
      continue;
    }
    if (classified.has(term)) {
      findings.push(
        finding(
          "ATLAS_VOCABULARY_TERM_DOUBLE_CLASSIFIED",
          `Atlas SDK both binds the term ${JSON.stringify(term)} to a contract and records it as not bound to one; a term must be classified exactly once.`,
          glossaryPath,
        ),
      );
    }
    unbound.add(term);
  }
  for (const [term, line] of glossary.terms) {
    if (classified.has(term) || unbound.has(term)) continue;
    findings.push(
      finding(
        "ATLAS_VOCABULARY_TERM_UNCLASSIFIED",
        `${glossaryPath} defines the term ${JSON.stringify(term)}, which Atlas SDK neither binds to a contract nor records as deliberately unbound.`,
        glossaryPath,
        {
          end: { column: 1, line: line + 1 },
          start: { column: 1, line },
        },
      ),
    );
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

function isModuleCall(expression: ts.Expression): boolean {
  if (expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(expression)) return expression.text === "require";
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "resolve" &&
    ts.isMetaProperty(expression.expression) &&
    expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    expression.expression.name.text === "meta"
  );
}

function contractSyntax(source: ts.SourceFile): {
  readonly specifiers: ReadonlySet<ts.Node>;
  readonly computed: boolean;
} {
  const specifiers = new Set<ts.Node>();
  const pathNames = new Set<string>();
  const calls = new Set<string>();
  const analysis = { computed: false };
  function add(node: ts.Node | undefined): void {
    if (node !== undefined && ts.isStringLiteralLike(node)) specifiers.add(node);
  }
  function visit(node: ts.Node): void {
    if (
      ts.isTemplateExpression(node) ||
      (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    )
      analysis.computed = true;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (ts.isExternalModuleReference(node)) {
      add(node.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal);
    } else if (ts.isCallExpression(node) && isModuleCall(node.expression)) {
      add(node.arguments[0]);
    }
    if (ts.isCallExpression(node)) {
      let target = node.expression;
      while (ts.isPropertyAccessExpression(target)) target = target.expression;
      if (ts.isIdentifier(target)) calls.add(target.text);
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      pathModulePattern.test(node.moduleSpecifier.text)
    ) {
      const clause = node.importClause;
      if (clause?.name !== undefined) pathNames.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings !== undefined) {
        if (ts.isNamespaceImport(bindings)) pathNames.add(bindings.name.text);
        else for (const binding of bindings.elements) pathNames.add(binding.name.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return {
    specifiers,
    computed: analysis.computed || [...pathNames].some((name) => calls.has(name)),
  };
}

/** Only AST-proven module literals are blanked for whole-source identifier
 * scans. The original source and AST remain intact for literal scanning, and
 * each span keeps its UTF-16 length for exact source locations. */
function maskModuleSpecifiers(
  source: ts.SourceFile,
  specifiers: ReadonlySet<ts.Node>,
): string {
  const parts: string[] = [];
  let offset = 0;
  for (const node of specifiers) {
    const start = node.getStart(source);
    parts.push(source.text.slice(offset, start), " ".repeat(node.end - start));
    offset = node.end;
  }
  parts.push(source.text.slice(offset));
  return parts.join("");
}

function typescriptPositions(source: ts.SourceFile): PositionIndex {
  const positionAt = (offset: number): FindingLocation["start"] => {
    const position = source.getLineAndCharacterOfPosition(offset);
    return { column: position.character + 1, line: position.line + 1 };
  };
  return {
    rangeAt: (start, end) => ({ end: positionAt(end), start: positionAt(start) }),
  };
}

function normalizedContractPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function pathOperation(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): "join" | "resolve" | undefined {
  let target = expression;
  let operation: string | undefined;
  if (ts.isPropertyAccessExpression(target)) {
    operation = target.name.text;
    target = target.expression;
    if (
      ts.isPropertyAccessExpression(target) &&
      ["posix", "win32"].includes(target.name.text)
    ) {
      target = target.expression;
    }
  }
  const declaration = checker.getSymbolAtLocation(target)?.declarations?.[0];
  let imported: ts.Node | undefined;
  if (declaration !== undefined) {
    if (ts.isImportSpecifier(declaration)) {
      const name = (declaration.propertyName ?? declaration.name).text;
      if (operation === undefined || !["default", "posix", "win32"].includes(name))
        operation = name;
      imported = declaration.parent.parent.parent;
    } else if (ts.isNamespaceImport(declaration)) {
      imported = declaration.parent.parent;
    } else if (ts.isImportClause(declaration)) {
      imported = declaration.parent;
    }
  }
  return (operation === "join" || operation === "resolve") &&
    imported !== undefined &&
    ts.isImportDeclaration(imported) &&
    ts.isStringLiteral(imported.moduleSpecifier) &&
    pathModulePattern.test(imported.moduleSpecifier.text)
    ? operation
    : undefined;
}

function contractProgram(contracts: readonly VocabularyTextFile[]): {
  readonly program: ts.Program;
  readonly names: ReadonlyMap<VocabularyTextFile, string>;
  readonly checker: () => ts.TypeChecker;
} {
  const contents = new Map<string, string>();
  const names = new Map<VocabularyTextFile, string>();
  const directories = new Set<string>(["/"]);
  for (const file of contracts) {
    if (file.path.endsWith(".md") || file.content.length > CONTRACT_LIMIT) continue;
    let name = normalizedContractPath(file.path);
    if (contents.has(name)) name = `/duplicate-${String(names.size)}${name}`;
    names.set(file, name);
    contents.set(name, file.content);
    for (
      let slash = name.lastIndexOf("/");
      slash > 0;
      slash = name.lastIndexOf("/", slash - 1)
    ) {
      directories.add(name.slice(0, slash));
    }
  }
  const options: ts.CompilerOptions = {
    allowJs: true,
    allowNonTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleDetection: ts.ModuleDetectionKind.Force,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    target: ts.ScriptTarget.Latest,
    types: [],
  };
  const parser = ts.createCompilerHost(options, true);
  const readFile = contents.get.bind(contents);
  parser.readFile = readFile;
  const host: ts.CompilerHost = {
    getSourceFile: parser.getSourceFile.bind(parser),
    getDefaultLibFileName: parser.getDefaultLibFileName.bind(parser),
    getNewLine: parser.getNewLine.bind(parser),
    writeFile: parser.writeFile.bind(parser),
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    readFile,
    fileExists: contents.has.bind(contents),
    directoryExists: directories.has.bind(directories),
  };
  const program = ts.createProgram([...contents.keys()], options, host);
  let checker: ts.TypeChecker | undefined;
  return { names, program, checker: () => (checker ??= program.getTypeChecker()) };
}

/** Undefined is not statically known; null explicitly refuses an exhausted
 * analysis budget. No source expression or filesystem module is executed. */
function constantText(
  checker: () => ts.TypeChecker,
): (node: ts.Expression) => string | undefined | null {
  const memo = new Map<ts.Expression, string | undefined | null>();
  const visiting = new Set<ts.Expression>();
  let remaining = CONTRACT_LIMIT;
  function combine(
    left: string | undefined | null,
    right: string | undefined | null,
  ): string | undefined | null {
    if (left === null || right === null) return null;
    if (left === undefined || right === undefined) return undefined;
    const length = left.length + right.length;
    if (length > remaining) return null;
    remaining -= length;
    return left + right;
  }
  function read(node: ts.Expression, depth: number): string | undefined | null {
    if (memo.has(node)) return memo.get(node);
    if (visiting.has(node)) return undefined;
    if (depth >= 128) return null;
    visiting.add(node);
    let text: string | undefined | null;
    if (ts.isStringLiteralLike(node)) {
      text = node.text;
    } else if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      text = read(node.expression, depth + 1);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      text = combine(read(node.left, depth + 1), read(node.right, depth + 1));
    } else if (ts.isTemplateExpression(node)) {
      text = node.head.text;
      for (const span of node.templateSpans) {
        text = combine(
          combine(text, read(span.expression, depth + 1)),
          span.literal.text,
        );
      }
    } else if (ts.isCallExpression(node)) {
      const operation = pathOperation(node.expression, checker());
      if (operation !== undefined) {
        text = "";
        for (const argument of node.arguments) {
          const part = read(argument, depth + 1);
          if (
            operation === "resolve" &&
            typeof part === "string" &&
            /^[\\/]/u.test(part)
          )
            text = "";
          text = combine(combine(text, "/"), part === undefined ? "\0" : part);
        }
        if (typeof text === "string") text = normalizedContractPath(text);
      }
    } else if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const typeChecker = checker();
      let symbol = typeChecker.getSymbolAtLocation(node);
      if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
        symbol = typeChecker.getAliasedSymbol(symbol);
      }
      const declaration = symbol?.valueDeclaration;
      if (
        declaration !== undefined &&
        ts.isVariableDeclaration(declaration) &&
        ts.isVariableDeclarationList(declaration.parent) &&
        (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
        declaration.initializer !== undefined
      ) {
        text = read(declaration.initializer, depth + 1);
      }
    }
    visiting.delete(node);
    memo.set(node, text);
    return text;
  }
  return (node) => read(node, 0);
}

function scanDirectorySyntax(
  vocabulary: ContractVocabulary,
  file: VocabularyTextFile,
  source: ts.SourceFile,
  specifiers: ReadonlySet<ts.Node>,
  checker: (() => ts.TypeChecker) | undefined,
  positions: PositionIndex,
  findings: Finding[],
): string {
  const read = checker === undefined ? undefined : constantText(checker);
  const parts: string[] = [];
  let offset = 0;
  let limited = false;
  function visit(node: ts.Node): void {
    if (specifiers.has(node)) return;
    const literal = ts.isStringLiteralLike(node);
    if (
      literal ||
      ts.isTemplateExpression(node) ||
      ts.isCallExpression(node) ||
      (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    ) {
      const text = literal ? node.text : read?.(node);
      const start = node.getStart(source);
      if (text === null && !limited) {
        limited = true;
        findings.push(
          finding(
            "ATLAS_VOCABULARY_PATH_ANALYSIS_LIMIT",
            "Atlas SDK could not inspect a computed directory reference within its bounded constant-analysis budget.",
            file.path,
            positions.rangeAt(start, node.end),
          ),
        );
      }
      if (typeof text === "string") {
        parts.push(file.content.slice(offset, start), " ".repeat(node.end - start));
        offset = node.end;
        scanDirectories(
          vocabulary,
          { content: text.replaceAll(/\\(?![./])/gu, "/"), path: file.path },
          {
            rangeAt:
              literal && source.text.slice(start + 1, node.end - 1) === text
                ? (from, to) => positions.rangeAt(start + 1 + from, start + 1 + to)
                : () => positions.rangeAt(start, node.end),
          },
          findings,
        );
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  parts.push(file.content.slice(offset));
  return parts.join("");
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
 * Scans the literals a contract declares, where a page-ID prefix, a
 * page type, Finding message, or generated prompt fragment is spelled. A prompt
 * fragment may be one word and need not end in a full stop. Its capitalized
 * words are read singly and in adjacent runs, so a term of several words is read
 * as one name. The TypeScript parser distinguishes regular expressions,
 * division, comments, and template substitutions using the language grammar.
 * Only literal nodes are read; template heads and middles retain their final
 * `$`, so a page-ID prefix followed by a substitution stays visible.
 */
function scanLiterals(
  vocabulary: ContractVocabulary,
  file: VocabularyTextFile,
  source: ts.SourceFile,
  specifiers: ReadonlySet<ts.Node>,
  positions: PositionIndex,
  findings: Finding[],
): void {
  function visit(node: ts.Node): void {
    if (specifiers.has(node)) return;
    if (!ts.isStringLiteralLike(node) && !ts.isTemplateLiteralToken(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    const start = node.getStart(source) + 1;
    const text = file.content.slice(start, node.end - 1);
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
    scanRuns(
      vocabulary,
      text.endsWith(".") ? "a Finding message" : "a contract literal",
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
  visit(source);
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

function exportedIdentifiersOf(
  contracts: readonly VocabularyTextFile[],
): ReadonlySet<string> {
  const exportedIdentifiers = new Set<string>();
  for (const file of contracts) {
    if (file.content.length > CONTRACT_LIMIT || !/^src[\\/].+\.ts$/u.test(file.path)) {
      continue;
    }
    for (const exported of file.content.matchAll(exportedIdentifierPattern)) {
      exportedIdentifiers.add(exported[1] as string);
    }
  }
  return exportedIdentifiers;
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
 * literal. Generated Markdown prompts expose their capitalized
 * domain terms directly rather than through TypeScript literals. Lower-case
 * ordinary English is not a capitalized domain term. Identical input produces
 * identical ordered Findings.
 */
export function validateVocabularyAgreement(
  bindings: CoreArchetypeBindings,
  contractTerms: readonly ContractVocabularyBinding[],
  unboundTerms: readonly UnboundGlossaryTerm[],
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
  validateBindings(
    bindings,
    contractTerms,
    exportedIdentifiersOf(contracts),
    parsed,
    glossary.path,
    glossary.content,
    findings,
  );
  validateTermClassification(
    bindings,
    contractTerms,
    unboundTerms,
    parsed,
    glossary.path,
    findings,
  );

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
  let compilation: ReturnType<typeof contractProgram> | undefined;
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
    let source = file.path.endsWith(".md")
      ? undefined
      : ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest);
    let syntax = source === undefined ? undefined : contractSyntax(source);
    let typeChecker: (() => ts.TypeChecker) | undefined;
    if (syntax?.computed === true) {
      compilation ??= contractProgram(contracts);
      const compiledSource = compilation.program.getSourceFile(
        compilation.names.get(file) as string,
      ) as ts.SourceFile;
      source = compiledSource;
      syntax = contractSyntax(compiledSource);
      typeChecker = compilation.checker;
    }
    const specifiers = syntax?.specifiers ?? new Set<ts.Node>();
    const scanned: VocabularyTextFile = {
      content:
        source === undefined ? file.content : maskModuleSpecifiers(source, specifiers),
      path: file.path,
    };
    const positions =
      source === undefined ? positionIndex(file.content) : typescriptPositions(source);
    scanDiagnostics(vocabulary, scanned, positions, findings);
    const directoryContent =
      source === undefined
        ? scanned.content
        : scanDirectorySyntax(
            vocabulary,
            scanned,
            source,
            specifiers,
            typeChecker,
            positions,
            findings,
          );
    scanDirectories(
      vocabulary,
      { content: directoryContent, path: file.path },
      positions,
      findings,
    );
    if (source === undefined) {
      scanRuns(
        vocabulary,
        "a generated Markdown prompt",
        scanned.content,
        [...scanned.content.matchAll(capitalizedPattern)].map((word) => ({
          index: word.index,
          length: word[0].length,
        })),
        (index, length) => positions.rangeAt(index, index + length),
        scanned,
        findings,
      );
    } else {
      scanLiterals(vocabulary, file, source, specifiers, positions, findings);
    }
  }

  return Object.freeze(findings.toSorted(compareFindings));
}
