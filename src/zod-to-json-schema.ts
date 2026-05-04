import { z, ZodTypeAny, ZodObject, ZodEnum, ZodOptional, ZodDefault } from "zod";

/**
 * Minimal Zod → JSON Schema converter that's good enough for MCP tool
 * inputSchemas. Avoids pulling in `zod-to-json-schema` (yet another transitive
 * dep) — we only need a small subset (object, string, number, boolean, enum,
 * optional, default, describe).
 */
export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  return convert(schema);
}

function convert(schema: ZodTypeAny): Record<string, unknown> {
  const def = schema._def;
  const description: string | undefined = def.description;

  // Unwrap ZodOptional / ZodDefault first — keep going until we hit the
  // underlying primitive/object type.
  if (schema instanceof ZodOptional) {
    return convert(def.innerType);
  }
  if (schema instanceof ZodDefault) {
    const inner = convert(def.innerType);
    return { ...inner, default: def.defaultValue() };
  }

  if (schema instanceof ZodObject) {
    const shape = (schema as ZodObject<any>).shape as Record<string, ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, fieldSchema] of Object.entries(shape)) {
      properties[key] = convert(fieldSchema);
      if (!isOptional(fieldSchema)) {
        required.push(key);
      }
    }
    const out: Record<string, unknown> = { type: "object", properties };
    if (required.length) out.required = required;
    if (description) out.description = description;
    return out;
  }

  if (schema instanceof ZodEnum) {
    return {
      type: "string",
      enum: (def.values as string[]) ?? [],
      ...(description ? { description } : {}),
    };
  }

  // Primitives by typeName — works for the basic schemas our tools use.
  switch (def.typeName) {
    case "ZodString":
      return { type: "string", ...(description ? { description } : {}) };
    case "ZodNumber":
      return { type: "number", ...(description ? { description } : {}) };
    case "ZodBoolean":
      return { type: "boolean", ...(description ? { description } : {}) };
    default:
      // Fall back to any-object for unsupported types. We don't expect to hit
      // this for the current tool set; expand as needed.
      return { ...(description ? { description } : {}) };
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  if (schema instanceof ZodOptional) return true;
  if (schema instanceof ZodDefault) return true;
  return false;
}
