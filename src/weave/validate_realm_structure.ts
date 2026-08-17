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
type MarkdownNode = {
  readonly children?: readonly MarkdownNode[];
  readonly identifier?: string;
  readonly position?: MarkdownPosition;
  readonly type: string;
  readonly value?: string;
};
type MutableWikiLinkNode = {
  type: "wikiLink";
  value: string;
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
  return {
    enter: {
      wikiLink(this: CompileContext, token: Token): void {
        current = { type: "wikiLink", value: "" };
        this.enter(current as unknown as Nodes, token);
      },
    },
    exit: {
      wikiLink(this: CompileContext, token: Token): void {
        this.exit(token);
        current = undefined;
      },
      wikiLinkTarget(this: CompileContext, token: Token): void {
        (current as MutableWikiLinkNode).value = this.sliceSerialize(token);
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
  visitor(node);
  for (const child of node.children ?? []) visitMarkdown(child, visitor);
}

function unresolvedReferences(
  tree: MarkdownNode,
  body: string,
): readonly { readonly identifier: string; readonly position: MarkdownPosition }[] {
  const references: { identifier: string; position: MarkdownPosition }[] = [];
  function visitVisibleText(node: MarkdownNode): void {
    if (
      ["code", "footnoteDefinition", "html", "image", "inlineCode"].includes(node.type)
    ) {
      return;
    }
    if (node.type !== "text" || node.position?.start.offset === undefined) {
      for (const child of node.children ?? []) visitVisibleText(child);
      return;
    }
    const startOffset = node.position.start.offset;
    const endOffset = node.position.end.offset as number;
    const source = body.slice(startOffset, endOffset);
    for (let index = 0; index < source.length - 3; index += 1) {
      if (source[index] !== "[" || source[index + 1] !== "^") continue;
      let escapes = 0;
      for (
        let before = index - 1;
        before >= 0 && source[before] === "\\";
        before -= 1
      ) {
        escapes += 1;
      }
      if (escapes % 2 === 1) continue;
      const close = source.indexOf("]", index + 2);
      if (close < index + 3) continue;
      const identifier = source.slice(index + 2, close);
      if (/[\r\n[\]]/u.test(identifier)) continue;
      references.push({
        identifier: identifier.trim().replace(/\s+/gu, " ").toLowerCase(),
        position: rangeAt(body, startOffset + index, startOffset + close + 1),
      });
      index = close;
    }
  }
  visitVisibleText(tree);
  return references;
}

function citationTargetPath(target: string): string | undefined {
  const path = target.split("#", 1)[0] as string;
  if (
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return undefined;
  }
  if (!path.startsWith(".atlas/lore/")) return path;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.includes(".") && !name.endsWith(".md")) return path;
  return path.endsWith(".md") ? path : `${path}.md`;
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
    const unresolved = unresolvedReferences(tree, page.page.body);
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
      const targets: MarkdownNode[] = [];
      visitMarkdown(definition, (node) => {
        if (node.type === "wikiLink") targets.push(node);
      });
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
      const targetValue = target.value as string;
      const targetPath = citationTargetPath(targetValue);
      if (targetPath === undefined) {
        findings.push(
          finding(
            "ATLAS_CITATION_TARGET_INVALID",
            "Citation target must be a Realm-local root-relative forward-slash path.",
            file.path,
            markdownLocation(page, target.position as MarkdownPosition),
          ),
        );
      } else if (
        !targetPath.startsWith(".atlas/lore/") ||
        !targetPath.endsWith(".md")
      ) {
        findings.push(
          finding(
            "ATLAS_CITATION_TARGET_NOT_LORE",
            "Citation target must classify as a Realm Lore Markdown page.",
            file.path,
            markdownLocation(page, target.position as MarkdownPosition),
          ),
        );
      } else if (!pagePaths.has(targetPath)) {
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
