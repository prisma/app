/**
 * Runs a Standard Schema validator over an unknown value, returning the
 * parsed output — or throwing with the validator's own issues on failure.
 * Used by serve() to validate a request's input and its handler's return;
 * the client does not re-validate the response, since serve() already
 * guaranteed it against the same schema.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';

export async function standardValidate<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
): Promise<StandardSchemaV1.InferOutput<S>> {
  const result = await schema['~standard'].validate(value);
  if (result.issues !== undefined) {
    throw new Error(
      `Schema validation failed: ${result.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  return result.value;
}
