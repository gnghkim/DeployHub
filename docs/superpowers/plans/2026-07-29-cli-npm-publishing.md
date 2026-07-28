# CLI npm Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare `@deployhub/cli` version 0.1.0 for a human-reviewed public npm release without changing CLI behavior.

**Architecture:** Keep the CLI as a single tsup-generated ESM bundle with no published runtime dependencies. Add npm metadata and public documentation around the existing CLI while preserving its commands, build configuration, and repository registration instructions.

**Tech Stack:** Node.js 22, pnpm 9, TypeScript, tsup, npm package tarballs

---

### Task 1: Package metadata and lockfile

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] Set the package version to `0.1.0`, remove `private`, and add the description, `files`, Node engine, repository, homepage, bugs, MIT license, and public publish configuration.
- [ ] Keep `dependencies` empty and move `@deployhub/manifest`, `commander`, and `yaml` to `devDependencies`, because `tsup.config.ts` already bundles every external module.
- [ ] Add `prepublishOnly` using the existing build script.
- [ ] Run `pnpm install --lockfile-only` and confirm the CLI importer records all four build-time packages under `devDependencies`.

### Task 2: License and user documentation

**Files:**
- Create: `LICENSE`
- Modify: `README.md`
- Create: `templates/AGENTS.deployhub.md`
- Create: `docs/cli-npm-publishing.md`

- [ ] Add the standard MIT license with `Copyright (c) 2026 gnghkim` at the repository root only.
- [ ] Document npm installation, the reusable AGENTS template, the publishing guide, and the MIT license in `README.md`.
- [ ] Create a reusable registration template that uses the installed `deployhub` binary and retains all secret-handling and human-approval safeguards.
- [ ] Document the seven proof steps, keeping actual `npm publish` as a human-only final action.

### Task 3: Release proof and commit

**Files:**
- Verify only: `packages/cli/dist/index.js`
- Exclude from commit: `_CARD.md`

- [ ] Run frozen installation, CLI typecheck, the full test suite, and the CLI build.
- [ ] Run `npm pack --dry-run` and confirm only `package.json` and `dist/index.js` are included.
- [ ] Create and inspect the tarball outside the repository.
- [ ] Install the tarball in a second empty directory outside the repository, run `deployhub init --detect` with a loopback URL, and confirm it creates `deployhub.yaml`.
- [ ] Review the final diff, verify `_CARD.md` is untracked and unstaged, then commit the release-preparation files.
