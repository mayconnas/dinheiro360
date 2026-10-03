#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Gestor Financeiro 360 — runner de migrations versionadas.
#
# Aplica os arquivos de supabase/migrations/*.sql em ordem lexical e
# registra cada um em gestor360.schema_migrations (versão + sha256).
# Só precisa de `psql` e de uma conexão DIRETA com o Postgres.
#
# Uso:
#   DATABASE_URL=postgres://... scripts/migrate.sh status
#   DATABASE_URL=postgres://... scripts/migrate.sh up
#   DATABASE_URL=postgres://... scripts/migrate.sh baseline 0011_typesafe_jev
#
# Garantias:
#   • cada migration roda em UMA transação (psql --single-transaction)
#     junto com o INSERT do registro — ou aplica e registra, ou nada;
#   • a PK de schema_migrations impede aplicar a mesma versão duas vezes,
#     mesmo com dois runners em paralelo (o segundo falha e faz rollback);
#   • drift: se um arquivo já aplicado mudou (checksum diferente), avisa —
#     migration aplicada não se edita; crie uma nova.
#
# Variáveis:
#   DATABASE_URL     (obrigatória) string de conexão direta do Postgres
#   MIGRATIONS_DIR   (opcional) padrão: <repo>/supabase/migrations
#
# Requer bash 4+ (arrays associativos). Runbook: docs/OPERACAO.md
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$SCRIPT_DIR/../supabase/migrations}"
MIGRATIONS_TABLE="gestor360.schema_migrations"

# Ordem lexical estável, independente do locale da máquina.
export LC_ALL=C

# ─── Utilidades ───────────────────────────────────────────────
usage() {
  cat <<'EOF'
Uso: scripts/migrate.sh <comando> [args]

Comandos:
  status              lista migrations aplicadas e pendentes (e drift)
  up                  aplica as pendentes, em ordem, uma transação cada
  baseline <versão>   marca como aplicadas (SEM executar) todas as
                      migrations até <versão>, inclusive — para bancos
                      em que elas já foram rodadas à mão
  help                mostra esta ajuda

A versão é o nome do arquivo sem .sql (ex.: 0011_typesafe_jev).
Requer DATABASE_URL com uma conexão direta do Postgres.
EOF
}

