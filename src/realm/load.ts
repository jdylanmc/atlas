import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { LineCounter, parseDocument, stringify } from "yaml";

import {
  CORE_ARCHETYPES,
  CORE_SCHEMA_VERSION,
  FINDING_SCHEMA,
  MAX_REALM_FILE_BYTES,
  REALM_LAWS_SCHEMA,
  REALM_MANIFEST_SCHEMA,
  compareFindings,
  compareText,
  type AtlasEnvelope,
  type CoreArchetype,
  type Finding,
  type RealmManifest,
  type SourceLocation,
} from "../domain/contracts.ts";

const REQUIRED_PATHS = [
  ".atlas/index.md",
  ".atlas/realm/config.yaml",
  ".atlas/realm/laws.md",
  ".atlas/realm/manifest.yaml",
  ".atlas/realm/realms.yaml",
  ".atlas/realm/schemas/CHANGELOG.md",
] as const;
const TRUSTED_CHECK_ID = "atlas.realm.structure";
const YAML_FORMAT = { lineWidth: 0, sortMapEntries: false } as const;
const CORE_RELATIONSHIP_TYPES = ["governed-by", "orients"] as const;
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const UNSAFE_SCHEMA_KEYWORDS = new Set([
  "pattern",
  "patternProperties",
  "$ref",
  "$dynamicRef",
  "$recursiveRef",
  "$dynamicAnchor",
  "$recursiveAnchor",
]);

export interface SourceFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly digest: string;
}

export interface RealmPage {
  readonly path: string;
  readonly envelope: AtlasEnvelope;
  readonly realm: Readonly<Record<string, unknown>>;
  readonly body: string;
  readonly location: SourceLocation;
  readonly sourceLines: readonly string[];
}

export interface RealmFile {
  readonly path: string;
  readonly digest: string;
  readonly bytes: number;
}

export interface CanonicalFile {
  readonly path: string;
  readonly text: string;
}

export interface RealmView {
  readonly manifest: RealmManifest;
  readonly pages: readonly RealmPage[];
  readonly files: readonly RealmFile[];
  readonly canonicalFiles: readonly CanonicalFile[];
  readonly digest: string;
}

export type RealmLoadResult =
  | {
      readonly valid: true;
      readonly view: RealmView;
      readonly findings: readonly Finding[];
    }
  | {
      readonly valid: false;
      readonly manifest: RealmManifest | null;
      readonly findings: readonly Finding[];
      readonly digest: string;
    };

interface ParsedPage {
  readonly page: RealmPage;
  readonly canonical: string;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

function finding(
  code: string,
  message: string,
  path: string,
  line: number,
  column: number,
  remediation: string,
): Finding {
  return Object.freeze({
    schema: FINDING_SCHEMA,
    check: Object.freeze({ id: TRUSTED_CHECK_ID, origin: "trusted-atlas" }),
    severity: "error",
    code,
    message,
    location: Object.freeze({ path, line, column }),
    remediation,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function freezeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freezeValue(item)));
  }
  if (isRecord(value)) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, freezeValue(item)]),
      ),
    );
  }
  return value;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalJsonValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map((key) => [key, canonicalJsonValue(value[key])]),
    );
  }
  return value;
}

function canonicalYaml(value: unknown): string {
  return stringify(canonicalJsonValue(value), YAML_FORMAT);
}

function containsUnsafeSchemaRegex(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsUnsafeSchemaRegex(item));
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(
    ([key, item]) => UNSAFE_SCHEMA_KEYWORDS.has(key) || containsUnsafeSchemaRegex(item),
  );
}

function hasYamlKey(line: string, key: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith(`${key}:`) ||
    trimmed.startsWith(`${JSON.stringify(key)}:`) ||
    trimmed.startsWith(`'${key.replaceAll("'", "''")}':`)
  );
}

function keyLocation(path: string, text: string, key: string): SourceLocation {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => hasYamlKey(line, key));
  return Object.freeze({
    path,
    line: index < 0 ? 1 : index + 1,
    column: index < 0 ? 1 : (lines[index] as string).indexOf(key) + 1,
  });
}

function yamlLineKey(
  line: string,
): { readonly indent: number; readonly key: string } | null {
  const match = /^(\s*)("(?:\\.|[^"])*"|'(?:''|[^'])*'|[^#'"][^:]*):/.exec(line);
  if (match === null) {
    return null;
  }
  const rawKey = (match[2] as string).trim();
  return {
    indent: (match[1] as string).length,
    key:
      rawKey.startsWith('"') || rawKey.startsWith("'")
        ? String(parseDocument(rawKey).toJS())
        : rawKey,
  };
}

function keyPathLocation(path: string, text: string, keyPath: string): SourceLocation {
  const wanted = keyPath.split(".");
  const stack: Array<{ readonly indent: number; readonly key: string }> = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const parsed = yamlLineKey(line);
    if (parsed === null) {
      continue;
    }
    const { indent, key } = parsed;
    while ((stack.at(-1)?.indent ?? -1) >= indent) {
      stack.pop();
    }
    stack.push({ indent, key });
    if (
      stack.length === wanted.length &&
      stack.every((entry, position) => entry.key === wanted[position])
    ) {
      return Object.freeze({
        path,
        line: index + 1,
        column: indent + 1,
      });
    }
  }
  return keyLocation(path, text, wanted.at(-1) as string);
}

function isDateTime(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = DATE_TIME_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? "0");
  const offsetMinute = Number(match[8] ?? "0");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [
    month >= 1,
    month <= 12,
    day >= 1,
    day <= daysInMonth,
    hour <= 23,
    minute <= 59,
    second <= 59,
    offsetHour <= 23,
    offsetMinute <= 59,
  ].every(Boolean);
}

