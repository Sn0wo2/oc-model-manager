export function splitList(value?: string) {
  const items = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items?.length ? items : undefined;
}

export function parsePositiveInteger(value: string, option: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new TypeError(`${option} must be a positive integer`);
  return number;
}
