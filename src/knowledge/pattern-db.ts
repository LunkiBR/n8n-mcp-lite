// ============================================================
// n8n-mcp-lite: Knowledge base database
// Manages patterns, gotchas, payloads, and expressions
// ============================================================

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

// ---- Types ----

export interface Pattern {
  id: string;
  name: string;
  description: string;
  tags: string[];
  complexity: "simple" | "intermediate" | "advanced";
  estimatedNodes: number;
  requiredParams: RequiredParam[];
  nodes: unknown[];
  flow: unknown[];
  notes?: string;
}

export interface RequiredParam {
  key: string;
  description: string;
  envVar?: boolean;
  options?: string[];
  default?: unknown;
  example?: string;
}

export interface Gotcha {
  id: string;
  title: string;
  description: string;
  tags: string[];
  nodeTypes?: string[];
  solution: string;
  examples?: string[];
  exampleConfig?: unknown;
  exampleFix?: unknown;
  exampleConditions?: unknown[];
  connectionTypes?: Record<string, string>;
  exampleFlow?: unknown[];
  patternRef?: string;
}

export interface ProviderPayload {
  name: string;
  description: string;
  docsUrl?: string;
  webhookSetup?: string;
  webhookVerification?: unknown;
  events: Record<string, PayloadEvent>;
  sendMessage?: Record<string, unknown>;
  environmentVariables?: Record<string, string>;
}

export interface PayloadEvent {
  description: string;
  schema: unknown;
  expressions: Record<string, string>;
  filterForValidMessage?: string;
  filterForValidIncomingMessage?: string;
}

export interface ExpressionEntry {
  useCase: string;
  expression: string;
  example?: string;
}

export interface ExpressionCategory {
  id: string;
  title: string;
  description?: string;
  entries: ExpressionEntry[];
}

// ---- PatternDatabase ----

export class KnowledgeDatabase {
  private patterns: Pattern[] = [];
  private gotchas: Gotcha[] = [];
  private payloads: Record<string, ProviderPayload> = {};
  private expressionCategories: ExpressionCategory[] = [];
  private loaded = false;

  private load(): void {
    if (this.loaded) return;

    try {
      const patternsRaw = readFileSync(join(DATA_DIR, "patterns.json"), "utf-8");
      this.patterns = JSON.parse(patternsRaw) as Pattern[];
    } catch {
      this.patterns = [];
    }

    try {
      const gotchasRaw = readFileSync(join(DATA_DIR, "gotchas.json"), "utf-8");
      this.gotchas = JSON.parse(gotchasRaw) as Gotcha[];
    } catch {
      this.gotchas = [];
    }

    try {
      const payloadsRaw = readFileSync(join(DATA_DIR, "payloads.json"), "utf-8");
      this.payloads = JSON.parse(payloadsRaw) as Record<string, ProviderPayload>;
    } catch {
      this.payloads = {};
    }

    try {
      const expRaw = readFileSync(join(DATA_DIR, "expressions.json"), "utf-8");
      const expData = JSON.parse(expRaw) as { categories: ExpressionCategory[] };
      this.expressionCategories = expData.categories ?? [];
    } catch {
      this.expressionCategories = [];
    }

    this.loaded = true;
  }

  // ---- Patterns ----

  /** Search patterns by keyword (searches name, description, tags) */
  searchPatterns(query: string, tags?: string[]): Pattern[] {
    this.load();

    const q = query.toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);

    return this.patterns.filter((p) => {
      // Tag filter
      if (tags && tags.length > 0) {
        if (!tags.some((t) => p.tags.includes(t.toLowerCase()))) return false;
      }

      // If no query, return all (after tag filter)
      if (!q) return true;

      // Score-based matching
      const searchable = [
        p.name.toLowerCase(),
        p.description.toLowerCase(),
        p.tags.join(" ").toLowerCase(),
        p.id.toLowerCase(),
      ].join(" ");

      return words.some((word) => searchable.includes(word));
    });
  }

  /** Get a pattern by ID */
  getPattern(id: string): Pattern | null {
    this.load();
    return this.patterns.find((p) => p.id === id) ?? null;
  }

  /** List all patterns (metadata only, no nodes/flow) */
  listPatterns(): Omit<Pattern, "nodes" | "flow">[] {
    this.load();
    return this.patterns.map(({ nodes, flow, ...meta }) => meta);
  }

  // ---- Gotchas ----

  /** Search gotchas by query and/or nodeType */
  searchGotchas(query?: string, nodeType?: string): Gotcha[] {
    this.load();

    let results = this.gotchas;

    // Filter by nodeType
    if (nodeType) {
      const nt = nodeType.toLowerCase();
      results = results.filter((g) => {
        if (!g.nodeTypes) return false;
        return g.nodeTypes.some((t) => t.toLowerCase().includes(nt));
      });
    }

    // Filter by query
    if (query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      results = results.filter((g) => {
        const searchable = [
          g.title.toLowerCase(),
          g.description.toLowerCase(),
          g.tags.join(" ").toLowerCase(),
          (g.nodeTypes ?? []).join(" ").toLowerCase(),
          g.id.toLowerCase(),
        ].join(" ");
        return words.some((word) => searchable.includes(word));
      });
    }

    return results;
  }

  /** Get all gotchas */
  getAllGotchas(): Gotcha[] {
    this.load();
    return this.gotchas;
  }

  // ---- Payloads ----

  /** Get payload schema for a provider */
  getPayload(provider: string): ProviderPayload | null {
    this.load();
    const key = provider.toLowerCase().replace(/[-_\s]/g, "-");
    return this.payloads[key] ?? this.payloads[provider] ?? null;
  }

  /** List all available providers */
  listProviders(): Array<{ id: string; name: string; description: string }> {
    this.load();
    return Object.entries(this.payloads).map(([id, p]) => ({
      id,
      name: p.name,
      description: p.description,
    }));
  }

  // ---- Expressions ----

  /** Search expressions by use case keyword or category */
  searchExpressions(query?: string, categoryId?: string): ExpressionCategory[] {
    this.load();

    let categories = this.expressionCategories;

    // Filter by category
    if (categoryId) {
      categories = categories.filter((c) => c.id === categoryId);
    }

    // Filter entries by query
    if (query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      categories = categories
        .map((cat) => ({
          ...cat,
          entries: cat.entries.filter((e) => {
            const searchable = (e.useCase + " " + (e.expression ?? "") + " " + (e.example ?? "")).toLowerCase();
            return words.some((w) => searchable.includes(w));
          }),
        }))
        .filter((cat) => cat.entries.length > 0);
    }

    return categories;
  }

  /** Get all expression categories */
  getAllExpressions(): ExpressionCategory[] {
    this.load();
    return this.expressionCategories;
  }
}

// Singleton
export const knowledgeDb = new KnowledgeDatabase();
