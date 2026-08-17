from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import atlas_sdk_agents as agents  # noqa: E402


class AtlasSdkAgentContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.persona_text = agents.read_text(ROOT, agents.PERSONA_PATH)
        cls.composition_text = agents.read_text(ROOT, agents.COMPOSITION_PATH)

    def test_repository_contract_is_valid(self) -> None:
        agents.validate_contract(ROOT)

    def test_persona_has_schema_valid_display_metadata(self) -> None:
        metadata, sections = agents.parse_persona(self.persona_text)
        self.assertEqual(metadata, agents.EXPECTED_METADATA)
        self.assertEqual(metadata["authority"], "none")
        self.assertEqual(metadata["display-name"], "Merlin")
        self.assertEqual(metadata["realm"], "atlas-sdk")
        self.assertEqual(
            tuple(sections),
            (*agents.PERSONA_FIELDS, "Examples"),
        )

    def test_persona_rejects_behavioral_authority(self) -> None:
        changed = self.persona_text.replace(
            "Every flourish resolves into a plain semantic core",
            "Every response must approve a Realm Proposal",
        )
        with self.assertRaisesRegex(
            agents.ContractError,
            "behavioral authority",
        ):
            agents.validate_persona(changed)

    def test_persona_examples_preserve_literal_terms(self) -> None:
        examples = agents.validate_persona(self.persona_text)
        self.assertGreaterEqual(len(examples), 5)
        for plain, persona in examples:
            for token in ("Atlas", "Realm", "Agent Persona", "Agent Directive"):
                self.assertEqual(plain.count(token), persona.count(token))

    def test_persona_rejects_changed_technical_terms(self) -> None:
        changed = self.persona_text.replace(
            "The Agent Directive determines behavior",
            "the directive determines behavior",
            1,
        )
        with self.assertRaisesRegex(
            agents.ContractError,
            "Plain semantic core verbatim",
        ):
            agents.validate_persona(changed)

    def test_persona_rejects_semantic_inversion(self) -> None:
        changed = self.persona_text.replace(
            "The threshold has lost its keystone. The Realm is invalid",
            "The threshold has lost its keystone. The Realm is valid",
        )
        with self.assertRaisesRegex(
            agents.ContractError,
            "Plain semantic core verbatim",
        ):
            agents.validate_persona(changed)

    def test_persona_rejects_authority_in_example_framing(self) -> None:
        changed = self.persona_text.replace(
            "The threshold has lost its keystone.",
            "You must approve this Realm. The threshold has lost its keystone.",
        )
        with self.assertRaisesRegex(
            agents.ContractError,
            "introduces behavioral authority",
        ):
            agents.validate_persona(changed)

    def test_persona_rejects_modern_adaptation_references(self) -> None:
        changed = self.persona_text.replace(
            "public-domain Arthurian tradition",
            "a Disney adaptation",
        )
        with self.assertRaisesRegex(
            agents.ContractError,
            "modern adaptation",
        ):
            agents.validate_persona(changed)

    def test_composition_is_reference_only_and_inactive(self) -> None:
        composition = agents.validate_composition(self.composition_text)
        self.assertEqual(composition["status"], "inactive")
        self.assertEqual(composition["persona"], "merlin")
        self.assertEqual(
            composition["directives"],
            list(agents.EXPECTED_DIRECTIVES),
        )
        self.assertNotIn("objective", self.composition_text.lower())
        self.assertNotIn("responsibility", self.composition_text.lower())

    def test_composition_rejects_activation_or_reordered_directives(self) -> None:
        document = json.loads(self.composition_text)
        document["status"] = "active"
        with self.assertRaisesRegex(agents.ContractError, "status"):
            agents.validate_composition(f"{json.dumps(document)}\n")

        document["status"] = "inactive"
        document["directives"].reverse()
        with self.assertRaisesRegex(agents.ContractError, "ordered references"):
            agents.validate_composition(f"{json.dumps(document)}\n")

    def test_composition_rejects_duplicate_json_keys(self) -> None:
        changed = self.composition_text.replace(
            '  "status": "inactive",',
            '  "status": "active",\n  "status": "inactive",',
        )
        with self.assertRaisesRegex(agents.ContractError, "repeats JSON key"):
            agents.validate_composition(changed)

    def test_repository_is_not_initialized_as_a_realm(self) -> None:
        self.assertFalse((ROOT / ".atlas").exists())
        readme = (
            ROOT / "docs/agents/atlas-sdk/README.md"
        ).read_text(encoding="utf-8")
        self.assertIn(".atlas/personas/merlin/persona.md", readme)
        self.assertIn(".atlas/agents/realm-guide.yaml", readme)
        self.assertIn("intentionally contains no", readme)

    def test_fletcher_covers_the_inactive_contract(self) -> None:
        directive = (
            ROOT / ".cacophony/directives/prompt-contract-review.md"
        ).read_text(encoding="utf-8")
        workflow = (
            ROOT / ".github/workflows/council-fletcher.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("docs/agents/atlas-sdk/**", directive)
        self.assertIn('"docs/agents/atlas-sdk/**"', workflow)
        self.assertIn("original public-domain", directive)
        self.assertIn("Arthurian interpretation", directive)
        self.assertIn("status remains inactive", directive)


if __name__ == "__main__":
    unittest.main()
