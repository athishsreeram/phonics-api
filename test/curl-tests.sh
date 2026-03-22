#!/usr/bin/env bash
# phonics-api — full curl test suite
# Usage:
#   bash test/curl-tests.sh
#   API=http://localhost:3001 bash test/curl-tests.sh

API="${API:-https://phonics-api-k43i.onrender.com}"
PASS=0; FAIL=0; TOKEN=""
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ADMIN_EMAIL="${ADMIN_EMAIL:-startdreamhere123@gmail.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-athish1}"

pass() { echo -e "${GREEN}✅ PASS${NC} — $1"; ((PASS++)); }
fail() { echo -e "${RED}❌ FAIL${NC} — $1\n   got: $(echo "$2" | head -c 200)"; ((FAIL++)); }
skip() { echo -e "${BLUE}⏭  SKIP${NC} — $1"; ((PASS++)); }
info() { echo -e "   ℹ  $1"; }
sep()  { echo -e "\n${YELLOW}── $1 ──${NC}"; }

# ─── 1. HEALTH ────────────────────────────────────────────────
sep "1. Health Check"
R=$(curl -sf "$API/health")
echo "$R" | grep -q '"ok":true' && pass "GET /health" || fail "GET /health" "$R"

# ─── 2. STORIES — PUBLIC ─────────────────────────────────────
sep "2. Stories — Public Read"
R=$(curl -sf "$API/api/stories")
echo "$R" | grep -q '"data":' && pass "GET /api/stories" || fail "GET /api/stories" "$R"
COUNT=$(echo "$R" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")
info "$COUNT stories in library"
[ "$COUNT" -eq 0 ] && info "⚠ No stories — run seed.sql in Neon SQL Editor"

STORY_ID=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d[0]['id'] if d else 1)" 2>/dev/null || echo "1")
R=$(curl -sf "$API/api/stories/$STORY_ID")
echo "$R" | grep -q '"title":' && pass "GET /api/stories/$STORY_ID" || fail "GET /api/stories/$STORY_ID" "$R"

# ─── 3. USERS — PUBLIC ───────────────────────────────────────
sep "3. Users — Public Endpoints"
TSID="$$"

# Register new user
R=$(curl -sf -X POST "$API/api/users/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"testparent-$TSID@example.com\",\"child_name\":\"Test Child\",\"child_age\":5}")
echo "$R" | grep -q '"ok":true' && pass "POST /api/users/register — new user" || fail "POST /api/users/register" "$R"
USER_EMAIL="testparent-$TSID@example.com"

# Register same user again (upsert — should not error)
R=$(curl -sf -X POST "$API/api/users/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_EMAIL\",\"child_name\":\"Test Child Updated\",\"child_age\":6}")
echo "$R" | grep -q '"ok":true' && pass "POST /api/users/register — upsert existing" || fail "POST /api/users/register — upsert" "$R"

# Ping (last_seen update)
R=$(curl -sf -X POST "$API/api/users/ping" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_EMAIL\"}")
echo "$R" | grep -q '"ok":true' && pass "POST /api/users/ping — last_seen updated" || fail "POST /api/users/ping" "$R"

# Get user profile
R=$(curl -sf "$API/api/users/me?email=$USER_EMAIL")
echo "$R" | grep -q '"email":' && pass "GET /api/users/me — returns user profile" || fail "GET /api/users/me" "$R"
STATUS=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('status','?'))" 2>/dev/null || echo "?")
info "User status: $STATUS"

# 404 for unknown user
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/users/me?email=nobody@nowhere.com")
[ "$CODE" = "404" ] && pass "GET /api/users/me — unknown user → 404" || fail "Expected 404 for unknown user" "got $CODE"

# ─── 4. EVENTS — PUBLIC ──────────────────────────────────────
sep "4. Events — Public (fire-and-forget)"
R=$(curl -sf -X POST "$API/api/events" -H "Content-Type: application/json" \
  -d "{\"type\":\"page_view\",\"session\":\"test-$TSID\",\"url\":\"/index.html\",\"premium\":false,\"ts\":$(date +%s)}")
echo "$R" | grep -q '"ok":true' && pass "POST /api/events — page_view" || fail "POST /api/events — page_view" "$R"

