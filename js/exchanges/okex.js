import Exchanges from './baseExchange';
import pako from 'pako';
import ReWS from 'reconnecting-websocket';
import CryptoJS from 'crypto-js';



export default class OKEx extends Exchanges {
  constructor(proxy = '') {
    super();
    this.name = 'OKEx';
    this._mainUrl = 'wss://real.okex.com:10441/websocket?compress=true';
    this._socket = 0;
    this._subscriptions = {
      trade: '',
      orderbook: '',
      kline: ''
    };
    this._pingpongs = {};
    this._proxy = proxy;
    this._proxy_enable = !!proxy;
    this.BASE = `${proxy}https://www.okex.com`;

    this.orderBook = symbol => `${
      this._proxy_enable ? this._proxy : ''
      }https://www.okex.com/api/v1/depth.do?symbol=${symbol.toLowerCase()}&size=200`;

    this.streams = {
      depth: symbol => `ok_sub_spot_${symbol.toLowerCase()}_depth`,
      kline: (symbol, interval) => `ok_sub_spot_${symbol.toLowerCase()}_kline_${this.times[interval]}`,
      trade: symbol => `ok_sub_spot_${symbol.toLowerCase()}_deals`,
      ticker: symbol => `ok_sub_spot_${symbol.toLowerCase()}_ticker`
    };

    this.stable_coins = ['USDT'];

    this.times = {
      1: '1min',
      3: '3min',
      5: '5min',
      15: '15min',
      30: '30min',
      60: '1hour',
      120: '2hour',
      240: '4hour',
      360: '6hour',
      720: '12hour',
      '1D': '1day',
      '1W': '1week'
    };

    this.status = {
      open: 'open',
      ordering: 'open',
      part_filled: 'open',
      filled: 'closed',
      canceling: 'canceled',
      cancelled: 'canceled',
      failure: 'closed'
    };

    this.ms = {
      1: 60 * 1000,
      3: 3 * 60 * 1000,
      5: 5 * 60 * 1000,
      15: 15 * 60 * 1000,
      30: 30 * 60 * 1000,
      60: 60 * 60 * 1000,
      120: 60 * 60 * 1000,
      240: 4 * 60 * 60 * 1000,
      360: 6 * 60 * 60 * 1000,
      720: 12 * 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 100,
      '1W': 7 * 24 * 60 * 60 * 1000
    };

    this._handlers = {};
    this._socketPromise = new Promise(() => {
    });
  }


  getOrderTypes() {
    return ['market', 'limit'];
  }

  getExchangeConfig() {
    return {
      exchange: {
        isActive: true,
        componentList: ['open', 'history', 'balance'],
        orderTypes: ['limit', 'market']
      },
      margin: {
        isActive: false
      },
      intervals: this.getSupportedInterval()
    };
  }

  _setupWebSocket(eventHandler, path, type) {
    if (!this._socket) {
      let Resolver;
      this._socketPromise = new Promise((resolve) => {
        Resolver = resolve;
      });

      this._socket = new ReWS(this._mainUrl, [], {
        WebSocket:this.websocket,
        connectionTimeout: 5000,
        debug: false
      });
      this._socket.binaryType = 'arraybuffer';
      this._socket.onopen = () => {
        this._pingpongs = setInterval(() => {
          try {
            ws.send('{"event":"ping"}');
          } catch (e) {
            clearInterval(this._pingpongs);
          }
        }, 25000);
        Resolver();
      };
      this._socket.onclose = () => {
        clearInterval(this._pingpongs);
      };


      this._socket.onmessage = ({ data }) => {
        if (!(data instanceof String)) {
          try {
            const res = JSON.parse(pako.inflateRaw(data, { to: 'string' }));
            const channel = res[0].channel;
            if (this._handlers[channel]) this._handlers[channel](res[0].data);
          } catch (err) {
          }
        }
      };
    }
    this._socketPromise.then(() => {
      this._subscriptions[type] = path;
      this._handlers[path] = eventHandler;

      this._socket.send(`{'event': 'addChannel', 'channel': '${path}'}`);
    });
  }

