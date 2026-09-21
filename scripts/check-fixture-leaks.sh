#!/usr/bin/env bash
# Fail when an eval fixture's path or content tells the agent what it is supposed to find.
#
# Pioneer stages files into each arm's fixtures/ directory, lists every one in case.json,
# and prints them to stderr. Filenames are fully visible to the agent under test. A fixture
# called MOTION-stale.md, or one living under rough-tier/, hands over the answer — the eval
# still runs, still scores, and the score is meaningless in a flattering direction.
#
# The rule: the agent must see only what a developer would see in a real checkout.
#
# Run before `pioneer eval prepare`. Upstream proposal to move this into Pioneer itself:
# https://github.com/rock3r/pioneer/issues/64
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
status=0

# Terms that describe what a fixture contains rather than what it is.
terms='stale|bug|defect|bad|good|broken|wrong|negative|positive|rough|showcase|expected|fixture|case|violating|compliant'

# Matched on word boundaries within a path component, not as raw substrings: BadgeCase.kt,
# GoodsList.kt and BugsnagClient.kt are legitimate filenames and must not trip this.
split_words() { sed -E 's/([a-z0-9])([A-Z])/\1 \2/g; s/[^A-Za-z0-9]+/ /g' <<<"$1" | tr '[:upper:]' '[:lower:]'; }

while IFS= read -r -d '' file; do
    rel="${file#"$root"/}"

    # Only the staged portion of the path is visible to the agent.
    staged="${rel#*/evals/files/}"

    while IFS='/' read -ra parts; do
        for part in "${parts[@]}"; do
            for word in $(split_words "$part"); do
                if grep -qxE "$terms" <<<"$word"; then
                    echo "LEAK  path   $rel" >&2
                    echo "             component '$part' contains '$word'" >&2
                    status=1
                fi
            done
        done
    done <<<"$staged"

    # Markers a real checkout would not carry at the exact spot under test.
    if grep -nE '(BUG:|FIXME|XXX|TODO-EVAL|@violating|@compliant)' "$file" >/dev/null 2>&1; then
        echo "LEAK  content $rel" >&2
        grep -nE '(BUG:|FIXME|XXX|TODO-EVAL|@violating|@compliant)' "$file" | sed 's/^/             /' >&2
        status=1
    fi
done < <(find "$root"/skills/*/evals/files -type f -print0 2>/dev/null || true)

# Within ONE directory, two fixtures whose names differ only by a suffix let a model infer
# it is looking at a comparison — Screen.kt beside Screen_fixed.kt gives the game away.
#
# Identical names in DIFFERENT directories are the opposite: that is the battery pattern,
# where every variant stages the same filename so the agent cannot tell them apart. Only
# compare within a directory, never across.
while IFS= read -r dir; do
    dupes=$(find "$dir" -maxdepth 1 -type f -exec basename {} \; 2>/dev/null \
        | sed -E 's/[-_][a-z0-9]+(\.[a-z]+)$/\1/' | sort | uniq -d)
    if [[ -n "$dupes" ]]; then
        echo "WARN  near-identical siblings in ${dir#"$root"/}:" >&2
        sed 's/^/             /' <<<"$dupes" >&2
        echo "             a suffixed twin implies a comparison; use separate batteries" >&2
    fi
done < <(find "$root"/skills/*/evals/files -mindepth 1 -type d 2>/dev/null || true)

if [[ $status -eq 0 ]]; then
    echo "no fixture leaks found"
fi
exit $status
