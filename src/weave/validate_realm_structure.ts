import { fromMarkdown } from "mdast-util-from-markdown";
import type {
  CompileContext,
  Extension as MdastExtension,
} from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import type { Token } from "micromark-util-types";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { syntax as wikiLinkSyntax } from "micromark-extension-wiki-link";
import { isScalar, parseDocument, type Node, type Pair, type YAMLMap } from "yaml";
import type { Finding } from "../domain/finding.ts";
import type { RealmTextFile } from "../realm/load_realm_text.ts";
import {
  classifyRealmTextPath,
  normalizeRealmRelativePath,
} from "../realm/realm_path.ts";
import {
  parseRealmPages,
  RealmPageParseError,
  type ParsedRealmPage,
} from "../realm/parse_realm_pages.ts";

type FindingLocation = NonNullable<Finding["location"]>;
type MarkdownPosition = {
  readonly end: {
    readonly column: number;
    readonly line: number;
    readonly offset?: number;
  };
  readonly start: {
    readonly column: number;
    readonly line: number;
    readonly offset?: number;
  };
};
type SourceRange = {
  readonly end: number;
  readonly start: number;
};
type MarkdownNode = {
  readonly alt?: string;
  readonly children?: readonly MarkdownNode[];
  readonly identifier?: string;
  readonly position?: MarkdownPosition;
  readonly target?: string;
  readonly type: string;
  readonly value?: string;
  readonly visible?: SourceRange;
};
type MutableWikiLinkNode = {
  target: string;
  type: "wikiLink";
  value: string;
  visible: SourceRange;
};

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

function wikiLinkFromMarkdown(): MdastExtension {
  let current: MutableWikiLinkNode | undefined;
  function rendered(context: CompileContext, token: Token): void {
    const node = current as MutableWikiLinkNode;
    node.value = context.sliceSerialize(token);
    node.visible = { end: token.end.offset, start: token.start.offset };
  }
  return {
    enter: {
      wikiLink(this: CompileContext, token: Token): void {
        current = {
          target: "",
          type: "wikiLink",
          value: "",
          visible: { end: 0, start: 0 },
        };
        this.enter(current as unknown as Nodes, token);
      },
    },
    exit: {
      wikiLink(this: CompileContext, token: Token): void {
        this.exit(token);
        current = undefined;
      },
      wikiLinkAlias(this: CompileContext, token: Token): void {
        rendered(this, token);
      },
      wikiLinkTarget(this: CompileContext, token: Token): void {
        (current as MutableWikiLinkNode).target = this.sliceSerialize(token);
        rendered(this, token);
      },
    },
  };
}

const markdownOptions = {
  extensions: [gfmFootnote(), wikiLinkSyntax({ aliasDivider: "|" })],
  mdastExtensions: [gfmFootnoteFromMarkdown(), wikiLinkFromMarkdown()],
};

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

const lineEndings = /\r\n|[\n\r]/u;

function positionAt(content: string, offset: number): FindingLocation["start"] {
  const before = content.slice(0, offset);
  const lines = before.split(lineEndings);
  return {
    column: (lines.at(-1) as string).length + 1,
    line: lines.length,
  };
}

function rangeAt(content: string, start: number, end: number): FindingLocation {
  return { end: positionAt(content, end), start: positionAt(content, start) };
}

