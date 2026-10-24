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

# A new project runs every file in supabase/migrations in name order (the
# baseline first). baseline.test.sql replays that setup, so it must include
# each of them or a clean setup goes untested.
missing=()
for migration in ../migrations/*.sql; do
  grep -qF "\\ir $migration" baseline.test.sql || missing+=("$(basename "$migration")")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "✗ baseline.test.sql doesn't apply: ${missing[*]}"
  echo "  Add each to its \\ir list so the clean-setup test covers it."
  exit 1
fi

failed=()
ran=0

# The baseline migration is a squash of the archived 0001-0051 chain that
# production ran. Build both and compare their schema fingerprints line by
# line, so the baseline can't drift from what production has.
if [[ -z "$filter" || "baseline-equivalence" == *"$filter"* ]]; then
  fingerprint() {
    local db=$1 setup=$2
    dropdb --if-exists "$db" >/dev/null 2>&1
    createdb "$db" || return 1
    psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$setup" >/dev/null 2>&1 || { dropdb "$db"; return 1; }
    sed 's/^) x) select split_part.*/) x) select line from l order by line;/' ../schema-fingerprint.sql \
      | psql -X -q -At -d "$db"
    dropdb --if-exists "$db" >/dev/null 2>&1
  }
  chain=$(mktemp ./chain.XXXXXX.sql) squashed=$(mktemp ./squashed.XXXXXX.sql)
  { echo '\ir supabase-stubs.sql'; echo '\ir ../archive/baseline.sql'
    for f in ../archive/00*.sql; do (( 10#$(basename "$f" | cut -d_ -f1) > 37 )) && echo "\\ir $f"; done
  } > "$chain"
  printf '\\ir supabase-stubs.sql\n\\ir ../migrations/20261018000000_baseline.sql\n' > "$squashed"
  ran=$((ran + 1))
  if a=$(fingerprint sqltest_chain "$chain") && b=$(fingerprint sqltest_squashed "$squashed"); then
    if difference=$(diff <(echo "$a") <(echo "$b")); then
      echo "✓ baseline-equivalence ($(wc -l <<<"$a") schema objects match the archived chain)"
    else
      echo "✗ baseline-equivalence: the baseline migration differs from the archived 0001-0051 chain"
      echo "$difference" | head -20 | sed 's/^/    /'
      failed+=("baseline-equivalence")
    fi
  else
    echo "✗ baseline-equivalence: a setup failed to apply"
    failed+=("baseline-equivalence")
  fi
  rm -f "$chain" "$squashed"
fi

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
