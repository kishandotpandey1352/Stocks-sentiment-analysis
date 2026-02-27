from datetime import datetime, timedelta
from typing import List, Optional
import os
import sqlite3

import requests
import yfinance as yf
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

load_dotenv()

app = FastAPI(title="Net Social API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
TICKER_DB_PATH = os.path.join(DATA_DIR, "tickers.db")

DEFAULT_EXCHANGES = ["US", "L", "NS"]

SENTIMENT_NEGATIVE_MAX = 0.1
SENTIMENT_POSITIVE_MIN = 0.1

scheduler = BackgroundScheduler(timezone="UTC")
sentiment_analyzer = SentimentIntensityAnalyzer()


def get_finnhub_key() -> str:
    return (
        os.getenv("FINNHUB_API_KEY")
        or os.getenv("Finnhub_API_key")
        or os.getenv("FINNHUB_KEY")
        or ""
    )


def ensure_ticker_db() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with sqlite3.connect(TICKER_DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS tickers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                display_symbol TEXT,
                description TEXT,
                exchange TEXT NOT NULL,
                currency TEXT,
                instrument_type TEXT,
                mic TEXT,
                figi TEXT,
                isin TEXT,
                updated_at TEXT NOT NULL,
                UNIQUE(symbol, exchange)
            )
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_tickers_symbol
            ON tickers(symbol)
            """
        )
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_tickers_description
            ON tickers(description)
            """
        )
        conn.commit()


def fetch_finnhub_symbols(exchange: str) -> List[dict]:
    api_key = get_finnhub_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="Finnhub API key is missing.")

    url = "https://finnhub.io/api/v1/stock/symbol"
    resp = requests.get(url, params={"exchange": exchange, "token": api_key}, timeout=30)
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Finnhub API error for {exchange}: {resp.status_code}",
        )
    data = resp.json()
    if not isinstance(data, list):
        raise HTTPException(status_code=502, detail="Finnhub response not a list.")
    return data


def fetch_finnhub_quote(symbol: str) -> dict:
    api_key = get_finnhub_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="Finnhub API key is missing.")

    url = "https://finnhub.io/api/v1/quote"
    resp = requests.get(url, params={"symbol": symbol, "token": api_key}, timeout=30)
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Finnhub quote error for {symbol}: {resp.status_code}",
        )
    return resp.json()


def fetch_finnhub_candles(symbol: str, start_ts: int, end_ts: int) -> dict:
    api_key = get_finnhub_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="Finnhub API key is missing.")

    url = "https://finnhub.io/api/v1/stock/candle"
    resp = requests.get(
        url,
        params={
            "symbol": symbol,
            "resolution": "D",
            "from": start_ts,
            "to": end_ts,
            "token": api_key,
        },
        timeout=30,
    )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Finnhub candle error for {symbol}: {resp.status_code}",
        )
    data = resp.json()
    if data.get("s") != "ok":
        raise HTTPException(status_code=502, detail=f"Finnhub candle error for {symbol}.")
    return data


def fetch_finnhub_company_news(symbol: str, start_date: str, end_date: str) -> List[dict]:
    api_key = get_finnhub_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="Finnhub API key is missing.")

    url = "https://finnhub.io/api/v1/company-news"
    resp = requests.get(
        url,
        params={"symbol": symbol, "from": start_date, "to": end_date, "token": api_key},
        timeout=30,
    )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Finnhub news error for {symbol}: {resp.status_code}",
        )
    data = resp.json()
    if not isinstance(data, list):
        raise HTTPException(status_code=502, detail="Finnhub news response not a list.")
    return data




