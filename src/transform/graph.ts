// ============================================================
// n8n-mcp-lite: Graph traversal algorithms for Focus Mode
// ============================================================

import type { LiteConnection, NodeZone, WorkflowSegment } from "../types.js";

interface AdjEntry {
  node: string;
  outputIndex: number;
  inputIndex: number;
  type?: string;
}

export interface AdjacencyMaps {
  forward: Map<string, AdjEntry[]>;
  reverse: Map<string, AdjEntry[]>;
}

/**
 * Build forward and reverse adjacency lists from LiteConnection array.
 */
export function buildAdjacency(flow: LiteConnection[]): AdjacencyMaps {
  const forward = new Map<string, AdjEntry[]>();
  const reverse = new Map<string, AdjEntry[]>();

  for (const conn of flow) {
    // Forward: from -> to
    if (!forward.has(conn.from)) forward.set(conn.from, []);
    forward.get(conn.from)!.push({
      node: conn.to,
      outputIndex: conn.outputIndex ?? 0,
      inputIndex: conn.inputIndex ?? 0,
      type: conn.type,
    });

    // Reverse: to -> from
    if (!reverse.has(conn.to)) reverse.set(conn.to, []);
    reverse.get(conn.to)!.push({
      node: conn.from,
      outputIndex: conn.outputIndex ?? 0,
      inputIndex: conn.inputIndex ?? 0,
      type: conn.type,
    });
  }

  return { forward, reverse };
}

/**
 * BFS forward from start nodes, collecting all reachable nodes.
 */
export function bfsForward(
  startNodes: string[],
  forward: Map<string, AdjEntry[]>,
  options?: { maxDepth?: number; excludeNodes?: Set<string> }
): Set<string> {
  const visited = new Set<string>();
  const queue: Array<[string, number]> = [];
  const exclude = options?.excludeNodes ?? new Set();
  const maxDepth = options?.maxDepth ?? Infinity;

  for (const start of startNodes) {
    if (!exclude.has(start)) {
      queue.push([start, 0]);
      visited.add(start);
    }
  }

  while (queue.length > 0) {
    const [current, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;

    const neighbors = forward.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor.node) && !exclude.has(neighbor.node)) {
        visited.add(neighbor.node);
        queue.push([neighbor.node, depth + 1]);
      }
    }
  }

  return visited;
}

/**
 * BFS backward from start nodes, collecting all ancestor nodes.
 */
