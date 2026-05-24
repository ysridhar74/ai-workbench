/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * UiRendererService
 *
 * Provides LangChain tools that the LLM explicitly calls to render UI components
 * in the frontend. This is the industry-standard "tool-use for UI" pattern:
 *
 *   LLM decides to show a chart
 *     → calls ui_render_bar_chart({ title, data })
 *     → tool emits ui_component SSE event immediately
 *     → frontend renders the BarChart component
 *     → tool returns "Rendered BarChart with N items" to the LLM
 *     → LLM continues its text response
 *
 * Key design decisions:
 * - Tools are created per-request (factory pattern) so each has its own SSE emitter
 * - The LLM chooses which component to render based on data shape and intent
 * - Tools are fully typed via Zod schemas — no string parsing, no tag injection
 * - Each tool returns a short confirmation so the LLM knows the render succeeded
 */

import { Injectable } from '@nestjs/common';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/** Callback type — called by each render tool to emit a ui_component SSE event */
export type UiEmitFn = (componentType: string, props: unknown) => void;

@Injectable()
export class UiRendererService {
  /**
   * Create a set of render tools bound to a specific SSE emitter.
   * Call this once per request inside runStream(), pass the resulting tools
   * to createReactAgent alongside the other tools.
   */
  createRenderTools(emit: UiEmitFn): DynamicStructuredTool<any>[] {
    return [
      // ── Stats Dashboard ──────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'ui_render_stats',
        description: `Render a KPI / stats dashboard card grid. Call this when showing metrics, counts, totals, averages, or any set of key numbers. Each stat can have a label, value, optional delta (change), unit, and emoji icon.
Examples: total revenue + order count + avg value, user registrations per week, system health metrics.`,
        schema: z.object({
          title: z.string().optional().describe('Dashboard title'),
          stats: z.array(z.object({
            label: z.string().describe('Metric name, e.g. "Total Revenue"'),
            value: z.union([z.string(), z.number()]).describe('The metric value'),
            delta: z.number().optional().describe('Change vs previous period — positive=up, negative=down'),
            unit: z.string().optional().describe('Unit suffix, e.g. "$", "%", "ms"'),
            icon: z.string().optional().describe('Emoji icon, e.g. "💰", "📦", "👥"'),
            color: z.string().optional().describe('Hex accent color, e.g. "#6366f1"'),
          })).describe('Array of stat cards to display'),
        }),
        func: async (props: any) => {
          emit('StatsDashboard', props);
          return `Rendered stats dashboard with ${props.stats.length} metric(s).`;
        },
      }),

