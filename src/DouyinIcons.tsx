interface IconProps {
  className?: string
}

function Svg({ className, children, viewBox = '0 0 32 32' }: IconProps & { children: React.ReactNode; viewBox?: string }) {
  return <svg className={className} viewBox={viewBox} aria-hidden="true">{children}</svg>
}

export function MenuIcon(props: IconProps) {
  return <Svg {...props}><path d="M5 8h22M5 16h17M5 24h13" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" /></Svg>
}

export function SearchIcon(props: IconProps) {
  return <Svg {...props}><circle cx="14" cy="14" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.6" /><path d="m20.3 20.3 6.2 6.2" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" /></Svg>
}

export function UserIcon(props: IconProps) {
  return <Svg {...props}><circle cx="16" cy="10.5" r="6" fill="currentColor" /><path d="M5.5 28c.8-7.1 4.5-10.3 10.5-10.3S25.7 20.9 26.5 28" fill="currentColor" /></Svg>
}

export function HeartIcon(props: IconProps) {
  return <Svg {...props}><path d="M27.7 7.4c-3.3-3.3-8.7-3.3-12 0L16 7.7l.3-.3c-3.3-3.3-8.7-3.3-12 0s-3.3 8.7 0 12L16 30l11.7-10.6c3.3-3.3 3.3-8.7 0-12Z" fill="currentColor" /></Svg>
}

export function CommentIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 3.5C8.5 3.5 2.5 8.7 2.5 15.1c0 3.7 2.1 7 5.4 9.1l-.9 4.6 5.2-2.4c1.2.3 2.5.4 3.8.4 7.5 0 13.5-5.2 13.5-11.7S23.5 3.5 16 3.5Z" fill="currentColor" />
      <circle cx="10.2" cy="15.2" r="1.6" fill="#c7bbaa" />
      <circle cx="16" cy="15.2" r="1.6" fill="#c7bbaa" />
      <circle cx="21.8" cy="15.2" r="1.6" fill="#c7bbaa" />
    </Svg>
  )
}

export function StarIcon(props: IconProps) {
  return <Svg {...props}><path d="m16 2.4 4.2 8.6 9.5 1.4-6.9 6.7 1.7 9.5-8.5-4.5-8.5 4.5 1.7-9.5-6.9-6.7 9.5-1.4L16 2.4Z" fill="currentColor" /></Svg>
}

export function ShareIcon(props: IconProps) {
  return <Svg {...props}><path d="M29.2 13.5 18.5 3.3v6.1C9.2 10.1 4 15 2.8 24.8c3.4-4.2 7.6-6.1 15.7-5.8v6.3l10.7-11.8Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" /></Svg>
}

export function MusicIcon(props: IconProps) {
  return <Svg {...props}><path d="M12.3 7.4v14.1a4.9 4.9 0 1 1-2.3-4.2V9.7l13.3-2.9V18a4.9 4.9 0 1 1-2.3-4.2V4L12.3 7.4Z" fill="currentColor" /></Svg>
}

export function HomeIcon(props: IconProps) {
  return <Svg {...props}><path d="m4 14.2 12-10 12 10v13H19v-8h-6v8H4v-13Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" /></Svg>
}

export function FriendsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="11" r="5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M3.5 27c.5-6.1 3.4-9.1 8.5-9.1s8 3 8.5 9.1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M20.7 7.8a4.4 4.4 0 0 1 0 8.4M22 19c3.8.8 5.8 3.5 6.1 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </Svg>
  )
}

export function MessageIcon(props: IconProps) {
  return <Svg {...props}><path d="M16 4C8.8 4 3 8.8 3 14.8c0 3.7 2.2 7 5.7 8.9L8 28l4.8-2c1 .2 2.1.3 3.2.3 7.2 0 13-4.8 13-10.8S23.2 4 16 4Z" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round" /><path d="M9.6 14.8h.1m6.2 0h.1m6.2 0h.1" stroke="currentColor" strokeWidth="3.3" strokeLinecap="round" /></Svg>
}

export function MeIcon(props: IconProps) {
  return <Svg {...props}><circle cx="16" cy="10.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M5.5 28c.7-6.7 4.2-10 10.5-10s9.8 3.3 10.5 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></Svg>
}

export function CreateIcon(props: IconProps) {
  return (
    <Svg {...props} viewBox="0 0 48 34">
      <rect x="5" y="3" width="37" height="28" rx="9" fill="#25f4ee" />
      <rect x="8" y="3" width="37" height="28" rx="9" fill="#fe2c55" />
      <rect x="6.5" y="3" width="37" height="28" rx="9" fill="white" />
      <path d="M25 10v14M18 17h14" fill="none" stroke="#111" strokeWidth="3" strokeLinecap="round" />
    </Svg>
  )
}
