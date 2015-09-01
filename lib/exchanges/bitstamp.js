import crypto from 'crypto'
import Rx from 'rx'
import {requestStream} from './http/client'

function authSig (config) {
  let nonce = Date.now() + '0000'
  let msg = nonce + config.clientId + config.key

  return crypto
  .createHmac('sha256', config.key)
  .update(msg)
  .digest('hex')
  .toUpperCase()
}

export function prices (opts) {
  let interval$ = Rx.Observable.interval(opts.interval).startWith(0)

  return Rx.Observable.combineLatest(opts.config$, interval$, config => config)
  .flatMap(() =>
    requestStream({
      uri: 'https://www.bitstamp.net/api/eur_usd/',
      json: true
    }),
    (config, res) => [config, res]
  )
  .flatMap(() =>
    requestStream({
      uri: 'https://www.bitstamp.net/api/ticker/',
      json: true
    }),
    ([config, eur], price) => {
      let currency = config.locale.currency

      if (currency === 'USD') {
        config.exchangeRate = parseFloat(price.bid)
        config.fiatExchangeRate = parseFloat(price.ask)
        return config
      }

      if (currency === 'EUR') {
        config.exchangeRate = parseFloat(price.bid) / parseFloat(eur.buy)
        config.fiatExchangeRate = parseFloat(price.ask) / parseFloat(eur.sell)
        return config
      }

      throw new Error('Bitstamp ticker does not support ' + currency)
    }
  )
}

/*
- config$ -- latest bitstamp config
- orders$ -- buy and sell orders to process, can consolidate if needed
*/
