# Trace implementation guide

Trace is a local macOS circuit and firmware workbench. Read [product](docs/product.md), [architecture](docs/architecture.md), [design](docs/design.md), and [status](docs/status.md) before extending it. Status records actual verification and remaining work.

## Commands
- `npm ci` installs locked dependencies.
- `npm run dev` builds the desktop bridge, starts Vite, and launches Electron.
- `npm run dev:web` runs the manual editor in a browser; desktop services are explicitly unavailable.
- `npm run build` typechecks and produces renderer/desktop bundles.
- `npm start` launches the built desktop application.
- `npm run check` typechecks and runs focused domain/service tests.
- `npm run test:e2e` exercises the actual Electron application after building.

## Invariants
- Domain code cannot import React, Electron, or view state. Canonical connectivity is explicit endpoints; crossings/proximity never connect.
- Human and agent mutations use validated atomic transactions with an expected revision. Undo/redo also advance revisions.
- Terminal IDs belong to versioned part packages. Artwork and labels never establish electrical identity.
- Evidence, recommended conditions, absolute maxima, and unknowns must remain distinct. Never report universal electrical correctness.
- Keep credentials in main-process encrypted local storage; never send stored keys to the renderer, projects, model context, logs, or Git.
- No inference for selections, typing, movement, layout, checks, or suggestion presentation. Model calls require an eligible task and enforced budgets.
- No arbitrary model-generated shell commands. Build processes use fixed executables, validated arguments, bounded output, timeout, and cancellation.
- Add no publishing, submissions, messaging, domains, or physical operations without explicit user authorization.

## Delegation
The integrator owns shared schema, command contracts, dependencies, lockfile, tokens, and integration. At most two workers; never recursive delegation. Tools share this checkout. Prefer read-only reviews until interfaces are stable; independent writing must use disjoint files or isolated worktrees. Record scope and acceptance criteria, integrate frequently, and run the app. Preserve user changes.
