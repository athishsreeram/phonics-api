#!/usr/bin/env bash
# phonics-api — curl test suite
# Usage:
#   bash test/curl-tests.sh
#   API=http://localhost:3001 bash test/curl-tests.sh
#   ADMIN_PASSWORD=yourpass bash test/curl-tests.sh

API="${API:-https://phonics-api-k43i.onrender.com}"
PASS=0; FAIL=0; TOKEN=""
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ADMIN_PASSWORD="athish123"

pass() { echo -e "${GREEN}✅ PASS${NC} — $1"; ((PASS++)); }
fail() { echo -e "${RED}❌ FAIL${NC} — $1\n   got: $(echo "$2" | head -c 150)"; ((FAIL++)); }
sep()  { echo -e "\n${YELLOW}── $1 ──${NC}"; }

sep "1. Health Check"
R=$(curl -sf "$API/health")
echo "$R" | grep -q '"ok":true' && pass "GET /health" || fail "GET /health" "$R"

sep "2. Stories — Public"
R=$(curl -sf "$API/api/stories")
echo "$R" | grep -q '"data":' && pass "GET /api/stories" || fail "GET /api/stories" "$R"

STORY_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null || echo "1")
R=$(curl -sf "$API/api/stories/$STORY_ID")
echo "$R" | grep -q '"title":' && pass "GET /api/stories/$STORY_ID" || fail "GET /api/stories/$STORY_ID" "$R"

sep "3. Admin Login"
R=$(curl -sf -X POST "$API/api/admin/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL:-startdreamhere123@gmail.com}\",\"password\":\"${ADMIN_PASSWORD:-changeme}\"}")
echo "$R" | grep -q '"token":' && pass "POST /api/admin/login" || fail "POST /api/admin/login (set ADMIN_PASSWORD env var)" "$R"
TOKEN=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
  echo -e "${RED}No token — skipping write tests. Run: ADMIN_PASSWORD=yourpass bash test/curl-tests.sh${NC}"
else
  sep "4. Stories CRUD (admin)"
  R=$(curl -sf -X POST "$API/api/stories" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"title":"Bat and Ball","content":"The bat hit the ball in the hall.","level":1,"emoji":"🦇","words":["bat","ball","hall"]}')
  echo "$R" | grep -q '"ok":true' && pass "POST /api/stories" || fail "POST /api/stories" "$R"
  NEW_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data',{}).get('id',''))" 2>/dev/null || echo "")

  if [ -n "$NEW_ID" ]; then
    R=$(curl -sf -X PUT "$API/api/stories/$NEW_ID" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
      -d '{"title":"Bat and Ball (Updated)"}')
    echo "$R" | grep -q '"ok":true' && pass "PUT /api/stories/$NEW_ID" || fail "PUT /api/stories/$NEW_ID" "$R"

    R=$(curl -sf -X DELETE "$API/api/stories/$NEW_ID" -H "Authorization: Bearer $TOKEN")
    echo "$R" | grep -q '"ok":true' && pass "DELETE /api/stories/$NEW_ID" || fail "DELETE /api/stories/$NEW_ID" "$R"
  fi

  sep "5. Events"
  R=$(curl -sf -X POST "$API/api/events" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"page_view\",\"session\":\"test-$$\",\"url\":\"/index.html\",\"premium\":false,\"ts\":$(date +%s)}")
  echo "$R" | grep -q '"ok":true' && pass "POST /api/events" || fail "POST /api/events" "$R"

  sep "6. Emails"
  R=$(curl -sf -X POST "$API/api/emails" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"test-$$@example.com\",\"name\":\"Test\",\"source\":\"curl\"}")
  echo "$R" | grep -q '"ok":true' && pass "POST /api/emails" || fail "POST /api/emails" "$R"

  sep "7. Admin Dashboard"
  for ENDPOINT in overview users events emails "timeseries?days=7"; do
    R=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/admin/$ENDPOINT")
    echo "$R" | grep -q '"data":' && pass "GET /api/admin/$ENDPOINT" || fail "GET /api/admin/$ENDPOINT" "$R"
  done

  sep "8. Auth Guard"
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/stories" \
    -H "Content-Type: application/json" -d '{"title":"x","content":"y"}')
  [ "$CODE" = "401" ] && pass "POST /api/stories no-token → 401" || fail "Expected 401" "got $CODE"
fi

sep "Results"
echo -e "  ${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}"
[ "$FAIL" -eq 0 ] && echo -e "\n${GREEN}🎉 All tests passed!${NC}" || echo -e "\n${RED}Some tests failed — see above${NC}"
