import { useEffect, useState } from 'react';

/** Minimal hash routing: "#/<page>" or "#/<page>/<id>" (e.g. "#/print/12"). */
export interface HashRoute {
  page: string;
  id: string | null;
}

function parse(): HashRoute {
  const entry = window.location.hash.replace(/^#\/?/, '');
  const [page = '', id = null] = entry.split('/');
  return { page, id: id || null };
}

export function navigate(page: string, id?: string | number): void {
  window.location.hash = id === undefined ? `/${page}` : `/${page}/${id}`;
}

export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<HashRoute>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
