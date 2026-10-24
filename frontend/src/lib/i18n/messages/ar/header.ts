import type { en } from '../areas/header';

/** Arabic for `areas/header.ts` (Sean, 24 Oct: "Arabic and Swahili"). */
export const ar: Record<keyof typeof en, string> = {
  'stageHead.complete': 'مكتملة',
  'stageHead.stuck': 'متعثرة',
  'stageHead.skipped': 'متخطاة',
  'stageHead.stale': 'بانتظار إعادة التحقق',
  'stageHead.leftOpen': 'تُركت مفتوحة',
  'stageHead.reopened': 'أُعيد فتحها',
  'stageHead.draftApproval': 'المسودة مكتملة · بانتظار موافقتك',
  'stageHead.approval': 'بانتظار موافقتك',
  'stageHead.approvalWhy': 'تحقق PromptMaster مما يستطيع التحقق منه. تبقى هذه المرحلة مفتوحة حتى تمنح موافقتك في قائمة التحقق أدناه.',
  'stageHead.position': 'المرحلة {index} من {total}',
  'stageHead.optional': 'اختيارية',
  'stageHead.skippedWhy': 'متخطاة — {reason}',
  'stageHead.hideGuidance': 'إخفاء الإرشادات',
  'stageHead.pickMode': 'كيف تتناول هذه المرحلة — اختر وضعًا',
  'stageHead.suited': 'مناسب لهذه المرحلة',
  'stageHead.inUse': 'قيد الاستخدام',
};
