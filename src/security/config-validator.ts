// ============================================================
// n8n-mcp-lite: Node configuration validator
// Validates node configs against the knowledge DB schemas
// ============================================================

import type { ValidationError, ValidationWarning, VirtualNode } from "./types.js";
import { nodeDb } from "../knowledge/node-db.js";
import { NODE_FLAGS } from "../knowledge/types.js";

/**
 * Validate a single node's configuration against the node knowledge DB.
 * Returns errors (blocking) and warnings (advisory).
 */
export function validateNodeConfig(
  node: VirtualNode
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const { name, type, parameters } = node;

  // 1. Check node type exists in knowledge DB (getNode handles prefix resolution)
  const nodeSchema = nodeDb.getNode(type);
  if (!nodeSchema) {
    // Custom/community/newer nodes: WARNING only, don't block
    // The n8n API will reject truly invalid types anyway
    warnings.push({
      type: "unknown_node_warning",
      node: name,
      message: `Node type "${type}" not in knowledge DB (may be custom/community/newer). Schema validation skipped.`,
      suggestion: "Verify this node type exists in your n8n instance. Use search_nodes to find standard nodes.",
    });
    return { errors, warnings }; // Can't validate further without schema, but don't block
  }
  // 2. Validate required properties
  if (nodeSchema.props) {
    for (const prop of nodeSchema.props) {
      if (!prop.req) continue;

      // Check if property is conditionally visible
      if (prop.show) {
        const visible = isPropertyVisible(
          prop.show as Record<string, unknown[]>,
          parameters
        );
        if (!visible) continue; // Skip hidden required props
      }

      const value = parameters[prop.n];
      if (value === undefined || value === null || value === "") {
        errors.push({
          type: "missing_required",
          node: name,
          property: prop.n,
          message: `Required property "${prop.dn || prop.n}" is missing or empty.`,
          fix: prop.def !== undefined
            ? `Set "${prop.n}" (default: ${JSON.stringify(prop.def)})`
            : `Provide a value for "${prop.n}"`,
        });
      }
    }
  }

  // 3. Validate option values against allowed options
  if (nodeSchema.props) {
    for (const prop of nodeSchema.props) {
      if (!prop.opts || prop.opts.length === 0) continue;

      const value = parameters[prop.n];
      if (value === undefined || value === null) continue;

      // Skip expression values
      if (typeof value === "string" && value.startsWith("=")) continue;

      const allowedValues = prop.opts.map((o) => o.v);
      if (typeof value === "string" && !allowedValues.includes(value)) {
        errors.push({
          type: "invalid_value",
          node: name,
          property: prop.n,
          message: `Invalid value "${value}" for "${prop.dn || prop.n}". Allowed values: ${allowedValues.join(", ")}`,
          fix: `Use one of: ${allowedValues.join(", ")}`,
        });
      }
    }
  }

  // 4. Validate operations if the node has operation definitions
  if (nodeSchema.ops && nodeSchema.ops.length > 0) {
    const resource = parameters.resource as string | undefined;
    const operation = parameters.operation as string | undefined;

    if (resource !== undefined) {
      const validResources = [...new Set(nodeSchema.ops.map((o) => o.r))];
      if (typeof resource === "string" && !resource.startsWith("=") && !validResources.includes(resource)) {
        errors.push({
          type: "invalid_value",
          node: name,
          property: "resource",
          message: `Invalid resource "${resource}". Available: ${validResources.join(", ")}`,
          fix: `Use one of: ${validResources.join(", ")}`,
        });
      }
    }

    if (operation !== undefined && resource !== undefined) {
      const validOps = nodeSchema.ops
        .filter((o) => o.r === resource)
        .flatMap((o) => o.ops);

      if (
        typeof operation === "string" &&
        !operation.startsWith("=") &&
        validOps.length > 0 &&
        !validOps.includes(operation)
      ) {
        errors.push({
          type: "invalid_value",
          node: name,
          property: "operation",
          message: `Invalid operation "${operation}" for resource "${resource}". Available: ${validOps.join(", ")}`,
          fix: `Use one of: ${validOps.join(", ")}`,
        });
      }
    }
  }

  // 5. Node-specific checks
  const nodeType = nodeSchema.t.toLowerCase();

  // HTTP Request: URL validation
  if (nodeType.includes("httprequest")) {
    validateHttpRequest(name, parameters, errors, warnings);
  }

  // Database nodes: SQL injection
  if (
    nodeType.includes("postgres") ||
    nodeType.includes("mysql") ||
    nodeType.includes("microsoftsql")
  ) {
    validateSqlNode(name, parameters, errors, warnings);
  }

  // Code nodes: basic checks
  if (nodeType.includes("code") || nodeType.includes("function")) {
    validateCodeNode(name, parameters, warnings);
  }

  // 6. Type validation: check param types against schema
  if (nodeSchema.props) {
    for (const prop of nodeSchema.props) {
      const value = parameters[prop.n];
      if (value === undefined || value === null) continue;
      // Skip expression values (resolved at runtime)
      if (typeof value === "string" && value.startsWith("=")) continue;

      const expectedType = prop.t; // "string", "number", "boolean", "options", etc.
      const actualType = typeof value;

      if (
        (expectedType === "string" || expectedType === "options") &&
        actualType !== "string" &&
        actualType !== "object" // collections/fixedCollections are objects
      ) {
        warnings.push({
          type: "type_mismatch",
          node: name,
          property: prop.n,
          message: `"${prop.dn || prop.n}" expects a string but got ${actualType}.`,
          suggestion: `Convert the value to a string.`,
        });
      } else if (expectedType === "number" && actualType !== "number") {
        warnings.push({
          type: "type_mismatch",
          node: name,
          property: prop.n,
          message: `"${prop.dn || prop.n}" expects a number but got ${actualType}.`,
          suggestion: `Provide a numeric value.`,
        });
      } else if (expectedType === "boolean" && actualType !== "boolean") {
        warnings.push({
          type: "type_mismatch",
          node: name,
          property: prop.n,
          message: `"${prop.dn || prop.n}" expects a boolean but got ${actualType}.`,
          suggestion: `Use true or false.`,
        });
      }
    }
  }

  // 7. Property location hints: DISABLED
  // The compressed schema does not include all valid top-level params for every
  // node type. Any valid param absent from the compressed schema would be flagged
  // as misplaced, producing false positives on virtually every real workflow
  // (e.g. HTTP Request's sendBody, sendHeaders, queryParameters; Code's mode; etc.).
  // Re-enable only when the schema is extended to cover all valid top-level params.

  return { errors, warnings };
}

