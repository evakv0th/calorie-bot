const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const API_KEY_BOT = process.env.API_KEY_BOT;
const MONGO_URI = process.env.MONGO_URI;

let db;
let mealsCollection;

// Remove bot initialization here

// Move all bot-related code inside the MongoDB connection block
MongoClient.connect(MONGO_URI, { useUnifiedTopology: true })
  .then((client) => {
    db = client.db('telegram_meal_bot');
    mealsCollection = db.collection('meals');
    console.log('✅ Connected to MongoDB');

    const bot = new TelegramBot(API_KEY_BOT, {
      polling: true
    });

    // Command format: /add Chicken 350 30
    bot.onText(/^\/add (\S+) (\d+) (\d+)(?: (\d{4}-\d{2}-\d{2}))?$/, async (msg, match) => {
      await handleAddMeal(bot, mealsCollection, msg, match);
    });
    // Command: /remove_last
    bot.onText(/\/remove_last/, async (msg) => {
      await handleRemoveLastMeal(bot, mealsCollection, msg);
    });

    // Command: /today
    bot.onText(/\/today/, async (msg) => {
      await handleTodayMeals(bot, mealsCollection, msg);
    });

    // Command: /day YYYY-MM-DD
    bot.onText(/\/day (\d{4}-\d{2}-\d{2})/, async (msg, match) => {
      await handleDayMeals(bot, mealsCollection, msg, match);
    });

    bot.onText(/\/week/, async (msg) => {
      await handleWeekMeals(bot, mealsCollection, msg);
    });

    bot.onText(/\/remove (\d{4}-\d{2}-\d{2}) (\d+)/, async (msg, match) => {
      await handleRemoveMeal(bot, mealsCollection, msg, match);
    });
  })
  .catch((err) => console.error('❌ MongoDB connection error:', err));


const handleRemoveLastMeal = async (bot, mealsCollection, msg) => {
  const userId = msg.from.id;

  try {
    // Find the most recent meal by timestamp
    const lastMeal = await mealsCollection.find({ userId })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    if (!lastMeal.length) {
      return bot.sendMessage(msg.chat.id, '❌ No meals to remove.');
    }

    const mealToDelete = lastMeal[0];

    // Delete it
    await mealsCollection.deleteOne({ _id: mealToDelete._id });

    bot.sendMessage(msg.chat.id, `🗑 Removed last meal: ${mealToDelete.meal} (${mealToDelete.calories} kcal, ${mealToDelete.protein}g protein)`);
  } catch (err) {
    console.error('Error removing last meal:', err);
    bot.sendMessage(msg.chat.id, '❌ Error removing last meal. Try again later.');
  }
};

const handleAddMeal = async (bot, mealsCollection, msg, match) => {
  const userId = msg.from.id;
  const [ , mealName, caloriesStr, proteinStr, optionalDate ] = match;

  // Validate optionalDate format: YYYY-MM-DD
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const date = (optionalDate && datePattern.test(optionalDate)) ? optionalDate : new Date().toISOString().split('T')[0];

  const mealDoc = {
    userId,
    date,
    meal: mealName,
    calories: parseInt(caloriesStr),
    protein: parseInt(proteinStr),
    timestamp: new Date(`${date}T00:00:00Z`), // Align timestamp to the intended date
  };

  await mealsCollection.insertOne(mealDoc);

  bot.sendMessage(
    msg.chat.id,
    `✅ Saved: ${mealName} (${mealDoc.calories} kcal, ${mealDoc.protein}g protein) for ${date}`
  );
};

