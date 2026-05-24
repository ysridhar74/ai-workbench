/**
 * Pipeline Validator — ported from mcp-servers/mongodb-query
 * Ensures pipelines are read-only and within safe limits.
 */

const BLOCKED_STAGES = new Set([
  '$out', '$merge', '$currentOp', '$listLocalSessions', '$listSessions', '$planCacheStats',
]);

const ALLOWED_STAGES = new Set([
  '$addFields', '$bucket', '$bucketAuto', '$changeStream', '$collStats', '$count',
  '$densify', '$documents', '$facet', '$fill', '$geoNear', '$graphLookup', '$group',
  '$indexStats', '$limit', '$lookup', '$match', '$project', '$redact', '$replaceRoot',
  '$replaceWith', '$sample', '$search', '$set', '$setWindowFields', '$skip', '$sort',
  '$sortByCount', '$unionWith', '$unset', '$unwind',
]);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  pipeline: object[];
}

export const MAX_RESULT_LIMIT = 500;
export const MAX_STAGES = 20;

export function validatePipeline(rawPipeline: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(rawPipeline)) {
    return { valid: false, errors: ['Pipeline must be a JSON array'], warnings, pipeline: [] };
  }
  if (rawPipeline.length === 0) {
    return { valid: false, errors: ['Pipeline cannot be empty'], warnings, pipeline: [] };
  }
  if (rawPipeline.length > MAX_STAGES) {
    errors.push(`Pipeline has ${rawPipeline.length} stages — maximum allowed is ${MAX_STAGES}`);
  }

  const pipeline = [...rawPipeline] as object[];

  for (let i = 0; i < pipeline.length; i++) {
    const stage = pipeline[i];
    if (typeof stage !== 'object' || stage === null || Array.isArray(stage)) {
      errors.push(`Stage ${i} is not an object`);
      continue;
    }
    const keys = Object.keys(stage);
    if (keys.length !== 1) {
      errors.push(`Stage ${i} must have exactly one key, found: ${keys.join(', ')}`);
      continue;
    }
    const operator = keys[0];
    if (BLOCKED_STAGES.has(operator)) {
      errors.push(`Stage "${operator}" is not allowed — read-only`);
      continue;
    }
    if (!ALLOWED_STAGES.has(operator)) {
      warnings.push(`Unknown operator "${operator}" at position ${i}`);
    }
    if (operator === '$limit') {
      const limitVal = (stage as Record<string, unknown>)['$limit'];
      if (typeof limitVal !== 'number' || limitVal <= 0) {
        errors.push(`$limit must be a positive number, got: ${JSON.stringify(limitVal)}`);
      } else if (limitVal > MAX_RESULT_LIMIT) {
        warnings.push(`$limit ${limitVal} capped to ${MAX_RESULT_LIMIT}`);
        (pipeline[i] as Record<string, unknown>)['$limit'] = MAX_RESULT_LIMIT;
      }
    }
    if (operator === '$lookup') {
      const lookup = (stage as Record<string, unknown>)['$lookup'] as Record<string, unknown>;
      if (typeof lookup !== 'object' || !lookup.from) {
        errors.push(`$lookup at stage ${i} is missing required "from" field`);
      }
    }
  }

  const hasLimit = pipeline.some(s => Object.keys(s).includes('$limit'));
  if (!hasLimit && errors.length === 0) {
    pipeline.push({ $limit: MAX_RESULT_LIMIT });
    warnings.push(`Auto-added $limit: ${MAX_RESULT_LIMIT}`);
  }

  return { valid: errors.length === 0, errors, warnings, pipeline };
}

export function serializePipeline(pipeline: object[]): string {
  return JSON.stringify(pipeline, null, 2);
}
