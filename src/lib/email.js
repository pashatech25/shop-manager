// src/lib/email.js
import { supabase } from "../lib/superbase.js"; // keep your existing import style

export async function sendEmailDoc({ to, subject, html, attachments }) {
  const { data, error } = await supabase.functions.invoke("email-doc", {
    body: { to, subject, html, attachments },
  });
  if (error) throw new Error(error.message || "Edge function error");
  if (!data?.ok) throw new Error(data?.error || "Email failed");
  return data;
}
