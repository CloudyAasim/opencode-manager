export function getAssistantPath(): string {
  return '/assistant';
}

export function getAssistantSessionListPath(): string {
  return '/assistant';
}

export function isAssistantPath(pathname: string): boolean {
  return pathname === '/assistant' || /^\/repos\/[^/]+\/assistant$/.test(pathname);
}

/**
 * Whether the path is somewhere inside the projects area.
 *
 * A project and the sessions inside it are the same place as the list, so
 * the list has to stay lit while you are in one of them. The two
 * sub-places that have an entry of their own - a project's assistant and its
 * schedules - are not part of this, and they say so by lighting up
 * instead.
 */
export function isProjectPath(pathname: string): boolean {
  return pathname === '/' || /^\/repos\/[^/]+(?:\/sessions\/[^/]+)?$/.test(pathname);
}

/**
 * Whether the path is somewhere inside the settings.
 *
 * The OpenCode configuration page is settings, and opening it used to take
 * the highlight off the entry that leads you there.
 */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || /^\/settings\/.+/.test(pathname);
}

export function getSessionListPath(isAssistantSession: boolean): string {
  if (isAssistantSession) {
    return getAssistantSessionListPath();
  }
  return '/';
}

function isSafeInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

export function getPathWithReturnTo(path: string, returnTo: string): string {
  if (!isSafeInternalPath(returnTo)) return path;
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('returnTo', returnTo);
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

export function getReturnToPath(search: string, fallback: string): string {
  const returnTo = new URLSearchParams(search).get('returnTo');
  return returnTo && isSafeInternalPath(returnTo) ? returnTo : fallback;
}

export function getSwipeBackTarget(pathname: string, search = ''): string | null {
  const sessionDetailRegex = /^\/repos\/([^/]+)\/sessions\/[^/]+$/;
  const match = pathname.match(sessionDetailRegex);

  if (match) {
    void match;
    const params = new URLSearchParams(search);
    const isAssistant = params.get('assistant') === '1';
    return getSessionListPath(isAssistant);
  }

  if (isAssistantPath(pathname)) {
    return '/';
  }

  if (/^\/repos\/[^/]+$/.test(pathname)) {
    return '/';
  }

  if (/^\/repos\/[^/]+\/schedules$/.test(pathname)) {
    const returnTo = getReturnToPath(search, '');
    if (returnTo) return returnTo;
    const repoId = pathname.split('/')[2];
    if (repoId === '0') {
      return getAssistantPath();
    }
    return `/repos/${repoId}`;
  }

  if (pathname === '/schedules') {
    return '/';
  }

  if (pathname === '/' || pathname === '/login' || pathname === '/setup' || pathname === '/register') {
    return null;
  }

  return null;
}
