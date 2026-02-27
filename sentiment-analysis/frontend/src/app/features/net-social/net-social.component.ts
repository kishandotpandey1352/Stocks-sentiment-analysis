import { Component, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import {
  ApiService,
  PriceHistoryPoint,
  SentimentHistoryPoint,
  SentimentAnalysisResponse,
  TickerSuggestion,
} from '../../core/services/api.service';

@Component({
  selector: 'app-net-social',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './net-social.component.html',
  styleUrls: ['./net-social.component.css'],
})
export class NetSocialComponent implements OnInit {
  showIntroDetails = true;
  selectedMode: 'dashboard' | 'single' | 'batch' | 'report' | 'demo' = 'dashboard';
  sentimentWatchlistId = 1;
  sentimentTicker = '';
  sentimentLoading = false;
  sentimentError = '';
  sentimentData: SentimentAnalysisResponse | null = null;
  tickerSuggestions: TickerSuggestion[] = [];
  tickerDropdownOpen = false;
  tickerSearchLoading = false;

  batchLoading = false;
  batchError = '';
  maxBatchSize = 6;
  batchResults: Array<{
    ticker: string;
    score: number;
    label: string;
    price: number | null;
  }> = [];
  reportText = '';

  private sentimentRequestId = 0;
  private batchRequestId = 0;
  private tickerSearchRequestId = 0;
  private tickerSearchTimer: number | undefined;

  private readonly chartWidth = 320;
  private readonly chartHeight = 110;
  private readonly chartZoom: Record<'price' | 'sentiment', { start: number; end: number } | null> = {
    price: null,
    sentiment: null,
  };
  activeChartDialog: 'price' | 'sentiment' | null = null;
  chartHover: Record<
    'price' | 'sentiment',
    | {
        index: number;
        x: number;
        y: number;
        label: string;
        value: string;
        boxX: number;
        boxY: number;
        boxWidth: number;
      }
    | null
  > = {
    price: null,
    sentiment: null,
  };

  readonly localWatchlists: Array<{
    id: number;
    name: string;
    description: string;
    isPrivate: boolean;
    stocks: Array<{ symbol: string; name: string }>;
  }> = [
    {
      id: 1,
      name: 'AI Leaders',
      description: 'Large-cap AI beneficiaries',
      isPrivate: true,
      stocks: [
        { symbol: 'NVDA', name: 'NVIDIA Corp' },
        { symbol: 'MSFT', name: 'Microsoft Corp' },
        { symbol: 'META', name: 'Meta Platforms' },
      ],
    },
    {
      id: 2,
      name: 'Mega Cap Core',
      description: 'Core long-term holdings',
      isPrivate: true,
      stocks: [
        { symbol: 'AAPL', name: 'Apple Inc' },
        { symbol: 'AMZN', name: 'Amazon.com Inc' },
        { symbol: 'GOOGL', name: 'Alphabet Inc' },
      ],
    },
    {
      id: 3,
      name: 'Options Flow',
      description: 'High open interest names',
      isPrivate: true,
      stocks: [
        { symbol: 'TSLA', name: 'Tesla Inc' },
        { symbol: 'AMD', name: 'Advanced Micro Devices' },
      ],
    },
  ];

  constructor(private api: ApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    if (this.localWatchlists.length) {
      this.sentimentWatchlistId = this.localWatchlists[0].id;
      this.syncSentimentTicker();
    }
  }

  hideIntroDetails() {
    this.showIntroDetails = false;
  }

  showIntroDetailsOnHover() {
    this.showIntroDetails = true;
  }

  setMode(mode: 'dashboard' | 'single' | 'batch' | 'report' | 'demo') {
    this.selectedMode = mode;
    if (mode === 'dashboard' || mode === 'single') {
      this.batchLoading = false;
    } else {
      this.sentimentLoading = false;
    }
  }

  onSentimentWatchlistChange(id: number) {
    this.sentimentWatchlistId = id;
    this.syncSentimentTicker();
    this.sentimentData = null;
    this.sentimentError = '';
    this.batchResults = [];
    this.batchError = '';
  }

  onSentimentTickerChange(ticker: string) {
    this.sentimentTicker = ticker;
    this.sentimentData = null;
    this.sentimentError = '';
    this.queueTickerSearch(ticker);
  }

  onTickerInputFocus() {
    this.tickerDropdownOpen = true;
    if (this.sentimentTicker) {
      this.queueTickerSearch(this.sentimentTicker);
    }
  }

  onTickerInputBlur() {
    window.setTimeout(() => {
      this.tickerDropdownOpen = false;
      this.cdr.detectChanges();
    }, 150);
  }

  onSelectTickerSuggestion(suggestion: TickerSuggestion) {
    this.sentimentTicker = suggestion.symbol.toUpperCase();
    this.tickerSuggestions = [];
    this.tickerDropdownOpen = false;
  }

  async analyzeSentiment() {
    const ticker = this.sentimentTicker.trim().toUpperCase();
    if (!ticker || this.sentimentLoading) return;

    const requestId = ++this.sentimentRequestId;
    this.sentimentLoading = true;
    this.sentimentError = '';
    this.sentimentData = null;

    try {
      const data = await firstValueFrom(this.api.analyzeSentiment(ticker));
      if (requestId === this.sentimentRequestId) {
        this.sentimentData = data;
      }
    } catch {
      if (requestId === this.sentimentRequestId) {
        this.sentimentError = 'Failed to analyze sentiment.';
      }
    } finally {
      if (requestId === this.sentimentRequestId) {
        this.sentimentLoading = false;
        this.cdr.detectChanges();
      }
    }
  }

  async runBatchAnalysis(useDemo = false) {
    if (this.batchLoading) return;

    const tickers = this.getBatchTickers(useDemo);
    if (!tickers.length) {
      this.batchError = 'No tickers available for batch analysis.';
      return;
    }

    const requestId = ++this.batchRequestId;
    this.batchLoading = true;
    this.batchError = '';
    this.batchResults = [];
    this.reportText = '';

    try {
      for (const ticker of tickers) {
        try {
          const data = await firstValueFrom(
            this.api.analyzeSentiment(ticker)
          );
          if (requestId === this.batchRequestId) {
            this.batchResults.push({
              ticker: data.ticker,
              score: data.overall_score,
              label: data.sentiment_label,
              price: data.current_price,
            });
            this.cdr.detectChanges();
          }
        } catch {
          if (requestId === this.batchRequestId) {
            this.batchError = `Failed to analyze ${ticker}.`;
            this.cdr.detectChanges();
          }
        }
      }

      if (requestId === this.batchRequestId && !this.batchResults.length) {
        this.batchError = this.batchError || 'No batch results available.';
      }
    } finally {
      if (requestId === this.batchRequestId) {
        this.batchLoading = false;
        this.cdr.detectChanges();
      }
    }
  }

  async generateMarketReport() {
    if (!this.batchResults.length) {
      await this.runBatchAnalysis(false);
    }
    if (!this.batchResults.length) return;
    this.reportText = this.buildReportText();
  }

  downloadReport() {
    if (!this.reportText) return;
    const blob = new Blob([this.reportText], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sentiment-report-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  downloadAnalysisPdf() {
    if (!this.sentimentData) return;
    const lines = this.buildAnalysisReportLines();
    const blob = this.buildPdfBlob(
      lines,
      this.sentimentData,
      this.priceSeriesPath,
      this.sentimentSeriesPath
    );
    const url = window.URL.createObjectURL(blob);
    const fileDate = new Date().toISOString().slice(0, 10);
    const ticker = this.sentimentData.ticker.toUpperCase();
    const link = document.createElement('a');
    link.href = url;
    link.download = `sentiment-analysis-${ticker}-${fileDate}.pdf`;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  get sentimentWatchlist() {
    return this.localWatchlists.find((w) => w.id === this.sentimentWatchlistId);
  }

  get sentimentTickers() {
    return this.sentimentWatchlist?.stocks ?? [];
  }

  get sentimentDistributionTotal() {
    const dist = this.sentimentData?.distribution;
    if (!dist) return 0;
    return dist.positive + dist.neutral + dist.negative;
  }

  get sentimentScoreDisplay() {
    if (!this.sentimentData) return '0.000';
    return this.sentimentData.overall_score.toFixed(3);
  }

  get gaugeAngle() {
    const score = this.sentimentData?.overall_score ?? 0;
    const clamped = Math.max(-1, Math.min(1, score));
    const neutralMax = 0.2;
    const neutralMin = 0.1;
    const neutralSpan = 20;

    if (clamped >= neutralMax) {
      const ratio = (clamped - neutralMax) / (1 - neutralMax);
      return ratio * 60;
    }

    if (clamped <= neutralMin) {
      const ratio = (neutralMin - clamped) / (1 + neutralMin);
      return ratio * -60;
    }

    const neutralRatio = (clamped - neutralMin) / (neutralMax - neutralMin);
    return neutralRatio * neutralSpan - neutralSpan / 2;
  }

  get gaugeLabel() {
    return this.sentimentData?.sentiment_label ?? 'Neutral';
  }

  get batchAverageScore() {
    if (!this.batchResults.length) return 0;
    return (
      this.batchResults.reduce((sum, r) => sum + r.score, 0) /
      this.batchResults.length
    );
  }

  get batchMostPositive() {
    if (!this.batchResults.length) return null;
    return this.batchResults.reduce((max, r) => (r.score > max.score ? r : max));
  }

  get batchMostNegative() {
    if (!this.batchResults.length) return null;
    return this.batchResults.reduce((min, r) => (r.score < min.score ? r : min));
  }

  get priceSeriesPath() {
    return this.buildLinePath(
      this.getVisibleData('price', this.sentimentData?.price_history ?? []),
      (point) => point.close,
      this.chartWidth,
      this.chartHeight
    );
  }

  get priceXAxisLabels() {
    return this.buildXAxisLabels(
      this.getVisibleData('price', this.sentimentData?.price_history ?? []),
      this.chartWidth
    );
  }

  get priceYAxisLabels() {
    return this.buildYAxisLabels(
      this.getVisibleData('price', this.sentimentData?.price_history ?? []),
      (point) => point.close,
      this.chartHeight
    );
  }

  get sentimentSeriesPath() {
    return this.buildLinePath(
      this.getVisibleData('sentiment', this.sentimentData?.sentiment_history ?? []),
      (point) => point.score,
      this.chartWidth,
      this.chartHeight
    );
  }

  get sentimentXAxisLabels() {
    return this.buildXAxisLabels(
      this.getVisibleData('sentiment', this.sentimentData?.sentiment_history ?? []),
      this.chartWidth
    );
  }

  onChartHover(event: MouseEvent, kind: 'price' | 'sentiment') {
    if (kind === 'price') {
      const data = this.getChartData('price');
      if (!data.length) return;
      const points = this.buildChartPoints('price', data);
      if (!points.length) return;

      const svg = event.currentTarget as SVGElement | null;
      const rect = svg?.getBoundingClientRect();
      if (!rect) return;
      const localX = ((event.clientX - rect.left) / rect.width) * this.chartWidth;

      const step = this.chartWidth / Math.max(points.length - 1, 1);
      const index = Math.max(0, Math.min(points.length - 1, Math.round(localX / step)));
      const point = points[index];
      if (!point) return;

      const valueText = `$${point.value.toFixed(2)}`;
      const label = this.formatShortDate(point.date);
      const labelText = `${label}`;
      const valueLine = `${valueText}`;
      const textLength = Math.max(labelText.length, valueLine.length);
      const boxWidth = Math.max(64, textLength * 6 + 12);
      const boxHeight = 28;
      const offsetX = point.x > this.chartWidth * 0.65 ? -boxWidth - 8 : 8;
      const boxX = Math.max(4, Math.min(this.chartWidth - boxWidth - 4, point.x + offsetX));
      const boxY = Math.max(6, point.y - boxHeight - 8);

      this.chartHover.price = {
        index: point.rawIndex,
        x: point.x,
        y: point.y,
        label: labelText,
        value: valueLine,
        boxX,
        boxY,
        boxWidth,
      };
      return;
    }

    const data = this.getChartData('sentiment');
    if (!data.length) return;
    const points = this.buildChartPoints('sentiment', data);
    if (!points.length) return;

    const svg = event.currentTarget as SVGElement | null;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    const localX = ((event.clientX - rect.left) / rect.width) * this.chartWidth;

    const step = this.chartWidth / Math.max(points.length - 1, 1);
    const index = Math.max(0, Math.min(points.length - 1, Math.round(localX / step)));
    const point = points[index];
    if (!point) return;

    const valueText = point.value.toFixed(3);
    const label = this.formatShortDate(point.date);
    const labelText = `${label}`;
    const valueLine = `${valueText}`;
    const textLength = Math.max(labelText.length, valueLine.length);
    const boxWidth = Math.max(64, textLength * 6 + 12);
    const boxHeight = 28;
    const offsetX = point.x > this.chartWidth * 0.65 ? -boxWidth - 8 : 8;
    const boxX = Math.max(4, Math.min(this.chartWidth - boxWidth - 4, point.x + offsetX));
    const boxY = Math.max(6, point.y - boxHeight - 8);

    this.chartHover.sentiment = {
      index: point.rawIndex,
      x: point.x,
      y: point.y,
      label: labelText,
      value: valueLine,
      boxX,
      boxY,
      boxWidth,
    };
  }

  onChartLeave(kind: 'price' | 'sentiment') {
    this.chartHover[kind] = null;
  }

  onChartDoubleClick(event: MouseEvent, kind: 'price' | 'sentiment') {
    if (kind === 'price') {
      const data = this.getChartData('price');
      if (!data.length) return;

      if (this.chartZoom.price) {
        this.chartZoom.price = null;
        this.chartHover.price = null;
        return;
      }

      const points = this.buildChartPoints('price', data);
      if (!points.length) return;

      const svg = event.currentTarget as SVGElement | null;
      const rect = svg?.getBoundingClientRect();
      if (!rect) return;
      const localX = ((event.clientX - rect.left) / rect.width) * this.chartWidth;
      const step = this.chartWidth / Math.max(points.length - 1, 1);
      const visibleIndex = Math.max(0, Math.min(points.length - 1, Math.round(localX / step)));
      const rawIndex = points[visibleIndex].rawIndex;

      const windowSize = Math.max(5, Math.floor(data.length * 0.35));
      const half = Math.floor(windowSize / 2);
      let start = Math.max(0, rawIndex - half);
      let end = Math.min(data.length - 1, start + windowSize - 1);
      start = Math.max(0, end - windowSize + 1);

      this.chartZoom.price = { start, end };
      this.onChartHover(event, 'price');
      return;
    }

    const data = this.getChartData('sentiment');
    if (!data.length) return;

    if (this.chartZoom.sentiment) {
      this.chartZoom.sentiment = null;
      this.chartHover.sentiment = null;
      return;
    }

    const points = this.buildChartPoints('sentiment', data);
    if (!points.length) return;

    const svg = event.currentTarget as SVGElement | null;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    const localX = ((event.clientX - rect.left) / rect.width) * this.chartWidth;
    const step = this.chartWidth / Math.max(points.length - 1, 1);
    const visibleIndex = Math.max(0, Math.min(points.length - 1, Math.round(localX / step)));
    const rawIndex = points[visibleIndex].rawIndex;

    const windowSize = Math.max(5, Math.floor(data.length * 0.35));
    const half = Math.floor(windowSize / 2);
    let start = Math.max(0, rawIndex - half);
    let end = Math.min(data.length - 1, start + windowSize - 1);
    start = Math.max(0, end - windowSize + 1);

    this.chartZoom.sentiment = { start, end };
    this.onChartHover(event, 'sentiment');
  }

  onOpenChartDialog(kind: 'price' | 'sentiment') {
    this.activeChartDialog = kind;
    this.applyDefaultZoom(kind);
    this.chartHover[kind] = null;
  }

  closeChartDialog() {
    if (!this.activeChartDialog) return;
    const kind = this.activeChartDialog;
    this.chartZoom[kind] = null;
    this.chartHover[kind] = null;
    this.activeChartDialog = null;
  }

  private syncSentimentTicker() {
    const tickers = this.sentimentTickers;
    this.sentimentTicker = tickers.length ? tickers[0].symbol : '';
  }

  private queueTickerSearch(query: string) {
    if (this.tickerSearchTimer) {
      window.clearTimeout(this.tickerSearchTimer);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      this.tickerSuggestions = [];
      return;
    }

    this.tickerSearchTimer = window.setTimeout(() => {
      this.fetchTickerSuggestions(trimmed);
    }, 250);
  }

  private async fetchTickerSuggestions(query: string) {
    const requestId = ++this.tickerSearchRequestId;
    this.tickerSearchLoading = true;

    try {
      const suggestions = await firstValueFrom(this.api.searchTickers(query, 20));
      if (requestId === this.tickerSearchRequestId) {
        this.tickerSuggestions = suggestions;
        this.tickerDropdownOpen = true;
      }
    } catch {
      if (requestId === this.tickerSearchRequestId) {
        this.tickerSuggestions = [];
      }
    } finally {
      if (requestId === this.tickerSearchRequestId) {
        this.tickerSearchLoading = false;
        this.cdr.detectChanges();
      }
    }
  }

  private getBatchTickers(useDemo: boolean) {
    const watchlistTickers = this.sentimentTickers.map((s) => s.symbol);
    const fallback = ['AAPL', 'MSFT', 'NVDA'];
    const base = watchlistTickers.length ? watchlistTickers : fallback;
    const list = useDemo ? base.slice(0, 3) : base.slice(0, this.maxBatchSize);
    return list.map((t) => t.toUpperCase());
  }

  private buildReportText() {
    const avg = this.batchAverageScore.toFixed(3);
    const mostPositive = this.batchMostPositive;
    const mostNegative = this.batchMostNegative;
    const lines = [
      'FINANCIAL SENTIMENT ANALYSIS REPORT',
      '===================================',
      `Generated: ${new Date().toLocaleString()}`,
      'Analysis Type: Sentiment',
      '',
      `Average Sentiment Score: ${avg}`,
      mostPositive
        ? `Most Positive: ${mostPositive.ticker} (${mostPositive.score.toFixed(3)})`
        : 'Most Positive: N/A',
      mostNegative
        ? `Most Negative: ${mostNegative.ticker} (${mostNegative.score.toFixed(3)})`
        : 'Most Negative: N/A',
      '',
      'Ticker Summary:',
    ];

    for (const row of this.batchResults) {
      const price = row.price === null ? 'n/a' : `$${row.price.toFixed(2)}`;
      lines.push(
        `${row.ticker.padEnd(6)} | ${row.label.padEnd(8)} | ${row.score.toFixed(3)} | ${price}`
      );
    }

    return lines.join('\n');
  }

  private buildAnalysisReportLines() {
    if (!this.sentimentData) return [] as string[];
    const data = this.sentimentData;
    const price = data.current_price === null ? 'n/a' : `$${data.current_price.toFixed(2)}`;
    const lines = [
      'FINANCIAL SENTIMENT ANALYSIS REPORT',
      '===================================',
      `Generated: ${new Date().toLocaleString()}`,
      `Ticker: ${data.ticker}`,
      'Analysis Type: Sentiment',
      `Overall Score: ${data.overall_score.toFixed(3)}`,
      `Label: ${data.sentiment_label}`,
      `Confidence: ${data.confidence.toFixed(2)}`,
      `Sources Analyzed: ${data.sources_analyzed}`,
      `Current Price: ${price}`,
      '',
      'Distribution:',
      `Positive: ${data.distribution.positive}`,
      `Neutral: ${data.distribution.neutral}`,
      `Negative: ${data.distribution.negative}`,
      '',
      'Recent Headlines:',
    ];

    if (!data.news.length) {
      lines.push('n/a');
    } else {
      const maxHeadlines = 6;
      for (const item of data.news.slice(0, maxHeadlines)) {
        const score = item.sentiment_score.toFixed(2);
        lines.push(`- ${item.headline} (${item.sentiment_label}, ${score})`);
      }
    }

    return lines;
  }

  private buildPdfBlob(
    lines: string[],
    sentimentData: SentimentAnalysisResponse | null,
    pricePath = '',
    sentimentPath = ''
  ) {
    const wrapped = lines.flatMap((line) => this.wrapPdfText(line, 92));
    const displayLines = wrapped.slice(0, 20);
    const textBlock = [
      'BT',
      '/F1 12 Tf',
      '72 720 Td',
      '14 TL',
      displayLines
        .map((line) => `(${this.escapePdfText(line)}) Tj`)
        .join('\nT*\n'),
      'ET',
    ].join('\n');

    const charts = this.buildPdfCharts(sentimentData, pricePath, sentimentPath);
    const contentStream = [textBlock, charts].filter(Boolean).join('\n');

    const encoder = new TextEncoder();
    const contentLength = encoder.encode(contentStream).length;
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj',
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
      `5 0 obj\n<< /Length ${contentLength} >>\nstream\n${contentStream}\nendstream\nendobj`,
    ];

    const parts: string[] = [];
    const offsets: number[] = [0];
    let offset = 0;

    const addPart = (part: string) => {
      const text = `${part}\n`;
      parts.push(text);
      offset += encoder.encode(text).length;
    };

    addPart('%PDF-1.4');
    for (const obj of objects) {
      offsets.push(offset);
      addPart(obj);
    }

    const xrefStart = offset;
    addPart('xref');
    addPart(`0 ${objects.length + 1}`);
    addPart('0000000000 65535 f ');
    for (let i = 1; i < offsets.length; i += 1) {
      const line = `${offsets[i].toString().padStart(10, '0')} 00000 n `;
      addPart(line);
    }
    addPart('trailer');
    addPart(`<< /Size ${objects.length + 1} /Root 1 0 R >>`);
    addPart('startxref');
    addPart(`${xrefStart}`);
    addPart('%%EOF');

    return new Blob(parts, { type: 'application/pdf' });
  }

  private wrapPdfText(line: string, maxLength: number) {
    if (line.length <= maxLength) return [line];
    const words = line.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxLength) {
        current = next;
        continue;
      }

      if (current) {
        lines.push(current);
        current = word;
      } else {
        lines.push(word.slice(0, maxLength));
        current = word.slice(maxLength);
      }
    }

    if (current) {
      lines.push(current);
    }

    return lines;
  }

  private escapePdfText(text: string) {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  private buildPdfCharts(
    sentimentData: SentimentAnalysisResponse | null,
    pricePath: string,
    sentimentPath: string
  ) {
    const pricePoints = this.parseSvgPath(pricePath);
    const sentimentPoints = this.parseSvgPath(sentimentPath);
    if (!sentimentData && !pricePoints.length && !sentimentPoints.length) return '';

    const blocks: string[] = [];
    if (sentimentData) {
      blocks.push(this.renderGaugeBlock(sentimentData, 72, 300));
      blocks.push(this.renderDistributionBlock(sentimentData, 312, 300));
    }
    if (pricePoints.length) {
      const priceXLabels = this.buildXAxisLabels(sentimentData?.price_history ?? [], this.chartWidth);
      const priceYLabels = this.buildYAxisLabels(
        sentimentData?.price_history ?? [],
        (point) => point.close,
        this.chartHeight
      );
      blocks.push(
        this.renderChartBlock(
          'Price Trend',
          pricePoints,
          72,
          160,
          priceXLabels,
          priceYLabels,
          'Time',
          'Price'
        )
      );
    }
    if (sentimentPoints.length) {
      const sentimentXLabels = this.buildXAxisLabels(
        sentimentData?.sentiment_history ?? [],
        this.chartWidth
      );
      const sentimentYLabels = [
        { y: 6, label: '1.0' },
        { y: 55, label: '0.0' },
        { y: 104, label: '-1.0' },
      ];
      blocks.push(
        this.renderChartBlock(
          'Sentiment Trend',
          sentimentPoints,
          72,
          20,
          sentimentXLabels,
          sentimentYLabels,
          'Time',
          'Sentiment'
        )
      );
    }
    return blocks.join('\n');
  }

  private renderChartBlock(
    title: string,
    points: Array<[number, number]>,
    x: number,
    y: number,
    xLabels: Array<{ x: number; label: string }>,
    yLabels: Array<{ y: number; label: string }>,
    xAxisTitle: string,
    yAxisTitle: string
  ) {
    const width = 468;
    const height = 110;
    const xLabelY = y - 6;
    const labelOffset = 8;
    const yAxisTitleX = x - 36;
    const yAxisTitleY = y + height - 8;
    const xAxisTitleX = x + width - 20;
    const xAxisTitleY = y - 18;
    const chart = [
      'q',
      '0.1 0.7 0.68 RG',
      '1 w',
      `${x} ${y} ${width} ${height} re S`,
      '0.9 0.95 0.97 rg',
      '0 0 0 RG',
      `BT /F1 11 Tf ${x} ${y + height + 14} Td (${this.escapePdfText(title)}) Tj ET`,
      'q',
      '0 0 0 RG',
      '/F1 9 Tf',
      ...yLabels.map((label) => {
        const labelY = y + height - (label.y / this.chartHeight) * height + 3;
        const labelX = x - labelOffset;
        return `BT ${labelX} ${labelY} Td (${this.escapePdfText(label.label)}) Tj ET`;
      }),
      ...xLabels.map((label) => {
        const labelX = x + (label.x / this.chartWidth) * width;
        return `BT ${labelX} ${xLabelY} Td (${this.escapePdfText(label.label)}) Tj ET`;
      }),
      `BT /F1 9 Tf ${xAxisTitleX} ${xAxisTitleY} Td (${this.escapePdfText(xAxisTitle)}) Tj ET`,
      `q 1 0 0 1 ${yAxisTitleX} ${yAxisTitleY} cm 0 1 -1 0 0 0 cm BT /F1 9 Tf 0 0 Td (${this.escapePdfText(
        yAxisTitle
      )}) Tj ET Q`,
      'Q',
      'q',
      '0 0 0 RG',
      '1.2 w',
      ...this.renderPolyline(points, x, y, width, height),
      'Q',
      'Q',
    ];

    return chart.join('\n');
  }

  private renderPolyline(points: Array<[number, number]>, x: number, y: number, width: number, height: number) {
    if (!points.length) return [] as string[];
    const scaled = points.map(([px, py]) => [x + (px / 320) * width, y + height - (py / 110) * height]);
    const commands: string[] = [];
    const [startX, startY] = scaled[0];
    commands.push(`${startX.toFixed(2)} ${startY.toFixed(2)} m`);
    for (let i = 1; i < scaled.length; i += 1) {
      const [lineX, lineY] = scaled[i];
      commands.push(`${lineX.toFixed(2)} ${lineY.toFixed(2)} l`);
    }
    commands.push('S');
    return commands;
  }

  private parseSvgPath(path: string) {
    if (!path) return [] as Array<[number, number]>;
    const points: Array<[number, number]> = [];
    const tokens = path.replace(/[ML]/g, '').trim().split(' ');
    for (const token of tokens) {
      const [x, y] = token.split(',').map((value) => Number(value));
      if (Number.isFinite(x) && Number.isFinite(y)) {
        points.push([x, y]);
      }
    }
    return points;
  }

  private renderGaugeBlock(data: SentimentAnalysisResponse, x: number, y: number) {
    const width = 220;
    const height = 120;
    const centerX = x + width / 2;
    const centerY = y + 30;
    const radius = 52;
    const score = Math.max(-1, Math.min(1, data.overall_score));
    const angle = (180 - (score + 1) * 90) * (Math.PI / 180);
    const needleX = centerX + Math.cos(angle) * (radius - 8);
    const needleY = centerY + Math.sin(angle) * (radius - 8);

    const arcs = [
      { start: 180, end: 120, color: '0.94 0.35 0.35 RG' },
      { start: 120, end: 60, color: '0.82 0.76 0.63 RG' },
      { start: 60, end: 0, color: '0.2 0.8 0.6 RG' },
    ];

    const commands: string[] = ['q', '1.5 w'];
    for (const arc of arcs) {
      commands.push(arc.color);
      commands.push(...this.renderArc(centerX, centerY, radius, arc.start, arc.end));
    }
    commands.push('0 0 0 RG');
    commands.push('1 w');
    commands.push(`${centerX.toFixed(2)} ${centerY.toFixed(2)} m`);
    commands.push(`${needleX.toFixed(2)} ${needleY.toFixed(2)} l`);
    commands.push('S');
    commands.push('0.15 0.2 0.25 rg');
    commands.push(`${(centerX - 3).toFixed(2)} ${(centerY - 3).toFixed(2)} 6 6 re f`);
    commands.push('0 0 0 rg');
    commands.push(
      `BT /F1 11 Tf ${x} ${y + height - 6} Td (${this.escapePdfText('Signal Gauge')}) Tj ET`
    );
    commands.push(
      `BT /F1 10 Tf ${x} ${y + 8} Td (${this.escapePdfText(
        `Score ${data.overall_score.toFixed(3)} | ${data.sentiment_label}`
      )}) Tj ET`
    );
    commands.push('Q');
    return commands.join('\n');
  }

  private renderDistributionBlock(data: SentimentAnalysisResponse, x: number, y: number) {
    const width = 228;
    const height = 120;
    const total =
      data.distribution.positive + data.distribution.neutral + data.distribution.negative || 1;
    const rows = [
      { label: 'Positive', value: data.distribution.positive, color: '0.2 0.8 0.6 rg' },
      { label: 'Neutral', value: data.distribution.neutral, color: '0.82 0.76 0.63 rg' },
      { label: 'Negative', value: data.distribution.negative, color: '0.94 0.35 0.35 rg' },
    ];
    const barX = x + 72;
    const barWidth = width - 90;
    const rowHeight = 18;
    const startY = y + height - 26;

    const commands: string[] = ['q'];
    commands.push(
      `BT /F1 11 Tf ${x} ${y + height - 6} Td (${this.escapePdfText('Distribution')}) Tj ET`
    );
    rows.forEach((row, index) => {
      const rowY = startY - index * (rowHeight + 6);
      const ratio = row.value / total;
      const fillWidth = Math.max(2, barWidth * ratio);
      commands.push(`BT /F1 10 Tf ${x} ${rowY + 4} Td (${row.label}) Tj ET`);
      commands.push('0.12 0.16 0.2 rg');
      commands.push(`${barX} ${rowY} ${barWidth} ${rowHeight} re f`);
      commands.push(row.color);
      commands.push(`${barX} ${rowY} ${fillWidth} ${rowHeight} re f`);
      commands.push('0 0 0 rg');
      commands.push(
        `BT /F1 10 Tf ${barX + barWidth + 6} ${rowY + 4} Td (${row.value}) Tj ET`
      );
    });
    commands.push('Q');
    return commands.join('\n');
  }

  private renderArc(centerX: number, centerY: number, radius: number, start: number, end: number) {
    const points: Array<[number, number]> = [];
    const step = 8;
    for (let angle = start; angle >= end; angle -= step) {
      const rad = (angle * Math.PI) / 180;
      points.push([
        centerX + Math.cos(rad) * radius,
        centerY + Math.sin(rad) * radius,
      ]);
    }
    const endRad = (end * Math.PI) / 180;
    points.push([centerX + Math.cos(endRad) * radius, centerY + Math.sin(endRad) * radius]);
    return this.renderPolylineRaw(points);
  }

  private renderPolylineRaw(points: Array<[number, number]>) {
    if (!points.length) return [] as string[];
    const commands: string[] = [];
    const [startX, startY] = points[0];
    commands.push(`${startX.toFixed(2)} ${startY.toFixed(2)} m`);
    for (let i = 1; i < points.length; i += 1) {
      const [lineX, lineY] = points[i];
      commands.push(`${lineX.toFixed(2)} ${lineY.toFixed(2)} l`);
    }
    commands.push('S');
    return commands;
  }

  private buildLinePath<T>(
    data: T[],
    valueSelector: (point: T) => number,
    width = 320,
    height = 110
  ) {
    if (!data.length) return '';
    const values = data
      .map((point) => Number(valueSelector(point)))
      .filter((v) => Number.isFinite(v));
    if (!values.length) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const step = width / Math.max(values.length - 1, 1);

    return values
      .map((value, index) => {
        const x = index * step;
        const y = height - ((value - min) / range) * height;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  private buildXAxisLabels(
    data: Array<{ date: string }>,
    width = 320
  ) {
    if (!data.length) return [] as Array<{ x: number; label: string }>;
    const lastIndex = data.length - 1;
    const midIndex = Math.floor(lastIndex / 2);
    const points = [0, midIndex, lastIndex];
    const step = width / Math.max(lastIndex, 1);

    return points.map((index) => ({
      x: index * step,
      label: this.formatShortDate(data[index].date),
    }));
  }

  private buildYAxisLabels<T>(
    data: T[],
    valueSelector: (point: T) => number,
    height = 110
  ) {
    if (!data.length) return [] as Array<{ y: number; label: string }>;
    const values = data
      .map((point) => Number(valueSelector(point)))
      .filter((value) => Number.isFinite(value));
    if (!values.length) return [] as Array<{ y: number; label: string }>;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const mid = (min + max) / 2;
    const format = (value: number) => value.toFixed(2);

    return [
      { y: 6, label: format(max) },
      { y: 55, label: format(mid) },
      { y: 104, label: format(min) },
    ];
  }

  private formatShortDate(value: string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString(undefined, {
      month: 'short',
      day: '2-digit',
    });
  }

  private getChartData(kind: 'price'): PriceHistoryPoint[];
  private getChartData(kind: 'sentiment'): SentimentHistoryPoint[];
  private getChartData(kind: 'price' | 'sentiment') {
    return kind === 'price'
      ? this.sentimentData?.price_history ?? []
      : this.sentimentData?.sentiment_history ?? [];
  }

  private getVisibleData<T>(kind: 'price' | 'sentiment', data: T[]) {
    const zoom = this.chartZoom[kind];
    if (!zoom) return data;
    const start = Math.max(0, Math.min(zoom.start, data.length - 1));
    const end = Math.max(start, Math.min(zoom.end, data.length - 1));
    return data.slice(start, end + 1);
  }

  private applyDefaultZoom(kind: 'price' | 'sentiment') {
    if (kind === 'price') {
      const data = this.getChartData('price');
      if (!data.length) return;
      this.chartZoom.price = this.buildDefaultZoomWindow(data.length);
      return;
    }

    const data = this.getChartData('sentiment');
    if (!data.length) return;
    this.chartZoom.sentiment = this.buildDefaultZoomWindow(data.length);
  }

  private buildDefaultZoomWindow(length: number) {
    const windowSize = Math.max(5, Math.floor(length * 0.35));
    const half = Math.floor(windowSize / 2);
    const center = Math.floor(length / 2);
    let start = Math.max(0, center - half);
    let end = Math.min(length - 1, start + windowSize - 1);
    start = Math.max(0, end - windowSize + 1);
    return { start, end };
  }

  private buildChartPoints(
    kind: 'price',
    data: PriceHistoryPoint[]
  ): Array<{ x: number; y: number; value: number; rawIndex: number; date: string }>;
  private buildChartPoints(
    kind: 'sentiment',
    data: SentimentHistoryPoint[]
  ): Array<{ x: number; y: number; value: number; rawIndex: number; date: string }>;
  private buildChartPoints(
    kind: 'price' | 'sentiment',
    data: Array<PriceHistoryPoint | SentimentHistoryPoint>
  ) {
    const selector = (point: any) => (kind === 'price' ? point.close : point.score);
    const zoom = this.chartZoom[kind];
    const start = zoom ? Math.max(0, Math.min(zoom.start, data.length - 1)) : 0;
    const end = zoom ? Math.max(start, Math.min(zoom.end, data.length - 1)) : data.length - 1;
    const visible = data.slice(start, end + 1) as Array<{ date: string }>;
    if (!visible.length) return [] as Array<{ x: number; y: number; value: number; rawIndex: number; date: string }>;

    const values = visible
      .map((point) => Number(selector(point)))
      .filter((value) => Number.isFinite(value));
    if (!values.length) return [] as Array<{ x: number; y: number; value: number; rawIndex: number; date: string }>;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const step = this.chartWidth / Math.max(visible.length - 1, 1);

    return visible.map((point: any, index) => {
      const value = Number(selector(point));
      const x = index * step;
      const y = this.chartHeight - ((value - min) / range) * this.chartHeight;
      return {
        x,
        y,
        value,
        rawIndex: start + index,
        date: point.date,
      };
    });
  }
}
