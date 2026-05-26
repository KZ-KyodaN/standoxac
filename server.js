// server.js — Standox Admin Panel Express Server
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://kyodan:kika8989@standox.kaplhfc.mongodb.net/test?appName=standox';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const TOKEN_SECRET = 'standox-super-admin-key-2026';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Connect to MongoDB ────────────────────────────────────────────────────────
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('Successfully connected to MongoDB.'))
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
  });

// ── Models ────────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  password: { type: String },
  playerId: { type: String, required: true },
  gold: { type: Number, default: 0 },
  kills: { type: String, default: "0" },
  deaths: { type: String, default: "0" },
  headshots: { type: String, default: "0" },
  avatar: { type: String, default: "" },
  inventoryData: { type: String, default: "" },
  status: { type: String, default: "regular" },
  nicknameColor: { type: String, default: "" },
  premiumExpiresAt: { type: Date, default: null }
}, { strict: false, collection: 'users' });

const promocodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  rewards: [{ type: { type: String }, count: Number }],
  maxActivations: { type: Number, default: 0 },
  currentActivations: { type: Number, default: 0 },
  expirationDate: { type: String, default: null },
  usedBy: [{ type: String }]
}, { strict: false, collection: 'promocodes' });

const User = mongoose.model('User', userSchema);
const Promocode = mongoose.model('Promocode', promocodeSchema);

// ── Auth Middleware ───────────────────────────────────────────────────────────
function authAdmin(req, res, next) {
  const token = req.headers['authorization'] || req.headers['x-admin-key'];
  if (!token || token !== TOKEN_SECRET) {
    return res.status(401).json({ success: false, message: 'Неавторизован. Пожалуйста, войдите снова.' });
  }
  next();
}

// ── Auth Endpoints ────────────────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: 'Пароль обязателен.' });
  }
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true, token: TOKEN_SECRET });
  } else {
    return res.status(401).json({ success: false, message: 'Неверный пароль.' });
  }
});

app.get('/api/auth/verify', authAdmin, (req, res) => {
  res.json({ success: true });
});

// ── Stats Endpoint ────────────────────────────────────────────────────────────
app.get('/api/stats', authAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalPromos = await Promocode.countDocuments();
    
    // Calculate total gold from users
    const goldStats = await User.aggregate([
      { $group: { _id: null, totalGold: { $sum: "$gold" } } }
    ]);
    const totalGoldCirculation = goldStats[0]?.totalGold || 0;

    res.json({
      success: true,
      stats: {
        usersCount: totalUsers,
        promosCount: totalPromos,
        totalGold: totalGoldCirculation
      }
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, message: 'Ошибка получения статистики: ' + err.message });
  }
});

// ── Users Endpoints ───────────────────────────────────────────────────────────
app.get('/api/users/search', authAdmin, async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q.trim()) {
      return res.json({ success: true, users: [] });
    }

    const regex = new RegExp(q.trim(), 'i');
    const users = await User.find({
      $or: [
        { username: regex },
        { playerId: regex }
      ]
    }, { password: 0, avatar: 0, inventoryData: 0 }).limit(15).lean();

    res.json({ success: true, users });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/user/:playerId', authAdmin, async (req, res) => {
  try {
    const playerId = req.params.playerId.trim();
    let user = await User.findOne({ playerId: playerId }).lean();
    if (!user) {
      user = await User.findOne({ username: { $regex: new RegExp(`^${playerId}$`, 'i') } }).lean();
    }
    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден.' });
    }
    delete user.password;
    res.json({ success: true, user });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/user/:playerId', authAdmin, async (req, res) => {
  try {
    const playerId = req.params.playerId.trim();

    // ── Handle Full Raw Document Replacement ─────────────────────────────────
    if (req.body.isRaw) {
      const doc = req.body.document;
      if (!doc || typeof doc !== 'object') {
        return res.status(400).json({ success: false, message: 'Неверные данные документа.' });
      }

      if (!doc.playerId) {
        return res.status(400).json({ success: false, message: 'Поле playerId обязательно.' });
      }
      const newPid = String(doc.playerId).trim();

      const targetUser = await User.findOne({
        $or: [{ playerId: playerId }, { username: new RegExp(`^${playerId}$`, 'i') }]
      });
      if (!targetUser) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден.' });
      }

      if (newPid !== targetUser.playerId) {
        const dup = await User.findOne({ playerId: newPid });
        if (dup) {
          return res.status(400).json({ success: false, message: `Игрок с Player ID "${newPid}" уже существует.` });
        }
      }

      const rawId = targetUser._id;
      delete doc._id;
      delete doc.__v;

      if (!doc.password && targetUser.password) {
        doc.password = targetUser.password;
      }

      await User.replaceOne({ _id: rawId }, doc);
      const updatedUser = await User.findById(rawId).lean();
      delete updatedUser.password;
      return res.json({ success: true, message: 'Документ успешно перезаписан в БД.', user: updatedUser });
    }

    // ── Handle Specific Field Updates ────────────────────────────────────────
    const forbidden = ['_id', '__v'];
    const updates = {};

    // Validate Player ID if updating it
    if (req.body.playerId) {
      const newPid = String(req.body.playerId).trim();
      const targetUser = await User.findOne({
        $or: [{ playerId: playerId }, { username: new RegExp(`^${playerId}$`, 'i') }]
      });
      if (!targetUser) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден.' });
      }
      if (newPid !== targetUser.playerId) {
        const dup = await User.findOne({ playerId: newPid });
        if (dup) {
          return res.status(400).json({ success: false, message: `Игрок с Player ID "${newPid}" уже существует.` });
        }
      }
    }

    for (const [k, v] of Object.entries(req.body)) {
      if (!forbidden.includes(k)) {
        if (k === 'gold') {
          updates[k] = Number(v);
        } else if (k === 'premiumExpiresAt') {
          updates[k] = v ? new Date(v) : null;
        } else {
          updates[k] = v;
        }
      }
    }

    const user = await User.findOneAndUpdate(
      { $or: [{ playerId: playerId }, { username: new RegExp(`^${playerId}$`, 'i') }] },
      { $set: updates },
      { new: true }
    ).lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден.' });
    }

    delete user.password;
    res.json({ success: true, message: 'Информация о пользователе обновлена.', user });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Promocode Endpoints ──────────────────────────────────────────────────────
