import ReWS from "reconnecting-websocket";
import CryptoJS from "crypto-js";
import { Decimal } from "decimal.js";
import Exchanges from "./baseExchange";

export default class Bitmex extends Exchanges {
  constructor(proxy) {
    super();
    this.name = "Bitmex";
    this._mainUrl = "wss://www.bitmex.com/realtime";
    this._socket = undefined;

    this.tradeLog = [];
    this._proxy = proxy;
    this._proxy_enable = !!proxy;

    this._dbIds = {};

    this.streams = {
      depth: symbol => `orderBookL2:${symbol}`,
      depthLevel: (symbol, level) =>
        `${
          this._proxy_enable ? this._proxy : ""
        }https://www.bitmex.com/api/v1/orderBook/L2?symbol=${symbol}&depth=${level}`,
      kline: (symbol, interval) =>
        `${
          this._proxy_enable ? this._proxy : ""
        }https://www.bitmex.com/api/v1/trade/bucketed?binSize=${interval}&partial=false&symbol=${symbol}&count=1&reverse=true`,
      trade: symbol => `trade:${symbol}`
    };

    this.times = {
      "1": "1m",
      "5": "5m",
      "60": "1h",
      "1D": "1d"
    };

    this.ms = {
      "1": 60 * 1000,
      "5": 5 * 60 * 1000,
      "60": 60 * 60 * 1000,
      "1D": 24 * 60 * 60 * 1000
    };

    this._handlers = {};
    this._subscriptions = {
      trade: "",
      orderbook: "",
      kline: ""
    };
    this._socketPromise = new Promise(() => {});

    this.recognizeType = (ordType, pegOffsetValue) => {
      if (ordType === "Stop" && pegOffsetValue) {
        return "MarginalTrailingStop";
      }

      return this.typeMapping[ordType];
    };

    this.typeMapping = {
      Limit: "MarginalLimit",
      Market: "MarginalMarket",
      Stop: "MarginalStopMarket",
      StopLimit: "MarginalStopLimit",
      LimitIfTouched: "MarginalTakeLimit",
      MarketIfTouched: "MarginalTakeMarket"
    };

    this.status = {
      New: "open",
      Filled: "close",
      Canceled: " canceled"
    };
  }

  getOrderTypes() {
    return [];
  }

  getExchangeConfig() {
    return {
      margin: {
        isActive: true,
        componentList: ["position", "open", "history", "balance"],
        orderTypes: [
          "MarginalLimit",
          "MarginalMarket",
          "MarginalStopMarket",
          "MarginalStopLimit",
          "MarginalTakeLimit",
          "MarginalTakeMarket",
          "MarginalTrailingStop"
        ]
      },
      exchange: {
        isActive: false
      },
      intervals: this.getSupportedInterval()
    };
  }

