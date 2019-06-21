import ReWS from "reconnecting-websocket";
import Exchanges from "./baseExchange";
import { Decimal } from "decimal.js";

export default class HitBTC extends Exchanges {
  constructor(proxy) {
    super();
    this.name = "HitBTC";
    this._mainUrl = "wss://api.hitbtc.com/api/2/ws";
    this._sockets = {};

    this._proxy = proxy;
    this._proxy_enable = !!proxy;
    this.BASE = `${
      this._proxy_enable ? this._proxy : ""
    }https://api.hitbtc.com`;

    this.streams = {
      depth: symbol =>
        JSON.stringify({
          method: "subscribeOrderbook",
          params: {
            symbol
          },
          id: 123
        }),
      depthLevel: symbol =>
        `${
          this._proxy_enable ? this._proxy : ""
        }https://api.hitbtc.com/api/2/public/orderbook/${symbol}?limit=0`,
      trade: symbol =>
        JSON.stringify({
          method: "subscribeTrades",
          params: {
            symbol
          },
          id: 123
        }),
      kline: (symbol, interval) =>
        JSON.stringify({
          method: "subscribeCandles",
          params: {
            symbol,
            period: this.times[interval]
          },
          id: 123
        })
    };

    this.times = {
      "1": "M1",
      "3": "M3",
      "5": "M5",
      "15": "M15",
      "30": "M30",
      "60": "H1",
      "240": "H4",
      "1D": "D1",
      "1W": "D7"
    };

    this.ms = {
      "1": 60 * 1000,
      "3": 3 * 60 * 1000,
      "5": 5 * 60 * 1000,
      "15": 15 * 60 * 1000,
      "30": 30 * 60 * 1000,
      "60": 60 * 60 * 1000,
      "240": 4 * 60 * 60 * 1000,
      "1D": 24 * 60 * 60 * 1000,
      "1W": 7 * 24 * 60 * 60 * 1000,
      "1M": 30 * 24 * 60 * 60 * 1000
    };

    this.stable_coins = ["USD", "PAX", "SDC", "SDT", "URS"];

    this.status = {
      new: "open",
      suspended: "open",
      partiallyFilled: "open",
      filled: "closed",
      canceled: "canceled",
      expired: "canceled"
    };
  }

  getExchangeConfig() {
    return {
      exchange: {
        isActive: true,
        componentList: ["open", "history", "balance"],
        orderTypes: ["limit", "market"]
      },
      margin: {
        isActive: false
      },
      intervals: this.getSupportedInterval()
    };
  }

  _setupWebSocket(eventHandler, path, type) {
    if (this._sockets[type]) {
      this._sockets[type].close();
    }

    const ws = new ReWS(this._mainUrl, [], {
      WebSocket: this.websocket,
      connectionTimeout: 5000,
      debug: false
    });

    ws.onopen = () => ws.send(path);

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
    const [quote, base] = symbol.split(/[:/]/);
    const newSymbol = quote + base;

    const handler = res => {
      if (res.hasOwnProperty("method")) {
        res = res.params.data;
        res.forEach(e => {
          const data = new Date(e.timestamp);
          const trade = {
            id: e.id,
            side: e.side,
            timestamp: data.getTime(),
            price: +e.price,
            amount: +e.quantity,
            symbol,
            exchange: "hitbtc"
          };
          eventHandler(trade);
        });
      }
    };

    return this._setupWebSocket(
      handler,
      this.streams.trade(newSymbol),
      "trade"
    );
  }

