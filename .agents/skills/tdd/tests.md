# Good and Bad Tests

Use `node:test` and `node:assert/strict`. The following TypeScript snippets use
hypothetical commerce interfaces, not Atlas features. Substitute the actual
approved seam and existing fixtures; do not add these example APIs.

## Good tests

Test observable behavior through the real interface:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

test("checkout confirms a valid cart", async () => {
  const cart = new Cart();
  cart.add({ price: 15 });
  const result = await checkout(cart, { paymentMethod: "card" });
  assert.equal(result.status, "confirmed");
});
```

A good test uses the public interface, describes what the caller gets, and
survives an internal refactor. Choose fixtures that actually reach the
required behavior, including meaningful failure paths.

## Implementation-coupled tests

```typescript
// BAD: asserts an internal collaboration instead of the result.
test("checkout calls the internal payment service", async () => {
  const payment = new PaymentSpy();
  const service = new CheckoutService(payment);
  await service.checkout({ items: [{ price: 15 }] });
  assert.deepEqual(payment.processedAmounts, [15]);
});
```

Watch for private-method tests, mocks of internal collaborators, and call-order
assertions that break while observable behavior remains correct. Interaction
assertions are appropriate only when that interaction is itself the contract,
such as refusing a write outside an approved proposal.

```typescript
// BAD: bypasses the interface to inspect storage.
test("creating a user writes a database row", () => {
  const database = UserDatabase.inMemory();
  const users = new UserDirectory(database);
  users.createUser({ name: "Alice" });
  assert.equal(database.countUsersNamed("Alice"), 1);
});

// GOOD: verifies through the caller's interface.
test("a created user is retrievable", () => {
  const users = UserDirectory.inMemory();
  const created = users.createUser({ name: "Alice" });
  const retrieved = users.user(created.id);
  assert.ok(retrieved);
  assert.equal(retrieved.name, "Alice");
});
```

## Tautological tests

Expected values must come from an independent source: a specification, worked
example, or known literal, not the implementation rewritten in the test.

```typescript
// BAD: recomputes the expected value the same way as the implementation.
const items = [{ price: 10 }, { price: 5 }];
assert.equal(calculateTotal(items), items.reduce((sum, item) => sum + item.price, 0));

// GOOD: an independently known result.
assert.equal(calculateTotal(items), 15);
```

For Atlas, assert the exact Operation Result shape, Finding, citation,
proposal change, or routed context that the requirement specifies. A command
that merely exits successfully does not prove the requested behavior.
