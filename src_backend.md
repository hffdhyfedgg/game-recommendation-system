# Структура файлов проекта

## Дерево проекта

```
backend/
├── app/
│   ├── __init__.py
│   ├── auth.py
│   ├── database.py
│   ├── main.py
│   ├── models.py
│   ├── schemas.py
│   └── seed.py
└── Dockerfile
```

---

## Директория: `backend`

Найдено 1 файл(ов):

### Файл: `Dockerfile`

```
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

```

---

### Директория: `app`

Найдено 7 файл(ов):

#### Файл: `__init__.py`

```python
# PlayNext backend package

```

---

#### Файл: `auth.py`

```python
import os
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .database import get_db
from .models import User


SECRET_KEY = os.getenv("JWT_SECRET_KEY", "playnext-secret-key")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "720"))

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user_id: int) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expires_at}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        ) from None

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )
    return user

```

---

#### Файл: `database.py`

```python
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://playnext:playnext@db:5432/playnext",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

```

---

#### Файл: `main.py`

```python
from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session, joinedload

from .auth import create_access_token, get_current_user, hash_password, verify_password
from .database import Base, SessionLocal, engine, get_db
from .models import ActivityLog, Game, Genre, Rating, Review, User
from .schemas import (
    ChangePasswordRequest,
    GameCardOut,
    GameDetailOut,
    GenreOut,
    LoginRequest,
    MessageResponse,
    PreferencesResponse,
    PreferencesUpdateRequest,
    ProfileResponse,
    RatingRequest,
    RegisterRequest,
    ReviewOut,
    ReviewRequest,
    TokenResponse,
)
from .seed import seed_database


app = FastAPI(title="PlayNext API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()


def log_action(db: Session, user_id: int | None, action: str, details: str):
    db.add(ActivityLog(user_id=user_id, action=action, details=details))


def serialize_review(review: Review, current_user_id: int | None) -> ReviewOut:
    rating_value = None
    for rating in review.game.ratings:
        if rating.user_id == review.user_id:
            rating_value = rating.value
            break

    return ReviewOut(
        id=review.id,
        username=review.user.username,
        rating=rating_value,
        content=review.content,
        created_at=review.created_at,
        updated_at=review.updated_at,
        is_mine=current_user_id == review.user_id,
    )


def serialize_game(game: Game, current_user: User | None, preferred_genres: set[str]) -> GameCardOut:
    genre_names = sorted(genre.name for genre in game.genres)
    ratings = [rating.value for rating in game.ratings]
    average_rating = round(sum(ratings) / len(ratings), 1) if ratings else 0.0
    my_rating = None
    if current_user is not None:
        for rating in game.ratings:
            if rating.user_id == current_user.id:
                my_rating = rating.value
                break
    recommended_score = sum(1 for genre in genre_names if genre in preferred_genres)

    return GameCardOut(
        id=game.id,
        title=game.title,
        short_description=game.short_description,
        cover_path=game.cover_path,
        genres=genre_names,
        average_rating=average_rating,
        reviews_count=len(game.reviews),
        my_rating=my_rating,
        recommended_score=recommended_score,
    )


def get_games_query(db: Session):
    return (
        db.query(Game)
        .options(
            joinedload(Game.genres),
            joinedload(Game.ratings),
            joinedload(Game.reviews).joinedload(Review.user),
        )
        .order_by(Game.title.asc())
    )


def build_profile_response(db: Session, user: User) -> ProfileResponse:
    refreshed_user = (
        db.query(User)
        .options(
            joinedload(User.favorite_genres),
            joinedload(User.ratings),
            joinedload(User.reviews),
        )
        .filter(User.id == user.id)
        .first()
    )
    favorite_games_count = sum(1 for rating in refreshed_user.ratings if rating.value == 5)
    return ProfileResponse(
        username=refreshed_user.username,
        email=refreshed_user.email,
        role=refreshed_user.role,
        created_at=refreshed_user.created_at,
        rated_games_count=len(refreshed_user.ratings),
        reviews_count=len(refreshed_user.reviews),
        favorite_genres_count=len(refreshed_user.favorite_genres),
        favorite_games_count=favorite_games_count,
    )


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.post("/api/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    existing_user = (
        db.query(User)
        .filter((User.email == payload.email) | (User.username == payload.username))
        .first()
    )
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email or username already exists.",
        )

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role="player",
    )
    db.add(user)
    db.flush()
    log_action(db, user.id, "register", f"New account: {user.email}")
    db.commit()
    return TokenResponse(access_token=create_access_token(user.id))


@app.post("/api/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    log_action(db, user.id, "login", "User signed in")
    db.commit()
    return TokenResponse(access_token=create_access_token(user.id))


@app.get("/api/auth/me", response_model=ProfileResponse)
def get_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return build_profile_response(db, current_user)


@app.post("/api/auth/change-password", response_model=MessageResponse)
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )

    current_user.password_hash = hash_password(payload.new_password)
    log_action(db, current_user.id, "change_password", "Password updated")
    db.commit()
    return MessageResponse(message="Password updated successfully.")


@app.delete("/api/auth/me", response_model=MessageResponse)
def delete_account(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    username = current_user.username
    db.delete(current_user)
    db.commit()
    return MessageResponse(message=f"Account {username} was deleted.")


@app.get("/api/genres", response_model=list[GenreOut])
def list_genres(db: Session = Depends(get_db)):
    return db.query(Genre).order_by(Genre.name.asc()).all()


@app.get("/api/games", response_model=list[GameCardOut])
def list_games(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_user = (
        db.query(User)
        .options(joinedload(User.favorite_genres))
        .filter(User.id == current_user.id)
        .first()
    )
    preferred_genres = {genre.name for genre in current_user.favorite_genres}
    games = [serialize_game(game, current_user, preferred_genres) for game in get_games_query(db).all()]

    if preferred_genres:
        games.sort(
            key=lambda item: (
                -item.recommended_score,
                -item.average_rating,
                -item.reviews_count,
                item.title,
            )
        )
    else:
        games.sort(key=lambda item: (-item.average_rating, -item.reviews_count, item.title))
    return games


@app.get("/api/games/{game_id}", response_model=GameDetailOut)
def get_game_details(
    game_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    game = get_games_query(db).filter(Game.id == game_id).first()
    if game is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found.")

    ratings = [rating.value for rating in game.ratings]
    average_rating = round(sum(ratings) / len(ratings), 1) if ratings else 0.0
    my_rating = next((rating.value for rating in game.ratings if rating.user_id == current_user.id), None)
    my_review_obj = next((review for review in game.reviews if review.user_id == current_user.id), None)
    ordered_reviews = sorted(game.reviews, key=lambda review: review.updated_at, reverse=True)

    log_action(db, current_user.id, "view_game", game.title)
    db.commit()

    return GameDetailOut(
        id=game.id,
        title=game.title,
        short_description=game.short_description,
        description=game.description,
        cover_path=game.cover_path,
        system_requirements=game.system_requirements,
        genres=sorted(genre.name for genre in game.genres),
        average_rating=average_rating,
        ratings_count=len(game.ratings),
        reviews_count=len(game.reviews),
        my_rating=my_rating,
        my_review=my_review_obj.content if my_review_obj else None,
        reviews=[serialize_review(review, current_user.id) for review in ordered_reviews],
    )


@app.post("/api/games/{game_id}/rating", response_model=MessageResponse)
def upsert_rating(
    game_id: int,
    payload: RatingRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    game = db.get(Game, game_id)
    if game is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found.")

    rating = (
        db.query(Rating)
        .filter(Rating.user_id == current_user.id, Rating.game_id == game_id)
        .first()
    )

    if rating is None:
        db.add(Rating(user_id=current_user.id, game_id=game_id, value=payload.value))
        message = "Rating added."
    else:
        rating.value = payload.value
        rating.updated_at = datetime.utcnow()
        message = "Rating updated."

    log_action(db, current_user.id, "rate_game", f"{game.title}: {payload.value} stars")
    db.commit()
    return MessageResponse(message=message)


@app.post("/api/games/{game_id}/review", response_model=MessageResponse)
def upsert_review(
    game_id: int,
    payload: ReviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    game = db.get(Game, game_id)
    if game is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found.")

    review = (
        db.query(Review)
        .filter(Review.user_id == current_user.id, Review.game_id == game_id)
        .first()
    )
    cleaned_content = payload.content.strip()

    if review is None:
        db.add(Review(user_id=current_user.id, game_id=game_id, content=cleaned_content))
        message = "Review added."
    else:
        review.content = cleaned_content
        review.updated_at = datetime.utcnow()
        message = "Review updated."

    log_action(db, current_user.id, "review_game", game.title)
    db.commit()
    return MessageResponse(message=message)


@app.get("/api/users/me/preferences", response_model=PreferencesResponse)
def get_preferences(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = (
        db.query(User)
        .options(joinedload(User.favorite_genres), joinedload(User.ratings))
        .filter(User.id == current_user.id)
        .first()
    )
    preferred_genres = {genre.name for genre in user.favorite_genres}

    favorite_game_ids = [rating.game_id for rating in user.ratings if rating.value == 5]
    if favorite_game_ids:
        favorite_games = [
            serialize_game(game, user, preferred_genres)
            for game in get_games_query(db).filter(Game.id.in_(favorite_game_ids)).all()
        ]
    else:
        favorite_games = []

    return PreferencesResponse(
        favorite_genres=sorted(preferred_genres),
        favorite_games=sorted(favorite_games, key=lambda item: item.title),
    )


@app.put("/api/users/me/preferences", response_model=MessageResponse)
def update_preferences(
    payload: PreferencesUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    requested_genres = sorted(set(payload.genres))
    genres = db.query(Genre).filter(Genre.name.in_(requested_genres)).all()
    found_genres = {genre.name for genre in genres}
    missing = [genre for genre in requested_genres if genre not in found_genres]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown genres: {', '.join(missing)}",
        )

    user = (
        db.query(User)
        .options(joinedload(User.favorite_genres))
        .filter(User.id == current_user.id)
        .first()
    )
    user.favorite_genres = genres
    log_action(db, current_user.id, "update_preferences", ", ".join(requested_genres) or "no genres")
    db.commit()
    return MessageResponse(message="Favorite genres updated.")

```

