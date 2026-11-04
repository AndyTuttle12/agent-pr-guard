import { loadConfig } from './config.js';

export function parse(raw: string): unknown {
  const data = JSON.parse(raw) as { value: unknown };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: any = loadConfig(raw);
  return config.strict ? data.value : null;
}