function decodeFile(file: SourceFile, findings: Finding[]): string | null {
  if (file.bytes.byteLength > MAX_REALM_FILE_BYTES) {
    findings.push(
      finding(
        "ATLAS_REALM_FILE_TOO_LARGE",
        `${file.path} exceeds ${String(MAX_REALM_FILE_BYTES)} bytes.`,
        file.path,
        1,
        1,
        "Reduce the file below the Atlas per-file limit.",
      ),
    );
    return null;
  }
  let text: string;
  try {
    text = decoder.decode(file.bytes);
  } catch {
    findings.push(
      finding(
        "ATLAS_REALM_INVALID_UTF8",
        `${file.path} is not valid UTF-8 text.`,
        file.path,
        1,
        1,
        "Encode Realm files as UTF-8 text.",
      ),
    );
    return null;
  }
  if (text.includes("\0")) {
    findings.push(
      finding(
        "ATLAS_REALM_BINARY_FILE",
        `${file.path} contains a NUL byte.`,
        file.path,
        1,
        1,
        "Store only text beneath the minimal Realm contract.",
      ),
    );
    return null;
  }
  if (text.includes("\r")) {
    findings.push(
      finding(
        "ATLAS_REALM_LINE_ENDINGS",
        `${file.path} must use LF line endings.`,
        file.path,
        1,
        1,
        "Rewrite the file with LF line endings.",
      ),
    );
  }
  if (!text.endsWith("\n")) {
    findings.push(
      finding(
        "ATLAS_REALM_FINAL_NEWLINE",
        `${file.path} must end with a newline.`,
        file.path,
        text.split("\n").length,
        1,
        "Add one final newline.",
      ),
    );
  }
  return text;
}

export function parseYaml(
  path: string,
  text: string,
  findings: Finding[],
  parser: typeof parseDocument = parseDocument,
  lineOffset = 0,
): Record<string, unknown> | null {
  const lineCounter = new LineCounter();
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parser(text, {
      lineCounter,
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
    });
  } catch (error) {
    findings.push(
      finding(
        "ATLAS_REALM_YAML_SYNTAX",
        `${path} could not be parsed as YAML: ${String(error)}`,
        path,
        1 + lineOffset,
        1,
        "Reduce YAML nesting and correct the document syntax.",
      ),
    );
    return null;
  }
  if (document.errors.length > 0) {
    const error = document.errors[0] as {
      readonly message: string;
      readonly pos: readonly [number, number];
    };
    const position = lineCounter.linePos(error.pos[0]);
    findings.push(
      finding(
        "ATLAS_REALM_YAML_SYNTAX",
        `${path} contains invalid YAML: ${error.message}`,
        path,
        position.line + lineOffset,
        position.col,
        "Correct the YAML syntax and remove duplicate keys.",
      ),
    );
    return null;
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 }) as unknown;
  } catch {
    findings.push(
      finding(
        "ATLAS_REALM_YAML_ALIAS",
        `${path} contains a YAML alias, which is not allowed in a Realm snapshot.`,
        path,
        1 + lineOffset,
        1,
        "Replace YAML aliases with explicit acyclic values.",
      ),
    );
    return null;
  }
  if (!isRecord(value)) {
    findings.push(
      finding(
        "ATLAS_REALM_YAML_OBJECT",
        `${path} must contain a YAML mapping.`,
        path,
        1,
        1,
        "Replace the document root with a YAML mapping.",
      ),
    );
    return null;
  }
  return value;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  text: string,
  findings: Finding[],
): string | null {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  const location = keyLocation(path, text, key);
  findings.push(
    finding(
      "ATLAS_REALM_REQUIRED_FIELD",
      `${path} requires a non-empty ${JSON.stringify(key)} string.`,
      location.path,
      location.line,
      location.column,
      `Set ${key} to the required string value.`,
    ),
  );
  return null;
}

function validateKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  text: string,
  findings: Finding[],
  contract: string,
  scope?: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      const location =
        scope === undefined
          ? keyLocation(path, text, key)
          : keyPathLocation(path, text, `${scope}.${key}`);
      findings.push(
        finding(
          "ATLAS_REALM_UNKNOWN_FIELD",
          `${path} declares unknown ${contract} field ${JSON.stringify(key)}.`,
          location.path,
          location.line,
          location.column,
          `Remove ${key} or move it to a declared Realm extension field.`,
        ),
      );
    }
  }
}

function parseManifest(
  text: string,
  findings: Finding[],
): { readonly manifest: RealmManifest; readonly canonical: string } | null {
  const path = ".atlas/realm/manifest.yaml";
  const value = parseYaml(path, text, findings);
  if (value === null) {
    return null;
  }
  validateKeys(
    value,
    ["schema", "realm", "atlas-schema", "realm-schema"],
    path,
    text,
    findings,
    "Manifest",
  );
  const schema = requiredString(value, "schema", path, text, findings);
  const atlasSchema = requiredString(value, "atlas-schema", path, text, findings);
  const realmSchema = requiredString(value, "realm-schema", path, text, findings);
  const realm = value["realm"];
  if (!isRecord(realm)) {
    const location = keyLocation(path, text, "realm");
    findings.push(
      finding(
        "ATLAS_REALM_REQUIRED_FIELD",
        `${path} requires a realm mapping.`,
        location.path,
        location.line,
        location.column,
        "Add realm.id and realm.title.",
      ),
    );
    return null;
  }
  validateKeys(realm, ["id", "title"], path, text, findings, "Manifest realm", "realm");
  const id = requiredString(realm, "id", path, text, findings);
  const title = requiredString(realm, "title", path, text, findings);
  if (
    schema === null ||
    atlasSchema === null ||
    realmSchema === null ||
    id === null ||
    title === null
  ) {
    return null;
  }
  if (schema !== REALM_MANIFEST_SCHEMA || atlasSchema !== CORE_SCHEMA_VERSION) {
    const location = keyLocation(path, text, "schema");
    findings.push(
      finding(
        "ATLAS_REALM_UNSUPPORTED_SCHEMA",
        `${path} declares an unsupported Atlas contract.`,
        location.path,
        location.line,
        location.column,
        `Use ${REALM_MANIFEST_SCHEMA} with Atlas schema ${CORE_SCHEMA_VERSION}.`,
      ),
    );
    return null;
  }
  return Object.freeze({
    manifest: Object.freeze({
      schema: REALM_MANIFEST_SCHEMA,
      realm: Object.freeze({ id, title }),
      atlasSchema: CORE_SCHEMA_VERSION,
      realmSchema,
    }),
    canonical: canonicalYaml(value),
  });
}

