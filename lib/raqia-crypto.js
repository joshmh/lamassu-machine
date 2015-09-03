var crypto = require('crypto')
var ursa = require('ursa')

var ALGO = 'aes-128-gcm'
var RSA_KEY_LENGTH = 4096 // See http://www.keylength.com/en/compare/
var VERSION_BUF = new Buffer(2)
VERSION_BUF.writeUInt16LE(0x1)

var pubkey = {
  privkey: '-----BEGIN RSA PRIVATE KEY-----\n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\n-----END RSA PRIVATE KEY-----\n',
  pubkey: '-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAnv7xjMEpAqRG1railRV+\nbmBBxmrdrtoAAneYuzmbEPP9FHBoErGDQJpUDWe861f4Bei66h1aaJYcmdLIewD5\nQJeuniPhQ2ra/rRuKOEOg5/8YmrA4M9CBVtMHmZYVWV86WwmSR+kArN6rSI7hl7I\n3uqu8QIv+TniKtCaZkzo8sTbcbBjNXlfWKbIs1pcVk0QweeKf/Pj5oAMO4HTDG83\n97LcbQ5ylbXfSW2uT9Rik1jGTPbp7pYco79k6WFLqxXyJFTAVHoO8mhNk1+9I/2z\nbq7zjbiXvy8j7lw+7RxFrYSw5A6df30e6nNJfZ976Hy06qTXTebhGioz7kC0exze\nL2OinhQSr2hc7WJJsRHOEg2aa2sDT44T1KvmdDZGOmD8baRDYDvAr3dVootH6vTW\nW0d9NTQRmrM4r55pbYeNIMMZ3NQ/zR6cGTP/iBY0USdnOtS4yscMZ6dJBPe9/d5P\natwgivyEbkVLLnx8+8+intepMK/iohFZRXgYDA/pj5mBAgMBAAE=\n-----END PUBLIC KEY-----\n'
}

function encrypt (buf, key) {
  var rawKey = key
  var iv = crypto.randomBytes(12)
  var cipher = crypto.createCipheriv(ALGO, rawKey, iv)
  var encrypted = cipher.update(buf)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  var tag = cipher.getAuthTag()

  var len = 16 + encrypted.length
  return {
    version: 0,
    iv: iv,
    ciphertext: Buffer.concat([encrypted, tag], len)
  }
}

function decrypt (rec, key) {
  var ciphertext = rec.Ciphertext.B
  var tag = ciphertext.slice(-16)
  var iv = rec.Iv.B
  var content = ciphertext.slice(0, -16)
  var decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  var dec = decipher.update(content)
  dec += decipher.final()
  return dec
}

function publicEncrypt (buf, key) {
  return crypto.publicEncrypt(key, buf)
}

function privateDecrypt (enc, key) {
  return crypto.privateDecrypt(key, enc)
}

// *generation* is the 2 byte serial number of the generation of the key
function generateKey (generation) {
  var key = new Buffer(18)
  key.writeUInt16LE(generation)
  crypto.randomBytes(16).copy(key, 2)
  return key
}

function extractRawKey (key) {
  return key.slice(2)
}

function extractGeneration (key) {
  return key.readUInt16LE(key)
}

function generateKeyPair () {
  var privkey = ursa.generatePrivateKey(RSA_KEY_LENGTH)
  return {
    privkey: privkey.toPrivatePem().toString(),
    pubkey: privkey.toPublicPem().toString()
  }
}

function hkdf (master, salt, index) {
  let prk = crypto
  .createHmac('sha256', salt)
  .update(master)
  .digest('hex')

  let okm = crypto
  .createHmac('sha256', prk)
  .update(Buffer.concat([index, new Buffer([0x01])]))
  .digest('hex')

  return okm.slice(0, 16)
}

let master = crypto.randomBytes(32)
let salt = crypto.randomBytes(32)
let index = new Buffer([0x0, 0x0, 0x0, 0x0])
let index2 = new Buffer([0x0, 0x0, 0x0, 0x1])
console.log(hkdf(master, salt, index))
console.log(hkdf(master, salt, index2))

module.exports = {
  generateKey: generateKey,
  encrypt: encrypt,
  decrypt: decrypt,
  generateKeyPair: generateKeyPair,
  publicEncrypt: publicEncrypt,
  privateDecrypt: privateDecrypt,
  extractGeneration: extractGeneration
}
