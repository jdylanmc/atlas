import type {
  FootnoteDefinition,
  FootnoteReference,
  Heading,
  Nodes,
  Paragraph,
  PhrasingContent,
  Text,
} from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { toString } from "mdast-util-to-string";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { isScalar, parseDocument, type Node, type Pair, type YAMLMap } from "yaml";
import type { Finding } from "../domain/finding.ts";
import type { RealmTextFile } from "../realm/load_realm_text.ts";
import {
  classifyRealmTextPath,
  parseRealmPages,
  RealmPageParseError,
  type ParsedRealmPage,
} from "../realm/parse_realm_pages.ts";

type FindingLocation = NonNullable<Finding["location"]>;
type MarkdownPosition = NonNullable<Nodes["position"]>;

const attribution = Object.freeze({
  checkId: "atlas-core.structural-validation",
  kind: "atlas-core" as const,
  trusted: true as const,
});

const parseCodes = Object.freeze({
  INVALID_PAGE_ENVELOPE: "ATLAS_PAGE_INVALID_ENVELOPE",
  MALFORMED_FRONTMATTER: "ATLAS_PAGE_MALFORMED_FRONTMATTER",
  MISSING_FRONTMATTER: "ATLAS_PAGE_MISSING_FRONTMATTER",
});

const parseMessages = Object.freeze({
  INVALID_PAGE_ENVELOPE: "Realm page frontmatter does not satisfy the page envelope.",
  MALFORMED_FRONTMATTER: "Realm page frontmatter is malformed.",
  MISSING_FRONTMATTER: "Realm page frontmatter is missing.",
});

const corePathTypes = Object.freeze({
  bonfires: "bonfire",
  insights: "insight",
  lore: "lore",
  pillars: "pillar",
  threads: "thread",
} as const);
const coreTypeNames: ReadonlySet<string> = new Set(Object.values(corePathTypes));

const lorePrefix = ".atlas/lore/";

const citationLabelBreak = /[\t\n\r ]/u;
const citationLabelEscapable: ReadonlySet<string> = new Set(["[", "\\", "]"]);
const citationLabelLimit = 999;

const markdownOptions = Object.freeze({
  extensions: [gfmFootnote()],
  mdastExtensions: [gfmFootnoteFromMarkdown()],
});

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (point) => point.codePointAt(0) as number);
  const rightPoints = Array.from(right, (point) => point.codePointAt(0) as number);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
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

function positionAt(content: string, offset: number): FindingLocation["start"] {
  const before = content.slice(0, offset);
  const lines = before.split(/\r?\n/u);
  return {
    column: (lines.at(-1) as string).length + 1,
    line: lines.length,
  };
}

function rangeAt(content: string, start: number, end: number): FindingLocation {
  return { end: positionAt(content, end), start: positionAt(content, start) };
}

function lineLocation(content: string, line: number): FindingLocation | undefined {
  const lines = content.split(/\r?\n/u);
  const text = lines[line - 1];
  if (text === undefined) return undefined;
  return {
    end: { column: text.length + 1, line },
    start: { column: 1, line },
  };
}

function pairFor(map: unknown, key: string): Pair<Node, Node> {
  return (map as YAMLMap<Node, Node>).items.find(
    (pair) => isScalar(pair.key) && pair.key.value === key,
  ) as Pair<Node, Node>;
}

function atlasKeyLocation(
  content: string,
  key: "created-at" | "id" | "type" | "updated-at",
): FindingLocation {
  const openingLength = content.indexOf("\n") + 1;
  const closing = /^---(?:\r?\n|$)/gmu;
  closing.lastIndex = openingLength;
  const match = closing.exec(content) as RegExpExecArray;

  const document = parseDocument(content.slice(openingLength, match.index), {
    strict: true,
    uniqueKeys: true,
  });
  const atlas = pairFor(document.contents, "atlas");
  const target = pairFor(atlas.value, key);
  const range = target.key.range as [number, number, number];
  return rangeAt(content, openingLength + range[0], openingLength + range[1]);
}

function expectedType(path: string): string | undefined {
  if (path === ".atlas/index.md") return "bonfire";
  const custom = /^\.atlas\/types\/([^/]+)\/.+\.md$/u.exec(path);
  if (custom !== null) return custom[1];
  const start = ".atlas/".length;
  const directory = path.slice(start, path.indexOf("/", start));
  return corePathTypes[directory as keyof typeof corePathTypes];
}

