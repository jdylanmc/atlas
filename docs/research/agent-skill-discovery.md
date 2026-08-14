# Agent Skill Discovery and Installation Contracts

Research for [Research portable agent skill discovery and installation contracts](https://github.com/jdylanmc/atlas/issues/15).

## Recommendation

Keep Realm-authored source skills under `.atlas/skills/<name>/SKILL.md`. An Atlas adapter should expose those skills to harnesses by copying or symlinking each complete skill directory into the harness discovery locations:

- `.agents/skills/<name>/` for GitHub Copilot, OpenAI Codex, OpenCode, and Pi.
- `.claude/skills/<name>/` for Claude Code.

The portable contract should use only the Agent Skills standard fields `name` and `description`. Harness-specific metadata belongs in generated adapter output, not the Realm's canonical skill.

Atlas should support both copying and symlinking. Copying is the compatibility baseline; symlinking is an optimization enabled only after the adapter verifies the target harness and platform behavior.

## Shared skill contract

The Agent Skills specification defines a skill as a directory containing `SKILL.md` with YAML frontmatter and Markdown instructions. `name` and `description` are required; optional standard fields include `license`, `compatibility`, `metadata`, and `allowed-tools`. Supporting files may live beside `SKILL.md` in directories such as `scripts/`, `references/`, and `assets/`.

Source: [Agent Skills specification](https://agentskills.io/specification.md).

## Compatibility matrix

| Harness | Project discovery path | Invocation | Atlas adapter |
| --- | --- | --- | --- |
| GitHub Copilot | `.agents/skills/<name>/SKILL.md` | Skill tool and slash-command surfaces depend on host | Publish to `.agents/skills/` |
| OpenAI Codex | `.agents/skills/<name>/SKILL.md` and Codex-specific locations | Model selection from description; explicit skill invocation is also supported | Publish to `.agents/skills/` |
| OpenCode | `.opencode/skills/`, `.claude/skills/`, and `.agents/skills/` while walking to the Git root | `skill` tool | Publish to `.agents/skills/` |
| Pi | `.pi/skills/` and `.agents/skills/` after project trust | `/skill:<name>` or model selection | Publish to `.agents/skills/` |
| Claude Code | `.claude/skills/<name>/SKILL.md` | Slash command and model selection | Publish to `.claude/skills/` |

Primary sources:

- [GitHub Copilot: Creating agent skills](https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-coding-agent-with-agent-skills)
- [OpenAI Codex: Agent Skills](https://developers.openai.com/codex/skills/)
- [OpenCode skills documentation](https://opencode.ai/docs/skills/)
- [Pi skills documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
- [Claude Code skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills)

## Portability requirements

1. The directory name and frontmatter `name` should match, using lowercase letters, digits, and hyphens.
2. Descriptions must state both capability and invocation conditions because harnesses use them for model-driven selection.
3. Canonical Realm skills must not depend on harness-specific frontmatter such as Codex's `agents/openai.yaml`.
4. Relative links and bundled references must remain inside the copied or linked skill directory.
5. Adapter output must be derived and replaceable. Agents edit `.atlas/skills/`, never the harness projection.
6. The adapter must detect collisions with pre-existing project skills and require an explicit overwrite policy.
7. Project trust remains a harness concern. Atlas must report when skills are projected but not active because a harness has not trusted the repository.
8. Agent instructions should provide a fallback path that tells an agent to open `.atlas/skills/<name>/SKILL.md` directly when native discovery is unavailable.

## Symlink evidence and uncertainty

Codex and Claude document or support linked skill directories. OpenCode and Pi use ordinary filesystem traversal, but their user documentation does not make a stable cross-platform symlink guarantee. Atlas should therefore treat copying as universally supported and symlinking as adapter-specific behavior covered by integration tests.

## Resulting v1 contract

`.atlas/skills/` is the portable source of truth. The initial adapter should generate `.agents/skills/` and `.claude/skills/` projections, record what it generated, avoid overwriting independent skills, and allow an agent to use the source instructions directly when projection is unavailable.