function lineLocation(content: string, line: number): FindingLocation | undefined {
  const lines = content.split(lineEndings);
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

function visibleHeadingText(heading: MarkdownNode): string {
  const parts: string[] = [];
  const pending: MarkdownNode[] = [heading];
  while (pending.length > 0) {
    const node = pending.pop() as MarkdownNode;
    if ("value" in node) {
      parts.push(node.value);
      continue;
    }
    if ("alt" in node && node.alt) {
      parts.push(node.alt);
      continue;
    }
    pushChildren(pending, node);
  }
  return parts.join("");
}

function markdownHeadingFinding(
  parsed: ParsedRealmPage,
  content: string,
): Finding | undefined {
  const tree = fromMarkdown(parsed.page.body, markdownOptions);
  const first = tree.children[0];
  if (first?.type !== "heading" || first.depth !== 1) {
    const position = first?.position;
    const location =
      position === undefined
        ? lineLocation(content, parsed.source.body.startLine)
        : {
            end: {
              column: position.end.column,
              line: parsed.source.body.startLine + position.end.line - 1,
            },
            start: {
              column: position.start.column,
              line: parsed.source.body.startLine + position.start.line - 1,
            },
          };
    return finding(
      "ATLAS_PAGE_TITLE_H1_REQUIRED",
      "The first substantive Markdown block must be an H1 matching the Atlas title.",
      parsed.source.path,
      location,
    );
  }
  if (visibleHeadingText(first as MarkdownNode) === parsed.page.atlas.title) {
    return undefined;
  }
  const position = first.position as NonNullable<typeof first.position>;
  return finding(
    "ATLAS_PAGE_TITLE_H1_MISMATCH",
    "The first Markdown H1 must exactly match the Atlas title.",
    parsed.source.path,
    {
      end: {
        column: position.end.column,
        line: parsed.source.body.startLine + position.end.line - 1,
      },
      start: {
        column: position.start.column,
        line: parsed.source.body.startLine + position.start.line - 1,
      },
    },
  );
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

function visitMarkdown(
  node: MarkdownNode,
  visitor: (node: MarkdownNode) => void,
): void {
  const pending: MarkdownNode[] = [node];
  while (pending.length > 0) {
    const current = pending.pop() as MarkdownNode;
    visitor(current);
    pushChildren(pending, current);
  }
}

type CitationMarker = {
  readonly identifier: string;
  readonly position: MarkdownPosition;
};

type MarkerCell = {
  readonly character: string;
  readonly end: number;
  readonly escapable: boolean;
  readonly escaped: boolean;
  readonly html: boolean;
  readonly start: number;
};

type VisibleMarkers = {
  readonly rawHtml: MarkdownPosition[];
  readonly references: CitationMarker[];
};

const hiddenNodeTypes: ReadonlySet<string> = new Set([
  "code",
  "definition",
  "footnoteDefinition",
  "image",
  "inlineCode",
]);
const labelNodeTypes: ReadonlySet<string> = new Set(["link", "linkReference"]);
const transparentNodeTypes: ReadonlySet<string> = new Set([
  "delete",
  "emphasis",
  "strong",
]);
const breakEntry = "break";
type PendingEntry = MarkdownNode | typeof breakEntry;
const ambiguousCharacter = "\u0000";
const characterReference =
  /&(?:#\d{1,7}|#[Xx][\dA-Fa-f]{1,6}|[A-Za-z][\dA-Za-z]{0,31});/uy;
const markerBoundary = /[\r\n[]/u;

function pushChildren(pending: PendingEntry[], node: MarkdownNode): void {
  const children = node.children ?? [];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    pending.push(children[index] as MarkdownNode);
  }
}

function nodeRange(node: MarkdownNode): SourceRange {
  const position = node.position as MarkdownPosition;
  return {
    end: position.end.offset as number,
    start: position.start.offset as number,
  };
}

/**
 * Appends one rendered-visible source range to a cell stream, keeping absolute
 * source offsets. A character reference renders as a character this validator
 * cannot resolve without an HTML renderer, so it matches every Citation marker
 * character and fails closed.
 */
function appendCells(
  cells: MarkerCell[],
  body: string,
  range: SourceRange,
  escapable: boolean,
  html: boolean,
): void {
  const source = body.slice(range.start, range.end);
  let backslashes = 0;
  let index = 0;
  while (index < source.length) {
    characterReference.lastIndex = index;
    const reference = source[index] === "&" ? characterReference.exec(source) : null;
    const end = reference === null ? index + 1 : index + reference[0].length;
    const character =
      reference === null ? (source[index] as string) : ambiguousCharacter;
    cells.push({
      character,
      end: range.start + end,
      escapable,
      escaped: backslashes % 2 === 1,
      html,
      start: range.start + index,
    });
    backslashes = reference === null && character === "\\" ? backslashes + 1 : 0;
    index = end;
  }
}

function rendersAs(cell: MarkerCell, character: string): boolean {
  return cell.character === character || cell.character === ambiguousCharacter;
}

/**
 * Scans one rendered-visible run for Citation markers. Nearest following close,
 * nearest following boundary, and raw-HTML counts are precomputed once, so
 * repeated candidates stay linear and accepted markers never overlap.
 */
function collectMarkers(
  body: string,
  cells: readonly MarkerCell[],
  found: VisibleMarkers,
): void {
  const nextClose = new Int32Array(cells.length);
  const nextBoundary = new Int32Array(cells.length);
  const htmlBefore = new Int32Array(cells.length + 1);
  let nearestClose = -1;
  let nearestBoundary = -1;
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const cell = cells[index] as MarkerCell;
    if (rendersAs(cell, "]")) nearestClose = index;
    if (markerBoundary.test(cell.character)) nearestBoundary = index;
    nextClose[index] = nearestClose;
    nextBoundary[index] = nearestBoundary;
  }
  for (let index = 0; index < cells.length; index += 1) {
    htmlBefore[index + 1] =
      (htmlBefore[index] as number) + ((cells[index] as MarkerCell).html ? 1 : 0);
  }
  for (let index = 0; index + 3 < cells.length; index += 1) {
    const open = cells[index] as MarkerCell;
    if (!rendersAs(open, "[") || !rendersAs(cells[index + 1] as MarkerCell, "^")) {
      continue;
    }
    if (open.escapable && open.escaped) continue;
    const close = nextClose[index + 2] as number;
    if (close < index + 3) continue;
    const boundary = nextBoundary[index + 2] as number;
    if (boundary >= 0 && boundary < close) continue;
    let identifier = "";
    for (let cursor = index + 2; cursor < close; cursor += 1) {
      const cell = cells[cursor] as MarkerCell;
      identifier += body.slice(cell.start, cell.end);
    }
    const position = rangeAt(body, open.start, (cells[close] as MarkerCell).end);
    if ((htmlBefore[close + 1] as number) > (htmlBefore[index] as number)) {
      found.rawHtml.push(position);
    } else {
      found.references.push({
        identifier: identifier.trim().replace(/\s+/gu, " ").toLowerCase(),
        position,
      });
    }
    index = close;
  }
}

/**
 * Streams the rendered-visible text of adjacent inline nodes into one cell run,
 * so a marker split across formatting or a wiki-link alias cannot bypass
 * detection. Hidden content, link destinations, autolinks, block boundaries,
 * and gaps holding a line ending flush the run instead of bridging it.
 */
function visibleCitationMarkers(tree: MarkdownNode, body: string): VisibleMarkers {
  const found: VisibleMarkers = { rawHtml: [], references: [] };
  const pending: PendingEntry[] = [tree];
  let cells: MarkerCell[] = [];
  let previousEnd = -1;
  function flush(): void {
    if (cells.length > 0) {
      collectMarkers(body, cells, found);
      cells = [];
    }
    previousEnd = -1;
  }
  function emit(range: SourceRange, escapable: boolean, html: boolean): void {
    if (previousEnd >= 0 && lineEndings.test(body.slice(previousEnd, range.start))) {
      flush();
    }
    appendCells(cells, body, range, escapable, html);
    previousEnd = range.end;
  }
  while (pending.length > 0) {
    const entry = pending.pop() as PendingEntry;
    if (entry === breakEntry) {
      flush();
      continue;
    }
    if (entry.type === "text") {
      emit(nodeRange(entry), true, false);
      continue;
    }
    if (entry.type === "html") {
      emit(nodeRange(entry), false, true);
      continue;
    }
    if (entry.type === "wikiLink") {
      emit(entry.visible as SourceRange, false, false);
      continue;
    }
    if (transparentNodeTypes.has(entry.type)) {
      pushChildren(pending, entry);
      continue;
    }
    flush();
    if (hiddenNodeTypes.has(entry.type)) continue;
    if (labelNodeTypes.has(entry.type)) {
      if (body[nodeRange(entry).start] !== "[") continue;
      pending.push(breakEntry);
    }
    pushChildren(pending, entry);
  }
  flush();
  return found;
}

function citationTargetPath(target: string):
  | { readonly kind: "candidate"; readonly path: string }
  | { readonly kind: "invalid" }
  | {
      readonly kind: "not-lore";
    } {
  const path = target.split("#", 1)[0] as string;
  if (path.endsWith(".md")) {
    return { kind: "invalid" };
  }
  const normalized = normalizeRealmRelativePath(path);
  if (normalized === undefined || normalized !== path) {
    return { kind: "invalid" };
  }
  if (normalized.slice(normalized.lastIndexOf("/") + 1).includes(".")) {
    return { kind: "not-lore" };
  }
  if (!normalized.startsWith(".atlas/lore/")) {
    return { kind: "not-lore" };
  }
  return { kind: "candidate", path: `${normalized}.md` };
}

function definitionWikilinks(definition: MarkdownNode): readonly MarkdownNode[] {
  const targets: MarkdownNode[] = [];
  const pending: MarkdownNode[] = [definition];
  while (pending.length > 0) {
    const node = pending.pop() as MarkdownNode;
    if (node !== definition && node.type === "footnoteDefinition") continue;
    if (node.type === "wikiLink") targets.push(node);
    pushChildren(pending, node);
  }
  return targets;
}

function validateCitations(
  parsedPages: readonly {
    readonly file: RealmTextFile;
    readonly page: ParsedRealmPage;
  }[],
  pagePaths: ReadonlySet<string>,
  findings: Finding[],
): void {
  for (const { file, page } of parsedPages) {
    const tree = fromMarkdown(page.page.body, markdownOptions) as MarkdownNode;
    const references: MarkdownNode[] = [];
    const { rawHtml, references: unresolved } = visibleCitationMarkers(
      tree,
      page.page.body,
    );
    const definitions = new Map<string, MarkdownNode[]>();
    visitMarkdown(tree, (node) => {
      if (node.type === "footnoteReference" && node.identifier !== undefined) {
        references.push(node);
      }
      if (node.type === "footnoteDefinition" && node.identifier !== undefined) {
        const existing = definitions.get(node.identifier);
        if (existing === undefined) definitions.set(node.identifier, [node]);
        else existing.push(node);
      }
    });

    for (const position of rawHtml) {
      findings.push(
        finding(
          "ATLAS_CITATION_MARKER_IN_RAW_HTML",
          "Citation markers must not appear in raw HTML.",
          file.path,
          markdownLocation(page, position),
        ),
      );
    }

    for (const reference of unresolved) {
      findings.push(
        finding(
          "ATLAS_CITATION_DEFINITION_MISSING",
          "Citation reference must have a matching footnote definition.",
          file.path,
          markdownLocation(page, reference.position),
        ),
      );
    }

    const referenced = new Set(
      references.map(({ identifier }) => identifier as string),
    );
    for (const { identifier } of unresolved) {
      referenced.add(identifier);
    }
    for (const identifier of referenced) {
      const matches = definitions.get(identifier) ?? [];
      if (matches.length > 1) {
        for (const definition of matches) {
          findings.push(
            finding(
              "ATLAS_CITATION_DEFINITION_DUPLICATE",
              "Citation reference must resolve to exactly one footnote definition.",
              file.path,
              markdownLocation(page, definition.position as MarkdownPosition),
            ),
          );
        }
        continue;
      }
      const definition = matches[0];
      if (definition === undefined) continue;
      const targets = definitionWikilinks(definition);
      if (targets.length !== 1) {
        findings.push(
          finding(
            "ATLAS_CITATION_DEFINITION_MALFORMED",
            "Citation definition must contain exactly one Realm-local Lore wikilink.",
            file.path,
            markdownLocation(page, definition.position as MarkdownPosition),
          ),
        );
        continue;
      }

      const target = targets[0] as MarkdownNode;
      const targetValue = target.target as string;
      const resolution = citationTargetPath(targetValue);
      if (resolution.kind === "invalid") {
        findings.push(
          finding(
            "ATLAS_CITATION_TARGET_INVALID",
            "Citation target must be a Realm-local root-relative forward-slash path.",
            file.path,
            markdownLocation(page, target.position as MarkdownPosition),
          ),
        );
      } else if (resolution.kind === "not-lore") {
        findings.push(
          finding(
            "ATLAS_CITATION_TARGET_NOT_LORE",
            "Citation target must classify as a Realm Lore Markdown page.",
            file.path,
            markdownLocation(page, target.position as MarkdownPosition),
          ),
        );
      } else if (!pagePaths.has(resolution.path)) {
        findings.push(
          finding(
            "ATLAS_CITATION_TARGET_MISSING",
            "Citation target must resolve to an existing local Lore page.",
            file.path,
            markdownLocation(page, target.position as MarkdownPosition),
          ),
        );
      }
    }
  }
}

function validatePage(
  file: RealmTextFile,
  parsed: ParsedRealmPage,
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

  const heading = markdownHeadingFinding(parsed, file.content);
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

  const parsed: { readonly file: RealmTextFile; readonly page: ParsedRealmPage }[] = [];
  for (const file of pageRecords) {
    const result = parseOne(file);
    if ("code" in result) findings.push(result);
    else {
      parsed.push({ file, page: result });
      validatePage(file, result, findings);
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

  validateCitations(parsed, new Set(pageRecords.map(({ path }) => path)), findings);

  return Object.freeze(findings.toSorted(compareFindings));
}
