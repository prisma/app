import { defineService, postgres } from "../../index.ts";

export default defineService({ db: postgres() }, ({ db }) => {
  return { marker: "ARTIFACT_FIXTURE_MARKER", db };
});
