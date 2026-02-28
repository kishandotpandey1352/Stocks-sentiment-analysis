# Net Social Standalone

Standalone net-social feature with an Angular frontend and a FastAPI backend.

## Run backend

1. Create and activate a Python virtual environment: 
    python -m venv sentiment-env

    1.1 Activate the environment:
        sentiment-env\Scripts\activate

2. Install dependencies:

   pip install -r backend/requirements.txt

3. Start the API:

   uvicorn backend.app.main:app --reload --port 8000

   3.1 test the API
   curl http://localhost:8000/health
   curl "http://localhost:8000/sentiment/analyze?ticker=AAPL&analysis_type=sentiment"


## Run frontend

1. Install dependencies:

   cd frontend
   npm install

2. Start the app:

   npm start

Then open your browser at localhost:4200

testing git push

### APIs used
1) NewsAPI

Endpoint: https://newsapi.org/v2/everything
Request (query params in notebook)
q: ticker symbol (e.g., AAPL)
from: date string YYYY-MM-DD
sortBy: publishedAt
language: en
apiKey: your key
pageSize: up to 100
Response (JSON, used fields)
articles[]: each article uses source.name, title, description, url, publishedAt, content
2) Twitter/X API (via Tweepy v2)

Endpoint: https://api.twitter.com/2/tweets/search/recent
Request (query params in notebook)
query: e.g., $AAPL OR #AAPL lang:en -is:retweet
max_results: up to 100
tweet.fields: created_at,public_metrics,text
user.fields: username
Response (JSON, used fields)
data[]: each tweet uses text, created_at, public_metrics.retweet_count, public_metrics.like_count, public_metrics.reply_count
3) Yahoo Finance (via yfinance)

Endpoint: Not called directly in the notebook. yfinance handles internal requests.
Request in notebook
yf.Ticker(ticker).history(period="1mo" | "1d")
Response (used by notebook)
A pandas DataFrame with OHLCV columns: Open, High, Low, Close, Volume
The notebook adds Returns, SMA_20, Volume_SMA
4) Alpha Vantage

Endpoint (standard): https://www.alphavantage.co/query
Request: The notebook imports AlphaVantage but does not show an actual call.
Typical params: function, symbol, apikey, etc.
Response: JSON, structure depends on function (e.g., Time Series (Daily)).
5) Hugging Face model hub (FinBERT)

Endpoint: https://huggingface.co/ProsusAI/finbert
Request: The notebook loads the model via pipeline(...) and downloads weights.
Response: Model artifacts, then local inference outputs like:
[{ "label": "positive|negative|neutral", "score": float }]
6) ngrok (via pyngrok)

Endpoint: Not specified directly in the notebook (handled by pyngrok).
Request/Response: Not explicit; it creates a tunnel and returns a public_url.


Created the frontend app ann backend app
Dockerise both separately and created docker-compose.yml file
Run: 
docker compose up --build
Re-run:
docker compose down
docker compose up --build

## Deployment of the backend:
Here’s a clean step‑by‑step for deploying your FastAPI backend to Fly.io.

1) Install and login

Install flyctl: https://fly.io/docs/flyctl/install/
Login: fly auth login
2) From your backend folder
Go to:

3) Launch the app

During the prompt:

Pick an app name
Pick a region
Say yes to create the config
4) Make sure the app listens on 0.0.0.0:8000
Your Dockerfile should run something like:

5) Set secrets (API keys, etc.)

6) Ensure Fly knows the internal port
Edit fly.toml if needed:

7) Deploy

8) Confirm it’s live

Then hit:

If you want, paste your backend Dockerfile (or the command it runs) and I’ll verify the exact Fly config/port settings for you.