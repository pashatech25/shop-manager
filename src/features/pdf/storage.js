// src/features/pdf/storage.js
import { supabase } from "../../lib/superbase.js";

/** Normalize "folder/file.pdf" (no leading slash) */
function cleanPath(p = "") {
  return String(p).replace(/^\/+/, "");
}

/** Upload a Blob/File to a bucket and overwrite if exists */
export async function uploadPublicLike(bucket, path, blob) {
  const key = cleanPath(path);
  const file = blob instanceof Blob
    ? new File([blob], key.split("/").pop() || "document.pdf", { type: "application/pdf" })
    : new File([new Blob([blob])], key.split("/").pop() || "document.pdf", { type: "application/pdf" });

  const { data, error } = await supabase
    .storage
    .from(bucket)
    .upload(key, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: "application/pdf",
    });

  if (error) {
    // Surface bucket-not-found and other details clearly
    throw new Error(`Storage upload failed: ${error.message || error.error_description || "unknown error"}`);
  }
  return data; // { path, ... }
}

/** Create a signed URL for the given path (seconds) */
export async function signedUrl(bucket, path, expiresIn = 3600) {
  const key = cleanPath(path);
  const { data, error } = await supabase
    .storage
    .from(bucket)
    .createSignedUrl(key, expiresIn);

  if (error) {
    throw new Error(`Signed URL failed: ${error.message || "unknown error"}`);
  }
  return data?.signedUrl;
}
