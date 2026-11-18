#!/bin/sh
# Sets up Basalt Sync on a fresh Ubuntu or Debian server, such as an EC2 or Lightsail instance:
# installs Docker, writes /opt/basalt/.env with new secrets, and starts the sync server, Postgres
# and Caddy (HTTPS). Run it on the server as root, with your domain:
#
#   curl -fsSL https://raw.githubusercontent.com/Nabhyaraj-Sonagara/Basalt/main/deploy/aws/setup.sh | sudo sh -s -- sync.example.com
#
# Or paste these two lines into the instance's "User data" when you launch it, so it runs on first boot:
#
#   #!/bin/sh
#   curl -fsSL https://raw.githubusercontent.com/Nabhyaraj-Sonagara/Basalt/main/deploy/aws/setup.sh | sh -s -- sync.example.com
#
# Running it again updates the compose files and the server image, and keeps .env (your secrets
# and settings). Options (environment variables): BASALT_DIR (default /opt/basalt), BASALT_REF
# (git branch or tag to take the files from, default main), BASALT_SRC (where to fetch them from),
# SYNC_IMAGE (a server image to pin, saved in .env).
set -eu

say() { printf '%s\n' "$*"; }
fail() {
  printf 'Basalt Sync setup failed: %s\n' "$*" >&2
  exit 1
}

DOMAIN="${1:-}"
DIR="${BASALT_DIR:-/opt/basalt}"
SRC="${BASALT_SRC:-https://raw.githubusercontent.com/Nabhyaraj-Sonagara/Basalt/${BASALT_REF:-main}/deploy/aws}"

[ "$(id -u)" = 0 ] || fail "run it as root, for example: curl -fsSL … | sudo sh -s -- sync.example.com"
if [ -z "$DOMAIN" ] && [ ! -f "$DIR/.env" ]; then fail "give your sync domain, for example: sh setup.sh sync.example.com"; fi
case "$DOMAIN" in
  '' | *.*) ;;
  *) fail "\"$DOMAIN\" doesn't look like a domain name (for example sync.example.com)" ;;
esac
case "$DOMAIN" in http://* | https://* | */*) fail "give just the name, like sync.example.com, without https:// or a path" ;; esac

secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32; else od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; fi
}

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | sh >/dev/null || fail "couldn't install Docker"
fi
docker compose version >/dev/null 2>&1 || fail "Docker Compose isn't available (install the docker-compose-plugin package)"

mkdir -p "$DIR"
cd "$DIR"
say "Fetching the server files into $DIR…"
for f in docker-compose.yml Caddyfile backup.sh .env.example; do
  curl -fsSL "$SRC/$f" -o "$f.new" || fail "couldn't download $SRC/$f"
  mv -f "$f.new" "$f"
done
chmod +x backup.sh

if [ ! -f .env ]; then
  umask 077
  sed -e "s|^SYNC_DOMAIN=.*|SYNC_DOMAIN=$DOMAIN|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(secret)|" \
    -e "s|^SERVER_SECRET=.*|SERVER_SECRET=$(secret)|" .env.example >.env
  umask 022
  say "Wrote $DIR/.env with new secrets. Keep a copy somewhere safe: the database password is in it."
elif [ -n "$DOMAIN" ]; then
  sed -i "s|^SYNC_DOMAIN=.*|SYNC_DOMAIN=$DOMAIN|" .env
fi
# SYNC_IMAGE=… pins a server version (for example ghcr.io/nabhyaraj-sonagara/basalt-sync:v0.3.0).
if [ -n "${SYNC_IMAGE:-}" ]; then
  sed -i '/^#* *SYNC_IMAGE=/d' .env
  printf 'SYNC_IMAGE=%s\n' "$SYNC_IMAGE" >>.env
fi
chmod 600 .env
DOMAIN=$(sed -n 's/^SYNC_DOMAIN=//p' .env)

say "Starting Basalt Sync…"
# A failed pull (registry briefly down) still starts the images already here.
docker compose pull -q --ignore-pull-failures
docker compose up -d --remove-orphans

# The sync container reports healthy once it can reach the database.
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q sync)" 2>/dev/null)" = healthy ]; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    docker compose logs --tail 30 sync >&2
    fail "the sync server didn't start (its log is above)"
  fi
  sleep 2
done

# Caddy gets the HTTPS certificate once the domain points here; that can take a minute.
i=0
until curl -fsS -m 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/healthz" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 24 ]; then
    say ""
    say "Basalt Sync is running, but HTTPS for $DOMAIN isn't ready yet."
    say "Check that $DOMAIN has a DNS A record pointing at this server's public IP, and that ports 80 and"
    say "443 are open to the internet (Caddy needs both to get its certificate). It retries by itself;"
    say "see progress with:  cd $DIR && docker compose logs -f caddy"
    exit 0
  fi
  sleep 5
done

say ""
say "Basalt Sync is running at https://$DOMAIN"
say "In Basalt, open Settings → Sync, enter https://$DOMAIN and create your account."
say "Settings (storage limits, sign-ups) are in $DIR/.env; apply changes with:  cd $DIR && docker compose up -d"
