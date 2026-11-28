// Chooses where Moments stores videos and pictures:
//  * if the S3_* environment variables are set → any S3-compatible storage (Backblaze B2, Supabase, R2…) — no Google billing needed
//  * otherwise → the Firebase / Google Cloud Storage bucket (needs the Blaze plan)
import { getAdminBucket } from "./firebaseAdmin.js";
import { s3ConfigFromEnv, createS3Bucket } from "./s3Storage.js";

export function getMomentsBucket(env = process.env) {
  const cfg = s3ConfigFromEnv(env);
  return cfg ? createS3Bucket(cfg) : getAdminBucket();
}
