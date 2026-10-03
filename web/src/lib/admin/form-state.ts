/**
 * What a server action returns to its form. Error codes are i18n keys under
 * `admin.errors`; nothing user-entered is echoed back.
 */
export const FORM_ERRORS = [
  "generic",
  "notAllowed",
  "required",
  "nameRequired",
  "invalidChoice",
  "invalidDate",
  "invalidUrl",
  "invalidEmail",
  "invalidPhone",
  "invalidAmount",
  "priceRangeOrder",
  "sourceRequired",
  "observedAtRequired",
  "observedAtInFuture",
  "reportCountRequired",
  "invalidCoordinates",
  "coordinatesIncomplete",
  "invalidHours",
  "licenceIncomplete",
  "prcNumberRequired",
  "prcExpiryRequired",
  "prcExpiryPast",
  "prcNotVerified",
  "datesOrder",
  "duplicate",
  "cannotChangeOwnAccount",
  "inviteFailed",
  "timesOrder",
  "invalidSlotLength",
  "notAffiliated",
  "affiliationInUse",
  "slotFull",
  "slotUnavailable",
  "consentRequired",
  "patientRequired",
  "transitionNotAllowed",
  "noShowTooEarly",
  "rescheduleNotAllowed",
  "reasonRequired",
  "verificationRequested",
  "homeAddressRequired",
  "resourceNameRequired",
  "invalidQuantity",
  "fileRequired",
  "fileTooLarge",
  "fileTypeNotAllowed",
  "uploadFailed",
  "withdrawalNotAllowed",
  "fileRemovalFailed",
  "overrideNotConfirmed",
] as const;

export type FormError = (typeof FORM_ERRORS)[number];

export type FormState = { errors: FormError[] } | { saved: true } | null;

export function failed(...errors: FormError[]): FormState {
  return { errors: errors.length > 0 ? errors : ["generic"] };
}

export const SAVED: FormState = { saved: true };

const KNOWN = new Set<string>(FORM_ERRORS);

/** Maps Zod issue messages (which are our error codes) to a de-duplicated list. */
export function errorsFromIssues(issues: ReadonlyArray<{ message: string }>): FormState {
  const codes = issues.map((issue) => (KNOWN.has(issue.message) ? (issue.message as FormError) : "generic"));
  return failed(...new Set(codes));
}

/** Postgres unique violation, as PostgREST reports it. */
export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}