      // ── Data Table ──────────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'ui_render_table',
        description: `Render a sortable, paginated data table. Call this when showing lists of records, query results, comparisons, or any tabular data with multiple rows and columns. Supports up to 500 rows with client-side pagination.
Examples: list of trading partners, order history, search results, agent run logs.`,
        schema: z.object({
          title: z.string().optional().describe('Table title'),
          caption: z.string().optional().describe('Short description shown below the title'),
          data: z.array(z.record(z.unknown())).describe('Array of row objects — keys become column headers'),
          columns: z.array(z.string()).optional().describe('Column order override. Defaults to keys from first row.'),
        }),
        func: async (props: any) => {
          emit('DataTable', props);
          return `Rendered table with ${props.data.length} row(s).`;
        },
      }),

      // ── Bar Chart ────────────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'ui_render_bar_chart',
        description: `Render a bar chart for comparing values across categories. Call this for rankings, distributions, grouped counts, or any "X per Y" data (orders per country, revenue per product, users per plan).
Use horizontal=true when labels are long. Best for 2–30 data points.`,
        schema: z.object({
          title: z.string().optional().describe('Chart title'),
          data: z.array(z.object({
            label: z.string().describe('Category label'),
            value: z.number().describe('Numeric value'),
            color: z.string().optional().describe('Bar color (hex), e.g. "#6366f1"'),
          })).describe('Data points'),
          horizontal: z.boolean().optional().describe('Use horizontal bars (better for long labels)'),
          xLabel: z.string().optional().describe('X-axis label'),
          yLabel: z.string().optional().describe('Y-axis label'),
        }),
        func: async (props: any) => {
          emit('BarChart', props);
          return `Rendered bar chart with ${props.data.length} bar(s).`;
        },
      }),

      // ── Line Chart ───────────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'ui_render_line_chart',
        description: `Render a line chart for trends over time or continuous data series. Call this for time-series data, growth curves, before/after comparisons, or any data where the X axis is ordered (dates, months, steps).
Supports multiple series on the same chart.`,
        schema: z.object({
          title: z.string().optional().describe('Chart title'),
          xLabels: z.array(z.string()).optional().describe('X-axis labels (e.g. ["Jan", "Feb", "Mar"])'),
          series: z.array(z.object({
            label: z.string().describe('Series name'),
            data: z.array(z.number()).describe('Y values — must match xLabels length'),
            color: z.string().optional().describe('Line color (hex)'),
          })).describe('One or more data series'),
        }),
        func: async (props: any) => {
          emit('LineChart', props);
          return `Rendered line chart with ${props.series.length} series.`;
        },
      }),

      // ── Entity Card ──────────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'ui_render_entity_card',
        description: `Render a detail card for a single entity (record, contact, product, order, etc.). Call this when showing the full details of one specific item rather than a list.
Shows ALL fields in a two-column grid with a header and optional badge/status. The UI handles any number of fields — do NOT truncate or omit any field.`,
        schema: z.object({
          title: z.string().describe('Entity name or primary identifier'),
          subtitle: z.string().optional().describe('Secondary info, e.g. "Trading Partner · ID: TP-00412"'),
          badge: z.string().optional().describe('Status badge text, e.g. "Active", "Pending"'),
          badgeColor: z.string().optional().describe('Badge background color (hex)'),
          fields: z.record(z.unknown()).describe('ALL key-value pairs from the document — include every field, do not omit or summarise any'),
          tags: z.array(z.string()).optional().describe('Tag chips shown in the header, e.g. ["Tier 1", "Europe"]'),
        }),
        func: async (props: any) => {
          emit('EntityCard', props);
          return `Rendered entity card for "${props.title}".`;
        },
      }),

      // ── Timeline ─────────────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'ui_render_timeline',
        description: `Render a vertical timeline of events. Call this for process flows, order lifecycle, audit trails, history logs, step-by-step sequences, or any ordered list of events with dates.`,
        schema: z.object({
          title: z.string().optional().describe('Timeline title'),
          events: z.array(z.object({
            date: z.string().describe('Date or timestamp string'),
            label: z.string().describe('Event name or short title'),
            description: z.string().optional().describe('Additional details'),
            icon: z.string().optional().describe('Emoji icon'),
            color: z.string().optional().describe('Accent color (hex)'),
          })).describe('Ordered list of events (earliest first)'),
        }),
        func: async (props: any) => {
          emit('Timeline', props);
          return `Rendered timeline with ${props.events.length} event(s).`;
        },
      }),

      // ── Alert Panel ──────────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'ui_render_alert',
        description: `Render a highlighted alert or notice panel. Call this for important messages that should stand out: warnings, errors, success confirmations, informational notices, or action items.
Types: "info" (blue), "success" (green), "warning" (amber), "error" (red).`,
        schema: z.object({
          type: z.enum(['info', 'success', 'warning', 'error']).describe('Alert severity/style'),
          title: z.string().describe('Alert headline'),
          message: z.string().optional().describe('Explanatory text'),
          items: z.array(z.string()).optional().describe('Bullet point list of details'),
        }),
        func: async (props: any) => {
          emit('AlertPanel', props);
          return `Rendered ${props.type} alert: "${props.title}".`;
        },
      }),

      // ── Key-Value List ────────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'ui_render_key_value',
        description: `Render a clean two-column key-value list. Call this for configuration details, system info, entity attributes, or any structured data that is better as a labelled list than a full table.
Best for 3–20 items where each item has a clear label and value.`,
        schema: z.object({
          title: z.string().optional().describe('Section title'),
          items: z.array(z.object({
            key: z.string().describe('Label'),
            value: z.union([z.string(), z.number(), z.boolean()]).describe('Value'),
            color: z.string().optional().describe('Value text color (hex)'),
          })).describe('Key-value pairs to display'),
        }),
        func: async (props: any) => {
          emit('KeyValueList', props);
          return `Rendered key-value list with ${props.items.length} item(s).`;
        },
      }),

      // ── Query Result ─────────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'ui_render_query_result',
        description: `Render a database query result with context header (database, collection, row count, duration). Call this specifically after running a MongoDB query — it wraps a DataTable with query metadata shown above.`,
        schema: z.object({
          title: z.string().optional().describe('Query description or natural language question'),
          database: z.string().optional().describe('Database name'),
          collection: z.string().optional().describe('Collection name'),
          rowCount: z.number().describe('Total rows returned'),
          durationMs: z.number().optional().describe('Query execution time in ms'),
          rows: z.array(z.record(z.unknown())).describe('Result rows'),
          columns: z.array(z.string()).optional().describe('Column order override'),
        }),
        func: async (props: any) => {
          emit('QueryResult', props);
          return `Rendered query result: ${props.rowCount} row(s) from ${props.database ?? ''}${props.collection ? `.${props.collection}` : ''}.`;
        },
      }),

      // ── Comparison Table ─────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'ui_render_comparison',
        description: `Render a side-by-side comparison table. Call this when the user asks to compare two or more concepts, tools, approaches, products, or options — e.g. "compare RAG vs context window", "what's the difference between X and Y", "pros and cons of A vs B".
Rows = aspects/attributes being compared. Columns = the items being compared. Each item has a name and a values array (one string per aspect, in the same order as aspects).
NEVER use a plain table or bullet points for comparisons — always use this tool.`,
        schema: z.object({
          title: z.string().optional().describe('Comparison title, e.g. "RAG vs Context Window"'),
          caption: z.string().optional().describe('One-line description of what is being compared'),
          aspects: z.array(z.string()).describe('Row labels — the attributes or dimensions being compared, e.g. ["Definition", "Best for", "Latency", "Cost"]'),
          items: z.array(z.object({
            name: z.string().describe('Column header — the thing being compared, e.g. "RAG"'),
            color: z.string().optional().describe('Accent color for this column (hex), e.g. "#6366f1"'),
            values: z.array(z.string()).describe('One value per aspect, in the same order as the aspects array. Use "—" if not applicable.'),
          })).describe('The items being compared — each becomes a column'),
        }),
        func: async (props: any) => {
          emit('ComparisonTable', props);
          return `Rendered comparison table: ${props.items.length} item(s) across ${props.aspects.length} aspect(s).`;
        },
      }),
    ];
  }
}
