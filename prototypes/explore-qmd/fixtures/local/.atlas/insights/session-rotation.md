---
atlas:
  id: insight-session-rotation
  type: insight
  title: Session Rotation
  updated: 2026-08-16
---

# Session Rotation

Refresh tokens rotate after successful use. Reusing an invalidated refresh
token revokes the entire session family.[^design]

[^design]: [[lore/auth-design]]

