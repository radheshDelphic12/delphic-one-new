import { createContext, useContext, useEffect, useState } from 'react';
import apiClient from './apiClient';
import { uiRole } from './access.js';

const AuthContext = createContext(null);

function activeOrgFrom(memberships, orgId) {
  return (
    memberships.find((membership) => membership.org_id === orgId)?.org ||
    memberships[0]?.org ||
    null
  );
}

function withOrgContext(user, memberships, activeOrg) {
  const membership = memberships.find((item) => item.org_id === activeOrg?.id);
  return {
    ...user,
    memberships,
    active_org: activeOrg,
    role: membership?.role || user.role,
    // 'contractor' → the simplified contractor portal (see ContractorPortalPage).
    worker_type: membership?.worker_type || 'full_time_employee',
  };
}

// A custom role's permissions come from /users/me for the company that is open; login and switch-company fetch them too.
async function withPermissions(user) {
  try {
    const { data } = await apiClient.get('/users/me');
    const me = data.data || {};
    // `access` tells the app whether this company is on the permission model and what the person holds in it.
    const base = me.access?.mode === 'permissions' ? { role: uiRole(me) } : {};
    return me.permissions ? { ...user, ...base, permissions: me.permissions, custom_role: me.custom_role, access: me.access } : { ...user, ...base, permissions: undefined, custom_role: undefined, access: me.access };
  } catch {
    return user;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setLoading(false);
      return;
    }
    Promise.all([apiClient.get('/users/me'), apiClient.get('/orgs/me/memberships')])
      .then(([userResponse, membershipsResponse]) => {
        const baseUser = userResponse.data.data;
        const memberships = membershipsResponse.data.data || [];
        const storedOrgId = localStorage.getItem('active_org_id');
        const activeOrg = activeOrgFrom(memberships, storedOrgId);
        if (activeOrg) localStorage.setItem('active_org_id', activeOrg.id);
        setUser(withOrgContext(baseUser, memberships, activeOrg));
      })
      .catch(() => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('active_org_id');
      })
      .finally(() => setLoading(false));
  }, []);

  // An admin's change to a role or its permissions reaches an open session without a new login or deployment: the server reads the
  // role live on every request, and the app re-reads /users/me when the tab is used again and every 5 minutes.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return undefined;
    let last = Date.now();
    const refresh = () => {
      last = Date.now();
      apiClient.get('/users/me').then(({ data }) => {
        const me = data.data || {};
        setUser((prev) => {
          if (!prev || prev.id !== me.id) return prev;
          const sameRole = (prev.custom_role?.id || null) === (me.custom_role?.id || null);
          if (sameRole && JSON.stringify(prev.permissions || null) === JSON.stringify(me.permissions || null) && JSON.stringify(prev.access || null) === JSON.stringify(me.access || null)) return prev;
          // a custom role's base role is the plain role, so the screens follow it too; in a company on permissions the role is derived
          const follows = me.custom_role || prev.custom_role || me.access?.mode === 'permissions';
          return { ...prev, permissions: me.permissions, custom_role: me.custom_role, access: me.access, role: follows ? uiRole(me) : prev.role };
        });
      }).catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - last > 30000) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = setInterval(refresh, 5 * 60 * 1000);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); clearInterval(timer); };
  }, [userId]);

  async function login(email, password, orgSlug) {
    const { data } = await apiClient.post('/auth/login', { email, password, ...(orgSlug ? { org_slug: orgSlug } : {}) });
    localStorage.setItem('access_token', data.data.access_token);
    localStorage.setItem('refresh_token', data.data.refresh_token);
    const memberships = data.data.memberships || [];
    const activeOrg = data.data.active_org;
    if (activeOrg) localStorage.setItem('active_org_id', activeOrg.id);
    const nextUser = await withPermissions(withOrgContext(data.data.user, memberships, activeOrg));
    setUser(nextUser);
    return nextUser;
  }

  async function switchOrg(orgId) {
    if (!user || orgId === user.active_org?.id) return user;
    const { data } = await apiClient.post('/auth/switch-org', { org_id: orgId });
    localStorage.setItem('access_token', data.data.access_token);
    localStorage.setItem('refresh_token', data.data.refresh_token);
    localStorage.setItem('active_org_id', data.data.active_org.id);
    const nextUser = await withPermissions(withOrgContext(user, user.memberships || [], data.data.active_org));
    setUser(nextUser);
    return nextUser;
  }

  async function createOrganization(payload) {
    if (!user?.active_org) throw new Error('An active organization is required');
    const { data } = await apiClient.post('/orgs', payload);
    const createdOrg = data.data.org;
    const switched = await apiClient.post('/auth/switch-org', { org_id: createdOrg.id });
    localStorage.setItem('access_token', switched.data.data.access_token);
    localStorage.setItem('refresh_token', switched.data.data.refresh_token);
    localStorage.setItem('active_org_id', createdOrg.id);
    const nextMembership = {
      ...switched.data.data.active_org,
      id: data.data.membership.id,
      org_id: createdOrg.id,
      role: data.data.membership.role,
      employment_status: data.data.membership.employment_status,
      org: switched.data.data.active_org,
    };
    const memberships = [...(user.memberships || []), nextMembership];
    const nextUser = withOrgContext(user, memberships, switched.data.data.active_org);
    setUser(nextUser);
    return nextUser;
  }

  // Merge changes into the signed-in user and/or the active org (after editing the logo or own profile).
  function patchSession({ user: userPatch, org: orgPatch } = {}) {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...(userPatch || {}) };
      if (orgPatch) {
        next.active_org = { ...prev.active_org, ...orgPatch };
        next.memberships = (prev.memberships || []).map((m) => (m.org_id === prev.active_org?.id ? { ...m, org: { ...m.org, ...orgPatch } } : m));
      }
      return next;
    });
  }

  function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('active_org_id');
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        patchSession,
        switchOrg,
        createOrganization,
        memberships: user?.memberships || [],
        activeOrg: user?.active_org || null,
        isSuperadmin: Boolean(user?.is_superadmin),
        isGroupSuperadmin: Boolean(user?.is_group_superadmin),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
