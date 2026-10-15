#!/usr/bin/env bash
# Runs every behavioural SQL test in supabase/manual-tests against a fresh,
# throwaway Postgres database each, and fails if any of them prints FAIL or
# raises an ERROR. Connection settings come from the usual PG* environment
# variables (PGHOST, PGUSER, PGPASSWORD, ...).
#
#   scripts/test-sql.sh                 # every *.test.sql file
#   scripts/test-sql.sh baseline.test   # only files whose name matches
set -uo pipefail

cd "$(dirname "$0")/../supabase/manual-tests"

filter="${1:-}"

# baseline.sql is the schema as of 0037; a new project runs it and then every
# later migration. baseline.test.sql replays that setup, so it must include
# each of those migrations or a clean setup goes untested.
missing=()
for migration in ../migrations/*.sql; do
  number=$(basename "$migration" | cut -d_ -f1)
  ((10#$number <= 37)) && continue
  grep -qF "\\ir $migration" baseline.test.sql || missing+=("$(basename "$migration")")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "✗ baseline.test.sql doesn't apply: ${missing[*]}"
  echo "  Add each to its \\ir list so the clean-setup test covers it."
  exit 1
fi

failed=()
ran=0

for file in *.test.sql; do
  [[ -n "$filter" && "$file" != *"$filter"* ]] && continue
  db="sqltest_$(basename "$file" .test.sql | tr -c 'a-zA-Z0-9\n' '_')"
  dropdb --if-exists "$db" >/dev/null 2>&1
  createdb "$db" || { failed+=("$file (createdb)"); continue; }

  output=$(psql -X -q -v ON_ERROR_STOP=0 -d "$db" -f "$file" 2>&1)
  status=$?
  dropdb --if-exists "$db" >/dev/null 2>&1
  ran=$((ran + 1))

  problems=$(grep -E 'FAIL|ERROR' <<<"$output")
  if [[ $status -ne 0 || -n "$problems" ]]; then
    echo "✗ $file"
    echo "${problems:-$output}" | sed 's/^/    /'
    failed+=("$file")
  else
    passes=$(grep -c 'PASS' <<<"$output")
    echo "✓ $file ($passes checks)"
  fi
done

if [[ $ran -eq 0 ]]; then
  echo "No SQL test matched '$filter'." >&2
  exit 1
fi
if [[ ${#failed[@]} -gt 0 ]]; then
  echo
  echo "${#failed[@]} of $ran SQL test files failed: ${failed[*]}"
  exit 1
fi
echo
echo "All $ran SQL test files passed."
