import type { Finding } from "../domain/finding.ts";

export type SourceLocation = NonNullable<Finding["location"]>;

export function positionAt(content: string, offset: number): SourceLocation["start"] {
  const before = content.slice(0, offset);
  const lines = before.split(/\r?\n/u);
  return {
    column: (lines.at(-1) as string).length + 1,
    line: lines.length,
  };
}

export function rangeAt(content: string, start: number, end: number): SourceLocation {
  return { end: positionAt(content, end), start: positionAt(content, start) };
}
