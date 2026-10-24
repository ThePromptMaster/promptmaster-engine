import type { en } from '../areas/brief';

/** Arabic for `areas/brief.ts` (Sean, 24 Oct: "Arabic and Swahili"). */
export const ar: Record<keyof typeof en, string> = {
  'brief.field.objective': 'الهدف',
  'brief.field.objectiveHint': 'ما الذي تحاول إنتاجه، ولماذا؟',
  'brief.field.audience': 'الجمهور',
  'brief.field.audienceHint': 'من سيقرأ هذا، وما الذي يعرفه مسبقًا؟',
  'brief.field.constraints': 'القيود',
  'brief.field.constraintsHint': 'ما الذي يجب أن يفعله أو يتجنبه أو يلتزم بحدوده؟',
  'brief.field.output_format': 'صيغة المخرجات',
  'brief.field.output_formatHint': 'الطول، والبنية، والأسلوب.',
  'brief.field.context': 'سياق المشروع — حقائق وأرقام وخلفية',
  'brief.field.contextHint': 'مادة مرجعية يجوز لكل مرحلة الاقتباس منها. اختياري.',
  'brief.setupLabel': 'إعداد المشروع',
  'brief.setupExplain':
    'يُنقل إلى كل مراحل هذا المشروع، لا إلى هذه المرحلة وحدها. هدفك هو ما تُكتب كل مرحلة على أساسه: ما يصوغه PromptMaster أدناه يُحكمه ولا يحلّ محله أبدًا.',
  'brief.required': 'مطلوب',
  'brief.requiredWaiting': 'مطلوب — هذه المرحلة بانتظاره',
  'brief.title': 'موجز المشروع',
  'brief.noObjective': 'لا يوجد هدف بعد',
  'brief.for': '· لـ {audience}',
  'brief.explain':
    'كل مرحلة تُكتب على أساس هذا — بكلماتك أنت، لا بإعادة صياغة أي مرحلة لها. غيّره هنا وستتبعه المسودة التالية.',
  'brief.colour': 'لون المشروع',
  'brief.colourMine': 'لوني',
  'brief.colourNamed': 'لون المشروع: {name}',
  'brief.colourHint': 'يميّز مشاريعك بعضها عن بعض بنظرة واحدة، هنا وفي قائمة المشاريع.',
  'brief.thinking': 'التفكير',
  'brief.thinkingStandard': 'عادي',
  'brief.thinkingDeep': 'عميق — يفكّر مدة أطول قبل الإجابة',
  'brief.thinkingHint': 'التفكير العميق يستغرق وقتًا أطول ويكلّف أكثر لكل إجابة. جرّبه حين تبدو الإجابات سطحية أو تُغفل قيدًا.',
  'brief.writesIn': 'لغة الكتابة',
  'brief.writesInHint': 'تُكتب المسودات والفحوص والمحادثة الجانبية وGo بهذه اللغة. ما كُتب من قبل يبقى كما هو.',
  'brief.model': 'النموذج',
  'brief.modelHint': 'يُستخدم لكل مسودة وفحص ومحادثة من الآن فصاعدًا. تحتفظ النسخ السابقة بالنموذج الذي كتبها.',
};
