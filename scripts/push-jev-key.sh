#!/usr/bin/env bash
# Push a Jev API key from a 1Password vault to the machine that runs the evals.
#
# Run this ON the machine where `op` works — the one with the 1Password desktop app and a
# GUI session. Not on the eval runner, and not through an agent.
#
# Why it pushes rather than the runner pulling: 1Password's desktop app integration is
# bound to your GUI login session. Over SSH, `op` reports "No accounts configured" no
# matter what you approve, and `op signin` only exports a session token into the shell it
# was run in. So the vault side has to initiate.
#
#   ./push-jev-key.sh bepi "op://Private/TypeSafe/test api key"
#
# The key goes to the runner's per-user tmpfs: RAM only, 0600 in a 0700 directory, gone on
# reboot. It is never written to a disk on either machine and never appears in an argument
# list, so it stays out of the process table and out of shell history.
#
# The alternative, if you would rather the runner fetch it unattended, is a 1Password
# service account token on the runner. That is the supported automation path, but a
# service account cannot read a Private vault — the item has to live in a shared one.
set -euo pipefail

runner="${1:-}"
ref="${2:-}"

if [[ -z $runner || -z $ref ]]; then
    echo "usage: $0 <runner-ssh-host> <op://vault/item/field>" >&2
    exit 64
fi

if ! command -v op >/dev/null; then
    echo "error: the 1Password CLI is not installed here." >&2
    echo "  Run this on the machine with the 1Password app, not on the runner." >&2
    exit 1
fi

if ! op whoami >/dev/null 2>&1; then
    echo "error: op is not signed in. Unlock 1Password and enable Settings > Developer >" >&2
    echo "  'Integrate with 1Password CLI', then run this from a normal terminal." >&2
    exit 1
fi

# Piped, never a variable and never an argument. `install` creates it 0600 in one step, so
# there is no window where the file exists with looser permissions.
if op read "$ref" \
    | ssh "$runner" 'install -m600 /dev/stdin "/run/user/$(id -u)/jev-key"'; then
    echo "key delivered to $runner:/run/user/<uid>/jev-key (tmpfs, cleared on reboot)"
    echo "the runner's key spec should be:  !cat /run/user/\$(id -u)/jev-key"
else
    echo "error: delivery failed. Nothing was written." >&2
    exit 1
fi