const escapeMarkdown = (text) => {
  return text
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!');
};
const handleTodayMeals = async (bot, mealsCollection, msg) => {
  const userId = msg.from.id;
  const date = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'

  try {
    const meals = await mealsCollection.find({ userId, date }).toArray();

    if (meals.length === 0) {
      return bot.sendMessage(msg.chat.id, 'No meals logged for today.');
    }

    const total = meals.reduce((acc, m) => {
      acc.calories += m.calories;
      acc.protein += m.protein;
      return acc;
    }, { calories: 0, protein: 0 });

    const mealList = meals
      .map(m => `🍽 ${escapeMarkdown(m.meal)} — ${m.calories} kcal, ${m.protein}g protein`)
      .join('\n');

    bot.sendMessage(
      msg.chat.id,
      `📅 *Today's meals:*\n${mealList}\n\n🔥 *Total:* ${total.calories} kcal, ${total.protein}g protein`,
      { parse_mode: 'MarkdownV2' }
    );

  } catch (err) {
    console.error('Error fetching today\'s meals:', err);
    bot.sendMessage(msg.chat.id, '❌ Error fetching today\'s meals. Try again later.');
  }
};
const handleDayMeals = async (bot, mealsCollection, msg, match) => {
  const userId = msg.from.id;
  const date = match[1];

  const meals = await mealsCollection.find({ userId, date }).toArray();

  if (!meals.length) {
    return bot.sendMessage(msg.chat.id, `No meals logged for ${date}.`);
  }

  const total = meals.reduce((acc, m) => {
    acc.calories += m.calories;
    acc.protein += m.protein;
    return acc;
  }, { calories: 0, protein: 0 });

  const mealList = meals.map(m =>
    `🍽 ${escapeMarkdown(m.meal)} — ${m.calories} kcal, ${m.protein}g`
  ).join('\n');

  bot.sendMessage(
    msg.chat.id,
    `📅 *Meals for ${escapeMarkdown(date)}:*\n${mealList}\n\n🔥 *Total:* ${total.calories} kcal, ${total.protein}g`,
    { parse_mode: 'MarkdownV2' }
  );
};
const handleWeekMeals = async (bot, mealsCollection, msg) => {
  const userId = msg.from.id;

  const now = new Date();
  const startDate = new Date();
  startDate.setDate(now.getDate() - 6); // Last 7 days including today
  startDate.setHours(0, 0, 0, 0);

  try {
    // Get all meals in the last 7 days
    const meals = await mealsCollection.find({
      userId,
      timestamp: { $gte: startDate }
    }).toArray();

    if (!meals.length) {
      return bot.sendMessage(msg.chat.id, 'No meals found in the last 7 days.');
    }

    // Group by date
    const dailyStats = {};
    for (const meal of meals) {
      const date = meal.timestamp.toISOString().split('T')[0];
      if (!dailyStats[date]) {
        dailyStats[date] = { calories: 0, protein: 0, count: 0 };
      }
      dailyStats[date].calories += meal.calories;
      dailyStats[date].protein += meal.protein;
      dailyStats[date].count += 1;
    }

    const dates = Object.keys(dailyStats).sort(); // Ascending date order

    // Calculate totals
    const totalDays = dates.length;
    const totalCalories = dates.reduce((sum, date) => sum + dailyStats[date].calories, 0);
    const totalProtein = dates.reduce((sum, date) => sum + dailyStats[date].protein, 0);

    const avgCalories = Math.round(totalCalories / totalDays);
    const avgProtein = Math.round(totalProtein / totalDays);

    // Format response
    const dayLines = dates.map(date => {
      const stats = dailyStats[date];
      return `📆 ${date}: ${stats.calories} kcal, ${stats.protein}g protein (${stats.count} meal${stats.count > 1 ? 's' : ''})`;
    }).join('\n');

    const summary = `📊 *Last 7 Days Summary:*\n\n${dayLines}\n\n🔥 *Average/day:* ${avgCalories} kcal\n💪 *Average/day:* ${avgProtein}g protein`;

    bot.sendMessage(msg.chat.id, summary, { parse_mode: 'Markdown' });

  } catch (err) {
    console.error('Error fetching weekly meals:', err);
    bot.sendMessage(msg.chat.id, '❌ Error fetching last 7 days of meals. Try again later.');
  }
};

const handleRemoveMeal = async (bot, mealsCollection, msg, match) => {
  const userId = msg.from.id;
  const [ , date, indexStr ] = match;
  const index = parseInt(indexStr, 10) - 1;

  const meals = await mealsCollection.find({ userId, date }).toArray();

  if (!meals.length) {
    return bot.sendMessage(msg.chat.id, `No meals found for ${date}.`);
  }

  if (index < 0 || index >= meals.length) {
    return bot.sendMessage(msg.chat.id, `❌ Invalid meal number. There are only ${meals.length} meals for ${date}.`);
  }

  const mealToRemove = meals[index];
  await mealsCollection.deleteOne({ _id: mealToRemove._id });

  bot.sendMessage(
    msg.chat.id,
    `🗑 Removed: ${mealToRemove.meal} (${mealToRemove.calories} kcal, ${mealToRemove.protein}g) from ${date}`
  );
};