  capitalize(s) {
    return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  hmac(request, secret, hash = "sha256", digest = "hex") {
    const result = CryptoJS[`Hmac${hash.toUpperCase()}`](request, secret);
    if (digest) {
      const encoding = digest === "binary" ? "Latin1" : this.capitalize(digest);
      return result.toString(CryptoJS.enc[this.capitalize(encoding)]);
    }
    return result;
  }

  // 'Content-Type: application/x-www-form-urlencoded';
  // 'Accept: application/json';
  // 'X-Requested-With: XMLHttpRequest';
  // 'symbol=XBTUSD&leverage=15';
  // 'https://www.bitmex.com/api/v1/position/leverage';

  _pCall(path, data = {}, method = "GET", { apiKey, apiSecret }) {
    if (!apiKey || !apiSecret) {
      throw new Error(
        "You need to pass an API key and secret to make authenticated calls."
      );
    }

    return Promise.resolve(Math.round(new Date().getTime() / 1000) + 60).then(
      timestamp => {
        const postBody =
          Object.keys(data).length === 0 ? "" : JSON.stringify(data);
        const signature = this.hmac(
          method + path + timestamp + postBody,
          apiSecret
        );
        const headers = {
          "Content-Type": "application/json",
          Accept: "application/json",
          "api-expires": timestamp,
          "api-key": apiKey,
          "api-signature": signature
        };
        let requestOptions = {};
        if (method === "GET") {
          requestOptions = {
            headers,
            method
          };
        } else {
          requestOptions = {
            headers,
            method,
            body: JSON.stringify(data)
          };
        }

        return fetch(`https://www.bitmex.com${path}`, requestOptions)
          .then(r => {
            if (r.status === 401)
              throw new Error("Invalid api keys or insufficient permissions");
            if (r.status === 403) throw new Error("Access deny");
            return r;
          })
          .then(r => r.json())
          .then(data => {
            if (data.error) {
              throw new Error(data.error.message);
            }
            return data;
          });
      }
    );
  }

  _setupWebSocket(eventHandler, path, type) {
    if (!this._socket) {
      let Resolver;
      this._socketPromise = new Promise(resolve => {
        Resolver = resolve;
      });
      const ws = (this._socket = new ReWS(this._mainUrl, [], {
        WebSocket: this.websocket,
        connectionTimeout: 5000,
        debug: false
      }));
      ws.onopen = () => {
        Resolver();
      };
      ws.onmessage = event => {
        const res = JSON.parse(event.data);
        if (this._handlers[res.table]) this._handlers[res.table](res);
      };
      this._socket = ws;
    }

    this._socketPromise.then(() => {
      this._subscriptions[type] = path;
      this._handlers[path.split(":")[0]] = eventHandler;
      this._socket.send(`{ "op": "subscribe", "args": ["${path}"] }`);
    });
  }

  _setupWebSocketEmulator(eventHandler, path, type) {
    if (this._socket) {
      clearInterval(this._socket);
    }

    this._socket_kline = setInterval(() => {
      fetch(path, {
        mode: "cors",
        headers: { "x-requested-with": "XMLHttpRequest" }
      })
        .then(resp => {
          return resp.json();
        })
        .then(res => {
          eventHandler(res);
        });
    }, 4000);
  }

  closeTrade() {
    if (this._socket)
      this._socket.send(
        `{ "op": "unsubscribe", "args": ["${this._subscriptions.trade}"] }`
      );
    this._subscriptions.trade = "";
  }

  closeOB() {
    if (this._socket)
      this._socket.send(
        `{ "op": "unsubscribe", "args": ["${this._subscriptions.orderbook}"] }`
      );
    this._subscriptions.orderbook = "";
  }

  closeKline() {
    if (this._socket_kline) clearInterval(this._socket_kline);
  }

  onTrade(symbol, eventHandler) {
    const newSymbol = symbol.replace("/", "");
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
      if (!res.success) {
        if (res.action === "insert" && res.data) {
          res.data.forEach(el => {
            if (newSymbol === el.symbol) {
              const d = new Date(el.timestamp);
              const trade = {
                id: el.trdMatchID,
                side: el.side,
                timestamp: d.getTime(),
                price: el.price,
                amount: el.homeNotional,
                symbol,
                exchange: "bitmex"
              };
              customEventHandler(trade);
            }
          });
        }
      }
    };

    return fetch(
      `https://www.bitmex.com/api/v1/trade?symbol=${newSymbol}&count=20&reverse=true`
    )
      .then(r => r.json())
      .then(r => {
        r.forEach(el => {
          if (newSymbol === el.symbol) {
            const d = new Date(el.timestamp);
            eventHandler({
              id: el.trdMatchID,
              side: el.side.toLowerCase(),
              timestamp: d.getTime(),
              price: el.price,
              amount: el.homeNotional,
              symbol,
              exchange: "bitmex"
            });
          }
        });
        return this._setupWebSocket(
          handler,
          this.streams.trade(newSymbol),
          "trade"
        );
      });
  }

