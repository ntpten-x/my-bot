import { normalizeProvinceName } from "./pipeline/province";

export function parseProvinceList(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of String(value || "").split(/[,\n|]/)) {
    const name = normalizeProvinceName(part.trim());
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// A post with no detected province stays in the area: most buyers never write one.
export function inServiceArea(province: string | null | undefined, area: string[]) {
  if (!area.length || !province) return true;
  return area.includes(province);
}
