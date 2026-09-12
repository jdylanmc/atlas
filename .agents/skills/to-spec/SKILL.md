---
name: to-spec
description: Compatibility alias for Atlas's /spec workflow. Publish one unlabeled specification from the current conversation without another interview.
disable-model-invocation: true
---

# To Spec

Invoke the project `spec` skill with the same conversation and arguments.
Its canonical instructions are [../spec/SKILL.md](../spec/SKILL.md). If the
harness cannot resolve that project skill, read and follow that file directly;
do not substitute a similarly named global skill.

Do not publish a second issue, add readiness labels, or introduce an interview.
All repository checks, duplicate guards, and publication behavior belong to
`spec`; this alias does not change them.
