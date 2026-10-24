import type { en } from '../areas/loader';

/** Chinese for `areas/loader.ts` (Sean, 24 Oct: "…and then Mandarin"). */
export const zh: Record<keyof typeof en, string> = {
  'proj.saving': '正在保存…',
  'proj.saved': '已保存',
  'proj.conflict': '已在别处更改',
  'proj.notSaved': '未保存',
  'proj.retryNow': '立即重试',
  'proj.titleLabel': '项目标题',
  'proj.backToProjects': '返回项目列表',
  'proj.projects': '项目',
  'proj.stale': '无法加载最新更改，因此此页面可能已过时。没有任何内容丢失。',
  'proj.reload': '重新加载',
  'proj.otherTab': '此项目已在另一个标签页中被更改。',
  'proj.reloadTheirs': '加载对方的版本',
  'proj.keepMine': '保留我的更改',
  'proj.noWorkflow': '无法加载此项目的工作流。',
  'proj.noWorkflowHint': '没有任何内容丢失——这是加载问题，并不是项目丢失。',
  'proj.retry': '重试',
  'proj.retrying': '正在重试…',
  'proj.noStages': '无法加载此项目的工作流，因此其阶段暂不可用。下方是其工作的最新版本。',
  'proj.nothingYet': '此项目尚未生成任何内容。',
  'proj.noHistory': '无法加载此项目的当前进度。',
  'proj.noHistoryHint': '其历史记录未能加载，因此暂时无法显示各阶段。没有任何内容丢失：你的工作和每个阶段的进度都已保存。',
};
