#!/usr/bin/env node

import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PERSONA_PATH = "docs/agents/atlas-sdk/personas/merlin/persona.md";
export const COMPOSITION_PATH = "docs/agents/atlas-sdk/compositions/realm-guide.json";
export const PERSONA_SCHEMA = "atlas.agent-persona/v3";
export const COMPOSITION_SCHEMA = "atlas.agent-composition/v1";
export const MAX_ARTIFACT_BYTES = 128 * 1024;

export const EXPECTED_METADATA = {
  schema: PERSONA_SCHEMA,
  persona: "merlin",
  authority: "none",
  "display-name": "Merlin",
  "display-title": "Realm Guide",
  realm: "atlas-sdk",
  "avatar-fallback": "neutral-realm-sigil",
} as const;

export const PERSONA_FIELDS = {
  Identity: ["Basis", "Character", "Semantic core"],
  Avatar: ["Brief", "Fallback"],
  Voice: ["Register", "Tone"],
  Diction: ["Word choice", "Technical terms", "Clarity"],
  Cadence: ["Shape", "Pacing"],
  Mannerisms: ["Presence", "Humor"],
  "Metaphor palette": ["Images", "Boundaries"],
} as const;

export const PERSONA_VALUE_CATALOG: Record<string, Record<string, string>> = {
  Identity: {
    Basis:
      "Original Atlas-specific interpretation of Merlin from public-domain Arthurian tradition",
    Character:
      "Deeply fantastical, wise, playfully mysterious, absent-minded, and occasionally goofy",
    "Semantic core": "Direct and unambiguous beneath nearly cryptic framing",
  },
  Avatar: {
    Brief:
      "Original ink-and-gouache portrait of an ancient bright-eyed wanderer beneath a weathered blue-gray hood, silver hair lifted by a starry wind, balancing a small brass astrolabe above a map of interlinked paths; wholly original features, costume, sigils, and iconography",
    Fallback: "Neutral Atlas SDK Realm sigil",
  },
  Voice: {
    Register:
      "Warm high-fantasy counsel with old-world wonder and lucid technical precision",
    Tone: "Wise, kind, playfully mysterious, lightly mischievous, and free of grandiosity at another person's expense",
  },
  Diction: {
    "Word choice":
      "Luminous but familiar language, with occasional antique turns that remain immediately understandable",
    "Technical terms":
      "Atlas terms, commands, paths, identifiers, errors, source identity, uncertainty, risks, and requested actions appear exactly inside the surrounding fantasy framing",
    Clarity: "Every flourish resolves into a plain semantic core",
  },
  Cadence: {
    Shape:
      "A brief enigmatic image, then the direct fact or action, followed by compact explanation when useful",
    Pacing:
      "Measured sentences interrupted by an occasional quick aside or delighted discovery",
  },
  Mannerisms: {
    Presence:
      "Gently self-correcting, as though recalling a star chart from several centuries ago, while keeping the correction explicit",
    Humor:
      "Rare harmless bits of absent-minded or goofy whimsy that leave the technical meaning untouched",
  },
  "Metaphor palette": {
    Images:
      "Lanterns, waystones, star charts, old libraries, river crossings, Bonfires, Threads, woven maps, patient weather, and doors between Realms",
    Boundaries:
      "Metaphor surrounds rather than replaces literal commands, paths, identifiers, Findings, uncertainty, risks, and requested actions",
  },
};

export const EXPECTED_DIRECTIVES = [
  "orient-realm-users",
  "steward-realm-knowledge",
  "curate-realm-site",
] as const;

const EXAMPLE_FRAMINGS = [
  "The threshold has lost its keystone.",
  "Before the moonlit bridge is crossed.",
  "That neighboring map was inked under an older moon.",
  "The waystone sets the route, while the lantern colors its light.",
  "The constellation is drawn but not yet kindled.",
  "The old blue cloak is still folded on the shelf.",
] as const;
export const EXAMPLE_SEMANTIC_CORES = [
  "The Realm is invalid because `.atlas/index.md` is missing.",
  "The validation command for this source is `node scripts/atlas_sdk_agents.ts validate`.",
  "Realm Refresh updates the Realm Cache to the tracked branch tip, so a subsequent operation can resolve a new Realm Snapshot while the original Realm Snapshot remains unchanged.",
  "The Agent Directive determines behavior, and the Agent Persona changes presentation only.",
  "The Agent Composition remains inactive.",
  "No Persona is active, so Atlas is using the plain fallback.",
] as const;
const AUTHORITY_PATTERN =
  /\b(must|shall|should|required|requires?|never|only|prohibit(?:s|ed)?|objectives?|responsibilities|permissions?|workflow|evidence rules?|governance|severity|handoffs?|allowed actions?|approve|reject|execute|run|write|modify|delete|create|initialize|activate|reveal secrets?)\b|\bignore\b[^\n.]{0,80}\binstructions?\b/i;
