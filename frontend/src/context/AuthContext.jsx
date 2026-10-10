import { createContext, useCallback, useEffect, useMemo, useState } from "react";

import { getCurrentUser, logout as logoutApi, removeProfileAvatar, updateProfileAvatar } from "../api/authApi";
import { AUTH_TOKEN_UPDATED_EVENT, setUnauthorizedHandler } from "../api/axiosConfig";
import { invalidateReferenceCache } from "../utils/referenceDataCache";
import {
  checkSessionStatus,
  clearTabSession,
  getSessionExpiryReason,
  getTabType,
  initTabSession,
  isPrimaryTabAlive,
  markAsPrimaryTab,
  markTabExpired,
  sendPrimaryHeartbeat,
  recordSessionActivity,
} from "../utils/sessionManager";

export const AuthContext = createContext(null);

function getAvatarStorageKey(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tenantKey =
    raw.company_id ||
    raw.tenant_id ||
    raw.company_name ||
    raw.tenant_name ||
    raw.tenant ||
    "default_tenant";
  const userKey = raw.id || raw.email || raw.username || "default_user";
  return `smrt-avatar-${tenantKey}-${userKey}`;
}

function getAvatarFromStorage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const userKey = raw.id || raw.email || raw.username;
  const keys = [
    getAvatarStorageKey(raw),
    raw.id ? `smrt-avatar-${raw.id}` : null,
    raw.email ? `smrt-avatar-${raw.email}` : null,
    userKey ? `smrt-avatar-user-${userKey}` : null,
    "smrt-current-avatar",
  ].filter(Boolean);

  for (const k of keys) {
    try {
      const val = localStorage.getItem(k);
      if (val && typeof val === "string" && val.length > 20) {
        return val;
      }
    } catch {}
  }
  return null;
}

function normalizeUser(raw) {
  if (!raw || typeof raw !== "object") return null;
  const fullName = raw.full_name ?? raw.name ?? "User";
  let avatar = raw.avatar ?? raw.profile_picture ?? raw.photo ?? null;
  if (!avatar || typeof avatar !== "string" || avatar.trim() === "") {
    avatar = getAvatarFromStorage(raw);
  }
  const isUserAdmin =
    String(raw.username || "").toLowerCase() === "admin" ||
    String(raw.name || "").toLowerCase() === "admin" ||
    String(raw.full_name || "").toLowerCase() === "admin" ||
    String(raw.role || "").toLowerCase() === "admin" ||
    String(raw.role_name || "").toLowerCase() === "admin";

  const defaultRole = isUserAdmin ? "Admin" : "Operator";
  const userRole = raw.role ?? raw.role_name ?? defaultRole;
  const finalRole = isUserAdmin ? "Admin" : userRole;

  return {
    ...raw,
    full_name: fullName,
    name: fullName,
    avatar,
    role: finalRole,
    role_name: finalRole,
    roles: Array.isArray(raw.roles) ? raw.roles : [],
    permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
  };
}

function readStoredUser() {
  try {
    const status = checkSessionStatus();
    if (status.expired) {
      if (status.reason === "primary_9hr_timeout" || !isPrimaryTabAlive()) {
        clearTenantDataCaches();
        localStorage.removeItem("smrt-token");
        localStorage.removeItem("smrt-refresh-token");
        localStorage.removeItem("smrt-user");
      }
      return null;
    }
    const token = localStorage.getItem("smrt-token");
    if (!token) return null;
    const stored = localStorage.getItem("smrt-user");
    if (stored) return normalizeUser(JSON.parse(stored));
  } catch {}
  return null;
}

