# Code review guidance

Use only for relevant code, design, or implementation evidence. Repository requirements override optional heuristics. Roast's review-only boundaries and output contract apply throughout.

For code, load required `solid` through [Doctrine](../doctrine/SKILL.md) before applying these optional heuristics. Assess relevant SOLID principles against the actual evidence; loading them does not mandate abstractions or manufacture findings. Preserve other selections from Roast's work packet.

## Requirements and correctness

Trace the actual behavior against the supplied acceptance requirements. Look for missing or partial functionality, scope creep, incorrect state transitions, edge cases, error propagation, data loss, concurrency hazards, and incompatible API or data changes. Ground a finding in a real path or bounded experiment, not merely a suspicious-looking line.

Inspect tests for defect sensitivity and observable behavior, not just coverage claims or mocked implementation details. Identify unverified requirements and whether recorded test results apply to the reviewed state. A migration or rollout claim needs its relevant compatibility and recovery evidence.

## Standards and design

Cite governing repository guidance or selected doctrine before alleging a violation. Consider naming, ownership, type safety, dependency direction, boundaries, maintainability, and the smallest sufficient design where those affect the requested outcome.

The imported review's smell vocabulary can help identify a concern:

| Heuristic | Question to investigate |
| --- | --- |
| Mysterious Name | Does a misleading or ambiguous name obscure the actual contract? |
| Duplicated Code | Is duplicated behavior likely to diverge, or are the cases intentionally distinct? |
| Feature Envy | Does behavior belong with the data or responsibility it repeatedly reaches into? |
| Data Clumps | Do recurring values represent one domain concept with shared invariants? |
| Primitive Obsession | Is an untyped primitive obscuring a real domain constraint? |
| Repeated Switches | Are repeated dispatch decisions drifting or duplicating ownership? |
| Shotgun Surgery | Does a single responsibility require unjustifiably scattered changes? |
| Divergent Change | Is one unit changing for unrelated responsibilities? |
| Speculative Generality | Is machinery present for requirements that do not exist? |
| Message Chains | Is a caller depending on internal navigation it should not know? |
| Middle Man | Is delegation obscuring rather than enforcing a useful boundary? |
| Refused Bequest | Does an inherited contract misrepresent what an implementation supports? |

These are questions, not automatic refactoring instructions. Label a supported smell as a heuristic concern and explain its concrete consequence. Do not invent abstractions, mandate polymorphism, or report every instance of a familiar shape as a defect.

Avoid duplicating routine formatter/linter output. When an actual check failure matters to review, cite the observed result and its consequence rather than claiming that tools will enforce it without evidence. Roast may inspect or run permitted non-mutating checks; it does not auto-fix their findings.

Report one prioritized findings list. A short closing coverage statement retains the requirements/standards distinction without letting either hide gaps in the other.