function parseLaws(
  text: string,
  realmSchemaVersion: string | null,
  findings: Finding[],
): string | null {
  const path = ".atlas/realm/laws.md";
  if (!text.startsWith("---\n")) {
    findings.push(
      finding(
        "ATLAS_REALM_FRONTMATTER_REQUIRED",
        `${path} must begin with YAML frontmatter.`,
        path,
        1,
        1,
        "Add the Realm Laws frontmatter contract.",
      ),
    );
    return null;
  }
  const closing = text.indexOf("\n---\n", 4);
  if (closing < 0) {
    findings.push(
      finding(
        "ATLAS_REALM_FRONTMATTER_UNTERMINATED",
        `${path} has unterminated YAML frontmatter.`,
        path,
        1,
        1,
        "Close the frontmatter with --- on its own line.",
      ),
    );
    return null;
  }
  const frontmatter = parseYaml(
    path,
    text.slice(4, closing + 1),
    findings,
    parseDocument,
    1,
  );
  if (frontmatter === null) {
    return null;
  }
  validateKeys(
    frontmatter,
    ["schema", "atlas-schema", "realm-schema", "laws", "approved"],
    path,
    text,
    findings,
    "Realm Laws",
  );
  const schema = requiredString(frontmatter, "schema", path, text, findings);
  const atlasSchema = requiredString(frontmatter, "atlas-schema", path, text, findings);
  const realmSchema = requiredString(frontmatter, "realm-schema", path, text, findings);
  if ([schema, atlasSchema, realmSchema].some((value) => value === null)) {
    return null;
  }
  if (
    ![
      schema === REALM_LAWS_SCHEMA,
      atlasSchema === CORE_SCHEMA_VERSION,
      realmSchemaVersion === null || realmSchema === realmSchemaVersion,
    ].every(Boolean)
  ) {
    findings.push(
      finding(
        "ATLAS_REALM_UNSUPPORTED_SCHEMA",
        `${path} declares an unsupported Realm Laws contract.`,
        path,
        2,
        1,
        `Use ${REALM_LAWS_SCHEMA} with Atlas schema ${CORE_SCHEMA_VERSION}.`,
      ),
    );
    return null;
  }
  const approved = frontmatter["approved"];
  if (
    !Array.isArray(frontmatter["laws"]) ||
    !frontmatter["laws"].every(isRecord) ||
    !isRecord(approved) ||
    !isDateTime(approved["at"]) ||
    !isRecord(approved["by"]) ||
    approved["by"]["kind"] !== "human" ||
    typeof approved["by"]["name"] !== "string" ||
    approved["by"]["name"].length === 0
  ) {
    findings.push(
      finding(
        "ATLAS_REALM_LAWS_FIELDS",
        `${path} requires a laws sequence and approval mapping.`,
        path,
        2,
        1,
        "Declare the reviewed Law set and its approval metadata.",
      ),
    );
    return null;
  }
  validateKeys(approved, ["at", "by"], path, text, findings, "Realm Laws approval");
  validateKeys(
    approved["by"],
    ["kind", "name"],
    path,
    text,
    findings,
    "Realm Laws approval actor",
  );
  const body = text.slice(closing + 5);
  if (!body.startsWith("\n# Realm Laws\n")) {
    findings.push(
      finding(
        "ATLAS_REALM_TITLE_MISMATCH",
        `${path} must begin with '# Realm Laws'.`,
        path,
        text.slice(0, closing + 5).split("\n").length,
        1,
        "Set the first heading to # Realm Laws.",
      ),
    );
  }
  const canonicalBody = body.startsWith("\n") ? body : `\n${body}`;
  return `---\n${canonicalYaml(frontmatter)}---\n${canonicalBody}`;
}

function parseEnvelope(
  path: string,
  text: string,
  atlas: Record<string, unknown>,
  findings: Finding[],
): AtlasEnvelope | null {
  validateKeys(
    atlas,
    [
      "id",
      "type",
      "schema",
      "realm-schema",
      "title",
      "created",
      "updated",
      "tags",
      "originating-operation",
    ],
    path,
    text,
    findings,
    "Atlas envelope",
  );
  const id = requiredString(atlas, "id", path, text, findings);
  const type = requiredString(atlas, "type", path, text, findings);
  const schema = requiredString(atlas, "schema", path, text, findings);
  const realmSchema = requiredString(atlas, "realm-schema", path, text, findings);
  const title = requiredString(atlas, "title", path, text, findings);
  const originatingOperation = atlas["originating-operation"];
  const created = atlas["created"];
  const updated = atlas["updated"];
  const tags = atlas["tags"];
  if (
    id === null ||
    type === null ||
    schema === null ||
    realmSchema === null ||
    title === null
  ) {
    return null;
  }
  if (
    originatingOperation !== undefined &&
    (typeof originatingOperation !== "string" || originatingOperation.length === 0)
  ) {
    const location = keyLocation(path, text, "originating-operation");
    findings.push(
      finding(
        "ATLAS_REALM_INVALID_ENVELOPE",
        `${path} contains invalid originating-operation provenance.`,
        location.path,
        location.line,
        location.column,
        "Use a non-empty originating operation id or remove the optional field.",
      ),
    );
    return null;
  }
  if (!CORE_ARCHETYPES.includes(type as CoreArchetype)) {
    const location = keyLocation(path, text, "type");
    findings.push(
      finding(
        "ATLAS_REALM_UNKNOWN_ARCHETYPE",
        `${path} declares unknown archetype ${JSON.stringify(type)}.`,
        location.path,
        location.line,
        location.column,
        `Use one of: ${CORE_ARCHETYPES.join(", ")}.`,
      ),
    );
    return null;
  }
  if (schema !== CORE_SCHEMA_VERSION) {
    const location = keyLocation(path, text, "schema");
    findings.push(
      finding(
        "ATLAS_REALM_UNSUPPORTED_SCHEMA",
        `${path} declares unsupported Atlas schema ${JSON.stringify(schema)}.`,
        location.path,
        location.line,
        location.column,
        `Use Atlas schema ${CORE_SCHEMA_VERSION}.`,
      ),
    );
    return null;
  }
  if (!isRecord(created) || !isRecord(updated) || !Array.isArray(tags)) {
    findings.push(
      finding(
        "ATLAS_REALM_INVALID_ENVELOPE",
        `${path} requires created, updated, and tags envelope fields.`,
        path,
        2,
        1,
        "Add structured created/updated audit stamps and a tags sequence.",
      ),
    );
    return null;
  }
  const auditLocation = (
    auditKey: "created" | "updated",
    value: Record<string, unknown>,
  ): SourceLocation => {
    const at = value["at"];
    const by = value["by"];
    const invalidKey = !isDateTime(at)
      ? "at"
      : !isRecord(by)
        ? "by"
        : !["human", "agent", "system"].includes(String(by["kind"]))
          ? "by.kind"
          : "by.name";
    return keyPathLocation(path, text, `atlas.${auditKey}.${invalidKey}`);
  };
  const parseAudit = (
    value: Record<string, unknown>,
  ): {
    readonly at: string;
    readonly by: { readonly kind: "human" | "agent" | "system"; readonly name: string };
  } | null => {
    validateKeys(value, ["at", "by"], path, text, findings, "audit stamp");
    const at = value["at"];
    const by = value["by"];
    if (
      !isDateTime(at) ||
      !isRecord(by) ||
      !["human", "agent", "system"].includes(String(by["kind"])) ||
      typeof by["name"] !== "string" ||
      by["name"].length === 0
    ) {
      return null;
    }
    validateKeys(by, ["kind", "name"], path, text, findings, "audit actor");
    return Object.freeze({
      at,
      by: Object.freeze({
        kind: by["kind"] as "human" | "agent" | "system",
        name: by["name"],
      }),
    });
  };
  const createdAudit = parseAudit(created);
  const updatedAudit = parseAudit(updated);
  if (
    createdAudit === null ||
    updatedAudit === null ||
    !tags.every((tag) => typeof tag === "string")
  ) {
    const location =
      createdAudit === null
        ? auditLocation("created", created)
        : updatedAudit === null
          ? auditLocation("updated", updated)
          : keyPathLocation(path, text, "atlas.tags");
    findings.push(
      finding(
        "ATLAS_REALM_INVALID_ENVELOPE",
        `${path} contains an invalid audit stamp or tag.`,
        location.path,
        location.line,
        location.column,
        "Use ISO timestamps, a valid actor kind/name, and string tags.",
      ),
    );
    return null;
  }
  return Object.freeze({
    id,
    type: type as CoreArchetype,
    schema: CORE_SCHEMA_VERSION,
    realmSchema,
    title,
    created: createdAudit,
    updated: updatedAudit,
    tags: Object.freeze([...tags] as string[]),
    ...(originatingOperation === undefined
      ? {}
      : { "originating-operation": originatingOperation }),
  });
}

