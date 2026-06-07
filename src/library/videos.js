export const concertVideos = [
  {
    id: "bnnIdWzGSYI",
    youtube_id: "bnnIdWzGSYI",
    youtube_url: "https://www.youtube.com/watch?v=bnnIdWzGSYI",
    title: "King Gizzard - Live in Greece '25 Night 2",
    duration_s: 8753,
    tracklist_source: {
      name: "Bandcamp",
      url: "https://midnightgnomepeople.bandcamp.com/album/live-in-greece-25",
      note: "Night 2 is the YouTube video bnnIdWzGSYI. Tracks 18-33 are the Night 2 song order.",
    },
    tracklist_intro_offset_s: 833,
    // `music_end_offset_s` is the song-relative time where the music actually
    // ends, distinct from `duration_s` which spans through the trailing
    // banter/applause/intermission up to the next song's start. Detected via
    // `tools/analyze-music-end.mjs` (smoothed-loudness threshold) and
    // rider-validated on Motor Spirit (F2-anchored end at 1775.9 matched the
    // detected 1777, ~1.1s diff). Songs without this field run music straight
    // through to `duration_s` (continuous live segues).
    tracks: [
      { title: "Gila Monster", duration_s: 286 },
      { title: "Motor Spirit", duration_s: 676, music_end_offset_s: 658 },
      { title: "I'm in Your Mind", duration_s: 241 },
      { title: "I'm Not in Your Mind", duration_s: 269 },
      { title: "Cellophane", duration_s: 408 },
      { title: "I'm in Your Mind Fuzz", duration_s: 220 },
      { title: "The Balrog", duration_s: 300, music_end_offset_s: 270 },
      { title: "Ambergris", duration_s: 355 },
      { title: "Sad Pilot", duration_s: 416, music_end_offset_s: 393 },
      { title: "Iron Lung", duration_s: 1034 },
      { title: "Evil Death Roll", duration_s: 606 },
      { title: "Muddy Water", duration_s: 343 },
      { title: "The Bitter Boogie", duration_s: 538, music_end_offset_s: 522 },
      { title: "Hog Calling Contest", duration_s: 274, music_end_offset_s: 266 },
      { title: "Kepler-22b", duration_s: 824 },
      { title: "Set", duration_s: 1130, music_end_offset_s: 1096 },
    ],
  },
];
