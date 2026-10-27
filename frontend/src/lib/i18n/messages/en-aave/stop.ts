import type { en } from '../areas/stop';

/** African American English for `areas/stop.ts` (Sean, 26 Oct). */
export const aave: Record<keyof typeof en, string> = {
  "stop.cleared": "You good to keep going — press Resume.",
  "stop.movedOn": "The project done moved past that stage — press Resume to keep going from here.",
  "stop.waitingApproval": "Waiting on your approval: {action}.",
  "stop.windowClosed": "Window closed so the work it touched can get updated.",
  "stop.plannedFor": "That move was planned for {was}; the project on {now} now. Press Go to plan again.",
  "stop.stageChanged": "The stage changed after that move got planned, so it ain't get done. Press Go to plan again.",
  "stop.declined": "You said no to \"{action}\".",
  "stop.byYou": "You stopped it.",
  "stop.suggestedAgain": "Suggested again after the stage changed.",
  "stop.beforeBudget": "Stopped before \"{action}\": it need {n} steps and it's only {m} left.",
  "stop.goError": "Go mode ran into an error.",
  "stop.finished": "The project finished.",
  "stop.noObjective": "The project ain't got no objective yet. Set one, then press Go.",
  "stop.stuck": "This stage marked stuck: {why}. Clear that, or skip it, so Go can keep going.",
  "stop.budgetUsed": "Used all {n} steps this run had.",
  "stop.failedInRow": "The last {n} steps failed. Stopping instead of trying again blind.",
  "stop.alternating": "Going round in circles: \"{a}\" and \"{b}\" been taking turns on this stage and it ain't moving on. It need you to say which way.",
  "stop.repairedTooOften": "Going round in circles: {stage} got repaired {n} times this run, and every new version opened work back up. Every repair saved as its own version; look at the latest one before Go keep going. It need you to say which way.",
  "stop.noProgressNone": "Going round in circles: \"{action}\" got picked {n} times in a row for the same stage, and ain't none of them save nothing. What each one made is in the run log.",
  "stop.noProgressSome": "Going round in circles: \"{action}\" got picked {n} times in a row for the same stage, and only {saved} of them saved a new version. What each one made is in the run log.",
  "stop.noChange": "The last {n} moves ain't change nothing on this stage — no new version, no decision recorded, no requirement met. Tell me what to do different, or do the next part yourself and press Resume.",
  "stop.roundsIdle": "Go done ran {n} rounds since anything new came into the project, so it ain't starting another one: moving on to {stage}. What's still open go forward as open items and limits.",
  "stop.aDecision": "a decision from you",
  "stop.resumeCheck": "resume Go so it check the objective again",
};