  onDepthUpdate(symbol, eventHandler) {
    const restSymbol = symbol.replace("/", "");

    const handler = res => {
      const responseSymbol = res.data[0].symbol;
      if (restSymbol === responseSymbol) {
        const update = {
          asks: [],
          bids: [],
          type: "update",
          exchange: "bitmex",
          symbol
        };

        if (res.action === "partial") {
          const snapshot = {
            asks: [],
            bids: [],
            type: "snapshot",
            exchange: "bitmex",
            symbol
          };

          res.data.forEach(r => {
            this._dbIds[r.id] = r.price;
            if (r.side === "Sell") {
              snapshot.asks.push([r.price, r.size / r.price]);
            } else {
              snapshot.bids.push([r.price, r.size / r.price]);
            }
          });
          eventHandler(snapshot);
        } else if (res.action === "update") {
          res.data.forEach(r => {
            if (r.side === "Sell") {
              update.asks.push([this._dbIds[r.id], r.size / this._dbIds[r.id]]);
            } else {
              update.bids.push([this._dbIds[r.id], r.size / this._dbIds[r.id]]);
            }
          });
          eventHandler(update);
        } else if (res.action === "insert") {
          res.data.forEach(r => {
            this._dbIds[r.id] = r.price;
            if (r.side === "Sell") {
              update.asks.push([r.price, r.size / r.price]);
            } else {
              update.bids.push([r.price, r.size / r.price]);
            }
          });
          eventHandler(update);
        } else if (res.action === "delete") {
          res.data.forEach(r => {
            if (r.side === "Sell") {
              update.asks.push([this._dbIds[r.id], 0]);
            } else {
              update.bids.push([this._dbIds[r.id], 0]);
            }
            delete this._dbIds[r.id];
            eventHandler(update);
          });
        }
      }
    };
    return this._setupWebSocket(
      handler,
      this.streams.depth(restSymbol),
      "orderbook"
    );
  }

  onKline(symbol, interval, eventHandler) {
    const newSymbol = symbol.replace("/", "");

    const handler = data => {
      if (data && data.length > 0) {
        const k = data[0];
        const d = new Date(k.timestamp);
        const newData = {
          close: k.close,
          high: k.high,
          low: k.low,
          open: k.open,
          time: d.getTime(),
          volume: k.volume
        };
        eventHandler(newData);
      }
    };
    return this._setupWebSocketEmulator(
      handler,
      this.streams.kline(newSymbol, this.times[interval]),
      "kline"
    );
  }

