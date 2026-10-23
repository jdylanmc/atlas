import assert from "node:assert/strict";
import test from "node:test";
import { checkFinding } from "../src/domain/finding.ts";
import type { ProseLintRequest } from "../src/lint/prose_lint.ts";
import { valeFindingCode, valeProseLintOutcome } from "../src/lint/vale_alerts.ts";

function at<T>(items: readonly T[] | undefined, index: number): T {
  const item = items?.[index];
  assert.ok(item !== undefined);
  return item;
}

const root = "/tmp/atlas-vale-xyz";

const request: ProseLintRequest = Object.freeze({
  files: Object.freeze([
    Object.freeze({ content: "StylesPath = vale/styles\n", path: ".atlas/.vale.ini" }),
    Object.freeze({
      content: "extends: occurrence\n",
      path: ".atlas/vale/styles/A/R.yml",
    }),
    Object.freeze({ content: "# A\n", path: ".atlas/concepts/a.md" }),
    Object.freeze({ content: "# B\n", path: ".atlas/index.md" }),
  ]),
  pagePaths: Object.freeze([".atlas/concepts/a.md", ".atlas/index.md"]),
});

function alert(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Action: { Name: "", Params: null },
    Check: "AtlasSDK.PageLength",
    Description: "",
    Line: 7,
    Link: "",
    Match: "One",
    Message: "Page prose runs to 1001 words.",
    Severity: "error",
    Span: [1, 3],
    Suggestions: [],
    ...overrides,
  };
}

function run(status: number | null, output: unknown, raw?: string) {
  return valeProseLintOutcome(
    { status, stdout: raw ?? JSON.stringify(output) },
    request,
    root,
  );
}

test("Vale finding codes derive from the check name", () => {
  assert.equal(valeFindingCode("AtlasSDK.PageLength"), "VALE_ATLASSDK_PAGELENGTH");
  assert.equal(valeFindingCode("my-style.No Hedging"), "VALE_MY_STYLE_NO_HEDGING");
  assert.equal(valeFindingCode("..."), "VALE_ALERT");
});

test("Vale alerts become Atlas-owned located Findings in code-point order", () => {
  const outcome = run(1, {
    ".atlas/index.md": [alert({ Line: 3, Severity: "warning", Check: "House.Hedge" })],
    ".atlas/concepts/a.md": [
      alert({ Line: 9, Span: [4, 2] }),
      alert({ Line: 9, Span: [1, 3], Check: "House.Terms", Severity: "suggestion" }),
    ],
  });
  assert.equal(outcome.state, "completed");
  assert.deepEqual(
    outcome.findings.map((finding) => [
      finding.path,
      finding.code,
      finding.severity,
      finding.location,
    ]),
    [
      [
        ".atlas/concepts/a.md",
        "VALE_HOUSE_TERMS",
        "suggestion",
        { end: { column: 4, line: 9 }, start: { column: 1, line: 9 } },
      ],
      [
        ".atlas/concepts/a.md",
        "VALE_ATLASSDK_PAGELENGTH",
        "error",
        { end: { column: 5, line: 9 }, start: { column: 4, line: 9 } },
      ],
      [
        ".atlas/index.md",
        "VALE_HOUSE_HEDGE",
        "warning",
        { end: { column: 4, line: 3 }, start: { column: 1, line: 3 } },
      ],
    ],
  );
  for (const finding of outcome.findings) {
    assert.ok(checkFinding(finding));
    assert.equal(finding.attribution.kind, "atlas-owned");
    assert.equal(finding.attribution.trusted, false);
    assert.ok(Object.isFrozen(finding));
  }
  assert.equal(at(outcome.findings, 1).attribution.checkId, "vale.AtlasSDK.PageLength");
});

test("Vale alert text cannot smuggle control or bidirectional characters", () => {
  const outcome = run(0, {
    ".atlas/index.md": [
      alert({ Check: "A\u001b.B", Message: "bad\u202etext\u0007\u2067\u009f" }),
    ],
  });
  assert.equal(outcome.state, "completed");
  assert.equal(at(outcome.findings, 0).message, "bad\uFFFDtext\uFFFD\uFFFD\uFFFD");
  assert.equal(at(outcome.findings, 0).attribution.checkId, "vale.A\uFFFD.B");
});

test("Vale alerts at one position order by code, then message", () => {
  const outcome = run(1, {
    ".atlas/index.md": [
      alert({ Check: "B.Rule", Message: "second" }),
      alert({ Check: "A.Rule", Message: "zeta" }),
      alert({ Check: "A.Rule", Message: "alpha" }),
    ],
  });
  assert.equal(outcome.state, "completed");
  assert.deepEqual(
    outcome.findings.map((finding) => [finding.code, finding.message]),
    [
      ["VALE_A_RULE", "alpha"],
      ["VALE_A_RULE", "zeta"],
      ["VALE_B_RULE", "second"],
    ],
  );
});

