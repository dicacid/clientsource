export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function toJsonValue(value: unknown): JsonValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("A saved result must contain JSON data.");
  return JSON.parse(encoded) as JsonValue;
}