def upsert_tickers(exchange: str, symbols: List[dict]) -> int:
    now = datetime.utcnow().isoformat()
    rows = []
    for item in symbols:
        symbol = item.get("symbol")
        display_symbol = item.get("displaySymbol") or symbol
        if not symbol:
            continue
        rows.append(
            (
                symbol,
                display_symbol,
                item.get("description", ""),
                exchange,
                item.get("currency"),
                item.get("type"),
                item.get("mic"),
                item.get("figi"),
                item.get("isin"),
                now,
            )
        )

    with sqlite3.connect(TICKER_DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.executemany(
            """
            INSERT INTO tickers (
                symbol,
                display_symbol,
                description,
                exchange,
                currency,
                instrument_type,
                mic,
                figi,
                isin,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol, exchange) DO UPDATE SET
                display_symbol=excluded.display_symbol,
                description=excluded.description,
                currency=excluded.currency,
                instrument_type=excluded.instrument_type,
                mic=excluded.mic,
                figi=excluded.figi,
                isin=excluded.isin,
                updated_at=excluded.updated_at
            """,
            rows,
        )
        conn.commit()
    return len(rows)


def refresh_tickers_job() -> None:
    try:
        ensure_ticker_db()
        for exchange in DEFAULT_EXCHANGES:
            symbols = fetch_finnhub_symbols(exchange)
            upsert_tickers(exchange, symbols)
    except Exception as exc:
        print(f"Ticker refresh job failed: {exc}")


class SentimentDistribution(BaseModel):
    positive: int
    neutral: int
    negative: int


class SentimentHistoryPoint(BaseModel):
    date: str
    score: float


class PriceHistoryPoint(BaseModel):
    date: str
    close: float


def fetch_yahoo_history(symbol: str, days: int) -> List[PriceHistoryPoint]:
    hist = None
    try:
        hist = yf.Ticker(symbol).history(period=f"{days}d", interval="1d", auto_adjust=True)
    except Exception as exc:
        print(f"Yahoo history fetch failed for {symbol}: {exc}")

    if hist is None or hist.empty:
        try:
            hist = yf.download(
                symbol,
                period=f"{days}d",
                interval="1d",
                auto_adjust=True,
                progress=False,
                group_by="column",
                threads=False,
            )
        except Exception as exc:
            print(f"Yahoo download failed for {symbol}: {exc}")
            return []

    if hist is None or hist.empty:
        return fetch_yahoo_chart_history(symbol, days)

    history: List[PriceHistoryPoint] = []
    for index, row in hist.dropna().iterrows():
        close_value = row.get("Close") if hasattr(row, "get") else row["Close"]
        if close_value is None:
            continue
        date_str = index.date().isoformat()
        history.append(PriceHistoryPoint(date=date_str, close=round(float(close_value), 2)))
    if history:
        return history
    return fetch_yahoo_chart_history(symbol, days)


def fetch_yahoo_chart_history(symbol: str, days: int) -> List[PriceHistoryPoint]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    try:
        resp = requests.get(
            url,
            params={"range": f"{days}d", "interval": "1d"},
            headers=headers,
            timeout=30,
        )
    except Exception as exc:
        print(f"Yahoo chart fetch failed for {symbol}: {exc}")
        return []

    if resp.status_code != 200:
        print(f"Yahoo chart error for {symbol}: {resp.status_code}")
        return []

    try:
        payload = resp.json()
    except ValueError as exc:
        print(f"Yahoo chart JSON error for {symbol}: {exc}")
        return []

    result = (payload.get("chart", {}) or {}).get("result") or []
    if not result:
        return []
    chart = result[0] or {}
    timestamps = chart.get("timestamp") or []
    indicators = (chart.get("indicators", {}) or {}).get("quote") or []
    if not indicators:
        return []
    closes = (indicators[0] or {}).get("close") or []
    history: List[PriceHistoryPoint] = []
    for ts, close in zip(timestamps, closes):
        if close is None:
            continue
        try:
            date_str = datetime.utcfromtimestamp(int(ts)).date().isoformat()
            history.append(PriceHistoryPoint(date=date_str, close=round(float(close), 2)))
        except (TypeError, ValueError):
            continue
    return history


def is_valid_candle_data(candle: dict) -> bool:
    if not isinstance(candle, dict):
        return False
    times = candle.get("t") or []
    closes = candle.get("c") or []
    if not isinstance(times, list) or not isinstance(closes, list):
        return False
    if not times or not closes:
        return False
    if len(times) != len(closes):
        return False
    for close in closes:
        try:
            if close is not None and float(close) == float(close):
                return True
        except (TypeError, ValueError):
            continue
    return False


class SentimentNewsItem(BaseModel):
    headline: str
    summary: str
    source: str
    url: str
    datetime: int
    sentiment_score: float
    sentiment_label: str


class SentimentAnalysisResponse(BaseModel):
    ticker: str
    overall_score: float
    sentiment_label: str
    distribution: SentimentDistribution
    confidence: float
    sources_analyzed: int
    current_price: float | None
    price_history: List[PriceHistoryPoint]
    sentiment_history: List[SentimentHistoryPoint]
    news: List[SentimentNewsItem]


class TickerSuggestion(BaseModel):
    symbol: str
    description: str
    exchange: str
    currency: Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/tickers/health")
def ticker_db_health():
    ensure_ticker_db()
    with sqlite3.connect(TICKER_DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM tickers")
        total = cursor.fetchone()[0]
        cursor.execute("SELECT MAX(updated_at) FROM tickers")
        last_updated = cursor.fetchone()[0]

    return {"total": total, "last_updated": last_updated}


@app.on_event("startup")
def on_startup() -> None:
    ensure_ticker_db()
    if not scheduler.running:
        scheduler.add_job(
            refresh_tickers_job,
            CronTrigger(hour=2, minute=0),
            id="daily_ticker_refresh",
            replace_existing=True,
        )
        scheduler.start()


@app.on_event("shutdown")
def on_shutdown() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)


@app.post("/tickers/refresh")
def refresh_tickers(exchanges: str = Query("US,L,NS")):
    ensure_ticker_db()
    exchange_list = [e.strip().upper() for e in exchanges.split(",") if e.strip()]
    if not exchange_list:
        exchange_list = DEFAULT_EXCHANGES

    total = 0
    for exchange in exchange_list:
        symbols = fetch_finnhub_symbols(exchange)
        total += upsert_tickers(exchange, symbols)

    return {"updated": total, "exchanges": exchange_list}


@app.get("/tickers/search", response_model=List[TickerSuggestion])
def search_tickers(q: str = Query("", min_length=0), limit: int = Query(20, ge=1, le=50)):
    ensure_ticker_db()
    term = q.strip().upper()

    with sqlite3.connect(TICKER_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if term:
            like_term = f"%{term}%"
            cursor.execute(
                """
                SELECT symbol, display_symbol, description, exchange, currency
                FROM tickers
                WHERE symbol LIKE ? OR display_symbol LIKE ? OR description LIKE ?
                ORDER BY symbol ASC
                LIMIT ?
                """,
                (like_term, like_term, like_term, limit),
            )
        else:
            cursor.execute(
                """
                SELECT symbol, display_symbol, description, exchange, currency
                FROM tickers
                ORDER BY symbol ASC
                LIMIT ?
                """,
                (limit,),
            )
        rows = cursor.fetchall()

    return [
        TickerSuggestion(
            symbol=row["display_symbol"] or row["symbol"],
            description=row["description"] or "",
            exchange=row["exchange"],
            currency=row["currency"],
        )
        for row in rows
    ]


def label_for_score(score: float) -> str:
    if score >= SENTIMENT_POSITIVE_MIN:
        return "Positive"
    if score <= SENTIMENT_NEGATIVE_MAX:
        return "Negative"
    return "Neutral"


@app.get("/sentiment/analyze", response_model=SentimentAnalysisResponse)
def analyze_sentiment(
    ticker: str = Query(..., min_length=1),
    limit: int = Query(12, ge=6, le=60),
):
    symbol = ticker.upper().strip()
    days = 30
    end_date = datetime.utcnow().date()
    start_date = end_date - timedelta(days=days)
    start_ts = int(datetime.combine(start_date, datetime.min.time()).timestamp())
    end_ts = int(datetime.combine(end_date, datetime.max.time()).timestamp())

    try:
        quote = fetch_finnhub_quote(symbol)
    except HTTPException as exc:
        print(f"Quote fetch failed for {symbol}: {exc.detail}")
        quote = {}

    try:
        candle = fetch_finnhub_candles(symbol, start_ts, end_ts)
    except HTTPException as exc:
        print(f"Candle fetch failed for {symbol}: {exc.detail}")
        candle = {"t": [], "c": []}

    try:
        news_items = fetch_finnhub_company_news(
            symbol,
            start_date.isoformat(),
            end_date.isoformat(),
        )
    except HTTPException as exc:
        print(f"News fetch failed for {symbol}: {exc.detail}")
        news_items = []

    price_history: List[PriceHistoryPoint] = []
    if is_valid_candle_data(candle):
        for ts, close in zip(candle.get("t", []), candle.get("c", [])):
            price_history.append(
                PriceHistoryPoint(
                    date=datetime.utcfromtimestamp(ts).date().isoformat(),
                    close=round(float(close), 2),
                )
            )
    else:
        price_history = fetch_yahoo_history(symbol, days)

    scored_news: List[SentimentNewsItem] = []
    sentiment_scores: List[float] = []
    for item in news_items[:20]:
        headline = item.get("headline") or ""
        summary = item.get("summary") or ""
        text = f"{headline} {summary}".strip()
        score = sentiment_analyzer.polarity_scores(text).get("compound", 0.0)
        sentiment_scores.append(score)
        scored_news.append(
            SentimentNewsItem(
                headline=headline,
                summary=summary,
                source=item.get("source") or "",
                url=item.get("url") or "",
                datetime=int(item.get("datetime") or 0),
                sentiment_score=round(score, 3),
                sentiment_label=label_for_score(score),
            )
        )

    if sentiment_scores:
        overall_score = sum(sentiment_scores) / len(sentiment_scores)
    else:
        overall_score = 0.0

    dist_positive = len([s for s in sentiment_scores if s >= 0.4])
    dist_negative = len([s for s in sentiment_scores if s <= -0.4])
    dist_neutral = len(sentiment_scores) - dist_positive - dist_negative

    sentiment_by_day: dict[str, List[float]] = {}
    for item in scored_news:
        if not item.datetime:
            continue
        day = datetime.utcfromtimestamp(item.datetime).date().isoformat()
        sentiment_by_day.setdefault(day, []).append(item.sentiment_score)

    sentiment_history: List[SentimentHistoryPoint] = []
    for i in range(limit):
        day = (end_date - timedelta(days=limit - 1 - i)).isoformat()
        scores = sentiment_by_day.get(day, [])
        if scores:
            day_score = sum(scores) / len(scores)
        else:
            day_score = 0.0
        sentiment_history.append(SentimentHistoryPoint(date=day, score=round(day_score, 3)))

    if sentiment_scores:
        mean_score = overall_score
        variance = sum((s - mean_score) ** 2 for s in sentiment_scores) / len(sentiment_scores)
        confidence = max(0.0, 1.0 - min(1.0, variance**0.5))
    else:
        confidence = 0.0

    current_price = quote.get("c")
    if current_price is None:
        if price_history:
            current_price = price_history[-1].close
        else:
            price_history = fetch_yahoo_history(symbol, days)
            if price_history:
                current_price = price_history[-1].close

    return SentimentAnalysisResponse(
        ticker=symbol,
        overall_score=round(overall_score, 3),
        sentiment_label=label_for_score(overall_score),
        distribution=SentimentDistribution(
            positive=dist_positive,
            neutral=dist_neutral,
            negative=dist_negative,
        ),
        confidence=round(confidence, 2),
        sources_analyzed=len(sentiment_scores),
        current_price=current_price,
        price_history=price_history,
        sentiment_history=sentiment_history,
        news=scored_news,
    )
