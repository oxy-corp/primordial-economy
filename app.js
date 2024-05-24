require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { Faction, sequelize } = require('./models/faction');
const path = require('path');
const axios = require('axios');
const WebSocket = require('ws');

const app = express();
const port = 8080;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
client.login(process.env.DISCORD_BOT_TOKEN);

const adminIds = ['623172201088286725']; // Replace with actual Discord admin IDs

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_KEY,
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

passport.use(new DiscordStrategy({
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  callbackURL: process.env.REDIRECT_URI,
  scope: ['identify', 'email']
},
(accessToken, refreshToken, profile, done) => {
  process.nextTick(() => done(null, profile));
}));

// Ensure authenticated middleware
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/auth/discord');
}

// Sync database
sequelize.sync()
  .then(() => console.log('Database synced'))
  .catch(err => console.log(err));

// Routes
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', ensureAuthenticated, async (req, res) => {
  const factions = await Faction.findAll();
  const isAdmin = adminIds.includes(req.user.id);
  const userId = req.user.id;
  const userFactions = factions.filter(faction => faction.members['userId'] === userId);
  res.render('index', { factions, isAdmin, userFactions });
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/');
});

app.post('/update-economy', ensureAuthenticated, async (req, res) => {
  const { factionName, economy } = req.body;
  await Faction.update({ economy }, { where: { name: factionName } });
  res.redirect('/');
});

app.post('/update-money', ensureAuthenticated, async (req, res) => {
  const { factionName, money } = req.body;
  await Faction.update({ money }, { where: { name: factionName } });
  res.redirect('/');
  });

app.post('/remove-faction', ensureAuthenticated, async (req, res) => {
  const { factionName } = req.body;
  try {
    await Faction.destroy({ where: { name: factionName } });
    res.redirect('/');
  } catch (error) {
    console.error('Error removing faction:', error);
    res.status(500).send('An error occurred while trying to remove the faction.');
  }
});

app.post('/add-faction', ensureAuthenticated, async (req, res) => {
  if (!adminIds.includes(req.user.id)) {
    return res.status(403).send('You are not authorized to perform this action.');
  }

  const { name, leader, memberCount, userID } = req.body;
  console.log('Received faction data:', name, leader, memberCount);

  try {
    if (!name || !leader || isNaN(memberCount)) {
      return res.status(400).send('Invalid faction data. Please provide name, leader, and member count.');
    }

    const existingFaction = await Faction.findOne({ where: { name } });
    if (existingFaction) {
      return res.status(409).send(`Faction ${name} already exists.`);
    }

    const manualID = '1242220382480502875';
    const newFaction = await Faction.create({
      name,
      leader,
      members: { count: memberCount, userId: userID || manualID }
    });

    res.redirect('/');
    await announceChanges();
  } catch (error) {
    console.error('Error adding faction:', error);
    res.status(500).send('An error occurred while trying to add the faction.');
  }
});

// Define the sabotage command
client.on('messageCreate', async message => {
    if (message.content.startsWith('!sabotage')) {
        const args = message.content.split(' ');
        const targetFactionName = args[1];

        try {
            // Find the target faction
            const targetFaction = await Faction.findOne({ where: { name: targetFactionName } });
            if (targetFaction) {
                // Reduce the economy of the target faction
                targetFaction.economy -= 10;
                await targetFaction.save();

                message.channel.send(`Successfully sabotaged ${targetFactionName}. New economy: ${targetFaction.economy}%`);

                // Announce changes to a specific channel
                announceChanges();
            } else {
                message.channel.send(`Faction ${targetFactionName} not found.`);
            }
        } catch (error) {
            console.error(error);
            message.channel.send('An error occurred while trying to sabotage the faction.');
        }
    }
});

// Define the addFaction command
client.on('messageCreate', async message => {
    if (message.content.startsWith('!addFaction')) {
        const args = message.content.split(' ');
        const factionName = args[1];
        const leader = args[2];
        const memberCount = parseInt(args[3]);

        if (!factionName || !leader || isNaN(memberCount)) {
            return message.channel.send('Invalid command format. Use: !addFaction <name> <leader> <memberCount>');
        }

        try {
            // Check if the faction already exists
            const existingFaction = await Faction.findOne({ where: { name: factionName } });
            if (existingFaction) {
                return message.channel.send(`Faction ${factionName} already exists.`);
            }

            // Add new faction
            const newFaction = await Faction.create({
                name: factionName,
                leader: leader,
                members: { count: memberCount, userId: message.author.id }  // Assuming members is a JSON field
            });

            message.channel.send(`Faction ${factionName} with leader ${leader} and ${memberCount} members has been created.`);
            
            // Announce changes to a specific channel
            await announceChanges(action = 'addFaction');
        } catch (error) {
            console.error(error);
            message.channel.send('An error occurred while trying to add the faction.');
        }
    } else if (message.content.startsWith('!listFactions')) {
        try {
            const factions = await Faction.findAll();
            if (factions.length === 0) {
                return message.channel.send('No factions found.');
            }

            let response = 'Factions:\n';
            factions.forEach(faction => {
                response += `Name: ${faction.name}, Leader: ${faction.leader}, Members: ${faction.members.count}\n`;
            });
            message.channel.send(response);
        } catch (error) {
            console.error(error);
            message.channel.send('An error occurred while trying to list the factions.');
        }
    } else if (message.content.startsWith('!removeFaction')) {
        const args = message.content.split(' ');
        const factionName = args[1];

        if (!factionName) {
            return message.channel.send('Invalid command format. Use: !removeFaction <name>');
        }

        try {
            // Check if the faction exists
            const faction = await Faction.findOne({ where: { name: factionName } });
            if (!faction) {
                return message.channel.send(`Faction ${factionName} not found.`);
            }

            // Remove the faction
            await Faction.destroy({ where: { name: factionName } });

            message.channel.send(`Faction ${factionName} has been removed.`);
            
            // Announce changes to a specific channel
            await announceChanges(action = 'removeFaction');
        } catch (error) {
            console.error(error);
            message.channel.send('An error occurred while trying to remove the faction.');
        }
    }
});

async function announceChanges() {
  try {
    const channel = client.channels.cache.get('1242224002231963658');
    if (!channel) {
      console.error('Announcement channel not found');
      return;
    }
    const factions = await Faction.findAll();
    const embed = new EmbedBuilder()
      .setTitle('Faction Status Update')
      .setColor('#0099ff')
      .setDescription('Current status of all factions');

    factions.forEach(faction => {
      embed.addFields({ name: faction.name, value: `Leader: ${faction.leader}\nMembers: ${faction.members.count}`, inline: false });
    });

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Error sending announcement:', error);
  }
}

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
      // Parse incoming message
      const data = JSON.parse(message);
      const { action, factionName, targetFaction } = data;
      
      // Log user's information when a trade action is requested
      if (action === 'trade') {
          console.log(`User requesting trade: ${factionName}`);
          console.log(`User's faction: ${factionName}`);
          console.log(`Target faction: ${targetFaction}`);
      }
  });

  ws.send('Welcome to the WebSocket server!');
});

// Example function to send a message to all connected clients
function broadcastMessage(message) {
  wss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
          client.send(message);
      }
  });
}

// Start the server
app.listen(port, function () {
  console.log(`Server is running on port ${port}`);
});
