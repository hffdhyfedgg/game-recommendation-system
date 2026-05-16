export interface Game {
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

export function showToast(message: string): void {
  const toast = document.getElementById("toast");
  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout((toast as HTMLElement & { _timeoutId?: number })._timeoutId);
  (toast as HTMLElement & { _timeoutId?: number })._timeoutId = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

export function formatDate(value: string | number): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function initialsFromName(name: string): string {
  return (name || "P")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function stars(value: number): string {
  return `${value}/5`;
}

export function escapeHtml(text: string): string {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderGameCard(game: Game): string {
  const matchBadge =
    game.recommended_score && game.recommended_score > 0
      ? `<span class="match-badge">Match ${game.recommended_score}</span>`
      : "";

  const myRating =
    game.my_rating !== null && game.my_rating !== undefined
      ? `<span class="meta-muted">Your rating: ${stars(game.my_rating)}</span>`
      : `<span class="meta-muted">No personal rating yet</span>`;

  return `
    <article class="game-card">
      <img src="${escapeHtml(game.cover_path)}" alt="${escapeHtml(game.title)} cover" />
      <div class="game-card-body">
        ${matchBadge}
        <h3>${escapeHtml(game.title)}</h3>
        <p>${escapeHtml(game.short_description)}</p>
        <div class="genres-row">
          ${game.genres.map((genre) => `<span class="genre-chip">${escapeHtml(genre)}</span>`).join("")}
        </div>
        <div class="game-card-meta">
          <span class="meta-rating">${stars(Math.round(game.average_rating || 0))}</span>
          <span class="meta-muted">${game.average_rating.toFixed(1)} average</span>
        </div>
        <div class="card-footer">
          <span class="meta-muted">${game.reviews_count} reviews</span>
          <a class="link-button" href="/game/${game.id}">Open Page</a>
        </div>
        <div class="card-footer">
          ${myRating}
        </div>
      </div>
    </article>
  `;
}
