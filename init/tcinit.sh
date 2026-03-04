#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Determine paths
# ─────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Load overrides from .env in the project root
if [ -f "${PROJECT_ROOT}/.env.example" ]; then
  # shellcheck disable=SC1090
  source "${PROJECT_ROOT}/.env.example"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Defaults (override via env)
# ─────────────────────────────────────────────────────────────────────────────
TIDECLOAK_LOCAL_URL="${TIDECLOAK_LOCAL_URL:-http://localhost:8080}"
CLIENT_APP_URL="${CLIENT_APP_URL:-http://localhost:3000}"
REALM_JSON_PATH="${REALM_JSON_PATH:-${SCRIPT_DIR}/realm.json}"
ADAPTER_OUTPUT_PATH="${ADAPTER_OUTPUT_PATH:-${PROJECT_ROOT}/data/tidecloak.json}"
NEW_REALM_NAME="${NEW_REALM_NAME:-forseti-test}"
REALM_MGMT_CLIENT_ID="realm-management"
ADMIN_ROLE_NAME="tide-realm-admin"
KC_USER="${KC_USER:-admin}"
KC_PASSWORD="${KC_PASSWORD:-password}"
CLIENT_NAME="${CLIENT_NAME:-myclient}"
SUBSCRIPTION_EMAIL="${SUBSCRIPTION_EMAIL:-test@demo.org}"

# ─────────────────────────────────────────────────────────────────────────────
# sed -i portability
# ─────────────────────────────────────────────────────────────────────────────
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=(-i)
else
  SED_INPLACE=(-i '')
fi

# ─────────────────────────────────────────────────────────────────────────────
# Helper: grab an admin token
# ─────────────────────────────────────────────────────────────────────────────
get_admin_token() {
  curl -s -X POST "${TIDECLOAK_LOCAL_URL}/realms/master/protocol/openid-connect/token" \
       -H "Content-Type: application/x-www-form-urlencoded" \
       -d "username=${KC_USER}" \
       -d "password=${KC_PASSWORD}" \
       -d "grant_type=password" \
       -d "client_id=admin-cli" \
    | jq -r .access_token
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: prepare realm JSON
# ─────────────────────────────────────────────────────────────────────────────
REALM_NAME="${NEW_REALM_NAME}"
echo "${REALM_NAME}" > "${PROJECT_ROOT}/.realm_name"

TMP_REALM_JSON="$(mktemp)"
cp "${REALM_JSON_PATH}" "${TMP_REALM_JSON}"

# replace placeholders
sed "${SED_INPLACE[@]}" "s|http://localhost:3000|${CLIENT_APP_URL}|g" "${TMP_REALM_JSON}"
sed "${SED_INPLACE[@]}" "s|forseti-test|${REALM_NAME}|g"      "${TMP_REALM_JSON}"
sed "${SED_INPLACE[@]}" "s|myclient|${CLIENT_NAME}|g"        "${TMP_REALM_JSON}"

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: create realm (allow 409 if already exists)
# ─────────────────────────────────────────────────────────────────────────────
TOKEN="$(get_admin_token)"
echo "🌍 Creating realm..."
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @"${TMP_REALM_JSON}")

if [[ ${status} == 2* || ${status} -eq 409 ]]; then
  echo "✅ Realm created (or already exists)."
else
  echo "❌ Realm creation failed (HTTP ${status})" >&2
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: initialize Tide realm + IGA
# ─────────────────────────────────────────────────────────────────────────────
TOKEN="$(get_admin_token)"
echo "🔐 Initializing Tide realm + IGA..."

