#!/bin/bash
# Usage:
#   ./scripts/switch-roles-eth-to-bso.sh          # dry run (preview changes)
#   ./scripts/switch-roles-eth-to-bso.sh --apply   # apply changes

set -euo pipefail

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then
    APPLY=true
else
    echo "=== DRY RUN (use --apply to execute) ==="
    echo
fi

COMMUNITIES=$(bitsocial community list -q)

if [[ -z "$COMMUNITIES" ]]; then
    echo "No communities found."
    exit 0
fi

TOTAL_CHANGED=0

while IFS= read -r address; do
    [[ -z "$address" ]] && continue

    ROLES_JSON=$(bitsocial community get "$address" 2>/dev/null | jq -r '.roles // empty' || true)
    [[ -z "$ROLES_JSON" || "$ROLES_JSON" == "null" ]] && continue

    ETH_KEYS=$(echo "$ROLES_JSON" | jq -r 'keys[] | select(endswith(".eth"))')
    [[ -z "$ETH_KEYS" ]] && continue

    EDIT_ARGS=()
    while IFS= read -r eth_addr; do
        bso_addr="${eth_addr%.eth}.bso"
        role=$(echo "$ROLES_JSON" | jq -r --arg k "$eth_addr" '.[$k].role')

        echo "[$address] $eth_addr -> $bso_addr ($role)"

        EDIT_ARGS+=("--roles[\"$bso_addr\"].role" "$role")
        EDIT_ARGS+=("--roles[\"$eth_addr\"]" "null")
    done <<< "$ETH_KEYS"

    if $APPLY; then
        if OUTPUT=$(bitsocial community edit "$address" "${EDIT_ARGS[@]}" 2>&1); then
            echo "  applied"
        elif echo "$OUTPUT" | grep -q 'ERR_ROLE_ADDRESS_NAME_COULD_NOT_BE_RESOLVED'; then
            UNRESOLVED=$(echo "$OUTPUT" | grep -o '"roleAddress":"[^"]*"' | head -1 | cut -d'"' -f4)
            echo "  skipped ($UNRESOLVED could not be resolved)"
        else
            echo "  ERROR: $OUTPUT" >&2
            exit 1
        fi
        echo
    else
        echo "  (dry run — skipping edit)"
        echo
    fi

    TOTAL_CHANGED=$((TOTAL_CHANGED + 1))
done <<< "$COMMUNITIES"

if [[ $TOTAL_CHANGED -eq 0 ]]; then
    echo "No .eth roles found in any community."
else
    if $APPLY; then
        echo "$TOTAL_CHANGED community/communities updated."
    else
        echo "$TOTAL_CHANGED community/communities would be updated."
    fi
fi
