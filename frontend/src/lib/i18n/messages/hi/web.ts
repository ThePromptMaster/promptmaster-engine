import type { en } from '../areas/web';

/** Hindi for `areas/web.ts` (Sean, 24 Oct: "the next language should be Hindi"). */
export const hi: Record<keyof typeof en, string> = {
  'web.label': 'वेब एक्सेस और स्रोत',
  'web.title': 'वेब स्रोत',
  'web.on': 'वेब एक्सेस चालू',
  'web.off': 'वेब एक्सेस बंद',
  'web.saved': ' · {count} सहेजे गए',
  'web.switch': 'वेब एक्सेस',
  'web.explain':
    '— चालू होने पर PromptMaster इस प्रोजेक्ट के लिए सार्वजनिक वेब पर खोज सकता है, यहाँ से या Go में। हर खोज उनके लिंक और तारीख के साथ स्रोतों के रूप में सहेजी जाती है, चरण उन्हें [S1], [S2], … के रूप में उद्धृत करते हैं, और हर खोज की थोड़ी अतिरिक्त लागत होती है। बंद रखने पर प्रोजेक्ट केवल उसी तक सीमित रहता है जो आप देते हैं।',
  'web.form': 'वेब पर खोजें',
  'web.queryHint': 'क्या खोजना है, जैसे Harbor Industrial Services revenue 2025',
  'web.queryLabel': 'वेब पर क्या खोजना है',
  'web.searching': 'खोज रहा है…',
  'web.search': 'वेब पर खोजें',
  'web.list': 'सहेजे गए स्रोत',
  'web.retrieved': '{date} को प्राप्त किया गया',
  'web.byGo': ' Go द्वारा',
  'web.searched': ' · “{query}” खोजा गया',
  'web.takeOut': 'हटाएँ',
  'web.none': 'अभी तक कोई स्रोत सहेजा नहीं गया।',
  'web.newSaved_one': '{count} नया स्रोत सहेजा गया',
  'web.newSaved_other': '{count} नए स्रोत सहेजे गए',
  'web.alreadyOnRecord': '; {count} पहले से रिकॉर्ड में',
  'web.noResults': 'खोज में कोई स्रोत नहीं मिला। कुछ भी सहेजा नहीं गया।',
  'web.failed': 'खोज विफल रही। कुछ भी सहेजा नहीं गया।',
  'web.saveError': 'यह सहेजा नहीं गया।',
};
