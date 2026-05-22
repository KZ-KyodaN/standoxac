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

// Local JSON Promocodes Database Setup
const promocodeDbFilePath = path.join(__dirname, 'promocodes.json');
function readPromocodesLocal() {
  if (!fs.existsSync(promocodeDbFilePath)) {
    fs.writeFileSync(promocodeDbFilePath, JSON.stringify([]));
  }
  return JSON.parse(fs.readFileSync(promocodeDbFilePath, 'utf8'));
}
function writePromocodesLocal(promos) {
  fs.writeFileSync(promocodeDbFilePath, JSON.stringify(promos, null, 2));
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
  inventoryData: { type: String, default: "" }, // JSON string
  friends: { type: [String], default: [] },
  friendRequests: { type: [String], default: [] },
  blocked: { type: [String], default: [] },
  activeRoomId: { type: String, default: "" },
  clanId: { type: String, default: "" },
  clanRole: { type: String, default: "" },
  status: { type: String, default: "regular" },
  nicknameColor: { type: String, default: "" }
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

  findByPlayerId: async (playerId) => {
    if (!isUsingLocalJson) {
      try {
        return await User.findOne({ playerId: playerId });
      } catch (err) {
        console.warn('Mongoose query failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const users = readUsersLocal();
    return users.find(u => u.playerId === playerId);
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

// Promocode Model Schema (Mongoose)
const promocodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  rewards: [{ type: { type: String }, count: Number }],
  maxActivations: { type: Number, default: 0 }, // 0 = unlimited
  currentActivations: { type: Number, default: 0 },
  expirationDate: { type: String, default: null }, // null = unlimited (ISO string or YYYY-MM-DD)
  usedBy: [{ type: String }] // array of usernames in lowercase
});

const Promocode = mongoose.model('Promocode', promocodeSchema);

// DB Wrapper for Promocodes
const promoDb = {
  findOne: async (code) => {
    if (!isUsingLocalJson) {
      try {
        return await Promocode.findOne({ code: { $regex: new RegExp(`^${code}$`, 'i') } });
      } catch (err) {
        console.warn('Mongoose query failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const promos = readPromocodesLocal();
    const regex = new RegExp(`^${code}$`, 'i');
    return promos.find(p => regex.test(p.code));
  },

  save: async (promoData) => {
    if (!isUsingLocalJson && promoData.save) {
      try {
        return await promoData.save();
      } catch (err) {
        console.warn('Mongoose save failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const promos = readPromocodesLocal();
    const idx = promos.findIndex(p => p.code.toLowerCase() === promoData.code.toLowerCase());
    if (idx !== -1) {
      promos[idx] = promoData;
    } else {
      promos.push(promoData);
    }
    writePromocodesLocal(promos);
    return promoData;
  }
};

// Seed default promocode if none exists
async function seedDefaultPromocodes() {
  try {
    const giftPromo = await promoDb.findOne('GIFT');
    if (!giftPromo) {
      const defaultPromo = {
        code: 'GIFT',
        rewards: [
          { type: 'gold', count: 5000 },
          { type: 'AKR12_Aurora', count: 1 }
        ],
        maxActivations: 100,
        currentActivations: 0,
        expirationDate: '2026-12-31',
        usedBy: []
      };
      if (!isUsingLocalJson) {
        const p = new Promocode(defaultPromo);
        await p.save();
      } else {
        const promos = readPromocodesLocal();
        promos.push(defaultPromo);
        writePromocodesLocal(promos);
      }
      console.log('Seeded default promo code: GIFT');
    }
  } catch (err) {
    console.error('Error seeding default promo codes:', err);
  }
}
// Clan Model Schema (Mongoose)
const clanSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  tag: { type: String, required: true },
  avatarUrl: { type: String, default: "" },
  description: { type: String, default: "" },
  ownerId: { type: String, required: true },
  members: [{
    playerId: { type: String, required: true },
    role: { type: String, default: "member" }
  }],
  pendingRequests: { type: [String], default: [] },
  slotsLimit: { type: Number, default: 25 },
  type: { type: String, default: "open" },
  isPremium: { type: Boolean, default: false },
  tagColor: { type: String, default: "#bfbfbf" },
  premiumExpiresAt: { type: Date, default: null }
});

const Clan = mongoose.model('Clan', clanSchema);

// TradeOffer Model Schema (Mongoose)
const tradeOfferSchema = new mongoose.Schema({
  senderUsername: { type: String, required: true },
  receiverPlayerId: { type: String, required: true },
  senderItems: [String], // Array of uids
  receiverItems: [String], // Array of uids from receiver
  status: { type: String, default: "pending" }, // pending, accepted, declined, cancelled
  createdAt: { type: Date, default: Date.now }
});

const TradeOffer = mongoose.model('TradeOffer', tradeOfferSchema);

const clanDbFilePath = path.join(__dirname, 'clans.json');
function readClansLocal() {
  if (!fs.existsSync(clanDbFilePath)) {
    fs.writeFileSync(clanDbFilePath, JSON.stringify([]));
  }
  return JSON.parse(fs.readFileSync(clanDbFilePath, 'utf8'));
}
function writeClansLocal(clans) {
  fs.writeFileSync(clanDbFilePath, JSON.stringify(clans, null, 2));
}

const tradeDbFilePath = path.join(__dirname, 'trades.json');
function readTradesLocal() {
  if (!fs.existsSync(tradeDbFilePath)) {
    fs.writeFileSync(tradeDbFilePath, JSON.stringify([]));
  }
  return JSON.parse(fs.readFileSync(tradeDbFilePath, 'utf8'));
}
function writeTradesLocal(trades) {
  fs.writeFileSync(tradeDbFilePath, JSON.stringify(trades, null, 2));
}

const tradeDb = {
  find: async (query) => {
    if (!isUsingLocalJson) {
      try {
        return await TradeOffer.find(query);
      } catch (err) {
        console.warn('Mongoose trade query failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const trades = readTradesLocal();
    return trades.filter(t => {
      let match = true;
      for (const key in query) {
        if (query[key] && query[key].$in) {
            if (!query[key].$in.includes(t[key])) match = false;
        } else if (t[key] !== query[key]) {
          match = false;
        }
      }
      return match;
    });
  },

  findOne: async (query) => {
    if (!isUsingLocalJson) {
      try {
        return await TradeOffer.findOne(query);
      } catch (err) {
        console.warn('Mongoose trade query failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const trades = readTradesLocal();
    return trades.find(t => {
      let match = true;
      for (const key in query) {
        if (t[key] !== query[key]) match = false;
      }
      return match;
    });
  },

  create: async (tradeData) => {
    if (!isUsingLocalJson) {
      try {
        const newTrade = new TradeOffer(tradeData);
        await newTrade.save();
        return newTrade;
      } catch (err) {
        console.warn('Mongoose trade save failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const trades = readTradesLocal();
    const newTrade = { ...tradeData, _id: Math.random().toString(36).substr(2, 9), createdAt: new Date() };
    trades.push(newTrade);
    writeTradesLocal(trades);
    return newTrade;
  },

  save: async (tradeData) => {
    if (!isUsingLocalJson && tradeData.save) {
      try {
        return await tradeData.save();
      } catch (err) {
        console.warn('Mongoose trade save failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const trades = readTradesLocal();
    const idx = trades.findIndex(t => t._id === tradeData._id);
    if (idx !== -1) {
      trades[idx] = tradeData;
    } else {
      trades.push(tradeData);
    }
    writeTradesLocal(trades);
    return tradeData;
  }
};

const clanDb = {
  findOne: async (query) => {
    if (!isUsingLocalJson) {
      try {
        return await Clan.findOne(query);
      } catch (err) {
        console.warn('Mongoose clan query failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const clans = readClansLocal();
    if (query.name) {
      const regex = new RegExp(`^${query.name}$`, 'i');
      return clans.find(c => regex.test(c.name));
    }
    if (query.tag) {
      const regex = new RegExp(`^${query.tag}$`, 'i');
      return clans.find(c => regex.test(c.tag));
    }
    if (query._id) {
      return clans.find(c => c._id === query._id);
    }
    return null;
  },

  find: async (query) => {
    if (!isUsingLocalJson) {
      try {
        return await Clan.find(query);
      } catch (err) {
        console.warn('Mongoose clan query failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const clans = readClansLocal();
    if (query && query.$or) {
      const term = query.$or[0].name.$regex.source;
      const regex = new RegExp(term, 'i');
      return clans.filter(c => regex.test(c.name) || regex.test(c.tag));
    }
    return clans;
  },

  create: async (clanData) => {
    clanData._id = clanData._id || new mongoose.Types.ObjectId().toString();
    if (!isUsingLocalJson) {
      try {
        const newClan = new Clan(clanData);
        await newClan.save();
        return newClan;
      } catch (err) {
        console.warn('Mongoose clan save failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const clans = readClansLocal();
    clans.push(clanData);
    writeClansLocal(clans);
    return clanData;
  },

  save: async (clanData) => {
    if (!isUsingLocalJson && clanData.save) {
      try {
        return await clanData.save();
      } catch (err) {
        console.warn('Mongoose clan save failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    const clans = readClansLocal();
    const idx = clans.findIndex(c => c._id.toString() === clanData._id.toString() || c.name.toLowerCase() === clanData.name.toLowerCase());
    if (idx !== -1) {
      clans[idx] = clanData;
    } else {
      clans.push(clanData);
    }
    writeClansLocal(clans);
    return clanData;
  },

  deleteOne: async (query) => {
    if (!isUsingLocalJson) {
      try {
        return await Clan.deleteOne(query);
      } catch (err) {
        console.warn('Mongoose clan delete failed, falling back to JSON db:', err.message);
        isUsingLocalJson = true;
      }
    }
    let clans = readClansLocal();
    if (query._id) {
      clans = clans.filter(c => c._id.toString() !== query._id.toString());
    }
    writeClansLocal(clans);
    return { deletedCount: 1 };
  }
};
// Call seed function after some delay to allow MongoDB to connect
setTimeout(seedDefaultPromocodes, 3000);

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
      inventoryData: JSON.stringify(defaultInventory),
      friends: [],
      friendRequests: [],
      blocked: [],
      activeRoomId: "",
      clanId: "",
      clanRole: ""
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
        inventoryData: user.inventoryData,
        status: user.status || "regular",
        nicknameColor: user.nicknameColor || ""
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Endpoint: Get Profile (Fetch latest data)
app.post('/api/auth/profile', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ success: false, message: 'Username is required.' });
    }

    const user = await db.findOne(username);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.json({
      success: true,
      user: {
        username: user.username,
        playerId: user.playerId,
        gold: user.gold,
        kills: user.kills,
        deaths: user.deaths,
        headshots: user.headshots,
        avatar: user.avatar,
        inventoryData: user.inventoryData,
        status: user.status || "regular",
        nicknameColor: user.nicknameColor || ""
      }
    });

  } catch (error) {
    console.error('Fetch profile error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Endpoint: Sync Profile Data
app.post('/api/auth/sync', async (req, res) => {
  try {
    const { username, gold, kills, deaths, headshots, avatar, inventoryData, status, nicknameColor } = req.body;

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
    if (avatar !== undefined) {
      if (avatar.length > 7500000) {
        return res.status(400).json({ success: false, message: 'Аватарка не должна превышать 5 МБ.' });
      }
      
      const isGif = avatar.startsWith('R0lGOD'); // Base64 signature for GIF89a / GIF87a
      const currentStatus = status !== undefined ? status : user.status;
      
      if (isGif && currentStatus !== 'premium' && currentStatus !== 'developer') {
        return res.status(403).json({ success: false, message: 'GIF аватарки доступны только для Premium пользователей.' });
      }
      
      user.avatar = avatar;
    }
    if (inventoryData !== undefined) user.inventoryData = inventoryData;
    if (status !== undefined) user.status = status;
    if (nicknameColor !== undefined) user.nicknameColor = nicknameColor;

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

// Endpoint: Get User Avatar Fast
app.get('/api/avatar/:username', async (req, res) => {
  try {
    const username = req.params.username;
    if (!username) {
      return res.status(400).json({ success: false, message: 'Username is required.' });
    }
    
    // Support querying by playerId or username
    let user = null;
    if (username.length === 12 && !isNaN(username)) { // simple heuristics for numeric player ID
      user = await db.findByPlayerId(username);
    }
    
    if (!user) {
      user = await db.findOne(username);
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.json({
      success: true,
      avatar: user.avatar || ""
    });
  } catch (error) {
    console.error('Get avatar error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Endpoint: Redeem Promo Code
app.post('/api/auth/redeem-promo', async (req, res) => {
  try {
    const { username, promoCode } = req.body;

    if (!username || !promoCode) {
      return res.status(400).json({ success: false, message: 'Пользователь и промокод обязательны.' });
    }

    // 1. Find user
    const user = await db.findOne(username);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден.' });
    }

    // 2. Find promo code
    const promo = await promoDb.findOne(promoCode);
    if (!promo) {
      return res.status(404).json({ success: false, message: 'Промокод не существует.' });
    }

    // 3. Check expiration date
    if (promo.expirationDate) {
      const expDate = new Date(promo.expirationDate);
      if (new Date() > expDate) {
        return res.status(400).json({ success: false, message: 'Срок действия промокода истек.' });
      }
    }

    // 4. Check max activations
    if (promo.maxActivations > 0 && promo.currentActivations >= promo.maxActivations) {
      return res.status(400).json({ success: false, message: 'Количество активаций промокода исчерпано.' });
    }

    // 5. Check if user already used it
    if (promo.usedBy && promo.usedBy.includes(username.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Вы уже активировали этот промокод.' });
    }

    // 6. Apply rewards to user
    let goldAdded = 0;
    let itemsAdded = [];

    // Parse user inventoryData
    let inventory = { items: [] };
    if (user.inventoryData) {
      try {
        inventory = JSON.parse(user.inventoryData);
      } catch (e) {
        inventory = { items: [] };
      }
    }

    for (const reward of promo.rewards) {
      if (reward.type === 'gold') {
        user.gold = (user.gold || 0) + reward.count;
        goldAdded += reward.count;
      } else {
        // Add skin item to inventoryData
        const newItem = {
          Name: reward.type,
          IsEquipped: false,
          IsNew: true,
          StatTrack: { IsStatTrack: false, Kills: 0 },
          Stickers: ["", "", "", ""],
          Charm: "",
          uid: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
        };
        inventory.items.push(newItem);
        itemsAdded.push(reward.type);
      }
    }

    user.inventoryData = JSON.stringify(inventory);

    // 7. Update promo code status
    promo.currentActivations = (promo.currentActivations || 0) + 1;
    if (!promo.usedBy) promo.usedBy = [];
    promo.usedBy.push(username.toLowerCase());

    // Save changes
    await db.save(user);
    await promoDb.save(promo);

    console.log(`User ${username} redeemed promo ${promoCode}. Gold added: ${goldAdded}. Items: ${itemsAdded.join(', ')}`);

    return res.json({
      success: true,
      message: 'Промокод успешно активирован!',
      rewards: promo.rewards
    });

  } catch (error) {
    console.error('Redeem promo error:', error);
    return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера.' });
  }
});

function sanitizeUser(user) {
  if (!user.friends) user.friends = [];
  if (!user.friendRequests) user.friendRequests = [];
  if (!user.blocked) user.blocked = [];
  if (user.activeRoomId === undefined) user.activeRoomId = "";
  if (user.clanId === undefined || user.clanId === null) user.clanId = "";
  if (user.clanRole === undefined || user.clanRole === null) user.clanRole = "";
  return user;
}

// Endpoint: Get list of friends, requests, and blocked users
app.post('/api/friends/list', async (req, res) => {
  try {
    const { playerId } = req.body;
    if (!playerId) {
      return res.status(400).json({ success: false, message: 'PlayerId is required.' });
    }

    const user = await db.findByPlayerId(playerId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    sanitizeUser(user);

    const friendsProfiles = [];
    for (const fId of user.friends) {
      const f = await db.findByPlayerId(fId);
      if (f) {
        friendsProfiles.push({
          username: f.username,
          playerId: f.playerId,
          activeRoomId: f.activeRoomId || "",
          kills: f.kills || "0",
          avatar: f.avatar || ""
        });
      }
    }

    const requestsProfiles = [];
    for (const rId of user.friendRequests) {
      const r = await db.findByPlayerId(rId);
      if (r) {
        requestsProfiles.push({
          username: r.username,
          playerId: r.playerId,
          activeRoomId: r.activeRoomId || "",
          kills: r.kills || "0",
          avatar: r.avatar || ""
        });
      }
    }

    const blockedProfiles = [];
    for (const bId of user.blocked) {
      const b = await db.findByPlayerId(bId);
      if (b) {
        blockedProfiles.push({
          username: b.username,
          playerId: b.playerId,
          activeRoomId: b.activeRoomId || "",
          kills: b.kills || "0",
          avatar: b.avatar || ""
        });
      }
    }

    return res.json({
      success: true,
      friends: friendsProfiles,
      friendRequests: requestsProfiles,
      blocked: blockedProfiles
    });

  } catch (error) {
    console.error('List friends error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Endpoint: Find a user profile and get relationship
app.post('/api/friends/find', async (req, res) => {
  try {
    const { playerId, queryId } = req.body;
    if (!playerId || !queryId) {
      return res.status(400).json({ success: false, message: 'PlayerId and QueryId are required.' });
    }

    const requester = await db.findByPlayerId(playerId);
    if (!requester) {
      return res.status(404).json({ success: false, message: 'Requester not found.' });
    }
    sanitizeUser(requester);

    const target = await db.findByPlayerId(queryId);
    if (!target) {
      return res.status(404).json({ success: false, message: 'User with specified ID not found.' });
    }
    sanitizeUser(target);

    let relation = "none";
    if (requester.friends.includes(queryId)) {
      relation = "friend";
    } else if (target.friendRequests.includes(playerId)) {
      relation = "requested";
    } else if (requester.blocked.includes(queryId)) {
      relation = "blocked";
    }

    return res.json({
      success: true,
      user: {
        username: target.username,
        playerId: target.playerId,
        activeRoomId: target.activeRoomId || "",
        kills: target.kills || "0",
        avatar: target.avatar || ""
      },
      relation: relation
    });

  } catch (error) {
    console.error('Find friend error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Endpoint: Social Action (Add, Accept, Decline, Remove, Block, Unblock)
app.post('/api/friends/action', async (req, res) => {
  try {
    const { playerId, targetId, action } = req.body;
    if (!playerId || !targetId || !action) {
      return res.status(400).json({ success: false, message: 'Missing parameters.' });
    }

    const requester = await db.findByPlayerId(playerId);
    const target = await db.findByPlayerId(targetId);

    if (!requester || !target) {
      return res.status(404).json({ success: false, message: 'Requester or Target user not found.' });
    }

    sanitizeUser(requester);
    sanitizeUser(target);

    if (action === 'add') {
      if (target.blocked.includes(playerId)) {
        return res.status(400).json({ success: false, message: 'This user has blocked you.' });
      }

      if (requester.blocked.includes(targetId)) {
        requester.blocked = requester.blocked.filter(id => id !== targetId);
      }

      if (requester.friends.includes(targetId)) {
        return res.status(400).json({ success: false, message: 'Already friends.' });
      }

      if (requester.friendRequests.includes(targetId)) {
        requester.friendRequests = requester.friendRequests.filter(id => id !== targetId);
        if (!requester.friends.includes(targetId)) requester.friends.push(targetId);
        if (!target.friends.includes(playerId)) target.friends.push(playerId);
      } else {
        if (!target.friendRequests.includes(playerId)) {
          target.friendRequests.push(playerId);
        }
      }
    }
    else if (action === 'accept') {
      requester.friendRequests = requester.friendRequests.filter(id => id !== targetId);
      if (!requester.friends.includes(targetId)) requester.friends.push(targetId);
      if (!target.friends.includes(playerId)) target.friends.push(playerId);
    }
    else if (action === 'decline') {
      requester.friendRequests = requester.friendRequests.filter(id => id !== targetId);
      target.friendRequests = target.friendRequests.filter(id => id !== playerId);
    }
    else if (action === 'remove') {
      requester.friends = requester.friends.filter(id => id !== targetId);
      target.friends = target.friends.filter(id => id !== playerId);
    }
    else if (action === 'block') {
      if (!requester.blocked.includes(targetId)) {
        requester.blocked.push(targetId);
      }
      requester.friends = requester.friends.filter(id => id !== targetId);
      target.friends = target.friends.filter(id => id !== playerId);
      requester.friendRequests = requester.friendRequests.filter(id => id !== targetId);
      target.friendRequests = target.friendRequests.filter(id => id !== playerId);
    }
    else if (action === 'unblock') {
      requester.blocked = requester.blocked.filter(id => id !== targetId);
    }
    else {
      return res.status(400).json({ success: false, message: 'Invalid action.' });
    }

    await db.save(requester);
    await db.save(target);

    return res.json({ success: true, message: `Action ${action} completed successfully.` });

  } catch (error) {
    console.error('Execute action error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Endpoint: Update active room status
app.post('/api/friends/update-room', async (req, res) => {
  try {
    const { playerId, activeRoomId } = req.body;
    if (!playerId) {
      return res.status(400).json({ success: false, message: 'PlayerId is required.' });
    }

    const user = await db.findByPlayerId(playerId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    sanitizeUser(user);
    user.activeRoomId = activeRoomId || "";
    await db.save(user);

    return res.json({ success: true, message: 'Active room updated successfully.' });

  } catch (error) {
    console.error('Update room error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// --- CLAN SYSTEM ENDPOINTS ---

// 1. Create Clan
app.post('/api/clan/create', async (req, res) => {
  try {
    const { playerId, name, tag, avatarUrl } = req.body;

    if (!playerId || !name || !tag) {
      return res.status(400).json({ success: false, message: 'Все поля обязательны.' });
    }

    // Tag validation: up to 5 chars, only English letters
    const tagRegex = /^[A-Za-z]{1,5}$/;
    if (!tagRegex.test(tag)) {
      return res.status(400).json({ success: false, message: 'Тег должен быть от 1 до 5 символов и содержать только латинские буквы.' });
    }

    const user = await db.findByPlayerId(playerId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден.' });
    }
    sanitizeUser(user);

    if (user.clanId) {
      return res.status(400).json({ success: false, message: 'Вы уже состоите в клане.' });
    }

    if (user.gold < 50000) {
      return res.status(400).json({ success: false, message: 'Недостаточно золота для создания клана (требуется 50,000 голды).' });
    }

    // Check name uniqueness
    const existingClan = await clanDb.findOne({ name: name });
    if (existingClan) {
      return res.status(400).json({ success: false, message: 'Клан с таким названием уже существует.' });
    }

    // Deduct gold
    user.gold -= 50000;

    const clanData = {
      name: name,
      tag: tag.toUpperCase(),
      avatarUrl: avatarUrl || "",
      description: "Добро пожаловать в наш клан!",
      ownerId: playerId,
      members: [{ playerId: playerId, role: 'leader' }],
      pendingRequests: [],
      slotsLimit: 25,
      type: 'open',
      isPremium: false,
      tagColor: '#bfbfbf',
      premiumExpiresAt: null
    };

    const newClan = await clanDb.create(clanData);

    user.clanId = newClan._id.toString();
    user.clanRole = 'leader';

    await db.save(user);

    return res.json({
      success: true,
      message: 'Клан успешно создан!',
      clan: newClan,
      gold: user.gold
    });

  } catch (error) {
    console.error('Create clan error:', error);
    return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера.' });
  }
});

// 2. Search Clans
app.post('/api/clan/search', async (req, res) => {
  try {
    const { term } = req.body;
    let query = {};
    if (term) {
      const cleanTerm = term.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      query = {
        $or: [
          { name: { $regex: new RegExp(cleanTerm, 'i') } },
          { tag: { $regex: new RegExp(cleanTerm, 'i') } }
        ]
      };
    }

    const clans = await clanDb.find(query);
    const result = clans.map(c => ({
      _id: c._id,
      name: c.name,
      tag: c.tag,
      avatarUrl: c.avatarUrl || "",
      description: c.description || "",
      memberCount: c.members ? c.members.length : 0,
      slotsLimit: c.slotsLimit || 25,
      type: c.type || 'open'
    }));

    return res.json({ success: true, clans: result });
  } catch (error) {
    console.error('Search clan error:', error);
    return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера.' });
  }
});

// 3. Clan Info
app.post('/api/clan/info', async (req, res) => {
  try {
    const { playerId, clanId } = req.body;

    let targetClanId = clanId;
    if (playerId) {
      const user = await db.findByPlayerId(playerId);
      if (user) {
        sanitizeUser(user);
        targetClanId = user.clanId;
      }
    }

    if (!targetClanId) {
      return res.json({ success: true, inClan: false });
    }

    const clan = await clanDb.findOne({ _id: targetClanId });
    if (!clan) {
      // Clear user status if clan not found
      if (playerId) {
        const user = await db.findByPlayerId(playerId);
        if (user) {
          user.clanId = "";
          user.clanRole = "";
          await db.save(user);
        }
      }
      return res.json({ success: true, inClan: false });
    }

    // Check if premium subscription has expired
    const now = new Date();
    if (clan.isPremium && clan.premiumExpiresAt && new Date(clan.premiumExpiresAt) < now) {
      clan.isPremium = false;
      clan.tagColor = '#bfbfbf';
      await clanDb.save(clan);
    }

    const membersWithProfile = [];
    if (clan.members) {
      for (const m of clan.members) {
        const profile = await db.findByPlayerId(m.playerId);
        if (profile) {
          membersWithProfile.push({
            playerId: m.playerId,
            username: profile.username,
            role: m.role || 'member',
            kills: profile.kills || "0",
            avatar: profile.avatar || "",
            status: profile.status || "regular",
            nicknameColor: profile.nicknameColor || ""
          });
        }
      }
    }

    // Sort order: leader -> co-leader -> elder -> member
    const roleWeight = { leader: 4, 'co-leader': 3, elder: 2, member: 1 };
    membersWithProfile.sort((a, b) => (roleWeight[b.role] || 0) - (roleWeight[a.role] || 0));

    return res.json({
      success: true,
      inClan: true,
      clan: {
        _id: clan._id,
        name: clan.name,
        tag: clan.tag,
        avatarUrl: clan.avatarUrl || "",
        description: clan.description || "",
        ownerId: clan.ownerId,
        slotsLimit: clan.slotsLimit || 25,
        type: clan.type || 'open',
        members: membersWithProfile,
        pendingRequests: clan.pendingRequests || [],
        isPremium: clan.isPremium || false,
        tagColor: clan.tagColor || '#bfbfbf',
        premiumExpiresAt: clan.premiumExpiresAt || null
      }
    });

  } catch (error) {
    console.error('Get clan info error:', error);
    return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера.' });
  }
});

// 4. Leaders of Clans
app.post('/api/clan/leaders', async (req, res) => {
  try {
    const clans = await clanDb.find({});
    const leaders = [];

    for (const c of clans) {
      let totalKills = 0;
      if (c.members) {
        for (const m of c.members) {
          const profile = await db.findByPlayerId(m.playerId);
          if (profile) {
            totalKills += parseInt(profile.kills || "0", 10);
          }
        }
      }
      leaders.push({
        _id: c._id,
        name: c.name,
        tag: c.tag,
        avatarUrl: c.avatarUrl || "",
        memberCount: c.members ? c.members.length : 0,
        slotsLimit: c.slotsLimit || 25,
        totalKills: totalKills
      });
    }

    leaders.sort((a, b) => b.totalKills - a.totalKills);

    return res.json({ success: true, leaders: leaders.slice(0, 15) });
  } catch (error) {
    console.error('Get clan leaders error:', error);
    return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера.' });
  }
});

// 5. Clan Actions
app.post('/api/clan/action', async (req, res) => {
  try {
    const { playerId, action, targetId, value } = req.body;

    if (!playerId || !action) {
      return res.status(400).json({ success: false, message: 'Missing parameters.' });
    }

    const user = await db.findByPlayerId(playerId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден.' });
    }
    sanitizeUser(user);

    // ACTIONS FOR NON-CLAN MEMBERS
    if (action === 'join' || action === 'request') {
      if (user.clanId) {
        return res.status(400).json({ success: false, message: 'Вы уже состоите в клане.' });
      }

      const targetClan = await clanDb.findOne({ _id: targetId });
      if (!targetClan) {
        return res.status(404).json({ success: false, message: 'Клан не найден.' });
      }

      if (targetClan.members.length >= targetClan.slotsLimit) {
        return res.status(400).json({ success: false, message: 'В клане нет свободных мест.' });
      }

      if (action === 'join') {
        if (targetClan.type !== 'open') {
          return res.status(400).json({ success: false, message: 'В этот клан нельзя вступить без одобрения.' });
        }
        targetClan.members.push({ playerId: playerId, role: 'member' });
        user.clanId = targetClan._id.toString();
        user.clanRole = 'member';
        await clanDb.save(targetClan);
        await db.save(user);
        return res.json({ success: true, message: 'Вы успешно вступили в клан!' });
      } else {
        if (targetClan.type !== 'request') {
          return res.status(400).json({ success: false, message: 'В этот клан нельзя отправить заявку.' });
        }
        if (!targetClan.pendingRequests) targetClan.pendingRequests = [];
        if (!targetClan.pendingRequests.includes(playerId)) {
          targetClan.pendingRequests.push(playerId);
          await clanDb.save(targetClan);
        }
        return res.json({ success: true, message: 'Заявка на вступление успешно отправлена!' });
      }
    }

    if (action === 'cancel_request') {
      const targetClan = await clanDb.findOne({ _id: targetId });
      if (targetClan) {
        if (targetClan.pendingRequests) {
          targetClan.pendingRequests = targetClan.pendingRequests.filter(id => id !== playerId);
          await clanDb.save(targetClan);
        }
      }
      return res.json({ success: true, message: 'Заявка отменена.' });
    }

    // ACTIONS FOR CLAN MEMBERS
    if (!user.clanId) {
      return res.status(400).json({ success: false, message: 'Вы не состоите в клане.' });
    }

    const clan = await clanDb.findOne({ _id: user.clanId });
    if (!clan) {
      user.clanId = "";
      user.clanRole = "";
      await db.save(user);
      return res.status(404).json({ success: false, message: 'Ваш клан не найден.' });
    }

    const myRole = user.clanRole;

    if (action === 'leave') {
      if (myRole === 'leader') {
        if (clan.members.length > 1) {
          return res.status(400).json({ success: false, message: 'Вы должны передать лидерство перед тем как покинуть клан.' });
        }
        // If leader is the only member, disband
        await clanDb.deleteOne({ _id: clan._id });
        user.clanId = "";
        user.clanRole = "";
        await db.save(user);
        return res.json({ success: true, message: 'Клан распущен.' });
      }

      clan.members = clan.members.filter(m => m.playerId !== playerId);
      await clanDb.save(clan);

      user.clanId = "";
      user.clanRole = "";
      await db.save(user);
      return res.json({ success: true, message: 'Вы покинули клан.' });
    }

    if (action === 'disband') {
      if (myRole !== 'leader') {
        return res.status(403).json({ success: false, message: 'Недостаточно прав.' });
      }

      // Clear clan fields for all members
      for (const m of clan.members) {
        const u = await db.findByPlayerId(m.playerId);
        if (u) {
          u.clanId = "";
          u.clanRole = "";
          await db.save(u);
        }
      }

      await clanDb.deleteOne({ _id: clan._id });
      return res.json({ success: true, message: 'Клан распущен лидером.' });
    }

    if (action === 'upgrade_slots') {
      const slotsToBuy = parseInt(value, 10);
      if (isNaN(slotsToBuy) || slotsToBuy <= 0) {
        return res.status(400).json({ success: false, message: 'Некорректное количество слотов.' });
      }

      if (clan.slotsLimit + slotsToBuy > 100) {
        return res.status(400).json({ success: false, message: 'Максимальный лимит слотов — 100.' });
      }

      const cost = slotsToBuy * 1000;
      if (user.gold < cost) {
        return res.status(400).json({ success: false, message: `Недостаточно золота. Требуется ${cost} голды.` });
      }

      user.gold -= cost;
      clan.slotsLimit += slotsToBuy;

      await clanDb.save(clan);
      await db.save(user);

      return res.json({ success: true, message: `Лимит слотов успешно расширен до ${clan.slotsLimit}!`, gold: user.gold, slotsLimit: clan.slotsLimit });
    }

    if (action === 'buy_premium') {
      if (myRole !== 'leader') {
        return res.status(403).json({ success: false, message: 'Только Лидер может приобрести/продлить Premium статус для клана.' });
      }
      const cost = 25000;
      if (user.gold < cost) {
        return res.status(400).json({ success: false, message: `Недостаточно золота. Требуется ${cost} голды.` });
      }
      user.gold -= cost;

      const now = new Date();
      let expireDate;
      if (clan.isPremium && clan.premiumExpiresAt && new Date(clan.premiumExpiresAt) > now) {
        // Extend existing subscription by 30 days
        expireDate = new Date(clan.premiumExpiresAt);
        expireDate.setDate(expireDate.getDate() + 30);
      } else {
        // Start new subscription for 30 days
        expireDate = new Date();
        expireDate.setDate(expireDate.getDate() + 30);
      }

      clan.isPremium = true;
      clan.premiumExpiresAt = expireDate;
      await clanDb.save(clan);
      await db.save(user);

      const expiryFormatted = expireDate.toLocaleDateString('ru-RU');
      return res.json({ success: true, message: `Премиум успешно оформлен/продлен до ${expiryFormatted}!`, gold: user.gold });
    }

    // ROLE/MANAGEMENT PERMISSIONS CHECK
    const isAuthorized = (myRole === 'leader' || myRole === 'co-leader');

    if (action === 'update_settings') {
      if (!isAuthorized) {
        return res.status(403).json({ success: false, message: 'Недостаточно прав.' });
      }

      let parsedValue = {};
      if (typeof value === 'string') {
        try {
          parsedValue = JSON.parse(value);
        } catch (e) {
          parsedValue = {};
        }
      } else if (typeof value === 'object') {
        parsedValue = value || {};
      }

      const { type, description, avatarUrl, tagColor } = parsedValue;

      if (type) {
        if (!['open', 'closed', 'request'].includes(type)) {
          return res.status(400).json({ success: false, message: 'Некорректный тип входа.' });
        }
        clan.type = type;
      }
      if (description !== undefined) {
        clan.description = description;
      }
      if (avatarUrl !== undefined) {
        clan.avatarUrl = avatarUrl;
      }
      if (tagColor !== undefined && tagColor !== "") {
        if (!clan.isPremium) {
          return res.status(400).json({ success: false, message: 'Изменение цвета тега доступно только для Premium кланов.' });
        }
        const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;
        if (!hexColorRegex.test(tagColor)) {
          return res.status(400).json({ success: false, message: 'Некорректный формат цвета (должен быть #HEX, например #FFCC00).' });
        }
        clan.tagColor = tagColor;
      }

      await clanDb.save(clan);
      return res.json({ success: true, message: 'Настройки клана успешно обновлены!' });
    }

    if (action === 'accept' || action === 'decline') {
      if (!isAuthorized) {
        return res.status(403).json({ success: false, message: 'Недостаточно прав.' });
      }

      clan.pendingRequests = (clan.pendingRequests || []).filter(id => id !== targetId);

      if (action === 'accept') {
        if (clan.members.length >= clan.slotsLimit) {
          return res.status(400).json({ success: false, message: 'В клане нет свободных мест.' });
        }
        const targetUser = await db.findByPlayerId(targetId);
        if (targetUser) {
          sanitizeUser(targetUser);
          if (targetUser.clanId) {
            await clanDb.save(clan);
            return res.status(400).json({ success: false, message: 'Игрок уже состоит в другом клане.' });
          }
          clan.members.push({ playerId: targetId, role: 'member' });
          targetUser.clanId = clan._id.toString();
          targetUser.clanRole = 'member';
          await db.save(targetUser);
        }
      }

      await clanDb.save(clan);
      return res.json({ success: true, message: `Заявка игрока ${action === 'accept' ? 'принята' : 'отклонена'}.` });
    }

    // ACTIONS REQUIRING TARGET MEMBERS
    const targetMember = clan.members.find(m => m.playerId === targetId);
    if (!targetMember) {
      return res.status(404).json({ success: false, message: 'Участник не найден в вашем клане.' });
    }

    const targetUser = await db.findByPlayerId(targetId);

    if (action === 'kick') {
      const canKick = (myRole === 'leader') || (myRole === 'co-leader' && targetMember.role !== 'leader' && targetMember.role !== 'co-leader');
      if (!canKick) {
        return res.status(403).json({ success: false, message: 'Недостаточно прав для изгнания этого игрока.' });
      }

      clan.members = clan.members.filter(m => m.playerId !== targetId);
      await clanDb.save(clan);

      if (targetUser) {
        targetUser.clanId = "";
        targetUser.clanRole = "";
        await db.save(targetUser);
      }

      return res.json({ success: true, message: 'Игрок успешно изгнан из клана.' });
    }

    if (action === 'promote') {
      if (targetMember.role === 'member') {
        if (myRole !== 'leader' && myRole !== 'co-leader') {
          return res.status(403).json({ success: false, message: 'Недостаточно прав.' });
        }
        targetMember.role = 'elder';
      } else if (targetMember.role === 'elder') {
        if (myRole !== 'leader') {
          return res.status(403).json({ success: false, message: 'Только Лидер может назначать Заместителей.' });
        }
        targetMember.role = 'co-leader';
      } else {
        return res.status(400).json({ success: false, message: 'Нельзя повысить роль далее.' });
      }

      await clanDb.save(clan);
      if (targetUser) {
        targetUser.clanRole = targetMember.role;
        await db.save(targetUser);
      }

      return res.json({ success: true, message: `Игрок повышен до ${targetMember.role}.` });
    }

    if (action === 'demote') {
      if (targetMember.role === 'co-leader') {
        if (myRole !== 'leader') {
          return res.status(403).json({ success: false, message: 'Только Лидер может понижать Заместителей.' });
        }
        targetMember.role = 'elder';
      } else if (targetMember.role === 'elder') {
        if (myRole !== 'leader' && myRole !== 'co-leader') {
          return res.status(403).json({ success: false, message: 'Недостаточно прав.' });
        }
        targetMember.role = 'member';
      } else {
        return res.status(400).json({ success: false, message: 'Нельзя понизить роль далее.' });
      }

      await clanDb.save(clan);
      if (targetUser) {
        targetUser.clanRole = targetMember.role;
        await db.save(targetUser);
      }

      return res.json({ success: true, message: `Игрок понижен до ${targetMember.role}.` });
    }

    if (action === 'transfer') {
      if (myRole !== 'leader') {
        return res.status(403).json({ success: false, message: 'Только Лидер может передать клан.' });
      }

      const myMember = clan.members.find(m => m.playerId === playerId);
      if (myMember) myMember.role = 'co-leader';
      user.clanRole = 'co-leader';

      targetMember.role = 'leader';
      clan.ownerId = targetId;

      await clanDb.save(clan);
      await db.save(user);

      if (targetUser) {
        targetUser.clanRole = 'leader';
        await db.save(targetUser);
      }

      return res.json({ success: true, message: 'Лидерство клана успешно передано!' });
    }

    return res.status(400).json({ success: false, message: 'Invalid action.' });

  } catch (error) {
    console.error('Execute clan action error:', error);
    return res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера.' });
  }
});
// --- TRADE SYSTEM ENDPOINTS ---

app.post('/api/trades/create', async (req, res) => {
  try {
    const { username, targetPlayerId, itemUids, receiverItemUids } = req.body;
    if (!username || !targetPlayerId) {
      return res.status(400).json({ success: false, message: 'Неверные параметры трейда.' });
    }

    const sender = await db.findOne(username);
    if (!sender) return res.status(404).json({ success: false, message: 'Отправитель не найден.' });

    const receiver = await db.findByPlayerId(targetPlayerId);
    if (!receiver) return res.status(404).json({ success: false, message: 'Получатель не найден.' });
    
    if (sender.playerId === receiver.playerId) {
      return res.status(400).json({ success: false, message: 'Нельзя отправить трейд самому себе.' });
    }

    let senderInventory = { items: [] };
    if (sender.inventoryData) {
      try { senderInventory = JSON.parse(sender.inventoryData); } catch (e) {}
    }

    let receiverInventory = { items: [] };
    if (receiver.inventoryData) {
      try { receiverInventory = JSON.parse(receiver.inventoryData); } catch (e) {}
    }

    // Check if sender has all items and they are NOT already in trade
    const itemsToTrade = [];
    const safeItemUids = itemUids || [];
    for (const uid of safeItemUids) {
      const item = senderInventory.items.find(i => i.uid === uid);
      if (!item) {
        return res.status(400).json({ success: false, message: 'Ваша вещь не найдена.' });
      }
      if (item.isTradeFrozen) {
        return res.status(400).json({ success: false, message: 'Одна или несколько ваших вещей уже находятся в другом трейде.' });
      }
      if (item.IsEquipped) {
         return res.status(400).json({ success: false, message: 'Нельзя обменивать надетые вещи.' });
      }
      itemsToTrade.push(item);
    }

    // Quick check if receiver has the requested items (do not freeze them yet)
    const safeReceiverUids = receiverItemUids || [];
    for (const uid of safeReceiverUids) {
      const item = receiverInventory.items.find(i => i.uid === uid);
      if (!item) {
        return res.status(400).json({ success: false, message: 'Запрошенная вещь у друга не найдена.' });
      }
      if (item.IsEquipped) {
        return res.status(400).json({ success: false, message: 'Друг сейчас надел эту вещь.' });
      }
    }

    // Freeze sender items
    for (const item of itemsToTrade) {
      item.isTradeFrozen = true;
    }
    sender.inventoryData = JSON.stringify(senderInventory);
    await db.save(sender);

    // Create trade offer
    const offer = await tradeDb.create({
      senderUsername: sender.username,
      receiverPlayerId: receiver.playerId,
      senderItems: safeItemUids,
      receiverItems: safeReceiverUids,
      status: 'pending'
    });

    return res.json({ success: true, message: 'Трейд успешно отправлен!', trade: offer });
  } catch (err) {
    console.error('Trade create error:', err);
    return res.status(500).json({ success: false, message: 'Ошибка сервера при создании трейда.' });
  }
});

app.get('/api/trades/pending', async (req, res) => {
  try {
    const { username, playerId } = req.query;
    if (!username || !playerId) return res.status(400).json({ success: false, message: 'Missing params' });

    const incoming = await tradeDb.find({ receiverPlayerId: playerId, status: 'pending' });
    const outgoing = await tradeDb.find({ senderUsername: username, status: 'pending' });

    return res.json({ success: true, incoming, outgoing });
  } catch (err) {
    console.error('Trade pending error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/trades/accept', async (req, res) => {
  try {
    const { username, tradeId } = req.body;
    const trade = await tradeDb.findOne({ _id: tradeId });
    if (!trade || trade.status !== 'pending') return res.status(400).json({ success: false, message: 'Трейд не найден или уже завершен.' });

    const receiver = await db.findOne(username);
    if (!receiver || receiver.playerId !== trade.receiverPlayerId) return res.status(403).json({ success: false, message: 'Нет доступа.' });

    const sender = await db.findOne(trade.senderUsername);
    if (!sender) return res.status(404).json({ success: false, message: 'Отправитель не найден.' });

    let senderInv = { items: [] };
    if (sender.inventoryData) try { senderInv = JSON.parse(sender.inventoryData); } catch (e) {}
    
    let receiverInv = { items: [] };
    if (receiver.inventoryData) try { receiverInv = JSON.parse(receiver.inventoryData); } catch (e) {}

    // 1. Move items from Sender to Receiver
    const itemsToMoveToReceiver = [];
    senderInv.items = senderInv.items.filter(item => {
      if (trade.senderItems.includes(item.uid)) {
        item.isTradeFrozen = false;
        itemsToMoveToReceiver.push(item);
        return false; // Remove from sender
      }
      return true; // Keep in sender
    });

    if (itemsToMoveToReceiver.length !== trade.senderItems.length) {
      // Revert Sender items and cancel trade
      senderInv.items.push(...itemsToMoveToReceiver); // put them back
      sender.inventoryData = JSON.stringify(senderInv);
      await db.save(sender);
      trade.status = 'cancelled';
      await tradeDb.save(trade);
      return res.status(400).json({ success: false, message: 'Вещи отправителя больше недоступны.' });
    }

    // 2. Check and Move items from Receiver to Sender
    const safeReceiverItems = trade.receiverItems || [];
    const itemsToMoveToSender = [];
    receiverInv.items = receiverInv.items.filter(item => {
      if (safeReceiverItems.includes(item.uid)) {
        if (item.isTradeFrozen || item.IsEquipped) {
           return true; // Cannot move this item right now
        }
        item.isTradeFrozen = false;
        itemsToMoveToSender.push(item);
        return false; // Remove from receiver
      }
      return true; // Keep in receiver
    });

    if (itemsToMoveToSender.length !== safeReceiverItems.length) {
      // Revert EVERYTHING
      senderInv.items.push(...itemsToMoveToReceiver);
      receiverInv.items.push(...itemsToMoveToSender);
      sender.inventoryData = JSON.stringify(senderInv);
      await db.save(sender);
      trade.status = 'cancelled';
      await tradeDb.save(trade);
      return res.status(400).json({ success: false, message: 'Ваши запрашиваемые вещи недоступны для обмена.' });
    }

    // 3. Complete swap
    receiverInv.items.push(...itemsToMoveToReceiver);
    senderInv.items.push(...itemsToMoveToSender);

    sender.inventoryData = JSON.stringify(senderInv);
    receiver.inventoryData = JSON.stringify(receiverInv);
    
    await db.save(sender);
    await db.save(receiver);

    trade.status = 'accepted';
    await tradeDb.save(trade);

    return res.json({ success: true, message: 'Трейд успешно принят!' });
  } catch (err) {
    console.error('Trade accept error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/trades/decline', async (req, res) => {
  try {
    const { username, tradeId, action } = req.body; // action can be 'decline' or 'cancel'
    const trade = await tradeDb.findOne({ _id: tradeId });
    if (!trade || trade.status !== 'pending') return res.status(400).json({ success: false, message: 'Трейд не найден или уже завершен.' });

    const user = await db.findOne(username);
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден.' });

    if (action === 'cancel' && trade.senderUsername !== username) return res.status(403).json({ success: false, message: 'Нет доступа.' });
    if (action === 'decline' && trade.receiverPlayerId !== user.playerId) return res.status(403).json({ success: false, message: 'Нет доступа.' });

    const sender = await db.findOne(trade.senderUsername);
    if (sender) {
      let senderInv = { items: [] };
      if (sender.inventoryData) try { senderInv = JSON.parse(sender.inventoryData); } catch(e){}
      
      senderInv.items.forEach(item => {
        if (trade.senderItems.includes(item.uid)) {
          item.isTradeFrozen = false;
        }
      });
      sender.inventoryData = JSON.stringify(senderInv);
      await db.save(sender);
    }

    trade.status = action === 'cancel' ? 'cancelled' : 'declined';
    await tradeDb.save(trade);

    return res.json({ success: true, message: `Трейд ${action === 'cancel' ? 'отменен' : 'отклонен'}.` });
  } catch (err) {
    console.error('Trade decline error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Endpoint: Get Player Inventory Info for Trade
app.get('/api/inventory/:playerId', async (req, res) => {
  try {
    const playerId = req.params.playerId;
    const targetUser = await db.findByPlayerId(playerId);
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found.' });

    let inventory = { items: [] };
    if (targetUser.inventoryData) {
      try { inventory = JSON.parse(targetUser.inventoryData); } catch (e) {}
    }

    // Filter out equipped and frozen items from what we send back to ensure accurate picking
    const availableItems = inventory.items.filter(i => !i.isTradeFrozen && !i.IsEquipped);

    return res.json({ success: true, inventoryData: JSON.stringify({ items: availableItems }) });
  } catch(e) {
    console.error('Inventory GET error:', e);
    return res.status(500).json({ success: false, message: 'Server error' });
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
