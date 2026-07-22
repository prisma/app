import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './contract.prisma',
  db: { connection: 'postgres://localhost:5432/placeholder' },
});