  async getPairs() {
    return await fetch(
      `${
        this._proxy_enable ? this._proxy : ""
      }https://www.bitmex.com/api/v1/instrument/active`
    )
      .then(r => r.json())
      .then(r => {
        const pairs = { USD: [], ALT: [] };
        const fullList = [];
        r.forEach(pair => {
          const base = pair.symbol.substr(3);
          const target = pair.symbol.slice(0, 3);
          const symbol = `${target}/${base}`;
          const data = {
            symbol,
            volume: +pair.volume,
            priceChangePercent: pair.lastChangePcnt * 100,
            price: pair.lastPrice,
            high: pair.highPrice,
            low: pair.lowPrice,
            tickSize: pair.tickSize,
            quote: pair.positionCurrency ? pair.positionCurrency : "ETH",
            base: pair.quoteCurrency ? pair.quoteCurrency : "ETH",
            maxLeverage: 1 / pair.initMargin
          };
          if (data.price !== 0) {
            if (base === "USD") {
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

  async getKline(pair = "XBT/USD", interval = 60, start, end) {
    if (!end) end = new Date().getTime() / 1000;
    try {
      const symbol = pair.replace("/", "");
      const startTime = new Date(
        end * 1000 - 750 * this.ms[interval]
      ).toISOString();

      return fetch(
        `${
          this._proxy_enable ? this._proxy : ""
        }https://www.bitmex.com/api/v1/trade/bucketed?binSize=${
          this.times[interval]
        }&partial=false&symbol=${symbol}&count=750&startTime=${startTime}`
      )
        .then(r => r.json())
        .then(r => {
          return r.map(obj => {
            const d = new Date(obj.timestamp);
            return {
              time: d.getTime(),
              open: obj.open,
              high: obj.high,
              low: obj.low,
              close: obj.close,
              volume: obj.volume
            };
          });
        });
    } catch (e) {
      return [];
    }
  }

  async getBalance(credentials) {
    return this._pCall(
      "/api/v1/user/margin?currency=XBt",
      {},
      "GET",
      credentials
    ).then(data => {
      return {
        margin: {
          XBT: {
            coin: "XBT",
            free: data.availableMargin / 100000000,
            used: (data.marginBalance - data.availableMargin) / 100000000,
            total: data.marginBalance / 100000000
          }
        }
      };
    });
  }

  async getOpenOrders(credentials) {
    return this._pCall(
      "/api/v1/order?filter=%7B%22ordStatus%22%3A%22New%22%7D&count=500&reverse=true",
      {},
      "GET",
      credentials
    ).then(data => {
      return data.map(el => {
        const timestamp = new Date(el.timestamp).getTime();
        const lastTimestamp = new Date(el.transactTime).getTime();
        const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
        return {
          id: el.orderID,
          timestamp,
          lastTradeTimestamp: lastTimestamp,
          status: this.status[el.ordStatus],
          symbol,
          type: this.recognizeType(el.ordType, el.pegOffsetValue),
          side: el.side.toLowerCase(),
          price: el.price,
          stopPx: el.stopPx,
          trailValue: el.pegOffsetValue,
          amount: +el.orderQty,
          executed: el.cumQty,
          filled: (el.cumQty / el.orderQty) * 100,
          remaining: el.leavesQty,
          cost: el.cumQty * el.price,
          fee: {
            symbol: 0,
            value: 0
          }
        };
      });
    });
  }

  async getClosedOrders(credentials, { pair } = {}) {
    const symbol = pair.replace("/", "");
    return this._pCall(
      `/api/v1/order?symbol=${symbol}&filter=%7B%22ordStatus%22%3A%22Filled%22%7D&count=500&reverse=true`,
      {},
      "GET",
      credentials
    ).then(data => {
      return data.map(el => {
        const timestamp = new Date(el.timestamp).getTime();
        const lastTimestamp = new Date(el.transactTime).getTime();
        const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
        return {
          id: el.orderID,
          timestamp,
          lastTradeTimestamp: lastTimestamp,
          status: this.status[el.ordStatus],
          symbol,
          type: this.recognizeType(el.ordType, el.pegOffsetValue),
          trailValue: el.pegOffsetValue,
          side: el.side.toLowerCase(),
          price: el.price,
          stopPx: el.stopPx,
          amount: +el.orderQty,
          executed: el.cumQty,
          filled: (el.cumQty / el.orderQty) * 100,
          remaining: el.leavesQty,
          cost: el.cumQty * el.price,
          fee: {
            symbol: 0,
            value: 0
          }
        };
      });
    });
  }

  async getAllOrders(credentials, { pair, orderId }) {
    const symbol = pair.replace("/", "");
    let url = `/api/v1/order?symbol=${symbol}&count=500&reverse=true`;
    if (orderId)
      url = `/api/v1/order?filter=%7B%22orderID%22%3A%22${orderId}%22%7D&count=500&reverse=true`;
    return this._pCall(url, {}, "GET", credentials).then(data => {
      return data.map(el => {
        const timestamp = new Date(el.timestamp).getTime();
        const lastTimestamp = new Date(el.transactTime).getTime();
        const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
        return {
          id: el.orderID,
          timestamp,
          lastTradeTimestamp: lastTimestamp,
          status: this.status[el.ordStatus],
          symbol,
          type: this.recognizeType(el.ordType),
          trailValue: el.pegOffsetValue,
          side: el.side.toLowerCase(),
          price: el.price,
          amount: +el.orderQty,
          executed: el.cumQty,
          filled: (el.cumQty / el.orderQty) * 100,
          remaining: el.leavesQty,
          cost: el.cumQty * el.price,
          fee: {
            symbol: 0,
            value: 0
          }
        };
      });
    });
  }

  async getPositions(credentials) {
    return this._pCall(
      "/api/v1/position?count=10000",
      {},
      "GET",
      credentials
    ).then(data => {
      return data.map(el => {
        const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
        return {
          symbol,
          price: el.avgEntryPrice,
          amount: el.currentQty,
          liquidationPrice: el.liquidationPrice,
          leverage: el.leverage,
          total: el.lastValue / 100000000,
          margin: el.maintMargin / 100000000,
          unrealisePNL: el.unrealisedGrossPnl / 100000000,
          realisePNL: el.realisedPnl / 100000000,
          isOpen: el.isOpen,
          roe: el.unrealisedRoePcnt,
          markPrice: el.markPrice,
          crossMargin: el.crossMargin
        };
      });
    });
  }

  async setLeverage(credenials, { pair, leverage }) {
    const symbol = pair.replace("/", "");
    return this._pCall(
      "/api/v1/position/leverage",
      { symbol, leverage },
      "POST",
      credenials
    ).then(() => {
      return this.getPositions(credenials);
    });
  }

  async cancelOrder(credentials, { orderId }) {
    return this._pCall(
      "/api/v1/order",
      { orderID: orderId },
      "DELETE",
      credentials
    ).then(data => {
      return data.map(el => {
        const timestamp = new Date(el.timestamp).getTime();
        const lastTimestamp = new Date(el.transactTime).getTime();
        const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
        return {
          id: el.orderID,
          timestamp,
          lastTradeTimestamp: lastTimestamp,
          status: this.status[el.ordStatus],
          symbol,
          type: this.recognizeType(el.ordType),
          side: el.side.toLowerCase(),
          price: el.price,
          amount: +el.orderQty,
          executed: el.cumQty,
          filled: (el.cumQty / el.orderQty) * 100,
          remaining: el.leavesQty,
          cost: el.cumQty * el.price,
          fee: {
            symbol: 0,
            value: 0
          }
        };
      });
    });
  }

  async createOrder(credentials, data) {
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
    const symbol = data.pair.replace("/", "");

    if (data.type === "MarginalMarket") {
      const payload = {
        orderQty: data.volume,
        side: this.capitalize(data.side),
        type: "Market",
        symbol
      };
      return this._pCall("/api/v1/order", payload, "POST", credentials).then(
        el => {
          const timestamp = new Date(el.timestamp).getTime();
          const lastTimestamp = new Date(el.transactTime).getTime();
          const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
          return [
            {
              id: el.orderID,
              timestamp,
              lastTradeTimestamp: lastTimestamp,
              status: this.status[el.ordStatus],
              symbol,
              type: this.recognizeType(el.ordType),
              side: el.side.toLowerCase(),
              price: el.price,
              amount: +el.orderQty,
              executed: el.cumQty,
              filled: (el.cumQty / el.orderQty) * 100,
              remaining: el.leavesQty,
              cost: el.cumQty * el.price,
              fee: {
                symbol: 0,
                value: 0
              }
            }
          ];
        }
      );
    }
    if (data.type === "MarginalLimit") {
      if (!data.price) {
        throw Error("Need pass order price");
      }

      const tickSize = await this.getPairs().then(r =>
        r[1].hasOwnProperty(data.pair) ? r[1][data.pair].tickSize : 1
      );

      const precision_d = new Decimal(tickSize);
      const price_d = new Decimal(data.price);

      const price = price_d
        .div(precision_d)
        .floor()
        .mul(precision_d);
      const payload = {
        orderQty: data.volume,
        side: this.capitalize(data.side),
        type: "Limit",
        symbol,
        price
      };
      return this._pCall("/api/v1/order", payload, "POST", credentials).then(
        el => {
          const timestamp = new Date(el.timestamp).getTime();
          const lastTimestamp = new Date(el.transactTime).getTime();
          const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
          return [
            {
              id: el.orderID,
              timestamp,
              lastTradeTimestamp: lastTimestamp,
              status: this.status[el.ordStatus],
              symbol,
              type: this.recognizeType(el.ordType),
              side: el.side.toLowerCase(),
              price: el.price,
              amount: +el.orderQty,
              executed: el.cumQty,
              filled: (el.cumQty / el.orderQty) * 100,
              remaining: el.leavesQty,
              cost: el.cumQty * el.price,
              fee: {
                symbol: 0,
                value: 0
              }
            }
          ];
        }
      );
    }

    if (data.type === "MarginalStopLimit") {
      if (!data.price) {
        throw Error("Need pass order price");
      }

      if (!data.stopPx) {
        throw Error("Need pass stop order price");
      }

      const tickSize = await this.getPairs().then(r =>
        r[1].hasOwnProperty(data.pair) ? r[1][data.pair].tickSize : 1
      );

      const precision_d = new Decimal(tickSize);

      const price_d = new Decimal(data.price);
      const price = price_d
        .div(precision_d)
        .floor()
        .mul(precision_d);

      const stopPx_d = new Decimal(data.stopPx);
      const stopPx = stopPx_d
        .div(precision_d)
        .floor()
        .mul(precision_d);

      const payload = {
        orderQty: data.volume,
        side: this.capitalize(data.side),
        type: "StopLimit",
        symbol,
        price,
        stopPx,
        execInst: "LastPrice"
      };
      return this._pCall("/api/v1/order", payload, "POST", credentials).then(
        el => {
          const timestamp = new Date(el.timestamp).getTime();
          const lastTimestamp = new Date(el.transactTime).getTime();
          const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
          return [
            {
              stopPx: el.stopPx,
              id: el.orderID,
              timestamp,
              lastTradeTimestamp: lastTimestamp,
              status: this.status[el.ordStatus],
              symbol,
              type: this.recognizeType(el.ordType),
              side: el.side.toLowerCase(),
              price: el.price,
              amount: +el.orderQty,
              executed: el.cumQty,
              filled: (el.cumQty / el.orderQty) * 100,
              remaining: el.leavesQty,
              cost: el.cumQty * el.price,
              fee: {
                symbol: 0,
                value: 0
              }
            }
          ];
        }
      );
    }

    if (data.type === "MarginalStopMarket") {
      if (!data.volume) {
        throw Error("Need pass volume");
      }

      if (!data.stopPx) {
        throw Error("Need pass stop order price");
      }

      const tickSize = await this.getPairs().then(r =>
        r[1].hasOwnProperty(data.pair) ? r[1][data.pair].tickSize : 1
      );

      const precision_d = new Decimal(tickSize);

      const stopPx_d = new Decimal(data.stopPx);
      const stopPx = stopPx_d
        .div(precision_d)
        .floor()
        .mul(precision_d);

      const payload = {
        orderQty: data.volume,
        side: this.capitalize(data.side),
        type: "Stop",
        symbol,
        price: null,
        stopPx,
        execInst: "LastPrice"
      };
      return this._pCall("/api/v1/order", payload, "POST", credentials).then(
        el => {
          const timestamp = new Date(el.timestamp).getTime();
          const lastTimestamp = new Date(el.transactTime).getTime();
          const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
          return [
            {
              stopPx: el.stopPx,
              id: el.orderID,
              timestamp,
              lastTradeTimestamp: lastTimestamp,
              status: this.status[el.ordStatus],
              symbol,
              type: this.recognizeType(el.ordType),
              side: el.side.toLowerCase(),
              price: el.price,
              amount: +el.orderQty,
              executed: el.cumQty,
              filled: (el.cumQty / el.orderQty) * 100,
              remaining: el.leavesQty,
              cost: el.cumQty * el.price,
              fee: {
                symbol: 0,
                value: 0
              }
            }
          ];
        }
      );
    }

    if (data.type === "MarginalTakeLimit") {
      if (!data.price) {
        throw Error("Need pass order price");
      }

      if (!data.stopPx) {
        throw Error("Need pass stop order price");
      }

      const tickSize = await this.getPairs().then(r =>
        r[1].hasOwnProperty(data.pair) ? r[1][data.pair].tickSize : 1
      );

      const precision_d = new Decimal(tickSize);

      const price_d = new Decimal(data.price);
      const price = price_d
        .div(precision_d)
        .floor()
        .mul(precision_d);

      const stopPx_d = new Decimal(data.stopPx);
      const stopPx = stopPx_d
        .div(precision_d)
        .floor()
        .mul(precision_d);

      const payload = {
        orderQty: data.volume,
        side: this.capitalize(data.side),
        type: "LimitIfTouched",
        symbol,
        price,
        stopPx,
        execInst: "LastPrice"
      };
      return this._pCall("/api/v1/order", payload, "POST", credentials).then(
        el => {
          const timestamp = new Date(el.timestamp).getTime();
          const lastTimestamp = new Date(el.transactTime).getTime();
          const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
          return [
            {
              stopPx: el.stopPx,
              id: el.orderID,
              timestamp,
              lastTradeTimestamp: lastTimestamp,
              status: this.status[el.ordStatus],
              symbol,
              type: this.recognizeType(el.ordType),
              side: el.side.toLowerCase(),
              price: el.price,
              amount: +el.orderQty,
              executed: el.cumQty,
              filled: (el.cumQty / el.orderQty) * 100,
              remaining: el.leavesQty,
              cost: el.cumQty * el.price,
              fee: {
                symbol: 0,
                value: 0
              }
            }
          ];
        }
      );
    }

    if (data.type === "MarginalTakeMarket") {
      if (!data.stopPx) {
        throw Error("Need pass stop order price");
      }
      if (!data.volume) {
        throw Error("Need pass volume");
      }

      const tickSize = await this.getPairs().then(r =>
        r[1].hasOwnProperty(data.pair) ? r[1][data.pair].tickSize : 1
      );

      const precision_d = new Decimal(tickSize);

      const stopPx_d = new Decimal(data.stopPx);
      const stopPx = stopPx_d
        .div(precision_d)
        .floor()
        .mul(precision_d);

      const payload = {
        orderQty: data.volume,
        side: this.capitalize(data.side),
        type: "MarketIfTouched",
        symbol,
        price: null,
        stopPx,
        execInst: "LastPrice"
      };
      return this._pCall("/api/v1/order", payload, "POST", credentials).then(
        el => {
          const timestamp = new Date(el.timestamp).getTime();
          const lastTimestamp = new Date(el.transactTime).getTime();
          const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
          return [
            {
              stopPx: el.stopPx,
              id: el.orderID,
              timestamp,
              lastTradeTimestamp: lastTimestamp,
              status: this.status[el.ordStatus],
              symbol,
              type: this.recognizeType(el.ordType),
              side: el.side.toLowerCase(),
              price: el.price,
              amount: +el.orderQty,
              executed: el.cumQty,
              filled: (el.cumQty / el.orderQty) * 100,
              remaining: el.leavesQty,
              cost: el.cumQty * el.price,
              fee: {
                symbol: 0,
                value: 0
              }
            }
          ];
        }
      );
    }

    if (data.type === "MarginalTrailingStop") {
      if (!data.trailValue) {
        throw Error("Need to pass trailValue");
      }

      const tickSize = await this.getPairs().then(r =>
        r[1].hasOwnProperty(data.pair) ? r[1][data.pair].tickSize : 1
      );

      const precision_d = new Decimal(tickSize);

      const trailValue_d = new Decimal(data.trailValue);
      const trailValue = trailValue_d
        .div(precision_d)
        .floor()
        .mul(precision_d);

      const payload = {
        orderQty: data.volume,
        side: this.capitalize(data.side),
        type: "Stop",
        symbol,
        pegOffsetValue: trailValue,
        pegPriceType: "TrailingStopPeg",
        price: null,
        stopPx: null,
        execInst: "LastPrice"
      };
      return this._pCall("/api/v1/order", payload, "POST", credentials).then(
        el => {
          const timestamp = new Date(el.timestamp).getTime();
          const lastTimestamp = new Date(el.transactTime).getTime();
          const symbol = `${el.symbol.slice(0, 3)}/${el.symbol.slice(3)}`;
          return [
            {
              stopPx: el.stopPx,
              trailValue: el.pegOffsetValue,
              id: el.orderID,
              timestamp,
              lastTradeTimestamp: lastTimestamp,
              status: this.status[el.ordStatus],
              symbol,
              type: this.recognizeType(el.ordType, el.pegOffsetValue),
              side: el.side.toLowerCase(),
              price: el.price,
              amount: +el.orderQty,
              executed: el.cumQty,
              filled: (el.cumQty / el.orderQty) * 100,
              remaining: el.leavesQty,
              cost: el.cumQty * el.price,
              pegPriceType: el.pegPriceType,
              fee: {
                symbol: 0,
                value: 0
              }
            }
          ];
        }
      );
    }
  }
}
