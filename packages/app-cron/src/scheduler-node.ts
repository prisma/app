// The module `cronScheduler`'s build points `module` at. The deploy bootstrap
// does `import main from <module>; main.run(address, boot)`, so that module's
// DEFAULT export must be the runnable scheduler node — a factory barrel with
// only named exports would make `main` undefined and `main.run()` throw at
// boot. An empty schedule is fine: run() reads the real jobs from the stashed
// env, never from this default.
import { cronScheduler } from './scheduler.ts';

export default cronScheduler<string>({ jobs: [] });
