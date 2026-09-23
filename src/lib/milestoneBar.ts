/**
 * The milestone bar on the customer's tracking page: Booked → Received →
 * Departed → Arrived → Delivered, or the FCL version with stuffing and gate-in.
 *
 * ---------------------------------------------------------------------------
 * A milestone is reached when the job's stage has reached it, not only when its
 * own step was ticked: a job ticked straight to "arrived" has departed, even
 * if nobody ticked the departure. The date shown is the step's own, where it
 * has one — the bar says when, not just whether.
 * ---------------------------------------------------------------------------
 */

export interface Milestone {
  stage: string;
  label: string;
  /** Reached: this stage or one after it is the job's stage. */
  done: boolean;
  /** The one the job is at now. */
  current: boolean;
  /** When its step was ticked, if it was. */
  at: string | null;
}

export function milestoneBar(
  stages: string[],
  label: (stage: string) => string,
  steps: Array<{ stage?: string | null; done_at: string | null }>,
  current: string
): Milestone[] {
  const at = stages.indexOf(current);
  return stages.map((stage, i) => {
    const ticks = steps
      .filter((s) => s.stage === stage && s.done_at)
      .map((s) => s.done_at!)
      .sort();
    return {
      stage,
      label: label(stage),
      done: at >= 0 && i <= at,
      current: i === at,
      at: ticks[0] ?? null,
    };
  });
}
