import Exchanges from 'websocket-crypto-api/exchanges/baseExchange';

export default class Exmo extends Exchanges {
  constructor(data = {}) {
    super();
    this.name = 'Exmo';
    this._sockets = {};
    this._proxy = data.proxy || '';

    // this._key = data.key;
    // this._secret = data.secret;

    this.status = {
      NEW: 'open',
      PARTIALLY_FILLED: 'open',
      FILLED: 'closed',
      CANCELED: 'canceled',
      REJECTED: 'canceled',
      EXPIRED: 'canceled',
    };

    this.type = {
      LIMIT: 'limit',
      MARKET: 'market',
      STOP_LOSS: 'stop_loss',
      STOP_LOSS_LIMIT: 'stop_loss_limit',
      TAKE_PROFIT: 'take_profit',
      TAKE_PROFIT_LIMIT: 'take_profit_limit',
      LIMIT_MAKER: 'limit_maker',
    };

    // this.types = {
    //   limit: 'LIMIT',
    //   market: 'MARKET',
    //   stop_loss: 'STOP_LOSS',
    //   stop_loss_limit: 'STOP_LOSS_LIMIT',
    //   take_profit: 'TAKE_PROFIT',
    //   take_profit_limit: 'TAKE_PROFIT_LIMIT',
    // };

    this.stable_coins = ['USD', 'USDT', 'USDC', 'PAX', 'EUR', 'RUB', 'UAH'];

    this.ms = {
      '1': 60,
      '5': 300,
      '15': 60 * 15,
      '30': 30 * 60,
      '60': 60 * 60,
      '120': 120 * 60,
      '240': 240 * 60,
      'D': 24 * 60 * 60,
      'W': 7 * 24 * 60 * 60,
    };
  }

  getExchangeConfig() {
    return {
      exchange: {
        isActive: true,
        componentList: ['open', 'history', 'balance'],
        orderTypes: ['limit'],
      },
      margin: {
        isActive: false,
      },
      intervals: this.getSupportedInterval(),
    };
  }

  getSupportedInterval() {
    return ['1', '5', '15', '30', '60', '120', '240', 'D', 'W'];
  }

