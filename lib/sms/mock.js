exports.phoneCode = function phoneCode () {
  return new Promise(resolve => setTimeout(() => resolve('123456'), 1000))
}

exports.message = function message (str) {
  console.log('*** Sending SMS: %s', str)
}
