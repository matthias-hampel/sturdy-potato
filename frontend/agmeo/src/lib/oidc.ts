import type { AuthConfig } from '@agmeo/contracts'
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'

/**
 * Keycloak sign-in (OpenID Connect, Authorization Code with PKCE).
 *
 * The API says which sign-in it expects (`GET /auth/config`). In `oidc` mode the user
 * manager keeps the session in localStorage and renews the access token with the refresh
 * token shortly before it expires; every new token is handed to `onToken`, which the API
 * client stores. In `dev` mode none of this runs.
 */

let configPromise: Promise<AuthConfig> | undefined
let manager: UserManager | undefined

export function authConfig(): Promise<AuthConfig> {
  configPromise ??= fetch('/api/v1/auth/config')
    .then((r) => (r.ok ? (r.json() as Promise<AuthConfig>) : Promise.reject(new Error(`auth config: ${r.status}`))))
    .catch((e: unknown) => {
      configPromise = undefined
      throw e
    })
  return configPromise
}

export async function userManager(): Promise<UserManager | null> {
  const config = await authConfig()
  if (config.mode !== 'oidc') return null
  manager ??= new UserManager({
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: `${window.location.origin}/login`,
    response_type: 'code',
    scope: 'openid profile email',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
  })
  return manager
}

/** Keeps the stored access token current while the app is open. */
export async function watchTokens(onToken: (token: string | null) => void): Promise<() => void> {
  const um = await userManager()
  if (!um) return () => {}
  const loaded = (user: User) => onToken(user.access_token)
  const unloaded = () => onToken(null)
  um.events.addUserLoaded(loaded)
  um.events.addUserUnloaded(unloaded)
  // A failed renewal (offline, Keycloak restarting) keeps the old token: the next request that
  // gets a 401 retries the renewal and only then ends the session.
  // Loading the stored user starts the expiry timers that drive the automatic renewal.
  const user = await um.getUser()
  if (user && !user.expired) onToken(user.access_token)
  return () => {
    um.events.removeUserLoaded(loaded)
    um.events.removeUserUnloaded(unloaded)
  }
}

/** Gets a fresh access token with the refresh token, or null when the session has ended. */
export async function renewToken(): Promise<string | null> {
  const um = await userManager()
  if (!um) return null
  try {
    const user = await um.signinSilent()
    return user?.access_token ?? null
  } catch {
    return null
  }
}

/** Sends the browser to Keycloak. `register` opens the registration form instead of sign-in. */
export async function redirectToSignIn(opts: { returnTo?: string; register?: boolean; loginHint?: string } = {}) {
  const um = await userManager()
  if (!um) throw new Error('OIDC sign-in is not configured')
  await um.signinRedirect({
    state: { returnTo: opts.returnTo ?? null },
    login_hint: opts.loginHint,
    prompt: opts.register ? 'create' : undefined,
    extraQueryParams: { ui_locales: 'de' },
  })
}

/** Completes the redirect back from Keycloak; returns the access token and where to go next. */
export async function completeSignIn(): Promise<{ token: string; returnTo: string | null }> {
  const um = await userManager()
  if (!um) throw new Error('OIDC sign-in is not configured')
  const user = await um.signinRedirectCallback()
  const state = (user.state ?? {}) as { returnTo?: string | null }
  return { token: user.access_token, returnTo: state.returnTo ?? null }
}

/** Ends the Keycloak session as well, then comes back to the sign-in page. */
export async function redirectToSignOut() {
  const um = await userManager()
  if (!um) return false
  const user = await um.getUser()
  await um.removeUser()
  await um.signoutRedirect({ id_token_hint: user?.id_token })
  return true
}
