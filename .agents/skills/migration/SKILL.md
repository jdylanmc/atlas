---
name: migration
description: "Internal helper only when established production use creates a real migration obligation. Plan safe transitions; normally skip ceremony for non-production prototypes, never infer data safety from version alone."
disable-model-invocation: false
user-invocable: false
---

# Migration

**Entry:** Internal helper only when established production use creates a real migration obligation. Plan safe transitions; normally skip ceremony for non-production prototypes, never infer data safety from version alone. Follow the [invocation contract](../setup/INVOCATION.md).

Use [doctrine selection and application](../doctrine/APPLY.md). Preserve the task's selections; with none, consider `sequencing`, `idempotency`, and, for stored-data changes, `data` or `distributed-data`. Select only relevant guidance and load its text before applying it. No doctrine authorizes destructive contraction or expands the agreed stage.

This is an internal helper, not a standalone entry point or a default phase for every change. The calling delivery owner retains scope, permissions, doctrine selections, and responsibility for finishing the ordinary change.

## 1. Check eligibility before adding ceremony

Require evidence for **both**:

- The application is in production: actual production usage/deployments or an authoritative owner confirmation, not an assumed release convention.
- This change needs a migration: persisted data must transition, deployed consumers/contracts must remain compatible, versions overlap in rollout, or another concrete transition obligation exists.

Name the evidence, affected data/consumers, and change-specific reason. A version number alone establishes neither production use nor absence of users/data. A pre-1.0 or non-production change normally skips migration ceremony and compatibility scaffolding; do not add expand–contract layers to a 0.2 prototype speculatively.

If either fact is unknown, report the uncertainty to the owner for clarification before proceeding. Do not fabricate users, data, or rollback needs. If ineligible, return **"migration not needed"**, the evidence/reasons, and any ordinary data-preservation obligation. The original owner continues the ordinary change; this helper creates no migration code, compatibility layer, staged ticket graph, or cleanup task.

Skipping this helper never authorizes data loss, even in pre-1.0 work. Existing valuable data, exports/backups, and destructive changes still require the ordinary delivery's preservation checks and explicit human decisions.

## 2. Agree the eligible transition

Within the caller's existing approval gates, map current readers/writers, stored shape, deployed contracts, actual compatibility window, and ownership. Define the requested stage, acceptance evidence, forward path, and rollback/recovery path. Explain irreversible operations and preservation proof; obtain separate explicit permission for destructive steps. If recovery is roll-forward rather than rollback, state that limitation and obtain agreement.

Require `worktrees` through [doctrine selection](../doctrine/APPLY.md) before authorized PR changes; reuse the delivery owner's suitable isolation and [workspace procedure](../ship/WORKSPACE.md). Planning or eligibility inspection does not permit writes.

## 3. Execute and verify only the agreed stages

- Sequence expand, migrate, verify, then contract only where the evidenced transition requires those stages.
- Preserve data and mixed-version operation across the actual rollout window. Do not preserve obsolete compatibility beyond the agreed need.
- Make retries idempotent; define resumable checkpoints and observable partial failures without leaking sensitive data.
- Verify preservation, required old/new paths, repeated/partial runs, and the agreed rollback or recovery behavior at relevant stages.
- Stop and return evidence on unexpected failure. Do not hide it by destroying old data or advancing to contraction.

For authorized changes use [Changelog](../changelog/SKILL.md) for the affected repository/component: curated notable `Unreleased` entries in Keep a Changelog 1.1.0 format, including user-relevant migration/recovery impact where applicable. Report no entry needed if nothing notable changed. No changelog writes during eligibility/proposal/review, commit dumps, automatic versions/releases, or recursive changelog-only entries.

Return eligibility evidence, stages actually completed, preservation/recovery results, remaining risks, and deferred work to the original delivery owner. Stop after the requested stage passes; later contraction is not implicit permission. The owner continues its review, validation, PR, and Shepherd flow; this helper neither merges nor approves its own result.
