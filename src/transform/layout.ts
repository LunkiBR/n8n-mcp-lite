// ============================================================
// n8n-mcp-lite: Smart Auto-Layout Algorithm
// Layered + Branch Fan positioning for workflow nodes
//
// Produces readable layouts for:
// - Linear chains (A → B → C)
// - IF branches (true/false paths with vertical separation)
// - Switch with N outputs (fan pattern)
// - Merge nodes (centered between converging branches)
// - Parallel disconnected chains
// ============================================================

import type { LiteNode, LiteConnection } from "../types.js";

// ---- Constants ----

const SPACING_X = 250; // Horizontal spacing between layers
const SPACING_Y = 200; // Vertical spacing between lanes
const BASE_X = 250; // Starting X position
const BASE_Y = 300; // Center Y position

// ---- Types ----

interface AdjEntry {
  node: string;
  outputIndex: number;
  inputIndex: number;
}

interface LayoutContext {
  forward: Map<string, AdjEntry[]>;
  reverse: Map<string, AdjEntry[]>;
  layers: Map<string, number>;
  lanes: Map<string, number>;
  branchOutputs: Map<string, number>; // node → max outputIndex
  nodeNames: Set<string>;
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Calculate [x, y] positions for all nodes based on the workflow topology.
 *
 * Algorithm:
 * 1. BFS layer assignment (X axis) — roots at layer 0, children at layer+1
 * 2. Detect branch points (IF/Switch nodes with multiple outputs)
 * 3. DFS lane assignment (Y axis) — branches fan out vertically
 * 4. Merge nodes center between incoming branches
 * 5. Convert layers/lanes to pixel coordinates
 */
export function autoLayout(
  nodes: LiteNode[],
  flow: LiteConnection[]
): Map<string, [number, number]> {
  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) {
    return new Map([[nodes[0].name, [BASE_X, BASE_Y]]]);
  }

  const nodeNames = new Set(nodes.map((n) => n.name));
  const { forward, reverse } = buildLocalAdjacency(flow, nodeNames);
  const branchOutputs = detectBranchPoints(flow, nodeNames);

  // Step 1: Assign layers (X axis)
  const layers = assignLayers(nodes, forward, reverse);

  // Step 2: Assign lanes (Y axis) with branch fan-out
  const lanes = assignLanes(nodes, flow, layers, branchOutputs, forward, reverse);

  // Step 3: Convert to pixel positions
  return computePositions(nodes, layers, lanes);
}

// ============================================================
// STEP 1: Layer Assignment (X axis via BFS)
// ============================================================

/**
 * Assign each node to a layer using BFS from root nodes.
 * Uses the "longest path" approach: a node's layer = max(parent_layers) + 1
 * This ensures merge nodes are placed after ALL their inputs arrive.
 */
function assignLayers(
  nodes: LiteNode[],
  forward: Map<string, AdjEntry[]>,
  reverse: Map<string, AdjEntry[]>
): Map<string, number> {
  const layers = new Map<string, number>();

  // Find root nodes (no incoming connections)
  const roots = nodes.filter(
    (n) => !reverse.has(n.name) || reverse.get(n.name)!.length === 0
  );

  // If no roots found (cycle?), use first node
  if (roots.length === 0 && nodes.length > 0) {
    roots.push(nodes[0]);
  }

  // BFS with longest-path layer assignment
  const queue: Array<[string, number]> = [];

  for (const root of roots) {
    layers.set(root.name, 0);
    queue.push([root.name, 0]);
  }

  // Bug #16 fix: guard against infinite loops caused by cycles in the graph.
  // Workflows should be DAGs, but corrupted data or update_nodes misuse can
  // introduce A→B→A edges. Cap iterations at nodes²×2 as a hard safety limit.
  let maxIterations = nodes.length * nodes.length * 2 + nodes.length + 1;

  while (queue.length > 0) {
    if (--maxIterations < 0) break; // cycle detected — stop gracefully

    const [current, currentLayer] = queue.shift()!;
    const neighbors = forward.get(current) ?? [];

    for (const neighbor of neighbors) {
      const newLayer = currentLayer + 1;
      const existingLayer = layers.get(neighbor.node);

      // Always use the MAXIMUM layer (for merge nodes that have multiple inputs)
      if (existingLayer === undefined || newLayer > existingLayer) {
        layers.set(neighbor.node, newLayer);
        queue.push([neighbor.node, newLayer]);
      }
    }
  }

  // Handle disconnected nodes: assign to layer 0
  for (const node of nodes) {
    if (!layers.has(node.name)) {
      layers.set(node.name, 0);
    }
  }

  return layers;
}