  closeWebSocket(type) {
    if (this._subscriptions[type]) {
      const path = this._subscriptions[type];
      this._socket.send(`{'event': 'removeChannel', 'channel': '${path}'}`);
      this._subscriptions[type] = '';
      delete this._handlers[path];
    }

  }

  closeTrade() {
    this.closeWebSocket('trade');
  }

  closeOB() {
    this.closeWebSocket('orderbook');
  }

  closeKline() {
    this.closeWebSocket('kline');
  }

  onTrade(symbol, eventHandler) {
    const [quote, base] = symbol.split(/[:/]/);
    const newSymbol = `${quote}_${base}`;

    const handler = res => {
      const side = res[0][4] === 'ask' ? 'sell' : 'buy';
      const date = new Date();
      const trade = {
        id: +res[0][0],
        side,
        timestamp: date.getTime(),
        price: +res[0][1],
        amount: +res[0][2],
        symbol,
        exchange: 'okex'
      };
      eventHandler(trade);
    };
    this.getTrades(symbol).then(r => r.forEach(el => eventHandler(el))).then(() => {
      return this._setupWebSocket(handler, this.streams.trade(newSymbol), 'trade');
    });
  }

  onDepthUpdate(symbol, eventHandler) {
    const [quote, base] = symbol.split(/[:/]/);
    const newSymbol = `${quote}_${base}`;
    let SnapshotAccepted = false;
    const uBuffer = {
      type: 'update',
      bids: [],
      asks: [],
      exchange: 'okex',
      symbol
    };

    const handler = res => {
      const data = {
        asks: [],
        bids: [],
        type: 'update',
        exchange: 'okex',
        symbol
      };
      if (
        res.hasOwnProperty('asks')
        && res.asks.length !== 200
        && res.bids.length !== 200
      ) {
        if (SnapshotAccepted) {
          res.asks.forEach(r => data.asks.push([+r[0], +r[1]]));
          res.bids.forEach(r => data.bids.push([+r[0], +r[1]]));
          eventHandler(data);
        } else {
          res.asks.forEach(r => uBuffer.asks.push([+r[0], +r[1]]));
          res.bids.forEach(r => uBuffer.bids.push([+r[0], +r[1]]));
        }
      }
    };
    this._setupWebSocket(handler, this.streams.depth(newSymbol), 'orderbook');

    fetch(this.orderBook(newSymbol))
      .then(r => r.json())
      .then(res => {
        const data = {
          asks: [],
          bids: [],
          type: 'snapshot',
          exchange: 'okex',
          symbol
        };
        res.asks.forEach(r => data.asks.push([+r[0], +r[1]]));
        res.bids.forEach(r => data.bids.push([+r[0], +r[1]]));
        eventHandler(data);
        eventHandler(uBuffer);
        SnapshotAccepted = true;
      });
  }

  onKline(symbol, interval, eventHandler) {
    const [quote, base] = symbol.split(/[:/]/);
    const newSymbol = `${quote}_${base}`;

    const handler = data => {
      if (!data.hasOwnProperty('result')) {
        const newData = {
          close: +data[0][4],
          high: +data[0][2],
          low: +data[0][3],
          open: +data[0][1],
          time: +data[0][0],
          volume: +data[0][5]
        };
        eventHandler(newData);
      }
    };
    return this._setupWebSocket(
      handler,
      this.streams.kline(newSymbol, interval),
      'kline'
    );
  }

