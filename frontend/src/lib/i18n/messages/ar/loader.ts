import type { en } from '../areas/loader';

/** Arabic for `areas/loader.ts` (Sean, 24 Oct: "Arabic and Swahili"). */
export const ar: Record<keyof typeof en, string> = {
  'proj.saving': 'جارٍ الحفظ…',
  'proj.saved': 'تم الحفظ',
  'proj.conflict': 'تغيّر في مكان آخر',
  'proj.notSaved': 'لم يُحفظ',
  'proj.retryNow': 'أعد المحاولة الآن',
  'proj.titleLabel': 'عنوان المشروع',
  'proj.backToProjects': 'العودة إلى المشاريع',
  'proj.projects': 'المشاريع',
  'proj.stale': 'تعذّر تحميل أحدث التغييرات، لذا قد تكون هذه الصفحة غير محدّثة. لم يُفقد شيء.',
  'proj.reload': 'إعادة التحميل',
  'proj.otherTab': 'تغيّر هذا المشروع في علامة تبويب أخرى.',
  'proj.reloadTheirs': 'تحميل تغييراتها',
  'proj.keepMine': 'الاحتفاظ بتغييراتي',
  'proj.noWorkflow': 'تعذّر تحميل سير عمل هذا المشروع.',
  'proj.noWorkflowHint': 'لم يُفقد شيء — هذه مشكلة في التحميل، وليس المشروع مفقودًا.',
  'proj.retry': 'أعد المحاولة',
  'proj.retrying': 'جارٍ إعادة المحاولة…',
  'proj.noStages': 'تعذّر تحميل سير عمل هذا المشروع، لذا مراحله غير متاحة. أحدث نسخة من عمله معروضة أدناه.',
  'proj.nothingYet': 'لم يُنشأ أي شيء في هذا المشروع بعد.',
  'proj.noHistory': 'تعذّر تحميل موقف هذا المشروع الحالي.',
  'proj.noHistoryHint': 'لم يُحمَّل سجلّه، لذا لا يمكن عرض مراحله بعد. لم يُفقد شيء: عملك وتقدّم كل مرحلة محفوظان.',
};
