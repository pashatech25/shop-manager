// src/features/pdf/storage.js
import {supabase} from "../../lib/superbase.js";

/**
 * Uploads a Blob/File to Supabase Storage with upsert.
 * Defaults contentType to PDF; override for images, etc.
 */
export async function uploadPublicLike(bucket, path, fileOrBlob, contentType="application/pdf"){
  const {error} = await supabase
    .storage
    .from(bucket)
    .upload(path, fileOrBlob, {upsert:true, contentType});

  if(error) throw error;
  return {bucket, path};
}

/**
 * Returns a time-limited signed URL for a storage object.
 * expires: seconds (default 3600 = 1h)
 */
export async function signedUrl(bucket, path, expires=3600){
  const {data, error} = await supabase
    .storage
    .from(bucket)
    .createSignedUrl(path, expires);

  if(error) throw error;
  return data?.signedUrl;
}

/** Optional helper if you later want a public URL (no expiry) */
export function publicUrl(bucket, path){
  const {data} = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl;
}
