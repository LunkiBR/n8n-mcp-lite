// ============================================================
// n8n-mcp-lite: Expression validator
// Validates n8n expressions in node parameters
// ============================================================

import type { ValidationError, ValidationWarning } from "./types.js";

/** Check a single string value for expression issues */
export function validateExpression(
  value: string,
  nodeName: string,
  propertyPath: string
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!value || typeof value !== "string") return { errors, warnings };

  // Rule 1: Detect expressions missing the = prefix
  // {{ }} without leading = means the expression is NOT evaluated (literal text)
  const hasBrackets = value.includes("{{") && value.includes("}}");
  const hasPrefix = value.startsWith("=");

  if (hasBrackets && !hasPrefix) {
    errors.push({
      type: "invalid_expression",
      node: nodeName,
      property: propertyPath,
      message: `Expression missing "=" prefix: "${truncate(value, 60)}". Without "=", n8n treats this as literal text and won't evaluate it.`,
      fix: `Prepend "=" to the value: "=${value}"`,
    });
  }

  // Rule 2: Bracket matching
  if (hasBrackets || hasPrefix) {
    const openCount = countOccurrences(value, "{{");
    const closeCount = countOccurrences(value, "}}");

    if (openCount !== closeCount) {
      errors.push({
        type: "syntax_error",
        node: nodeName,
        property: propertyPath,
        message: `Unmatched expression brackets: ${openCount} opening "{{" vs ${closeCount} closing "}}".`,
        fix: "Ensure every {{ has a matching }}",
      });
    }

    // Rule 3: Empty expressions
    if (value.includes("{{}}") || value.includes("{{ }}")) {
      errors.push({
        type: "syntax_error",
        node: nodeName,
        property: propertyPath,
        message: "Empty expression {{ }} found.",
        fix: "Add content between {{ and }}, e.g., {{ $json.field }}",
      });
    }
  }

  // Rule 4: Template literal syntax (common mistake from JS developers)
  if (value.includes("${") && !value.includes("{{")) {
    warnings.push({
      type: "expression_hint",
      node: nodeName,
      property: propertyPath,
      message: `Found JS template literal syntax "\${...}" which n8n doesn't support.`,
      suggestion: `Use n8n syntax instead: "={{ $json.fieldName }}"`,
    });
  }

  // Rule 5: Check for common n8n expression patterns
  if (hasPrefix && hasBrackets) {
    const inner = extractExpressionContent(value);
    for (const expr of inner) {
      // Optional chaining not supported
      if (expr.includes("?.")) {
        warnings.push({
          type: "expression_hint",
          node: nodeName,
          property: propertyPath,
          message: `Optional chaining "?." may not work in n8n expressions.`,
          suggestion: `Use explicit null checks or the $if helper instead.`,
        });
      }

      // Nested brackets not supported
      if (expr.includes("{{")) {
        errors.push({
          type: "syntax_error",
          node: nodeName,
          property: propertyPath,
          message: "Nested {{ }} brackets are not supported in n8n expressions.",
          fix: "Flatten nested expressions into a single {{ }} block.",
        });
      }
    }
  }

  return { errors, warnings };
}

/**
 * Recursively validate all string values in a parameter object.
 * Returns combined errors and warnings for all expressions found.
 */
export function validateAllExpressions(
  params: Record<string, unknown>,
  nodeName: string,
  basePath: string = ""
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const seen = new WeakSet();

  function walk(obj: unknown, path: string, depth: number): void {
    if (depth > 50) return; // Prevent infinite recursion

    if (typeof obj === "string") {
      const result = validateExpression(obj, nodeName, path);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      return;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        walk(obj[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }

    if (obj && typeof obj === "object") {
      if (seen.has(obj as object)) return;
      seen.add(obj as object);

      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        walk(value, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  }

  walk(params, basePath, 0);
  return { errors, warnings };
}

// ---- Helpers ----

function countOccurrences(str: string, sub: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

function extractExpressionContent(value: string): string[] {
  const results: string[] = [];
  const regex = /\{\{(.*?)\}\}/gs;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.substring(0, maxLen) + "..." : str;
}