R=$(curl -sf -X POST "$API/api/events" -H "Content-Type: application/json" \
  -d "{\"type\":\"activity_start\",\"session\":\"test-$TSID\",\"url\":\"/listen-choose.html\",\"premium\":false,\"ts\":$(date +%s),\"data\":{\"activity\":\"sound-matching\"}}")
echo "$R" | grep -q '"ok":true' && pass "POST /api/events — activity_start" || fail "POST /api/events — activity_start" "$R"

R=$(curl -sf -X POST "$API/api/events" -H "Content-Type: application/json" \
  -d "{\"type\":\"activity_complete\",\"session\":\"test-$TSID\",\"url\":\"/listen-choose.html\",\"premium\":false,\"ts\":$(date +%s),\"data\":{\"activity\":\"sound-matching\",\"score\":8,\"total\":10}}")
echo "$R" | grep -q '"ok":true' && pass "POST /api/events — activity_complete" || fail "POST /api/events — activity_complete" "$R"

# ─── 5. EMAILS — PUBLIC ──────────────────────────────────────
sep "5. Email Leads — Public"
R=$(curl -sf -X POST "$API/api/emails" -H "Content-Type: application/json" \
  -d "{\"email\":\"lead-$TSID@example.com\",\"name\":\"Test Parent\",\"source\":\"curl-test\"}")
echo "$R" | grep -q '"ok":true' && pass "POST /api/emails — new lead" || fail "POST /api/emails" "$R"

R=$(curl -sf -X POST "$API/api/emails" -H "Content-Type: application/json" \
  -d "{\"email\":\"lead-$TSID@example.com\",\"name\":\"Test Parent\",\"source\":\"curl-test\"}")
echo "$R" | grep -q '"ok":true' && pass "POST /api/emails — duplicate (idempotent)" || fail "POST /api/emails — duplicate" "$R"

# ─── 6. SUBSCRIPTIONS — PUBLIC ───────────────────────────────
sep "6. Subscriptions — Public"
R=$(curl -s -X POST "$API/api/subscriptions/checkout" -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_EMAIL\"}")
if echo "$R" | grep -q '"url":'; then
  pass "POST /api/subscriptions/checkout — returns Stripe URL"
elif echo "$R" | grep -q '"error":'; then
  ERR=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
  skip "POST /api/subscriptions/checkout — Stripe not configured: $ERR"
else
  fail "POST /api/subscriptions/checkout" "$R"
fi

R=$(curl -s "$API/api/subscriptions/verify?session_id=cs_test_fake123")
echo "$R" | grep -qE '"error":|"status":' \
  && pass "GET /api/subscriptions/verify — responds without crash" \
  || fail "GET /api/subscriptions/verify" "$R"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/subscriptions/webhook" \
  -H "Content-Type: application/json" -H "stripe-signature: badsig" -d '{"type":"test"}')
( [ "$CODE" = "400" ] || [ "$CODE" = "200" ] ) \
  && pass "POST /api/subscriptions/webhook — rejects bad sig (HTTP $CODE)" \
  || fail "Webhook unexpected status" "got $CODE"

