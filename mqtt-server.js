// Minimalistische in-memory MQTT broker voor onderwijs
// - TCP op poort 1883
// - WebSocket op poort 8888 (handig voor browser-clients)
// - Geen persistence; reboot = alles weg
// - Topic-guard: alleen topics onder "student/<id>/..."

const aedes = require('aedes')();
const net = require('net');
const http = require('http');
const WebSocket = require('ws');

const TCP_PORT = process.env.TCP_PORT || 1883;
const WS_PORT  = process.env.WS_PORT  || 8888;

// --- Topic policy: alleen student/<id>/... toestaan
function isAllowedTopic(topic) {
  // Voorbeeld: student/12345/topic
  return /^student\/[A-Za-z0-9_-]+(\/.*)?$/.test(topic);
}

// Optioneel: beperk QoS en retained voor eenvoud
const MAX_QOS = 1; // 0 of 1 is vaak genoeg in een klas
const ALLOW_RETAINED = false;

// Logging (optioneel; zet op false voor rust)
const LOG = true;

function getCurrentDateTime() {
    const now = new Date();

    // ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)
    console.log("ISO format:", now.toISOString());

    // Local date and time
    console.log("Local date/time:", now.toLocaleString());

    // Custom format: YYYY-MM-DD HH:mm:ss
    const pad = (n) => String(n).padStart(2, '0');
    const formatted = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
                    + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    console.log("Custom format:", formatted);
}

// --- Auth (hier: alles toestaan) ---
aedes.authenticate = (client, username, password, done) => {
  // Voor de klas meestal open; je kunt hier evt. basic checks doen.
  done(null, true);
};

// --- Authorisatie publish ---
aedes.authorizePublish = (client, packet, done) => {
  const topic = packet.topic || '';

if (!isAllowedTopic(topic) || packet.payload?.length > 100){
    const err = new Error('Publish or payload not allowed to this topic');
    err.returnCode = 128;
    return done(err);
  }

  // Forceer max QoS
  if (packet.qos > MAX_QOS) packet.qos = MAX_QOS;

  // Optioneel: retained uitzetten
  if (!ALLOW_RETAINED && packet.retain) {
    packet.retain = false;
  }

  if (LOG) console.log(`[PUB] ${getCurrentDateTime()} ${client?.id || 'unknown'} -> ${topic} | ${packet.payload}`);
  done(null);
};

// --- Authorisatie subscribe ---
aedes.authorizeSubscribe = (client, sub, done) => {
  if (!isAllowedTopic(sub.topic)) {
    const err = new Error('Subscribe not allowed to this topic');
    err.returnCode = 0x80; // failure
    return done(err);
  }
  // Forceer max QoS
  if (sub.qos > MAX_QOS) sub.qos = MAX_QOS;

  if (LOG) console.log(`[SUB] ${client?.id || 'unknown'} -> ${sub.topic} (qos ${sub.qos})`);
  done(null, sub);
};

// --- Events ---
aedes.on('client', (client) => LOG && console.log(`[CONN] ${getCurrentDateTime()} ${client?.id || 'unknown'}`));
aedes.on('clientDisconnect', (client) => LOG && console.log(`[DISC] ${getCurrentDateTime()} ${client?.id || 'unknown'}`));
aedes.on('subscribe', (subs, client) => LOG && subs.forEach(s => console.log(`[EVT SUB] ${getCurrentDateTime()} ${client?.id} ${s.topic}`)));
aedes.on('unsubscribe', (subs, client) => LOG && subs.forEach(t => console.log(`[EVT UNSUB] ${getCurrentDateTime()} ${client?.id} ${t}`)));
aedes.on('publish', (packet, client) => {
  // Filter eigen broker messages
  if (packet && packet.topic && !packet.topic.startsWith('$SYS/')) {
   // LOG && console.log(`[EVT PUB] ${client?.id || 'BROKER'} -> ${packet.topic}`);
  }
});

// --- TCP server (1883) ---
const tcpServer = net.createServer(aedes.handle);
tcpServer.listen(TCP_PORT, () => {
  console.log(`MQTT TCP broker listening on :${TCP_PORT}`);
});

// --- WebSocket server (ws://host:8888) ---
const httpServer = http.createServer();
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws) => {
  const stream = WebSocket.createWebSocketStream(ws);
  aedes.handle(stream);
});

httpServer.listen(WS_PORT, () => {
  console.log(`MQTT over WebSocket listening on :${WS_PORT}`);
});

// Veilige limieten voor klaslokaal (optioneel)
aedes.mq.on('publish', (packet, cb) => {
  // eenvoudige payload-grootte limiter (~64KB)
  if (packet?.payload && packet.payload.length > 64 * 1024) {
    packet.payload = Buffer.from('Payload too large (truncated by broker)');
  }
  cb();
});
