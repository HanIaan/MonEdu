/**
 * Copy text to the clipboard with a fallback for browsers/contexts without the async Clipboard API.
 * Returns whether the copy succeeded; never throws.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    if (typeof document === 'undefined') return false;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
