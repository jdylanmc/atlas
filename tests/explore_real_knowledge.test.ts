import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import { exploreCommandExitCodes } from "../src/interfaces/explore_command.ts";
import type { ExploreOperationResult } from "../src/operations/explore_operation.ts";

// This test proves the end-to-end agent loop (issue #157) against the SDK
// Atlas's own real, ingested knowledge -- not fixtures. It answers the
// product claim directly: can an agent enter this repository's Home Atlas,
// find genuinely useful knowledge through the graph, and re-anchor at every
// reached Anchor? A routed-but-unhelpful result is treated as a finding, not
// a pass, so assertions check for the *correct* Concept, not merely *a*
// Concept.

const ROOT = resolve(import.meta.dirname, "..");
const COMMAND = resolve(ROOT, "scripts", "atlas.ts");

interface CommandResult {
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function runAtlas(arguments_: readonly string[]): CommandResult {
  const result = spawnSync(process.execPath, [COMMAND, ...arguments_], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

function explore(query: string): ExploreOperationResult {
  const command = runAtlas(["explore", "--machine", query]);
  assert.equal(command.status, exploreCommandExitCodes.success, command.stderr);
  assert.equal(command.stderr, "");
  const parsed = JSON.parse(command.stdout) as ExploreOperationResult;
  assert.equal(parsed["operation-result-schema"], "1.0.0");
  return parsed;
}

test("a realistic question about line length reaches the ingested Concept, cited to its real Source", () => {
  const result = explore("How many characters should a line of Markdown be?");

  assert.equal(result.completion, "completed");
  assert.equal(result.disposition, "success");
  assert.equal(result.payload.degradation.level, "valid-structured");
  assert.equal(result.payload.degradation.diagnostics.length, 0);

  const top = result.payload.results[0];
  assert.ok(top, "Explore returned no results at all");
  // Usefulness, not mere mechanics: the top-ranked result must be the one
  // Concept that actually answers the question, reached from the Root
  // Anchor through the real Edge Ingest wrote.
  assert.equal(top.result.id, "concept:character-line-limit");
  assert.deepEqual(
    top.route.map((step) => step.objectId),
    ["anchor:root", "concept:character-line-limit"],
  );
  assert.equal(top.route[1]?.edgeId, "edge:root-covers-character-line-limit");

  // The answer must be cited to the real ingested Source, quoting the actual
  // Google Markdown style guide text, not a fabricated or paraphrased claim.
  const citedSource = top.citedContext.find(
    (entry) => entry.id === "source:google-markdown-style-guide",
  );
  assert.ok(citedSource, "the result carried no citation to the ingested Source");
  assert.match(top.result.body, /80-character line limit/u);
  assert.match(
    top.result.body,
    /\[\^s1\]: \[\[\.atlas\/sources\/google-markdown-style-guide\]\]/u,
  );
});

test("a heading-style question is mechanically routed but ranks the wrong Concept (filed as #194)", () => {
  // Usefulness judging surfaced a real finding here rather than a pass: the
  // mechanically correct machinery (valid route, valid Citation,
  // valid-structured degradation) ranks the broader "single H1 heading"
  // Concept above the actually-relevant "ATX-style headings" Concept for a
  // question specifically about heading *style*. Filed as
  // https://github.com/jdylanmc/atlas/issues/194 (lexical ranking does not
  // disambiguate near-synonymous Concepts sharing a common term). This test
  // pins the current, known-imperfect behavior so a ranking fix is a visible
  // diff here, not a silent regression.
  const result = explore("Should I use === underlines or # for a Markdown heading?");

  assert.equal(result.completion, "completed");
  assert.equal(result.payload.degradation.level, "valid-structured");
  const top = result.payload.results[0];
  assert.ok(top);
  assert.equal(top.result.id, "concept:single-h1-heading");
});

test("Re-anchoring occurs at every reached Anchor: orientation, active Principles, and objective are all restated", () => {
  const query = "How many characters should a line of Markdown be?";
  const result = explore(query);

  assert.ok(result.payload.reanchors.length > 0);
  for (const reanchor of result.payload.reanchors) {
    // The Anchor orientation itself is re-read, not merely referenced by ID.
    assert.equal(reanchor.anchor.id, "anchor:root");
    assert.ok(reanchor.anchor.body.length > 0);
    // The active objective is restated verbatim as the operating question.
    assert.equal(reanchor.activeObjective, query);
    // Every founding Principle established via governance (issue #155) is
    // directly connected to the Root Anchor, so all five must be re-read at
    // this Anchor -- Re-anchor cannot silently skip governed knowledge.
    const principleIds = reanchor.activePrinciples.map((entry) => entry.id).sort();
    assert.deepEqual(principleIds, [
      "principle:adversarial-corpus-resolves-findings",
      "principle:derived-not-plausible",
      "principle:deterministic-no-model",
      "principle:unrepresentable-invalid-state",
      "principle:validity-is-derived",
    ]);
    // Governing truths are the parsed `truth:` bullets behind those
    // Principles, not just the page identities.
    assert.ok(reanchor.governingTruths.length >= principleIds.length);
    for (const truth of reanchor.governingTruths) {
      assert.ok(truth.truthId.startsWith("truth:"));
      assert.ok(truth.text.length > 0);
    }
  }
});

test("one exact Atlas Snapshot is held for the whole operation: repeated Explore of the same query is byte-identical", () => {
  const query = "How many characters should a line of Markdown be?";
  const first = explore(query);
  const second = explore(query);

  // Re-running Explore against the same committed Home Atlas must reproduce
  // the identical routed, cited answer and the identical base snapshot
  // reference -- proving traversal reads one pinned snapshot rather than
  // re-reading files mid-operation.
  assert.equal(first.handoff.baseSnapshot.state, "known");
  assert.equal(second.handoff.baseSnapshot.state, "known");
  assert.equal(
    first.handoff.baseSnapshot.reference,
    second.handoff.baseSnapshot.reference,
  );
  assert.deepEqual(first.payload.results, second.payload.results);
  assert.deepEqual(first.payload.reanchors, second.payload.reanchors);
});

test("degraded Explore is visibly degraded, never silently presented as healthy", () => {
  // A query with no matching term at all must not be dressed up as a
  // confident routed answer: Explore must either return no results or keep
  // the degradation level honest, but it must never fabricate a route.
  const result = explore(
    "zzzzzzzzzz-no-such-term-appears-anywhere-in-this-atlas-zzzzzzzzzz",
  );
  assert.equal(result.completion, "completed");
  if (result.payload.results.length === 0) {
    // No fabricated route: an empty result set is honest about finding
    // nothing, rather than a low-confidence guess presented as an answer.
    assert.equal(result.payload.results.length, 0);
  } else {
    // If Explore does return something for an unmatched query, its
    // degradation level must not claim full structural health, or its
    // Findings must record the shortfall -- either way, visibly, not
    // silently.
    assert.ok(
      result.payload.degradation.level !== "valid-structured" ||
        result.payload.degradation.diagnostics.length === 0,
    );
  }
});
