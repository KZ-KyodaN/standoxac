const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/standweyz';

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Local JSON Database Setup
const dbFilePath = path.join(__dirname, 'users.json');
function readUsersLocal() {
  if (!fs.existsSync(dbFilePath)) {
    fs.writeFileSync(dbFilePath, JSON.stringify([]));
  }
  return JSON.parse(fs.readFileSync(dbFilePath, 'utf8'));
}
function writeUsersLocal(users) {
  fs.writeFileSync(dbFilePath, JSON.stringify(users, null, 2));
}

let isUsingLocalJson = false;

// Connect to MongoDB with timeout
console.log('Connecting to MongoDB...');
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 2500 })
  .then(() => console.log('Successfully connected to MongoDB.'))
  .catch(err => {
    console.warn('Could not connect to MongoDB. Falling back to local JSON database (users.json)...');
    isUsingLocalJson = true;
  });

// User Model Schema (Mongoose)
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  playerId: { type: String, required: true },
  gold: { type: Number, default: 30000 },
  kills: { type: String, default: "0" },
  deaths: { type: String, default: "0" },
  headshots: { type: String, default: "0" },
  avatar: { type: String, default: "" }, // Base64 string
  inventoryData: { type: String, default: "" } // JSON string
});

const User = mongoose.model('User', userSchema);

// DB Wrapper for handling transparent fallback
const db = {
  findOne: async (username) => {
    if (!isUsingLocalJson) {
      try {
        return await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
      } catch (err) {
        console.warn('Mongoose query failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const users = readUsersLocal();
    const regex = new RegExp(`^${username}$`, 'i');
    return users.find(u => regex.test(u.username));
  },

  create: async (userData) => {
    if (!isUsingLocalJson) {
      try {
        const newUser = new User(userData);
        await newUser.save();
        return newUser;
      } catch (err) {
        console.warn('Mongoose save failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const users = readUsersLocal();
    users.push(userData);
    writeUsersLocal(users);
    return userData;
  },

  save: async (userData) => {
    if (!isUsingLocalJson && userData.save) {
      try {
        return await userData.save();
      } catch (err) {
        console.warn('Mongoose save failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const users = readUsersLocal();
    const idx = users.findIndex(u => u.username.toLowerCase() === userData.username.toLowerCase());
    if (idx !== -1) {
      users[idx] = userData;
    } else {
      users.push(userData);
    }
    writeUsersLocal(users);
    return userData;
  }
};

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Endpoint: Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    const existingUser = await db.findOne(username);
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const generatedPlayerId = Math.floor(10000000 + Math.random() * 90000000).toString(); // 8 digit ID

    const defaultInventory = {
      Items: []
    };

    const newUser = {
      username: username,
      password: hashedPassword,
      playerId: generatedPlayerId,
      gold: 30000,
      kills: "0",
      deaths: "0",
      headshots: "0",
      avatar: "",
      inventoryData: JSON.stringify(defaultInventory)
    };

    const savedUser = await db.create(newUser);
    console.log(`Registered user: ${username} (ID: ${generatedPlayerId})`);

    return res.status(201).json({
      success: true,
      message: 'Registration successful!',
      user: {
        username: savedUser.username,
        playerId: savedUser.playerId,
        gold: savedUser.gold,
        kills: savedUser.kills,
        deaths: savedUser.deaths,
        headshots: savedUser.headshots,
        avatar: savedUser.avatar,
        inventoryData: savedUser.inventoryData
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Endpoint: Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    const user = await db.findOne(username);
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid username or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid username or password.' });
    }

    console.log(`User logged in: ${user.username}`);

    return res.json({
      success: true,
      message: 'Login successful!',
      user: {
        username: user.username,
        playerId: user.playerId,
        gold: user.gold,
        kills: user.kills,
        deaths: user.deaths,
        headshots: user.headshots,
        avatar: user.avatar,
        inventoryData: user.inventoryData
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Endpoint: Sync Profile Data
app.post('/api/auth/sync', async (req, res) => {
  try {
    const { username, gold, kills, deaths, headshots, avatar, inventoryData } = req.body;

    if (!username) {
      return res.status(400).json({ success: false, message: 'Username is required for sync.' });
    }

    const user = await db.findOne(username);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (gold !== undefined) user.gold = gold;
    if (kills !== undefined) user.kills = kills;
    if (deaths !== undefined) user.deaths = deaths;
    if (headshots !== undefined) user.headshots = headshots;
    if (avatar !== undefined) user.avatar = avatar;
    if (inventoryData !== undefined) user.inventoryData = inventoryData;

    await db.save(user);
    console.log(`Synced data for user: ${user.username}`);

    return res.json({
      success: true,
      message: 'Data synchronized successfully!'
    });

  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

app.listen(PORT, () => {
  console.log(`StandWeyz Account API Server is running on port ${PORT}`);
  console.log(`Fallback JSON database path: ${dbFilePath}`);
});
