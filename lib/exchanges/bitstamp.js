import crypto from 'crypto'
import R from 'ramda'
import Rx from 'rx'
import {requestStream} from './http/client'

function auth (config) {
  let nonce = Date.now() + '0000'
  let msg = nonce + config.clientId + config.key

  let signature = crypto
  .createHmac('sha256', config.key)
  .update(msg)
  .digest('hex')
  .toUpperCase()

  return {
    key: config.key,
    nonce: nonce,
    signature: signature
  }
}

let usdPrice$ = Rx.Observable.interval(10000).startWith(0)
.flatMap(() => requestStream({
  uri: 'https://www.bitstamp.net/api/ticker/',
  json: true
}))

let identityRate$ = Rx.Observable.just({buy: 1, sell: 1})

let price$ = usdPrice$.combineLatest(config$)
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
}, ([price, config], eur) => {
  config.exchangeRate = parseFloat(price.bid) / parseFloat(eur.buy)
  config.fiatExchangeRate = parseFloat(price.ask) / parseFloat(eur.sell)
  return config
})

// Note: amount is always in bitcoins
// Mote: in transitional stage, we can emit trades using an even emitter
// tied to the trade$ observable
function requestTrade ([config, trade, price]) {
  let authParams = auth(config)

  if (trade.direction === 'buy') {
    return requestStream({
      uri: 'https://www.bitstamp.net/api/buy/',
      json: true,
      body: R.merge({
        amount: (trade.satoshis / 1e8).toFixed(8),
        price: (price.buy * config.fudgeFactor).toFixed(2)
      }, authParams)
    })
  }

  if (trade.direction === 'sell') {
    return requestStream({
      uri: 'https://www.bitstamp.net/api/sell/',
      json: true,
      body: R.merge({
        amount: (trade.satoshis / 1e8).toFixed(8),
        price: (price.sell / config.fudgeFactor).toFixed(2)
      }, authParams)
    })
  }
}

function processTrade (trade) {

}

export function run (trades$, config$) {
  // TODO: mix in usd price to calculate USD value
  let buys$ = trades$.filter(trade => trade.direction === 'buy')
  .map(r => r.satoshis)
  .withLatestFrom(usdPrice$, config$,
      (satoshis, price, config) => [satoshis, price, config])
  .scan(([ acc, res, , ], [satoshis, price, config]) => {
    let satoshiResult = acc + satoshis
    let fiatResult = (satoshiResult / 1e8) * price
    let tradeThreshold = config.tradeThreshold
    return fiatResult > tradeThreshold ?
      [0, fiatResult, satoshiResult, price] :
      [satoshiResult, null, satoshiResult, price]
  }, [0, 0])
  .filter(r => r[1] !== null)
  .map(r => ({direction: 'buy', price: r[3], satoshis: r[2]}))

  let sells$ = null

  return Rx.Observable.merge(buys$, sells$)
}
/*
- config$ -- latest bitstamp config
- orders$ -- buy and sell orders to process, can consolidate if needed
*/