// ============================================================
// STEP 2: Lane Assignment (Y axis via DFS with Branch Fan)
// ============================================================

/**
 * Assign lanes (vertical positions) using DFS.
 * Branch nodes (IF/Switch) fan out their children into separate lanes.
 * Merge nodes center between their incoming lanes.
 */
function assignLanes(
  nodes: LiteNode[],
  flow: LiteConnection[],
  layers: Map<string, number>,
  branchOutputs: Map<string, number>,
  forward: Map<string, AdjEntry[]>,
  reverse: Map<string, AdjEntry[]>
): Map<string, number> {
  const lanes = new Map<string, number>();
  const visited = new Set<string>();

  // Find root nodes to start DFS from
  const roots = nodes.filter(
    (n) => !reverse.has(n.name) || reverse.get(n.name)!.length === 0
  );

  if (roots.length === 0 && nodes.length > 0) {
    roots.push(nodes[0]);
  }

  // Process each root with its own starting lane
  let nextRootLane = 0;
  for (const root of roots) {
    if (visited.has(root.name)) continue;
    dfsAssignLane(root.name, nextRootLane, lanes, visited, forward, reverse, branchOutputs, flow);

    // Next disconnected root gets a new lane band
    nextRootLane = getMaxLane(lanes) + 2;
  }

  // Handle any remaining unvisited nodes
  for (const node of nodes) {
    if (!lanes.has(node.name)) {
      lanes.set(node.name, nextRootLane);
      nextRootLane++;
    }
  }

  // Post-process: center merge nodes between their incoming lanes
  // and propagate to downstream single-parent chains
  centerMergeNodes(nodes, lanes, reverse, forward);

  return lanes;
}

/**
 * DFS traversal that propagates lanes and fans out at branch points.
 */
function dfsAssignLane(
  nodeName: string,
  currentLane: number,
  lanes: Map<string, number>,
  visited: Set<string>,
  forward: Map<string, AdjEntry[]>,
  reverse: Map<string, AdjEntry[]>,
  branchOutputs: Map<string, number>,
  flow: LiteConnection[]
): void {
  if (visited.has(nodeName)) return;
  visited.add(nodeName);
  lanes.set(nodeName, currentLane);

  const maxOutput = branchOutputs.get(nodeName) ?? 0;
  const children = forward.get(nodeName) ?? [];

  if (maxOutput > 0 && children.length > 1) {
    // This is a BRANCH node (IF/Switch) — fan out children
    // Group children by their outputIndex
    const childrenByOutput = new Map<number, string[]>();
    for (const child of children) {
      const outIdx = child.outputIndex;
      if (!childrenByOutput.has(outIdx)) {
        childrenByOutput.set(outIdx, []);
      }
      childrenByOutput.get(outIdx)!.push(child.node);
    }

    // Sort output indices
    const sortedOutputs = [...childrenByOutput.keys()].sort((a, b) => a - b);
    const totalOutputs = sortedOutputs.length;

    // Fan out: each output gets a lane offset centered around parent lane
    for (let i = 0; i < sortedOutputs.length; i++) {
      const outputIdx = sortedOutputs[i];
      const childNames = childrenByOutput.get(outputIdx)!;

      // Calculate lane offset: center the fan around parent lane
      const offset = i - (totalOutputs - 1) / 2;
      const childLane = currentLane + offset;

      for (const childName of childNames) {
        dfsAssignLane(
          childName,
          childLane,
          lanes,
          visited,
          forward,
          reverse,
          branchOutputs,
          flow
        );
      }
    }
  } else {
    // Normal node — propagate same lane to children
    for (const child of children) {
      // Only visit if not already visited (avoid merge conflicts mid-DFS)
      if (!visited.has(child.node)) {
        dfsAssignLane(
          child.node,
          currentLane,
          lanes,
          visited,
          forward,
          reverse,
          branchOutputs,
          flow
        );
      }
    }
  }
}

