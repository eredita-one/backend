#!/usr/bin/env bash
# Migrations e seed no banco de PRODUÇÃO (Supabase), rodando da sua máquina.
#
#   bash scripts/db-producao.sh status    # migrations aplicadas e pendentes (só leitura)
#   bash scripts/db-producao.sh migrate   # aplica as pendentes (pnpm db:deploy)
#   bash scripts/db-producao.sh seed      # perfis padrão + primeiro admin, sem contas demo
#
# Atalhos no package.json: pnpm db:prod:status | db:prod:migrate | db:prod:seed
#
# Os valores vêm do .env.production (fora do git e da imagem Docker), e o que faltar
# nele é perguntado no terminal. Chaves lidas:
#   DATABASE_URL               URL do Session pooler do Supabase (porta 5432)
#   SEED_ADMIN_EMAIL           só para o seed
#   SEED_ADMIN_NAME            só para o seed (vazio = "Administrador")
#   SEED_ADMIN_PASSWORD        só para o seed; apague do arquivo depois de usar
#   SEED_ADMIN_EXTRA_PROFILES  só para o seed; ex.: Consultor, Commercialista
# O arquivo é lido como texto (não é executado) e qualquer outra chave é ignorada. O .env
# de desenvolvimento nunca é lido. "sim" antes de alterar o banco é sempre perguntado.
#
# Enquanto o Render não tiver pré-deploy (plano Free), rode `migrate` ANTES de enviar à
# main um commit que traga migration nova.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=.env.production

die() { printf '\nErro: %s\n' "$1" >&2; exit 1; }
usage() { sed -n '4,6p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 1; }

[ $# -eq 1 ] || usage
cmd=$1
case "$cmd" in status | migrate | seed) ;; *) usage ;; esac

confirm() {
  printf '\n%s\nDigite "sim" para continuar: ' "$1"
  IFS= read -r answer || true
  [ "$answer" = sim ] || die "cancelado, nada foi alterado."
}

# ─── Ambiente isolado ─────────────────────────────────────────────────────────
# O prisma.config.ts e o seed.ts carregam o .env pelo dotenv; com um arquivo que não
# existe, nada do .env de desenvolvimento entra (URL local, contas demo, perfis extras).
export DOTENV_PATH="$PWD/.env.ignorado-pelo-db-producao"
[ ! -e "$DOTENV_PATH" ] || die "$DOTENV_PATH não deveria existir."
export NODE_ENV=production
unset SEED_ADMIN_EMAIL SEED_ADMIN_NAME SEED_ADMIN_PASSWORD SEED_ADMIN_EXTRA_PROFILES \
  SEED_DEMO_ACCOUNTS SEED_DEMO_PASSWORD

# ─── .env.production ──────────────────────────────────────────────────────────
file_url='' file_email='' file_name='' file_password='' file_extra='' file_extra_set=''
if [ -f "$ENV_FILE" ]; then
  printf 'Lendo %s\n' "$ENV_FILE"
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case "$line" in '' | '#'*) continue ;; *=*) ;; *) continue ;; esac
    key=${line%%=*}
    key=${key#export }
    key=${key//[[:space:]]/}
    value=${line#*=}
    case "$value" in
      \"*\") value=${value#\"} && value=${value%\"} ;;
      \'*\') value=${value#\'} && value=${value%\'} ;;
      *) value=${value%"${value##*[![:space:]]}"} ;;
    esac
    case "$key" in
      DATABASE_URL) file_url=$value ;;
      SEED_ADMIN_EMAIL) file_email=$value ;;
      SEED_ADMIN_NAME) file_name=$value ;;
      SEED_ADMIN_PASSWORD) file_password=$value ;;
      SEED_ADMIN_EXTRA_PROFILES) file_extra=$value && file_extra_set=1 ;;
      *) printf 'Aviso: %s ignorada (o script só lê DATABASE_URL e SEED_ADMIN_*).\n' "$key" >&2 ;;
    esac
  done < "$ENV_FILE"
fi

# ─── URL do banco ─────────────────────────────────────────────────────────────
url=${DATABASE_URL_PRODUCAO:-$file_url}
if [ -z "$url" ]; then
  printf 'URL do Session pooler do Supabase (não aparece na tela): '
  IFS= read -rs url || true
  echo
fi
[ -n "$url" ] || die "URL vazia."

