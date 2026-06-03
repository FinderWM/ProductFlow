export type DynamicFieldScalar = string | number | boolean | null;

export interface DynamicFieldDraft {
  key: string;
  value: string;
}

export function parseDynamicScalar(value: string): DynamicFieldScalar {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (trimmed && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return value;
}

export function dynamicFieldsToRecord(fields: readonly DynamicFieldDraft[]): Record<string, DynamicFieldScalar> {
  return fields.reduce<Record<string, DynamicFieldScalar>>((result, field) => {
    const key = field.key.trim();
    if (!key) {
      return result;
    }
    result[key] = parseDynamicScalar(field.value);
    return result;
  }, {});
}
