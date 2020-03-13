'use strict'

const express = require('express')
const app = express()

const bodyParser = require('body-parser')

const db = require('./queries')

app.use(bodyParser.json())
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
)
app.get('/', (request, response) => {
  response.json({ info: 'Node.js, Express, and Postgres API' })
})
app.get('/latestuploads', db.getLatestUploads)
app.get('/sessionsCount', db.getSessionsCount)
app.get('/sessions', db.getSessions)
app.get('/sessions/:id', db.getSessionByTableId)
//app.get('/sessions', db.getSessionByUID)
app.post('/sessions', db.createSession)
app.put('/sessions/:id', db.updateSession)
app.delete('/sessions/:id', db.deleteSession)

app.listen(3000, e => e ?
  console.log('Failed to start server', e)
  :
  console.log('Listening on port 3000.')
);

module.exports = app
