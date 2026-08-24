import assert from "node:assert/strict";
import test from "node:test";
import {
  atlasPrincipleActiveTruthIds,
  extractAtlasPrincipleActiveTruths,
  malformedAtlasPrincipleTruthLines,
} from "../src/domain/atlas_principle.ts";

function principleBody(activeTruthsHeading: string, truthLine: string): string {
  return [
    "# Determinism",
    "",
    activeTruthsHeading,
    "",
    truthLine,
    "",
    "## Amendments",
    "",
    "### 1 - 2026-08-24",
    "",
    "Recorded the truth under Maintainer approval.",
  ].join("\n");
}

test("Principle active truth extraction recognizes one canonical block shape", () => {
  const parsed = extractAtlasPrincipleActiveTruths(
    [
      "# Determinism",
      "",
      "## Active truths",
      "",
      "- `truth:one` Use deterministic routing",
      "  with wrapped continuation.",
      "not a continuation",
      "- `truth:two` Preserve cited evidence.",
      "",
      "## Amendments",
    ].join("\n"),
  );
  assert.deepEqual(parsed, [
    {
      text: "Use deterministic routing with wrapped continuation.",
      truthId: "truth:one",
    },
    { text: "Preserve cited evidence.", truthId: "truth:two" },
  ]);
  assert.deepEqual(atlasPrincipleActiveTruthIds("## Active truths\n\n- `truth:x` X"), [
    "truth:x",
  ]);
});

test("Principle active truth extraction reports drift instead of normalizing it", () => {
  for (const [name, body, line] of [
    [
      "trailing-whitespace heading",
      principleBody("## Active truths ", "- `truth:one` Text."),
      5,
    ],
    ["H3 heading", principleBody("### Active truths", "- `truth:one` Text."), 5],
    [
      "case-changed heading",
      principleBody("## Active Truths", "- `truth:one` Text."),
      5,
    ],
    ["indented bullet", principleBody("## Active truths", "  - `truth:one` Text."), 5],
    [
      "tab-indented bullet",
      principleBody("## Active truths", "\t- `truth:one` Text."),
      5,
    ],
    ["missing same-line text", principleBody("## Active truths", "- `truth:one`"), 5],
    ["empty truth identity", principleBody("## Active truths", "- `` Text."), 5],
    [
      "after active block",
      "# Determinism\n\n## Active truths\n\n## Amendments\n\n- `truth:late` Text.",
      7,
    ],
  ] as const) {
    assert.deepEqual(extractAtlasPrincipleActiveTruths(body), [], name);
    assert.deepEqual(malformedAtlasPrincipleTruthLines(body), [{ line }], name);
  }

  const mixed =
    "# Determinism\n\n## Active truths\n\n- `truth:ok` Enforced.\n- `truth:inert`\n  Intended but not parsed.";
  assert.deepEqual(atlasPrincipleActiveTruthIds(mixed), ["truth:ok"]);
  assert.deepEqual(malformedAtlasPrincipleTruthLines(mixed), [{ line: 6 }]);
});
