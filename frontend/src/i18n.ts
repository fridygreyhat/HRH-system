import { Lang } from './types';

/** Interface text for the provider work-log screens. Kiswahili should be reviewed by a native speaker. */
const DICT = {
  myWorkLogs: { en: 'My work logs', sw: 'Kumbukumbu zangu za kazi' },
  startLog: { en: 'Start a work log', sw: 'Anza kumbukumbu ya kazi' },
  start: { en: 'Start', sw: 'Anza' },
  payPeriod: { en: 'Pay period', sw: 'Kipindi cha malipo' },
  noOpenPeriods: { en: 'No open pay periods are available to start.', sw: 'Hakuna kipindi cha malipo kilicho wazi.' },
  noLogs: { en: 'You have no work logs yet.', sw: 'Bado huna kumbukumbu za kazi.' },
  open: { en: 'Open', sw: 'Fungua' },
  back: { en: 'Back to my work logs', sw: 'Rudi kwenye kumbukumbu zangu' },
  header: { en: 'Form details', sw: 'Taarifa za fomu' },
  region: { en: 'Region', sw: 'Mkoa' },
  district: { en: 'District', sw: 'Wilaya' },
  ward: { en: 'Ward', sw: 'Kata' },
  facility: { en: 'Facility', sw: 'Kituo' },
  community: { en: 'Community area', sw: 'Eneo la jamii' },
  occupation: { en: 'Occupation', sw: 'Kada' },
  occupationOther: { en: 'Specify occupation', sw: 'Taja kada' },
  section: { en: 'Section', sw: 'Idara' },
  periodComment: { en: 'Comments for the period', sw: 'Maoni ya kipindi' },
  saveDetails: { en: 'Save details', sw: 'Hifadhi taarifa' },
  days: { en: 'Days', sw: 'Siku' },
  daysWorked: { en: 'Days worked', sw: 'Siku za kazi' },
  hours: { en: 'Hours', sw: 'Masaa' },
  hoursWorked: { en: 'Hours worked', sw: 'Masaa uliyofanya kazi' },
  startTime: { en: 'Start time', sw: 'Muda wa kuanza' },
  endTime: { en: 'End time', sw: 'Muda wa kumaliza' },
  hoursComputed: { en: 'Hours are calculated by the server from start and end time.', sw: 'Masaa yanakokotolewa na mfumo kutoka muda wa kuanza na kumaliza.' },
  evidence: { en: 'Evidence of work (required)', sw: 'Ushahidi wa kazi (lazima)' },
  evidenceWarning: {
    en: 'Do not enter patient names, ID numbers, phone numbers or identifiable case details.',
    sw: 'Usiandike majina ya wagonjwa, namba za utambulisho, namba za simu au taarifa zinazomtambulisha mteja.',
  },
  comment: { en: 'Comment (optional)', sw: 'Maoni (si lazima)' },
  saveDay: { en: 'Save day', sw: 'Hifadhi siku' },
  deleteDay: { en: 'Delete this day', sw: 'Futa siku hii' },
  confirmDelete: { en: 'Delete the entry for this day?', sw: 'Futa taarifa za siku hii?' },
  cancel: { en: 'Cancel', sw: 'Ghairi' },
  close: { en: 'Close', sw: 'Funga' },
  yes: { en: 'Yes', sw: 'Ndiyo' },
  no: { en: 'No', sw: 'Hapana' },
  notSet: { en: 'Not set', sw: 'Haijajazwa' },
  captureGps: { en: 'Capture my location', sw: 'Chukua mahali nilipo' },
  gpsCaptured: { en: 'Location captured', sw: 'Mahali pamechukuliwa' },
  gpsFailed: { en: 'Location could not be captured. You can still save; the reviewer will see it.', sw: 'Mahali hapakupatikana. Bado unaweza kuhifadhi; mhakiki ataona.' },
  gpsRequired: {
    en: 'Your location is needed to submit. Allow location (GPS) for this site, then submit again.',
    sw: 'Mahali ulipo panahitajika ili kuwasilisha. Ruhusu GPS kwa tovuti hii, kisha wasilisha tena.',
  },
  gpsRequiredHint: {
    en: 'Your location is recorded when you submit. It is only used for review and never rejects your work automatically.',
    sw: 'Mahali ulipo panarekodiwa unapowasilisha. Panatumika kwa mapitio tu na hakukatai kazi yako moja kwa moja.',
  },
  estimateTitle: { en: 'Estimated payout', sw: 'Makadirio ya malipo' },
  estimateNote: {
    en: 'Estimate from approved rates — not yet approved. The amount paid is set when your claim is approved.',
    sw: 'Makadirio kwa viwango vilivyoidhinishwa — bado hayajaidhinishwa. Kiasi halisi huwekwa dai lako linapoidhinishwa.',
  },
  estimateNone: { en: 'No approved rates apply to this work log yet.', sw: 'Bado hakuna viwango vilivyoidhinishwa kwa kumbukumbu hii.' },
  gpsHint: { en: 'Location is only used for review and never rejects your work automatically.', sw: 'Mahali panatumika kwa mapitio tu na hakukatai kazi yako moja kwa moja.' },
  calendar: { en: 'Days in this period', sw: 'Siku za kipindi hiki' },
  calendarHint: { en: 'Tap a day to record or change your work. Future days are locked.', sw: 'Gusa siku kurekodi au kubadilisha kazi yako. Siku zijazo zimefungwa.' },
  recorded: { en: 'Recorded', sw: 'Imerekodiwa' },
  flagged: { en: 'Needs correction', sw: 'Inahitaji marekebisho' },
  totals: { en: 'Totals (calculated by the server)', sw: 'Jumla (imekokotolewa na mfumo)' },
  total: { en: 'Total', sw: 'Jumla' },
  submitTitle: { en: 'Submit for verification', sw: 'Wasilisha kwa uhakiki' },
  attest: { en: 'I confirm these entries are true and complete', sw: 'Ninathibitisha kuwa taarifa hizi ni za kweli na kamili' },
  submit: { en: 'Submit', sw: 'Wasilisha' },
  submitting: { en: 'Submitting…', sw: 'Inawasilisha…' },
  saving: { en: 'Saving…', sw: 'Inahifadhi…' },
  saved: { en: 'Saved', sw: 'Imehifadhiwa' },
  locked: { en: 'This work log is locked while it is being reviewed.', sw: 'Kumbukumbu hii imefungwa wakati inapitiwa.' },
  returnedTitle: { en: 'Returned for correction', sw: 'Imerudishwa kwa marekebisho' },
  reviewerSays: { en: 'Reviewer comment', sw: 'Maoni ya mhakiki' },
  otpTitle: { en: 'Confirm your verified work log', sw: 'Thibitisha kumbukumbu yako iliyohakikiwa' },
  otpIntro: {
    en: 'Your supervisor verified this work log. Check the entries and totals, then enter the code sent to your phone by SMS.',
    sw: 'Msimamizi wako amehakiki kumbukumbu hii. Kagua taarifa na jumla, kisha weka namba uliyotumiwa kwa SMS.',
  },
  otpCode: { en: 'Confirmation code', sw: 'Namba ya uthibitisho' },
  confirm: { en: 'Confirm', sw: 'Thibitisha' },
  resend: { en: 'Send a new code', sw: 'Tuma namba mpya' },
  decline: { en: 'Something is wrong – decline', sw: 'Kuna kosa – kataa' },
  declineReason: { en: 'What is wrong? (required)', sw: 'Kuna kosa gani? (lazima)' },
  devCode: { en: 'Development code (shown only in test mode)', sw: 'Namba ya majaribio (inaonekana kwenye majaribio tu)' },
  language: { en: 'Language', sw: 'Lugha' },
  status: { en: 'Status', sw: 'Hali' },
  print: { en: 'Print view', sw: 'Chapisha' },
  editingDay: { en: 'Entry for', sw: 'Taarifa za' },
  history: { en: 'History', sw: 'Historia' },
  outsidePeriod: { en: 'Outside period', sw: 'Nje ya kipindi' },
  future: { en: 'Future', sw: 'Siku ijayo' },
  loading: { en: 'Loading…', sw: 'Inapakia…' },
  dailyEntries: { en: 'Daily entries', sw: 'Taarifa za kila siku' },
  reload: { en: 'Reload', sw: 'Pakia upya' },
  approvedNotPaid: { en: 'Approved work is not a payment. Payment status is shown separately.', sw: 'Kazi iliyoidhinishwa si malipo. Hali ya malipo inaonyeshwa peke yake.' },
  cancelLog: { en: 'Cancel this work log', sw: 'Ghairi kumbukumbu hii' },
} as const;

export type MessageKey = keyof typeof DICT;

export function translate(lang: Lang, key: MessageKey): string {
  return DICT[key][lang];
}

/** Primary label in the chosen language with the other language as a secondary line (reviewers need English). */
export function bilingual(lang: Lang, en: string, sw: string | null | undefined): { primary: string; secondary: string | null } {
  if (!sw) return { primary: en, secondary: null };
  return lang === 'sw' ? { primary: sw, secondary: en } : { primary: en, secondary: sw };
}
