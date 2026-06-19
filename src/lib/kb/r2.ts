import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
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

// Delete every object under a key prefix (e.g. `kb/<itemId>/`). Best-effort GC
// when an item leaves the knowledge base, so unfavoriting doesn't orphan its
// transferred images in the bucket. Returns how many objects were deleted.
export async function deletePrefix(prefix: string): Promise<number> {
  const client = s3();
  let deleted = 0;
  let token: string | undefined;
  do {
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: config.R2_BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    const objects = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => Boolean(k))
      .map((Key) => ({ Key }));
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({
        Bucket: config.R2_BUCKET,
        Delete: { Objects: objects, Quiet: true },
      }));
      deleted += objects.length;
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}
