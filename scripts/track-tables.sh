#!/bin/bash
# Wait for Hasura to be ready, then track all entity tables
HASURA_ENDPOINT="${HASURA_GRAPHQL_ENDPOINT:-http://localhost:8090/v1/metadata}"
HASURA_BASE="${HASURA_ENDPOINT%/v1/metadata}"

for i in $(seq 1 30); do
  if curl -s "$HASURA_BASE/healthz" | grep -q "OK"; then
    break
  fi
  sleep 1
done

TABLES="Campaign Dao DaoPermission DelegateChangedEvent DelegateVotesChangedEvent Gauge GaugeVote Lock LockToVoteMember NativeTransferPermission Plugin PluginActivityMetric PluginMember PluginRepo PluginSetting PluginSetupLog Proposal SelectorPermission Token TokenDelegation TokenMember Vote"

for table in $TABLES; do
  curl -s "$HASURA_ENDPOINT" -H 'Content-Type: application/json' \
    -d "{\"type\":\"pg_track_table\",\"args\":{\"source\":\"default\",\"table\":{\"schema\":\"public\",\"name\":\"$table\"}}}" > /dev/null 2>&1
done
echo "Hasura tables tracked"
