export interface Settings {
  order: string[];
}

export function normalize(settings: Settings): Settings {
  return { order: [...new Set(settings.order)] };
}

// One-time migration, to remove after the September release.
export function migrateLegacy(settings: Settings): Settings {
  return { order: settings.order.map((id) => (id === 'old' ? 'new' : id)) };
}
