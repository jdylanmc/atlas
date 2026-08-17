import type { RealmPageEnvelope } from "../src/domain/realm_page.ts";

const page: RealmPageEnvelope = {
  atlas: {
    "atlas-schema": "1.0.0",
    "created-at": "2024-02-29T12:30:45Z",
    "created-by": { kind: "agent", name: "Test Agent" },
    id: "custom:typed",
    "realm-schema": "2.0.0",
    tags: ["typed"],
    title: "Typed Page",
    type: "custom",
    "updated-at": "2024-02-29T13:30:45+01:00",
    "updated-by": { kind: "human", name: "Test Reviewer" },
  },
  body: "Body",
  realm: { nested: { labels: ["one", "two"] } },
};

// @ts-expect-error Realm page properties are readonly.
page.body = "Changed";
// @ts-expect-error Atlas metadata is readonly.
page.atlas.title = "Changed";
// @ts-expect-error Nested Realm arrays are readonly.
page.realm["nested"].labels.push("changed"); // eslint-disable-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
