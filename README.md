# Hotel Room Booking System

Full-stack web app (Aim 1): add, search, book and cancel hotel rooms.

| Layer    | Technology                              |
|----------|-----------------------------------------|
| Frontend | HTML, CSS, vanilla JavaScript (Fetch)   |
| Backend  | Node.js + Express.js (REST API)         |
| Database | SQLite (Node built-in `node:sqlite`)        |

## Run

```bash
npm install          # installs Express only; Node 22.13+ required
npm start          # http://localhost:3000
npm test           # 23 automated API / edge-case tests
```

Seven sample rooms are created on first run. The database file is `hotel.db`; delete it to reset.

## Database schema

```
rooms (id PK, room_no UNIQUE, type, price)
bookings (id PK, room_id FK -> rooms.id ON DELETE CASCADE,
          guest_name, check_in, check_out, created_at)
```

One room has many bookings (one-to-many). A room's availability is **derived** from its bookings
rather than stored as a flag, so it can never get out of sync.

## REST API

| Method | Endpoint                                   | Purpose                                         |
|--------|--------------------------------------------|-------------------------------------------------|
| GET    | `/api/rooms?date=YYYY-MM-DD`               | List all rooms with status on that date (today by default) |
| GET    | `/api/rooms/search?type=&checkIn=&checkOut=` | Search available rooms by type and/or date range |
| POST   | `/api/rooms`                               | Add a room `{room_no, type, price}`             |
| PUT    | `/api/rooms/:id`                           | Update a room's type / price                    |
| DELETE | `/api/rooms/:id`                           | Delete a room (blocked if it has active bookings) |
| GET    | `/api/bookings`                            | List bookings with nights and total cost        |
| POST   | `/api/bookings`                            | Book a room `{room_id, guest_name, check_in, check_out}` |
| DELETE | `/api/bookings/:id`                        | Cancel a booking                                |

Errors return JSON `{ "error": "..." }` with 400 (validation), 404 (not found) or 409 (conflict).

## Double-booking prevention

Stays are half-open ranges `[check_in, check_out)`. Two stays on the same room overlap when
`a.check_in < b.check_out AND b.check_in < a.check_out`. The check and the insert run inside a
single SQLite transaction, so two simultaneous requests cannot both succeed. A guest may check in
on the day another checks out.

## Validation

**Client and server:** required fields, room type from a fixed list, price > 0, guest name
2-80 characters, real calendar dates (rejects e.g. 2026-02-30), check-out after check-in, no
check-in in the past, duplicate room numbers.
**Server only:** malformed JSON, non-numeric ids, overlapping dates.

## Edge cases covered by tests (`test/api.test.js`)

- Booking an already-reserved room: exact match, partial overlap at either end, fully inside, fully enclosing
- Back-to-back stays allowed; same dates on a different room allowed
- Cancelling a non-existent booking, and cancelling the same booking twice
- Rebooking dates after a cancellation
- Invalid / reversed / past / impossible dates; unknown room; blank guest name
- Deleting a room that still has bookings; updating or deleting a missing room
- Malformed JSON and unknown endpoints

## Project structure

```
hotel-booking/
├── server.js        # starts server, seeds sample rooms
├── app.js           # Express app: middleware, routes, error handling
├── db.js            # SQLite connection and schema
├── public/          # index.html, style.css, app.js (Fetch-based UI, no page reloads)
└── test/api.test.js
```
