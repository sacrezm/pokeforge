// Engine snapshots (schemaVersion 1) in the shape the preview engine returns, one per world a test needs.
const evs = (hp = 0, attack = 0, speed = 0) =>
  ({ hp, attack, defense: 0, 'special-attack': 0, 'special-defense': 0, speed })

const pokemon = (id: string, speciesID: number, name: string, level: number, extra: Record<string, unknown> = {}) => ({
  id, speciesID, name, shiny: false, level, xp: level * 20, nextXP: 90, rarity: 'common', nature: 'jolly',
  evs: evs(), trainer: null, trainable: true, raising: false, recordedAt: 1790950000 + speciesID, ...extra,
})

const COLLECTION = [
  pokemon('p-pikachu', 25, 'Pikachu', 12, { evs: evs(40, 12, 120), trainer: 'Mathias', raising: true }),
  pokemon('p-eevee', 133, 'Eevee', 7, { shiny: true, rarity: 'uncommon' }),
  pokemon('p-bulbasaur', 1, 'Bulbasaur', 5),
  pokemon('p-charmander', 4, 'Charmander', 9),
  pokemon('p-squirtle', 7, 'Squirtle', 3),
  pokemon('p-gengar', 94, 'Gengar', 31, { rarity: 'rare' }),
  pokemon('p-magikarp', 129, 'Magikarp', 2, { shiny: true }),
  pokemon('p-snorlax', 143, 'Snorlax', 20, { rarity: 'rare' }),
  pokemon('p-dragonite', 149, 'Dragonite', 55, { rarity: 'rare', nextXP: null }),
  pokemon('p-mewtwo', 150, 'Mewtwo', 70, { rarity: 'legendary', trainable: false }),
]

const NO_USAGE = { providers: [], limits: [], refreshing: false, stale: false, updatedAt: null }

const EGG = {
  schemaVersion: 1,
  collection: [pokemon('p-pikachu', 25, 'Pikachu', 5)],
  companion: { activeID: null, egg: true, name: 'Token Egg', shiny: false, speciesID: null, progress: 0.25, remaining: 750000, hatching: false, finalStage: false },
  training: { mode: 'catching', target: 'p-pikachu', focus: 'hp', canCandy: true, canMint: false },
  items: [
    { id: 'rareCandy', count: 3, price: 5000000, canBuy: true, passive: false },
    { id: 'mint', count: 0, price: 2000000, canBuy: true, passive: false },
    { id: 'shinyCharm', count: 0, price: 3000000000, canBuy: false, passive: true },
  ],
  balls: [
    { id: 'pokeBall', count: 1, price: 1000000 },
    { id: 'greatBall', count: 0, price: 3000000 },
  ],
  wallet: 30000000,
  queuedBall: null,
  usage: NO_USAGE,
  sandbox: false,
  headless: true,
  saveError: false,
  enginePID: 4242,
  modArt: null as null | Record<string, unknown>,
}

const HATCHED = {
  ...EGG,
  collection: COLLECTION,
  companion: { activeID: 'p-pikachu', egg: false, name: 'Pikachu', shiny: false, speciesID: 25, progress: 0.4, remaining: 600000, hatching: false, finalStage: false },
  training: { mode: 'balanced', target: 'p-pikachu', focus: 'speed', canCandy: true, canMint: true },
  usage: {
    ...NO_USAGE,
    providers: [
      { name: 'Claude Code', today: 120000, week: 800000, month: 3100000, cost: 12.5, costEstimated: true, costPartial: false,
        daily: [{ date: '2026-09-30', tokens: 90000 }, { date: '2026-10-01', tokens: 140000 }, { date: '2026-10-02', tokens: 120000 }] },
      { name: 'Codex', today: 30000, week: 90000, month: 400000, cost: null, costEstimated: false, costPartial: true,
        daily: [{ date: '2026-10-02', tokens: 30000 }] },
    ],
    limits: [{ provider: 'Claude Code', used: 42.4, reset: 1790990000 }, { provider: 'Codex', used: 12, reset: null }],
  },
}

export const SNAPSHOTS = {
  /** An unhatched egg; one Pokémon owned. */
  egg: EGG,
  /** A hatched shiny-less companion, ten Pokémon (two shinies, one untrainable), usage with providers, daily and limits. */
  hatched: HATCHED,
  /** Nothing owned yet: no trainee, nothing to candy. */
  empty: { ...EGG, collection: [], training: { ...EGG.training, target: null, canCandy: false } },
  /** Pokémon owned, none of them trainable. */
  untrainable: { ...HATCHED, collection: COLLECTION.map(p => ({ ...p, trainable: false })), training: { ...HATCHED.training, mode: 'catching', target: null, canCandy: false, canMint: false } },
  /** A real-sized save: 85 trainable Pokémon, more than a Select may list; the trainee is the weakest. */
  crowded: { ...HATCHED, collection: Array.from({ length: 85 }, (_, n) => pokemon(`p-${n}`, n + 1, `Mon ${n}`, n + 2)), training: { ...HATCHED.training, target: 'p-0' } },
  /** A wallet too low for anything in the shop. */
  poor: { ...HATCHED, wallet: 100, items: HATCHED.items.map(item => ({ ...item, canBuy: false })) },
}


