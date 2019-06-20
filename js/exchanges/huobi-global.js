import ReWS from 'reconnecting-websocket';
import Exchanges from './baseExchange';
import pako from 'pako';


export default class HitBTC extends Exchanges {
  constructor(proxy) {
    super();
    this.name = 'HitBTC';
    this._mainUrl = 'wss://api.huobi.pro/ws';
    this._sockets = {};

    this._proxy = proxy;
    this._proxy_enable = !!proxy;
    this.BASE = `${this._proxy_enable ? this._proxy : ''}https://api.hitbtc.com`;

    this.streams = {
      depth: symbol =>
        JSON.stringify({ 'sub': `market.${symbol}.depth.step0`, 'id': '133' }),
      depthLevel: symbol =>
        `${this._proxy_enable ? this._proxy : ''}https://api.huobi.pro/market/depth?symbol=${symbol}&type=step0`,
      trade: symbol =>
        JSON.stringify({ 'sub': `market.${symbol}.trade.detail`, 'id': '133' }),
      kline: (symbol, interval) =>
        JSON.stringify({ 'sub': `market.${symbol}.kline.${this.times[interval]}`, 'id': '123' }),
    };

    this.times = {
      '1': '1min',
      '5': '5min',
      '15': '15min',
      '30': '30min',
      '60': '60min',
      '1D': '1day',
      '1W': '1week',
    };


    this.ms = {
      '1': 60 * 1000,
      '5': 5 * 60 * 1000,
      '15': 15 * 60 * 1000,
      '30': 30 * 60 * 1000,
      '60': 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 1000,
      '1W': 7 * 24 * 60 * 60 * 1000,
    };

    this.stable_coins = ['USDT', 'HUSD'];

    this.status = {
      new: 'open',
      suspended: 'open',
      partiallyFilled: 'open',
      filled: 'closed',
      canceled: 'canceled',
      expired: 'canceled',
    };
  }

  getExchangeConfig() {
    return {
      exchange: {
        isActive: true,
        componentList: ['open', 'history', 'balance'],
        orderTypes: ['limit', 'market'],
      },
      margin: {
        isActive: false,
      },
      intervals: this.getSupportedInterval(),
    };
  }

  _setupWebSocket(eventHandler, path, type) {
    if (this._sockets[type]) {
      this._sockets[type].close();
    }

    const ws = new ReWS(this._mainUrl, [], {
      WebSocket: this.websocket,
      connectionTimeout: 5000,
      debug: false,
    });

    ws.onopen = () => ws.send(path);

    ws.onmessage = (e) => {

      let reader = new FileReader();
      reader.onload = () => {
        const res = JSON.parse(pako.inflate(reader.result, { to: 'string' }));
        eventHandler(res);
      };
      reader.readAsBinaryString(e.data);
    };

    this._sockets[type] = ws;
    return ws;
  }

  closeTrade() {
    if (this._sockets.trade) this._sockets.trade.close();
  }

  closeOB() {
    if (this._sockets.orderbook) this._sockets.orderbook.close();
  }

  closeKline() {
    if (this._sockets.kline) this._sockets.kline.close();
  }


  onTrade(symbol, eventHandler) {
    const newSymbol = symbol.replace('/', '').toLowerCase();

    const handler = res => {
      if (res.hasOwnProperty('tick')) {
        res = res.tick.data;
        res.forEach(e => {
          const data = new Date(e.timestamp);
          const trade = {
            id: e.id,
            side: e.direction,
            timestamp: e.ts,
            price: +e.price,
            amount: +e.amount,
            symbol,
            exchange: 'huobi-global',
          };
          eventHandler(trade);
        });
      }
    };

    return this._setupWebSocket(handler, this.streams.trade(newSymbol), 'trade');
  }

  onDepthUpdate(symbol, eventHandler) {
    const newSymbol = symbol.replace('/', '').toLowerCase();
    let SnapshotAccepted = false;
    const uBuffer = {
      asks: [],
      bids: [],
      type: 'update',
      exchange: 'hitbtc',
      symbol,
    };
    const handler = res => {
      if (res.hasOwnProperty('tick')) {
        const data = {
          asks: [],
          bids: [],
          type: 'snapshot',
          exchange: 'huobi-global',
          symbol,
        };
        res = res.tick;
        res.asks.forEach(r => data.asks.push([+r[0], +r[1]]));
        res.bids.forEach(r => data.bids.push([+r[0], +r[1]]));

        eventHandler(data);
      }
    };
    this._setupWebSocket(handler, this.streams.depth(newSymbol), 'orderbook');
  }

  onKline(symbol, interval, eventHandler) {
    const newSymbol = symbol.replace('/', '').toLowerCase();

    const handler = data => {
      if (data.hasOwnProperty('tick')) {
        data = data.tick;
        const newData = {
          close: +data.close,
          high: +data.high,
          low: +data.low,
          open: +data.open,
          time: data.id * 1000,
          volume: +data.amount,
        };
        eventHandler(newData);
      }
    };
    return this._setupWebSocket(handler, this.streams.kline(newSymbol, interval), 'kline');
  }

  async getPairs() {
    return await fetch(
      `${this._proxy_enable ? this._proxy : 'https://api.huobi.pro/market/tickers'}`,
    )
      .then(r => r.json())
      .then(r => {
        const pairs = {
          BTC: [],
          ALT: [],
          STABLE: [],
        };
        const fullList = {};
        r.data.forEach(pair => {
          let numSub = 3;
          if (pair.symbol.endsWith('ht')) numSub = 2;
          if (pair.symbol.endsWith('usdt') || pair.symbol.endsWith('husd')) numSub = 4;

          const base = pair.symbol.substr(pair.symbol.length - numSub);
          const target = pair.symbol.substr(0, pair.symbol.length - numSub);
          const symbol = `${target}/${base}`;
          const data = {
            symbol,
            volume: pair.vol,
            priceChangePercent: 100 - (pair.close / pair.open) * 100,
            price: pair.close,
            high: pair.high,
            low: pair.low,
            quote: target,
            base,
            maxLeverage: 0,
            tickSize: 0,
          };
          if (data.price !== 0) {
            if (base === 'BTC') {
              pairs[base].push(data);
            } else if (this.stable_coins.indexOf(base) !== -1) {
              pairs.STABLE.push(data);
            } else {
              pairs.ALT.push(data);
            }
            fullList[symbol] = data;
          }
        });
        return [pairs, fullList];
      });
  }

  async getKline(pair = 'BTC/USD', interval = 60, start, end) {
    const symbol = pair.replace('/', '').toLowerCase();

    return fetch(
      `${
        this._proxy_enable ? this._proxy : ''
        }https://api.huobi.pro/market/history/kline?period=${this.times[interval]}&size=2000&symbol=${symbol}`,
    )
      .then(r => r.json())
      .then(r => {
        const newCandles = [];
        r.data.forEach(obj => {
          newCandles.push({
            time: obj.id * 1000,
            open: +obj.open,
            high: +obj.high,
            low: +obj.low,
            close: +obj.close,
            volume: +obj.vol,
          });
        });
        return newCandles.reverse();
      });
  }

}
