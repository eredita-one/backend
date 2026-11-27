#!/usr/bin/env bash
# Migrations e seed no banco de PRODUÇÃO (Supabase), rodando da sua máquina.
#
#   bash scripts/db-producao.sh status    # migrations aplicadas e pendentes (só leitura)
#   bash scripts/db-producao.sh migrate   # aplica as pendentes (pnpm db:deploy)
#   bash scripts/db-producao.sh seed      # perfis padrão + primeiro admin, sem contas demo
#
# Atalhos no package.json: pnpm db:prod:status | db:prod:migrate | db:prod:seed
#
# A URL do banco é pedida sem aparecer na tela (ou lida de DATABASE_URL_PRODUCAO) e nunca
# é gravada em arquivo. O .env local é ignorado, para nada de desenvolvimento ir para
# produção. Rode com `bash`, não com `source`: as variáveis morrem com o script.
#
# Enquanto o Render não tiver pré-deploy (plano Free), rode `migrate` ANTES de enviar à
# main um commit que traga migration nova.
set -euo pipefail

cd "$(dirname "$0")/.."

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

# ─── URL do banco ─────────────────────────────────────────────────────────────
url=${DATABASE_URL_PRODUCAO:-}
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
    printf 'E-mail: '
    IFS= read -r SEED_ADMIN_EMAIL || true
    case "$SEED_ADMIN_EMAIL" in *?@?*.?*) ;; *) die "e-mail inválido." ;; esac
    printf 'Nome [Administrador]: '
    IFS= read -r SEED_ADMIN_NAME || true
    printf 'Senha (12+ caracteres, não aparece na tela): '
    IFS= read -rs SEED_ADMIN_PASSWORD || true
    echo
    printf 'Repita a senha: '
    IFS= read -rs repeat || true
    echo
    [ "$SEED_ADMIN_PASSWORD" = "$repeat" ] || die "as senhas não conferem."
    [ ${#SEED_ADMIN_PASSWORD} -ge 12 ] || die "a senha precisa ter pelo menos 12 caracteres."
    printf 'Perfis de outros apps para o admin, separados por vírgula\n'
    printf '(ex.: Consultor, Commercialista; Enter para nenhum): '
    IFS= read -r SEED_ADMIN_EXTRA_PROFILES || true

    export SEED_ADMIN_EMAIL SEED_ADMIN_NAME SEED_ADMIN_PASSWORD SEED_ADMIN_EXTRA_PROFILES
    export SEED_DEMO_ACCOUNTS=false

    confirm "Rodar o seed em $target com o admin $SEED_ADMIN_EMAIL?"
    pnpm db:seed
    ;;
esac
