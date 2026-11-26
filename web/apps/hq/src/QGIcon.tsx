const paths = {
  overview: ["M4 4h6v8h-6zM4 16h6v4h-6zM14 12h6v8h-6zM14 4h6v4h-6z"],
  networks: [
    "M3 21l18 0M9 8l1 0M9 12l1 0M9 16l1 0M14 8l1 0M14 12l1 0M14 16l1 0M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16",
  ],
  stores: [
    "M3 21l18 0M3 7v1a3 3 0 0 0 6 0v-1m0 1a3 3 0 0 0 6 0v-1m0 1a3 3 0 0 0 6 0v-1h-18l2 -4h14l2 4M5 21l0 -10.15M19 21l0 -10.15M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4",
  ],
  devices: [
    "M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1zM7 20h10M9 16v4M15 16v4",
  ],
  batches: ["M4 6h16M4 12h16M4 18h12"],
  plans: [
    "M7.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3z",
  ],
  releases: [
    "M12 3l8 4.5v9l-8 4.5l-8 -4.5v-9zM12 12l8 -4.5M12 12v9M12 12l-8 -4.5M16 5.25l-8 4.5",
  ],
  connectors: [
    "M9.785 6l8.215 8.215l-2.054 2.054a5.81 5.81 0 1 1 -8.215 -8.215l2.054 -2.054zM4 20l3.5 -3.5M15 4l-3.5 3.5M20 9l-3.5 3.5",
  ],
  users: [
    "M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0 -3 -3.85",
  ],
  audit: [
    "M14 3v4a1 1 0 0 0 1 1h4M12 21h-5a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v4.5M14 17.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M18.5 19.5l2.5 2.5",
  ],
  documentation: [
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
    "M12 17l0 .01",
    "M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4",
  ],
  menu: [
    "M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2zM9 4v16M15 10l-2 2l2 2",
  ],
  search: ["M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M21 21l-6 -6"],
  moon: [
    "M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z",
  ],
  bell: [
    "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6",
    "M9 17v1a3 3 0 0 0 6 0v-1",
  ],
  chevron: ["M6 9l6 6l6 -6"],
  sun: [
    "M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
    "M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7",
  ],
} as const;
export type QGIconName = keyof typeof paths;
export function QGIcon({
  name,
  size = 20,
}: {
  name: QGIconName;
  size?: 16 | 20;
}) {
  return (
    <svg
      data-qg-icon={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
