const FRIENDS_KEY = 'dreamhome.social.friends.v1';
const MESSAGES_KEY = 'dreamhome.social.messages.v1';

const FRIEND_SEED = [
  { id: 'amber', name: 'Amber', avatar: 'A', accent: '#94ad9d', kind: 'person' },
  { id: 'momo', name: 'Momo', avatar: 'M', accent: '#7f957d', kind: 'person' },
  { id: 'xiaotuanzi', name: '小团子', avatar: '团', accent: '#d2a88a', kind: 'person' },
  { id: 'decorate-together', name: '一起装小组', avatar: '装', accent: '#b38b75', kind: 'group' },
];

const clone = (value) => JSON.parse(JSON.stringify(value));

function readStore(key, fallback) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    return stored && typeof stored === 'object' ? stored : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function nextId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

export function getFriends() {
  const store = readStore(FRIENDS_KEY, { version: 1, friends: [] });
  const storedFriends = Array.isArray(store.friends) ? store.friends : [];
  const byId = new Map(storedFriends.filter((friend) => friend?.id).map((friend) => [friend.id, friend]));
  for (const friend of FRIEND_SEED) {
    byId.set(friend.id, { ...friend, ...(byId.get(friend.id) || {}) });
  }
  const friends = [...byId.values()];
  writeStore(FRIENDS_KEY, { version: 1, friends });
  return clone(friends);
}

export function addMessage(input) {
  const friendId = String(input?.friendId || '').trim();
  if (!friendId) throw new TypeError('friendId is required');

  const friend = getFriends().find((item) => item.id === friendId);
  if (!friend) throw new TypeError(`Unknown friend: ${friendId}`);

  const store = readStore(MESSAGES_KEY, { version: 1, messages: [] });
  const messages = Array.isArray(store.messages) ? store.messages : [];
  const message = {
    id: input.id || nextId('message'),
    conversationId: `dm:${friendId}`,
    friendId,
    senderId: input.senderId || 'me',
    type: input.type || 'text',
    text: String(input.text || '').trim(),
    home: input.home ? clone(input.home) : null,
    createdAt: input.createdAt || new Date().toISOString(),
  };

  messages.push(message);
  writeStore(MESSAGES_KEY, { version: 1, messages: messages.slice(-300) });
  return clone(message);
}

export function getConversation(friendId) {
  const targetId = String(friendId || '').trim();
  const store = readStore(MESSAGES_KEY, { version: 1, messages: [] });
  const messages = Array.isArray(store.messages) ? store.messages : [];
  return clone(messages
    .filter((message) => message?.friendId === targetId)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))));
}
