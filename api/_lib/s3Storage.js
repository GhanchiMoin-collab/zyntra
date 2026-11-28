// S3-compatible object storage for Zyntra Moments (Backblaze B2, Supabase Storage, Cloudflare R2, Tigris, MinIO, AWS S3…).
// Implements just enough AWS Signature V4 to:
//   * presign short-lived PUT (upload) and GET (playback) URLs,
//   * make signed server-side requests (HEAD, ranged GET, DELETE, LIST, PUT, CORS).
// It exposes the same small "bucket / file" surface the Moments API already uses for Google Cloud Storage,
// so the rest of the code does not care which one is behind it.
import { createHash, createHmac } from "node:crypto";

const sha256hex = (d) => createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
const enc = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => String(p).split("/").map(enc).join("/");
const amzDate = (ms) => new Date(ms).toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20130524T000000Z
const xmlDecode = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const xmlEnc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function signingKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac("AWS4" + secret, date), region), service), "aws4_request");
}
function canonicalQuery(q) {
  return Object.keys(q).map((k) => [enc(k), enc(q[k])]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
}

// Query-string presigned URL (used for browser uploads and playback). Exported for tests.
export function presignUrl({ method, protocol = "https", host, path, query = {}, headers = {}, accessKeyId, secretAccessKey, region, expires, nowMs, service = "s3" }) {
  const stamp = amzDate(nowMs), date = stamp.slice(0, 8), scope = `${date}/${region}/${service}/aws4_request`;
  const hdrs = { host };
  for (const [k, v] of Object.entries(headers)) hdrs[k.toLowerCase()] = String(v).trim();
  const names = Object.keys(hdrs).sort();
  const q = Object.assign({}, query, { "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${accessKeyId}/${scope}`, "X-Amz-Date": stamp, "X-Amz-Expires": String(expires), "X-Amz-SignedHeaders": names.join(";") });
  const cq = canonicalQuery(q);
  const canonical = [method, path, cq, names.map((n) => `${n}:${hdrs[n]}\n`).join(""), names.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
  const sts = ["AWS4-HMAC-SHA256", stamp, scope, sha256hex(canonical)].join("\n");
  const sig = createHmac("sha256", signingKey(secretAccessKey, date, region, service)).update(sts).digest("hex");
  return `${protocol}://${host}${path}?${cq}&X-Amz-Signature=${sig}`;
}

export function s3ConfigFromEnv(env) {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env || {};
  if (!(S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY)) return null;
  // region: explicit S3_REGION, else taken from a Backblaze endpoint (s3.<region>.backblazeb2.com), else "auto" (Cloudflare R2 style)
  let region = env.S3_REGION;
  if (!region) { const m = /^(?:https?:\/\/)?s3\.([a-z0-9-]+)\.backblazeb2\.com/i.exec(S3_ENDPOINT); region = m ? m[1] : "auto"; }
  const endpoint = /^https?:\/\//i.test(S3_ENDPOINT) ? S3_ENDPOINT : "https://" + S3_ENDPOINT;
  return { endpoint, bucket: S3_BUCKET, accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY, region, signContentLength: env.S3_SIGN_CONTENT_LENGTH !== "0" };
}

export function createS3Bucket(cfg, { fetchFn = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  const u = new URL(cfg.endpoint);
  const basePath = u.pathname.replace(/\/+$/, "");
  const pathFor = (key) => `${basePath}/${enc(cfg.bucket)}${key ? "/" + encPath(key) : ""}`;

  // signed server-side request (Authorization header)
  async function request(method, key, { query = {}, headers = {}, body } = {}) {
    const bodyBuf = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body);
    const stamp = amzDate(now()), date = stamp.slice(0, 8), scope = `${date}/${cfg.region}/s3/aws4_request`;
    const payloadHash = sha256hex(bodyBuf);
    const hdrs = { host: u.host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
    for (const [k, v] of Object.entries(headers)) hdrs[k.toLowerCase()] = String(v).trim();
    const names = Object.keys(hdrs).sort(), path = pathFor(key), cq = canonicalQuery(query);
    const canonical = [method, path, cq, names.map((n) => `${n}:${hdrs[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
    const sts = ["AWS4-HMAC-SHA256", stamp, scope, sha256hex(canonical)].join("\n");
    const sig = createHmac("sha256", signingKey(cfg.secretAccessKey, date, cfg.region, "s3")).update(sts).digest("hex");
    const send = {}; for (const n of names) if (n !== "host") send[n] = hdrs[n];
    send.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}`;
    return fetchFn(`${u.protocol}//${u.host}${path}${cq ? "?" + cq : ""}`, { method, headers: send, body: bodyBuf.length ? bodyBuf : undefined });
  }
  const fail = async (r, what) => { let t = ""; try { t = (await r.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200); } catch (e) {} const e = new Error(`${what}: HTTP ${r.status}${t ? " — " + t : ""}`); e.code = r.status; return e; };
  const presign = (method, key, { expiresSec, headers } = {}) => presignUrl({ method, protocol: u.protocol.replace(":", ""), host: u.host, path: pathFor(key), headers, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region, expires: Math.max(1, Math.min(604800, Math.floor(expiresSec))), nowMs: now() });

  const file = (key) => ({
    async exists() { const r = await request("HEAD", key); if (r.status === 200) return [true]; if (r.status === 404) return [false]; throw await fail(r, "HEAD"); },
    async getMetadata() { const r = await request("HEAD", key); if (r.status !== 200) throw await fail(r, "HEAD"); return [{ size: r.headers.get("content-length"), contentType: r.headers.get("content-type") }]; },
    async download({ start, end }) { const r = await request("GET", key, { headers: { range: `bytes=${start}-${end}` } }); if (r.status !== 200 && r.status !== 206) throw await fail(r, "GET"); return [Buffer.from(await r.arrayBuffer())]; },
    async delete() { const r = await request("DELETE", key); if (![200, 204, 404].includes(r.status)) throw await fail(r, "DELETE"); },
    async save(data, opts = {}) { const r = await request("PUT", key, { body: data, headers: { "content-type": opts.contentType || "application/octet-stream" } }); if (r.status !== 200) throw await fail(r, "PUT"); },
    async getSignedUrl({ expires }) { return [presign("GET", key, { expiresSec: ((expires || now() + 300000) - now()) / 1000 })]; },
    // browser upload: a presigned PUT. Content-Type (and the exact size, if enabled) are part of the signature.
    async presignPut({ contentType, size, expiresMs = 900000, signLength }) {
      const headers = { "content-type": contentType };
      if ((signLength === undefined ? cfg.signContentLength : signLength) && size > 0) headers["content-length"] = String(size);
      return { url: presign("PUT", key, { expiresSec: expiresMs / 1000, headers }), headers: { "Content-Type": contentType } };
    }
  });

  return {
    kind: "s3", name: cfg.bucket, endpointHost: u.host, region: cfg.region, signsContentLength: cfg.signContentLength, fetch: (...a) => fetchFn(...a), file,
    async exists() { const r = await request("HEAD", ""); if (r.status === 200) return [true]; if (r.status === 404) return [false]; throw await fail(r, "HEAD bucket"); },
    // CORS rules, if the provider exposes them through the S3 API (some don't → corsUnknown)
    async getMetadata() {
      const r = await request("GET", "", { query: { cors: "" } });
      if (r.status === 404) return [{ cors: [], location: cfg.region }];
      if (r.status === 501 || r.status === 400 || r.status === 403 || r.status === 405) return [{ cors: null, corsUnknown: true, location: cfg.region }];
      if (r.status !== 200) throw await fail(r, "GET cors");
      const xml = await r.text(); const rules = [];
      for (const m of xml.matchAll(/<CORSRule>([\s\S]*?)<\/CORSRule>/g)) {
        const all = (tag) => [...m[1].matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((x) => xmlDecode(x[1]));
        rules.push({ origin: all("AllowedOrigin"), method: all("AllowedMethod") });
      }
      return [{ cors: rules, location: cfg.region }];
    },
    async setCorsConfiguration(rules) {
      const body = `<CORSConfiguration>${rules.map((c) => `<CORSRule>${c.origin.map((o) => `<AllowedOrigin>${xmlEnc(o)}</AllowedOrigin>`).join("")}${c.method.map((m) => `<AllowedMethod>${m}</AllowedMethod>`).join("")}<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>${c.maxAgeSeconds || 3600}</MaxAgeSeconds></CORSRule>`).join("")}</CORSConfiguration>`;
      const md5 = createHash("md5").update(body).digest("base64");
      const r = await request("PUT", "", { query: { cors: "" }, body, headers: { "content-type": "application/xml", "content-md5": md5 } });
      if (r.status !== 200 && r.status !== 204) throw await fail(r, "PUT cors");
    },
    async deleteFiles({ prefix }) {
      let token = null;
      for (let i = 0; i < 200; i++) {
        const q = { "list-type": "2", prefix }; if (token) q["continuation-token"] = token;
        const r = await request("GET", "", { query: q });
        if (r.status !== 200) throw await fail(r, "LIST");
        const xml = await r.text();
        for (const m of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) await file(xmlDecode(m[1])).delete();
        const more = /<IsTruncated>true<\/IsTruncated>/.test(xml); const nt = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
        if (!more || !nt) break; token = xmlDecode(nt[1]);
      }
    }
  };
}
