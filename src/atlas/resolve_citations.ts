import type { FootnoteDefinition, FootnoteReference, Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { compareCodePoints } from "./compare_code_points.ts";

const markdownOptions = Object.freeze({
  extensions: [gfmFootnote()],
  mdastExtensions: [gfmFootnoteFromMarkdown()],
});

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
      for (const child of node.children) pending.push(child);
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
