#!/usr/bin/env bash
# Serveur KYC local (apps/api) pour tester le mode « En ligne · KYC » de l'app depuis un iPhone
# sur le même Wi-Fi — voir apps/mobile/src/authentik/README.md « Mode en ligne · KYC ».
#
#   scripts/serveur-local.sh installer              .env, clés de signature, Postgres + Redis (Docker), tables
#   scripts/serveur-local.sh demarrer               API + worker, affiche l'adresse à saisir dans l'app (Ctrl-C pour arrêter)
#   scripts/serveur-local.sh client [identifiant]   crée un client KYC et affiche sa clé API (une seule fois)
#   scripts/serveur-local.sh registre <exige|non-exige> [identifiant]
#                                                   registre des documents perdus/volés exigé ou non pour ce client
#   scripts/serveur-local.sh master-list <fichier>  charge la Master List ICAO (.ml) ou un export LDIF dans le serveur
#   scripts/serveur-local.sh empreintes             ré-affiche les empreintes à comparer dans l'app
#   scripts/serveur-local.sh clients                liste les clients KYC et leur réglage « registre »
#
# SANS_DOCKER=1 : Postgres et Redis tournent déjà autrement (adresses de DATABASE_URL / REDIS_URL).
# Les clés de signature déjà présentes dans .env ne sont jamais remplacées : l'app les a peut-être
# déjà épinglées, et une nouvelle clé ferait refuser tous les résultats.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/apps/api"
ENV_FILE="$ROOT/.env"
TS_NODE=(node -r ts-node/register/transpile-only)
CLIENT_FIELDS="documentNumber,dateOfBirth,dateOfExpiry,nationality,sex,primaryIdentifier,secondaryIdentifier"

info() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() {
  printf '\nErreur : %s\n' "$*" >&2
  exit 1
}

# Remplace (ou ajoute) CLÉ=valeur dans .env — en Node plutôt que `sed -i`, dont la syntaxe diffère sur macOS.
env_set() {
  node -e '
    const fs = require("fs");
    const [file, key, value] = process.argv.slice(1);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const i = lines.findIndex((line) => line.startsWith(key + "="));
    if (i >= 0) lines[i] = key + "=" + value;
    else lines.splice(lines[lines.length - 1] === "" ? lines.length - 1 : lines.length, 0, key + "=" + value);
    fs.writeFileSync(file, lines.join("\n"));
  ' "$ENV_FILE" "$1" "$2"
}

env_get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

