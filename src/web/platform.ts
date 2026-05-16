import type { PlatformAdapter } from '../core/platform';
import { ATTR } from '../core/attributes';
export class WebPlatform implements PlatformAdapter {
    readonly name = 'web' as const;
    async getItem(key: string): Promise<string | null> {
        try {
            return globalThis.localStorage?.getItem(key) ?? null;
        }
        catch {
            return null;
        }
    }
    async setItem(key: string, value: string): Promise<void> {
        try {
            globalThis.localStorage?.setItem(key, value);
        }
        catch {
        }
    }
    async removeItem(key: string): Promise<void> {
        try {
            globalThis.localStorage?.removeItem(key);
        }
        catch {
        }
    }
    async collectResourceAttributes(): Promise<Record<string, string | number | boolean>> {
        const attrs: Record<string, string | number | boolean> = {};
        const nav = (globalThis as any).navigator;
        if (!nav)
            return attrs;
        const ua = nav.userAgentData;
        if (ua?.platform)
            attrs[ATTR.OS_NAME] = String(ua.platform);
        else if (nav.platform)
            attrs[ATTR.OS_NAME] = String(nav.platform);
        if (nav.userAgent)
            attrs['browser.user_agent'] = String(nav.userAgent);
        if (nav.language)
            attrs['browser.language'] = String(nav.language);
        const screen = (globalThis as any).screen;
        if (screen?.width)
            attrs['screen.width'] = Number(screen.width);
        if (screen?.height)
            attrs['screen.height'] = Number(screen.height);
        if ((globalThis as any).devicePixelRatio) {
            attrs['screen.pixel_ratio'] = Number((globalThis as any).devicePixelRatio);
        }
        attrs[ATTR.DEVICE_IS_PHYSICAL] = 'true';
        const win = globalThis as any;
        if (typeof win.innerWidth === 'number') {
            attrs[ATTR.VIEWPORT_WIDTH] = Number(win.innerWidth);
        }
        if (typeof win.innerHeight === 'number') {
            attrs[ATTR.VIEWPORT_HEIGHT] = Number(win.innerHeight);
        }
        try {
            const intl = win.Intl?.DateTimeFormat?.();
            if (intl?.resolvedOptions) {
                const opts = intl.resolvedOptions();
                if (opts.locale)
                    attrs[ATTR.APPLICATION_LOCALE] = String(opts.locale);
                if (opts.timeZone)
                    attrs[ATTR.DEVICE_TIME_ZONE] = String(opts.timeZone);
            }
        }
        catch {
        }
        if (typeof nav.hardwareConcurrency === 'number') {
            attrs[ATTR.DEVICE_LOGICAL_CPU_COUNT] = Number(nav.hardwareConcurrency);
        }
        if (typeof nav.deviceMemory === 'number') {
            attrs[ATTR.DEVICE_TOTAL_RAM] = Math.round(nav.deviceMemory * 1024);
        }
        return attrs;
    }
    getConnectionType(): string {
        const nav = (globalThis as any).navigator;
        const c = nav?.connection ?? nav?.mozConnection ?? nav?.webkitConnection;
        if (c?.effectiveType)
            return String(c.effectiveType);
        if (c?.type)
            return String(c.type);
        return 'unknown';
    }
    onConnectivityChange(handler: (type: string) => void): () => void {
        const nav = (globalThis as any).navigator;
        const c = nav?.connection ?? nav?.mozConnection ?? nav?.webkitConnection;
        if (!c?.addEventListener)
            return () => { };
        const fn = () => {
            handler(this.getConnectionType());
        };
        c.addEventListener('change', fn);
        return () => c.removeEventListener('change', fn);
    }
}
