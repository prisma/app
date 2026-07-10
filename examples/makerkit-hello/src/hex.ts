import { hex } from '@makerkit/core';
import helloService, { db } from './service.ts';

/**
 * The app root: one hex owning its one Postgres. `db` is the service module's
 * dual-form postgres — the hex provisions that same object and wires it into
 * the service's slot; the database exists because the hex says so, never
 * because a service mentioned it.
 */
export default hex('hello', (h) => {
  const dbRef = h.provision('db', db);
  h.provision('hello', helloService, { db: dbRef });
});
