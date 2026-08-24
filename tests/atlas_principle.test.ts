import assert from "node:assert/strict";
import test from "node:test";
import {
  atlasPrincipleActiveTruthIds,
  extractAtlasPrincipleActiveTruths,
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

test("Principle active truth extraction rejects drift instead of normalizing it", () => {
  for (const [name, body] of [
    [
      "trailing-whitespace heading",
      principleBody("## Active truths ", "- `truth:one` Text."),
    ],
    ["H3 heading", principleBody("### Active truths", "- `truth:one` Text.")],
    ["case-changed heading", principleBody("## Active Truths", "- `truth:one` Text.")],
    ["indented bullet", principleBody("## Active truths", "  - `truth:one` Text.")],
    ["missing same-line text", principleBody("## Active truths", "- `truth:one`")],
  ] as const) {
    assert.deepEqual(extractAtlasPrincipleActiveTruths(body), [], name);
  }
});
