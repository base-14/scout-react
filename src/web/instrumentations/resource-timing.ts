import { ATTR } from '../../core/attributes';
import type { Attributes } from '../../core/types';
export function resourceTimingAttributes(entry: PerformanceResourceTiming): Attributes {
  const out: Attributes = {};
  const base = entry.startTime;
  const phase = (keyStart: string, keyDur: string, startVal: number, endVal: number) => {
    if (!startVal || startVal === 0) return;
    if (endVal < startVal) return;
    out[keyStart] = startVal - base;
    out[keyDur] = endVal - startVal;
  };
  phase(
    ATTR.HTTP_PHASE_REDIRECT_START_MS,
    ATTR.HTTP_PHASE_REDIRECT_DURATION_MS,
    entry.redirectStart,
    entry.redirectEnd,
  );
  phase(
    ATTR.HTTP_PHASE_WORKER_START_MS,
    ATTR.HTTP_PHASE_WORKER_DURATION_MS,
    entry.workerStart ?? 0,
    entry.fetchStart,
  );
  phase(
    ATTR.HTTP_PHASE_DNS_START_MS,
    ATTR.HTTP_PHASE_DNS_DURATION_MS,
    entry.domainLookupStart,
    entry.domainLookupEnd,
  );
  phase(
    ATTR.HTTP_PHASE_CONNECT_START_MS,
    ATTR.HTTP_PHASE_CONNECT_DURATION_MS,
    entry.connectStart,
    entry.connectEnd,
  );
  if (entry.secureConnectionStart && entry.secureConnectionStart > 0) {
    out[ATTR.HTTP_PHASE_SSL_START_MS] = entry.secureConnectionStart - base;
    out[ATTR.HTTP_PHASE_SSL_DURATION_MS] = entry.connectEnd - entry.secureConnectionStart;
  }
  phase(
    ATTR.HTTP_PHASE_FIRST_BYTE_START_MS,
    ATTR.HTTP_PHASE_FIRST_BYTE_DURATION_MS,
    entry.requestStart,
    entry.responseStart,
  );
  phase(
    ATTR.HTTP_PHASE_DOWNLOAD_START_MS,
    ATTR.HTTP_PHASE_DOWNLOAD_DURATION_MS,
    entry.responseStart,
    entry.responseEnd,
  );
  if (typeof entry.encodedBodySize === 'number' && entry.encodedBodySize > 0) {
    out[ATTR.HTTP_RESPONSE_ENCODED_BODY_SIZE] = entry.encodedBodySize;
  }
  if (typeof entry.decodedBodySize === 'number' && entry.decodedBodySize > 0) {
    out[ATTR.HTTP_RESPONSE_DECODED_BODY_SIZE] = entry.decodedBodySize;
  }
  if (typeof entry.transferSize === 'number' && entry.transferSize > 0) {
    out[ATTR.HTTP_TRANSFER_SIZE] = entry.transferSize;
  }
  if (entry.nextHopProtocol) {
    out[ATTR.NETWORK_PROTOCOL_NAME] = entry.nextHopProtocol;
  }
  const dt = (
    entry as PerformanceResourceTiming & {
      deliveryType?: string;
    }
  ).deliveryType;
  if (dt) out[ATTR.HTTP_DELIVERY_TYPE] = dt;
  const rbs = (
    entry as PerformanceResourceTiming & {
      renderBlockingStatus?: string;
    }
  ).renderBlockingStatus;
  if (rbs) out[ATTR.HTTP_RENDER_BLOCKING_STATUS] = rbs;
  if (entry.initiatorType) out[ATTR.HTTP_RESOURCE_TYPE] = entry.initiatorType;
  return out;
}
