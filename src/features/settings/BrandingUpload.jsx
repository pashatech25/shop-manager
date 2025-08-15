import {useEffect, useMemo, useState} from 'react';
import {supabase} from '../../lib/superbase.js'; // keep your existing client import
import {useTenant} from '../../context/TenantContext.jsx';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export default function BrandingUpload({
  logoPath,                  // string path stored in DB (e.g. "<tenantId>/logo-...png")
  onChange,                  // function(path: string, url?: string)
  label = 'Logo (PNG/SVG/JPG)',
  disabled = false,
}) {
  const {tenantId} = useTenant();
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Resolve a usable URL for preview (public -> getPublicUrl, private -> signed URL)
  const resolveUrl = async (path) => {
    if (!path) { setPreviewUrl(''); return; }

    // Try public first
    const pub = supabase.storage.from('branding').getPublicUrl(path);
    if (pub?.data?.publicUrl) {
      setPreviewUrl(pub.data.publicUrl);
      return;
    }

    // Fallback to signed URL (private buckets)
    const { data, error } = await supabase
      .storage
      .from('branding')
      .createSignedUrl(path, 60 * 60); // 1 hour
    if (!error && data?.signedUrl) {
      setPreviewUrl(data.signedUrl);
    } else {
      setPreviewUrl('');
    }
  };

  useEffect(() => { resolveUrl(logoPath); }, [logoPath]);

  const pick = async (e) => {
    try {
      setErrorMsg('');
      const file = e.target.files?.[0];
      if (!file) return;
      if (!tenantId) { setErrorMsg('No tenant context.'); return; }

      // Basic guards
      if (!/^image\/(png|jpeg|jpg|svg\+xml)$/.test(file.type) && !file.name.toLowerCase().endsWith('.svg')) {
        setErrorMsg('Please select a PNG, JPG, or SVG file.');
        return;
      }
      if (file.size > MAX_BYTES) {
        setErrorMsg(`File is too large. Max ${(MAX_BYTES/1024/1024).toFixed(0)}MB.`);
        return;
      }

      setBusy(true);

      // Normalize filename a little
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
      const path = `${tenantId}/logo-${Date.now()}-${cleanName}`;

      // Upload under the tenant folder; upsert true so re-upload replaces
      const { error } = await supabase
        .storage
        .from('branding')
        .upload(path, file, { upsert: true, cacheControl: '3600' });

      if (error) throw error;

      // Resolve a URL for immediate preview
      await resolveUrl(path);

      // Bubble path + resolved URL up to the form
      onChange?.(path, previewUrl);
    } catch (err) {
      console.error(err);
      setErrorMsg(err?.message || 'Upload failed.');
    } finally {
      setBusy(false);
      // reset the input so selecting the same file again re-triggers change
      e.target.value = '';
    }
  };

  const remove = async () => {
    if (!logoPath) return;
    if (!confirm('Remove current logo?')) return;

    try {
      setBusy(true);
      await supabase.storage.from('branding').remove([logoPath]).catch(() => {});
      setPreviewUrl('');
      onChange?.('', '');
    } catch (err) {
      console.error(err);
      setErrorMsg(err?.message || 'Failed to remove logo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="group">
      <label>{label}</label>

      <input
        type="file"
        accept="image/*,.svg"
        onChange={pick}
        disabled={busy || disabled}
      />

      {errorMsg ? (
        <div className="tiny" style={{ color: '#c00', marginTop: 6 }}>{errorMsg}</div>
      ) : null}

      {logoPath ? (
        <div style={{marginTop: 10}}>
          {previewUrl ? (
            <div className="row" style={{alignItems:'center', gap: 10}}>
              <img
                src={previewUrl}
                alt="Logo preview"
                style={{width: 48, height: 48, objectFit: 'contain', borderRadius: 6, border: '1px solid #eee'}}
              />
              <div className="tiny mono" style={{flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                {logoPath}
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={remove}
                disabled={busy || disabled}
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="tiny mono" style={{marginTop: 6}}>
              {logoPath}
            </div>
          )}
        </div>
      ) : (
        <div className="tiny" style={{marginTop: 6}}>
          Upload a square logo for best results.
        </div>
      )}
    </div>
  );
}
