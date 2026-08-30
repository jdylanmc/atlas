import type {
  FootnoteDefinition,
  FootnoteReference,
  Heading,
  Link,
  LinkReference,
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
import {
  coreArchetypes,
  corePageTypes,
  corePageTypesByDirectory,
  rootAnchorPageId,
} from "../domain/core_archetype.ts";
import { malformedAtlasPrincipleTruthLines } from "../domain/atlas_principle.ts";
import { checkAtlasSchemaVersion } from "../domain/atlas_schema_version.ts";
import type { Finding, FindingLocation } from "../domain/finding.ts";
import { compareCodePoints } from "../atlas/compare_code_points.ts";
import type { AtlasTextFile } from "../atlas/load_atlas_text.ts";
import { rethrowProcessLimit } from "../atlas/process_limit.ts";
import { positionIndex } from "./source_position.ts";
import { sdkFindings } from "./sdk_finding.ts";
import {
  atlasFrontmatterSpan,
  classifyAtlasTextPath,
  parseAtlasPage,
  AtlasPageParseError,
  type AtlasFrontmatterSpan,
  type ParsedAtlasPage,
} from "../atlas/parse_atlas_pages.ts";

export interface AtlasStructureValidation {
  /**
   * Every page whose Atlas page envelope parsed from the validated text. Pages
   * that later structural checks reject are still carried so downstream
   * read-only operations consume the same parse Lint examined instead of
   * reparsing the snapshot.
   */
  readonly pages: readonly ParsedAtlasPage[];
  readonly findings: readonly Finding[];
}

type MarkdownPosition = NonNullable<Nodes["position"]>;

const finding = sdkFindings("sdk-core.structural-validation");

const parseCodes = Object.freeze({
  FRONTMATTER_TOO_DEEP: "ATLAS_PAGE_FRONTMATTER_TOO_DEEP",
  FRONTMATTER_TOO_LARGE: "ATLAS_PAGE_FRONTMATTER_TOO_LARGE",
  INVALID_PAGE_ENVELOPE: "ATLAS_PAGE_INVALID_ENVELOPE",
  MALFORMED_FRONTMATTER: "ATLAS_PAGE_MALFORMED_FRONTMATTER",
  MISSING_FRONTMATTER: "ATLAS_PAGE_MISSING_FRONTMATTER",
  NON_CANONICAL_LINE_TERMINATOR: "ATLAS_PAGE_NON_CANONICAL_LINE_TERMINATOR",
});

const parseMessages = Object.freeze({
  FRONTMATTER_TOO_DEEP: "Atlas page frontmatter nests deeper than Atlas SDK reads.",
  FRONTMATTER_TOO_LARGE: "Atlas page frontmatter is larger than Atlas SDK reads.",
  INVALID_PAGE_ENVELOPE: "Atlas page frontmatter does not satisfy the page envelope.",
  MALFORMED_FRONTMATTER: "Atlas page frontmatter is malformed.",
  MISSING_FRONTMATTER: "Atlas page frontmatter is missing.",
  NON_CANONICAL_LINE_TERMINATOR: "Atlas page contains a non-canonical line terminator.",
});

const sourcePrefix = `.atlas/${coreArchetypes.Source.directory}/`;

const rootAnchorDiagnostic = `ATLAS_ROOT_${coreArchetypes.Anchor.diagnosticStem}`;

const citationLabelBreak = /[\t\n\r ]/u;
const citationLabelEscapable: ReadonlySet<string> = new Set(["[", "\\", "]"]);
const citationLabelLimit = 999;

const markdownOptions = Object.freeze({
  extensions: [gfmFootnote()],
  mdastExtensions: [gfmFootnoteFromMarkdown()],
});

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

function sdkKeyLocation(
  content: string,
  key: "atlas-sdk-schema" | "created-at" | "id" | "type" | "updated-at",
): FindingLocation {
  // Only a page the parse already read reaches here, so the span is answered.
  // Asking the parse where its frontmatter was keeps one rule for the closing
  // delimiter instead of a second description that can disagree with it.
  const span = atlasFrontmatterSpan(content) as AtlasFrontmatterSpan;

  const document = parseDocument(content.slice(span.start, span.end), {
    strict: true,
    uniqueKeys: true,
  });
  const sdk = pairFor(document.contents, "sdk");
  const target = pairFor(sdk.value, key);
  const range = target.key.range as [number, number, number];
  return positionIndex(content).rangeAt(span.start + range[0], span.start + range[1]);
}

function expectedType(path: string): string | undefined {
  if (path === ".atlas/index.md") return coreArchetypes.Anchor.pageType;
  const custom = /^\.atlas\/types\/([^/]+)\/.+\.md$/u.exec(path);
  if (custom !== null) return custom[1];
  const start = ".atlas/".length;
  const directory = path.slice(start, path.indexOf("/", start));
  return corePageTypesByDirectory.get(directory);
}

function customTypeName(path: string): string | undefined {
  return /^\.atlas\/types\/([^/]+)\/.+\.md$/u.exec(path)?.[1];
}

function markdownLocation(
  parsed: ParsedAtlasPage,
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
  parsed: ParsedAtlasPage,
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
      "The first substantive Markdown block must be an H1 matching the page title.",
      parsed.source.path,
      location,
    );
  }
  if (toString(first) === parsed.page.sdk.title) return undefined;
  return finding(
    "ATLAS_PAGE_TITLE_H1_MISMATCH",
    "The first Markdown H1 must exactly match the page title.",
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
  | { readonly kind: "not-source" }
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
 * Normalizes one Citation target to its canonical Atlas-relative Source page path.
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
  if (!path.startsWith(sourcePrefix)) return { kind: "not-source" };
  if (!pagePaths.has(path)) return { kind: "missing" };
  return { kind: "valid" };
}

