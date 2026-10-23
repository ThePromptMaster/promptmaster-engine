/**
 * The interface's words in English: the source every other dictionary must
 * match key for key (`messages.test.ts`).
 *
 * Keys are `area.thing`, flat, so a missing translation is a type error
 * rather than a blank. `{name}` is filled in by `translate`; a key ending in
 * `_one` / `_other` is a plural pair, chosen by the count.
 *
 * Only words people read. Anything sent to the model (prompts, hints, stage
 * instructions) stays English in the code that sends it: the project's
 * "Writes in" language, not the interface, decides what the model writes.
 */
export const en = {
  // The account menu (components/shared/app-header.tsx)
  'header.account': 'Account',
  'header.guest': 'Guest',
  'header.signedIn': 'Signed in',
  'header.guestNote': 'Work stays in this browser',
  'header.colours': 'Colours',
  'header.language': 'Language',
  'header.languageNote': 'The words on the screen. What a project writes in is set on the project.',
  'header.guestWarning':
    "A guest can't sign back in. Signing out loses this browser's projects for good unless you create an account first.",
  'header.createAccount': 'Create an account',
  'header.signOut': 'Sign out',
  'header.signOutAnyway': 'Sign out anyway',
  'header.signingOut': 'Signing out…',

  // Colours (components/shared/colour-preferences.tsx)
  'colours.background': 'Background',
  'colours.accent': 'Accent',
  'colours.starting': 'Starting version (v1)',
  'colours.later': 'Later versions',
  'colours.reset': 'Reset to the defaults',
  'colours.keptHere': 'Kept in this browser only.',
  'colours.swatch.background': 'Background: {name}',
  'colours.swatch.accent': 'Accent: {name}',
  'colours.swatch.starting': 'Starting version: {name}',
  'colour.grey': 'Grey',
  'colour.pink': 'Pink',
  'colour.cream': 'Cream',
  'colour.mint': 'Mint',
  'colour.lavender': 'Lavender',
  'colour.slate': 'Slate blue',
  'colour.teal': 'Teal',
  'colour.plum': 'Plum',
  'colour.forest': 'Forest',
  'colour.rust': 'Rust',
  'colour.ink': 'Ink',
  'colour.blue': 'Blue',
  'colour.green': 'Green',
  'colour.amber': 'Amber',
  'colour.rose': 'Rose',
  'colour.calm': 'Calm',
  'colour.bright': 'Bright',
  'colour.mono': 'One colour',

  // The beta notice (components/shared/beta-notice.tsx)
  'beta.chip': 'Beta',
  'beta.show': 'Show the beta notice',
  'beta.title': 'This is an early beta',
  'beta.body':
    'PromptMaster is an early beta, so outputs require review before you act on them — production-critical reliance is not intended, and nothing here replaces your own professional judgement. Please do not enter sensitive information: no confidential client material, personal data, or credentials.',
  'beta.gotIt': 'Got it',
  'beta.feedback': 'Tell us how it went',
  'beta.hideFeedback': 'Hide feedback form',

  // The feedback form (components/shared/feedback-form.tsx)
  'feedback.title': 'Tell us how it went',
  'feedback.intro': 'Four short questions. Real usage is the only thing that tells us whether this works outside a demo.',
  'feedback.useCase': 'What were you trying to do?',
  'feedback.value': 'What was valuable?',
  'feedback.blockage': 'Where did you get confused or blocked?',
  'feedback.reuse': 'How likely are you to use it again?',
  'feedback.notLikely': 'Not likely',
  'feedback.veryLikely': 'Very likely',
  'feedback.send': 'Send feedback',
  'feedback.sending': 'Sending…',
  'feedback.notNow': 'Not now',
  'feedback.close': 'Close',
  'feedback.failed': 'Could not send that feedback.',
  'feedback.thanks': 'Thank you — that is genuinely useful.',
  'feedback.thanksBody': 'Beta feedback goes straight to the people building this, and it shapes what gets fixed next.',
  'feedback.signIn': 'Feedback needs a signed-in session — sign in or continue as a guest, then tell us how it went.',

  // Relative times (lib/i18n/format.ts)
  'time.justNow': 'just now',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
