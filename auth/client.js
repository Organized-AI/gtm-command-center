// The browser receives only the publishable key. Google tokens stay in the Worker.
let initialization;
function loadScript(src, key) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    if (key) script.dataset.clerkPublishableKey = key;
    const timer = setTimeout(() => reject(new Error('Sign-in took too long to load. Please retry.')), 15000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('Unable to load secure sign-in. Check your connection and retry.')); };
    document.head.append(script);
  });
}

export function initializeAuth() {
  if (!initialization) initialization = (async () => {
    const response = await fetch('/api/auth/config', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Sign-in is temporarily unavailable. Please retry.');
    const config = await response.json();
    if (config.provider !== 'clerk') return { config, clerk: null };
    if (!config.configured) throw new Error('Sign-in is being configured. You can explore the demo in the meantime.');
    const match = /^pk_(test|live)_([A-Za-z0-9+/=]+)$/.exec(config.publishableKey);
    if (!match) throw new Error('Sign-in configuration is unavailable.');
    const host = atob(match[2]).replace(/\$$/, '');
    if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes('.') || host.includes('..')) throw new Error('Sign-in configuration is unavailable.');
    await loadScript(`https://${host}/npm/@clerk/ui@1/dist/ui.browser.js`);
    await loadScript(`https://${host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, config.publishableKey);
    await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
    return { config, clerk: window.Clerk };
  })();
  return initialization;
}

export const appearance = {
  variables: {
    colorPrimary: '#9cff00', colorPrimaryForeground: '#101708',
    colorBackground: '#0c1218', colorForeground: '#eef0f0',
    colorMutedForeground: '#a2aab0', colorInput: '#080d12',
    colorInputForeground: '#eef0f0', colorDanger: '#f69b9b',
    borderRadius: '0rem', fontFamily: 'JetBrains Mono, ui-monospace, monospace',
  },
  elements: {
    rootBox: { width: '100%' },
    cardBox: { width: '100%', boxShadow: 'none' },
    card: { background: 'transparent', boxShadow: 'none', padding: '0' },
    headerTitle: { fontSize: '16px' },
    headerSubtitle: { fontSize: '11px' },
    socialButtonsBlockButton: { background: '#9cff00', color: '#142007', minHeight: '46px', border: '1px solid #9cff00', fontSize: '11px' },
    footerAction: { gap: '6px', flexWrap: 'wrap', justifyContent: 'center' },
    footerActionText: { fontSize: '11px' },
    footerActionLink: { fontSize: '11px', whiteSpace: 'nowrap' },
  },
};