test("a blank Vale message is replaced with one naming the rule", () => {
  const outcome = run(0, { ".atlas/index.md": [alert({ Message: "  " })] });
  assert.equal(outcome.state, "completed");
  assert.equal(
    at(outcome.findings, 0).message,
    "Vale rule AtlasSDK.PageLength reported an alert.",
  );
});

test("Windows-style Vale paths resolve to the requested Atlas page", () => {
  const outcome = run(0, { ".atlas\\concepts\\a.md": [alert()] });
  assert.equal(outcome.state, "completed");
  assert.equal(at(outcome.findings, 0).path, ".atlas/concepts/a.md");
});

test("an empty Vale report completes with no Findings", () => {
  assert.deepEqual(run(0, {}), { findings: [], state: "completed" });
});

test("unreadable or unexpected Vale reports leave prose Lint unable to run", () => {
  const cases: readonly [number | null, unknown, string?][] = [
    [0, undefined, "not json"],
    [0, []],
    [0, null],
    [1, { ".atlas/other.md": [alert()] }],
    [1, { ".atlas/index.md": {} }],
    [1, { ".atlas/index.md": [null] }],
    [1, { ".atlas/index.md": [alert({ Check: " " })] }],
    [1, { ".atlas/index.md": [alert({ Check: 3 })] }],
    [1, { ".atlas/index.md": [alert({ Message: 3 })] }],
    [1, { ".atlas/index.md": [alert({ Severity: "fatal" })] }],
    [1, { ".atlas/index.md": [alert({ Severity: 1 })] }],
    [1, { ".atlas/index.md": [alert({ Line: 0 })] }],
    [1, { ".atlas/index.md": [alert({ Span: [1] })] }],
    [1, { ".atlas/index.md": [alert({ Span: "1,2" })] }],
    [1, { ".atlas/index.md": [alert({ Span: [0, 2] })] }],
    [1, { ".atlas/index.md": [alert({ Span: [1, 2.5] })] }],
    [3, {}],
    [null, {}],
  ];
  for (const [status, output, raw] of cases) {
    const outcome = run(status, output, raw);
    assert.equal(outcome.state, "unavailable", JSON.stringify([status, output, raw]));
  }
});

test("a Vale configuration error is an Atlas error that never leaks the workspace", () => {
  const outcome = run(2, {
    Code: "E201",
    Line: 3,
    Path: `${root}/.atlas/.vale.ini`,
    Span: 17,
    Text: `Style 'Nope' isn't on the StylesPath (${root}/.atlas/vale/styles).`,
  });
  assert.equal(outcome.state, "completed");
  const [finding] = outcome.findings;
  assert.ok(finding !== undefined && checkFinding(finding));
  assert.equal(finding.code, "ATLAS_VALE_CONFIG_INVALID");
  assert.equal(finding.severity, "error");
  assert.equal(finding.attribution.kind, "sdk-core");
  assert.equal(finding.path, ".atlas/.vale.ini");
  assert.deepEqual(finding.location, {
    end: { column: 18, line: 3 },
    start: { column: 17, line: 3 },
  });
  assert.equal(
    finding.message,
    "The Atlas's Vale configuration could not be loaded: Style 'Nope' isn't on the StylesPath (.atlas/vale/styles).",
  );
  assert.ok(!finding.message.includes(root));
});

test("a Vale configuration error names a loaded style file it points at", () => {
  const windowsRoot = "C:\\Temp\\atlas-vale-1";
  const outcome = valeProseLintOutcome(
    {
      status: 2,
      stdout: JSON.stringify({
        Line: 1,
        Path: `${windowsRoot}\\.atlas\\vale\\styles\\A\\R.yml`,
        Text: `bad rule in ${windowsRoot}\\.atlas\\vale and ${windowsRoot}`,
      }),
    },
    request,
    windowsRoot,
  );
  assert.equal(outcome.state, "completed");
  assert.equal(at(outcome.findings, 0).path, ".atlas/vale/styles/A/R.yml");
  assert.deepEqual(at(outcome.findings, 0).location, {
    end: { column: 2, line: 1 },
    start: { column: 1, line: 1 },
  });
  assert.equal(
    at(outcome.findings, 0).message,
    "The Atlas's Vale configuration could not be loaded: bad rule in .atlas\\vale and .",
  );
});

test("a Vale configuration error outside the Atlas falls back to its configuration", () => {
  for (const output of [
    { Path: "/etc/vale.ini", Text: "nope" },
    { Path: 4, Text: "" },
    { Line: "3" },
    [],
  ]) {
    const outcome = run(2, output);
    assert.equal(outcome.state, "completed");
    assert.equal(at(outcome.findings, 0).path, ".atlas/.vale.ini");
    assert.equal(at(outcome.findings, 0).location, undefined);
  }
  const unparsed = run(2, undefined, "not json");
  assert.equal(unparsed.state, "completed");
  assert.equal(
    at(unparsed.findings, 0).message,
    "The Atlas's Vale configuration could not be loaded: Vale rejected the configuration.",
  );
});
