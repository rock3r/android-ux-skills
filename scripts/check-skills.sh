#!/usr/bin/env bash
# Validate each skill against the androidskills.dev registry contract, before the registry
# does it for us. Every check here mirrors a rejection the ingestion pipeline would make.
#
#   ./scripts/check-skills.sh
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
status=0

fail() { echo "FAIL  $*" >&2; status=1; }
pass() { echo "ok    $*"; }

for dir in "$root"/skills/*/; do
    skill="$(basename "$dir")"

    # Slug is the directory name. Registry pattern: ^[a-z0-9]+(-[a-z0-9]+)*$
    if [[ ! "$skill" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
        fail "$skill: directory name is not a valid slug"
    fi

    manifest="$dir/SKILL.md"
    [[ -f "$manifest" ]] || { fail "$skill: no SKILL.md"; continue; }

    # Frontmatter must be the first thing in the file.
    head -1 "$manifest" | grep -qE '^-{3,}$' || fail "$skill: SKILL.md does not open with frontmatter"

    fm="$(awk 'NR>1 && /^-{3,}[[:space:]]*$/{exit} NR>1{print}' "$manifest")"

    # name, description and license are required; name must equal the directory.
    name="$(grep -m1 '^name:' <<<"$fm" | sed 's/^name:[[:space:]]*//')"
    [[ -n "$name" ]] || fail "$skill: frontmatter has no name"
    [[ "$name" == "$skill" ]] || fail "$skill: frontmatter name '$name' does not match directory"
    grep -qE '^description:' <<<"$fm" || fail "$skill: frontmatter has no description"
    grep -qE '^license:' <<<"$fm" || fail "$skill: frontmatter has no license"

    # metadata.version, when present, must be strict SemVer — the registry rejects
    # anything else, and rejects inline flow maps for metadata entirely.
    if grep -qE '^metadata:' <<<"$fm"; then
        grep -qE '^metadata:[[:space:]]*\{' <<<"$fm" && \
            fail "$skill: metadata must be a block mapping, not an inline flow map"
        ver="$(grep -m1 -E '^[[:space:]]+version:' <<<"$fm" | sed -E 's/.*version:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/')"
        if [[ -n "$ver" ]] && ! [[ "$ver" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
            fail "$skill: metadata.version '$ver' is not strict SemVer"
        fi
    fi

    # Tags: lowercase, 1-40 chars, first character alphanumeric.
    while read -r tag; do
        [[ -z "$tag" ]] && continue
        [[ "$tag" =~ ^[a-z0-9][a-z0-9._+-]{0,39}$ ]] || fail "$skill: invalid tag '$tag'"
    done < <(awk '/^tags:/{f=1;next} f&&/^[[:space:]]*-[[:space:]]/{sub(/^[[:space:]]*-[[:space:]]*/,"");print;next} f&&!/^[[:space:]]/{exit}' <<<"$fm")

    # Only SKILL.md, files in the skill root, references/** and scripts/** are ingested.
    while IFS= read -r f; do
        rel="${f#"$dir"}"
        case "$rel" in
            */*) [[ "$rel" == references/* || "$rel" == scripts/* ]] || \
                     fail "$skill: '$rel' is outside the ingestible set" ;;
        esac
    done < <(find "$dir" -type f ! -path '*/.git/*')

    # Provenance sidecar must be valid JSON. It is excluded from the ingested bundle, so
    # a malformed one fails here or nowhere.
    sidecar="$dir/skill-source.json"
    if [[ -f "$sidecar" ]]; then
        python3 -m json.tool "$sidecar" >/dev/null 2>&1 || fail "$skill: skill-source.json is not valid JSON"
    else
        fail "$skill: no skill-source.json"
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
        fail "$skill: ingestible content is ${bytes} bytes, over the 10 MiB limit"
    fi

    [[ $status -eq 0 ]] && pass "$skill"
done

# Every rule id cited by a skill must exist in STANDARDS.md. A skill enforcing a rule that
# was cut is worse than one enforcing nothing.
ids="$(grep -oE '^### [FOT]-[0-9]+' "$root/STANDARDS.md" | awk '{print $2}' | sort -u)"
while IFS= read -r cited; do
    grep -qx "$cited" <<<"$ids" || fail "SKILL.md files cite $cited, which is not in STANDARDS.md"
done < <(grep -ohE '\b[FOT]-[0-9]{3}\b' "$root"/skills/*/SKILL.md | sort -u)

[[ $status -eq 0 ]] && echo "all skills satisfy the registry contract"
exit $status
