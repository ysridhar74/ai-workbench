/**
 * Pipeline Validator
 *
 * Ensures that a generated or user-supplied aggregation pipeline is:
 * 1. A valid JSON array of stage objects
 * 2. Read-only (no write stages)
 * 3. Not excessively large (stage count limit)
 * 4. Has a $limit somewhere (auto-injects one if missing)
 *
 * This runs BEFORE execution — if it throws, the pipeline is rejected.
 */

// Stages that write data — NEVER allow these
const BLOCKED_STAGES = new Set([
  '$out',
  '$merge',
  '$currentOp',
  '$listLocalSessions',
  '$listSessions',
  '$planCacheStats',
]);

// Stages that are valid in aggregation pipelines
const ALLOWED_STAGES = new Set([
  '$addFields',
  '$bucket',
  '$bucketAuto',
  '$changeStream',
  '$collStats',
  '$count',
  '$densify',
  '$documents',
  '$facet',
  '$fill',
  '$geoNear',
  '$graphLookup',
  '$group',
  '$indexStats',
  '$limit',
  '$lookup',
  '$match',
  '$project',
  '$redact',
  '$replaceRoot',
  '$replaceWith',
  '$sample',
  '$search',
  '$set',
  '$setWindowFields',
  '$skip',
  '$sort',
  '$sortByCount',
  '$unionWith',
  '$unset',
  '$unwind',
]);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  pipeline: object[];   // possibly modified (e.g. limit injected)
}

export const MAX_RESULT_LIMIT = 500;
export const MAX_STAGES = 20;

export function validatePipeline(rawPipeline: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Must be an array
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

    // Each stage must be a plain object
    if (typeof stage !== 'object' || stage === null || Array.isArray(stage)) {
      errors.push(`Stage ${i} is not an object`);
      continue;
    }

    const keys = Object.keys(stage);
    if (keys.length !== 1) {
      errors.push(`Stage ${i} must have exactly one key (the stage operator), found: ${keys.join(', ')}`);
      continue;
    }

    const operator = keys[0];

    // Block write operators
    if (BLOCKED_STAGES.has(operator)) {
      errors.push(`Stage "${operator}" is not allowed — this MCP server is read-only`);
      continue;
    }

    // Warn about unknown operators (might be typos)
    if (!ALLOWED_STAGES.has(operator)) {
      warnings.push(`Unknown stage operator "${operator}" at position ${i} — will attempt execution anyway`);
    }

    // Special check: $limit value must be reasonable
    if (operator === '$limit') {
      const limitVal = (stage as Record<string, unknown>)['$limit'];
      if (typeof limitVal !== 'number' || limitVal <= 0) {
        errors.push(`$limit value must be a positive number, got: ${JSON.stringify(limitVal)}`);
      } else if (limitVal > MAX_RESULT_LIMIT) {
        warnings.push(`$limit ${limitVal} exceeds maximum ${MAX_RESULT_LIMIT} — capping automatically`);
        (pipeline[i] as Record<string, unknown>)['$limit'] = MAX_RESULT_LIMIT;
      }
    }

    // Special check: $lookup must have required fields
    if (operator === '$lookup') {
      const lookup = (stage as Record<string, unknown>)['$lookup'] as Record<string, unknown>;
      if (typeof lookup !== 'object' || !lookup.from) {
        errors.push(`$lookup at stage ${i} is missing required "from" field`);
      }
    }
  }

  // If no $limit exists anywhere, inject one at the end for safety
  const hasLimit = pipeline.some(s => Object.keys(s).includes('$limit'));
  if (!hasLimit && errors.length === 0) {
    pipeline.push({ $limit: MAX_RESULT_LIMIT });
    warnings.push(`No $limit stage found — automatically added $limit: ${MAX_RESULT_LIMIT} for safety`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    pipeline,
  };
}

// Serialize a pipeline back to a clean JSON string for display
export function serializePipeline(pipeline: object[]): string {
  return JSON.stringify(pipeline, null, 2);
}
