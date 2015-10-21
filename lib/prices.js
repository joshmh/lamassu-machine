const Rx = require('rx')
const requestStream = require('./http/client').requestStream

exports.prices = function prices (opts) {
  let interval$ = Rx.Observable.interval(opts.interval).startWith(0)

  return Rx.Observable.combineLatest(opts.config$, interval$, config => config)
  .flatMap((config) =>
    requestStream({
      uri: 'https://api.bitcoinaverage.com/ticker/global/' + config.locale.currency + '/'
    }),
    (config, res) => [config, res]
  )
  .map((arr) => {
    const config = arr[0]
    const res = arr[1]
    let price = JSON.parse(res.body)
    config.exchangeRate = price.bid
    config.fiatExchangeRate = price.ask
    return config
  })
}
