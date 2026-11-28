/** Inline inventory update UI state (top-of-screen box + confirm panel). */

export const INV_QUICK_PLACEHOLDER =
  "e.g. we're out of 3D printer filament, it lives in the office";

export function emptyQuickUpdateState() {
  return { phase: "idle", text: "", draftText: "", error: "", proposal: null };
}

/** Proposal target while confirming an inline update (not the modal). */
export function inlineUpdateConfirm(state) {
  return state?.phase === "confirm" && state.proposal ? state : null;
}