load_env() {
  [ -f "$ENV_FILE" ] || die "pas de .env — lance d'abord : scripts/serveur-local.sh installer"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

# Attend qu'un port TCP accepte les connexions (60 s au plus).
wait_port() {
  node -e '
    const net = require("net");
    const [host, port] = [process.argv[1], Number(process.argv[2])];
    const deadline = Date.now() + 60000;
    (function attempt() {
      const socket = net.connect(port, host, () => { socket.end(); process.exit(0); });
      socket.on("error", () => { if (Date.now() > deadline) process.exit(1); setTimeout(attempt, 1000); });
    })();
  ' "$1" "$2" || die "$3 ne répond pas sur $1:$2"
}

url_host_port() { node -e 'const u = new URL(process.argv[1]); console.log(u.hostname + " " + (u.port || process.argv[2]))' "$1" "$2"; }

fingerprint() {
  node -e '
    const hex = require("crypto").createHash("sha256").update(Buffer.from(process.argv[1], "base64")).digest("hex");
    console.log(hex.slice(0, 32).toUpperCase().match(/..../g).join(" "));
  ' "$1"
}

# Génère une paire de clés via le script de l'API si .env n'en a pas encore.
ensure_key_pair() {
  local script="$1" prefix="$2" label="$3" out
  if [ -n "$(env_get "${prefix}_PRIVATE_KEY")" ]; then
    echo "$label : déjà présente dans .env, conservée."
    return
  fi
  out="$(cd "$API" && "${TS_NODE[@]}" "scripts/$script")"
  env_set "${prefix}_PRIVATE_KEY" "$(printf '%s\n' "$out" | grep "^${prefix}_PRIVATE_KEY=" | cut -d= -f2-)"
  env_set "${prefix}_PUBLIC_KEY" "$(printf '%s\n' "$out" | grep "^${prefix}_PUBLIC_KEY=" | cut -d= -f2-)"
  echo "$label : générée et enregistrée dans .env."
}

cmd_empreintes() {
  local result bundle
  result="$(env_get VERIFICATION_RESULT_SIGNING_PUBLIC_KEY)"
  bundle="$(env_get CSCA_BUNDLE_SIGNING_PUBLIC_KEY)"
  info "Empreintes à comparer dans l'app (Réglages › Serveur KYC) :"
  if [ -n "$result" ]; then echo "  Clé qui signe les résultats    : $(fingerprint "$result")"; fi
  if [ -n "$bundle" ]; then echo "  Clé qui signe le magasin CSCA  : $(fingerprint "$bundle")"; fi
}

cmd_installer() {
  command -v node >/dev/null || die "node introuvable"
  command -v pnpm >/dev/null || die "pnpm introuvable (npm install -g pnpm)"

  info "1/5 Fichier .env"
  if [ ! -f "$ENV_FILE" ]; then
    cp "$ROOT/.env.example" "$ENV_FILE"
    echo ".env créé depuis .env.example."
  fi
  # Chemins absolus : l'API est lancée depuis apps/api, où les chemins relatifs de .env.example ne mènent nulle part.
  env_set MASTER_LIST_SIGNER_TRUST_ANCHORS_PATH "$ROOT/config/master-list-signer-trust-anchors.json"
  env_set EXTENDED_TRUST_STORE_PATH "$ROOT/config/extended-trust-store.json"
  if [ -z "$(env_get LIVENESS_CHALLENGE_SIGNING_SECRET)" ]; then
    env_set LIVENESS_CHALLENGE_SIGNING_SECRET "$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  fi

  info "2/5 Dépendances (pnpm install)"
  (cd "$ROOT" && pnpm install)

  info "3/5 Clés de signature du serveur"
  ensure_key_pair generate-signing-key.ts VERIFICATION_RESULT_SIGNING "Clé qui signe les résultats"
  ensure_key_pair generate-csca-bundle-signing-key.ts CSCA_BUNDLE_SIGNING "Clé qui signe le magasin CSCA"

  info "4/5 Postgres et Redis"
  if [ "${SANS_DOCKER:-0}" != "1" ]; then
    command -v docker >/dev/null || die "Docker introuvable : installe Docker Desktop (ou SANS_DOCKER=1 si Postgres/Redis tournent déjà)"
    docker info >/dev/null 2>&1 || die "Docker ne tourne pas : ouvre Docker Desktop, attends qu'il soit prêt, puis relance"
    (cd "$ROOT" && docker compose up -d postgres redis)
  fi
  load_env
  # shellcheck disable=SC2046
  wait_port $(url_host_port "$DATABASE_URL" 5432) "Postgres"
  # shellcheck disable=SC2046
  wait_port $(url_host_port "$REDIS_URL" 6379) "Redis"

  info "5/5 Tables de la base (migrations Prisma)"
  (cd "$API" && pnpm prisma:generate >/dev/null && pnpm prisma:migrate:deploy)

  cmd_empreintes
  info "Installation terminée. Étape suivante : scripts/serveur-local.sh demarrer"
}

cmd_clients() {
  load_env
  cd "$API"
  node -e '
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    prisma.kycClient.findMany({ orderBy: { createdAt: "asc" } })
      .then((clients) => {
        if (clients.length === 0) console.log("  (aucun client — scripts/serveur-local.sh client)");
        for (const c of clients) {
          console.log(`  ${c.clientId} : registre perdus/volés ${c.lostStolenCheckRequired ? "exigé" : "non exigé"}${c.active ? "" : " (suspendu)"}`);
        }
      })
      .finally(() => prisma.$disconnect());
  '
}

cmd_demarrer() {
  load_env
  cd "$API"
  # Toujours la base au niveau du code (nouvelles colonnes après un git pull), sans étape à oublier.
  pnpm prisma:generate >/dev/null
  pnpm prisma:migrate:deploy >/dev/null || die "migrations de la base impossibles — Postgres tourne-t-il ? (scripts/serveur-local.sh installer)"
  info "Code : $(git -C "$ROOT" log -1 --format='%h %s' 2>/dev/null || echo inconnu)"
  echo "Clients KYC :"
  cmd_clients
  "${TS_NODE[@]}" src/main.ts &
  local api=$!
  "${TS_NODE[@]}" src/worker.ts &
  local worker=$!
  # shellcheck disable=SC2064
  trap "kill $api $worker 2>/dev/null || true" INT TERM EXIT

  local port="${API_PORT:-3000}" i
  for i in $(seq 1 90); do
    if curl -sf "http://localhost:$port/health" >/dev/null 2>&1; then break; fi
    kill -0 "$api" 2>/dev/null || die "l'API s'est arrêtée — voir les messages ci-dessus"
    sleep 1
  done
  curl -sf "http://localhost:$port/health" >/dev/null 2>&1 || die "l'API ne répond pas sur le port $port"

  local ip
  ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
  info "Serveur prêt."
  echo "  Adresse à saisir dans l'app : http://${ip:-<IP-du-Mac>}:$port"
  echo "  Test depuis l'iPhone (Safari) : http://${ip:-<IP-du-Mac>}:$port/health"
  echo "  Ctrl-C pour arrêter l'API et le worker."
  wait
}

cmd_client() {
  local id="${1:-iphone}"
  load_env
  cd "$API"
  "${TS_NODE[@]}" scripts/create-kyc-client.ts --client-id="$id" --trust-levels=high,medium --fields="$CLIENT_FIELDS"
}

cmd_registre() {
  local mode="${1:-}" id="${2:-}" value
  case "$mode" in
    exige) value=required ;;
    non-exige) value=optional ;;
    *) die "usage : scripts/serveur-local.sh registre <exige|non-exige> [identifiant du client, facultatif s'il n'y en a qu'un]" ;;
  esac
  load_env
  cd "$API"
  "${TS_NODE[@]}" scripts/update-kyc-client.ts ${id:+--client-id="$id"} --lost-stolen="$value"
}

