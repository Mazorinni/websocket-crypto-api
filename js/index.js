import binance from './exchanges/binance';
import okex from './exchanges/okex';
import Bitfinex from './exchanges/bitfinex';
import HitBTC from './exchanges/hitbtc';
import Poloniex from './exchanges/poloniex';
import Bitmex from './exchanges/bitmex';
import CryproBridge from './exchanges/cryptoBridge';
import BitmexTestNet from './exchanges/testnet-bitmex';
import Crex24 from './exchanges/crex24';

const exchanges = {
  binance,
  okex,
  bitfinex: Bitfinex,
  hitbtc: HitBTC,
  poloniex: Poloniex,
  bitmex: Bitmex,
  'bitmex-testnet': BitmexTestNet,
  cryptobridge: CryproBridge,
  crex24: Crex24,
};

export default exchanges;
