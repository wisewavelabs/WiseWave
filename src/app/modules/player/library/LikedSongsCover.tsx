export function LikedSongsCover({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden className={className} focusable="false" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="liked-songs-gradient" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#e17a8f" />
          <stop offset="52%" stopColor="#a66582" />
          <stop offset="100%" stopColor="#7188a6" />
        </linearGradient>
      </defs>
      <rect fill="url(#liked-songs-gradient)" height="100" width="100" />
      <path
        d="M50 68c-.6 0-1.2-.2-1.7-.6l-13-11.2C31 52.6 30 49.5 30 46.2 30 40.6 34.3 36 39.7 36c3 0 5.8 1.4 7.7 3.8l2.6 3.2 2.6-3.2c1.9-2.4 4.7-3.8 7.7-3.8C65.7 36 70 40.6 70 46.2c0 3.3-1 6.4-5.3 10l-13 11.2c-.5.4-1.1.6-1.7.6z"
        fill="#fff"
      />
    </svg>
  );
}

