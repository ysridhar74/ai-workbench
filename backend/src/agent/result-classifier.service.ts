/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from '@nestjs/common';

/**
 * ResultClassifierService
 *
 * Inspects any tool result and automatically picks the best UI component
 * to render it — without the agent needing to call a ui_render_* tool explicitly.
 *
 * Rules are applied in priority order. First match wins.
 * Returns null if no component fits — the agent's text response handles it.
 *
 * Coexists with explicit agent-driven rendering: if the agent already called
 * a ui_render_* tool, that component is in the uiQueue and renders first.
 * The classifier fires as a fallback on the raw tool output.
 */

export interface ClassifiedComponent {
  componentType: string;
  props: unknown;
}

// Tool names that should never trigger auto-rendering
const SKIP_TOOLS = new Set([
  'search_knowledge_base',
  'ui_render_stats',
  'ui_render_table',
  'ui_render_bar_chart',
  'ui_render_line_chart',
  'ui_render_entity_card',
  'ui_render_timeline',
  'ui_render_alert',
  'ui_render_key_value',
  'ui_render_query_result',
  'ui_render_comparison',
  // Schema/metadata tools return markdown prose — no UI component needed
  'mongo_discover_schema',
  'mongo_get_schema',
  'mongo_list_databases',
]);

// Tool names that are Excel processor tools — render differently
const EXCEL_TOOLS = new Set([
  'excel_inspect_file',
  'excel_read_sheet',
  'excel_clean_sheet',
  'excel_map_schema',
  'excel_write_file',
  'excel_process_bordereaux',
]);

// Tool names that produce MongoDB query results
const MONGO_TOOLS = new Set([
  'mongo_ask_collection',
  'mongo_run_pipeline',
  'mongo_list_collections',
  'mongo_sample_collection',
  'mongo_get_sample_documents',
]);

@Injectable()
export class ResultClassifierService {
  private readonly logger = new Logger(ResultClassifierService.name);

