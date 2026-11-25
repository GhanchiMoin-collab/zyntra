// Zyntra Moments — the single serverless function for the whole feature.
// All logic lives in api/_lib/momentsApi.js (files under _lib are not
// counted as Vercel functions; the Hobby plan allows 12 in total).
import { createMomentsHandler } from "./_lib/momentsApi.js";
export default createMomentsHandler();
