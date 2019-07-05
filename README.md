# Websocket Crypto Api
API for getting public and private data from exchanges

A JavaScript library for connecting to realtime public APIs on all cryptocurrency exchanges.

## Usage

Install websocket-crypto-api

```bash
npm install websocket-crypto-api
```

Create a new client for an exchange. And use class methods as below.

```javascript
import webca from 'websocket-crypto-api'

const exchangeName = 'binance'
const webca = new webca[exchangeName]()
```

### Public methods

subscribe to Klines, Trades and Orderbook just as

```javascript
webca.onKline(pair, data => {
  console.log(data)
});
webca.onDepthUpdate(pair, data => {
  console.log(data)
});
webca.onTrade(pair, data => {
  console.log(data)
});
```

and unsubscribe

```javascript
webca.closeKline();
webca.closeOB();
webca.closeTrade();
```

Then we have some getters.
```javascript
webca.getPairs()
webca.getKline(pair, resolution, from, to)
webca.getExchangeConfig()
```

### Private methods

All private methods requires api keys and some args.. All other args are required.

```javascript
webca.getBalance({ apiKey, apiSecret })
webca.getClosedOrders({ apiKey, apiSecret }, { pair })
webca.getOpenOrders({ apiKey, apiSecret })
webca.cancelOrder({ apiKey, apiSecret }, { pair, orderId })
// stopPx and trailValue not required for not stopLoss-takeProfit type of order
// and price isn't required for market orders
webca.createOrder({ apiKey, apiSecret }, { type, pair, side, volume, price, stopPx, trailValue }) 
// by status 'open' 'closed' or certain orderId you can filter orders you want to get
webca.getAllOrders({ apiKey, apiSecret }, { pair, status, orderId })
webca.getPositions({ apiKey, apiSecret }, { pair })
webca.setLeverage({ apiKey, apiSecret }, { pair, leverage })
```

### Response shapes

All methods but getExchangeConfig() returns a promise. 

Order has the below shape, createOrder, cancelOrder, getClosedOrders, getOpenOrders, getAllOrders. And they all returns array of orders.

```javascript
  const order = {
    amount: 12,
    cost: 68124,
    executed: 12,
    fee: {
      symbol: 0,
      value: 0,
    },
    filled: 100,
    id: '3cf2db6d-b753-84c3-b875-1caf7e30c600',
    lastTradeTimestamp: 1557112199157,
    price: 5677,
    remaining: 0,
    side: 'sell',
    status: 'close',
    stopPx: null,
    symbol: 'XBT/USD',
    timestamp: 1557112199157,
    trailValue: null,
    type: 'MarginalMarket',
  };
```

Position has following shape. getPositions and setLeverage currently returns array of positions.

```javascript
  const position = {
    amount: -12,
    crossMargin: true,
    isOpen: true,
    leverage: 100,
    liquidationPrice: 100000000,
    margin: 0.00002315,
    markPrice: 7265.52,
    price: 5677,
    realisePNL: 0.00001191,
    roe: -21.862,
    symbol: 'XBT/USD',
    total: 0.00165168,
    unrealisePNL: -0.00046212,
  }
```

Balances:

```javascript
//exchange field for exchange balance and trading for margin.
  const balances = {
    exchange: {
      BTG: { coin: 'BTG', free: 0.00000174, used: 0, total: 0.00000174 },
      LTC: { coin: 'LTC', free: 0.00147187, used: 0, total: 0.00147187 },
      USD: { coin: 'USD', free: 168.6457295, used: 0, total: 168.6457295 },
      ZEC: { coin: 'ZEC', free: 0.10597299, used: 0, total: 0.10597299 },
    },

    trading: {
      USD: { coin: 'USD', free: 12, used: 0, total: 12 },
    },
  };
```

Pair:

```javascript
  const pair = {
    base: 'BNB',
    high: 0.00357,
    low: 0.00316,
    maxLeverage: 0,
    price: 0.00317,
    priceChangePercent: -9.169,
    quote: 'ADA',
    symbol: 'ADA/BNB',
    tickSize: 0,
    volume: 60736.14907,
  };
```

Kline:

```javascript
[
      {
        close: 7915.74,
        high: 7934.68,
        low: 7910,
        open: 7932.99,
        time: 1558025880000,
        volume: 37.879134,
      },
]
```

exchangeConfig:

```javascript
      margin: {
        isActive: true,
        componentList: ['position', 'open', 'history', 'balance'],
        orderTypes: [
          'MarginalLimit',
          'MarginalMarket',
          'MarginalStopMarket',
          'MarginalStopLimit',
          'MarginalTakeLimit',
          'MarginalTakeMarket',
          'MarginalTrailingStop'
        ]
      },
      exchange: {
        isActive: false
      },
      intervals: {
      '1': '1m',
      '5': '5m',
      '60': '1h',
      '1D': '1d'
      }
```

data from onTrade:

```javascript
      const trade = {
        amount: 0.001505,
        exchange: 'binance',
        id: 123470260,
        price: 7279.61,
        side: 'sell',
        symbol: 'BTCUSDT',
        timestamp: 1558085158203,
      };
```

data from onDepthUpdate:

```javascript
      const update = {
        asks: [[7285.37, 0.001594], [7285.38, 0.051328], [7285.39, 0], [7285.4, 0.132504]],
        bids: [[7285.38, 0.051328], [7285.39, 0]],
      };
```


## Supported exchanges

| Exchange     | Public data (charting) | Exchange trading | Margin trading |
| ------------ |:----------------------:|:----------------:|:--------------:|
| Binance      | ✅                      | ✅                | not supported  |
| BitMEX       | ✅                      | ✅                | ✅              |
| Bitfinex     | ✅                      | ✅                |                |
| CryptoBridge | ✅                      | ✅                | not supported  |
| HitBTC       | ✅                      |                  |                |
| OKex         | ✅                      | ✅               |                |
| Poloniex     | ✅                      |                  |                |
| Crex24       | ✅                      | ✅                | not supported  |
| Huobi Global | ✅                      | ✅                |                |

## Plans
- Addding new exchanges, trade and margin support for existing exchnages
- Adding new order types
- Testing return shapes of all methods 

## Contributing
Thanks for your interest in contributing! You can find pull request process and our code of conduct here:
https://github.com/oneexbit/websocket-crypto-api/blob/master/contributing.md
 
