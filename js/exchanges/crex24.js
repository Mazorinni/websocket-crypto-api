import Exchanges from './baseExchange';

const axios = require('axios');
const crypto = require('crypto');

class Crex24 extends Exchanges {
  constructor(data = {}) {
    super();
    this._key = data.key;
    this._secret = data.secret;
    this.name = 'Crex24';
    this._proxy = data.proxy || '';
    this.URL = `${this._proxy}https://api.crex24.com`;

    this.stable_coins = ['RUB', 'USD', 'CNY', 'JPY', 'EUR'];

    this.times = {
      1: '1m',
      3: '3m',
      5: '5m',
      15: '15m',
      30: '30m',
      60: '1h',
      240: '4h',
      '1D': '1d',
      '1W': '1w',
      '1M': '1mo'
    };
    this.ms = {
      1: 60 * 1000,
      3: 3 * 60 * 1000,
      5: 5 * 60 * 1000,
      15: 15 * 60 * 1000,
      30: 30 * 60 * 1000,
      60: 60 * 60 * 1000,
      240: 4 * 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 1000,
      '1W': 7 * 24 * 60 * 1000,
      '1M': '1mo'
    };

    this._sockets = {};

    this.status = {
      submitting: 'open',
      unfilledActive: 'open',
      partiallyFilledActive: 'open',
      filled: 'closed',
      unfilledCancelled: 'canceled',
      partiallyFilledCancelled: 'canceled',
      waiting: 'open'
    };

    this.cashCandles = {};
  }

  //PUBLIC METHODS

  getOrderTypes() {
    return ['limit', 'market'];
  }

  getExchangeConfig() {
    return {
      exchange: {
        isActive: true,
        componentList: ['open', 'history', 'balance'],
        orderTypes: ['limit']
      },
      margin: {
        isActive: false
      },
      intervals: this.getSupportedInterval()
    };
  }

  // OB with 1 ask and bid limit
  getOrderBook(pair) {
    let symbol = pair.replace('/', '-');
    return axios(
      `${this.URL}/v2/public/orderBook?instrument=${symbol}&limit=10000`
    ).then(res => {
      const result = {
        bids: [],
        asks: [],
        type: 'snapshot',
        exchange: 'crex24',
        symbol
      };

      result.bids = res.data.buyLevels.map(el => {
        return [+el.price, +el.volume];
      });

      result.asks = res.data.sellLevels.map(el => {
        return [+el.price, +el.volume];
      });
      return result;
    });
  }

  getTrades(pair) {
    const symbol = pair.replace('/', '-');
    return axios.get(`${this.URL}/v2/public/recentTrades?instrument=${symbol}`).then(res => {
      const trades = res.data.map(trade => {
        const d = new Date(trade.timestamp);
        return {
          id: d.getTime(),
          side: trade.side,
          timestamp: d.getTime(),
          price: +trade.price,
          amount: +trade.volume,
          symbol: pair,
          exchange: 'crex24'
        };
      });
      return trades.reverse();
    });
  }

  onDepthUpdate(symbol, eventHandler) {
    this._sockets['orderbook'] ? clearInterval(this._sockets['orderbook']) : 0;
    this.getOrderBook(symbol).then(eventHandler);
    this._sockets['orderbook'] = setInterval(() => this.getOrderBook(symbol).then(eventHandler), 3000);
  }

  onTrade(symbol, eventHandler) {
    this._sockets['trade'] ? clearInterval(this._sockets['trade']) : 0;
    this.getTrades(symbol).then(res => res.forEach(eventHandler));
    let lastId = 0;
    this._sockets['trade'] = setInterval(() => this.getTrades(symbol).then(res => {
      res.filter(trade => trade.id > lastId).forEach(eventHandler);
      lastId = res[res.length - 1].id;
    }), 3000);
  }

  onKline(symbol, interval, eventHandler) {
    this._sockets['kline'] ? clearInterval(this._sockets['kline']) : 0;
    this.getKline(symbol, interval, 0, 0, 1).then(res => res.forEach(eventHandler));
    this._sockets['kline'] = setInterval(() => this.getKline(symbol, interval, 0, 0, 1).then(res => eventHandler[res[0]]), 3000);
  }

  closeTrade() {
    if (this._sockets.trade) clearInterval(this._sockets.trade);
  }

  closeOB() {
    if (this._sockets.orderbook) clearInterval(this._sockets.orderbook);
  }

  closeKline() {
    if (this._sockets.kline) clearInterval(this._sockets.kline);
  }