function customTypeName(path: string): string | undefined {
  return /^\.atlas\/types\/([^/]+)\/.+\.md$/u.exec(path)?.[1];
}

function markdownLocation(
  parsed: ParsedRealmPage,
  position: MarkdownPosition,
): FindingLocation {
  return {
    end: {
      column: position.end.column,
      line: parsed.source.body.startLine + position.end.line - 1,
    },
    start: {
      column: position.start.column,
      line: parsed.source.body.startLine + position.start.line - 1,
    },
  };
}

function markdownHeadingFinding(
  parsed: ParsedRealmPage,
  content: string,
  tree: Nodes,
): Finding | undefined {
  const first = (tree as { readonly children: readonly Nodes[] }).children[0];
  if (first?.type !== "heading" || first.depth !== 1) {
    const position = first?.position;
    const location =
      position === undefined
        ? lineLocation(content, parsed.source.body.startLine)
        : markdownLocation(parsed, position);
    return finding(
      "ATLAS_PAGE_TITLE_H1_REQUIRED",
      "The first substantive Markdown block must be an H1 matching the Atlas title.",
      parsed.source.path,
      location,
    );
  }
  if (toString(first) === parsed.page.atlas.title) return undefined;
  return finding(
    "ATLAS_PAGE_TITLE_H1_MISMATCH",
    "The first Markdown H1 must exactly match the Atlas title.",
    parsed.source.path,
    markdownLocation(parsed, first.position as MarkdownPosition),
  );
}

