export function parse(raw: string): unknown {
  const text = raw.trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = JSON.parse(raw);
  return text === '' ? null : data.value;
}
