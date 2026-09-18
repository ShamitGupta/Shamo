// Where the app is served from, derived once so that a subpath deployment
// needs a build variable and nothing else.
//
// Vite sets import.meta.env.BASE_URL from `base` in vite.config.js, which
// reads VITE_BASE_PATH. Serving from https://shamoclasses.com/chatbot gives
// '/chatbot/'; serving from the domain root gives '/'. Everything below is
// derived from that single value, so the two deployments cannot drift apart.

const RAW_BASE = import.meta.env.BASE_URL || '/';

// Absolute URL of the app's own root, e.g. https://shamoclasses.com/chatbot/
export const APP_BASE_URL = new URL(RAW_BASE, window.location.origin).toString();

// React Router wants no trailing slash, and '' for a root deployment.
export const ROUTER_BASENAME = RAW_BASE.replace(/\/+$/, '');

// Resolve an in-app path against the app root.
//
// The leading slash MUST be stripped first: new URL('/teacher', '.../chatbot/')
// resolves to '.../teacher', silently dropping the subpath and landing the
// user on the marketing site instead of the app.
export function appUrl(path) {
    if (typeof path !== 'string' || !path) return APP_BASE_URL;
    return new URL(path.replace(/^\/+/, ''), APP_BASE_URL).toString();
}
