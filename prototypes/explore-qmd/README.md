# PROTOTYPE: Atlas Explore over QMD

This throwaway prototype asks:

> Does Explore feel understandable and context-efficient when one query returns
> ranked entry-point pages, a Bonfire result carries its Realm context, and the
> agent progressively opens Threads, claims, Citations, and cross-Realm results
> rather than loading whole Realms?

Run the QMD feasibility probe:

```sh
npm install
npm run probe
```

Then open `explore-prototype.html` directly in a browser for the interaction
walkthrough.

The prototype deliberately uses QMD's BM25 search only. Embeddings and LLM
reranking remain optional accelerators rather than requirements for Explore.

## Acceptance probe

The probe indexes three independent Realm collections behind an Atlas-owned
`SearchProvider` interface. It fails if any of these conditions are false:

- a second sync is incremental;
- result identity remains stable across sync;
- skills and Laws stay outside the knowledge index;
- Bonfires carry their Realm Manifest and Laws context;
- stale cached Realms remain queryable and visibly stale;
- Realm filters are enforced;
- QMD URIs and native result fields do not escape the provider;
- lexical search works while embeddings are absent; and
- Atlas can promote Bonfires as entry points without changing QMD.

`qmd-capture.json` records the real provider output used to shape the clickable
demo.
