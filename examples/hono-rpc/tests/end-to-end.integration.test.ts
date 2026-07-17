/// <reference types="bun" />
import { beforeAll, describe, expect, test } from 'bun:test';
import { bootstrapService } from '@prisma/composer-prisma-cloud/testing';
import appService from '../src/app-service.ts';
import calculatorService from '../src/calculator-service.ts';

const CALCULATOR_PORT = 4611;
const APP_PORT = 4612;

describe('Hono app -> Composer RPC -> calculator', () => {
  let app: Awaited<ReturnType<typeof bootstrapService>>;

  beforeAll(async () => {
    const calculator = await bootstrapService(calculatorService, {
      service: { port: CALCULATOR_PORT },
      inputs: {},
    });
    app = await bootstrapService(appService, {
      service: { port: APP_PORT },
      inputs: { calculator: { url: calculator.url } },
    });
  });

  test('calls the calculator service', async () => {
    const response = await app.fetch(`${app.url}double/21`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 42 });
  });

  test('rejects invalid input', async () => {
    const response = await app.fetch(`${app.url}double/not-a-number`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'value must be a finite number' });
  });
});
