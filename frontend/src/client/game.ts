import { api, logout, getToken } from './api';
import { showToast, formatDate, escapeHtml, stars } from './utils';

interface Game {
  id: number;
  title: string;
  short_description: string;
  cover_path: string;
  genres: string[];
  average_rating: number;
  reviews_count: number;
}

interface Review {
  id: number;
  user_id: number;
  username: string;
  rating: number;
  text: string;
  created_at: string;
}

// Get game ID from data attribute
const main = document.querySelector('main[data-game-id]') as HTMLElement;
const gameId = Number(main?.dataset.gameId);

if (!gameId) {
  showToast('Game ID not found');
}

// Logout
document.getElementById('logoutButton')?.addEventListener('click', () => {
  logout();
});

// Star picker
const starPicker = document.getElementById('starPicker');
const ratingInput = document.getElementById('ratingInput') as HTMLInputElement;
let selectedRating = 0;

starPicker?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.classList.contains('star-button')) return;

  const starValue = Number(target.dataset.star);
  selectedRating = starValue;
  ratingInput.value = String(starValue);

  // Update visual state
  starPicker.querySelectorAll('.star-button').forEach((btn, index) => {
    btn.classList.toggle('active', index < starValue);
  });
});

// Load game details
async function loadGame(id: number): Promise<Game> {
  return api(`/games/${id}`) as Promise<Game>;
}

// Load reviews
async function loadReviews(gameId: number): Promise<Review[]> {
  const data = await api(`/games/${gameId}`) as Record<string, unknown>;
  return (data.reviews as Review[]) || [];
}

// Submit rating
async function submitRating(gameId: number, value: number): Promise<void> {
  await api(`/games/${gameId}/rating`, { method: 'POST', body: { value } });
}

// Submit review
async function submitReview(gameId: number, content: string): Promise<void> {
  await api(`/games/${gameId}/review`, { method: 'POST', body: { content } });
}

function renderGame(game: Game) {
  const cover = document.getElementById('gameCover');
  const title = document.getElementById('gameTitle');
  const subtitle = document.getElementById('gameSubtitle');
  const genres = document.getElementById('gameGenres');
  const avgRating = document.getElementById('gameAvgRating');
  const reviewsCount = document.getElementById('gameReviewsCount');

  if (cover) {
    cover.src = game.cover_path;
    cover.alt = `${game.title} cover`;
  }
  if (title) title.textContent = game.title;
  if (subtitle) subtitle.textContent = game.short_description;
  if (genres) genres.textContent = game.genres.join(', ');
  if (avgRating) avgRating.textContent = stars(Math.round(game.average_rating));
  if (reviewsCount) reviewsCount.textContent = String(game.reviews_count);
}

function renderReviews(reviews: Review[]) {
  const list = document.getElementById('reviewsList');
  const empty = document.getElementById('reviewsEmpty');

  if (!list) return;

  if (reviews.length === 0) {
    list.innerHTML = '';
    empty?.classList.remove('hidden');
  } else {
    empty?.classList.add('hidden');
    list.innerHTML = reviews
      .map(
        (review) => `
      <div class="review-card">
        <div class="review-top">
          <strong>${escapeHtml(review.username)}</strong>
          <span class="review-rating">${stars(review.rating)}</span>
        </div>
        <p>${escapeHtml(review.text)}</p>
        <small class="meta-muted">${formatDate(review.created_at)}</small>
      </div>
    `
      )
      .join('');
  }
}

// Initialize page
(async function init() {
  if (!getToken()) {
    window.location.href = '/';
    return;
  }

  if (!gameId) {
    showToast('Invalid game ID');
    return;
  }

  try {
    const [game, reviews] = await Promise.all([loadGame(gameId), loadReviews(gameId)]);
    renderGame(game);
    renderReviews(reviews);
  } catch (err) {
    showToast((err as Error).message);
  }
})();

// Review form submit
const reviewForm = document.getElementById('reviewForm') as HTMLFormElement;
reviewForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!selectedRating) {
    showToast('Please select a rating');
    return;
  }

  const formData = new FormData(reviewForm);
  const text = formData.get('text') as string;

  try {
    await submitRating(gameId, selectedRating);
    await submitReview(gameId, text);
    showToast('Review submitted successfully!');
    reviewForm.reset();
    selectedRating = 0;
    ratingInput.value = '';
    starPicker?.querySelectorAll('.star-button').forEach((btn) => btn.classList.remove('active'));

    // Reload reviews
    const reviews = await loadReviews(gameId);
    renderReviews(reviews);
  } catch (err) {
    showToast((err as Error).message);
  }
});