---

#### Файл: `models.py`

```python
from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base


game_genres = Table(
    "game_genres",
    Base.metadata,
    Column("game_id", ForeignKey("games.id"), primary_key=True),
    Column("genre_id", ForeignKey("genres.id"), primary_key=True),
)


user_genres = Table(
    "user_genres",
    Base.metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("genre_id", ForeignKey("genres.id"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="player")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    ratings = relationship("Rating", back_populates="user", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="user", cascade="all, delete-orphan")
    favorite_genres = relationship("Genre", secondary=user_genres, back_populates="fans")
    activity_logs = relationship(
        "ActivityLog",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class Genre(Base):
    __tablename__ = "genres"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)

    games = relationship("Game", secondary=game_genres, back_populates="genres")
    fans = relationship("User", secondary=user_genres, back_populates="favorite_genres")


class Game(Base):
    __tablename__ = "games"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), unique=True, nullable=False, index=True)
    short_description = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    system_requirements = Column(Text, nullable=False)
    cover_path = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    genres = relationship("Genre", secondary=game_genres, back_populates="games")
    ratings = relationship("Rating", back_populates="game", cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="game", cascade="all, delete-orphan")


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (UniqueConstraint("user_id", "game_id", name="uq_rating_user_game"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=False)
    value = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="ratings")
    game = relationship("Game", back_populates="ratings")


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("user_id", "game_id", name="uq_review_user_game"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="reviews")
    game = relationship("Game", back_populates="reviews")


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(100), nullable=False)
    details = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="activity_logs")

```

