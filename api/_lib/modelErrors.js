// Pure helpers for deciding what to do when an AI-model call fails. Kept in their own
// module (no side effects at import, no closure variables) so they can be unit-tested
// directly — see tests/unit/model-errors.test.mjs.

// True when the provider says THIS MODEL can't be used (doesn't exist, no access for this
// account, or was decommissioned) — as opposed to a problem with the request itself.
export function isModelUnavailableError(result) {
  const err = (result && result.data && result.data.error) || {};
  const text = `${err.code || ""} ${err.message || ""}`;
  return /model_not_found|model_decommissioned|does not exist or you do not have access|decommissioned/i.test(text);
}

// Move on to the next model only for problems another model could fix: a rate limit
// (429), a provider/server error (>= 500, including our own synthetic 504 timeout), or
// "this model isn't available to the account". A bad request (400/413 — wrong image
// format, too large, malformed) is NOT retryable: the same input would fail the same way.
export function isRetryableFailure(result) {
  return result.status === 429 || result.status >= 500 || isModelUnavailableError(result);
}

// Why a failed attempt failed — used for the per-model counters on the admin dashboard.
export function failureReason(result) {
  if (result.status === 429) return "rateLimited";
  if (isModelUnavailableError(result)) return "unavailable";
  if (result.status >= 500) return "serverError";
  return "other";
}

// The message a person sees. Never the provider's raw text for problems we understand.
export function userFacingError(result, log = console.error) {
  const rawMessage = result.data?.error?.message || '';

  // Image problems (unsupported format, too big, too many) are the user's to fix, so
  // say so plainly — and they are never retried on other models.
  if ((result.status === 400 || result.status === 413) && /image|base64|media type|payload/i.test(rawMessage) && !/does not exist or you do not have access/i.test(rawMessage)) {
    log('Image rejected by provider:', result.status, rawMessage.slice(0, 200));
    return "I couldn't process that image. Please try a PNG or JPG (a smaller one if it's very large), and send no more than 3 images at a time.";
  }

  if (/too large|reduce your message size/i.test(rawMessage)) {
    log('Groq payload-too-large error:', result.status, rawMessage);
    return "That message (or this conversation) is too long for me to process in one go. Try shortening it, pasting less at once, or starting a new chat.";
  }

  if (isModelUnavailableError(result)) {
    log('Every model in the chain was unavailable:', result.status, rawMessage);
    return "Zyntra AI couldn't reach its AI model just now. Please try again in a few minutes.";
  }

  if (result.status === 429 || /rate limit|tokens per minute/i.test(rawMessage)) {
    log('Rate limited:', result.status, rawMessage);
    return "Zyntra AI is handling a lot of requests right now — please wait a few seconds and try again.";
  }

  return rawMessage || 'The AI service returned an error. Please try again.';
}
