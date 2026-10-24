import type { en } from '../areas/stop';

/** Chinese for `areas/stop.ts` (Sean, 24 Oct: "…and then Mandarin"). */
export const zh: Record<keyof typeof en, string> = {
  'stop.cleared': '可以继续了——请按“继续”。',
  'stop.movedOn': '项目已经越过了那个阶段——请按“继续”从这里接着进行。',
  'stop.waitingApproval': '正在等待你的批准：{action}。',
  'stop.windowClosed': '本轮已结束，以便更新受影响的工作。',
  'stop.plannedFor': '那一步是为{was}规划的；项目现在处于{now}。请按 Go 重新规划。',
  'stop.stageChanged': '规划那一步之后阶段发生了变化，因此未执行。请按 Go 重新规划。',
  'stop.declined': '你拒绝了“{action}”。',
  'stop.byYou': '已由你停止。',
  'stop.suggestedAgain': '阶段变化后再次建议。',
  'stop.beforeBudget': '在“{action}”之前停止：它需要 {n} 步，而只剩 {m} 步。',
  'stop.goError': 'Go 模式遇到错误。',
  'stop.finished': '项目已完成。',
  'stop.noObjective': '项目还没有目标。请先设定一个，然后按 Go。',
  'stop.stuck': '此阶段已被标记为受阻：{why}。解除该状态或跳过此阶段，Go 才能继续。',
  'stop.budgetUsed': '已用完本次运行额度中的全部 {n} 步。',
  'stop.failedInRow': '最近 {n} 步都失败了。停止运行，而不是盲目重试。',
  'stop.alternating': '在原地打转：“{a}”和“{b}”一直在此阶段轮流进行，但阶段没有推进。需要你给出方向。',
  'stop.repairedTooOften': '在原地打转：{stage}在本次运行中被修复了 {n} 次，而每个新版本又重新打开了工作。每次修复都已保存为独立版本；在 Go 继续之前，请查看最新版本。需要你给出方向。',
  'stop.noProgressNone': '在原地打转：“{action}”在同一阶段连续被选中 {n} 次，但都没有保存任何内容。每次的产出都在运行日志中。',
  'stop.noProgressSome': '在原地打转：“{action}”在同一阶段连续被选中 {n} 次，只有 {saved} 次保存了新版本。每次的产出都在运行日志中。',
  'stop.noChange': '最近 {n} 步没有让此阶段发生任何变化——没有新版本，没有记录决定，也没有满足任何要求。告诉我换一种做法，或者由你完成下一部分后按“继续”。',
  'stop.roundsIdle': '自从项目最后一次有新内容以来，Go 已运行了 {n} 轮，所以不再开始新的一轮：继续进入{stage}。仍未完成的内容会作为待办事项和局限性带到后面。',
  'stop.aDecision': '你的一个决定',
  'stop.resumeCheck': '继续运行 Go，再次检查目标',
};
