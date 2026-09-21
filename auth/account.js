import { initializeAuth, appearance } from './client.js';

window.commandCenterAuth = initializeAuth();
window.commandCenterAuth.then(({ clerk }) => {
  if (!clerk) return;
  const signIn = document.getElementById('app-signin');
  const user = document.getElementById('app-user');
  if (clerk.user) {
    if (signIn) signIn.hidden = true;
    if (user) clerk.mountUserButton(user, { appearance: {...appearance, elements: {...appearance.elements, userButtonAvatarBox: {width:'24px',height:'24px'}}} });
  }
  const sessionId = clerk.session?.id || null;
  clerk.addListener(state => {
    const next = state.session?.id || null;
    if (next !== sessionId) {
      // Drop all private DOM state immediately when a session changes.
      document.getElementById('gallery-frame')?.setAttribute('src', 'about:blank');
      location.replace('/auth/');
    }
  });
}).catch(() => {
  const signIn = document.getElementById('app-signin');
  if (signIn) signIn.hidden = false;
});