function parsePage(path: string, text: string, findings: Finding[]): ParsedPage | null {
  if (!text.startsWith("---\n")) {
    findings.push(
      finding(
        "ATLAS_REALM_FRONTMATTER_REQUIRED",
        `${path} must begin with YAML frontmatter.`,
        path,
        1,
        1,
        "Add a leading --- YAML frontmatter block.",
      ),
    );
    return null;
  }
  const closing = text.indexOf("\n---\n", 4);
  if (closing < 0) {
    findings.push(
      finding(
        "ATLAS_REALM_FRONTMATTER_UNTERMINATED",
        `${path} has unterminated YAML frontmatter.`,
        path,
        1,
        1,
        "Close the frontmatter with --- on its own line.",
      ),
    );
    return null;
  }
  const frontmatterText = text.slice(4, closing + 1);
  const frontmatter = parseYaml(path, frontmatterText, findings, parseDocument, 1);
  if (frontmatter === null) {
    return null;
  }
  validateKeys(
    frontmatter,
    ["atlas", "realm"],
    path,
    text,
    findings,
    "page frontmatter",
  );
  const atlas = frontmatter["atlas"];
  const realm = frontmatter["realm"];
  if (!isRecord(atlas) || !isRecord(realm)) {
    findings.push(
      finding(
        "ATLAS_REALM_FRONTMATTER_ENVELOPE",
        `${path} requires atlas and realm frontmatter mappings.`,
        path,
        2,
        1,
        "Add the reserved atlas and realm mappings.",
      ),
    );
    return null;
  }
  const envelope = parseEnvelope(path, text, atlas, findings);
  if (envelope === null) {
    return null;
  }
  const body = text.slice(closing + 5);
  if (!body.startsWith(`\n# ${envelope.title}\n`)) {
    const frontmatterLines = text.slice(0, closing + 5).split("\n").length;
    findings.push(
      finding(
        "ATLAS_REALM_TITLE_MISMATCH",
        `${path} must begin with an H1 matching its Atlas title.`,
        path,
        frontmatterLines,
        1,
        `Set the first heading to # ${envelope.title}.`,
      ),
    );
  }
  const canonicalFrontmatter = canonicalYaml(frontmatter);
  const canonicalBody = body.startsWith("\n") ? body : `\n${body}`;
  return Object.freeze({
    page: Object.freeze({
      path,
      envelope,
      realm: freezeValue(realm) as Readonly<Record<string, unknown>>,
      body,
      location: keyPathLocation(path, text, "realm"),
      sourceLines: Object.freeze(text.split("\n")),
    }),
    canonical: `---\n${canonicalFrontmatter}---\n${canonicalBody}`,
  });
}

function pageLocation(
  page: RealmPage,
  key: string,
  sequenceValue?: string,
): SourceLocation {
  let index = page.sourceLines.findIndex((line) =>
    sequenceValue === undefined
      ? hasYamlKey(line, key)
      : [
          `- ${sequenceValue}`,
          `- ${JSON.stringify(sequenceValue)}`,
          `- '${sequenceValue.replaceAll("'", "''")}'`,
        ].includes(line.trim()),
  );
  if (index < 0 && sequenceValue !== undefined) {
    index = page.sourceLines.findIndex((line) => hasYamlKey(line, key));
  }
  const line = page.sourceLines[index] ?? "";
  return Object.freeze({
    path: page.path,
    line: index < 0 ? 1 : index + 1,
    column: index < 0 ? 1 : Math.max(1, line.indexOf(sequenceValue ?? key) + 1),
  });
}