interface CitationTarget {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

interface CitationSourceRange {
  readonly end: number;
  readonly start: number;
}

type CitationTargetResolution =
  | { readonly kind: "invalid" }
  | { readonly kind: "missing" }
  | { readonly kind: "not-lore" }
  | { readonly kind: "valid" };

/**
 * Collects `[[target]]` markers only from parser-visible source ranges owned by
 * one footnote definition. Each scan step advances past the marker it accepted,
 * so the ranges are examined in linear bounded time without a global wiki-link
 * parser extension. Malformed marker boundaries fail the scan closed.
 */
function citationTargets(
  source: string,
  ranges: readonly CitationSourceRange[],
): readonly CitationTarget[] | undefined {
  const targets: CitationTarget[] = [];
  for (const range of ranges) {
    const visible = source.slice(range.start, range.end);
    let index = 0;
    for (;;) {
      const open = visible.indexOf("[[", index);
      if (open === -1) break;
      const close = visible.indexOf("]]", open + 2);
      const nestedOpen = visible.indexOf("[[", open + 2);
      if (close === -1 || (nestedOpen !== -1 && nestedOpen < close)) {
        return undefined;
      }
      targets.push({
        end: range.start + close + 2,
        start: range.start + open,
        text: visible.slice(open + 2, close),
      });
      index = close + 2;
    }
  }
  return targets;
}

/**
 * Normalizes one Citation target to its canonical Realm-relative Lore page path.
 * Fragments, aliases, extensions, traversal, and non-canonical segments are
 * rejected outright rather than repaired.
 */
function citationTargetPath(text: string): string | undefined {
  if (/[\s\p{Cc}#|\\]/u.test(text)) return undefined;
  const segments = text.split("/");
  if (segments.length < 2) return undefined;
  if (segments[0] !== ".atlas") return undefined;
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    return undefined;
  if ((segments.at(-1) as string).includes(".")) return undefined;
  return `${text}.md`;
}

function resolveCitationTarget(
  text: string,
  pagePaths: ReadonlySet<string>,
): CitationTargetResolution {
  const path = citationTargetPath(text);
  if (path === undefined) return { kind: "invalid" };
  if (!path.startsWith(lorePrefix)) return { kind: "not-lore" };
  if (!pagePaths.has(path)) return { kind: "missing" };
  return { kind: "valid" };
}

const targetCodes = Object.freeze({
  invalid: "ATLAS_CITATION_TARGET_INVALID",
  missing: "ATLAS_CITATION_TARGET_MISSING",
  "not-lore": "ATLAS_CITATION_TARGET_NOT_LORE",
});

const targetMessages = Object.freeze({
  invalid:
    "Citation target must be a canonical Realm-relative path without fragment, alias, extension, or traversal.",
  missing: "Citation target must resolve to an existing local Lore page.",
  "not-lore": "Citation target must address a Realm Lore page.",
});

function offsetLocation(
  parsed: ParsedRealmPage,
  origin: MarkdownPosition,
  target: CitationTarget,
): FindingLocation {
  const body = parsed.page.body;
  const from = origin.start.offset as number;
  let line = origin.start.line;
  let column = origin.start.column;
  let start: FindingLocation["start"] | undefined;
  for (let index = from; index < from + target.end; index += 1) {
    if (index === from + target.start) start = { column, line };
    if (body[index] === "\n") {
      line += 1;
      column = 1;
    } else column += 1;
  }
  return markdownLocation(parsed, {
    end: { column, line },
    start: start as FindingLocation["start"],
  });
}

interface SourceCursor {
  column: number;
  index: number;
  line: number;
}

interface CitationVisiblePart {
  readonly end: MarkdownPosition["end"];
  readonly start: MarkdownPosition["start"];
  readonly textRanges: readonly CitationSourceRange[];
}

type CitationVisibleRun = CitationVisiblePart;

type CitationProse = Heading | Paragraph;

const citationFormattingTypes: ReadonlySet<PhrasingContent["type"]> = new Set([
  "delete",
  "emphasis",
  "strong",
]);

function isAutolink(node: Nodes, body: string): boolean {
  return (
    node.type === "link" &&
    body[(node.position as MarkdownPosition).start.offset as number] === "<"
  );
}

function isCitationFormatting(
  node: PhrasingContent,
): node is Extract<
  PhrasingContent,
  { readonly type: "delete" | "emphasis" | "strong" }
> {
  return citationFormattingTypes.has(node.type);
}

/**
 * Advances one cursor across exactly `count` source characters while keeping
 * its line and column exact, counting `\n` as the only line ending like the
 * other Markdown offset locations in this check.
 */
function advanceCursor(source: string, cursor: SourceCursor, count: number): void {
  for (let step = 0; step < count; step += 1) {
    if (source[cursor.index] === "\n") {
      cursor.column = 1;
      cursor.line += 1;
    } else cursor.column += 1;
    cursor.index += 1;
  }
}

/**
 * Mirrors the parser's footnote call label grammar at one source offset: `[^`,
 * then at most 999 label characters carrying no line ending, space, tab, or
 * unescaped bracket, then `]`. Shapes the parser could never resolve to a
 * Citation reference are not markers and are never reported: a label carrying
 * whitespace is ordinary bracketed Markdown, never a footnote Citation.
 */
function citationMarkerLabel(source: string, from: number): string | undefined {
  if (source[from] !== "[" || source[from + 1] !== "^") return undefined;
  const start = from + 2;
  let index = start;
  while (index - start <= citationLabelLimit) {
    const character = source[index];
    if (
      character === undefined ||
      character === "[" ||
      citationLabelBreak.test(character)
    ) {
      return undefined;
    }
    if (character === "]") {
      return index === start ? undefined : source.slice(start, index);
    }
    const escapes =
      character === "\\" && citationLabelEscapable.has(source[index + 1] as string);
    index += escapes ? 2 : 1;
  }
  return undefined;
}

/**
 * Scans one exact visible source range for literal Citation markers the parser
 * left unresolved. Each accepted marker advances the scan past itself, keeping
 * the range linear and bounded.
 */
function citationMarkers(
  position: MarkdownPosition,
  body: string,
): readonly MarkdownPosition[] {
  const source = body.slice(position.start.offset, position.end.offset);
  const markers: MarkdownPosition[] = [];
  const cursor: SourceCursor = {
    column: position.start.column,
    index: 0,
    line: position.start.line,
  };
  while (cursor.index < source.length) {
    const label = citationMarkerLabel(source, cursor.index);
    if (label === undefined) {
      advanceCursor(source, cursor, source[cursor.index] === "\\" ? 2 : 1);
      continue;
    }
    const start = {
      column: cursor.column,
      line: cursor.line,
      offset: (position.start.offset as number) + cursor.index,
    };
    advanceCursor(source, cursor, label.length + 3);
    markers.push({
      end: {
        column: cursor.column,
        line: cursor.line,
        offset: (position.start.offset as number) + cursor.index,
      },
      start,
    });
  }
  return markers;
}

function citationVisiblePart(node: PhrasingContent): CitationVisiblePart | undefined {
  const position = node.position as MarkdownPosition;
  if (node.type === "text") {
    return {
      end: position.end,
      start: position.start,
      textRanges: [
        {
          end: position.end.offset as number,
          start: position.start.offset as number,
        },
      ],
    };
  }
  if (!isCitationFormatting(node)) return undefined;

  const textRanges: CitationSourceRange[] = [];
  const pending: PhrasingContent[] = [node];
  while (pending.length > 0) {
    const current = pending.pop() as PhrasingContent;
    if (current.type === "text") {
      const currentPosition = current.position as MarkdownPosition;
      textRanges.push({
        end: currentPosition.end.offset as number,
        start: currentPosition.start.offset as number,
      });
      continue;
    }
    if (!isCitationFormatting(current)) return undefined;
    for (let index = current.children.length - 1; index >= 0; index -= 1) {
      pending.push(current.children[index] as PhrasingContent);
    }
  }
  return { end: position.end, start: position.start, textRanges };
}

function citationVisibleRuns(container: CitationProse): readonly CitationVisibleRun[] {
  const runs: CitationVisibleRun[] = [];
  let end: MarkdownPosition["end"] | undefined;
  let start: MarkdownPosition["start"] | undefined;
  let textRanges: CitationSourceRange[] = [];

  for (const child of container.children) {
    const part = citationVisiblePart(child);
    if (part === undefined) {
      if (start !== undefined)
        runs.push({ end: end as MarkdownPosition["end"], start, textRanges });
      end = undefined;
      start = undefined;
      textRanges = [];
      continue;
    }
    /* c8 ignore start -- maintained parser siblings are source-contiguous;
       this guard fails closed if a future parser violates that contract. */
    if (
      start !== undefined &&
      (end as MarkdownPosition["end"]).offset !== part.start.offset
    ) {
      runs.push({ end: end as MarkdownPosition["end"], start, textRanges });
      start = undefined;
      textRanges = [];
    }
    /* c8 ignore stop */
    start ??= part.start;
    end = part.end;
    for (const range of part.textRanges) textRanges.push(range);
  }
  if (start !== undefined)
    runs.push({ end: end as MarkdownPosition["end"], start, textRanges });
  return runs;
}

function formattingSplitCitationMarkers(
  container: CitationProse,
  body: string,
): readonly MarkdownPosition[] {
  const split: MarkdownPosition[] = [];
  for (const run of citationVisibleRuns(container)) {
    const markers = citationMarkers({ end: run.end, start: run.start }, body);
    let textIndex = 0;
    for (const marker of markers) {
      const markerStart = marker.start.offset as number;
      const markerEnd = marker.end.offset as number;
      while (
        textIndex < run.textRanges.length &&
        (run.textRanges[textIndex] as CitationSourceRange).end <= markerStart
      ) {
        textIndex += 1;
      }
      let covered = markerStart;
      let rangeIndex = textIndex;
      while (
        rangeIndex < run.textRanges.length &&
        (run.textRanges[rangeIndex] as CitationSourceRange).start <= covered &&
        covered < markerEnd
      ) {
        covered = (run.textRanges[rangeIndex] as CitationSourceRange).end;
        rangeIndex += 1;
      }
      if (covered < markerEnd) split.push(marker);
    }
  }
  return split;
}

function collectCitationNodes(
  tree: Nodes,
  body: string,
): {
  readonly definitions: ReadonlyMap<string, readonly FootnoteDefinition[]>;
  readonly prose: readonly CitationProse[];
  readonly references: readonly FootnoteReference[];
  readonly texts: readonly Text[];
} {
  const definitions = new Map<string, FootnoteDefinition[]>();
  const prose: CitationProse[] = [];
  const references: FootnoteReference[] = [];
  const texts: Text[] = [];
  const pending: Nodes[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop() as Nodes;
    if (node.type === "footnoteReference") references.push(node);
    if (node.type === "footnoteDefinition") {
      const matches = definitions.get(node.identifier);
      if (matches === undefined) definitions.set(node.identifier, [node]);
      else matches.push(node);
    }
    /* Definition labels are owned by the definition node, never by its text
       children, so definition prose is scanned without its `[^label]:` source. */
    if (node.type === "text") texts.push(node);
    if (node.type === "heading" || node.type === "paragraph") prose.push(node);
    if (isAutolink(node, body)) continue;
    if ("children" in node) {
      for (const child of node.children) pending.push(child);
    }
  }
  return { definitions, prose, references, texts };
}

function citationSourceRanges(
  definition: FootnoteDefinition,
  body: string,
): readonly CitationSourceRange[] | undefined {
  const origin = (definition.position as MarkdownPosition).start.offset as number;
  const ranges: CitationSourceRange[] = [];
  const pending: Nodes[] = [];
  for (let index = definition.children.length - 1; index >= 0; index -= 1) {
    pending.push(definition.children[index] as Nodes);
  }
  while (pending.length > 0) {
    const node = pending.pop() as Nodes;
    if (node.type === "definition" || node.type === "footnoteDefinition")
      return undefined;
    if (node.type === "text") {
      const position = node.position as MarkdownPosition;
      ranges.push({
        end: (position.end.offset as number) - origin,
        start: (position.start.offset as number) - origin,
      });
      continue;
    }
    if (isAutolink(node, body)) {
      continue;
    }
    if ("children" in node) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push(node.children[index] as Nodes);
      }
    }
  }
  return ranges;
}

/**
 * Validates every parser-recognized Citation reference against the definition
 * carrying its Lore target. Reference and definition identity is the parser's
 * canonical footnote identifier; source labels and positions stay separate.
 */
function validateCitations(
  file: RealmTextFile,
  parsed: ParsedRealmPage,
  tree: Nodes,
  pagePaths: ReadonlySet<string>,
  findings: Finding[],
): void {
  const { definitions, prose, references, texts } = collectCitationNodes(
    tree,
    parsed.page.body,
  );
  const referenced = new Set(references.map((reference) => reference.identifier));
  for (const identifier of [...referenced].sort(compareCodePoints)) {
    /* A parsed reference exists only where the parser matched a definition. */
    const matches = definitions.get(identifier) as readonly FootnoteDefinition[];
    if (matches.length > 1) {
      for (const definition of matches) {
        findings.push(
          finding(
            "ATLAS_CITATION_DEFINITION_DUPLICATE",
            "Citation reference must resolve to exactly one footnote definition.",
            file.path,
            markdownLocation(parsed, definition.position as MarkdownPosition),
          ),
        );
      }
      continue;
    }

    const definition = matches[0] as FootnoteDefinition;
    const position = definition.position as MarkdownPosition;
    const source = parsed.page.body.slice(position.start.offset, position.end.offset);
    const ranges = citationSourceRanges(definition, parsed.page.body);
    const targets = ranges === undefined ? undefined : citationTargets(source, ranges);
    if (targets === undefined || targets.length !== 1) {
      findings.push(
        finding(
          "ATLAS_CITATION_DEFINITION_MALFORMED",
          "Citation definition must contain exactly one Realm-local Lore target.",
          file.path,
          markdownLocation(parsed, position),
        ),
      );
      continue;
    }

    const target = targets[0] as CitationTarget;
    const resolution = resolveCitationTarget(target.text, pagePaths);
    if (resolution.kind === "valid") continue;
    findings.push(
      finding(
        targetCodes[resolution.kind],
        targetMessages[resolution.kind],
        file.path,
        offsetLocation(parsed, position, target),
      ),
    );
  }

  for (const node of texts) {
    for (const marker of citationMarkers(
      node.position as MarkdownPosition,
      parsed.page.body,
    )) {
      findings.push(
        finding(
          "ATLAS_CITATION_DEFINITION_MISSING",
          "Citation marker must resolve to a Citation definition in the same page.",
          file.path,
          markdownLocation(parsed, marker),
        ),
      );
    }
  }
  for (const container of prose) {
    for (const marker of formattingSplitCitationMarkers(container, parsed.page.body)) {
      findings.push(
        finding(
          "ATLAS_CITATION_DEFINITION_MISSING",
          "Citation marker must resolve to a Citation definition in the same page.",
          file.path,
          markdownLocation(parsed, marker),
        ),
      );
    }
  }
}

function validatePage(
  file: RealmTextFile,
  parsed: ParsedRealmPage,
  tree: Nodes,
  findings: Finding[],
): void {
  const expected = expectedType(file.path);
  if (parsed.page.atlas.type !== expected) {
    findings.push(
      finding(
        "ATLAS_PAGE_TYPE_PATH_MISMATCH",
        "Realm page type does not match its registered path.",
        file.path,
        atlasKeyLocation(file.content, "type"),
      ),
    );
  }

  const custom = customTypeName(file.path);
  if (custom !== undefined && coreTypeNames.has(custom)) {
    findings.push(
      finding(
        "ATLAS_CUSTOM_TYPE_NAME_RESERVED",
        "Realm-owned custom type paths cannot use an Atlas core archetype name.",
        file.path,
      ),
    );
  }

  if (file.path === ".atlas/index.md" && parsed.page.atlas.id !== "bonfire:root") {
    findings.push(
      finding(
        "ATLAS_ROOT_BONFIRE_ID_INVALID",
        "The Root Bonfire must use the stable ID bonfire:root.",
        file.path,
        atlasKeyLocation(file.content, "id"),
      ),
    );
  }

  const heading = markdownHeadingFinding(parsed, file.content, tree);
  if (heading !== undefined) findings.push(heading);

  if (
    Date.parse(parsed.page.atlas["created-at"]) >
    Date.parse(parsed.page.atlas["updated-at"])
  ) {
    findings.push(
      finding(
        "ATLAS_PAGE_UPDATED_BEFORE_CREATED",
        "Realm page updated-at must not precede created-at.",
        file.path,
        atlasKeyLocation(file.content, "updated-at"),
      ),
    );
  }
}

function parseOne(file: RealmTextFile): ParsedRealmPage | Finding {
  try {
    const [parsed] = parseRealmPages([file]);
    return parsed as ParsedRealmPage;
  } catch (error: unknown) {
    if (error instanceof RealmPageParseError) {
      return finding(
        parseCodes[error.code],
        parseMessages[error.code],
        file.path,
        lineLocation(file.content, error.sourceLine),
      );
    }
    /* c8 ignore next 6 -- parser internals may fail without exposing details */
    return finding(
      "ATLAS_PAGE_PARSE_FAILED",
      "Realm page could not be parsed.",
      file.path,
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

function capturePageRecord(input: RealmTextFile): RealmTextFile | Finding | undefined {
  let path = ".atlas/unknown";
  try {
    const candidatePath = (input as { readonly path?: unknown }).path;
    if (typeof candidatePath !== "string") throw new TypeError();
    path = candidatePath;
    if (classifyRealmTextPath(path) !== "page") return undefined;
    const content = (input as { readonly content?: unknown }).content;
    if (typeof content !== "string") throw new TypeError();
    return Object.freeze({ content, path });
  } catch {
    return finding("ATLAS_PAGE_PARSE_FAILED", "Realm page could not be parsed.", path);
  }
}

/**
 * Parses and validates captured Realm text, returning deeply immutable Findings
 * ordered by path, source position, code, then message using Unicode code points.
 * Opaque Framework, Chronicle, and non-page Markdown records produce no Findings.
 */
export function validateRealmStructure(
  files: readonly RealmTextFile[],
): readonly Finding[] {
  const findings: Finding[] = [];
  const pageRecords: RealmTextFile[] = [];
  for (const input of files) {
    const captured = capturePageRecord(input);
    if (captured === undefined) continue;
    if ("code" in captured) findings.push(captured);
    else pageRecords.push(captured);
  }
  pageRecords.sort((left, right) => compareCodePoints(left.path, right.path));

  const pagePaths: ReadonlySet<string> = new Set(pageRecords.map((file) => file.path));
  const parsed: { readonly file: RealmTextFile; readonly page: ParsedRealmPage }[] = [];
  for (const file of pageRecords) {
    const result = parseOne(file);
    if ("code" in result) findings.push(result);
    else {
      const tree = fromMarkdown(result.page.body, markdownOptions);
      parsed.push({ file, page: result });
      validatePage(file, result, tree, findings);
      validateCitations(file, result, tree, pagePaths, findings);
    }
  }

  if (!pageRecords.some((file) => file.path === ".atlas/index.md")) {
    findings.push(
      finding(
        "ATLAS_ROOT_BONFIRE_REQUIRED",
        "Realm must contain the Root Bonfire at .atlas/index.md.",
        ".atlas/index.md",
      ),
    );
  }

  const ids = new Map<string, typeof parsed>();
  for (const entry of parsed) {
    const matches = ids.get(entry.page.page.atlas.id);
    if (matches === undefined) ids.set(entry.page.page.atlas.id, [entry]);
    else matches.push(entry);
  }
  for (const entries of ids.values()) {
    if (entries.length < 2) continue;
    for (const { file } of entries) {
      findings.push(
        finding(
          "ATLAS_PAGE_ID_DUPLICATE",
          "Realm page stable ID must be unique within the Realm.",
          file.path,
          atlasKeyLocation(file.content, "id"),
        ),
      );
    }
  }

  return Object.freeze(findings.toSorted(compareFindings));
}
