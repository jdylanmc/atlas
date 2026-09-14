import type { FootnoteDefinition, FootnoteReference, Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { compareCodePoints } from "./compare_code_points.ts";

const markdownOptions = Object.freeze({
  extensions: [gfmFootnote()],
  mdastExtensions: [gfmFootnoteFromMarkdown()],
});

export interface ResolvedCitation {
  readonly occurrence: number;
  readonly quotation: string;
  readonly target: string;
}

export interface ResolvedCitationSequence {
  readonly citations: readonly ResolvedCitation[];
  readonly complete: boolean;
}

export function citationSequence(
  citations: readonly Omit<ResolvedCitation, "occurrence">[],
): readonly ResolvedCitation[] {
  const occurrences = new Map<string, number>();
  return Object.freeze(
    citations.map((citation) => {
      const key = `${citation.target}\u0000${citation.quotation}`;
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      return Object.freeze({ ...citation, occurrence });
    }),
  );
}

export function citationSequencesEqual(
  left: readonly ResolvedCitation[],
  right: readonly ResolvedCitation[],
): boolean {
  return (
    left.length === right.length &&
    left.every((citation, index) => {
      const expected = right[index] as ResolvedCitation;
      return (
        citation.target === expected.target &&
        citation.quotation === expected.quotation &&
        citation.occurrence === expected.occurrence
      );
    })
  );
}

function collectCitationNodes(tree: Nodes): {
  readonly definitions: ReadonlyMap<string, readonly FootnoteDefinition[]>;
  readonly references: readonly FootnoteReference[];
} {
  const definitions = new Map<string, FootnoteDefinition[]>();
  const references: FootnoteReference[] = [];
  const pending: Nodes[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop() as Nodes;
    if (node.type === "footnoteReference") references.push(node);
    if (node.type === "footnoteDefinition") {
      const matches = definitions.get(node.identifier);
      if (matches === undefined) definitions.set(node.identifier, [node]);
      else matches.push(node);
    }
    if ("children" in node) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push(node.children[index] as Nodes);
      }
    }
  }
  return { definitions, references };
}

function visibleCitationText(node: Nodes): string {
  if (node.type === "text") return node.value;
  if (
    node.type === "code" ||
    node.type === "html" ||
    node.type === "inlineCode" ||
    node.type === "link" ||
    node.type === "linkReference" ||
    node.type === "image" ||
    node.type === "imageReference"
  ) {
    return "";
  }
  if (
    node.type === "paragraph" &&
    node.children.some((child) => child.type === "html")
  ) {
    return "";
  }
  if (!("children" in node)) return "";
  return node.children.map((child) => visibleCitationText(child)).join("");
}

function citationTargetPath(text: string): string | undefined {
  if (/[\s\p{Cc}#|\\]/u.test(text)) return undefined;
  const segments = text.split("/");
  if (segments.length < 2) return undefined;
  if (segments[0] !== ".atlas" || segments[1] !== "sources") return undefined;
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    return undefined;
  if ((segments.at(-1) as string).includes(".")) return undefined;
  return `${text}.md`;
}

function citationTargets(text: string): readonly string[] {
  const targets: string[] = [];
  let index = 0;
  for (;;) {
    const open = text.indexOf("[[", index);
    if (open === -1) break;
    const close = text.indexOf("]]", open + 2);
    if (close === -1) break;
    const path = citationTargetPath(text.slice(open + 2, close));
    if (path !== undefined) targets.push(path);
    index = close + 2;
  }
  return targets;
}

function resolvedCitation(
  definition: FootnoteDefinition,
): Omit<ResolvedCitation, "occurrence"> | undefined {
  const text = definition.children.map((child) => visibleCitationText(child)).join("");
  const match = /^\[\[([^\]]+)\]\] Quoted span ("(?:[^"\\]|\\.)*")\.$/u.exec(text);
  if (match === null) return undefined;
  const target = citationTargetPath(match[1] as string);
  if (target === undefined) return undefined;
  try {
    const quotation = JSON.parse(match[2] as string) as string;
    if (quotation.trim() !== quotation) {
      return undefined;
    }
    return Object.freeze({ quotation, target });
  } catch {
    return undefined;
  }
}

export function resolvedCitationSequence(body: string): ResolvedCitationSequence {
  const tree = fromMarkdown(body, markdownOptions);
  const { definitions, references } = collectCitationNodes(tree);
  const citations: Omit<ResolvedCitation, "occurrence">[] = [];
  let complete = true;
  for (const reference of references) {
    const matches = definitions.get(reference.identifier);
    if (matches === undefined || matches.length !== 1) {
      complete = false;
      continue;
    }
    const citation = resolvedCitation(matches[0] as FootnoteDefinition);
    if (citation === undefined) {
      complete = false;
      continue;
    }
    citations.push(citation);
  }
  return Object.freeze({
    citations: citationSequence(citations),
    complete,
  });
}

export function resolvedCitationSourcePaths(body: string): readonly string[] {
  const tree = fromMarkdown(body, markdownOptions);
  const { definitions, references } = collectCitationNodes(tree);
  const paths: string[] = [];
  const referenced = new Set(references.map((reference) => reference.identifier));
  for (const identifier of [...referenced].sort(compareCodePoints)) {
    const matches = definitions.get(identifier);
    if (matches === undefined || matches.length !== 1) continue;
    const definition = matches[0] as FootnoteDefinition;
    for (const child of definition.children) {
      paths.push(...citationTargets(visibleCitationText(child)));
    }
  }
  return Object.freeze([...new Set(paths)].sort(compareCodePoints));
}
