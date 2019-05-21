/* eslint-disable max-len,no-constant-condition */
import BitShares from 'btsdex-fix';
import Exchanges from './baseExchange';

export default class CryproBridge extends Exchanges {
  constructor(data = {}) {
    super();
    this._login = data.key;
    this._pass = data.secret;
    this.name = 'CryptoBridge';
    this._sockets = {};
    this._proxy = data.proxy || '';
    this.BASE = `${this._proxy}https://api.crypto-bridge.org`;
    this.connected = BitShares.connect();
    this.times = {
      1: 60,
      5: 300,
      60: 3600,
      '1D': 86400
    };

    this.staticPairs = ['NSK4AM', 'BTS'];
    this.markets = ['BTC', 'ETH', 'BTS', 'USD', 'LTC', 'XDOGE'];
    this.stableCoins = [];

    this.ms = {
      1: 60 * 1000,
      5: 300 * 1000,
      60: 3600 * 1000,
      '1D': 86400 * 1000
    };
  }

  getOrderTypes() {
    return ['limit'];
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

  async getPairs() {
    return fetch(`${this.BASE}/api/v1/ticker`)
      .then(r => r.json())
      .then(res => {
        const pairs = {
          BTC: [],
          ALT: []
        };
        const fullList = {};
        res.forEach(pair => {
          const id = pair.id.split('_');
          const coin = id[0];
          const base = id[1];
          const symbol = `${coin}/${base}`;

          const data = {
            symbol,
            volume: +pair.volume,
            priceChangePercent: +pair.percentChange,
            price: +pair.last,
            high: +pair.ask,
            low: +pair.bid,
            quote: coin,
            base,
            maxLeverage: 0,
            tickSize: 0
          };
          if (data.price !== 0) {
            if (base === 'BTC') {
              pairs[base].push(data);
            } else {
              pairs.ALT.push(data);
            }
            fullList[symbol] = data;
          }
        });
        return [pairs, fullList];
      });
  }

  async getAllAssets() {
    return this.connected.then(async () => {
      const assets = [];
      const count = 100;
      while (true) {
        const n =
          assets.length === 0
            ? BitShares.db.list_assets('A', count)
            : BitShares.db.list_assets(assets[assets.length - 1].symbol, count);
        if (n.length < 20) break;
        n.forEach(el => assets.push(el));
      }
      return assets;
    });
  }

  async getObjectsById(data = []) {
    return this.connected.then(async () => {
      if (!Array.isArray(data)) throw Error('Need pass data in array');
      return BitShares.db.get_objects(data);
    });
  }

  async getOrderBook(pair) {
    let [quote, base] = pair.split('/');
    quote = this.staticPairs.indexOf(quote) === -1 ? `BRIDGE.${quote}` : quote;
    base = this.staticPairs.indexOf(base) === -1 ? `BRIDGE.${base}` : base;
    return this.connected.then(async () => {
      const [baseId, basePres] = await BitShares.assets[base].then(r => [r.id, r.precision]);
      const [quoteId, quotePres] = await BitShares.assets[quote].then(r => [r.id, r.precision]);
      const data = await BitShares.db.get_limit_orders(baseId, quoteId, 300);
      const asks = {};
      const bids = {};
      const result = {
        bids: [],
        asks: [],
        type: 'snapshot',
        exchange: 'cryptobridge',
        symbol: pair
      };
      data.forEach(el => {
        if (el.sell_price.base.asset_id === baseId) {
          let price =
            el.sell_price.base.amount / el.sell_price.quote.amount / 10 ** (basePres - quotePres);
          price = +price.toFixed(8);
          const volume = el.sell_price.quote.amount / 10 ** quotePres;
          if (Object.prototype.hasOwnProperty.call(bids, price)) {
            bids[price] += volume;
          } else {
            bids[price] = volume;
          }
        } else {
          let price =
            el.sell_price.quote.amount / el.sell_price.base.amount / 10 ** (basePres - quotePres);
          price = +price.toFixed(8);
          const volume = el.sell_price.base.amount / 10 ** quotePres;
          if (Object.prototype.hasOwnProperty.call(asks, price)) {
            asks[price] += volume;
          } else {
            asks[price] = volume;
          }
        }
      });
      result.asks = Object.keys(asks)
        .sort((a, b) => +a - +b)
        .map(price => [+price, asks[price]]);
      result.bids = Object.keys(bids)
        .sort((a, b) => +b - +a)
        .map(price => [+price, bids[price]]);
      return result;
    });
  }

  async getTrades(pair, limit = 200) {
    let [base, quote] = pair.split('/');
    quote = this.staticPairs.indexOf(quote) === -1 ? `BRIDGE.${quote}` : quote;
    base = this.staticPairs.indexOf(base) === -1 ? `BRIDGE.${base}` : base;
    return this.connected.then(async () => {
      const result = [];
      const [baseId, basePres] = await BitShares.assets[base].then(r => [r.id, r.precision]);
      const [quoteId, quotePres] = await BitShares.assets[quote].then(r => [r.id, r.precision]);
      const data = await BitShares.history.get_fill_order_history(baseId, quoteId, limit);
      data.forEach(e => {
        if (e.op.is_maker) {
          const [bP, qP] =
            e.op.pays.asset_id === quoteId ? [quotePres, basePres] : [basePres, quotePres];

          const baseAmount = e.op.fill_price.base.amount / 10 ** bP;
          const quoteAmount = e.op.fill_price.quote.amount / 10 ** qP;
          const time = new Date(e.time).getTime();
          const offset = new Date().getTimezoneOffset() * 60000;
          const timestamp = time - offset;
          const trade = {
            id: e.id,
            side: e.op.pays.asset_id === baseId ? 'buy' : 'sell',
            price:
              e.op.pays.asset_id === quoteId ? baseAmount / quoteAmount : quoteAmount / baseAmount,
            timestamp,
            amount:
              e.op.pays.asset_id !== quoteId
                ? e.op.pays.amount / 10 ** bP
                : e.op.receives.amount / 10 ** qP,
            symbol: pair,
            exchange: 'cryptobridge'
          };
          result.push(trade);
        }
      });
      return result;
    });
  }

  async getKline(pair = 'ETH/BTC', interval = 60, start) {
    if (!start) start = new Date().getTime() / 1000 | 0;
    const sInterval = this.times[interval];
    let [base, quote] = pair.split('/');
    quote = this.staticPairs.indexOf(quote) === -1 ? `BRIDGE.${quote}` : quote;
    base = this.staticPairs.indexOf(base) === -1 ? `BRIDGE.${base}` : base;
    const offset = new Date().getTimezoneOffset() * 60000;
    return this.connected
      .then(async () => {
        const startISO = new Date(start * 1000).toISOString().split('.')[0];
        const end = '2100-1-1T18:31:42';
        const [baseId, basePres] = await BitShares.assets[base].then(r => [r.id, r.precision]);
        const [quoteId, quotePres] = await BitShares.assets[quote].then(r => [r.id, r.precision]);
        const rPres = basePres - quotePres;
        const data = await BitShares.history.get_market_history(
          baseId,
          quoteId,
          sInterval,
          startISO,
          end
        );

        const result = [];
        data.forEach(el => {
          const date = new Date(el.key.open).getTime() - offset;
          if (el.key.base !== baseId) {
            result.push({
              time: date,
              open: (el.open_base / el.open_quote) * 10 ** rPres,
              high: (el.high_base / el.high_quote) * 10 ** rPres,
              low: (el.low_base / el.low_quote) * 10 ** rPres,
              close: (el.close_base / el.close_quote) * 10 ** rPres,
              volume: el.quote_volume / 10 ** basePres
            });
          } else {
            result.push({
              time: date.getTime(),
              open: (el.open_quote / el.open_base) * 10 ** rPres,
              high: (el.high_quote / el.high_base) * 10 ** rPres,
              low: (el.low_quote / el.low_base) * 10 ** rPres,
              close: (el.close_quote / el.close_base) * 10 ** rPres,
              volume: el.base_volume / 10 ** basePres
            });
          }
        });
        return result;
      })
      .then(rawKline => {
        if (interval === '1M') return rawKline;
        const kline = [];
        let prevTime = -1;
        rawKline.forEach(candle => {
          if (prevTime !== -1 && candle.time - this.ms[interval] !== prevTime) {
            while (prevTime !== candle.time) {
              const newCandle = {
                time: prevTime + this.ms[interval],
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
  }

  onTrade(symbol, eventHandler) {
    const handler = (r, lastId) => {
      r.reverse().forEach(trade => {
        if (trade.id > `${lastId}`) {
          eventHandler(trade);
        }
      });
    };

    let lastId = -0;
    this.getTrades(symbol, 20)
      .then(r => {
        handler(r, lastId);
        if (r.length) lastId = r[r.length - 1].id;
      })
      .then(() => {
        this._sockets.trade = setInterval(() => {
          this.getTrades(symbol, 20).then(r => {
            handler(r, lastId);
            if (r.length) lastId = r[r.length - 1].id;
          });
        }, 5000);
      });
  }

  onDepthUpdate(symbol, eventHandler) {
    this.getOrderBook(symbol).then(eventHandler);
    this._sockets.orderbook = setInterval(() => {
      this.getOrderBook(symbol).then(eventHandler);
    }, 5000);
  }

  onKline(symbol, interval, eventHandler) {
    const sInterval = this.times[interval];
    this._sockets.kline = setInterval(() => {
      const date = new Date().getTime() / 1000 - sInterval * 100;
      this.getKline(symbol, interval, date, 1).then(r => eventHandler(r[r.length - 1]));
    }, 3000);
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

  async getBalance({ apiKey, apiSecret }) {
    if (apiKey) {
      return this.connected
        .then(() => {
          if (apiKey && apiSecret) {
            this.BS = BitShares.login(apiKey, apiSecret);
          }
          return this.BS;
        })
        .then(async () =>
          BitShares.db
            .get_full_accounts([apiKey], false)
            .then(async data => {
              const balances = data[0][1].balances;
              const openOrders = data[0][1].limit_orders;
              const result = { exchange: {} };
              const list = balances.map(async el => {
                const [assetName, assetPres] = await this.getObjectsById([el.asset_type]).then(
                  r => [r[0].symbol.replace('BRIDGE.', ''), r[0].precision]
                );
                const orders = openOrders.filter(e => e.sell_price.base.asset_id === el.asset_type);
                let used = 0;
                const free = +el.balance / 10 ** assetPres;
                orders.forEach(e => {
                  used += e.for_sale / 10 ** assetPres;
                });

                result.exchange[assetName] = {
                  coin: assetName,
                  free,
                  used,
                  total: free + used
                };
              });
              await Promise.all(list);
              return result;
            })
            .catch(err => {
              throw new Error(err.message);
            })
        );
    }
    return [];
  }

  async getOpenOrders({ apiKey }) {
    if (apiKey) {
      const pairs = Object.keys((await this.getPairs())[1]);
      return this.connected.then(async () =>
        BitShares.db
          .get_full_accounts([apiKey], false)
          .then(r => r[0][1].limit_orders)
          .then(data => {
            const list = data.map(async order => {
              const [base, quote] = await this.getObjectsById([
                order.sell_price.base.asset_id,
                order.sell_price.quote.asset_id
              ]);
              const basePres = base.precision;
              const quotePres = quote.precision;
              let pair = `${quote.symbol.replace('BRIDGE.', '')}/${base.symbol.replace(
                'BRIDGE.',
                ''
              )}`;
              const explar = new Date(
                new Date(order.expiration).getTime() -
                new Date(order.expiration).getTimezoneOffset() * 60000
              );
              if (pairs.indexOf(pair) !== -1) {
                const price =
                  (order.sell_price.base.amount / order.sell_price.quote.amount) *
                  10 ** (quotePres - basePres);
                const amount = +order.sell_price.quote.amount / 10 ** quotePres;
                const cost = +order.sell_price.quote.amount / 10 ** basePres;
                return {
                  id: order.id,
                  timestamp: explar,
                  lastTradeTimestamp: 0,
                  status: 'open',
                  symbol: pair,
                  type: 'limit',
                  side: 'buy',
                  price,
                  amount,
                  executed: 0,
                  filled: 0,
                  remaining: amount,
                  cost,
                  fee: {}
                };
              }
              pair = `${base.symbol.replace('BRIDGE.', '')}/${quote.symbol.replace('BRIDGE.', '')}`;
              const price =
                (order.sell_price.quote.amount / order.sell_price.base.amount) *
                10 ** (basePres - quotePres);
              const amount = +order.sell_price.base.amount / 10 ** basePres;
              const cost = +order.sell_price.base.amount / 10 ** quotePres;
              return {
                id: order.id,
                timestamp: explar,
                lastTradeTimestamp: 0,
                status: 'open',
                symbol: pair,
                type: 'limit',
                side: 'sell',
                price,
                amount,
                executed: 0,
                filled: 0,
                remaining: amount,
                cost,
                fee: {}
              };
            });
            return Promise.all(list);
          })
      );
    }

    return [];
  }

  async getClosedOrders({ apiKey }, { pair } = {}) {
    let [base, quote] = pair.split('/');
    quote = this.staticPairs.indexOf(quote) === -1 ? `BRIDGE.${quote}` : quote;
    base = this.staticPairs.indexOf(base) === -1 ? `BRIDGE.${base}` : base;
    const [baseId, basePres] = await BitShares.assets[base].then(r => [r.id, r.precision]);
    const [quoteId, quotePres] = await BitShares.assets[quote].then(r => [r.id, r.precision]);
    const accId = (await BitShares.accounts[apiKey]).id;

    if (apiKey) {
      return this.connected.then(() =>
        BitShares.history
          .get_fill_order_history(baseId, quoteId, 200)
          .then(r => r.filter(e => e.op.account_id === accId))
          .then(data => {
            const list = data.map(async order => {
              const offset = new Date().getTimezoneOffset() * 60000;
              const time = new Date(order.time).getTime() - offset;
              if (baseId === order.op.pays.asset_id) {
                const price =
                  (order.op.receives.amount / order.op.pays.amount) * 10 ** (basePres - quotePres);
                const amount = +order.op.pays.amount / 10 ** basePres;
                const cost = +order.op.receives.amount / 10 ** quotePres;
                return {
                  id: order.id,
                  timestamp: time,
                  lastTradeTimestamp: 0,
                  status: 'close',
                  symbol: pair,
                  type: 'LIMIT',
                  side: 'sell',
                  price,
                  amount,
                  executed: amount,
                  filled: 100,
                  remaining: 0,
                  cost,
                  fee: {
                    // 'symbol': base,
                    // 'value' :
                    // order.cummulativeQuoteQty >
                    // 0 ?
                    // order.cummulativeQuoteQty *
                    // 0.001 : 0
                  }
                };
              }
              const price =
                (order.op.pays.amount / order.op.receives.amount) * 10 ** (basePres - quotePres);
              const amount = +order.op.receives.amount / 10 ** basePres;
              const cost = +order.op.pays.amount / 10 ** quotePres;
              return {
                id: order.id,
                timestamp: time,
                lastTradeTimestamp: 0,
                status: 'close',
                symbol: pair,
                type: 'LIMIT',
                side: 'buy',
                price,
                amount,
                executed: amount,
                filled: 100,
                remaining: 0,
                cost,
                fee: {
                  // 'symbol': base,
                  // 'value' :
                  // order.cummulativeQuoteQty >
                  // 0 ?
                  // order.cummulativeQuoteQty *
                  // 0.001 : 0
                }
              };
            });
            return Promise.all(list);
          })
      );
    }
    return [];
  }

  async cancelOrder({ apiKey, apiSecret }, { orderId } = {}) {
    return this.connected
      .then(() => {
        if (apiKey && apiSecret) {
          this.BS = BitShares.login(apiKey, apiSecret);
        }
        return this.BS;
      })
      .then(() => this.BS.then(acc => acc.cancelOrder(orderId)));
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
    if (!data.price) {
      throw Error('Need pass order pair');
    }
    if (!data.side) {
      throw Error('Need pass order side');
    }
    if (!data.volume) {
      throw Error('Need pass order volume');
    }

    let [base, quote] = data.pair.split('/');
    quote = this.staticPairs.indexOf(quote) === -1 ? `BRIDGE.${quote}` : quote;
    base = this.staticPairs.indexOf(base) === -1 ? `BRIDGE.${base}` : base;
    return this.connected
      .then(() => {
        if (apiKey && apiSecret) {
          this.BS = BitShares.login(apiKey, apiSecret);
        }
        return this.BS;
      })
      .then(async () => {
        return this.BS.then(async acc => {
          if (data.side === 'buy') {
            return acc.buy(base, quote, data.volume, data.price);
          }
          return acc.sell(base, quote, data.volume, data.price);
        }).then(order =>
          this.getAllOrders(
            { apiKey, apiSecret },
            {
              pair: data.pair,
              orderId: order && order.id
            }
          )
        );
      });
  }

  async getAllOrders(credentials, { pair, orderId } = {}) {
    const openOrders = await this.getOpenOrders(credentials);
    const closedOrders = await this.getClosedOrders(credentials, { pair });
    const allOrders = openOrders.concat(closedOrders);
    if (orderId) {
      return allOrders.reduce((p, c) => {
        if (c.id === orderId) {
          return [c];
        }
        return p;
      }, []);
    }
    return allOrders;
  }
}
