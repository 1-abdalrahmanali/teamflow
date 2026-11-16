// Links that work wherever the site is hosted, including under a sub-path
// such as https://name.github.io/teamflow/.

// This file lives at <site root>/js/utils/paths.js, so two levels up is the site root.
export const ROOT = new URL('../../', import.meta.url);

export function url(path = '', params) {
  const target = new URL(path, ROOT);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') target.searchParams.set(key, value);
    }
  }
  return target.href;
}

export function go(path, params) {
  window.location.assign(url(path, params));
}

export function param(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// A "next" address is only honoured when it stays inside this site, so a
// crafted link cannot bounce someone to another website after sign-in.
export function safeNext(next) {
  if (!next) return null;
  try {
    const target = new URL(next, window.location.href);
    return target.origin === window.location.origin && target.href.startsWith(ROOT.href) ? target.href : null;
  } catch {
    return null;
  }
}
