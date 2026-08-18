import { fromMarkdown } from "mdast-util-from-markdown";
import type {
  CompileContext,
  Extension as MdastExtension,
} from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import type { Token } from "micromark-util-types";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { normalizeIdentifier } from "micromark-util-normalize-identifier";
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
type SourcePositionIndex = {
  readonly content: string;
  readonly lineEnds: readonly number[];
  readonly lineStarts: readonly number[];
};
type MarkdownNode = {
  readonly alt?: string;
  readonly children?: readonly MarkdownNode[];
  readonly depth?: number;
  readonly identifier?: string;
  readonly label?: string;
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

export const MARKDOWN_PARSE_WORK_PER_CODE_UNIT = 64;

function wikiLinkFromMarkdown(): MdastExtension {
  let current: MutableWikiLinkNode | undefined;
  function rendered(context: CompileContext, token: Token): void {
    const node = current as MutableWikiLinkNode;
    node.value = decodeRenderedText(context.sliceSerialize(token));
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

function sourcePositionIndex(content: string): SourcePositionIndex {
  const lineEnds: number[] = [];
  const lineStarts = [0];
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character !== "\n" && character !== "\r") continue;
    lineEnds.push(index);
    if (character === "\r" && content[index + 1] === "\n") index += 1;
    lineStarts.push(index + 1);
  }
  lineEnds.push(content.length);
  return { content, lineEnds, lineStarts };
}

function lineIndexAt(index: SourcePositionIndex, offset: number): number {
  let low = 0;
  let high = index.lineStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((index.lineStarts[middle] as number) <= offset) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function positionAt(
  index: SourcePositionIndex,
  offset: number,
): FindingLocation["start"] {
  /* c8 ignore start -- source ranges never stop inside a CRLF pair */
  if (
    offset > 0 &&
    index.content[offset] === "\n" &&
    index.content[offset - 1] === "\r"
  ) {
    return {
      column: 1,
      line: lineIndexAt(index, offset + 1) + 1,
    };
  }
  /* c8 ignore stop */
  const lineIndex = lineIndexAt(index, offset);
  return {
    column: offset - (index.lineStarts[lineIndex] as number) + 1,
    line: lineIndex + 1,
  };
}

function rangeAt(
  index: SourcePositionIndex,
  start: number,
  end: number,
): FindingLocation {
  return { end: positionAt(index, end), start: positionAt(index, start) };
}

function lineLocation(
  index: SourcePositionIndex,
  line: number,
): FindingLocation | undefined {
  const start = index.lineStarts[line - 1];
  const end = index.lineEnds[line - 1];
  if (start === undefined || end === undefined) return undefined;
  return {
    end: { column: end - start + 1, line },
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
  positions: SourcePositionIndex,
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
  return rangeAt(positions, openingLength + range[0], openingLength + range[1]);
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

const markdownPunctuationOrSymbol = /[\p{P}\p{S}]/u;
const markdownWhitespace = /\s/u;

function isMarkdownWhitespace(character: string | undefined): boolean {
  return character === undefined || markdownWhitespace.test(character);
}

function isMarkdownPunctuationOrSymbol(character: string | undefined): boolean {
  return character !== undefined && markdownPunctuationOrSymbol.test(character);
}

function delimiterCapabilities(
  marker: "*" | "_",
  before: string | undefined,
  after: string | undefined,
): { readonly canClose: boolean; readonly canOpen: boolean } {
  const beforeWhitespace = isMarkdownWhitespace(before);
  const afterWhitespace = isMarkdownWhitespace(after);
  const beforePunctuation = isMarkdownPunctuationOrSymbol(before);
  const afterPunctuation = isMarkdownPunctuationOrSymbol(after);
  const leftFlanking =
    !afterWhitespace && (!afterPunctuation || beforeWhitespace || beforePunctuation);
  const rightFlanking =
    !beforeWhitespace && (!beforePunctuation || afterWhitespace || afterPunctuation);
  if (marker === "*") {
    return { canClose: rightFlanking, canOpen: leftFlanking };
  }
  return {
    canClose: rightFlanking && (!leftFlanking || afterPunctuation),
    canOpen: leftFlanking && (!rightFlanking || beforePunctuation),
  };
}

function isBlankMarkdownLine(body: string, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (body[index] !== " " && body[index] !== "\t") return false;
  }
  return true;
}

/**
 * Realm byte budgets already bound linear parsing work, and a decoded body's
 * UTF-16 code-unit length cannot exceed its validated UTF-8 byte length. This
 * preflight limits parser-sensitive structure to a fixed amplification of those
 * accepted bytes: unresolved emphasis delimiters are charged by active depth,
 * and ambiguous wiki-link and link-label candidate nesting is bounded until
 * closes consume it.
 */
function markdownComplexityRange(
  body: string,
  positions: SourcePositionIndex,
): SourceRange | undefined {
  const delimiterWorkLimit = body.length * MARKDOWN_PARSE_WORK_PER_CODE_UNIT;
  let delimiterDepth = 0;
  let delimiterWork = 0;
  let starOpeners = 0;
  let underscoreOpeners = 0;
  let labelCandidateDepth = 0;
  const labelCandidates: boolean[] = [];

  for (let line = 0; line < positions.lineStarts.length; line += 1) {
    const lineStart = positions.lineStarts[line] as number;
    const lineEnd = positions.lineEnds[line] as number;
    let backslashes = 0;
    let wikiCandidateDepth = 0;
    let index = lineStart;
    while (index < lineEnd) {
      const character = body[index] as string;
      if (character === "\\") {
        backslashes += 1;
        index += 1;
        continue;
      }
      const escaped = backslashes % 2 === 1;
      backslashes = 0;

      if (!escaped && body[index + 1] === character) {
        if (character === "[") {
          wikiCandidateDepth += 1;
          if (wikiCandidateDepth > MARKDOWN_PARSE_WORK_PER_CODE_UNIT) {
            return { end: index + 2, start: index };
          }
        } else if (character === "]") {
          wikiCandidateDepth = Math.max(0, wikiCandidateDepth - 1);
        }
      }

      if (!escaped && character === "[") {
        const candidate =
          body[index + 1] !== "^" &&
          (body[index - 1] === "!" ||
            (body[index - 1] !== "[" && body[index + 1] !== "["));
        labelCandidates.push(candidate);
        if (candidate) {
          labelCandidateDepth += 1;
          if (labelCandidateDepth > MARKDOWN_PARSE_WORK_PER_CODE_UNIT) {
            return { end: index + 1, start: index };
          }
        }
      } else if (!escaped && character === "]" && labelCandidates.pop()) {
        labelCandidateDepth -= 1;
      }

      if (character !== "*" && character !== "_") {
        index += 1;
        continue;
      }
      let runEnd = index + 1;
      while (runEnd < lineEnd && body[runEnd] === character) runEnd += 1;
      const activeStart = index + (escaped ? 1 : 0);
      if (activeStart < runEnd) {
        const { canClose, canOpen } = delimiterCapabilities(
          character,
          index === lineStart ? undefined : body[index - 1],
          runEnd === lineEnd ? undefined : body[runEnd],
        );
        if (canClose || canOpen) {
          for (let unit = activeStart; unit < runEnd; unit += 1) {
            const unitWork = delimiterDepth + 1;
            if (unitWork > delimiterWorkLimit - delimiterWork) {
              return { end: unit + 1, start: unit };
            }
            delimiterWork += unitWork;
            const matchingOpeners = character === "*" ? starOpeners : underscoreOpeners;
            if (canClose && matchingOpeners > 0) {
              delimiterDepth -= 1;
              if (character === "*") starOpeners -= 1;
              else underscoreOpeners -= 1;
            } else if (canOpen) {
              delimiterDepth += 1;
              if (character === "*") starOpeners += 1;
              else underscoreOpeners += 1;
            }
          }
        }
      }
      index = runEnd;
    }

    if (isBlankMarkdownLine(body, lineStart, lineEnd)) {
      delimiterDepth = 0;
      starOpeners = 0;
      underscoreOpeners = 0;
      labelCandidateDepth = 0;
      labelCandidates.length = 0;
    }
  }
  return undefined;
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
  contentPositions: SourcePositionIndex,
  tree: MarkdownNode,
): Finding | undefined {
  const first = tree.children?.[0];
  if (first?.type !== "heading" || first.depth !== 1) {
    const position = first?.position;
    const location =
      position === undefined
        ? lineLocation(contentPositions, parsed.source.body.startLine)
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
  if (visibleHeadingText(first) === parsed.page.atlas.title) {
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
  readonly start: number;
};

const hiddenNodeTypes: ReadonlySet<string> = new Set([
  "code",
  "definition",
  "footnoteDefinition",
  "html",
  "image",
  "inlineCode",
]);
const labelNodeTypes: ReadonlySet<string> = new Set(["link", "linkReference"]);
const transparentNodeTypes: ReadonlySet<string> = new Set([
  "delete",
  "emphasis",
  "strong",
]);
type PendingEntry = MarkdownNode;
const markerBoundary = /[\r\n[]/u;
const c1CharacterReferenceReplacements: ReadonlyMap<number, string> = new Map([
  [0x80, "\u20ac"],
  [0x82, "\u201a"],
  [0x83, "\u0192"],
  [0x84, "\u201e"],
  [0x85, "\u2026"],
  [0x86, "\u2020"],
  [0x87, "\u2021"],
  [0x88, "\u02c6"],
  [0x89, "\u2030"],
  [0x8a, "\u0160"],
  [0x8b, "\u2039"],
  [0x8c, "\u0152"],
  [0x8e, "\u017d"],
  [0x91, "\u2018"],
  [0x92, "\u2019"],
  [0x93, "\u201c"],
  [0x94, "\u201d"],
  [0x95, "\u2022"],
  [0x96, "\u2013"],
  [0x97, "\u2014"],
  [0x98, "\u02dc"],
  [0x99, "\u2122"],
  [0x9a, "\u0161"],
  [0x9b, "\u203a"],
  [0x9c, "\u0153"],
  [0x9e, "\u017e"],
  [0x9f, "\u0178"],
]);

type DecodedCharacterReference = {
  readonly character: string;
  readonly end: number;
};

function digitValue(character: number, radix: 10 | 16): number {
  if (character >= 0x30 && character <= 0x39) return character - 0x30;
  if (radix === 16 && character >= 0x41 && character <= 0x46) {
    return character - 0x41 + 10;
  }
  if (radix === 16 && character >= 0x61 && character <= 0x66) {
    return character - 0x61 + 10;
  }
  return -1;
}

function isAsciiAlphaNumeric(character: number): boolean {
  return (
    (character >= 0x30 && character <= 0x39) ||
    (character >= 0x41 && character <= 0x5a) ||
    (character >= 0x61 && character <= 0x7a)
  );
}

function renderedNumericCharacter(value: number, overflowed: boolean): string {
  if (overflowed || value === 0 || (value >= 0xd800 && value <= 0xdfff)) {
    return "\ufffd";
  }
  return c1CharacterReferenceReplacements.get(value) ?? String.fromCodePoint(value);
}

function decodedCharacterReference(
  source: string,
  start: number,
  allowMissingNumericSemicolon: boolean,
): DecodedCharacterReference | undefined {
  let index = start + 1;
  if (source.charCodeAt(index) === 0x23) {
    index += 1;
    let radix: 10 | 16 = 10;
    const hexMarker = source.charCodeAt(index);
    if (hexMarker === 0x58 || hexMarker === 0x78) {
      radix = 16;
      index += 1;
    }
    const digitsStart = index;
    let overflowed = false;
    let value = 0;
    for (;;) {
      const digit = digitValue(source.charCodeAt(index), radix);
      if (digit < 0) break;
      if (!overflowed) {
        if (value > Math.floor((0x10ffff - digit) / radix)) {
          overflowed = true;
        } else {
          value = value * radix + digit;
        }
      }
      index += 1;
    }
    if (index === digitsStart) return undefined;
    if (source[index] === ";") {
      index += 1;
    } else if (!allowMissingNumericSemicolon) {
      return undefined;
    }
    return {
      character: renderedNumericCharacter(value, overflowed),
      end: index,
    };
  }

  const nameStart = index;
  while (isAsciiAlphaNumeric(source.charCodeAt(index))) index += 1;
  if (index === nameStart || source[index] !== ";") return undefined;
  const character = decodeNamedCharacterReference(source.slice(nameStart, index));
  return character === false ? undefined : { character, end: index + 1 };
}

function decodeRenderedText(source: string): string {
  const characters: string[] = [];
  let index = 0;
  while (index < source.length) {
    const reference =
      source[index] === "&"
        ? decodedCharacterReference(source, index, true)
        : undefined;
    if (reference !== undefined) {
      characters.push(reference.character);
      index = reference.end;
      continue;
    }
    const point = source.codePointAt(index) as number;
    const end = index + (point > 0xffff ? 2 : 1);
    characters.push(source.slice(index, end));
    index = end;
  }
  return characters.join("");
}

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
 * A Realm knowledge page body may not contain raw HTML at all. Approximating
 * HTML5 parsing, CSS visibility, template inertness, and rendered order is not
 * safely possible here, so every parser-recognized raw HTML construct, and any
 * `<` inside wiki-link syntax the Markdown parser never inspects, fails closed
 * at its own source range instead.
 */
function rawHtmlRanges(tree: MarkdownNode, body: string): readonly SourceRange[] {
  const ranges: SourceRange[] = [];
  visitMarkdown(tree, (node) => {
    if (node.type === "html") {
      ranges.push(nodeRange(node));
      return;
    }
    if (node.type !== "wikiLink") return;
    const range = nodeRange(node);
    const index = body.indexOf("<", range.start);
    if (index >= 0 && index < range.end) {
      ranges.push({ end: index + 1, start: index });
    }
  });
  return ranges;
}

function appendCells(
  cells: MarkerCell[],
  body: string,
  range: SourceRange,
  escapable: boolean,
  allowMissingNumericSemicolon: boolean,
): void {
  const source = body.slice(range.start, range.end);
  let backslashes = 0;
  let index = 0;
  while (index < source.length) {
    const reference =
      source[index] === "&"
        ? decodedCharacterReference(source, index, allowMissingNumericSemicolon)
        : undefined;
    if (reference !== undefined) {
      for (const character of Array.from(reference.character)) {
        cells.push({
          character,
          end: range.start + reference.end,
          escapable,
          escaped: false,
          start: range.start + index,
        });
      }
      backslashes = 0;
      index = reference.end;
      continue;
    }
    const point = source.codePointAt(index) as number;
    const end = index + (point > 0xffff ? 2 : 1);
    const character = source.slice(index, end);
    cells.push({
      character,
      end: range.start + end,
      escapable,
      escaped: backslashes % 2 === 1,
      start: range.start + index,
    });
    backslashes = character === "\\" ? backslashes + 1 : 0;
    index = end;
  }
}

function rendersAs(cell: MarkerCell, character: string): boolean {
  return cell.character === character;
}

/**
 * Folds one rendered Citation label with the same algorithm GFM footnote
 * identity uses: micromark's identifier normalization plus the lowercase fold
 * `mdast-util-gfm-footnote` applies. GFM derives identity from raw source, so
 * this fold keys what a reader sees, not the parser's identity; parsed nodes
 * keep the parser's own `identifier` and reach this key space only through
 * their decoded `label`.
 */
function canonicalCitationIdentifier(label: string): string {
  return normalizeIdentifier(label).toLowerCase();
}

/**
 * Scans one cell run for Citation markers. Nearest following close and nearest
 * following boundary are precomputed once, so repeated candidates stay linear
 * and accepted markers never overlap.
 */
function collectMarkers(
  positions: SourcePositionIndex,
  cells: readonly MarkerCell[],
  markers: CitationMarker[],
): void {
  const nextClose = new Int32Array(cells.length);
  const nextBoundary = new Int32Array(cells.length);
  let nearestClose = -1;
  let nearestBoundary = -1;
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const cell = cells[index] as MarkerCell;
    if (rendersAs(cell, "]")) nearestClose = index;
    if (markerBoundary.test(cell.character)) nearestBoundary = index;
    nextClose[index] = nearestClose;
    nextBoundary[index] = nearestBoundary;
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
    const identifier: string[] = [];
    for (let cursor = index + 2; cursor < close; cursor += 1) {
      const cell = cells[cursor] as MarkerCell;
      identifier.push(cell.character);
    }
    markers.push({
      identifier: canonicalCitationIdentifier(identifier.join("")),
      position: rangeAt(positions, open.start, (cells[close] as MarkerCell).end),
    });
    index = close;
  }
}

/**
 * Streams the rendered-visible text of adjacent inline nodes into one cell run,
 * so a marker split across formatting or a wiki-link alias cannot bypass
 * detection. Hidden content, raw HTML, link destinations, autolinks, and block
 * boundaries flush the run, while hidden syntax between rendered cells bridges
 * it: source line endings inside a link destination or title are never
 * rendered, so they cannot separate text a reader sees as contiguous.
 *
 * Raw HTML is rejected for the whole page, so a run never has to model what an
 * HTML renderer would show, hide, or reorder.
 */
function visibleCitationMarkers(
  tree: MarkdownNode,
  body: string,
  positions: SourcePositionIndex,
): readonly CitationMarker[] {
  const markers: CitationMarker[] = [];
  const pending: PendingEntry[] = [tree];
  let cells: MarkerCell[] = [];
  function flush(): void {
    if (cells.length > 0) {
      collectMarkers(positions, cells, markers);
      cells = [];
    }
  }
  function emit(
    range: SourceRange,
    escapable: boolean,
    allowMissingNumericSemicolon: boolean,
  ): void {
    appendCells(cells, body, range, escapable, allowMissingNumericSemicolon);
  }
  while (pending.length > 0) {
    const entry = pending.pop() as PendingEntry;
    if (entry.type === "text") {
      emit(nodeRange(entry), true, false);
      continue;
    }
    if (entry.type === "wikiLink") {
      emit(entry.visible as SourceRange, false, true);
      continue;
    }
    if (transparentNodeTypes.has(entry.type)) {
      pushChildren(pending, entry);
      continue;
    }
    if (labelNodeTypes.has(entry.type) && body[nodeRange(entry).start] === "[") {
      pushChildren(pending, entry);
      continue;
    }
    flush();
    if (hiddenNodeTypes.has(entry.type)) continue;
    if (labelNodeTypes.has(entry.type)) continue;
    pushChildren(pending, entry);
  }
  flush();
  return markers;
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

type MarkdownPage = {
  readonly bodyPositions: SourcePositionIndex;
  readonly file: RealmTextFile;
  readonly page: ParsedRealmPage;
  readonly tree: MarkdownNode;
};

function validateCitations(
  parsedPages: readonly MarkdownPage[],
  pagePaths: ReadonlySet<string>,
  findings: Finding[],
): void {
  for (const { bodyPositions, file, page, tree } of parsedPages) {
    const references: MarkdownNode[] = [];
    const unresolved = visibleCitationMarkers(tree, page.page.body, bodyPositions);
    const definitions = new Map<string, MarkdownNode[]>();
    const renderedDefinitions = new Map<string, Set<string>>();
    visitMarkdown(tree, (node) => {
      if (node.type === "footnoteReference" && node.identifier !== undefined) {
        references.push(node);
      }
      if (node.type === "footnoteDefinition" && node.identifier !== undefined) {
        const identifier = node.identifier;
        const existing = definitions.get(identifier);
        if (existing === undefined) definitions.set(identifier, [node]);
        else existing.push(node);
        const rendered = canonicalCitationIdentifier(node.label as string);
        const identities = renderedDefinitions.get(rendered);
        if (identities === undefined) {
          renderedDefinitions.set(rendered, new Set([identifier]));
        } else identities.add(identifier);
      }
    });

    const referenced = new Set<string>();
    for (const reference of references) {
      const identities = renderedDefinitions.get(
        canonicalCitationIdentifier(reference.label as string),
      );
      if (identities !== undefined && identities.size > 1) {
        findings.push(
          finding(
            "ATLAS_CITATION_LABEL_AMBIGUOUS",
            "Citation label must render to exactly one footnote identity.",
            file.path,
            markdownLocation(page, reference.position as MarkdownPosition),
          ),
        );
        continue;
      }
      referenced.add(reference.identifier as string);
    }

    for (const reference of unresolved) {
      const identities = renderedDefinitions.get(reference.identifier);
      if (identities === undefined) {
        findings.push(
          finding(
            "ATLAS_CITATION_DEFINITION_MISSING",
            "Citation reference must have a matching footnote definition.",
            file.path,
            markdownLocation(page, reference.position),
          ),
        );
        continue;
      }
      if (identities.size > 1) {
        findings.push(
          finding(
            "ATLAS_CITATION_LABEL_AMBIGUOUS",
            "Citation label must render to exactly one footnote identity.",
            file.path,
            markdownLocation(page, reference.position),
          ),
        );
        continue;
      }
      for (const identifier of identities) referenced.add(identifier);
    }

    /* Every referenced identity came from a parsed reference, whose definition
       the parser guarantees, or from a definition's own rendered label. */
    for (const identifier of referenced) {
      const matches = definitions.get(identifier) as MarkdownNode[];
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
      const definition = matches[0] as MarkdownNode;
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

function validatePageMetadata(
  file: RealmTextFile,
  parsed: ParsedRealmPage,
  positions: SourcePositionIndex,
  findings: Finding[],
): void {
  const expected = expectedType(file.path);
  if (parsed.page.atlas.type !== expected) {
    findings.push(
      finding(
        "ATLAS_PAGE_TYPE_PATH_MISMATCH",
        "Realm page type does not match its registered path.",
        file.path,
        atlasKeyLocation(file.content, positions, "type"),
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
        atlasKeyLocation(file.content, positions, "id"),
      ),
    );
  }

  if (
    Date.parse(parsed.page.atlas["created-at"]) >
    Date.parse(parsed.page.atlas["updated-at"])
  ) {
    findings.push(
      finding(
        "ATLAS_PAGE_UPDATED_BEFORE_CREATED",
        "Realm page updated-at must not precede created-at.",
        file.path,
        atlasKeyLocation(file.content, positions, "updated-at"),
      ),
    );
  }
}

function parseOne(
  file: RealmTextFile,
  positions: SourcePositionIndex,
): ParsedRealmPage | Finding {
  try {
    const [parsed] = parseRealmPages([file]);
    return parsed as ParsedRealmPage;
  } catch (error: unknown) {
    if (error instanceof RealmPageParseError) {
      return finding(
        parseCodes[error.code],
        parseMessages[error.code],
        file.path,
        lineLocation(positions, error.sourceLine),
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

  const parsed: {
    readonly contentPositions: SourcePositionIndex;
    readonly file: RealmTextFile;
    readonly page: ParsedRealmPage;
  }[] = [];
  const markdownPages: MarkdownPage[] = [];
  for (const file of pageRecords) {
    const contentPositions = sourcePositionIndex(file.content);
    const result = parseOne(file, contentPositions);
    if ("code" in result) findings.push(result);
    else {
      parsed.push({ contentPositions, file, page: result });
      validatePageMetadata(file, result, contentPositions, findings);

      const bodyPositions = sourcePositionIndex(result.page.body);
      const complexity = markdownComplexityRange(result.page.body, bodyPositions);
      if (complexity !== undefined) {
        findings.push(
          finding(
            "ATLAS_PAGE_MARKDOWN_COMPLEXITY_EXCEEDED",
            "Realm page Markdown exceeds deterministic parsing complexity limits.",
            file.path,
            markdownLocation(
              result,
              rangeAt(bodyPositions, complexity.start, complexity.end),
            ),
          ),
        );
        continue;
      }

      let tree: MarkdownNode;
      /* c8 ignore next 12 -- parser internals may fail without exposing details */
      try {
        tree = fromMarkdown(result.page.body, markdownOptions) as MarkdownNode;
      } catch {
        findings.push(
          finding(
            "ATLAS_PAGE_MARKDOWN_PARSE_FAILED",
            "Realm page Markdown could not be parsed.",
            file.path,
          ),
        );
        continue;
      }
      const heading = markdownHeadingFinding(result, contentPositions, tree);
      if (heading !== undefined) findings.push(heading);
      for (const range of rawHtmlRanges(tree, result.page.body)) {
        findings.push(
          finding(
            "ATLAS_PAGE_RAW_HTML_UNSUPPORTED",
            "Realm page Markdown must not contain raw HTML; write the content as Markdown.",
            file.path,
            markdownLocation(result, rangeAt(bodyPositions, range.start, range.end)),
          ),
        );
      }
      markdownPages.push({ bodyPositions, file, page: result, tree });
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
    for (const { contentPositions, file } of entries) {
      findings.push(
        finding(
          "ATLAS_PAGE_ID_DUPLICATE",
          "Realm page stable ID must be unique within the Realm.",
          file.path,
          atlasKeyLocation(file.content, contentPositions, "id"),
        ),
      );
    }
  }

  validateCitations(
    markdownPages,
    new Set(pageRecords.map(({ path }) => path)),
    findings,
  );

  return Object.freeze(findings.toSorted(compareFindings));
}
