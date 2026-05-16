export interface GraphQLRequestInfo {
    operationType: 'query' | 'mutation' | 'subscription';
    operationName?: string;
    variables?: unknown;
}
type OpType = 'query' | 'mutation' | 'subscription';
export function parseGraphQLRequest(body: unknown): GraphQLRequestInfo | null {
    if (!body)
        return null;
    let str: string;
    if (typeof body === 'string') {
        str = body;
    }
    else if (typeof Blob !== 'undefined' &&
        body instanceof Blob &&
        body.type === 'application/json') {
        return null;
    }
    else {
        return null;
    }
    let obj: any;
    try {
        obj = JSON.parse(str);
    }
    catch {
        return null;
    }
    if (!obj || typeof obj !== 'object')
        return null;
    const query: string | undefined = typeof obj.query === 'string' ? obj.query : undefined;
    if (!query)
        return null;
    const opMatch = query.match(/^\s*(query|mutation|subscription)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/);
    const opType = (opMatch?.[1] as OpType | undefined) ?? 'query';
    const opName: string | undefined = typeof obj.operationName === 'string' ? obj.operationName : opMatch?.[2];
    return {
        operationType: opType,
        operationName: opName,
        variables: obj.variables,
    };
}
export interface GraphQLResponseInfo {
    errorCount: number;
    errors: unknown[];
}
export function parseGraphQLResponse(body: unknown): GraphQLResponseInfo | null {
    if (!body)
        return null;
    let str: string;
    if (typeof body === 'string') {
        str = body;
    }
    else {
        return null;
    }
    let obj: any;
    try {
        obj = JSON.parse(str);
    }
    catch {
        return null;
    }
    if (!obj || typeof obj !== 'object')
        return null;
    const errors = Array.isArray(obj.errors) ? obj.errors : [];
    if (!('data' in obj) && errors.length === 0)
        return null;
    return { errorCount: errors.length, errors };
}
