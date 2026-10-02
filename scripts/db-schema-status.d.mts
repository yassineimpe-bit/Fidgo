export type SchemaObject = {
  kind: "table" | "column" | "index" | "constraint" | "trigger" | "function" | "constraintdef";
  name: string;
  table?: string;
  pattern?: string;
};

export type SchemaSource = { id: string; objects: SchemaObject[] };

export function inventory(text: string): SchemaObject[];
export function attribute(list: SchemaSource[]): SchemaSource[];
