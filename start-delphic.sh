#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_BASE="${SCRIPT_DIR}/docker-compose.yml"
COMPOSE_PROD="${SCRIPT_DIR}/docker-compose.prod.yml"
UNIT_NAME="delphic.service"
UNIT_PATH="/etc/systemd/system/${UNIT_NAME}"
ENV_FILE="${SCRIPT_DIR}/.env"
BACKUP_DIR="${SCRIPT_DIR}/backups"
# Keep this many pre-deploy dumps (one per push). Oldest is deleted so the
# count never exceeds BACKUP_KEEP — default 7, not unbounded growth.
BACKUP_KEEP="${BACKUP_KEEP:-7}"
# Abort the backup/deploy when the backups filesystem has less than this free.
BACKUP_MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-2}"

if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; NC=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; NC=""
fi

info() { printf '%s[info]%s %s\n' "${BLUE}" "${NC}" "$*"; }
success() { printf '%s[ok]%s %s\n' "${GREEN}" "${NC}" "$*"; }
warning() { printf '%s[warn]%s %s\n' "${YELLOW}" "${NC}" "$*"; }
error() { printf '%s[error]%s %s\n' "${RED}" "${NC}" "$*" >&2; }

usage() {
  cat <<'EOF'
Usage: ./start-delphic.sh [options]

Start the Delphic stack with Docker Compose (Postgres + API + client nginx).

Options:
  --prod          Use docker-compose.prod.yml (loopback binds, required secrets)
  --service       Non-interactive entry for systemd (no boot reinstall)
  --no-boot       Skip installing/enabling the systemd unit after a successful start
  --skip-backup   Do NOT take a verified pre-deploy DB backup first (discouraged)
  --skip-rehearsal  Do NOT rehearse migrations on a copy of that backup first (discouraged)
  --rehearse-only   Take the backup and rehearse the migrations, then stop. Changes nothing live.
  -h, --help      Show this help

Every --prod run takes a verified `pg_dump -Fc` of the live database into
./backups/ BEFORE building/migrating, and aborts the deploy if that backup
cannot be written or read back, or if the backups volume has less than
BACKUP_MIN_FREE_GB (default 2) free. Keeps the newest BACKUP_KEEP (default 7)
predeploy-*.dump files and deletes older ones. Restores are always manual.

It then restores that backup into a throwaway Postgres container and runs the
new server image's `prisma migrate deploy` against the copy. If any migration
fails there, the deploy stops before the live database or running containers
are touched.

Examples:
  ./start-delphic.sh --prod
  ./start-delphic.sh --prod --no-boot
  ./start-delphic.sh --prod --service
EOF
}

require_file() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    error "Missing required file: ${path}"
    exit 2
  fi
}

env_has_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d= -f2- || true)"
  if [[ -z "${value}" ]]; then
    return 1
  fi
  case "${value}" in
    change_me_*|dev_*_change_me|postgres|local_dev_*) return 1 ;;
  esac
  if [[ "${key}" == JWT_* && "${#value}" -lt 32 ]]; then
    return 1
  fi
  return 0
}

validate_prod_env() {
  require_file "${ENV_FILE}"
  local missing=0
  for key in POSTGRES_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET CORS_ORIGIN; do
    if ! env_has_value "${key}"; then
      error "${key} must be set to a strong non-placeholder value in ${ENV_FILE}"
      missing=1
    fi
  done
  if [[ "${missing}" -ne 0 ]]; then
    exit 2
  fi
}

compose_cmd() {
  docker compose -f "${COMPOSE_BASE}" -f "${COMPOSE_PROD}" "$@"
}

