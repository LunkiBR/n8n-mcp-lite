// ============================================================
// n8n-mcp-lite: In-memory node knowledge database
// Loaded from pre-built data/nodes.json at startup
// ============================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  CompactNodeEntry,
  CompactProperty,
  CompactOperation,
  NodeSearchResult,
} from "./types.js";
import { NODE_FLAGS } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---- Load data ----

let nodesData: CompactNodeEntry[] = [];
try {
  const dataPath = join(__dirname, "..", "data", "nodes.json");
  const raw = readFileSync(dataPath, "utf-8");
  nodesData = JSON.parse(raw);
} catch {
  // Data file not yet generated — knowledge tools will return empty results
  console.error(
    "[n8n-mcp-lite] Warning: data/nodes.json not found. Run 'npm run build:nodes' to generate."
  );
}

// ---- Database ----

export class NodeDatabase {
  private nodes: Map<string, CompactNodeEntry>;
  private allEntries: CompactNodeEntry[];

  constructor(data: CompactNodeEntry[] = nodesData) {
    this.nodes = new Map();
    this.allEntries = data;
    for (const entry of data) {
      this.nodes.set(entry.t, entry);
      // Also index by short name (e.g. "httpRequest" → full type)
      const short = entry.t.replace("n8n-nodes-base.", "").replace("@n8n/n8n-nodes-langchain.", "langchain:");
      if (short !== entry.t) {
        this.nodes.set(short, entry);
      }
      // Index by lowercase displayName
      this.nodes.set(entry.d.toLowerCase(), entry);
    }
  }

  /** Get a single node by type, short name, or display name */
  getNode(nodeType: string): CompactNodeEntry | null {
    // Direct lookup
    const direct = this.nodes.get(nodeType);
    if (direct) return direct;

    // Normalize n8n-nodes-base. → nodes-base. (data uses compact prefix)
    if (nodeType.startsWith("n8n-nodes-base.")) {
      const compact = nodeType.replace("n8n-nodes-base.", "nodes-base.");
      const found = this.nodes.get(compact);
      if (found) return found;
    }

    // Normalize @n8n/n8n-nodes-langchain. → nodes-langchain.
    if (nodeType.startsWith("@n8n/n8n-nodes-langchain.")) {
      const compact = nodeType.replace("@n8n/n8n-nodes-langchain.", "nodes-langchain.");
      const found = this.nodes.get(compact);
      if (found) return found;
    }

    // Try with n8n-nodes-base. prefix
    const withPrefix = this.nodes.get(`n8n-nodes-base.${nodeType}`);
    if (withPrefix) return withPrefix;

    // Try with nodes-base. prefix (compact format)
    const withShortPrefix = this.nodes.get(`nodes-base.${nodeType}`);
    if (withShortPrefix) return withShortPrefix;

    // Try langchain prefixes
    const withLangchain = this.nodes.get(`@n8n/n8n-nodes-langchain.${nodeType}`);
    if (withLangchain) return withLangchain;
    const withShortLangchain = this.nodes.get(`nodes-langchain.${nodeType}`);
    if (withShortLangchain) return withShortLangchain;

    // Case-insensitive display name
    const lower = nodeType.toLowerCase();
    return this.nodes.get(lower) ?? null;
  }

  /** Search nodes with relevance scoring */
  searchNodes(
    query: string,
    options?: {
      mode?: "OR" | "AND" | "FUZZY";
      limit?: number;
      source?: "all" | "core" | "langchain";
    }
  ): NodeSearchResult[] {
    const mode = options?.mode ?? "OR";
    const limit = options?.limit ?? 20;
    const source = options?.source ?? "all";

    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    if (words.length === 0) return [];

    const results: Array<{ entry: CompactNodeEntry; score: number }> = [];

    for (const entry of this.allEntries) {
      // Source filter
      if (source === "core" && entry.pkg !== "base") continue;
      if (source === "langchain" && entry.pkg !== "langchain") continue;

      const score = this.scoreEntry(entry, words, mode);
      if (score > 0) {
        results.push({ entry, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit).map(({ entry, score }) => ({
      nodeType: entry.t,
      displayName: entry.d,
      description: entry.desc,
      category: entry.cat,
      package: entry.pkg,
      score,
      isTrigger: !!(entry.f & NODE_FLAGS.TRIGGER),
      isWebhook: !!(entry.f & NODE_FLAGS.WEBHOOK),
      isAITool: !!(entry.f & NODE_FLAGS.AI_TOOL),
    }));
  }

  /** Get operations for a node */
  getOperations(nodeType: string): CompactOperation[] {
    return this.getNode(nodeType)?.ops ?? [];
  }

  /** Get all essential properties */
  getProperties(nodeType: string): CompactProperty[] {
    return this.getNode(nodeType)?.props ?? [];
  }

  /** Get only required properties */
  getRequiredProperties(nodeType: string): CompactProperty[] {
    return this.getProperties(nodeType).filter((p) => p.req);
  }

  /** Total node count */
  get size(): number {
    return this.allEntries.length;
  }

  // ---- Private scoring ----

  private scoreEntry(
    entry: CompactNodeEntry,
    words: string[],
    mode: "OR" | "AND" | "FUZZY"
  ): number {
    let totalScore = 0;
    let matchedWords = 0;

    for (const word of words) {
      let wordScore = 0;
      const typeLower = entry.t.toLowerCase();
      const nameLower = entry.d.toLowerCase();
      const tokens = entry._s;

      // Exact type match
      if (typeLower === word || typeLower.endsWith(`.${word}`)) {
        wordScore = 100;
      }
      // Exact display name match
      else if (nameLower === word) {
        wordScore = 90;
      }
      // Display name starts with word
      else if (nameLower.startsWith(word)) {
        wordScore = 70;
      }
      // Display name contains word
      else if (nameLower.includes(word)) {
        wordScore = 50;
      }
      // Type contains word
      else if (typeLower.includes(word)) {
        wordScore = 40;
      }
      // Search tokens contain word
      else if (tokens.includes(word)) {
        wordScore = 20;
      }
      // FUZZY: substring tolerance (1-char difference)
      else if (mode === "FUZZY" && word.length >= 3) {
        wordScore = this.fuzzyScore(word, nameLower, tokens);
      }

      if (wordScore > 0) {
        matchedWords++;
        totalScore += wordScore;
      }
    }

    // AND mode: all words must match
    if (mode === "AND" && matchedWords < words.length) return 0;

    // OR mode: at least one word must match
    if (matchedWords === 0) return 0;

    return totalScore;
  }

  private fuzzyScore(word: string, name: string, tokens: string): number {
    // Simple fuzzy: check if removing 1 char from word matches
    for (let i = 0; i < word.length; i++) {
      const partial = word.slice(0, i) + word.slice(i + 1);
      if (name.includes(partial) || tokens.includes(partial)) return 15;
    }
    // Check if swapping adjacent chars matches
    for (let i = 0; i < word.length - 1; i++) {
      const swapped =
        word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
      if (name.includes(swapped) || tokens.includes(swapped)) return 12;
    }
    return 0;
  }
}

// Singleton instance
export const nodeDb = new NodeDatabase();
