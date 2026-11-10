interface IconProps {
  className?: string;
}

export {
  ArrowLeft as MenuBackIcon,
  Check as MenuCheckIcon,
  ChevronRight as MenuChevronIcon,
  Globe2 as MenuPublicIcon,
  Copy as MenuCopyIcon,
  ListMusic as MenuQueueIcon,
  ListPlus as MenuPlaylistIcon,
  Lock as MenuPrivateIcon,
  Pencil as MenuEditIcon,
  Trash2 as MenuTrashIcon,
} from "lucide-react";

function Glyph({ className, path, strokeWidth }: IconProps & { path: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" focusable="false" viewBox="0 0 16 16">
      <path
        d={path}
        stroke={strokeWidth ? "currentColor" : undefined}
        strokeLinecap={strokeWidth ? "round" : undefined}
        strokeLinejoin={strokeWidth ? "round" : undefined}
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}

export function ListCollapseIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M10 5h11" />
      <path d="M10 12h11" />
      <path d="M10 19h11" />
      <path d="m3 10 3-3-3-3" />
      <path d="m3 20 3-3-3-3" />
    </svg>
  );
}

export function NextIcon({ className }: IconProps) {
  return <Glyph className={className} path="M12.7 1a.7.7 0 0 0-.7.7v5.15L2.05 1.107A.7.7 0 0 0 1 1.712v12.575a.7.7 0 0 0 1.05.607L12 9.149V14.3a.7.7 0 0 0 .7.7h1.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z" />;
}

export function PreviousIcon({ className }: IconProps) {
  return <Glyph className={className} path="M3.3 1a.7.7 0 0 1 .7.7v5.15l9.95-5.744a.7.7 0 0 1 1.05.606v12.575a.7.7 0 0 1-1.05.607L4 9.149V14.3a.7.7 0 0 1-.7.7H1.7a.7.7 0 0 1-.7-.7V1.7a.7.7 0 0 1 .7-.7z" />;
}

export function RepeatIcon({ className, one = false }: IconProps & { one?: boolean }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" focusable="false" viewBox="0 0 16 16">
      <path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L6.939 12.75l2.829-2.828a.75.75 0 1 1 1.06 1.06L9.811 12h2.439a2.25 2.25 0 0 0 2.25-2.25v-5a2.25 2.25 0 0 0-2.25-2.25h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75z" />
      {one && <text dominantBaseline="central" fontSize="7" fontWeight="800" textAnchor="middle" x="8" y="7.5">1</text>}
    </svg>
  );
}

export function AutoplayIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return <Glyph className={className} path="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7z" strokeWidth={1.4} />;
}

export function PlayIcon({ className }: IconProps) {
  return <Glyph className={className} path="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288z" />;
}

export function HomeIcon({ className }: IconProps) {
  return <svg aria-hidden="true" className={className} fill="currentColor" focusable="false" viewBox="0 0 24 24"><path d="M12.5 3.247a1 1 0 0 0-1 0L4 7.577V20h4.5v-6a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v6H20V7.577zm-2-1.732a3 3 0 0 1 3 0l7.5 4.33a2 2 0 0 1 1 1.732V21a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1v-6h-3v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7.577a2 2 0 0 1 1-1.732z" /></svg>;
}

export const MenuPlayIcon = PlayIcon;

export function MenuHeartIcon({ className, filled = false }: IconProps & { filled?: boolean }) {
  return <svg aria-hidden="true" className={className} fill={filled ? "currentColor" : "none"} focusable="false" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 32 32"><path d="M2.66675 12.3311C2.66675 7.87873 5.55164 3.99997 10.2401 3.99997C12.8574 3.99997 14.6667 5.33148 16.0001 7.33148C17.3334 5.33148 19.1427 3.99997 21.7601 3.99997C26.4485 3.99997 29.3334 7.87873 29.3334 12.3311C29.3334 20.0799 22.1889 24.9023 16.0001 27.9981C9.81127 24.9023 2.66675 20.0799 2.66675 12.3311Z" /></svg>;
}

export function ShuffleIcon({ className }: IconProps) {
  return <Glyph className={className} path="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06L15.98 3.75zm-.06 10.096a.75.75 0 1 0-1.06 1.06l1.017 1.018H11.16a2.25 2.25 0 0 1-1.724-.804l-1.98-2.36-.98 1.168 1.813 2.159A3.75 3.75 0 0 0 11.16 15h1.949l-1.018 1.018a.75.75 0 0 0 1.06 1.06l2.83-2.828zM.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5" />;
}

export function PlaylistPinIcon({ className }: IconProps) {
  return <Glyph className={className} path="M8.822.797a2.72 2.72 0 0 1 3.847 0l2.534 2.533a2.72 2.72 0 0 1 0 3.848l-3.678 3.678-1.337 4.988-4.486-4.486L1.28 15.78a.75.75 0 0 1-1.06-1.06l4.422-4.422L.156 5.812l4.987-1.337z" />;
}

export const MenuPinIcon = PlaylistPinIcon;

export function MenuShareIcon({ className }: IconProps) {
  return <svg aria-hidden="true" className={className} fill="none" focusable="false" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>;
}
