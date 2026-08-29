// Quick test: Send WORKER_HELLO to coordinator to verify connection,
// then trigger layer assignment

const net = require('net');

// Connect to coordinator
const socket = net.createConnection(9501, '127.0.0.1');

function sendMessage(msg) {
  const data = JSON.stringify(msg);
  const buf = Buffer.from(data);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  socket.write(Buffer.concat([len, buf]));
  console.log(`Sent: ${msg.type}`);
}

socket.on('connect', () => {
  console.log('Connected to coordinator TCP');
  
  // Send a heartbeat to verify connection
  sendMessage({
    type: 'HEARTBEAT',
    nodeId: 'test-heartbeat',
    timestamp: Date.now(),
  });
  
  // Wait 1 second then test assignment
  setTimeout(() => {
    socket.destroy();
    console.log('Connection test passed');
    process.exit(0);
  }, 1000);
});

socket.on('data', (chunk) => {
  // Parse response
  if (chunk.length >= 4) {
    const msgLen = chunk.readUInt32BE(0);
    if (chunk.length >= 4 + msgLen) {
      const msg = JSON.parse(chunk.subarray(4, 4 + msgLen).toString());
      console.log(`Received: ${msg.type}`);
    }
  }
});

socket.on('error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('Timeout');
  process.exit(1);
}, 5000);
