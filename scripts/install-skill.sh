#!/usr/bin/env bash
# Installs the sepia skill + always-on instruction files into every editor
# dir it can find.
#
# Two channels:
#   1. The Agent Skill (SKILL.md) — on-demand: the editor lists it, the model
#      loads it when relevant.
#   2. Always-on instructions (always-on/) — injected into EVERY session by
#      the editor's own instruction system (VS Code prompts, Cursor rules,
#      Claude Code CLAUDE.md). Skills alone don't cut it: every platform
#      loads skill bodies only on demand.
#
# Idempotent: re-running overwrites in place, never duplicates.
#
# VERIFIES what it wrote. Every installed copy must end up advertising the same
# version as the source (frontmatter `version: "X"`, `sepia-docs-version: X`, or
# `Docs version: X`) — a copy that silently keeps an old version is the exact
# failure this script exists to prevent, so it exits non-zero instead.
#
# KEEP IN SYNC with scripts/remote-install.sh (`replace_section`) — that is the
# copy served at /install for `curl | bash`. Both must replace the
# <!-- sepia:start --> … <!-- sepia:end --> block IN PLACE: an installer that
# skips already-present blocks leaves stale instructions on every machine that
# ran an older version.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../skills/sepia" && pwd)"

if [ ! -f "$SRC/SKILL.md" ]; then
  echo "error: $SRC/SKILL.md not found" >&2
  exit 1
fi

# The version a file advertises — any of the three marker forms
# (sepia-docs-version comment, `Docs version:` line, `version:` frontmatter).
#
# Whole-line anchored, mirroring scripts/docs-manifest.ts: a marker QUOTED
# inside prose is not a marker, so a doc that shows the format in a sentence
# cannot make this return the wrong version.
#
# awk rather than `sed | head -1`: head closes the pipe after one line, so sed
# dies of SIGPIPE and `set -o pipefail` turns that into a silent abort. awk's
# explicit exit stops after the first match without breaking anything.
#
# KEEP IN SYNC with scripts/remote-install.sh's file_version — it cannot be
# shared, because that script is served standalone to `curl | bash`.
file_version() {
  awk '
    /^[[:space:]]*<!--[[:space:]]*sepia-docs-version:[[:space:]]*[0-9]/ {
      v = $0; sub(/.*sepia-docs-version:[[:space:]]*/, "", v); sub(/[^0-9.].*/, "", v)
      print v; exit
    }
    /^version:[[:space:]]*"[0-9]/ {
      v = $0; sub(/^version:[[:space:]]*"/, "", v); sub(/".*/, "", v)
      print v; exit
    }
    /^Docs version:[[:space:]]*[0-9]/ {
      v = $0; sub(/^Docs version:[[:space:]]*/, "", v); sub(/[^0-9.].*/, "", v)
      print v; exit
    }
  ' "$1" 2>/dev/null
}

VERSION="$(file_version "$SRC/SKILL.md" || true)"
if [ -z "$VERSION" ]; then
  echo "error: no version marker in $SRC/SKILL.md (run bun run scripts/stamp-docs-version.ts)" >&2
  exit 1
fi

# Fail loudly if a destination did not land at the source version. `|| true` so a
# missing/unreadable file reports itself instead of aborting on the assignment.
verify() {
  local file="$1" got
  got="$(file_version "$file" || true)"
  if [ "$got" != "$VERSION" ]; then
    echo "error: $file is at ${got:-no version marker}, expected $VERSION — install incomplete" >&2
    exit 1
  fi
}

install_to() {
  mkdir -p "$1"
  cp -R "$SRC/." "$1/"
  verify "$1/SKILL.md"
  echo "installed → $1 (v$VERSION)"
}