const targetCodes = Object.freeze({
  invalid: "ATLAS_CITATION_TARGET_INVALID",
  missing: "ATLAS_CITATION_TARGET_MISSING",
  "not-source": "ATLAS_CITATION_TARGET_NOT_SOURCE",
});

const targetMessages = Object.freeze({
  invalid:
    "Citation target must be a canonical Atlas-relative path without fragment, alias, extension, or traversal.",
  missing: "Citation target must resolve to an existing local Source page.",
  "not-source": "Citation target must address an Atlas Source page.",
});

function offsetLocation(
  parsed: ParsedAtlasPage,
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

type CitationVisibleContainer = Heading | Link | LinkReference | Paragraph;

function isAutolink(node: Nodes, body: string): boolean {
  return (
    node.type === "link" &&
    body[(node.position as MarkdownPosition).start.offset as number] === "<"
  );
}

function isCitationFormatting(
  node: PhrasingContent,
): node is Extract<PhrasingContent, { readonly type: "emphasis" | "strong" }> {
  return node.type === "emphasis" || node.type === "strong";
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
 * unescaped bracket, then `]`. Shapes the parser does not resolve to a
 * Citation reference are not markers and are not reported: a label carrying
 * whitespace is ordinary bracketed Markdown, not a footnote Citation.
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

/**
 * Keeps visible source around excluded descendants as separate ordered parts.
 * Formatting delimiters remain in those exact source slices, while each
 * excluded node becomes a boundary that the caller does not bridge.
 */
function citationVisibleParts(
  node: PhrasingContent,
): readonly (CitationVisiblePart | undefined)[] {
  const position = node.position as MarkdownPosition;
  if (node.type === "text") {
    return [
      {
        end: position.end,
        start: position.start,
        textRanges: [
          {
            end: position.end.offset as number,
            start: position.start.offset as number,
          },
        ],
      },
    ];
  }
  if (!isCitationFormatting(node)) return [undefined];

  const excluded: MarkdownPosition[] = [];
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
    if (isCitationFormatting(current)) {
      for (let index = current.children.length - 1; index >= 0; index -= 1) {
        pending.push(current.children[index] as PhrasingContent);
      }
    } else {
      excluded.push(current.position as MarkdownPosition);
    }
  }
  if (excluded.length === 0) {
    return [{ end: position.end, start: position.start, textRanges }];
  }

  const parts: (CitationVisiblePart | undefined)[] = [];
  let start = position.start;
  let textIndex = 0;
  for (const boundary of excluded) {
    const segmentTextRanges: CitationSourceRange[] = [];
    while (
      textIndex < textRanges.length &&
      (textRanges[textIndex] as CitationSourceRange).start <
        (boundary.start.offset as number)
    ) {
      segmentTextRanges.push(textRanges[textIndex] as CitationSourceRange);
      textIndex += 1;
    }
    parts.push({ end: boundary.start, start, textRanges: segmentTextRanges });
    parts.push(undefined);
    start = boundary.end;
  }
  const segmentTextRanges: CitationSourceRange[] = [];
  while (textIndex < textRanges.length) {
    segmentTextRanges.push(textRanges[textIndex] as CitationSourceRange);
    textIndex += 1;
  }
  parts.push({ end: position.end, start, textRanges: segmentTextRanges });
  return parts;
}

function citationVisibleRuns(
  container: CitationVisibleContainer,
): readonly CitationVisibleRun[] {
  const runs: CitationVisibleRun[] = [];
  let end: MarkdownPosition["end"] | undefined;
  let start: MarkdownPosition["start"] | undefined;
  let textRanges: CitationSourceRange[] = [];

  for (const child of container.children) {
    for (const part of citationVisibleParts(child)) {
      if (part === undefined) {
        if (start !== undefined)
          runs.push({ end: end as MarkdownPosition["end"], start, textRanges });
        end = undefined;
        start = undefined;
        textRanges = [];
        continue;
      }
      start ??= part.start;
      end = part.end;
      for (const range of part.textRanges) textRanges.push(range);
    }
  }
  if (start !== undefined)
    runs.push({ end: end as MarkdownPosition["end"], start, textRanges });
  return runs;
}

function formattingSplitCitationMarkers(
  container: CitationVisibleContainer,
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
  readonly containers: readonly CitationVisibleContainer[];
  readonly definitions: ReadonlyMap<string, readonly FootnoteDefinition[]>;
  readonly references: readonly FootnoteReference[];
  readonly texts: readonly Text[];
} {
  const containers: CitationVisibleContainer[] = [];
  const definitions = new Map<string, FootnoteDefinition[]>();
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
    if (node.type === "heading" || node.type === "paragraph") containers.push(node);
    if (isAutolink(node, body)) continue;
    if (node.type === "link" || node.type === "linkReference") containers.push(node);
    if ("children" in node) {
      for (const child of node.children) pending.push(child);
    }
  }
  return { containers, definitions, references, texts };
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
 * carrying its Source target. Reference and definition identity is the parser's
 * canonical footnote identifier; source labels and positions stay separate.
 */
function validateCitations(
  file: AtlasTextFile,
  parsed: ParsedAtlasPage,
  tree: Nodes,
  pagePaths: ReadonlySet<string>,
  findings: Finding[],
): void {
  const { containers, definitions, references, texts } = collectCitationNodes(
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
          "Citation definition must contain exactly one Atlas-local Source target.",
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
  for (const container of containers) {
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
  file: AtlasTextFile,
  parsed: ParsedAtlasPage,
  tree: Nodes,
  findings: Finding[],
): void {
  if (!checkAtlasSchemaVersion(parsed.page.sdk["atlas-sdk-schema"])) {
    findings.push(
      finding(
        "ATLAS_SCHEMA_VERSION_MALFORMED",
        "Atlas page atlas-sdk-schema must be a well-formed MAJOR.MINOR.PATCH version.",
        file.path,
        sdkKeyLocation(file.content, "atlas-sdk-schema"),
      ),
    );
  }

  const expected = expectedType(file.path);
  if (parsed.page.sdk.type !== expected) {
    findings.push(
      finding(
        "ATLAS_PAGE_TYPE_PATH_MISMATCH",
        "Atlas page type does not match its registered path.",
        file.path,
        sdkKeyLocation(file.content, "type"),
      ),
    );
  }

  const custom = customTypeName(file.path);
  if (custom !== undefined && corePageTypes.has(custom)) {
    findings.push(
      finding(
        "ATLAS_CUSTOM_TYPE_NAME_RESERVED",
        "Atlas-owned custom type paths cannot use an Atlas SDK core archetype name.",
        file.path,
      ),
    );
  }

  if (file.path === ".atlas/index.md" && parsed.page.sdk.id !== rootAnchorPageId) {
    findings.push(
      finding(
        `${rootAnchorDiagnostic}_ID_INVALID`,
        `The Root Anchor must use the stable ID ${rootAnchorPageId}.`,
        file.path,
        sdkKeyLocation(file.content, "id"),
      ),
    );
  }

  const heading = markdownHeadingFinding(parsed, file.content, tree);
  if (heading !== undefined) findings.push(heading);

  if (parsed.page.sdk.type === coreArchetypes.Principle.pageType) {
    for (const malformed of malformedAtlasPrincipleTruthLines(parsed.page.body)) {
      findings.push(
        finding(
          "ATLAS_PRINCIPLE_TRUTH_MALFORMED",
          "A Principle truth-shaped bullet must be inside the canonical Active truths block and carry a stable truth identity with same-line text.",
          file.path,
          lineLocation(file.content, parsed.source.body.startLine + malformed.line - 1),
        ),
      );
    }
  }

  if (
    Date.parse(parsed.page.sdk["created-at"]) >
    Date.parse(parsed.page.sdk["updated-at"])
  ) {
    findings.push(
      finding(
        "ATLAS_PAGE_UPDATED_BEFORE_CREATED",
        "Atlas page updated-at must not precede created-at.",
        file.path,
        sdkKeyLocation(file.content, "updated-at"),
      ),
    );
  }
}

function parseOne(file: AtlasTextFile): ParsedAtlasPage | Finding {
  const parsed = parseAtlasPage(file);
  if (!(parsed instanceof AtlasPageParseError)) return parsed;
  return finding(
    parseCodes[parsed.code],
    parseMessages[parsed.code],
    file.path,
    lineLocation(file.content, parsed.sourceLine),
  );
}

// Reading Markdown costs more than the bytes it holds. Nesting multiplies the
// work each block costs, and blocks and emphasis marks each cost more the more
// of them a body carries, so how deeply and how much markup Atlas SDK reads are
// both declared, and both are measured from the text before any reader runs
// over it. Every nested block costs at least one quote marker, one list marker,
// or two columns of indentation, and every nested inline span costs one
// bracket, so the scan can only overstate the nesting it measures. Every line
// is one more place a block can begin, and reading each costs more the more
// lines stand beside it, so how many lines a body holds is declared too. Prose
// costs only what its bytes cost, so a page of it is read whole.
// Markdown begins a line after a line feed, a carriage return, or both, so the
// scan reads the same lines the reader will.
const markdownLineBreak = /\r\n|[\n\r]/u;
const maxBodyNestingDepth = 64;
const maxBodyMarkupMarks = 8192;
const maxBodyLines = 16 * 1024;

const listMarkerAt = /(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/uy;
const markupMarks: ReadonlySet<string> = new Set([
  "*",
  "_",
  "~",
  "`",
  "[",
  "]",
  "&",
  "<",
  ">",
]);

interface BodyMarkdownBound {
  readonly lines: number;
  readonly marks: number;
  readonly nesting: number;
}

function bodyMarkdownBound(body: string): BodyMarkdownBound {
  let lines = 0;
  let marks = 0;
  let nesting = 0;
  for (const line of body.split(markdownLineBreak)) {
    lines += 1;
    let blocks = 1;
    let columns = 0;
    let index = 0;
    for (; index < line.length;) {
      const character = line[index];
      if (character === " " || character === "\t") {
        columns += 1;
        index += 1;
        continue;
      }
      if (character === ">") {
        blocks += 1;
        index += 1;
        continue;
      }
      listMarkerAt.lastIndex = index;
      const marker = listMarkerAt.exec(line);
      if (marker === null) break;
      blocks += 2;
      index += marker[0].length;
    }
    blocks += Math.floor(columns / 2);
    nesting = Math.max(nesting, blocks);
    marks += blocks - 1;

    let spans = 0;
    for (const character of line.slice(index)) {
      if (markupMarks.has(character)) marks += 1;
      if (character === "[") {
        spans += 1;
        nesting = Math.max(nesting, blocks + spans);
      } else if (character === "]") {
        spans = Math.max(0, spans - 1);
      }
    }
  }
  return { lines, marks, nesting };
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

function capturePageRecord(input: AtlasTextFile): AtlasTextFile | Finding | undefined {
  let path = ".atlas/unknown";
  try {
    const candidatePath = (input as { readonly path?: unknown }).path;
    if (typeof candidatePath !== "string") throw new TypeError();
    path = candidatePath;
    if (classifyAtlasTextPath(path) !== "page") return undefined;
    const content = (input as { readonly content?: unknown }).content;
    if (typeof content !== "string") throw new TypeError();
    return Object.freeze({ content, path });
  } catch (error: unknown) {
    rethrowProcessLimit(error);
    return finding("ATLAS_PAGE_PARSE_FAILED", "Atlas page could not be parsed.", path);
  }
}

function validateAtlasStructureWithPages(
  files: readonly AtlasTextFile[],
): AtlasStructureValidation {
  const findings: Finding[] = [];
  const pageRecords: AtlasTextFile[] = [];
  for (const input of files) {
    const captured = capturePageRecord(input);
    if (captured === undefined) continue;
    if ("code" in captured) findings.push(captured);
    else pageRecords.push(captured);
  }
  pageRecords.sort((left, right) => compareCodePoints(left.path, right.path));

  const pagePaths: ReadonlySet<string> = new Set(pageRecords.map((file) => file.path));
  const pages: ParsedAtlasPage[] = [];
  const parsed: { readonly file: AtlasTextFile; readonly page: ParsedAtlasPage }[] = [];
  for (const file of pageRecords) {
    const result = parseOne(file);
    if ("code" in result) findings.push(result);
    else {
      pages.push(result);
      // A body carrying more Markdown than Atlas SDK reads is reported from the
      // scan of its text rather than read.
      const bound = bodyMarkdownBound(result.page.body);
      if (bound.nesting > maxBodyNestingDepth) {
        findings.push(
          finding(
            "ATLAS_PAGE_BODY_TOO_DEEP",
            "Atlas page body nests deeper than Atlas SDK reads.",
            file.path,
          ),
        );
        continue;
      }
      if (bound.marks > maxBodyMarkupMarks) {
        findings.push(
          finding(
            "ATLAS_PAGE_BODY_TOO_MARKED",
            "Atlas page body carries more Markdown markup than Atlas SDK reads.",
            file.path,
          ),
        );
        continue;
      }
      if (bound.lines > maxBodyLines) {
        findings.push(
          finding(
            "ATLAS_PAGE_BODY_TOO_LONG",
            "Atlas page body holds more lines than Atlas SDK reads.",
            file.path,
          ),
        );
        continue;
      }
      const tree = fromMarkdown(result.page.body, markdownOptions);
      parsed.push({ file, page: result });
      validatePage(file, result, tree, findings);
      validateCitations(file, result, tree, pagePaths, findings);
    }
  }

  if (!pageRecords.some((file) => file.path === ".atlas/index.md")) {
    findings.push(
      finding(
        `${rootAnchorDiagnostic}_REQUIRED`,
        "Atlas must contain the Root Anchor at .atlas/index.md.",
        ".atlas/index.md",
      ),
    );
  }

  const ids = new Map<string, typeof parsed>();
  for (const entry of parsed) {
    const matches = ids.get(entry.page.page.sdk.id);
    if (matches === undefined) ids.set(entry.page.page.sdk.id, [entry]);
    else matches.push(entry);
  }
  for (const entries of ids.values()) {
    if (entries.length < 2) continue;
    for (const { file } of entries) {
      findings.push(
        finding(
          "ATLAS_PAGE_ID_DUPLICATE",
          "Atlas page stable ID must be unique within the Atlas.",
          file.path,
          sdkKeyLocation(file.content, "id"),
        ),
      );
    }
  }

  return Object.freeze({
    findings: Object.freeze(findings.toSorted(compareFindings)),
    pages: Object.freeze(pages),
  });
}

/**
 * Parses and validates captured Atlas text, returning deeply immutable Findings
 * ordered by path, source position, code, then message using Unicode code points.
 * Opaque framework-directory, Changelog, and non-page Markdown records produce
 * no Findings.
 */
export function validateAtlasStructure(
  files: readonly AtlasTextFile[],
): readonly Finding[] {
  return validateAtlasStructureWithPages(files).findings;
}

export { validateAtlasStructureWithPages };