/**
 * Post-process: center merge nodes between their incoming branch lanes,
 * then propagate the corrected lane to downstream single-parent chains.
 */
function centerMergeNodes(
  nodes: LiteNode[],
  lanes: Map<string, number>,
  reverse: Map<string, AdjEntry[]>,
  forward?: Map<string, AdjEntry[]>
): void {
  const corrected = new Set<string>();

  for (const node of nodes) {
    const parents = reverse.get(node.name) ?? [];
    if (parents.length <= 1) continue;

    // This is a merge point — center between parent lanes
    const parentLanes = parents
      .map((p) => lanes.get(p.node))
      .filter((l): l is number => l !== undefined);

    if (parentLanes.length >= 2) {
      const avgLane =
        parentLanes.reduce((sum, l) => sum + l, 0) / parentLanes.length;
      lanes.set(node.name, avgLane);
      corrected.add(node.name);
    }
  }

  // Propagate corrected lanes to downstream chains
  if (forward && corrected.size > 0) {
    const propagateQueue = [...corrected];
    const propagated = new Set<string>();

    while (propagateQueue.length > 0) {
      const current = propagateQueue.shift()!;
      if (propagated.has(current)) continue;
      propagated.add(current);

      const currentLane = lanes.get(current);
      if (currentLane === undefined) continue;

      const children = forward.get(current) ?? [];
      for (const child of children) {
        // Only propagate to single-parent children (not other merge points)
        const childParents = reverse.get(child.node) ?? [];
        if (childParents.length <= 1) {
          lanes.set(child.node, currentLane);
          propagateQueue.push(child.node);
        }
      }
    }
  }
}

// ============================================================
// STEP 3: Convert Layers/Lanes to Pixel Positions
// ============================================================

function computePositions(
  nodes: LiteNode[],
  layers: Map<string, number>,
  lanes: Map<string, number>
): Map<string, [number, number]> {
  const positions = new Map<string, [number, number]>();

  for (const node of nodes) {
    const layer = layers.get(node.name) ?? 0;
    const lane = lanes.get(node.name) ?? 0;

    const x = BASE_X + layer * SPACING_X;
    const y = BASE_Y + lane * SPACING_Y;

    positions.set(node.name, [Math.round(x), Math.round(y)]);
  }

  return positions;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Build adjacency maps from flow connections, filtered to known nodes only.
 */
function buildLocalAdjacency(
  flow: LiteConnection[],
  nodeNames: Set<string>
): { forward: Map<string, AdjEntry[]>; reverse: Map<string, AdjEntry[]> } {
  const forward = new Map<string, AdjEntry[]>();
  const reverse = new Map<string, AdjEntry[]>();

  for (const conn of flow) {
    if (!nodeNames.has(conn.from) || !nodeNames.has(conn.to)) continue;

    const entry: AdjEntry = {
      node: conn.to,
      outputIndex: conn.outputIndex ?? 0,
      inputIndex: conn.inputIndex ?? 0,
    };

    if (!forward.has(conn.from)) forward.set(conn.from, []);
    forward.get(conn.from)!.push(entry);

    const reverseEntry: AdjEntry = {
      node: conn.from,
      outputIndex: conn.outputIndex ?? 0,
      inputIndex: conn.inputIndex ?? 0,
    };
    if (!reverse.has(conn.to)) reverse.set(conn.to, []);
    reverse.get(conn.to)!.push(reverseEntry);
  }

  return { forward, reverse };
}

/**
 * Detect branch points: nodes with connections using outputIndex > 0.
 */
function detectBranchPoints(
  flow: LiteConnection[],
  nodeNames: Set<string>
): Map<string, number> {
  const maxOutput = new Map<string, number>();

  for (const conn of flow) {
    if (!nodeNames.has(conn.from)) continue;
    const idx = conn.outputIndex ?? 0;
    const current = maxOutput.get(conn.from) ?? 0;
    if (idx > current) maxOutput.set(conn.from, idx);
  }

  return maxOutput;
}

/**
 * Get the maximum lane value currently assigned.
 */
function getMaxLane(lanes: Map<string, number>): number {
  if (lanes.size === 0) return 0;
  return Math.max(...lanes.values());
}
