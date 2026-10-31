#!/usr/bin/env bash
# Validate each skill against the androidskills.dev registry contract and CLI packaging
# invariants before the registry or npm publish does it for us.
#
#   ./scripts/check-skills.sh
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
status=0

fail() { echo "FAIL  $*" >&2; status=1; }
pass() { echo "ok    $*"; }

# Validate top-level JSON manifests (plugin, hooks, npm package).
for jf in \
    "$root/package.json" \
    "$root/plugin.json" \
    "$root/.claude-plugin/plugin.json" \
    "$root/.claude-plugin/marketplace.json" \
    "$root/hooks.json" \
    "$root/hooks/hooks.json"
do
    if [[ -f "$jf" ]]; then
        python3 -m json.tool "$jf" >/dev/null 2>&1 || fail "${jf#"$root/"}: invalid JSON"
    else
        fail "${jf#"$root/"}: missing manifest"
    fi
done

[[ -x "$root/cli/launcher/android-ux" ]] || fail "cli/launcher/android-ux: missing or not executable"
[[ -x "$root/cli/bin/android-ux.mjs" ]] || fail "cli/bin/android-ux.mjs: missing or not executable"

for dir in "$root"/skills/*/; do
    skill="$(basename "$dir")"
    skill_failed=0
    skill_fail() { fail "$@"; skill_failed=1; }

    # Slug is the directory name. Registry pattern: ^[a-z0-9]+(-[a-z0-9]+)*$
    if [[ ! "$skill" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
        skill_fail "$skill: directory name is not a valid slug"
    fi

    manifest="$dir/SKILL.md"
    [[ -f "$manifest" ]] || { skill_fail "$skill: no SKILL.md"; continue; }

    # Frontmatter must be the first thing in the file.
    head -1 "$manifest" | grep -qE '^-{3,}$' || skill_fail "$skill: SKILL.md does not open with frontmatter"

    fm="$(awk 'NR>1 && /^-{3,}[[:space:]]*$/{exit} NR>1{print}' "$manifest")"

    # name, description and license are required; name must equal the directory.
    name="$(grep -m1 '^name:' <<<"$fm" | sed 's/^name:[[:space:]]*//')"
    [[ -n "$name" ]] || skill_fail "$skill: frontmatter has no name"
    [[ "$name" == "$skill" ]] || skill_fail "$skill: frontmatter name '$name' does not match directory"
    grep -qE '^description:' <<<"$fm" || skill_fail "$skill: frontmatter has no description"
    grep -qE '^license:' <<<"$fm" || skill_fail "$skill: frontmatter has no license"

    # metadata.version, when present, must be strict SemVer — the registry rejects
    # anything else, and rejects inline flow maps for metadata entirely.
    if grep -qE '^metadata:' <<<"$fm"; then
        grep -qE '^metadata:[[:space:]]*\{' <<<"$fm" && \
            skill_fail "$skill: metadata must be a block mapping, not an inline flow map"
        ver="$(grep -m1 -E '^[[:space:]]+version:' <<<"$fm" | sed -E 's/.*version:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/')"
        if [[ -n "$ver" ]] && ! [[ "$ver" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
            skill_fail "$skill: metadata.version '$ver' is not strict SemVer"
        fi
    fi

    # Tags: lowercase, 1-40 chars, first character alphanumeric.
    while read -r tag; do
        [[ -z "$tag" ]] && continue
        [[ "$tag" =~ ^[a-z0-9][a-z0-9._+-]{0,39}$ ]] || skill_fail "$skill: invalid tag '$tag'"
    done < <(awk '/^tags:/{f=1;next} f&&/^[[:space:]]*-[[:space:]]/{sub(/^[[:space:]]*-[[:space:]]*/,"");print;next} f&&!/^[[:space:]]/{exit}' <<<"$fm")

    # Only SKILL.md, files in the skill root, references/** and scripts/** are ingested.
    # evals/** is allowed here but is not ingested by the registry and is stripped by
    # Pioneer before an actor ever sees it, so it costs nothing in the bundle.
    while IFS= read -r f; do
        rel="${f#"$dir"}"
        case "$rel" in
            */*) [[ "$rel" == references/* || "$rel" == scripts/* || "$rel" == evals/* ]] || \
                     skill_fail "$skill: '$rel' is outside the ingestible set" ;;
        esac
    done < <(find "$dir" -type f ! -path '*/.git/*')

    # Bundled CLI & cross-OS launchers must exist in every skill's scripts/ directory,
    # stay below 512 KiB, and never leak eval case IDs or phantom-language fixture tokens.
    sh_launcher="$dir/scripts/android-ux"
    cmd_launcher="$dir/scripts/android-ux.cmd"
    mjs_bundle="$dir/scripts/android-ux.mjs"

    [[ -f "$sh_launcher" ]] || skill_fail "$skill: missing scripts/android-ux"
    [[ -x "$sh_launcher" ]] || skill_fail "$skill: scripts/android-ux is not executable"
    [[ -f "$cmd_launcher" ]] || skill_fail "$skill: missing scripts/android-ux.cmd"
    if [[ -f "$mjs_bundle" ]]; then
        bundle_bytes="$(wc -c < "$mjs_bundle" | tr -d ' ')"
        if [[ "${bundle_bytes:-0}" -gt $((512 * 1024)) ]]; then
            skill_fail "$skill: scripts/android-ux.mjs is ${bundle_bytes} bytes, over the 512 KiB bundle cap"
        fi
        if grep -qiE '\bc[0-9]{2}\b|AppMotion\b|destinationEnter|destinationExit|surfaceExpand|OnboardingPager|LegacyPagerHost' "$mjs_bundle"; then
            skill_fail "$skill: scripts/android-ux.mjs leaks eval case IDs or phantom-language fixture names"
        fi
    else
        skill_fail "$skill: missing scripts/android-ux.mjs"
    fi

    # Provenance sidecar must be valid JSON. It is excluded from the ingested bundle, so
    # a malformed one fails here or nowhere.
    sidecar="$dir/skill-source.json"
    if [[ -f "$sidecar" ]]; then
        python3 -m json.tool "$sidecar" >/dev/null 2>&1 || skill_fail "$skill: skill-source.json is not valid JSON"
    else
        skill_fail "$skill: no skill-source.json"
    fi

    # 10 MiB per skill, measured over what would actually be ingested.
    # Done in Python because `find -printf` and `paste -sd+` are GNU-only and fail
    # silently on macOS, which would turn this check into a no-op on half the machines
    # that run it.
    bytes="$(python3 - "$dir" <<'PY'
import os, sys
root = sys.argv[1]
total = 0
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in (".git", "evals")]
    for name in filenames:
        if name == "skill-source.json":
            continue
        total += os.path.getsize(os.path.join(dirpath, name))
print(total)
PY
)"
    if [[ "${bytes:-0}" -gt $((10 * 1024 * 1024)) ]]; then
        skill_fail "$skill: ingestible content is ${bytes} bytes, over the 10 MiB limit"
    fi

    [[ $skill_failed -eq 0 ]] && pass "$skill"
done

# Every rule id cited by a skill OR registered in cli/src/domains/motion/catalog.mjs must
# exist in STANDARDS.md. A skill or CLI enforcing a rule that was cut is worse than one
# enforcing nothing.
ids="$(grep -oE '^### [FOT]-[0-9]+' "$root/STANDARDS.md" | awk '{print $2}' | sort -u)"
while IFS= read -r cited; do
    grep -qx "$cited" <<<"$ids" || fail "SKILL.md files cite $cited, which is not in STANDARDS.md"
done < <(grep -ohE '\b[FOT]-[0-9]{3}\b' "$root"/skills/*/SKILL.md | sort -u)

if [[ -f "$root/cli/src/domains/motion/catalog.mjs" ]]; then
    while IFS= read -r cat_id; do
        grep -qx "$cat_id" <<<"$ids" || fail "cli/src/domains/motion/catalog.mjs defines $cat_id, which is not in STANDARDS.md"
    done < <(grep -ohE '\b[FOT]-[0-9]{3}\b' "$root/cli/src/domains/motion/catalog.mjs" | sort -u)
fi

[[ $status -eq 0 ]] && echo "all skills and CLI bundles satisfy the registry contract"
exit $status
