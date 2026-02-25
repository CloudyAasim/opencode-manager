# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.6] - 2026-02-24

### Added

- Core memory tools: `memory-read`, `memory-write`, `memory-edit`, `memory-delete`, `memory-health`
- Planning state tools: `memory-planning-update` and `memory-planning-get` for tracking session objectives, phases, findings, and errors
- `memory-plan-execute` tool for creating new Code sessions with approved implementation plans
- Three embedding providers: local (`all-MiniLM-L6-v2`), OpenAI (`text-embedding-3-small/large`, `ada-002`), and Voyage (`voyage-code-3`, `voyage-2`)
- Bundled Code agent (`ocm-code`) with memory-aware coding workflows
- Bundled Architect agent (`ocm-architect`) for read-only planning with automatic plan handoff
- Bundled Memory agent (`ocm-memory`) for expert knowledge curation and post-compaction extraction
- Compaction context injection with custom prompt, planning state, conventions, and decisions
- Configurable compaction settings: custom prompt, inline planning, token budget, snapshot storage
- CLI export/import for backing up and migrating memories as JSON or Markdown
- Embedding cache with SHA-256 keying and 24-hour TTL
- Embedding sync service with batch processing and retry logic
- Session state KV store with TTL management (7-day planning, 24-hour snapshots)
- Automatic deduplication via exact match and semantic similarity detection
- Dimension mismatch detection on startup with guided recovery via reindex
- Build-time version injection displayed in `memory-health` output
- Automatic model download via `postinstall` script
- Auto-copy of bundled config on first run
- SQLite storage with `sqlite-vec` for vector similarity search
