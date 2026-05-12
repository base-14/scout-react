import type { Attributes } from './types';
export class UserManager {
    private _id: string | null = null;
    private _attributes: Attributes = {};
    set(id: string, attributes?: Attributes): void {
        this._id = id;
        this._attributes = { ...(attributes ?? {}) };
    }
    clear(): void {
        this._id = null;
        this._attributes = {};
    }
    get id(): string | null {
        return this._id;
    }
    get attributes(): Readonly<Attributes> {
        return this._attributes;
    }
}
