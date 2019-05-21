/* eslint-disable class-methods-use-this,no-restricted-syntax */
import CryptoJS from 'crypto-js';
import ReWS from 'reconnecting-websocket';
import Exchanges from './baseExchange';

export default class Bitfinex extends Exchanges {
  constructor(data = {}) {
    super();
    this.name = 'Bitfinex';
    this._mainUrl = 'wss://api.bitfinex.com/ws/2';
    this._sockets = {};

    this.tradeLog = [];
    this._proxy = data.proxy || '';

    this.BASE = `${this._proxy}https://api.bitfinex.com`;

    this._key = data.key;
    this._secret = data.secret;

    this._pCall = this.privateCall();
    this._pCallv1 = this.privateCallv1();

    this.last_time = Date.now();

    this.v1Chain = Promise.resolve(0);
    this.v2Chain = Promise.resolve(0);

    this.streams = {
      depth: symbol =>
        JSON.stringify({
          event: 'subscribe',
          channel: 'book',
          symbol,
          freq: 'F1'
        }),
      depthLevel: (symbol, level) =>
        `${
          this._proxy
          }https://api.bitfinex.com/v1/book/${symbol}?limit_bids=${level}&limit_asks=${level}`,
      kline: (symbol, interval) =>
        JSON.stringify({
          event: 'subscribe',
          channel: 'candles',
          key: `trade:${this.times[interval]}:${symbol}`
        }),
      trade: symbol =>
        JSON.stringify({
          event: 'subscribe',
          channel: 'trades',
          symbol
        }),
      ticker: symbol =>
        JSON.stringify({
          event: 'subscribe',
          channel: 'ticker',
          symbol
        })
    };

    this.times = {
      1: '1m',
      5: '5m',
      15: '15m',
      30: '30m',
      60: '1h',
      180: '3h',
      360: '6h',
      720: '12h',
      '1D': '1D',
      '1W': '7D',
      '1M': '1M'
    };

    this.TYPE = {
      LIMIT: 'margin limit',
      MARKET: 'margin market',
      STOP: 'margin stop',
      'TRAILING STOP': 'margin ts',
      FOK: 'margin fok',
      'EXCHANGE MARKET': 'market',
      'EXCHANGE LIMIT': 'limit',
      'EXCHANGE STOP': 'stop',
      'EXCHANGE TRAILING STOP': 'ts',
      'EXCHANGE FOK': 'fok'
    };

    this.stable_coins = ['USD', 'EUR', 'JPY', 'GBP'];
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

  capitalize(s) {
    return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  STATUS(status) {
    const statuses = {
      ACTIVE: 'open',
      EXECUTED: 'closed',
      'PARTIALLY FILLED': 'open',
      CANCELED: 'canceled'
    };
    for (const st in statuses) {
      if (status.indexOf(st) !== -1) {
        return statuses[st];
      }
    }
    return 'close';
  }

  hmac(request, secret, hash = 'sha384', digest = 'hex') {
    const result = CryptoJS[`Hmac${hash.toUpperCase()}`](request, secret);
    if (digest) {
      const encoding = digest === 'binary' ? 'Latin1' : this.capitalize(digest);
      return result.toString(CryptoJS.enc[this.capitalize(encoding)]);
    }
    return result;
  }

  privateCall() {
    return (path, data = {}, method = 'GET', { apiKey, apiSecret }) => {
      if (!apiKey || !apiSecret) {
        throw new Error('You need to pass an API key and secret to make authenticated calls.');
      }
      let resolve;
      const result = this.v2Chain.then(() => {
        data.nonce = Date.now().toString();
        data.request = path;
        data.apikey = apiKey;

        const signature = `/api${path.split('?')[0]}${data.nonce}${JSON.stringify(data)}`;

        const hsig = this.hmac(signature, apiSecret);

        return fetch(`${this.BASE}${path}`, {
          method,
          headers: {
            'bfx-nonce': data.nonce,
            'bfx-apikey': apiKey,
            'bfx-signature': hsig,
            'content-type': 'application/json'
          },
          body: JSON.stringify(data)
        })
          .then(r => {
            if (r.status === 500)
              throw new Error(
                'Probably, there is another terminal running on this IP. Currently only one terminal per IP allowed'
              );
            return r.json();
          })
          .then(r => {
            resolve();
            return r;
          });
      });

      this.v2Chain = this.v2Chain.then(() => new Promise(res => (resolve = res)));

      return result;
    };
  }

  privateCallv1() {
    return (path, data = {}, method = 'GET', { apiKey, apiSecret }) => {
      if (!apiKey || !apiSecret) {
        throw new Error('You need to pass an API key and secret to make authenticated calls.');
      }
      let resolve;
      const result = this.v1Chain.then(() => {
        data.nonce = Date.now().toString();
        data.request = path;
        data.apikey = apiKey;

        const payload = Buffer.from(JSON.stringify(data)).toString('base64');

        const signature = this.hmac(payload, apiSecret);

        return fetch(`${this.BASE}${path}`, {
          method,
          headers: {
            'X-BFX-APIKEY': apiKey,
            'X-BFX-PAYLOAD': payload,
            'X-BFX-SIGNATURE': signature,
            'content-type': 'application/json'
          },
          body: JSON.stringify(data)
        })
          .then(r => {
            // if (r.status === 400) throw new Error('Probably, there is another terminal running on this IP. Currently only one terminal per IP allowed');
            if (r.status === 401) throw new Error('Invalid api keys or insufficient permissions');
            if (r.status === 429)
              throw new Error(
                'Probably, there is another terminal running on this IP. Currently only one terminal per IP allowed'
              );
            return r.json();
          })
          .then(r => {
            if (r.error && r.error === 'ERR_RATE_LIMIT')
              throw new Error(
                'Probably, there is another terminal running on this IP. Currently only one terminal per IP allowed'
              );
            if (r.message && r.message.includes('Invalid order: minimum size'))
              throw new Error('Order has invalid amount');
            if (r.message && r.message.includes('Invalid order size'))
              throw new Error('Order has invalid amount');
            if (r.message && r.message.includes('Invalid order: not enough'))
              throw new Error('Account has insufficient balance');
            return r;
          })
          .finally(() => resolve());
      });
      this.v1Chain = this.v1Chain.then(() => new Promise(res => (resolve = res)));

      return result;
    };
  }

  _setupWebSocket(eventHandler, path, func = () => {
  }, type) {
    if (this._sockets[type]) {
      this._sockets[type].close();
    }

    const ws = new ReWS(this._mainUrl, [], {
      WebSocket: this.websocket,
      connectionTimeout: 5000,
      debug: false
    });

    ws.onopen = () => {
      ws.send(path);
      if (func) {
        func();
      }
    };

    ws.onmessage = event => {
      const res = JSON.parse(event.data);
      eventHandler(res);
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
    const splitSymbol = symbol.split(/[:/]/);
    const base = splitSymbol[1] === 'USDT' ? 'USD' : splitSymbol[1];
    const newSymbol = `t${splitSymbol[0]}${base}`;
    const customEventHandler = trade => {
      if (this.tradeLog.indexOf(trade.id) === -1) {
        this.tradeLog.push(trade.id);
        eventHandler(trade);
      }
      if (this.tradeLog.length > 40) {
        this.tradeLog.shift();
      }
    };

    const handler = res => {
      if (res.length === 3) {
        const side = res[2][2] < 0 ? 'sell' : 'buy';
        const trade = {
          id: res[2][0],
          side,
          timestamp: res[2][1],
          price: res[2][3],
          amount: res[2][2] < 0 ? -res[2][2] : res[2][2],
          symbol,
          exchange: 'bitfinex'
        };
        customEventHandler(trade);
      } else if (res.length === 2 && Array.isArray(res[1])) {
        res[1].reverse().forEach(data => {
          const side = data[2] < 0 ? 'sell' : 'buy';
          const trade = {
            id: data[0],
            side,
            timestamp: data[1],
            price: data[3],
            amount: Math.abs(data[2]),
            symbol,
            exchange: 'bitfinex'
          };
          customEventHandler(trade);
        });
      }
    };

    return this._setupWebSocket(handler, this.streams.trade(newSymbol), () => {
    }, 'trade');
  }


  onDepthUpdate(symbol, eventHandler) {
    const splitSymbol = symbol.split(/[:/]/);
    const base = splitSymbol[1] === 'USDT' ? 'USD' : splitSymbol[1];
    const newSymbol = `t${splitSymbol[0]}${base}`;
    const restSymbol = splitSymbol[0] + base;
    const uBuffer = {
      asks: [],
      bids: [],
      type: 'update',
      exchange: 'bitfinex',
      symbol
    };
    let SnapshotAccepted = false;

    const handler = res => {
      if (SnapshotAccepted) {
        const data = {
          asks: [],
          bids: [],
          type: 'update',
          exchange: 'bitfinex',
          symbol
        };
        if (Array.isArray(res)) {
          if (res[1].length === 3) {
            if (res[1][1] !== 0) {
              res[1][2] > 0
                ? (data.bids = [[res[1][0], res[1][2]]])
                : (data.asks = [[res[1][0], -res[1][2]]]);
            } else {
              res[1][2] > 0 ? (data.bids = [[res[1][0], 0]]) : (data.asks = [[res[1][0], 0]]);
            }
            eventHandler(data);
          }
        }
      } else if (Array.isArray(res)) {
        if (res[1].length === 3) {
          if (res[1][1] !== 0) {
            res[1][2] > 0
              ? uBuffer.bids.push([res[1][0], res[1][2]])
              : uBuffer.asks.push([res[1][0], -res[1][2]]);
          } else {
            res[1][2] > 0 ? uBuffer.bids.push([res[1][0], 0]) : uBuffer.asks.push([res[1][0], 0]);
          }
        }
      }
    };

    fetch(this.streams.depthLevel(restSymbol, 1000))
      .then(r => r.json())
      .then(res => {
        const data = {
          asks: [],
          bids: [],
          type: 'snapshot',
          exchange: 'bitfinex',
          symbol
        };
        res.asks.forEach(r => data.asks.push([+r.price, +r.amount]));
        res.bids.forEach(r => data.bids.push([+r.price, +r.amount]));
        eventHandler(data);
      });

    const func = () => {
      fetch(this.streams.depthLevel(restSymbol, 1000))
        .then(r => r.json())
        .then(res => {
          const data = {
            asks: [],
            bids: [],
            type: 'snapshot',
            exchange: 'bitfinex',
            symbol
          };
          res.asks.forEach(r => data.asks.push([+r.price, +r.amount]));
          res.bids.forEach(r => data.bids.push([+r.price, +r.amount]));
          eventHandler(data);
          SnapshotAccepted = true;
          eventHandler(uBuffer);
        });
    };

    return this._setupWebSocket(handler, this.streams.depth(newSymbol), func, 'orderbook');
  }

  onKline(symbol, interval, eventHandler) {
    const splitSymbol = symbol.split(/[:/]/);
    const base = splitSymbol[1] === 'USDT' ? 'USD' : splitSymbol[1];
    const newSymbol = `t${splitSymbol[0]}${base}`;
    let lastKline = 0;

    const handler = response => {
      if (Array.isArray(response[1]) && response[1].length === 6) {
        const data = response[1];
        const newData = {
          close: data[2],
          high: data[3],
          low: data[4],
          open: data[1],
          time: data[0],
          volume: data[5]
        };
        if (newData.time >= lastKline) {
          lastKline = newData.time;
          eventHandler(newData);
        }
      }
    };
    return this._setupWebSocket(
      handler,
      this.streams.kline(newSymbol, interval),
      () => {
      },
      'kline'
    );
  }

  async getPairs() {
    return fetch(`${this._proxy}https://api.bitfinex.com/v2/tickers?symbols=ALL`)
      .then(r => r.json())
      .then(r => {
        const pairs = {
          BTC: [],
          ALT: [],
          STABLE: []
        };
        const fullList = {};
        r.forEach(pair => {
          if (pair[0][0] === 't') {
            const base = pair[0].substr(pair[0].length - 3);
            const target = pair[0].substr(1, pair[0].length - 4);
            const symbol = `${target}/${base}`;
            const data = {
              symbol,
              volume: pair[8] * pair[7],
              priceChangePercent: pair[6] * 100,
              price: pair[7],
              high: pair[9],
              low: pair[10],
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
          }
        });
        return [pairs, fullList];
      });
  }

  async getKline(pair = 'BTC/USD', interval = 60, start, end) {
    if (!end) end = new Date().getTime() / 1000;
    const splitSymbol = pair.split(/[:/]/);
    const base = splitSymbol[1] === 'USDT' ? 'USD' : splitSymbol[1];
    const symbol = `t${splitSymbol[0]}${base}`;
    return fetch(
      `${this._proxy}https://api.bitfinex.com/v2/candles/trade:${
        this.times[interval]
        }:${symbol}/hist?limit=1000&end=${end * 1000}`
    )
      .then(r => r.json())
      .then(r => {
        const newcandle = [];
        r.map(obj =>
          newcandle.push({
            time: obj[0],
            open: +obj[1],
            high: +obj[3],
            low: +obj[4],
            close: +obj[2],
            volume: +obj[5]
          })
        );
        return newcandle.reverse();
      });
  }

  async getBalance(credentials) {
    return this._pCallv1('/v1/balances', {}, 'POST', credentials).then(r => {
      const balance = { exchange: {}, trading: {}, deposit: {} };
      r.forEach(coin => {
        const symbol = coin.currency.toUpperCase();
        if (+coin.amount !== 0) {
          if (!Object.hasOwnProperty.call(balance, symbol)) {
            balance[coin.type][symbol] = {
              coin: coin.currency.toUpperCase(),
              free: +coin.available,
              used: +coin.amount - +coin.available,
              total: +coin.amount
            };
          }
        }
      });
      return balance;
    });
  }

  async transferBalance(data = {}) {
    if (!data.from) {
      throw Error('Need pass from-wallet type');
    }
    if (!data.to) {
      throw Error('Need pass to-wallet type');
    }
    if (!data.coin) {
      throw Error('Need pass coin name');
    }
    if (!data.volume) {
      throw Error('Need pass coin volume');
    }

    const payload = {
      amount: data.volume.toString(),
      currency: data.coin.toUpperCase(),
      walletfrom: data.from,
      walletto: data.to
    };
    return this._pCallv1('/v1/transfer', payload, 'POST').then(r => r[0]);
  }

  async getPairsMargin() {
    return this._pCallv1('/v1/margin_infos', {}, 'POST').then((r) => {
      const symbols = r[0].margin_limits;
      return this.getPairs().then((r) => {
        const full_data = {};
        const pairs = {};
        symbols.forEach((e) => {
          const base = e.on_pair.substr(e.on_pair.length - 3);
          const target = e.on_pair.substr(0, e.on_pair.length - 3);
          const symbol = `${target}/${base}`;
          const info = r[1][symbol];
          if (pairs[base]) {
            pairs[base].push(info);
          } else {
            pairs[base] = [];
            pairs[base].push(info);
          }
          full_data[symbol] = info;
        });
        return [pairs, full_data];
      });
    });
  }

  async getOpenOrders(credentials, { orderId } = {}) {
    return this._pCall('/v2/auth/r/orders', {}, 'POST', credentials).then(r => {
      const orders = [];
      r.forEach(order => {
        const base = order[3].substr(order[3].length - 3);
        const target = order[3].substr(1, order[3].length - 4);
        const symbol = `${target}/${base}`;
        const item = {
          id: order[0],
          timestamp: order[4],
          lastTradeTimestamp: order[5],
          status: this.STATUS(order[13]),
          symbol,
          type: this.TYPE[order[8]],
          side: order[7] > 0 ? 'buy' : 'sell',
          price: order[16],
          amount: Math.abs(order[7]),
          executed: Math.abs(order[7]) - Math.abs(order[6]),
          filled: (1 - order[6] / order[7]) * 100,
          remaining: Math.abs(order[6]),
          cost: order[16] * Math.abs(order[7]),
          fee: {
            symbol: base,
            value: 0
          }
        };
        if (orderId) {
          if (orderId === item.id) {
            orders.push(item);
          }
        } else {
          orders.push(item);
        }
      });
      return orders;
    });
  }

  async getAllOrders(credentials, { pair, status, orderId } = {}) {
    let promis = 0;
    if (pair) {
      const splitSymbol = pair.split(/[:/]/);
      const base = splitSymbol[1] === 'USDT' ? 'USD' : splitSymbol[1];
      const symbol = `t${splitSymbol[0]}${base}`;
      promis = this._pCall(`/v2/auth/r/orders/${symbol}/hist`, {}, 'POST', credentials);
    } else {
      promis = this._pCall('/v2/auth/r/orders/hist', {}, 'POST', credentials);
    }
    return promis.then(r => {
      const orders = [];
      r.forEach(order => {
        const base = order[3].substr(order[3].length - 3);
        const target = order[3].substr(1, order[3].length - 4);
        const symbol = `${target}/${base}`;
        const data = {
          id: order[0],
          timestamp: order[4],
          lastTradeTimestamp: order[5],
          status: this.STATUS(order[13]),
          symbol,
          type: this.TYPE[order[8]],
          side: order[7] > 0 ? 'buy' : 'sell',
          price: order[16],
          amount: Math.abs(order[7]),
          executed: Math.abs(order[7]) - Math.abs(order[6]),
          filled: (1 - order[6] / order[7]) * 100,
          remaining: Math.abs(order[6]),
          cost: order[16] * Math.abs(order[7]),
          fee: {
            symbol: base,
            value: 0
          }
        };
        if (orderId) {
          if (data.id === orderId) orders.push(data);
        } else if (!status || data.status === status) {
          orders.push(data);
        }
      });
      return orders;
    });
  }

  async getClosedOrders(credentials, { pair } = {}) {
    const payload = {
      pair,
      status: 'closed'
    };
    return this.getAllOrders(credentials, payload);
  }

  async cancelOrder(credentials, { pair, orderId } = {}) {
    return this._pCallv1('/v1/order/cancel', { order_id: orderId }, 'POST', credentials).then(r => {
      if (!r.id) {
        throw Error(r.message);
      }
      return [
        {
          id: r.id,
          timestamp: +r.timestamp,
          lastTradeTimestamp: Date.now(),
          status: 'canceled',
          symbol: pair,
          type: this.TYPE[r.type.toUpperCase()],
          side: r.side,
          price: +r.price,
          amount: +r.original_amount,
          executed: +r.original_amount - +r.remaining_amount,
          filled: (1 - +r.remaining_amount / +r.original_amount) * 100,
          remaining: +r.remaining_amount,
          cost: +r.original_amount * +r.price,
          fee: {
            symbol: pair.split('/')[1],
            value: 0
          }
        }
      ];
    });
  }

  async createOrder(credentials, data) {
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

    const symbol = data.pair.replace('/', '');

    if (data.type === 'market') {
      const payload = {
        symbol,
        amount: data.volume.toString(),
        price: '1',
        exchange: 'bitfinex',
        side: data.side,
        type: 'exchange market'
      };
      return this._pCallv1('/v1/order/new', payload, 'POST', credentials).then(r => {
        if (!r.id) {
          throw Error(r.message);
        }
        return [
          {
            id: r.id,
            timestamp: +r.timestamp * 1000,
            lastTradeTimestamp: Date.now(),
            status: 'close',
            symbol: data.pair,
            type: this.TYPE[r.type.toUpperCase()],
            side: r.side,
            price: +r.price,
            amount: +r.original_amount,
            executed: +r.original_amount - +r.remaining_amount,
            filled: (1 - +r.remaining_amount / +r.original_amount) * 100,
            remaining: +r.remaining_amount,
            cost: +r.original_amount * +r.price,
            fee: {
              symbol: data.pair.split('/')[1],
              value: 0
            }
          }
        ];
      });
    }
    if (data.type === 'limit') {
      if (!data.price) {
        throw Error('Need pass order price');
      }

      const payload = {
        symbol,
        amount: data.volume.toString(),
        price: data.price.toString(),
        exchange: 'bitfinex',
        side: data.side,
        type: 'exchange limit'
      };
      return this._pCallv1('/v1/order/new', payload, 'POST', credentials).then(r => {
        if (!r.id) {
          throw Error(r.message);
        }
        return this.getAllOrders(credentials, { pair: data.pair, orderId: r.id }).then(order => {
          if (order.length) {
            return order;
          }
          return this.getOpenOrders(credentials, { pair: data.pair, orderId: r.id }).then(
            openOrder => {
              if (openOrder.length) {
                return openOrder;
              }
              return [
                {
                  id: r.id,
                  timestamp: +r.timestamp * 1000,
                  lastTradeTimestamp: Date.now(),
                  status: r.is_live ? 'open' : 'close',
                  symbol: data.pair,
                  type: this.TYPE[r.type.toUpperCase()],
                  side: r.side,
                  price: +r.price,
                  amount: +r.original_amount,
                  executed: +r.original_amount - +r.remaining_amount,
                  filled: (1 - +r.remaining_amount / +r.original_amount) * 100,
                  remaining: +r.remaining_amount,
                  cost: +r.original_amount * +r.price,
                  fee: {
                    symbol: data.pair.split('/')[1],
                    value: 0
                  }
                }
              ];
            }
          );
        });
      });
    }
    if (data.type === 'margin market') {
      const payload = {
        symbol,
        amount: data.volume.toString(),
        price: '1',
        exchange: 'bitfinex',
        side: data.side,
        type: 'market'
      };
      return this._pCallv1('/v1/order/new', payload, 'POST', credentials).then(r => {
        if (!r.id) {
          throw Error(r.message);
        }
        return [
          {
            id: r.id,
            timestamp: +r.timestamp,
            lastTradeTimestamp: Date.now(),
            status: r.is_live ? 'open' : 'close',
            symbol: data.pair,
            type: this.TYPE[r.type.toUpperCase()],
            side: r.side,
            price: +r.price,
            amount: +r.original_amount,
            executed: +r.original_amount - +r.remaining_amount,
            filled: (1 - +r.remaining_amount / +r.original_amount) * 100,
            remaining: +r.remaining_amount,
            cost: +r.original_amount * +r.price,
            fee: {
              symbol: data.pair.split('/')[1],
              value: 0
            }
          }
        ];
      });
    }
    if (data.type === 'margin limit') {
      if (!data.price) {
        throw Error('Need pass order price');
      }

      const payload = {
        symbol,
        amount: data.volume.toString(),
        price: data.price.toString(),
        exchange: 'bitfinex',
        side: data.side,
        type: 'limit'
      };
      return this._pCallv1('/v1/order/new', payload, 'POST', credentials).then(r => {
        if (!r.id) {
          throw Error(r.message);
        }

        return [
          {
            id: r.id,
            timestamp: +r.timestamp,
            lastTradeTimestamp: Date.now(),
            status: r.is_live ? 'open' : 'close',
            symbol: data.pair,
            type: this.TYPE[r.type.toUpperCase()],
            side: r.side,
            price: +r.price,
            amount: +r.original_amount,
            executed: +r.original_amount - +r.remaining_amount,
            filled: (1 - +r.remaining_amount / +r.original_amount) * 100,
            remaining: +r.remaining_amount,
            cost: +r.original_amount * +r.price,
            fee: {
              symbol: data.pair.split('/')[1],
              value: 0
            }
          }
        ];
      });
    }
    // else if (type === 'stop_loss') {
    //   if (!stopPrice) {
    //     throw Error("Need pass order price")
    //   }
    //
    //   const data = {
    //     recvWindow : RecvWindow,
    //     symbol     : symbol,
    //     type       : this.types[type],
    //     side       : side.toUpperCase(),
    //     quantity   : volume,
    //     stopPrice  : stopPrice
    //   };
    //   return this._pCall('/v3/order', data, "POST")
    // }
    // else if (type === 'stop_loss_limit') {
    // }
    // else if (type === 'take_profit') {
    // }
    // else if (type === 'take_profit_limit') {
    // }

    throw Error('Unexpected order type');
  }
}