# The prod overlay relies on the !reset / !override merge tags (Compose 2.24+).
# On an older Compose those tags fail or silently append, which would publish
# Postgres and the API on every interface. Assert the merged result instead of
# trusting a version string.
assert_loopback_only() {
  local merged published_count loopback_count
  if ! merged="$(compose_cmd config 2>&1)"; then
    error "docker compose config failed:"
    printf '%s\n' "${merged}" >&2
    exit 1
  fi

  # Compose omits host_ip entirely when a port binds all interfaces, so compare
  # the number of published ports against the number bound to 127.0.0.1.
  published_count="$(printf '%s\n' "${merged}" | grep -cE '^\s*published:' || true)"
  loopback_count="$(printf '%s\n' "${merged}" | grep -cE '^\s*host_ip:\s*127\.0\.0\.1\s*$' || true)"

  if [[ "${published_count}" -ne "${loopback_count}" ]]; then
    error "Merged compose config publishes ${published_count} port(s) but only ${loopback_count} are bound to 127.0.0.1."
    error "Docker publish rules bypass UFW, so this would expose services to the internet."
    error "This usually means Docker Compose is older than 2.24 and ignored the !reset/!override tags."
    error "Check 'docker compose version', then re-run."
    exit 1
  fi

  if printf '%s\n' "${merged}" | grep -qE '^\s*published:\s*"?(5432|5434)"?\s*$'; then
    error "Merged compose config still publishes Postgres. Refusing to start."
    exit 1
  fi

  success "Preflight: all ${published_count} published port(s) bound to loopback only"
}

# Take a verified pg_dump -Fc of the live DB before we build/migrate. A deploy
# that CANNOT prove it captured the current data does not proceed — that dump is
# the only thing standing between a bad migration and permanent data loss.
#
# Safe on a brand-new install too: if the DB is genuinely empty, pg_dump still
# succeeds (tiny dump) and we continue with a warning. We only abort when pg_dump
# itself errors — i.e. we could not read the database at all.
backup_db() {
  local db_user="${POSTGRES_USER:-postgres}"
  local db_name="${POSTGRES_DB:-requirement_dashboard}"
  local ts out size i

  # Make sure the db service is up (systemd --service mode stops the whole stack
  # on ExecStop, so on a reboot nothing is running yet). Starting just `db` is
  # non-destructive — the named volume persists.
  if ! compose_cmd ps --status running db 2>/dev/null | grep -q '\bdb\b'; then
    info "Starting 'db' service to take the pre-deploy backup"
    compose_cmd up -d db
  fi
  for i in $(seq 1 30); do
    if compose_cmd exec -T db pg_isready -U "${db_user}" -d "${db_name}" >/dev/null 2>&1; then
      break
    fi
    info "Waiting for Postgres… (${i}/30)"
    sleep 2
  done
  if ! compose_cmd exec -T db pg_isready -U "${db_user}" -d "${db_name}" >/dev/null 2>&1; then
    error "Postgres never became ready — aborting deploy before any change."
    exit 1
  fi

  mkdir -p "${BACKUP_DIR}"
  assert_backup_disk_space

  ts="$(date +%Y-%m-%d-%H%M%S)"
  out="${BACKUP_DIR}/predeploy-${ts}.dump"
  LAST_BACKUP="${out}"

  info "Backing up database '${db_name}' → ${out}"
  if ! compose_cmd exec -T db pg_dump -U "${db_user}" -Fc "${db_name}" > "${out}"; then
    error "pg_dump FAILED — could not read the database. Aborting deploy. No changes were made."
    rm -f "${out}"
    exit 1
  fi

  # Verify the dump is readable by pg_restore (do it inside the container, which
  # always has a matching pg_restore; the host may not).
  if ! compose_cmd exec -T db sh -c 'cat > /tmp/verify.dump && pg_restore --list /tmp/verify.dump >/dev/null && rm -f /tmp/verify.dump' < "${out}"; then
    error "Backup ${out} could not be read back by pg_restore --list. Aborting deploy."
    exit 1
  fi

  size="$(wc -c < "${out}" | tr -d ' ')"
  if [[ "${size}" -lt 2000 ]]; then
    warning "Backup ${out} is only ${size} bytes — treating this as a fresh/empty database. Continuing."
  else
    success "Verified pre-deploy backup: ${out} (${size} bytes)"
  fi

  # Keep exactly the newest ${BACKUP_KEEP} predeploy dumps (one per push).
  local old
  # shellcheck disable=SC2012
  ls -1t "${BACKUP_DIR}"/predeploy-*.dump 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do
    rm -f "${old}" && info "Rotated out old backup: $(basename "${old}")"
  done
}

