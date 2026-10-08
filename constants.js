const ROOM_TYPES = ['Single', 'Double', 'Deluxe', 'Suite'];

const ROOM_IMAGES = {
  Single: 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=900&q=80',
  Double: 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=80',
  Deluxe: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=900&q=80',
  Suite: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80',
};

const ALL_AMENITIES = [
  'Wi-Fi',
  'Air conditioning',
  'TV',
  'Desk',
  'Mini fridge',
  'Mini bar',
  'Bathtub',
  'Room service',
  'Balcony',
  'Kitchenette',
  'Safe',
  'Coffee maker',
];

const ROOM_AMENITIES = {
  Single: ['Wi-Fi', 'Air conditioning', 'TV', 'Desk'],
  Double: ['Wi-Fi', 'Air conditioning', 'TV', 'Mini fridge', 'Desk'],
  Deluxe: ['Wi-Fi', 'Air conditioning', 'TV', 'Mini bar', 'Bathtub', 'Room service', 'Safe'],
  Suite: ['Wi-Fi', 'Air conditioning', 'TV', 'Mini bar', 'Bathtub', 'Room service', 'Balcony', 'Kitchenette', 'Coffee maker'],
};

const HOTEL_AMENITIES = [
  { name: 'Swimming pool', detail: 'Heated outdoor pool, 6am–10pm' },
  { name: 'Spa & wellness', detail: 'Massage and steam rooms by appointment' },
  { name: 'Fitness centre', detail: '24-hour gym with cardio and weights' },
  { name: 'Restaurant', detail: 'All-day dining and in-room service' },
  { name: 'Free parking', detail: 'Secure on-site parking for guests' },
  { name: 'Airport transfer', detail: 'Paid shuttle on request' },
  { name: 'High-speed Wi-Fi', detail: 'Complimentary throughout the hotel' },
  { name: '24-hour reception', detail: 'Front desk and concierge always open' },
];

function normalizeAmenities(raw, type) {
  if (raw == null) return [...(ROOM_AMENITIES[type] || [])];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const allowed = new Set(ALL_AMENITIES);
  return [...new Set(list.map((s) => String(s).trim()).filter((s) => allowed.has(s)))];
}

function parseAmenities(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

module.exports = {
  ROOM_TYPES,
  ROOM_IMAGES,
  ALL_AMENITIES,
  ROOM_AMENITIES,
  HOTEL_AMENITIES,
  normalizeAmenities,
  parseAmenities,
};
