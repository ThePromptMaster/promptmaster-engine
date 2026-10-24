import type { en } from '../areas/header';

/** Chinese for `areas/header.ts` (Sean, 24 Oct: "…and then Mandarin"). */
export const zh: Record<keyof typeof en, string> = {
  'stageHead.complete': '已完成',
  'stageHead.stuck': '受阻',
  'stageHead.skipped': '已跳过',
  'stageHead.stale': '待重新检查',
  'stageHead.leftOpen': '未完成即离开',
  'stageHead.reopened': '已重新打开',
  'stageHead.draftApproval': '草稿已完成 · 待你批准',
  'stageHead.approval': '待你批准',
  'stageHead.approvalWhy': 'PromptMaster 已核实了它能核实的内容。在你于下方清单中给出批准之前，此阶段保持开放。',
  'stageHead.position': '第 {index} 阶段，共 {total} 个',
  'stageHead.optional': '可选',
  'stageHead.skippedWhy': '已跳过——{reason}',
  'stageHead.hideGuidance': '隐藏指引',
  'stageHead.pickMode': '如何思考这个阶段——选择一种模式',
  'stageHead.suited': '适合此阶段',
  'stageHead.inUse': '使用中',
};
