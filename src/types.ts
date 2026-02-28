// ============================================================
// n8n-mcp-lite: Type definitions
// ============================================================

// --- n8n API raw types ---

export interface N8nNodeRaw {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
  disabled?: boolean;
  notes?: string;
  notesInFlow?: boolean;
  onError?: string;
  continueOnFail?: boolean;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
  webhookId?: string;
  [key: string]: unknown;
}

export interface N8nConnectionTarget {
  node: string;
  type: string;
  index: number;
}

export interface N8nConnections {
  [sourceName: string]: {
    [outputType: string]: N8nConnectionTarget[][];
  };
}

export interface N8nWorkflowRaw {
  id: string;
  name: string;
  active: boolean;
  nodes: N8nNodeRaw[];
  connections: N8nConnections;
  settings?: Record<string, unknown>;
  tags?: Array<{ id: string; name: string }>;
  createdAt?: string;
  updatedAt?: string;
  description?: string | null;
  isArchived?: boolean;
  // Bloat fields we strip
  staticData?: unknown;
  meta?: unknown;
  pinData?: unknown;
  versionId?: string;
  activeVersionId?: string;
  versionCounter?: number;
  triggerCount?: number;
  shared?: unknown;
  activeVersion?: unknown;
  [key: string]: unknown;
}

export interface N8nWorkflowListItem {
  id: string;
  name: string;
  active: boolean;
  isArchived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  tags?: Array<{ id: string; name: string }>;
  nodeCount?: number;
}

// --- Simplified (lite) types ---

export interface LiteNode {
  /** Node name (unique identifier within workflow) */
  name: string;
  /** Node type without "n8n-nodes-base." prefix when possible */
  type: string;
  /** Only non-default, non-empty parameters */
  params?: Record<string, unknown>;
  /** Credential names used (simplified) */
  creds?: Record<string, string>;
  /** Only present if true */
  disabled?: true;
  /** Error handling mode if non-default */
  onError?: string;
  /** Notes attached to node */
  notes?: string;
  /** Internal ID - preserved for reconstruction */
  _id: string;
  /** Type version - only if != 1 */
  _v?: number;
  /** Input data keys from last execution (injected by focus_workflow with executionId) */
  inputHint?: string[];
}

/** Simplified connection: "source -> target" with optional metadata */
export interface LiteConnection {
  from: string;
  to: string;
  /** Output type if not "main" */
  type?: string;
  /** Source output index if > 0 (e.g., IF true=0/false=1) */
  outputIndex?: number;
  /** Target input index if > 0 */
  inputIndex?: number;
}

export interface LiteWorkflow {
  id: string;
  name: string;
  active: boolean;
  tags?: string[];
  /** Nodes in execution order when possible */
  nodes: LiteNode[];
  /** Simplified connections */
  flow: LiteConnection[];
  /** Only non-default settings */
  settings?: Record<string, unknown>;
  /** Metadata */
  nodeCount: number;
  updatedAt?: string;
}

// --- API client types ---

export interface N8nApiConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

export interface ApiResponse<T> {
  data: T;
  nextCursor?: string;
}

// --- Execution types ---

export interface N8nExecution {
  id: string;
  finished: boolean;
  mode: string;
  status: string;
  startedAt: string;
  stoppedAt?: string;
  workflowId: string;
  data?: unknown;
}

/** Parsed execution run data for a single node */
export interface NodeRunData {
  /** Output data keys from the node's JSON output */
  outputKeys: string[];
  /** Number of items output */
  itemCount: number;
  /** Error message if the node failed */
  error?: string;
}

/** Map of node name -> run data extracted from execution */
export type ExecutionRunDataMap = Record<string, NodeRunData>;

export interface ExecutionListItem {
  id: string;
  status: string;
  mode: string;
  startedAt: string;
  stoppedAt?: string;
  workflowId: string;
  workflowName?: string;
}

// ============================================================
// Focus Mode types
// ============================================================

/** Minimal node representation for workflow scan (no params/code/creds) */
export interface ScanNode {
  name: string;
  type: string;
  _id: string;
  disabled?: true;
  /** One-line summary derived from type + key params */
  summary?: string;
  /** Number of output branches (IF=2, Switch=N, normal=1) */
  outputs?: number;
}

/** Lightweight workflow overview — the "table of contents" */
export interface WorkflowScan {
  id: string;
  name: string;
  active: boolean;
  tags?: string[];
  nodeCount: number;
  nodes: ScanNode[];
  flow: LiteConnection[];
  /** Detected branch segments (Switch paths, IF branches) */
  segments?: WorkflowSegment[];
  /** Estimated total tokens if full workflow were returned */
  estimatedTokens: number;
  /** True if focus mode is recommended for this workflow */
  focusRecommended: boolean;
  updatedAt?: string;
}

/** A detected branch/segment of the workflow */
export interface WorkflowSegment {
  label: string;
  branchNode: string;
  outputIndex: number;
  nodeNames: string[];
  nodeCount: number;
}

/** Classification of a node relative to the focus area */
export type NodeZone = "focused" | "upstream" | "downstream" | "parallel";

/** A dormant (non-focused) node with minimal info */
export interface DormantNode {
  name: string;
  type: string;
  zone: NodeZone;
  summary?: string;
  /** For upstream nodes: which focused nodes they feed into */
  outputsTo?: string[];
  /** For downstream nodes: which focused nodes feed them */
  inputsFrom?: string[];
  /** Hint about what data this node outputs (for upstream context) */
  outputHint?: string;
}

/** A boundary crossing into or out of the focus area */
export interface FocusBoundary {
  from: string;
  to: string;
  outputIndex?: number;
  inputIndex?: number;
  direction: "entry" | "exit";
}

/** The focused workflow view — full detail inside, minimal outside */
export interface FocusedWorkflow {
  id: string;
  name: string;
  totalNodeCount: number;
  /** Nodes with FULL detail (LiteNode format with params/creds) */
  focused: LiteNode[];
  /** Connections between focused nodes only */
  focusedFlow: LiteConnection[];
  /** All non-focused nodes with minimal info */
  dormant: DormantNode[];
  /** Entry/exit points of the focus area */
  boundaries: FocusBoundary[];
  stats: {
    focusedCount: number;
    upstreamCount: number;
    downstreamCount: number;
    parallelCount: number;
  };
}
