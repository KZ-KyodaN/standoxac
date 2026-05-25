const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const createStart = content.indexOf("app.post('/api/trades/create', async (req, res) => {");
const declineEnd = content.indexOf("// Health check endpoint");

if (createStart !== -1 && declineEnd !== -1) {
    const endpoints = `app.post('/api/trades/create', async (req, res) => {
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

    return res.json({ success: true, message: \`Трейд \${action === 'cancel' ? 'отменен' : 'отклонен'}.\` });
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

`;
    const newContent = content.substring(0, createStart) + endpoints + content.substring(declineEnd);
    fs.writeFileSync('server.js', newContent);
    console.log('Successfully updated server.js endpoints');
} else {
    console.log('Could not find markers', createStart, declineEnd);
}
