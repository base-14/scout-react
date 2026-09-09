/**
 * A one-slot handoff from the tap tracker to the frustration tracker.
 *
 * Both listen for `click` on `document` in the capture phase and the tap
 * tracker is installed first, so by the time frustration detection runs the
 * `user_interaction` span for that same click has already been emitted. This
 * carries its identity across so a frustration span can point back at the
 * interaction it describes instead of being an uncorrelatable twin.
 *
 * A single element reference is retained at a time — the same shape the
 * frustration tracker's own `recent` buffer already holds.
 */
export interface RecordedInteraction {
  id: string;
  target: Element;
  description: string;
  targetType: string;
  /** `performance.now()` at emit. */
  at: number;
}
let last: RecordedInteraction | null = null;
export function recordInteraction(interaction: RecordedInteraction): void {
  last = interaction;
}
/** The interaction emitted for `target`, if it is recent enough to be the same gesture. */
export function lastInteractionFor(
  target: Element,
  withinMs: number,
): RecordedInteraction | null {
  if (!last || last.target !== target) return null;
  return performance.now() - last.at <= withinMs ? last : null;
}
export function resetInteractionRegistry(): void {
  last = null;
}
