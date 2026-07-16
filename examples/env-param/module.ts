import { module } from '@prisma/composer';
import { envParam } from '@prisma/composer-prisma-cloud';
import echoService from './src/service.ts';

/**
 * The env-param example: one service whose required `greeting` param is bound
 * to the platform env var ENV_PARAM_GREETING at provision. The value lives on
 * the platform per stage (production template / preview override), is
 * shell-filled by deploy preflight when absent, and is read back through
 * `config()` at boot — the non-secret sibling of the streams example's
 * envSecret binding.
 *
 * A closed root: no boundary argument, no return — it only provisions.
 */
export default module('env-param-example', ({ provision }) => {
  provision(echoService, { params: { greeting: envParam('ENV_PARAM_GREETING') } });
});
