import { Type, type TSchema } from "@sinclair/typebox";
import { containsLineBreak, lineBreakCharacters } from "../domain/atlas_changelog.ts";

const invalidInput = Symbol("invalid input");

export interface InputIssue {
  readonly message: string;
  readonly path: string;
  readonly rule: "invalid" | "required" | "forbidden";
}

export interface InputField<Value> {
  readonly schema: TSchema;
  readonly read: (
    value: unknown,
    path: string,
    issues: InputIssue[],
  ) => Value | typeof invalidInput;
}

function freeze<Value>(value: Value): Value {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value as Readonly<Record<string, unknown>>)) {
      freeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function field<Value>(
  schema: TSchema,
  read: InputField<Value>["read"],
): InputField<Value> {
  return Object.freeze({ read, schema: freeze(schema) });
}

function reject(
  issues: InputIssue[],
  path: string,
  message: string,
  rule: InputIssue["rule"] = "invalid",
): typeof invalidInput {
  issues.push(Object.freeze({ message: `${path} ${message}`, path, rule }));
  return invalidInput;
}

interface TextInputOptions {
  readonly maxBytes?: number;
  readonly singleLine?: true;
}

function textSchemaOptions(
  options: TextInputOptions,
): Readonly<Record<string, unknown>> {
  const breaks = lineBreakCharacters.replace(
    /[\s\S]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return {
    ...(options.maxBytes === undefined ? {} : { "x-maxUtf8Bytes": options.maxBytes }),
    ...(options.singleLine === true ? { pattern: `^[^${breaks}]*(?![\\s\\S])` } : {}),
  };
}

export function textInput(options: TextInputOptions = {}): InputField<string> {
  options = Object.freeze({ ...options });
  return field(Type.String(textSchemaOptions(options)), (value, path, issues) => {
    if (typeof value !== "string") {
      return reject(issues, path, "must be a string");
    }
    let valid = true;
    if (
      options.maxBytes !== undefined &&
      new TextEncoder().encode(value).length > options.maxBytes
    ) {
      reject(issues, path, `exceeds the ${String(options.maxBytes)} byte budget`);
      valid = false;
    }
    if (options.singleLine === true && containsLineBreak(value)) {
      reject(issues, path, "must be a single line");
      valid = false;
    }
    return valid ? value : invalidInput;
  });
}

export function numberInput(): InputField<number> {
  return field(Type.Number(), (value, path, issues) =>
    typeof value === "number" && Number.isFinite(value)
      ? value
      : reject(issues, path, "must be a finite number"),
  );
}

export function literalInput<const Value extends string>(
  expected: Value,
  options: TextInputOptions = {},
): InputField<Value> {
  options = Object.freeze({ ...options });
  const text = textInput(options);
  return field(
    Type.Literal(expected, textSchemaOptions(options)),
    (value, path, issues) => {
      const parsed = text.read(value, path, issues);
      if (parsed === invalidInput) return invalidInput;
      return parsed === expected
        ? expected
        : reject(issues, path, `must be ${JSON.stringify(expected)}`);
    },
  );
}

export function enumInput<const Values extends Readonly<Record<string, true>>>(
  values: Values,
  expectation: string,
  options: TextInputOptions = {},
): InputField<keyof Values & string> {
  options = Object.freeze({ ...options });
  const names = Object.keys(values);
  const allowed = new Set(names);
  const text = textInput(options);
  return field(
    Type.Union(
      names.map((name) => Type.Literal(name)),
      textSchemaOptions(options),
    ),
    (value, path, issues) => {
      const parsed = text.read(value, path, issues);
      if (parsed === invalidInput) return invalidInput;
      return allowed.has(parsed) ? parsed : reject(issues, path, expectation);
    },
  );
}

export function optionalInput<Value>(
  input: InputField<Value>,
): InputField<Value | undefined> {
  return field(Type.Optional(input.schema), (value, path, issues) =>
    value === undefined ? undefined : input.read(value, path, issues),
  );
}

export function nullableInput<Value>(
  input: InputField<Value>,
): InputField<Value | null> {
  return field(Type.Union([input.schema, Type.Null()]), (value, path, issues) =>
    value === null ? null : input.read(value, path, issues),
  );
}

export function arrayInput<Value>(
  input: InputField<Value>,
  budget?: { readonly maxItems: number; readonly name: string },
): InputField<readonly Value[]> {
  budget = budget === undefined ? undefined : Object.freeze({ ...budget });
  const schema = Type.Array(
    input.schema,
    budget === undefined ? {} : { maxItems: budget.maxItems },
  );
  return field(schema, (value, path, issues) => {
    if (!Array.isArray(value)) {
      return reject(issues, path, "must be an array");
    }
    if (budget !== undefined && value.length > budget.maxItems) {
      return reject(
        issues,
        path,
        `exceeds the ${String(budget.maxItems)} ${budget.name} budget`,
      );
    }
    const values: Value[] = [];
    const groups = new Map<
      string,
      {
        readonly suffix: string;
        readonly detail: string;
        readonly rule: InputIssue["rule"];
        readonly indices: ArrayIndexSet;
      }
    >();
    let valid = true;
    for (let index = 0; index < value.length; index += 1) {
      const itemPath = `${path}[${String(index)}]`;
      const itemIssues: InputIssue[] = [];
      const parsed = input.read(value[index], itemPath, itemIssues);
      if (parsed === invalidInput) valid = false;
      else values.push(parsed);
      for (const issue of itemIssues) {
        const suffix = issue.path.slice(itemPath.length);
        const detail = issue.message.slice(issue.path.length);
        const key = JSON.stringify([suffix, detail, issue.rule]);
        const group = groups.get(key);
        if (group === undefined) {
          groups.set(key, {
            suffix,
            detail,
            rule: issue.rule,
            indices: new ArrayIndexSet(index),
          });
        } else {
          group.indices.add(index);
        }
      }
    }
    for (const group of groups.values()) {
      const indices = group.indices.format();
      const groupedPath = `${path}[${indices}]${group.suffix}`;
      issues.push(
        Object.freeze({
          path: groupedPath,
          message: `${groupedPath}${group.detail}`,
          rule: group.rule,
        }),
      );
    }
    return valid ? Object.freeze(values) : invalidInput;
  });
}

function indexRange(start: number, end: number): string {
  return start === end ? String(start) : `${String(start)}..${String(end)}`;
}

class ArrayIndexSet {
  readonly #bytes = new Map<number, number>();
  readonly #first: number;
  #last: number;

  constructor(index: number) {
    this.#first = index;
    this.#last = index;
    this.add(index);
  }

  add(index: number): void {
    const byte = Math.floor(index / 8);
    this.#bytes.set(byte, (this.#bytes.get(byte) ?? 0) | (2 ** (index % 8)));
    this.#last = index;
  }

  format(): string {
    let start = this.#first;
    let end = start;
    const ranges: string[] = [];
    // Indices arrive in array order, so sparse byte keys retain that order.
    for (const [byte, bits] of this.#bytes) {
      for (let bit = 0; bit < 8; bit += 1) {
        const index = byte * 8 + bit;
        if ((bits & (2 ** bit)) === 0 || index === this.#first) continue;
        if (index !== end + 1) {
          ranges.push(indexRange(start, end));
          start = index;
        }
        end = index;
      }
    }
    ranges.push(indexRange(start, end));
    const text = ranges.join(",");
    const firstByte = Math.floor(this.#first / 8);
    const lastByte = Math.floor(this.#last / 8);
    const prefix = `mask@${String(firstByte * 8)}:`;
    if (prefix.length + (lastByte - firstByte + 1) * 2 >= text.length) return text;
    const hex: string[] = [];
    for (let byte = firstByte; byte <= lastByte; byte += 1) {
      hex.push((this.#bytes.get(byte) ?? 0).toString(16).padStart(2, "0"));
    }
    return prefix + hex.join("");
  }
}

interface InputRule<Value> {
  readonly property: keyof Value & string;
  readonly values: readonly string[];
  readonly field: keyof Value & string;
  readonly presence: "required" | "forbidden";
  readonly message: string;
}

export function objectInput<Value extends object>(
  inputs: { readonly [Key in Extract<keyof Value, string>]-?: InputField<Value[Key]> },
  conditions: readonly InputRule<Value>[] = [],
): InputField<Value> {
  const entries = Object.entries(inputs) as [
    keyof Value & string,
    InputField<Value[keyof Value]>,
  ][];
  const rules = conditions.map((condition) =>
    freeze({
      ...condition,
      values: [...condition.values],
    }),
  );
  const schema = Type.Object(
    Object.fromEntries(entries.map(([key, input]) => [key, input.schema])),
    {
      additionalProperties: true,
      ...(rules.length === 0
        ? {}
        : {
            allOf: rules.map((rule) => {
              const present = {
                type: "object",
                properties: { [rule.field]: {} },
                required: [rule.field],
              };
              return {
                if: {
                  type: "object",
                  properties: { [rule.property]: { enum: rule.values } },
                  required: [rule.property],
                },
                then: rule.presence === "required" ? present : { not: present },
              };
            }),
          }),
    },
  );
  return field(schema, (value, path, issues) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return reject(issues, path, "must be an object");
    }
    const record = value as Readonly<Record<string, unknown>>;
    const values = new Map(entries.map(([key]) => [key, record[key]]));
    const activeRules = rules.filter((rule) => {
      const discriminator = values.get(rule.property);
      return typeof discriminator === "string" && rule.values.includes(discriminator);
    });
    const parsed: [string, unknown][] = [];
    let valid = true;
    for (const [key, input] of entries) {
      const raw = values.get(key);
      const itemPath = `${path}.${key}`;
      const violated = activeRules.find(
        (rule) =>
          rule.field === key &&
          (rule.presence === "required" ? raw === undefined : raw !== undefined),
      );
      if (violated !== undefined) {
        reject(issues, itemPath, violated.message, violated.presence);
        valid = false;
        continue;
      }
      const item = input.read(raw, itemPath, issues);
      if (item === invalidInput) valid = false;
      else if (item !== undefined) parsed.push([key, item]);
    }
    // Each declared field was decoded above; optional undefined fields are omitted.
    return valid ? (Object.freeze(Object.fromEntries(parsed)) as Value) : invalidInput;
  });
}

export function readInput<Value>(
  input: InputField<Value>,
  value: unknown,
  path: string,
):
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly issues: readonly InputIssue[] } {
  const issues: InputIssue[] = [];
  const parsed = input.read(value, path, issues);
  return parsed === invalidInput
    ? { issues: Object.freeze(issues), ok: false }
    : { ok: true, value: parsed };
}
