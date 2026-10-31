import type { en } from '../areas/web';

/** Arabic for `areas/web.ts` (Sean, 24 Oct: "Arabic and Swahili"). */
export const ar: Record<keyof typeof en, string> = {
  'web.label': 'الوصول إلى الويب والمصادر',
  'web.title': 'مصادر الويب',
  'web.on': 'الوصول إلى الويب مفعّل',
  'web.off': 'الوصول إلى الويب متوقف',
  'web.saved': ' · المحفوظ: {count}',
  'web.switch': 'الوصول إلى الويب',
  'web.explain':
    '— عند تفعيله، يجوز لـ PromptMaster البحث في الويب العام لهذا المشروع، من هنا أو في وضع Go. يُحفظ كل بحث مصادرَ مع روابطها وتاريخها، وتستشهد بها المراحل بصيغة [S1]، [S2]، …، وكل بحث يكلّف قليلًا إضافيًا. إيقافه يقصر المشروع على ما تقدّمه أنت.',
  'web.form': 'البحث في الويب',
  'web.queryHint': 'ما الذي تبحث عنه، مثل: إيرادات Harbor Industrial Services لعام 2025',
  'web.queryLabel': 'ما الذي تبحث عنه في الويب',
  'web.searching': 'جارٍ البحث…',
  'web.search': 'ابحث في الويب',
  'web.list': 'المصادر المحفوظة',
  'web.retrieved': 'استُرجع في {date}',
  'web.byGo': ' بواسطة Go',
  'web.searched': ' · بحث عن «{query}»',
  'web.takeOut': 'إزالة',
  'web.none': 'لم تُحفظ أي مصادر بعد.',
  'web.cited': 'المصادر المستشهد بها',
  'web.citedLabel': 'مصادر الويب المحفوظة التي تستشهد بها هذه النسخة',
  'web.newSaved_one': 'حُفظ {count} مصدر جديد',
  'web.newSaved_other': 'عدد المصادر الجديدة المحفوظة: {count}',
  'web.alreadyOnRecord': '؛ {count} مسجّلة من قبل',
  'web.noResults': 'لم يُرجع البحث أي مصادر. لم يُحفظ شيء.',
  'web.failed': 'فشل البحث. لم يُحفظ شيء.',
  'web.saveError': 'لم يُحفظ ذلك.',
};
