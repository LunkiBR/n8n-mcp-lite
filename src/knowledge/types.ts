// ============================================================
// n8n-mcp-lite: Node knowledge types
// Compact representations for the pre-built node database
// ============================================================

/** Flags bitmask for node capabilities */
export const NODE_FLAGS = {
  TRIGGER: 1,
  WEBHOOK: 2,
  AI_TOOL: 4,
  VERSIONED: 8,
} as const;

/** Compact node entry stored in data/nodes.json */
export interface CompactNodeEntry {
  /** Full node type (e.g. "n8n-nodes-base.httpRequest") */
  t: string;
  /** Display name */
  d: string;
  /** Short description */
  desc: string;
  /** Category */
  cat: string;
  /** Package: "base" | "langchain" | "community" */
  pkg: string;
  /** Flags bitmask: trigger=1, webhook=2, aiTool=4, versioned=8 */
  f: number;
  /** Latest version string */
  v: string;
  /** Operations: [{r: "channel", ops: ["create","get"]}] */
  ops?: CompactOperation[];
  /** Essential properties (pre-filtered) */
  props?: CompactProperty[];
  /** Required credential types */
  creds?: string[];
  /** Pre-built lowercase search tokens */
  _s: string;
}

/** Compact operation (resource + operations) */
export interface CompactOperation {
  /** Resource name */
  r: string;
  /** Operation names */
  ops: string[];
}

/** Compact property definition */
export interface CompactProperty {
  /** Property name */
  n: string;
  /** Display name */
  dn: string;
  /** Type (string, number, boolean, options, collection, etc.) */
  t: string;
  /** Description */
  desc?: string;
  /** Default value */
  def?: unknown;
  /** Options [{v: value, l: label}] */
  opts?: Array<{ v: string; l: string }>;
  /** Required flag */
  req?: true;
  /** Conditional display: displayOptions.show */
  show?: Record<string, unknown>;
}

/** Search result returned by NodeDatabase.searchNodes() */
export interface NodeSearchResult {
  nodeType: string;
  displayName: string;
  description: string;
  category: string;
  package: string;
  score: number;
  isTrigger: boolean;
  isWebhook: boolean;
  isAITool: boolean;
}