# Refuse to write a new dump when the backups filesystem is nearly full.
assert_backup_disk_space() {
  local min_kb avail_kb
  min_kb=$((BACKUP_MIN_FREE_GB * 1024 * 1024))
  avail_kb="$(df -Pk "${BACKUP_DIR}" 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ -z "${avail_kb}" ]]; then
    warning "Could not read free space for ${BACKUP_DIR} — continuing without a disk guard."
    return 0
  fi
  if [[ "${avail_kb}" -lt "${min_kb}" ]]; then
    error "Less than ${BACKUP_MIN_FREE_GB} GiB free on ${BACKUP_DIR} (${avail_kb} KiB available). Aborting before writing a backup."
    exit 1
  fi
}

# Restore the pre-deploy backup into a throwaway Postgres on the stack's network
# and apply the NEW server image's migrations to it. A migration that cannot
# apply to a copy of today's data never reaches the live database: the live db
# keeps running, the old server keeps serving, and the deploy exits non-zero.
rehearse_migrations() {
  local dump="$1"
  local db_container network name rc i
  name="delphic-migrate-rehearsal-$$"

  info "Building the new server image for the migration rehearsal"
  compose_cmd build server

  db_container="$(compose_cmd ps -q db)"
  network="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "${db_container}" | awk '{print $1}')"
  if [[ -z "${network}" ]]; then
    error "Could not find the compose network for the migration rehearsal. Aborting deploy. No changes were made."
    exit 1
  fi

  info "Restoring ${dump} into throwaway container ${name}"
  docker run -d --rm --name "${name}" --network "${network}"     -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=rehearsal postgres:16-alpine >/dev/null
  # shellcheck disable=SC2064
  trap "docker rm -f ${name} >/dev/null 2>&1 || true" EXIT
  # Check over TCP: during first-boot init the image runs a temporary server on
  # the unix socket only, then restarts. TCP answers only once the real one is up.
  for i in $(seq 1 60); do
    docker exec -e PGPASSWORD=rehearsal "${name}" psql -h 127.0.0.1 -U postgres -d rehearsal -Atc 'select 1' >/dev/null 2>&1 && break
    sleep 2
  done
  if ! docker exec -e PGPASSWORD=rehearsal "${name}" psql -h 127.0.0.1 -U postgres -d rehearsal -Atc 'select 1' >/dev/null 2>&1; then
    error "Throwaway Postgres for the rehearsal never became ready. Aborting deploy. No changes were made."
    exit 1
  fi
  if ! docker exec -i -e PGPASSWORD=rehearsal "${name}" pg_restore -h 127.0.0.1 -U postgres -d rehearsal --no-owner --exit-on-error < "${dump}"; then
    error "Could not restore ${dump} for the rehearsal. Aborting deploy. No changes were made."
    exit 1
  fi

  info "Applying the new migrations to the copy"
  set +e
  compose_cmd run --rm --no-deps -T     -e DATABASE_URL="postgres://postgres:rehearsal@${name}:5432/rehearsal"     server npx prisma migrate deploy
  rc=$?
  set -e
  docker rm -f "${name}" >/dev/null 2>&1 || true
  trap - EXIT

  if [[ "${rc}" -ne 0 ]]; then
    error "Migrations FAILED on a copy of the live database. Aborting deploy."
    error "Production is untouched: same containers, same data. Fix the migration and redeploy."
    exit 1
  fi
  success "Migration rehearsal passed on a copy of the live database"
}

