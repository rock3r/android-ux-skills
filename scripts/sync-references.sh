#!/usr/bin/env bash
# Generate each skill's references/standards.md from the single root STANDARDS.md.
#
# The registry scopes references/** per skill, so every skill needs its own copy of the
# rules. Copies drift. This makes the root file the only source anyone edits, and the
# copies reproducible — run it after changing STANDARDS.md, and in CI to verify nothing
# was hand-edited downstream.
#
#   ./scripts/sync-references.sh          write the copies
#   ./scripts/sync-references.sh --check  fail if any copy is out of date
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_file="$root/STANDARDS.md"
check_only=false
[[ "${1:-}" == "--check" ]] && check_only=true

[[ -f "$source_file" ]] || { echo "error: $source_file not found" >&2; exit 1; }

header='<!-- GENERATED FILE — do not edit.
     Source: STANDARDS.md at the repository root.
     Regenerate with ./scripts/sync-references.sh -->
'

status=0
for skill_dir in "$root"/skills/*/; do
    skill="$(basename "$skill_dir")"
    target="$skill_dir/references/standards.md"
    mkdir -p "$skill_dir/references"

    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    printf '%s\n' "$header" > "$tmp"
    # Repo-root siblings do not travel with a skill bundle, so a relative link to one is
    # broken for anyone who installs the skill. Demote those links to plain text.
    sed -E 's/\[`?([^]`]+)`?\]\((REVISION-[0-9]+\.md|README\.md)\)/\1/g' "$source_file" >> "$tmp"

    if $check_only; then
        if ! cmp -s "$tmp" "$target"; then
            echo "out of date: skills/$skill/references/standards.md" >&2
            status=1
        fi
    else
        mv "$tmp" "$target"
        trap - EXIT
        echo "wrote skills/$skill/references/standards.md"
    fi
done

if $check_only && [[ $status -eq 0 ]]; then
    echo "all skill references are in sync with STANDARDS.md"
fi
exit $status
