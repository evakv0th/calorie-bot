const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const API_KEY_BOT = process.env.API_KEY_BOT;
const MONGO_URI = process.env.MONGO_URI;

let db;
let mealsCollection;
let goalsCollection;
let activitiesCollection;

// Remove bot initialization here

// Move all bot-related code inside the MongoDB connection block
MongoClient.connect(MONGO_URI, { useUnifiedTopology: true })
  .then((client) => {
    db = client.db('telegram_meal_bot');
    mealsCollection = db.collection('meals');
    goalsCollection = db.collection('goals');
    activitiesCollection = db.collection('activities');
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

    bot.onText(/\/summary/, async (msg) => {
      await handleAllDaysAverage(bot, mealsCollection, msg);
    });

    bot.onText(/\/remove (\d{4}-\d{2}-\d{2}) (\d+)/, async (msg, match) => {
      await handleRemoveMeal(bot, mealsCollection, msg, match);
    });

    bot.onText(/\/setActivity \(([^)]+)\)(?: (\d{4}-\d{2}-\d{2}))?/, async (msg, match) => {
      const userId = msg.from.id;
      const activity = match[1];
      const optionalDate = match[2];

      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const date = (optionalDate && datePattern.test(optionalDate))
        ? optionalDate
        : new Date().toISOString().split('T')[0];

      const activityDoc = {
        userId,
        date,
        activity,
        timestamp: new Date(`${date}T00:00:00Z`),
      };

      try {
        await activitiesCollection.updateOne(
          { userId, date },
          { $set: activityDoc },
          { upsert: true }
        );

        bot.sendMessage(
          msg.chat.id,
          `✅ Activity set for ${date}: ${activity}`
        );
      } catch (err) {
        console.error('Error setting activity:', err);
        bot.sendMessage(msg.chat.id, '❌ Failed to set activity. Please try again.');
      }
    });

    bot.onText(/\/setGoal (\d+) (\d+)/, async (msg, match) => {
      const userId = msg.from.id;
      const calories = parseInt(match[1]);
      const protein = parseInt(match[2]);

      try {
        await goalsCollection.updateOne(
          { userId },
          { $set: { calories, protein } },
          { upsert: true }
        );

        bot.sendMessage(msg.chat.id, `✅ Goal set: ${calories} kcal, ${protein}g protein`);
      } catch (err) {
        console.error('Error setting goal:', err);
        bot.sendMessage(msg.chat.id, '❌ Failed to set goal. Please try again.');
      }
    });
  })
  .catch((err) => console.error('❌ MongoDB connection error:', err));

