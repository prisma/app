/**
 * A synthetic extension-pack descriptor for the pack-requirement tests: just
 * enough shape to pass PN's config validation (kind/id/familyId/version) and
 * carry a `contractSpace.headRef.hash` for the preflight to compare. The
 * contract value is synthetic — nothing under test reads past the head hash.
 */
import { blindCast } from '@internal/foundation/casts';
import type { PostgresConfigOptions } from '@prisma-next/postgres/config';

type PgPack = NonNullable<PostgresConfigOptions['extensions']>[number];
type PgPackContractSpace = NonNullable<PgPack['contractSpace']>;

export const GADGET_PACK_ID = 'gadget';
export const GADGET_PACK_HEAD_HASH = 'sha256:packed-contract-fixture-head';

const contractSpace: PgPackContractSpace = {
  contractJson: blindCast<
    PgPackContractSpace['contractJson'],
    'synthetic fixture contract; the code under test reads only contractSpace.headRef.hash'
  >({ storage: { namespaces: {}, storageHash: GADGET_PACK_HEAD_HASH } }),
  migrations: [],
  headRef: { hash: GADGET_PACK_HEAD_HASH, invariants: [] },
};

export const gadgetPack: PgPack = {
  kind: 'extension',
  id: GADGET_PACK_ID,
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  contractSpace,
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
};
