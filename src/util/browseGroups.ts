// Explore's sections (spec "Explorar"). Spotify sends Browse all as one list with no groups,
// so the app groups it by page id: the ids are the same in every language, and a tile Spotify
// adds later lands in Discover until it is placed here.

/** Genre pages. */
const GENRES = new Set([
  "0JQ5DAqbMKFEC4WFtoNRpw", // Pop
  "0JQ5DAqbMKFxXaXKP7zcDp", // Latin
  "0JQ5DAqbMKFQ00XGBls6ym", // Hip-Hop
  "0JQ5DAqbMKFDXXwE9BDJAr", // Rock
  "0JQ5DAqbMKFHOzuVTgTizF", // Dance/Electronic
  "0JQ5DAqbMKFCkm2Enfbj7Y", // Brazilian Funk
  "0JQ5DAqbMKFNT6Du8qM9kt", // Brazilian Music
  "0JQ5DAqbMKFCWjUTdzaG0e", // Indie
  "0JQ5DAqbMKFEZPnFQSFB1T", // R&B
  "0JQ5DAqbMKFGvOw3O4nLAf", // K-pop
  "0JQ5DAqbMKFDkd668ypn6O", // Metal
  "0JQ5DAqbMKFziKOShCi009", // Anime
  "0JQ5DAqbMKFAJ5xb0fwo9m", // Jazz
  "0JQ5DAqbMKFPrEiAOxgac3", // Classical
  "0JQ5DAqbMKFy78wprEpAjl", // Folk & Acoustic
  "0JQ5DAqbMKFIpEuaCnimBj", // Soul
  "0JQ5DAqbMKFRieVZLLoo9m", // Instrumental
  "0JQ5DAqbMKFAjfauKLOZiv", // Punk
  "0JQ5DAqbMKFLjmiZRss79w", // Ambient
  "0JQ5DAqbMKFQiK2EHwyjcU", // Blues
  "0JQ5DAqbMKFFtlLYUHv8bT", // Alternative
  "0JQ5DAqbMKFObNLOHydSW8", // Caribbean
  "0JQ5DAqbMKFNQ0fGp4byGU", // Afro
  "0JQ5DAqbMKFFsW9N8maB6z", // Funk & Disco
  "0JQ5DAqbMKFKLfwjuJMoNC", // Country
  "0JQ5DAqbMKFKGQWi5egawY", // Brazil
  "0JQ5DAqbMKFQFQN0rnK48G", // Flamenco
  "0JQ5DAqbMKFHCaWrPJOoNF", // MPB
  "0JQ5DAqbMKFJKoGyUMo2hE", // Reggae
  "0JQ5DAqbMKFJCTDO6ndZMP", // Sertanejo
]);

/** Mood and moment pages. */
const MOODS = new Set([
  "0JQ5DAqbMKFzHmL4tf05da", // Mood
  "0JQ5DAqbMKFCbimwdOYlsl", // Focus
  "0JQ5DAqbMKFAXlCG6QvYQ4", // Workout Music
  "0JQ5DAqbMKFFzDl7qN9Apr", // Chill
  "0JQ5DAqbMKFCuoRTxhYWow", // Sleep
  "0JQ5DAqbMKFA6SOHvT3gck", // Party
  "0JQ5DAqbMKFAUsdyVjCQuL", // Love
  "0JQ5DAqbMKFx0uLQR2okcc", // At Home
  "0JQ5DAqbMKFAQy4HL4XU2D", // Travel
  "0JQ5DAqbMKFRY5ok2pxXJ0", // Cooking & Dining
  "0JQ5DAqbMKFLb2EqgLtpjC", // Wellness
  "0JQ5DAqbMKFI3pNLtYMD9S", // Nature & Noise
  "0JQ5DAqbMKFJ6dHNHTv6Mx", // Fitness
  "0JQ5DAqbMKFCfObibaOZbv", // Gaming
  "0JQ5DAqbMKFNwFFRSG0HRv", // Karaoke
]);

/** The quick mood chips on top of Explore, in this order. */
export const MOOD_CHIPS = [
  "0JQ5DAqbMKFCbimwdOYlsl", // Focus
  "0JQ5DAqbMKFAXlCG6QvYQ4", // Workout Music
  "0JQ5DAqbMKFCuoRTxhYWow", // Sleep
  "0JQ5DAqbMKFA6SOHvT3gck", // Party
  "0JQ5DAqbMKFFzDl7qN9Apr", // Chill
  "0JQ5DAqbMKFAQy4HL4XU2D", // Travel
].map((id) => `spotify:page:${id}`);

export type BrowseGroup = "genres" | "moods" | "discover";

export const BROWSE_GROUPS: { id: BrowseGroup; title: string }[] = [
  { id: "genres", title: "Genres" },
  { id: "moods", title: "Mood and moment" },
  { id: "discover", title: "Discover" },
];

export function browseGroup(uri: string): BrowseGroup {
  const id = uri.split(":").pop() ?? "";
  return GENRES.has(id) ? "genres" : MOODS.has(id) ? "moods" : "discover";
}
