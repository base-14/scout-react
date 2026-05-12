import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { METRIC } from '../../core/metrics';
import type { Scout } from '../../core/scout';
const NAME_TO_METRIC: Record<string, string> = {
    CLS: METRIC.WEB_VITAL_CLS,
    FCP: METRIC.WEB_VITAL_FCP,
    INP: METRIC.WEB_VITAL_INP,
    LCP: METRIC.WEB_VITAL_LCP,
    TTFB: METRIC.WEB_VITAL_TTFB,
};
export function installWebVitalsTracker(scout: Scout): () => void {
    const send = (m: Metric) => {
        try {
            const metricName = NAME_TO_METRIC[m.name] ?? `web.vital.${m.name.toLowerCase()}`;
            scout.emitHistogram(metricName, m.value, {
                [ATTR.WEB_VITAL_NAME]: m.name,
                [ATTR.WEB_VITAL_VALUE]: m.value,
                [ATTR.WEB_VITAL_RATING]: m.rating,
                [ATTR.WEB_VITAL_ID]: m.id,
            });
            scout.emitSpan(SPAN.WEB_VITAL, {
                [ATTR.WEB_VITAL_NAME]: m.name,
                [ATTR.WEB_VITAL_VALUE]: m.value,
                [ATTR.WEB_VITAL_RATING]: m.rating,
                [ATTR.WEB_VITAL_ID]: m.id,
                ...scout.commonAttributes(),
            });
        }
        catch {
        }
    };
    onCLS(send);
    onFCP(send);
    onINP(send);
    onLCP(send);
    onTTFB(send);
    return () => {
    };
}
