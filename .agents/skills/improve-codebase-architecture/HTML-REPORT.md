# HTML Report Format

Create one offline, self-contained document in an approved private location.
Use inline CSS and static inline SVG or text diagrams. Include no executable
scripts, remote resources, telemetry or automatic navigation. Escape source
snippets, paths and user text as data rather than inserting raw HTML.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
    <title>Architecture review</title>
    <style>
      body { margin: 0; background: #fafaf9; color: #0f172a;
             font-family: system-ui, sans-serif; line-height: 1.5; }
      main { max-width: 64rem; margin: auto; padding: 2rem; }
      article { background: white; border: 1px solid #cbd5e1;
                border-radius: 0.75rem; padding: 1.5rem; margin: 1.5rem 0; }
      .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
      .diagram { white-space: pre-wrap; overflow-wrap: anywhere; }
      .warning { border-left: 0.25rem solid #b45309; padding-left: 1rem; }
      @media (max-width: 40rem) { .comparison { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header><h1>Architecture review</h1></header>
      <section id="candidates" aria-label="Candidates"></section>
      <section id="top-recommendation" aria-label="Top recommendation"></section>
    </main>
  </body>
</html>
```

## Candidate cards

Use one `<article>` per candidate with:

- A descriptive heading and recommendation strength: Strong, Worth exploring,
  or Speculative. Do not communicate strength by color alone.
- The actual files and domain concepts involved.
- Before/after diagrams with labels, plus a short textual explanation.
- Problem, proposed change, and gains in locality, leverage or testability.
- Any conflict with an existing architecture decision.

Draw dependencies as labeled boxes and arrows, layered structures as horizontal
bands, and interface/implementation proportions as paired rectangles. Inline
SVG needs an accessible title/description; a readable `<pre>` diagram is also
valid. Do not add a renderer dependency for layout convenience.

Keep prose concise. Use the `codebase-design` vocabulary for architectural
relationships while preserving established repository type and service names.
End with a top recommendation and an internal link to its candidate card.
Reporting a candidate is not approval to implement it.
