#!/usr/bin/env bash
set -uo pipefail

# ── Ido Test Suite ───────────────────────────────────────────
# Usage:
#   bash ido-test.sh                        # all suites, localhost
#   bash ido-test.sh --suite surfaces       # one suite only
#   IDO_BASE_URL=https://... bash ido-test.sh
#   IDO_API_KEY=ido_k_... bash ido-test.sh
#   IDO_USER_ID=alice@corp.com bash ido-test.sh   # inject user_id (corporate mode)

BASE_URL="${IDO_BASE_URL:-http://localhost:8645}"
API_KEY="${IDO_API_KEY:-}"
USER_ID="${IDO_USER_ID:-}"
PASSED=0
FAILED=0
SKIPPED=0
AUTH_OK=false

AUTH_HEADER=()
if [ -n "$API_KEY" ]; then
  AUTH_HEADER=(-H "X-Ido-Api-Key: $API_KEY")
else
  AUTH_HEADER=(-H "Authorization: Bearer ido-dev-token")
fi

# ── Helpers ─────────────────────────────────────────────────

green()  { printf "\033[32m%s\033[0m" "$1"; }
red()    { printf "\033[31m%s\033[0m" "$1"; }
yellow() { printf "\033[33m%s\033[0m" "$1"; }
bold()   { printf "\033[1m%s\033[0m" "$1"; }

# Inject user_id into a JSON payload string (for corporate mode testing).
# Uses node to merge {"user_id":"..."} into the payload object.
# If USER_ID is empty or the payload already has user_id, returns it unchanged.
inject_user_id() {
  local payload="$1"
  if [ -z "$USER_ID" ]; then
    printf '%s' "$payload"
    return
  fi
  node -e "
    const p = JSON.parse(process.argv[1]);
    if (!p.user_id) p.user_id = process.argv[2];
    process.stdout.write(JSON.stringify(p));
  " "$payload" "$USER_ID"
}

pass() {
  PASSED=$((PASSED + 1))
  echo "  $(green '✅ PASS') $1"
}

fail() {
  FAILED=$((FAILED + 1))
  echo "  $(red '❌ FAIL') $1"
}

skip() {
  SKIPPED=$((SKIPPED + 1))
  echo "  $(yellow '⚠️  SKIP') $1"
}

# ── Auth probe ───────────────────────────────────────────────

check_auth() {
  if $AUTH_OK; then return 0; fi
  # Fast probe: create a notification via A2A, short timeout
  local probe_payload
  probe_payload=$(inject_user_id '{"surface_type":"notification","surface_title":"_p","context":"_p"}')
  local probe
  probe=$(printf '{"jsonrpc":"2.0","method":"message/send","params":%s,"id":1}' "$probe_payload" | \
    curl -s --max-time 5 -X POST "$BASE_URL/api/v1/a2a" -H "Content-Type: application/json" "${AUTH_HEADER[@]}" -d @- 2>/dev/null)
  if echo "$probe" | grep -q '"surface_id"\|task_id'; then
    AUTH_OK=true
    return 0
  fi
  return 1
}

# Retry auth probe once after a short wait (SW / cold start)
ensure_auth() {
  check_auth
  if $AUTH_OK; then return 0; fi
  sleep 2
  check_auth
}

# Run before any auth-required suite. Prints diagnostic skip if auth fails.
require_auth() {
  local suite_name="$1"
  local probe_payload
  probe_payload=$(inject_user_id '{"surface_type":"notification","surface_title":"_auth_probe","context":"probe"}')
  local probe
  local http_code
  probe=$(printf '{"jsonrpc":"2.0","method":"message/send","params":%s,"id":1}' "$probe_payload" | \
    curl -s -w '\n%{http_code}' --max-time 10 -X POST "$BASE_URL/api/v1/a2a" \
      -H "Content-Type: application/json" \
      "${AUTH_HEADER[@]}" \
      -d @- 2>/dev/null)
  http_code=$(echo "$probe" | tail -1)
  probe=$(echo "$probe" | sed '$d')
  if echo "$probe" | grep -q '"surface_id"\|task_id'; then
    AUTH_OK=true
    return 0
  fi
  # Diagnostic — show what the server actually returned
  echo ""
  if [ -z "$probe" ]; then
    echo "  $(yellow '⚠️  AUTH FAILED') — $suite_name"
    echo "  ┌─ No response from $BASE_URL/api/v1/a2a"
    echo "  │  Is the server running? Check: curl $BASE_URL/api/v1/health"
  elif [ "$http_code" = "000" ]; then
    echo "  $(yellow '⚠️  AUTH FAILED') — $suite_name"
    echo "  ┌─ Connection refused or timed out ($BASE_URL)"
    echo "  │  Check the URL is reachable and not firewalled."
  elif echo "$probe" | grep -q 'INVALID_API_KEY'; then
    echo "  $(red '🔑 INVALID API KEY') — $suite_name"
    echo "  ┌─ Server says: $(echo "$probe" | grep -o '"error":"[^"]*"\|"message":"[^"]*"')"
    echo "  │  Your IDO_API_KEY was rejected — check it's not revoked or regenerated."
  elif echo "$probe" | grep -q 'INVALID_KEY_FORMAT\|Malformed'; then
    echo "  $(red '🔑 BAD KEY FORMAT') — $suite_name"
    echo "  ┌─ Key must start with 'ido_k_' — check your IDO_API_KEY value."
  elif echo "$probe" | grep -q 'Authentication required'; then
    echo "  $(yellow '⚠️  NO AUTH') — $suite_name"
    echo "  ┌─ No valid credentials sent. Set IDO_API_KEY=ido_k_..."
    echo "  │  or (dev mode only) omit IDO_API_KEY to use the dev token."
  else
    echo "  $(yellow '⚠️  AUTH FAILED') — $suite_name"
    echo "  ┌─ HTTP $http_code: $probe"
  fi
  echo "  └─ URL: $BASE_URL/api/v1/a2a"
  return 1
}