  _setupWebSocket(eventHandler, type) {
    if (this._sockets[type]) {
      clearInterval(this._sockets[type]);
    }
    this._sockets[type] = setInterval(() => {
      eventHandler();
    }, 5000);
    return this._sockets[type];
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

  onTrade(symbol = 'BTC/USDT', eventHandler) {
    let lastTrade = 0;

    const handler = () => {
      this.getTrades(symbol).then(r => {
        r.forEach(t => {
          if (t.id > lastTrade) {
            lastTrade = t.id;
            eventHandler(t);
          }
        });
      });
    };
    handler();
    return this._setupWebSocket(
      handler,
      'trade',
    );
  }

  onDepthUpdate(symbol = 'BTC/USDT', eventHandler) {

    const handler = () => {
      this.getOrderBook(symbol).then(r => {
        eventHandler(r);
      });
    };
    handler();
    return this._setupWebSocket(
      handler,
      'orderbook',
    );
  }

  onKline(symbol = 'BTC/USDT', interval = 60, eventHandler) {
    const handler = () => {
      const now = Date.now() / 1000 | 0;
      this.getKline(symbol, interval, now - this.ms[interval] - 100, now).then(data => {
        eventHandler(data[0]);
      });
    };
    handler();
    return this._setupWebSocket(
      handler,
      'kline',
    );
  }

  async getPairs() {
    return fetch(`${this._proxy}https://api.exmo.me/v1/ticker/`)
      .then(r => r.json())
      .then(r => {
        const pairs = {
          BTC: [],
          ALT: [],
          STABLE: [],
        };
        const fullList = {};
        Object.keys(r).forEach(name => {
          const pair = r[name];
          const [target, base] = name.split('_');
          const symbol = `${target}/${base}`;
          const data = {
            symbol,
            volume: +pair.vol_curr,
            priceChangePercent: 0,
            price: +pair.last_trade,
            high: +pair.high,
            low: +pair.low,
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

  async getTrades(pair) {
    return fetch(`${this._proxy}https://api.exmo.me/v1/trades/?pair=${pair.replace('/', '_')}`)
      .then(r => r.json())
      .then(r => {
        const res = [];
        r[pair.replace('/', '_')].forEach(raw => {
          res.push({
            id: raw.trade_id,
            side: raw.type,
            timestamp: raw.date * 1000,
            price: +raw.price,
            amount: +raw.amount,
            symbol: pair,
            exchange: 'exmo',
          });
        });
        return res.reverse();
      });
  }

  async getOrderBook(pair) {
    return fetch(`${this._proxy}https://api.exmo.me/v1/order_book/?pair=${pair.replace('/', '_')}`)
      .then(r => r.json())
      .then(r => {
        const data = {
          asks: [],
          bids: [],
          type: 'snapshot',
          exchange: 'exmo',
          symbol: pair,
        };

        r[pair.replace('/', '_')].ask.forEach(raw => {
          data.asks.push([+raw[0], +raw[1]]);
        });
        r[pair.replace('/', '_')].bid.forEach(raw => {
          data.bids.push([+raw[0], +raw[1]]);
        });
        return data;
      });
  }

  async getKline(pair = 'BTC/USDT', interval = 60, start = 0, end) {
    if (!end) end = new Date().getTime() / 1000;

    const symbol = pair.replace('/', '_');
    return fetch(
      `${this._proxy}https://chart.exmoney.com/ctrl/chart/history?symbol=${symbol}&resolution=${interval}&from=${start}&to=${end}`,
    )
      .then(r => r.json())
      .then(r => {
        return r.candles.map(obj => {
          return {
            time: obj.t,
            open: +obj.o,
            high: +obj.h,
            low: +obj.l,
            close: +obj.c,
            volume: +obj.v,
          };
        });
      });
  }

  // async getBalance(credentials) {
  //   return this._pCall(
  //     '/v3/account',
  //     { recvWindow: RecvWindow },
  //     'GET',
  //     credentials,
  //   ).then(r => {
  //     const newData = { exchange: {} };
  //     if (r && r.balances) {
  //       r.balances.forEach(c => {
  //         if (+c.free !== 0 || +c.locked !== 0) {
  //           newData.exchange[c.asset] = {
  //             coin: c.asset,
  //             free: +c.free,
  //             used: +c.locked,
  //             total: +c.free + +c.locked,
  //           };
  //         }
  //       });
  //     }
  //     return newData;
  //   });
  // }
  //
  // async getOpenOrders(credentials, { pair } = {}) {
  //   const symbol = pair ? pair.replace('/', '') : '';
  //   const data = { recvWindow: RecvWindow };
  //   if (symbol) {
  //     data.symbol = symbol;
  //   }
  //
  //   return this._pCall('/v3/openOrders', data, 'GET', credentials).then(r => {
  //     const newData = [];
  //     if (r) {
  //       r.forEach(order => {
  //         const responsePair = pair ? symbol : order.symbol;
  //         const base =
  //           responsePair.indexOf('USDT') === -1
  //             ? responsePair.substr(responsePair.length - 3)
  //             : responsePair.substr(responsePair.length - 4);
  //         const target =
  //           base === 'USDT'
  //             ? responsePair.substr(0, responsePair.length - 4)
  //             : responsePair.substr(0, responsePair.length - 3);
  //         const responseSymbol = `${target}/${base}`;
  //         newData.push({
  //           id: order.orderId,
  //           timestamp: order.time,
  //           lastTradeTimestamp: order.updateTime,
  //           status: this.status[order.status],
  //           symbol: responseSymbol,
  //           type: this.type[order.type],
  //           side: order.side.toLowerCase(),
  //           price: +order.price,
  //           amount: +order.origQty,
  //           executed: +order.executedQty,
  //           filled: (+order.executedQty / +order.origQty) * 100,
  //           remaining: +order.origQty - +order.executedQty,
  //           cost:
  //             order.cummulativeQuoteQty > 0 ? +order.cummulativeQuoteQty : 0,
  //           fee: {
  //             symbol: base,
  //             value:
  //               order.cummulativeQuoteQty > 0
  //                 ? order.cummulativeQuoteQty * 0.001
  //                 : 0,
  //           },
  //         });
  //       });
  //     }
  //     return newData.reverse();
  //   });
  // }
  //
  // async getAllOrders(credentials, { pair, status, orderId } = {}) {
  //   const symbol = pair ? pair.replace('/', '') : '';
  //   const data = { recvWindow: RecvWindow, symbol };
  //   if (!symbol) {
  //     throw Error('Need pass symbol argument');
  //   }
  //
  //   if (orderId) {
  //     data.orderId = orderId;
  //   }
  //   return this._pCall('/v3/allOrders', data, 'GET', credentials)
  //     .then(r => {
  //       const newData = [];
  //       if (r) {
  //         if (orderId) r = r.filter(order => order.orderId === orderId);
  //         r.forEach(order => {
  //           const base = pair.split('/')[1];
  //           const formatedOrder = {
  //             id: order.orderId,
  //             timestamp: order.time,
  //             lastTradeTimestamp: order.updateTime,
  //             status: this.status[order.status],
  //             symbol: pair,
  //             type: this.type[order.type],
  //             side: order.side.toLowerCase(),
  //             price: +order.cummulativeQuoteQty
  //               ? +order.cummulativeQuoteQty / +order.executedQty
  //               : +order.price,
  //             amount: +order.origQty,
  //             filled: +order.executedQty,
  //             remaining: +order.origQty - +order.executedQty,
  //             cost:
  //               order.cummulativeQuoteQty > 0 ? +order.cummulativeQuoteQty : 0,
  //             fee: {
  //               symbol: base,
  //               value:
  //                 order.cummulativeQuoteQty > 0
  //                   ? order.cummulativeQuoteQty * 0.001
  //                   : 0,
  //             },
  //           };
  //           if ((status && formatedOrder.status === status) || !status) {
  //             newData.push(formatedOrder);
  //           }
  //         });
  //       }
  //       return newData.reverse();
  //     })
  //     .catch(err => {
  //       throw Error(err);
  //     });
  // }
  //
  // async getClosedOrders(credentials, { pair } = {}) {
  //   return this.getAllOrders(credentials, { pair, status: 'closed' });
  // }
  //
  // async cancelOrder(credentials, { pair, orderId } = {}) {
  //   const symbol = pair ? pair.replace('/', '') : '';
  //   const data = { recvWindow: RecvWindow, symbol, orderId };
  //
  //   if (!symbol) {
  //     throw Error('Need pass symbol argument');
  //   }
  //   if (!orderId) {
  //     throw Error('Need pass orderId argument');
  //   }
  //
  //   return this._pCall('/v3/order', data, 'DELETE', credentials).then(() =>
  //     this.getAllOrders(credentials, { pair, type: '', orderId }),
  //   );
  // }
  //
  // async createOrder(credentials, data) {
  //   if (!data) {
  //     throw Error('Need pass oder data object');
  //   }
  //   if (!data.type) {
  //     throw Error('Need pass order type');
  //   }
  //   if (!data.pair) {
  //     throw Error('Need pass order pair');
  //   }
  //   if (!data.side) {
  //     throw Error('Need pass order side');
  //   }
  //   if (!data.volume) {
  //     throw Error('Need pass order volume');
  //   }
  //   const symbol = data.pair.replace('/', '');
  //   return fetch(`${this.BASE}/api/v1/exchangeInfo`)
  //     .then(r => r.json())
  //     .then(exchangeInfo => {
  //       const symbolInfo = exchangeInfo.symbols.find(e => e.symbol === symbol);
  //       if (!symbolInfo) {
  //         throw Error('You pass wrong symbol');
  //       }
  //       const lotFilter = symbolInfo.filters.find(
  //         el => el.filterType === 'LOT_SIZE',
  //       );
  //       const step = +lotFilter.stepSize;
  //
  //       const priceFilter = symbolInfo.filters.find(
  //         el => el.filterType === 'PRICE_FILTER',
  //       );
  //       const precision = +priceFilter.tickSize;
  //
  //       const one = new Decimal(1);
  //       const step_d = new Decimal(step);
  //       const precision_d = new Decimal(precision);
  //       const volume_d = new Decimal(data.volume);
  //       const price_d = new Decimal(data.price);
  //
  //       const volumePres = volume_d
  //         .div(step_d)
  //         .floor()
  //         .mul(step_d);
  //       const pricePres = price_d
  //         .div(precision_d)
  //         .floor()
  //         .mul(precision_d);
  //       // const volumePres = Math.floor(data.volume / step) / (1 / step);
  //       // const pricePres = Math.floor(data.price / precision) / (1 / precision);
  //
  //       if (data.type === 'market') {
  //         const payload = {
  //           recvWindow: RecvWindow,
  //           symbol,
  //           type: this.types[data.type],
  //           side: data.side.toUpperCase(),
  //           quantity: volumePres.toNumber(),
  //         };
  //         return this._pCall('/v3/order', payload, 'POST', credentials).then(
  //           r => {
  //             if (!r.orderId) {
  //               throw Error(r.msg);
  //             }
  //             return this.getAllOrders(credentials, {
  //               pair: data.pair,
  //               status: '',
  //               orderId: r.orderId,
  //             });
  //           },
  //         );
  //         // .then(r => this.getAllOrders(pair_req, "", order_id))
  //       }
  //       if (data.type === 'limit') {
  //         if (!data.price) {
  //           throw Error('Need pass order price');
  //         }
  //
  //         const payload = {
  //           recvWindow: RecvWindow,
  //           symbol,
  //           type: this.types[data.type],
  //           side: data.side.toUpperCase(),
  //           quantity: volumePres.toNumber(),
  //           price: pricePres.toNumber(),
  //           timeInForce: 'GTC',
  //         };
  //         return this._pCall('/v3/order', payload, 'POST', credentials).then(
  //           r => {
  //             if (!r.orderId) {
  //               throw Error(r.msg);
  //             }
  //             return this.getAllOrders(credentials, {
  //               pair: data.pair,
  //               status: '',
  //               orderId: r.orderId,
  //             });
  //           },
  //         );
  //       }
  //       // else if (type === 'stop_loss') {
  //       //   if (!stopPrice) {
  //       //     throw Error("Need pass order price")
  //       //   }
  //       //
  //       //   const data = {
  //       //     recvWindow : RecvWindow,
  //       //     symbol     : symbol,
  //       //     type       : this.types[type],
  //       //     side       : side.toUpperCase(),
  //       //     quantity   : volume,
  //       //     stopPrice  : stopPrice
  //       //   };
  //       //   return this._pCall('/v3/order', data, "POST")
  //       // }
  //       // else if (type === 'stop_loss_limit') {
  //       // }
  //       // else if (type === 'take_profit') {
  //       // }
  //       // else if (type === 'take_profit_limit') {
  //       // }
  //
  //       throw Error('Unexpected order type');
  //     });
  // }
}