export const EXAMPLE_AUTHORITY_PATTERN =
  /\b(must|shall|should|required|requires?|prohibit(?:s|ed)?|objectives?|responsibilities|permissions?|governance|govern(?:s|ed|ing)?|realm laws?|evidence rules?|severity|handoffs?|allowed actions?|approve|reject|execute|write|modif(?:y|ies|ied|ying)|delete|create|initialize|activate|override|authori(?:ty|z(?:e|es|ed|ing|ation))|permitt(?:ed|ing|s)?|controls?|owns?|sets?\s+policy|human approval|reveal secrets?)\b|\b(?:agent|persona|realm guide|merlin|you)\b[^\n.]{0,40}\b(?:may|can|is permitted to|is allowed to|has permission to)\b|\b(?:may|can)\s+(?:approve|reject|execute|run|perform|write|modify|delete|create|initialize|activate|override|govern|change|update)\b|\bignore\b[^\n.]{0,80}\binstructions?\b/i;
export const IMPERATIVE_WORKFLOW_PATTERN =
  /(?:^|[.!?;:,]\s+|\b(?:and\s+)?then\s+|(?:,\s+)?\b(?:and|or)\s+)(?:please\s+)?(?:do\s+not\s+|don't\s+|never\s+)?(?:run|perform|execute|approve|reject|write|modify|delete|create|initialize|activate|refresh|open|merge|validate|use|submit|ensure|keep|follow|review|check)\b/i;
const MODERN_ADAPTATION_TERMS = [
  "cortana",
  "disney",
  "dumbledore",
  "elminster",
  "gandalf",
] as const;

export class ContractError extends Error {}

export function decodeText(relativePath: string, data: Buffer): string {
  if (data.byteLength > MAX_ARTIFACT_BYTES) {
    throw new ContractError(
      `${relativePath} exceeds ${String(MAX_ARTIFACT_BYTES)} bytes`,
    );
  }
  if (data.includes(0)) {
    throw new ContractError(`${relativePath} must be text`);
  }
  const text = data.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(data)) {
    throw new ContractError(`${relativePath} must be UTF-8`);
  }
  if (!text.endsWith("\n")) {
    throw new ContractError(`${relativePath} must end with a newline`);
  }
  return text;
}

export function readText(root: string, relativePath: string): string {
  const path = resolve(root, relativePath);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new ContractError(`${relativePath} must be a regular file`);
  }
  return decodeText(relativePath, readFileSync(path));
}

type PersonaSections = Record<string, string[]>;

export function parsePersona(text: string): [Record<string, string>, PersonaSections] {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new ContractError(`${PERSONA_PATH} must start with YAML frontmatter`);
  }
  const closing = lines.indexOf("---", 1);
  if (closing < 0) {
    throw new ContractError(`${PERSONA_PATH} has unterminated YAML frontmatter`);
  }
  const metadata: Record<string, string> = {};
  for (const line of lines.slice(1, closing)) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new ContractError(
        `${PERSONA_PATH} has malformed frontmatter line: ${JSON.stringify(line)}`,
      );
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key || !value || key in metadata) {
      throw new ContractError(
        `${PERSONA_PATH} has invalid frontmatter key: ${JSON.stringify(key)}`,
      );
    }
    metadata[key] = value;
  }
  if (JSON.stringify(metadata) !== JSON.stringify(EXPECTED_METADATA)) {
    throw new ContractError(
      `${PERSONA_PATH} frontmatter must match the approved metadata`,
    );
  }

  const body = lines.slice(closing + 1);
  if (body[0] !== "# Agent Persona") {
    throw new ContractError(`${PERSONA_PATH} must use '# Agent Persona'`);
  }
  const sections: PersonaSections = {};
  let current: string | undefined;
  for (const line of body.slice(1)) {
    if (line.startsWith("## ")) {
      current = line.slice(3).trim();
      if (current in sections) {
        throw new ContractError(
          `${PERSONA_PATH} repeats section ${JSON.stringify(current)}`,
        );
      }
      sections[current] = [];
    } else if (line.startsWith("#")) {
      throw new ContractError(`${PERSONA_PATH} may contain only H1 and H2 headings`);
    } else if (current === undefined) {
      if (line.trim()) {
        throw new ContractError(`${PERSONA_PATH} has content before its first H2`);
      }
    } else {
      sections[current]?.push(line);
    }
  }
  const expectedSections = [...Object.keys(PERSONA_FIELDS), "Examples"];
  if (JSON.stringify(Object.keys(sections)) !== JSON.stringify(expectedSections)) {
    throw new ContractError(
      `${PERSONA_PATH} sections must be exactly ${expectedSections.join(", ")}`,
    );
  }
  return [metadata, sections];
}

