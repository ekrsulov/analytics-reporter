const ANALYTICS_DATA_TABLE_NAME = "analytics_data"

const knex = require("knex")
const moment = require("moment-timezone")
const Promise = require("bluebird")
const config = require("../config")

const publish = (results) => {
  const db = knex({ client: "pg", connection: config.postgres })

  if (results.query.dimensions.match(/ga:date/)) {
    return _writeRegularResults({ db, results }).then(() => db.destroy())
  } else {
    return Promise.resolve()
  }
}

const _dataForDataPoint = (dataPoint, { realtime } = {}) => {
  const data = Object.assign({}, dataPoint)
  let dateTime
  if (realtime) {
    dateTime = (new Date()).toISOString()
  } else {
    dateTime = _dateTimeForDataPoint(dataPoint)
  }
  delete data.date
  delete data.hour

  return {
    date_time: dateTime,
    data: data,
  }
}

const _dateTimeForDataPoint = (dataPoint) => {
  let dateString = dataPoint.date
  if (dataPoint.hour) {
    dateString = `${dateString}T${dataPoint.hour}:00:00`
  } else {
    dateString = `${dateString}T00:00:00`
  }
  if (!isNaN(Date.parse(dateString))) {
    return moment.tz(dateString, config.timezone).toISOString()
  }
}

const _queryForExistingRow = ({ db, row }) => {
  query = db(ANALYTICS_DATA_TABLE_NAME)

  Object.keys(row).forEach(key => {
    if (row[key] === undefined) {
      return
    } else if (key === "data") {
      const dataQuery = Object.assign({}, row.data)
      delete dataQuery.visits
      delete dataQuery.users
      Object.keys(dataQuery).forEach(dataKey => {
        query = query.whereRaw(`data->>'${dataKey}' = ?`, [dataQuery[dataKey]])
      })
    } else {
      query = query.where({ [key]: row[key] })
    }
  })

  return query.select()
}

const _handleExistingRow = ({ db, existingRow, newRow }) => {
  if (existingRow.data.visits != newRow.data.visits || existingRow.data.users != newRow.data.users) {
    return db(ANALYTICS_DATA_TABLE_NAME).where({ id: existingRow.id }).update(newRow)
  }
}

const _rowForDataPoint = ({ results, dataPoint, realtime }) => {
  const row = _dataForDataPoint(dataPoint, { realtime })
  row.report_name = results.name
  row.report_agency = results.agency
  return row
}

const _writeRegularResults = ({ db, results }) => {
  const rows = results.data.map(dataPoint => {
    return _rowForDataPoint({ results, dataPoint })
  })

  const rowsToInsert = []
  return Promise.each(rows, row => {
    return _queryForExistingRow({ db, row }).then(results => {
      if (row.date_time === undefined) {
        return
      } else if (results.length === 0) {
        rowsToInsert.push(row)
      } else if (results.length === 1) {
        return _handleExistingRow({ db, existingRow: results[0], newRow: row })
      }
    })
  }).then(() => {
    return db(ANALYTICS_DATA_TABLE_NAME).insert(rowsToInsert)
  }).then(() => {
    return db.destroy()
  })
}

module.exports = { publish, ANALYTICS_DATA_TABLE_NAME }
