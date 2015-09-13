const R = require('ramda')
const Rx = require('rx')
const crypto = require('crypto')
const uuid = require('node-uuid')

const rcrypto = require('./raqia-crypto')
const raqia = require('./raqia-client')
const SALT = 'raqia-pairing'
const ALPHA_MAP = 'bcdfghjklmnpqrst'

exports.generateOTP = function generateOTP () {
  return crypto.randomBytes(8)
}

exports.prettyPrintOTP = function prettyPrintOTP (otp) {
  const hexArr = otp.toString('hex').split('')
  console.log(otp.toString('hex'))
  return hexArr.map(r => ALPHA_MAP[parseInt(r, 16)]).reduce((acc, r, i) => {
    if (i % 4 === 0 && i !== 0) return acc.concat(' ', r)
    return acc.concat(r)
  }, '')
}

exports.register = function register (rec) {
  const otp = rec.otp
  const machineId = rec.machineId
  const privateKey = rec.privateKey
  const recordId = rcrypto.hkdf(otp, SALT, 'pairing-record-id')
  const key = rcrypto.hkdf(otp, SALT, 'pairing-record-key')
  const deviceId = uuid.v4()
  const deviceRec = {publicKey: rec.publicKey, deviceId: deviceId}
  const plaintext = new Buffer(JSON.stringify(deviceRec), 'utf8')
  const cipherRec = rcrypto.encrypt(plaintext, key)

  const putDeviceRec$ = raqia.registerPairing(R.merge(cipherRec, {
    id: recordId,
    machineId: machineId
  }))
  .map('deviceUpload')

  const fetchDeviceRec$ = raqia.fetchDevice(machineId, deviceId)
  .flatMap(r => r.Item
    ? Rx.Observable.just({
      devicePublicKey: rcrypto.privateDecrypt(r.Item.publicKey, privateKey),
      machineId: machineId,
      deviceId: deviceId,
      encryptionKeys: rec.encryptionKeys
    })
    : Rx.Observable.throw(new Error('No record found')).delay(5000)
  )
  .retry(24)  // Waiting for admin to input OTP
  .concatMap(r => {
    Rx.Observable.just('deviceDownload')
    .concat(() => raqia.putKeys(r))
  })

  return Rx.Observable.concat(putDeviceRec$, fetchDeviceRec$)
}

console.log(exports.prettyPrintOTP(exports.generateOTP()))
