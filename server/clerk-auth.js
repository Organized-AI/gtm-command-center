import { createClerkClient } from '@clerk/backend';

const responseHeaders = new WeakMap();
export function clerkResponseHeaders(request) { return responseHeaders.get(request); }

export function clerkEnabled(env) {
  if (env.AUTH_PROVIDER && !['google', 'clerk'].includes(env.AUTH_PROVIDER)) throw Object.assign(new Error('Sign-in configuration is unavailable.'), {status:503,code:'app_auth_setup_required'});
  return env.AUTH_PROVIDER === 'clerk';
}

export function clerkConfigured(env) {
  return Boolean(env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);
}

export function publicAuthConfig(env) {
  if (!clerkEnabled(env)) return { provider: 'google' };
  return { provider: 'clerk', configured: clerkConfigured(env), publishableKey: env.CLERK_PUBLISHABLE_KEY || '' };
}

export async function appIdentity(request, env) {
  if (!clerkEnabled(env)) return null;
  if (!clerkConfigured(env)) throw Object.assign(new Error('Sign-in is being configured. Please try again shortly.'), { status: 503, code: 'app_auth_setup_required' });
  const client = createClerkClient({ publishableKey: env.CLERK_PUBLISHABLE_KEY, secretKey: env.CLERK_SECRET_KEY });
  const state = await client.authenticateRequest(request, {
    jwtKey: env.CLERK_JWT_KEY,
    authorizedParties: [new URL(env.APP_ORIGIN).origin],
    acceptsToken: 'session_token',
  });
  if (state.headers) responseHeaders.set(request, state.headers);
  const auth = state.toAuth();
  if (!state.isSignedIn || !auth?.userId || !auth?.sessionId) {
    // Browser document requests may need Clerk's cookie-refresh handshake.
    if (state.status === 'handshake' && request.headers.get('Sec-Fetch-Dest') === 'document' && state.headers.get('location')) {
      const headers = new Headers(state.headers);
      headers.set('Cache-Control', 'no-store, private');
      throw new Response(null, { status: 307, headers });
    }
    throw Object.assign(new Error('Sign in to Command Center to continue.'), { status: 401, code: 'app_sign_in_required' });
  }
  return { userId: auth.userId, sessionId: auth.sessionId };
}

export function ownsConnection(identity, connection) {
  return !identity || (connection.appUserId === identity.userId && connection.appSessionId === identity.sessionId);
}
