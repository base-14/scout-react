import { describe, it, expect } from 'vitest';
import { resourceTimingAttributes } from './resource-timing';
import { ATTR } from '../../core/attributes';
function entry(overrides: Partial<PerformanceResourceTiming>): PerformanceResourceTiming {
  const base = {
    name: 'https://api.example.com/users',
    entryType: 'resource',
    startTime: 100,
    duration: 250,
    initiatorType: 'fetch',
    nextHopProtocol: 'h2',
    workerStart: 0,
    redirectStart: 0,
    redirectEnd: 0,
    fetchStart: 100,
    domainLookupStart: 105,
    domainLookupEnd: 120,
    connectStart: 120,
    connectEnd: 180,
    secureConnectionStart: 150,
    requestStart: 180,
    responseStart: 290,
    responseEnd: 350,
    transferSize: 4096,
    encodedBodySize: 3000,
    decodedBodySize: 5000,
    toJSON: () => ({}),
  } as unknown as PerformanceResourceTiming;
  return Object.assign(base, overrides);
}
describe('resourceTimingAttributes', () => {
  it('emits dns/connect/ssl/first_byte/download phases relative to startTime', () => {
    const attrs = resourceTimingAttributes(entry({}));
    expect(attrs[ATTR.HTTP_PHASE_DNS_START_MS]).toBe(5);
    expect(attrs[ATTR.HTTP_PHASE_DNS_DURATION_MS]).toBe(15);
    expect(attrs[ATTR.HTTP_PHASE_CONNECT_START_MS]).toBe(20);
    expect(attrs[ATTR.HTTP_PHASE_CONNECT_DURATION_MS]).toBe(60);
    expect(attrs[ATTR.HTTP_PHASE_SSL_START_MS]).toBe(50);
    expect(attrs[ATTR.HTTP_PHASE_SSL_DURATION_MS]).toBe(30);
    expect(attrs[ATTR.HTTP_PHASE_FIRST_BYTE_START_MS]).toBe(80);
    expect(attrs[ATTR.HTTP_PHASE_FIRST_BYTE_DURATION_MS]).toBe(110);
    expect(attrs[ATTR.HTTP_PHASE_DOWNLOAD_START_MS]).toBe(190);
    expect(attrs[ATTR.HTTP_PHASE_DOWNLOAD_DURATION_MS]).toBe(60);
  });
  it('emits body size / transfer size / protocol when populated', () => {
    const attrs = resourceTimingAttributes(entry({}));
    expect(attrs[ATTR.HTTP_RESPONSE_ENCODED_BODY_SIZE]).toBe(3000);
    expect(attrs[ATTR.HTTP_RESPONSE_DECODED_BODY_SIZE]).toBe(5000);
    expect(attrs[ATTR.HTTP_TRANSFER_SIZE]).toBe(4096);
    expect(attrs[ATTR.NETWORK_PROTOCOL_NAME]).toBe('h2');
    expect(attrs[ATTR.HTTP_RESOURCE_TYPE]).toBe('fetch');
  });
  it('omits SSL phase on plain HTTP (secureConnectionStart === 0)', () => {
    const attrs = resourceTimingAttributes(
      entry({ secureConnectionStart: 0 } as Partial<PerformanceResourceTiming>),
    );
    expect(attrs[ATTR.HTTP_PHASE_SSL_START_MS]).toBeUndefined();
    expect(attrs[ATTR.HTTP_PHASE_SSL_DURATION_MS]).toBeUndefined();
  });
  it('omits redirect / worker phases when not used', () => {
    const attrs = resourceTimingAttributes(entry({}));
    expect(attrs[ATTR.HTTP_PHASE_REDIRECT_START_MS]).toBeUndefined();
    expect(attrs[ATTR.HTTP_PHASE_REDIRECT_DURATION_MS]).toBeUndefined();
    expect(attrs[ATTR.HTTP_PHASE_WORKER_START_MS]).toBeUndefined();
  });
});