cmd_master_list() {
  local file="${1:-}"
  [ -n "$file" ] && [ -f "$file" ] || die "usage : scripts/serveur-local.sh master-list <fichier .ml ou .ldif de l'ICAO>"
  file="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
  load_env
  cd "$API"
  case "$file" in
    *.ldif | *.LDIF)
      "${TS_NODE[@]}" scripts/import-pkd-ldif.ts "$file"
      return
      ;;
  esac
  # La synchronisation télécharge la Master List par URL : le fichier est servi le temps de l'import.
  local port=8765
  node -e '
    const fs = require("fs"), http = require("http");
    http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/octet-stream" }); fs.createReadStream(process.argv[1]).pipe(res); })
      .listen(Number(process.argv[2]), "127.0.0.1");
  ' "$file" "$port" &
  local server=$!
  # shellcheck disable=SC2064
  trap "kill $server 2>/dev/null || true" EXIT
  wait_port 127.0.0.1 "$port" "Le serveur de fichier"
  PKD_MASTER_LIST_SOURCE=https PKD_MASTER_LIST_HTTPS_URL="http://127.0.0.1:$port/master-list.ml" "${TS_NODE[@]}" scripts/sync-master-list.ts
}

case "${1:-}" in
  installer) cmd_installer ;;
  demarrer) cmd_demarrer ;;
  client) cmd_client "${2:-}" ;;
  registre) cmd_registre "${2:-}" "${3:-}" ;;
  master-list) cmd_master_list "${2:-}" ;;
  empreintes) cmd_empreintes ;;
  clients) cmd_clients ;;
  *)
    sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
