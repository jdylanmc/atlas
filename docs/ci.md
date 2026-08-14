# Cacophony Prompt Review

Atlas uses Fletcher to review every new Cacophony adversary before that
adversary joins the review council.

The path-gated `pull_request_target` workflow first queries the pull request
file metadata without checking out or executing pull-request code. Fletcher
runs only when the change adds a new Markdown prompt directly under
`.cacophony/agents/`; edits, renames, and deletions do not invoke it. Fletcher
uses the `gpt-5.6-luna-high` deployment with a 40-turn review budget.

The reusable worker checks authorization before checkout, inspects the pull
request merge ref without executing it, loads reviewer prompts from the trusted
base commit, gives the Azure credential only to an immutable Cacophony action,
and uploads each structured report separately.

## Required repository configuration

Configure these under **Settings > Secrets and variables > Actions**:

- Secret `CACOPHONY_AZURE_API_KEY`: the Azure AI Foundry API key.
- Variable `CACOPHONY_AZURE_ENDPOINT`: the Azure AI Foundry project endpoint or
  compatible `/openai/v1` endpoint.

A reviewer introduced by a pull request begins running only after its prompt is
merged into the trusted base branch.
