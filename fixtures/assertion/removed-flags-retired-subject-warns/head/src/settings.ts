export interface Settings {
  order: string[];
}

export function normalize(settings: Settings): Settings {
  return { order: [...new Set(settings.order)] };
}
