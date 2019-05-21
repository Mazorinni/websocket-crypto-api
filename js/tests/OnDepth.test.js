const exchanges = require('..').default;

export const exchangePairs = {
  binance: 'BTC/USDT',
  bitfinex: 'BTC/USD',
  bitmex: 'XBT/USD',
  'bitmex-testnet': 'XBT/USD',
  cryptobridge: 'ETH/BTC',
  hitbtc: 'BTC/USD',
  okex: 'BTC/USDT',
  poloniex: 'BTC/USDT',
  crex24: 'BTC/USD'
};

// asks: [],
//   bids: [],
//   type: 'update',
//   exchange: 'bitfinex',

const testDepthLevel = (depthLevel, key) => {
  expect(Object.keys(depthLevel).sort()).toEqual(['asks', 'bids', 'type', 'exchange', 'symbol'].sort());
  expect(Array.isArray(depthLevel.asks)).toBeTruthy();
  expect(Array.isArray(depthLevel.bids)).toBeTruthy();
  expect(typeof depthLevel.type).toEqual('string');
  expect(depthLevel.exchange).toEqual(key);
  depthLevel.asks.forEach(el => {
    expect(Array.isArray(el)).toBeTruthy();
    expect(typeof el[0]).toEqual('number');
    expect(typeof el[1]).toEqual('number');
  });
  depthLevel.bids.forEach(el => {
    expect(Array.isArray(el)).toBeTruthy();
    expect(typeof el[0]).toEqual('number');
    expect(typeof el[1]).toEqual('number');
  });
};


describe('onTrade socket', () => {
  Object.keys(exchanges).map(key => {
    const exchange = new exchanges[key]();
    test(key, async (done) => {
      let snapshotAccepted = false;
      let updateAccepted = false;
      exchange.onDepthUpdate(exchangePairs[key], (res) => {
        expect(typeof res).toEqual('object');
        if (res.type === 'snapshot') {
          snapshotAccepted = true;
          if (snapshotAccepted) updateAccepted = true;
        } else {
          updateAccepted = true;
        }
        testDepthLevel(res, key);

        if (snapshotAccepted && updateAccepted) {
          exchange.closeOB();
          done();
        }
      });
    });
  });
});