// ---- Node-specific validators ----

function validateHttpRequest(
  nodeName: string,
  params: Record<string, unknown>,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const url = params.url as string | undefined;
  if (url && typeof url === "string" && !url.startsWith("=")) {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      warnings.push({
        type: "best_practice",
        node: nodeName,
        property: "url",
        message: `URL "${url}" doesn't start with http:// or https://. May be intentional if using a base URL.`,
        suggestion: "Ensure the URL includes the protocol (https://)",
      });
    }
  }

  const method = (params.method as string || params.requestMethod as string || "").toUpperCase();
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const hasBody =
      params.body !== undefined ||
      params.sendBody !== undefined ||
      params.bodyParameters !== undefined ||
      params.jsonBody !== undefined;
    if (!hasBody) {
      warnings.push({
        type: "best_practice",
        node: nodeName,
        message: `${method} request without body configuration. Consider adding a request body.`,
        suggestion: "Set sendBody or configure body parameters.",
      });
    }
  }
}

function validateSqlNode(
  nodeName: string,
  params: Record<string, unknown>,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const query = params.query as string | undefined;
  if (!query || typeof query !== "string") return;

  // SQL injection: expressions directly in SQL
  if (query.includes("{{") && query.includes("}}")) {
    warnings.push({
      type: "security",
      node: nodeName,
      property: "query",
      message: "SQL query contains template expressions, which may be vulnerable to SQL injection.",
      suggestion: "Use parameterized queries ($1, $2) instead of embedding expressions directly in SQL.",
    });
  }

  // DELETE without WHERE
  const upper = query.toUpperCase().replace(/\s+/g, " ");
  if (upper.includes("DELETE FROM") && !upper.includes("WHERE")) {
    warnings.push({
      type: "security",
      node: nodeName,
      property: "query",
      message: "DELETE statement without WHERE clause will delete ALL rows in the table.",
      suggestion: "Add a WHERE clause to limit which rows are deleted.",
    });
  }

  // DROP TABLE
  if (upper.includes("DROP TABLE") || upper.includes("DROP DATABASE")) {
    warnings.push({
      type: "security",
      node: nodeName,
      property: "query",
      message: "Destructive SQL operation (DROP) detected. This cannot be undone.",
      suggestion: "Double-check this is intentional. Consider using a safety snapshot first.",
    });
  }
}

function validateCodeNode(
  nodeName: string,
  params: Record<string, unknown>,
  warnings: ValidationWarning[]
): void {
  const code = (params.jsCode as string) || (params.pythonCode as string) || (params.code as string) || "";
  if (!code || typeof code !== "string") return;

  // eval/exec detection
  if (/\beval\s*\(/.test(code) || /\bexec\s*\(/.test(code)) {
    warnings.push({
      type: "security",
      node: nodeName,
      property: "code",
      message: "Code uses eval() or exec(), which can execute arbitrary code and is a security risk.",
      suggestion: "Avoid eval/exec. Use explicit logic instead.",
    });
  }

  // Missing return statement
  if (
    code.includes("function") &&
    !code.includes("return") &&
    !code.includes("=>")
  ) {
    warnings.push({
      type: "best_practice",
      node: nodeName,
      property: "code",
      message: "Code function may be missing a return statement.",
      suggestion: "Ensure the function returns items (e.g., return $input.all()).",
    });
  }
}

// ---- Visibility check ----

/**
 * Check if a property is visible based on its show conditions.
 * show is a record like { resource: ["channel"], operation: ["create"] }
 */
function isPropertyVisible(
  show: Record<string, unknown[]>,
  params: Record<string, unknown>
): boolean {
  for (const [key, allowedValues] of Object.entries(show)) {
    const actualValue = params[key];
    if (actualValue === undefined) return false;

    const matches = allowedValues.some(
      (allowed) => String(allowed) === String(actualValue)
    );
    if (!matches) return false;
  }
  return true;
}
