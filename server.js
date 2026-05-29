const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); // Tillåter att din GitHub-sida pratar med servern

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Tillåt anslutningar från alla domäner (t.ex. GitHub Pages)
        methods: ["GET", "POST"]
    }
});

// Speltillstånd
let players = [];      // Lista med alla anslutna spelare { id, name, role }
let gameActive = false; // Är rundan igång?
let secretWord = "Kaffe"; 
let imposterWord = "Te";

io.on('connection', (socket) => {
    console.log(`Ny spelare ansluten: ${socket.id}`);

    // Bestäm om spelaren får spela eller blir spectator
    let playerRole = 'waiting';
    if (gameActive) {
        playerRole = 'spectator';
    }

    // Skapa spelarobjektet
    const newPlayer = {
        id: socket.id,
        name: `Spelare ${players.length + 1}`,
        role: playerRole
    };
    
    players.push(newPlayer);

    // Skicka nuvarande spelstatus till den nya spelaren
    socket.emit('init', {
        id: socket.id,
        gameActive: gameActive,
        role: playerRole,
        isHost: players[0].id === socket.id // Första spelaren i listan blir host
    });

    // Uppdatera alla med den nya spelarlistan
    io.emit('updatePlayers', players);

    // När hosten startar spelet
    socket.on('startGame', () => {
        // Bara hosten får starta, och spelet får inte redan vara igång
        if (players[0].id !== socket.id || gameActive) return;

        // Filtrera ut de som faktiskt ska spela (inte de som joinade sent och är spectators)
        let activePlayers = players.filter(p => p.role === 'waiting');
        
        if (activePlayers.length < 3) {
            socket.emit('errorMsg', 'Det krävs minst 3 spelare för att starta!');
            return;
        }

        gameActive = true;

        // Slumpa vem som blir Imposter bland de aktiva spelarna
        const randomIndex = Math.floor(Math.random() * activePlayers.length);
        const imposterId = activePlayers[randomIndex].id;

        // Sätt roller och skicka ut orden privat till varje spelare
        players.forEach(player => {
            if (player.role === 'waiting') {
                if (player.id === imposterId) {
                    player.role = 'imposter';
                    io.to(player.id).emit('gameStarted', { role: 'imposter', word: imposterWord });
                } else {
                    player.role = 'innocent';
                    io.to(player.id).emit('gameStarted', { role: 'innocent', word: secretWord });
                }
            } else {
                // De som redan var spectators får veta att spelet startat
                io.to(player.id).emit('gameStarted', { role: 'spectator', word: 'Du tittar på...' });
            }
        });

        io.emit('gameStateChanged', { gameActive: true, players: players });
    });

    // När rundan avslutas
    socket.on('endGame', () => {
        if (players[0].id !== socket.id) return; // Bara host kan avsluta

        gameActive = false;
        
        // Återställ alla spelare till 'waiting' inför nästa runda (även gamla spectators)
        players.forEach(p => p.role = 'waiting');

        io.emit('gameEnded', { secretWord: secretWord });
        io.emit('init', { gameActive: false }); // Återställ gränssnittet
        io.emit('updatePlayers', players);
    });

    // Hantera när någon stänger sidan
    socket.on('disconnect', () => {
        console.log(`Spelare kopplade ifrån: ${socket.id}`);
        players = players.filter(p => p.id !== socket.id);
        
        // Om hosten lämnade, ge host-rollen till nästa person i kön
        if (players.length > 0) {
            io.to(players[0].id).emit('makeHost');
        } else {
            gameActive = false; // Återställ om alla lämnade
        }
        
        io.emit('updatePlayers', players);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servern körs på port ${PORT}`);
});
