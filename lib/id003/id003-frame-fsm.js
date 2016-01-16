'use strict'

const machina = require('machina')
const rs232Fsm = require('id003-rs232-fsm')

const fsm = new machina.Fsm({
  initialState: 'Idle',
  states: {
    Idle: {
      _child: rs232Fsm,
      LineError: () => fsm.emit('status'),
      Frame: frame => {
        fsm.emit('frame', frame)
        fsm.transition('Idle')
      },
      Send: data => {
        startTimer()
        fsm.emit('send', data)
        fsm.deferAndTransition('Pending')
      }
    },
    Pending: {
      _child: rs232Fsm,
      _onEnter: function () {
        fsm.handle('Request')
      },
      Timeout: () => fsm.emit('status'),
      LineError: () => fsm.emit('status'),
      FrameTimeout: () => {
        fsm.emit('error', new Error('Timeout'))
        fsm.transition('Idle')
      },
      Frame: frame => {
        clearTimer()
        fsm.emit('frame', frame)
        fsm.transition('Idle')
      }
    }
  }
})

function startTimer () {
  fsm.timerId = setTimeout(() => fsm.handle('FrameTimeout'), 3000)
}

function clearTimer () {
  clearTimeout(fsm.timerId)
}

// module.export = fsm
