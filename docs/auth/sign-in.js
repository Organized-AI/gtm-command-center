import { initializeAuth, appearance } from './client.js';

const status = document.getElementById('auth-status');
const retry = document.getElementById('auth-retry');
const mount = document.getElementById('clerk-signin');
const legacy = document.getElementById('google-entry');
const complete = document.getElementById('signed-in');

async function start() {
  try {
    const { config, clerk } = await initializeAuth();
    status.hidden = true;
    if (!clerk) {
      if (config.googleConfigured) {
        const response = await fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok) throw new Error('Unable to check your session. Please retry.');
        const session = await response.json();
        if (session.signedIn) {
          complete.hidden = false;
          document.getElementById('signed-in-name').textContent = session.user?.name ? `Welcome back, ${session.user.name}.` : 'You’re signed in.';
          return;
        }
      }
      legacy.hidden = false;
      const button = document.getElementById('continue-google');
      button.disabled = !config.googleConfigured;
      if (!config.googleConfigured) {
        status.hidden = false;
        status.textContent = 'Google sign-in is not available in this preview. Explore the demo below.';
      }
      button.addEventListener('click', () => {
        button.disabled = true;
        button.textContent = 'Opening Google…';
        location.assign('/api/auth/start');
      });
      return;
    }
    if (clerk.user) {
      complete.hidden = false;
      document.getElementById('signed-in-name').textContent = clerk.user.firstName ? `Welcome back, ${clerk.user.firstName}.` : 'You’re signed in.';
      clerk.mountUserButton(document.getElementById('auth-user'), { appearance });
      return;
    }
    // Clerk owns verification, social login, MFA and account recovery.
    // Only methods enabled in the Clerk application are shown.
    clerk.mountSignIn(mount, {
      appearance, routing: 'hash',
      forceRedirectUrl: '/#google-connection',
      signUpForceRedirectUrl: '/#google-connection',
    });
  } catch (error) {
    status.hidden = false;
    status.textContent = error.message || 'Unable to load sign-in. Please retry.';
    status.dataset.error = 'true';
    retry.hidden = false;
  }
}

retry.addEventListener('click', () => location.reload());
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
start();
