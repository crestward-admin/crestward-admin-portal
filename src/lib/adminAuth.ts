import { supabase } from '@shared/lib/supabase';
import type { User } from '@shared/types';
import type { AuthChangeEvent } from '@supabase/supabase-js';

const LOOKUP_MAX_ATTEMPTS = 8;
const INIT_TIMEOUT_MS = 8000;

const isAbortErr = (e: unknown): boolean => {
  const err = e as { name?: string; message?: string; details?: string };
  return (
    err?.name === 'AbortError' ||
    !!err?.message?.includes('AbortError') ||
    !!err?.details?.includes('AbortError')
  );
};

const mapProductOwnerUser = (
  authUser: { id: string; email?: string },
  productOwner: {
    name: string;
    role: User['role'];
    permissions?: User['permissions'];
  }
): User => ({
  id: authUser.id,
  name: productOwner.name,
  email: authUser.email || '',
  isLoggedIn: true,
  role: productOwner.role,
  userType: 'product_owner',
  permissions: productOwner.permissions || {
    view_all_doctors: true,
    view_analytics: true,
    manage_doctors: false,
    system_settings: false,
  },
});

async function lookupProductOwnerUser(authUser: {
  id: string;
  email?: string;
}): Promise<User | null> {
  const { data: productOwner, error } = await supabase
    .from('product_owners')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error) {
    if (isAbortErr(error)) throw error;
    console.error('[adminAuth] product_owners lookup failed:', error);
    return null;
  }

  if (!productOwner) return null;
  return mapProductOwnerUser(authUser, productOwner);
}

async function lookupWithRetries(authUser: { id: string; email?: string }): Promise<User | null> {
  for (let attempt = 0; attempt < LOOKUP_MAX_ATTEMPTS; attempt++) {
    try {
      return await lookupProductOwnerUser(authUser);
    } catch (err) {
      if (!isAbortErr(err) || attempt === LOOKUP_MAX_ATTEMPTS - 1) throw err;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  return null;
}

/** Email/password sign-in — returns admin user or throws. */
export async function adminSignIn(email: string, password: string): Promise<User> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('Sign in failed. Please try again.');

  const user = await lookupWithRetries(data.user);
  if (!user) {
    await supabase.auth.signOut();
    throw new Error(
      'This account does not have admin access. Use the doctor app to sign in instead.'
    );
  }

  return user;
}

export type AdminAuthCallbacks = {
  onAdminUser: (user: User) => void;
  onGuest: () => void;
  onRedirectToWebapp: () => void;
  onSignedOut: () => void;
};

/**
 * Single auth listener — avoids getSession() + onAuthStateChange deadlock.
 * INITIAL_SESSION handles boot; SIGNED_IN is ignored (LoginModal sets user).
 */
export function subscribeAdminAuth(
  callbacks: AdminAuthCallbacks
): { unsubscribe: () => void } {
  let initSettled = false;

  const settleInit = () => {
    if (!initSettled) initSettled = true;
  };

  const initTimer = window.setTimeout(() => {
    if (!initSettled) {
      initSettled = true;
      callbacks.onGuest();
    }
  }, INIT_TIMEOUT_MS);

  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (event: AuthChangeEvent, session) => {
      if (event === 'SIGNED_OUT') {
        callbacks.onSignedOut();
        return;
      }

      if (event !== 'INITIAL_SESSION') return;

      settleInit();
      window.clearTimeout(initTimer);

      if (!session?.user) {
        callbacks.onGuest();
        return;
      }

      try {
        const user = await lookupWithRetries(session.user);
        if (user) callbacks.onAdminUser(user);
        else callbacks.onRedirectToWebapp();
      } catch (err) {
        console.error('[adminAuth] INITIAL_SESSION lookup failed:', err);
        callbacks.onGuest();
      }
    }
  );

  return {
    unsubscribe: () => {
      window.clearTimeout(initTimer);
      subscription.unsubscribe();
    },
  };
}

const SIGN_OUT_TIMEOUT_MS = 3000;

/** Sign out locally; does not block forever on auth lock contention. */
export async function adminSignOut(): Promise<void> {
  const signOut = supabase.auth.signOut();
  const timeout = new Promise<void>((resolve) => {
    window.setTimeout(resolve, SIGN_OUT_TIMEOUT_MS);
  });

  await Promise.race([signOut.then(({ error }) => {
    if (error) console.warn('[adminAuth] signOut error:', error.message);
  }), timeout]);
}
