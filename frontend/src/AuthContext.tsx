import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, onUnauthorized, setToken } from './api';
import { MessageKey, translate } from './i18n';
import { Lang, Me } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  sessionExpired: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: string[]) => boolean;
  lang: Lang;
  setLanguage: (lang: Lang) => Promise<void>;
  t: (key: MessageKey) => string;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const [sessionExpired, setSessionExpired] = useState(false);
  const [lang, setLang] = useState<Lang>('sw');

  const logout = useCallback(() => {
    setToken(null);
    setMe(null);
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setSessionExpired(true);
      setMe(null);
    });
    return () => onUnauthorized(null);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api
      .get<Me>('/auth/me')
      .then((m) => {
        setMe(m);
        setLang(m.preferred_language === 'en' ? 'en' : 'sw');
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { access_token } = await api.login(username, password);
    setToken(access_token);
    const m = await api.get<Me>('/auth/me');
    setSessionExpired(false);
    setLang(m.preferred_language === 'en' ? 'en' : 'sw');
    setMe(m);
  }, []);

  const setLanguage = useCallback(async (next: Lang) => {
    setLang(next); // switch immediately; the server remembers it for SMS and next sign-in
    await api.put('/auth/me/language', { preferred_language: next });
  }, []);

  const hasRole = useCallback((...roles: string[]) => !!me && roles.some((r) => me.roles.includes(r)), [me]);
  const t = useCallback((key: MessageKey) => translate(lang, key), [lang]);

  const value = useMemo(
    () => ({ me, loading, sessionExpired, login, logout, hasRole, lang, setLanguage, t }),
    [me, loading, sessionExpired, login, logout, hasRole, lang, setLanguage, t],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
