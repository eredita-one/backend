# api-backend

API dos apps **admin**, **consultor**, **contábil** (equipe interna) e **portal do cliente**.
NestJS 12 (ESM) · Prisma 7 · PostgreSQL 18 · Node 24 · pnpm.

Estrutura herdada do `antlia-backend` (módulos, guard global com `@Public()`, Prisma,
exceções, Swagger, Docker), reescrita sem o domínio de pedidos/cobrança.

## Contexto Contas (identidade e acesso)

Hoje a API tem um contexto delimitado: **Contas** (`src/modules/accounts`). Ele responde
*quem é* e *o que pode fazer*. Os dados cadastrais (cliente, associado, família, dados
fiscais) pertencem aos contextos de negócio, que guardam só o id da conta.

```
src/modules/accounts/
  domain/          regras puras: credenciais, sessões, catálogo de permissões,
                   política de acesso (anti-escalada), eventos, portas
  application/     casos de uso: login, sessão, gestão de acessos, sincronização
  infrastructure/  adapters: Prisma, JWT
  http/            controllers, guard global, decorators, DTOs
  index.ts         API pública: o único arquivo que outros módulos importam (regra de lint)
```

### Dois domínios de login

```
equipe interna ── users ─┬─ user_access_profiles ── access_profiles ── access_profile_permissions
                         └─ user_refresh_tokens            token assinado com JWT_STAFF_SECRET

clientes ──────── client_accounts ── client_refresh_tokens  token assinado com JWT_CLIENT_SECRET

auditoria ─────── access_audit_log
```

- **Clientes em outra tabela, com outro segredo.** Não existe ligação entre
  `client_accounts` e perfis/apps da equipe, e um token de cliente não confere numa rota
  da equipe. Mesmo e-mail pode existir nos dois lados, com senhas independentes.
- **Equipe: uma base de usuários, acesso por perfis.** Cada perfil pertence a um app
  (ADMIN, CONSULTOR, CONTABIL) e reúne permissões. Ter algum perfil de um app é o que
  libera a entrada nele. O token vale para um app só.

### Permissões e perfis

- O **catálogo de permissões** fica no código (`domain/permissions.ts`), porque uma
  permissão só tem efeito se algum endpoint a exigir. O admin combina permissões em
  **perfis de acesso** e atribui perfis às pessoas.
- **Administrador geral** é o perfil do sistema: todas as permissões do admin, sempre.
  Ao subir, a API o sincroniza com o catálogo (permissão nova já nasce com ele).
- Regras (em `domain/access/access-policy.ts`, cobertas por testes):
  1. **Ninguém concede o que não tem.** Mexer num perfil do admin exige a permissão de
     gestão *e* todas as permissões do perfil. Perfis do consultor e do contábil pedem a
     permissão de gestão daquele app (`admin.access.consultor.manage` /
     `admin.access.contabil.manage`).
  2. **Ninguém altera o próprio acesso** (perfis ou status).
  3. **Ninguém age sobre quem tem mais poder** (ativar/desativar exige autoridade sobre
     cada perfil da pessoa).
  4. **Sempre resta um Administrador geral** ativo e com senha.
  5. **Perfis do sistema** não são editados nem apagados; **perfil em uso** não é apagado.
- **Vale na hora:** o guard relê conta, perfis e permissões a cada requisição. Revogar
  um perfil ou desativar alguém derruba os tokens já emitidos.
- **Auditoria:** perfil criado/editado/apagado, perfil concedido/revogado, usuário
  criado/ativado/desativado, conta bloqueada e reuso de sessão ficam em `access_audit_log`,
  gravados na mesma transação da mudança.

### Protegendo uma rota nova

```ts
import { Can, CanAny, ClientArea, StaffApp, StaffApps } from '../accounts/index.js';

@Can('admin.commissions.view')                          // exige a permissão (o app vem dela)
@Can('admin.clients.view', 'admin.clients.edit')        // exige todas
@CanAny('admin.commissions.view', 'admin.fiscal.view')  // exige uma delas
@StaffApps(StaffApp.CONSULTOR)                          // só o app, sem permissão específica
@ClientArea()                                           // portal do cliente (@CurrentClient)
```

Rota sem nenhum desses decorators (nem `@Public()`) é negada com 403. Permissão de outro
app ou inexistente não compila.

## Rodando localmente

```bash
pnpm install                 # também gera o client do Prisma (postinstall)
cp .env.example .env         # preencha os dois segredos e o SEED_ADMIN_*
docker compose up -d         # PostgreSQL 18 na porta 5432 (+ banco api_backend_test)
pnpm db:deploy               # aplica as migrations
pnpm db:seed                 # Administrador geral, perfis padrão, primeiro admin (e demo)
pnpm start:dev               # http://localhost:3333 · Swagger em /docs
```

**Windows sem Docker nativo:** rode o compose dentro do WSL; a porta 5432 do WSL aparece
no `localhost` do Windows, então a API e o Prisma rodam normalmente no Windows:

```bash
wsl -e sh -lc "cd /mnt/c/<caminho>/api-backend && docker compose up -d"
```

Para mudar o schema: `pnpm db:migrate --name <descricao>` (gera e aplica a migration).
A migration inicial tem dois `CHECK` escritos à mão (e-mail sempre minúsculo): o Prisma
não os enxerga, mas também não os remove.

O seed cria os perfis padrão **Consultor**, **Líder de rede** e **Commercialista**, e o
primeiro admin com o **Administrador geral** mais os perfis de `SEED_ADMIN_EXTRA_PROFILES`
(ex.: `"Consultor, Commercialista"`), para ele também entrar nos outros apps da equipe.
Como ninguém altera o próprio acesso pela API, esse é o único momento em que o primeiro
admin recebe perfis sozinho: o seed só atribui perfis **ao criar** a conta e nunca mexe
nos perfis de uma conta que já existe.