app.get('/api/promocodes', authAdmin, async (req, res) => {
  try {
    const promos = await Promocode.find({}).sort({ _id: -1 }).lean();
    res.json({ success: true, promos });
  } catch (err) {
    console.error('Get promos error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/promocodes', authAdmin, async (req, res) => {
  try {
    const { code, rewards, maxActivations, expirationDate } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Код промокода обязателен.' });
    }

    const cleanCode = code.toUpperCase().trim();
    const exists = await Promocode.findOne({ code: new RegExp(`^${cleanCode}$`, 'i') });
    if (exists) {
      return res.status(400).json({ success: false, message: `Промокод "${cleanCode}" уже существует.` });
    }

    const promo = await Promocode.create({
      code: cleanCode,
      rewards: rewards || [],
      maxActivations: maxActivations || 0,
      currentActivations: 0,
      expirationDate: expirationDate || null,
      usedBy: []
    });

    res.json({ success: true, message: 'Промокод успешно создан.', promo });
  } catch (err) {
    console.error('Create promo error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/promocodes/:code', authAdmin, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim();
    const result = await Promocode.deleteOne({ code: new RegExp(`^${code}$`, 'i') });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Промокод не найден.' });
    }
    res.json({ success: true, message: 'Промокод успешно удален.' });
  } catch (err) {
    console.error('Delete promo error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Skins Catalog Endpoint ────────────────────────────────────────────────────
app.get('/api/skins', authAdmin, (req, res) => {
  const possiblePaths = [
    path.join(__dirname, 'skins_catalog.json'),
    'c:\\StandWeyz1 project\\Server\\skins_catalog.json'
  ];

  let catalogFound = false;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const fileContent = fs.readFileSync(p, 'utf8');
        const data = JSON.parse(fileContent);
        if (data && Array.isArray(data.skins)) {
          const skinNames = data.skins.map(s => s.name).filter(Boolean);
          res.json({ success: true, skins: skinNames });
          catalogFound = true;
          break;
        }
      } catch (err) {
        console.error(`Error reading catalog at ${p}:`, err.message);
      }
    }
  }

  if (!catalogFound) {
    // Fallback default list of popular skins if catalog doesn't load
    const fallbackSkins = [
      "AKR12_Aurora", "AKR12_Carbon", "AKR12_Geometric", "AKR_Dragon", "AKR_Necromancer", "AKR_TreasureHunter",
      "AWM_Dragon", "AWM_Genesis", "AWM_TreasureHunter", "Butterfly_DragonGlass", "Butterfly_Gold", "Butterfly_Starfall",
      "Deagle_DragonGlass", "Deagle_GreenRevenge", "Deagle_Predator", "FiveSeven_Poison", "FiveSeven_Toxic",
      "Karambit_Gold", "Karambit_Claw", "M4_Samurai", "M4_Lizard", "M40_Grip", "M16_Winged"
    ];
    res.json({ success: true, skins: fallbackSkins, isFallback: true });
  }
});

// ── Fallback Route SPA ────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Standox Admin Panel running on http://localhost:${PORT}`);
});
