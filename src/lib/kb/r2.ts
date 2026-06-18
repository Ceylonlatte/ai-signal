import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../../config.js";

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

// True only when every R2 setting is present, so the image pipeline can skip
// uploads (and keep remote src) instead of throwing in a half-configured env.
export function r2Configured(): boolean {
  return Boolean(
    config.R2_ACCOUNT_ID && config.R2_ACCESS_KEY_ID &&
    config.R2_SECRET_ACCESS_KEY && config.R2_BUCKET && config.R2_PUBLIC_BASE_URL,
  );
}

export function publicUrl(key: string): string {
  return `${config.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<string> {
  await s3().send(new PutObjectCommand({
    Bucket: config.R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return publicUrl(key);
}
