// The pack's own PN project: `prisma-next contract emit` regenerates
// src/pack/contract.{json,d.ts} from contract.prisma, and the migration
// tooling authors the shipped migration packages against it. Never loaded at
// runtime — consumers get the pack through `@internal/auth/pack`.
import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './src/pack/contract.prisma',
  db: { connection: 'postgres://localhost:5432/placeholder' },
});
