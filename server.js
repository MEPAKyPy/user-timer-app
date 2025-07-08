const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage
let users = [];
let timers = new Map();

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateTimer(userId) {
  const user = users.find(u => u.id === userId);
  if (!user || !user.isRunning || user.isExpired) return;

  user.timeLeft--;
  
  if (user.timeLeft <= 0) {
    user.timeLeft = 0;
    user.isRunning = false;
    user.isExpired = true;
    
    if (timers.has(userId)) {
      clearInterval(timers.get(userId));
      timers.delete(userId);
    }
  }
  
  io.emit('userUpdated', user);
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.emit('usersState', users);
  
  socket.on('addUser', (userData) => {
    const existingUser = users.find(u => u.name.toLowerCase() === userData.name.toLowerCase());
    if (existingUser) {
      socket.emit('error', 'User already exists');
      return;
    }
    
    const user = {
      id: Date.now(),
      name: userData.name,
      timeLeft: 90 * 60,
      isRunning: false,
      isExpired: false,
      createdAt: new Date()
    };
    
    users.push(user);
    io.emit('userAdded', user);
  });
  
  socket.on('deleteUser', (userId) => {
    if (timers.has(userId)) {
      clearInterval(timers.get(userId));
      timers.delete(userId);
    }
    
    users = users.filter(user => user.id !== userId);
    io.emit('userDeleted', userId);
  });
  
  socket.on('toggleTimer', (userId) => {
    const user = users.find(u => u.id === userId);
    if (!user || user.isExpired) return;
    
    if (user.isRunning) {
      user.isRunning = false;
      if (timers.has(userId)) {
        clearInterval(timers.get(userId));
        timers.delete(userId);
      }
    } else {
      user.isRunning = true;
      const intervalId = setInterval(() => updateTimer(userId), 1000);
      timers.set(userId, intervalId);
    }
    
    io.emit('userUpdated', user);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

cron.schedule('*/5 * * * *', () => {
  console.log('Saving state... Users count:', users.length);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  timers.forEach((intervalId) => clearInterval(intervalId));
  timers.clear();
  server.close(() => {
    process.exit(0);
  });
});
