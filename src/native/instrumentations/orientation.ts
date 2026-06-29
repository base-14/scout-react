import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';

let RN: any = null;
try {
  RN = withSuppression(() => require('react-native'));
} catch {}

function computeOrientation(): string | null {
  try {
    const dims = RN?.Dimensions?.get?.('window');
    if (!dims) return null;
    const w = Number(dims.width);
    const h = Number(dims.height);
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
    return w >= h ? 'landscape' : 'portrait';
  } catch {
    return null;
  }
}

export function installOrientationTracker(scout: Scout): () => void {
  const initial = computeOrientation();
  // eslint-disable-next-line no-console
  if ((scout.config as { debug?: boolean }).debug) {
    console.log(
      '[scout]',
      'orientation init',
      initial,
      'dims',
      RN?.Dimensions?.get?.('window'),
    );
  }
  if (initial) scout.setRuntimeAttribute('device.orientation', initial);
  if (!RN?.Dimensions?.addEventListener) return () => {};
  const sub = RN.Dimensions.addEventListener('change', () => {
    const next = computeOrientation();
    if (next) scout.setRuntimeAttribute('device.orientation', next);
  });
  return () => {
    try {
      if (typeof sub?.remove === 'function') sub.remove();
    } catch {}
  };
}
