# Atlas SDK is a deterministic library; agentic work lives in Markdown

`CONTEXT.md` describes semantic verification, Challenge, and Crawlers — "the read-only
subagents an Ingest dispatches to crawl one source in parallel" — without saying which
component runs a model. We decided Atlas SDK never does. The SDK is a deterministic
TypeScript library: it validates, reads, writes, and reports. Every agentic step is a
Markdown instruction file written in English with frontmatter, executed by whatever
coding agent the human is already using.

## Consequences

The SDK offers agentic steps a *seam*, not an implementation. Where a workflow needs
judgment — a semantic Policy verdict, its Challenge, a Crawler traversing a source — the
SDK contributes the deterministic half: the input it hands out, the shape of the result
it will accept back, and the validation that result must survive. The model-run half
happens outside the process, and its output re-enters through ordinary validated input.

This keeps properties the merged work already depends on. Every operation stays
reproducible and testable at `--100` coverage with no network and no API key, so
`npm run ci` remains a complete gate. A model can never weaken a Directive, Framework
contract, trusted Finding, Principle, or Atlas Policy, because trusted validation runs in
a process the model cannot reach. Adopters are not bound to one vendor.

The cost is that a workflow is only as good as the agent driving it, and a semantic
verdict is not reproducible from the repository alone. That is why a semantic verdict must
carry cited evidence and survive a Challenge, and why disagreement produces an
inconclusive Finding and escalates to a human rather than resolving itself.

The glossary is unchanged: it defines Ingest and Lint as *human-facing workflows*, not SDK
functions, so "Crawlers an Ingest dispatches" stays accurate — the dispatching lives in the
workflow's Markdown, not in `src/`.
