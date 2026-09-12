---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Research directly for small questions or when already running as a delegated
worker. Otherwise delegate one bounded research task only when permitted and
there is independent work to do while it runs. Do not recursively spawn another
research agent for the same objective.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save a document only when the user requested an artifact or the approved
   workflow requires one. Follow `docs/agents/domain.md` and existing note
   conventions; if the destination is unclear, ask. Keep temporary evidence
   in the private session workspace, and never send repository/private data
   to an external service merely to obtain citations.
