import type { en } from '../areas/header';

/** Hindi for `areas/header.ts` (Sean, 24 Oct: "the next language should be Hindi"). */
export const hi: Record<keyof typeof en, string> = {
  'stageHead.complete': 'पूर्ण',
  'stageHead.stuck': 'अटका हुआ',
  'stageHead.skipped': 'छोड़ा गया',
  'stageHead.stale': 'पुनर्जाँच की प्रतीक्षा',
  'stageHead.leftOpen': 'खुला छोड़ा गया',
  'stageHead.reopened': 'फिर से खोला गया',
  'stageHead.draftApproval': 'ड्राफ़्ट पूरा · आपकी स्वीकृति बाकी',
  'stageHead.approval': 'आपकी स्वीकृति बाकी',
  'stageHead.approvalWhy': 'PromptMaster ने जो जाँच सकता था, जाँच लिया है। यह चरण तब तक खुला रहेगा जब तक आप नीचे दी गई चेकलिस्ट में स्वीकृति नहीं देते।',
  'stageHead.position': 'चरण {index} / {total}',
  'stageHead.optional': 'वैकल्पिक',
  'stageHead.skippedWhy': 'छोड़ा गया — {reason}',
  'stageHead.hideGuidance': 'मार्गदर्शन छिपाएँ',
  'stageHead.pickMode': 'इस चरण के बारे में कैसे सोचें — एक मोड चुनें',
  'stageHead.suited': 'इस चरण के लिए उपयुक्त',
  'stageHead.inUse': 'उपयोग में',
};
