#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; NC=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; NC=""
fi

info() { printf '%s[info]%s %s\n' "${BLUE}" "${NC}" "$*"; }
success() { printf '%s[ok]%s %s\n' "${GREEN}" "${NC}" "$*"; }
error() { printf '%s[error]%s %s\n' "${RED}" "${NC}" "$*" >&2; }

usage() {
  cat <<'EOF'
Usage: sudo ./setup-vm.sh

Idempotent Ubuntu bootstrap for Delphic on EC2:
  - update/upgrade packages
  - install Docker (docker.io), Compose v2, nginx, certbot, git, curl
  - enable docker and nginx on boot
  - add the invoking user to the docker group

Does not install app secrets. After this script, copy .env and run ./start-delphic.sh --prod.
EOF
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    error "Run as root: sudo ./setup-vm.sh"
    exit 2
  fi
}

verify_cmd() {
  local name="$1"
  if ! command -v "${name}" >/dev/null; then
    error "Missing command after install: ${name}"
    exit 1
  fi
  success "${name} available: $(command -v "${name}")"
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help) usage; exit 0 ;;
      *) error "Unknown option: $1"; usage; exit 2 ;;
    esac
    shift
  done

  require_root

  info "Updating package indexes"
  apt-get update -y

  info "Upgrading installed packages"
  DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

  info "Installing runtime prerequisites"
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    git \
    docker.io \
    docker-compose-v2 \
    nginx \
    certbot \
    python3-certbot-nginx

  info "Enabling docker and nginx"
  systemctl enable --now docker
  systemctl enable --now nginx

  local invoke_user="${SUDO_USER:-}"
  if [[ -n "${invoke_user}" && "${invoke_user}" != "root" ]]; then
    usermod -aG docker "${invoke_user}"
    success "Added ${invoke_user} to docker group (re-login required)"
  fi

  verify_cmd docker
  docker compose version >/dev/null
  success "docker compose plugin ok"
  verify_cmd nginx
  verify_cmd certbot
  verify_cmd git
  verify_cmd curl

  chmod +x "${SCRIPT_DIR}/start-delphic.sh" || true
  success "VM bootstrap complete. Next: create ${SCRIPT_DIR}/.env, then ./start-delphic.sh --prod"
}

main "$@"
