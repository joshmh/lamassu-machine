import crypto from 'crypto'
import R from 'ramda'
import Rx from 'rx'
import {requestStream} from '../http/client'

function auth (fullConfig) {
  let config = fullConfig.exchanges.bitstamp

  let nonce = Date.now() + '0000'
  let msg = nonce + config.clientId + config.key

  let signature = crypto
  .createHmac('sha256', config.secret)
  .update(msg)
  .digest('hex')
  .toUpperCase()

  return {
    key: config.key,
    nonce: nonce,
    signature: signature
  }
}

export let price$

function price (config$, usdPrice$) {
  let identityRate$ = Rx.Observable.just({body: {buy: 1, sell: 1}})

  return usdPrice$.combineLatest(config$)
  .flatMap(([price, config]) => {
    let currency = config.locale.currency
    if (currency === 'USD') return identityRate$
    if (currency === 'EUR') {
      return requestStream({
        uri: 'https://www.bitstamp.net/api/eur_usd/',
        json: true
      })
    }
    throw new Error('Bitstamp ticker does not support ' + currency)
  }, ([price, config], res) => {
    let eur = res.body
    config.exchangeRate = parseFloat(price.bid) / parseFloat(eur.buy)
    config.fiatExchangeRate = parseFloat(price.ask) / parseFloat(eur.sell)
    return config
  })
}

// Note: amount is always in bitcoins
// Note: in transitional stage, we can emit trades using an even emitter
// tied to the trade$ observable
function tradeRequest (rec) {
  let authParams = auth(rec.config)

  if (rec.direction === 'buy') {
    return {
      uri: 'https://www.bitstamp.net/api/buy/',
      json: true,
      body: R.merge({
        amount: (rec.satoshis / 1e8).toFixed(8),
        price: (rec.price * rec.config.fudgeFactor).toFixed(2)
      }, authParams)
    }
  }

  if (rec.direction === 'sell') {
    return {
      uri: 'https://www.bitstamp.net/api/sell/',
      json: true,
      body: R.merge({
        amount: (rec.satoshis / 1e8).toFixed(8),
        price: (rec.price / rec.config.fudgeFactor).toFixed(2)
      }, authParams)
    }
  }
}

export function run (trades$, config$) {
  // TODO: mix in usd price to calculate USD value

  let usdPriceCold$ = Rx.Observable.interval(10000).startWith(0)
  .flatMap(() => requestStream({
    uri: 'https://www.bitstamp.net/api/ticker/',
    json: true
  })).map(r => ({bid: parseFloat(r.body.bid), ask: parseFloat(r.body.ask)}))
  let usdPrice$ = usdPriceCold$.publish()
  usdPrice$.connect()

  price$ = price(config$, usdPrice$)

  let buys$ = trades$
  .filter(trade => trade.direction === 'buy')
  .tap(pp)
  .withLatestFrom(usdPrice$.map(r => r.ask), config$,
    (trade, price, config) => [trade, price, config])
  .scan(([acc], [trade, price, config]) => {
    let satoshis = trade.satoshis
    let satoshiResult = acc + satoshis
    let fiatResult = (satoshiResult / 1e8) * price
    let tradeThreshold = config.exchanges.bitstamp.tradeThreshold
    return fiatResult > tradeThreshold ?
      [0, fiatResult, satoshiResult, price, config] :
      [satoshiResult, null, satoshiResult, price, config]
  }, [0, null])
  .filter(r => r[1] !== null)
  .map(r => ({direction: 'buy', price: r[3], satoshis: r[2], config: r[4]}))
  .map(tradeRequest)

  let sells$ = Rx.Observable.empty()

  return Rx.Observable.merge(buys$, sells$)
}

/*

TODO: finish up network requests, test

- config$ -- latest bitstamp config
- orders$ -- buy and sell orders to process, can consolidate if needed
*/

import pp from '../pp'
let trades$ = Rx.Observable.from([{
  direction: 'buy',
  satoshis: 1e8 * 0.2001,
  id: 1
}, {
  direction: 'buy',
  satoshis: 1e8 * 0.1,
  id: 2
}]).delay(1000)

let config = require('../../scratch/bitstamp-test.json')
let config$ = Rx.Observable.just({fudgeFactor: 1.1, locale: {currency: 'USD'}, exchanges: {bitstamp: config}})

let http$ = run(trades$, config$)

http$.subscribe(pp, err => console.log(err.stack), () => console.log('completed'))
