const ICONS = {
  community: (
    <>
      <path d="M4.5 18.5c1.7-1.1 3.6-1.7 5.8-1.7h3.9c4 0 7.3-2.8 7.3-6.4S18.2 4 14.2 4h-4.4C5.8 4 2.5 6.8 2.5 10.4c0 1.8.8 3.4 2.2 4.5l-.2 3.6Z" />
      <path d="M8 9h8" />
      <path d="M8 12h5" />
    </>
  ),
  messages: (
    <>
      <path d="M4 6.5h16v11H4z" />
      <path d="m4.5 7 7.5 6 7.5-6" />
    </>
  ),
  music: (
    <>
      <path d="M9 18.2a2.7 2.7 0 1 1-1-2.1V5.8l9-1.8v11.2a2.7 2.7 0 1 1-1-2.1V7.3l-7 1.4v9.5Z" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 9.8c0-3.4-2.2-5.8-6-5.8s-6 2.4-6 5.8c0 4-1.5 5.1-2.2 6.2h16.4C19.5 14.9 18 13.8 18 9.8Z" />
      <path d="M9.5 19a2.7 2.7 0 0 0 5 0" />
    </>
  ),
  announcements: (
    <>
      <path d="M4 13h3l9 4.5v-13L7 9H4v4Z" />
      <path d="M7 13v4" />
      <path d="M19 9.2a3 3 0 0 1 0 3.6" />
    </>
  ),
  events: (
    <>
      <path d="M5 5.5h14v14H5z" />
      <path d="M8 3.5v4" />
      <path d="M16 3.5v4" />
      <path d="M5 9.5h14" />
      <path d="M8.5 13h2" />
      <path d="M13.5 13h2" />
      <path d="M8.5 16h2" />
    </>
  ),
  assistant: (
    <>
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7-5.6-1.9L10.1 9 12 3.5Z" />
      <path d="M19 4.5v3" />
      <path d="M20.5 6h-3" />
    </>
  ),
  profile: (
    <>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M4.5 20c1.2-3.4 4-5.2 7.5-5.2s6.3 1.8 7.5 5.2" />
    </>
  )
};

export default function NavIcon({ name }) {
  return (
    <span className="nav-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[name] || ICONS.community}
        </g>
      </svg>
    </span>
  );
}
