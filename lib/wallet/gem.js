import Round from 'round-node'

Round.client()
.then(function (client) {
  let deviceCreds = {
    email: USER_EMAIL,
    api_token: API_TOKEN,
    device_token: DEVICE_TOKEN
  };

  client.authenticateDevice(deviceCreds)
  .then(function (user) {
    ...
  });
})