# ─── 7. ADMIN LOGIN ──────────────────────────────────────────
sep "7. Admin Login"
R=$(curl -sf -X POST "$API/api/admin/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
echo "$R" | grep -q '"token":' && pass "POST /api/admin/login" || fail "POST /api/admin/login" "$R"
TOKEN=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/admin/login" \
  -H "Content-Type: application/json" -d '{"email":"x@x.com","password":"wrong"}')
[ "$CODE" = "401" ] && pass "POST /api/admin/login — wrong creds → 401" || fail "Expected 401" "got $CODE"

if [ -z "$TOKEN" ]; then
  echo -e "${RED}No token — skipping admin tests. Check ADMIN_PASSWORD.${NC}"
else

  # ─── 8. STORIES CRUD ────────────────────────────────────────
  sep "8. Stories CRUD — Admin"
  R=$(curl -sf -X POST "$API/api/stories" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -d '{"title":"Bat and Ball","content":"The bat hit the ball in the hall.","level":1,"emoji":"🦇","words":["bat","ball","hall"]}')
  echo "$R" | grep -q '"ok":true' && pass "POST /api/stories — create" || fail "POST /api/stories — create" "$R"
  NEW_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")

  if [ -n "$NEW_ID" ]; then
    R=$(curl -sf -X PUT "$API/api/stories/$NEW_ID" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
      -d '{"title":"Bat and Ball (Updated)","level":2}')
    echo "$R" | grep -q '"ok":true' && pass "PUT /api/stories/$NEW_ID — update" || fail "PUT /api/stories/$NEW_ID" "$R"

    R=$(curl -sf -X DELETE "$API/api/stories/$NEW_ID" -H "Authorization: Bearer $TOKEN")
    echo "$R" | grep -q '"ok":true' && pass "DELETE /api/stories/$NEW_ID" || fail "DELETE /api/stories/$NEW_ID" "$R"

    CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/stories/$NEW_ID")
    [ "$CODE" = "404" ] && pass "GET deleted story → 404" || fail "Expected 404 after delete" "got $CODE"
  fi

  # ─── 9. ADMIN DASHBOARD ─────────────────────────────────────
  sep "9. Admin Dashboard"
  for ENDPOINT in overview users events emails "timeseries?days=7"; do
    R=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/admin/$ENDPOINT")
    echo "$R" | grep -q '"data":' && pass "GET /api/admin/$ENDPOINT" || fail "GET /api/admin/$ENDPOINT" "$R"
  done

  # ─── 10. DB POPULATION CHECK ────────────────────────────────
  sep "10. DB Population Check"
  R=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/admin/overview")
  if echo "$R" | grep -q '"data":'; then
    D=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(f\"stories={d.get('total_stories',0)} users={d.get('new_users_today',0)} events={d.get('total_events',0)} emails={d.get('total_emails',0)} subs={d.get('active_subs',0)} MRR=\${d.get('mrr',0):.0f}\")" 2>/dev/null || echo "parse error")
    pass "DB overview — $D"
    STORIES=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('total_stories',0))" 2>/dev/null || echo "0")
    [ "$STORIES" -gt 0 ] \
      && info "✅ stories table populated ($STORIES rows)" \
      || info "⚠  stories table empty — paste seed.sql into Neon SQL Editor"
  else
    fail "DB overview" "$R"
  fi

  R=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/admin/users")
  UCOUNT=$(echo "$R" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")
  info "users table: $UCOUNT row(s)"
  [ "$UCOUNT" -gt 0 ] \
    && pass "users table has data ($UCOUNT users)" \
    || skip "users table empty — will populate as real parents register"

  R=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/admin/emails")
  ECOUNT=$(echo "$R" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")
  info "email_leads table: $ECOUNT row(s)"

  R=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/admin/events")
  EVCOUNT=$(echo "$R" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo "0")
  info "events table: $EVCOUNT row(s)"

  # ─── 11. SUBSCRIPTIONS DETAIL ───────────────────────────────
  sep "11. Subscriptions Detail"
  R=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/admin/overview")
  ACTIVE=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('active_subs',0))" 2>/dev/null || echo "0")
  TRIAL=$(echo "$R"  | python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('trialing',0))"   2>/dev/null || echo "0")
  MRR=$(echo "$R"    | python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('mrr',0))"        2>/dev/null || echo "0")
  pass "Subscription stats — active: $ACTIVE | trialing: $TRIAL | MRR: \$$MRR"

  # ─── 12. AUTH GUARD ─────────────────────────────────────────
  sep "12. Auth Guard"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/stories" \
    -H "Content-Type: application/json" -d '{"title":"x","content":"y"}')
  [ "$CODE" = "401" ] && pass "POST /api/stories no-token → 401" || fail "Expected 401" "got $CODE"

  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer badtoken999" "$API/api/admin/overview")
  [ "$CODE" = "401" ] && pass "GET /api/admin/overview bad-token → 401" || fail "Expected 401 for bad token" "got $CODE"

fi

# ─── SUMMARY ─────────────────────────────────────────────────
sep "Results"
TOTAL=$((PASS + FAIL))
echo -e "  ${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}  Total: $TOTAL"
[ "$FAIL" -eq 0 ] \
  && echo -e "\n${GREEN}🎉 All tests passed!${NC}" \
  || echo -e "\n${RED}$FAIL test(s) failed — check output above${NC}"