Com `SEED_DEMO_ACCOUNTS=true`, cria também contas de demonstração, entre elas uma gestora
com um perfil restrito do admin ("Operações (demo)") para testar as permissões.

Uma conta da equipe entra em todos os apps em que tiver algum perfil (um login por app);
o portal do cliente é outro domínio e nunca aceita conta da equipe.

## Endpoints

| Método | Rota | Acesso |
|---|---|---|
| POST | `/auth/staff/login` · `/refresh` · `/logout` | público (limite por IP) |
| GET | `/auth/staff/me` | qualquer app da equipe; devolve as permissões do app atual |
| POST | `/auth/client/login` · `/refresh` · `/logout` | público (limite por IP) |
| GET | `/auth/client/me` | portal do cliente |
| GET | `/admin/permissions` | alguma permissão de gestão de acessos |
| GET, POST | `/admin/access-profiles` | gestão de perfis (do app correspondente) |
| PATCH, DELETE | `/admin/access-profiles/:id` | idem |
| GET, POST | `/admin/staff-users` | listar: gestão; criar: `admin.access.users.manage` |
| GET | `/admin/staff-users/:id` | gestão |
| PUT, DELETE | `/admin/staff-users/:id/access-profiles/:profileId` | conceder/revogar perfil |
| POST | `/admin/staff-users/:id/disable` · `/enable` | `admin.access.users.manage` |
| GET | `/admin/access-audit?subjectId=&limit=` | `admin.access.audit.view` |
| GET | `/health` | público |

Usuário criado pelo admin nasce **com convite pendente** (sem senha): ainda não consegue
entrar. O envio e o aceite do convite são a próxima etapa.

### Sessão

- Access token JWT de 15 min. Refresh token opaco, guardado só como SHA-256.
- Cada refresh troca o refresh token. A sessão tem prazo fixo (12 h, ou 30 dias com
  "Manter conectado"): renovar não estende.
- Token trocado reaparecendo depois de `REFRESH_TOKEN_REUSE_GRACE_SECONDS`, com a sessão
  ainda viva, é sinal de cópia: a sessão inteira cai e o evento vai para a auditoria.
  Refresh atrasado depois de logout é só recusado.

### Erros

Formato: `{ statusCode, code, message, details? }`. O front traduz pelo `code`
(lista completa em `src/common/exceptions/error-codes.ts`).

| code | status | quando |
|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | 401 | e-mail inexistente, senha errada ou convite não aceito |
| `AUTH_APP_FORBIDDEN` | 403 | sem perfil no app pedido / token de outro app |
| `AUTH_PERMISSION_DENIED` | 403 | falta permissão da rota (`details.required`) |
| `AUTH_ACCOUNT_LOCKED` | 429 | muitas falhas; `details.retryAfterSeconds` |
| `AUTH_ACCOUNT_DISABLED` | 403 | conta desativada |
| `AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID` | 401 | sem token / inválido, expirado ou revogado |
| `AUTH_REFRESH_INVALID` | 401 | refresh inválido, expirado, revogado ou reutilizado |
| `ACCESS_ESCALATION_DENIED` | 403 | conceder/editar o que não tem (`details.missing`) |
| `ACCESS_SELF_CHANGE_DENIED` | 403 | mexer no próprio acesso |
| `ACCESS_LAST_GENERAL_ADMIN` | 409 | ficaria sem Administrador geral |
| `ACCESS_UNKNOWN_PERMISSION` | 422 | permissão fora do catálogo do app |
| `ACCESS_PROFILE_IN_USE` · `…_NAME_TAKEN` · `…_SYSTEM_PROFILE_READONLY` · `STAFF_USER_EMAIL_TAKEN` | 409 | conflitos |
| `VALIDATION_FAILED` | 400 | `details: [{ field, constraints }]` |

## Testes

```bash
pnpm test        # unitários: política de acesso, env, hash de senha, seed
pnpm test:e2e    # e2e: AppModule real, persistência em memória, sem banco
pnpm test:int    # integração: AppModule + Prisma + Postgres (precisa do docker compose)
pnpm lint && pnpm typecheck
```

A integração usa o banco `api_backend_test` (ou `TEST_DATABASE_URL`), apaga os dados
entre os testes e se recusa a rodar em banco cujo nome não termine em `_test`. Ela cobre
o que a memória não alcança: consultas Prisma, transações, constraints do banco e o
advisory lock que impede duas mudanças simultâneas de deixarem o sistema sem
Administrador geral (testado com requisições paralelas).

## Produção

- `pnpm build && pnpm start:prod`. Migrations num passo separado: `pnpm db:deploy`.
- `SWAGGER_ENABLED=false`, `TRUST_PROXY` conforme o proxy, `CORS_ORIGINS` só com os apps.
- `Dockerfile` multi-stage incluído. Na imagem, as migrations rodam com `pnpm db:deploy`
  (o `pnpm-lock.yaml` vai junto para o pnpm não tentar reinstalar as dependências).
- Supabase: use a URL do **Session pooler** (porta 5432) com
  `?sslmode=require&uselibpqcompat=true`. Sem o `uselibpqcompat`, o `pg` trata `require`
  como `verify-full` e recusa o certificado do Supabase.

## Ainda não implementado

- Envio e aceite de convite; "esqueci a senha" (tabelas `*_action_tokens`).
- Contas de cliente criadas a partir do cadastro do CRM.
- Segundo fator (TOTP) para admin e contábil.
