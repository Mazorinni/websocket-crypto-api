import ReWS from 'reconnecting-websocket';
import baseExchange from './baseExchange';

export default class Poloniex extends baseExchange {
  constructor(proxy) {
    super();
    this.name = 'OKEx';
    this._mainUrl = 'wss://api2.poloniex.com';
    this._sockets = {};
    this.listUrl = 'https://poloniex.com/public?command=returnTicker';

    this.stable_coins = ['USDT', 'USDC'];

    this.streams = {
      depth: symbol =>
        JSON.stringify({
          command: 'subscribe',
          channel: symbol,
        }),
      depthLevel: (symbol, level) =>
        `https://poloniex.com/public?command=returnOrderBook&currencyPair=${symbol}&depth=${level}`,
      kline: (symbol, time, interval) =>
        `https://poloniex.com/public?command=returnChartData&currencyPair=${symbol}&start=${time}&end=9999999999&period=${interval}`,
      trade: symbol =>
        JSON.stringify({
          command: 'subscribe',
          channel: symbol,
        }),
      ticker: symbol =>
        JSON.stringify({
          command: 'subscribe',
          channel: symbol,
        }),
    };

    this.times = {
      '5': 5 * 60,
      '15': 15 * 60,
      '30': 30 * 60,
      '120': 2 * 60 * 60,
      '240': 4 * 60 * 60,
      '1D': 24 * 60 * 60,
    };

    this._proxy = proxy;
    this._proxy_enable = !!proxy;
  }

  getOrderTypes() {
    return ['market', 'limit'];
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

    ws.onmessage = event => {
      const res = JSON.parse(event.data);
      eventHandler(res);
    };

    this._sockets[type] = ws;
    return ws;
  }

  _setupWebSocketEmulator(eventHandler, path, type) {
    if (this._sockets[type]) {
      clearInterval(this._sockets[type]);
    }
    this._sockets[type] = setInterval(() => {
      fetch(path)
        .then(r => r.json())
        .then(res => {
          eventHandler(res);
        });
    }, 3000);
  }

  closeTrade() {
    if (this._sockets.trade) this._sockets.trade.close();
  }

  closeOB() {
    if (this._sockets.orderbook) this._sockets.orderbook.close();
  }

  closeKline() {
    if (this._sockets.kline) clearInterval(this._sockets.kline);
  }

  onTrade(symbol, eventHandler) {
    const splitSymbol = symbol.split(/[:/]/);
    const newSymbol = `${splitSymbol[1]}_${splitSymbol[0]}`;
    const offset = new Date().getTimezoneOffset() * 60000;

    fetch(`https://poloniex.com/public?command=returnTradeHistory&currencyPair=${newSymbol}`)
      .then(res => res.json())
      .then(res => {
        res
          .slice(0, 20)
          .reverse()
          .forEach(el => {
            const time = new Date(el.date).getTime();
            eventHandler({
              id: el.globalTradeID,
              side: el.type,
              timestamp: time - offset,
              price: +el.rate,
              amount: +el.amount,
              symbol,
              exchange: 'poloniex',
            });
          });

        const handler = res => {
          if (res.length > 2) {
            res[2].forEach(e => {
              if (e[0] === 't') {
                const trade = {
                  id: +e[1],
                  side: e[2] ? 'buy' : 'sell',
                  timestamp: e[5] * 1000,
                  price: +e[3],
                  amount: +e[4],
                  symbol,
                  exchange: 'poloniex',
                };
                eventHandler(trade);
              }
            });
          }
        };

        return this._setupWebSocket(handler, this.streams.trade(newSymbol), 'trade');
      });
  }

  onDepthUpdate(symbol, eventHandler) {
    const splitSymbol = symbol.split(/[:/]/);
    const newSymbol = `${splitSymbol[1]}_${splitSymbol[0]}`;
    fetch(this.streams.depthLevel(newSymbol, 10000))
      .then(r => r.json())
      .then(res => {
        const data = {
          asks: [],
          bids: [],
          type: 'snapshot',
          exchange: 'poloniex',
          symbol,
        };
        res.asks.forEach(r => data.asks.push([+r[0], r[1]]));
        res.bids.forEach(r => data.bids.push([+r[0], r[1]]));
        eventHandler(data);

        const handler = res => {
          const data = {
            asks: [],
            bids: [],
            type: 'update',
            exchange: 'poloniex',
            symbol,
          };
          if (res.length && res.length > 2)
            res[2].forEach(r => {
              if (r[0] === 'o') {
                r[1] ? data.bids.push([+r[2], +r[3]]) : data.asks.push([+r[2], +r[3]]);
              }
            });
          if (data.asks.length || data.bids.length) eventHandler(data);
        };
        return this._setupWebSocket(handler, this.streams.depth(newSymbol), 'orderbook');
      });
  }

  onKline(symbol, interval, eventHandler) {
    const splitSymbol = symbol.split(/[:/]/);
    const newSymbol = `${splitSymbol[1]}_${splitSymbol[0]}`;
    const date = new Date();
    date.setHours(date.getHours() - 1);

    const handler = data => {
      data = data[data.length - 1];
      const newData = {
        close: data.close,
        high: data.high,
        low: data.low,
        open: data.open,
        time: data.date * 1000,
        volume: data.volume,
      };
      eventHandler(newData);
    };
    return this._setupWebSocketEmulator(
      handler,
      this.streams.kline(newSymbol, (date.getTime() / 1000) | 0, this.times[interval]),
      'kline'
    );
  }

  async getPairs() {
    return await fetch(
      `${this._proxy_enable ? this._proxy : ''}https://poloniex.com/public?command=returnTicker`
    )
      .then(r => r.json())
      .then(r => {
        const pairs = {
          BTC: [],
          ALT: [],
          STABLE: [],
        };
        const fullList = {};
        Object.keys(r).forEach(pair => {
          const pair_data = r[pair];
          const base = pair.split('_')[0];
          const target = pair.split('_')[1];
          const symbol = `${target}/${base}`;
          const data = {
            symbol,
            volume: +pair_data.baseVolume,
            priceChangePercent: +pair_data.percentChange * 100,
            price: +pair_data.last,
            high: +pair_data.high24hr,
            low: +pair_data.low24hr,
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

  async getKline(pair = 'BTC/USDT', interval = 30, start, end) {
    if (!end) end = new Date().getTime() / 1000;
    const splitSymbol = pair.split('/');
    const symbol = `${splitSymbol[1]}_${splitSymbol[0]}`;
    const startTime = end - 1000 * this.times[interval];
    return fetch(
      `${
        this._proxy_enable ? this._proxy : ''
      }https://poloniex.com/public?command=returnChartData&currencyPair=${symbol}&start=${startTime}&end=${end}&period=${
        this.times[interval]
      }`
    )
      .then(r => r.json())
      .then(r => {
        const newCandles = [];
        r.forEach(obj => {
          newCandles.push({
            time: obj.date * 1000,
            open: obj.open,
            high: obj.high,
            low: obj.low,
            close: obj.close,
            volume: obj.volume,
          });
        });
        return newCandles;
      });
  }
}
