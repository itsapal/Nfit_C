Place preset songs in subfolders here.

Folder format:
songs/<preset-folder>/<audio-files>

Then list them in:
songs/presets.js

Example:
window.SONG_PRESETS = [
  {
    name: "Chill Night",
    tracks: [
      { name: "Track 01", url: "./songs/chill-night/track-01.mp3" },
      { name: "Track 02", url: "./songs/chill-night/track-02.mp3" }
    ]
  }
];

Supported formats: mp3, wav, ogg, m4a, flac

Notes:
- Works when opening index.html directly (file://) and with Vite.
- Preset name comes from the "name" field in presets.js.
- Clicking a preset adds all songs from that preset to the queue.
