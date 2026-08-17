import { fromMarkdown } from "mdast-util-from-markdown";
import type {
  CompileContext,
  Extension as MdastExtension,
} from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { toString } from "mdast-util-to-string";
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
  if (toString(first) === parsed.page.atlas.title) return undefined;
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
  readonly start: number;
};

const hiddenNodeTypes: ReadonlySet<string> = new Set([
  "code",
  "definition",
  "footnoteDefinition",
  "image",
  "inlineCode",
]);
const labelNodeTypes: ReadonlySet<string> = new Set(["link", "linkReference"]);
const ambiguousCharacter = "\u0000";
const characterReference =
  /&(?:#\d{1,7}|#[Xx][\dA-Fa-f]{1,6}|[A-Za-z][\dA-Za-z]{0,31});/uy;

function pushChildren(pending: MarkdownNode[], node: MarkdownNode): void {
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
 * Splits source into rendered cells. A character reference renders as a
 * character this validator cannot resolve without an HTML renderer, so it
 * matches every Citation marker character and fails closed.
 */
function markerCells(source: string): readonly MarkerCell[] {
  const cells: MarkerCell[] = [];
  let index = 0;
  while (index < source.length) {
    characterReference.lastIndex = index;
    const reference = source[index] === "&" ? characterReference.exec(source) : null;
    const end = reference === null ? index + 1 : index + reference[0].length;
    cells.push({
      character: reference === null ? (source[index] as string) : ambiguousCharacter,
      end,
      start: index,
    });
    index = end;
  }
  return cells;
}

function rendersAs(cell: MarkerCell, character: string): boolean {
  return cell.character === character || cell.character === ambiguousCharacter;
}

function isEscaped(source: string, offset: number): boolean {
  let escapes = 0;
  for (let before = offset - 1; before >= 0 && source[before] === "\\"; before -= 1) {
    escapes += 1;
  }
  return escapes % 2 === 1;
}

function citationMarkers(
  body: string,
  range: SourceRange,
  escapable: boolean,
): readonly CitationMarker[] {
  const markers: CitationMarker[] = [];
  const source = body.slice(range.start, range.end);
  const cells = markerCells(source);
  for (let index = 0; index + 3 < cells.length; index += 1) {
    const open = cells[index] as MarkerCell;
    if (!rendersAs(open, "[") || !rendersAs(cells[index + 1] as MarkerCell, "^")) {
      continue;
    }
    if (escapable && isEscaped(source, open.start)) continue;
    let close = -1;
    for (let scan = index + 2; scan < cells.length; scan += 1) {
      if (rendersAs(cells[scan] as MarkerCell, "]")) {
        close = scan;
        break;
      }
    }
    if (close < index + 3) continue;
    const identifier = source.slice(
      (cells[index + 2] as MarkerCell).start,
      (cells[close] as MarkerCell).start,
    );
    if (/[\r\n[\]]/u.test(identifier)) continue;
    markers.push({
      identifier: identifier.trim().replace(/\s+/gu, " ").toLowerCase(),
      position: rangeAt(
        body,
        range.start + open.start,
        range.start + (cells[close] as MarkerCell).end,
      ),
    });
    index = close;
  }
  return markers;
}

function visibleCitationMarkers(
  tree: MarkdownNode,
  body: string,
): {
  readonly rawHtml: readonly MarkdownPosition[];
  readonly references: readonly CitationMarker[];
} {
  const rawHtml: MarkdownPosition[] = [];
  const references: CitationMarker[] = [];
  const pending: MarkdownNode[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop() as MarkdownNode;
    if (hiddenNodeTypes.has(node.type)) continue;
    if (node.type === "html") {
      for (const marker of citationMarkers(body, nodeRange(node), false)) {
        rawHtml.push(marker.position);
      }
      continue;
    }
    if (node.type === "wikiLink") {
      references.push(...citationMarkers(body, node.visible as SourceRange, false));
      continue;
    }
    if (labelNodeTypes.has(node.type) && body[nodeRange(node).start] !== "[") {
      continue;
    }
    if (node.type === "text") {
      references.push(...citationMarkers(body, nodeRange(node), true));
      continue;
    }
    pushChildren(pending, node);
  }
  return { rawHtml, references };
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
