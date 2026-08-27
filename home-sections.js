/** Home accordion open/closed state. Session only — ticks must not reset it. */

export const HOME_SECTIONS_KEY = "tab.home-sections.v1";
export const HOME_SECTION_IDS = ["income", "cards", "pending", "exceptions", "weeklies", "planned"];

export function defaultHomeSectionState() {
  return Object.fromEntries(HOME_SECTION_IDS.map((id) => [id, true]));
}

export function readHomeSectionState(storage) {
  const defaults = defaultHomeSectionState();
  if (!storage?.getItem) return defaults;
  try {
    const saved = JSON.parse(storage.getItem(HOME_SECTIONS_KEY));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
    const next = { ...defaults };
    for (const id of HOME_SECTION_IDS) {
      if (typeof saved[id] === "boolean") next[id] = saved[id];
    }
    return next;
  } catch {
    return defaults;
  }
}

export function writeHomeSectionOpen(storage, id, open) {
  const next = readHomeSectionState(storage);
  if (!HOME_SECTION_IDS.includes(id) || !storage?.setItem) return next;
  next[id] = Boolean(open);
  storage.setItem(HOME_SECTIONS_KEY, JSON.stringify(next));
  return next;
}