  async getPairs() {
    return await fetch(`${this._proxy_enable ? this._proxy : ''}https://www.okex.com/v2/spot/markets/tickers`).then(r => r.json()).then(r => {
      const pairs = {
        BTC: [],
        ALT: [],
        STABLE: []
      };
      const fullList = {};
      if (r.data) {
        r.data.forEach(pair => {
          const base = pair.symbol.split('_')[1].toUpperCase();
          const target = pair.symbol.split('_')[0].toUpperCase();
          const symbol = `${target}/${base}`;
          const data = {
            symbol: symbol,
            volume: +pair.coinVolume,
            priceChangePercent: +pair.changePercentage.split('%')[0],
            price: +pair.last,
            high: +pair.dayHigh,
            low: +pair.dayLow,
            quote: target,
            base: base,
            maxLeverage: 0,
            tickSize: 0
          };
          if (data.price !== 0) {
            if (base === 'BTC') {
              pairs[base].push(data);
            } else if (this.stable_coins.indexOf(base) !== -1) {
              pairs['STABLE'].push(data);
            } else {
              pairs['ALT'].push(data);
            }
            fullList[symbol] = data;
          }
        });
      }
      return [pairs, fullList];
    });
  }

  async getTicker(pair) {
    const pairs = await this.getPairs().then(r => r[1]);
    return pairs[pair];
  }

  async getKline(pair = 'BTC/USDT', interval = 60, start, end) {
    if (!end) end = new Date().getTime() / 1000 | 0;
    const symbol = pair.replace('/', '_').toLowerCase();
    const startTime = end - this.ms[interval];
    return fetch(`${this._proxy_enable ? this._proxy : ''}https://www.okex.com/api/v1/kline.do?symbol=${symbol}&type=${this.times[interval]}&since=${startTime}&size=2000`)
      .then(r => r.json()).then(r => {
        const newcandle = [];
        r.forEach(obj => {
          newcandle.push({
            time: obj[0],
            open: +obj[1],
            high: +obj[2],
            low: +obj[3],
            close: +obj[4],
            volume: +obj[5]
          });
        });
        return newcandle;
      });
  }

  async getTrades(pair) {
    const symbol = pair.replace('/', '_').toLowerCase();
    const list = [];
    return fetch(`${this._proxy_enable ? this._proxy : ''}https://www.okex.com/api/v1/trades.do?symbol=${symbol}`).then(r => r.json()).then(r => {
      r.forEach(el => {
        const date = new Date();
        const trade = {
          id: el.tid,
          side: el.type,
          timestamp: el.date_ms,
          price: el.price,
          amount: el.amount,
          symbol:pair,
          exchange: 'okex'
        };
        list.push(trade);
      });
      return list;
    });
  }