assert_eq() {
  local actual="$1" expected="$2" label="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$label"
  else
    fail "$label — expected '$expected', got '$actual'"
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  if echo "$haystack" | grep -q -e "$needle"; then
    pass "$label"
  else
    fail "$label — response does not contain '$needle'"
  fi
}

a2a_call() {
  local method="$1" params
  if [ -n "${2-}" ]; then params="$2"; else params="{}"; fi
  printf '{"jsonrpc":"2.0","method":"%s","params":%s,"id":1}' "$method" "$params" | \
    curl -s --max-time 10 -X POST "$BASE_URL/api/v1/a2a" \
      -H "Content-Type: application/json" \
      "${AUTH_HEADER[@]}" \
      -d @-
}

mcp_call() {
  local method="$1" params
  if [ -n "${2-}" ]; then params="$2"; else params="{}"; fi
  printf '{"jsonrpc":"2.0","method":"%s","params":%s,"id":1}' "$method" "$params" | \
    curl -s --max-time 10 -X POST "$BASE_URL/api/v1/mcp" \
      -H "Content-Type: application/json" \
      "${AUTH_HEADER[@]}" \
      -d @-
}

# MCP send surface — wraps payload in tools/call → ido_send_task
mcp_send() {
  local payload="$1"
  local wrapped="{\"name\":\"ido_send_task\",\"arguments\":$payload}"
  printf '{"jsonrpc":"2.0","method":"tools/call","params":%s,"id":1}' "$wrapped" | \
    curl -s --max-time 10 -X POST "$BASE_URL/api/v1/mcp" \
      -H "Content-Type: application/json" \
      "${AUTH_HEADER[@]}" \
      -d @-
}

rest_call() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s -X "$method" "$BASE_URL$path" \
      -H "Content-Type: application/json" \
      "${AUTH_HEADER[@]}" \
      -d "$body"
  else
    curl -s -X "$method" "$BASE_URL$path" \
      "${AUTH_HEADER[@]}"
  fi
}

# ── Suite: Health ───────────────────────────────────────────

suite_health() {
  echo ""
  echo "$(bold '═══ Health ═══')"

  local resp
  resp=$(curl -s "$BASE_URL/api/v1/health")
  assert_contains "$resp" '"status":"ok"' "Health check returns ok"
}

# ── Suite: A2A JSON-RPC ─────────────────────────────────────

