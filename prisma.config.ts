import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// O Prisma 7 não carrega o .env sozinho: o `dotenv/config` acima faz isso.
// `prisma generate` não precisa de banco, por isso a URL pode faltar nesse comando;
// `migrate`/`db seed` falham com mensagem clara se ela não estiver definida.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
