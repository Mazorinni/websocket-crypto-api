const exchanges = require('..').default;


const testPair = (pair) => {
  expect(Object.keys(pair).sort()).toEqual(['symbol', 'volume', 'priceChangePercent', 'price', 'high', 'low', 'quote', 'base', 'tickSize', 'maxLeverage'].sort());
  expect(typeof pair.symbol).toEqual('string');
  expect(typeof pair.volume).toEqual('number');
  expect(typeof pair.priceChangePercent).toEqual('number');
  expect(typeof pair.price).toEqual('number');
  expect(typeof pair.high).toEqual('number');
  expect(typeof pair.low).toEqual('number');
  expect(typeof pair.tickSize).toEqual('number');
  expect(typeof pair.maxLeverage).toEqual('number');
  expect(typeof pair.quote).toEqual('string');
  expect(typeof pair.base).toEqual('string');

};


describe('Get exchange pairs list', () => {
  Object.keys(exchanges).map(key => {
    const exchange = new exchanges[key]();
    test(key, async (done) => {

      const res = await exchange.getPairs();

      expect(res instanceof Array).toBeTruthy();

      const [pairs, fullList] = res;
      expect(typeof pairs).toEqual('object');
      expect(typeof fullList).toEqual('object');

      Object.keys(fullList).forEach(key => {
        testPair(fullList[key]);
      });
      Object.keys(pairs).forEach(market => {
        Object.keys(pairs[market]).forEach(key => {
          testPair(pairs[market][key]);
        });
      });
      done();
    });
  });
});