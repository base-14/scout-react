// @vitest-environment jsdom
/**
 * The SDK installs itself by patching page-global APIs. Hosts that mount and
 * unmount it — Grafana app plugins, micro-frontends — depend on `shutdown()`
 * handing the page back exactly as it found it, because anything left patched
 * keeps reporting under a `service.name` that no longer applies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Scout from './index';

const ENDPOINT = 'http://collector.test:4318';

function config() {
  return {
    serviceName: 'host-app',
    endpoint: ENDPOINT,
    secure: false,
    sessionSampleRate: 100,
  };
}

describe('Scout lifecycle — install and uninstall', () => {
  let pristine: {
    fetch: typeof globalThis.fetch;
    pushState: typeof history.pushState;
    replaceState: typeof history.replaceState;
    xhrOpen: typeof XMLHttpRequest.prototype.open;
    xhrSend: typeof XMLHttpRequest.prototype.send;
    xhrSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader;
  };

  beforeEach(() => {
    // Stubbed before the snapshot so exporters never reach the network and the
    // restoration check compares against a known reference.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })),
    );
    pristine = {
      fetch: globalThis.fetch,
      pushState: history.pushState,
      replaceState: history.replaceState,
      xhrOpen: XMLHttpRequest.prototype.open,
      xhrSend: XMLHttpRequest.prototype.send,
      xhrSetHeader: XMLHttpRequest.prototype.setRequestHeader,
    };
  });

  afterEach(async () => {
    if (Scout.isInitialized) await Scout.shutdown();
    vi.unstubAllGlobals();
  });

  function patchedGlobals(): string[] {
    const changed: string[] = [];
    if (globalThis.fetch !== pristine.fetch) changed.push('fetch');
    if (history.pushState !== pristine.pushState) changed.push('history.pushState');
    if (history.replaceState !== pristine.replaceState) {
      changed.push('history.replaceState');
    }
    if (XMLHttpRequest.prototype.open !== pristine.xhrOpen) changed.push('xhr.open');
    if (XMLHttpRequest.prototype.send !== pristine.xhrSend) changed.push('xhr.send');
    if (XMLHttpRequest.prototype.setRequestHeader !== pristine.xhrSetHeader) {
      changed.push('xhr.setRequestHeader');
    }
    return changed;
  }

  it('patches the page globals it instruments through', async () => {
    await Scout.initialize(config());
    expect(Scout.isInitialized).toBe(true);
    expect(patchedGlobals()).toEqual(
      expect.arrayContaining([
        'fetch',
        'history.pushState',
        'history.replaceState',
        'xhr.open',
        'xhr.send',
      ]),
    );
  });

  // The guarantee a host relies on: after teardown the page carries no trace of
  // the SDK, so navigation and requests outside the host go unreported.
  it('restores every patched global on shutdown', async () => {
    await Scout.initialize(config());
    await Scout.shutdown();
    expect(patchedGlobals()).toEqual([]);
    expect(Scout.isInitialized).toBe(false);
  });

  it('can be reinstalled after shutdown, and torn down again cleanly', async () => {
    await Scout.initialize(config());
    await Scout.shutdown();

    await Scout.initialize(config());
    expect(Scout.isInitialized).toBe(true);
    expect(patchedGlobals().length).toBeGreaterThan(0);

    await Scout.shutdown();
    expect(patchedGlobals()).toEqual([]);
    expect(Scout.isInitialized).toBe(false);
  });

  it('survives repeated install/uninstall cycles without stacking patches', async () => {
    for (let i = 0; i < 3; i++) {
      await Scout.initialize(config());
      await Scout.shutdown();
    }
    expect(patchedGlobals()).toEqual([]);
  });

  it('ignores a redundant shutdown', async () => {
    await Scout.initialize(config());
    await Scout.shutdown();
    await expect(Scout.shutdown()).resolves.toBeUndefined();
    expect(patchedGlobals()).toEqual([]);
  });

  it('stops reporting events once shut down', async () => {
    await Scout.initialize(config());
    await Scout.shutdown();
    // The façade drops through to a null instance rather than throwing, so a
    // late callback in the host cannot resurrect a torn-down SDK.
    expect(() => Scout.logEvent('late.event', { a: 1 })).not.toThrow();
    expect(Scout.sessionId).toBeNull();
  });
});
