'use strict';

module.exports = {
  verifyUser: verifyUser,
  verifyTransaction: verifyTransaction,
  verifySms: verifySms
};


// Mocking for dev

function verifyUser(data, cb) {
  if (data.documentType === 'mobilePhone') {
    return cb(null, {smsVerification: 'xxx'});
  }
  cb(null, {success: true});
}

function verifyTransaction(data, cb) {
  cb(null, {success: true});
}

function verifySms(phone, code, cb) {
  cb(null, {success: true});
}
