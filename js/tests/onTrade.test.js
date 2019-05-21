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

const testTrade = (trade, key) => {
  expect(Object.keys(trade).sort()).toEqual(['id', 'side', 'timestamp', 'price', 'amount', 'symbol', 'exchange'].sort());

  expect(typeof trade.side).toEqual('string');
  expect(typeof trade.timestamp).toEqual('number');
  expect(typeof trade.price).toEqual('number');
  expect(typeof trade.amount).toEqual('number');
  expect(trade.symbol).toEqual(exchangePairs[key]);
  expect(trade.exchange).toEqual(key);
};


describe('onTrade socket', () => {
  Object.keys(exchanges).map(key => {
    const exchange = new exchanges[key]();
    test(key, async (done) => {
      let numTrades = 0;
      exchange.onTrade(exchangePairs[key], (trade) => {
        expect(typeof trade).toEqual('object');
        testTrade(trade, key);
        numTrades += 1;
        if (numTrades > 5) {
          exchange.closeTrade();
          done();
        }
      });
    });
  });
});