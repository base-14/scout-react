import type { Breadcrumb } from './types';
import type { PlatformAdapter } from './platform';
const MAX_BREADCRUMBS = 20;
const STORAGE_KEY = 'scout.breadcrumbs';
export class BreadcrumbManager {
    private buffer: Breadcrumb[] = [];
    constructor(private platform: PlatformAdapter) { }
    async hydrate(): Promise<void> {
        try {
            const raw = await this.platform.getItem(STORAGE_KEY);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    this.buffer = arr.slice(-MAX_BREADCRUMBS);
                }
            }
        }
        catch {
        }
    }
    add(type: string, message: string): void {
        const crumb: Breadcrumb = {
            type,
            message,
            time: new Date().toISOString(),
        };
        this.buffer.push(crumb);
        if (this.buffer.length > MAX_BREADCRUMBS) {
            this.buffer.shift();
        }
        void this.persist();
    }
    list(): Breadcrumb[] {
        return [...this.buffer];
    }
    serialize(): string {
        return JSON.stringify(this.buffer);
    }
    clear(): void {
        this.buffer = [];
        void this.platform.removeItem(STORAGE_KEY).catch(() => { });
    }
    private async persist(): Promise<void> {
        try {
            await this.platform.setItem(STORAGE_KEY, JSON.stringify(this.buffer));
        }
        catch {
        }
    }
}
