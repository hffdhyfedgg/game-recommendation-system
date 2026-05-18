import { api, setToken, getToken, logout } from './api';
import { showToast } from './utils';

// Tab switching
const tabButtons = document.querySelectorAll('[data-auth-tab]');
const loginForm = document.getElementById('loginForm') as HTMLFormElement;
const registerForm = document.getElementById('registerForm') as HTMLFormElement;
const authTitle = document.getElementById('authTitle');
const authSubtitle = document.getElementById('authSubtitle');

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = (btn as HTMLElement).dataset.authTab;
    tabButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    if (tab === 'login') {
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
      authTitle!.textContent = 'Welcome back';
      authSubtitle!.textContent = 'Use your email and password to enter PlayNext.';
    } else {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
      authTitle!.textContent = 'Create your account';
      authSubtitle!.textContent = 'Join PlayNext to start discovering games.';
    }
  });
});

// Login form submit
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(loginForm);
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    const token = (data as Record<string, string>).access_token;
    setToken(token);
    showToast('Welcome back!');
    window.location.href = '/app';
  } catch (err) {
    showToast((err as Error).message);
  }
});

// Register form submit
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(registerForm);
  const username = formData.get('username') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: { username, email, password },
      auth: false,
    });
    const token = (data as Record<string, string>).access_token;
    setToken(token);
    showToast('Account created successfully!');
    window.location.href = '/app';
  } catch (err) {
    showToast((err as Error).message);
  }
});

// Auto-redirect if already logged in
if (getToken()) {
  window.location.href = '/app';
}
