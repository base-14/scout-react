import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { SpanStatusCode } from '@opentelemetry/api';
export function installCspViolationTracker(scout: Scout): () => void {
    if (typeof document === 'undefined')
        return () => { };
    const handler = (e: SecurityPolicyViolationEvent) => {
        try {
            scout.emitSpan(SPAN.ERROR, {
                [ATTR.ERROR_TYPE]: 'csp_violation',
                [ATTR.ERROR_MESSAGE]: `CSP violated: ${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`,
                [ATTR.ERROR_SOURCE]: 'report',
                [ATTR.ERROR_SOURCE_TYPE]: 'browser',
                [ATTR.ERROR_CATEGORY]: 'Network',
                [ATTR.ERROR_HANDLED]: 'true',
                [ATTR.ERROR_HANDLING]: 'handled',
                [ATTR.ERROR_CSP_DISPOSITION]: e.disposition || 'enforce',
                [ATTR.ERROR_CSP_VIOLATED_DIRECTIVE]: e.violatedDirective,
                [ATTR.ERROR_CSP_BLOCKED_URI]: e.blockedURI,
                ...scout.commonAttributes(),
            }, { status: SpanStatusCode.ERROR });
        }
        catch {
        }
    };
    document.addEventListener('securitypolicyviolation', handler);
    return () => document.removeEventListener('securitypolicyviolation', handler);
}