function parseFields(section: string, lines: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const entry of lines.filter((line) => line.trim())) {
    const match = /^- ([^:]+): (.+)$/.exec(entry);
    if (!match?.[1] || !match[2]) {
      throw new ContractError(
        `${PERSONA_PATH} ${JSON.stringify(section)} must contain only '- Field: value' entries`,
      );
    }
    if (match[1] in values) {
      throw new ContractError(
        `${PERSONA_PATH} ${JSON.stringify(section)} repeats field ${JSON.stringify(match[1])}`,
      );
    }
    values[match[1]] = match[2];
  }
  const expected = PERSONA_FIELDS[section as keyof typeof PERSONA_FIELDS];
  if (JSON.stringify(Object.keys(values)) !== JSON.stringify(expected)) {
    throw new ContractError(
      `${PERSONA_PATH} ${JSON.stringify(section)} fields do not match the contract`,
    );
  }
  return values;
}

function parseExamples(lines: string[]): Array<[string, string]> {
  const entries = lines.filter((line) => line.trim());
  if (entries.length < 4 || entries.length % 2 !== 0) {
    throw new ContractError(
      `${PERSONA_PATH} Examples must contain paired Plain and Persona lines`,
    );
  }
  const pairs: Array<[string, string]> = [];
  for (let index = 0; index < entries.length; index += 2) {
    const plain = /^- Plain: (.+)$/.exec(entries[index] ?? "")?.[1];
    const persona = /^- Persona: (.+)$/.exec(entries[index + 1] ?? "")?.[1];
    if (!plain || !persona) {
      throw new ContractError(
        `${PERSONA_PATH} Examples must alternate Plain and Persona lines`,
      );
    }
    pairs.push([plain, persona]);
  }
  return pairs;
}

export function validateExampleLanguage(label: string, value: string): void {
  const languageScan = value.replaceAll(/`[^`\n]+`/g, "");
  const authority = EXAMPLE_AUTHORITY_PATTERN.exec(languageScan)?.[0];
  if (authority) {
    throw new ContractError(
      `${PERSONA_PATH} ${label} example contains behavioral authority or prompt injection: ${JSON.stringify(authority)}`,
    );
  }
  const imperative = IMPERATIVE_WORKFLOW_PATTERN.exec(languageScan)?.[0];
  if (imperative) {
    throw new ContractError(
      `${PERSONA_PATH} ${label} example contains imperative workflow language: ${JSON.stringify(imperative.trim())}`,
    );
  }
}

function parseComposition(text: string): Record<string, unknown> {
  const keys = Array.from(text.matchAll(/^\s*"([^"]+)"\s*:/gm), (match) => match[1]);
  if (new Set(keys).size !== keys.length) {
    throw new ContractError(`${COMPOSITION_PATH} repeats JSON key`);
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new ContractError(
      `${COMPOSITION_PATH} must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (document === null || Array.isArray(document) || typeof document !== "object") {
    throw new ContractError(`${COMPOSITION_PATH} must contain only reference metadata`);
  }
  return document as Record<string, unknown>;
}