function realmFieldLocation(page: RealmPage, key: string): SourceLocation {
  const realmIndex = page.sourceLines.findIndex(
    (line) => yamlLineKey(line)?.key === "realm",
  );
  const realmIndent = (
    yamlLineKey(page.sourceLines[realmIndex] as string) as {
      readonly indent: number;
    }
  ).indent;
  const closingIndex = page.sourceLines.findIndex(
    (line, position) => position > realmIndex && line === "---",
  );
  const index = page.sourceLines.findIndex(
    (line, position) =>
      position > realmIndex &&
      position < closingIndex &&
      (line.match(/^\s*/) as RegExpMatchArray)[0].length > realmIndent &&
      hasYamlKey(line, key),
  );
  if (index < 0) {
    return page.location;
  }
  const line = page.sourceLines[index] as string;
  return Object.freeze({
    path: page.path,
    line: index + 1,
    column: line.indexOf(key) + 1,
  });
}

function markdownEvidence(body: string): string {
  const visibleLines: string[] = [];
  let fence: { readonly marker: string; readonly length: number } | null = null;
  let htmlTerminator: string | null = null;
  for (const line of body.split("\n")) {
    const containerContent = line.replace(/^(?: {0,3}> ?)+/, "");
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(containerContent)?.[1];
    const htmlOpening =
      /^ {0,3}<(address|article|aside|base|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul|pre|script|style|textarea)(?:\s|>|$)/i.exec(
        containerContent,
      )?.[1];
    if (fence !== null) {
      const closing = /^ {0,3}(`+|~+)\s*$/.exec(containerContent)?.[1];
      if (
        closing !== undefined &&
        closing[0] === fence.marker &&
        closing.length >= fence.length
      ) {
        fence = null;
      }
      visibleLines.push("");
      continue;
    }
    if (htmlTerminator !== null) {
      if (containerContent.toLowerCase().includes(htmlTerminator)) {
        htmlTerminator = null;
      }
      visibleLines.push("");
      continue;
    }
    const specialTerminator = containerContent.trimStart().startsWith("<![CDATA[")
      ? "]]>"
      : containerContent.trimStart().startsWith("<?")
        ? "?>"
        : /^ {0,3}<![A-Z]/.test(containerContent)
          ? ">"
          : null;
    if (specialTerminator !== null) {
      if (!containerContent.includes(specialTerminator)) {
        htmlTerminator = specialTerminator;
      }
      visibleLines.push("");
      continue;
    }
    if (htmlOpening !== undefined) {
      const terminator = `</${htmlOpening.toLowerCase()}>`;
      if (!containerContent.toLowerCase().includes(terminator)) {
        htmlTerminator = terminator;
      }
      visibleLines.push("");
      continue;
    }
    if (marker !== undefined) {
      fence = { marker: marker[0] as string, length: marker.length };
      visibleLines.push("");
    } else if (/^(?: {4}|\t)/.test(containerContent)) {
      visibleLines.push("");
    } else {
      visibleLines.push(line);
    }
  }
  return visibleLines
    .join("\n")
    .replace(/<!--[\s\S]*(?:-->|$)/g, "")
    .replace(/\]\([^)\n]*\)/g, "]")
    .replace(/<[^>\n]*>/g, "")
    .replace(/(`+)[\s\S]*?\1/g, "");
}

function validatePages(
  pages: readonly RealmPage[],
  realmSchemaVersion: string | null,
  relationshipTypes: ReadonlySet<string>,
  realmSchemaValidator: ValidateFunction | null,
  findings: Finding[],
): void {
  const ids = new Map<string, RealmPage>();
  const paths = new Map<string, RealmPage>();
  for (const page of pages) {
    paths.set(page.path, page);
    if (
      realmSchemaVersion !== null &&
      page.envelope.realmSchema !== realmSchemaVersion
    ) {
      const location = pageLocation(page, "realm-schema");
      findings.push(
        finding(
          "ATLAS_REALM_SCHEMA_MISMATCH",
          `${page.path} declares Realm Schema ${JSON.stringify(page.envelope.realmSchema)} instead of ${JSON.stringify(realmSchemaVersion)}.`,
          location.path,
          location.line,
          location.column,
          `Set realm-schema to ${realmSchemaVersion}.`,
        ),
      );
    }
    let validShape: boolean;
    let coreFields: readonly string[];
    switch (page.envelope.type) {
      case "bonfire":
        coreFields = ["root", "catalog"];
        validShape = [
          typeof page.realm["root"] === "boolean",
          Array.isArray(page.realm["catalog"]) &&
            page.realm["catalog"].every((id) => typeof id === "string"),
        ].every(Boolean);
        break;
      case "insight":
        coreFields = ["heresy"];
        validShape = typeof page.realm["heresy"] === "boolean";
        break;
      case "lore":
        coreFields = ["source", "authority", "gathered-at", "refresh-after"];
        validShape = [
          isRecord(page.realm["source"]) &&
            typeof page.realm["source"]["kind"] === "string" &&
            page.realm["source"]["kind"].length > 0,
          typeof page.realm["authority"] === "string" &&
            page.realm["authority"].length > 0,
          isDateTime(page.realm["gathered-at"]),
          isDateTime(page.realm["refresh-after"]),
        ].every(Boolean);
        break;
      case "pillar":
        coreFields = ["approved"];
        validShape = typeof page.realm["approved"] === "boolean";
        break;
      case "thread":
        coreFields = ["endpoints", "relationships"];
        validShape =
          Array.isArray(page.realm["relationships"]) &&
          page.realm["relationships"].length > 0 &&
          page.realm["relationships"].every(
            (relationship) =>
              typeof relationship === "string" && relationship.length > 0,
          );
        break;
    }
    const extension = Object.fromEntries(
      Object.entries(page.realm).filter(([key]) => !coreFields.includes(key)),
    );
    if (realmSchemaValidator !== null && !realmSchemaValidator(extension)) {
      const errors = realmSchemaValidator.errors as NonNullable<
        ValidateFunction["errors"]
      >;
      for (const error of errors) {
        const parameters = error.params as Record<string, unknown>;
        const missingProperty = parameters["missingProperty"];
        const additionalProperty = parameters["additionalProperty"];
        const key =
          typeof missingProperty === "string"
            ? missingProperty
            : typeof additionalProperty === "string"
              ? additionalProperty
              : error.instancePath.split("/").filter(Boolean)[0];
        const location =
          key === undefined ? page.location : realmFieldLocation(page, key);
        findings.push(
          finding(
            "ATLAS_REALM_SCHEMA_VALIDATION",
            `${page.path} Realm extension ${error.instancePath || "/"} ${String(error.message)}.`,
            location.path,
            location.line,
            location.column,
            "Make the Realm extension data satisfy the active Realm Schema.",
          ),
        );
      }
    }
    if (!validShape) {
      const location = pageLocation(page, "realm");
      findings.push(
        finding(
          "ATLAS_REALM_ARCHETYPE_FIELDS",
          `${page.path} does not satisfy the ${page.envelope.type} core schema.`,
          location.path,
          location.line,
          location.column,
          `Add the required ${page.envelope.type} Realm fields.`,
        ),
      );
    }
    const previous = ids.get(page.envelope.id);
    if (previous !== undefined) {
      const location = pageLocation(page, "id");
      findings.push(
        finding(
          "ATLAS_REALM_DUPLICATE_ID",
          `${page.path} repeats stable id ${JSON.stringify(page.envelope.id)} from ${previous.path}.`,
          location.path,
          location.line,
          location.column,
          "Assign a unique stable id within this Realm snapshot.",
        ),
      );
    } else {
      ids.set(page.envelope.id, page);
    }
  }
  const root = pages.find((page) => page.path === ".atlas/index.md");
  if (root !== undefined) {
    if (root.envelope.type !== "bonfire" || root.realm["root"] !== true) {
      const location = pageLocation(
        root,
        root.envelope.type !== "bonfire" ? "type" : "root",
      );
      findings.push(
        finding(
          "ATLAS_REALM_ROOT_NOT_BONFIRE",
          ".atlas/index.md must be the active Root Bonfire.",
          location.path,
          location.line,
          location.column,
          "Set the Root Bonfire type to bonfire and realm.root to true.",
        ),
      );
    }
    const catalog = root.realm["catalog"];
    if (Array.isArray(catalog)) {
      for (const id of catalog.filter(
        (value): value is string => typeof value === "string",
      )) {
        if (!ids.has(id)) {
          const location = pageLocation(root, "catalog", id);
          findings.push(
            finding(
              "ATLAS_REALM_CATALOG_TARGET_MISSING",
              `${root.path} catalogs missing object ${JSON.stringify(id)}.`,
              location.path,
              location.line,
              location.column,
              "Remove the stale catalog entry or add the referenced Realm object.",
            ),
          );
        }
      }
      for (const extraRoot of pages.filter(
        (page) => page.path !== root.path && page.realm["root"] === true,
      )) {
        const location = pageLocation(extraRoot, "root");
        findings.push(
          finding(
            "ATLAS_REALM_MULTIPLE_ROOTS",
            `${extraRoot.path} declares a second Root Bonfire.`,
            location.path,
            location.line,
            location.column,
            "Keep .atlas/index.md as the only page with realm.root set to true.",
          ),
        );
      }
    }
  }
  const threadEndpoints = new Set<string>();
  const endpointPairs = new Map<string, RealmPage>();
  for (const page of pages.filter(
    (candidate) => candidate.envelope.type === "thread",
  )) {
    const relationships = page.realm["relationships"];
    if (Array.isArray(relationships)) {
      for (const relationship of relationships.filter(
        (value): value is string => typeof value === "string",
      )) {
        if (!relationshipTypes.has(relationship)) {
          const location = pageLocation(page, "relationships", relationship);
          findings.push(
            finding(
              "ATLAS_REALM_RELATIONSHIP_UNKNOWN",
              `${page.path} declares unknown relationship ${JSON.stringify(relationship)}.`,
              location.path,
              location.line,
              location.column,
              "Use an Atlas core or declared Realm relationship type.",
            ),
          );
        }
      }
    }
    const endpoints = page.realm["endpoints"];
    if (
      !Array.isArray(endpoints) ||
      endpoints.length !== 2 ||
      !endpoints.every((endpoint) => typeof endpoint === "string") ||
      new Set(endpoints).size !== 2
    ) {
      const location = pageLocation(page, "endpoints");
      findings.push(
        finding(
          "ATLAS_REALM_THREAD_ENDPOINTS",
          `${page.path} must declare exactly two endpoint ids.`,
          location.path,
          location.line,
          location.column,
          "Set realm.endpoints to two existing Realm object ids.",
        ),
      );
      continue;
    }
    const pair = [...endpoints].sort(compareText).join("\0");
    const previousPair = endpointPairs.get(pair);
    if (previousPair !== undefined) {
      const location = pageLocation(page, "endpoints", endpoints[0]);
      findings.push(
        finding(
          "ATLAS_REALM_THREAD_PAIR_DUPLICATE",
          `${page.path} duplicates the unordered endpoint pair from ${previousPair.path}.`,
          location.path,
          location.line,
          location.column,
          "Keep at most one Thread for each unordered in-Realm page pair.",
        ),
      );
    } else {
      endpointPairs.set(pair, page);
    }
    for (const endpoint of endpoints) {
      threadEndpoints.add(endpoint);
      const location = pageLocation(page, "endpoints", endpoint);
      const target = ids.get(endpoint);
      if (target === undefined) {
        findings.push(
          finding(
            "ATLAS_REALM_THREAD_TARGET_MISSING",
            `${page.path} references missing endpoint ${JSON.stringify(endpoint)}.`,
            location.path,
            location.line,
            location.column,
            "Reference an existing Realm object id.",
          ),
        );
      } else if (target.envelope.type === "lore" || target.envelope.type === "thread") {
        findings.push(
          finding(
            "ATLAS_REALM_THREAD_ENDPOINT_TYPE",
            `${page.path} cannot connect to ${target.envelope.type} endpoint ${JSON.stringify(endpoint)}.`,
            location.path,
            location.line,
            location.column,
            "Connect Threads only among Bonfires, Insights, Pillars, or valid extensions.",
          ),
        );
      }
    }
  }
  for (const insight of pages.filter(
    (candidate) => candidate.envelope.type === "insight",
  )) {
    if (!threadEndpoints.has(insight.envelope.id)) {
      const location = pageLocation(insight, "id");
      findings.push(
        finding(
          "ATLAS_REALM_INSIGHT_ORPHAN",
          `${insight.path} has no Thread.`,
          location.path,
          location.line,
          location.column,
          "Connect every Insight through at least one Thread.",
        ),
      );
    }
  }
  if (root !== undefined) {
    const adjacent = new Map<string, Set<string>>();
    const connect = (left: string, right: string): void => {
      const neighbors = adjacent.get(left) ?? new Set<string>();
      neighbors.add(right);
      adjacent.set(left, neighbors);
    };
    const catalog = root.realm["catalog"];
    if (Array.isArray(catalog)) {
      for (const id of catalog.filter(
        (value): value is string => typeof value === "string",
      )) {
        connect(root.envelope.id, id);
      }
    }
    for (const thread of pages.filter(
      (candidate) => candidate.envelope.type === "thread",
    )) {
      const endpoints = thread.realm["endpoints"];
      if (
        Array.isArray(endpoints) &&
        endpoints.length === 2 &&
        endpoints.every((endpoint) => typeof endpoint === "string")
      ) {
        connect(endpoints[0] as string, endpoints[1] as string);
        connect(endpoints[1] as string, endpoints[0] as string);
      }
    }
    const reachable = new Set<string>();
    const pending = [root.envelope.id];
    while (pending.length > 0) {
      const id = pending.pop() as string;
      if (reachable.has(id)) {
        continue;
      }
      reachable.add(id);
      for (const neighbor of adjacent.get(id) ?? []) {
        pending.push(neighbor);
      }
    }
    for (const page of pages.filter((candidate) =>
      ["bonfire", "insight", "pillar"].includes(candidate.envelope.type),
    )) {
      if (!reachable.has(page.envelope.id)) {
        const location = pageLocation(page, "id");
        findings.push(
          finding(
            "ATLAS_REALM_OBJECT_UNREACHABLE",
            `${page.path} is not reachable from the Root Bonfire.`,
            location.path,
            location.line,
            location.column,
            "Catalog the object or connect it to the Root Bonfire through Threads.",
          ),
        );
      }
    }
  }
  for (const page of pages.filter((candidate) =>
    ["bonfire", "insight", "thread"].includes(candidate.envelope.type),
  )) {
    const evidence = markdownEvidence(page.body);
    const references = Array.from(
      evidence.matchAll(/\[\^([^\]\n]+)\](?!:)/g),
      (match) => match[1] as string,
    );
    const definitions = new Map(
      Array.from(
        evidence.matchAll(/^\[\^([^\]\n]+)\]:\s+\[\[([^\]#\n]+)(?:#[^\]\n]*)?\]\]/gm),
        (match) => [match[1] as string, match[2] as string] as const,
      ),
    );
    if (references.length === 0) {
      const location = pageLocation(page, "title");
      findings.push(
        finding(
          "ATLAS_REALM_CITATION_REQUIRED",
          `${page.path} requires at least one Realm-local Lore Citation.`,
          location.path,
          location.line,
          location.column,
          "Cite the supporting Realm-local Lore with a Markdown footnote.",
        ),
      );
    }
    for (const reference of references) {
      const link = definitions.get(reference);
      const lineIndex = page.sourceLines.findIndex((line) =>
        line.includes(`[^${reference}]`),
      );
      const line = page.sourceLines[lineIndex] as string;
      const location = Object.freeze({
        path: page.path,
        line: lineIndex + 1,
        column: Math.max(1, line.indexOf(`[^${reference}]`) + 1),
      });
      if (link === undefined) {
        findings.push(
          finding(
            "ATLAS_REALM_CITATION_DEFINITION_MISSING",
            `${page.path} references undefined Citation ${JSON.stringify(reference)}.`,
            location.path,
            location.line,
            location.column,
            "Add a footnote definition that links to Realm-local Lore.",
          ),
        );
      } else {
        const target = paths.get(`.atlas/${link}.md`);
        if (target?.envelope.type !== "lore") {
          findings.push(
            finding(
              "ATLAS_REALM_CITATION_TARGET_INVALID",
              `${page.path} Citation ${JSON.stringify(reference)} does not resolve to Realm-local Lore.`,
              location.path,
              location.line,
              location.column,
              "Link the Citation definition to an existing Lore page.",
            ),
          );
        }
      }
    }
  }
}

export function loadRealm(
  inputFiles: readonly SourceFile[],
  combineDigest: (files: readonly SourceFile[]) => string,
): RealmLoadResult {
  const findings: Finding[] = [];
  const files = [...inputFiles].sort((left, right) =>
    compareText(left.path, right.path),
  );
  const duplicatePaths = files.filter(
    (file, index) => index > 0 && file.path === files[index - 1]?.path,
  );
  for (const file of duplicatePaths) {
    findings.push(
      finding(
        "ATLAS_REALM_DUPLICATE_PATH",
        `Realm input repeats ${file.path}.`,
        file.path,
        1,
        1,
        "Supply each Realm-relative path exactly once.",
      ),
    );
  }
  const fileMap = new Map(files.map((file) => [file.path, file]));
  for (const requiredPath of REQUIRED_PATHS) {
    if (!fileMap.has(requiredPath)) {
      findings.push(
        finding(
          "ATLAS_REALM_REQUIRED_FILE",
          `Realm is missing ${requiredPath}.`,
          requiredPath,
          1,
          1,
          `Create ${requiredPath} using the current Realm schema.`,
        ),
      );
    }
  }
  const digest = combineDigest(files);
  const texts = new Map<string, string>();
  for (const file of files) {
    const text = decodeFile(file, findings);
    if (text !== null) {
      texts.set(file.path, text);
    }
  }
  const manifestText = texts.get(".atlas/realm/manifest.yaml");
  const parsedManifest =
    manifestText === undefined ? null : parseManifest(manifestText, findings);
  const canonicalFiles = new Map<string, Uint8Array>();
  if (parsedManifest !== null) {
    canonicalFiles.set(
      ".atlas/realm/manifest.yaml",
      encoder.encode(parsedManifest.canonical),
    );
    for (const requiredPath of [
      `.atlas/realm/schemas/${parsedManifest.manifest.realmSchema}/relationships.yaml`,
      `.atlas/realm/schemas/${parsedManifest.manifest.realmSchema}/schema.json`,
    ]) {
      if (!fileMap.has(requiredPath)) {
        findings.push(
          finding(
            "ATLAS_REALM_REQUIRED_FILE",
            `Realm is missing ${requiredPath}.`,
            requiredPath,
            1,
            1,
            `Add the complete ${parsedManifest.manifest.realmSchema} Realm Schema bundle.`,
          ),
        );
      }
    }
  }
  const lawsText = texts.get(".atlas/realm/laws.md");
  if (lawsText !== undefined) {
    const canonicalLaws = parseLaws(
      lawsText,
      parsedManifest?.manifest.realmSchema ?? null,
      findings,
    );
    if (canonicalLaws !== null) {
      canonicalFiles.set(".atlas/realm/laws.md", encoder.encode(canonicalLaws));
    }
  }
  const pages: RealmPage[] = [];
  for (const [path, text] of texts) {
    if (
      !path.endsWith(".md") ||
      path === ".atlas/realm/laws.md" ||
      path === ".atlas/realm/schemas/CHANGELOG.md"
    ) {
      continue;
    }
    const parsed = parsePage(path, text, findings);
    if (parsed !== null) {
      pages.push(parsed.page);
      canonicalFiles.set(path, encoder.encode(parsed.canonical));
    }
  }
  const parsedYamlFiles = new Map<string, Record<string, unknown>>();
  const parsedJsonFiles = new Map<string, unknown>();
  for (const [path, text] of texts) {
    if (canonicalFiles.has(path)) {
      continue;
    }
    if (path.endsWith(".yaml")) {
      const value = parseYaml(path, text, findings);
      if (value !== null) {
        parsedYamlFiles.set(path, value);
        canonicalFiles.set(path, encoder.encode(canonicalYaml(value)));
      }
    } else if (path.endsWith(".json")) {
      try {
        const value = JSON.parse(text) as unknown;
        parsedJsonFiles.set(path, value);
        canonicalFiles.set(
          path,
          encoder.encode(`${JSON.stringify(canonicalJsonValue(value), null, 2)}\n`),
        );
      } catch (error) {
        findings.push(
          finding(
            "ATLAS_REALM_JSON_SYNTAX",
            `${path} contains invalid JSON: ${String(error)}`,
            path,
            1,
            1,
            "Correct the JSON syntax.",
          ),
        );
      }
    } else {
      canonicalFiles.set(path, encoder.encode(text));
    }
  }
  const relationshipTypes = new Set<string>(CORE_RELATIONSHIP_TYPES);
  let realmSchemaValidator: ValidateFunction | null = null;
  if (parsedManifest !== null) {
    const schemaPath = `.atlas/realm/schemas/${parsedManifest.manifest.realmSchema}/schema.json`;
    const schema = parsedJsonFiles.get(schemaPath);
    if (schema !== undefined) {
      const schemaInvalid =
        !isRecord(schema) ||
        typeof schema["$schema"] !== "string" ||
        typeof schema["$id"] !== "string" ||
        schema["$async"] !== undefined ||
        schema["type"] !== "object" ||
        !isRecord(schema["properties"]) ||
        schema["additionalProperties"] !== false ||
        containsUnsafeSchemaRegex(schema);
      if (schemaInvalid) {
        findings.push(
          finding(
            "ATLAS_REALM_SCHEMA_ARTIFACT_INVALID",
            `${schemaPath} is not a supported Realm extension schema.`,
            schemaPath,
            1,
            1,
            "Provide a closed JSON Schema object with identity and properties.",
          ),
        );
      } else {
        try {
          realmSchemaValidator = new Ajv2020({
            allErrors: true,
            strict: true,
          }).compile(schema);
        } catch (error) {
          findings.push(
            finding(
              "ATLAS_REALM_SCHEMA_ARTIFACT_INVALID",
              `${schemaPath} cannot be compiled: ${String(error)}`,
              schemaPath,
              1,
              1,
              "Correct the Realm extension JSON Schema.",
            ),
          );
        }
      }
    }
    const relationshipsPath = `.atlas/realm/schemas/${parsedManifest.manifest.realmSchema}/relationships.yaml`;
    const registry = parsedYamlFiles.get(relationshipsPath);
    if (registry !== undefined) {
      const relationships = registry["relationships"];
      if (!Array.isArray(relationships)) {
        findings.push(
          finding(
            "ATLAS_REALM_RELATIONSHIP_REGISTRY_INVALID",
            `${relationshipsPath} must declare a relationships sequence.`,
            relationshipsPath,
            1,
            1,
            "Declare Realm relationship descriptors under relationships.",
          ),
        );
      } else {
        for (const relationship of relationships) {
          const id =
            typeof relationship === "string"
              ? relationship
              : isRecord(relationship) && typeof relationship["id"] === "string"
                ? relationship["id"]
                : null;
          if (id === null) {
            findings.push(
              finding(
                "ATLAS_REALM_RELATIONSHIP_REGISTRY_INVALID",
                `${relationshipsPath} contains a relationship without a stable id.`,
                relationshipsPath,
                1,
                1,
                "Give every Realm relationship descriptor a string id.",
              ),
            );
          } else {
            relationshipTypes.add(id);
          }
        }
      }
    }
  }
  validatePages(
    pages,
    parsedManifest?.manifest.realmSchema ?? null,
    relationshipTypes,
    realmSchemaValidator,
    findings,
  );
  for (const file of files) {
    const canonical = canonicalFiles.get(file.path);
    if (canonical !== undefined && decoder.decode(canonical) !== texts.get(file.path)) {
      findings.push(
        finding(
          "ATLAS_REALM_NON_CANONICAL",
          `${file.path} is valid but not canonically serialized.`,
          file.path,
          1,
          1,
          "Rewrite the file using Atlas canonical serialization.",
        ),
      );
    }
  }
  findings.sort(compareFindings);
  if (findings.some((item) => item.severity === "error") || parsedManifest === null) {
    return Object.freeze({
      valid: false,
      manifest: parsedManifest?.manifest ?? null,
      findings: Object.freeze(findings),
      digest,
    });
  }
  const view: RealmView = Object.freeze({
    manifest: parsedManifest.manifest,
    pages: Object.freeze(pages),
    files: Object.freeze(
      files.map((file) =>
        Object.freeze({
          path: file.path,
          digest: combineDigest([file]),
          bytes: file.bytes.byteLength,
        }),
      ),
    ),
    canonicalFiles: Object.freeze(
      [...canonicalFiles]
        .sort(([left], [right]) => compareText(left, right))
        .map(([path, bytes]) => Object.freeze({ path, text: decoder.decode(bytes) })),
    ),
    digest,
  });
  return Object.freeze({
    valid: true,
    view,
    findings: Object.freeze(findings),
  });
}
