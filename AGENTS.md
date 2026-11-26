# AGENTS.md

## Regras de acesso (não quebrar)

- Toda rota nova precisa de `@Public()`, `@Can(...)`, `@CanAny(...)`, `@StaffApps(...)`
  ou `@ClientArea()`. Sem isso o guard nega com 403; não "conserte" tornando a rota pública.
- Funcionalidade nova da equipe → acrescente a permissão ao catálogo
  (`src/modules/accounts/domain/permissions.ts`) e proteja a rota com `@Can(...)`.
  O Administrador geral recebe a permissão sozinho ao subir.
- Regras de quem pode conceder o quê ficam em `domain/access/access-policy.ts` (funções
  puras). Mudou regra → mude o teste `access-policy.spec.ts` junto.
- Equipe interna (`users`) e clientes (`client_accounts`) ficam separados: não crie
  relação, coluna ou endpoint que dê a uma conta de cliente perfil ou app da equipe,
  nem que reaproveite o segredo de um domínio no outro.
- Toda mudança de acesso grava evento de auditoria na mesma transação.
- Erros saem como `AppException` com um `ErrorCode` (`src/common/exceptions`). O front
  traduz pelo código.
- Nunca logue senha, hash, token ou query do Prisma com parâmetros.

## Contextos (DDD)

- `src/modules/accounts` é o contexto Contas. Outros módulos importam **só** de
  `modules/accounts/index.js` (regra `no-restricted-imports` no `.oxlintrc.json`).
- Contextos de negócio (CRM, fiscal, comercial) guardam só o id da conta e nunca consultam
  as tabelas de login. Contas nunca conhece Cliente nem Associado.
- Língua do código: Contas e infraestrutura em inglês; contextos de negócio na língua do
  negócio (`Cliente`, `Associado`, termos técnicos italianos em italiano).

## NestJS 12 e ESM

A versão do NestJS deste projeto é provavelmente mais nova do que você conhece; a
documentação está indexada em https://docs.nestjs.com/llms.txt.

Os pacotes do Nest são só ESM, e este projeto também: imports relativos terminam em `.js`,
`__dirname` não existe (use `import.meta.dirname`) e os testes rodam no Vitest (`vi.fn()`,
não `jest.fn()`). Interfaces usadas em construtor com decorator vão com `import type`.

## Prisma 7 e PostgreSQL

O client é gerado em `src/generated/prisma` (fora do git; `pnpm db:generate`) e usa o
driver adapter `@prisma/adapter-pg`. A URL do banco vem do `prisma.config.ts`, não do
schema. Ao mudar o schema: `pnpm db:migrate --name <descricao>`. Ids são `uuid` nativo:
em SQL cru, compare com `${valor}::uuid`.

O banco roda em Docker (`docker compose up -d`); no Windows desta equipe, dentro do WSL
(`wsl -e sh -lc "cd /mnt/c/... && docker compose up -d"`).

## Testes

- Unitários ao lado do código (`*.spec.ts`) e em `prisma/`.
- e2e em `test/`: AppModule com persistência em memória (`test/support`, que implementa
  as mesmas portas dos adapters Prisma).
- Integração em `test/integration`: AppModule + Postgres de teste (`pnpm test:int`).
  Mudou consulta Prisma, transação ou constraint → cubra aqui.

Cubra com teste o comportamento que mudar, principalmente regra de acesso.
