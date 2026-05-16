export interface ProviderEntry {
    domain: string;
    name: string;
    type: string;
}
const TABLE: ProviderEntry[] = [
    { domain: 'cloudfront.net', name: 'cloudfront', type: 'cdn' },
    { domain: 'akamaihd.net', name: 'akamai', type: 'cdn' },
    { domain: 'akamai.net', name: 'akamai', type: 'cdn' },
    { domain: 'cloudflare.com', name: 'cloudflare', type: 'cdn' },
    { domain: 'jsdelivr.net', name: 'jsdelivr', type: 'cdn' },
    { domain: 'unpkg.com', name: 'unpkg', type: 'cdn' },
    { domain: 'cdnjs.cloudflare.com', name: 'cdnjs', type: 'cdn' },
    { domain: 'fastly.net', name: 'fastly', type: 'cdn' },
    { domain: 'bunnycdn.com', name: 'bunny', type: 'cdn' },
    { domain: 'google-analytics.com', name: 'google-analytics', type: 'analytics' },
    { domain: 'analytics.google.com', name: 'google-analytics', type: 'analytics' },
    { domain: 'mixpanel.com', name: 'mixpanel', type: 'analytics' },
    { domain: 'amplitude.com', name: 'amplitude', type: 'analytics' },
    { domain: 'segment.io', name: 'segment', type: 'analytics' },
    { domain: 'segment.com', name: 'segment', type: 'analytics' },
    { domain: 'hotjar.com', name: 'hotjar', type: 'analytics' },
    { domain: 'heap.io', name: 'heap', type: 'analytics' },
    { domain: 'fullstory.com', name: 'fullstory', type: 'analytics' },
    { domain: 'logrocket.com', name: 'logrocket', type: 'analytics' },
    { domain: 'doubleclick.net', name: 'doubleclick', type: 'ad' },
    { domain: 'googlesyndication.com', name: 'google-ads', type: 'ad' },
    { domain: 'googletagservices.com', name: 'google-ads', type: 'ad' },
    { domain: 'adservice.google.com', name: 'google-ads', type: 'advertising' },
    { domain: 'adnxs.com', name: 'appnexus', type: 'ad' },
    { domain: 'criteo.com', name: 'criteo', type: 'ad' },
    { domain: 'googletagmanager.com', name: 'gtm', type: 'tag-manager' },
    { domain: 'tagmanager.google.com', name: 'gtm', type: 'tag-manager' },
    { domain: 'facebook.com', name: 'facebook', type: 'social' },
    { domain: 'twitter.com', name: 'twitter', type: 'social' },
    { domain: 'x.com', name: 'x', type: 'social' },
    { domain: 'linkedin.com', name: 'linkedin', type: 'social' },
    { domain: 'instagram.com', name: 'instagram', type: 'social' },
    { domain: 'youtube.com', name: 'youtube', type: 'video' },
    { domain: 'ytimg.com', name: 'youtube', type: 'video' },
    { domain: 'vimeo.com', name: 'vimeo', type: 'video' },
    { domain: 'twitch.tv', name: 'twitch', type: 'video' },
    { domain: 'fonts.googleapis.com', name: 'google-fonts', type: 'content' },
    { domain: 'fonts.gstatic.com', name: 'google-fonts', type: 'content' },
    { domain: 'use.typekit.net', name: 'adobe-fonts', type: 'content' },
    { domain: 'intercom.io', name: 'intercom', type: 'customer-success' },
    { domain: 'zendesk.com', name: 'zendesk', type: 'customer-success' },
    { domain: 'helpscout.net', name: 'helpscout', type: 'customer-success' },
    { domain: 'drift.com', name: 'drift', type: 'customer-success' },
    { domain: 'stripe.com', name: 'stripe', type: 'utility' },
    { domain: 'plaid.com', name: 'plaid', type: 'utility' },
    { domain: 'twilio.com', name: 'twilio', type: 'utility' },
    { domain: 'sendgrid.com', name: 'sendgrid', type: 'utility' },
    { domain: 's3.amazonaws.com', name: 'aws-s3', type: 'hosting' },
    { domain: 'blob.core.windows.net', name: 'azure-blob', type: 'hosting' },
    { domain: 'storage.googleapis.com', name: 'gcs', type: 'hosting' },
];
export function lookupProvider(url: string): ProviderEntry | null {
    let host: string;
    try {
        host = new URL(url).host.toLowerCase();
    }
    catch {
        return null;
    }
    for (const e of TABLE) {
        if (host === e.domain || host.endsWith(`.${e.domain}`))
            return e;
    }
    return null;
}
