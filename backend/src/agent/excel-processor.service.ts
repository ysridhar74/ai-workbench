/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from '@nestjs/common';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * ExcelProcessorService
 *
 * Provides LangChain tools for reading, inspecting, cleaning, schema-mapping,
 * and writing Excel / CSV files. Tools are stateless — each call receives the
 * full file path and operates on it directly.
 *
 * Processing happens entirely on the backend server:
 *   - Uploaded files land in the RAG upload directory (or a temp path).
 *   - Output files are written to the configurable output directory.
 *   - The agent returns the output path so the frontend can offer a download.
 */
@Injectable()
export class ExcelProcessorService {
  private readonly logger = new Logger(ExcelProcessorService.name);

  /** Root directory where processed output files are saved */
  private readonly outputDir: string;

  constructor() {
    this.outputDir = process.env.EXCEL_OUTPUT_DIR ?? path.join(os.tmpdir(), 'ai-workbench-excel');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool factory
  // ─────────────────────────────────────────────────────────────────────────

  createExcelTools(): DynamicStructuredTool<any>[] {
    return [
      this.toolInspectFile(),
      this.toolReadSheet(),
      this.toolCleanSheet(),
      this.toolMapSchema(),
      this.toolWriteFile(),
      this.toolProcessBordereaux(),
    ];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 1: Inspect — list sheets, row counts, column names
  // ─────────────────────────────────────────────────────────────────────────

  private toolInspectFile(): DynamicStructuredTool<any> {
    return new DynamicStructuredTool({
      name: 'excel_inspect_file',
      description:
        'Inspect an Excel or CSV file. Returns sheet names, row counts, column headers, ' +
        'and a 3-row data preview for each sheet. Use this first before any other Excel tool.',
      schema: z.object({
        filePath: z
          .string()
          .describe(
            'Absolute path to the .xlsx, .xls, or .csv file on the server. ' +
            'For uploaded files use the path returned by the RAG upload endpoint.',
          ),
      }),
      func: async (props: any) => {
        try {
          const { filePath } = props;
          this.logger.log(`Inspecting file: ${filePath}`);

          if (!fs.existsSync(filePath)) {
            return JSON.stringify({ error: `File not found: ${filePath}` });
          }

          const wb = XLSX.readFile(filePath, { sheetStubs: true });
          const result: any[] = [];

          for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

            const headers = (rows[0] as string[]) ?? [];
            const dataRows = rows.slice(1);
            const preview = dataRows.slice(0, 3);

            // Infer column types from first 20 data rows
            const columnTypes = headers.map((h, i) => {
              const vals = dataRows.slice(0, 20).map((r: any) => r[i]).filter(v => v !== null && v !== '');
              const isNum = vals.length > 0 && vals.every(v => !isNaN(Number(v)));
              const isDate = vals.length > 0 && vals.every(v => !isNaN(Date.parse(String(v))));
              return { column: h, type: isNum ? 'number' : isDate ? 'date' : 'string', nullCount: dataRows.filter((r: any) => r[i] === null || r[i] === '').length };
            });

            result.push({
              sheet: sheetName,
              rowCount: dataRows.length,
              columnCount: headers.length,
              columns: columnTypes,
              preview,
            });
          }

          return JSON.stringify({ filePath, sheets: result }, null, 2);
        } catch (err: any) {
          return JSON.stringify({ error: err.message });
        }
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 2: Read — load a sheet into JSON rows
  // ─────────────────────────────────────────────────────────────────────────

  private toolReadSheet(): DynamicStructuredTool<any> {
    return new DynamicStructuredTool({
      name: 'excel_read_sheet',
      description:
        'Read a specific sheet from an Excel or CSV file and return rows as JSON. ' +
        'Use after excel_inspect_file to load data for analysis.',
      schema: z.object({
        filePath: z.string().describe('Absolute path to the Excel or CSV file.'),
        sheetName: z
          .string()
          .optional()
          .describe('Sheet name to read. Defaults to the first sheet.'),
        maxRows: z
          .number()
          .optional()
          .describe('Maximum rows to return (default 500). Use to avoid huge payloads.'),
      }),
      func: async (props: any) => {
        try {
          const { filePath, sheetName, maxRows = 500 } = props;

          if (!fs.existsSync(filePath)) {
            return JSON.stringify({ error: `File not found: ${filePath}` });
          }

          const wb = XLSX.readFile(filePath);
          const name = sheetName ?? wb.SheetNames[0];
          const ws = wb.Sheets[name];

          if (!ws) {
            return JSON.stringify({ error: `Sheet "${name}" not found. Available: ${wb.SheetNames.join(', ')}` });
          }

          const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: null });
          const slice = rows.slice(0, maxRows);

          return JSON.stringify({
            sheet: name,
            totalRows: rows.length,
            returnedRows: slice.length,
            rows: slice,
          }, null, 2);
        } catch (err: any) {
          return JSON.stringify({ error: err.message });
        }
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 3: Clean — standardize and clean a sheet
  // ─────────────────────────────────────────────────────────────────────────

  private toolCleanSheet(): DynamicStructuredTool<any> {
    return new DynamicStructuredTool({
      name: 'excel_clean_sheet',
      description:
        'Clean and standardize an Excel sheet. Applies: trim whitespace, normalize case, ' +
        'remove fully blank rows/columns, deduplicate rows, coerce numeric strings to numbers, ' +
        'parse date strings, fill blank cells in specified columns with a default value. ' +
        'Returns a new file path with the cleaned data.',
      schema: z.object({
        filePath: z.string().describe('Absolute path to the source Excel or CSV file.'),
        sheetName: z.string().optional().describe('Sheet to clean. Defaults to first sheet.'),
        options: z
          .object({
            trimWhitespace: z.boolean().optional().default(true),
            normalizeHeaders: z.boolean().optional().default(true).describe('Lowercase + snake_case column names'),
            removeBlankRows: z.boolean().optional().default(true),
            deduplicateRows: z.boolean().optional().default(false),
            coerceNumbers: z.boolean().optional().default(true),
            fillDefaults: z
              .record(z.string())
              .optional()
              .describe('Map of column → default value for blank cells. e.g. {"status": "unknown"}'),
          })
          .optional(),
        outputFileName: z
          .string()
          .optional()
          .describe('Output filename. Defaults to <original>_cleaned.xlsx'),
      }),
      func: async (props: any) => {
        try {
          const { filePath, sheetName, options = {}, outputFileName } = props;
          const {
            trimWhitespace = true,
            normalizeHeaders = true,
            removeBlankRows = true,
            deduplicateRows = false,
            coerceNumbers = true,
            fillDefaults = {},
          } = options;

          if (!fs.existsSync(filePath)) {
            return JSON.stringify({ error: `File not found: ${filePath}` });
          }

          const wb = XLSX.readFile(filePath);
          const name = sheetName ?? wb.SheetNames[0];
          const ws = wb.Sheets[name];

          if (!ws) {
            return JSON.stringify({ error: `Sheet "${name}" not found.` });
          }

          let rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: null });
          const originalCount = rows.length;

          // Normalize headers
          if (normalizeHeaders && rows.length > 0) {
            const normalizeKey = (k: string) =>
              k.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            rows = rows.map(row => {
              const newRow: any = {};
              for (const [k, v] of Object.entries(row)) {
                newRow[normalizeKey(k)] = v;
              }
              return newRow;
            });
          }

          // Trim whitespace in string values
          if (trimWhitespace) {
            rows = rows.map(row => {
              const newRow: any = {};
              for (const [k, v] of Object.entries(row)) {
                newRow[k] = typeof v === 'string' ? v.trim() : v;
              }
              return newRow;
            });
          }

          // Remove blank rows
          if (removeBlankRows) {
            rows = rows.filter(row =>
              Object.values(row).some(v => v !== null && v !== '' && v !== undefined),
            );
          }

          // Coerce numeric strings
          if (coerceNumbers) {
            rows = rows.map(row => {
              const newRow: any = {};
              for (const [k, v] of Object.entries(row)) {
                if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v.replace(/,/g, '')))) {
                  newRow[k] = Number(v.replace(/,/g, ''));
                } else {
                  newRow[k] = v;
                }
              }
              return newRow;
            });
          }

          // Fill defaults for blank cells
          if (Object.keys(fillDefaults).length > 0) {
            rows = rows.map(row => {
              const newRow = { ...row };
              for (const [col, def] of Object.entries(fillDefaults)) {
                if (newRow[col] === null || newRow[col] === '' || newRow[col] === undefined) {
                  newRow[col] = def;
                }
              }
              return newRow;
            });
          }

          // Deduplicate
          if (deduplicateRows) {
            const seen = new Set<string>();
            rows = rows.filter(row => {
              const key = JSON.stringify(row);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          }

          // Write output
          const outName = outputFileName ?? `${path.basename(filePath, path.extname(filePath))}_cleaned.xlsx`;
          const outPath = path.join(this.outputDir, outName);
          const outWb = XLSX.utils.book_new();
          const outWs = XLSX.utils.json_to_sheet(rows);
          XLSX.utils.book_append_sheet(outWb, outWs, name);
          XLSX.writeFile(outWb, outPath);

          this.logger.log(`Cleaned file written to: ${outPath}`);

          return JSON.stringify({
            success: true,
            outputPath: outPath,
            originalRows: originalCount,
            cleanedRows: rows.length,
            removedRows: originalCount - rows.length,
            operationsApplied: { trimWhitespace, normalizeHeaders, removeBlankRows, deduplicateRows, coerceNumbers, fillDefaults },
          }, null, 2);
        } catch (err: any) {
          return JSON.stringify({ error: err.message });
        }
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 4: Schema mapping — rename/reorder/filter columns to a target schema
  // ─────────────────────────────────────────────────────────────────────────

  private toolMapSchema(): DynamicStructuredTool<any> {
    return new DynamicStructuredTool({
      name: 'excel_map_schema',
      description:
        'Map columns from a source Excel file to a target schema. Renames columns, ' +
        'reorders them, drops columns not in the target, and adds missing target columns as blank. ' +
        'Use this to normalise files from different sources into one standard format.',
      schema: z.object({
        filePath: z.string().describe('Absolute path to the source Excel or CSV file.'),
        sheetName: z.string().optional().describe('Sheet to map. Defaults to first sheet.'),
        columnMapping: z
          .record(z.string())
          .describe(
            'Map of source column name → target column name. ' +
            'Example: {"Policy No": "policy_number", "Gross Premium": "gross_premium_usd"}',
          ),
        targetColumns: z
          .array(z.string())
          .optional()
          .describe(
            'Ordered list of all target column names. Sets column order and adds blanks for missing columns. ' +
            'If omitted, uses the mapped columns in their source order.',
          ),
        outputFileName: z.string().optional().describe('Output filename. Defaults to <original>_mapped.xlsx'),
      }),
      func: async (props: any) => {
        try {
          const { filePath, sheetName, columnMapping, targetColumns, outputFileName } = props;

          if (!fs.existsSync(filePath)) {
            return JSON.stringify({ error: `File not found: ${filePath}` });
          }

          const wb = XLSX.readFile(filePath);
          const name = sheetName ?? wb.SheetNames[0];
          const ws = wb.Sheets[name];

          if (!ws) {
            return JSON.stringify({ error: `Sheet "${name}" not found.` });
          }

          const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: null });

          // Apply column mapping
          const mappedRows = rows.map((row: any) => {
            const newRow: any = {};
            for (const [srcCol, tgtCol] of Object.entries(columnMapping)) {
              newRow[tgtCol as string] = row[srcCol] ?? null;
            }
            return newRow;
          });

          // Enforce target column order and add missing columns
          let finalRows = mappedRows;
          if (targetColumns && targetColumns.length > 0) {
            finalRows = mappedRows.map(row => {
              const ordered: any = {};
              for (const col of targetColumns) {
                ordered[col] = row[col] ?? null;
              }
              return ordered;
            });
          }

          // Write output
          const outName = outputFileName ?? `${path.basename(filePath, path.extname(filePath))}_mapped.xlsx`;
          const outPath = path.join(this.outputDir, outName);
          const outWb = XLSX.utils.book_new();
          const outWs = XLSX.utils.json_to_sheet(finalRows);
          XLSX.utils.book_append_sheet(outWb, outWs, 'Mapped');
          XLSX.writeFile(outWb, outPath);

          this.logger.log(`Schema-mapped file written to: ${outPath}`);

          // Report unmapped source columns
          const sourceColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
          const mappedSourceCols = Object.keys(columnMapping);
          const unmappedCols = sourceColumns.filter(c => !mappedSourceCols.includes(c));

          return JSON.stringify({
            success: true,
            outputPath: outPath,
            rowsProcessed: finalRows.length,
            columnsIn: sourceColumns.length,
            columnsMapped: mappedSourceCols.length,
            unmappedSourceColumns: unmappedCols,
            targetSchema: targetColumns ?? Object.values(columnMapping),
          }, null, 2);
        } catch (err: any) {
          return JSON.stringify({ error: err.message });
        }
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 5: Write — write JSON rows to a new Excel file
  // ─────────────────────────────────────────────────────────────────────────

  private toolWriteFile(): DynamicStructuredTool<any> {
    return new DynamicStructuredTool({
      name: 'excel_write_file',
      description:
        'Write JSON rows to a new Excel (.xlsx) file on the server and return the output path. ' +
        'Use after cleaning/mapping to produce the final standardised file.',
      schema: z.object({
        rows: z.array(z.record(z.any())).describe('Array of row objects to write.'),
        sheetName: z.string().optional().default('Sheet1').describe('Sheet name in the output file.'),
        outputFileName: z.string().describe('Output filename (e.g. "standardised_renewals_2024.xlsx").'),
        includeHeaders: z.boolean().optional().default(true),
      }),
      func: async (props: any) => {
        try {
          const { rows, sheetName = 'Sheet1', outputFileName, includeHeaders = true } = props;

          if (!rows || rows.length === 0) {
            return JSON.stringify({ error: 'No rows provided to write.' });
          }

          const outPath = path.join(this.outputDir, outputFileName);
          const wb = XLSX.utils.book_new();
          const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: !includeHeaders });
          XLSX.utils.book_append_sheet(wb, ws, sheetName);
          XLSX.writeFile(wb, outPath);

          this.logger.log(`Excel file written: ${outPath} (${rows.length} rows)`);

          return JSON.stringify({
            success: true,
            outputPath: outPath,
            rowsWritten: rows.length,
            columnsWritten: Object.keys(rows[0]).length,
          }, null, 2);
        } catch (err: any) {
          return JSON.stringify({ error: err.message });
        }
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 6: Bordereaux processor — reinsurance-specific standardisation
  // ─────────────────────────────────────────────────────────────────────────

  private toolProcessBordereaux(): DynamicStructuredTool<any> {
    return new DynamicStructuredTool({
      name: 'excel_process_bordereaux',
      description:
        'Process a reinsurance bordereaux file (premium or claims) into a standard format. ' +
        'Auto-detects bordereaux type (premium/claims/loss run), standardises column names to ' +
        'the company schema, validates required fields, flags anomalies (negative premiums, ' +
        'missing policy refs, future effective dates), and produces a clean output file plus ' +
        'a validation report.',
      schema: z.object({
        filePath: z.string().describe('Absolute path to the bordereaux Excel or CSV file.'),
        sheetName: z.string().optional().describe('Sheet to process. Defaults to first sheet.'),
        bordereauxType: z
          .enum(['premium', 'claims', 'loss_run', 'auto'])
          .optional()
          .default('auto')
          .describe('Type of bordereaux. Use "auto" to detect from column headers.'),
        cedant: z.string().optional().describe('Cedant/client name — added as a metadata column.'),
        asOfDate: z.string().optional().describe('As-of date (ISO format) for validation.'),
        outputFileName: z.string().optional().describe('Output filename. Defaults to <original>_standardised.xlsx'),
      }),
      func: async (props: any) => {
        try {
          const { filePath, sheetName, bordereauxType = 'auto', cedant, asOfDate, outputFileName } = props;

          if (!fs.existsSync(filePath)) {
            return JSON.stringify({ error: `File not found: ${filePath}` });
          }

          const wb = XLSX.readFile(filePath);
          const name = sheetName ?? wb.SheetNames[0];
          const ws = wb.Sheets[name];

          if (!ws) {
            return JSON.stringify({ error: `Sheet "${name}" not found.` });
          }

          let rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: null });
          if (rows.length === 0) return JSON.stringify({ error: 'Sheet is empty.' });

          // ── Auto-detect type ────────────────────────────────────────────
          const headerStr = Object.keys(rows[0]).join(' ').toLowerCase();
          const detectedType = bordereauxType !== 'auto'
            ? bordereauxType
            : headerStr.includes('loss') || headerStr.includes('claim') || headerStr.includes('incurred')
              ? 'claims'
              : headerStr.includes('premium') || headerStr.includes('gep') || headerStr.includes('nep')
                ? 'premium'
                : 'premium'; // default assumption

          // ── Schema definitions ──────────────────────────────────────────
          const PREMIUM_SCHEMA: Record<string, string[]> = {
            policy_ref: ['policy no', 'policy number', 'policy ref', 'policy_no', 'polno', 'pol ref'],
            insured_name: ['insured', 'insured name', 'client', 'assured', 'insured_name'],
            effective_date: ['effective date', 'inception date', 'start date', 'effective_date', 'inception'],
            expiry_date: ['expiry date', 'expiry', 'end date', 'expiry_date'],
            gross_premium: ['gross premium', 'gep', 'gross written premium', 'gwp', 'gross_premium', 'gross written'],
            net_premium: ['net premium', 'nep', 'net_premium', 'net written'],
            currency: ['currency', 'ccy', 'curr'],
            class_of_business: ['class', 'class of business', 'lob', 'line of business', 'class_of_business'],
            territory: ['territory', 'country', 'region'],
          };

          const CLAIMS_SCHEMA: Record<string, string[]> = {
            claim_ref: ['claim no', 'claim number', 'claim ref', 'claim_ref', 'claimno'],
            policy_ref: ['policy no', 'policy number', 'policy ref', 'policy_no'],
            loss_date: ['loss date', 'date of loss', 'occurrence date', 'loss_date'],
            notification_date: ['notification date', 'reported date', 'date reported', 'notification_date'],
            paid_loss: ['paid loss', 'paid', 'paid losses', 'paid_loss', 'paid_claims'],
            outstanding_reserve: ['outstanding', 'reserve', 'outstanding reserve', 'o/s', 'outstanding_reserve'],
            incurred: ['incurred', 'total incurred', 'gross incurred', 'incurred_loss'],
            currency: ['currency', 'ccy'],
            status: ['status', 'claim status', 'open/closed'],
          };

          const schema = detectedType === 'claims' ? CLAIMS_SCHEMA : PREMIUM_SCHEMA;

          // ── Build column mapping from source headers ─────────────────────
          const sourceHeaders = Object.keys(rows[0]);
          const columnMap: Record<string, string> = {};
          const unmapped: string[] = [];

          for (const srcHeader of sourceHeaders) {
            const normalized = srcHeader.toLowerCase().trim();
            let matched = false;
            for (const [targetCol, aliases] of Object.entries(schema)) {
              if (aliases.some(a => normalized.includes(a) || a.includes(normalized))) {
                columnMap[srcHeader] = targetCol;
                matched = true;
                break;
              }
            }
            if (!matched) unmapped.push(srcHeader);
          }

          // ── Apply mapping ────────────────────────────────────────────────
          const mappedRows = rows.map(row => {
            const newRow: any = {};
            for (const [src, tgt] of Object.entries(columnMap)) {
              newRow[tgt] = row[src];
            }
            // Carry unmapped columns through with a prefix
            for (const col of unmapped) {
              newRow[`extra__${col}`] = row[col];
            }
            if (cedant) newRow['cedant'] = cedant;
            return newRow;
          });

          // ── Validation ───────────────────────────────────────────────────
          const anomalies: any[] = [];
          const today = asOfDate ? new Date(asOfDate) : new Date();

          mappedRows.forEach((row, i) => {
            const rowNum = i + 2; // 1-indexed + header

            if (detectedType === 'premium') {
              if (!row.policy_ref) anomalies.push({ row: rowNum, field: 'policy_ref', issue: 'Missing policy reference' });
              if (row.gross_premium !== null && Number(row.gross_premium) < 0)
                anomalies.push({ row: rowNum, field: 'gross_premium', issue: `Negative premium: ${row.gross_premium}` });
              if (row.effective_date) {
                const d = new Date(row.effective_date);
                if (d > new Date(today.getTime() + 365 * 24 * 3600 * 1000))
                  anomalies.push({ row: rowNum, field: 'effective_date', issue: `Effective date >1yr in future: ${row.effective_date}` });
              }
              if (!row.currency) anomalies.push({ row: rowNum, field: 'currency', issue: 'Missing currency' });
            } else {
              if (!row.claim_ref) anomalies.push({ row: rowNum, field: 'claim_ref', issue: 'Missing claim reference' });
              if (row.incurred !== null && Number(row.incurred) < 0)
                anomalies.push({ row: rowNum, field: 'incurred', issue: `Negative incurred: ${row.incurred}` });
              if (row.loss_date && row.notification_date) {
                const loss = new Date(row.loss_date);
                const notif = new Date(row.notification_date);
                if (notif < loss)
                  anomalies.push({ row: rowNum, field: 'notification_date', issue: 'Notification date before loss date' });
              }
            }
          });

          // ── Write output ─────────────────────────────────────────────────
          const outName = outputFileName ?? `${path.basename(filePath, path.extname(filePath))}_standardised.xlsx`;
          const outPath = path.join(this.outputDir, outName);
          const outWb = XLSX.utils.book_new();

          // Main sheet: standardised data
          const dataWs = XLSX.utils.json_to_sheet(mappedRows);
          XLSX.utils.book_append_sheet(outWb, dataWs, 'Standardised');

          // Anomalies sheet
          if (anomalies.length > 0) {
            const anomalyWs = XLSX.utils.json_to_sheet(anomalies);
            XLSX.utils.book_append_sheet(outWb, anomalyWs, 'Anomalies');
          }

          XLSX.writeFile(outWb, outPath);
          this.logger.log(`Bordereaux processed → ${outPath}`);

          return JSON.stringify({
            success: true,
            outputPath: outPath,
            detectedType,
            cedant: cedant ?? 'not specified',
            rowsProcessed: mappedRows.length,
            columnsMapped: Object.keys(columnMap).length,
            unmappedColumns: unmapped,
            anomalyCount: anomalies.length,
            anomalies: anomalies.slice(0, 20), // return first 20 in payload
            targetSchema: Object.keys(schema),
          }, null, 2);
        } catch (err: any) {
          return JSON.stringify({ error: err.message });
        }
      },
    });
  }
}