  /**
   * Main entry point. Called after every tool result.
   * Returns a UI component definition or null.
   */
  classify(toolName: string, rawOutput: string): ClassifiedComponent | null {
    // Never auto-render for render tools themselves or RAG
    if (SKIP_TOOLS.has(toolName)) return null;

    // Parse JSON output
    let data: any;
    try {
      data = JSON.parse(rawOutput);
    } catch {
      // Plain string output — check if it's meaningful enough to show as alert
      return this.classifyPlainString(toolName, rawOutput);
    }

    // Route by tool category first, then by data shape
    if (EXCEL_TOOLS.has(toolName)) return this.classifyExcelResult(toolName, data);
    if (MONGO_TOOLS.has(toolName)) return this.classifyMongoResult(toolName, data);

    // Generic shape-based classification for everything else
    return this.classifyByShape(toolName, data);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Excel tool results
  // ─────────────────────────────────────────────────────────────────────────

  private classifyExcelResult(toolName: string, data: any): ClassifiedComponent | null {
    if (data?.error) {
      return {
        componentType: 'AlertPanel',
        props: {
          type: 'error',
          title: 'Excel processing error',
          message: data.error,
        },
      };
    }

    // Inspect result → show sheet summary as stats + column table
    if (toolName === 'excel_inspect_file' && data?.sheets) {
      const firstSheet = data.sheets[0];
      if (!firstSheet) return null;

      return {
        componentType: 'QueryResult',
        props: {
          title: `File inspection: ${data.filePath?.split('/').pop() ?? 'file'}`,
          database: 'Excel',
          collection: firstSheet.sheet,
          rowCount: firstSheet.rowCount,
          durationMs: 0,
          rows: firstSheet.columns.map((c: any) => ({
            column: c.column,
            type: c.type,
            nulls: c.nullCount,
          })),
          columns: ['column', 'type', 'nulls'],
        },
      };
    }

    // Read sheet → show as table (up to 50 rows preview)
    if (toolName === 'excel_read_sheet' && data?.rows) {
      const rows = data.rows.slice(0, 50);
      if (rows.length === 0) return null;
      return {
        componentType: 'QueryResult',
        props: {
          title: `Sheet: ${data.sheet}`,
          database: 'Excel',
          collection: data.sheet,
          rowCount: data.totalRows,
          durationMs: 0,
          rows,
          columns: Object.keys(rows[0]),
        },
      };
    }

    // Clean / map / write / bordereaux → stats dashboard
    if (
      ['excel_clean_sheet', 'excel_map_schema', 'excel_write_file', 'excel_process_bordereaux'].includes(toolName) &&
      data?.success
    ) {
      const stats: any[] = [];

      if (data.rowsProcessed !== undefined)
        stats.push({ label: 'Rows processed', value: data.rowsProcessed, icon: '📄' });
      if (data.cleanedRows !== undefined)
        stats.push({ label: 'Rows after clean', value: data.cleanedRows, icon: '✅', color: '#10b981' });
      if (data.removedRows !== undefined && data.removedRows > 0)
        stats.push({ label: 'Rows removed', value: data.removedRows, icon: '🗑️', color: '#f59e0b' });
      if (data.columnsMapped !== undefined)
        stats.push({ label: 'Columns mapped', value: data.columnsMapped, icon: '🔗' });
      if (data.rowsWritten !== undefined)
        stats.push({ label: 'Rows written', value: data.rowsWritten, icon: '💾', color: '#6366f1' });
      if (data.anomalyCount !== undefined)
        stats.push({
          label: 'Anomalies found',
          value: data.anomalyCount,
          icon: '⚠️',
          color: data.anomalyCount > 0 ? '#ef4444' : '#10b981',
        });

      const result: ClassifiedComponent = {
        componentType: 'StatsDashboard',
        props: {
          title: this.excelToolTitle(toolName, data),
          stats,
        },
      };

      // If bordereaux has anomalies, we'll let the agent's explicit ui_render_table
      // handle them — the stats card is enough from the classifier
      return result;
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MongoDB tool results
  // ─────────────────────────────────────────────────────────────────────────

  private classifyMongoResult(toolName: string, data: any): ClassifiedComponent | null {
    // List collections → key-value style
    if (toolName === 'mongo_list_collections') {
      const collections = Array.isArray(data) ? data : data?.collections ?? [];
      if (collections.length === 0) return null;
      return {
        componentType: 'KeyValueList',
        props: {
          title: 'Collections',
          items: collections.map((c: any, i: number) => ({
            key: `${i + 1}`,
            value: typeof c === 'string' ? c : c.name ?? JSON.stringify(c),
          })),
        },
      };
    }

    // Extract rows from various mongo result shapes
    const rows = this.extractRows(data);
    if (!rows || rows.length === 0) return null;

    const keys = Object.keys(rows[0]);
    const numericKeys = keys.filter(k => this.isNumericColumn(rows, k));
    const dateKey = keys.find(k => this.isDateColumn(rows, k));
    const categoryKey = keys.find(k => !this.isNumericColumn(rows, k) && k !== '_id');

    // Time-series: has a date column + at least one numeric → line chart
    if (dateKey && numericKeys.length >= 1 && rows.length > 2) {
      const valueKey = numericKeys[0];
      return {
        componentType: 'LineChart',
        props: {
          title: `${valueKey} over time`,
          xKey: dateKey,
          yKey: valueKey,
          data: rows.map((r: any) => ({
            [dateKey]: String(r[dateKey]),
            [valueKey]: Number(r[valueKey]),
          })),
        },
      };
    }

    // Two-column aggregation: one category + one numeric → bar chart
    if (keys.length === 2 && categoryKey && numericKeys.length === 1 && rows.length <= 20) {
      const valueKey = numericKeys[0];
      return {
        componentType: 'BarChart',
        props: {
          title: `${valueKey} by ${categoryKey}`,
          xKey: categoryKey,
          yKey: valueKey,
          data: rows.map((r: any) => ({
            [categoryKey]: String(r[categoryKey] ?? 'Unknown'),
            [valueKey]: Number(r[valueKey]),
          })),
        },
      };
    }

    // Single row with multiple numeric fields → stats dashboard
    if (rows.length === 1 && numericKeys.length >= 2) {
      return {
        componentType: 'StatsDashboard',
        props: {
          title: 'Query summary',
          stats: numericKeys.slice(0, 6).map(k => ({
            label: this.humanizeKey(k),
            value: rows[0][k],
          })),
        },
      };
    }

    // General: array of records → query result table
    return {
      componentType: 'QueryResult',
      props: {
        title: `${rows.length} result${rows.length !== 1 ? 's' : ''}`,
        database: data?.database ?? '',
        collection: data?.collection ?? toolName,
        rowCount: data?.count ?? rows.length,
        durationMs: data?.durationMs ?? 0,
        rows: rows.slice(0, 100),
        columns: keys.slice(0, 12),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Generic shape-based classification (MCP tools, custom tools, etc.)
  // ─────────────────────────────────────────────────────────────────────────

  private classifyByShape(toolName: string, data: any): ClassifiedComponent | null {
    if (data === null || data === undefined) return null;

    // Error object → alert
    if (data?.error) {
      return {
        componentType: 'AlertPanel',
        props: {
          type: 'error',
          title: `${toolName} error`,
          message: String(data.error),
        },
      };
    }

    // Success confirmation with no interesting data → alert (success)
    if (data?.success === true && !data?.rows && !data?.stats && !data?.items) {
      return {
        componentType: 'AlertPanel',
        props: {
          type: 'success',
          title: 'Done',
          message: data?.message ?? `${toolName} completed successfully.`,
        },
      };
    }

    // Array of objects → classify by shape
    const rows = this.extractRows(data);
    if (rows && rows.length > 0) {
      const keys = Object.keys(rows[0]);
      const numericKeys = keys.filter(k => this.isNumericColumn(rows, k));

      // Two columns, one numeric → bar chart
      if (keys.length === 2 && numericKeys.length === 1 && rows.length <= 20) {
        const catKey = keys.find(k => !numericKeys.includes(k))!;
        const valKey = numericKeys[0];
        return {
          componentType: 'BarChart',
          props: {
            title: `${this.humanizeKey(valKey)} by ${this.humanizeKey(catKey)}`,
            xKey: catKey,
            yKey: valKey,
            data: rows.map((r: any) => ({
              [catKey]: String(r[catKey] ?? ''),
              [valKey]: Number(r[valKey]),
            })),
          },
        };
      }

      // General table
      if (keys.length >= 2) {
        return {
          componentType: 'QueryResult',
          props: {
            title: this.humanizeKey(toolName),
            database: '',
            collection: '',
            rowCount: rows.length,
            durationMs: 0,
            rows: rows.slice(0, 100),
            columns: keys.slice(0, 12),
          },
        };
      }
    }

    // Plain object with 2–15 keys → key-value card
    if (this.isPlainObject(data)) {
      const keys = Object.keys(data).filter(k => typeof data[k] !== 'object');
      if (keys.length >= 2 && keys.length <= 15) {
        return {
          componentType: 'KeyValueList',
          props: {
            title: this.humanizeKey(toolName),
            items: keys.map(k => ({ key: this.humanizeKey(k), value: String(data[k]) })),
          },
        };
      }
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Plain string results (non-JSON tool output)
  // ─────────────────────────────────────────────────────────────────────────

  private classifyPlainString(toolName: string, output: string): ClassifiedComponent | null {
    const trimmed = output.trim();
    if (trimmed.length < 20) return null; // too short to bother

    // Looks like an error message
    if (
      trimmed.toLowerCase().startsWith('error') ||
      trimmed.toLowerCase().includes('failed') ||
      trimmed.toLowerCase().includes('not found')
    ) {
      return {
        componentType: 'AlertPanel',
        props: { type: 'error', title: `${toolName} error`, message: trimmed },
      };
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /** Extract a rows array from various result shapes */
  private extractRows(data: any): any[] | null {
    if (Array.isArray(data)) return data.filter(r => this.isPlainObject(r));
    if (Array.isArray(data?.rows)) return data.rows.filter((r: any) => this.isPlainObject(r));
    if (Array.isArray(data?.results)) return data.results.filter((r: any) => this.isPlainObject(r));
    if (Array.isArray(data?.data)) return data.data.filter((r: any) => this.isPlainObject(r));
    if (Array.isArray(data?.documents)) return data.documents.filter((r: any) => this.isPlainObject(r));
    return null;
  }

  /** Check if a column contains primarily numeric values */
  private isNumericColumn(rows: any[], key: string): boolean {
    const sample = rows.slice(0, 20).map(r => r[key]).filter(v => v !== null && v !== undefined);
    if (sample.length === 0) return false;
    return sample.filter(v => !isNaN(Number(v))).length / sample.length >= 0.8;
  }

  /** Check if a column contains date-like values */
  private isDateColumn(rows: any[], key: string): boolean {
    const lk = key.toLowerCase();
    if (lk.includes('date') || lk.includes('time') || lk.includes('month') || lk.includes('year') || lk.includes('day')) {
      return true;
    }
    const sample = rows.slice(0, 5).map(r => r[key]).filter(v => v !== null && v !== undefined);
    return sample.length > 0 && sample.every(v => !isNaN(Date.parse(String(v))));
  }

  /** Convert snake_case or camelCase to human readable */
  private humanizeKey(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\w/, c => c.toUpperCase());
  }

  private isPlainObject(val: any): boolean {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
  }

  private excelToolTitle(toolName: string, data: any): string {
    const file = data?.outputPath?.split('/').pop() ?? '';
    const map: Record<string, string> = {
      excel_clean_sheet: `Cleaned${file ? ': ' + file : ''}`,
      excel_map_schema: `Schema mapped${file ? ': ' + file : ''}`,
      excel_write_file: `Written${file ? ': ' + file : ''}`,
      excel_process_bordereaux: `Bordereaux processed — ${data?.detectedType ?? ''} (${data?.cedant ?? ''})`,
    };
    return map[toolName] ?? 'Excel processing complete';
  }
}
