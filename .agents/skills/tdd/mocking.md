# When to Mock

Substitute effects at established system boundaries:

- Time and randomness: supply fixed values when the operation accepts them.
- Filesystem and Git: use existing disposable repository fixtures or runtime
  adapters, depending on which behavior the test must prove.
- External services: keep them outside the deterministic SDK; use captured,
  synthetic input at its existing validated boundary.

Do not mock Atlas's own parsing, validation, graph traversal, or internal
collaborators merely to make a test pass. A fake filesystem cannot prove a
real filesystem safety property, and a runtime stub cannot prove the installed
CLI's integration behavior.

## Dependency injection

Pass effects through an existing typed seam rather than creating them inside
the logic. These TypeScript examples use hypothetical commerce interfaces,
not an Atlas payment integration:

```typescript
interface PaymentClient {
  charge(amount: number): Promise<PaymentReceipt>;
}

// Easy to substitute at the system boundary.
async function processPayment(
  order: Order,
  client: PaymentClient,
): Promise<PaymentReceipt> {
  return client.charge(order.total);
}

// Hard to isolate.
async function processLivePayment(order: Order): Promise<PaymentReceipt> {
  const client = new LivePaymentClient();
  return client.charge(order.total);
}
```

## Specific operations over generic transports

Prefer a domain-facing interface with typed operations:

```typescript
interface StoreClient {
  user(id: string): Promise<User>;
  orders(userId: string): Promise<readonly Order[]>;
  createOrder(draft: OrderDraft): Promise<Order>;
}
```

Each substitute returns one known shape without decoding transport details
to discover which operation a test intended. A shared low-level transport
can still exist behind that interface.

Reuse existing Atlas runtime interfaces and fixtures before introducing
another adapter. Preserve inward import boundaries; do not pull Node
filesystem or process APIs into the deterministic layers for convenience.
