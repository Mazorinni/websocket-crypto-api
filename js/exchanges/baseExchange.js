export default class Exchanges {
  constructor() {
    if (process.env.NODE_ENV === 'test') {
      this.websocket = require('ws');
    } else {
      this.websocket = WebSocket;
    }
  }

  _setupWebSocket(eventHandler, path) {
    throw new Error('Method _setupWebSocket() is not defined');
  }

  closeWebSocket() {
    throw new Error('Method closeWebSocket() is not defined');
  }

  getSupportedInterval() {
    return Object.keys(this.times);
  }

  onTrade(symbol, eventHandler) {
    throw new Error('Method onAggTrade() is not defined');
  }

  onDepthUpdate(symbol, eventHandler) {
    throw new Error('Method onDepthUpdate() is not defined');
  }

  onDepthLevelUpdate(symbol, eventHandler) {
    throw new Error('Method onDepthUpdate() is not defined');
  }

  onKline(symbol, interval, eventHandler) {
    throw new Error('Method onKline() is not defined');
  }

  async getPairs() {
    throw new Error('Method getPairs() is not defined');
  }

  async getKline(pair, start, end, interval) {
    throw new Error('Method getKline() is not defined');
  }

  async getBalance() {
    throw new Error('Method getBalance() is not defined');
  }

  async getOpenOrders(pair_req) {
    throw new Error('Method getOpenOrders() is not defined');
  }

  async getAllOrders(pair_req, status) {
    throw new Error('Method getAllOrders() is not defined');
  }

  async getClosedOrders(pair_req) {
    throw new Error('Method getClosedOrders() is not defined');
  }

  async cancelOrder(pair_req, order_id) {
    throw new Error('Method cancelOrder() is not defined');
  }

  async createOrder(type, price, volume) {
    throw new Error('Method createOrder() is not defined');
  }
}
