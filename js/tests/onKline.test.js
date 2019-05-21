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

const testCandle = (candle) => {
  expect(Object.keys(candle).sort()).toEqual(['time', 'open', 'high', 'low', 'close', 'volume'].sort());
  expect(typeof candle.time).toEqual('number');
  expect(typeof candle.open).toEqual('number');
  expect(typeof candle.high).toEqual('number');
  expect(typeof candle.low).toEqual('number');
  expect(typeof candle.close).toEqual('number');
  expect(typeof candle.volume).toEqual('number');
};


describe('onTrade socket', () => {
  Object.keys(exchanges).map(key => {
    const exchange = new exchanges[key]();
    test(key, async (done) => {
      const interval = exchange.getExchangeConfig().intervals[0];
      exchange.onKline(exchangePairs[key], interval, (candle) => {
        expect(typeof candle).toEqual('object');
        testCandle(candle);
        exchange.closeKline();
        done();
      });
    });
  });
});