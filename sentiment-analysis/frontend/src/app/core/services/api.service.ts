import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface SentimentDistribution {
  positive: number;
  neutral: number;
  negative: number;
}

export interface SentimentHistoryPoint {
  date: string;
  score: number;
}

export interface PriceHistoryPoint {
  date: string;
  close: number;
}

export interface SentimentNewsItem {
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
  sentiment_score: number;
  sentiment_label: string;
}

export interface TickerSuggestion {
  symbol: string;
  description: string;
  exchange: string;
  currency?: string | null;
}

export interface SentimentAnalysisResponse {
  ticker: string;
  overall_score: number;
  sentiment_label: string;
  distribution: SentimentDistribution;
  confidence: number;
  sources_analyzed: number;
  current_price: number | null;
  price_history: PriceHistoryPoint[];
  sentiment_history: SentimentHistoryPoint[];
  news: SentimentNewsItem[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  health() {
    return this.http.get<{ status: string }>(`${environment.apiBaseUrl}/health`);
  }

  analyzeSentiment(ticker: string, limit = 12) {
    return this.http.get<SentimentAnalysisResponse>(
      `${environment.apiBaseUrl}/sentiment/analyze`,
      {
        params: {
          ticker,
          limit,
        },
      }
    );
  }

  searchTickers(query: string, limit = 20) {
    return this.http.get<TickerSuggestion[]>(`${environment.apiBaseUrl}/tickers/search`, {
      params: {
        q: query,
        limit,
      },
    });
  }
}