  onDepthUpdate(symbol, eventHandler) {
    const [quote, base] = symbol.split(/[:/]/);
    const newSymbol = quote + base;
    let SnapshotAccepted = false;
    const uBuffer = {
      asks: [],
      bids: [],
      type: "update",
      exchange: "hitbtc",
      symbol
    };
    const handler = res => {
      if (res.hasOwnProperty("method"))
        if (res.method === "updateOrderbook") {
          if (SnapshotAccepted) {
            const data = {
              asks: [],
              bids: [],
              type: "update",
              exchange: "hitbtc",
              symbol
            };
            res = res.params;
            res.ask.forEach(r => data.asks.push([+r.price, +r.size]));
            res.bid.forEach(r => data.bids.push([+r.price, +r.size]));
            eventHandler(data);
          } else {
            res = res.params;
            res.ask.forEach(r => uBuffer.asks.push([+r.price, +r.size]));
            res.bid.forEach(r => uBuffer.bids.push([+r.price, +r.size]));
          }
        }
    };

    fetch(this.streams.depthLevel(newSymbol))
      .then(r => r.json())
      .then(res => {
        const data = {
          asks: [],
          bids: [],
          type: "snapshot",
          exchange: "hitbtc",
          symbol
        };
        res.ask.slice(0, 20).forEach(r => data.asks.push([+r.price, +r.size]));
        res.bid.slice(0, 20).forEach(r => data.bids.push([+r.price, +r.size]));
        eventHandler(data);
      });

    this._setupWebSocket(handler, this.streams.depth(newSymbol), "orderbook");
    setTimeout(() => {
      fetch(this.streams.depthLevel(newSymbol))
        .then(r => r.json())
        .then(res => {
          const data = {
            asks: [],
            bids: [],
            type: "snapshot",
            exchange: "hitbtc",
            symbol
          };
          res.ask
            .slice(0, 20)
            .forEach(r => data.asks.push([+r.price, +r.size]));
          res.bid
            .slice(0, 20)
            .forEach(r => data.bids.push([+r.price, +r.size]));
          eventHandler(data);
          SnapshotAccepted = true;
          eventHandler(uBuffer);
        });
    }, 1000);
  }

  onKline(symbol, interval, eventHandler) {
    const [quote, base] = symbol.split(/[:/]/);
    const newSymbol = quote + base;

    const handler = data => {
      if (data.hasOwnProperty("method")) {
        if (data.method === "updateCandles") {
          data = data.params.data[0];
          const date = new Date(data.timestamp);
          const newData = {
            close: +data.close,
            high: +data.max,
            low: +data.min,
            open: +data.open,
            time: date.getTime(),
            volume: +data.volume
          };
          eventHandler(newData);
        }
      }
    };
    return this._setupWebSocket(
      handler,
      this.streams.kline(newSymbol, interval),
      "kline"
    );
  }