export function bfsBackward(
  startNodes: string[],
  reverse: Map<string, AdjEntry[]>,
  options?: { maxDepth?: number; excludeNodes?: Set<string> }
): Set<string> {
  const visited = new Set<string>();
  const queue: Array<[string, number]> = [];
  const exclude = options?.excludeNodes ?? new Set();
  const maxDepth = options?.maxDepth ?? Infinity;

  for (const start of startNodes) {
    if (!exclude.has(start)) {
      queue.push([start, 0]);
      visited.add(start);
    }
  }

  while (queue.length > 0) {
    const [current, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;

    const ancestors = reverse.get(current) ?? [];
    for (const ancestor of ancestors) {
      if (!visited.has(ancestor.node) && !exclude.has(ancestor.node)) {
        visited.add(ancestor.node);
        queue.push([ancestor.node, depth + 1]);
      }
    }
  }

  return visited;
}

/**
 * Follow a specific output branch from a branching node.
 * Only follows the specified outputIndex from the start node,
 * then follows ALL outputs from downstream nodes.
 * Always includes the branchNode itself.
 */
export function followBranch(
  branchNode: string,
  outputIndex: number,
  flow: LiteConnection[],
  options?: { maxDepth?: number }
): Set<string> {
  // Find immediate targets of the specific branch output
  const branchTargets = flow
    .filter(
      (c) =>
        c.from === branchNode && (c.outputIndex ?? 0) === outputIndex
    )
    .map((c) => c.to);

  if (branchTargets.length === 0) {
    return new Set([branchNode]);
  }

  // BFS forward from branch targets (following ALL outputs)
  const { forward } = buildAdjacency(flow);
  const reachable = bfsForward(branchTargets, forward, {
    maxDepth: options?.maxDepth,
  });

  // Always include the branch node and its targets
  reachable.add(branchNode);
  for (const t of branchTargets) reachable.add(t);

  return reachable;
}

/**
 * Find all nodes on the path between fromNode and toNode.
 * Uses BFS forward from fromNode, but only includes nodes
 * that are also ancestors of toNode.
 */
export function findNodesBetween(
  fromNode: string,
  toNode: string,
  flow: LiteConnection[]
): Set<string> {
  const { forward, reverse } = buildAdjacency(flow);

  // All nodes reachable forward from fromNode
  const forwardReachable = bfsForward([fromNode], forward);

  // All ancestors of toNode (backward reachable)
  const backwardReachable = bfsBackward([toNode], reverse);

  // Intersection: nodes that are both forward-reachable from start
  // AND backward-reachable from end = nodes on the path
  const between = new Set<string>();
  for (const node of forwardReachable) {
    if (backwardReachable.has(node)) {
      between.add(node);
    }
  }

  // Always include from and to
  between.add(fromNode);
  between.add(toNode);

  return between;
}

/**
 * Classify all nodes relative to a set of focused node names.
 */
export function classifyNodes(
  allNodeNames: string[],
  focusedNames: Set<string>,
  flow: LiteConnection[]
): Map<string, NodeZone> {
  const { forward, reverse } = buildAdjacency(flow);
  const classification = new Map<string, NodeZone>();

  // Mark focused nodes
  for (const name of focusedNames) {
    classification.set(name, "focused");
  }

  // Find upstream: nodes that can reach any focused node
  const upstream = bfsBackward(
    Array.from(focusedNames),
    reverse,
    { excludeNodes: focusedNames }
  );

  // Find downstream: nodes reachable from any focused node
  const downstream = bfsForward(
    Array.from(focusedNames),
    forward,
    { excludeNodes: focusedNames }
  );

  // Classify non-focused nodes
  for (const name of allNodeNames) {
    if (focusedNames.has(name)) continue;

    if (downstream.has(name)) {
      // Downstream takes priority over upstream (for merge nodes)
      classification.set(name, "downstream");
    } else if (upstream.has(name)) {
      classification.set(name, "upstream");
    } else {
      classification.set(name, "parallel");
    }
  }

  return classification;
}

/**
 * Detect segments/branches in a workflow.
 * Finds nodes with multiple output paths and traces each branch.
 */
export function detectSegments(
  nodes: Array<{ name: string; type: string }>,
  flow: LiteConnection[]
): WorkflowSegment[] {
  // Find branching nodes by checking for outputIndex > 0 in connections
  const maxOutputByNode = new Map<string, number>();
  for (const conn of flow) {
    const idx = conn.outputIndex ?? 0;
    const current = maxOutputByNode.get(conn.from) ?? 0;
    if (idx > current) maxOutputByNode.set(conn.from, idx);
  }

  const segments: WorkflowSegment[] = [];

  for (const [nodeName, maxIdx] of maxOutputByNode) {
    if (maxIdx === 0) continue; // Only 1 output, not a branch

    const nodeInfo = nodes.find((n) => n.name === nodeName);
    const nodeType = nodeInfo?.type ?? "unknown";

    // Trace each output branch
    for (let outIdx = 0; outIdx <= maxIdx; outIdx++) {
      const branchNodes = followBranch(nodeName, outIdx, flow);
      // Remove the branch node itself from the segment nodes list
      branchNodes.delete(nodeName);

      if (branchNodes.size === 0) continue;

      // Generate label based on node type
      let label: string;
      if (nodeType.includes("if") || nodeType === "if") {
        label = outIdx === 0 ? `${nodeName}: true branch` : `${nodeName}: false branch`;
      } else {
        label = `${nodeName}: output ${outIdx}`;
      }

      segments.push({
        label,
        branchNode: nodeName,
        outputIndex: outIdx,
        nodeNames: Array.from(branchNodes),
        nodeCount: branchNodes.size,
      });
    }
  }

  return segments;
}

/**
 * Find entry and exit boundary connections for a focus area.
 */
export function findBoundaries(
  focusedNames: Set<string>,
  flow: LiteConnection[]
): Array<{
  from: string;
  to: string;
  outputIndex?: number;
  inputIndex?: number;
  direction: "entry" | "exit";
}> {
  const boundaries: Array<{
    from: string;
    to: string;
    outputIndex?: number;
    inputIndex?: number;
    direction: "entry" | "exit";
  }> = [];

  for (const conn of flow) {
    const fromInFocus = focusedNames.has(conn.from);
    const toInFocus = focusedNames.has(conn.to);

    if (!fromInFocus && toInFocus) {
      // Entry: outside → inside
      boundaries.push({
        from: conn.from,
        to: conn.to,
        ...(conn.outputIndex ? { outputIndex: conn.outputIndex } : {}),
        ...(conn.inputIndex ? { inputIndex: conn.inputIndex } : {}),
        direction: "entry",
      });
    } else if (fromInFocus && !toInFocus) {
      // Exit: inside → outside
      boundaries.push({
        from: conn.from,
        to: conn.to,
        ...(conn.outputIndex ? { outputIndex: conn.outputIndex } : {}),
        ...(conn.inputIndex ? { inputIndex: conn.inputIndex } : {}),
        direction: "exit",
      });
    }
  }

  return boundaries;
}
