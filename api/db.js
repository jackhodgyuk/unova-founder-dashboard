require('dotenv').config();

let pool;

function getPool() {
  if (!process.env.MYSQL_HOST || !process.env.MYSQL_DATABASE) {
    throw new Error('MySQL is not configured.');
  }

  if (!pool) {
    const mysql = require('mysql2/promise');
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
    });
  }

  return pool;
}

module.exports = {
  query(...args) {
    return getPool().query(...args);
  }
};