  async getPairs() {
    return await fetch(
      `${
        this._proxy_enable
          ? this._proxy
          : "https://api.hitbtc.com/api/2/public/ticker"
      }`
    )
      .then(r => r.json())
      .then(r => {
        const pairs = {
          BTC: [],
          ALT: [],
          STABLE: []
        };
        const fullList = {};
        r.forEach(pair => {
          const base = pair.symbol.substr(pair.symbol.length - 3);
          const target = pair.symbol.substr(0, pair.symbol.length - 3);
          const symbol = `${target}/${base}`;
          const data = {
            symbol,
            volume: +pair.volumeQuote,
            priceChangePercent: 100 - (+pair.last / +pair.open) * 100,
            price: +pair.last,
            high: +pair.high,
            low: +pair.low,
            quote: target,
            base,
            maxLeverage: 0,
            tickSize: 0
          };
          if (data.price !== 0) {
            if (base === "BTC") {
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

  async getKline(pair = "BTC/USD", interval = 60, start, end) {
    if (!end) end = new Date().getTime() / 1000;
    const symbol = pair.replace("/", "");
    const endTime = new Date(end * 1000).toISOString();
    const startTime = new Date(
      end * 1000 - 1000 * this.ms[interval]
    ).toISOString();

    return fetch(
      `${
        this._proxy_enable ? this._proxy : ""
      }https://api.hitbtc.com/api/2/public/candles/${symbol}?period=${
        this.times[interval]
      }&limit=1000&from=${startTime}&till=${endTime}`
    )
      .then(r => r.json())
      .then(r => {
        const newCandles = [];
        r.forEach(obj => {
          const d = new Date(obj.timestamp);
          newCandles.push({
            time: d.getTime(),
            open: +obj.open,
            high: +obj.max,
            low: +obj.min,
            close: +obj.close,
            volume: +obj.volumeQuote
          });
        });
        return newCandles;
      });
  }

  makeQueryString(q) {
    return q
      ? `?${Object.keys(q)
          .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`)
          .join("&")}`
      : "";
  }

  async pCall(path, apiKey, apiSecret, method = "GET", data) {
    if (!apiKey || !apiSecret) {
      throw new Error(
        "You need to pass an API key and secret to make authenticated calls."
      );
    }
    const params = {
      method,
      headers: new Headers({
        Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded"
      })
    };

    if (method === "POST") {
      const formData = new URLSearchParams();
      Object.keys(data).forEach(name => {
        formData.set(name, data[name]);
      });
      params.body = formData;
    }
    return fetch(
      `${this.BASE}${path}${
        method !== "POST" ? this.makeQueryString(data) : ""
      }`,
      params
    )
      .then(r => {
        if (r.status === 503) throw new Error("Service Unavailable");
        // if (r.status === 400) throw new Error('Probably, there is another terminal running on this IP. Currently only one terminal per IP allowed');
        // if (r.status === 429) throw new Error('Probably, there is another terminal running on this IP. Currently only one terminal per IP allowed');
        return r.json();
      })
      .then(response => {
        if (response.error) {
          // if (response.code === -1021) throw new Error('You have different time/date with server. Check your local time/date settings');
          // if (response.code === -1022) throw new Error('Invalid api keys or insufficient permissions');
          if (response.error.code === 20001)
            throw new Error("Account has insufficient balance");
        }
        return response;
      });
  }

  getBalance({ apiKey, apiSecret }) {
    const path = "/api/2/trading/balance";
    return this.pCall(path, apiKey, apiSecret).then(res => {
      const result = { exchange: {} };
      res.forEach(element => {
        if (+element.available + element.reserved > 0) {
          result.exchange[element.currency] = {
            coin: element.currency,
            free: element.available,
            used: element.reserved,
            total: element.reserved + element.available
          };
        }
      });
      return result;
    });
  }

  getOpenOrders({ apiKey, apiSecret }) {
    const path = "/api/2/order";

    return this.pCall(path, apiKey, apiSecret).then(res => {
      return res.map(order => {
        const base = order.symbol.substr(order.symbol.length - 3);
        const target = order.symbol.substr(0, order.symbol.length - 3);
        const symbol = `${target}/${base}`;
        return {
          id: order.clientOrderId,
          timestamp: new Date(order.createdAt).getTime(),
          lastTradeTimestamp: new Date(order.updatedAt).getTime(),
          status: this.status[order.status],
          symbol: symbol,
          type: order.type,
          side: order.side,
          price: +order.price,
          stopPx: order.stopPrice ? +order.stopPrice : order.stopPrice,
          amount: +order.quantity,
          executed: +order.cumQuantity,
          filled: (+order.cumQuantity / +order.quantity) * 100,
          remaining: +order.quantity - +order.cumQuantity,
          cost: order.price * +order.cumQuantity,
          fee: {
            symbol: 0,
            value: 0
          }
        };
      });
    });
  }

  async getClosedOrders({ apiKey, apiSecret }, { pair } = {}) {
    return this.pCall(`/api/2/history/order`, apiKey, apiSecret, "GET", {
      symbol: pair.replace("/", "")
    }).then(res => {
      return res
        .map(order => {
          const base = order.symbol.substr(order.symbol.length - 3);
          const target = order.symbol.substr(0, order.symbol.length - 3);
          const symbol = `${target}/${base}`;
          return {
            id: order.clientOrderId,
            timestamp: new Date(order.createdAt).getTime(),
            lastTradeTimestamp: new Date(order.updatedAt).getTime(),
            status: this.status[order.status],
            symbol: symbol,
            type: order.type,
            side: order.side,
            price: +order.price,
            stopPx: order.stopPrice ? +order.stopPrice : order.stopPrice,
            amount: +order.quantity,
            executed: +order.cumQuantity,
            filled: (+order.cumQuantity / +order.quantity) * 100,
            remaining: +order.quantity - +order.cumQuantity,
            cost: order.price * +order.cumQuantity,
            fee: {
              symbol: 0,
              value: 0
            }
          };
        })
        .filter(order => order.status === "closed");
    });
  }

  async getAllOrders(credentials, { pair, status, orderId } = {}) {
    const openOrders = await this.getOpenOrders(credentials).then(r =>
      r.filter(order => order.symbol === pair)
    );
    const closeOrders = await this.getClosedOrders(credentials, { pair });
    const allOrders = [...openOrders, ...closeOrders];
    if (status) return allOrders.filter(order => order.status === status);
    if (orderId) return allOrders.filter(order => order.id === orderId);
    return allOrders;
  }

  async createOrder({ apiKey, apiSecret }, data) {
    return this.getSymbolInfo(data.pair).then(info => {
      if (!data) {
        throw Error("Need pass oder data object");
      }
      if (!data.type) {
        throw Error("Need pass order type");
      }
      if (!data.pair) {
        throw Error("Need pass order pair");
      }
      if (!data.side) {
        throw Error("Need pass order side");
      }
      if (!data.volume) {
        throw Error("Need pass order volume");
      }

      const tickSize_d = new Decimal(info.tickSize);
      const rate_d = new Decimal(1 + info.takeLiquidityRate);
      const volume_d = new Decimal(data.volume);

      const volumePres = volume_d.div(rate_d);

      data.volume = +volumePres.toNumber().toFixed(8);

      const path = "/api/2/order";
      const body = {
        symbol: data.pair.replace("/", ""),
        side: data.side,
        type: data.type,
        quantity: data.volume
      };

      if (data.type === "limit") {
        const price_d = new Decimal(data.price);
        const pricePres = price_d
          .div(tickSize_d)
          .floor()
          .mul(tickSize_d);
        data.price = pricePres.toNumber();

        body.price = +data.price;
      }

      if (data.type.indexOf("stop") !== -1) {
        const stopprice_d = new Decimal(data.stopPrice);
        const stoppricePres = price_d
          .div(tickSize_d)
          .floor()
          .mul(tickSize_d);
        data.stopPrice = stoppricePres.toNumber();

        body.stopPrice = +data.stopPrice;
      }
      return this.pCall(path, apiKey, apiSecret, "POST", body)
        .then(order => {
          return [
            {
              id: order.clientOrderId,
              timestamp: new Date(order.createdAt).getTime(),
              lastTradeTimestamp: new Date(order.updatedAt).getTime(),
              status: this.status[order.status],
              symbol: data.pair,
              type: order.type,
              side: order.side,
              price: +order.price || +order.tradesReport[0].price,
              stopPx: order.stopPrice ? +order.stopPrice : order.stopPrice,
              amount: +order.quantity,
              executed: +order.cumQuantity,
              filled: (+order.cumQuantity / +order.quantity) * 100,
              remaining: +order.quantity - +order.cumQuantity,
              cost:
                (+order.price || +order.tradesReport[0].price) *
                +order.cumQuantity,
              fee: {
                symbol: 0,
                value: 0
              }
            }
          ];
        })
        .then(data => {
          return data;
        });
    });
  }

  cancelOrder({ apiKey, apiSecret }, { pair, orderId }) {
    const path = `/api/2/order/${orderId}`;
    return this.pCall(path, apiKey, apiSecret, "DELETE").then(res => {
      return [{ id: res.clientOrderId }];
    });
  }

  getSymbolInfo(pair) {
    const path = `${this.BASE}/api/2/public/symbol/${pair.replace("/", "")}`;
    return fetch(path)
      .then(r => r.json())
      .then(res => {
        return {
          quantityIncrement: +res.quantityIncrement,
          tickSize: +res.tickSize,
          takeLiquidityRate: +res.takeLiquidityRate,
          provideLiquidityRate: +res.provideLiquidityRate
        };
      });
  }
}