suite_a2a() {
  echo ""
  echo "$(bold '═══ A2A JSON-RPC ═══')"
  require_auth "A2A" || return

  # skills/guide (no auth required per spec)
  local guide
  guide=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/a2a" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"skills/guide","id":1}')
  assert_contains "$guide" '"version"' "skills/guide returns version"

  # message/send — form
  local form_resp
  form_resp=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Test Form","inputs_schema":{"type":"object","properties":{"name":{"type":"string","title":"Name"}},"required":["name"]}}')
  local task_id
  task_id=$(echo "$form_resp" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$task_id" ]; then
    pass "message/send — form created"
  else
    fail "message/send — form creation failed: $form_resp"
  fi

  # tasks/get
  if [ -n "$task_id" ]; then
    local get_resp
    get_resp=$(a2a_call "tasks/get" "{\"task_id\":\"$task_id\"}")
    assert_contains "$get_resp" "TASK_STATE_INPUT_REQUIRED" "tasks/get returns input_required"
  fi

  # message/send — approval
  local appr_resp
  appr_resp=$(a2a_call "message/send" '{"surface_type":"approval","surface_title":"Test Approval","context":"Approve this"}')
  local appr_task
  appr_task=$(echo "$appr_resp" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$appr_task" ]; then
    pass "message/send — approval created"
  else
    fail "message/send — approval creation failed"
  fi

  # message/send — notification
  local notif_resp
  notif_resp=$(a2a_call "message/send" '{"surface_type":"notification","surface_title":"Test Notification","context":"Hello world"}')
  assert_contains "$notif_resp" "TASK_STATE_COMPLETED" "message/send — notification auto-completed"

  # tasks/list
  local list_resp
  list_resp=$(a2a_call "tasks/list" "{}")
  assert_contains "$list_resp" '"id"' "tasks/list returns tasks"

  # tasks/cancel
  if [ -n "$task_id" ]; then
    local cancel_resp
    cancel_resp=$(a2a_call "tasks/cancel" "{\"task_id\":\"$task_id\"}")
    assert_contains "$cancel_resp" "CANCELLED" "tasks/cancel works"
  fi

  # skills/list-templates
  local tmpl_resp
  tmpl_resp=$(a2a_call "skills/list-templates" "{}")
  assert_contains "$tmpl_resp" "standup" "skills/list-templates includes standup"

  # Invalid method
  local bad_resp
  bad_resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/a2a" \
    -H "Content-Type: application/json" \
    "${AUTH_HEADER[@]}" \
    -d '{"jsonrpc":"2.0","method":"nonexistent","id":1}')
  assert_contains "$bad_resp" '-32601' "Unknown method returns -32601"

  # Invalid JSON-RPC
  local invalid
  invalid=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/a2a" \
    -H "Content-Type: application/json" \
    "${AUTH_HEADER[@]}" \
    -d '{"not":"jsonrpc"}')
  assert_contains "$invalid" '-32600' "Invalid request returns -32600"
}

# ── Suite: MCP ───────────────────────────────────────────────

suite_mcp() {
  echo ""
  echo "$(bold '═══ MCP ═══')"
  require_auth "MCP" || return

  # initialize
  local init
  init=$(mcp_call "initialize" '{"protocolVersion":"2024-11-05","capabilities":{}}')
  assert_contains "$init" "2024-11-05" "MCP initialize returns protocol version"

  # ping
  local ping
  ping=$(mcp_call "ping")
  assert_contains "$ping" '"result":{}' "MCP ping returns empty result"

  # tools/list
  local tools
  tools=$(mcp_call "tools/list")
  assert_contains "$tools" "ido_send_task" "MCP tools/list includes ido_send_task"
  assert_contains "$tools" "ido_get_skills_guide" "MCP tools/list includes ido_get_skills_guide"

  # tools/call — ido_get_skills_guide
  local sg
  sg=$(mcp_call "tools/call" '{"name":"ido_get_skills_guide","arguments":{}}')
  assert_contains "$sg" "componentCatalog" "MCP ido_get_skills_guide works"

  # tools/call — ido_send_task
  local send
  send=$(mcp_call "tools/call" '{"name":"ido_send_task","arguments":{"surface_type":"form","surface_title":"MCP Form Test"}}')
  assert_contains "$send" "task_id" "MCP ido_send_task works"

  # Unknown tool
  local bad_tool
  bad_tool=$(mcp_call "tools/call" '{"name":"nonexistent_tool","arguments":{}}')
  assert_contains "$bad_tool" '-32601' "Unknown MCP tool returns -32601"
}

# ── Suite: Surfaces ─────────────────────────────────────────

suite_surfaces() {
  echo ""
  echo "$(bold '═══ Surfaces (REST) ═══')"
  require_auth "Surfaces (REST)" || return

  # Create via A2A, then test REST endpoints
  local create
  create=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"REST Test Form","inputs_schema":{"type":"object","properties":{"field1":{"type":"string","title":"Field 1"}},"required":["field1"]}}')
  local sid
  sid=$(echo "$create" | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -z "$sid" ]; then
    fail "Could not create test surface for REST suite"
    return
  fi

  # GET /api/v1/surfaces
  local surfaces
  surfaces=$(rest_call "GET" "/api/v1/surfaces")
  assert_contains "$surfaces" "$sid" "GET surfaces includes created surface"

  # GET /api/v1/surfaces/:id
  local detail
  detail=$(rest_call "GET" "/api/v1/surfaces/$sid")
  assert_contains "$detail" "REST Test Form" "GET surface detail works"

  # Submit
  local submit
  submit=$(rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"user_input":{"field1":"test value"}}')
  assert_contains "$submit" "COMPLETED" "Submit surface works"

  # Test idempotency
  local idem
  idem=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Idempotent Form","idempotency_key":"test-key-123","inputs_schema":{"type":"object","properties":{"x":{"type":"string","title":"X"}}}}')
  local idem2
  idem2=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Idempotent Form","idempotency_key":"test-key-123","inputs_schema":{"type":"object","properties":{"x":{"type":"string","title":"X"}}}}')
  local tid1 tid2
  tid1=$(echo "$idem" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  tid2=$(echo "$idem2" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ "$tid1" = "$tid2" ]; then
    pass "Idempotency — duplicate key returns same task"
  else
    fail "Idempotency — expected same task, got different"
  fi

  # Bulk archive
  local bulk
  bulk=$(rest_call "POST" "/api/v1/surfaces/bulk-archive" "{\"surface_ids\":[\"$sid\"]}")

  # Negative: submit already completed
  local bad_submit
  bad_submit=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/surfaces/$sid/submit" \
    -H "Content-Type: application/json" \
    "${AUTH_HEADER[@]}" \
    -d '{"user_input":{"field1":"test"}}')
  assert_contains "$bad_submit" "409\|Cannot submit" "Cannot submit completed surface"
}

# ── Suite: Negative Validation ───────────────────────────────

suite_negative() {
  echo ""
  echo "$(bold '═══ Negative Validation ═══')"
  require_auth "Negative Validation" || return

  # Missing surface_type
  local r1
  r1=$(a2a_call "message/send" '{"surface_title":"Bad"}' 2>/dev/null || echo '{"error":{}}')
  assert_contains "$r1" "error\|32602" "Missing surface_type rejected"

  # Invalid surface_type
  local r2
  r2=$(a2a_call "message/send" '{"surface_type":"chat","surface_title":"Bad"}')
  assert_contains "$r2" "error\|32602" "Invalid surface_type rejected"

  # Approval with Form component
  local r3
  r3=$(a2a_call "message/send" '{"surface_type":"approval","surface_title":"Bad","context":"Test","a2ui_layout":[{"id":"f1","component":"Form","props":{}}]}')
  assert_contains "$r3" "error\|422" "Approval with Form rejected"

  # Approval with InputField
  local r4
  r4=$(a2a_call "message/send" '{"surface_type":"approval","surface_title":"Bad","context":"Test","a2ui_layout":[{"id":"i1","component":"InputField","props":{"label":"X"},"bind":"x"}]}')
  assert_contains "$r4" "error\|422" "Approval with InputField rejected"

  # Button in any layout
  local r5
  r5=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Bad","a2ui_layout":[{"id":"b1","component":"Button","props":{}}]}')
  assert_contains "$r5" "error\|422" "Button rejected"

  # Unknown component
  local r6
  r6=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Bad","a2ui_layout":[{"id":"u1","component":"FluxCapacitor","props":{}}]}')
  assert_contains "$r6" "error\|422" "Unknown component rejected"

  # Notification: no context
  local r7
  r7=$(a2a_call "message/send" '{"surface_type":"notification","surface_title":"Bad"}')
  assert_contains "$r7" "error\|422" "Notification without context rejected"

  # Approval with extra inputs_schema property
  local r8
  r8=$(a2a_call "message/send" '{"surface_type":"approval","surface_title":"Bad","context":"Test","inputs_schema":{"type":"object","properties":{"reason":{"type":"string"},"invalid_field":{"type":"string"}}}}')
  assert_contains "$r8" "error\|422" "Approval with extra schema prop rejected"

  # Missing entry id
  local r9
  r9=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Bad","a2ui_layout":[{"component":"Text","props":{"text":"no id"}}]}')
  assert_contains "$r9" "error\|422" "Missing component id rejected"

  # Non-existent parent
  local r10
  r10=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Bad","a2ui_layout":[{"id":"c1","component":"Text","props":{"text":"orphan"},"parent":"nonexistent"}]}')
  assert_contains "$r10" "error\|422" "Bad parent ref rejected"

  # Severity on non-notification
  local r11
  r11=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Bad","severity":"error","inputs_schema":{"type":"object","properties":{"x":{"type":"string","title":"X"}}}}')
  assert_contains "$r11" "error\|422" "Severity on form rejected"
}

# ── Suite: Expiry ────────────────────────────────────────────

suite_expiry() {
  echo ""
  echo "$(bold '═══ Expiry ═══')"
  require_auth "Expiry" || return

  # Create form with 5s expiry
  local future_date
  future_date=$(date -u -v+5S +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "+5 seconds" +"%Y-%m-%dT%H:%M:%SZ")
  local create
  create=$(a2a_call "message/send" "{\"surface_type\":\"form\",\"surface_title\":\"Expires Soon\",\"expires_at\":\"$future_date\",\"inputs_schema\":{\"type\":\"object\",\"properties\":{\"x\":{\"type\":\"string\",\"title\":\"X\"}}}}")
  local tid sid
  tid=$(echo "$create" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  sid=$(echo "$create" | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -z "$tid" ]; then
    fail "Expiry surface creation failed"
    return
  fi
  pass "Expiry surface created with 5s TTL"

  # Wait for expiry
  echo "  Waiting 8s for expiry..."
  sleep 8

  # Force expiry sweep
  curl -s --max-time 10 -X POST "$BASE_URL/api/v1/admin/sweep" \
    "${AUTH_HEADER[@]}" > /dev/null

  # Poll
  local poll
  poll=$(a2a_call "tasks/get" "{\"task_id\":\"$tid\"}")
  assert_contains "$poll" "TASK_STATE_FAILED\|EXPIRED" "Expired task shows failed/expired"

  # Try to submit expired
  if [ -n "$sid" ]; then
    local submit
    submit=$(rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"user_input":{"x":"test"}}')
    assert_contains "$submit" "410\|expired" "Cannot submit expired surface"
  fi
}

# ── Suite: Demo ──────────────────────────────────────────────

suite_demo() {
  echo ""
  echo "$(bold '═══ Demo Payloads ═══')"
  require_auth "Demo Payloads" || return

  local demo_dir="$(dirname "$0")/../tests/payloads/demo"
  local count=0
  local total=0

  for file in "$demo_dir"/*.json; do
    [ -f "$file" ] || continue
    total=$((total + 1))
    local demo=$(basename "$file" .json)

    local payload
    payload=$(inject_user_id "$(cat "$file")")
    local resp
    resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/a2a" \
      -H "Content-Type: application/json" \
      "${AUTH_HEADER[@]}" \
      -d "{\"jsonrpc\":\"2.0\",\"method\":\"message/send\",\"params\":$payload,\"id\":1}")

    if echo "$resp" | grep -q '"result"'; then
      pass "$demo"
      count=$((count + 1))
    else
      fail "$demo — rejected: $(echo "$resp" | head -c 200)"
    fi
  done

  echo ""
  echo "  $(bold "$count/$total demo payloads accepted")"
  echo "  Open $BASE_URL to see demo surfaces."
}

# ── Suite: Payload Validation ────────────────────────────────

suite_payloads() {
  echo ""
  echo "$(bold '═══ Payload Validation ═══')"
  require_auth "Payload Validation" || return
  local dir="tests/payloads"

  # Positive tests — shared payloads, tested against all 3 protocols
  echo ""
  echo "  $(bold 'Positive (shared payloads × A2A, MCP, REST):')"
  for file in "$dir/positive"/*.json; do
    [ -f "$file" ] || continue
    local payload name
    payload=$(inject_user_id "$(cat "$file")")
    name="$(basename "$file")"
    for proto in a2a mcp rest; do
      local resp
      if [ "$proto" = "a2a" ]; then
        resp=$(a2a_call "message/send" "$payload")
      elif [ "$proto" = "mcp" ]; then
        resp=$(mcp_send "$payload")
      else
        resp=$(rest_call "POST" "/api/v1/surfaces" "$payload")
      fi
      local ok=false
      if echo "$resp" | grep -q '"surface_id"'; then
        ok=true
      elif echo "$resp" | grep -q 'task_id'; then
        # MCP wraps result in content[0].text JSON — \"task_id\" is escaped
        ok=true
      fi
      if $ok; then
        pass "$proto/$name"
      else
        fail "$proto/$name — rejected: $(echo "$resp" | head -c 100)"
      fi
    done
  done

  # Negative tests — shared payloads, tested against all 3 protocols
  echo ""
  echo "  $(bold 'Negative (shared payloads × A2A, MCP, REST):')"
  for file in "$dir/negative"/*.json; do
    [ -f "$file" ] || continue
    local payload name
    payload=$(inject_user_id "$(cat "$file")")
    name="$(basename "$file")"
    for proto in a2a mcp rest; do
      local resp
      if [ "$proto" = "a2a" ]; then
        resp=$(a2a_call "message/send" "$payload")
      elif [ "$proto" = "mcp" ]; then
        resp=$(mcp_send "$payload")
      else
        resp=$(rest_call "POST" "/api/v1/surfaces" "$payload")
      fi
      if echo "$resp" | grep -q -e '"error"' -e '"code".*-326'; then
        pass "$proto/$name"
      else
        fail "$proto/$name — should have been rejected"
      fi
    done
  done
}

# ── Suite: Inbox vs History Mutations ────────────────────────

suite_inbox_history() {
  echo ""
  echo "$(bold '═══ Inbox vs History Mutations ═══')"
  require_auth "Inbox vs History" || return

  # Create a form with expiry set far in the future
  local payload='{"surface_type":"form","surface_title":"Mutation Test Form","expires_at":"2030-01-01T00:00:00Z","inputs_schema":{"type":"object","properties":{"answer":{"type":"string","title":"Answer"}},"required":["answer"]}}'
  local create_resp
  create_resp=$(a2a_call "message/send" "$payload")
  local surface_id
  surface_id=$(echo "$create_resp" | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -z "$surface_id" ]; then
    fail "Create test surface"
    return
  fi
  pass "Create test surface: $surface_id"

  # 1. Inbox surface should be mutable — submit with data
  local submit_resp
  submit_resp=$(rest_call "POST" "/api/v1/surfaces/$surface_id/submit" '{"user_input":{"answer":"test value"}}')
  if echo "$submit_resp" | grep -q '"state"'; then
    pass "Inbox surface accepts submit"
  else
    fail "Inbox surface should accept submit: $(echo "$submit_resp" | head -c 100)"
  fi

  # 2. Completed surface should be immutable — second submit should fail
  local resubmit
  resubmit=$(rest_call "POST" "/api/v1/surfaces/$surface_id/submit" '{"user_input":{"answer":"second attempt"}}')
  if echo "$resubmit" | grep -q '"error"'; then
    pass "Completed surface rejects re-submit"
  else
    fail "Completed surface should reject re-submit"
  fi

  # 3. History surface should reject dismiss
  local dismiss_resp
  dismiss_resp=$(rest_call "POST" "/api/v1/surfaces/$surface_id/dismiss" '{}')
  if echo "$dismiss_resp" | grep -q '"error"'; then
    pass "Completed surface rejects dismiss"
  else
    fail "Completed surface should reject dismiss"
  fi

  # 4. Create a notification for dismiss testing
  local notif_payload='{"surface_type":"notification","surface_title":"Dismiss Test","context":"Test","severity":"info"}'
  local notif_resp
  notif_resp=$(a2a_call "message/send" "$notif_payload")
  local notif_id
  notif_id=$(echo "$notif_resp" | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -z "$notif_id" ]; then
    fail "Create test notification"
    return
  fi
  pass "Create test notification: $notif_id"

  # 5. Active notification should accept dismiss
  local notif_dismiss
  notif_dismiss=$(rest_call "POST" "/api/v1/surfaces/$notif_id/dismiss" '{}')
  if echo "$notif_dismiss" | grep -q '"state"'; then
    pass "Active notification accepts dismiss"
  else
    fail "Active notification should accept dismiss: $(echo "$notif_dismiss" | head -c 100)"
  fi

  # 6. Dismissed notification should reject re-dismiss
  local renotif_dismiss
  renotif_dismiss=$(rest_call "POST" "/api/v1/surfaces/$notif_id/dismiss" '{}')
  if echo "$renotif_dismiss" | grep -q '"error"'; then
    pass "Dismissed notification rejects re-dismiss"
  else
    fail "Dismissed notification should reject re-dismiss"
  fi
}

# ── Suite: Full Lifecycle ────────────────────────────────────

suite_lifecycle() {
  echo ""
  echo "$(bold '═══ Full Surface Lifecycle ═══')"
  require_auth "Surface Lifecycle" || return

  local sid resp

  # ── Form lifecycle: create → submit → complete → immutable ──
  echo ""
  echo "  $(bold 'Form lifecycle:')"
  sid=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Lifecycle Form","expires_at":"2030-01-01T00:00:00Z","inputs_schema":{"type":"object","properties":{"field":{"type":"string","title":"Field"}},"required":["field"]}}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "1. Create form" || { fail "1. Create form"; return; }

  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"user_input":{"field":"hello"}}')
  echo "$resp" | grep -q '"COMPLETED"' && pass "2. Submit form → COMPLETED" || fail "2. Submit form → COMPLETED"

  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"user_input":{"field":"again"}}')
  echo "$resp" | grep -q '"error"' && pass "3. Re-submit rejected (immutable)" || fail "3. Re-submit should be rejected"

  # ── Approval lifecycle: create → approve → complete ────────
  echo ""
  echo "  $(bold 'Approval lifecycle:')"
  sid=$(a2a_call "message/send" '{"surface_type":"approval","surface_title":"Lifecycle Approval"}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "4. Create approval" || { fail "4. Create approval"; return; }

  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"decision":"approved"}')
  echo "$resp" | grep -q '"COMPLETED"' && pass "5. Approve → COMPLETED" || fail "5. Approve → COMPLETED"

  # ── Approval lifecycle: create → reject → rejected ─────────
  sid=$(a2a_call "message/send" '{"surface_type":"approval","surface_title":"Reject Me"}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "6. Create approval" || { fail "6. Create approval"; return; }

  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"decision":"rejected"}')
  echo "$resp" | grep -q '"REJECTED"' && pass "7. Reject → REJECTED" || fail "7. Reject → REJECTED"

  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"decision":"approved"}')
  echo "$resp" | grep -q '"error"' && pass "8. Re-submit rejected (immutable)" || fail "8. Re-submit should be rejected"

  # ── Notification lifecycle: create → dismiss → immutable ───
  echo ""
  echo "  $(bold 'Notification lifecycle:')"
  sid=$(a2a_call "message/send" '{"surface_type":"notification","surface_title":"Dismiss Me","context":"Test notification","severity":"info"}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "9. Create notification" || fail "9. Create notification (no surface_id)"

  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/dismiss" '{}')
  echo "$resp" | grep -q '"DISMISSED"' && pass "10. Dismiss → DISMISSED" || fail "10. Dismiss → DISMISSED"

  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/dismiss" '{}')
  echo "$resp" | grep -q '"error"' && pass "11. Re-dismiss rejected (immutable)" || fail "11. Re-dismiss should be rejected"

  # ── Required field enforcement ─────────────────────────────
  echo ""
  echo "  $(bold 'Required field validation:')"
  sid=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Required Fields","expires_at":"2030-01-01T00:00:00Z","inputs_schema":{"type":"object","properties":{"name":{"type":"string","title":"Name"},"email":{"type":"string","title":"Email"}},"required":["name","email"]}}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "12. Create form with required fields" || fail "12. Create form (no surface_id)"

  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"user_input":{"name":"Test"}}')
  echo "$resp" | grep -q '"error"\|missing' && pass "13. Submit without required → rejected" || fail "13. Should reject missing required"

  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"user_input":{"name":"Test","email":"test@test.com"}}')
  echo "$resp" | grep -q '"COMPLETED"' && pass "14. Submit with all required → COMPLETED" || fail "14. Should accept all required"

  # ── Prefill / initial_data verification ────────────────────
  echo ""
  echo "  $(bold 'Data model:')"
  sid=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Prefill Test","expires_at":"2030-01-01T00:00:00Z","initial_data_model":{"name":"Alice","score":100},"inputs_schema":{"type":"object","properties":{"name":{"type":"string","title":"Name"},"score":{"type":"number","title":"Score"}},"required":["name","score"]}}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "15. Create form with prefill" || fail "15. Create form (no surface_id)"

  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"user_input":{"name":"Alice","score":100}}')
  echo "$resp" | grep -q '"COMPLETED"' && pass "16. Submit with prefill values → COMPLETED" || fail "16. Prefill submit"

  # ── Idempotency ────────────────────────────────────────────
  echo ""
  echo "  $(bold 'Idempotency:')"
  local idem_key="idem-test-$(date +%s)"
  sid=$(a2a_call "message/send" '{"surface_type":"notification","surface_title":"Idempotent","context":"Test","idempotency_key":"'"$idem_key"'"}')
  sid=$(echo "$sid" | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "17. Create with idempotency key" || fail "17. Create (no surface_id)"

  local sid2
  sid2=$(a2a_call "message/send" '{"surface_type":"notification","surface_title":"Duplicate","context":"Test","idempotency_key":"'"$idem_key"'"}')
  sid2=$(echo "$sid2" | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ "$sid2" = "$sid" ] && pass "18. Duplicate returns same surface_id" || fail "18. Idempotency — expected $sid, got $sid2"

  # ── Archiving ──────────────────────────────────────────────
  echo ""
  echo "  $(bold 'Archive:')"

  # Archive active form
  sid=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Archive Me","expires_at":"2030-01-01T00:00:00Z","inputs_schema":{"type":"object","properties":{"field":{"type":"string","title":"Field"}}}}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "19. Create form" || fail "19. Create (no surface_id)"
  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/archive" '{}')
  echo "$resp" | grep -q '"archived":true' && pass "20. Archive active form" || fail "20. Archive active form"
  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/archive" '{}')
  echo "$resp" | grep -q '"archived":true' && pass "21. Re-archive (idempotent, no error)" || fail "21. Re-archive"

  # Archive completed form
  sid=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Complete then Archive","expires_at":"2030-01-01T00:00:00Z","inputs_schema":{"type":"object","properties":{"x":{"type":"string","title":"X"}},"required":["x"]}}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "22. Create form" || fail "22. Create (no surface_id)"
  rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"user_input":{"x":"done"}}' > /dev/null
  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/archive" '{}')
  echo "$resp" | grep -q '"archived":true' && pass "23. Archive completed form" || fail "23. Archive completed form"

  # Archive active approval
  sid=$(a2a_call "message/send" '{"surface_type":"approval","surface_title":"Archive Approval"}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "24. Create approval" || fail "24. Create (no surface_id)"
  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/archive" '{}')
  echo "$resp" | grep -q '"archived":true' && pass "25. Archive active approval" || fail "25. Archive active approval"

  # Archive after approve
  sid=$(a2a_call "message/send" '{"surface_type":"approval","surface_title":"Approve then Archive"}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "26. Create approval" || fail "26. Create (no surface_id)"
  rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"decision":"approved"}' > /dev/null
  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/archive" '{}')
  echo "$resp" | grep -q '"archived":true' && pass "27. Archive approved surface" || fail "27. Archive approved surface"

  # Archive after reject
  sid=$(a2a_call "message/send" '{"surface_type":"approval","surface_title":"Reject then Archive"}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "28. Create approval" || fail "28. Create (no surface_id)"
  rest_call "POST" "/api/v1/surfaces/$sid/submit" '{"decision":"rejected"}' > /dev/null
  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/archive" '{}')
  echo "$resp" | grep -q '"archived":true' && pass "29. Archive rejected surface" || fail "29. Archive rejected surface"

  # Archive active notification
  sid=$(a2a_call "message/send" '{"surface_type":"notification","surface_title":"Archive Notif","context":"Test"}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "30. Create notification" || fail "30. Create (no surface_id)"
  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/archive" '{}')
  echo "$resp" | grep -q '"archived":true' && pass "31. Archive active notification" || fail "31. Archive active notification"

  # Archive after dismiss
  sid=$(a2a_call "message/send" '{"surface_type":"notification","surface_title":"Dismiss then Archive","context":"Test"}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "32. Create notification" || fail "32. Create (no surface_id)"
  rest_call "POST" "/api/v1/surfaces/$sid/dismiss" '{}' > /dev/null
  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/archive" '{}')
  echo "$resp" | grep -q '"archived":true' && pass "33. Archive dismissed notification" || fail "33. Archive dismissed notification"

  # Dismiss then archive notification
  sid=$(a2a_call "message/send" '{"surface_type":"notification","surface_title":"Dismiss and Archive","context":"Test"}' | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "34. Create notification" || fail "34. Create (no surface_id)"
  rest_call "POST" "/api/v1/surfaces/$sid/dismiss" '{}' > /dev/null
  resp=$(rest_call "POST" "/api/v1/surfaces/$sid/archive" '{}')
  echo "$resp" | grep -q '"archived":true' && pass "35. Archive dismissed notification" || fail "35. Archive dismissed notification"
}

# ── Suite: Security ──────────────────────────────────────────

suite_security() {
  echo ""
  echo "$(bold '═══ Security ═══')"
  local resp

  # ── Auth failures ──
  echo ""
  echo "  $(bold 'Auth:')"

  # Missing auth
  resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/surfaces" -H "Content-Type: application/json" -d '{"surface_type":"notification","surface_title":"x","context":"x"}')
  echo "$resp" | grep -q -e '"Authentication required"' -e '"error"' && pass "1. Missing auth → rejected" || fail "1. Missing auth should be rejected"

  # Invalid API key
  resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/surfaces" -H "Content-Type: application/json" -H "X-Ido-Api-Key: ido_k_invalid" -d '{"surface_type":"notification","surface_title":"x","context":"x"}')
  echo "$resp" | grep -q -e '"Authentication required"' -e '"error"' && pass "2. Invalid API key → rejected" || fail "2. Invalid API key should be rejected"

  # Tampered key (wrong format)
  resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/surfaces" -H "Content-Type: application/json" -H "X-Ido-Api-Key: not-a-valid-key" -d '{"surface_type":"notification","surface_title":"x","context":"x"}')
  echo "$resp" | grep -q -e '"Authentication required"' -e '"error"' && pass "3. Bad format key → rejected" || fail "3. Bad format key should be rejected"

  # ── Injection ──
  echo ""
  echo "  $(bold 'Injection:')"
  if ! $AUTH_OK && ! check_auth; then skip "Injection tests — set IDO_API_KEY"; else

  # SQL injection in title
  resp=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"DROP TABLE users;--","inputs_schema":{"type":"object","properties":{"f":{"type":"string","title":"F"}},"required":["f"]}}')
  echo "$resp" | grep -q '"surface_id"' && pass "4. SQL injection in title → accepted (parameterized)" || fail "4. SQL injection in title — rejected"

  # XSS in context
  resp=$(a2a_call "message/send" '{"surface_type":"notification","surface_title":"XSS Test","context":"<script>alert(1)</script>"}')
  echo "$resp" | grep -q '"surface_id"' && pass "5. XSS in context → accepted (escaped on render)" || fail "5. XSS in context — rejected"

  # Null byte in title
  resp=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"Bad\u0000Title","inputs_schema":{"type":"object","properties":{"f":{"type":"string","title":"F"}},"required":["f"]}}')
  echo "$resp" | grep -q '"error"' && pass "6. Null byte → rejected" || fail "6. Null byte should be rejected"
  fi  # end auth-required injection tests

  # ── Edge cases ──
  echo ""
  echo "  $(bold 'Edge cases:')"

  if ! $AUTH_OK && ! check_auth; then skip "Surface edge cases — set IDO_API_KEY"; else
  # Very long title (2000 chars — exceeds max 200)
  local long_title="$(python3 -c 'print("A"*2001)')"
  resp=$(a2a_call "message/send" "{\"surface_type\":\"form\",\"surface_title\":\"$long_title\",\"inputs_schema\":{\"type\":\"object\",\"properties\":{\"f\":{\"type\":\"string\",\"title\":\"F\"}},\"required\":[\"f\"]}}")
  echo "$resp" | grep -q '"error"' && pass "7. Overlong title → rejected" || fail "7. Overlong title should be rejected"

  # Max-length title (200 chars — should pass)
  local max_title="$(python3 -c 'print("A"*200)')"
  resp=$(a2a_call "message/send" "{\"surface_type\":\"notification\",\"surface_title\":\"$max_title\",\"context\":\"Test\"}")
  echo "$resp" | grep -q '"surface_id"' && pass "8. Max-length title → accepted" || fail "8. Max-length title should be accepted"

  # Deeply nested JSON
  local nested='{"a":{"b":{"c":{"d":{"e":{"f":{"g":{"h":{"i":{"j":"deep"}}}}}}}}}}'
  resp=$(a2a_call "message/send" "{\"surface_type\":\"notification\",\"surface_title\":\"Nested\",\"context\":\"Test\",\"initial_data_model\":$nested}")
  echo "$resp" | grep -q '"surface_id"' && pass "9. Deeply nested JSON → accepted" || fail "9. Deeply nested JSON should be accepted"

  # Unicode / emoji
  resp=$(a2a_call "message/send" '{"surface_type":"notification","surface_title":"🚀 Launch! 日本語テスト","context":"🎉✨🔥💯"}')
  echo "$resp" | grep -q '"surface_id"' && pass "10. Emoji + Unicode → accepted" || fail "10. Emoji + Unicode should be accepted"

  # Empty body
  resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/a2a" -H "Content-Type: application/json" "${AUTH_HEADER[@]}" -d '')
  echo "$resp" | grep -q '"error"' && pass "11. Empty body → rejected" || fail "11. Empty body should be rejected"

  # Non-JSON body
  resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/a2a" -H "Content-Type: application/json" "${AUTH_HEADER[@]}" -d 'this is not json')
  echo "$resp" | grep -q '"error"' && pass "12. Non-JSON body → rejected" || fail "12. Non-JSON should be rejected"

  # Whitespace-only title
  resp=$(a2a_call "message/send" '{"surface_type":"form","surface_title":"   ","inputs_schema":{"type":"object","properties":{"f":{"type":"string","title":"F"}},"required":["f"]}}')
  echo "$resp" | grep -q '"error"' && pass "13. Whitespace title → rejected" || fail "13. Whitespace title should be rejected"
  fi  # end auth-required surface edge tests
}

# ── Suite: Tenant Isolation ──────────────────────────────────

suite_tenant() {
  echo ""
  echo "$(bold '═══ Tenant Isolation ═══')"
  require_auth "Tenant Isolation" || return
  local KEY_A="${IDO_API_KEY_A:-}"
  local KEY_B="${IDO_API_KEY_B:-}"
  if [ -z "$KEY_A" ] || [ -z "$KEY_B" ]; then
    fail "IDO_API_KEY_A and IDO_API_KEY_B must be set"
    return
  fi

  local resp sid

  # Create surface as tenant A
  resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/a2a" \
    -H "Content-Type: application/json" \
    -H "X-Ido-Api-Key: $KEY_A" \
    -d '{"jsonrpc":"2.0","method":"message/send","params":{"surface_type":"form","surface_title":"Tenant A Secret","inputs_schema":{"type":"object","properties":{"f":{"type":"string","title":"F"}},"required":["f"]}},"id":1}')
  sid=$(echo "$resp" | grep -o '"surface_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$sid" ] && pass "1. Tenant A creates surface" || { fail "1. Tenant A create failed"; return; }

  # Tenant B tries to read surface A
  resp=$(curl -s --max-time 10 "$BASE_URL/api/v1/surfaces/$sid" -H "X-Ido-Api-Key: $KEY_B")
  echo "$resp" | grep -q '"Not found"\|"error"' && pass "2. Tenant B cannot read surface A" || fail "2. Tenant B should NOT see surface A"

  # Tenant B tries to submit surface A
  resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/surfaces/$sid/submit" \
    -H "Content-Type: application/json" \
    -H "X-Ido-Api-Key: $KEY_B" \
    -d '{"user_input":{"f":"x"}}')
  echo "$resp" | grep -q '"Not found"\|"error"' && pass "3. Tenant B cannot submit surface A" || fail "3. Tenant B should NOT submit surface A"

  # Tenant B tries to dismiss surface A
  resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/surfaces/$sid/dismiss" \
    -H "Content-Type: application/json" \
    -H "X-Ido-Api-Key: $KEY_B" \
    -d '{}')
  echo "$resp" | grep -q '"Not found"\|"error"' && pass "4. Tenant B cannot dismiss surface A" || fail "4. Tenant B should NOT dismiss surface A"

  # Tenant B tries to archive surface A
  resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/surfaces/$sid/archive" \
    -H "Content-Type: application/json" \
    -H "X-Ido-Api-Key: $KEY_B" \
    -d '{}')
  echo "$resp" | grep -q '"Not found"\|"error"' && pass "5. Tenant B cannot archive surface A" || fail "5. Tenant B should NOT archive surface A"

  # Tenant A can still read and submit their own surface
  resp=$(curl -s --max-time 10 "$BASE_URL/api/v1/surfaces/$sid" -H "X-Ido-Api-Key: $KEY_A")
  echo "$resp" | grep -q '"surface_id"' && pass "6. Tenant A can read own surface" || fail "6. Tenant A should see own surface"

  resp=$(curl -s --max-time 10 -X POST "$BASE_URL/api/v1/surfaces/$sid/submit" \
    -H "Content-Type: application/json" \
    -H "X-Ido-Api-Key: $KEY_A" \
    -d '{"user_input":{"f":"done"}}')
  echo "$resp" | grep -q '"COMPLETED"' && pass "7. Tenant A can submit own surface" || fail "7. Tenant A should submit own surface"
}



# ── Main ─────────────────────────────────────────────────────

echo ""
SUITE="${1:-help}"
if [ "$SUITE" = "--suite" ]; then
  SUITE="$2"
fi
if [ "$SUITE" = "--help" ] || [ "$SUITE" = "-h" ]; then
  SUITE="help"
fi

# Header — only for actual test runs
if [ "$SUITE" != "help" ]; then
  echo ""
  echo "$(bold '═══════════════════════════════════')"
  echo "$(bold '  Ido Test Suite')"
  echo "$(bold '═══════════════════════════════════')"
  echo "  Target: $BASE_URL"
  echo ""
fi

case "$SUITE" in
  help)
    echo ""
    echo "$(bold '═══ Ido Test Suite ═══')"
    echo ""
    echo "Usage: IDO_API_KEY=ido_k_... bash scripts/ido-test.sh [suite]"
    echo "       IDO_BASE_URL=https://... IDO_API_KEY=ido_k_... bash scripts/ido-test.sh [suite]"
    echo "       IDO_USER_ID=alice@corp.com IDO_API_KEY=ido_k_... bash scripts/ido-test.sh demo"
    echo ""
    echo "Suites:"
    echo "  health     — proxy health check"
    echo "  a2a        — A2A JSON-RPC smoke tests"
    echo "  mcp        — MCP protocol smoke tests"
    echo "  surfaces   — REST surface CRUD"
    echo "  negative   — error handling"
    echo "  expiry     — surface expiry sweep"
    echo "  demo       — rich UI demo payloads"
    echo "  payloads   — shared payloads × all 3 protocols"
    echo "  inbox      — inbox vs history mutation guards"
    echo "  lifecycle  — full surface lifecycle (35 tests)"
    echo "  security   — auth + injection + edge cases"
    echo "  tenant     — tenant isolation (needs 2 keys)"
    echo "  all        — run everything"
    echo ""
    echo "Env vars:"
    echo "  IDO_API_KEY     API key for auth (required in SaaS/Corporate mode)"
    echo "  IDO_BASE_URL    Target URL (default: http://localhost:8645)"
    echo "  IDO_USER_ID     Inject user_id into payloads (corporate mode)"
    echo "  IDO_API_KEY_A   Tenant A key (for tenant isolation)"
    echo "  IDO_API_KEY_B   Tenant B key (for tenant isolation)"
    echo ""
    exit 0
    ;;
  health)    suite_health ;;
  a2a)       suite_a2a ;;
  mcp)       suite_mcp ;;
  surfaces)  suite_surfaces ;;
  negative)  suite_negative ;;
  expiry)    suite_expiry ;;
  demo)      suite_demo ;;
  payloads)  suite_payloads ;;
  inbox)     suite_inbox_history ;;
  lifecycle) suite_lifecycle ;;
  security)  suite_security ;;
  tenant)    suite_tenant ;;
  all)
    suite_health
    suite_a2a
    suite_mcp
    suite_surfaces
    suite_negative
    suite_expiry
    suite_demo
    suite_payloads
    suite_inbox_history
    suite_lifecycle
    suite_security
    suite_tenant
    ;;
  *)
    echo "Unknown suite: $SUITE"
    echo "Available: health, a2a, mcp, surfaces, negative, expiry, demo, payloads, inbox, lifecycle, security, tenant, all"
    exit 1
    ;;
esac

echo ""
echo "$(bold '═══════════════════════════════════')"
printf "  %s passed, " "$(green "$PASSED")"
printf "%s failed" "$(red "$FAILED")"
if [ "$SKIPPED" -gt 0 ]; then
  printf ", %s skipped" "$(yellow "$SKIPPED")"
fi
printf "\n"
echo "$(bold '═══════════════════════════════════')"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi


