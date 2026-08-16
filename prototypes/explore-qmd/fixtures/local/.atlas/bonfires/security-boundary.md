---
atlas:
  id: bonfire-security
  type: bonfire
  title: Security Boundary
  updated: 2026-08-16
---

# Security Boundary

Authentication establishes identity. Session rotation limits the lifetime of
stolen credentials.[^session]

Follow [[insights/session-rotation]] for the current application behavior.
The payments Realm contains the token-validation boundary used after login.

[^session]: [[lore/auth-design]]