function clearTenantDataCaches() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k &&
        (k.startsWith("smrt_") ||
          k.startsWith("gns_") ||
          k.startsWith("iva_") ||
          k.startsWith("smrt-company-") ||
          k.startsWith("starred_") ||
          k.startsWith("local_") ||
          k.startsWith("custom_") ||
          k.startsWith("payment_modes") ||
          k.includes("leave_records") ||
          k.includes("production_orders"))
      ) {
        if (
          !k.startsWith("smrt-token") &&
          !k.startsWith("smrt-refresh") &&
          !k.startsWith("smrt-user") &&
          !k.startsWith("smrt-language") &&
          !k.startsWith("smrt-avatar") &&
          !k.startsWith("smrt-company-logo")
        ) {
          keys.push(k);
        }
      }
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {}
  invalidateReferenceCache();
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionExpiryReason, setSessionExpiryReason] = useState(() => getSessionExpiryReason());

  const logout = useCallback(async ({ allDevices = false } = {}) => {
    try {
      const refreshToken = localStorage.getItem("smrt-refresh-token");
      if (refreshToken) {
        await logoutApi(refreshToken, { allDevices }).catch(() => {});
      }
    } catch {
      /* ignore network errors — still clear local session */
    } finally {
      setUser(null);
      setSessionExpired(false);
      setSessionExpiryReason(null);
      clearTabSession();
      try {
        clearTenantDataCaches();
        localStorage.removeItem("smrt-user");
        localStorage.removeItem("smrt-token");
        localStorage.removeItem("smrt-refresh-token");
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const token = localStorage.getItem("smrt-token");
      if (token && token.startsWith("fast-session-")) {
        return; // Fast offline session is valid locally
      }
      const loginTime = Number(localStorage.getItem("smrt-login-time") || 0);
      if (Date.now() - loginTime < 60_000) {
        return; // Suppress immediate false expiration right after login
      }
      setUser(null);
      const isAuthPage =
        typeof window !== "undefined" &&
        (window.location.pathname.startsWith("/login") ||
          window.location.pathname.startsWith("/gns-admin") ||
          window.location.pathname.startsWith("/register") ||
          window.location.pathname === "/landing");
      if (!isAuthPage) {
        setSessionExpired(true);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    try {
      const token = localStorage.getItem("smrt-token");
      if (!token && user) {
        setUser(null);
        localStorage.removeItem("smrt-user");
      }
    } catch {}
  }, [user]);

  // Session lifecycle manager: 9 hours for login session, 10 minutes for new tab
  useEffect(() => {
    initTabSession();

    const checkAndEnforceSession = () => {
      if (getTabType() === "primary") {
        sendPrimaryHeartbeat();
      }

      const token = localStorage.getItem("smrt-token");
      if (!token || token.startsWith("fast-session-")) return;

      const status = checkSessionStatus();
      if (status.expired) {
        setSessionExpiryReason(status.reason);
        if (status.reason === "primary_9hr_timeout" || !isPrimaryTabAlive()) {
          logout();
          setSessionExpired(true);
        } else {
          // Tab-specific expiration for new tab: keep primary 9hr tab active
          markTabExpired(status.reason);
          setUser(null);
          setSessionExpired(true);
        }
      }
    };

    checkAndEnforceSession();
    const interval = setInterval(checkAndEnforceSession, 2000);

    const onStorageChange = (e) => {
      if (e.key === "smrt-token" && !e.newValue) {
        setUser(null);
      }
    };
    const onTokenUpdated = () => {
      recordSessionActivity();
    };
    window.addEventListener("storage", onStorageChange);
    window.addEventListener(AUTH_TOKEN_UPDATED_EVENT, onTokenUpdated);

    const onUnload = () => {
      if (getTabType() === "primary") {
        try {
          localStorage.removeItem("smrt-primary-heartbeat");
        } catch {}
      }
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", onStorageChange);
      window.removeEventListener(AUTH_TOKEN_UPDATED_EVENT, onTokenUpdated);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [logout]);

  useEffect(() => {
    let cancelled = false;
    let token = null;
    try {
      token = localStorage.getItem("smrt-token");
    } catch {
      return undefined;
    }
    if (!token || token.startsWith("fast-session-")) return undefined;

    const loginTime = Number(localStorage.getItem("smrt-login-time") || 0);
    const freshLogin = loginTime > 0 && Date.now() - loginTime < 120_000;
    if (freshLogin && user) {
      return undefined;
    }

    getCurrentUser()
      .then((data) => {
        if (cancelled || !data) return;
        const u = normalizeUser(data);
        setUser(u);
        try {
          localStorage.setItem("smrt-user", JSON.stringify(u));
        } catch {}
      })
      .catch(() => {
        /* 401 refresh/logout handled by axios interceptors; keep cached user until then */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback((authData) => {
    setSessionExpired(false);
    setSessionExpiryReason(null);
    markAsPrimaryTab();
    clearTenantDataCaches();
    let u;
    if (typeof authData === "object" && authData !== null) {
      const token = authData.access_token ?? authData.token;
      const refreshToken = authData.refresh_token;
      const userPayload = authData.user ?? authData;
      const rest = { ...userPayload };
      delete rest.access_token;
      delete rest.refresh_token;
      u = normalizeUser(rest);
      if (token) {
        try {
          localStorage.setItem("smrt-token", token);
        } catch {}
      }
      if (refreshToken) {
        try {
          localStorage.setItem("smrt-refresh-token", refreshToken);
        } catch {}
      }
    } else {
      u = { name: String(authData), role: "Operator" };
    }
    setUser(u);
    try {
      localStorage.setItem("smrt-user", JSON.stringify(u));
      if (u?.tenant_name) {
        localStorage.setItem("smrt-company-name", u.tenant_name);
      }
    } catch {}
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const token = localStorage.getItem("smrt-token");
      if (!token) return;
      const data = await getCurrentUser();
      const u = normalizeUser(data);
      setUser(u);
      localStorage.setItem("smrt-user", JSON.stringify(u));
    } catch {
      /* ignore */
    }
  }, []);

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
    setSessionExpiryReason(null);
  }, []);

  const updateUserAvatar = useCallback((avatarData) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, avatar: avatarData || null };
      const primaryKey = getAvatarStorageKey(prev);
      const userKey = prev.id || prev.email || prev.username;
      const allKeys = [
        primaryKey,
        prev.id ? `smrt-avatar-${prev.id}` : null,
        prev.email ? `smrt-avatar-${prev.email}` : null,
        userKey ? `smrt-avatar-user-${userKey}` : null,
      ].filter(Boolean);

      try {
        localStorage.setItem("smrt-user", JSON.stringify(updated));
        for (const k of allKeys) {
          if (avatarData) {
            localStorage.setItem(k, avatarData);
          } else {
            localStorage.removeItem(k);
          }
        }
      } catch {}

      // Persist to backend database so it never resets
      if (avatarData) {
        updateProfileAvatar(avatarData).catch(() => {});
      } else {
        removeProfileAvatar().catch(() => {});
      }

      return updated;
    });
  }, []);

  const value = useMemo(() => {
    let hasToken = false;
    try {
      hasToken = Boolean(localStorage.getItem("smrt-token"));
    } catch {}
    return {
      user,
      isAuthenticated: Boolean(user && hasToken),
      sessionExpired,
      sessionExpiryReason,
      clearSessionExpired,
      login,
      logout,
      refreshUser,
      updateUserAvatar,
    };
  }, [user, sessionExpired, sessionExpiryReason, clearSessionExpired, login, logout, refreshUser, updateUserAvatar]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}