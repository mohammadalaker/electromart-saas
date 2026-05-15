import { useEffect, useState, useCallback } from 'react';
import { Package } from 'lucide-react';
import { supabase, STORAGE_BUCKET } from '../lib/supabaseClient';
import { getPublicImageUrl, extractStoragePath } from '../utils/storageImageUrl';

/**
 * صورة من Supabase Storage: جرّب الرابط العام أولاً ثم رابطاً موقّعاً (مناسب إذا كان الـ bucket خاصاً).
 */
export default function StorageObjectImage({
  srcValue,
  className = '',
  alt = '',
  iconSize = 22,
  fallbackClassName = 'text-slate-300',
}) {
  const [src, setSrc] = useState(() => getPublicImageUrl(srcValue));
  const [triedSigned, setTriedSigned] = useState(false);

  useEffect(() => {
    setSrc(getPublicImageUrl(srcValue));
    setTriedSigned(false);
  }, [srcValue]);

  const onError = useCallback(async () => {
    if (triedSigned) {
      setSrc(null);
      return;
    }
    setTriedSigned(true);
    const path = extractStoragePath(srcValue);
    if (!path) {
      setSrc(null);
      return;
    }
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, 3600);
    if (!error && data?.signedUrl) {
      setSrc(data.signedUrl);
    } else {
      setSrc(null);
    }
  }, [srcValue, triedSigned]);

  if (!srcValue || typeof srcValue !== 'string' || !String(srcValue).trim()) {
    return <Package className={fallbackClassName} size={iconSize} />;
  }
  if (!src) {
    return <Package className={fallbackClassName} size={iconSize} />;
  }

  return (
    <img src={src} alt={alt} className={className} onError={onError} loading="lazy" decoding="async" />
  );
}
