const PHONEISH = /^[+()\d.\s-]+$/;

export function phoneLookupVariants(input: unknown): [string | null, string | null, string | null] {
  if (typeof input !== "string") return [null, null, null];
  const value = input.trim();
  if (!value || value.length > 40 || !PHONEISH.test(value)) return [null, null, null];

  const digits = value.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return [null, null, null];

  const variants = new Set<string>([digits]);
  if (digits.startsWith("0033") && digits.length === 13) {
    variants.add(`0${digits.slice(4)}`);
    variants.add(`33${digits.slice(4)}`);
  } else if (digits.startsWith("33") && digits.length === 11) {
    variants.add(`0${digits.slice(2)}`);
    variants.add(`0033${digits.slice(2)}`);
  } else if (digits.startsWith("0") && digits.length === 10) {
    variants.add(`33${digits.slice(1)}`);
    variants.add(`0033${digits.slice(1)}`);
  }

  const list = [...variants].slice(0, 3);
  return [list[0] ?? null, list[1] ?? null, list[2] ?? null];
}