  async getPairs() {
    return axios.get(`${this.URL}/v2/public/tickers`).then(res => {
      const pairs = {
        BTC: [],
        ALT: [],
        STABLE: []
      };
      const fullList = {};
      res.data.forEach(pair => {
        const [target, base] = pair.instrument.split('-');
        const symbol = pair.instrument.replace('-', '/');
        const data = {
          symbol,
          volume: +pair.quoteVolume,
          priceChangePercent: +pair.percentChange,
          price: +pair.last,
          high: +pair.high,
          low: +pair.low,
          quote: target,
          base,
          maxLeverage: 0,
          tickSize: 0
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

  async getKline(pair = 'BTC/USD', interval = 60, start, end, limit = 1000) {
    if (!end) end = new Date().getTime() / 1000;
    const symbol = pair.replace('/', '-');
    const msInterval = this.ms[interval];
    const cash = this.cashCandles[`${symbol}-${msInterval}`];
    if (end !== 0 && !!cash && cash[cash.length - 1].time + msInterval >= end * 1000) {
      return cash;
    }
    const klines = await fetch(
      `${this.URL}/v2/public/ohlcv?instrument=${symbol}&granularity=${this.times[interval]}&limit=${limit}`
    ).then(r => r.json())
      .then(r => {
        const newcandle = [];
        r.map(obj => {
          const d = new Date(obj.timestamp);
          newcandle.push({
            time: d.getTime(),
            open: +obj.open,
            high: +obj.high,
            low: +obj.low,
            close: +obj.close,
            volume: +obj.volume
          });
        });
        return newcandle;
      }).then(rawKline => {
        if (interval === '1M') return rawKline;
        const kline = [];
        let prevTime = -1;
        rawKline.forEach(candle => {
          if (prevTime !== -1 && candle.time - msInterval !== prevTime) {

            while (prevTime !== candle.time) {
              const newCandle = {
                time: prevTime + msInterval,
                open: candle.open,
                high: candle.open,
                low: candle.open,
                close: candle.open,
                volume: 0
              };
              kline.push(newCandle);
              prevTime = newCandle.time;
            }
          }
          prevTime = candle.time;
          kline.push(candle);
        });
        return kline;
      });
    this.cashCandles[`${symbol}-${msInterval}`] = klines;
    return klines;
  }

  //PRIVATE METHODS

  privateCall(path, apiKey, apiSecret, method = 'GET', data) {
    const nonce = Date.now();
    const key = Buffer(apiSecret, 'base64');

    const message = method === 'POST' ? path + nonce + JSON.stringify(data) : path + nonce;
    const hmac = crypto.createHmac('sha512', key);
    const signature = hmac.update(message).digest('base64');

    return axios({
      url: this.URL + path,
      method,
      headers: {
        'X-CREX24-API-KEY': apiKey || this._key,
        'X-CREX24-API-NONCE': nonce,
        'X-CREX24-API-SIGN': signature
      },
      data
    })
      .then(res => res.data);
  }

  getBalance({ apiKey, apiSecret }) {
    const path = '/v2/account/balance';

    return this.privateCall(path, apiKey, apiSecret)
      .then(res => {
        const result = { exchange: {} };
        res.forEach(element => {
          result.exchange[element.currency] = {
            coin: element.currency,
            free: element.available,
            used: element.reserved,
            total: element.available + element.reserved
          };
        });
        return result;
      });
  }

  getOpenOrders({ apiKey, apiSecret }) {
    const path = '/v2/trading/activeOrders';

    return this.privateCall(path, apiKey, apiSecret).then(res => {
      return res.map(order => {
        return {
          id: order.id,
          timestamp: new Date(order.timestamp).getTime(),
          lastTradeTimestamp: new Date(order.lastUpdate).getTime(),
          status: this.status[order.status],
          symbol: order.instrument.replace('-', '/'),
          type: order.type,
          side: order.side,
          price: +order.price,
          stopPx: +order.stopPrice,
          amount: +order.volume,
          executed: +order.volume - +order.remainingVolume,
          filled: ((+order.volume - +order.remainingVolume) / +order.volume) * 100,
          remaining: +order.remainingVolume,
          cost: order.price * (+order.volume - +order.remainingVolume),
          fee: {
            symbol: 0,
            value: 0
          }
        };
      });
    });
  }

  async getClosedOrders({ apiKey, apiSecret }, { pair } = {}) {
    return this.privateCall(`/v2/trading/orderHistory?instrument=${pair.replace('/', '-')}&limit=1000`, apiKey, apiSecret).then(res => {
      return res.map(order => {
        return {
          id: order.id,
          timestamp: new Date(order.timestamp).getTime(),
          lastTradeTimestamp: new Date(order.lastUpdate).getTime(),
          status: this.status[order.status],
          symbol: order.instrument.replace('-', '/'),
          type: order.type,
          side: order.side,
          price: +order.price,
          amount: +order.volume,
          stopPx: +order.stopPrice,
          executed: +order.volume - +order.remainingVolume,
          filled: ((+order.volume - +order.remainingVolume) / +order.volume) * 100,
          remaining: +order.remainingVolume,
          cost: order.price * (+order.volume - +order.remainingVolume),
          fee: {
            symbol: 0,
            value: 0
          }
        };
      });
    });
  }

  async getAllOrders(credentials, { pair, status, orderId } = {}) {
    const openOrders = await this.getOpenOrders(credentials).then(r => r.filter(order => order.symbol === pair));
    const closeOrders = await this.getClosedOrders(credentials, { pair });
    const allOrders = [...openOrders, ...closeOrders];
    if (status) return allOrders.filter(order => order.status === status);
    if (orderId) return allOrders.filter(order => order.id === orderId);
    return allOrders;
  }

  createOrder({ apiKey, apiSecret }, data) {
    if (!data) {
      throw Error('Need pass oder data object');
    }
    if (!data.type) {
      throw Error('Need pass order type');
    }
    if (!data.pair) {
      throw Error('Need pass order pair');
    }
    if (!data.side) {
      throw Error('Need pass order side');
    }
    if (!data.volume) {
      throw Error('Need pass order volume');
    }

    const path = '/v2/trading/placeOrder';
    const body = {
      instrument: data.pair.replace('/', '-'),
      side: data.side,
      volume: data.volume,
      type: data.type
    };

    if (data.type === 'limit') body.price = data.price;
    if (data.type === 'stopLimit') body.stopPrice = data.stopPx;

    return this.privateCall(path, apiKey, apiSecret, 'POST', body).then(
      res => this.getAllOrders({ apiKey, apiSecret }, { pair: data.pair, orderId: res.id })
    );
  }

  cancelOrder(credentials, { pair, orderId }) {
    const { apiKey, apiSecret } = credentials;
    const path = '/v2/trading/cancelOrdersById';
    const body = {
      ids: [orderId]
    };

    return this.privateCall(path, apiKey, apiSecret, 'POST', body).then(() => this.getAllOrders(credentials, {
      pair,
      orderId
    }));
  }
}

export default Crex24;
