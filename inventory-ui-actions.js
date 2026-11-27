/**
 * Which data-action values are inventory screens but not handleInventoryClick.
 * (Smart understanding must open a modal via the global click router.)
 */
export const INVENTORY_GLOBAL_ACTIONS = new Set(["inv-ai-settings", "inv-ai-test-key"]);

export function inventoryClickRoutedGlobally(action) {
  return INVENTORY_GLOBAL_ACTIONS.has(action);
}