  capitalize(s) {
    return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  makeQueryString(q) {
    return q
      ? `?${Object.keys(q)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`)
        .join('&')}`
      : '';
  }

  hmac(request, secret, hash = 'sha256', digest = 'hex') {
    const result = CryptoJS[`Hmac${hash.toUpperCase()}`](request, secret);
    if (digest) {
      const encoding = digest === 'binary' ? 'Latin1' : this.capitalize(digest);
      return result.toString(CryptoJS.enc[this.capitalize(encoding)]);
    }
    return result;
  }

  async privateCall(
    path, apiKey, apiSecret, method = 'GET', data
  ) {
    if (!apiKey || !apiSecret) {
      throw new Error('You need to pass an API key and secret to make authenticated calls.');
    }

    return fetch(`${this._proxy}https://www.okex.com/api/general/v3/time`).then(r => r.json()).then(r => r.iso).then((timestamp) => {
      const dirUrl = path.replace(/.*\/\/[^\/]*/, '');
      const stringData = method === 'POST' ? JSON.stringify(data) : '';
      const signature = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(timestamp + method + dirUrl + stringData, apiSecret));
      return fetch(
        `${this.BASE}${path}`,
        {
          method,
          headers: {
            'OK-ACCESS-KEY': apiKey,
            'OK-ACCESS-SIGN': signature,
            'OK-ACCESS-TIMESTAMP': timestamp,
            'OK-ACCESS-PASSPHRASE': 'oneexbit',
            'content-type': 'application/json'
          },
          json: true,
          body: JSON.stringify(data)
        }
      ).then((r) => {
        // if (r.status === 401) throw new Error('Invalid api keys or insufficient permissions');
        // if (r.status === 419) throw new Error('Probably, there is another terminal running on this IP. Currently only one terminal per IP allowed');
        // if (r.status === 429) throw new Error('Probably, there is another terminal running on this IP. Currently only one terminal per IP allowed');
        return r.json();
      }).then(responce => {
        // if (responce.code === -1021) throw new Error('You have different time/date with server. Check your local time/date settings');
        // if (responce.code === -1022) throw new Error('Invalid api keys or insufficient permissions');
        // if (responce.code === -2010) throw new Error('Account has insufficient balance');
        return responce;
      });
    });
  };

  getBalance({ apiKey, apiSecret }) {
    const path = '/api/spot/v3/accounts';

    return this.privateCall(path, apiKey, apiSecret)
      .then(res => {
        const result = { exchange: {} };
        res.forEach(element => {
          result.exchange[element.currency] = {
            coin: element.currency,
            free: element.available,
            used: element.balance - element.available,
            total: element.balance
          };
        });
        return result;
      });
  }

  getOpenOrders({ apiKey, apiSecret }) {
    const path = '/api/spot/v3/orders_pending';

    return this.privateCall(path, apiKey, apiSecret).then(res => {
      return res.map(order => {
        return {
          id: order.order_id,
          timestamp: new Date(order.created_at).getTime(),
          lastTradeTimestamp: new Date(order.timestamp).getTime(),
          status: this.status[order.status],
          symbol: order.instrument_id.replace('-', '/'),
          type: order.type,
          side: order.side,
          price: +order.price,
          stopPx: +order.stopPrice,
          amount: +order.size,
          executed: +order.filled_size,
          filled: ((+order.size - +order.filled_size) / +order.size) * 100,
          remaining: +order.size - +order.filled_size,
          cost: order.price * (+order.filled_size),
          fee: {
            symbol: 0,
            value: 0
          }
        };
      });
    });
  }

  async getClosedOrders({ apiKey, apiSecret }, { pair } = {}) {
    return this.privateCall(`/api/spot/v3/orders?instrument_id=BTC-USDT&status=filled`, apiKey, apiSecret).then(res => {
      return res.map(order => {
        return {
          id: order.order_id,
          timestamp: new Date(order.created_at).getTime(),
          lastTradeTimestamp: new Date(order.timestamp).getTime(),
          status: this.status[order.status],
          symbol: order.instrument_id.replace('-', '/'),
          type: order.type,
          side: order.side,
          price: +order.price,
          stopPx: +order.stopPrice,
          amount: +order.size,
          executed: +order.filled_size,
          filled: ((+order.size - +order.filled_size) / +order.size) * 100,
          remaining: +order.size - +order.filled_size,
          cost: order.price * (+order.filled_size),
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

  async createOrder({ apiKey, apiSecret }, data) {
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

    const path = '/api/spot/v3/orders';
    const body = {
      instrument_id: data.pair.replace('/', '-'),
      side: data.side,
      type: data.type,
      margin_trading: '1'
    };

    if (data.type === 'limit') {
      body.price = +data.price;
      body.size = +data.volume;
    } else if (data.side === 'buy') {
      const price = await this.getTicker(data.pair).then(r => r.price);
      body.notional = +data.volume * price;
    } else {
      body.size = +data.volume;
    }
    return this.privateCall(path, apiKey, apiSecret, 'POST', body).then(
      res => this.getAllOrders({ apiKey, apiSecret }, { pair: data.pair, orderId: res.order_id })
    );
  }

  cancelOrder(credentials, { pair, orderId, clientOId }) {
    const { apiKey, apiSecret } = credentials;
    const path = `/api/spot/v3/cancel_orders/${orderId}`;
    const body = {
      instrument_id: pair.replace('/', '-'),
      order_id: orderId
      // 'client-oid': clientOId
    };
    return this.privateCall(path, apiKey, apiSecret, 'POST', body).then((res) => {
      return [{ id: res.order_id }];
    });
  }
}
