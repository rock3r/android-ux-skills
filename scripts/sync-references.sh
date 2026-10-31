#!/usr/bin/env bash
# Generate each skill's references/standards.md from the single root STANDARDS.md, and
# bundle the self-contained zero-dependency CLI + cross-OS launchers into skills/*/scripts/.
#
# The registry scopes references/** and scripts/** per skill, so every skill needs its own
# copy of STANDARDS.md and the bundled android-ux runtime. Copies drift. This makes the
# root files the only source anyone edits, and the copies reproducible — run it after
# changing STANDARDS.md or cli/**, and in CI to verify nothing was hand-edited downstream.
#
#   ./scripts/sync-references.sh          write the copies and bundle
#   ./scripts/sync-references.sh --check  fail if any copy or bundle is out of date
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_file="$root/STANDARDS.md"
esbuild_bin="$root/node_modules/.bin/esbuild"
launcher_sh="$root/cli/launcher/android-ux"
launcher_cmd="$root/cli/launcher/android-ux.cmd"
entry_mjs="$root/cli/bin/android-ux.mjs"

check_only=false
[[ "${1:-}" == "--check" ]] && check_only=true

[[ -f "$source_file" ]] || { echo "error: $source_file not found" >&2; exit 1; }
[[ -f "$launcher_sh" ]] || { echo "error: $launcher_sh not found" >&2; exit 1; }
[[ -f "$launcher_cmd" ]] || { echo "error: $launcher_cmd not found" >&2; exit 1; }
[[ -f "$entry_mjs" ]] || { echo "error: $entry_mjs not found" >&2; exit 1; }
[[ -x "$esbuild_bin" ]] || { echo "error: $esbuild_bin not found (run npm ci first)" >&2; exit 1; }

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

header='<!-- GENERATED FILE — do not edit.
     Source: STANDARDS.md at the repository root.
     Regenerate with ./scripts/sync-references.sh -->
'

std_tmp="$tmpdir/standards.md"
printf '%s\n' "$header" > "$std_tmp"
# Repo-root siblings do not travel with a skill bundle, so a relative link to one is
# broken for anyone who installs the skill. Demote those links to plain text.
sed -E 's/\[`?([^]`]+)`?\]\((REVISION-[0-9]+\.md|README\.md)\)/\1/g' "$source_file" >> "$std_tmp"

bundle_tmp="$tmpdir/android-ux.mjs"
"$esbuild_bin" "$entry_mjs" \
    --bundle \
    --platform=node \
    --format=esm \
    --target=node20 \
    --legal-comments=none \
    --outfile="$bundle_tmp" >/dev/null

status=0
for skill_dir in "$root"/skills/*/; do
    skill="$(basename "$skill_dir")"
    target_std="$skill_dir/references/standards.md"
    target_mjs="$skill_dir/scripts/android-ux.mjs"
    target_sh="$skill_dir/scripts/android-ux"
    target_cmd="$skill_dir/scripts/android-ux.cmd"

    if $check_only; then
        if ! cmp -s "$std_tmp" "$target_std"; then
            echo "out of date: skills/$skill/references/standards.md" >&2
            status=1
        fi
        if ! cmp -s "$bundle_tmp" "$target_mjs"; then
            echo "out of date: skills/$skill/scripts/android-ux.mjs" >&2
            status=1
        fi
        if ! cmp -s "$launcher_sh" "$target_sh"; then
            echo "out of date: skills/$skill/scripts/android-ux" >&2
            status=1
        elif [[ ! -x "$target_sh" ]]; then
            echo "not executable: skills/$skill/scripts/android-ux" >&2
            status=1
        fi
        if ! cmp -s "$launcher_cmd" "$target_cmd"; then
            echo "out of date: skills/$skill/scripts/android-ux.cmd" >&2
            status=1
        fi
    else
        mkdir -p "$skill_dir/references" "$skill_dir/scripts"
        cp "$std_tmp" "$target_std"
        cp "$bundle_tmp" "$target_mjs"
        cp "$launcher_sh" "$target_sh"
        chmod +x "$target_sh" "$target_mjs"
        cp "$launcher_cmd" "$target_cmd"
        echo "synced skills/$skill/{references/standards.md,scripts/android-ux*}"
    fi
done

if $check_only && [[ $status -eq 0 ]]; then
    echo "all skill references and bundled CLI launchers are in sync"
fi
exit $status