wait_for_health() {
  local url="http://127.0.0.1:${API_PORT:-4000}/api/v1/health"
  local i
  for i in $(seq 1 60); do
    if curl -sf "${url}" >/dev/null; then
      success "API healthy at ${url}"
      return 0
    fi
    info "Waiting for API… (${i}/60)"
    sleep 5
  done
  error "API did not become healthy"
  compose_cmd logs --no-color --tail=80 || true
  exit 1
}

install_boot_unit() {
  if [[ "${EUID}" -ne 0 ]]; then
    warning "Skipping systemd install (need root). Re-run with sudo to enable boot persistence."
    return 0
  fi

  cat > "${UNIT_PATH}" <<EOF
[Unit]
Description=Delphic One Docker Compose stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${SCRIPT_DIR}/start-delphic.sh --prod --service
ExecStop=/usr/bin/docker compose -f ${COMPOSE_BASE} -f ${COMPOSE_PROD} down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "${UNIT_NAME}"
  success "Installed and enabled ${UNIT_NAME}"
}

main() {
  local use_prod=0
  local as_service=0
  local no_boot=0
  local skip_backup=0
  local skip_rehearsal=0
  local rehearse_only=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --prod) use_prod=1 ;;
      --service) as_service=1 ;;
      --no-boot) no_boot=1 ;;
      --skip-backup) skip_backup=1 ;;
      --skip-rehearsal) skip_rehearsal=1 ;;
      --rehearse-only) rehearse_only=1 ;;
      -h|--help) usage; exit 0 ;;
      *) error "Unknown option: $1"; usage; exit 2 ;;
    esac
    shift
  done

  if [[ "${use_prod}" -ne 1 ]]; then
    error "This front door is for production. Pass --prod (local Docker uses: docker compose up)."
    exit 2
  fi

  require_file "${COMPOSE_BASE}"
  require_file "${COMPOSE_PROD}"
  command -v docker >/dev/null || { error "docker is required"; exit 2; }
  command -v curl >/dev/null || { error "curl is required"; exit 2; }

  require_file "${ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a
  validate_prod_env
  assert_loopback_only

  if [[ "${skip_backup}" -eq 1 ]]; then
    warning "--skip-backup: NOT taking a pre-deploy DB backup. If a migration loses data it cannot be rolled back."
  else
    backup_db
  fi

  if [[ "${rehearse_only}" -eq 1 && ( "${skip_backup}" -eq 1 || "${skip_rehearsal}" -eq 1 ) ]]; then
    error "--rehearse-only needs the backup and the rehearsal; drop --skip-backup / --skip-rehearsal."
    exit 2
  fi

  if [[ "${skip_rehearsal}" -eq 1 ]]; then
    warning "--skip-rehearsal: migrations go straight to the live database."
  elif [[ "${as_service}" -eq 1 ]]; then
    # Boot-time start: the code was already rehearsed when it was deployed, and a
    # rehearsal hiccup must not keep the stack down after a reboot.
    info "Service mode: skipping the migration rehearsal"
  elif [[ -z "${LAST_BACKUP:-}" ]]; then
    warning "No backup taken this run, so there is nothing to rehearse migrations against."
  else
    rehearse_migrations "${LAST_BACKUP}"
  fi

  if [[ "${rehearse_only}" -eq 1 ]]; then
    success "Rehearsal only: backup ${LAST_BACKUP} taken, migrations verified on a copy. Nothing live was changed."
    exit 0
  fi

  if [[ "${as_service}" -eq 1 ]]; then
    info "Stopping stale stack (service mode)"
    compose_cmd down || true
  fi

  info "Building and starting production stack"
  compose_cmd up -d --build
  wait_for_health

  if [[ "${as_service}" -eq 0 && "${no_boot}" -eq 0 ]]; then
    install_boot_unit
  elif [[ "${no_boot}" -eq 1 ]]; then
    warning "Boot persistence skipped (--no-boot)"
  fi

  success "Delphic is up. Client: http://127.0.0.1:${CLIENT_PORT:-8081} (front with host nginx + TLS)"
}

main "$@"
