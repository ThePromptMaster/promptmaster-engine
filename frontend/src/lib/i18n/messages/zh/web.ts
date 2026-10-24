import type { en } from '../areas/web';

/** Chinese for `areas/web.ts` (Sean, 24 Oct: "…and then Mandarin"). */
export const zh: Record<keyof typeof en, string> = {
  'web.label': '联网访问和来源',
  'web.title': '网络来源',
  'web.on': '联网访问已开启',
  'web.off': '联网访问已关闭',
  'web.saved': ' · 已保存 {count} 个',
  'web.switch': '联网访问',
  'web.explain':
    '——开启后，PromptMaster 可以在此处或在 Go 中为此项目搜索公开网络。每次搜索都会连同链接和日期保存为来源，各阶段以 [S1]、[S2]……的形式引用它们，每次搜索都会产生少量额外费用。关闭时，项目只使用你提供的内容。',
  'web.form': '搜索网络',
  'web.queryHint': '要查找的内容，例如 Harbor Industrial Services 2025 年营收',
  'web.queryLabel': '要在网络上搜索的内容',
  'web.searching': '正在搜索…',
  'web.search': '搜索网络',
  'web.list': '已保存的来源',
  'web.retrieved': '获取于 {date}',
  'web.byGo': '，由 Go 获取',
  'web.searched': ' · 搜索了“{query}”',
  'web.takeOut': '移除',
  'web.none': '尚未保存任何来源。',
  'web.newSaved_one': '已保存 {count} 个新来源',
  'web.newSaved_other': '已保存 {count} 个新来源',
  'web.alreadyOnRecord': '；{count} 个已有记录',
  'web.noResults': '搜索未返回任何来源。未保存任何内容。',
  'web.failed': '搜索失败。未保存任何内容。',
  'web.saveError': '未能保存。',
};
