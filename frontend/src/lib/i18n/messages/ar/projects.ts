import type { en } from '../areas/projects';

/** Arabic for `areas/projects.ts` (Sean, 24 Oct: "Arabic and Swahili"). */
export const ar: Record<keyof typeof en, string> = {
  // app/projects/page.tsx
  'list.title': 'المشاريع',
  'list.subtitle': 'يحتفظ كلٌّ منها بهدفه، وبكل نسخة، وبالأساس الذي قُيّم عليه.',
  'list.newProject': 'مشروع جديد',
  'list.folders': 'المجلدات',
  'list.foldersWith': 'المجلدات: {name}',
  'list.closeFolders': 'إغلاق المجلدات',
  'list.loadFailed': 'تعذّر تحميل مشاريعك. لم يُفقد شيء. ({error})',
  'list.loadError': 'تعذّر تحميل المشاريع.',
  'list.retry': 'أعد المحاولة',
  'list.emptyFolder': 'لا شيء في {name} بعد. اسحب مشروعًا إلى هنا، أو استخدم زر المجلد في بطاقته.',
  'list.thisFolder': 'هذا المجلد',
  'list.showAll': 'عرض كل المشاريع',
  'list.emptyTitle': 'لا شيء هنا بعد',
  'list.emptyBody':
    'يأخذ المشروع هدفًا واحدًا إلى مُخرَج نهائي — يُصاغ، ويُتحقق منه مقابل ما طلبته، ويُحفظ بكل نسخه. قل ما تحتاج إليه في جملة، أو ابدأ بأحد هذه:',
  'list.inProgress': 'قيد التنفيذ',
  'list.finished': 'مكتملة',
  'list.untitled': 'مشروع بلا عنوان',
  'list.noObjective': 'لا يوجد هدف بعد',
  'list.paused': 'متوقف مؤقتًا',
  'list.pausedWhy': 'لم يتحقق الهدف؛ بانتظار مدخلات ناقصة',
  'list.delete': 'حذف',
  'list.keep': 'إبقاء',
  'list.deleteNamed': 'حذف {name}',
  'list.aProject': 'المشروع',
  'list.moveError': 'تعذّر نقل المشروع.',
  'list.deleteError': 'تعذّر حذف المشروع.',

  // lib/projects/example-goals.ts, as shown on the empty list
  'examples.memo.label': 'مذكرة توصية',
  'examples.memo.goal':
    'اكتب مذكرة من صفحة واحدة توصي بما إذا كان ينبغي لفريقنا المكوّن من 12 شخصًا الانتقال من Slack إلى Microsoft Teams. الميزانية 8,000 دولار سنويًا.',
  'examples.briefing.label': 'إحاطة قصيرة',
  'examples.briefing.goal':
    'اكتب إحاطة من صفحتين لمجلس إدارة حول المخاطر الرئيسية لاعتماد أدوات الذكاء الاصطناعي في شركة محاسبة تضم 200 شخص، مع خطوة أولى موصى بها.',
  'examples.plan.label': 'خطة بالأرقام',
  'examples.plan.goal':
    'ضع مسودة خطة مدتها 90 يومًا لخفض زمن الاستجابة في دعم العملاء من 24 ساعة إلى 8 ساعات لفريق من 6 موظفين، دون تعيينات جديدة.',

  // components/projects/folders-sidebar.tsx
  'folders.label': 'المجلدات',
  'folders.all': 'كل المشاريع',
  'folders.unfiled': 'غير مصنّفة',
  'folders.heading': 'المجلدات',
  'folders.new': 'مجلد جديد',
  'folders.newIn': 'مجلد جديد داخل {name}',
  'folders.newInside': 'مجلد جديد بالداخل',
  'folders.name': 'اسم المجلد',
  'folders.rename': 'إعادة التسمية',
  'folders.renameNamed': 'إعادة تسمية {name}',
  'folders.delete': 'حذف',
  'folders.deleteNamed': 'حذف {name}',
  'folders.confirmDelete':
    'حذف «{name}»؟ تنتقل مشاريعه إلى «غير مصنّفة» وتنتقل المجلدات التي بداخله إلى المستوى الأعلى. لن يُحذف أي مشروع.',
  'folders.deleteFolder': 'حذف المجلد',
  'folders.keep': 'إبقاء',
  'folders.emptyHint': 'أنشئ مجلدًا، ثم اسحب مشروعًا إليه أو استخدم زر المجلد في بطاقته.',
  'folders.saveError': 'لم يُحفظ ذلك.',
  'folders.deleteError': 'تعذّر حذف المجلد.',

  // components/projects/move-to-menu.tsx
  'move.button': 'نقل {name} إلى مجلد',
  'move.title': 'نقل إلى مجلد',
  'move.menu': 'نقل إلى',
  'move.none': 'لا توجد مجلدات بعد — أنشئ واحدًا في الشريط الجانبي.',

  // components/projects/use-in-project-menu.tsx
  'useIn.button': 'استخدام {name} في مشروع آخر',
  'useIn.title': 'الاستخدام في مشروع آخر',
  'useIn.dialog': 'الاستخدام في مشروع',
  'useIn.prompt': 'أي مشروع ينبغي أن يستعين بـ «{name}»؟ يرافق عمله المنجز وحقائقه أوامر ذلك المشروع.',
  'useIn.done': 'أصبح «{name}» يستعين بهذا المشروع.',
  'useIn.thatProject': 'ذلك المشروع',
  'useIn.thisProject': 'هذا المشروع',
  'useIn.already': 'ذلك المشروع يستخدم هذا المشروع بالفعل.',
  'useIn.full': 'ذلك المشروع يستخدم خمسة مشاريع أخرى بالفعل، وهو الحد الأقصى.',
  'useIn.failed': 'تعذّرت إضافته.',
  'card.more': 'مزيد من الخيارات لـ {name}',
  'card.useIn': 'استخدام في مشروع آخر…',
  'card.move': 'نقل إلى مجلد…',
  'card.delete': 'حذف…',
  'card.close': 'إغلاق',
  'card.back': 'رجوع',

  // components/projects/deleted-projects.tsx
  'trash.heading': 'المحذوفة مؤخرًا',
  'trash.explain':
    'تُحفظ المشاريع المحذوفة لمدة {days} يومًا كي يمكن التراجع عن الخطأ، ثم تُزال نهائيًا مع مُخرَجاتها ونسخها وتقييماتها. احذفها الآن إن كنت لا تريد الانتظار.',
  'trash.nothing': 'لا شيء محذوف.',
  'trash.due': 'مستحقة للإزالة',
  'trash.tomorrow': 'تُزال نهائيًا غدًا',
  'trash.inDays': 'تُزال نهائيًا خلال {days} يومًا',
  'trash.confirm': 'حذف نهائي؟ لا يمكن التراجع عن هذا.',
  'trash.deletePermanently': 'حذف نهائي',
  'trash.keep': 'إبقاء',
  'trash.restore': 'استعادة',
  'trash.deleteNow': 'حذف الآن',
  'trash.loadError': 'تعذّر تحميل المشاريع المحذوفة.',
  'trash.restoreError': 'تعذّرت استعادة المشروع.',
  'trash.deleteError': 'تعذّر حذف المشروع.',

  // components/projects/guest-banner.tsx
  'guest.title': 'أنت تعمل بصفة زائر',
  'guest.body':
    'مشاريعك محفوظة، ولكن في هذا المتصفح فقط. أنشئ حسابًا للوصول إليها من أي مكان — وكل ما أنشأته حتى الآن ينتقل معك.',
  'guest.createAccount': 'إنشاء حساب',
  'guest.email': 'البريد الإلكتروني',
  'guest.password': 'كلمة المرور',
  'guest.create': 'إنشاء',
  'guest.creating': 'جارٍ الإنشاء…',
  'guest.notNow': 'ليس الآن',
  'guest.created':
    'أُنشئ الحساب — تفقّد بريدك الإلكتروني لتأكيده. كل ما أنشأته حتى الآن مرتبط به بالفعل.',
  'guest.createError': 'تعذّر إنشاء الحساب.',
  'card.copy': "إنشاء نسخة",
  'list.copyNamed': "إنشاء نسخة من {name}",
  'list.copyFailed': "تعذّر إنشاء النسخة.",
  'list.copyFailedWhy': "تعذّر إنشاء النسخة: {message}",
  'list.copyMissing': "أُنشئت النسخة، لكن تعذّر نسخ هذه الملفات إليها: {files}. لا تزال في الأصل.",
};