# Replace or append a section to a file idempotently. The section is wrapped
# in block markers (<!-- sepia:start --> … <!-- sepia:end -->) so re-running
# UPDATES the section in place instead of duplicating it — this is how
# installed copies get new docs versions.
append_section() {
  local file="$1" section="$2"
  local start_marker="<!-- sepia:start -->"
  local end_marker="<!-- sepia:end -->"
  mkdir -p "$(dirname "$file")"
  if [ -f "$file" ] && grep -qF "$start_marker" "$file"; then
    # Replace everything between the markers (inclusive) with the new section.
    {
      sed "/^${start_marker}$/,/^${end_marker}$/d" "$file"
      printf '%s\n' "$start_marker"
      cat "$section"
      printf '%s\n' "$end_marker"
    } > "$file.tmp" && mv "$file.tmp" "$file"
    verify "$file"
    echo "updated → $file (v$VERSION)"
  else
    { [ -f "$file" ] && printf '\n'; printf '%s\n' "$start_marker"; cat "$section"; printf '%s\n' "$end_marker"; } >> "$file"
    verify "$file"
    echo "appended → $file (v$VERSION)"
  fi
}

# ── Channel 1: the Agent Skill (on-demand) ────────────────────────────────
[ -d "$HOME/.agents/skills" ] && install_to "$HOME/.agents/skills/sepia"
[ -d "$HOME/.cursor/skills" ] && install_to "$HOME/.cursor/skills/sepia"
[ -d "$HOME/.claude/skills" ] && install_to "$HOME/.claude/skills/sepia"
[ -d "$HOME/.codex/skills" ] && install_to "$HOME/.codex/skills/sepia"
[ -d "$HOME/.opencode/skills" ] && install_to "$HOME/.opencode/skills/sepia"

# ── Channel 2: always-on instructions (every session, no invocation) ───────
# VS Code Copilot — user-level prompts folder (*.instructions.md with
# applyTo '**/*' is auto-attached to every chat request).
VSCODE_PROMPTS="${VSCODE_USER_PROMPTS_FOLDER:-$HOME/.config/Code/User/prompts}"
if [ -d "$VSCODE_PROMPTS" ]; then
  cp "$SRC/always-on/vscode.instructions.md" "$VSCODE_PROMPTS/sepia.instructions.md"
  verify "$VSCODE_PROMPTS/sepia.instructions.md"
  echo "installed → $VSCODE_PROMPTS/sepia.instructions.md (v$VERSION)"
fi

# Cursor — user rules (alwaysApply: true → every session, unconditionally).
if [ -d "$HOME/.cursor" ]; then
  mkdir -p "$HOME/.cursor/rules"
  cp "$SRC/always-on/cursor.mdc" "$HOME/.cursor/rules/sepia.mdc"
  verify "$HOME/.cursor/rules/sepia.mdc"
  echo "installed → $HOME/.cursor/rules/sepia.mdc (v$VERSION)"
fi

# Claude Code — user-global CLAUDE.md (loaded at the start of every session).
if [ -d "$HOME/.claude" ]; then
  append_section "$HOME/.claude/CLAUDE.md" "$SRC/always-on/claude.md"
fi

# Codex — user-global AGENTS.md.
if [ -d "$HOME/.codex" ]; then
  append_section "$HOME/.codex/AGENTS.md" "$SRC/always-on/agents.md"
fi

# OpenCode — user-global AGENTS.md.
if [ -d "$HOME/.config/opencode" ]; then
  append_section "$HOME/.config/opencode/AGENTS.md" "$SRC/always-on/agents.md"
fi

# AGENTS.md (Codex, Cursor, Copilot, any agentsmd-compliant agent) — install
# into the current repo's AGENTS.md if one exists, else print the snippet.
if [ -f "AGENTS.md" ]; then
  append_section "AGENTS.md" "$SRC/always-on/agents.md"
else
  echo "note: no AGENTS.md in $(pwd) — append skills/sepia/always-on/agents.md manually for repo-level agents"
fi

echo "Done — every copy is at v$VERSION. Restart your editor to pick up the skill + always-on instructions."
echo "Verify anytime: bun run scripts/check-docs-version.ts"
