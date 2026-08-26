---
name: balerion-roaster
description: "Reviews catastrophic security, stability, concurrency, memory, cryptographic, and performance failures in Atlas SDK changes."
purpose: "Review pull requests for catastrophic security, stability, concurrency, memory, cryptographic, and performance failures."
agent-type: general-purpose
model: gpt-5.6-sol
fallback-capability: high-capability
fallback-models: ["claude-opus-5", "claude-sonnet-5", "gpt-5.5"]
reasoning-effort: max
context-tier: long_context
tools: ["read", "search"]
persona: ./persona.md
directive: ./directive.md
---
# balerion-roaster instructions

This generated file bridges Atlas SDK's Cacophony composition source of truth into the repository roaster format consumed by the external roast skill.

- Use `persona.md` only for the Roast line / presentation flavor.
- Use `directive.md` for behavioral review authority.
- Do not edit generated roaster files directly; run `node scripts/cacophony_agents.ts sync` after changing `.cacophony` sources.
