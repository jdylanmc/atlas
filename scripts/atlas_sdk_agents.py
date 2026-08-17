#!/usr/bin/env python3
"""Validate the inactive Atlas SDK Realm Guide source artifacts."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


PERSONA_PATH = "docs/agents/atlas-sdk/personas/merlin/persona.md"
COMPOSITION_PATH = "docs/agents/atlas-sdk/compositions/realm-guide.json"
PERSONA_SCHEMA = "atlas.agent-persona/v3"
COMPOSITION_SCHEMA = "atlas.agent-composition/v1"
MAX_ARTIFACT_BYTES = 128 * 1024

EXPECTED_METADATA = {
    "schema": PERSONA_SCHEMA,
    "persona": "merlin",
    "authority": "none",
    "display-name": "Merlin",
    "display-title": "Realm Guide",
    "realm": "atlas-sdk",
    "avatar-fallback": "neutral-realm-sigil",
}
PERSONA_FIELDS = {
    "Identity": ("Basis", "Character", "Semantic core"),
    "Avatar": ("Brief", "Fallback"),
    "Voice": ("Register", "Tone"),
    "Diction": ("Word choice", "Technical terms", "Clarity"),
    "Cadence": ("Shape", "Pacing"),
    "Mannerisms": ("Presence", "Humor"),
    "Metaphor palette": ("Images", "Boundaries"),
}
EXPECTED_DIRECTIVES = (
    "orient-realm-users",
    "steward-realm-knowledge",
    "curate-realm-site",
)
EXAMPLE_FRAMINGS = (
    "The threshold has lost its keystone.",
    "Before the moonlit bridge is crossed.",
    "That neighboring map was inked under an older moon.",
    "The waystone sets the route, while the lantern colors its light.",
    "The constellation is drawn but not yet kindled.",
    "The old blue cloak is still folded on the shelf.",
)
DOCUMENTED_COMMANDS = (
    "python3 scripts/atlas_sdk_agents.py validate",
)
AUTHORITY_PATTERN = re.compile(
    r"\b(must|shall|should|required|requires?|never|only|prohibit(?:s|ed)?|"
    r"objectives?|responsibilities|permissions?|workflow|evidence rules?|"
    r"governance|severity|handoffs?|allowed actions?|approve|reject|execute|"
    r"run|write|modify|delete|create|initialize|activate)\b",
    re.IGNORECASE,
)
MODERN_ADAPTATION_TERMS = (
    "cortana",
    "disney",
    "dumbledore",
    "elminster",
    "gandalf",
)


class ContractError(ValueError):
    """Raised when an inactive Atlas SDK agent artifact is invalid."""


def read_text(root: Path, relative_path: str) -> str:
    path = root.resolve() / relative_path
    if path.is_symlink() or not path.is_file():
        raise ContractError(f"{relative_path} must be a regular file")
    if path.stat().st_size > MAX_ARTIFACT_BYTES:
        raise ContractError(
            f"{relative_path} exceeds {MAX_ARTIFACT_BYTES} bytes"
        )
    data = path.read_bytes()
    if b"\0" in data:
        raise ContractError(f"{relative_path} must be text")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ContractError(f"{relative_path} must be UTF-8") from error
    if not text.endswith("\n"):
        raise ContractError(f"{relative_path} must end with a newline")
    return text


def parse_persona(text: str) -> tuple[dict[str, str], dict[str, list[str]]]:
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ContractError(f"{PERSONA_PATH} must start with YAML frontmatter")
    try:
        closing = lines.index("---", 1)
    except ValueError as error:
        raise ContractError(
            f"{PERSONA_PATH} has unterminated YAML frontmatter"
        ) from error

    metadata: dict[str, str] = {}
    for line in lines[1:closing]:
        if not line or ":" not in line:
            raise ContractError(
                f"{PERSONA_PATH} has malformed frontmatter line: {line!r}"
            )
        key, value = (part.strip() for part in line.split(":", 1))
        if not key or not value or key in metadata:
            raise ContractError(
                f"{PERSONA_PATH} has invalid frontmatter key: {key!r}"
            )
        metadata[key] = value
    if metadata != EXPECTED_METADATA:
        raise ContractError(
            f"{PERSONA_PATH} frontmatter must be exactly {EXPECTED_METADATA}"
        )

    body = lines[closing + 1 :]
    if not body or body[0] != "# Agent Persona":
        raise ContractError(f"{PERSONA_PATH} must use '# Agent Persona'")
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in body[1:]:
        if line.startswith("## "):
            current = line[3:].strip()
            if current in sections:
                raise ContractError(
                    f"{PERSONA_PATH} repeats section {current!r}"
                )
            sections[current] = []
        elif line.startswith("#"):
            raise ContractError(
                f"{PERSONA_PATH} may contain only H1 and H2 headings"
            )
        elif current is None:
            if line.strip():
                raise ContractError(
                    f"{PERSONA_PATH} has content before its first H2"
                )
        else:
            sections[current].append(line)
    expected_sections = (*PERSONA_FIELDS, "Examples")
    if tuple(sections) != expected_sections:
        raise ContractError(
            f"{PERSONA_PATH} sections must be exactly {expected_sections}"
        )
    return metadata, sections


def parse_fields(section: str, lines: list[str]) -> dict[str, str]:
    entries = [line for line in lines if line.strip()]
    values: dict[str, str] = {}
    for entry in entries:
        match = re.fullmatch(r"- ([^:]+): (.+)", entry)
        if not match:
            raise ContractError(
                f"{PERSONA_PATH} {section!r} must contain only "
                "'- Field: value' entries"
            )
        field, value = match.groups()
        if field in values:
            raise ContractError(
                f"{PERSONA_PATH} {section!r} repeats field {field!r}"
            )
        values[field] = value
    expected = PERSONA_FIELDS[section]
    if tuple(values) != expected:
        raise ContractError(
            f"{PERSONA_PATH} {section!r} fields must be exactly {expected}"
        )
    return values


def parse_examples(lines: list[str]) -> tuple[tuple[str, str], ...]:
    entries = [line for line in lines if line.strip()]
    if len(entries) < 4 or len(entries) % 2:
        raise ContractError(
            f"{PERSONA_PATH} Examples must contain paired Plain and Persona lines"
        )
    pairs: list[tuple[str, str]] = []
    for index in range(0, len(entries), 2):
        plain_match = re.fullmatch(r"- Plain: (.+)", entries[index])
        persona_match = re.fullmatch(r"- Persona: (.+)", entries[index + 1])
        if not plain_match or not persona_match:
            raise ContractError(
                f"{PERSONA_PATH} Examples must alternate Plain and Persona lines"
            )
        pairs.append((plain_match.group(1), persona_match.group(1)))
    return tuple(pairs)


def reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    document: dict[str, object] = {}
    for key, value in pairs:
        if key in document:
            raise ContractError(
                f"{COMPOSITION_PATH} repeats JSON key {key!r}"
            )
        document[key] = value
    return document


def validate_persona(text: str) -> tuple[tuple[str, str], ...]:
    _, sections = parse_persona(text)
    presentation_values: list[str] = []
    for section in PERSONA_FIELDS:
        presentation_values.extend(parse_fields(section, sections[section]).values())

    presentation_text = "\n".join(presentation_values)
    authority = AUTHORITY_PATTERN.search(presentation_text)
    if authority:
        raise ContractError(
            f"{PERSONA_PATH} contains behavioral authority: "
            f"{authority.group(0)!r}"
        )
    lower_text = text.lower()
    for term in MODERN_ADAPTATION_TERMS:
        if term in lower_text:
            raise ContractError(
                f"{PERSONA_PATH} references modern adaptation term {term!r}"
            )

    examples = parse_examples(sections["Examples"])
    if len(examples) != len(EXAMPLE_FRAMINGS):
        raise ContractError(
            f"{PERSONA_PATH} Examples must contain exactly "
            f"{len(EXAMPLE_FRAMINGS)} reviewed pairs"
        )
    for (plain, persona), framing in zip(examples, EXAMPLE_FRAMINGS):
        if persona != f"{framing} {plain}":
            raise ContractError(
                f"{PERSONA_PATH} Persona example must use its approved framing "
                "followed by the complete Plain semantic core verbatim"
            )
        if plain.startswith("Run "):
            commands = re.findall(r"`([^`\n]+)`", plain)
            if commands != list(DOCUMENTED_COMMANDS):
                raise ContractError(
                    f"{PERSONA_PATH} command example must use a documented "
                    "repository command"
                )
        plain_tokens = re.findall(r"`[^`\n]+`", plain)
        persona_tokens = re.findall(r"`[^`\n]+`", persona)
        if plain_tokens != persona_tokens:
            raise ContractError(
                f"{PERSONA_PATH} Persona example must preserve exact code "
                "tokens"
            )
    return examples


def validate_composition(text: str) -> dict[str, object]:
    try:
        document = json.loads(text, object_pairs_hook=reject_duplicate_keys)
    except json.JSONDecodeError as error:
        raise ContractError(
            f"{COMPOSITION_PATH} must contain valid JSON: {error.msg}"
        ) from error
    expected_keys = {
        "schema",
        "composition",
        "realm",
        "status",
        "persona",
        "directives",
    }
    if not isinstance(document, dict) or set(document) != expected_keys:
        raise ContractError(
            f"{COMPOSITION_PATH} must contain only reference metadata"
        )
    expected_values = {
        "schema": COMPOSITION_SCHEMA,
        "composition": "realm-guide",
        "realm": "atlas-sdk",
        "status": "inactive",
        "persona": "merlin",
    }
    for key, value in expected_values.items():
        if document[key] != value:
            raise ContractError(
                f"{COMPOSITION_PATH} {key!r} must be {value!r}"
            )
    directives = document["directives"]
    if directives != list(EXPECTED_DIRECTIVES):
        raise ContractError(
            f"{COMPOSITION_PATH} directives must be the ordered references "
            f"{EXPECTED_DIRECTIVES!r}"
        )
    return document


def validate_contract(root: Path) -> None:
    validate_persona(read_text(root, PERSONA_PATH))
    validate_composition(read_text(root, COMPOSITION_PATH))


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate")
    validate.add_argument("--root", type=Path, default=Path.cwd())
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    try:
        if arguments.command == "validate":
            validate_contract(arguments.root)
            print("validated inactive Atlas SDK Realm Guide composition")
    except ContractError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
