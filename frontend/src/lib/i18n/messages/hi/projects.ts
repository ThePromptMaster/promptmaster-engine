import type { en } from '../areas/projects';

/** Hindi for `areas/projects.ts` (Sean, 24 Oct: "the next language should be Hindi"). */
export const hi: Record<keyof typeof en, string> = {
  // app/projects/page.tsx
  'list.title': 'प्रोजेक्ट',
  'list.subtitle': 'हर प्रोजेक्ट अपना उद्देश्य, हर संस्करण और जिस आधार पर उसे परखा गया, सब सहेजकर रखता है।',
  'list.newProject': 'नया प्रोजेक्ट',
  'list.folders': 'फ़ोल्डर',
  'list.foldersWith': 'फ़ोल्डर: {name}',
  'list.closeFolders': 'फ़ोल्डर बंद करें',
  'list.loadFailed': 'आपके प्रोजेक्ट लोड नहीं हो सके। कुछ भी खोया नहीं है। ({error})',
  'list.loadError': 'प्रोजेक्ट लोड नहीं हो सके।',
  'list.retry': 'फिर से कोशिश करें',
  'list.emptyFolder': '{name} में अभी कुछ नहीं है। कोई प्रोजेक्ट यहाँ खींचकर लाएँ, या उसके कार्ड पर फ़ोल्डर बटन का उपयोग करें।',
  'list.thisFolder': 'इस फ़ोल्डर',
  'list.showAll': 'सभी प्रोजेक्ट दिखाएँ',
  'list.emptyTitle': 'यहाँ अभी कुछ नहीं है',
  'list.emptyBody':
    'एक प्रोजेक्ट एक लक्ष्य को तैयार डिलीवरेबल तक ले जाता है — ड्राफ़्ट किया हुआ, आपकी माँग के अनुसार जाँचा हुआ, और हर संस्करण के साथ सहेजा हुआ। एक वाक्य में बताइए कि आपको क्या चाहिए, या इनमें से किसी एक से शुरू करें:',
  'list.inProgress': 'जारी',
  'list.finished': 'पूरे हुए',
  'list.untitled': 'बिना शीर्षक का प्रोजेक्ट',
  'list.noObjective': 'अभी कोई उद्देश्य नहीं',
  'list.paused': 'रुका हुआ',
  'list.pausedWhy': 'उद्देश्य पूरा नहीं हुआ है; छूटे हुए इनपुट की प्रतीक्षा है',
  'list.delete': 'हटाएँ',
  'list.keep': 'रखें',
  'list.deleteNamed': '{name} हटाएँ',
  'list.aProject': 'प्रोजेक्ट',
  'list.moveError': 'प्रोजेक्ट को स्थानांतरित नहीं किया जा सका।',
  'list.deleteError': 'प्रोजेक्ट हटाया नहीं जा सका।',

  // lib/projects/example-goals.ts, as shown on the empty list
  'examples.memo.label': 'एक सिफ़ारिश मेमो',
  'examples.memo.goal':
    'एक पेज का मेमो लिखें जिसमें सिफ़ारिश हो कि हमारी 12 लोगों की टीम को Slack से Microsoft Teams पर जाना चाहिए या नहीं। बजट $8,000 प्रति वर्ष है।',
  'examples.briefing.label': 'एक छोटी ब्रीफ़िंग',
  'examples.briefing.goal':
    '200 लोगों की एक अकाउंटिंग फ़र्म में AI टूल अपनाने के मुख्य जोखिमों पर बोर्ड के लिए दो पेज की ब्रीफ़िंग लिखें, साथ में पहला सुझाया गया कदम भी।',
  'examples.plan.label': 'आँकड़ों के साथ एक योजना',
  'examples.plan.goal':
    '6 एजेंटों की टीम के लिए, बिना नई भर्ती के, ग्राहक सहायता का जवाब देने का समय 24 घंटे से घटाकर 8 घंटे करने की 90-दिन की योजना का ड्राफ़्ट बनाएँ।',

  // components/projects/folders-sidebar.tsx
  'folders.label': 'फ़ोल्डर',
  'folders.all': 'सभी प्रोजेक्ट',
  'folders.unfiled': 'बिना फ़ोल्डर',
  'folders.heading': 'फ़ोल्डर',
  'folders.new': 'नया फ़ोल्डर',
  'folders.newIn': '{name} में नया फ़ोल्डर',
  'folders.newInside': 'अंदर नया फ़ोल्डर',
  'folders.name': 'फ़ोल्डर का नाम',
  'folders.rename': 'नाम बदलें',
  'folders.renameNamed': '{name} का नाम बदलें',
  'folders.delete': 'हटाएँ',
  'folders.deleteNamed': '{name} हटाएँ',
  'folders.confirmDelete':
    '“{name}” हटाएँ? इसके प्रोजेक्ट “बिना फ़ोल्डर” में चले जाएँगे और इसके अंदर के फ़ोल्डर सबसे ऊपरी स्तर पर आ जाएँगे। कोई प्रोजेक्ट नहीं हटाया जाएगा।',
  'folders.deleteFolder': 'फ़ोल्डर हटाएँ',
  'folders.keep': 'रखें',
  'folders.emptyHint': 'एक फ़ोल्डर बनाएँ, फिर किसी प्रोजेक्ट को उस पर खींचें या उसके कार्ड पर फ़ोल्डर बटन का उपयोग करें।',
  'folders.saveError': 'यह सहेजा नहीं गया।',
  'folders.deleteError': 'फ़ोल्डर हटाया नहीं जा सका।',

  // components/projects/move-to-menu.tsx
  'move.button': '{name} को किसी फ़ोल्डर में ले जाएँ',
  'move.title': 'किसी फ़ोल्डर में ले जाएँ',
  'move.menu': 'यहाँ ले जाएँ',
  'move.none': 'अभी कोई फ़ोल्डर नहीं — साइडबार में एक बनाएँ।',

  // components/projects/use-in-project-menu.tsx
  'useIn.button': '{name} को किसी दूसरे प्रोजेक्ट में उपयोग करें',
  'useIn.title': 'किसी दूसरे प्रोजेक्ट में उपयोग करें',
  'useIn.dialog': 'किसी प्रोजेक्ट में उपयोग करें',
  'useIn.prompt': 'किस प्रोजेक्ट को “{name}” का सहारा लेना चाहिए? इसका पूरा हुआ काम और तथ्य उस प्रोजेक्ट के प्रॉम्प्ट के साथ जाएँगे।',
  'useIn.done': '“{name}” अब इस प्रोजेक्ट का सहारा लेता है।',
  'useIn.thatProject': 'वह प्रोजेक्ट',
  'useIn.thisProject': 'यह प्रोजेक्ट',
  'useIn.already': 'वह प्रोजेक्ट पहले से इसका उपयोग करता है।',
  'useIn.full': 'वह प्रोजेक्ट पहले से पाँच दूसरे प्रोजेक्ट का उपयोग करता है, जो अधिकतम सीमा है।',
  'useIn.failed': 'इसे जोड़ा नहीं जा सका।',
  'card.more': '{name} के लिए और विकल्प',
  'card.useIn': 'किसी दूसरे प्रोजेक्ट में उपयोग करें…',
  'card.move': 'किसी फ़ोल्डर में ले जाएँ…',
  'card.delete': 'हटाएँ…',
  'card.close': 'बंद करें',
  'card.back': 'वापस',

  // components/projects/deleted-projects.tsx
  'trash.heading': 'हाल ही में हटाए गए',
  'trash.explain':
    'हटाए गए प्रोजेक्ट {days} दिनों तक रखे जाते हैं ताकि गलती सुधारी जा सके, फिर वे अपने आर्टिफ़ैक्ट, संस्करणों और मूल्यांकनों के साथ स्थायी रूप से हटा दिए जाते हैं। अगर आप प्रतीक्षा नहीं करना चाहते, तो अभी हटा दें।',
  'trash.nothing': 'कुछ भी हटाया नहीं गया।',
  'trash.due': 'हटाए जाने वाले हैं',
  'trash.tomorrow': 'कल स्थायी रूप से हटा दिया जाएगा',
  'trash.inDays': '{days} दिनों में स्थायी रूप से हटा दिया जाएगा',
  'trash.confirm': 'स्थायी रूप से हटाएँ? इसे वापस नहीं किया जा सकता।',
  'trash.deletePermanently': 'स्थायी रूप से हटाएँ',
  'trash.keep': 'रखें',
  'trash.restore': 'वापस लाएँ',
  'trash.deleteNow': 'अभी हटाएँ',
  'trash.loadError': 'हटाए गए प्रोजेक्ट लोड नहीं हो सके।',
  'trash.restoreError': 'प्रोजेक्ट वापस नहीं लाया जा सका।',
  'trash.deleteError': 'प्रोजेक्ट हटाया नहीं जा सका।',

  // components/projects/guest-banner.tsx
  'guest.title': 'आप अतिथि के रूप में काम कर रहे हैं',
  'guest.body':
    'आपके प्रोजेक्ट सहेजे गए हैं, पर केवल इसी ब्राउज़र में। कहीं से भी उन तक पहुँचने के लिए एक खाता बनाएँ — अब तक आपने जो कुछ भी बनाया है, वह सब आपके साथ आएगा।',
  'guest.createAccount': 'खाता बनाएँ',
  'guest.email': 'ईमेल',
  'guest.password': 'पासवर्ड',
  'guest.create': 'बनाएँ',
  'guest.creating': 'बनाया जा रहा है…',
  'guest.notNow': 'अभी नहीं',
  'guest.created':
    'खाता बन गया — इसकी पुष्टि करने के लिए अपना ईमेल देखें। अब तक आपने जो कुछ भी बनाया है, वह पहले से इससे जुड़ा है।',
  'guest.createError': 'खाता नहीं बनाया जा सका।',
};
