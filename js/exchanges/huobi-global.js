import ReWS from 'reconnecting-websocket';
import Exchanges from './baseExchange';
import pako from 'pako';
import CryptoJS from 'crypto-js';


export default class HuobiG extends Exchanges {
  constructor(proxy) {
    super();
    this.name = 'Huobi Global';
    this._mainUrl = 'wss://api.huobi.pro/ws`';
    this._sockets = {};

    this._proxy = proxy;
    this._proxy_enable = !!proxy;
    this.BASE = `${this._proxy_enable ? this._proxy : ''}https://api.huobi.pro`;

    this.streams = {
      depth: symbol =>
        JSON.stringify({ 'sub': `market.${symbol}.depth.step0`, 'id': '133' }),
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
      submitted: 'open',
      'partial-filled': 'open',
      filled: 'closed',
      'partial-canceled': 'canceled',
      canceled: 'canceled',
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
          pair.symbol = pair.symbol.toUpperCase();
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

  makeQueryString(q) {
    return q
      ? `?${Object.keys(q).sort()
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`)
        .join('&')}`
      : '';
  }

  digitFormat(a) {
    if (a < 10) {
      return `0${a}`;
    }
    return `${a}`;
  }

  timeFormat(a) {
    const year = this.digitFormat(a.getFullYear());
    const month = this.digitFormat(a.getMonth() + 1);
    const day = this.digitFormat(a.getDate());
    const hour = this.digitFormat(a.getHours());
    const minute = this.digitFormat(a.getMinutes());
    const second = this.digitFormat(a.getSeconds());
    const str = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    return str;
  }


  async pCall(path, apiKey, apiSecret, method = 'GET', data = {}) {
    if (!apiKey || !apiSecret) {
      throw new Error('You need to pass an API key and secret to make authenticated calls.');
    }

    const date = new Date();
    date.setTime(date.getTime() + date.getTimezoneOffset() * 60 * 1000);
    data.Timestamp = this.timeFormat(date);
    data.AccessKeyId = apiKey;
    data.SignatureMethod = 'HmacSHA256';
    data.SignatureVersion = '2';

    const dirUrl = path.replace(/.*\/\/[^\/]*/, '');

    // Add new format querry string
    // const querryString = `AccessKeyId=e2xxxxxx-99xxxxxx-84xxxxxx-7xxxx&SignatureMethod=HmacSHA256&SignatureVersion=2&Timestamp=2017-05-11T15%3A19%3A30`;

    const signString = `${method}\n${this.BASE.replace('https://', '')}\n${path}\n${this.makeQueryString(data).replace('?', '')}`;

    const signature = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(signString, apiSecret));

    const dataString = this.makeQueryString(data) + '&Signature=' + encodeURIComponent(signature);

    const prom = method === 'GET' ?
      fetch(`${this.BASE}${path}${dataString}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
      })
      :
      fetch(`${this.BASE}${path}${dataString}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

    return prom.then((r) => {
      // if (r.status === 401) throw new Error('Invalid api keys or insufficient permissions');
      // if (r.status === 419) throw new Error('Probably, there is another terminal running on this IP. Currently only one terminal per IP allowed');
      // if (r.status === 429) throw new Error('Probably, there is another terminal running on this IP. Currently only one terminal per IP allowed');
      return r.json();
    }).then(response => {
      if (response.status === 'error') throw new Error(`huobi ${response['err-msg']}`);
      // if (response.code === -1021) throw new Error('You have different time/date with server. Check your local time/date settings');
      // if (response.code === -1022) throw new Error('Invalid api keys or insufficient permissions');
      // if (response.code === -2010) throw new Error('Account has insufficient balance');
      return response;
    });
  }

  getBalance({ apiKey, apiSecret }) {
    return this.pCall('/v1/account/accounts', apiKey, apiSecret).then(res => {
      const result = { exchange: {} };
      const proms = res.data.map(({ id }) => {
        return this.pCall(`/v1/account/accounts/${id}/balance`, apiKey, apiSecret).then(res => {
          res.data.list.forEach(el => {
            if (+el.balance > 0) {
              if (!result.exchange[el.currency.toUpperCase()]) {
                result.exchange[el.currency.toUpperCase()] = {
                  coin: el.currency.toUpperCase(),
                  free: 0,
                  used: 0,
                  total: 0,
                };
              }
              if (el.type === 'trade') result.exchange[el.currency.toUpperCase()].free = +el.balance;
              if (el.type === 'frozen') result.exchange[el.currency.toUpperCase()].used = +el.balance;
              result.exchange[el.currency.toUpperCase()].total = result.exchange[el.currency.toUpperCase()].free + result.exchange[el.currency.toUpperCase()].used;
            }
          });
        });
      });
      return Promise.all(proms).then(() => {
        console.log('getBalance', result);
        return result;
      });
    });
  }

  async getOpenOrders({ apiKey, apiSecret }) {

    return this.pCall('/v1/order/openOrders', apiKey, apiSecret, 'GET', {
      size: 2000,
    }).then(res => {
      return res.data.map(order => {
        const [side, type] = order.type.split('-');
        let numSub = 3;
        if (order.symbol.endsWith('ht')) numSub = 2;
        if (order.symbol.endsWith('usdt') || order.symbol.endsWith('husd')) numSub = 4;
        order.symbol = order.symbol.toUpperCase();
        const base = order.symbol.substr(order.symbol.length - numSub);
        const target = order.symbol.substr(0, order.symbol.length - numSub);
        const symbol = `${target}/${base}`;
        return {
          id: order.id,
          timestamp: new Date(order['created-at']).getTime(),
          lastTradeTimestamp: new Date(order['created-at']).getTime(),
          status: this.status[order.state],
          symbol: symbol,
          type: type,
          side: side,
          price: +order.price,
          stopPx: 0,
          amount: +order.amount,
          executed: +order['filled-amount'],
          filled: ((+order['filled-amount']) / +order.amount) * 100,
          remaining: +order.quantity - +order.cumQuantity,
          cost: +order.price * (+order.amount),
          fee: {
            symbol: 0,
            value: 0,
          },
        };
      });
    }).then(res => {
      console.log('getOpenOrders', res);
      return res;
    });

    // account-id: 6683454
    // amount: "50.000000000000000000"
    // created-at: 1561456814794
    // filled-amount: "0.0"
    // filled-cash-amount: "0.0"
    // filled-fees: "0.0"
    // id: 38268159150
    // price: "0.090000000000000000"
    // source: "web"
    // state: "submitted"
    // symbol: "adausdt"
    // type: "buy-limit"

  }


  async getAllOrders({ apiKey, apiSecret }, { pair, status, orderId } = {}) {
    const closed = await this.getClosedOrders({ apiKey, apiSecret }, { pair });
    const opened = await this.getOpenOrders({ apiKey, apiSecret });
    console.log('GAVNOVHUIAH', closed, opened);
    const allOrders = [...closed, ...opened];

    if (orderId) return allOrders.filter(order => order.id === orderId);
    if (orderId) return allOrders.filter(order => order.status === status);
    return allOrders;
  }

  async getClosedOrders({ apiKey, apiSecret }, { pair } = {}) {
    return this.pCall('/v1/account/accounts', apiKey, apiSecret).then(res => {
      const result = [];
      const proms = res.data.map(({ id }) => {
        return this.pCall('/v1/order/orders', apiKey, apiSecret, 'GET', {
          symbol: pair.replace('/', '').toLowerCase(),
          states: 'partial-canceled,filled,canceled',
          size: 100,
          'account-id': id,
        }).then(res => {
          res.data.forEach(order => {
            const [side, type] = order.type.split('-');
            let numSub = 3;
            if (order.symbol.endsWith('ht')) numSub = 2;
            if (order.symbol.endsWith('usdt') || order.symbol.endsWith('husd')) numSub = 4;
            order.symbol = order.symbol.toUpperCase();
            const base = order.symbol.substr(order.symbol.length - numSub);
            const target = order.symbol.substr(0, order.symbol.length - numSub);
            const symbol = `${target}/${base}`;
            result.push({
              id: order.id,
              timestamp: new Date(order['created-at']).getTime(),
              lastTradeTimestamp: new Date(order['created-at']).getTime(),
              status: this.status[order.state],
              symbol: symbol,
              type: type,
              side: side,
              price: +order.price,
              stopPx: 0,
              amount: +order.amount,
              executed: +order['filled-amount'],
              filled: ((+order['filled-amount']) / +order.amount) * 100,
              remaining: +order.quantity - +order.cumQuantity,
              cost: +order.price * (+order.amount),
              fee: {
                symbol: 0,
                value: 0,
              },
            });
          });
        });
      });

      return Promise.all(proms).then(() => result);
    });
  }

  async cancelOrder({ apiKey, apiSecret }, { pair, orderId }) {
    return this.pCall(`/v1/order/orders/${orderId}/submitcancel`, apiKey, apiSecret, 'POST', {}).then(res => {
      console.log('cancelOrder', res);
      return this.getAllOrders({ apiKey, apiSecret }, { pair, orderId });
    });
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

    const info = await this.getPairInfo(data.pair);

    return this.pCall('/v1/account/accounts', apiKey, apiSecret).then(res => {
      const accId = res.data[0].id;

      const payload = {
        'account-id': `${accId}`,
        'amount': data.volume.toFixed(info['amount-precision']),
        'source': 'api',
        'symbol': data.pair.replace('/', '').toLowerCase(),
        'type': `${data.side}-${data.type}`.toLowerCase(),
      };

      if (data.type === 'limit') {
        if (!data.volume) {
          throw Error('Need pass order price');
        }
        payload.price = (+data.price).toFixed(info['price-precision']);
      }
      return this.pCall('/v1/order/orders/place', apiKey, apiSecret, 'POST', payload).then(res => {
        return this.getAllOrders({ apiKey, apiSecret }, { pair: data.pair, orderId: res.data });
      });

    });
  }

  async getPairInfo(pair) {
    const [base, quote] = pair.toLowerCase().split('/');
    return fetch(this.BASE + '/v1/common/symbols').then(r => r.json()).then(r => {
      const res = r.data.filter(coin => coin['base-currency'] === base && coin['quote-currency'] === quote);
      // console.log('getPairInfo', r, res);
      return res[0];
    });
  }

}