case "$url" in
  postgres://* | postgresql://*) ;;
  *) die "a URL precisa começar com postgresql://" ;;
esac
case "$url" in
  *'[YOUR-PASSWORD]'* | *'<SUA-SENHA>'*) die "troque [YOUR-PASSWORD] pela senha do banco, sem os colchetes." ;;
esac
case "$url" in
  *:6543/*) die "essa é a URL do Transaction pooler (porta 6543). Use a do Session pooler (porta 5432)." ;;
esac

# SSL: o driver pg trata sslmode=require como verify-full e recusaria o certificado do
# Supabase; com uselibpqcompat=true a conexão segue criptografada sem exigir a CA.
case "$url" in *\?*) sep='&' ;; *) sep='?' ;; esac
case "$url" in *sslmode=*) ;; *) url="${url}${sep}sslmode=require" && sep='&' ;; esac
case "$url" in *uselibpqcompat=*) ;; *) url="${url}${sep}uselibpqcompat=true" ;; esac
export DATABASE_URL=$url

# Só o host e o banco aparecem na tela; a senha fica antes do @.
target=${url#*@}
target=${target%%\?*}
printf 'Banco: %s\n' "$target"

# ─── Comandos ─────────────────────────────────────────────────────────────────
case "$cmd" in
  status)
    # Sai com erro quando há migration pendente; aqui isso é informação, não falha.
    pnpm exec prisma migrate status || true
    ;;

  migrate)
    pnpm exec prisma migrate status || true
    confirm "Aplicar as migrations pendentes em $target?"
    pnpm db:deploy
    ;;

  seed)
    if ! out=$(pnpm exec prisma migrate status 2>&1); then
      printf '%s\n' "$out"
      die "rode 'migrate' antes do seed (ou corrija a conexão, se o erro acima for de acesso)."
    fi

    printf '\nPrimeiro admin. Se o e-mail já existir, a conta é mantida como está.\n'
    SEED_ADMIN_EMAIL=$file_email
    if [ -z "$SEED_ADMIN_EMAIL" ]; then
      printf 'E-mail: '
      IFS= read -r SEED_ADMIN_EMAIL || true
    fi
    case "$SEED_ADMIN_EMAIL" in *?@?*.?*) ;; *) die "e-mail do admin inválido." ;; esac

    SEED_ADMIN_NAME=$file_name
    if [ -z "$SEED_ADMIN_NAME" ]; then
      printf 'Nome [Administrador]: '
      IFS= read -r SEED_ADMIN_NAME || true
    fi

    SEED_ADMIN_PASSWORD=$file_password
    if [ -z "$SEED_ADMIN_PASSWORD" ]; then
      printf 'Senha (12+ caracteres, não aparece na tela): '
      IFS= read -rs SEED_ADMIN_PASSWORD || true
      echo
      printf 'Repita a senha: '
      IFS= read -rs repeat || true
      echo
      [ "$SEED_ADMIN_PASSWORD" = "$repeat" ] || die "as senhas não conferem."
    fi
    [ ${#SEED_ADMIN_PASSWORD} -ge 12 ] || die "a senha do admin precisa ter pelo menos 12 caracteres."

    if [ -n "$file_extra_set" ]; then
      SEED_ADMIN_EXTRA_PROFILES=$file_extra
    else
      printf 'Perfis de outros apps para o admin, separados por vírgula\n'
      printf '(ex.: Consultor, Commercialista; Enter para nenhum): '
      IFS= read -r SEED_ADMIN_EXTRA_PROFILES || true
    fi

    export SEED_ADMIN_EMAIL SEED_ADMIN_NAME SEED_ADMIN_PASSWORD SEED_ADMIN_EXTRA_PROFILES
    export SEED_DEMO_ACCOUNTS=false

    printf '\nAdmin: %s (%s)\nPerfis extras: %s\n' "$SEED_ADMIN_EMAIL" \
      "${SEED_ADMIN_NAME:-Administrador}" "${SEED_ADMIN_EXTRA_PROFILES:-nenhum}"
    confirm "Rodar o seed em $target?"
    pnpm db:seed

    if [ -n "$file_password" ]; then
      printf '\nLembrete: apague SEED_ADMIN_PASSWORD do %s. O admin já existe, e a senha\n' "$ENV_FILE"
      printf 'não precisa mais ficar gravada ali.\n'
    fi
    ;;
esac