log()  { printf '%s\n' "$*"; }
warn() { printf 'AVISO: %s\n' "$*" >&2; }
die()  { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

require_env() {
  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL não definida (conexão direta do Postgres)."
  command -v psql >/dev/null 2>&1 || die "psql não encontrado no PATH (instale o postgresql-client)."
  [[ -d "$MIGRATIONS_DIR" ]] || die "diretório de migrations não encontrado: $MIGRATIONS_DIR"
}

# psql sem ~/.psqlrc, parando no primeiro erro, saída "crua" (-At).
run_psql() {
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    die "nem sha256sum nem shasum disponíveis para calcular o checksum."
  fi
}

# Versão = nome do arquivo sem diretório e sem .sql.
version_of() {
  local name
  name="$(basename "$1")"
  printf '%s' "${name%.sql}"
}

# ─── Estado ───────────────────────────────────────────────────
FILES=()                      # caminhos, em ordem lexical
declare -A FILE_BY_VERSION=() # versão → caminho
declare -A APPLIED=()         # versão → checksum gravado
declare -A APPLIED_AT=()      # versão → data de aplicação

load_files() {
  local f version
  shopt -s nullglob
  for f in "$MIGRATIONS_DIR"/*.sql; do
    version="$(version_of "$f")"
    # Nome vira literal SQL — só aceita caracteres seguros.
    [[ "$version" =~ ^[A-Za-z0-9_.-]+$ ]] || die "nome de migration inválido: $(basename "$f")"
    FILES+=("$f")
    FILE_BY_VERSION["$version"]="$f"
  done
  shopt -u nullglob
  (( ${#FILES[@]} > 0 )) || die "nenhuma migration em $MIGRATIONS_DIR"
}

ensure_table() {
  run_psql <<SQL
create schema if not exists gestor360;
create table if not exists ${MIGRATIONS_TABLE} (
  version    text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);
comment on table ${MIGRATIONS_TABLE} is
  'Controle de migrations aplicadas por scripts/migrate.sh (versão = nome do arquivo sem .sql).';
SQL
}

load_applied() {
  local version checksum applied_at
  APPLIED=()
  APPLIED_AT=()
  while IFS=$'\t' read -r version checksum applied_at; do
    [[ -n "$version" ]] || continue
    APPLIED["$version"]="$checksum"
    APPLIED_AT["$version"]="$applied_at"
  done < <(run_psql -At -F $'\t' -c \
    "select version, checksum, to_char(applied_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from ${MIGRATIONS_TABLE} order by version")
}

# Avisa sobre arquivos aplicados que mudaram e registros sem arquivo.
# Drift só AVISA (não interrompe): a correção é sempre uma migration nova.
check_drift() {
  local version problems=0
  for version in "${!APPLIED[@]}"; do
    if [[ -z "${FILE_BY_VERSION[$version]:-}" ]]; then
      warn "$version está registrada no banco, mas o arquivo não existe mais."
      problems=$((problems + 1))
    elif [[ "$(sha256_of "${FILE_BY_VERSION[$version]}")" != "${APPLIED[$version]}" ]]; then
      warn "$version foi alterada depois de aplicada (checksum diferente). Não edite migrations aplicadas — crie uma nova."
      problems=$((problems + 1))
    fi
  done
  if (( problems > 0 )); then
    warn "$problems divergência(s) entre o banco e supabase/migrations."
  fi
}

# ─── Comandos ─────────────────────────────────────────────────
cmd_status() {
  local f version pending=0
  log "Migrations em ${MIGRATIONS_DIR#"$SCRIPT_DIR/../"}:"
  for f in "${FILES[@]}"; do
    version="$(version_of "$f")"
    if [[ -n "${APPLIED[$version]:-}" ]]; then
      local mark="aplicada"
      [[ "$(sha256_of "$f")" == "${APPLIED[$version]}" ]] || mark="ALTERADA"
      printf '  [x] %-40s %s em %s UTC\n' "$version" "$mark" "${APPLIED_AT[$version]}"
    else
      printf '  [ ] %-40s pendente\n' "$version"
      pending=$((pending + 1))
    fi
  done
  log ""
  log "Aplicadas: ${#APPLIED[@]} · Pendentes: $pending"
  check_drift
}

cmd_up() {
  local f version checksum applied=0
  check_drift
  for f in "${FILES[@]}"; do
    version="$(version_of "$f")"
    [[ -z "${APPLIED[$version]:-}" ]] || continue

    checksum="$(sha256_of "$f")"
    log "→ aplicando $version"
    # Arquivo + INSERT do registro numa única transação. O ';' extra
    # fecha um eventual último comando sem ponto e vírgula.
    {
      cat "$f"
      printf '\n;\n'
      printf "insert into %s (version, checksum) values (:'mig_version', :'mig_checksum');\n" \
        "$MIGRATIONS_TABLE"
    } | run_psql --single-transaction \
          -v mig_version="$version" \
          -v mig_checksum="$checksum" \
          -f - \
      || die "falha ao aplicar $version — transação desfeita, nada foi registrado."
    applied=$((applied + 1))
  done

  if (( applied == 0 )); then
    log "Nada a aplicar: banco em dia."
  else
    log "✓ $applied migration(s) aplicada(s)."
  fi
}

cmd_baseline() {
  local target="${1:-}" f version sql="" marked=0
  [[ -n "$target" ]] || die "informe a versão: scripts/migrate.sh baseline <versão>"
  target="${target%.sql}"
  [[ -n "${FILE_BY_VERSION[$target]:-}" ]] || die "migration não encontrada: $target"

  for f in "${FILES[@]}"; do
    version="$(version_of "$f")"
    [[ "$version" > "$target" ]] && break
    [[ -z "${APPLIED[$version]:-}" ]] || continue
    # version já validada (^[A-Za-z0-9_.-]+$) e checksum é hex: literais seguros.
    sql+="insert into ${MIGRATIONS_TABLE} (version, checksum) values ('${version}', '$(sha256_of "$f")');"$'\n'
    log "  marcando $version como aplicada (sem executar)"
    marked=$((marked + 1))
  done

  if (( marked == 0 )); then
    log "Nada a marcar: tudo até $target já está registrado."
    return 0
  fi
  printf '%s' "$sql" | run_psql --single-transaction -f -
  log "✓ baseline concluído: $marked migration(s) registrada(s) até $target."
}

# ─── Main ─────────────────────────────────────────────────────
main() {
  local cmd="${1:-help}"
  case "$cmd" in
    help|-h|--help) usage; return 0 ;;
    status|up|baseline) ;;
    *) usage >&2; die "comando desconhecido: $cmd" ;;
  esac

  require_env
  load_files
  ensure_table
  load_applied

  case "$cmd" in
    status)   cmd_status ;;
    up)       cmd_up ;;
    baseline) shift; cmd_baseline "$@" ;;
  esac
}

main "$@"
