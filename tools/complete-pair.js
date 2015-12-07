const crypto = require('crypto')
const pad = require('padster')
var bs10 = require('base-x')('0123456789')

const pairing = require('../lib/pairing')
const rcrypto = require('../lib/raqia-crypto')

const ecdh = crypto.createECDH('secp521r1')
// TODO: set pubkey in ecdh
let pubkey
const otp = rcrypto.hash(pubkey)

pairing.fetchDeviceRecord(otp)
.then(r => {
  const ltk = rcrypto.hash(ecdh.computeSecret(r.pubkey, 'base64'))
  this.allegedDevice = {
    deviceId: r.deviceId,
    ltk: ltk
  }

  const num = Math.floor(crypto.randomBytes(2).readUInt16LE(0) / 6.5535)
  const nonce = pad(num, 4)

  return pairing.sendEncryptedNonce(nonce, ltk)
  .then(() => {
    const hash = rcrypto.hash(pubkey)
    const pairingAuth = bs10.encode(hash).slice(0, 4)

    console.log('pairingAuth: %s', pairingAuth)
  })
})
.catch(e => console.log(e.stack))
