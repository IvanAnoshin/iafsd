export default function GearIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.38 3.2h3.24l.48 2.04c.42.12.82.28 1.2.5l1.84-1.02 2.3 2.3-1.02 1.84c.22.38.38.78.5 1.2l2.04.48v3.24l-2.04.48c-.12.42-.28.82-.5 1.2l1.02 1.84-2.3 2.3-1.84-1.02c-.38.22-.78.38-1.2.5l-.48 2.04h-3.24l-.48-2.04c-.42-.12-.82-.28-1.2-.5l-1.84 1.02-2.3-2.3 1.02-1.84a6.9 6.9 0 0 1-.5-1.2l-2.04-.48v-3.24l2.04-.48c.12-.42.28-.82.5-1.2L4.72 7.02l2.3-2.3 1.84 1.02c.38-.22.78-.38 1.2-.5l.48-2.04Z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  );
}
