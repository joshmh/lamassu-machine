var Rx = require('rx')
var request = require('request')

function transformResponse (response, body) {
  return {
    response: response,
    body: body
  }
}

export function requestStream (opts) {
  request = Rx.Observable.fromNodeCallback(request, null, transformResponse)
  return request(opts)
}
