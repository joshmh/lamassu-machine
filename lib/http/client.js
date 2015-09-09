const Rx = require('rx')
const request = require('request')

function transformResponse (response, body) {
  return {
    response: response,
    body: body
  }
}

exports.requestStream = function requestStream (opts) {
  let requester = Rx.Observable.fromNodeCallback(request, null, transformResponse)
  return requester(opts)
}