---

#### Файл: `schemas.py`

```python
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=6, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MessageResponse(BaseModel):
    message: str


class GenreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class ReviewOut(BaseModel):
    id: int
    username: str
    rating: int | None = None
    content: str
    created_at: datetime
    updated_at: datetime
    is_mine: bool = False


class GameCardOut(BaseModel):
    id: int
    title: str
    short_description: str
    cover_path: str
    genres: list[str]
    average_rating: float
    reviews_count: int
    my_rating: int | None = None
    recommended_score: int = 0


class GameDetailOut(BaseModel):
    id: int
    title: str
    short_description: str
    description: str
    cover_path: str
    system_requirements: str
    genres: list[str]
    average_rating: float
    ratings_count: int
    reviews_count: int
    my_rating: int | None = None
    my_review: str | None = None
    reviews: list[ReviewOut]


class RatingRequest(BaseModel):
    value: int = Field(ge=1, le=5)


class ReviewRequest(BaseModel):
    content: str = Field(min_length=3, max_length=1200)


class PreferencesResponse(BaseModel):
    favorite_genres: list[str]
    favorite_games: list[GameCardOut]


class PreferencesUpdateRequest(BaseModel):
    genres: list[str]


class ProfileResponse(BaseModel):
    username: str
    email: EmailStr
    role: str
    created_at: datetime
    rated_games_count: int
    reviews_count: int
    favorite_genres_count: int
    favorite_games_count: int

```

