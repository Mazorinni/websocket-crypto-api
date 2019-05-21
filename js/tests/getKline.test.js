const exchanges = require('..').default;


const testCandle = (candle) => {
  expect(Object.keys(candle).sort()).toEqual(['time', 'open', 'high', 'low', 'close', 'volume'].sort());
  expect(typeof candle.time).toEqual('number');
  expect(typeof candle.open).toEqual('number');
  expect(typeof candle.high).toEqual('number');
  expect(typeof candle.low).toEqual('number');
  expect(typeof candle.close).toEqual('number');
  expect(typeof candle.volume).toEqual('number');
};


describe('Get klines', () => {
  Object.keys(exchanges).map(key => {
    const exchange = new exchanges[key]();
    test(key, async (done) => {

      const res = await exchange.getKline();

      expect(Array.isArray(res)).toBeTruthy();

      res.forEach(candle => {
        expect(typeof candle).toEqual('object');
        testCandle(candle);
      });
      done();
    });

  });
});