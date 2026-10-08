const app = require('./app');
const db = require('./db');
const { ROOM_IMAGES, ROOM_AMENITIES } = require('./constants');

const PORT = process.env.PORT || 3000;

// Seed sample rooms on first run so the UI isn't empty
if (db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n === 0) {
  const insert = db.prepare(
    'INSERT INTO rooms (room_no, type, price, image_url, amenities) VALUES (?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    [
      ['101', 'Single', 1500], ['102', 'Single', 1500],
      ['201', 'Double', 2500], ['202', 'Double', 2600],
      ['301', 'Deluxe', 3800], ['302', 'Deluxe', 4000],
      ['401', 'Suite', 6500],
    ].forEach(([no, type, price]) => {
      insert.run(no, type, price, ROOM_IMAGES[type], JSON.stringify(ROOM_AMENITIES[type]));
    });
  });
  console.log('Seeded sample rooms.');
}

app.listen(PORT, () => console.log(`Hotel Booking System running at http://localhost:${PORT}`));
