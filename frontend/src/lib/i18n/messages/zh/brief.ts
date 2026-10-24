import type { en } from '../areas/brief';

/** Chinese for `areas/brief.ts` (Sean, 24 Oct: "…and then Mandarin"). */
export const zh: Record<keyof typeof en, string> = {
  'brief.field.objective': '目标',
  'brief.field.objectiveHint': '你想产出什么？为什么？',
  'brief.field.audience': '受众',
  'brief.field.audienceHint': '谁会阅读？他们已经知道些什么？',
  'brief.field.constraints': '约束条件',
  'brief.field.constraintsHint': '它必须做到什么、避免什么，或限定在什么范围内？',
  'brief.field.output_format': '输出格式',
  'brief.field.output_formatHint': '篇幅、结构、语气。',
  'brief.field.context': '项目背景——事实、数据、背景信息',
  'brief.field.contextHint': '每个阶段都可以引用的原始材料。可选。',
  'brief.setupLabel': '项目设置',
  'brief.setupExplain':
    '会带入此项目的每个阶段，而不只是这一个。你的目标是每个阶段写作的依据：PromptMaster 在下方起草的内容只会让它更明确，绝不会取代它。',
  'brief.required': '必填',
  'brief.requiredWaiting': '必填——此阶段正在等待它',
  'brief.title': '项目简介',
  'brief.noObjective': '尚无目标',
  'brief.for': '· 面向{audience}',
  'brief.explain':
    '每个阶段都依据它来写——依据的是你的原话，而不是任何阶段对它的复述。在这里修改，下一份草稿就会随之调整。',
  'brief.colour': '项目颜色',
  'brief.colourMine': '我的',
  'brief.colourNamed': '项目颜色：{name}',
  'brief.colourHint': '让你一眼就能区分各个项目，在这里和项目列表中都适用。',
  'brief.thinking': '思考',
  'brief.thinkingStandard': '标准',
  'brief.thinkingDeep': '深度——回答前推理更久',
  'brief.thinkingHint': '深度模式耗时更长，每次回答的费用也更高。当回答显得浅显或遗漏了某项约束时可以试试。',
  'brief.writesIn': '写作语言',
  'brief.writesInHint': '草稿、检查、侧边对话和 Go 都使用这种语言写作。已写好的内容保持不变。',
  'brief.model': '模型',
  'brief.modelHint': '从现在起用于每一次起草、检查和对话。较早的版本保留撰写它们的模型。',
};
