export function parseValue(raw: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = JSON.parse(raw);
  return data.value;
}