---

#### Файл: `seed.py`

```python
from datetime import datetime

from .auth import hash_password
from .models import ActivityLog, Game, Genre, Rating, Review, User


GENRE_NAMES = [
    "Action",
    "Adventure",
    "Classic",
    "Competitive",
    "Co-op",
    "Crime",
    "Horror",
    "MOBA",
    "Multiplayer",
    "Open World",
    "Puzzle",
    "RPG",
    "Racing",
    "Shooter",
    "Simulation",
    "Stealth",
    "Story Rich",
    "Strategy",
    "Survival",
    "Superhero",
]


def requirements(cpu="Intel Core i5 / AMD Ryzen 5", ram="8 GB", gpu="NVIDIA GTX 970 / AMD RX 570", storage="30 GB"):
    return (
        "OS: Windows 10/11 64-bit\n"
        f"CPU: {cpu}\n"
        f"RAM: {ram}\n"
        f"GPU: {gpu}\n"
        f"Storage: {storage}"
    )


GAME_CATALOG = [
    ("Alan Wake", "Alan_Wake.jpg", ["Horror", "Story Rich", "Action"]),
    ("Amnesia: A Machine for Pigs", "Amnesia_A_Machine_For_Pigs.jpg", ["Horror", "Adventure", "Story Rich"]),
    ("Amnesia: Rebirth", "Amnesia_Rebirth.jpg", ["Horror", "Adventure", "Story Rich"]),
    ("Amnesia: The Bunker", "Amnesia_The_Bunker.jpg", ["Horror", "Survival", "Stealth"]),
    ("Amnesia: The Dark Descent", "Amnesia_The_Dark_Descent.jpg", ["Horror", "Survival", "Classic"]),
    ("Assassin's Creed Unity", "Assasin_s_Creed_Unity.jpg", ["Action", "Adventure", "Open World", "Stealth"]),
    ("Batman: Arkham Asylum", "Batman_Arkham_Asylum.jpg", ["Action", "Adventure", "Superhero"]),
    ("Batman: Arkham City", "Batman_Arkham_City.jpg", ["Action", "Adventure", "Superhero", "Open World"]),
    ("Batman: Arkham Knight", "Batman_Arkham_Knight.jpg", ["Action", "Adventure", "Superhero", "Open World"]),
    ("Batman: Arkham Origins", "Batman_Arkham_Origins.jpg", ["Action", "Adventure", "Superhero"]),
    ("Battlefield 1 Revolution", "Battlefield_1_Revolution.jpg", ["Shooter", "Action", "Multiplayer"]),
    ("Battlefield 4", "Battlefield_4.jpg", ["Shooter", "Action", "Multiplayer"]),
    ("Battlefield V", "Battlefield_V.jpg", ["Shooter", "Action", "Multiplayer"]),
    ("BioShock 2", "Bioshock_2.jpg", ["Shooter", "Story Rich", "Action"]),
    ("Buckshot Roulette", "Buckshot_Roulette.jpg", ["Horror", "Strategy"]),
    ("Chained Together", "Chained_together.jpg", ["Co-op", "Adventure", "Puzzle"]),
    ("Counter-Strike 2", "Counter_Strike_2.jpg", ["Shooter", "Competitive", "Action"]),
    ("Darkwood", "Darkwood.jpg", ["Horror", "Survival", "Story Rich"]),
    ("Dota 2", "Dota_2.jpg", ["MOBA", "Competitive", "Strategy"]),
    ("Factorio", "Factorio.jpg", ["Strategy", "Simulation"]),
    ("Fallout 4", "Fallout_4.jpg", ["RPG", "Shooter", "Open World"]),
    ("Fallout: New Vegas", "Fallout_New_Vegas.jpg", ["RPG", "Shooter", "Open World", "Story Rich"]),
    ("Fears to Fathom: Carson House", "Fears_to_Fathom_Carson_House.jpg", ["Horror", "Story Rich"]),
    ("Fears to Fathom: Home Alone", "Fears_to_Fathom_Home_Alone.jpg", ["Horror", "Story Rich"]),
    ("Fears to Fathom: Ironbark Lookout", "Fears_to_Fathom_Ironbark_Lookout.jpg", ["Horror", "Story Rich"]),
    ("Fears to Fathom: Norwood Hitchhike", "Fears_to_Fathom_Norwood_Hitchhike.jpg", ["Horror", "Story Rich"]),
    ("Fears to Fathom: Woodbury Getaway", "Fears_to_Fathom_Woodbury_Getaway.jpg", ["Horror", "Story Rich"]),
    ("Firewatch", "Firewatch.jpg", ["Adventure", "Story Rich"]),
    ("FlatOut 2", "Flatout_2.jpg", ["Racing", "Action", "Classic"]),
    ("Grand Theft Auto III - Definitive Edition", "GTA_3_Definitive_Edition.jpg", ["Crime", "Action", "Open World"]),
    ("Grand Theft Auto IV", "GTA_4.jpg", ["Crime", "Action", "Open World", "Story Rich"]),
    ("Grand Theft Auto: San Andreas - Definitive Edition", "GTA_San_Andreas_Definitive_Edition.jpg", ["Crime", "Action", "Open World"]),
    ("Grand Theft Auto V", "GTA_V.jpg", ["Crime", "Action", "Open World"]),
    ("Grand Theft Auto: Vice City - Definitive Edition", "GTA_Vice_City_Definitive_Edition.jpg", ["Crime", "Action", "Open World"]),
    ("Hitman 2: Silent Assassin", "Hitman_2_Silent_Assassin.jpg", ["Stealth", "Action", "Puzzle"]),
    ("Hitman: Absolution", "Hitman_Absolution.jpg", ["Stealth", "Action"]),
    ("Hitman: Blood Money", "Hitman_Blood_Money.jpg", ["Stealth", "Action", "Puzzle"]),
    ("Hitman: Codename 47", "Hitman_Codename_47.jpg", ["Stealth", "Action", "Classic"]),
    ("Hitman: Contracts", "Hitman_Contracts.jpg", ["Stealth", "Action"]),
    ("Hitman World of Assassination", "Hitman_World_Of_Assassination.jpg", ["Stealth", "Action", "Puzzle"]),
    ("Hogwarts Legacy", "Hogwarts_Legacy.jpg", ["RPG", "Adventure", "Open World"]),
    ("Just Cause", "Just_Cause.jpg", ["Action", "Open World", "Adventure"]),
    ("Mafia II", "Mafia_2.jpg", ["Crime", "Action", "Story Rich"]),
    ("Mafia III", "Mafia_3.jpg", ["Crime", "Action", "Open World"]),
    ("Manhunt", "Manhunt.jpg", ["Horror", "Stealth", "Action"]),
    ("Max Payne", "Max_Payne.jpg", ["Action", "Shooter", "Classic"]),
    ("Max Payne 2", "Max_Payne_2.jpg", ["Action", "Shooter", "Story Rich"]),
    ("Max Payne 3", "Max_Payne_3.jpg", ["Action", "Shooter", "Story Rich"]),
    ("Medal of Honor", "Medal_of_Honor.jpg", ["Shooter", "Action", "Classic"]),
    ("Mimic Search", "Mimic_Search.jpg", ["Horror", "Puzzle"]),
    ("Missing Hiker", "Missing_Hiker.jpg", ["Horror", "Adventure"]),
    ("Mouthwashing", "Mouthwashing.jpg", ["Horror", "Story Rich"]),
    ("Outlast", "Outlast.jpg", ["Horror", "Survival", "Stealth"]),
    ("Penumbra: Black Plague", "Penumbra_Black_Plague.jpg", ["Horror", "Puzzle", "Story Rich"]),
    ("Penumbra: Overture", "Penumbra_Overture.jpg", ["Horror", "Puzzle", "Story Rich"]),
    ("Phasmophobia", "Phasmophobia.jpg", ["Horror", "Co-op", "Survival"]),
    ("Portal", "Portal.jpg", ["Puzzle", "Story Rich", "Classic"]),
    ("Portal 2", "Portal_2.jpg", ["Puzzle", "Co-op", "Story Rich"]),
    ("Prey", "Prey.jpg", ["Shooter", "RPG", "Story Rich"]),
    ("Resident Evil 0", "Resident_Evil_0.jpg", ["Horror", "Survival", "Classic"]),
    ("Resident Evil 2", "Resident_Evil_2.jpg", ["Horror", "Survival", "Action"]),
    ("Resident Evil 4", "Resident_Evil_4.jpg", ["Horror", "Action", "Survival"]),
    ("Rise of the Tomb Raider", "Rise_of_the_Tomb_Raider.jpg", ["Action", "Adventure", "Puzzle"]),
    ("Rust", "Rust.jpg", ["Survival", "Open World", "Co-op"]),
    ("Spider-Man Remastered", "Spider_man_Remastered.jpg", ["Action", "Adventure", "Superhero", "Open World"]),
    ("Terraria", "Terraria.jpg", ["Adventure", "Survival", "Co-op"]),
    ("That Which Gave Chase", "That_Which_Gave_Chase.jpg", ["Horror", "Adventure"]),
    ("Tomb Raider", "Tomb_Raider.jpg", ["Action", "Adventure", "Puzzle"]),
    ("Tomb Raider: Anniversary", "Tomb_Raider_Anniversary.jpg", ["Action", "Adventure", "Puzzle"]),
    ("Tomb Raider: Legend", "Tomb_Raider_Legend.jpg", ["Action", "Adventure", "Puzzle"]),
    ("Tomb Raider: Underworld", "Tomb_Raider_Underworld.jpg", ["Action", "Adventure", "Puzzle"]),
]


SPECIAL_TEXT = {
    "Hogwarts Legacy": (
        "A magical open-world RPG full of spells, secrets, and chaotic student energy.",
        "Explore Hogwarts, Hogsmeade, and the Forbidden Forest while learning spells, brewing potions, and dealing with ancient mysteries. It is a generous adventure for players who want magic, exploration, and a lot of collectible distractions.",
        requirements(storage="85 GB"),
    ),
    "Factorio": (
        "Build the factory, defend the factory, become the factory.",
        "Mine ore, automate production chains, and slowly turn a quiet planet into an industrial machine. It starts with one conveyor belt and somehow ends with you optimizing copper throughput at 3 AM.",
        requirements(cpu="Intel Core i3 / AMD Ryzen 3", ram="8 GB", gpu="OpenGL 3.3 compatible GPU", storage="4 GB"),
    ),
    "Portal 2": (
        "A brilliant puzzle comedy about portals, test chambers, and suspicious robots.",
        "Solve spatial puzzles with a portal gun, listen to some of the sharpest dialogue in games, and try not to trust every friendly voice coming from the ceiling.",
        requirements(cpu="Intel Core i3 / AMD Ryzen 3", ram="4 GB", gpu="NVIDIA GTX 650 / AMD HD 7750", storage="8 GB"),
    ),
    "Firewatch": (
        "A quiet first-person mystery with beautiful views and tense radio conversations.",
        "Spend a summer in the Wyoming wilderness as a fire lookout and slowly uncover what is happening around you. It is calm, emotional, and easy to finish in one memorable evening.",
        requirements(cpu="Intel Core i3 / AMD Ryzen 3", ram="6 GB", gpu="NVIDIA GTX 650 / AMD HD 7750", storage="4 GB"),
    ),
    "Counter-Strike 2": (
        "A competitive tactical shooter where every corner has a lesson waiting.",
        "Team up, manage economy, learn maps, and discover that your crosshair placement becomes a personality trait after a few matches.",
        requirements(ram="8 GB", gpu="NVIDIA GTX 1060 / AMD RX 580", storage="85 GB"),
    ),
}


DEMO_USERS = [
    {"username": "VoldemortFan69", "email": "voldemortfan69@playnext.local", "password": "demo12345", "genres": ["RPG", "Adventure"]},
    {"username": "NapoleonTinyButMighty", "email": "napoleon@playnext.local", "password": "demo12345", "genres": ["Strategy", "Action"]},
    {"username": "GravityGuruNewton", "email": "newton@playnext.local", "password": "demo12345", "genres": ["Puzzle", "Story Rich"]},
    {"username": "PixelWanderer", "email": "pixel@playnext.local", "password": "demo12345", "genres": ["Adventure", "Open World"]},
    {"username": "FactoryOverlord", "email": "factory@playnext.local", "password": "demo12345", "genres": ["Strategy", "Simulation"]},
    {"username": "QuestGoblin", "email": "goblin@playnext.local", "password": "demo12345", "genres": ["RPG", "Open World"]},
    {"username": "SuspiciousBarrel", "email": "barrel@playnext.local", "password": "demo12345", "genres": ["Horror", "Puzzle"]},
    {"username": "StealthIntern", "email": "stealth@playnext.local", "password": "demo12345", "genres": ["Stealth", "Action"]},
    {"username": "LaggingPhilosopher", "email": "lag@playnext.local", "password": "demo12345", "genres": ["Competitive", "Shooter"]},
]


REVIEW_OVERRIDES = {
    "Hogwarts Legacy": [
        ("VoldemortFan69", 4, "The game is great... but why do not I have a nose after choosing a character?"),
        ("NapoleonTinyButMighty", 3, "Trolls attack suddenly, like the Russian frost in 1812."),
        ("GravityGuruNewton", 5, "Hogwarts completely ignores my laws, and somehow I still respect the castle."),
        ("QuestGoblin", 5, "I went to learn magic and accidentally enrolled in Inventory Management 101."),
    ],
    "Factorio": [
        ("FactoryOverlord", 5, "I installed it for one evening and left three days later with conveyor belts in my dreams."),
        ("GravityGuruNewton", 5, "The factory must grow. I am not sure who said it first, but I now obey."),
        ("QuestGoblin", 4, "Very relaxing, if your idea of relaxing is arguing with iron plates."),
    ],
    "Counter-Strike 2": [
        ("LaggingPhilosopher", 4, "I peeked mid and discovered both mortality and bad Wi-Fi."),
        ("NapoleonTinyButMighty", 5, "A tactical masterpiece, especially when everyone ignores the tactic."),
        ("StealthIntern", 4, "The enemy cannot see me if I miss every shot and confuse them emotionally."),
    ],
    "Portal 2": [
        ("GravityGuruNewton", 5, "Portals are illegal according to my paperwork, but I enjoyed the violation."),
        ("SuspiciousBarrel", 5, "The cake jokes aged better than most of my group projects."),
        ("PixelWanderer", 5, "Every puzzle made me feel smart exactly three seconds after feeling hopeless."),
    ],
    "Grand Theft Auto V": [
        ("NapoleonTinyButMighty", 5, "No plan survives contact with Los Santos traffic."),
        ("PixelWanderer", 4, "I started a mission and somehow spent an hour choosing a car I immediately crashed."),
        ("QuestGoblin", 4, "The city is so alive that even the sidewalks seem personally offended by me."),
    ],
    "Hitman World of Assassination": [
        ("StealthIntern", 5, "A perfect game for people who say 'I have a plan' and then use a fish."),
        ("PixelWanderer", 5, "Every mission makes me feel smart right before I accidentally knock out the wrong person."),
        ("SuspiciousBarrel", 4, "Disguises work so well that I am now suspicious of every waiter in real life."),
    ],
    "Prey": [
        ("GravityGuruNewton", 5, "I no longer trust coffee mugs, chairs, or the concept of safety."),
        ("SuspiciousBarrel", 5, "The mimics turned interior design into a survival mechanic."),
        ("FactoryOverlord", 4, "Great station. Terrible workplace safety policy."),
    ],
    "Rise of the Tomb Raider": [
        ("VoldemortFan69", 4, "The tombs are excellent. The cliffs clearly hate me, but the tombs are excellent."),
        ("QuestGoblin", 5, "I came for treasure and stayed because Lara has better cardio than my entire university group."),
        ("PixelWanderer", 4, "Very pretty snow, very rude enemies, excellent climbing."),
    ],
}


GENERIC_REVIEWS = [
    ("PixelWanderer", 4, "I opened it for a quick session and immediately lost track of time. Suspicious behavior from a game."),
    ("QuestGoblin", 5, "The side content keeps stealing my attention like it pays rent in my brain."),
    ("SuspiciousBarrel", 4, "I do not fully trust the level design, which probably means it is doing a good job."),
    ("StealthIntern", 4, "I tried to play carefully, failed loudly, and still had a great time."),
    ("LaggingPhilosopher", 3, "My skill level says no, but my confidence keeps pressing Play."),
    ("FactoryOverlord", 5, "The gameplay loop is dangerously comfortable. I respect it and fear it."),
    ("VoldemortFan69", 4, "Strong atmosphere, good pacing, and no one asked me about my nose. Perfect."),
    ("NapoleonTinyButMighty", 4, "The game has ambition. I respect ambition, especially when it does not invade Russia."),
    ("GravityGuruNewton", 5, "Physics occasionally disagrees with me, but entertainment wins this round."),
]


def make_game_seed(title, cover_file, genres):
    if title in SPECIAL_TEXT:
        short_description, description, system_requirements = SPECIAL_TEXT[title]
    else:
        genre_text = ", ".join(genres[:3]).lower()
        short_description = f"A {genre_text} experience selected for players looking for a memorable session."
        description = (
            f"{title} brings together {genre_text} ideas with a clear hook, strong atmosphere, "
            "and enough personality to make it easy to discuss after playing. It is a good pick "
            "when you want something recognizable, stylish, and fun to compare with other games in the library."
        )
        storage = "20 GB"
        if "Open World" in genres:
            storage = "70 GB"
        elif "Shooter" in genres:
            storage = "50 GB"
        elif "Horror" in genres:
            storage = "15 GB"
        system_requirements = requirements(storage=storage)

    return {
        "title": title,
        "short_description": short_description,
        "description": description,
        "system_requirements": system_requirements,
        "cover_path": f"/covers/{cover_file}",
        "genres": genres,
    }


GAME_SEEDS = [make_game_seed(title, cover_file, genres) for title, cover_file, genres in GAME_CATALOG]


def build_review_seeds():
    review_seeds = []
    for index, game_seed in enumerate(GAME_SEEDS):
        title = game_seed["title"]
        if title in REVIEW_OVERRIDES:
            for username, rating, content in REVIEW_OVERRIDES[title]:
                review_seeds.append({"game": title, "username": username, "rating": rating, "content": content})
            continue

        for offset in range(3):
            username, rating, content = GENERIC_REVIEWS[(index + offset) % len(GENERIC_REVIEWS)]
            review_seeds.append({"game": title, "username": username, "rating": rating, "content": content})

    return review_seeds


REVIEW_SEEDS = build_review_seeds()


def seed_database(db):
    genre_by_name = {}
    for genre_name in GENRE_NAMES:
        genre = db.query(Genre).filter(Genre.name == genre_name).first()
        if genre is None:
            genre = Genre(name=genre_name)
            db.add(genre)
        genre_by_name[genre_name] = genre

    db.flush()

    game_by_title = {}
    for game_seed in GAME_SEEDS:
        game = db.query(Game).filter(Game.title == game_seed["title"]).first()
        if game is None:
            game = Game(title=game_seed["title"])
            db.add(game)

        game.short_description = game_seed["short_description"]
        game.description = game_seed["description"]
        game.system_requirements = game_seed["system_requirements"]
        game.cover_path = game_seed["cover_path"]
        game.genres = [genre_by_name[name] for name in game_seed["genres"]]
        game_by_title[game_seed["title"]] = game

    db.flush()

    user_by_username = {}
    for user_seed in DEMO_USERS:
        user = db.query(User).filter(User.email == user_seed["email"]).first()
        if user is None:
            user = User(
                username=user_seed["username"],
                email=user_seed["email"],
                password_hash=hash_password(user_seed["password"]),
                role="player",
            )
            db.add(user)

        user.favorite_genres = [genre_by_name[name] for name in user_seed["genres"]]
        user_by_username[user_seed["username"]] = user

    db.flush()

    for review_seed in REVIEW_SEEDS:
        game = game_by_title[review_seed["game"]]
        user = user_by_username[review_seed["username"]]

        rating = (
            db.query(Rating)
            .filter(Rating.user_id == user.id, Rating.game_id == game.id)
            .first()
        )
        if rating is None:
            rating = Rating(user_id=user.id, game_id=game.id)
            db.add(rating)
        rating.value = review_seed["rating"]
        rating.updated_at = datetime.utcnow()

        review = (
            db.query(Review)
            .filter(Review.user_id == user.id, Review.game_id == game.id)
            .first()
        )
        if review is None:
            review = Review(user_id=user.id, game_id=game.id)
            db.add(review)
        review.content = review_seed["content"]
        review.updated_at = datetime.utcnow()

        existing_log = (
            db.query(ActivityLog)
            .filter(
                ActivityLog.user_id == user.id,
                ActivityLog.action == "seed_review",
                ActivityLog.details == game.title,
            )
            .first()
        )
        if existing_log is None:
            db.add(ActivityLog(user_id=user.id, action="seed_review", details=game.title))

    db.commit()

```

---

