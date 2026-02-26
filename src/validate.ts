// ============================================================
// n8n-mcp-lite: Zero-dependency input validation
// Validates tool parameters against JSON Schema-like definitions
// ============================================================

export interface ValidationError {
  field: string;
  message: string;
  expected?: string;
}

interface PropertySchema {
  type?: string;
  enum?: unknown[];
  items?: PropertySchema;
  properties?: Record<string, PropertySchema>;
  required?: string[];
  minimum?: number;
  maximum?: number;
}

interface ToolSchema {
  type: "object";
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

// ---- Core validation ----

export function validate(
  args: Record<string, unknown>,
  schema: ToolSchema
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (args[field] === undefined || args[field] === null) {
        errors.push({
          field,
          message: `Missing required parameter: ${field}`,
        });
      }
    }
  }

  // Check each provided field against schema
  if (schema.properties) {
    for (const [key, value] of Object.entries(args)) {
      const propSchema = schema.properties[key];
      if (!propSchema) continue; // Allow extra fields (MCP may pass metadata)

      const fieldErrors = validateValue(key, value, propSchema);
      errors.push(...fieldErrors);
    }
  }

  return errors;
}

function validateValue(
  field: string,
  value: unknown,
  schema: PropertySchema
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (value === undefined || value === null) return errors;

  // Type checking
  if (schema.type) {
    const actualType = getJsonType(value);
    if (actualType !== schema.type) {
      errors.push({
        field,
        message: `Expected ${schema.type}, got ${actualType}`,
        expected: schema.type,
      });
      return errors; // Skip further checks if type is wrong
    }
  }

  // Enum checking
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({
      field,
      message: `Invalid value "${value}". Must be one of: ${schema.enum.join(", ")}`,
      expected: schema.enum.join(" | "),
    });
  }

  // Number range
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({
        field,
        message: `Value ${value} is below minimum ${schema.minimum}`,
      });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({
        field,
        message: `Value ${value} is above maximum ${schema.maximum}`,
      });
    }
  }

  // Array item validation
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const itemErrors = validateValue(`${field}[${i}]`, value[i], schema.items);
      errors.push(...itemErrors);

      // Validate required sub-fields for object items
      if (
        schema.items.type === "object" &&
        schema.items.required &&
        typeof value[i] === "object" &&
        value[i] !== null
      ) {
        const item = value[i] as Record<string, unknown>;
        for (const req of schema.items.required) {
          if (item[req] === undefined || item[req] === null) {
            errors.push({
              field: `${field}[${i}].${req}`,
              message: `Missing required field: ${req}`,
            });
          }
        }
      }
    }
  }

  return errors;
}

function getJsonType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value; // "string" | "number" | "boolean" | "object" | ...
}

// ---- Helper: validate and return formatted error or null ----

export function validateArgs(
  args: Record<string, unknown>,
  schema: ToolSchema,
  toolName: string
): string | null {
  const errors = validate(args, schema);
  if (errors.length === 0) return null;

  const lines = errors.map((e) =>
    e.expected
      ? `  - ${e.field}: ${e.message}`
      : `  - ${e.field}: ${e.message}`
  );
  return `Validation failed for "${toolName}":\n${lines.join("\n")}`;
}
