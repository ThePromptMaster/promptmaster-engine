import type { en } from '../areas/brief';

/** Hindi for `areas/brief.ts` (Sean, 24 Oct: "the next language should be Hindi"). */
export const hi: Record<keyof typeof en, string> = {
  'brief.field.objective': 'उद्देश्य',
  'brief.field.objectiveHint': 'आप क्या तैयार करना चाहते हैं, और क्यों?',
  'brief.field.audience': 'पाठक',
  'brief.field.audienceHint': 'इसे कौन पढ़ेगा, और वे पहले से क्या जानते हैं?',
  'brief.field.constraints': 'शर्तें',
  'brief.field.constraintsHint': 'इसे क्या करना है, किससे बचना है, या किस दायरे में रहना है?',
  'brief.field.output_format': 'आउटपुट का प्रारूप',
  'brief.field.output_formatHint': 'लंबाई, संरचना, लहजा।',
  'brief.field.context': 'प्रोजेक्ट का संदर्भ — तथ्य, आँकड़े, पृष्ठभूमि',
  'brief.field.contextHint': 'स्रोत सामग्री जिसे हर चरण उद्धृत कर सकता है। वैकल्पिक।',
  'brief.setupLabel': 'प्रोजेक्ट सेटअप',
  'brief.setupExplain':
    'यह इस प्रोजेक्ट के हर चरण में लागू होता है, सिर्फ़ इसी में नहीं। हर चरण आपके उद्देश्य को ध्यान में रखकर लिखा जाता है: नीचे PromptMaster जो ड्राफ़्ट करता है, वह इसे और स्पष्ट करता है, इसकी जगह कभी नहीं लेता।',
  'brief.required': 'आवश्यक',
  'brief.requiredWaiting': 'आवश्यक — यह चरण इसकी प्रतीक्षा कर रहा है',
  'brief.title': 'प्रोजेक्ट ब्रीफ़',
  'brief.noObjective': 'अभी कोई उद्देश्य नहीं',
  'brief.for': '· {audience} के लिए',
  'brief.explain':
    'हर चरण इसी को ध्यान में रखकर लिखा जाता है — आपके शब्द, किसी चरण का दोहराया गया रूप नहीं। इसे यहाँ बदलें और अगला ड्राफ़्ट उसी के अनुसार होगा।',
  'brief.colour': 'प्रोजेक्ट का रंग',
  'brief.colourMine': 'मेरा',
  'brief.colourNamed': 'प्रोजेक्ट का रंग: {name}',
  'brief.colourHint': 'यहाँ और प्रोजेक्ट सूची में आपके प्रोजेक्ट एक नज़र में अलग पहचाने जाते हैं।',
  'brief.thinking': 'सोचने का स्तर',
  'brief.thinkingStandard': 'मानक',
  'brief.thinkingDeep': 'गहन — जवाब देने से पहले ज़्यादा देर तक सोचता है',
  'brief.thinkingHint': 'गहन में हर जवाब पर ज़्यादा समय और ज़्यादा लागत लगती है। इसे तब आज़माएँ जब जवाब सतही लगें या कोई शर्त छूट जाए।',
  'brief.writesIn': 'लिखने की भाषा',
  'brief.writesInHint': 'ड्राफ़्ट, जाँचें, साइड चैट और Go इसी भाषा में लिखते हैं। जो काम पहले लिखा जा चुका है, वह वैसा ही रहता है।',
  'brief.model': 'मॉडल',
  'brief.modelHint': 'अब से हर ड्राफ़्ट, जाँच और चैट के लिए इस्तेमाल होगा। पुराने संस्करण उसी मॉडल के साथ रहते हैं जिसने उन्हें लिखा था।',
};
