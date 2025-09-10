// Ensure a minimal, Anthropic-compatible object schema while preserving useful bits.
export function ensureObjectSchema(raw: any) {
  const out: any = { type: "object" };

  // properties / required / additionalProperties
  out.properties =
    raw?.properties && typeof raw.properties === "object" ? raw.properties : {};
  if (Array.isArray(raw?.required)) out.required = raw.required;
  out.additionalProperties =
    typeof raw?.additionalProperties !== "undefined"
      ? !!raw.additionalProperties
      : false;

  // Preserve helpful references/defs so descriptions don't lose structure
  if (raw?.$defs && typeof raw.$defs === "object") out.$defs = raw.$defs;
  if (raw?.definitions && typeof raw.definitions === "object")
    out.definitions = raw.definitions;

  // (Optional) pass through common combinators if present
  if (Array.isArray(raw?.allOf)) out.allOf = raw.allOf;
  if (Array.isArray(raw?.oneOf)) out.oneOf = raw.oneOf;
  if (Array.isArray(raw?.anyOf)) out.anyOf = raw.anyOf;

  return out;
}

// Strip api_key whether it's top-level or nested in req.$ref target
export function stripApiKeyEverywhere(schema: any) {
  if (!schema || typeof schema !== "object") return schema;

  // Case 1: top-level property
  if (schema.properties?.api_key) {
    delete schema.properties.api_key;
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((p: string) => p !== "api_key");
    }
  }

  // Case 2: nested under req.$ref → $defs
  if (schema?.properties?.req?.$ref) {
    const defName = String(schema.properties.req.$ref).split("/").pop();
    if (defName && schema.$defs?.[defName]) {
      const def = schema.$defs[defName];
      if (def.properties?.api_key) {
        delete def.properties.api_key;
      }
      if (Array.isArray(def.required)) {
        def.required = def.required.filter((p: string) => p !== "api_key");
      }
    }
  }

  return schema;
}
