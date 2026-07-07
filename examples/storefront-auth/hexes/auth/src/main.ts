// Runtime bundle entry (app-owned): a pure re-export; nothing runs on
// import. The Service node carries its own run(); the pack-printed
// bootstrap imports this bundle and calls main.run(address).
export { default } from "./service.ts";
