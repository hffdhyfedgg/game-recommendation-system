import { api, logout, getToken } from './api';
import { showToast, renderGameCard, formatDate, initialsFromName, stars } from './utils';

interface Game {
  id: number;
  title: string;
  short_description: string;
  cover_path: string;
  genres: string[];
  average_rating: number;
  reviews_count: number;
  recommended_score?: number;
  my_rating?: number | null;
}

interface Genre {
  id: number;
  name: string;
}

interface User {
  id: number;
  username: string;
  email: string;
  created_at: string;
}

// Panel switching
const navButtons = document.querySelectorAll('[data-panel-target]');
const panels = document.querySelectorAll('[data-panel]');

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = (btn as HTMLElement).dataset.panelTarget;
    navButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    panels.forEach((panel) => {
      panel.classList.toggle('active', (panel as HTMLElement).dataset.panel === target);
    });
  });
});

// Logout
const logoutButton = document.getElementById('logoutButton');
logoutButton?.addEventListener('click', () => {
  logout();
});

// Search
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
let allGames: Game[] = [];

searchInput?.addEventListener('input', async (e) => {
  const query = (e.target as HTMLInputElement).value.toLowerCase().trim();
  if (!query) {
    renderGames(allGames);
    return;
  }
  const filtered = allGames.filter(
    (game) =>
      game.title.toLowerCase().includes(query) ||
      game.genres.some((g) => g.toLowerCase().includes(query))
  );
  renderGames(filtered);
});

async function loadCurrentUser(): Promise<User> {
  return api('/auth/me') as Promise<User>;
}

async function loadGames(): Promise<Game[]> {
  return api('/games') as Promise<Game[]>;
}

async function loadGenres(): Promise<Genre[]> {
  return api('/genres') as Promise<Genre[]>;
}

async function loadFavoriteGames(): Promise<Game[]> {
  return api('/user/favorites') as Promise<Game[]>;
}

async function saveGenres(genreIds: number[]): Promise<void> {
  await api('/user/genres', { method: 'POST', body: { genre_ids: genreIds } });
}

async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api('/auth/password', { method: 'PUT', body: { current_password: currentPassword, new_password: newPassword } });
}

async function deleteAccount(): Promise<void> {
  await api('/auth/account', { method: 'DELETE' });
}

function renderGames(games: Game[]) {
  const grid = document.getElementById('gamesGrid');
  const empty = document.getElementById('gamesEmpty');
  if (!grid) return;

  if (games.length === 0) {
    grid.innerHTML = '';
    empty?.classList.remove('hidden');
  } else {
    empty?.classList.add('hidden');
    grid.innerHTML = games.map((game) => renderGameCard(game)).join('');
  }
}

function renderGenres(genres: Genre[], userGenres: number[] = []) {
  const grid = document.getElementById('genresGrid');
  if (!grid) return;

  grid.innerHTML = genres
    .map(
      (genre) => `
      <label class="genre-option">
        <input type="checkbox" value="${genre.id}" ${userGenres.includes(genre.id) ? 'checked' : ''} />
        <span>${genre.name}</span>
      </label>
    `
    )
    .join('');
}

function renderFavoriteGames(games: Game[]) {
  const grid = document.getElementById('favoriteGamesGrid');
  const empty = document.getElementById('favoritesEmpty');
  if (!grid) return;

  if (games.length === 0) {
    grid.innerHTML = '';
    empty?.classList.remove('hidden');
  } else {
    empty?.classList.add('hidden');
    grid.innerHTML = games.map((game) => renderGameCard(game)).join('');
  }
}

function renderProfile(user: User) {
  const avatar = document.getElementById('profileAvatar');
  const username = document.getElementById('profileUsername');
  const email = document.getElementById('profileEmail');
  const createdAt = document.getElementById('profileCreatedAt');
  const headerUser = document.getElementById('headerUser');

  if (avatar) avatar.textContent = initialsFromName(user.username);
  if (username) username.textContent = user.username;
  if (email) email.textContent = user.email;
  if (createdAt) createdAt.textContent = formatDate(user.created_at);
  if (headerUser) headerUser.textContent = user.username;
}

function renderStats() {
  const grid = document.getElementById('statsGrid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="stat-card">
      <strong>0</strong>
      <span>Games rated</span>
    </div>
    <div class="stat-card">
      <strong>0</strong>
      <span>Reviews written</span>
    </div>
    <div class="stat-card">
      <strong>0</strong>
      <span>Favorites saved</span>
    </div>
    <div class="stat-card">
      <strong>0</strong>
      <span>Genres selected</span>
    </div>
  `;
}

// Initialize app
(async function init() {
  if (!getToken()) {
    window.location.href = '/';
    return;
  }

  try {
    const [user, games, genres, favoriteGames] = await Promise.all([
      loadCurrentUser(),
      loadGames(),
      loadGenres(),
      loadFavoriteGames(),
    ]);

    allGames = games;
    renderGames(games);
    renderGenres(genres);
    renderFavoriteGames(favoriteGames);
    renderProfile(user);
    renderStats();
  } catch (err) {
    showToast((err as Error).message);
  }
})();

// Save genres button
document.getElementById('saveGenresButton')?.addEventListener('click', async () => {
  const checkboxes = document.querySelectorAll('#genresGrid input[type="checkbox"]:checked');
  const genreIds = Array.from(checkboxes).map((cb) => Number((cb as HTMLInputElement).value));

  try {
    await saveGenres(genreIds);
    showToast('Genres saved successfully!');
  } catch (err) {
    showToast((err as Error).message);
  }
});

// Password modal
const passwordModal = document.getElementById('passwordModal');
const openPasswordModalBtn = document.getElementById('openPasswordModal');
const closePasswordModalBtn = document.getElementById('close-passwordModal');

openPasswordModalBtn?.addEventListener('click', () => {
  passwordModal?.classList.remove('hidden');
});

closePasswordModalBtn?.addEventListener('click', () => {
  passwordModal?.classList.add('hidden');
});

passwordModal?.addEventListener('click', (e) => {
  if (e.target === passwordModal) {
    passwordModal.classList.add('hidden');
  }
});

// Password form
const passwordForm = document.getElementById('passwordForm') as HTMLFormElement;
passwordForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(passwordForm);
  const currentPassword = formData.get('currentPassword') as string;
  const newPassword = formData.get('newPassword') as string;

  try {
    await changePassword(currentPassword, newPassword);
    showToast('Password updated successfully!');
    passwordForm.reset();
    passwordModal?.classList.add('hidden');
  } catch (err) {
    showToast((err as Error).message);
  }
});

// Delete account
document.getElementById('deleteAccountButton')?.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
    return;
  }

  try {
    await deleteAccount();
    logout();
  } catch (err) {
    showToast((err as Error).message);
  }
});