response=$(curl -i -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/vendorResources/setUpTideRealm" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "email=${SUBSCRIPTION_EMAIL}" 2>&1)

# toggle IGA
curl -s -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/tide-admin/toggle-iga" \
     -H "Authorization: Bearer ${TOKEN}" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     --data-urlencode "isIGAEnabled=true" \
  > /dev/null

echo "✅ Tide realm + IGA done."

# ─────────────────────────────────────────────────────────────────────────────
# Approve & commit change-sets
# ─────────────────────────────────────────────────────────────────────────────
approve_and_commit() {
  local TYPE=$1
  echo "🔄 Processing ${TYPE} change-sets..."
  TOKEN="$(get_admin_token)"
  curl -s -X GET "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/tide-admin/change-set/${TYPE}/requests" \
       -H "Authorization: Bearer ${TOKEN}" \
    | jq -c '.[]' | while read -r req; do
        payload=$(jq -n \
          --arg id  "$(jq -r .draftRecordId   <<< "${req}")" \
          --arg cst "$(jq -r .changeSetType   <<< "${req}")" \
          --arg at  "$(jq -r .actionType      <<< "${req}")" \
          '{changeSetId:$id,changeSetType:$cst,actionType:$at}')

        curl -s -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/tide-admin/change-set/sign" \
             -H "Authorization: Bearer ${TOKEN}" \
             -H "Content-Type: application/json" \
             -d "${payload}" \
          > /dev/null

        curl -s -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/tide-admin/change-set/commit" \
             -H "Authorization: Bearer ${TOKEN}" \
             -H "Content-Type: application/json" \
             -d "${payload}" \
          > /dev/null
      done
  echo "✅ ${TYPE^} change-sets done."
}
approve_and_commit clients

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: create admin user + assign role
# ─────────────────────────────────────────────────────────────────────────────
TOKEN="$(get_admin_token)"
echo "👤 Creating new admin user..."
curl -s -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/users" \
     -H "Authorization: Bearer ${TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","email":"admin@tidecloak.com","firstName":"admin","lastName":"user","enabled":true}' \
  > /dev/null

USER_ID=$(curl -s -X GET \
  "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/users?username=admin" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.[0].id')

CLIENT_UUID=$(curl -s -X GET \
  "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/clients?clientId=${REALM_MGMT_CLIENT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.[0].id')

ROLE_JSON=$(curl -s -X GET \
  "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/clients/${CLIENT_UUID}/roles/${ADMIN_ROLE_NAME}" \
  -H "Authorization: Bearer ${TOKEN}")

curl -s -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/users/${USER_ID}/role-mappings/clients/${CLIENT_UUID}" \
     -H "Authorization: Bearer ${TOKEN}" \
     -H "Content-Type: application/json" \
     -d "[${ROLE_JSON}]" \
  > /dev/null

echo "✅ Admin user & role done."

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: generate invite link + wait
# ─────────────────────────────────────────────────────────────────────────────
TOKEN="$(get_admin_token)"
echo "🔗 Generating invite link..."
INVITE_LINK=$(curl -s -X POST \
  "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/tideAdminResources/get-required-action-link?userId=${USER_ID}&lifespan=43200" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '["link-tide-account-action"]')

echo "🔗 Invite link: ${INVITE_LINK}"
echo "→ Use (or send) this URL to link the first admin to their account."

MAX_TRIES=3
attempt=1
while true; do
  echo -n "Checking link status (attempt ${attempt}/${MAX_TRIES})… "
  ATTRS=$(curl -s -X GET \
    "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/users?username=admin" \
    -H "Authorization: Bearer ${TOKEN}")

  KEY=$(jq -r '.[0].attributes.tideUserKey[0] // empty' <<< "${ATTRS}")
  VUID=$(jq -r '.[0].attributes.vuid[0]        // empty' <<< "${ATTRS}")

  if [[ -n "${KEY}" && -n "${VUID}" ]]; then
    echo "✅ Linked!"
    break
  fi

  if (( attempt >= MAX_TRIES )); then
    echo "⚠️  Max retries reached (${MAX_TRIES}). Moving on."
    break
  fi

  read -t 30 -p "Not linked yet; press ENTER to retry or wait 30s…" || true
  echo
  ((attempt++))
done

approve_and_commit users

# ─────────────────────────────────────────────────────────────────────────────
# Step 6: update CustomAdminUIDomain
# ─────────────────────────────────────────────────────────────────────────────
TOKEN="$(get_admin_token)"
echo "🌐 Updating CustomAdminUIDomain..."

INST_JSON=$(curl -s -X GET \
  "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/identity-provider/instances/tide" \
  -H "Authorization: Bearer ${TOKEN}")

UPDATED_JSON=$(jq --arg d "${CLIENT_APP_URL}" '.config.CustomAdminUIDomain = $d' <<< "${INST_JSON}")

curl -s -X PUT "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/identity-provider/instances/tide" \
     -H "Authorization: Bearer ${TOKEN}" \
     -H "Content-Type: application/json" \
     -d "${UPDATED_JSON}" \
  > /dev/null

curl -s -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/vendorResources/sign-idp-settings" \
     -H "Authorization: Bearer ${TOKEN}" \
  > /dev/null

echo "✅ CustomAdminUIDomain updated + signed."


# ─────────────────────────────────────────────────────────────────────────────
# Step 7: fetch adapter config + cleanup
# ─────────────────────────────────────────────────────────────────────────────
TOKEN="$(get_admin_token)"
echo "📥 Fetching adapter config…"
CLIENT_UUID=$(curl -s -X GET \
  "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/clients?clientId=${CLIENT_NAME}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r '.[0].id')

mkdir -p "$(dirname "${ADAPTER_OUTPUT_PATH}")"
curl -s -X GET \
  "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/vendorResources/get-installations-provider?clientId=${CLIENT_UUID}&providerId=keycloak-oidc-keycloak-json" \
  -H "Authorization: Bearer ${TOKEN}" \
  > "${ADAPTER_OUTPUT_PATH}"

echo "✅ Adapter config saved to ${ADAPTER_OUTPUT_PATH}"
rm -f "${PROJECT_ROOT}/.realm_name" "${TMP_REALM_JSON}"

echo "🎉 All done!"
