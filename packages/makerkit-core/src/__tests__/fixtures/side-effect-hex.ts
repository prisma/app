import { hex, service } from "../../index.ts";

// Importing this module must not increment either counter — only Loading the
// hex may run the body, and only invoking a service may run its handler.
export let bodyCallCount = 0;
export let handlerCallCount = 0;

const svc = service({
  type: "fixture/app",
  inputs: {},
  params: {},
  handler: () => {
    handlerCallCount += 1;
    return null;
  },
});

export default hex("fixture-hex", (h) => {
  bodyCallCount += 1;
  h.provision("app", svc);
});
