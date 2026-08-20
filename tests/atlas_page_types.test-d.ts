import type { AtlasPageEnvelope } from "../src/domain/atlas_page.ts";

const page: AtlasPageEnvelope = {
  sdk: {
    "atlas-sdk-schema": "1.0.0",
    "created-at": "2024-02-29T12:30:45Z",
    "created-by": { kind: "agent", name: "Test Agent" },
    id: "custom:typed",
    "local-atlas-schema": "2.0.0",
    tags: ["typed"],
    title: "Typed Page",
    type: "custom",
    "updated-at": "2024-02-29T13:30:45+01:00",
    "updated-by": { kind: "human", name: "Test Reviewer" },
  },
  body: "Body",
  atlas: { nested: { labels: ["one", "two"] } },
};

// @ts-expect-error Atlas page properties are readonly.
page.body = "Changed";
// @ts-expect-error Atlas SDK metadata is readonly.
page.sdk.title = "Changed";
// @ts-expect-error Nested Atlas arrays are readonly.
page.atlas["nested"].labels.push("changed"); // eslint-disable-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