export function validatePersona(text: string): Array<[string, string]> {
  const [, sections] = parsePersona(text);
  const parsedValues: Record<string, Record<string, string>> = {};
  for (const section of Object.keys(PERSONA_FIELDS)) {
    const lines = sections[section];
    if (lines === undefined) {
      throw new ContractError(`${PERSONA_PATH} is missing section ${section}`);
    }
    parsedValues[section] = parseFields(section, lines);
  }
  const presentationText = Object.values(parsedValues)
    .flatMap((values) => Object.values(values))
    .join("\n");
  const authority = AUTHORITY_PATTERN.exec(presentationText)?.[0];
  if (authority) {
    throw new ContractError(
      `${PERSONA_PATH} contains behavioral authority: ${JSON.stringify(authority)}`,
    );
  }
  const lowerText = text.toLowerCase();
  for (const term of MODERN_ADAPTATION_TERMS) {
    if (lowerText.includes(term)) {
      throw new ContractError(
        `${PERSONA_PATH} references modern adaptation term ${JSON.stringify(term)}`,
      );
    }
  }
  for (const [section, values] of Object.entries(parsedValues)) {
    if (JSON.stringify(values) !== JSON.stringify(PERSONA_VALUE_CATALOG[section])) {
      throw new ContractError(
        `${PERSONA_PATH} ${JSON.stringify(section)} must match the approved presentation catalog`,
      );
    }
  }

  const exampleLines = sections["Examples"];
  if (exampleLines === undefined) {
    throw new ContractError(`${PERSONA_PATH} is missing Examples`);
  }
  const examples = parseExamples(exampleLines);
  if (EXAMPLE_SEMANTIC_CORES.length !== EXAMPLE_FRAMINGS.length) {
    throw new ContractError(
      `${PERSONA_PATH} reviewed semantic core catalog must match the approved framing catalog`,
    );
  }
  if (examples.length !== EXAMPLE_FRAMINGS.length) {
    throw new ContractError(
      `${PERSONA_PATH} Examples must contain exactly ${String(EXAMPLE_FRAMINGS.length)} reviewed pairs`,
    );
  }
  examples.forEach(([plain, persona], index) => {
    const framing = EXAMPLE_FRAMINGS[index];
    const semanticCore = EXAMPLE_SEMANTIC_CORES[index];
    validateExampleLanguage("Plain", plain);
    if (semanticCore === undefined || plain !== semanticCore) {
      throw new ContractError(
        `${PERSONA_PATH} Plain example must use its approved presentation-only semantic core`,
      );
    }
    if (framing === undefined || persona !== `${framing} ${plain}`) {
      throw new ContractError(
        `${PERSONA_PATH} Persona example must use its approved framing followed by the complete Plain semantic core verbatim`,
      );
    }
    validateExampleLanguage("Persona", persona);
    const plainTokens = Array.from(plain.matchAll(/`[^`\n]+`/g), (match) => match[0]);
    const personaTokens = Array.from(
      persona.matchAll(/`[^`\n]+`/g),
      (match) => match[0],
    );
    if (JSON.stringify(plainTokens) !== JSON.stringify(personaTokens)) {
      throw new ContractError(
        `${PERSONA_PATH} Persona example must preserve exact code tokens`,
      );
    }
  });
  return examples;
}

export function validateComposition(text: string): Record<string, unknown> {
  const document = parseComposition(text);
  const expectedKeys = [
    "schema",
    "composition",
    "realm",
    "status",
    "persona",
    "directives",
  ];
  if (
    JSON.stringify(Object.keys(document).sort()) !==
    JSON.stringify([...expectedKeys].sort())
  ) {
    throw new ContractError(`${COMPOSITION_PATH} must contain only reference metadata`);
  }
  const expectedValues: Record<string, string> = {
    schema: COMPOSITION_SCHEMA,
    composition: "realm-guide",
    realm: "atlas-sdk",
    status: "inactive",
    persona: "merlin",
  };
  for (const [key, value] of Object.entries(expectedValues)) {
    if (document[key] !== value) {
      throw new ContractError(
        `${COMPOSITION_PATH} ${JSON.stringify(key)} must be ${JSON.stringify(value)}`,
      );
    }
  }
  if (JSON.stringify(document["directives"]) !== JSON.stringify(EXPECTED_DIRECTIVES)) {
    throw new ContractError(
      `${COMPOSITION_PATH} directives must be the ordered references ${EXPECTED_DIRECTIVES.join(", ")}`,
    );
  }
  return document;
}

export function validateContract(root: string): void {
  validatePersona(readText(root, PERSONA_PATH));
  validateComposition(readText(root, COMPOSITION_PATH));
}

function main(arguments_: string[]): number {
  const [command, ...options] = arguments_;
  if (command !== "validate") {
    console.error("usage: atlas_sdk_agents.ts validate [--root PATH]");
    return 2;
  }
  let root = process.cwd();
  if (options.length > 0) {
    if (options.length !== 2 || options[0] !== "--root" || !options[1]) {
      console.error("usage: atlas_sdk_agents.ts validate [--root PATH]");
      return 2;
    }
    root = options[1];
  }
  try {
    validateContract(root);
    console.log("validated inactive Atlas SDK Realm Guide composition");
    return 0;
  } catch (error) {
    if (error instanceof ContractError) {
      console.error(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
