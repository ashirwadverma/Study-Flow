const mongoose = require("mongoose");

let isConnected = false;

async function connectDB() {
  const mongoURI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/syllabus_study_planner";

  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    const conn = await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 2000,
    });
    isConnected = true;
    console.log(`✓ MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn.connection;
  } catch (error) {
    console.warn(`MongoDB offline notice (${error.message}). Continuing with local JSON storage.`);
    return null;
  }
}

function getIsConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

module.exports = {
  connectDB,
  getIsConnected,
};
