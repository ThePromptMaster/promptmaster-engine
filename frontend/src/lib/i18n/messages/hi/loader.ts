import type { en } from '../areas/loader';

/** Hindi for `areas/loader.ts` (Sean, 24 Oct: "the next language should be Hindi"). */
export const hi: Record<keyof typeof en, string> = {
  'proj.saving': 'सहेजा जा रहा है…',
  'proj.saved': 'सहेजा गया',
  'proj.conflict': 'कहीं और बदला गया',
  'proj.notSaved': 'सहेजा नहीं गया',
  'proj.retryNow': 'अभी फिर कोशिश करें',
  'proj.titleLabel': 'प्रोजेक्ट का शीर्षक',
  'proj.backToProjects': 'प्रोजेक्ट्स पर वापस',
  'proj.projects': 'प्रोजेक्ट्स',
  'proj.stale': 'नवीनतम बदलाव लोड नहीं हो सके, इसलिए यह पेज पुराना हो सकता है। कुछ भी खोया नहीं है।',
  'proj.reload': 'फिर से लोड करें',
  'proj.otherTab': 'यह प्रोजेक्ट किसी दूसरे टैब में बदला गया था।',
  'proj.reloadTheirs': 'उनके बदलाव लोड करें',
  'proj.keepMine': 'मेरे बदलाव रखें',
  'proj.noWorkflow': 'इस प्रोजेक्ट का वर्कफ़्लो लोड नहीं हो सका।',
  'proj.noWorkflowHint': 'कुछ भी खोया नहीं है — यह लोड होने की समस्या है, प्रोजेक्ट गायब नहीं है।',
  'proj.retry': 'फिर कोशिश करें',
  'proj.retrying': 'फिर कोशिश हो रही है…',
  'proj.noStages': 'इस प्रोजेक्ट का वर्कफ़्लो लोड नहीं हो सका, इसलिए इसके चरण उपलब्ध नहीं हैं। इसके काम का नवीनतम संस्करण नीचे है।',
  'proj.nothingYet': 'इस प्रोजेक्ट में अभी तक कुछ भी तैयार नहीं किया गया है।',
  'proj.noHistory': 'यह प्रोजेक्ट कहाँ तक पहुँचा है, यह लोड नहीं हो सका।',
  'proj.noHistoryHint': 'इसका इतिहास लोड नहीं हुआ, इसलिए इसके चरण अभी दिखाए नहीं जा सकते। कुछ भी खोया नहीं है: आपका काम और हर चरण की प्रगति सहेजी गई है।',
};
