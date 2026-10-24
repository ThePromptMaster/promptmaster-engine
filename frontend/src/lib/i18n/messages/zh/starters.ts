import type { en } from '../areas/starters';

/** Chinese for `areas/starters.ts`. */
export const zh: Record<keyof typeof en, string> = {
  'starter.produce': '这个项目的{stage}阶段应该产出什么？',
  'starter.openRows_one': '这 {count} 行待定内容中，哪一行最重要？为什么？',
  'starter.openRows_other': '这 {count} 行待定内容中，哪些最重要？为什么？',
  'starter.summarise': '总结一下这里还有哪些需要我决定。',
  'starter.tableWrong': '这张表有缺漏或错误吗？',
  'starter.outlineCovers': '这份大纲是否涵盖了目标承诺的全部内容？',
  'starter.outlineWeakest': '哪一节最薄弱或最不合适？',
  'starter.chapterWork': '哪一章最需要修改？为什么？',
  'starter.chaptersContradict': '各章之间有没有相互矛盾的地方？',
  'starter.weakest': '这份草稿最薄弱的部分是什么？',
  'starter.objective': '这仍然符合目标吗？',
  'starter.stillNeeds': '这个阶段还需要我提供什么？（尚未完成：{criterion}）',
  'starter.ready': '可以进入{stage}了吗？',
};