const getUserGoal = async (userId) => {
  return await goalsCollection.findOne({ userId });
};

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
    // Fetch meals for today
    const meals = await mealsCollection.find({ userId, date }).toArray();

    // Fetch activity for today
    const activityDoc = await activitiesCollection.findOne({ userId, date });

    // Fetch goal (if any)
    const goal = await getUserGoal(userId);

    // Build meals text
    let messageText = `📅 *Today's meals:*\n`;

    if (meals.length === 0) {
      messageText += `No meals logged for today.\n`;
    } else {
      const total = meals.reduce((acc, m) => {
        acc.calories += m.calories;
        acc.protein += m.protein;
        return acc;
      }, { calories: 0, protein: 0 });

      const mealList = meals
        .map(m => `🍽 ${escapeMarkdown(m.meal)} — ${m.calories} kcal, ${m.protein}g protein`)
        .join('\n');

      messageText += `${mealList}\n\n🔥 *Total:* ${total.calories} kcal, ${total.protein}g protein`;
    }

    // Add activity if present
    if (activityDoc?.activity) {
      messageText += `\n\n🏃 *Activity:* ${escapeMarkdown(activityDoc.activity)}`;
    }

    // Add goal if present
    if (goal) {
      messageText += `\n\n🎯 *Goal:* ${goal.calories} kcal, ${goal.protein}g protein`;
    }

    bot.sendMessage(msg.chat.id, messageText, { parse_mode: 'MarkdownV2' });

  } catch (err) {
    console.error('Error fetching today\'s meals:', err);
    bot.sendMessage(msg.chat.id, '❌ Error fetching today\'s meals. Try again later.');
  }
};
const handleDayMeals = async (bot, mealsCollection, msg, match) => {
  const userId = msg.from.id;
  const date = match[1];

  try {
    const meals = await mealsCollection.find({ userId, date }).toArray();
    const activityDoc = await activitiesCollection.findOne({ userId, date });
    const goal = await getUserGoal(userId);

    let messageText = `📅 *Meals for ${escapeMarkdown(date)}:*\n`;

    if (!meals.length) {
      messageText += `No meals logged for this day.`;
    } else {
      const total = meals.reduce((acc, m) => {
        acc.calories += m.calories;
        acc.protein += m.protein;
        return acc;
      }, { calories: 0, protein: 0 });

      const mealList = meals.map(m =>
        `🍽 ${escapeMarkdown(m.meal)} — ${m.calories} kcal, ${m.protein}g`
      ).join('\n');

      messageText += `${mealList}\n\n🔥 *Total:* ${total.calories} kcal, ${total.protein}g`;
    }

    if (activityDoc?.activity) {
      messageText += `\n\n🏃 *Activity:* ${escapeMarkdown(activityDoc.activity)}`;
    }

    if (goal) {
      messageText += `\n\n🎯 *Goal:* ${goal.calories} kcal, ${goal.protein}g protein`;
    }

    bot.sendMessage(msg.chat.id, messageText, { parse_mode: 'MarkdownV2' });

  } catch (err) {
    console.error(`Error fetching meals for ${date}:`, err);
    bot.sendMessage(msg.chat.id, `❌ Error fetching data for ${date}. Try again later.`);
  }
};
const handleWeekMeals = async (bot, mealsCollection, msg) => {
  const userId = msg.from.id;

  const now = new Date();
  const startDate = new Date();
  startDate.setDate(now.getDate() - 6); // Last 7 days including today
  startDate.setHours(0, 0, 0, 0);

  try {
    // Fetch meals
    const meals = await mealsCollection.find({
      userId,
      timestamp: { $gte: startDate }
    }).toArray();

    // Fetch activities
    const activitiesCursor = await activitiesCollection.find({
      userId,
      timestamp: { $gte: startDate }
    }).toArray();

    if (!meals.length && !activitiesCursor.length) {
      return bot.sendMessage(msg.chat.id, 'No meals or activities found in the last 7 days.');
    }

    const goal = await getUserGoal(userId);

    // Group meals by date
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

    // Map activities by date
    const activitiesMap = {};
    for (const activity of activitiesCursor) {
      const date = activity.timestamp.toISOString().split('T')[0];
      activitiesMap[date] = activity.activity;
    }

    // Collect all unique dates (from meals and activities)
    const allDates = new Set([
      ...Object.keys(dailyStats),
      ...Object.keys(activitiesMap)
    ]);

    const sortedDates = Array.from(allDates).sort(); // Ascending order

    // Calculate totals from days that had meals
    const totalCalories = Object.values(dailyStats).reduce((sum, stat) => sum + stat.calories, 0);
    const totalProtein = Object.values(dailyStats).reduce((sum, stat) => sum + stat.protein, 0);
    const totalDays = Object.keys(dailyStats).length;

    const avgCalories = totalDays ? Math.round(totalCalories / totalDays) : 0;
    const avgProtein = totalDays ? Math.round(totalProtein / totalDays) : 0;

    // Format lines
    const dayLines = sortedDates.map(date => {
      const stats = dailyStats[date];
      const activity = activitiesMap[date];
      const mealLine = stats
        ? `${stats.calories} kcal, ${stats.protein}g protein (${stats.count} meal${stats.count > 1 ? 's' : ''})`
        : `No meals`;

      const activityLine = activity ? `🏃 ${escapeMarkdown(activity)}` : '';
      return `📆 ${date}: ${mealLine}${activityLine ? `\n   ${activityLine}` : ''}`;
    }).join('\n');

    const summary = `📊 *Last 7 Days Summary:*\n\n${dayLines}\n\n🔥 *Average/day:* ${avgCalories} kcal\n💪 *Average/day:* ${avgProtein}g protein${goal ? `\n\n🎯 *Goal:* ${goal.calories} kcal, ${goal.protein}g protein` : ''}`;

    bot.sendMessage(msg.chat.id, summary, { parse_mode: 'Markdown' });

  } catch (err) {
    console.error('Error fetching weekly meals or activities:', err);
    bot.sendMessage(msg.chat.id, '❌ Error fetching last 7 days of data. Try again later.');
  }
};

const handleAllDaysAverage = async (bot, mealsCollection, msg) => {
  const userId = msg.from.id;

  try {
    // Get daily meal totals
    const result = await mealsCollection.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }
          },
          totalCalories: { $sum: '$calories' },
          totalProtein: { $sum: '$protein' },
          mealCount: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]).toArray();

    if (!result.length) {
      return bot.sendMessage(msg.chat.id, 'No meal data found.');
    }

    // Get all activities by date
    const activityDocs = await activitiesCollection.find({ userId }).toArray();
    const activityMap = {};
    for (const activity of activityDocs) {
      const date = activity.timestamp.toISOString().split('T')[0];
      activityMap[date] = activity.activity;
    }

    // Build lines with activity
    const lines = result.map(day => {
      const date = day._id.date;
      const activity = activityMap[date];

      const mealSummary = `🔥 ${day.totalCalories} kcal, 💪 ${day.totalProtein}g (from ${day.mealCount} meal${day.mealCount > 1 ? 's' : ''})`;
      const activityLine = activity ? `\n🏃 ${escapeMarkdown(activity)}` : '';

      return `📆 ${date}: ${mealSummary}${activityLine}`;
    });

    const message = `📈 *Daily Averages (All Time):*\n\n${lines.join('\n')}`;

    bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });

  } catch (err) {
    console.error('Error fetching daily averages:', err);
    bot.sendMessage(msg.chat.id, '❌ Failed to fetch daily averages. Try again later.');
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